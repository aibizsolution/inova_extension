(function initMeetingListCache(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const RECENT_MEETING_LIST_TTL_MS = 15000;

  function create(getAccessToken) {
    const activeRequests = new Map();
    const recentResults = new Map();
    return {
      async listMeetings(input, providerIdentity) {
        const cacheKey = buildCacheKey(input, providerIdentity);
        const recent = getRecent(cacheKey);
        if (recent) return recent;
        if (cacheKey && activeRequests.has(cacheKey)) {
          return activeRequests.get(cacheKey);
        }
        const request = (async () => {
          const accessToken = await getAccessToken();
          const result = await namespace.cloudApi.listInovaMeetings(input, providerIdentity, accessToken);
          if (cacheKey) {
            recentResults.set(cacheKey, {
              expiresAt: Date.now() + RECENT_MEETING_LIST_TTL_MS,
              result,
            });
          }
          return result;
        })();
        if (cacheKey) activeRequests.set(cacheKey, request);
        try {
          return await request;
        } finally {
          if (cacheKey) activeRequests.delete(cacheKey);
        }
      },
    };

    function getRecent(cacheKey) {
      if (!cacheKey) {
        return null;
      }
      const entry = recentResults.get(cacheKey);
      if (!entry || entry.expiresAt <= Date.now()) {
        recentResults.delete(cacheKey);
        return null;
      }
      return entry.result;
    }

    function buildCacheKey(input, providerIdentity) {
      const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      if (!providerUserKey) {
        return "";
      }
      const normalizedInput = input && typeof input === "object" ? input : {};
      return JSON.stringify({
        cursor: namespace.session.normalizeText(normalizedInput.cursor),
        limit: Math.max(1, Number(normalizedInput.limit) || 24),
        providerUserKey,
      });
    }
  }

  namespace.meetingListCache = {
    create,
  };
})(globalThis);
