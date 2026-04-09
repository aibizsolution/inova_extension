(function initPanelAuthCache(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const RECENT_PANEL_AUTH_TTL_MS = 50 * 60 * 1000;

  function create(getAccessToken) {
    const recentMeetingPanelAuthResults = new Map();
    const pendingMeetingPanelAuthRequests = new Map();
    const recentPromptPanelAuthResults = new Map();
    const pendingPromptPanelAuthRequests = new Map();
    return {
      issueMeetingPanelAuth(providerIdentity, requestOptions = {}) {
        return issuePanelAuth(
          recentMeetingPanelAuthResults,
          pendingMeetingPanelAuthRequests,
          providerIdentity,
          namespace.cloudApi.issueInovaMeetingPanelAuth,
          requestOptions
        );
      },
      issuePromptPanelAuth(providerIdentity, requestOptions = {}) {
        return issuePanelAuth(
          recentPromptPanelAuthResults,
          pendingPromptPanelAuthRequests,
          providerIdentity,
          namespace.cloudApi.issueInovaPromptPanelAuth,
          requestOptions
        );
      },
    };

    async function issuePanelAuth(cache, pending, providerIdentity, issueAuth, requestOptions) {
      const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      const cacheKey = buildPanelAuthCacheKey(providerUserKey, requestOptions);
      const recent = getRecentPanelAuthResult(cache, cacheKey);
      if (recent) return recent;
      if (cacheKey && pending.has(cacheKey)) {
        return pending.get(cacheKey);
      }
      const request = (async () => {
        const accessToken = await getAccessToken();
        const result = await issueAuth(providerIdentity, accessToken, requestOptions);
        cacheRecentPanelAuthResult(cache, cacheKey, result);
        return result;
      })();
      if (cacheKey) pending.set(cacheKey, request);
      try {
        return await request;
      } finally {
        if (cacheKey) pending.delete(cacheKey);
      }
    }

    function getRecentPanelAuthResult(cache, cacheKey) {
      const key = namespace.session.normalizeText(cacheKey);
      const entry = key ? cache.get(key) : null;
      if (!entry || entry.expiresAt <= Date.now()) {
        if (key) cache.delete(key);
        return null;
      }
      return entry.result;
    }

    function cacheRecentPanelAuthResult(cache, cacheKey, result) {
      const key = namespace.session.normalizeText(cacheKey);
      const expiryTime = resolvePanelAuthCacheExpiry(result?.expiresAt);
      if (!key || !result || expiryTime <= Date.now()) {
        if (key) cache.delete(key);
        return;
      }
      cache.set(key, { expiresAt: expiryTime, result });
    }

    function buildPanelAuthCacheKey(providerUserKey, requestOptions) {
      const normalizedProviderUserKey = namespace.session.normalizeText(providerUserKey);
      if (!normalizedProviderUserKey) {
        return "";
      }
      const functionsBaseUrl = namespace.session.normalizeText(requestOptions?.functionsConfig?.baseUrl);
      return `${normalizedProviderUserKey}::${functionsBaseUrl}`;
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
