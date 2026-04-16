(function initPanelV2ShellBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function createPanelActivityBridge(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const render = typeof deps.render === "function" ? deps.render : () => {};

    return {
      handleVisibilityChange,
      handleWindowFocus,
    };

    function handleVisibilityChange() {
      if (global.document.visibilityState !== "visible") {
        logPanelDebug("panel.ui.visibility.hidden", {
          scope: "panel-ui",
          tool: "panel",
        });
        render();
        return;
      }
      void providerIdentitySync.syncToStorage("visibility-visible");
      logPanelDebug("panel.ui.visibility.visible", {
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }

    function handleWindowFocus() {
      void providerIdentitySync.syncToStorage("window-focus");
      logPanelDebug("panel.ui.focus", {
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }
  }

  function createPanelLifecycleBridge(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const render = typeof deps.render === "function" ? deps.render : () => {};

    return {
      applyPanelOpen,
      initializeOpenState,
      readPanelOpen,
    };

    function initializeOpenState() {
      state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences);
    }

    function applyPanelOpen(nextOpen, options = {}) {
      const shouldRender = options.render !== false;
      const panelOpen = typeof nextOpen === "boolean" ? nextOpen : !readPanelOpen();
      state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
        panelOpen,
      });
      logPanelDebug("panel.ui.toggle", {
        open: panelOpen,
        scope: "panel-ui",
        tool: "panel",
      });
      if (shouldRender) {
        render();
      }
      return panelOpen;
    }

    function readPanelOpen() {
      return namespace.storage.mergeUiPreferences(state.uiPreferences).panelOpen === true;
    }
  }

  function createPanelSurfaceBridge(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function"
      ? deps.logPanelDebug
      : () => {};
    const render = typeof deps.render === "function" ? deps.render : () => {};

    return {
      installSurfaceWatchers,
    };

    function installSurfaceWatchers() {
      state.surfaceSignature = getSurfaceSignature();
      if (state.surfacePollTimer) {
        global.clearInterval(state.surfacePollTimer);
      }
      state.surfacePollTimer = global.setInterval(() => {
        const nextSignature = getSurfaceSignature();
        if (nextSignature === state.surfaceSignature) {
          return;
        }
        const previousSurface = parseSurfaceSignature(state.surfaceSignature);
        const nextSurface = parseSurfaceSignature(nextSignature);
        const hadComposer = previousSurface.hasComposer;
        const hasComposer = nextSurface.hasComposer;
        state.surfaceSignature = nextSignature;
        if (previousSurface.hasComposer !== nextSurface.hasComposer || previousSurface.hasChatLog !== nextSurface.hasChatLog) {
          logPanelDebug("panel.ui.surface.changed", {
            hadChatLog: previousSurface.hasChatLog,
            hadComposer,
            hasChatLog: nextSurface.hasChatLog,
            hasComposer,
            scope: "panel-ui",
            tool: "panel",
          });
        }
        render();
      }, 600);
    }

    function getSurfaceSignature() {
      const conversation = namespace.contentDom.getConversationState();
      return `${conversation.hasComposer}|${conversation.hasChatLog}|${conversation.articleCount}|${conversation.userCount}`;
    }

    function parseSurfaceSignature(signature) {
      const [hasComposer, hasChatLog] = String(signature || "").split("|");
      return {
        hasChatLog: hasChatLog === "true",
        hasComposer: hasComposer === "true",
      };
    }
  }

  function createBootstrapController(state, deps = {}) {
    const buildHostedPanelCallbacks = typeof deps.buildHostedPanelCallbacks === "function"
      ? deps.buildHostedPanelCallbacks
      : buildDefaultHostedPanelCallbacks;
    const panelActivityController = deps.panelActivityController || { handleVisibilityChange() {}, handleWindowFocus() {} };
    const panelDebugController = deps.panelDebugController || { installValidationApi() {} };
    const panelLifecycleController = deps.panelLifecycleController || {
      applyPanelOpen() {},
      initializeOpenState() {},
      readPanelOpen() { return false; },
    };
    const promptShellController = deps.promptShellController || {
      ensureReviewFloat() {},
    };
    const panelShellController = deps.panelShellController || {
      updateHandlePosition() {},
    };
    const panelSurfaceController = deps.panelSurfaceController || { installSurfaceWatchers() {} };
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const routeStateController = deps.routeStateController || { handleStorageChange() { return false; } };
    const routeSync = deps.routeSync || { scheduleRefresh() {}, syncRouteState: async () => {} };
    const routeWatchController = deps.routeWatchController || { installRouteWatchers() {} };

    return {
      bootstrap,
      handleRouteStorageChange,
    };

    async function bootstrap() {
      panelLifecycleController.initializeOpenState();
      void providerIdentitySync.syncToStorage("bootstrap");
      namespace.contentPanel.ensurePanel(buildHostedPanelCallbacks({
        panelLifecycleController,
        panelShellController,
      }));
      panelDebugController.installValidationApi();
      promptShellController.ensureReviewFloat();
      routeWatchController.installRouteWatchers();
      panelSurfaceController.installSurfaceWatchers();
      global.addEventListener("resize", render, { passive: true });
      global.addEventListener("focus", panelActivityController.handleWindowFocus, { passive: true });
      global.document.addEventListener("visibilitychange", panelActivityController.handleVisibilityChange, { passive: true });
      global.chrome?.storage?.onChanged?.addListener(handleRouteStorageChange);
      await routeSync.syncRouteState(true);
      [450, 1200].forEach((delay) => global.setTimeout(() => {
        if (shouldPrimeRouteRefresh()) {
          routeSync.scheduleRefresh();
        }
      }, delay));
    }

    function handleRouteStorageChange(changes, areaName) {
      if (routeStateController.handleStorageChange(changes, areaName)) {
        routeSync.scheduleRefresh();
      }
    }

    function shouldPrimeRouteRefresh() {
      return Boolean(
        state.awaitingRouteMessages
        || state.lastError
        || !Array.isArray(state.bookmarks)
        || !state.bookmarks.length
      );
    }
  }

  function buildDefaultHostedPanelCallbacks(deps = {}) {
    const panelLifecycleController = deps.panelLifecycleController || {};
    const panelShellController = deps.panelShellController || {
      updateHandlePosition() {},
    };

    return {
      onHandlePositionChange: panelShellController.updateHandlePosition,
      onPanelChromeSync(chromeState) {
        if (Object.hasOwn(chromeState || {}, "open")) {
          panelLifecycleController.applyPanelOpen?.(Boolean(chromeState.open), {
            render: false,
          });
        }
        return Boolean(namespace.contentPanel?.syncPanelChrome?.(chromeState));
      },
      onToggle() {
        return Boolean(namespace.contentPanel?.emitPanelEvent?.("external-toggle"));
      },
    };
  }

  function createRenderController(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const panelBookmarkController = deps.panelBookmarkController || { buildToolState() { return { count: 0 }; } };
    const panelDebugController = deps.panelDebugController || {
      syncEnabled() {},
    };
    const buildConversationSnapshot = typeof deps.buildConversationSnapshot === "function"
      ? deps.buildConversationSnapshot
      : () => panelBookmarkController.buildToolState();
    const promptShellController = deps.promptShellController || {
      buildReviewFloatState() { return { visible: false }; },
      buildToolState() { return { promptTool: {} }; },
    };
    const buildPromptSnapshot = typeof deps.buildPromptSnapshot === "function"
      ? deps.buildPromptSnapshot
      : (promptToolState) => promptToolState?.promptTool || {};
    const readPanelOpen = typeof deps.readPanelOpen === "function"
      ? deps.readPanelOpen
      : () => false;

    return {
      render,
    };

    function render() {
      panelDebugController.syncEnabled();
      if (!state.settingsHydrated) {
        namespace.composerReviewFloat?.render?.(promptShellController.buildReviewFloatState(false));
        return;
      }
      const visible = state.settings.enabled && isToolSurface() && !isPaused();
      const bookmarkTool = normalizeConversationSnapshot(buildConversationSnapshot());
      const promptToolState = promptShellController.buildToolState();
      const promptSnapshot = normalizePromptSnapshot(buildPromptSnapshot(promptToolState));
      const panelOpen = readPanelOpen();
      namespace.contentPanel.renderPanel({
        handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
        panelSnapshot: {
          bookmarksTool: bookmarkTool,
          open: panelOpen,
          promptTool: promptSnapshot,
          settings: state.settings,
          uiPreferences: namespace.storage.mergeUiPreferences(state.uiPreferences),
          visible,
        },
      });
      namespace.composerReviewFloat?.render?.(promptShellController.buildReviewFloatState(visible));
    }

    function normalizeConversationSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizePromptSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

  }

  function createShellController(state, deps = {}) {
    const render = typeof deps.render === "function" ? deps.render : () => {};

    return {
      updateHandlePosition,
    };

    async function updateHandlePosition(nextRatio) {
      const bucket = namespace.storage.getViewportBucket(global.innerWidth);
      const handleRatio = namespace.storage.normalizeHandleRatio(nextRatio, bucket);
      const handleRatios = { [bucket]: handleRatio };
      state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
        handleRatios,
      });
      render();
      try {
        await namespace.storage.updateUiPreferences({
          handleRatios,
        });
      } catch (error) {
        console.error("[i-Nova Bookmarks] handle position save failed", error);
      }
    }

  }

  namespace.panelV2ShellBridge = {
    createBootstrapController,
    createPanelActivityBridge,
    createPanelLifecycleBridge,
    createPanelSurfaceBridge,
    createRenderController,
    createShellController,
  };
})(globalThis);
