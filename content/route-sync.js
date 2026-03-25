(function initRouteSync(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const ROUTE_FALLBACK_MS = 1600;

  function create(state, hooks) {
    return {
      handleStorageChange,
      installRouteWatchers,
      scheduleRefresh,
      syncRouteState,
    };

    function scheduleRefresh() {
      global.clearTimeout(state.syncTimer);
      state.syncTimer = global.setTimeout(() => refreshState().catch(logRefreshError), 120);
    }

    async function refreshState() {
      try {
        const storageState = await namespace.storage.getState();
        state.settings = storageState.settings || { ...namespace.constants.defaults.settings };
        state.pausedSessions = storageState.pausedSessions || {};
        state.uiPreferences = namespace.storage.mergeUiPreferences(storageState.uiPreferences);
        state.uiPreferences.activePromptTab = normalizePromptTab(state.uiPreferences.activeTool === "store" ? "store" : state.uiPreferences.activePromptTab);
        state.activeTool = hooks.normalizeToolId(state.uiPreferences.activeTool || state.activeTool);
        state.promptLibrary = namespace.promptLibrary.mergePromptLibrary(storageState.promptLibrary);
        if (state.sessionId) {
          state.sessionTitle = namespace.contentDom.getSessionTitle();
        }
        state.bookmarks = readLiveBookmarks();
        state.lastError = "";
        if (isStoreTabActive()) hooks.ensureStoreLoaded?.();
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        console.error("[i-Nova Bookmarks] refresh state failed", error);
      }

      hooks.render();
    }

    async function syncRouteState(force = false) {
      const nextSessionId = namespace.session.getSessionId();
      const sessionChanged = nextSessionId !== state.sessionId;
      state.lastRouteKey = getRouteKey();
      if (!force && !sessionChanged) {
        return;
      }

      disconnectObserver();
      clearRouteRetryTimers();
      resetRouteState(nextSessionId, namespace.contentDom.getUserMessageSignature());
      hooks.render();
      if (!nextSessionId) {
        return;
      }

      state.observer = namespace.contentDom.observeMessages(scheduleRefresh);
      scheduleRouteRetryTimers();
      await refreshState();
    }

    function resetRouteState(nextSessionId, previousSignature) {
      state.sessionId = nextSessionId || "";
      state.sessionTitle = nextSessionId ? namespace.contentDom.getSessionTitle() : "";
      state.open = namespace.contentDom.getConversationState().hasComposer ? state.preferredOpen : false;
      state.activeId = "";
      state.bookmarks = [];
      state.lastError = "";
      state.routeBaselineSignature = nextSessionId ? previousSignature : "";
      state.awaitingRouteMessages = Boolean(nextSessionId);
      state.routeWaitStartedAt = nextSessionId ? Date.now() : 0;
    }

    function scheduleRouteRetryTimers() {
      [180, 500, 900, 1600, 2600].forEach((delay) => {
        state.routeRetryTimers.push(global.setTimeout(scheduleRefresh, delay));
      });
    }

    function clearRouteRetryTimers() {
      state.routeRetryTimers.forEach((timerId) => global.clearTimeout(timerId));
      state.routeRetryTimers = [];
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

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local") {
        return;
      }

      if (changes.settings) state.settings = { ...namespace.constants.defaults.settings, ...(changes.settings.newValue || {}) };
      if (changes.pausedSessions) state.pausedSessions = changes.pausedSessions.newValue || {};
      if (changes.uiPreferences) {
        state.uiPreferences = namespace.storage.mergeUiPreferences(changes.uiPreferences.newValue);
        state.uiPreferences.activePromptTab = normalizePromptTab(state.uiPreferences.activeTool === "store" ? "store" : state.uiPreferences.activePromptTab);
        state.activeTool = hooks.normalizeToolId(state.uiPreferences.activeTool || state.activeTool);
        if (isStoreTabActive()) hooks.ensureStoreLoaded?.();
      }
      if (changes.promptLibrary) state.promptLibrary = namespace.promptLibrary.mergePromptLibrary(changes.promptLibrary.newValue);
      scheduleRefresh();
    }

    function isPaused() {
      return Boolean(state.pausedSessions[state.sessionId]);
    }

    function isStoreTabActive() {
      return state.activeTool === "prompts" && state.uiPreferences.activePromptTab === "store";
    }

    function normalizePromptTab(value) {
      return value === "store" ? "store" : "library";
    }

    function disconnectObserver() {
      state.observer?.disconnect();
      state.observer = null;
    }

    function installRouteWatchers() {
      if (state.routeWatchInstalled) {
        return;
      }

      state.lastRouteKey = getRouteKey();
      wrapHistoryMethod("pushState");
      wrapHistoryMethod("replaceState");
      global.addEventListener("popstate", scheduleRouteSync);
      global.addEventListener("visibilitychange", () => document.visibilityState === "visible" && scheduleRouteSync());
      document.addEventListener("click", handleDocumentClick, true);
      startRoutePolling();
      state.routeWatchInstalled = true;
    }

    function wrapHistoryMethod(methodName) {
      const original = history[methodName];
      history[methodName] = function wrappedHistoryState(...args) {
        const result = original.apply(this, args);
        scheduleRouteSync();
        return result;
      };
    }

    function handleDocumentClick(event) {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("a, button, [role='button']")) {
        return;
      }

      global.setTimeout(scheduleRouteSync, 80);
      global.setTimeout(scheduleRouteSync, 350);
    }

    function startRoutePolling() {
      if (state.routePollTimer) {
        global.clearInterval(state.routePollTimer);
      }

      state.routePollTimer = global.setInterval(() => {
        const nextRouteKey = getRouteKey();
        if (nextRouteKey === state.lastRouteKey) {
          return;
        }

        state.lastRouteKey = nextRouteKey;
        scheduleRouteSync();
      }, 400);
    }

    function scheduleRouteSync() {
      global.setTimeout(() => syncRouteState().catch((error) => console.error("[i-Nova Bookmarks] route sync failed", error)), 0);
    }

    function getRouteKey() {
      return `${global.location.pathname}${global.location.search}`;
    }

    function logRefreshError(error) {
      console.error("[i-Nova Bookmarks] refresh failed", error);
    }
  }

  namespace.routeSync = {
    create,
  };
})(globalThis);
