function createMeetingStateDomain(deps) {
  const {
    buildTranscriptExcerpt,
    getMeetingNotesPreviewText,
    limits,
    normalizeMeetingContext,
    normalizeMeetingNotes,
    normalizeMeetingNotesContextItems,
    normalizeMeetingNotesInputSnapshot,
    normalizeMeetingNotesStatus,
    normalizeMeetingSource,
    normalizeTranscriptSegment,
    normalizeWorkspaceMutation,
    resegmentTranscriptForReview,
    normalizeText,
    normalizeTextBlock,
  } = deps;
  const {
    MAX_MEETING_RECENT_RESULTS,
    MAX_SHARED_MEMO_CHARS,
    NOTES_SCHEMA_VERSION,
  } = limits;

  function normalizeTranscriptionResponse(response, fallbackDurationMs) {
    const inputSegments = Array.isArray(response?.segments) ? response.segments : [];
    const segments = inputSegments
      .map((segment) => {
        const text = normalizeText(segment?.text);
        if (!text) {
          return null;
        }
        const startMs = Math.max(0, Math.round(Number(segment?.start) * 1000));
        const endMs = Math.max(startMs + 1, Math.round(Number(segment?.end) * 1000));
        return {
          endMs,
          startMs,
          text,
        };
      })
      .filter(Boolean);

    if (!segments.length) {
      const text = normalizeText(response?.text);
      if (text) {
        segments.push({
          endMs: Math.max(1, Math.round(Number(response?.duration) * 1000) || Math.max(1, Number(fallbackDurationMs) || 1)),
          startMs: 0,
          text,
        });
      }
    }

    const reviewSegments = resegmentTranscriptForReview(segments);
    const transcriptText = reviewSegments.length
      ? reviewSegments.map((segment) => segment.text).join(" ")
      : normalizeText(response?.text);

    return {
      segments: reviewSegments,
      text: transcriptText,
    };
  }

  function normalizeMeetingJob(input) {
    const job = input && typeof input === "object" ? input : {};
    const normalizedContext = normalizeMeetingContext(job.context);
    const normalizedNotesContextItems = normalizeMeetingNotesContextItems(
      job.notesContextItems?.length ? job.notesContextItems : normalizedContext.notesContextItems
    );
    return {
      artifacts: Array.isArray(job.artifacts) ? job.artifacts.map(normalizeArtifactSummary) : [],
      cleanup: {
        deletedAt: normalizeText(job.cleanup?.deletedAt),
        sourceAudioDeleted: Boolean(job.cleanup?.sourceAudioDeleted),
      },
      context: normalizedContext,
      createdAt: normalizeText(job.createdAt),
      deletedAt: normalizeText(job.deletedAt),
      error: normalizeText(job.error),
      jobId: normalizeText(job.jobId),
      meeting: {
        createdAt: normalizeText(job.meeting?.createdAt),
        endedAt: normalizeText(job.meeting?.endedAt),
        language: normalizeText(job.meeting?.language),
        meetingId: normalizeText(job.meeting?.meetingId),
        sessionId: normalizeText(job.meeting?.sessionId),
        sharedMemo: normalizeTextBlock(job.meeting?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
        sourceTabId: Math.max(0, Number(job.meeting?.sourceTabId) || 0),
        startedAt: normalizeText(job.meeting?.startedAt),
        title: normalizeText(job.meeting?.title),
      },
      meetingId: normalizeText(job.meetingId || job.meeting?.meetingId),
      meetingNotes: normalizeMeetingNotes(job.meetingNotes),
      notesContextItems: normalizedNotesContextItems,
      notesDegradedReason: normalizeText(job.notesDegradedReason),
      notesGeneratedAt: normalizeText(job.notesGeneratedAt),
      notesInputSnapshot: normalizeMeetingNotesInputSnapshot(job.notesInputSnapshot, {
        contextItems: normalizedNotesContextItems,
        sharedMemo: normalizedContext.sharedMemoSnapshot,
        updatedAt: normalizeText(job.notesGeneratedAt || job.updatedAt),
      }),
      notesStatus: normalizeMeetingNotesStatus(job.notesStatus),
      notesSchemaVersion: Math.max(1, Number(job.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
      options: {
        redaction: normalizeText(job.options?.redaction),
        summary: Boolean(job.options?.summary),
      },
      owner: job.owner && typeof job.owner === "object" ? { ...job.owner } : {},
      progress: {
        currentPart: Math.max(0, Number(job.progress?.currentPart) || 0),
        parallelParts: Math.max(0, Number(job.progress?.parallelParts) || 0),
        percent: Math.max(0, Math.min(100, Number(job.progress?.percent) || 0)),
        phase: normalizeText(job.progress?.phase),
        totalParts: Math.max(0, Number(job.progress?.totalParts) || 0),
      },
      retry: {
        count: Math.max(0, Number(job.retry?.count) || 0),
        lastError: normalizeText(job.retry?.lastError),
        lastRetriedAt: normalizeText(job.retry?.lastRetriedAt),
      },
      queuedAt: normalizeText(job.queuedAt),
      sessionId: normalizeText(job.sessionId || job.meeting?.sessionId),
      source: normalizeMeetingSource(job.source),
      status: normalizeText(job.status),
      title: normalizeText(job.title || job.meeting?.title),
      transcript: {
        artifactId: normalizeText(job.transcript?.artifactId),
        segments: Array.isArray(job.transcript?.segments) ? job.transcript.segments.map(normalizeTranscriptSegment) : [],
        text: normalizeText(job.transcript?.text),
      },
      transcription: {
        language: normalizeText(job.transcription?.language),
      },
      updatedAt: normalizeText(job.updatedAt),
      workspaceMutation: normalizeWorkspaceMutation(job.workspaceMutation),
    };
  }

  function normalizeMeetingArtifact(input) {
    const artifact = input && typeof input === "object" ? input : {};
    const normalizedNotesContextItems = normalizeMeetingNotesContextItems(artifact.notesContextItems);
    return {
      artifactId: normalizeText(artifact.artifactId),
      createdAt: normalizeText(artifact.createdAt),
      deletedAt: normalizeText(artifact.deletedAt),
      format: normalizeText(artifact.format),
      jobId: normalizeText(artifact.jobId),
      kind: normalizeText(artifact.kind),
      meetingId: normalizeText(artifact.meetingId),
      notesContextItems: normalizedNotesContextItems,
      notesDegradedReason: normalizeText(artifact.notesDegradedReason),
      notes: normalizeMeetingNotes(artifact.notes),
      notesGeneratedAt: normalizeText(artifact.notesGeneratedAt),
      notesInputSnapshot: normalizeMeetingNotesInputSnapshot(artifact.notesInputSnapshot, {
        contextItems: normalizedNotesContextItems,
        updatedAt: normalizeText(artifact.notesGeneratedAt || artifact.createdAt),
      }),
      notesStatus: normalizeMeetingNotesStatus(artifact.notesStatus),
      notesSchemaVersion: Math.max(1, Number(artifact.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
      owner: artifact.owner && typeof artifact.owner === "object" ? { ...artifact.owner } : {},
      segments: Array.isArray(artifact.segments) ? artifact.segments.map(normalizeTranscriptSegment) : [],
      sessionId: normalizeText(artifact.sessionId),
      text: normalizeText(artifact.text),
    };
  }

  function normalizeArtifactSummary(input) {
    const artifact = input && typeof input === "object" ? input : {};
    return {
      artifactId: normalizeText(artifact.artifactId),
      createdAt: normalizeText(artifact.createdAt),
      format: normalizeText(artifact.format),
      jobId: normalizeText(artifact.jobId),
      kind: normalizeText(artifact.kind),
    };
  }

  function normalizeMeetingSummary(input) {
    const meeting = input && typeof input === "object" ? input : {};
    return {
      createdAt: normalizeText(meeting.createdAt),
      deletedAt: normalizeText(meeting.deletedAt),
      endedAt: normalizeText(meeting.endedAt),
      excerpt: normalizeText(meeting.excerpt),
      language: normalizeText(meeting.language) || "ko",
      latestArtifactId: normalizeText(meeting.latestArtifactId),
      latestJobId: normalizeText(meeting.latestJobId),
      meetingId: normalizeText(meeting.meetingId),
      owner: meeting.owner && typeof meeting.owner === "object" ? { ...meeting.owner } : {},
      pendingLocalCount: Math.max(0, Number(meeting.pendingLocalCount) || 0),
      recentJobs: Array.isArray(meeting.recentJobs) ? meeting.recentJobs.map(normalizeMeetingResultSummary) : [],
      sessionId: normalizeText(meeting.sessionId),
      share: normalizeMeetingShareSummary(meeting.share),
      sharedMemo: normalizeTextBlock(meeting.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
      sourceTabId: Math.max(0, Number(meeting.sourceTabId) || 0),
      startedAt: normalizeText(meeting.startedAt),
      status: normalizeText(meeting.status),
      title: normalizeText(meeting.title),
      updatedAt: normalizeText(meeting.updatedAt),
      workspaceMutation: normalizeWorkspaceMutation(meeting.workspaceMutation),
    };
  }

  function normalizeMeetingShareSummary(input) {
    const share = input && typeof input === "object" ? input : {};
    const status = normalizeText(share.status);
    return {
      active: status === "active" && Boolean(normalizeText(share.shareId)),
      createdAt: normalizeText(share.createdAt),
      createdBy: share.createdBy && typeof share.createdBy === "object" ? { ...share.createdBy } : {},
      revokedAt: normalizeText(share.revokedAt),
      shareId: normalizeText(share.shareId),
      status,
    };
  }

  function normalizeMeetingResultSummary(input) {
    const item = input && typeof input === "object" ? input : {};
    const normalizedNotesContextItems = normalizeMeetingNotesContextItems(item.notesContextItems);
    const sharedMemoSnapshot = normalizeTextBlock(item.sharedMemoSnapshot).slice(0, MAX_SHARED_MEMO_CHARS);
    return {
      artifactId: normalizeText(item.artifactId),
      captureMode: normalizeText(item.captureMode),
      createdAt: normalizeText(item.createdAt),
      durationMs: Math.max(0, Number(item.durationMs) || 0),
      error: normalizeText(item.error),
      meetingId: normalizeText(item.meetingId),
      notesContextItems: normalizedNotesContextItems,
      notesDegradedReason: normalizeText(item.notesDegradedReason),
      notesGeneratedAt: normalizeText(item.notesGeneratedAt),
      notesInputSnapshot: normalizeMeetingNotesInputSnapshot(item.notesInputSnapshot, {
        contextItems: normalizedNotesContextItems,
        sharedMemo: sharedMemoSnapshot,
        updatedAt: normalizeText(item.notesGeneratedAt || item.updatedAt),
      }),
      notesStatus: normalizeMeetingNotesStatus(item.notesStatus),
      notesSchemaVersion: Math.max(1, Number(item.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
      previewText: normalizeText(item.previewText || item.excerpt),
      jobId: normalizeText(item.jobId),
      requestId: normalizeText(item.requestId),
      sessionId: normalizeText(item.sessionId),
      sharedMemoSnapshot,
      status: normalizeText(item.status),
      title: normalizeText(item.title),
      transcriptAvailable: Boolean(item.transcriptAvailable),
      updatedAt: normalizeText(item.updatedAt),
      workspaceMutation: normalizeWorkspaceMutation(item.workspaceMutation),
    };
  }

  function buildMeetingResultSummary(jobInput, artifactInput) {
    const job = normalizeMeetingJob(jobInput);
    const artifact = artifactInput ? normalizeMeetingArtifact(artifactInput) : null;
    const transcriptText = normalizeText(artifact?.text || job.transcript?.text);
    const notesPreview = getMeetingNotesPreviewText(artifact?.notes || job.meetingNotes);
    const notesContextItems = normalizeMeetingNotesContextItems(
      artifact?.notesContextItems?.length ? artifact.notesContextItems : job.notesContextItems
    );
    const sharedMemoSnapshot = normalizeTextBlock(job.context?.sharedMemoSnapshot).slice(0, MAX_SHARED_MEMO_CHARS);
    return normalizeMeetingResultSummary({
      artifactId: normalizeText(artifact?.artifactId || job.transcript?.artifactId || job.artifacts?.[0]?.artifactId),
      captureMode: job.source.captureMode,
      createdAt: job.createdAt || job.queuedAt,
      durationMs: job.source.durationMs,
      error: job.error,
      jobId: job.jobId,
      meetingId: job.meetingId,
      notesContextItems,
      notesDegradedReason: normalizeText(artifact?.notesDegradedReason || job.notesDegradedReason),
      notesGeneratedAt: normalizeText(artifact?.notesGeneratedAt || job.notesGeneratedAt),
      notesInputSnapshot: normalizeMeetingNotesInputSnapshot(
        artifact?.notesInputSnapshot || job.notesInputSnapshot,
        {
          contextItems: notesContextItems,
          sharedMemo: sharedMemoSnapshot,
          updatedAt: normalizeText(artifact?.notesGeneratedAt || job.notesGeneratedAt || job.updatedAt),
        }
      ),
      notesStatus: normalizeMeetingNotesStatus(artifact?.notesStatus || job.notesStatus),
      notesSchemaVersion: Math.max(1, Number(artifact?.notesSchemaVersion || job.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
      previewText: notesPreview || buildTranscriptExcerpt(transcriptText),
      requestId: normalizeText(job.source.requestId),
      sessionId: job.sessionId,
      sharedMemoSnapshot,
      status: job.status,
      title: job.title || job.meeting.title,
      transcriptAvailable: Boolean(transcriptText || normalizeText(artifact?.artifactId || job.transcript?.artifactId)),
      updatedAt: job.updatedAt || job.createdAt || job.queuedAt,
      workspaceMutation: job.workspaceMutation,
    });
  }

  function mergeRecentJobs(currentItems, nextItem) {
    const map = new Map();
    for (const item of Array.isArray(currentItems) ? currentItems : []) {
      const normalized = normalizeMeetingResultSummary(item);
      if (normalized.jobId) {
        map.set(normalized.jobId, normalized);
      }
    }
    const normalizedNext = normalizeMeetingResultSummary(nextItem);
    if (normalizedNext.jobId) {
      map.set(normalizedNext.jobId, normalizedNext);
    }
    return Array.from(map.values())
      .sort(compareMeetingResults)
      .slice(0, MAX_MEETING_RECENT_RESULTS);
  }

  function compareMeetingResults(left, right) {
    return toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt);
  }

  function compareMeetings(left, right) {
    return toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt);
  }

  function toTimestamp(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return 0;
    }
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return {
    buildMeetingResultSummary,
    compareMeetingResults,
    compareMeetings,
    mergeRecentJobs,
    normalizeArtifactSummary,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeMeetingResultSummary,
    normalizeMeetingShareSummary,
    normalizeMeetingSummary,
    normalizeTranscriptionResponse,
  };
}

module.exports = {
  createMeetingStateDomain,
};
