function createMeetingProcessingDomain(deps) {
  const {
    artifactCollection,
    bucket,
    buildChunkTranscriptStorageObjectPath,
    buildMeetingDocId,
    buildMeetingJobPartId,
    buildQueuedMeetingJobFinalizer,
    buildQueuedMeetingJobPart,
    buildSucceededJobPatch,
    buildTranscriptArtifact,
    commitProcessedMeetingUsage,
    collectMeetingChunkTranscriptStorageObjects,
    collectMeetingSourceStorageObjects,
    createHttpError,
    db,
    deleteDocumentIfExists,
    deleteTemporarySourceGroup,
    finalizeCollection,
    formatMeetingProcessErrorMessage,
    getMeetingArtifactId,
    getMeetingChunkWorkerQueueConcurrency,
    getMeetingProcessRetryLimit,
    isRetryableMeetingProcessError,
    jobCollection,
    jobPartCollection,
    loadMeetingChunkTranscript,
    loadMeetingJobPartDocs,
    loadStoredMeetingJob,
    logEvent,
    logMeetingCleanupWarning,
    markMeetingSourceDeleted,
    maybeGenerateMeetingNotes,
    meetingCollection,
    mergeChunkTranscripts,
    mergeMeetingJobPatch,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingJobFinalizer,
    normalizeMeetingJobPart,
    normalizeMeetingOptions,
    normalizeMeetingRequest,
    normalizeMeetingSource,
    normalizeText,
    saveMeetingChunkTranscript,
    transcribeMeetingSourcePart,
    transcribeQueuedMeetingSource,
    upsertMeetingJobSummary,
  } = deps;

  async function persistMeetingJobPatch(jobRef, meetingRef, meeting, owner, currentJobInput, patch, artifactInput) {
    const storedJob = await loadStoredMeetingJob(jobRef);
    if (!storedJob?.jobId || storedJob.deletedAt) {
      return storedJob || normalizeMeetingJob(currentJobInput);
    }
    const nextJob = mergeMeetingJobPatch(storedJob, patch);
    await Promise.all([
      jobRef.set(patch, { merge: true }),
      upsertMeetingJobSummary(meetingRef, meeting, owner, nextJob, artifactInput),
    ]);
    return nextJob;
  }

  async function upsertQueuedMeetingJobParts(job) {
    const normalizedJob = normalizeMeetingJob(job);
    const existingParts = await loadMeetingJobPartDocs(normalizedJob.jobId);
    const existingByIndex = new Map(existingParts.map((part) => [Number(part.index), part]));
    const totalParts = Array.isArray(normalizedJob.source.parts) ? normalizedJob.source.parts.length : 0;
    const concurrency = getMeetingChunkWorkerQueueConcurrency(totalParts);
    const enforceQueueLimit = concurrency < Math.max(1, totalParts);
    let activeSlotCount = existingParts.filter((part) => ["processing", "queued"].includes(normalizeText(part.status))).length;
    const batch = db.batch();
    const queuedAt = new Date().toISOString();
    const expectedIndexes = new Set();
    for (const sourcePart of normalizedJob.source.parts) {
      const index = Math.max(0, Number(sourcePart.index) || 0);
      expectedIndexes.add(index);
      const partRef = db.collection(jobPartCollection).doc(buildMeetingJobPartId(normalizedJob.jobId, index));
      const existingPart = existingByIndex.get(index);
      const existingStatus = normalizeText(existingPart?.status);
      const existingTranscriptStorageObject = normalizeText(existingPart?.transcript?.storageObject);
      const isSameSource = normalizeText(existingPart?.jobId) === normalizedJob.jobId
        && Number(existingPart?.index) === index
        && normalizeText(existingPart?.part?.storageObject) === normalizeText(sourcePart?.storageObject);
      const canReuseTranscript = isSameSource
        && existingTranscriptStorageObject
        && existingStatus === "succeeded";
      let nextStatus = "pending_upload";
      if (canReuseTranscript) {
        nextStatus = "succeeded";
      } else if (isSameSource && ["processing", "queued"].includes(existingStatus)) {
        nextStatus = existingStatus;
      } else if (isSameSource && existingStatus === "failed") {
        nextStatus = "failed";
      } else if (normalizeText(sourcePart?.storageObject)) {
        if (!enforceQueueLimit || activeSlotCount < concurrency) {
          nextStatus = "queued";
          activeSlotCount += 1;
        } else {
          nextStatus = "waiting";
        }
      }
      const queuedPart = buildQueuedMeetingJobPart(
        normalizedJob,
        sourcePart,
        queuedAt,
        existingPart,
        nextStatus
      );
      batch.set(partRef, queuedPart);
    }
    for (const existingPart of existingParts) {
      if (!expectedIndexes.has(Number(existingPart.index))) {
        batch.delete(db.collection(jobPartCollection).doc(existingPart.docId));
      }
    }
    await batch.commit();
    return loadMeetingJobPartDocs(normalizedJob.jobId);
  }

  async function promoteWaitingMeetingJobParts(job, existingPartDocsInput) {
    const normalizedJob = normalizeMeetingJob(job);
    if (!normalizedJob.jobId) {
      return [];
    }
    const existingPartDocs = Array.isArray(existingPartDocsInput) && existingPartDocsInput.length
      ? existingPartDocsInput
      : await loadMeetingJobPartDocs(normalizedJob.jobId);
    const totalParts = existingPartDocs.length
      || Math.max(0, Array.isArray(normalizedJob.source.parts) ? normalizedJob.source.parts.length : 0);
    const concurrency = getMeetingChunkWorkerQueueConcurrency(totalParts);
    const processingCount = existingPartDocs.filter((part) => part.status === "processing").length;
    const queuedCount = existingPartDocs.filter((part) => part.status === "queued").length;
    const availableSlots = Math.max(0, concurrency - processingCount - queuedCount);
    if (availableSlots <= 0) {
      return existingPartDocs;
    }
    const waitingParts = existingPartDocs
      .filter((part) => part.status === "waiting")
      .sort((left, right) => left.index - right.index || left.part.startMs - right.part.startMs)
      .slice(0, availableSlots);
    if (!waitingParts.length) {
      return existingPartDocs;
    }
    const batch = db.batch();
    const queuedAt = new Date().toISOString();
    for (const waitingPart of waitingParts) {
      batch.set(
        db.collection(jobPartCollection).doc(waitingPart.docId),
        {
          error: "",
          queuedAt,
          status: "queued",
          updatedAt: queuedAt,
        },
        { merge: true }
      );
    }
    await batch.commit();
    return loadMeetingJobPartDocs(normalizedJob.jobId);
  }

  async function synchronizeChunkedMeetingJobProgress(jobRef, meetingRef, meeting, owner, currentJobInput, options, overridePatch) {
    const currentJob = normalizeMeetingJob(currentJobInput);
    const partDocs = await loadMeetingJobPartDocs(currentJob.jobId);
    const totalParts = Math.max(
      0,
      partDocs.length || Number(currentJob.progress?.totalParts) || (Array.isArray(currentJob.source?.parts) ? currentJob.source.parts.length : 0)
    );
    const processingCount = partDocs.filter((part) => part.status === "processing").length;
    const succeededCount = partDocs.filter((part) => part.status === "succeeded").length;
    const failedCount = partDocs.filter((part) => part.status === "failed").length;
    const queuedCount = partDocs.filter((part) => part.status === "queued").length;
    const transcribeProgressEndPercent = 80;
    const isFullyTranscribed = totalParts > 0 && succeededCount >= totalParts;
    const defaultPatch = {
      progress: {
        currentPart: succeededCount,
        parallelParts: processingCount,
        percent: isFullyTranscribed
          ? 80
          : Math.max(
              8,
              Math.min(
                transcribeProgressEndPercent,
                Math.round(8 + ((totalParts > 0 ? succeededCount / totalParts : 0) * (transcribeProgressEndPercent - 8)))
              )
            ),
        phase: failedCount > 0
          ? "failed"
          : isFullyTranscribed
            ? "assembling_transcript"
            : "transcribing_chunks",
        totalParts,
      },
      updatedAt: new Date().toISOString(),
    };
    const patch = {
      ...defaultPatch,
      ...(overridePatch || {}),
      progress: {
        ...defaultPatch.progress,
        ...((overridePatch && overridePatch.progress) || {}),
      },
    };
    const nextJob = await persistMeetingJobPatch(
      jobRef,
      meetingRef,
      meeting,
      owner,
      currentJob,
      patch
    );
    return {
      currentJob: nextJob,
      failedCount,
      isFullyTranscribed,
      partDocs,
      processingCount,
      queuedCount,
      succeededCount,
      totalParts,
    };
  }

  async function maybeQueueMeetingJobFinalizer(job, existingFinalizerInput) {
    const normalizedJob = normalizeMeetingJob(job);
    if (!normalizedJob.jobId || normalizedJob.deletedAt) {
      return false;
    }
    const jobRef = db.collection(jobCollection).doc(normalizedJob.jobId);
    const storedJob = await loadStoredMeetingJob(jobRef);
    if (!storedJob?.jobId || storedJob.deletedAt) {
      return false;
    }
    const finalizerRef = db.collection(finalizeCollection).doc(storedJob.jobId);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(finalizerRef);
      const currentFinalizer = snapshot.exists
        ? normalizeMeetingJobFinalizer(snapshot.data())
        : normalizeMeetingJobFinalizer(existingFinalizerInput);
      if (["queued", "processing", "succeeded"].includes(currentFinalizer.status)) {
        return false;
      }
      const queuedAt = new Date().toISOString();
      transaction.set(finalizerRef, buildQueuedMeetingJobFinalizer(storedJob, queuedAt, currentFinalizer));
      return true;
    });
  }

  async function processQueuedMeetingJobWrite(event) {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousJob = beforeSnapshot?.exists ? normalizeMeetingJob(beforeSnapshot.data()) : null;
    const queuedJob = normalizeMeetingJob(afterSnapshot.data());
    if (!queuedJob.jobId || queuedJob.deletedAt) {
      return;
    }
    if (normalizeText(queuedJob.status) !== "queued" || normalizeText(previousJob?.status) === "queued") {
      return;
    }

    const owner = queuedJob.owner && typeof queuedJob.owner === "object" ? { ...queuedJob.owner } : {};
    const meeting = normalizeMeetingRequest(queuedJob.meeting);
    const options = normalizeMeetingOptions(queuedJob.options);
    const context = normalizeMeetingContext(queuedJob.context);
    const source = normalizeMeetingSource(queuedJob.source);
    const artifactId = getMeetingArtifactId(queuedJob.jobId, owner.providerUserKey, meeting.meetingId, source.requestId, db);
    const artifactRef = db.collection(artifactCollection).doc(artifactId);
    const jobRef = db.collection(jobCollection).doc(queuedJob.jobId);
    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
    let currentJob = queuedJob;

    const persistPatch = async (patch, artifact) => {
      currentJob = await persistMeetingJobPatch(
        jobRef,
        meetingRef,
        meeting,
        owner,
        currentJob,
        patch,
        artifact
      );
      return currentJob;
    };

    try {
      await persistPatch({
        progress: {
          currentPart: source.mode === "chunked" ? 0 : 1,
          parallelParts: 0,
          percent: 8,
          phase: source.mode === "chunked" ? "transcribing_chunks" : "transcribing",
          totalParts: source.mode === "chunked" ? Math.max(0, Array.isArray(source.parts) ? source.parts.length : 0) : 1,
        },
        status: "processing",
        transcription: {
          language: meeting.language,
        },
        updatedAt: new Date().toISOString(),
      });

      if (source.mode === "chunked" && Array.isArray(source.parts) && source.parts.length) {
        const refreshedJobSnapshot = await jobRef.get();
        if (refreshedJobSnapshot.exists) {
          currentJob = normalizeMeetingJob(refreshedJobSnapshot.data());
        }
        const partDocs = await upsertQueuedMeetingJobParts(currentJob);
        const synchronized = await synchronizeChunkedMeetingJobProgress(
          jobRef,
          meetingRef,
          meeting,
          owner,
          currentJob,
          options,
          {
            progress: {
              phase: "transcribing_chunks",
            },
          }
        );
        currentJob = synchronized.currentJob;
        if (synchronized.isFullyTranscribed) {
          await maybeQueueMeetingJobFinalizer(currentJob);
        }
        logEvent("meeting.process.chunk-dispatched", {
          jobId: queuedJob.jobId,
          meetingId: meeting.meetingId,
          parallelParts: getMeetingChunkWorkerQueueConcurrency(partDocs.length),
          partCount: partDocs.length,
          providerUserKey: owner.providerUserKey,
        });
        return;
      }

      const transcript = await transcribeQueuedMeetingSource(
        source,
        meeting,
        async (progressPatch) => persistPatch(progressPatch)
      );
      await persistPatch({
        progress: {
          percent: 86,
          phase: "generating_notes",
        },
        updatedAt: new Date().toISOString(),
      });
      const meetingNotes = await maybeGenerateMeetingNotes(transcript, meeting, options, context, logEvent, owner, queuedJob.jobId);
      const completedAt = new Date().toISOString();
      const artifact = buildTranscriptArtifact(artifactId, queuedJob.jobId, meeting, owner, transcript, meetingNotes, completedAt, context);
      const deletion = await deleteTemporarySourceGroup(bucket, collectMeetingSourceStorageObjects(source));
      logMeetingCleanupWarning("meeting.process.cleanup.warning", deletion, {
        jobId: queuedJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      const succeededPatch = buildSucceededJobPatch(
        artifact,
        meeting,
        options,
        markMeetingSourceDeleted(source, deletion.deletedStorageObjects),
        context,
        transcript,
        meetingNotes,
        completedAt,
        deletion.deletedAt,
        currentJob.retry
      );
      const storedJob = await loadStoredMeetingJob(jobRef);
      if (!storedJob?.jobId || storedJob.deletedAt) {
        return;
      }
      currentJob = mergeMeetingJobPatch(storedJob, succeededPatch);
      await Promise.all([
        artifactRef.set(artifact),
        jobRef.set(succeededPatch, { merge: true }),
        upsertMeetingJobSummary(meetingRef, meeting, owner, currentJob, artifact),
      ]);
      await safelyCommitProcessedUsage(currentJob, artifact, completedAt);

      logEvent("meeting.process.success", {
        artifactId,
        chunked: source.mode === "chunked",
        jobId: queuedJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
    } catch (error) {
      const errorMessage = formatMeetingProcessErrorMessage(error);
      const nextRetryCount = Math.max(0, Number(currentJob.retry?.count) || 0) + 1;
      const retryLimit = getMeetingProcessRetryLimit();
      if (isRetryableMeetingProcessError(error) && nextRetryCount <= retryLimit) {
        const retriedAt = new Date().toISOString();
        await persistPatch({
          error: "",
          progress: {
            currentPart: 0,
            parallelParts: 0,
            percent: 0,
            phase: "queued",
            totalParts: source.mode === "chunked" ? Math.max(0, Array.isArray(source.parts) ? source.parts.length : 0) : 1,
          },
          queuedAt: retriedAt,
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          status: "queued",
          updatedAt: retriedAt,
        });
        logEvent("meeting.process.retry.queued", {
          error: normalizeText(error?.message),
          jobId: queuedJob.jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
          retryCount: nextRetryCount,
          retryLimit,
        });
        return;
      }
      const deletion = await deleteTemporarySourceGroup(bucket, collectMeetingSourceStorageObjects(source));
      logMeetingCleanupWarning("meeting.process.cleanup.warning", deletion, {
        jobId: currentJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      const failedPatch = {
        cleanup: {
          deletedAt: deletion.deletedAt,
          sourceAudioDeleted: Boolean(deletion.deletedAt),
        },
        error: errorMessage,
        progress: {
          parallelParts: 0,
          percent: 100,
          phase: "failed",
        },
        retry: {
          count: Math.max(0, Number(currentJob.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(currentJob.retry?.lastRetriedAt),
        },
        source: markMeetingSourceDeleted(source, deletion.deletedStorageObjects),
        status: "failed",
        updatedAt: new Date().toISOString(),
      };
      await persistPatch(failedPatch);
      logEvent("meeting.process.error", {
        error: normalizeText(error?.message),
        jobId: queuedJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
    }
  }

  async function processQueuedMeetingJobPartWrite(event) {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousPart = beforeSnapshot?.exists ? normalizeMeetingJobPart(beforeSnapshot.data()) : null;
    const queuedPart = normalizeMeetingJobPart(afterSnapshot.data());
    if (!queuedPart.jobId || normalizeText(queuedPart.status) !== "queued" || normalizeText(previousPart?.status) === "queued") {
      return;
    }

    const jobRef = db.collection(jobCollection).doc(queuedPart.jobId);
    const partRef = db.collection(jobPartCollection).doc(afterSnapshot.id);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      await deleteDocumentIfExists(partRef);
      return;
    }

    let currentJob = normalizeMeetingJob(jobSnapshot.data());
    if (!currentJob.jobId || currentJob.deletedAt) {
      return;
    }
    const owner = currentJob.owner && typeof currentJob.owner === "object" ? { ...currentJob.owner } : {};
    const meeting = normalizeMeetingRequest(currentJob.meeting);
    const options = normalizeMeetingOptions(currentJob.options);
    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));

    try {
      const startedAt = new Date().toISOString();
      await partRef.set({
        error: "",
        status: "processing",
        updatedAt: startedAt,
      }, { merge: true });
      const synchronizedStart = await synchronizeChunkedMeetingJobProgress(
        jobRef,
        meetingRef,
        meeting,
        owner,
        currentJob,
        options
      );
      currentJob = synchronizedStart.currentJob;

      const transcript = await transcribeMeetingSourcePart(queuedPart.part, meeting, currentJob.source);
      const transcriptStorageObject = buildChunkTranscriptStorageObjectPath(
        owner.providerUserKey,
        meeting.meetingId,
        queuedPart.jobId,
        queuedPart.index
      );
      const transcriptMeta = await saveMeetingChunkTranscript(
        bucket,
        transcriptStorageObject,
        transcript,
        owner,
        meeting,
        queuedPart.jobId,
        queuedPart.index
      );
      const completedAt = new Date().toISOString();
      await partRef.set({
        error: "",
        status: "succeeded",
        transcript: transcriptMeta,
        updatedAt: completedAt,
      }, { merge: true });
      const synchronized = await synchronizeChunkedMeetingJobProgress(
        jobRef,
        meetingRef,
        meeting,
        owner,
        currentJob,
        options
      );
      currentJob = synchronized.currentJob;
      if (!synchronized.isFullyTranscribed) {
        await promoteWaitingMeetingJobParts(currentJob, synchronized.partDocs);
      }
      if (synchronized.isFullyTranscribed) {
        await maybeQueueMeetingJobFinalizer(currentJob);
      }
      logEvent("meeting.process.part.success", {
        jobId: queuedPart.jobId,
        meetingId: meeting.meetingId,
        partIndex: queuedPart.index,
        providerUserKey: owner.providerUserKey,
      });
    } catch (error) {
      const errorMessage = formatMeetingProcessErrorMessage(error);
      const nextRetryCount = Math.max(0, Number(queuedPart.retry?.count) || 0) + 1;
      const retryLimit = getMeetingProcessRetryLimit();
      if (isRetryableMeetingProcessError(error) && nextRetryCount <= retryLimit) {
        const retriedAt = new Date().toISOString();
        await partRef.set({
          error: "",
          queuedAt: retriedAt,
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          status: "queued",
          updatedAt: retriedAt,
        }, { merge: true });
        await synchronizeChunkedMeetingJobProgress(
          jobRef,
          meetingRef,
          meeting,
          owner,
          currentJob,
          options
        );
        logEvent("meeting.process.part.retry.queued", {
          error: normalizeText(error?.message),
          jobId: queuedPart.jobId,
          meetingId: meeting.meetingId,
          partIndex: queuedPart.index,
          providerUserKey: owner.providerUserKey,
          retryCount: nextRetryCount,
          retryLimit,
        });
        return;
      }

      await partRef.set({
        error: errorMessage,
        retry: {
          count: Math.max(0, Number(queuedPart.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(queuedPart.retry?.lastRetriedAt),
        },
        status: "failed",
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await synchronizeChunkedMeetingJobProgress(
        jobRef,
        meetingRef,
        meeting,
        owner,
        currentJob,
        options,
        {
          error: errorMessage,
          progress: {
            parallelParts: 0,
            percent: 100,
            phase: "failed",
          },
          retry: {
            count: Math.max(0, Number(currentJob.retry?.count) || 0),
            lastError: errorMessage,
            lastRetriedAt: normalizeText(currentJob.retry?.lastRetriedAt),
          },
          status: "failed",
        }
      );
      logEvent("meeting.process.part.error", {
        error: normalizeText(error?.message),
        jobId: queuedPart.jobId,
        meetingId: meeting.meetingId,
        partIndex: queuedPart.index,
        providerUserKey: owner.providerUserKey,
      });
    }
  }

  async function finalizeChunkedMeetingJobWrite(event) {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousFinalizer = beforeSnapshot?.exists ? normalizeMeetingJobFinalizer(beforeSnapshot.data()) : null;
    const queuedFinalizer = normalizeMeetingJobFinalizer(afterSnapshot.data());
    if (!queuedFinalizer.jobId || normalizeText(queuedFinalizer.status) !== "queued" || normalizeText(previousFinalizer?.status) === "queued") {
      return;
    }

    const finalizerRef = db.collection(finalizeCollection).doc(afterSnapshot.id);
    const jobRef = db.collection(jobCollection).doc(queuedFinalizer.jobId);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      await deleteDocumentIfExists(finalizerRef);
      return;
    }

    let currentJob = normalizeMeetingJob(jobSnapshot.data());
    if (!currentJob.jobId || currentJob.deletedAt) {
      return;
    }
    const owner = currentJob.owner && typeof currentJob.owner === "object" ? { ...currentJob.owner } : {};
    const meeting = normalizeMeetingRequest(currentJob.meeting);
    const options = normalizeMeetingOptions(currentJob.options);
    const context = normalizeMeetingContext(currentJob.context);
    const source = normalizeMeetingSource(currentJob.source);
    const artifactId = getMeetingArtifactId(currentJob.jobId, owner.providerUserKey, meeting.meetingId, source.requestId, db);
    const artifactRef = db.collection(artifactCollection).doc(artifactId);
    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
    let partDocs = [];
    const persistJobPatch = async (patch, artifact) => {
      currentJob = await persistMeetingJobPatch(
        jobRef,
        meetingRef,
        meeting,
        owner,
        currentJob,
        patch,
        artifact
      );
      return currentJob;
    };

    try {
      const startedAt = new Date().toISOString();
      await finalizerRef.set({
        error: "",
        status: "processing",
        updatedAt: startedAt,
      }, { merge: true });
      await persistJobPatch({
        progress: {
          currentPart: Math.max(0, Number(currentJob.progress?.currentPart) || 0),
          parallelParts: 0,
          percent: 80,
          phase: "assembling_transcript",
          totalParts: Math.max(0, Number(currentJob.progress?.totalParts) || (Array.isArray(source.parts) ? source.parts.length : 0)),
        },
        updatedAt: startedAt,
      });

      partDocs = await loadMeetingJobPartDocs(currentJob.jobId);
      if (!partDocs.length || partDocs.some((part) => part.status !== "succeeded" || !normalizeText(part.transcript?.storageObject))) {
        throw createHttpError(409, "청크 전사 결과가 아직 모두 준비되지 않았어요.");
      }
      const chunkTranscripts = [];
      for (const partDoc of partDocs) {
        chunkTranscripts.push({
          part: partDoc.part,
          transcript: await loadMeetingChunkTranscript(bucket, partDoc.transcript.storageObject),
        });
      }
      const transcript = await mergeChunkTranscripts(chunkTranscripts, async (progressPatch) => {
        await persistJobPatch(progressPatch);
      });
      await persistJobPatch({
        progress: {
          currentPart: partDocs.length,
          parallelParts: 0,
          percent: 86,
          phase: "generating_notes",
          totalParts: partDocs.length,
        },
        updatedAt: new Date().toISOString(),
      });
      const meetingNotes = await maybeGenerateMeetingNotes(transcript, meeting, options, context, logEvent, owner, currentJob.jobId);
      const completedAt = new Date().toISOString();
      const artifact = buildTranscriptArtifact(artifactId, currentJob.jobId, meeting, owner, transcript, meetingNotes, completedAt, context);
      const deletion = await deleteTemporarySourceGroup(
        bucket,
        [
          ...collectMeetingSourceStorageObjects(source),
          ...collectMeetingChunkTranscriptStorageObjects(partDocs),
        ]
      );
      logMeetingCleanupWarning("meeting.finalize.cleanup.warning", deletion, {
        jobId: currentJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      const succeededPatch = buildSucceededJobPatch(
        artifact,
        meeting,
        options,
        markMeetingSourceDeleted(source, deletion.deletedStorageObjects),
        context,
        transcript,
        meetingNotes,
        completedAt,
        deletion.deletedAt,
        currentJob.retry
      );
      const storedJob = await loadStoredMeetingJob(jobRef);
      if (!storedJob?.jobId || storedJob.deletedAt) {
        await Promise.all([
          deleteDocumentIfExists(finalizerRef),
          ...partDocs.map((partDoc) => deleteDocumentIfExists(db.collection(jobPartCollection).doc(partDoc.docId))),
        ]);
        return;
      }
      currentJob = mergeMeetingJobPatch(storedJob, succeededPatch);
      await Promise.all([
        artifactRef.set(artifact),
        jobRef.set(succeededPatch, { merge: true }),
        upsertMeetingJobSummary(meetingRef, meeting, owner, currentJob, artifact),
        deleteDocumentIfExists(finalizerRef),
        ...partDocs.map((partDoc) => deleteDocumentIfExists(db.collection(jobPartCollection).doc(partDoc.docId))),
      ]);
      await safelyCommitProcessedUsage(currentJob, artifact, completedAt);
      logEvent("meeting.process.success", {
        artifactId,
        chunked: true,
        jobId: currentJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
    } catch (error) {
      const errorMessage = formatMeetingProcessErrorMessage(error);
      const nextRetryCount = Math.max(0, Number(queuedFinalizer.retry?.count) || 0) + 1;
      const retryLimit = getMeetingProcessRetryLimit();
      if (isRetryableMeetingProcessError(error) && nextRetryCount <= retryLimit) {
        const retriedAt = new Date().toISOString();
        await finalizerRef.set({
          error: "",
          queuedAt: retriedAt,
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          status: "queued",
          updatedAt: retriedAt,
        }, { merge: true });
        await persistJobPatch({
          error: "",
          progress: {
            currentPart: Math.max(0, Number(currentJob.progress?.currentPart) || 0),
            parallelParts: 0,
            percent: Math.max(80, Number(currentJob.progress?.percent) || 80),
            phase: "assembling_transcript",
            totalParts: Math.max(0, Number(currentJob.progress?.totalParts) || (Array.isArray(source.parts) ? source.parts.length : 0)),
          },
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          updatedAt: retriedAt,
        });
        logEvent("meeting.process.finalize.retry.queued", {
          error: normalizeText(error?.message),
          jobId: currentJob.jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
          retryCount: nextRetryCount,
          retryLimit,
        });
        return;
      }

      const deletion = await deleteTemporarySourceGroup(
        bucket,
        [
          ...collectMeetingSourceStorageObjects(source),
          ...collectMeetingChunkTranscriptStorageObjects(partDocs),
        ]
      );
      logMeetingCleanupWarning("meeting.finalize.cleanup.warning", deletion, {
        jobId: currentJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });

      await finalizerRef.set({
        error: errorMessage,
        retry: {
          count: Math.max(0, Number(queuedFinalizer.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(queuedFinalizer.retry?.lastRetriedAt),
        },
        status: "failed",
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await persistJobPatch({
        cleanup: {
          deletedAt: deletion.deletedAt,
          sourceAudioDeleted: Boolean(deletion.deletedAt),
        },
        error: errorMessage,
        progress: {
          currentPart: Math.max(0, Number(currentJob.progress?.currentPart) || 0),
          parallelParts: 0,
          percent: 100,
          phase: "failed",
          totalParts: Math.max(0, Number(currentJob.progress?.totalParts) || (Array.isArray(source.parts) ? source.parts.length : 0)),
        },
        retry: {
          count: Math.max(0, Number(currentJob.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(currentJob.retry?.lastRetriedAt),
        },
        source: markMeetingSourceDeleted(source, deletion.deletedStorageObjects),
        status: "failed",
        updatedAt: new Date().toISOString(),
      });
      logEvent("meeting.process.error", {
        error: normalizeText(error?.message),
        jobId: currentJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
    }
  }

  async function safelyCommitProcessedUsage(job, artifact, processedAt) {
    if (typeof commitProcessedMeetingUsage !== "function") {
      return;
    }
    try {
      await commitProcessedMeetingUsage({ artifact, job, processedAt });
    } catch (error) {
      logEvent("meeting.usage.commit.error", {
        error: normalizeText(error?.message) || "usage-commit-failed",
        jobId: normalizeText(job?.jobId),
        meetingId: normalizeText(job?.meetingId || job?.meeting?.meetingId || artifact?.meetingId),
        providerUserKey: normalizeText(job?.owner?.providerUserKey || artifact?.owner?.providerUserKey),
      });
    }
  }

  return {
    finalizeChunkedMeetingJobWrite,
    maybeQueueMeetingJobFinalizer,
    persistMeetingJobPatch,
    processQueuedMeetingJobPartWrite,
    processQueuedMeetingJobWrite,
    promoteWaitingMeetingJobParts,
    synchronizeChunkedMeetingJobProgress,
    upsertQueuedMeetingJobParts,
  };
}

module.exports = {
  createMeetingProcessingDomain,
};
