(function initProviderIdentity(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function getCurrent() {
    try {
      const auth = safeParse(global.localStorage?.getItem("auth"));
      const userInfo = safeParse(global.localStorage?.getItem("userInfo"));
      return normalizeIdentity(auth?.userInfo || auth?.data?.userInfo || auth?.data || auth || userInfo || null);
    } catch {
      return normalizeIdentity(null);
    }
  }

  function normalizeIdentity(rawIdentity) {
    const providerUserKey = namespace.session.normalizeText(rawIdentity?.userKey || "");
    const email = namespace.session.normalizeText(rawIdentity?.email || "").toLowerCase();
    const displayName = namespace.session.normalizeText(rawIdentity?.name || "");
    const numericUserId = Number.isFinite(Number(rawIdentity?.id)) ? Number(rawIdentity.id) : null;

    return {
      provider: "inova",
      available: Boolean(providerUserKey),
      providerUserKey,
      email,
      displayName,
      numericUserId,
    };
  }

  function safeParse(text) {
    try {
      return JSON.parse(String(text || ""));
    } catch {
      return null;
    }
  }

  namespace.providerIdentity = {
    getCurrent,
  };
})(globalThis);
