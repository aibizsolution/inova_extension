(function initPanelHostedPromptRequest(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function handle(action, payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    const detail = payload?.detail && typeof payload.detail === "object" ? payload.detail : {};

    if (action === "prompt-action") {
      callbacks.onPromptAction?.(normalizeText(payload?.promptAction), detail);
      return Promise.resolve({
        handled: true,
        result: { handled: true },
      });
    }

    if (action === "prompt-draft-change") {
      callbacks.onPromptDraftChange?.(normalizeText(payload?.field), payload?.value);
      return Promise.resolve({
        handled: true,
        result: { handled: true },
      });
    }

    if (action === "prompt-tab-select") {
      callbacks.onSelectPromptTab?.(normalizeText(payload?.promptTabId));
      return Promise.resolve({
        handled: true,
        result: { handled: true },
      });
    }

    if (action === "store-action") {
      callbacks.onStoreAction?.(normalizeText(payload?.storeAction), detail);
      return Promise.resolve({
        handled: true,
        result: { handled: true },
      });
    }

    if (action === "import-file") {
      const file = payload?.file instanceof global.File ? payload.file : null;
      if (!file) {
        throw new Error("가져올 파일을 찾지 못했어요.");
      }
      return Promise.resolve(callbacks.onImportFile?.(file)).then(() => ({
        handled: true,
        result: { imported: true },
      }));
    }

    if (action === "move-prompt") {
      callbacks.onMovePrompt?.(
        normalizeText(payload?.dragPromptId),
        normalizeText(payload?.targetPromptId),
        normalizeText(payload?.placement) || "before"
      );
      return Promise.resolve({
        handled: true,
        result: { handled: true },
      });
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  namespace.panelHostedPromptRequest = { handle };
})(globalThis);
