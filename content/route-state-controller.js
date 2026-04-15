(function initRouteStateController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.session?.normalizeText || ((value) => String(value ?? "").trim());
  const ROUTE_FALLBACK_MS = 1600;
  const ROUTE_SETTLE_MS = 260;

  function create(state, deps = {}) {
    const readPreferredOpen = typeof deps.readPreferredOpen === "function"
      ? deps.readPreferredOpen
      : () => false;
    const applyPanelOpen = typeof deps.applyPanelOpen === "function"
      ? deps.applyPanelOpen
      : () => false;

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
        logDebug("route.refresh.success", {
          activeTool: readActiveTool(),
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
        if (!invalidatedContext) {
          logDebug("route.refresh.error", {
            error: state.lastError,
            scope: "route",
            sessionId: state.sessionId,
          });
        }
        if (!invalidatedContext) {
          console.error("[i-Nova Bookmarks] refresh state failed", error);
        }
      }
    }

    function resetRouteState(nextSessionId, previousSignature) {
      state.sessionId = nextSessionId || "";
      state.sessionTitle = nextSessionId ? namespace.contentDom.getSessionTitle() : "";
      applyPanelOpen(namespace.contentDom.getConversationState().hasComposer ? readPreferredOpen() : false, {
        persist: false,
        render: false,
      });
      state.bookmarks = [];
      state.lastError = "";
      state.routeBaselineSignature = nextSessionId ? previousSignature : "";
      state.routeLastMutationAt = nextSessionId ? Date.now() : 0;
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
      const uiPreferencesChange = getStorageChange(changes, namespace.constants.storageKeys.uiPreferences, "uiPreferences");

      if (settingsChange) {
        state.settings = {
          ...namespace.constants.defaults.settings,
          ...(settingsChange.newValue || {}),
        };
        state.settingsHydrated = true;
        changed = true;
      }
      if (pausedSessionsChange) {
        state.pausedSessions = pausedSessionsChange.newValue || {};
        changed = true;
      }
      if (uiPreferencesChange) {
        state.uiPreferences = readUiPreferences(uiPreferencesChange.newValue);
        changed = true;
      }

      return changed;
    }

    function mergeStorageState(storageState = {}) {
      state.settings = storageState.settings || { ...namespace.constants.defaults.settings };
      state.settingsHydrated = true;
      state.pausedSessions = storageState.pausedSessions || {};
      state.uiPreferences = readUiPreferences(storageState.uiPreferences);
    }

    function readUiPreferences(value) {
      const merged = namespace.storage.mergeUiPreferences(value);
      return namespace.storage.mergeUiPreferences(merged, {
        activePromptTab: normalizePromptTab(merged.activePromptTab),
      });
    }

    function readLiveBookmarks() {
      if (!shouldCollectLiveMessages()) {
        state.awaitingRouteMessages = false;
        state.routeBaselineSignature = "";
        return [];
      }

      const liveBookmarks = namespace.contentDom.collectUserMessages(state.sessionId);
      const mergedBookmarks = mergeLiveBookmarks(state.bookmarks, liveBookmarks);
      const liveSignature = namespace.contentDom.getUserMessageSignature();
      if (shouldKeepWaiting(liveBookmarks, liveSignature)) {
        return [];
      }

      state.awaitingRouteMessages = false;
      state.routeBaselineSignature = liveSignature;
      return mergedBookmarks;
    }

    function mergeLiveBookmarks(previousBookmarks, liveBookmarks) {
      const previous = Array.isArray(previousBookmarks) ? previousBookmarks : [];
      const next = Array.isArray(liveBookmarks) ? liveBookmarks : [];
      if (!previous.length) {
        return next.slice();
      }
      if (!next.length) {
        return previous.slice();
      }

      const merged = new Map();
      previous.forEach((bookmark) => {
        const bookmarkId = normalizeText(bookmark?.id);
        if (!bookmarkId) {
          return;
        }
        merged.set(bookmarkId, cloneValue(bookmark));
      });
      next.forEach((bookmark) => {
        const bookmarkId = normalizeText(bookmark?.id);
        if (!bookmarkId) {
          return;
        }
        merged.set(bookmarkId, {
          ...(merged.get(bookmarkId) || {}),
          ...cloneValue(bookmark),
        });
      });

      return Array.from(merged.values()).sort((left, right) => {
        const leftOrder = Math.max(0, Number(left?.order) || 0);
        const rightOrder = Math.max(0, Number(right?.order) || 0);
        return leftOrder - rightOrder;
      });
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
      const transitionDetected = routeLoaded || readyWithoutBaseline || becameEmpty;
      if (waitedLongEnough) {
        return false;
      }
      if (!transitionDetected) {
        return true;
      }
      return Date.now() - Math.max(0, Number(state.routeLastMutationAt) || 0) < ROUTE_SETTLE_MS;
    }

    function isPaused() {
      return Boolean(state.pausedSessions[state.sessionId]);
    }

    function normalizePromptTab(value) {
      return value === "store" || value === "review" ? value : "library";
    }

    function getStorageChange(changes, storageKey, fallbackKey) {
      return namespace.productLane?.getStorageChange?.(changes, storageKey) || changes[fallbackKey];
    }

    function cloneValue(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function readActiveTool() {
      const activeTool = normalizeText(readUiPreferences(state.uiPreferences).activeTool);
      return activeTool === "release" || activeTool === "prompts" || activeTool === "meeting"
        ? activeTool
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
