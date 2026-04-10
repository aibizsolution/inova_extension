function createMeetingNotesSourceDomain(deps) {
  const {
    artifactCollection,
    db,
    maxSharedMemoChars,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeMeetingNotesInputSnapshot,
    normalizeText,
    normalizeTextBlock,
  } = deps;

  function resolveMeetingArtifactId(jobInput) {
    const job = normalizeMeetingJob(jobInput);
    return normalizeText(job.transcript?.artifactId || job.artifacts?.[0]?.artifactId);
  }

  async function loadMeetingArtifactSource(jobInput, options = {}) {
    const artifactId = normalizeText(options.artifactId || resolveMeetingArtifactId(jobInput));
    const artifactRef = options.artifactRef || (artifactId ? db.collection(artifactCollection).doc(artifactId) : null);
    if (options.artifact) {
      return {
        artifact: normalizeMeetingArtifact(options.artifact),
        artifactId,
        artifactRef,
      };
    }
    if (!artifactRef) {
      return {
        artifact: null,
        artifactId,
        artifactRef: null,
      };
    }
    const snapshot = await artifactRef.get();
    return {
      artifact: snapshot.exists ? normalizeMeetingArtifact(snapshot.data()) : null,
      artifactId,
      artifactRef,
    };
  }

  async function loadMeetingNotesSource(jobInput, options = {}) {
    const job = normalizeMeetingJob(jobInput);
    const { artifact, artifactId, artifactRef } = await loadMeetingArtifactSource(job, options);
    const sharedMemoSnapshot = normalizeTextBlock(
      job.context?.sharedMemoSnapshot
      || job.meeting?.sharedMemo
      || options.sharedMemoFallback
    ).slice(0, maxSharedMemoChars);
    const notesInputSnapshot = normalizeMeetingNotesInputSnapshot(
      artifact?.notesInputSnapshot?.updatedAt ? artifact.notesInputSnapshot : job.notesInputSnapshot,
      {
        sharedMemo: sharedMemoSnapshot,
        updatedAt: normalizeText(artifact?.notesGeneratedAt || job.notesGeneratedAt || options.notesGeneratedAtFallback),
      }
    );
    return {
      artifact,
      artifactId,
      artifactRef,
      notesInputSnapshot,
      sharedMemoSnapshot,
    };
  }

  async function loadMeetingTranscriptForNotes(jobInput, createHttpError, options = {}) {
    const job = normalizeMeetingJob(jobInput);
    const { artifact, artifactId, artifactRef } = await loadMeetingArtifactSource(job, options);
    if (artifact) {
      const text = normalizeText(artifact.text);
      const segments = Array.isArray(artifact.segments) ? artifact.segments : [];
      if (text || segments.length) {
        return {
          artifact,
          artifactRef,
          transcript: {
            segments,
            text,
          },
        };
      }
    }

    const transcriptText = normalizeText(job.transcript?.text);
    const transcriptSegments = Array.isArray(job.transcript?.segments) ? job.transcript.segments : [];
    if (transcriptText || transcriptSegments.length) {
      return {
        artifact: normalizeMeetingArtifact({
          artifactId,
          createdAt: normalizeText(job.updatedAt || job.createdAt || job.queuedAt),
          deletedAt: "",
          format: "json",
          jobId: job.jobId,
          kind: "transcript",
          meetingId: job.meetingId,
          notesDegradedReason: job.notesDegradedReason,
          notes: job.meetingNotes,
          notesGeneratedAt: job.notesGeneratedAt,
          notesInputSnapshot: job.notesInputSnapshot,
          notesStatus: job.notesStatus,
          notesSchemaVersion: job.notesSchemaVersion,
          owner: job.owner,
          segments: transcriptSegments,
          sessionId: job.sessionId,
          text: transcriptText,
        }),
        artifactRef,
        transcript: {
          segments: transcriptSegments,
          text: transcriptText,
        },
      };
    }

    if (!artifactId) {
      throw createHttpError(409, "전사 원본이 아직 준비되지 않았어요.");
    }
    throw createHttpError(404, "전사 원본을 찾지 못했어요.");
  }

  return {
    loadMeetingArtifactSource,
    loadMeetingNotesSource,
    loadMeetingTranscriptForNotes,
    resolveMeetingArtifactId,
  };
}

module.exports = {
  createMeetingNotesSourceDomain,
};
