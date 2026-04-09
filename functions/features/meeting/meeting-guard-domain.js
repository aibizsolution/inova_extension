function createMeetingGuardDomain(deps) {
  const {
    normalizeText,
  } = deps;

  function shouldSyncMeetingTitleToResult(item, previousTitle) {
    const title = normalizeText(item?.title);
    const normalizedPrevious = normalizeText(previousTitle);
    return !title || title === normalizedPrevious;
  }

  function assertJobOwnership(job, owner, createHttpError) {
    if (normalizeText(job.owner?.providerUserKey) !== normalizeText(owner?.providerUserKey)) {
      throw createHttpError(403, "현재 사용자에게 허용되지 않은 회의 job이에요.");
    }
  }

  function assertMeetingOwnership(meeting, owner, createHttpError) {
    const storedOwnerKey = normalizeText(meeting.owner?.providerUserKey);
    if (storedOwnerKey && storedOwnerKey !== normalizeText(owner?.providerUserKey)) {
      throw createHttpError(403, "현재 사용자에게 허용되지 않은 회의예요.");
    }
  }

  return {
    assertJobOwnership,
    assertMeetingOwnership,
    shouldSyncMeetingTitleToResult,
  };
}

module.exports = {
  createMeetingGuardDomain,
};
