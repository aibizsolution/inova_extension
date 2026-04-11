(function initHostedPanelRuntime(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEBUG_VIEWPORTS = new Map();
  const QUERY_PREVIEW_LENGTH = 120;

  namespace.constants = namespace.constants || {
    limits: {
      queryPreviewLength: QUERY_PREVIEW_LENGTH,
    },
  };

  namespace.session = namespace.session || {
    clipPreview,
    normalizeText,
  };

  namespace.panelDebug = namespace.panelDebug || {
    captureViewport(key, element) {
      const normalizedKey = normalizeText(key);
      if (!normalizedKey) {
        return;
      }
      DEBUG_VIEWPORTS.set(
        normalizedKey,
        namespace.meetingDebugConsole?.captureLogViewport?.(element) || null
      );
    },
    restoreViewport(key, element) {
      const normalizedKey = normalizeText(key);
      if (!normalizedKey) {
        return;
      }
      namespace.meetingDebugConsole?.restoreLogViewport?.(
        element,
        DEBUG_VIEWPORTS.get(normalizedKey) || null
      );
    },
  };

  function clipPreview(text) {
    const normalized = normalizeText(text);
    if (normalized.length <= QUERY_PREVIEW_LENGTH) {
      return normalized;
    }
    return `${normalized.slice(0, QUERY_PREVIEW_LENGTH - 1)}…`;
  }

  function normalizeText(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }
})(globalThis);
