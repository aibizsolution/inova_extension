(function initRouteStateController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const ROUTE_FALLBACK_MS = 1600;

  function create(state, deps = {}) {
    const applyUiPreferenceLock = typeof deps.applyUiPreferenceLock === "function"
      ? deps.applyUiPreferenceLock
      : (uiPreferences) => uiPreferences;
    const ensureStoreLoaded = typeof deps.ensureStoreLoaded === "function"
      ? deps.ensureStoreLoaded
      : () => {};
    const normalizeToolId = typeof deps.normalizeToolId === "function"
      ? deps.normalizeToolId
      : defaultNormalizeToolId;

    return {
      handleStorageChange,
      refreshState,
      resetRouteState,
    };

    async function refreshState() {
      logDebug("route.refresh.start", {
        scope: "route",
        sessionId: state.sessionId,
      });
      try {
        const storageState = await namespace.storage.getState();
        mergeStorageState(storageState);
        if (state.sessionId) {
          state.sessionTitle = namespace.contentDom.getSessionTitle();
        }
        state.bookmarks = readLiveBookmarks();
        state.lastError = "";
        if (isStoreTabActive()) {
          ensureStoreLoaded();
        }
        logDebug("route.refresh.success", {
          activeTool: state.activeTool,
          bookmarkCount: state.bookmarks.length,
          scope: "route",
          sessionId: state.sessionId,
        });
      } catch (error) {
        const invalidatedContext = isInvalidatedContextError(error);
        state.lastError = invalidatedContext
          ? "확장프로그램이 갱신되어 페이지를 새로고침해야 해요."
          : error instanceof Error
            ? error.message
            : String(error);
        logDebug("route.refresh.error", {
          error: state.lastError,
          scope: "route",
          sessionId: state.sessionId,
        });
        if (!invalidatedContext) {
          console.error("[i-Nova Bookmarks] refresh state failed", error);
        }
      }
    }

    function resetRouteState(nextSessionId, previousSignature) {
      state.sessionId = nextSessionId || "";
      state.sessionTitle = nextSessionId ? namespace.contentDom.getSessionTitle() : "";
      state.open = namespace.contentDom.getConversationState().hasComposer ? state.preferredOpen : false;
      state.activeId = "";
      state.bookmarks = [];
      state.promptReview = { ...namespace.constants.defaults.promptReview };
      state.lastError = "";
      state.routeBaselineSignature = nextSessionId ? previousSignature : "";
      state.awaitingRouteMessages = Boolean(nextSessionId);
      state.routeWaitStartedAt = nextSessionId ? Date.now() : 0;
    }

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local") {
        return false;
      }

      let changed = false;
      const settingsChange = getStorageChange(changes, namespace.constants.storageKeys.settings, "settings");
      const pausedSessionsChange = getStorageChange(changes, namespace.constants.storageKeys.pausedSessions, "pausedSessions");
      const cloudSyncChange = getStorageChange(changes, namespace.constants.storageKeys.cloudSync, "cloudSync");
      const uiPreferencesChange = getStorageChange(changes, namespace.constants.storageKeys.uiPreferences, "uiPreferences");
      const promptLibraryChange = getStorageChange(changes, namespace.constants.storageKeys.promptLibrary, "promptLibrary");

      if (settingsChange) {
        state.settings = {
          ...namespace.constants.defaults.settings,
          ...(settingsChange.newValue || {}),
        };
        changed = true;
      }
      if (pausedSessionsChange) {
        state.pausedSessions = pausedSessionsChange.newValue || {};
        changed = true;
      }
      if (cloudSyncChange) {
        state.cloudSync = namespace.cloudSync.mergeCloudSyncState(cloudSyncChange.newValue);
        changed = true;
      }
      if (uiPreferencesChange) {
        state.uiPreferences = readUiPreferences(uiPreferencesChange.newValue);
        state.activeTool = normalizeToolId(state.uiPreferences.activeTool || state.activeTool);
        if (isStoreTabActive()) {
          ensureStoreLoaded();
        }
        changed = true;
      }
      if (promptLibraryChange) {
        state.promptLibrary = namespace.promptLibrary.mergePromptLibrary(promptLibraryChange.newValue);
        changed = true;
      }

      return changed;
    }

    function mergeStorageState(storageState = {}) {
      state.settings = storageState.settings || { ...namespace.constants.defaults.settings };
      state.pausedSessions = storageState.pausedSessions || {};
      state.cloudSync = namespace.cloudSync.mergeCloudSyncState(storageState.cloudSync);
      state.uiPreferences = readUiPreferences(storageState.uiPreferences);
      state.activeTool = normalizeToolId(state.uiPreferences.activeTool || state.activeTool);
      state.promptLibrary = namespace.promptLibrary.mergePromptLibrary(storageState.promptLibrary);
    }

    function readUiPreferences(value) {
      const merged = namespace.storage.mergeUiPreferences(value);
      const locked = applyUiPreferenceLock(merged);
      return {
        ...locked,
        activePromptTab: normalizePromptTab(locked.activeTool === "store" ? "store" : locked.activePromptTab),
      };
    }

    function readLiveBookmarks() {
      if (!shouldCollectLiveMessages()) {
        state.awaitingRouteMessages = false;
        state.routeBaselineSignature = "";
        return [];
      }

      const liveBookmarks = namespace.contentDom.collectUserMessages(state.sessionId);
      const liveSignature = namespace.contentDom.getUserMessageSignature();
      if (shouldKeepWaiting(liveBookmarks, liveSignature)) {
        return [];
      }

      state.awaitingRouteMessages = false;
      state.routeBaselineSignature = liveSignature;
      return liveBookmarks;
    }

    function shouldCollectLiveMessages() {
      return Boolean(state.sessionId) && state.settings.enabled && state.settings.autoBookmark && !isPaused();
    }

    function shouldKeepWaiting(liveBookmarks, liveSignature) {
      if (!state.awaitingRouteMessages) {
        return false;
      }

      const conversation = namespace.contentDom.getConversationState();
      const routeLoaded = Boolean(liveSignature) && liveSignature !== state.routeBaselineSignature;
      const emptyConversationReady = conversation.hasChatLog && conversation.hasComposer && conversation.articleCount === 0;
      const readyWithoutBaseline = !state.routeBaselineSignature && liveBookmarks.length > 0;
      const becameEmpty = !liveBookmarks.length && !liveSignature && emptyConversationReady;
      const waitedLongEnough = Date.now() - state.routeWaitStartedAt > ROUTE_FALLBACK_MS;
      return !(routeLoaded || readyWithoutBaseline || becameEmpty || waitedLongEnough);
    }

    function isPaused() {
      return Boolean(state.pausedSessions[state.sessionId]);
    }

    function isStoreTabActive() {
      return state.activeTool === "prompts" && state.uiPreferences.activePromptTab === "store";
    }

    function normalizePromptTab(value) {
      return value === "store" || value === "review" ? value : "library";
    }

    function getStorageChange(changes, storageKey, fallbackKey) {
      return namespace.productLane?.getStorageChange?.(changes, storageKey) || changes[fallbackKey];
    }

    function defaultNormalizeToolId(toolId) {
      return toolId === "release" || toolId === "prompts" || toolId === "meeting"
        ? toolId
        : toolId === "store"
            ? "prompts"
            : "bookmarks";
    }

    function logDebug(event, payload) {
      namespace.panelDebug?.log?.(event, payload || {});
    }
  }

  function isInvalidatedContextError(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
    return message.includes("Extension context invalidated")
      || message.includes("확장프로그램이 갱신");
  }

  namespace.routeStateController = { create };
})(globalThis);
