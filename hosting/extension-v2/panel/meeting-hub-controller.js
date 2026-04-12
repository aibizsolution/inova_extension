(function initMeetingHubController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create() {
    const state = {
      capabilities: [],
      lastCount: 0,
      settings: {
        meetingDebugConsoleEnabled: false,
      },
    };

    return {
      buildViewState,
      getMeetingCount,
      handleMeetingAction,
      hasRequiredCapabilities,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      if (!hasRequiredCapabilities()) {
        return;
      }
      state.settings = {
        ...state.settings,
        ...(panelState?.settings && typeof panelState.settings === "object" ? panelState.settings : {}),
      };
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getMeetingCount() {
      return state.lastCount;
    }

    function buildViewState(fallbackMeetingTool = {}) {
      if (!hasRequiredCapabilities()) {
        return fallbackMeetingTool;
      }
      const nextMeetingTool = fallbackMeetingTool && typeof fallbackMeetingTool === "object"
        ? fallbackMeetingTool
        : {};
      const items = Array.isArray(nextMeetingTool.items) ? nextMeetingTool.items.slice() : [];
      state.lastCount = Math.max(0, Number(nextMeetingTool.count) || items.length);
      return {
        ...nextMeetingTool,
        count: state.lastCount,
        items,
      };
    }

    function handleMeetingAction() {
      return false;
    }
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  namespace.meetingHubController = { create };
})(globalThis);
