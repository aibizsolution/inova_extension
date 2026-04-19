(function initAdminConsole(global) {
  const SESSION_STORAGE_KEY = "inova-admin-console-session";
  const PROJECT_ID = "browser-extension-main";
  const REGION = "asia-northeast3";
  const PRODUCTION_FUNCTIONS_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

  const state = {
    busy: false,
    error: "",
    role: "",
    sessionExpiresAt: "",
    viewer: null,
  };

  const elements = {};

  global.addEventListener("DOMContentLoaded", () => {
    bindElements();
    bindEvents();
    void boot();
  });

  async function boot() {
    renderLoading("관리자 권한을 확인하고 있습니다.");
    try {
      const params = new URLSearchParams(global.location.search);
      const launchToken = normalizeText(params.get("launch"));
      let session = loadStoredSession();
      if (launchToken) {
        session = await exchangeLaunchToken(launchToken);
        storeSession(session);
        removeLaunchParam();
      }
      if (!session?.adminSessionToken) {
        throw new Error("관리자 콘솔 세션이 없습니다. 확장 패널에서 다시 열어 주세요.");
      }
      const bootstrap = await readBootstrap(session.adminSessionToken);
      storeSession({
        ...session,
        role: bootstrap.role,
        sessionExpiresAt: bootstrap.sessionExpiresAt,
        viewer: bootstrap.viewer,
      });
      state.error = "";
      state.role = normalizeText(bootstrap.role) || "admin";
      state.sessionExpiresAt = normalizeText(bootstrap.sessionExpiresAt);
      state.viewer = normalizeViewer(bootstrap.viewer);
      renderVerified();
    } catch (error) {
      clearStoredSession();
      state.error = readErrorMessage(error);
      renderBlocked(state.error);
    }
  }

  async function refreshSession() {
    if (state.busy) {
      return;
    }
    state.busy = true;
    setRefreshBusy(true);
    try {
      const session = loadStoredSession();
      if (!session?.adminSessionToken) {
        throw new Error("관리자 콘솔 세션이 없습니다. 확장 패널에서 다시 열어 주세요.");
      }
      const bootstrap = await readBootstrap(session.adminSessionToken);
      storeSession({
        ...session,
        role: bootstrap.role,
        sessionExpiresAt: bootstrap.sessionExpiresAt,
        viewer: bootstrap.viewer,
      });
      state.error = "";
      state.role = normalizeText(bootstrap.role) || "admin";
      state.sessionExpiresAt = normalizeText(bootstrap.sessionExpiresAt);
      state.viewer = normalizeViewer(bootstrap.viewer);
      renderVerified();
    } catch (error) {
      clearStoredSession();
      state.error = readErrorMessage(error);
      renderBlocked(state.error);
    } finally {
      state.busy = false;
      setRefreshBusy(false);
    }
  }

  async function exchangeLaunchToken(launchToken) {
    const result = await postFunction("exchangeInovaAdminLaunch", {
      launchToken,
    });
    return {
      adminSessionToken: normalizeText(result.adminSessionToken),
      role: normalizeText(result.role),
      sessionExpiresAt: normalizeText(result.sessionExpiresAt),
      viewer: normalizeViewer(result.viewer),
    };
  }

  function readBootstrap(adminSessionToken) {
    return postFunction("readInovaAdminBootstrap", {}, {
      Authorization: `AdminSession ${adminSessionToken}`,
    });
  }

  async function postFunction(functionName, body, headers = {}) {
    const response = await fetch(`${resolveFunctionsBaseUrl()}/${functionName}`, {
      body: JSON.stringify(body || {}),
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(normalizeText(payload?.error?.message || payload?.message) || "관리자 요청에 실패했어요.");
    }
    return payload?.data || {};
  }

  function resolveFunctionsBaseUrl() {
    const { hostname, protocol } = global.location;
    const isLocal = protocol === "http:" && ["127.0.0.1", "localhost"].includes(normalizeText(hostname).toLowerCase());
    if (isLocal) {
      return `http://${hostname}:5001/${PROJECT_ID}/${REGION}`;
    }
    return PRODUCTION_FUNCTIONS_BASE_URL;
  }

  function loadStoredSession() {
    try {
      const raw = normalizeText(global.sessionStorage?.getItem(SESSION_STORAGE_KEY));
      if (!raw) {
        return null;
      }
      const session = JSON.parse(raw);
      if (!session || typeof session !== "object") {
        return null;
      }
      return {
        adminSessionToken: normalizeText(session.adminSessionToken),
        role: normalizeText(session.role),
        sessionExpiresAt: normalizeText(session.sessionExpiresAt),
        viewer: normalizeViewer(session.viewer),
      };
    } catch (error) {
      console.warn("[i-Nova admin] stored session reset", error);
      return null;
    }
  }

  function storeSession(session) {
    try {
      global.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        adminSessionToken: normalizeText(session?.adminSessionToken),
        role: normalizeText(session?.role),
        sessionExpiresAt: normalizeText(session?.sessionExpiresAt),
        viewer: normalizeViewer(session?.viewer),
      }));
    } catch (error) {
      console.warn("[i-Nova admin] stored session write failed", error);
    }
  }

  function clearStoredSession() {
    try {
      global.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
    } catch (error) {
      console.warn("[i-Nova admin] stored session clear failed", error);
    }
  }

  function removeLaunchParam() {
    const url = new URL(global.location.href);
    url.searchParams.delete("launch");
    global.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function bindElements() {
    [
      "blockedMessage",
      "blockedPanel",
      "blockedTitle",
      "placeholderPanel",
      "refreshButton",
      "sessionExpiresAt",
      "statusBadge",
      "statusSummary",
      "verifiedPanel",
      "viewerEmail",
      "viewerName",
      "viewerRole",
    ].forEach((id) => {
      elements[id] = global.document.getElementById(id);
    });
  }

  function bindEvents() {
    elements.refreshButton?.addEventListener("click", () => {
      void refreshSession();
    });
  }

  function renderLoading(message) {
    global.document.querySelector(".admin-shell")?.setAttribute("data-state", "loading");
    setText(elements.statusSummary, message);
    setBadge("loading", "확인 중");
    setHidden(elements.verifiedPanel, true);
    setHidden(elements.placeholderPanel, true);
    setHidden(elements.blockedPanel, true);
  }

  function renderVerified() {
    global.document.querySelector(".admin-shell")?.setAttribute("data-state", "verified");
    setText(elements.statusSummary, "권한 확인이 완료되었습니다.");
    setBadge("verified", "확인됨");
    setText(elements.viewerName, state.viewer?.displayName || state.viewer?.providerUserKey || "-");
    setText(elements.viewerEmail, state.viewer?.email || "-");
    setText(elements.viewerRole, state.role || "-");
    setText(elements.sessionExpiresAt, formatDateTime(state.sessionExpiresAt));
    setHidden(elements.verifiedPanel, false);
    setHidden(elements.placeholderPanel, false);
    setHidden(elements.blockedPanel, true);
  }

  function renderBlocked(message) {
    global.document.querySelector(".admin-shell")?.setAttribute("data-state", "blocked");
    setText(elements.statusSummary, "관리자 권한 확인이 중단되었습니다.");
    setBadge("blocked", "차단됨");
    setText(elements.blockedTitle, "관리자 권한을 확인할 수 없습니다");
    setText(elements.blockedMessage, normalizeText(message) || "확장 패널에서 관리자 메뉴를 다시 열어 주세요.");
    setHidden(elements.verifiedPanel, true);
    setHidden(elements.placeholderPanel, true);
    setHidden(elements.blockedPanel, false);
  }

  function setBadge(tone, text) {
    elements.statusBadge?.setAttribute("data-tone", tone);
    setText(elements.statusBadge, text);
  }

  function setRefreshBusy(busy) {
    if (elements.refreshButton) {
      elements.refreshButton.disabled = busy;
    }
  }

  function setHidden(element, hidden) {
    if (element) {
      element.hidden = hidden;
    }
  }

  function setText(element, text) {
    if (element) {
      element.textContent = normalizeText(text);
    }
  }

  function normalizeViewer(viewer) {
    const input = viewer && typeof viewer === "object" ? viewer : {};
    return {
      displayName: normalizeText(input.displayName),
      email: normalizeText(input.email).toLowerCase(),
      provider: normalizeText(input.provider) || "inova",
      providerUserKey: normalizeText(input.providerUserKey),
    };
  }

  function formatDateTime(value) {
    const timestamp = Date.parse(normalizeText(value));
    if (!Number.isFinite(timestamp)) {
      return "-";
    }
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  }

  function readErrorMessage(error) {
    return normalizeText(error instanceof Error ? error.message : error) || "관리자 요청에 실패했어요.";
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }
})(globalThis);
