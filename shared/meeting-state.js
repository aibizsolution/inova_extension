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
      session: {
        endedAt: normalizeText(meeting?.endedAt) || normalizeText(currentState?.session?.endedAt),
        startedAt: normalizeText(meeting?.startedAt) || normalizeText(currentState?.session?.startedAt),
        sessionId: normalizeText(meeting?.sessionId) || normalizeText(currentState?.session?.sessionId),
        title: normalizeText(meeting?.title) || normalizeText(currentState?.session?.title),
      },
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
    return mergeMeetingState(currentState, {
      capture: {
        captureMode: normalizeText(nextJob?.source?.captureMode) || normalizeText(currentState?.capture?.captureMode),
        durationMs: normalizeCount(nextJob?.source?.durationMs) || normalizeCount(currentState?.capture?.durationMs),
        mimeType: normalizeText(nextJob?.source?.mimeType) || normalizeText(currentState?.capture?.mimeType),
        sizeBytes: normalizeCount(nextJob?.source?.sizeBytes) || normalizeCount(currentState?.capture?.sizeBytes),
        status: "uploaded",
      },
      job: {
        artifactId: "",
        error: "",
        jobId: normalizeText(nextJob?.jobId),
        progress: {
          percent: 0,
          phase: "queued",
        },
        sourceAudioDeleted: false,
        status: normalizeText(nextJob?.status) || "queued",
        updatedAt: normalizeText(nextJob?.updatedAt || nextJob?.createdAt),
      },
      session: {
        sessionId: normalizeText(nextJob?.sessionId) || normalizeText(currentState?.session?.sessionId),
      },
      transcript: cloneValue(defaults.transcript),
    });
  }

  function applyMeetingJobSnapshot(currentState, payload) {
    const nextJob = payload?.job || {};
    const transcript = nextJob?.transcript || {};
    return mergeMeetingState(currentState, {
      job: {
        artifactId: normalizeText(nextJob?.artifacts?.[0]?.artifactId || transcript?.artifactId || currentState?.job?.artifactId),
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
    });
  }

  function applyMeetingArtifact(currentState, payload) {
    const artifact = payload?.artifact || {};
    return mergeMeetingState(currentState, {
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
    });
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
        captureMode: normalizeText(next.capture?.captureMode) || normalizeText(baseState.capture.captureMode),
        channelCount: normalizeCount(next.capture?.channelCount, baseState.capture.channelCount),
        durationMs: normalizeCount(next.capture?.durationMs, baseState.capture.durationMs),
        error: normalizeText(next.capture?.error) || normalizeText(baseState.capture.error),
        mimeType: normalizeText(next.capture?.mimeType) || normalizeText(baseState.capture.mimeType),
        sizeBytes: normalizeCount(next.capture?.sizeBytes, baseState.capture.sizeBytes),
        status: normalizeText(next.capture?.status) || normalizeText(baseState.capture.status) || defaults.capture.status,
      },
      job: {
        ...baseState.job,
        ...(next.job || {}),
        artifactId: normalizeText(next.job?.artifactId) || normalizeText(baseState.job.artifactId),
        error: normalizeText(next.job?.error) || normalizeText(baseState.job.error),
        jobId: normalizeText(next.job?.jobId) || normalizeText(baseState.job.jobId),
        progress: {
          ...baseState.job.progress,
          ...((next.job || {}).progress || {}),
          percent: normalizePercent(next.job?.progress?.percent, baseState.job.progress.percent),
          phase: normalizeText(next.job?.progress?.phase) || normalizeText(baseState.job.progress.phase),
        },
        sourceAudioDeleted: Boolean(next.job?.sourceAudioDeleted ?? baseState.job.sourceAudioDeleted),
        status: normalizeText(next.job?.status) || normalizeText(baseState.job.status) || defaults.job.status,
        updatedAt: normalizeText(next.job?.updatedAt) || normalizeText(baseState.job.updatedAt),
      },
      transcript: {
        ...baseState.transcript,
        ...(next.transcript || {}),
        artifactId: normalizeText(next.transcript?.artifactId) || normalizeText(baseState.transcript.artifactId),
        loadedAt: normalizeText(next.transcript?.loadedAt) || normalizeText(baseState.transcript.loadedAt),
        segments: next.transcript?.segments ? normalizeSegments(next.transcript.segments) : cloneValue(baseState.transcript.segments),
        speakerCount: normalizeCount(next.transcript?.speakerCount, baseState.transcript.speakerCount),
        text: next.transcript?.text !== undefined ? normalizeTextBlock(next.transcript.text) : normalizeTextBlock(baseState.transcript.text),
      },
    };
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
    shouldPollMeetingJob,
  };
})(globalThis);
