(function initLegacyStorageAccessors(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  const storage = namespace.storage || {};
  if (typeof storage.getState !== "function" || typeof storage.setLocal !== "function") {
    return;
  }

  async function getReleaseInfo() {
    const current = await storage.getState();
    return normalizeReleaseInfoState(current.releaseInfo);
  }

  async function getMeetingHub() {
    const current = await storage.getState();
    const nextHub = current.meetingHub && typeof current.meetingHub === "object"
      ? current.meetingHub
      : namespace.constants?.defaults?.meetingHub;
    return {
      ...cloneValue(namespace.constants?.defaults?.meetingHub || {}),
      ...cloneValue(nextHub),
      items: Array.isArray(nextHub?.items) ? cloneValue(nextHub.items) : [],
    };
  }

  async function getMeetingStateByMeetingId() {
    const current = await storage.getState();
    const nextState = current.meetingStateByMeetingId;
    return nextState && typeof nextState === "object"
      ? cloneValue(nextState)
      : cloneValue(namespace.constants?.defaults?.meetingStateByMeetingId || {});
  }

  async function setReleaseInfo(nextReleaseInfo) {
    const releaseInfo = normalizeReleaseInfoState(nextReleaseInfo);
    await storage.setLocal({ releaseInfo });
    return releaseInfo;
  }

  async function setMeetingHub(nextMeetingHub) {
    const meetingHub = {
      ...cloneValue(namespace.constants?.defaults?.meetingHub || {}),
      ...(nextMeetingHub && typeof nextMeetingHub === "object" ? cloneValue(nextMeetingHub) : {}),
      items: Array.isArray(nextMeetingHub?.items) ? cloneValue(nextMeetingHub.items) : [],
    };
    await storage.setLocal({ meetingHub });
    return meetingHub;
  }

  function normalizeReleaseInfoState(nextReleaseInfo) {
    if (namespace.releaseInfo?.mergeReleaseInfo) {
      return namespace.releaseInfo.mergeReleaseInfo(nextReleaseInfo);
    }
    if (nextReleaseInfo && typeof nextReleaseInfo === "object") {
      return cloneValue(nextReleaseInfo);
    }
    return cloneValue(namespace.constants?.defaults?.releaseInfo || {});
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.storage = {
    ...storage,
    getMeetingHub,
    getMeetingStateByMeetingId,
    getReleaseInfo,
    setMeetingHub,
    setReleaseInfo,
  };
})(globalThis);
