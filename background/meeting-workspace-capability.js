(function initMeetingWorkspaceCapability(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const INOVA_ORIGIN = "https://inova.incross.com";
  const browserCapability = namespace.browserCapability || {};
  const functionsRuntimeConfig = namespace.functionsRuntimeConfig || {};
  const meetingConfig = namespace.firebaseConfig.meeting;
  const normalizeProviderIdentity = typeof namespace.providerIdentityCache?.normalizeProviderIdentity === "function"
    ? namespace.providerIdentityCache.normalizeProviderIdentity
    : (providerIdentity) => providerIdentity && typeof providerIdentity === "object" ? { ...providerIdentity } : {};
  const HOSTED_MEETING_ALLOWED_ORIGINS = new Set(namespace.productLane?.getKnownHostingOrigins?.() || [
    "https://browser-extension-main.web.app",
    "https://browser-extension-v2.web.app",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
  ]);

  async function openWorkspace(input, providerIdentity, sender) {
    return openHostedMeetingPage("create", input, providerIdentity, sender);
  }

  async function openResult(input, providerIdentity, sender) {
    return openHostedMeetingPage("detail", input, providerIdentity, sender);
  }

  async function authorizeWorkspaceAccess(input, providerIdentity, sender) {
    try {
      const owner = await resolveMeetingProviderIdentity(providerIdentity);
      const accessToken = await global.getInovaAccessToken();
      const functionsConfig = await getMeetingFunctionsConfig();
      if (!namespace.session.normalizeText(accessToken)) {
        return buildMeetingWorkspaceBlockedAuthPayload(input, owner, "login-required", {
          extensionBridge: "connected",
          inovaLogin: false,
        });
      }
      if (!namespace.session.normalizeText(owner?.providerUserKey)) {
        return buildMeetingWorkspaceBlockedAuthPayload(input, owner, "identity-required", {
          extensionBridge: "connected",
          inovaLogin: true,
        });
      }
      const payload = await namespace.cloudApi.authorizeInovaMeetingWorkspaceAccess({
        debugAuthBypass: namespace.session.normalizeText(input?.debugAuthBypass),
        jobId: namespace.session.normalizeText(input?.jobId),
        meetingId: namespace.session.normalizeText(input?.meetingId),
        shareToken: namespace.session.normalizeText(input?.shareToken || input?.share),
      }, owner, accessToken, { functionsConfig });
      return {
        ...payload,
        extensionBridge: "connected",
        inovaLogin: payload?.inovaLogin !== false,
        senderUrl: namespace.session.normalizeText(sender?.url),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (looksLikeMeetingLoginError(message)) {
        return buildMeetingWorkspaceBlockedAuthPayload(input, providerIdentity, "login-required", {
          extensionBridge: "connected",
          inovaLogin: false,
        });
      }
      if (looksLikeMeetingIdentityError(message)) {
        return buildMeetingWorkspaceBlockedAuthPayload(input, providerIdentity, "identity-required", {
          extensionBridge: "connected",
          inovaLogin: true,
        });
      }
      throw error;
    }
  }

  async function createShareLink(input, providerIdentity, sender) {
    const owner = await resolveMeetingProviderIdentity(providerIdentity);
    const accessToken = await global.getInovaAccessToken();
    const functionsConfig = await getMeetingFunctionsConfig();
    const payload = await namespace.cloudApi.createInovaMeetingShareLink({
      jobId: namespace.session.normalizeText(input?.jobId),
      meetingId: namespace.session.normalizeText(input?.meetingId),
    }, owner, accessToken, { functionsConfig });
    return {
      ...payload,
      shareUrl: await buildHostedMeetingCleanUrl({
        jobId: namespace.session.normalizeText(input?.jobId),
        meetingId: namespace.session.normalizeText(input?.meetingId),
        shareToken: namespace.session.normalizeText(payload?.shareToken),
      }),
      senderUrl: namespace.session.normalizeText(sender?.url),
    };
  }

  async function revokeShareLink(input, providerIdentity, sender) {
    const owner = await resolveMeetingProviderIdentity(providerIdentity);
    const accessToken = await global.getInovaAccessToken();
    const functionsConfig = await getMeetingFunctionsConfig();
    const payload = await namespace.cloudApi.revokeInovaMeetingShareLink({
      jobId: namespace.session.normalizeText(input?.jobId),
      meetingId: namespace.session.normalizeText(input?.meetingId),
    }, owner, accessToken, { functionsConfig });
    return {
      ...payload,
      senderUrl: namespace.session.normalizeText(sender?.url),
    };
  }

  async function probeWorkspaceBridge(sender) {
    const senderUrl = namespace.session.normalizeText(sender?.url);
    const cookie = await chrome.cookies.get({
      name: "accessToken",
      url: INOVA_ORIGIN,
    }).catch(() => null);
    const accessTokenCookiePresent = Boolean(namespace.session.normalizeText(cookie?.value));

    return {
      accessTokenCookiePresent,
      inovaLoggedIn: accessTokenCookiePresent,
      loginCheckMode: "cookie-only",
      senderUrl,
      tokenRefreshError: "",
      tokenRefreshOk: false,
      tokenRefreshSkipped: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  async function getMeetingFunctionsConfig() {
    const runtimeConfig = await getMeetingRuntimeConfig();
    return runtimeConfig?.functions || {};
  }

  function isHostedWorkspaceSender(sender) {
    try {
      const url = new URL(String(sender?.url || ""));
      return HOSTED_MEETING_ALLOWED_ORIGINS.has(url.origin)
        && /\/meeting\/index\.html$/i.test(String(url.pathname || ""));
    } catch (error) {
      void error;
      return false;
    }
  }

  async function openHostedMeetingPage(mode, input, providerIdentity, sender) {
    try {
      const owner = await resolveMeetingProviderIdentity(providerIdentity);
      const meetingId = namespace.session.normalizeText(input?.meetingId) || buildMeetingId();
      const jobId = namespace.session.normalizeText(input?.jobId);
      const finalUrl = await buildHostedMeetingCleanUrl({
        jobId,
        meetingId,
      });
      logMeetingDebug("open.start", {
        input: input || {},
        mode,
        providerUserKey: owner.providerUserKey,
        senderTabId: Number(sender?.tab?.id) || 0,
        senderTitle: namespace.session.normalizeText(sender?.tab?.title),
        senderUrl: namespace.session.normalizeText(sender?.url),
      });
      logMeetingDebug("tabs.create", {
        finalUrl,
        hasWorkspaceHash: String(finalUrl || "").includes("#ws="),
        meetingId,
        mode,
      });
      const opened = await browserCapability.openUrl(finalUrl);
      logMeetingDebug("open.success", {
        finalUrl,
        meetingId,
        mode,
        tabId: Number(opened?.tabId) || 0,
      });
      return {
        expiresAt: "",
        meeting: {
          meetingId,
          title: namespace.session.normalizeText(input?.title || sender?.tab?.title) || "새 회의 룸",
        },
        opened: true,
        tabId: Number(opened?.tabId) || 0,
        url: finalUrl,
      };
    } catch (error) {
      logMeetingDebug("open.error", {
        error: error instanceof Error ? error.message : String(error || ""),
        mode,
      });
      throw error;
    }
  }

  async function buildHostedMeetingCleanUrl(input) {
    const normalizedSettings = await reconcileMeetingWorkspaceSettings((await namespace.storage.getState())?.settings);
    const url = new URL(await resolveMeetingWorkspacePageUrl());
    if (normalizedSettings.meetingDebugConsoleEnabled) url.searchParams.set("debug", "1");
    const meetingId = namespace.session.normalizeText(input?.meetingId);
    const jobId = namespace.session.normalizeText(input?.jobId);
    const shareToken = namespace.session.normalizeText(input?.shareToken || input?.share);
    if (meetingId) url.searchParams.set("meetingId", meetingId);
    if (jobId) url.searchParams.set("jobId", jobId);
    if (shareToken) url.searchParams.set("share", shareToken);
    return url.toString();
  }

  function buildShareUrl(input) {
    return buildHostedMeetingCleanUrl(input);
  }

  async function resolveMeetingWorkspacePageUrl() {
    const runtimeConfig = await getMeetingRuntimeConfig();
    const url = namespace.session.normalizeText(runtimeConfig?.hosting?.meetingWorkspaceUrl) || namespace.firebaseConfig?.hosting?.meetingWorkspaceUrl;
    logMeetingDebug("workspace.target", {
      functionsBaseUrl: namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl),
      target: namespace.session.normalizeText(runtimeConfig?.target) || "production",
      url,
    });
    return url;
  }

  async function getMeetingRuntimeConfig() {
    return functionsRuntimeConfig.getMeetingRuntimeConfig?.() || {
      hosting: namespace.firebaseConfig?.hosting || {},
      target: "production",
    };
  }

  async function reconcileMeetingWorkspaceSettings(settings) {
    if (typeof functionsRuntimeConfig.reconcileSettings === "function") {
      return functionsRuntimeConfig.reconcileSettings(settings);
    }
    const currentSettings = settings && typeof settings === "object" ? settings : {};
    return meetingConfig.normalizeSettings(currentSettings);
  }

  function buildMeetingId() {
    const partA = Date.now().toString(36);
    const partB = Math.random().toString(36).slice(2, 8);
    return `meeting-${partA}-${partB}`;
  }

  function buildMeetingWorkspaceBlockedAuthPayload(input, viewer, reason, options = {}) {
    return {
      accessDecision: "denied",
      accessMode: "blocked",
      bypassApplied: false,
      bypassMode: "",
      extensionBridge: namespace.session.normalizeText(options?.extensionBridge) || "connected",
      firebaseCustomToken: "",
      inovaLogin: options?.inovaLogin !== false,
      meetingDocumentId: "",
      meetingId: namespace.session.normalizeText(input?.meetingId),
      readOnly: false,
      reason: namespace.session.normalizeText(reason),
      shareId: "",
      viewer: {
        displayName: namespace.session.normalizeText(viewer?.displayName),
        email: namespace.session.normalizeText(viewer?.email),
        providerUserKey: namespace.session.normalizeText(viewer?.providerUserKey),
      },
    };
  }

  function looksLikeMeetingLoginError(message) {
    const normalized = namespace.session.normalizeText(message).toLowerCase();
    return normalized.includes("로그인")
      || normalized.includes("access token")
      || normalized.includes("refresh")
      || normalized.includes("unauth")
      || normalized.includes("401")
      || normalized.includes("403");
  }

  function looksLikeMeetingIdentityError(message) {
    const normalized = namespace.session.normalizeText(message).toLowerCase();
    return normalized.includes("사용자 키")
      || normalized.includes("provideruserkey")
      || normalized.includes("provider user key");
  }

  function logMeetingDebug() {
    return;
  }

  function warnMeetingProviderIdentityStorage(operation, error) {
    console.warn("[i-Nova Service Worker] meeting provider identity storage failed", {
      error: error instanceof Error ? error.message : String(error || ""),
      operation: namespace.session.normalizeText(operation),
    });
  }

  async function resolveMeetingProviderIdentity(providerIdentity) {
    const normalized = normalizeProviderIdentity(providerIdentity);
    if (normalized.providerUserKey) {
      await persistMeetingProviderIdentity(normalized);
      return normalized;
    }
    const persisted = await loadStoredMeetingProviderIdentity();
    if (persisted.providerUserKey) {
      return persisted;
    }
    const activeInovaIdentity = await requestMeetingProviderIdentityFromInovaTabs();
    return activeInovaIdentity.providerUserKey ? activeInovaIdentity : normalized;
  }

  async function loadStoredMeetingProviderIdentity() {
    try {
      if (typeof namespace.storage.getProviderIdentityCacheState === "function") {
        const providerIdentityCache = await namespace.storage.getProviderIdentityCacheState();
        return normalizeProviderIdentity(providerIdentityCache?.providerIdentity);
      }
      const storageState = await namespace.storage.getState();
      return normalizeProviderIdentity(storageState?.providerIdentityCache?.providerIdentity);
    } catch (error) {
      warnMeetingProviderIdentityStorage("load", error);
      return normalizeProviderIdentity(null);
    }
  }

  async function persistMeetingProviderIdentity(providerIdentity) {
    const normalized = normalizeProviderIdentity(providerIdentity);
    if (
      !normalized.providerUserKey
      || typeof namespace.storage.getProviderIdentityCacheState !== "function"
      || typeof namespace.storage.setProviderIdentityCacheState !== "function"
    ) {
      return normalized;
    }
    try {
      const current = await namespace.storage.getProviderIdentityCacheState();
      const currentIdentity = normalizeProviderIdentity(current?.providerIdentity);
      if (
        currentIdentity.providerUserKey === normalized.providerUserKey
        && currentIdentity.email === normalized.email
        && currentIdentity.displayName === normalized.displayName
        && currentIdentity.numericUserId === normalized.numericUserId
      ) {
        return normalized;
      }
      await namespace.storage.setProviderIdentityCacheState({
        ...(current && typeof current === "object" ? current : {}),
        providerIdentity: {
          ...currentIdentity,
          ...normalized,
          available: true,
        },
      });
    } catch (error) {
      warnMeetingProviderIdentityStorage("persist", error);
    }
    return normalized;
  }

  async function requestMeetingProviderIdentityFromInovaTabs() {
    if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) {
      return normalizeProviderIdentity(null);
    }
    let tabs;
    try {
      tabs = await chrome.tabs.query({ url: `${INOVA_ORIGIN}/*` });
    } catch (error) {
      void error;
      return normalizeProviderIdentity(null);
    }
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      const tabId = Number(tab?.id) || 0;
      if (!tabId) continue;
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "inova-meeting:get-provider-identity",
        });
        const normalized = normalizeProviderIdentity(response?.providerIdentity);
        if (normalized.providerUserKey) {
          await persistMeetingProviderIdentity(normalized);
          return normalized;
        }
      } catch (error) {
        void error;
      }
    }
    return normalizeProviderIdentity(null);
  }

  namespace.meetingWorkspaceCapability = {
    authorizeWorkspaceAccess,
    buildShareUrl,
    createShareLink,
    getMeetingFunctionsConfig,
    isHostedWorkspaceSender,
    openResult,
    openWorkspace,
    probeWorkspaceBridge,
    reconcileSettings: reconcileMeetingWorkspaceSettings,
    revokeShareLink,
  };
})(globalThis);
