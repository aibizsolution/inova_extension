(function initExtensionCapabilityClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PANEL_AUTH_CACHE_TTL_MS = 50 * 60 * 1000;
  const COMPATIBILITY_RUNTIME_ACTIONS = Object.freeze({
    "functions.invoke-endpoint": Object.freeze({
      owner: "runtime-platform",
      reason: "legacy hosted bundles that still send endpointKey requests",
      removeAfter: "2026-05-31",
      replacementAction: "capabilities.invoke",
    }),
  });

  function create(options = {}) {
    const invokePage = typeof options.invokePage === "function"
      ? options.invokePage
      : async () => ({});
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
    const recentPanelAuthResults = new Map();
    const pendingPanelAuthRequests = new Map();

    return {
      applyComposerText,
      clearDebugLog,
      copyDebugLog,
      createMeetingShare,
      invokeCapability,
      invokeFunctionEndpoint,
      issuePanelSession,
      jumpConversationItem,
      logTrace,
      openBrowserUrl,
      openMeetingResult,
      openMeetingWorkspace,
      readCapabilityCatalog,
      readComposerState,
      readConversationState,
      readDebugState,
      readPanelStorageState,
      revokeMeetingShare,
      setDebugEnabled,
      writeClipboardText,
      writeUiPreferences,
    };

    function applyComposerText(text, mode = "replace") {
      return invokePage({
        action: "composer.apply-text",
        mode,
        text,
      });
    }

    function clearDebugLog() {
      return invokePage({
        action: "debug.clear-log",
      });
    }

    function copyDebugLog(errorsOnly = false) {
      return invokePage({
        action: "debug.copy-log",
        errorsOnly,
      });
    }

    function createMeetingShare(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.share.create",
        input,
        providerIdentity,
      });
    }

    function invokeCapability(capabilityId, input = {}, options = {}) {
      return invokeRuntime({
        action: "capabilities.invoke",
        capabilityId,
        input,
        trace: options?.trace || null,
      });
    }

    function invokeFunctionEndpoint(request = {}) {
      const compatibility = COMPATIBILITY_RUNTIME_ACTIONS["functions.invoke-endpoint"];
      if (!compatibility?.replacementAction || !compatibility?.removeAfter) {
        throw new Error("functions.invoke-endpoint compatibility metadata is missing");
      }
      return invokeRuntime({
        ...request,
        action: "functions.invoke-endpoint",
      });
    }

    function issuePanelSession(panel, providerIdentity, options = {}) {
      const cacheKey = buildPanelAuthCacheKey(panel, providerIdentity, options);
      const recent = readRecentPanelAuthResult(cacheKey);
      if (recent) {
        return Promise.resolve(recent);
      }
      if (cacheKey && pendingPanelAuthRequests.has(cacheKey)) {
        return pendingPanelAuthRequests.get(cacheKey);
      }
      const request = invokeRuntime({
        action: "auth.issue-panel-session",
        panel,
        purpose: options?.purpose || "",
        providerIdentity,
        target: options?.target || "",
      }).then((result) => {
        cachePanelAuthResult(cacheKey, result);
        return result;
      });
      if (cacheKey) {
        pendingPanelAuthRequests.set(cacheKey, request);
      }
      return request.finally(() => {
        if (cacheKey) {
          pendingPanelAuthRequests.delete(cacheKey);
        }
      });
    }

    function jumpConversationItem(bookmarkId) {
      return invokePage({
        action: "conversation.jump-item",
        bookmarkId,
      });
    }

    function logTrace(channel, step, payload = {}) {
      return invokePage({
        action: "trace.log",
        channel,
        payload,
        step,
      });
    }

    function openBrowserUrl(url) {
      return invokeRuntime({
        action: "browser.open-url",
        url,
      });
    }

    function openMeetingResult(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.result.open",
        input,
        providerIdentity,
      });
    }

    function openMeetingWorkspace(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.workspace.open",
        input,
        providerIdentity,
      });
    }

    function readCapabilityCatalog(request = {}) {
      return invokeRuntime({
        ...request,
        action: "capabilities.handshake",
      });
    }

    function readComposerState() {
      return invokePage({
        action: "composer.read-state",
      });
    }

    function readConversationState() {
      return invokePage({
        action: "conversation.read-state",
      });
    }

    function readDebugState() {
      return invokePage({
        action: "debug.read-state",
      });
    }

    function readPanelStorageState() {
      return invokeRuntime({
        action: "storage.read-panel-state",
      });
    }

    function revokeMeetingShare(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.share.revoke",
        input,
        providerIdentity,
      });
    }

    function setDebugEnabled(enabled) {
      return invokePage({
        action: "debug.set-enabled",
        enabled,
      });
    }

    function writeClipboardText(text) {
      return invokePage({
        action: "clipboard.write-text",
        text,
      });
    }

    function writeUiPreferences(partial = {}) {
      return invokeCapability("panel.ui-preferences.write", { partial });
    }

    function buildPanelAuthCacheKey(panel, providerIdentity, requestOptions = {}) {
      const normalizedPanel = normalizeText(panel).toLowerCase();
      const providerUserKey = normalizeText(providerIdentity?.providerUserKey);
      const target = normalizeText(requestOptions?.target).toLowerCase() || "production";
      return normalizedPanel && providerUserKey ? `${normalizedPanel}::${providerUserKey}::${target}` : "";
    }

    function readRecentPanelAuthResult(cacheKey) {
      const key = normalizeText(cacheKey);
      const entry = key ? recentPanelAuthResults.get(key) : null;
      if (!entry || entry.expiresAt <= Date.now()) {
        if (key) {
          recentPanelAuthResults.delete(key);
        }
        return null;
      }
      return entry.result;
    }

    function cachePanelAuthResult(cacheKey, result) {
      const key = normalizeText(cacheKey);
      const expiresAt = Math.min(
        Date.parse(normalizeText(result?.expiresAt)) - 60000,
        Date.now() + PANEL_AUTH_CACHE_TTL_MS
      );
      if (!key || !result || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        if (key) {
          recentPanelAuthResults.delete(key);
        }
        return;
      }
      recentPanelAuthResults.set(key, { expiresAt, result });
    }

    function normalizeText(value) {
      return namespace.session.normalizeText(value);
    }
  }

  namespace.extensionCapabilityClient = {
    create,
  };
})(globalThis);
