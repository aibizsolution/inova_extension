function createMeetingProcessingRuntimeDomain(deps) {
  const {
    OpenAI,
    buildTranscriptText,
    bucket,
    createHttpError,
    defaultMeetingProcessRetryLimit,
    defaultSourcePartOverlapMs,
    getClient,
    getMeetingModel,
    normalizeMeetingSource,
    normalizeMeetingSourcePart,
    normalizeText,
    normalizeTranscriptionResponse,
    retryableMeetingProcessStatuses,
    resegmentTranscriptForReview,
  } = deps;

  function getMeetingChunkWorkerQueueConcurrency(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const override = resolveMeetingChunkTranscriptionConcurrencyOverride(normalizedTotalParts);
    return override || normalizedTotalParts;
  }

  function getMeetingProcessRetryLimit() {
    const requested = Number.parseInt(
      normalizeText(process.env.OPENAI_MEETING_PROCESS_RETRY_LIMIT),
      10
    );
    const resolved = Number.isFinite(requested) && requested >= 0
      ? requested
      : defaultMeetingProcessRetryLimit;
    return Math.max(0, Math.min(5, resolved));
  }

  function isRetryableMeetingProcessError(error) {
    const status = extractMeetingProcessErrorStatus(error);
    if (retryableMeetingProcessStatuses.has(status)) {
      return true;
    }
    const message = normalizeText(error?.message).toLowerCase();
    if (!message) {
      return false;
    }
    return [
      "server had an error processing your request",
      "temporarily unavailable",
      "timed out",
      "timeout",
      "rate limit",
      "overloaded",
      "socket hang up",
      "connection error",
    ].some((token) => message.includes(token));
  }

  function formatMeetingProcessErrorMessage(error) {
    const rawMessage = normalizeText(error?.message) || "회의 전사를 처리하지 못했어요.";
    const status = extractMeetingProcessErrorStatus(error);
    const requestId = extractMeetingProcessRequestId(error);
    const requestSuffix = requestId ? ` 요청 ID: ${requestId}` : "";
    if (status === 429 || rawMessage.toLowerCase().includes("rate limit")) {
      return `전사 API 요청이 잠시 몰려 있어 처리에 실패했어요. 잠시 후 다시 시도해 주세요.${requestSuffix}`.trim();
    }
    if (retryableMeetingProcessStatuses.has(status) || rawMessage.toLowerCase().includes("server had an error processing your request")) {
      return `전사 API에서 일시적인 서버 오류가 발생했어요. 다시 시도해 주세요.${requestSuffix}`.trim();
    }
    return rawMessage;
  }

  async function transcribeMeetingAudio(audioBuffer, meeting, source) {
    const file = await OpenAI.toFile(audioBuffer, source.fileName, {
      type: source.mimeType || "audio/webm",
    });
    const request = {
      file,
      language: meeting.language,
      model: getMeetingModel(),
      response_format: "json",
    };
    const response = await getClient().audio.transcriptions.create(request);
    return normalizeTranscriptionResponse(response, source.durationMs);
  }

  async function transcribeMeetingSourcePart(partInput, meeting, sourceInput) {
    const normalizedSource = normalizeMeetingSource(sourceInput);
    const normalizedPart = normalizeMeetingSourcePart(
      partInput,
      Math.max(0, Number(partInput?.index) || 0),
      normalizedSource.requestId
    );
    const audioBuffer = await loadMeetingSourcePartAudioBuffer(normalizedPart);
    return transcribeMeetingAudio(
      audioBuffer,
      meeting,
      {
        captureMode: normalizedSource.captureMode,
        durationMs: Math.max(1, normalizedPart.endMs - normalizedPart.startMs),
        fileName: buildMeetingPartFileName(normalizedSource.fileName, normalizedPart.index),
        mimeType: normalizedPart.mimeType || normalizedSource.mimeType,
        storageObject: normalizedPart.storageObject,
      }
    );
  }

  async function transcribeQueuedMeetingSource(sourceInput, meeting, onProgress) {
    const normalizedSource = normalizeMeetingSource(sourceInput);
    if (normalizedSource.mode !== "chunked" || !normalizedSource.parts.length) {
      const audioBuffer = await loadMeetingSourceAudioBuffer(normalizedSource);
      if (!audioBuffer.length) {
        throw createHttpError(400, "회의 원본 오디오가 비어 있어요.");
      }
      return transcribeMeetingAudio(audioBuffer, meeting, normalizedSource);
    }

    const orderedParts = normalizedSource.parts
      .map((part, index) => normalizeMeetingSourcePart(part, index, normalizedSource.requestId))
      .sort((left, right) => left.index - right.index || left.startMs - right.startMs);
    const totalParts = orderedParts.length;
    const transcribeProgressEndPercent = 80;
    let completedTranscriptionCount = 0;
    const chunkTranscripts = await mapWithConcurrency(
      orderedParts,
      getMeetingChunkTranscriptionConcurrency(totalParts),
      async (part) => {
        const transcript = await transcribeMeetingSourcePart(part, meeting, normalizedSource);
        completedTranscriptionCount += 1;
        if (typeof onProgress === "function") {
          await onProgress({
            progress: {
              currentPart: completedTranscriptionCount,
              percent: Math.max(
                8,
                Math.min(
                  transcribeProgressEndPercent,
                  Math.round(8 + (completedTranscriptionCount / totalParts) * (transcribeProgressEndPercent - 8))
                )
              ),
              phase: "transcribing_chunks",
              totalParts,
            },
            updatedAt: new Date().toISOString(),
          });
        }
        return { part, transcript };
      }
    );
    return mergeChunkTranscripts(chunkTranscripts, onProgress);
  }

  async function mergeChunkTranscripts(chunkTranscriptsInput, onProgress) {
    const chunkTranscripts = Array.isArray(chunkTranscriptsInput) ? chunkTranscriptsInput : [];
    let mergedSegments = [];
    const totalParts = Math.max(1, chunkTranscripts.length);
    const mergeProgressStartPercent = 80;
    const mergeProgressEndPercent = 88;
    for (const [index, chunk] of chunkTranscripts.entries()) {
      const part = chunk?.part;
      const transcript = chunk?.transcript;
      if (!part || !transcript) {
        continue;
      }
      const adjustedSegments = offsetTranscriptSegments(transcript.segments, part.startMs);
      if (mergedSegments.length && adjustedSegments.length && typeof onProgress === "function") {
        await onProgress({
          progress: {
            currentPart: index + 1,
            parallelParts: 0,
            percent: Math.max(
              mergeProgressStartPercent,
              Math.min(
                mergeProgressEndPercent,
                Math.round(
                  mergeProgressStartPercent
                  + ((index + 1) / totalParts) * (mergeProgressEndPercent - mergeProgressStartPercent)
                )
              )
            ),
            phase: "assembling_transcript",
            totalParts,
          },
          updatedAt: new Date().toISOString(),
        });
      }
      mergedSegments = mergeTranscriptSegments(mergedSegments, adjustedSegments, part.overlapMs || defaultSourcePartOverlapMs);
    }

    const reviewSegments = resegmentTranscriptForReview(mergedSegments);
    return {
      segments: reviewSegments,
      text: buildTranscriptText(reviewSegments),
    };
  }

  return {
    formatMeetingProcessErrorMessage,
    getMeetingChunkWorkerQueueConcurrency,
    getMeetingProcessRetryLimit,
    isRetryableMeetingProcessError,
    mergeChunkTranscripts,
    transcribeMeetingSourcePart,
    transcribeQueuedMeetingSource,
  };

  function resolveMeetingChunkTranscriptionConcurrencyOverride(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const requested = Number.parseInt(
      normalizeText(process.env.OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY),
      10
    );
    if (!Number.isFinite(requested) || requested <= 0) {
      return null;
    }
    return Math.max(1, Math.min(normalizedTotalParts, requested));
  }

  function getMeetingChunkTranscriptionConcurrency(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const override = resolveMeetingChunkTranscriptionConcurrencyOverride(normalizedTotalParts);
    return override || normalizedTotalParts;
  }

  function extractMeetingProcessErrorStatus(error) {
    const candidates = [error?.status, error?.statusCode, error?.cause?.status];
    for (const candidate of candidates) {
      const parsed = Number.parseInt(String(candidate || ""), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    const messageStatus = normalizeText(error?.message).match(/\b(408|409|429|500|502|503|504)\b/);
    return messageStatus ? Number.parseInt(messageStatus[1], 10) : 0;
  }

  function extractMeetingProcessRequestId(error) {
    const message = normalizeText(error?.message);
    const match = message.match(/\b(req_[a-zA-Z0-9]+)\b/);
    return match?.[1] || normalizeText(error?.request_id || error?.requestId);
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    const normalizedItems = Array.isArray(items) ? items : [];
    if (!normalizedItems.length) {
      return [];
    }
    const limit = Math.max(1, Math.min(normalizedItems.length, Number(concurrency) || 1));
    const results = new Array(normalizedItems.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: limit }, async () => {
        while (cursor < normalizedItems.length) {
          const currentIndex = cursor;
          cursor += 1;
          results[currentIndex] = await worker(normalizedItems[currentIndex], currentIndex);
        }
      })
    );
    return results;
  }

  async function loadMeetingSourceAudioBuffer(source) {
    if (source.inlineAudioBase64) {
      try {
        return Buffer.from(source.inlineAudioBase64, "base64");
      } catch {
        throw createHttpError(400, "회의 원본 오디오를 읽지 못했어요.");
      }
    }
    if (source.storageObject) {
      if (!bucket) {
        throw createHttpError(400, "회의 원본 오디오를 찾지 못했어요.");
      }
      const [buffer] = await bucket.file(source.storageObject).download();
      return buffer;
    }
    throw createHttpError(400, "회의 원본 오디오가 없어요.");
  }

  async function loadMeetingSourcePartAudioBuffer(part) {
    if (!bucket || !normalizeText(part?.storageObject)) {
      throw createHttpError(400, "분할 업로드 오디오 원본을 찾지 못했어요.");
    }
    const [buffer] = await bucket.file(part.storageObject).download();
    return buffer;
  }

  function offsetTranscriptSegments(segments, offsetMs) {
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => ({
        ...segment,
        endMs: Math.max(0, Number(segment.endMs) + Math.max(0, Number(offsetMs) || 0)),
        startMs: Math.max(0, Number(segment.startMs) + Math.max(0, Number(offsetMs) || 0)),
      }))
      .filter((segment) => normalizeText(segment.text));
  }

  function mergeTranscriptSegments(existingSegments, nextSegments, overlapMs) {
    const merged = Array.isArray(existingSegments) ? existingSegments.slice() : [];
    const overlapStartMs = merged.length
      ? Math.max(0, Number(merged[merged.length - 1]?.endMs) - Math.max(0, Number(overlapMs) || 0))
      : 0;
    for (const segment of Array.isArray(nextSegments) ? nextSegments : []) {
      if (isDuplicateTranscriptSegment(merged, segment, overlapStartMs)) {
        continue;
      }
      merged.push({
        endMs: Math.max(Number(segment.startMs) + 1, Number(segment.endMs) || 0),
        startMs: Math.max(0, Number(segment.startMs) || 0),
        text: normalizeText(segment.text),
      });
    }
    return merged;
  }

  function isDuplicateTranscriptSegment(existingSegments, segment, overlapStartMs) {
    const text = normalizeSegmentComparisonText(segment?.text);
    if (!text) {
      return true;
    }
    if (Number(segment?.startMs) < overlapStartMs) {
      const tail = (Array.isArray(existingSegments) ? existingSegments.slice(-6) : []);
      for (const previous of tail) {
        const previousText = normalizeSegmentComparisonText(previous?.text);
        if (!previousText) continue;
        if (previousText === text) {
          return true;
        }
        if (previousText.includes(text) || text.includes(previousText)) {
          return true;
        }
      }
    }
    return false;
  }

  function normalizeSegmentComparisonText(value) {
    return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
  }

  function buildMeetingPartFileName(fileName, partIndex) {
    const normalizedFileName = normalizeText(fileName) || "meeting-source.wav";
    const extensionMatch = normalizedFileName.match(/(\.[^.]+)$/);
    const extension = extensionMatch?.[1] || ".wav";
    const baseName = extensionMatch ? normalizedFileName.slice(0, -extension.length) : normalizedFileName;
    return `${baseName}-part-${String(Math.max(0, Number(partIndex) || 0)).padStart(3, "0")}${extension}`;
  }
}

module.exports = {
  createMeetingProcessingRuntimeDomain,
};
