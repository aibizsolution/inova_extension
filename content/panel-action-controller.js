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
        await panelDebugController.handleAction(action);
        return;
      }
      await panelMeetingController.handleAction(action, detail);
    }
  }

  namespace.panelActionController = { create };
})(globalThis);
