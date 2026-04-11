(function initRouteWatchController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const scheduleRouteSync = typeof deps.scheduleRouteSync === "function"
      ? deps.scheduleRouteSync
      : () => {};

    return {
      installRouteWatchers,
    };

    function installRouteWatchers() {
      if (state.routeWatchInstalled) {
        return;
      }

      state.lastRouteKey = getRouteKey();
      wrapHistoryMethod("pushState");
      wrapHistoryMethod("replaceState");
      global.addEventListener("popstate", () => scheduleRouteSync("popstate"));
      global.addEventListener("visibilitychange", () => global.document.visibilityState === "visible" && scheduleRouteSync("visibility"));
      global.document.addEventListener("click", handleDocumentClick, true);
      startRoutePolling();
      state.routeWatchInstalled = true;
    }

    function wrapHistoryMethod(methodName) {
      const original = global.history[methodName];
      global.history[methodName] = function wrappedHistoryState(...args) {
        const result = original.apply(this, args);
        scheduleRouteSync(`history.${methodName}`);
        return result;
      };
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

    function getRouteKey() {
      return `${global.location.pathname}${global.location.search}`;
    }
  }

  namespace.routeWatchController = { create };
})(globalThis);
