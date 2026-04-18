(function initRouteWatchController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const ROUTE_WATCH_RUNTIME_KEY = "__inovaRouteWatchRuntime";

  function create(state, deps = {}) {
    const scheduleRouteSync = typeof deps.scheduleRouteSync === "function"
      ? deps.scheduleRouteSync
      : () => {};
    const routeWatchRuntime = getRouteWatchRuntime();

    return {
      installRouteWatchers,
    };

    function installRouteWatchers() {
      routeWatchRuntime.scheduleRouteSync = scheduleRouteSync;
      routeWatchRuntime.state = state;
      if (state.routeWatchInstalled) {
        return;
      }

      state.lastRouteKey = getRouteKey();
      installGlobalRouteWatchers();
      state.routeWatchInstalled = true;
    }

    function installGlobalRouteWatchers() {
      if (routeWatchRuntime.installed) {
        return;
      }
      wrapHistoryMethod("pushState");
      wrapHistoryMethod("replaceState");
      global.addEventListener("popstate", handlePopstate);
      global.addEventListener("visibilitychange", handleVisibilityChange);
      global.document.addEventListener("click", handleDocumentClick, true);
      startRoutePolling();
      routeWatchRuntime.installed = true;
    }

    function wrapHistoryMethod(methodName) {
      const original = global.history[methodName];
      if (original?.__inovaRouteWatchWrapped) {
        return;
      }
      global.history[methodName] = function wrappedHistoryState(...args) {
        const result = original.apply(this, args);
        routeWatchRuntime.scheduleRouteSync(`history.${methodName}`);
        return result;
      };
      Object.defineProperty(global.history[methodName], "__inovaRouteWatchWrapped", {
        value: true,
      });
    }

    function handlePopstate() {
      routeWatchRuntime.scheduleRouteSync("popstate");
    }

    function handleVisibilityChange() {
      if (global.document.visibilityState === "visible") {
        routeWatchRuntime.scheduleRouteSync("visibility");
      }
    }

    function handleDocumentClick(event) {
      const target = event.target;
      if (!(target instanceof global.Element) || !target.closest("a, button, [role='button']")) {
        return;
      }

      global.setTimeout(() => scheduleRouteSync("click.80"), 80);
      global.setTimeout(() => scheduleRouteSync("click.350"), 350);
    }

    function startRoutePolling() {
      if (routeWatchRuntime.routePollTimer) {
        global.clearInterval(routeWatchRuntime.routePollTimer);
      }

      routeWatchRuntime.routePollTimer = global.setInterval(() => {
        const currentState = routeWatchRuntime.state || state;
        const nextRouteKey = getRouteKey();
        if (nextRouteKey === currentState.lastRouteKey) {
          return;
        }

        currentState.lastRouteKey = nextRouteKey;
        routeWatchRuntime.scheduleRouteSync("poll");
      }, 400);
      state.routePollTimer = routeWatchRuntime.routePollTimer;
    }

    function getRouteKey() {
      return `${global.location.pathname}${global.location.search}`;
    }
  }

  function getRouteWatchRuntime() {
    if (global[ROUTE_WATCH_RUNTIME_KEY]) {
      return global[ROUTE_WATCH_RUNTIME_KEY];
    }
    const routeWatchRuntime = {
      installed: false,
      routePollTimer: 0,
      scheduleRouteSync: () => {},
      state: null,
    };
    Object.defineProperty(global, ROUTE_WATCH_RUNTIME_KEY, {
      configurable: false,
      value: routeWatchRuntime,
    });
    return routeWatchRuntime;
  }

  namespace.routeWatchController = { create };
})(globalThis);
