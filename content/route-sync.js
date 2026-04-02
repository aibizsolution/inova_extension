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
      logDebug("route.refresh.start", {
        scope: "route",
        sessionId: state.sessionId,
      });
      try {
        const storageState = await namespace.storage.getState();
        state.settings = storageState.settings || { ...namespace.constants.defaults.settings };
        state.pausedSessions = storageState.pausedSessions || {};
        state.uiPreferences = applyUiPreferenceLock(namespace.storage.mergeUiPreferences(storageState.uiPreferences));
        state.uiPreferences.activePromptTab = normalizePromptTab(state.uiPreferences.activeTool === "store" ? "store" : state.uiPreferences.activePromptTab);
        state.activeTool = hooks.normalizeToolId(state.uiPreferences.activeTool || state.activeTool);
        state.promptLibrary = namespace.promptLibrary.mergePromptLibrary(storageState.promptLibrary);
        if (state.sessionId) {
          state.sessionTitle = namespace.contentDom.getSessionTitle();
        }
        state.bookmarks = readLiveBookmarks();
        state.lastError = "";
        if (isStoreTabActive()) hooks.ensureStoreLoaded?.();
        logDebug("route.refresh.success", {
          activeTool: state.activeTool,
          bookmarkCount: state.bookmarks.length,
          scope: "route",
          sessionId: state.sessionId,
        });
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        logDebug("route.refresh.error", {
          error: state.lastError,
          scope: "route",
          sessionId: state.sessionId,
        });
        console.error("[i-Nova Bookmarks] refresh state failed", error);
      }

      hooks.render();
    }

    async function syncRouteState(force = false, reason = "manual") {
      const nextSessionId = namespace.session.getSessionId();
      const sessionChanged = nextSessionId !== state.sessionId;
      state.lastRouteKey = getRouteKey();
      logDebug("route.sync.start", {
        force: Boolean(force),
        reason,
        scope: "route",
        sessionChanged,
        sessionId: nextSessionId,
      });
      if (!force && !sessionChanged) {
        logDebug("route.sync.skipped", {
          reason,
          scope: "route",
          sessionId: nextSessionId,
        });
        return;
      }

      disconnectObserver();
      clearRouteRetryTimers();
      resetRouteState(nextSessionId, namespace.contentDom.getUserMessageSignature());
      hooks.render();
      if (!nextSessionId) {
        logDebug("route.sync.empty", {
          force: Boolean(force),
          reason,
          scope: "route",
        });
        hooks.onRouteStateChanged?.({
          force,
          sessionChanged,
          sessionId: state.sessionId,
        });
        return;
      }

      state.observer = namespace.contentDom.observeMessages(scheduleRefresh);
      scheduleRouteRetryTimers();
      await refreshState();
      logDebug("route.sync.success", {
        force: Boolean(force),
        reason,
        scope: "route",
        sessionChanged,
        sessionId: state.sessionId,
      });
      hooks.onRouteStateChanged?.({
        force,
        sessionChanged,
        sessionId: state.sessionId,
      });
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
        state.uiPreferences = applyUiPreferenceLock(namespace.storage.mergeUiPreferences(changes.uiPreferences.newValue));
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
      return value === "store" || value === "review" ? value : "library";
    }

    function applyUiPreferenceLock(uiPreferences) {
      const lock = state.uiPreferenceLock;
      if (!lock) {
        return uiPreferences;
      }
      if ((Number(lock.until) || 0) <= Date.now()) {
        state.uiPreferenceLock = null;
        return uiPreferences;
      }
      return {
        ...uiPreferences,
        activePromptTab: normalizePromptTab(lock.activePromptTab),
        activeTool: hooks.normalizeToolId(lock.activeTool || uiPreferences.activeTool),
      };
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
      global.addEventListener("popstate", () => scheduleRouteSync("popstate"));
      global.addEventListener("visibilitychange", () => document.visibilityState === "visible" && scheduleRouteSync("visibility"));
      document.addEventListener("click", handleDocumentClick, true);
      startRoutePolling();
      state.routeWatchInstalled = true;
    }

    function wrapHistoryMethod(methodName) {
      const original = history[methodName];
      history[methodName] = function wrappedHistoryState(...args) {
        const result = original.apply(this, args);
        scheduleRouteSync(`history.${methodName}`);
        return result;
      };
    }

    function handleDocumentClick(event) {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("a, button, [role='button']")) {
        return;
      }

      global.setTimeout(() => scheduleRouteSync("click.80"), 80);
      global.setTimeout(() => scheduleRouteSync("click.350"), 350);
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
        scheduleRouteSync("poll");
      }, 400);
    }

    function scheduleRouteSync(reason = "scheduled") {
      global.setTimeout(() => syncRouteState(false, reason).catch((error) => console.error("[i-Nova Bookmarks] route sync failed", error)), 0);
    }

    function getRouteKey() {
      return `${global.location.pathname}${global.location.search}`;
    }

    function logRefreshError(error) {
      logDebug("route.schedule.error", {
        error: error instanceof Error ? error.message : String(error || ""),
        scope: "route",
      });
      console.error("[i-Nova Bookmarks] refresh failed", error);
    }

    function logDebug(event, payload) {
      namespace.panelDebug?.log?.(event, payload || {});
    }
  }

  namespace.routeSync = {
    create,
  };
})(globalThis);
