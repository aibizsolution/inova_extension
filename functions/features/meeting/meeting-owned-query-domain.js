function createMeetingOwnedQueryDomain(deps) {
  const {
    buildMeetingDocId,
    compareMeetings,
    db,
    jobCollection,
    meetingCollection,
    normalizeMeetingJob,
    normalizeMeetingSummary,
    normalizeText,
  } = deps;

  async function loadOwnedMeetingJobs(owner, meetingId) {
    const collection = db.collection(jobCollection);
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    if (typeof collection.where === "function") {
      const snapshot = await collection
        .where("owner.providerUserKey", "==", owner.providerUserKey)
        .where("meetingId", "==", normalizedMeetingId)
        .get();
      return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingJob(doc.data()))
        .filter((job) => normalizeText(job.owner?.providerUserKey) === owner.providerUserKey)
        .filter((job) => normalizeText(job.meetingId) === normalizedMeetingId);
    }
    if (typeof collection.get === "function") {
      const snapshot = await collection.get();
      return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingJob(doc.data()))
        .filter((job) => normalizeText(job.owner?.providerUserKey) === owner.providerUserKey)
        .filter((job) => normalizeText(job.meetingId) === normalizedMeetingId);
    }
    return [];
  }

  async function loadOwnedMeetings(owner, limit, cursor) {
    const collection = db.collection(meetingCollection);
    const cursorId = normalizeText(cursor);
    if (typeof collection.where === "function") {
      let query = collection
        .where("owner.providerUserKey", "==", owner.providerUserKey)
        .orderBy("updatedAt", "desc")
        .limit(limit);
      if (cursorId && typeof query.startAfter === "function") {
        const cursorSnapshot = await collection.doc(buildMeetingDocId(owner.providerUserKey, cursorId)).get();
        if (cursorSnapshot?.exists) {
          query = query.startAfter(cursorSnapshot);
        }
      }
      const snapshot = await query.get();
      return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingSummary(doc.data()))
        .filter((meeting) => normalizeText(meeting.owner?.providerUserKey) === owner.providerUserKey)
        .filter((meeting) => !meeting.deletedAt);
    }

    if (typeof collection.get === "function") {
      const snapshot = await collection.get();
      const items = (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingSummary(doc.data()))
        .filter((meeting) => normalizeText(meeting.owner?.providerUserKey) === owner.providerUserKey)
        .filter((meeting) => !meeting.deletedAt)
        .sort(compareMeetings);
      if (!cursorId) {
        return items.slice(0, limit);
      }
      const cursorIndex = items.findIndex((meeting) => meeting.meetingId === cursorId);
      return (cursorIndex >= 0 ? items.slice(cursorIndex + 1) : items).slice(0, limit);
    }

    return [];
  }

  return {
    loadOwnedMeetingJobs,
    loadOwnedMeetings,
  };
}

module.exports = {
  createMeetingOwnedQueryDomain,
};
