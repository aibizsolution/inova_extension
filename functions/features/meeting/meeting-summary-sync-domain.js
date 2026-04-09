function createMeetingSummarySyncDomain(deps) {
  const {
    assertMeetingOwnership,
    buildMeetingDocId,
    buildMeetingRecentJobsPatch,
    buildMeetingResultSummary,
    buildMeetingSummaryDocument,
    db,
    meetingCollection,
    mergeRecentJobs,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeMeetingSummary,
    normalizeText,
  } = deps;

  async function upsertMeetingJobSummary(meetingRef, meeting, owner, jobInput, artifactInput) {
    const job = normalizeMeetingJob(jobInput);
    if (!job.jobId || job.deletedAt) {
      return;
    }
    const snapshot = await meetingRef.get();
    const currentMeeting = snapshot.exists ? normalizeMeetingSummary(snapshot.data()) : normalizeMeetingSummary({
      meetingId: meeting.meetingId,
      owner,
    });
    if (currentMeeting.deletedAt) {
      return;
    }
    const jobSummary = buildMeetingResultSummary(job, artifactInput);
    const nextDocument = buildMeetingSummaryDocument(meeting, owner, jobSummary, currentMeeting);
    await meetingRef.set(nextDocument, { merge: true });
  }

  async function loadMeetingSummaryRecord(owner, input, createHttpError) {
    const meetingId = normalizeText(input?.meetingId);
    if (!meetingId) {
      return null;
    }
    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, meetingId));
    const snapshot = await meetingRef.get();
    if (!snapshot.exists) {
      return null;
    }
    let meeting = normalizeMeetingSummary(snapshot.data());
    if (!normalizeText(meeting.owner?.providerUserKey)) {
      await meetingRef.set({
        meetingId: meeting.meetingId || meetingId,
        owner,
      }, { merge: true });
      meeting = normalizeMeetingSummary({
        ...meeting,
        meetingId: meeting.meetingId || meetingId,
        owner,
      });
    }
    assertMeetingOwnership(meeting, owner, createHttpError);
    if (meeting.deletedAt) {
      return null;
    }
    return {
      meeting,
      recentJobs: Array.isArray(meeting.recentJobs) ? meeting.recentJobs : [],
    };
  }

  async function assertMeetingIsActive(owner, meetingId, createHttpError) {
    if (!meetingId) {
      return;
    }
    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, meetingId));
    const snapshot = await meetingRef.get();
    if (!snapshot.exists) {
      return;
    }
    const meeting = normalizeMeetingSummary(snapshot.data());
    assertMeetingOwnership(meeting, owner, createHttpError);
    if (meeting.deletedAt) {
      throw createHttpError(404, "삭제된 회의예요.");
    }
  }

  async function updateMeetingSummaryRecordResult(owner, jobInput, artifactInput, updatedAtInput) {
    const job = normalizeMeetingJob(jobInput);
    if (!job.jobId || job.deletedAt) {
      return;
    }
    const artifact = artifactInput ? normalizeMeetingArtifact(artifactInput) : null;
    const updatedAt = normalizeText(updatedAtInput || artifact?.notesGeneratedAt || job.updatedAt || new Date().toISOString());
    const summaryItem = buildMeetingResultSummary(job, artifact);

    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, job.meetingId));
    const meetingSnapshot = await meetingRef.get();
    if (meetingSnapshot.exists) {
      const currentMeeting = normalizeMeetingSummary(meetingSnapshot.data());
      const recentJobs = mergeRecentJobs(currentMeeting.recentJobs, summaryItem);
      await meetingRef.set(buildMeetingRecentJobsPatch(currentMeeting, recentJobs, updatedAt), { merge: true });
    }
  }

  async function removeMeetingResultFromSummaries(owner, jobInput, deletedAt) {
    const job = normalizeMeetingJob(jobInput);
    const meetingRef = db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, job.meetingId));
    let nextMeeting = normalizeMeetingSummary({
      meetingId: job.meetingId,
      owner,
      title: job.meeting.title,
      updatedAt: deletedAt,
    });

    const meetingSnapshot = await meetingRef.get();
    if (meetingSnapshot.exists) {
      const currentMeeting = normalizeMeetingSummary(meetingSnapshot.data());
      const recentJobs = currentMeeting.recentJobs.filter((item) => item.jobId !== job.jobId);
      nextMeeting = normalizeMeetingSummary({
        ...currentMeeting,
        ...buildMeetingRecentJobsPatch(currentMeeting, recentJobs, deletedAt),
      });
      await meetingRef.set(buildMeetingRecentJobsPatch(currentMeeting, recentJobs, deletedAt), { merge: true });
    }

    return nextMeeting;
  }

  return {
    assertMeetingIsActive,
    loadMeetingSummaryRecord,
    removeMeetingResultFromSummaries,
    updateMeetingSummaryRecordResult,
    upsertMeetingJobSummary,
  };
}

module.exports = {
  createMeetingSummarySyncDomain,
};
