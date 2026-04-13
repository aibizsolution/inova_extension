(function initPanelHostedShellRequest(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function handle(action, payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    const detail = payload?.detail && typeof payload.detail === "object" ? payload.detail : {};

    if (action === "toggle-panel") {
      callbacks.onToggle?.(payload?.open);
      return Promise.resolve({
        handled: true,
        result: { open: payload?.open !== false },
      });
    }

    if (action === "escape") {
      const consumed = Boolean(callbacks.onEscape?.());
      if (!consumed) {
        callbacks.onToggle?.(false);
      }
      return Promise.resolve({
        handled: true,
        result: { consumed },
      });
    }

    if (action === "select-tool") {
      return Promise.resolve(callbacks.onSelectTool?.(normalizeText(payload?.toolId))).then((selected) => ({
        handled: true,
        result: { selected: Boolean(selected) },
      }));
    }

    if (action === "search") {
      callbacks.onSearch?.(normalizeText(payload?.toolId), String(payload?.value || ""), payload?.options || {});
      return Promise.resolve({
        handled: true,
        result: { searched: true },
      });
    }

    if (action === "search-submit") {
      callbacks.onSearchSubmit?.(normalizeText(payload?.toolId), String(payload?.value || ""));
      return Promise.resolve({
        handled: true,
        result: { submitted: true },
      });
    }

    if (action === "bookmark-copy") {
      return Promise.resolve(callbacks.onCopyBookmark?.(normalizeText(payload?.bookmarkId))).then((copied) => ({
        handled: true,
        result: { copied: Boolean(copied) },
      }));
    }

    if (action === "bookmark-jump") {
      callbacks.onJumpBookmark?.(normalizeText(payload?.bookmarkId));
      return Promise.resolve({
        handled: true,
        result: { jumped: true },
      });
    }

    if (action === "release-summary-sync") {
      const releaseTool = payload?.releaseTool && typeof payload.releaseTool === "object"
        ? payload.releaseTool
        : {};
      return Promise.resolve(callbacks.onReleaseSummarySync?.(releaseTool)).then(() => ({
        handled: true,
        result: { handled: true },
      }));
    }

    if (action === "release-action") {
      return Promise.resolve(callbacks.onReleaseAction?.(normalizeText(payload?.releaseAction), detail)).then(() => ({
        handled: true,
        result: { handled: true },
      }));
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  namespace.panelHostedShellRequest = { handle };
})(globalThis);
