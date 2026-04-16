(function initPanelV2CompositionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.session?.normalizeText || ((value) => String(value ?? "").trim());
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
    const providerIdentitySync = createProviderIdentitySync(state, {
      ...runtimeDiagnostics,
      render,
    });
    const panelDebugController = createPanelDebugBridge(state, {
      ...runtimeFlags,
    });
    const conversationBridge = createConversationBridge(state);
    const panelShellController = panelV2ShellBridge.createShellController(state, {
      render,
    });
    const promptShellController = namespace.panelV2PromptController.create(state, {
      ...runtimeFlags,
      render,
    });
    const promptSnapshotBridge = createPromptSnapshotBridge();

    const panelLifecycleController = panelV2ShellBridge.createPanelLifecycleBridge(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      render,
    });
    const routeStateController = namespace.routeStateController.create(state);
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

    renderController = panelV2ShellBridge.createRenderController(state, {
      isPaused: runtimeFlags.isPaused,
      isToolSurface: runtimeFlags.isToolSurface,
      buildConversationSnapshot: conversationBridge.buildConversationSnapshot,
      buildPromptSnapshot: promptSnapshotBridge.buildPromptSnapshot,
      panelDebugController,
      promptShellController,
      readPanelOpen: panelLifecycleController.readPanelOpen,
    });
    const panelBootstrapController = panelV2ShellBridge.createBootstrapController(state, {
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

  }

  function createState() {
    return {
      sessionId: "",
      sessionTitle: "",
      settings: { ...namespace.constants.defaults.settings },
      settingsHydrated: false,
      pausedSessions: {},
      uiPreferences: namespace.storage.mergeUiPreferences(),
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
      routeLastMutationAt: 0,
      routeWaitStartedAt: 0,
      awaitingRouteMessages: false,
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
    };
  }

  function createConversationBridge(state) {
    return {
      buildConversationSnapshot() {
        return {
          count: getConversationCount(),
          snapshotFingerprint: buildSnapshotFingerprint(),
          visibleMessageId: normalizeText(namespace.contentDom?.getVisibleMessageId?.(state.bookmarks)),
        };
      },
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
        normalizeText(state.sessionId),
        String(getConversationCount()),
        normalizeText(items[0]?.id),
        normalizeText(items.at?.(-1)?.id),
      ].join("|");
    }
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

  namespace.panelV2CompositionController = { create, createState };
})(globalThis);
