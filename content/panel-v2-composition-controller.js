(function initPanelV2CompositionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const RUNTIME_PROVIDER_IDENTITY_REQUEST = "inova-meeting:get-provider-identity";

  function create(state) {
    let renderController = null;
    const render = () => renderController?.render();
    const panelV2ShellBridge = namespace.panelV2ShellBridge;
    if (!panelV2ShellBridge) {
      throw new Error("panelV2ShellBridge must load before panelV2CompositionController");
    }

    // v2 shell baseline keeps the shared extension-side runtime wiring.
    const panelRuntimeController = createPanelRuntimeBridge(state);
    const runtimeFlags = {
      isPaused: panelRuntimeController.isPaused,
      isToolSurface: panelRuntimeController.isToolSurface,
    };
    const runtimeDiagnostics = {
      isExtensionContextInvalidatedError: panelRuntimeController.isExtensionContextInvalidatedError,
      logPanelDebug: panelRuntimeController.logPanelDebug,
    };
    const releaseToolSummarySnapshot = createReleaseToolSummarySnapshotBridge(
      () => getToolSummary(state.toolSummaries, "release")
    );
    const providerIdentitySync = createProviderIdentitySync(state, {
      ...runtimeDiagnostics,
      render,
    });
    const meetingToolSummarySnapshot = createCountToolSummarySnapshotBridge(
      () => getToolSummary(state.toolSummaries, "meeting")
    );
    const panelDebugController = createPanelDebugBridge(state, {
      ...runtimeFlags,
    });
    const conversationBridge = createConversationBridge(state);
    const panelShellController = panelV2ShellBridge.createShellController(state, {
      isExtensionContextInvalidatedError: runtimeDiagnostics.isExtensionContextInvalidatedError,
      render,
    });
    const promptShellController = namespace.panelV2PromptController.create(state, {
      ...runtimeFlags,
      lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
      persistActiveTool: panelShellController.persistActiveTool,
      render,
    });
    const promptSnapshotBridge = createPromptSnapshotBridge();

    const routeStateController = namespace.routeStateController.create(state, {
      applyUiPreferenceLock: panelShellController.applyUiPreferenceLock,
      normalizeToolId: panelShellController.normalizeToolId,
    });
    const panelLifecycleController = panelV2ShellBridge.createPanelLifecycleBridge(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      render,
    });
    const panelActivityController = panelV2ShellBridge.createPanelActivityBridge(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      providerIdentitySync,
      render,
    });
    const panelSurfaceController = panelV2ShellBridge.createPanelSurfaceBridge(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      render,
    });
    const routeSync = namespace.routeSync.create(state, {
      onRouteStateChanged: () => false,
      refreshState: routeStateController.refreshState,
      render,
      resetRouteState: routeStateController.resetRouteState,
    });
    const routeWatchController = namespace.routeWatchController.create(state, {
      scheduleRouteSync: routeSync.scheduleRouteSync,
    });

    const toolSummarySnapshotBridges = {
      meeting: meetingToolSummarySnapshot,
      release: releaseToolSummarySnapshot,
    };

    renderController = panelV2ShellBridge.createRenderController(state, {
      isPaused: runtimeFlags.isPaused,
      isToolSurface: runtimeFlags.isToolSurface,
      buildConversationSnapshot: conversationBridge.buildConversationSnapshot,
      getConversationCount: conversationBridge.getConversationCount,
      buildPromptSnapshot: promptSnapshotBridge.buildPromptSnapshot,
      getPromptCounts: promptSnapshotBridge.getPromptCounts,
      buildToolSummarySnapshot(toolId) {
        return toolSummarySnapshotBridges[normalizeToolSummaryId(toolId)]?.buildSnapshot?.() || {};
      },
      getToolSummaryCount(toolId, toolSummary) {
        return toolSummarySnapshotBridges[normalizeToolSummaryId(toolId)]?.getCount?.(toolSummary) || 0;
      },
      panelDebugController,
      promptShellController,
      panelShellController,
    });
    const panelBootstrapController = panelV2ShellBridge.createBootstrapController(state, {
      handlePanelToolSummarySync: handleToolSummarySync,
      panelActivityController,
      panelDebugController,
      panelLifecycleController,
      promptShellController,
      panelShellController,
      panelSurfaceController,
      providerIdentitySync,
      render,
      routeStateController,
      routeSync,
      routeWatchController,
    });

    return {
      bootstrap() {
        return panelBootstrapController.bootstrap();
      },
    };

    function handleToolSummarySync(toolId, toolState = {}) {
      const normalizedToolId = normalizeToolSummaryId(toolId);
      if (!normalizedToolId) {
        return false;
      }
      const nextSummary = normalizeToolSummary(normalizedToolId, toolState);
      if (!shouldUpdateToolSummary(state.toolSummaries, normalizedToolId, nextSummary)) {
        return false;
      }
      state.toolSummaries = {
        ...state.toolSummaries,
        [normalizedToolId]: nextSummary,
      };
      render();
      return true;
    }
  }

  function createState() {
    return {
      sessionId: "",
      sessionTitle: "",
      open: false,
      preferredOpen: false,
      activeId: "",
      activeTool: namespace.constants.defaults.uiPreferences.activeTool,
      settings: { ...namespace.constants.defaults.settings },
      settingsHydrated: false,
      pausedSessions: {},
      toolSummaries: {
        meeting: { count: 0 },
        release: { count: 0 },
      },
      panelDebugUi: {
        collapsed: true,
        feedback: null,
        feedbackTimer: 0,
      },
      uiPreferences: namespace.storage.mergeUiPreferences(),
      promptReview: { ...namespace.constants.defaults.promptReview },
      feedbackTimer: 0,
      bookmarks: [],
      observer: null,
      surfacePollTimer: 0,
      surfaceSignature: "",
      syncTimer: 0,
      routeWatchInstalled: false,
      routePollTimer: 0,
      routeRetryTimers: [],
      lastRouteKey: "",
      routeBaselineSignature: "",
      routeWaitStartedAt: 0,
      awaitingRouteMessages: false,
      uiPreferenceLock: null,
      lastError: "",
    };
  }

  function createPanelRuntimeBridge(state) {
    return {
      isExtensionContextInvalidatedError,
      isPaused,
      isToolSurface,
      logPanelDebug,
    };

    function isPaused() {
      return Boolean(state.sessionId && state.pausedSessions[state.sessionId]);
    }

    function isToolSurface() {
      return Boolean(namespace.contentDom?.getConversationState?.().hasComposer);
    }

    function isExtensionContextInvalidatedError(error) {
      const message = normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
      return message.includes("extension context invalidated");
    }

    function logPanelDebug(event, payload) {
      namespace.panelDebug?.log?.(event, payload || {});
    }
  }

  function createPanelDebugBridge(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;

    return {
      buildState() {
        return {};
      },
      async handleAction(action) {
        const normalizedAction = normalizeText(action);
        if (normalizedAction === "debug-copy") {
          await copyEntries(false);
          return true;
        }
        if (normalizedAction === "debug-copy-errors") {
          await copyEntries(true);
          return true;
        }
        if (normalizedAction === "debug-clear") {
          namespace.panelDebug?.clearEntries?.();
          return true;
        }
        return normalizedAction === "debug-toggle";
      },
      handlesAction(action) {
        return new Set(["debug-toggle", "debug-copy", "debug-copy-errors", "debug-clear"]).has(normalizeText(action));
      },
      installValidationApi() {
        delete namespace.panelDebugValidation;
      },
      syncEnabled() {
        namespace.panelDebug?.setEnabled?.(Boolean(
          namespace.panelDebug?.isLocalDebugEnabled?.(state.settings)
          && state.settings.enabled
          && isToolSurface()
          && !isPaused()
          && global.document.visibilityState === "visible"
        ));
      },
    };

    async function copyEntries(errorsOnly) {
      const entries = namespace.panelDebug?.getEntries?.() || [];
      const text = errorsOnly
        ? namespace.panelDebug?.buildErrorCopyText?.(entries)
        : namespace.panelDebug?.buildCopyText?.(entries);
      if (!normalizeText(text)) {
        return;
      }
      try {
        await global.navigator?.clipboard?.writeText?.(text);
      } catch (error) {
        namespace.panelDebug?.log?.("panel.debug.copy.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          errorsOnly: Boolean(errorsOnly),
        });
      }
    }
  }

  function createProviderIdentitySync(state, deps = {}) {
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const isExtensionContextInvalidatedError = typeof deps.isExtensionContextInvalidatedError === "function"
      ? deps.isExtensionContextInvalidatedError
      : () => false;

    ensureProviderIdentityRuntimeInstalled();

    return {
      handleRuntimeMessage,
      syncToStorage,
    };

    async function syncToStorage(reason = "runtime", providedIdentity = null) {
      const providerIdentity = normalizeProviderIdentity(
        providedIdentity || namespace.providerIdentity?.getCurrent?.()
      );
      if (!providerIdentity.available || !providerIdentity.providerUserKey) {
        return false;
      }
      try {
        const currentProviderIdentityCache = await namespace.storage.getProviderIdentityCacheState();
        const currentIdentity = normalizeProviderIdentity(currentProviderIdentityCache?.providerIdentity);
        if (
          currentIdentity.providerUserKey === providerIdentity.providerUserKey
          && currentIdentity.email === providerIdentity.email
          && currentIdentity.displayName === providerIdentity.displayName
          && currentIdentity.numericUserId === providerIdentity.numericUserId
        ) {
          return false;
        }
        const nextProviderIdentityCache = namespace.providerIdentityCache.mergeProviderIdentityCacheState(currentProviderIdentityCache, {
          providerIdentity: {
            ...currentIdentity,
            ...providerIdentity,
            available: true,
          },
        });
        await namespace.storage.setProviderIdentityCacheState(nextProviderIdentityCache);
        logPanelDebug("panel.identity.cached", {
          providerUserKey: normalizeText(providerIdentity.providerUserKey),
          reason: normalizeText(reason) || "runtime",
          scope: "panel-ui",
          tool: "panel",
        });
        render();
        return true;
      } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
          return false;
        }
        console.error("[i-Nova Bookmarks] provider identity cache failed", error);
        return false;
      }
    }

    function handleRuntimeMessage(message, sender, sendResponse) {
      const type = normalizeText(message?.type);
      if (type !== RUNTIME_PROVIDER_IDENTITY_REQUEST) {
        return false;
      }
      Promise.resolve().then(async () => {
        const providerIdentity = normalizeProviderIdentity(namespace.providerIdentity?.getCurrent?.());
        await syncToStorage("runtime-message", providerIdentity);
        sendResponse({
          ok: true,
          providerIdentity,
          senderUrl: normalizeText(sender?.url),
        });
      }).catch((error) => {
        sendResponse({
          error: error instanceof Error ? error.message : String(error || "현재 i-Nova 사용자 정보를 읽지 못했어요."),
          ok: false,
        });
      });
      return true;
    }
  }

  function ensureProviderIdentityRuntimeInstalled() {
    if (namespace.providerIdentitySyncRuntimeInstalled || !global.chrome?.runtime?.onMessage?.addListener) {
      return;
    }
    global.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const type = normalizeText(message?.type);
      if (type !== RUNTIME_PROVIDER_IDENTITY_REQUEST) {
        return false;
      }
      Promise.resolve().then(() => {
        sendResponse({
          ok: true,
          providerIdentity: normalizeProviderIdentity(namespace.providerIdentity?.getCurrent?.()),
          senderUrl: normalizeText(sender?.url),
        });
      }).catch((error) => {
        sendResponse({
          error: error instanceof Error ? error.message : String(error || "현재 i-Nova 사용자 정보를 읽지 못했어요."),
          ok: false,
        });
      });
      return true;
    });
    namespace.providerIdentitySyncRuntimeInstalled = true;
  }

  function normalizeProviderIdentity(identity) {
    const normalize = typeof namespace.providerIdentityCache?.normalizeProviderIdentity === "function"
      ? namespace.providerIdentityCache.normalizeProviderIdentity
      : (value) => value && typeof value === "object" ? value : {};
    return normalize(identity || null);
  }

  function createCountToolSummarySnapshotBridge(getToolSummary = () => ({})) {
    return {
      buildSnapshot() {
        return {
          count: getCount(getToolSummary()),
        };
      },
      getCount,
    };

    function getCount(toolSummary = {}) {
      return normalizeToolSummaryCount(toolSummary?.count);
    }
  }

  function createPromptSnapshotBridge() {
    return {
      buildPromptSnapshot(promptToolState = {}) {
        const promptTool = promptToolState?.promptTool && typeof promptToolState.promptTool === "object"
          ? promptToolState.promptTool
          : {};
        return {
          review: normalizePromptReviewSnapshot(promptTool.review),
        };
      },
      getPromptCounts(promptToolState = {}) {
        return {
          promptCount: Math.max(0, Number(promptToolState.promptCount) || 0),
          promptToolCount: Math.max(0, Number(promptToolState.promptToolCount) || 0),
        };
      },
    };
  }

  function createConversationBridge(state) {
    return {
      buildConversationSnapshot() {
        return {
          count: getConversationCount(),
          snapshotFingerprint: buildSnapshotFingerprint(),
        };
      },
      getConversationCount,
    };

    function getConversationCount(conversationSnapshot = null) {
      if (conversationSnapshot && typeof conversationSnapshot === "object") {
        return Math.max(0, Number(conversationSnapshot.count) || 0);
      }
      return Array.isArray(state.bookmarks) ? state.bookmarks.length : 0;
    }

    function buildSnapshotFingerprint() {
      const items = Array.isArray(state.bookmarks) ? state.bookmarks : [];
      return [
        String(getConversationCount()),
        normalizeText(items[0]?.id),
        normalizeText(items.at?.(-1)?.id),
      ].join("|");
    }
  }

  function createReleaseToolSummarySnapshotBridge(getReleaseSummary = () => ({})) {
    return {
      buildSnapshot() {
        const releaseTool = normalizeToolSummary("release", getReleaseSummary());
        const count = getCount(releaseTool);
        return {
          count,
          updateAvailable: count > 0,
        };
      },
      getCount,
    };

    function getCount(releaseTool = normalizeToolSummary("release", getReleaseSummary())) {
      return normalizeToolSummaryCount(releaseTool.count);
    }
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  function normalizePromptReviewSnapshot(reviewState) {
    if (!reviewState || typeof reviewState !== "object") {
      return {};
    }
    const requestId = Math.max(0, Number(reviewState.requestId) || 0);
    return {
      ...(requestId ? { requestId } : {}),
    };
  }

  function normalizeToolSummaryCount(value) {
    return Math.max(0, Number(value) || 0);
  }

  function normalizeToolSummaryId(value) {
    const normalizedToolId = normalizeText(value);
    return normalizedToolId === "meeting" || normalizedToolId === "release"
      ? normalizedToolId
      : "";
  }

  function getToolSummary(toolSummaries, toolId) {
    const normalizedToolId = normalizeToolSummaryId(toolId);
    if (!normalizedToolId) {
      return {};
    }
    const summaries = toolSummaries && typeof toolSummaries === "object" ? toolSummaries : {};
    const summary = summaries[normalizedToolId];
    return summary && typeof summary === "object" ? summary : {};
  }

  function shouldUpdateToolSummary(toolSummaries, toolId, nextSummary) {
    return buildToolSummaryKey(toolId, getToolSummary(toolSummaries, toolId))
      !== buildToolSummaryKey(toolId, nextSummary);
  }

  function buildToolSummaryKey(toolId, toolSummary) {
    return JSON.stringify(normalizeToolSummary(toolId, toolSummary));
  }

  function normalizeToolSummary(toolId, toolSummary = {}) {
    const normalizedToolId = normalizeToolSummaryId(toolId);
    if (normalizedToolId === "meeting" || normalizedToolId === "release") {
      return {
        count: normalizeToolSummaryCount(toolSummary?.count),
      };
    }
    return {};
  }

  namespace.panelV2CompositionController = { create, createState };
})(globalThis);
