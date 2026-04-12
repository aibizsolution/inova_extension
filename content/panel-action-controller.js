(function initPanelActionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(_state, deps = {}) {
    const panelDebugController = deps.panelDebugController || {
      handleAction: async () => {},
      handlesAction: () => false,
    };
    const panelMeetingController = deps.panelMeetingController || { handleAction: async () => {} };

    return {
      handlePanelMeetingAction,
    };

    async function handlePanelMeetingAction(action, detail = {}) {
      if (panelDebugController.handlesAction(action)) {
        traceMeetingFlow("51.top.debug.action", {
          action,
        });
        await panelDebugController.handleAction(action);
        return;
      }
      traceMeetingFlow("52.top.panel.action.dispatch", {
        action,
        detail,
      });
      await panelMeetingController.handleAction(action, detail);
    }
  }

  function traceMeetingFlow(step, payload = {}) {
    if (!namespace.panelDebug?.isEnabled?.()) {
      return false;
    }
    const detail = payload && typeof payload === "object" ? payload : {};
    if (namespace.panelConsoleTrace?.log) {
      return namespace.panelConsoleTrace.log("meeting", step, detail);
    }
    console.info(`[inova:meeting] ${namespace.session.normalizeText(step) || "trace"}`, detail);
    namespace.panelDebug?.log?.(`trace.meeting.${namespace.session.normalizeText(step) || "trace"}`, detail);
    return true;
  }

  namespace.panelActionController = { create };
})(globalThis);
