(function initMeetingManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants.defaults.meetingHub;
  const ACTIVE_POLL_DELAY_MS = 1800;

  function create(state, hooks) {
    let inflight = false;
    let timerId = 0;

    return {
      handleRouteStateChange,
      handleStorageChange,
      refreshState,
      scheduleSync,
    };

    function handleRouteStateChange() {
      hooks.render?.();
    }

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local") {
        return;
      }
      if (changes.meetingHub) {
        state.meetingHub = mergeMeetingHub(changes.meetingHub.newValue);
        hooks.render?.();
        return;
      }
      if (changes.cloudSync) {
        scheduleSync(240);
      }
    }

    function scheduleSync(delay = ACTIVE_POLL_DELAY_MS) {
      global.clearTimeout(timerId);
      timerId = global.setTimeout(() => {
        refreshState().catch(logRefreshError);
      }, delay);
    }

    async function refreshState() {
      state.meetingHub = await namespace.storage.getMeetingHub();
      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity.available || inflight) {
        hooks.render?.();
        return state.meetingHub;
      }

      inflight = true;
      try {
        const listPayload = await namespace.meetingBridge.listMeetings(
          {
            limit: 24,
          },
          providerIdentity
        );
        state.meetingHub = await namespace.storage.setMeetingHub({
          checkedAt: new Date().toISOString(),
          error: "",
          items: Array.isArray(listPayload?.items) ? listPayload.items : [],
          version: Math.max(1, Number(state.meetingHub?.version) || 1),
        });
        hooks.render?.();
        return state.meetingHub;
      } catch (error) {
        const message = error instanceof Error ? error.message : "회의 목록을 불러오지 못했어요.";
        logRefreshError(error);
        state.meetingHub = await namespace.storage.setMeetingHub({
          checkedAt: new Date().toISOString(),
          error: message,
          items: Array.isArray(state.meetingHub?.items) ? state.meetingHub.items : [],
          version: Math.max(1, Number(state.meetingHub?.version) || 1),
        });
        hooks.render?.();
        return state.meetingHub;
      } finally {
        inflight = false;
      }
    }

    function logRefreshError(error) {
      if (isInvalidatedContextError(error)) {
        hooks.render?.();
        return;
      }
      console.error("[i-Nova Bookmarks] meeting hub refresh failed", error);
      hooks.render?.();
    }

    function isInvalidatedContextError(error) {
      const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
      return message.includes("Extension context invalidated")
        || message.includes("확장프로그램이 갱신됐어요.");
    }
  }

  function mergeMeetingHub(nextHub) {
    return {
      ...defaults,
      ...(nextHub && typeof nextHub === "object" ? nextHub : {}),
      items: Array.isArray(nextHub?.items) ? nextHub.items : [],
    };
  }

  namespace.meetingManager = {
    create,
    mergeMeetingHub,
  };
})(globalThis);
