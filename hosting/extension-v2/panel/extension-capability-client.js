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
  const PAGE_CAPABILITY_IDS = Object.freeze([
    "clipboard.write-text",
    "composer.apply-text",
    "composer.read-state",
    "conversation.jump-item",
    "conversation.read-state",
    "debug.clear-log",
    "debug.copy-log",
    "debug.read-state",
    "debug.set-enabled",
    "page.dispatch-named-event",
    "page.highlight-range",
    "page.read-selection",
    "page.scroll-to",
    "page.show-banner",
    "trace.log",
  ]);

  function create(options = {}) {
    const invokePage = typeof options.invokePage === "function"
      ? options.invokePage
      : async () => ({});
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
    const invokeWorkflow = typeof options.invokeWorkflow === "function"
      ? options.invokeWorkflow
      : null;
    let capabilityDefinitionsById = new Map();
    const recentPanelAuthResults = new Map();
    const pendingPanelAuthRequests = new Map();

    return {
      applyComposerText,
      clearDebugLog,
      copyDebugLog,
      invokeCapability,
      invokeFunctionEndpoint,
      invokePageCapability,
      issuePanelSession,
      jumpConversationItem,
      logTrace,
      openMeetingResult,
      openMeetingWorkspace,
      readCapabilityCatalog,
      readComposerState,
      readConversationState,
      readDebugState,
      readPanelStorageState,
      setDebugEnabled,
      writeClipboardText,
      writeUiPreferences,
    };

    function applyComposerText(text, mode = "replace") {
      return invokePageCapability("composer.apply-text", {
        mode,
        text,
      });
    }

    function clearDebugLog() {
      return invokePageCapability("debug.clear-log");
    }

    function copyDebugLog(errorsOnly = false) {
      return invokePageCapability("debug.copy-log", {
        errorsOnly,
      });
    }

    function invokeCapability(capabilityId, input = {}, options = {}) {
      const normalizedCapabilityId = normalizeText(capabilityId);
      const capability = capabilityDefinitionsById.get(normalizedCapabilityId);
      assertCapabilityEnabled(capability);
      if (capability?.kind === "page.capability") {
        return invokeManifestPageCapability(capability, input);
      }
      if (capability?.kind === "workflow") {
        return invokeManifestWorkflowCapability(capability, input, options);
      }
      return invokeRuntime({
        action: "capabilities.invoke",
        capabilityId: normalizedCapabilityId,
        input,
        trace: options?.trace || null,
      });
    }

    function assertCapabilityEnabled(capability) {
      if (capability?.enabled === false) {
        throw new Error("capability가 비활성화되어 있어요.");
      }
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

    function invokePageCapability(pageCapabilityId, input = {}) {
      const capabilityId = normalizeText(pageCapabilityId);
      if (!PAGE_CAPABILITY_IDS.includes(capabilityId)) {
        throw new Error("허용되지 않은 page capability예요.");
      }
      return invokePage({
        ...(input && typeof input === "object" ? input : {}),
        action: capabilityId,
      });
    }

    function invokeManifestPageCapability(capability, input = {}) {
      return invokePageCapability(capability.pageCapabilityId || capability.capabilityId, input);
    }

    function invokeManifestWorkflowCapability(capability, input = {}, requestOptions = {}) {
      if (typeof invokeWorkflow !== "function") {
        throw new Error("remote workflow host가 준비되지 않았어요.");
      }
      return invokeWorkflow(capability, input, requestOptions);
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
      return invokePageCapability("conversation.jump-item", {
        bookmarkId,
      });
    }

    function logTrace(channel, step, payload = {}) {
      return invokePageCapability("trace.log", {
        channel,
        payload,
        step,
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
      }).then(appendHostedBridgeCapabilities);
    }

    function readComposerState() {
      return invokePageCapability("composer.read-state");
    }

    function readConversationState() {
      return invokePageCapability("conversation.read-state");
    }

    function readDebugState() {
      return invokePageCapability("debug.read-state");
    }

    function readPanelStorageState() {
      return invokeRuntime({
        action: "storage.read-panel-state",
      });
    }

    function setDebugEnabled(enabled) {
      return invokePageCapability("debug.set-enabled", {
        enabled,
      });
    }

    function writeClipboardText(text) {
      return invokePageCapability("clipboard.write-text", {
        text,
      });
    }

    function writeUiPreferences(partial = {}) {
      return invokeCapability("panel.ui-preferences.write", { partial });
    }

    function appendHostedBridgeCapabilities(catalog) {
      const nextCatalog = catalog && typeof catalog === "object" ? { ...catalog } : {};
      nextCatalog.bridgeApis = mergeCapabilityList(nextCatalog.bridgeApis, ["invokePageCapability"]);
      nextCatalog.pageCapabilityIds = PAGE_CAPABILITY_IDS.slice();
      nextCatalog.capabilityAliases = Array.isArray(nextCatalog.capabilityAliases) ? nextCatalog.capabilityAliases.slice() : [];
      cacheCapabilityCatalog(nextCatalog);
      return nextCatalog;
    }

    function cacheCapabilityCatalog(catalog) {
      capabilityDefinitionsById = new Map();
      if (!Array.isArray(catalog?.capabilities)) {
        return;
      }
      catalog.capabilities.forEach((capability) => {
        const capabilityId = normalizeText(capability?.capabilityId);
        if (!capabilityId) {
          return;
        }
        capabilityDefinitionsById.set(capabilityId, {
          capabilityId,
          enabled: capability?.enabled === true,
          artifactId: normalizeText(capability?.artifactId),
          artifactVersion: normalizeText(capability?.artifactVersion),
          kind: normalizeText(capability?.kind),
          pageCapabilityId: normalizeText(capability?.pageCapabilityId),
          workflowId: normalizeText(capability?.workflowId),
        });
      });
      if (!Array.isArray(catalog?.capabilityAliases)) {
        return;
      }
      catalog.capabilityAliases.forEach((alias) => {
        const aliasId = normalizeText(alias?.aliasId);
        const replacementId = normalizeText(alias?.replacementId);
        const replacementCapability = capabilityDefinitionsById.get(replacementId);
        if (!aliasId || !replacementCapability) {
          return;
        }
        capabilityDefinitionsById.set(aliasId, {
          ...replacementCapability,
          aliasId,
          capabilityId: aliasId,
          replacementId,
        });
      });
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

    function mergeCapabilityList(values, requiredValues = []) {
      const merged = Array.isArray(values)
        ? values.map(normalizeText).filter(Boolean)
        : [];
      requiredValues.map(normalizeText).filter(Boolean).forEach((value) => {
        if (!merged.includes(value)) {
          merged.push(value);
        }
      });
      return merged;
    }
  }

  namespace.extensionCapabilityClient = {
    create,
  };
})(globalThis);
