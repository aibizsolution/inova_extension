function createMeetingSourceDomain(deps) {
  const {
    allowedCaptureModes,
    buildDefaultFileName,
    limits,
    normalizeMeetingJob,
    normalizeText,
    normalizeTextBlock,
  } = deps;
  const {
    MAX_SHARED_MEMO_CHARS,
  } = limits;

  function normalizeMeetingRequest(input) {
    return {
      endedAt: normalizeText(input?.endedAt),
      language: normalizeText(input?.language) || "ko",
      meetingId: normalizeText(input?.meetingId),
      sessionId: normalizeText(input?.sessionId),
      sharedMemo: normalizeTextBlock(input?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
      sourceTabId: Math.max(0, Number(input?.sourceTabId) || 0),
      startedAt: normalizeText(input?.startedAt),
      title: normalizeText(input?.title),
    };
  }

  function normalizeMeetingOptions(input) {
    return {
      redaction: normalizeText(input?.redaction) || "none",
      summary: Boolean(input?.summary),
    };
  }

  function normalizeMeetingSource(input) {
    const captureMode = normalizeText(input?.captureMode);
    const normalizedRequestId = normalizeText(input?.requestId);
    return {
      captureMode: allowedCaptureModes.has(captureMode) ? captureMode : "",
      channelCount: Math.max(0, Number(input?.channelCount) || 0),
      durationMs: Math.max(0, Number(input?.durationMs) || 0),
      fileName: normalizeText(input?.fileName) || buildDefaultFileName(input?.mimeType),
      inlineAudioBase64: normalizeText(input?.inlineAudioBase64),
      mimeType: normalizeText(input?.mimeType),
      mode: normalizeMeetingSourceMode(input?.mode),
      originalSizeBytes: Math.max(0, Number(input?.originalSizeBytes) || Number(input?.sizeBytes) || 0),
      parts: normalizeMeetingSourceParts(input?.parts, normalizedRequestId),
      requestId: normalizedRequestId,
      sizeBytes: Math.max(0, Number(input?.sizeBytes) || 0),
      storageObject: normalizeText(input?.storageObject),
      uploadStatus: normalizeText(input?.uploadStatus) || "",
    };
  }

  function normalizeMeetingSourceUploadRequest(request) {
    const query = request && typeof request.query === "object" ? request.query : {};
    const captureMode = normalizeText(query.captureMode);
    const headerMimeType = normalizeText(request?.headers?.["content-type"]);
    return {
      captureMode: allowedCaptureModes.has(captureMode) ? captureMode : "",
      channelCount: Math.max(0, Number(query.channelCount) || 0),
      durationMs: Math.max(0, Number(query.durationMs) || 0),
      fileName: normalizeText(query.fileName) || buildDefaultFileName(headerMimeType || query.mimeType),
      meetingId: normalizeText(query.meetingId),
      mimeType: headerMimeType || normalizeText(query.mimeType),
      overlapMs: Math.max(0, Number(query.overlapMs) || 0),
      parentRequestId: normalizeText(query.parentRequestId || query.requestId),
      partCount: Math.max(0, Number(query.partCount) || 0),
      partIndex: Math.max(0, Number(query.partIndex) || 0),
      requestId: normalizeText(query.requestId),
      startMs: Math.max(0, Number(query.startMs) || 0),
      endMs: Math.max(0, Number(query.endMs) || 0),
      sizeBytes: Math.max(0, Number(query.sizeBytes) || 0),
    };
  }

  function normalizeMeetingSourceMode(value) {
    const normalized = normalizeText(value);
    return normalized === "chunked" ? "chunked" : "single";
  }

  function normalizeMeetingSourceParts(parts, fallbackRequestId) {
    return (Array.isArray(parts) ? parts : [])
      .map((part, index) => normalizeMeetingSourcePart(part, index, fallbackRequestId))
      .filter((part) => part.requestId);
  }

  function normalizeMeetingSourcePart(input, index, fallbackRequestId) {
    const part = input && typeof input === "object" ? input : {};
    const requestId = normalizeText(part.requestId) || `${normalizeText(fallbackRequestId) || "meeting-source"}-part-${index}`;
    const startMs = Math.max(0, Number(part.startMs) || 0);
    const endMs = Math.max(startMs, Number(part.endMs) || startMs);
    return {
      endMs,
      index: Math.max(0, Number(part.index) || index),
      mimeType: normalizeText(part.mimeType) || "audio/wav",
      overlapMs: Math.max(0, Number(part.overlapMs) || 0),
      requestId,
      sizeBytes: Math.max(0, Number(part.sizeBytes) || 0),
      startMs,
      storageObject: normalizeText(part.storageObject),
      uploadStatus: normalizeText(part.uploadStatus) || (normalizeText(part.storageObject) ? "uploaded" : ""),
    };
  }

  function normalizeMeetingJobPart(input) {
    const part = input && typeof input === "object" ? input : {};
    const jobId = normalizeText(part.jobId);
    const normalizedPart = normalizeMeetingSourcePart(part.part, Number(part.index) || 0, part.requestId || jobId);
    return {
      error: normalizeText(part.error),
      index: normalizedPart.index,
      jobId,
      meetingId: normalizeText(part.meetingId),
      owner: part.owner && typeof part.owner === "object" ? { ...part.owner } : {},
      part: normalizedPart,
      queuedAt: normalizeText(part.queuedAt),
      retry: {
        count: Math.max(0, Number(part.retry?.count) || 0),
        lastError: normalizeText(part.retry?.lastError),
        lastRetriedAt: normalizeText(part.retry?.lastRetriedAt),
      },
      status: normalizeText(part.status),
      transcript: {
        segmentCount: Math.max(0, Number(part.transcript?.segmentCount) || 0),
        storageObject: normalizeText(part.transcript?.storageObject),
        textLength: Math.max(0, Number(part.transcript?.textLength) || 0),
      },
      updatedAt: normalizeText(part.updatedAt),
    };
  }

  function buildQueuedMeetingJobPart(job, partInput, queuedAt, existingPartInput, nextStatusInput) {
    const normalizedJob = normalizeMeetingJob(job);
    const normalizedPart = normalizeMeetingSourcePart(
      partInput,
      Number(partInput?.index) || 0,
      normalizedJob.source?.requestId || normalizedJob.jobId
    );
    const existingPart = normalizeMeetingJobPart(existingPartInput);
    const existingStatus = normalizeText(existingPart.status);
    const normalizedNextStatus = normalizeText(nextStatusInput) || "pending_upload";
    const isSameSource = normalizeText(existingPart.jobId) === normalizedJob.jobId
      && Number(existingPart.index) === Number(normalizedPart.index)
      && normalizeText(existingPart.part?.storageObject) === normalizeText(normalizedPart.storageObject);
    const canReuseTranscript = isSameSource
      && normalizeText(existingPart.transcript?.storageObject)
      && existingStatus === "succeeded";
    const shouldPreserveExistingState = isSameSource
      && ["failed", "processing", "queued"].includes(existingStatus)
      && existingStatus === normalizedNextStatus;
    const shouldPreserveRetry = canReuseTranscript || shouldPreserveExistingState;
    return {
      error: shouldPreserveExistingState ? normalizeText(existingPart.error) : "",
      index: normalizedPart.index,
      jobId: normalizedJob.jobId,
      meetingId: normalizedJob.meetingId,
      owner: normalizedJob.owner && typeof normalizedJob.owner === "object" ? { ...normalizedJob.owner } : {},
      part: normalizedPart,
      queuedAt: shouldPreserveExistingState ? normalizeText(existingPart.queuedAt || queuedAt) : queuedAt,
      retry: {
        count: shouldPreserveRetry ? Math.max(0, Number(existingPart.retry?.count) || 0) : 0,
        lastError: shouldPreserveExistingState ? normalizeText(existingPart.retry?.lastError) : "",
        lastRetriedAt: shouldPreserveRetry ? normalizeText(existingPart.retry?.lastRetriedAt) : "",
      },
      status: canReuseTranscript ? "succeeded" : normalizedNextStatus,
      transcript: canReuseTranscript || shouldPreserveExistingState
        ? {
            segmentCount: Math.max(0, Number(existingPart.transcript?.segmentCount) || 0),
            storageObject: normalizeText(existingPart.transcript?.storageObject),
            textLength: Math.max(0, Number(existingPart.transcript?.textLength) || 0),
          }
        : {
            segmentCount: 0,
            storageObject: "",
            textLength: 0,
          },
      updatedAt: canReuseTranscript || shouldPreserveExistingState ? normalizeText(existingPart.updatedAt || queuedAt) : queuedAt,
    };
  }

  function normalizeMeetingJobFinalizer(input) {
    const finalizer = input && typeof input === "object" ? input : {};
    return {
      error: normalizeText(finalizer.error),
      jobId: normalizeText(finalizer.jobId),
      meetingId: normalizeText(finalizer.meetingId),
      owner: finalizer.owner && typeof finalizer.owner === "object" ? { ...finalizer.owner } : {},
      queuedAt: normalizeText(finalizer.queuedAt),
      retry: {
        count: Math.max(0, Number(finalizer.retry?.count) || 0),
        lastError: normalizeText(finalizer.retry?.lastError),
        lastRetriedAt: normalizeText(finalizer.retry?.lastRetriedAt),
      },
      status: normalizeText(finalizer.status),
      updatedAt: normalizeText(finalizer.updatedAt),
    };
  }

  function buildQueuedMeetingJobFinalizer(job, queuedAt, existingFinalizerInput) {
    const normalizedJob = normalizeMeetingJob(job);
    const existingFinalizer = normalizeMeetingJobFinalizer(existingFinalizerInput);
    return {
      error: "",
      jobId: normalizedJob.jobId,
      meetingId: normalizedJob.meetingId,
      owner: normalizedJob.owner && typeof normalizedJob.owner === "object" ? { ...normalizedJob.owner } : {},
      queuedAt,
      retry: {
        count: Math.max(0, Number(existingFinalizer.retry?.count) || 0),
        lastError: "",
        lastRetriedAt: normalizeText(existingFinalizer.retry?.lastRetriedAt),
      },
      status: "queued",
      updatedAt: queuedAt,
    };
  }

  return {
    buildQueuedMeetingJobFinalizer,
    buildQueuedMeetingJobPart,
    normalizeMeetingJobFinalizer,
    normalizeMeetingJobPart,
    normalizeMeetingOptions,
    normalizeMeetingRequest,
    normalizeMeetingSource,
    normalizeMeetingSourceMode,
    normalizeMeetingSourcePart,
    normalizeMeetingSourceUploadRequest,
  };
}

module.exports = {
  createMeetingSourceDomain,
};
