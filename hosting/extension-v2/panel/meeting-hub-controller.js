(function initMeetingHubController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const INITIAL_SYNC_RETRY_MS = 1500;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const requestPanel = typeof options.requestPanel === "function"
      ? options.requestPanel
      : async () => ({});
    const state = {
      capabilities: [],
      lastCount: 0,
      lastSyncRequestedAt: 0,
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
      if (shouldRequestInitialSync(panelState?.activeTool, panelState?.meetingTool)) {
        state.lastSyncRequestedAt = Date.now();
        void requestPanel({
          action: "meeting-refresh",
        }).catch(() => {});
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

    async function handleMeetingAction() {
      return false;
    }

    function shouldRequestInitialSync(activeTool, meetingTool) {
      if (normalizeText(activeTool) !== "meeting") {
        return false;
      }
      const normalizedMeetingTool = meetingTool && typeof meetingTool === "object"
        ? meetingTool
        : {};
      if (normalizeText(normalizedMeetingTool.checkedAt) || normalizeText(normalizedMeetingTool.error)) {
        return false;
      }
      if (Array.isArray(normalizedMeetingTool.items) && normalizedMeetingTool.items.length) {
        return false;
      }
      return Date.now() - state.lastSyncRequestedAt >= INITIAL_SYNC_RETRY_MS;
    }
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  namespace.meetingHubController = { create };
})(globalThis);
