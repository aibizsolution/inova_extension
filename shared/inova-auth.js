(function initInovaAuth(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const REFRESH_ENDPOINT = "https://inova.incross.com/api/auth/refresh";
  const EXPIRY_BUFFER_SECONDS = 45;

  let tokenCache = {
    accessToken: "",
    expiresAt: 0,
  };

  async function getAccessToken(forceRefresh = false) {
    if (!forceRefresh && tokenCache.accessToken && tokenCache.expiresAt - EXPIRY_BUFFER_SECONDS > getNowSeconds()) {
      return tokenCache.accessToken;
    }

    const response = await global.fetch(REFRESH_ENDPOINT, {
      credentials: "include",
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("i-Nova 인증 갱신에 실패했어요.");
    }

    const payload = await response.json().catch(() => null);
    const accessToken = namespace.session.normalizeText(payload?.data?.tokens?.accessToken || "");
    if (!accessToken) {
      throw new Error("i-Nova access token을 가져오지 못했어요.");
    }

    tokenCache = {
      accessToken,
      expiresAt: decodeTokenExpiry(accessToken),
    };

    return accessToken;
  }

  function clearAccessToken() {
    tokenCache = {
      accessToken: "",
      expiresAt: 0,
    };
  }

  function decodeTokenExpiry(accessToken) {
    try {
      const [, payload] = String(accessToken || "").split(".");
      if (!payload) {
        return 0;
      }

      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const decoded = JSON.parse(global.atob(padded));
      return Number(decoded?.exp) || 0;
    } catch {
      return 0;
    }
  }

  function getNowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  namespace.inovaAuth = {
    clearAccessToken,
    getAccessToken,
  };
})(globalThis);
