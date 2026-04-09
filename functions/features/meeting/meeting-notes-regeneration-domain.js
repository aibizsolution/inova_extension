function createMeetingNotesRegenerationDomain(deps) {
  const {
    artifactCollection,
    assertJobOwnership,
    assertMeetingIsActive,
    buildWorkspaceMutation,
    commandCollection,
    createHttpError,
    db,
    generateMeetingNotesBundle,
    jobCollection,
    loadMeetingArtifactSource,
    loadMeetingNotesSource,
    loadMeetingSummaryRecord,
    loadMeetingTranscriptForNotes,
    loadStoredMeetingJob,
    logEvent,
    mergePersistedMeetingNotesContextItems,
    normalizeIdentity,
    normalizeMeetingArtifact,
    normalizeMeetingCommand,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingNotesContextItems,
    normalizeMeetingNotesInputSnapshot,
    normalizeText,
    resolveMeetingResultTitle,
    updateMeetingSummaryRecordResult,
  } = deps;

  function shouldProcessMeetingCommand(command, previousCommand) {
    return command.type === "regenerate_notes"
      && command.status === "queued"
      && normalizeText(previousCommand?.status) !== "queued";
  }

  async function acceptMeetingNotesRegeneration(input, owner) {
    if (!input.meetingId || !input.jobId) {
      throw createHttpError(400, "회의록을 다시 정리할 ID가 비어 있어요.");
    }

    const jobRef = db.collection(jobCollection).doc(input.jobId);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      throw createHttpError(404, "다시 정리할 회의 결과를 찾지 못했어요.");
    }
    const job = normalizeMeetingJob(jobSnapshot.data());
    if (job.deletedAt) {
      throw createHttpError(404, "이미 삭제된 회의 결과예요.");
    }
    assertJobOwnership(job, owner, createHttpError);
    await assertMeetingIsActive(owner, job.meetingId, createHttpError);
    if (job.meetingId !== input.meetingId) {
      throw createHttpError(404, "현재 회의와 맞지 않는 결과예요.");
    }

    const {
      artifact,
      artifactRef,
      notesContextItems: existingNotesContextItems,
      sharedMemoSnapshot: currentSharedMemoSnapshot,
    } = await loadMeetingNotesSource(job);
    const requestedAt = new Date().toISOString();
    const persistedNotesContextItems = input.contextItemsProvided
      ? mergePersistedMeetingNotesContextItems(existingNotesContextItems, input.contextItems, requestedAt)
      : existingNotesContextItems;
    const persistedSharedMemo = input.sharedMemoProvided
      ? input.sharedMemo
      : currentSharedMemoSnapshot;
    const persistedContext = normalizeMeetingContext({
      notesContextItems: persistedNotesContextItems,
      sharedMemoSnapshot: persistedSharedMemo,
    });
    const notesInputSnapshot = normalizeMeetingNotesInputSnapshot({
      contextItems: persistedNotesContextItems,
      sharedMemo: persistedSharedMemo,
      updatedAt: requestedAt,
    });
    const commandId = normalizeText(input.clientRequestId) || db.collection(commandCollection).doc().id;
    const commandRef = db.collection(commandCollection).doc(commandId);
    const existingCommandSnapshot = await commandRef.get();
    const existingCommand = existingCommandSnapshot.exists ? normalizeMeetingCommand(existingCommandSnapshot.data()) : null;
    if (
      existingCommand?.clientRequestId === commandId
      && existingCommand.jobId === input.jobId
      && existingCommand.meetingId === input.meetingId
      && ["queued", "processing", "succeeded"].includes(existingCommand.status)
    ) {
      return {
        accepted: true,
        requestId: commandId,
        responseStatus: existingCommand.status === "succeeded" ? 200 : 202,
      };
    }

    const workspaceMutation = buildWorkspaceMutation({
      requestId: commandId,
      requestedAt,
      status: "queued",
      type: "regenerateNotes",
    });
    const jobPatch = {
      context: persistedContext,
      notesContextItems: persistedNotesContextItems,
      notesInputSnapshot,
      updatedAt: requestedAt,
      workspaceMutation,
    };
    const artifactPatch = {
      notesContextItems: persistedNotesContextItems,
      notesInputSnapshot,
    };
    const nextJob = normalizeMeetingJob({
      ...job,
      ...jobPatch,
    });
    const nextArtifact = artifact
      ? normalizeMeetingArtifact({
          ...artifact,
          ...artifactPatch,
        })
      : null;
    await Promise.all([
      jobRef.set(jobPatch, { merge: true }),
      artifactRef ? artifactRef.set(artifactPatch, { merge: true }) : Promise.resolve(),
      commandRef.set(normalizeMeetingCommand({
        clientRequestId: commandId,
        contextItems: persistedNotesContextItems,
        contextItemsProvided: input.contextItemsProvided,
        jobId: input.jobId,
        meetingId: input.meetingId,
        owner,
        requestedAt,
        sharedMemo: persistedSharedMemo,
        sharedMemoProvided: input.sharedMemoProvided,
        status: "queued",
        type: "regenerate_notes",
        updatedAt: requestedAt,
      }), { merge: true }),
      updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, requestedAt),
    ]);

    logEvent("meeting.notes.regenerate.accepted", {
      hasContextItems: persistedNotesContextItems.length > 0,
      jobId: input.jobId,
      meetingId: input.meetingId,
      providerUserKey: owner.providerUserKey,
    });

    return {
      accepted: true,
      requestId: commandId,
      responseStatus: 202,
    };
  }

  async function processMeetingCommand(commandRef) {
    const claimedCommand = await claimMeetingCommand(commandRef);
    if (!claimedCommand?.clientRequestId) {
      return false;
    }
    try {
      if (claimedCommand.type === "regenerate_notes") {
        await processRegenerateNotesCommand(claimedCommand);
      }
      const completedAt = new Date().toISOString();
      await setDocumentIfExists(commandRef, {
        completedAt,
        error: "",
        status: "succeeded",
        updatedAt: completedAt,
      }, { merge: true });
      return true;
    } catch (error) {
      const normalizedError = normalizeText(error?.message) || "회의록을 다시 정리하지 못했어요.";
      const completedAt = new Date().toISOString();
      await markMeetingCommandFailed(claimedCommand, normalizedError, completedAt);
      await setDocumentIfExists(commandRef, {
        completedAt,
        error: normalizedError,
        status: "failed",
        updatedAt: completedAt,
      }, { merge: true });
      logEvent("meeting.command.process.error", {
        error: normalizedError,
        jobId: claimedCommand.jobId,
        meetingId: claimedCommand.meetingId,
        requestId: claimedCommand.clientRequestId,
        type: claimedCommand.type,
      });
      return false;
    }
  }

  async function claimMeetingCommand(commandRef) {
    let claimedCommand = null;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(commandRef);
      if (!snapshot.exists) {
        return;
      }
      const currentCommand = normalizeMeetingCommand(snapshot.data());
      if (currentCommand.status !== "queued" || currentCommand.type !== "regenerate_notes") {
        return;
      }
      const startedAt = new Date().toISOString();
      transaction.set(commandRef, {
        startedAt,
        status: "processing",
        updatedAt: startedAt,
      }, { merge: true });
      claimedCommand = normalizeMeetingCommand({
        ...currentCommand,
        startedAt,
        status: "processing",
        updatedAt: startedAt,
      });
    });
    return claimedCommand;
  }

  async function processRegenerateNotesCommand(command) {
    const jobRef = db.collection(jobCollection).doc(command.jobId);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      throw createHttpError(404, "다시 정리할 회의 결과를 찾지 못했어요.");
    }
    const job = normalizeMeetingJob(jobSnapshot.data());
    if (job.deletedAt) {
      throw createHttpError(404, "이미 삭제된 회의 결과예요.");
    }
    const owner = normalizeIdentity(command.owner?.providerUserKey ? command.owner : job.owner);
    if (!normalizeText(owner?.providerUserKey)) {
      throw createHttpError(400, "회의 결과 소유자 정보를 확인하지 못했어요.");
    }
    await assertMeetingIsActive(owner, job.meetingId, createHttpError);

    const transcriptSource = await loadMeetingTranscriptForNotes(job, createHttpError);
    const artifact = transcriptSource.artifact;
    const meetingRecord = await loadMeetingSummaryRecord(owner, { meetingId: job.meetingId }, createHttpError);
    const {
      notesContextItems: existingNotesContextItems,
      sharedMemoSnapshot: currentSharedMemoSnapshot,
    } = await loadMeetingNotesSource(job, {
      artifact,
      artifactRef: transcriptSource.artifactRef,
      sharedMemoFallback: meetingRecord?.meeting?.sharedMemo,
    });
    const requestedAt = normalizeText(command.requestedAt) || new Date().toISOString();
    const persistedNotesContextItems = command.contextItemsProvided
      ? normalizeMeetingNotesContextItems(command.contextItems)
      : existingNotesContextItems;
    const persistedSharedMemo = command.sharedMemoProvided
      ? command.sharedMemo
      : currentSharedMemoSnapshot;
    const persistedContext = normalizeMeetingContext({
      notesContextItems: persistedNotesContextItems,
      sharedMemoSnapshot: persistedSharedMemo,
    });
    const notesInputSnapshot = normalizeMeetingNotesInputSnapshot({
      contextItems: persistedNotesContextItems,
      sharedMemo: persistedSharedMemo,
      updatedAt: requestedAt,
    });
    const effectiveMeeting = {
      ...job.meeting,
      meetingId: job.meetingId,
      sharedMemo: persistedSharedMemo,
      title: normalizeText(job.meeting?.title || job.title || meetingRecord?.meeting?.title),
    };
    const meetingNotes = await generateMeetingNotesBundle(
      transcriptSource.transcript,
      effectiveMeeting,
      { ...persistedContext }
    );
    const resultTitle = resolveMeetingResultTitle(meetingNotes, job.title || effectiveMeeting.title);
    const completedAt = new Date().toISOString();
    const latestJob = await loadStoredMeetingJob(jobRef);
    if (!latestJob?.jobId || latestJob.deletedAt) {
      throw createHttpError(404, "이미 삭제된 회의 결과예요.");
    }
    await assertMeetingIsActive(owner, latestJob.meetingId, createHttpError);
    const latestArtifactId = normalizeText(latestJob.transcript?.artifactId || latestJob.artifacts?.[0]?.artifactId || artifact?.artifactId);
    const latestArtifactRef = latestArtifactId ? db.collection(artifactCollection).doc(latestArtifactId) : null;
    const workspaceMutation = buildWorkspaceMutation({
      completedAt,
      requestId: command.clientRequestId,
      requestedAt,
      status: "succeeded",
      type: "regenerateNotes",
    });
    const jobPatch = {
      context: persistedContext,
      meetingNotes: meetingNotes.notes,
      notesContextItems: persistedNotesContextItems,
      notesDegradedReason: meetingNotes.notesDegradedReason,
      notesGeneratedAt: meetingNotes.notesGeneratedAt,
      notesInputSnapshot,
      notesSchemaVersion: meetingNotes.notesSchemaVersion,
      notesStatus: meetingNotes.notesStatus,
      title: resultTitle,
      updatedAt: completedAt,
      workspaceMutation,
    };
    const artifactPatch = {
      notes: meetingNotes.notes,
      notesContextItems: persistedNotesContextItems,
      notesDegradedReason: meetingNotes.notesDegradedReason,
      notesGeneratedAt: meetingNotes.notesGeneratedAt,
      notesInputSnapshot,
      notesSchemaVersion: meetingNotes.notesSchemaVersion,
      notesStatus: meetingNotes.notesStatus,
    };
    const nextJob = normalizeMeetingJob({
      ...latestJob,
      ...jobPatch,
    });
    const nextArtifact = normalizeMeetingArtifact({
      ...artifact,
      artifactId: latestArtifactId,
      ...artifactPatch,
    });
    const jobUpdated = await setDocumentIfExists(jobRef, jobPatch);
    if (!jobUpdated) {
      throw createHttpError(404, "이미 삭제된 회의 결과예요.");
    }
    await Promise.all([
      latestArtifactRef ? setDocumentIfExists(latestArtifactRef, artifactPatch) : Promise.resolve(),
      updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, completedAt),
    ]);

    logEvent("meeting.notes.regenerate.success", {
      hasContextItems: persistedNotesContextItems.length > 0,
      jobId: command.jobId,
      meetingId: command.meetingId,
      providerUserKey: owner.providerUserKey,
      requestId: command.clientRequestId,
    });
  }

  async function markMeetingCommandFailed(command, errorMessage, completedAt) {
    const jobRef = db.collection(jobCollection).doc(command.jobId);
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
      return;
    }
    const currentJob = normalizeMeetingJob(snapshot.data());
    if (!currentJob.jobId || currentJob.deletedAt) {
      return;
    }
    const owner = normalizeIdentity(command.owner?.providerUserKey ? command.owner : currentJob.owner);
    const { artifact } = await loadMeetingArtifactSource(currentJob);
    const workspaceMutation = buildWorkspaceMutation({
      completedAt,
      error: errorMessage,
      requestId: command.clientRequestId,
      requestedAt: command.requestedAt || completedAt,
      status: "failed",
      type: "regenerateNotes",
    });
    const jobPatch = {
      updatedAt: completedAt,
      workspaceMutation,
    };
    const failedJob = normalizeMeetingJob({
      ...currentJob,
      ...jobPatch,
    });
    await jobRef.set(jobPatch, { merge: true });
    if (normalizeText(owner?.providerUserKey)) {
      await updateMeetingSummaryRecordResult(owner, failedJob, artifact, completedAt);
    }
  }

  async function setDocumentIfExists(ref, patch, options = { merge: true }) {
    if (!ref || typeof ref.get !== "function" || typeof ref.set !== "function") {
      return false;
    }
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return false;
      }
      transaction.set(ref, patch, options);
      return true;
    });
  }

  return {
    acceptMeetingNotesRegeneration,
    processMeetingCommand,
    shouldProcessMeetingCommand,
  };
}

module.exports = {
  createMeetingNotesRegenerationDomain,
};
