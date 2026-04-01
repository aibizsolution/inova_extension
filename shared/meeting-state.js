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

  function createMeetingId() {
    const timePart = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    return `meeting-${timePart}-${randomPart}`;
  }

  function createDraftMeetingState(input) {
    const meetingId = normalizeText(input?.meeting?.meetingId) || createMeetingId();
    const createdAt = normalizeText(input?.meeting?.createdAt) || new Date().toISOString();
    const sourceDurationMs = normalizeCount(input?.source?.durationMs);
    const sourceSizeBytes = normalizeCount(input?.source?.sizeBytes);
    const hasCapturedSource = sourceDurationMs > 0 || sourceSizeBytes > 0;
    return mergeMeetingState({
      meeting: {
        createdAt,
        meetingId,
        sourceTabId: normalizeCount(input?.meeting?.sourceTabId),
        title: normalizeText(input?.meeting?.title),
        updatedAt: createdAt,
      },
      capture: {
        captureMode: normalizeText(input?.source?.captureMode),
        error: "",
        channelCount: normalizeCount(input?.source?.channelCount),
        durationMs: sourceDurationMs,
        mimeType: normalizeText(input?.source?.mimeType),
        sizeBytes: sourceSizeBytes,
        status: hasCapturedSource ? "captured" : "idle",
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
    const current = mergeMeetingState(currentState);
    const startedAt = normalizeText(meeting?.startedAt);
    return mergeMeetingState(current, {
      meeting: {
        createdAt: startedAt || current.meeting.createdAt,
        meetingId: normalizeText(meeting?.meetingId) || current.meeting.meetingId,
        sourceTabId: normalizeCount(meeting?.sourceTabId, current.meeting.sourceTabId),
        title: normalizeText(meeting?.title) || current.meeting.title,
        updatedAt: startedAt || new Date().toISOString(),
      },
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
        startedAt: startedAt || normalizeText(current.session.startedAt),
        sessionId: normalizeText(meeting?.sessionId) || normalizeText(current.session.sessionId),
        title: normalizeText(meeting?.title) || normalizeText(current.session.title),
      },
      transcript: cloneValue(defaults.transcript),
    });
  }

  function applyMeetingCaptureFinished(currentState, payload) {
    const capture = payload?.capture || {};
    const meeting = payload?.meeting || {};
    const current = mergeMeetingState(currentState);
    const endedAt = normalizeText(meeting?.endedAt) || new Date().toISOString();
    return mergeMeetingState(current, {
      meeting: {
        meetingId: normalizeText(meeting?.meetingId) || current.meeting.meetingId,
        sourceTabId: normalizeCount(meeting?.sourceTabId, current.meeting.sourceTabId),
        title: normalizeText(meeting?.title) || current.meeting.title,
        updatedAt: endedAt,
      },
      capture: {
        captureMode: normalizeText(capture?.captureMode) || normalizeText(current.capture.captureMode),
        channelCount: normalizeCount(capture?.channelCount, current.capture.channelCount || 1),
        durationMs: normalizeCount(capture?.durationMs, current.capture.durationMs),
        error: "",
        mimeType: normalizeText(capture?.mimeType) || normalizeText(current.capture.mimeType),
        sizeBytes: normalizeCount(capture?.sizeBytes, current.capture.sizeBytes),
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
        endedAt,
        startedAt: normalizeText(meeting?.startedAt) || normalizeText(current.session.startedAt),
        sessionId: normalizeText(meeting?.sessionId) || normalizeText(current.session.sessionId),
        title: normalizeText(meeting?.title) || normalizeText(current.session.title),
      },
      transcript: cloneValue(defaults.transcript),
    });
  }

  function applyMeetingCaptureFailed(currentState, payload) {
    const capture = payload?.capture || {};
    const meeting = payload?.meeting || {};
    const current = mergeMeetingState(currentState);
    return mergeMeetingState(current, {
      meeting: {
        meetingId: normalizeText(meeting?.meetingId) || current.meeting.meetingId,
        sourceTabId: normalizeCount(meeting?.sourceTabId, current.meeting.sourceTabId),
        title: normalizeText(meeting?.title) || current.meeting.title,
        updatedAt: new Date().toISOString(),
      },
      capture: {
        captureMode: normalizeText(capture?.captureMode) || normalizeText(current.capture.captureMode),
        error: normalizeText(payload?.error || capture?.error),
        status: "error",
      },
      session: {
        sessionId: normalizeText(meeting?.sessionId) || normalizeText(current.session.sessionId),
        title: normalizeText(meeting?.title) || normalizeText(current.session.title),
      },
    });
  }

  function applyMeetingJobCreated(currentState, payload) {
    const nextJob = payload?.job || {};
    const transcript = nextJob?.transcript || {};
    const current = mergeMeetingState(currentState);
    return syncMeetingRecord(mergeMeetingState(current, {
      meeting: buildMeetingPatchFromJob(nextJob, current, nextJob?.updatedAt || nextJob?.createdAt),
      capture: {
        captureMode: normalizeText(nextJob?.source?.captureMode) || normalizeText(current.capture.captureMode),
        durationMs: normalizeCount(nextJob?.source?.durationMs, current.capture.durationMs),
        mimeType: normalizeText(nextJob?.source?.mimeType) || normalizeText(current.capture.mimeType),
        sizeBytes: normalizeCount(nextJob?.source?.sizeBytes, current.capture.sizeBytes),
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
        sessionId: normalizeText(nextJob?.sessionId) || normalizeText(current.session.sessionId),
        title: normalizeText(nextJob?.meeting?.title) || normalizeText(current.session.title),
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
    const current = mergeMeetingState(currentState);
    return syncMeetingRecord(mergeMeetingState(current, {
      meeting: buildMeetingPatchFromJob(nextJob, current, nextJob?.updatedAt),
      job: {
        artifactId: normalizeText(nextJob?.artifacts?.[0]?.artifactId || transcript?.artifactId || current.job.artifactId),
        createdAt: normalizeText(nextJob?.createdAt) || normalizeText(current.job.createdAt),
        error: normalizeText(nextJob?.error),
        jobId: normalizeText(nextJob?.jobId) || normalizeText(current.job.jobId),
        progress: {
          percent: normalizePercent(nextJob?.progress?.percent),
          phase: normalizeText(nextJob?.progress?.phase),
        },
        sourceAudioDeleted: Boolean(nextJob?.cleanup?.sourceAudioDeleted),
        status: normalizeText(nextJob?.status) || normalizeText(current.job.status),
        updatedAt: normalizeText(nextJob?.updatedAt),
      },
      session: {
        sessionId: normalizeText(nextJob?.sessionId) || normalizeText(current.session.sessionId),
        title: normalizeText(nextJob?.meeting?.title) || normalizeText(current.session.title),
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
    const current = mergeMeetingState(currentState);
    return syncMeetingRecord(mergeMeetingState(current, {
      meeting: {
        meetingId: normalizeText(artifact?.meetingId) || current.meeting.meetingId,
        updatedAt: new Date().toISOString(),
      },
      job: {
        artifactId: normalizeText(artifact?.artifactId) || normalizeText(current.job.artifactId),
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
      meetingId: normalized.meeting.meetingId,
      sessionId: normalized.session.sessionId,
    };
  }

  function buildMeetingArtifactLookup(meetingState) {
    const normalized = mergeMeetingState(meetingState);
    return {
      artifactId: normalized.transcript.artifactId || normalized.job.artifactId,
      jobId: normalized.job.jobId,
      meetingId: normalized.meeting.meetingId,
    };
  }

  function buildMeetingJobCreateInput(meetingState, overrides) {
    const normalized = mergeMeetingState(meetingState, overrides);
    return {
      meeting: {
        endedAt: normalizeText(normalized.session.endedAt),
        language: normalizeText(normalized.session.language) || defaults.session.language,
        meetingId: normalizeText(normalized.meeting.meetingId),
        sessionId: normalizeText(normalized.session.sessionId),
        sourceTabId: normalizeCount(normalized.meeting.sourceTabId),
        startedAt: normalizeText(normalized.session.startedAt),
        title: normalizeText(normalized.meeting.title) || normalizeText(normalized.session.title),
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
    const base = cloneValue(baseState || defaults);
    const next = nextState && typeof nextState === "object" ? nextState : {};
    const nextMeeting = next.meeting && typeof next.meeting === "object" ? next.meeting : null;
    const nextSession = next.session && typeof next.session === "object" ? next.session : null;
    const nextCapture = next.capture && typeof next.capture === "object" ? next.capture : null;
    const nextJob = next.job && typeof next.job === "object" ? next.job : null;
    const nextJobProgress = nextJob?.progress && typeof nextJob.progress === "object" ? nextJob.progress : null;
    const nextTranscript = next.transcript && typeof next.transcript === "object" ? next.transcript : null;

    const baseMeetingId = normalizeText(base.meeting?.meetingId || base.session?.sessionId);
    const nextMeetingId = normalizeText(nextMeeting?.meetingId || nextSession?.sessionId || baseMeetingId);
    const baseMeetingTitle = normalizeText(base.meeting?.title || base.session?.title);
    const nextMeetingTitle = normalizeText(nextMeeting?.title || nextSession?.title || baseMeetingTitle);

    return {
      ...base,
      ...next,
      version: Math.max(1, Number(next.version) || Number(base.version) || 1),
      meeting: {
        ...base.meeting,
        ...(next.meeting || {}),
        createdAt: hasOwn(nextMeeting, "createdAt")
          ? normalizeText(nextMeeting.createdAt)
          : normalizeText(base.meeting.createdAt),
        meetingId: nextMeetingId,
        sourceTabId: normalizeCount(next.meeting?.sourceTabId, base.meeting.sourceTabId),
        title: nextMeetingTitle,
        updatedAt: hasOwn(nextMeeting, "updatedAt")
          ? normalizeText(nextMeeting.updatedAt)
          : normalizeText(base.meeting.updatedAt),
      },
      session: {
        ...base.session,
        ...(next.session || {}),
        language: normalizeText(next.session?.language) || normalizeText(base.session.language) || defaults.session.language,
        sessionId: hasOwn(nextSession, "sessionId")
          ? normalizeText(nextSession.sessionId)
          : normalizeText(base.session.sessionId),
        title: nextMeetingTitle || normalizeText(base.session.title),
      },
      capture: {
        ...base.capture,
        ...(next.capture || {}),
        captureMode: hasOwn(nextCapture, "captureMode")
          ? normalizeText(nextCapture.captureMode)
          : normalizeText(base.capture.captureMode),
        channelCount: normalizeCount(next.capture?.channelCount, base.capture.channelCount),
        durationMs: normalizeCount(next.capture?.durationMs, base.capture.durationMs),
        error: hasOwn(nextCapture, "error")
          ? normalizeText(nextCapture.error)
          : normalizeText(base.capture.error),
        mimeType: hasOwn(nextCapture, "mimeType")
          ? normalizeText(nextCapture.mimeType)
          : normalizeText(base.capture.mimeType),
        sizeBytes: normalizeCount(next.capture?.sizeBytes, base.capture.sizeBytes),
        status: hasOwn(nextCapture, "status")
          ? normalizeText(nextCapture.status) || defaults.capture.status
          : normalizeText(base.capture.status) || defaults.capture.status,
      },
      job: {
        ...base.job,
        ...(next.job || {}),
        artifactId: hasOwn(nextJob, "artifactId")
          ? normalizeText(nextJob.artifactId)
          : normalizeText(base.job.artifactId),
        createdAt: hasOwn(nextJob, "createdAt")
          ? normalizeText(nextJob.createdAt)
          : normalizeText(base.job.createdAt),
        error: hasOwn(nextJob, "error")
          ? normalizeText(nextJob.error)
          : normalizeText(base.job.error),
        jobId: hasOwn(nextJob, "jobId")
          ? normalizeText(nextJob.jobId)
          : normalizeText(base.job.jobId),
        progress: {
          ...base.job.progress,
          ...((next.job || {}).progress || {}),
          percent: normalizePercent(next.job?.progress?.percent, base.job.progress.percent),
          phase: hasOwn(nextJobProgress, "phase")
            ? normalizeText(nextJobProgress.phase)
            : normalizeText(base.job.progress.phase),
        },
        sourceAudioDeleted: Boolean(next.job?.sourceAudioDeleted ?? base.job.sourceAudioDeleted),
        status: hasOwn(nextJob, "status")
          ? normalizeText(nextJob.status) || defaults.job.status
          : normalizeText(base.job.status) || defaults.job.status,
        updatedAt: hasOwn(nextJob, "updatedAt")
          ? normalizeText(nextJob.updatedAt)
          : normalizeText(base.job.updatedAt),
      },
      transcript: {
        ...base.transcript,
        ...(next.transcript || {}),
        artifactId: hasOwn(nextTranscript, "artifactId")
          ? normalizeText(nextTranscript.artifactId)
          : normalizeText(base.transcript.artifactId),
        loadedAt: hasOwn(nextTranscript, "loadedAt")
          ? normalizeText(nextTranscript.loadedAt)
          : normalizeText(base.transcript.loadedAt),
        segments: hasOwn(next, "transcript") && Array.isArray(next.transcript?.segments)
          ? normalizeSegments(next.transcript.segments)
          : cloneValue(base.transcript.segments),
        speakerCount: normalizeCount(next.transcript?.speakerCount, base.transcript.speakerCount),
        text: hasOwn(nextTranscript, "text")
          ? normalizeTextBlock(nextTranscript.text)
          : normalizeTextBlock(base.transcript.text),
      },
      records: hasOwn(next, "records")
        ? normalizeRecords(next.records)
        : cloneValue(base.records || defaults.records),
    };
  }

  function buildMeetingPatchFromJob(job, current, fallbackUpdatedAt) {
    return {
      createdAt: normalizeText(job?.meeting?.createdAt || current.meeting.createdAt || job?.createdAt),
      meetingId: normalizeText(job?.meetingId || job?.meeting?.meetingId || current.meeting.meetingId),
      sourceTabId: normalizeCount(job?.meeting?.sourceTabId, current.meeting.sourceTabId),
      title: normalizeText(job?.meeting?.title || current.meeting.title),
      updatedAt: normalizeText(fallbackUpdatedAt || current.meeting.updatedAt),
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
      meetingId: normalizeText(normalized.meeting.meetingId),
      previewText: transcriptText ? transcriptText.slice(0, 180) : "",
      sessionId: normalizeText(normalized.session.sessionId),
      speakerCount: normalizeCount(normalized.transcript.speakerCount || countSpeakers(normalized.transcript.segments)),
      status: normalizeText(normalized.job.status) || defaults.job.status,
      title: normalizeText(normalized.meeting.title || normalized.session.title || normalized.meeting.meetingId),
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
      meetingId: normalizeText(nextRecord.meetingId || nextRecord.sessionId),
      previewText: normalizeTextBlock(nextRecord.previewText || nextRecord.excerpt),
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
    applyMeetingArtifact,
    applyMeetingCaptureFailed,
    applyMeetingCaptureFinished,
    applyMeetingCaptureStarted,
    applyMeetingJobCreated,
    applyMeetingJobSnapshot,
    buildMeetingArtifactLookup,
    buildMeetingJobCreateInput,
    buildMeetingJobLookup,
    createDraftMeetingState,
    createMeetingId,
    mergeMeetingState,
    normalizeRecord,
    normalizeRecords,
    shouldPollMeetingJob,
  };
})(globalThis);
