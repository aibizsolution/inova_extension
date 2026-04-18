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
      const pendingKey = cacheKey || buildPanelAuthPendingKey(providerIdentity, requestOptions);
      const recent = getRecentPanelAuthResult(cache, cacheKey);
      if (recent) return recent;
      if (pendingKey && pending.has(pendingKey)) {
        return pending.get(pendingKey);
      }
      const request = (async () => {
        const accessToken = await getAccessToken();
        const result = await issuePanelAuthWithTokenRetry(issueAuth, providerIdentity, accessToken, requestOptions);
        cacheRecentPanelAuthResult(cache, cacheKey, result);
        return result;
      })();
      if (pendingKey) pending.set(pendingKey, request);
      try {
        return await request;
      } finally {
        if (pendingKey) pending.delete(pendingKey);
      }
    }

    async function issuePanelAuthWithTokenRetry(issueAuth, providerIdentity, accessToken, requestOptions) {
      try {
        return await issueAuth(providerIdentity, accessToken, requestOptions);
      } catch (error) {
        if (!shouldRetryPanelAuthWithFreshToken(error)) {
          throw error;
        }
        if (typeof namespace.inovaAuth?.clearAccessToken === "function") {
          namespace.inovaAuth.clearAccessToken();
        }
        const freshAccessToken = await getAccessToken(true);
        return issueAuth(providerIdentity, freshAccessToken, requestOptions);
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

    function buildPanelAuthPendingKey(providerIdentity, requestOptions) {
      const identityKey = namespace.session.normalizeText(
        providerIdentity?.providerUserKey
        || providerIdentity?.email
        || providerIdentity?.numericUserId
        || "anonymous"
      );
      const functionsBaseUrl = namespace.session.normalizeText(requestOptions?.functionsConfig?.baseUrl);
      return `${identityKey}::${functionsBaseUrl}`;
    }

    function resolvePanelAuthCacheExpiry(expiresAt) {
      const panelExpiry = Date.parse(namespace.session.normalizeText(expiresAt) || "") || Number.POSITIVE_INFINITY;
      return Math.min(panelExpiry - 60000, Date.now() + RECENT_PANEL_AUTH_TTL_MS);
    }

    function shouldRetryPanelAuthWithFreshToken(error) {
      const message = namespace.session.normalizeText(error?.message || error);
      return message.includes("i-Nova 세션 검증에 실패")
        || message.includes("i-Nova access token")
        || message.includes("i-Nova 인증 갱신");
    }
  }

  namespace.panelAuthCache = {
    create,
  };
})(globalThis);
