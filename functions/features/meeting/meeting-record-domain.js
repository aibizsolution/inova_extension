function createMeetingRecordDomain(deps) {
  const {
    compareMeetingResults,
    crypto,
    limits,
    mergeRecentJobs,
    normalizeMeetingContext,
    normalizeMeetingNotes,
    normalizeMeetingNotesContextItems,
    normalizeMeetingNotesInputSnapshot,
    normalizeMeetingNotesStatus,
    normalizeMeetingResultSummary,
    normalizeMeetingSummary,
    normalizeText,
    normalizeTextBlock,
  } = deps;
  const {
    MAX_MEETING_RECENT_RESULTS,
    MAX_SHARED_MEMO_CHARS,
    NOTES_SCHEMA_VERSION,
  } = limits;

  function buildQueuedJob(jobId, meeting, owner, options, source, context, createdAt) {
    return {
      artifacts: [],
      context: normalizeMeetingContext(context),
      createdAt,
      deletedAt: "",
      jobId,
      meeting: {
        ...meeting,
        createdAt: meeting.startedAt || createdAt,
        sharedMemo: normalizeTextBlock(meeting.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
      },
      meetingId: meeting.meetingId,
      notesDegradedReason: "",
      notesGeneratedAt: "",
      notesStatus: options.summary ? "pending" : "disabled",
      notesSchemaVersion: NOTES_SCHEMA_VERSION,
      options,
      owner: owner ? { ...owner } : {},
      progress: {
        currentPart: 0,
        parallelParts: 0,
        percent: 0,
        phase: "queued",
        totalParts: Math.max(0, Array.isArray(source?.parts) ? source.parts.length : 0) || 1,
      },
      retry: {
        count: 0,
        lastError: "",
        lastRetriedAt: "",
      },
      queuedAt: createdAt,
      sessionId: meeting.sessionId,
      source,
      status: "queued",
      title: normalizeText(meeting.title),
      transcription: {
        language: meeting.language,
      },
      updatedAt: createdAt,
    };
  }

  function buildSucceededJobPatch(artifact, meeting, options, source, context, transcript, meetingNotes, completedAt, deletedAt, retryInput) {
    const resultTitle = resolveMeetingResultTitle(meetingNotes, meeting.title);
    const normalizedContext = normalizeMeetingContext(context);
    const notesInputSnapshot = normalizeMeetingNotesInputSnapshot({
      contextItems: normalizedContext.notesContextItems,
      sharedMemo: normalizedContext.sharedMemoSnapshot,
      updatedAt: normalizeText(meetingNotes?.notesGeneratedAt || completedAt),
    });
    return {
      artifacts: [
        {
          artifactId: artifact.artifactId,
          createdAt: artifact.createdAt,
          format: artifact.format,
          jobId: artifact.jobId,
          kind: artifact.kind,
        },
      ],
      cleanup: {
        deletedAt,
        sourceAudioDeleted: Boolean(deletedAt),
      },
      progress: {
        currentPart: Math.max(1, Array.isArray(source?.parts) && source.parts.length ? source.parts.length : 1),
        parallelParts: 0,
        percent: 100,
        phase: "completed",
        totalParts: Math.max(1, Array.isArray(source?.parts) && source.parts.length ? source.parts.length : 1),
      },
      retry: {
        count: Math.max(0, Number(retryInput?.count) || 0),
        lastError: "",
        lastRetriedAt: normalizeText(retryInput?.lastRetriedAt),
      },
      source: {
        ...source,
        uploadStatus: deletedAt ? "deleted" : source.uploadStatus,
      },
      status: "succeeded",
      context: normalizedContext,
      notesDegradedReason: normalizeText(meetingNotes?.notesDegradedReason),
      meetingNotes: normalizeMeetingNotes(meetingNotes?.notes),
      notesContextItems: normalizedContext.notesContextItems,
      notesGeneratedAt: normalizeText(meetingNotes?.notesGeneratedAt),
      notesInputSnapshot,
      notesStatus: normalizeMeetingNotesStatus(meetingNotes?.notesStatus),
      notesSchemaVersion: Math.max(1, Number(meetingNotes?.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
      title: resultTitle,
      transcript: {
        artifactId: artifact.artifactId,
        segments: artifact.segments,
        text: artifact.text,
      },
      transcription: {
        language: meeting.language,
      },
      updatedAt: completedAt,
    };
  }

  function resolveMeetingResultTitle(meetingNotes, fallbackTitle) {
    const suggestedTitle = normalizeText(meetingNotes?.notes?.meetingMeta?.title || meetingNotes?.meetingMeta?.title);
    return suggestedTitle || normalizeText(fallbackTitle);
  }

  function buildTranscriptArtifact(artifactId, jobId, meeting, owner, transcript, meetingNotes, createdAt, contextInput) {
    const normalizedContext = normalizeMeetingContext(contextInput);
    const normalizedNotesContextItems = normalizeMeetingNotesContextItems(
      meetingNotes?.notesContextItems?.length ? meetingNotes.notesContextItems : normalizedContext.notesContextItems
    );
    return {
      artifactId,
      createdAt,
      deletedAt: "",
      format: "json",
      jobId,
      kind: "transcript",
      meetingId: meeting.meetingId,
      notesContextItems: normalizedNotesContextItems,
      notesDegradedReason: normalizeText(meetingNotes?.notesDegradedReason),
      notes: normalizeMeetingNotes(meetingNotes?.notes),
      notesGeneratedAt: normalizeText(meetingNotes?.notesGeneratedAt),
      notesInputSnapshot: normalizeMeetingNotesInputSnapshot({
        contextItems: normalizedNotesContextItems,
        sharedMemo: meetingNotes?.sharedMemoSnapshot || normalizedContext.sharedMemoSnapshot,
        updatedAt: normalizeText(meetingNotes?.notesGeneratedAt || createdAt),
      }),
      notesStatus: normalizeMeetingNotesStatus(meetingNotes?.notesStatus),
      notesSchemaVersion: Math.max(1, Number(meetingNotes?.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
      owner: owner ? { ...owner } : {},
      segments: transcript.segments,
      sessionId: meeting.sessionId,
      text: transcript.text,
    };
  }

  function buildMeetingDocId(providerUserKey, meetingId) {
    return `${normalizeText(providerUserKey)}__${normalizeText(meetingId)}`;
  }

  function buildMeetingSummaryDocument(meeting, owner, jobSummary, currentSummary) {
    const normalizedCurrent = normalizeMeetingSummary(currentSummary);
    const normalizedJobSummary = normalizeMeetingResultSummary(jobSummary);
    return {
      createdAt: normalizedCurrent.createdAt || normalizedJobSummary.createdAt || normalizeText(meeting.startedAt) || new Date().toISOString(),
      endedAt: normalizeText(meeting.endedAt),
      excerpt: normalizeText(normalizedJobSummary.previewText),
      language: normalizeText(meeting.language) || normalizedCurrent.language || "ko",
      latestArtifactId: normalizeText(normalizedJobSummary.artifactId),
      latestJobId: normalizeText(normalizedJobSummary.jobId),
      meetingId: normalizeText(meeting.meetingId),
      owner: owner ? { ...owner } : {},
      recentJobs: mergeRecentJobs(normalizedCurrent.recentJobs, normalizedJobSummary),
      sharedMemo: normalizeTextBlock(meeting.sharedMemo || normalizedCurrent.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
      sessionId: normalizeText(meeting.sessionId),
      sourceTabId: Math.max(0, Number(meeting.sourceTabId) || 0),
      startedAt: normalizeText(meeting.startedAt),
      status: normalizeText(normalizedJobSummary.status),
      title: normalizeText(meeting.title),
      updatedAt: normalizeText(normalizedJobSummary.updatedAt || new Date().toISOString()),
    };
  }

  function buildMeetingRecentJobsPatch(currentMeetingInput, recentJobsInput, updatedAt) {
    const currentMeeting = normalizeMeetingSummary(currentMeetingInput);
    const recentJobs = Array.isArray(recentJobsInput)
      ? recentJobsInput.map(normalizeMeetingResultSummary).sort(compareMeetingResults).slice(0, MAX_MEETING_RECENT_RESULTS)
      : [];
    const latest = recentJobs[0] || null;
    return {
      excerpt: normalizeText(latest?.previewText),
      latestArtifactId: normalizeText(latest?.artifactId),
      latestJobId: normalizeText(latest?.jobId),
      recentJobs,
      status: normalizeText(latest?.status) || "idle",
      updatedAt: normalizeText(updatedAt || latest?.updatedAt || currentMeeting.updatedAt || new Date().toISOString()),
    };
  }

  function buildTempStorageObjectPath(providerUserKey, meetingId, jobId, fileName) {
    return [
      "tmp",
      "meetings",
      normalizeText(providerUserKey) || "unknown-user",
      normalizeText(meetingId) || "unknown-meeting",
      `${normalizeText(jobId) || "meeting-job"}-${normalizeText(fileName) || "audio.webm"}`,
    ].join("/");
  }

  function buildChunkTranscriptStorageObjectPath(providerUserKey, meetingId, jobId, partIndex) {
    return [
      "tmp",
      "meetings",
      normalizeText(providerUserKey) || "unknown-user",
      normalizeText(meetingId) || "unknown-meeting",
      "chunk-transcripts",
      `${normalizeText(jobId) || "meeting-job"}-part-${String(Math.max(0, Number(partIndex) || 0)).padStart(4, "0")}.json`,
    ].join("/");
  }

  function buildStableMeetingEntityId(prefix, providerUserKey, meetingId, requestId) {
    const digest = crypto
      .createHash("sha256")
      .update([
        normalizeText(prefix),
        normalizeText(providerUserKey),
        normalizeText(meetingId),
        normalizeText(requestId),
      ].join("::"))
      .digest("hex")
      .slice(0, 32);
    return `${normalizeText(prefix) || "meeting-entity"}-${digest}`;
  }

  function buildMeetingJobPartId(jobId, index) {
    return `${normalizeText(jobId)}__${String(Math.max(0, Number(index) || 0)).padStart(4, "0")}`;
  }

  return {
    buildChunkTranscriptStorageObjectPath,
    buildMeetingDocId,
    buildMeetingJobPartId,
    buildMeetingRecentJobsPatch,
    buildMeetingSummaryDocument,
    buildQueuedJob,
    buildStableMeetingEntityId,
    buildSucceededJobPatch,
    buildTempStorageObjectPath,
    buildTranscriptArtifact,
    resolveMeetingResultTitle,
  };
}

module.exports = {
  createMeetingRecordDomain,
};
