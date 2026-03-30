(function initMeetingState(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants.defaults.meetingState;
  const ACTIVE_JOB_STATUSES = new Set(["queued", "processing"]);

  function mergeMeetingState(...states) {
    return states.reduce(
      (merged, nextState) => mergeOneMeetingState(merged, nextState),
      cloneValue(defaults)
    );
  }

  function createDraftMeetingState(input) {
    return mergeMeetingState({
      capture: {
        captureMode: normalizeText(input?.source?.captureMode),
        error: "",
        channelCount: normalizeCount(input?.source?.channelCount),
        durationMs: normalizeCount(input?.source?.durationMs),
        mimeType: normalizeText(input?.source?.mimeType),
        sizeBytes: normalizeCount(input?.source?.sizeBytes),
        status: "captured",
      },
      job: {
        artifactId: "",
        createdAt: "",
        error: "",
        jobId: "",
        progress: {
          percent: 0,
          phase: "",
        },
        sourceAudioDeleted: false,
        status: "idle",
        updatedAt: "",
      },
      session: {
        endedAt: normalizeText(input?.meeting?.endedAt),
        language: normalizeText(input?.meeting?.language) || defaults.session.language,
        sessionId: normalizeText(input?.meeting?.sessionId),
        startedAt: normalizeText(input?.meeting?.startedAt),
        title: normalizeText(input?.meeting?.title),
      },
      transcript: cloneValue(defaults.transcript),
    });
  }

  function applyMeetingCaptureStarted(currentState, payload) {
    const capture = payload?.capture || {};
    const meeting = payload?.meeting || {};
    return mergeMeetingState(currentState, {
      capture: {
        captureMode: normalizeText(capture?.captureMode),
        error: "",
        mimeType: normalizeText(capture?.mimeType),
        status: "recording",
      },
      job: {
        artifactId: "",
        createdAt: "",
        error: "",
        jobId: "",
        progress: {
          percent: 0,
          phase: "",
        },
        sourceAudioDeleted: false,
        status: "idle",
        updatedAt: "",
      },
      session: {
        endedAt: "",
        startedAt: normalizeText(meeting?.startedAt) || normalizeText(currentState?.session?.startedAt),
        sessionId: normalizeText(meeting?.sessionId) || normalizeText(currentState?.session?.sessionId),
        title: normalizeText(meeting?.title) || normalizeText(currentState?.session?.title),
      },
      transcript: cloneValue(defaults.transcript),
    });
  }

  function applyMeetingCaptureFinished(currentState, payload) {
    const capture = payload?.capture || {};
    const meeting = payload?.meeting || {};
    return mergeMeetingState(currentState, {
      capture: {
        captureMode: normalizeText(capture?.captureMode) || normalizeText(currentState?.capture?.captureMode),
        channelCount: normalizeCount(capture?.channelCount, currentState?.capture?.channelCount || 1),
        durationMs: normalizeCount(capture?.durationMs, currentState?.capture?.durationMs),
        error: "",
        mimeType: normalizeText(capture?.mimeType) || normalizeText(currentState?.capture?.mimeType),
        sizeBytes: normalizeCount(capture?.sizeBytes, currentState?.capture?.sizeBytes),
        status: "captured",
      },
      job: {
        artifactId: "",
        createdAt: "",
        error: "",
        jobId: "",
        progress: {
          percent: 0,
          phase: "",
        },
        sourceAudioDeleted: false,
        status: "idle",
        updatedAt: "",
      },
      session: {
        endedAt: normalizeText(meeting?.endedAt) || normalizeText(currentState?.session?.endedAt),
        startedAt: normalizeText(meeting?.startedAt) || normalizeText(currentState?.session?.startedAt),
        sessionId: normalizeText(meeting?.sessionId) || normalizeText(currentState?.session?.sessionId),
        title: normalizeText(meeting?.title) || normalizeText(currentState?.session?.title),
      },
      transcript: cloneValue(defaults.transcript),
    });
  }

  function applyMeetingCaptureFailed(currentState, payload) {
    const capture = payload?.capture || {};
    const meeting = payload?.meeting || {};
    return mergeMeetingState(currentState, {
      capture: {
        captureMode: normalizeText(capture?.captureMode) || normalizeText(currentState?.capture?.captureMode),
        error: normalizeText(payload?.error || capture?.error),
        status: "error",
      },
      session: {
        sessionId: normalizeText(meeting?.sessionId) || normalizeText(currentState?.session?.sessionId),
        title: normalizeText(meeting?.title) || normalizeText(currentState?.session?.title),
      },
    });
  }

  function applyMeetingJobCreated(currentState, payload) {
    const nextJob = payload?.job || {};
    const transcript = nextJob?.transcript || {};
    return syncMeetingRecord(mergeMeetingState(currentState, {
      capture: {
        captureMode: normalizeText(nextJob?.source?.captureMode) || normalizeText(currentState?.capture?.captureMode),
        durationMs: normalizeCount(nextJob?.source?.durationMs) || normalizeCount(currentState?.capture?.durationMs),
        mimeType: normalizeText(nextJob?.source?.mimeType) || normalizeText(currentState?.capture?.mimeType),
        sizeBytes: normalizeCount(nextJob?.source?.sizeBytes) || normalizeCount(currentState?.capture?.sizeBytes),
        status: "uploaded",
      },
      job: {
        artifactId: normalizeText(nextJob?.artifacts?.[0]?.artifactId || transcript?.artifactId),
        createdAt: normalizeText(nextJob?.createdAt),
        error: normalizeText(nextJob?.error),
        jobId: normalizeText(nextJob?.jobId),
        progress: {
          percent: normalizePercent(nextJob?.progress?.percent),
          phase: normalizeText(nextJob?.progress?.phase) || "queued",
        },
        sourceAudioDeleted: Boolean(nextJob?.cleanup?.sourceAudioDeleted),
        status: normalizeText(nextJob?.status) || "queued",
        updatedAt: normalizeText(nextJob?.updatedAt || nextJob?.createdAt),
      },
      session: {
        sessionId: normalizeText(nextJob?.sessionId) || normalizeText(currentState?.session?.sessionId),
      },
      transcript: {
        artifactId: normalizeText(transcript?.artifactId || nextJob?.artifacts?.[0]?.artifactId),
        loadedAt: normalizeText(nextJob?.updatedAt || nextJob?.createdAt),
        segments: normalizeSegments(transcript?.segments),
        speakerCount: Math.max(0, Number(nextJob?.transcription?.speakerCount) || 0),
        text: normalizeTextBlock(transcript?.text),
      },
    }));
  }

  function applyMeetingJobSnapshot(currentState, payload) {
    const nextJob = payload?.job || {};
    const transcript = nextJob?.transcript || {};
    return syncMeetingRecord(mergeMeetingState(currentState, {
      job: {
        artifactId: normalizeText(nextJob?.artifacts?.[0]?.artifactId || transcript?.artifactId || currentState?.job?.artifactId),
        createdAt: normalizeText(nextJob?.createdAt) || normalizeText(currentState?.job?.createdAt),
        error: normalizeText(nextJob?.error),
        jobId: normalizeText(nextJob?.jobId) || normalizeText(currentState?.job?.jobId),
        progress: {
          percent: normalizePercent(nextJob?.progress?.percent),
          phase: normalizeText(nextJob?.progress?.phase),
        },
        sourceAudioDeleted: Boolean(nextJob?.cleanup?.sourceAudioDeleted),
        status: normalizeText(nextJob?.status) || normalizeText(currentState?.job?.status),
        updatedAt: normalizeText(nextJob?.updatedAt),
      },
      session: {
        sessionId: normalizeText(nextJob?.sessionId) || normalizeText(currentState?.session?.sessionId),
      },
      transcript: {
        artifactId: normalizeText(transcript?.artifactId || nextJob?.artifacts?.[0]?.artifactId),
        loadedAt: normalizeText(nextJob?.updatedAt),
        segments: normalizeSegments(transcript?.segments),
        speakerCount: Math.max(0, Number(nextJob?.transcription?.speakerCount) || 0),
        text: normalizeTextBlock(transcript?.text),
      },
    }));
  }

  function applyMeetingArtifact(currentState, payload) {
    const artifact = payload?.artifact || {};
    return syncMeetingRecord(mergeMeetingState(currentState, {
      job: {
        artifactId: normalizeText(artifact?.artifactId) || normalizeText(currentState?.job?.artifactId),
      },
      transcript: {
        artifactId: normalizeText(artifact?.artifactId),
        loadedAt: new Date().toISOString(),
        segments: normalizeSegments(artifact?.segments),
        speakerCount: countSpeakers(artifact?.segments),
        text: normalizeTextBlock(artifact?.text),
      },
    }));
  }

  function buildMeetingJobLookup(meetingState) {
    const normalized = mergeMeetingState(meetingState);
    return {
      jobId: normalized.job.jobId,
      sessionId: normalized.session.sessionId,
    };
  }

  function buildMeetingArtifactLookup(meetingState) {
    const normalized = mergeMeetingState(meetingState);
    return {
      artifactId: normalized.transcript.artifactId || normalized.job.artifactId,
      jobId: normalized.job.jobId,
    };
  }

  function buildMeetingJobCreateInput(meetingState, overrides) {
    const normalized = mergeMeetingState(meetingState, overrides);
    return {
      meeting: {
        endedAt: normalizeText(normalized.session.endedAt),
        language: normalizeText(normalized.session.language) || defaults.session.language,
        sessionId: normalizeText(normalized.session.sessionId),
        startedAt: normalizeText(normalized.session.startedAt),
        title: normalizeText(normalized.session.title),
      },
      options: {
        redaction: normalizeText(overrides?.options?.redaction) || "none",
        speakerLabels: overrides?.options?.speakerLabels !== false,
        summary: Boolean(overrides?.options?.summary),
      },
      source: {
        captureMode: normalizeText(normalized.capture.captureMode),
        channelCount: normalizeCount(normalized.capture.channelCount, 1),
        durationMs: normalizeCount(normalized.capture.durationMs),
        mimeType: normalizeText(normalized.capture.mimeType),
        sizeBytes: normalizeCount(normalized.capture.sizeBytes),
      },
    };
  }

  function shouldPollMeetingJob(meetingState) {
    const normalized = mergeMeetingState(meetingState);
    return Boolean(normalized.job.jobId && ACTIVE_JOB_STATUSES.has(normalized.job.status));
  }

  function mergeOneMeetingState(baseState, nextState) {
    const next = nextState && typeof nextState === "object" ? nextState : {};
    const nextCapture = next.capture && typeof next.capture === "object" ? next.capture : null;
    const nextJob = next.job && typeof next.job === "object" ? next.job : null;
    const nextJobProgress = nextJob?.progress && typeof nextJob.progress === "object" ? nextJob.progress : null;
    const nextTranscript = next.transcript && typeof next.transcript === "object" ? next.transcript : null;
    return {
      ...baseState,
      ...next,
      version: Math.max(1, Number(next.version) || Number(baseState.version) || 1),
      session: {
        ...baseState.session,
        ...(next.session || {}),
        language: normalizeText(next.session?.language) || normalizeText(baseState.session.language) || defaults.session.language,
        sessionId: normalizeText(next.session?.sessionId) || normalizeText(baseState.session.sessionId),
      },
      capture: {
        ...baseState.capture,
        ...(next.capture || {}),
        captureMode: hasOwn(nextCapture, "captureMode")
          ? normalizeText(nextCapture.captureMode)
          : normalizeText(baseState.capture.captureMode),
        channelCount: normalizeCount(next.capture?.channelCount, baseState.capture.channelCount),
        durationMs: normalizeCount(next.capture?.durationMs, baseState.capture.durationMs),
        error: hasOwn(nextCapture, "error")
          ? normalizeText(nextCapture.error)
          : normalizeText(baseState.capture.error),
        mimeType: hasOwn(nextCapture, "mimeType")
          ? normalizeText(nextCapture.mimeType)
          : normalizeText(baseState.capture.mimeType),
        sizeBytes: normalizeCount(next.capture?.sizeBytes, baseState.capture.sizeBytes),
        status: hasOwn(nextCapture, "status")
          ? normalizeText(nextCapture.status) || defaults.capture.status
          : normalizeText(baseState.capture.status) || defaults.capture.status,
      },
      job: {
        ...baseState.job,
        ...(next.job || {}),
        artifactId: hasOwn(nextJob, "artifactId")
          ? normalizeText(nextJob.artifactId)
          : normalizeText(baseState.job.artifactId),
        createdAt: hasOwn(nextJob, "createdAt")
          ? normalizeText(nextJob.createdAt)
          : normalizeText(baseState.job.createdAt),
        error: hasOwn(nextJob, "error")
          ? normalizeText(nextJob.error)
          : normalizeText(baseState.job.error),
        jobId: hasOwn(nextJob, "jobId")
          ? normalizeText(nextJob.jobId)
          : normalizeText(baseState.job.jobId),
        progress: {
          ...baseState.job.progress,
          ...((next.job || {}).progress || {}),
          percent: normalizePercent(next.job?.progress?.percent, baseState.job.progress.percent),
          phase: hasOwn(nextJobProgress, "phase")
            ? normalizeText(nextJobProgress.phase)
            : normalizeText(baseState.job.progress.phase),
        },
        sourceAudioDeleted: Boolean(next.job?.sourceAudioDeleted ?? baseState.job.sourceAudioDeleted),
        status: hasOwn(nextJob, "status")
          ? normalizeText(nextJob.status) || defaults.job.status
          : normalizeText(baseState.job.status) || defaults.job.status,
        updatedAt: hasOwn(nextJob, "updatedAt")
          ? normalizeText(nextJob.updatedAt)
          : normalizeText(baseState.job.updatedAt),
      },
      transcript: {
        ...baseState.transcript,
        ...(next.transcript || {}),
        artifactId: hasOwn(nextTranscript, "artifactId")
          ? normalizeText(nextTranscript.artifactId)
          : normalizeText(baseState.transcript.artifactId),
        loadedAt: hasOwn(nextTranscript, "loadedAt")
          ? normalizeText(nextTranscript.loadedAt)
          : normalizeText(baseState.transcript.loadedAt),
        segments: next.transcript?.segments ? normalizeSegments(next.transcript.segments) : cloneValue(baseState.transcript.segments),
        speakerCount: normalizeCount(next.transcript?.speakerCount, baseState.transcript.speakerCount),
        text: next.transcript?.text !== undefined ? normalizeTextBlock(next.transcript.text) : normalizeTextBlock(baseState.transcript.text),
      },
      records: next.records ? normalizeRecords(next.records) : cloneValue(baseState.records || defaults.records),
    };
  }

  function syncMeetingRecord(meetingState) {
    const normalized = mergeMeetingState(meetingState);
    if (!normalizeText(normalized.job.jobId)) {
      return normalized;
    }
    const nextRecords = upsertMeetingRecord(normalized.records, createMeetingRecord(normalized));
    return mergeMeetingState(normalized, { records: nextRecords });
  }

  function createMeetingRecord(meetingState) {
    const normalized = mergeMeetingState(meetingState);
    const transcriptText = normalizeTextBlock(normalized.transcript.text);
    return {
      artifactId: normalizeText(normalized.transcript.artifactId || normalized.job.artifactId),
      createdAt: normalizeText(normalized.job.createdAt || normalized.job.updatedAt || normalized.transcript.loadedAt),
      error: normalizeText(normalized.job.error),
      jobId: normalizeText(normalized.job.jobId),
      previewText: transcriptText ? transcriptText.slice(0, 180) : "",
      sessionId: normalizeText(normalized.session.sessionId),
      speakerCount: normalizeCount(normalized.transcript.speakerCount || countSpeakers(normalized.transcript.segments)),
      status: normalizeText(normalized.job.status) || defaults.job.status,
      title: normalizeText(normalized.session.title) || normalizeText(normalized.session.sessionId),
      updatedAt: normalizeText(normalized.job.updatedAt || normalized.transcript.loadedAt || normalized.job.createdAt),
    };
  }

  function upsertMeetingRecord(records, nextRecord) {
    const normalizedRecord = normalizeRecord(nextRecord);
    if (!normalizedRecord.jobId) {
      return normalizeRecords(records);
    }
    const next = normalizeRecords(records).filter((record) => record.jobId !== normalizedRecord.jobId);
    next.push(normalizedRecord);
    next.sort(compareMeetingRecords);
    return next;
  }

  function normalizeRecords(records) {
    return (Array.isArray(records) ? records : [])
      .map(normalizeRecord)
      .filter((record) => record.jobId);
  }

  function normalizeRecord(record) {
    const nextRecord = record && typeof record === "object" ? record : {};
    return {
      artifactId: normalizeText(nextRecord.artifactId),
      createdAt: normalizeText(nextRecord.createdAt),
      error: normalizeText(nextRecord.error),
      jobId: normalizeText(nextRecord.jobId),
      previewText: normalizeTextBlock(nextRecord.previewText),
      sessionId: normalizeText(nextRecord.sessionId),
      speakerCount: normalizeCount(nextRecord.speakerCount),
      status: normalizeText(nextRecord.status) || defaults.job.status,
      title: normalizeText(nextRecord.title),
      updatedAt: normalizeText(nextRecord.updatedAt),
    };
  }

  function compareMeetingRecords(left, right) {
    return toRecordTime(right.updatedAt || right.createdAt) - toRecordTime(left.updatedAt || left.createdAt);
  }

  function toRecordTime(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function hasOwn(value, key) {
    return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
  }

  function normalizeSegments(segments) {
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => ({
        endMs: normalizeCount(segment?.endMs),
        speakerLabel: normalizeText(segment?.speakerLabel),
        startMs: normalizeCount(segment?.startMs),
        text: normalizeTextBlock(segment?.text),
      }))
      .filter((segment) => segment.speakerLabel && segment.text && segment.endMs > segment.startMs);
  }

  function countSpeakers(segments) {
    return Array.from(new Set(normalizeSegments(segments).map((segment) => segment.speakerLabel))).length;
  }

  function normalizeCount(value, fallback = 0) {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0) {
      return Math.max(0, Number(fallback) || 0);
    }
    return next;
  }

  function normalizePercent(value, fallback = 0) {
    return Math.max(0, Math.min(100, normalizeCount(value, fallback)));
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeTextBlock(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .trim();
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.meetingState = {
    applyMeetingCaptureFailed,
    applyMeetingCaptureFinished,
    applyMeetingCaptureStarted,
    applyMeetingArtifact,
    applyMeetingJobCreated,
    applyMeetingJobSnapshot,
    buildMeetingJobCreateInput,
    buildMeetingArtifactLookup,
    buildMeetingJobLookup,
    createDraftMeetingState,
    mergeMeetingState,
    normalizeRecords,
    shouldPollMeetingJob,
  };
})(globalThis);
