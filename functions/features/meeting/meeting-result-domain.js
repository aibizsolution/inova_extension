function createMeetingResultDomain(deps) {
  const {
    artifactCollection,
    assertJobOwnership,
    assertMeetingIsActive,
    assertMeetingOwnership,
    buildMeetingDocId,
    buildMeetingRecentJobsPatch,
    buildMeetingResultSummary,
    buildWorkspaceMutation,
    createHttpError,
    db,
    jobCollection,
    loadMeetingNotesSource,
    meetingCollection,
    mergeRecentJobs,
    normalizeMeetingArtifact,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingNotesInputSnapshot,
    normalizeMeetingSummary,
    normalizeText,
    updateMeetingSummaryRecordResult,
  } = deps;

  async function updateMeetingResult(input, owner) {
    const source = await loadMeetingResultMutationSource(input, owner);
    const updatedAt = new Date().toISOString();
    const mutationType = input.titleProvided
      ? "saveRecordTitle"
      : "saveRecordMemo";
    const workspaceMutation = buildWorkspaceMutation({
      completedAt: updatedAt,
      requestId: input.clientRequestId,
      requestedAt: updatedAt,
      status: "succeeded",
      type: mutationType,
    });
    const persistedSharedMemo = input.sharedMemoProvided
      ? input.sharedMemo
      : source.currentSharedMemoSnapshot;
    const shouldInitializeNotesInputSnapshot = !normalizeText(source.existingNotesInputSnapshot.updatedAt)
      && Boolean(normalizeText(source.artifact?.notesGeneratedAt || source.job.notesGeneratedAt));
    const baselineNotesInputSnapshot = shouldInitializeNotesInputSnapshot
      ? normalizeMeetingNotesInputSnapshot({
          sharedMemo: source.currentSharedMemoSnapshot,
          updatedAt: normalizeText(source.artifact?.notesGeneratedAt || source.job.notesGeneratedAt || source.job.updatedAt || updatedAt),
        })
      : source.existingNotesInputSnapshot;
    const nextContext = normalizeMeetingContext({
      ...source.job.context,
      sharedMemoSnapshot: persistedSharedMemo,
    });
    const jobPatch = {};
    if (input.titleProvided) {
      jobPatch.title = input.title;
      jobPatch.updatedAt = updatedAt;
    }
    if (input.sharedMemoProvided) {
      jobPatch.context = nextContext;
      jobPatch.updatedAt = updatedAt;
    }
    if (shouldInitializeNotesInputSnapshot) {
      jobPatch.notesInputSnapshot = baselineNotesInputSnapshot;
    }
    if (workspaceMutation.requestId) {
      jobPatch.workspaceMutation = workspaceMutation;
    }
    const artifactPatch = {};
    if (shouldInitializeNotesInputSnapshot) {
      artifactPatch.notesInputSnapshot = baselineNotesInputSnapshot;
    }

    const nextJob = normalizeMeetingJob({
      ...source.job,
      ...jobPatch,
    });
    const nextArtifact = source.artifact
      ? normalizeMeetingArtifact({
          ...source.artifact,
          ...artifactPatch,
        })
      : null;

    const writes = [];
    if (Object.keys(jobPatch).length) {
      writes.push(source.jobRef.set(jobPatch, { merge: true }));
    }
    if (source.artifactRef && Object.keys(artifactPatch).length) {
      writes.push(source.artifactRef.set(artifactPatch, { merge: true }));
    }
    if (writes.length) {
      await Promise.all(writes);
      await updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, updatedAt);
    }

    return {
      jobId: source.job.jobId,
      meetingId: source.job.meetingId,
      requestId: input.clientRequestId,
    };
  }

  async function moveMeetingResult(input, owner) {
    const jobRef = db.collection(jobCollection).doc(input.jobId);
    const sourceMeetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, input.meetingId));
    const targetMeetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, input.targetMeetingId));
    const movedAt = new Date().toISOString();
    const result = await db.runTransaction(async (transaction) => {
      const [jobSnapshot, sourceMeetingSnapshot, targetMeetingSnapshot] = await Promise.all([
        transaction.get(jobRef),
        transaction.get(sourceMeetingRef),
        transaction.get(targetMeetingRef),
      ]);

      if (!jobSnapshot.exists) {
        throw createHttpError(404, "이동할 회의 결과를 찾지 못했어요.");
      }
      if (!sourceMeetingSnapshot.exists) {
        throw createHttpError(404, "현재 회의 룸을 찾지 못했어요.");
      }
      if (!targetMeetingSnapshot.exists) {
        throw createHttpError(404, "이동할 회의 룸을 찾지 못했어요.");
      }

      const rawJobData = jobSnapshot.data();
      const persistedJobTitle = normalizeText(rawJobData?.title);
      const job = normalizeMeetingJob(rawJobData);
      const sourceMeeting = normalizeMeetingSummary(sourceMeetingSnapshot.data());
      const targetMeeting = normalizeMeetingSummary(targetMeetingSnapshot.data());

      assertJobOwnership(job, owner, createHttpError);
      assertMeetingOwnership(sourceMeeting, owner, createHttpError);
      assertMeetingOwnership(targetMeeting, owner, createHttpError);

      if (job.deletedAt) {
        throw createHttpError(404, "이미 삭제된 회의 결과예요.");
      }
      if (job.meetingId !== input.meetingId) {
        throw createHttpError(404, "현재 회의와 맞지 않는 결과예요.");
      }
      if (job.status !== "succeeded") {
        throw createHttpError(409, "완료된 기록만 이동할 수 있어요.");
      }
      if (sourceMeeting.deletedAt) {
        throw createHttpError(404, "현재 회의 룸을 더 이상 찾을 수 없어요.");
      }
      if (targetMeeting.deletedAt) {
        throw createHttpError(404, "이동할 회의 룸이 이미 삭제되었어요.");
      }

      const artifactId = normalizeText(job.transcript?.artifactId || job.artifacts?.[0]?.artifactId);
      const artifactRef = artifactId ? db.collection(artifactCollection).doc(artifactId) : null;
      const artifactSnapshot = artifactRef ? await transaction.get(artifactRef) : null;
      const artifact = artifactSnapshot?.exists ? normalizeMeetingArtifact(artifactSnapshot.data()) : null;
      const sourceSummaryItem = sourceMeeting.recentJobs.find((item) => normalizeText(item.jobId) === job.jobId) || null;
      const notesTitle = normalizeText(artifact?.notes?.meetingMeta?.title || job.meetingNotes?.meetingMeta?.title);
      const materializedTitle = normalizeText(
        persistedJobTitle
        || sourceSummaryItem?.title
        || notesTitle
        || job.meeting?.title
        || sourceMeeting.title
        || targetMeeting.title
        || "새 기록"
      );
      const workspaceMutation = buildWorkspaceMutation({
        completedAt: movedAt,
        requestId: input.clientRequestId,
        requestedAt: movedAt,
        status: "succeeded",
        type: "moveRecord",
      });
      const nextJobPatch = {
        meeting: {
          ...job.meeting,
          meetingId: input.targetMeetingId,
          title: targetMeeting.title,
        },
        meetingId: input.targetMeetingId,
        title: materializedTitle,
        updatedAt: movedAt,
        ...(workspaceMutation.requestId ? { workspaceMutation } : {}),
      };
      const nextJob = normalizeMeetingJob({
        ...job,
        ...nextJobPatch,
        meeting: {
          ...job.meeting,
          meetingId: input.targetMeetingId,
          title: targetMeeting.title,
        },
      });
      const nextArtifactPatch = artifact
        ? {
            meetingId: input.targetMeetingId,
          }
        : null;
      const nextArtifact = artifact
        ? normalizeMeetingArtifact({
            ...artifact,
            meetingId: input.targetMeetingId,
          })
        : null;
      const movedSummary = buildMeetingResultSummary(nextJob, nextArtifact);
      const nextSourceRecentJobs = sourceMeeting.recentJobs.filter((item) => normalizeText(item.jobId) !== job.jobId);
      const nextTargetRecentJobs = mergeRecentJobs(targetMeeting.recentJobs, movedSummary);

      transaction.set(jobRef, nextJobPatch, { merge: true });
      if (artifactRef && nextArtifactPatch) {
        transaction.set(artifactRef, nextArtifactPatch, { merge: true });
      }
      transaction.set(sourceMeetingRef, {
        ...buildMeetingRecentJobsPatch(sourceMeeting, nextSourceRecentJobs, movedAt),
        meetingId: sourceMeeting.meetingId || input.meetingId,
      }, { merge: true });
      transaction.set(targetMeetingRef, {
        ...buildMeetingRecentJobsPatch(targetMeeting, nextTargetRecentJobs, movedAt),
        meetingId: targetMeeting.meetingId || input.targetMeetingId,
      }, { merge: true });

      return {
        artifactId,
        jobId: job.jobId,
        meetingId: input.meetingId,
        requestId: input.clientRequestId,
        targetMeetingId: input.targetMeetingId,
      };
    });

    return result;
  }

  async function loadMeetingResultMutationSource(input, owner) {
    const jobRef = db.collection(jobCollection).doc(input.jobId);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      throw createHttpError(404, "수정할 회의 결과를 찾지 못했어요.");
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
      notesInputSnapshot: existingNotesInputSnapshot,
      sharedMemoSnapshot: currentSharedMemoSnapshot,
    } = await loadMeetingNotesSource(job);
    return {
      artifact,
      artifactRef,
      currentSharedMemoSnapshot,
      existingNotesInputSnapshot,
      job,
      jobRef,
    };
  }

  return {
    moveMeetingResult,
    updateMeetingResult,
  };
}

module.exports = {
  createMeetingResultDomain,
};
