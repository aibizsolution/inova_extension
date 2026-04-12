(function initPanelHostedMeetingRequest(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function handle(action, payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    const logConsoleTrace = typeof helpers.logConsoleTrace === "function"
      ? helpers.logConsoleTrace
      : () => {};
    const detail = payload?.detail && typeof payload.detail === "object" ? payload.detail : {};

    if (action === "meeting-action") {
      logConsoleTrace("meeting", "50.top.panel.request.received", {
        detail,
        meetingAction: normalizeText(payload?.meetingAction),
      });
      return Promise.resolve(callbacks.onMeetingAction?.(normalizeText(payload?.meetingAction), detail))
        .then(() => {
          logConsoleTrace("meeting", "59.top.panel.request.completed", {
            detail,
            meetingAction: normalizeText(payload?.meetingAction),
          });
          return {
            handled: true,
            result: { handled: true },
          };
        })
        .catch((error) => {
          logConsoleTrace("meeting", "59.top.panel.request.error", {
            detail,
            error: normalizeText(error instanceof Error ? error.message : String(error || "")),
            meetingAction: normalizeText(payload?.meetingAction),
          });
          throw error;
        });
    }

    if (action === "meeting-summary-sync") {
      const meetingTool = payload?.meetingTool && typeof payload.meetingTool === "object"
        ? payload.meetingTool
        : {};
      return Promise.resolve(callbacks.onMeetingSummarySync?.(meetingTool)).then(() => ({
        handled: true,
        result: { handled: true },
      }));
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  namespace.panelHostedMeetingRequest = { handle };
})(globalThis);
