(function initPanelAuthCache(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const RECENT_PANEL_AUTH_TTL_MS = 50 * 60 * 1000;

  function create(getAccessToken) {
    const recentMeetingPanelAuthResults = new Map();
    const pendingMeetingPanelAuthRequests = new Map();
    const recentPromptPanelAuthResults = new Map();
    const pendingPromptPanelAuthRequests = new Map();
    return {
      issueMeetingPanelAuth(providerIdentity) {
        return issuePanelAuth(
          recentMeetingPanelAuthResults,
          pendingMeetingPanelAuthRequests,
          providerIdentity,
          namespace.cloudApi.issueInovaMeetingPanelAuth
        );
      },
      issuePromptPanelAuth(providerIdentity) {
        return issuePanelAuth(
          recentPromptPanelAuthResults,
          pendingPromptPanelAuthRequests,
          providerIdentity,
          namespace.cloudApi.issueInovaPromptPanelAuth
        );
      },
    };

    async function issuePanelAuth(cache, pending, providerIdentity, issueAuth) {
      const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      const recent = getRecentPanelAuthResult(cache, providerUserKey);
      if (recent) return recent;
      if (providerUserKey && pending.has(providerUserKey)) {
        return pending.get(providerUserKey);
      }
      const request = (async () => {
        const accessToken = await getAccessToken();
        const result = await issueAuth(providerIdentity, accessToken);
        cacheRecentPanelAuthResult(cache, providerUserKey, result);
        return result;
      })();
      if (providerUserKey) pending.set(providerUserKey, request);
      try {
        return await request;
      } finally {
        if (providerUserKey) pending.delete(providerUserKey);
      }
    }

    function getRecentPanelAuthResult(cache, providerUserKey) {
      const key = namespace.session.normalizeText(providerUserKey);
      const entry = key ? cache.get(key) : null;
      if (!entry || entry.expiresAt <= Date.now()) {
        if (key) cache.delete(key);
        return null;
      }
      return entry.result;
    }

    function cacheRecentPanelAuthResult(cache, providerUserKey, result) {
      const key = namespace.session.normalizeText(providerUserKey);
      const expiryTime = resolvePanelAuthCacheExpiry(result?.expiresAt);
      if (!key || !result || expiryTime <= Date.now()) {
        if (key) cache.delete(key);
        return;
      }
      cache.set(key, { expiresAt: expiryTime, result });
    }

    function resolvePanelAuthCacheExpiry(expiresAt) {
      const panelExpiry = Date.parse(namespace.session.normalizeText(expiresAt) || "") || Number.POSITIVE_INFINITY;
      return Math.min(panelExpiry - 60000, Date.now() + RECENT_PANEL_AUTH_TTL_MS);
    }
  }

  namespace.panelAuthCache = {
    create,
  };
})(globalThis);
