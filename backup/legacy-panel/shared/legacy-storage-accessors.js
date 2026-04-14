(function initLegacyStorageAccessors(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  const storage = namespace.storage || {};
  const LEGACY_STORAGE_KEYS = Object.freeze({
    meetingHub: "meetingHub",
    meetingStateByMeetingId: "meetingStateByMeetingId",
    releaseInfo: "releaseInfo",
  });
  const LEGACY_MEETING_HUB_DEFAULTS = Object.freeze({
    version: 1,
    checkedAt: "",
    degraded: false,
    degradedReason: "",
    dataFreshness: "empty",
    source: "none",
    error: "",
    items: [],
  });
  const LEGACY_MEETING_STATE_DEFAULTS = Object.freeze({});
  const LEGACY_RELEASE_INFO_DEFAULTS = Object.freeze({
    version: 1,
    checkedAt: "",
    checkedForVersion: "",
    historyCheckedAt: "",
    historyCheckedForVersion: "",
    degraded: false,
    degradedReason: "",
    dataFreshness: "empty",
    source: "none",
    error: "",
    latest: null,
    history: [],
  });
  if (typeof storage.getState !== "function") {
    return;
  }

  async function getReleaseInfo() {
    const current = await readLegacyState();
    return normalizeReleaseInfoState(current.releaseInfo);
  }

  async function getMeetingHub() {
    const current = await readLegacyState();
    const nextHub = current.meetingHub && typeof current.meetingHub === "object"
      ? current.meetingHub
      : LEGACY_MEETING_HUB_DEFAULTS;
    return {
      ...cloneValue(LEGACY_MEETING_HUB_DEFAULTS),
      ...cloneValue(nextHub),
      items: Array.isArray(nextHub?.items) ? cloneValue(nextHub.items) : [],
    };
  }

  async function getMeetingStateByMeetingId() {
    const current = await readLegacyState();
    const nextState = current.meetingStateByMeetingId;
    return nextState && typeof nextState === "object"
      ? cloneValue(nextState)
      : cloneValue(LEGACY_MEETING_STATE_DEFAULTS);
  }

  async function setReleaseInfo(nextReleaseInfo) {
    const releaseInfo = normalizeReleaseInfoState(nextReleaseInfo);
    await writeLegacyState({ releaseInfo });
    return releaseInfo;
  }

  async function setMeetingHub(nextMeetingHub) {
    const meetingHub = {
      ...cloneValue(LEGACY_MEETING_HUB_DEFAULTS),
      ...(nextMeetingHub && typeof nextMeetingHub === "object" ? cloneValue(nextMeetingHub) : {}),
      items: Array.isArray(nextMeetingHub?.items) ? cloneValue(nextMeetingHub.items) : [],
    };
    await writeLegacyState({ meetingHub });
    return meetingHub;
  }

  function normalizeReleaseInfoState(nextReleaseInfo) {
    if (namespace.releaseInfo?.mergeReleaseInfo) {
      return namespace.releaseInfo.mergeReleaseInfo(nextReleaseInfo);
    }
    if (nextReleaseInfo && typeof nextReleaseInfo === "object") {
      return cloneValue(nextReleaseInfo);
    }
    return cloneValue(LEGACY_RELEASE_INFO_DEFAULTS);
  }

  async function readLegacyState() {
    if (!global.chrome?.storage?.local) {
      return {
        meetingHub: cloneValue(LEGACY_MEETING_HUB_DEFAULTS),
        meetingStateByMeetingId: cloneValue(LEGACY_MEETING_STATE_DEFAULTS),
        releaseInfo: cloneValue(LEGACY_RELEASE_INFO_DEFAULTS),
      };
    }
    const rawState = await global.chrome.storage.local.get(Object.values(LEGACY_STORAGE_KEYS));
    return {
      meetingHub: cloneValue(rawState?.[LEGACY_STORAGE_KEYS.meetingHub]),
      meetingStateByMeetingId: cloneValue(rawState?.[LEGACY_STORAGE_KEYS.meetingStateByMeetingId]),
      releaseInfo: cloneValue(rawState?.[LEGACY_STORAGE_KEYS.releaseInfo]),
    };
  }

  async function writeLegacyState(partial) {
    if (!global.chrome?.storage?.local) {
      return;
    }
    const nextPartial = {};
    if (Object.prototype.hasOwnProperty.call(partial || {}, "meetingHub")) {
      nextPartial[LEGACY_STORAGE_KEYS.meetingHub] = cloneValue(partial.meetingHub);
    }
    if (Object.prototype.hasOwnProperty.call(partial || {}, "meetingStateByMeetingId")) {
      nextPartial[LEGACY_STORAGE_KEYS.meetingStateByMeetingId] = cloneValue(partial.meetingStateByMeetingId);
    }
    if (Object.prototype.hasOwnProperty.call(partial || {}, "releaseInfo")) {
      nextPartial[LEGACY_STORAGE_KEYS.releaseInfo] = cloneValue(partial.releaseInfo);
    }
    if (Object.keys(nextPartial).length) {
      await global.chrome.storage.local.set(nextPartial);
    }
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
