function createMeetingCreationDomain(deps) {
  const {
    assertInlineOnlyFallbackAllowed,
    assertJobOwnership,
    assertMeetingIsActive,
    assertWorkspaceMeetingAccess,
    buildMeetingDocId,
    buildQueuedJob,
    buildStableMeetingEntityId,
    buildTempStorageObjectPath,
    bucket,
    createHttpError,
    db,
    defaultSourcePartOverlapMs,
    deleteTemporarySourceGroup,
    getInlineAudioLimitBytes,
    getMeetingSingleTranscribeMaxDurationMs,
    getMeetingSourceMaxBytes,
    getMeetingSourceMaxDurationMs,
    getMeetingSourceTargetPartBytes,
    jobCollection,
    loadSourceAudioBuffer,
    logEvent,
    logMeetingCleanupWarning,
    maybeQueueMeetingJobFinalizer,
    meetingCollection,
    mergeMeetingJobPatch,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingOptions,
    normalizeMeetingRequest,
    normalizeMeetingSource,
    normalizeMeetingSourceMode,
    normalizeMeetingSourcePart,
    normalizeText,
    persistMeetingJobPatch,
    synchronizeChunkedMeetingJobProgress,
    tempUploadTtlMs,
    upsertMeetingJobSummary,
    upsertQueuedMeetingJobParts,
    uploadTemporarySource,
  } = deps;

  async function createMeetingJob(input) {
    const access = input && typeof input.access === "object" ? input.access : {};
    const owner = access.owner && typeof access.owner === "object" ? { ...access.owner } : {};
    const meeting = normalizeMeetingRequest(input?.meeting);
    const options = normalizeMeetingOptions(input?.options);
    const source = normalizeMeetingSource(input?.source);
    const context = normalizeMeetingContext(input?.context);
    const inlineOnlyOptions = input && typeof input.inlineOnlyOptions === "object"
      ? input.inlineOnlyOptions
      : {};

    let cleanupStorageObjects = [];
    let jobQueued = false;

    try {
      if (!meeting.meetingId) {
        throw createHttpError(400, "회의 ID가 없어요.");
      }
      assertWorkspaceMeetingAccess(access, meeting.meetingId, createHttpError);
      if (!meeting.title) {
        throw createHttpError(400, "회의 제목이 없어요.");
      }
      if (!source.captureMode) {
        throw createHttpError(400, "녹음 source captureMode가 없어요.");
      }
      if (!(source.sizeBytes > 0) || !(source.durationMs > 0)) {
        throw createHttpError(400, "녹음 source 길이나 크기가 올바르지 않아요.");
      }
      assertMeetingSourceWithinSupportedLimits(source);

      const requestId = normalizeText(source.requestId);
      const jobId = requestId
        ? buildStableMeetingEntityId("meeting-job", owner.providerUserKey, meeting.meetingId, requestId)
        : db.collection(jobCollection).doc().id;
      const createdAt = new Date().toISOString();
      const jobRef = db.collection(jobCollection).doc(jobId);
      const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));

      if (requestId) {
        const existingSnapshot = await jobRef.get();
        if (existingSnapshot.exists) {
          const existingJob = normalizeMeetingJob(existingSnapshot.data());
          if (!existingJob.deletedAt && normalizeText(existingJob.status) !== "failed") {
            assertJobOwnership(existingJob, owner, createHttpError);
            await assertMeetingIsActive(owner, existingJob.meetingId || meeting.meetingId, createHttpError);
            const sourcePreparation = await ensureQueuedMeetingSourceReady(
              source,
              owner,
              meeting,
              jobId,
              inlineOnlyOptions
            );
            const mergedSource = mergeQueuedMeetingSource(existingJob.source, sourcePreparation.source);
            let nextJob = existingJob;
            if (hasMeaningfulMeetingSourceUpdate(existingJob.source, mergedSource)) {
              nextJob = await persistMeetingJobPatch(
                jobRef,
                meetingRef,
                meeting,
                owner,
                existingJob,
                {
                  source: mergedSource,
                  updatedAt: new Date().toISOString(),
                }
              );
              if (mergedSource.mode === "chunked" && normalizeText(nextJob.status) === "processing") {
                await upsertQueuedMeetingJobParts(nextJob);
                const synchronized = await synchronizeChunkedMeetingJobProgress(
                  jobRef,
                  meetingRef,
                  meeting,
                  owner,
                  nextJob,
                  options
                );
                nextJob = synchronized.currentJob;
                if (synchronized.isFullyTranscribed) {
                  await maybeQueueMeetingJobFinalizer(nextJob);
                }
              }
            }
            logEvent("meeting.create.deduped", {
              jobId: nextJob.jobId,
              meetingId: nextJob.meetingId || meeting.meetingId,
              providerUserKey: owner.providerUserKey,
              requestId,
            });
            return {
              job: nextJob,
              reused: true,
            };
          }
        }
      }

      const sourcePreparation = await ensureQueuedMeetingSourceReady(
        source,
        owner,
        meeting,
        jobId,
        inlineOnlyOptions
      );
      const sourceSnapshot = sourcePreparation.source;
      cleanupStorageObjects = sourcePreparation.cleanupStorageObjects;
      const effectiveMeeting = {
        ...meeting,
        sharedMemo: context.sharedMemoSnapshot,
      };
      const queuedJob = buildQueuedJob(jobId, effectiveMeeting, owner, options, sourceSnapshot, context, createdAt);
      await Promise.all([
        upsertMeetingJobSummary(meetingRef, effectiveMeeting, owner, queuedJob),
        jobRef.set(queuedJob),
      ]);
      jobQueued = true;

      logEvent("meeting.create.queued", {
        captureMode: source.captureMode,
        chunked: sourceSnapshot.mode === "chunked",
        jobId,
        meetingId: meeting.meetingId,
        partCount: Array.isArray(sourceSnapshot.parts) ? sourceSnapshot.parts.length : 0,
        providerUserKey: owner.providerUserKey,
      });
      return {
        job: queuedJob,
        reused: false,
      };
    } catch (error) {
      if (!jobQueued) {
        const cleanup = await deleteTemporarySourceGroup(bucket, cleanupStorageObjects);
        logMeetingCleanupWarning("meeting.create.cleanup.warning", cleanup, {
          providerUserKey: owner.providerUserKey,
          requestOrigin: normalizeText(inlineOnlyOptions.requestOrigin),
        });
      }
      throw error;
    }
  }

  async function persistUploadedMeetingSourceToExistingJob(jobId, owner, uploadInput, storageObject) {
    const normalizedJobId = normalizeText(jobId);
    const normalizedStorageObject = normalizeText(storageObject);
    if (!normalizedJobId || !normalizedStorageObject) {
      return null;
    }
    const jobRef = db.collection(jobCollection).doc(normalizedJobId);
    const uploadedAt = new Date().toISOString();
    let nextJob = null;
    let didWrite = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);
      if (!snapshot.exists) {
        return;
      }
      const currentJob = normalizeMeetingJob(snapshot.data());
      if (!currentJob.jobId || currentJob.deletedAt) {
        return;
      }
      if (normalizeText(currentJob.owner?.providerUserKey) !== normalizeText(owner?.providerUserKey)) {
        return;
      }
      if (normalizeText(currentJob.meetingId) !== normalizeText(uploadInput?.meetingId)) {
        return;
      }
      const nextSource = buildUploadedMeetingSourcePatch(currentJob.source, uploadInput, normalizedStorageObject);
      if (!hasMeaningfulMeetingSourceUpdate(currentJob.source, nextSource)) {
        nextJob = currentJob;
        return;
      }
      nextJob = mergeMeetingJobPatch(currentJob, {
        source: nextSource,
        updatedAt: uploadedAt,
      });
      didWrite = true;
      transaction.set(jobRef, {
        source: nextSource,
        updatedAt: uploadedAt,
      }, { merge: true });
    });
    if (!nextJob || !didWrite) {
      return nextJob;
    }
    const meeting = normalizeMeetingRequest(nextJob.meeting);
    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
    await upsertMeetingJobSummary(meetingRef, meeting, owner, nextJob);
    return nextJob;
  }

  function buildUploadedMeetingSourcePatch(sourceInput, uploadInput, storageObject) {
    const currentSource = normalizeMeetingSource(sourceInput);
    const normalizedStorageObject = normalizeText(storageObject);
    const normalizedParentRequestId = normalizeText(
      uploadInput?.parentRequestId || uploadInput?.requestId || currentSource.requestId
    );
    const normalizedCaptureMode = normalizeText(uploadInput?.captureMode) || currentSource.captureMode;
    const normalizedMimeType = normalizeText(uploadInput?.mimeType) || currentSource.mimeType;
    const normalizedFileName = normalizeText(uploadInput?.fileName) || currentSource.fileName;
    const normalizedDurationMs = Math.max(0, Number(uploadInput?.durationMs) || currentSource.durationMs || 0);
    const normalizedChannelCount = Math.max(0, Number(uploadInput?.channelCount) || currentSource.channelCount || 0);
    const normalizedOriginalSizeBytes = Math.max(
      0,
      Number(currentSource.originalSizeBytes) || 0,
      Number(currentSource.sizeBytes) || 0,
      Number(uploadInput?.sizeBytes) || 0
    );
    const targetPartCount = Math.max(
      0,
      Number(uploadInput?.partCount) || 0,
      Array.isArray(currentSource.parts) ? currentSource.parts.length : 0,
      Math.max(0, Number(uploadInput?.partIndex) || 0) + 1
    );

    if (targetPartCount > 0 || currentSource.mode === "chunked") {
      const existingPartsByIndex = new Map(
        (Array.isArray(currentSource.parts) ? currentSource.parts : []).map((part) => [Number(part.index), part])
      );
      const nextParts = [];
      for (let index = 0; index < targetPartCount; index += 1) {
        const existingPart = existingPartsByIndex.get(index);
        const isTargetPart = index === Math.max(0, Number(uploadInput?.partIndex) || 0);
        const nextPartInput = isTargetPart
          ? {
              ...(existingPart || {}),
              endMs: Math.max(0, Number(uploadInput?.endMs) || Number(existingPart?.endMs) || 0),
              index,
              mimeType: normalizedMimeType || normalizeText(existingPart?.mimeType),
              overlapMs: Math.max(0, Number(uploadInput?.overlapMs) || Number(existingPart?.overlapMs) || 0),
              requestId: normalizeText(uploadInput?.requestId) || normalizeText(existingPart?.requestId),
              sizeBytes: Math.max(0, Number(uploadInput?.sizeBytes) || Number(existingPart?.sizeBytes) || 0),
              startMs: Math.max(0, Number(uploadInput?.startMs) || Number(existingPart?.startMs) || 0),
              storageObject: normalizedStorageObject,
              uploadStatus: "uploaded",
            }
          : {
              ...(existingPart || {}),
              index,
              mimeType: normalizeText(existingPart?.mimeType) || normalizedMimeType,
              requestId: normalizeText(existingPart?.requestId),
              uploadStatus: normalizeText(existingPart?.uploadStatus) || "pending_upload",
            };
        nextParts.push(normalizeMeetingSourcePart(nextPartInput, index, normalizedParentRequestId));
      }
      const uploadedPartCount = nextParts.filter((part) => normalizeText(part.storageObject)).length;
      return normalizeMeetingSource({
        ...currentSource,
        captureMode: normalizedCaptureMode,
        channelCount: normalizedChannelCount,
        durationMs: Math.max(currentSource.durationMs, normalizedDurationMs),
        fileName: normalizedFileName || currentSource.fileName,
        inlineAudioBase64: "",
        mimeType: normalizedMimeType || currentSource.mimeType,
        mode: "chunked",
        originalSizeBytes: normalizedOriginalSizeBytes,
        parts: nextParts,
        requestId: normalizedParentRequestId || currentSource.requestId,
        sizeBytes: Math.max(currentSource.sizeBytes, normalizedOriginalSizeBytes),
        storageObject: "",
        uploadStatus: uploadedPartCount >= nextParts.length
          ? "uploaded"
          : uploadedPartCount > 0
            ? "partial"
            : "pending_upload",
      });
    }

    return normalizeMeetingSource({
      ...currentSource,
      captureMode: normalizedCaptureMode,
      channelCount: normalizedChannelCount,
      durationMs: Math.max(currentSource.durationMs, normalizedDurationMs),
      fileName: normalizedFileName || currentSource.fileName,
      inlineAudioBase64: "",
      mimeType: normalizedMimeType || currentSource.mimeType,
      mode: "single",
      originalSizeBytes: normalizedOriginalSizeBytes,
      requestId: normalizedParentRequestId || currentSource.requestId,
      sizeBytes: Math.max(currentSource.sizeBytes, normalizedOriginalSizeBytes),
      storageObject: normalizedStorageObject,
      uploadStatus: "uploaded",
    });
  }

  function assertMeetingSourceWithinSupportedLimits(source) {
    if (source.sizeBytes > getMeetingSourceMaxBytes()) {
      throw createHttpError(
        413,
        `현재 회의 원본은 ${Math.floor(getMeetingSourceMaxBytes() / (1024 * 1024))}MB 이하까지만 지원해요.`
      );
    }
    if (source.durationMs > getMeetingSourceMaxDurationMs()) {
      throw createHttpError(413, "현재 회의 원본은 최대 2시간까지만 지원해요.");
    }
    const sourceMode = normalizeMeetingSourceMode(source.mode || (source.parts.length ? "chunked" : "single"));
    if (sourceMode !== "chunked" && source.durationMs > getMeetingSingleTranscribeMaxDurationMs()) {
      throw createHttpError(
        413,
        `현재 전사 모델은 단일 오디오 ${Math.floor(getMeetingSingleTranscribeMaxDurationMs() / 1000)}초 이하만 지원해요. 더 긴 파일은 분할 업로드로 다시 시도해 주세요.`
      );
    }
  }

  async function ensureQueuedMeetingSourceReady(source, owner, meeting, jobId, options = {}) {
    const expiresAt = new Date(Date.now() + tempUploadTtlMs).toISOString();
    const baseSource = {
      captureMode: source.captureMode,
      channelCount: source.channelCount,
      durationMs: source.durationMs,
      expiresAt,
      fileName: source.fileName,
      inlineAudioBase64: "",
      mimeType: source.mimeType,
      mode: normalizeMeetingSourceMode(source.mode || (source.parts.length ? "chunked" : "single")),
      originalSizeBytes: Math.max(source.originalSizeBytes || source.sizeBytes, source.sizeBytes),
      parts: [],
      requestId: normalizeText(source.requestId),
      sizeBytes: source.sizeBytes,
      storageObject: "",
      uploadStatus: "uploaded",
    };
    if (baseSource.mode === "chunked") {
      if (!source.parts.length) {
        throw createHttpError(400, "분할 업로드 part 정보가 없어요.");
      }
      const normalizedParts = source.parts
        .map((part, index) => normalizeMeetingSourcePart(part, index, source.requestId))
        .sort((left, right) => left.index - right.index || left.startMs - right.startMs);
      for (const part of normalizedParts) {
        if (!(part.sizeBytes > 0) || part.sizeBytes > getMeetingSourceTargetPartBytes()) {
          throw createHttpError(400, "분할 업로드 part 크기가 올바르지 않아요.");
        }
      }
      const uploadedPartCount = normalizedParts.filter((part) => normalizeText(part.storageObject)).length;
      return {
        cleanupStorageObjects: [],
        source: {
          ...baseSource,
          parts: normalizedParts.map((part) => ({
            endMs: part.endMs,
            index: part.index,
            mimeType: part.mimeType,
            overlapMs: part.overlapMs || defaultSourcePartOverlapMs,
            requestId: part.requestId,
            sizeBytes: part.sizeBytes,
            startMs: part.startMs,
            storageObject: part.storageObject,
            uploadStatus: part.uploadStatus || (part.storageObject ? "uploaded" : "pending_upload"),
          })),
          uploadStatus: uploadedPartCount >= normalizedParts.length
            ? "uploaded"
            : uploadedPartCount > 0
              ? "partial"
              : "pending_upload",
        },
      };
    }

    if (normalizeText(source.storageObject)) {
      return {
        cleanupStorageObjects: [],
        source: {
          ...baseSource,
          storageObject: normalizeText(source.storageObject),
        },
      };
    }

    if (source.inlineAudioBase64) {
      const audioBuffer = await loadSourceAudioBuffer(source);
      if (!audioBuffer.length) {
        throw createHttpError(400, "회의 원본 오디오가 비어 있어요.");
      }
      if (audioBuffer.length > getInlineAudioLimitBytes()) {
        throw createHttpError(
          413,
          `현재 inline 업로드 경로는 ${Math.floor(getInlineAudioLimitBytes() / (1024 * 1024))}MB 이하 녹음만 지원해요.`
        );
      }
      if (!bucket) {
        assertInlineOnlyFallbackAllowed(options, createHttpError(500, "회의 임시 오디오를 저장할 bucket이 설정되지 않았어요."));
        logEvent("meeting.source-upload.inline-only", {
          jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
          reason: "bucket-missing",
          requestOrigin: normalizeText(options.requestOrigin),
        });
        return {
          cleanupStorageObjects: [],
          source: {
            ...baseSource,
            inlineAudioBase64: source.inlineAudioBase64,
            uploadStatus: "inline-only",
          },
        };
      }
      const storageObject = buildTempStorageObjectPath(owner.providerUserKey, meeting.meetingId, jobId, source.fileName);
      let uploadedSource;
      try {
        uploadedSource = await uploadTemporarySource(bucket, storageObject, audioBuffer, baseSource, owner, meeting, jobId);
      } catch (error) {
        assertInlineOnlyFallbackAllowed(options, error);
        logEvent("meeting.source-upload.inline-only", {
          error: normalizeText(error?.message),
          jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
          reason: "upload-failed",
          requestOrigin: normalizeText(options.requestOrigin),
        });
        return {
          cleanupStorageObjects: [],
          source: {
            ...baseSource,
            inlineAudioBase64: source.inlineAudioBase64,
            uploadStatus: "inline-only",
          },
        };
      }
      if (!normalizeText(uploadedSource?.storageObject)) {
        throw createHttpError(500, "임시 오디오 업로드를 준비하지 못했어요.");
      }
      return {
        cleanupStorageObjects: [storageObject],
        source: {
          ...baseSource,
          storageObject,
          uploadStatus: normalizeText(uploadedSource?.uploadStatus) || "uploaded",
        },
      };
    }

    throw createHttpError(400, "회의 원본 오디오가 없어요.");
  }

  function mergeQueuedMeetingSource(existingSourceInput, incomingSourceInput) {
    const existingSource = normalizeMeetingSource(existingSourceInput);
    const incomingSource = normalizeMeetingSource(incomingSourceInput);
    const mergedStorageObject = normalizeText(incomingSource.storageObject) || normalizeText(existingSource.storageObject);
    if (incomingSource.mode !== "chunked") {
      return normalizeMeetingSource({
        ...existingSource,
        ...incomingSource,
        inlineAudioBase64: "",
        requestId: incomingSource.requestId || existingSource.requestId,
        storageObject: mergedStorageObject,
        uploadStatus: normalizeText(incomingSource.uploadStatus)
          || normalizeText(existingSource.uploadStatus)
          || (mergedStorageObject ? "uploaded" : ""),
      });
    }

    const existingByIndex = new Map(
      (Array.isArray(existingSource.parts) ? existingSource.parts : []).map((part) => [Number(part.index), part])
    );
    const mergedParts = (Array.isArray(incomingSource.parts) && incomingSource.parts.length
      ? incomingSource.parts
      : existingSource.parts
    )
      .map((part, index) => {
        const existingPart = existingByIndex.get(Number(part.index) || index);
        const storageObject = normalizeText(part.storageObject) || normalizeText(existingPart?.storageObject);
        return normalizeMeetingSourcePart({
          ...(existingPart || {}),
          ...part,
          requestId: normalizeText(part.requestId) || normalizeText(existingPart?.requestId),
          sizeBytes: Math.max(0, Number(part.sizeBytes) || Number(existingPart?.sizeBytes) || 0),
          storageObject,
          uploadStatus: normalizeText(part.uploadStatus)
            || normalizeText(existingPart?.uploadStatus)
            || (storageObject ? "uploaded" : "pending_upload"),
        }, index, incomingSource.requestId || existingSource.requestId);
      })
      .sort((left, right) => left.index - right.index || left.startMs - right.startMs);
    const uploadedPartCount = mergedParts.filter((part) => normalizeText(part.storageObject)).length;
    return normalizeMeetingSource({
      ...existingSource,
      ...incomingSource,
      inlineAudioBase64: "",
      originalSizeBytes: Math.max(
        Number(existingSource.originalSizeBytes) || 0,
        Number(incomingSource.originalSizeBytes) || 0,
        Number(existingSource.sizeBytes) || 0,
        Number(incomingSource.sizeBytes) || 0
      ),
      parts: mergedParts,
      requestId: incomingSource.requestId || existingSource.requestId,
      storageObject: mergedStorageObject,
      uploadStatus: mergedParts.length
        ? (uploadedPartCount >= mergedParts.length ? "uploaded" : uploadedPartCount > 0 ? "partial" : "pending_upload")
        : normalizeText(incomingSource.uploadStatus)
          || normalizeText(existingSource.uploadStatus)
          || (mergedStorageObject ? "uploaded" : ""),
      sizeBytes: Math.max(
        Number(existingSource.sizeBytes) || 0,
        Number(incomingSource.sizeBytes) || 0,
        Number(existingSource.originalSizeBytes) || 0,
        Number(incomingSource.originalSizeBytes) || 0
      ),
    });
  }

  function hasMeaningfulMeetingSourceUpdate(existingSourceInput, nextSourceInput) {
    return JSON.stringify(normalizeMeetingSource(existingSourceInput))
      !== JSON.stringify(normalizeMeetingSource(nextSourceInput));
  }

  return {
    createMeetingJob,
    persistUploadedMeetingSourceToExistingJob,
  };
}

module.exports = {
  createMeetingCreationDomain,
};
