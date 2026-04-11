(function initRouteSync(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, hooks) {
    const refreshState = typeof hooks.refreshState === "function"
      ? hooks.refreshState
      : async () => {};
    const resetRouteState = typeof hooks.resetRouteState === "function"
      ? hooks.resetRouteState
      : () => {};

    return {
      scheduleRefresh,
      scheduleRouteSync,
      syncRouteState,
    };

    function scheduleRefresh() {
      global.clearTimeout(state.syncTimer);
      state.syncTimer = global.setTimeout(() => {
        refreshState()
          .then(() => hooks.render())
          .catch(logRefreshError);
      }, 120);
    }

    async function syncRouteState(force = false, reason = "manual") {
      const nextSessionId = namespace.session.getSessionId();
      const sessionChanged = nextSessionId !== state.sessionId;
      const quietClickProbe = shouldSkipSyncDebugLog(force, reason, sessionChanged);
      state.lastRouteKey = getRouteKey();
      if (!quietClickProbe) {
        logDebug("route.sync.start", {
          force: Boolean(force),
          reason,
          scope: "route",
          sessionChanged,
          sessionId: nextSessionId,
        });
      }
      if (!force && !sessionChanged) {
        if (!quietClickProbe) {
          logDebug("route.sync.skipped", {
            reason,
            scope: "route",
            sessionId: nextSessionId,
          });
        }
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
      hooks.render();
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

    function scheduleRouteRetryTimers() {
      [180, 500, 900, 1600, 2600].forEach((delay) => {
        state.routeRetryTimers.push(global.setTimeout(scheduleRefresh, delay));
      });
    }

    function clearRouteRetryTimers() {
      state.routeRetryTimers.forEach((timerId) => global.clearTimeout(timerId));
      state.routeRetryTimers = [];
    }

    function disconnectObserver() {
      state.observer?.disconnect();
      state.observer = null;
    }

    function scheduleRouteSync(reason = "scheduled") {
      global.setTimeout(() => syncRouteState(false, reason).catch((error) => console.error("[i-Nova Bookmarks] route sync failed", error)), 0);
    }

    function shouldSkipSyncDebugLog(force, reason, sessionChanged) {
      return !force && !sessionChanged && isQuietSyncReason(reason);
    }

    function isQuietSyncReason(reason) {
      const normalized = String(reason || "").trim();
      return normalized === "click.80"
        || normalized === "click.350"
        || normalized === "visibility";
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
