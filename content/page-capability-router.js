(function initPanelPageCapabilityRouter(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.session?.normalizeText || ((value) => String(value ?? "").trim());

  function handle(payload, helpers = {}) {
    const action = normalizeText(payload?.action);
    const buildConversationSnapshot = typeof helpers.buildConversationSnapshot === "function"
      ? helpers.buildConversationSnapshot
      : defaultBuildConversationSnapshot;
    const buildDebugState = typeof helpers.buildDebugState === "function"
      ? helpers.buildDebugState
      : defaultBuildDebugState;
    const copyDebugLog = typeof helpers.copyDebugLog === "function"
      ? helpers.copyDebugLog
      : defaultCopyDebugLog;
    const logConsoleTrace = typeof helpers.logConsoleTrace === "function"
      ? helpers.logConsoleTrace
      : () => {};

    if (action === "clipboard.write-text") {
      const text = String(payload?.text || "");
      if (!text) {
        return Promise.resolve({
          handled: true,
          result: { copied: false },
        });
      }
      return global.navigator.clipboard.writeText(text).then(() => ({
        handled: true,
        result: { copied: true },
      }));
    }

    if (action === "debug.copy-log") {
      return Promise.resolve(copyDebugLog(Boolean(payload?.errorsOnly))).then((result) => ({
        handled: true,
        result,
      }));
    }

    if (action === "debug.clear-log") {
      namespace.panelDebug?.clearEntries?.();
      return Promise.resolve({
        handled: true,
        result: buildDebugState(),
      });
    }

    if (action === "trace.log") {
      logConsoleTrace(
        normalizeText(payload?.channel) || "trace",
        normalizeText(payload?.step) || "trace",
        payload?.payload && typeof payload.payload === "object" ? payload.payload : {}
      );
      return Promise.resolve({
        handled: true,
        result: { logged: true },
      });
    }

    if (action === "composer.read-state") {
      return Promise.resolve({
        handled: true,
        result: namespace.composer?.getComposerState?.() || { available: false, text: "" },
      });
    }

    if (action === "composer.apply-text") {
      return Promise.resolve({
        handled: true,
        result: {
          applied: Boolean(namespace.composer?.applyPromptText?.(String(payload?.text || ""), normalizeText(payload?.mode) || "replace")),
        },
      });
    }

    if (action === "conversation.read-state") {
      return Promise.resolve({
        handled: true,
        result: buildConversationSnapshot(),
      });
    }

    if (action === "conversation.jump-item") {
      const bookmarkId = normalizeText(payload?.bookmarkId || payload?.itemId);
      if (!bookmarkId) {
        return Promise.resolve({
          handled: true,
          result: { jumped: false },
        });
      }
      namespace.contentPanel.setActiveBookmark(bookmarkId);
      namespace.contentPanel.focusBookmark(bookmarkId);
      return Promise.resolve({
        handled: true,
        result: {
          jumped: Boolean(namespace.contentDom?.scrollToMessage?.(bookmarkId, {
            behavior: "smooth",
            block: "start",
          })),
        },
      });
    }

    if (action === "debug.read-state") {
      return Promise.resolve({
        handled: true,
        result: buildDebugState(),
      });
    }

    if (action === "debug.set-enabled") {
      namespace.panelDebug?.setEnabled?.(Boolean(payload?.enabled));
      return Promise.resolve({
        handled: true,
        result: buildDebugState(),
      });
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  async function defaultCopyDebugLog(errorsOnly) {
    const entries = namespace.panelDebug?.getEntries?.() || [];
    const text = errorsOnly
      ? namespace.panelDebug?.buildErrorCopyText?.(entries)
      : namespace.panelDebug?.buildCopyText?.(entries);
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      return {
        copied: false,
        text: "",
      };
    }
    await global.navigator.clipboard.writeText(normalizedText);
    return {
      copied: true,
      text: normalizedText,
    };
  }

  function defaultBuildConversationSnapshot() {
    const sessionId = namespace.session?.getSessionId?.() || "";
    const items = namespace.contentDom?.collectUserMessages?.(sessionId) || [];
    return {
      conversation: cloneValue(namespace.contentDom?.getConversationState?.() || {}),
      items: cloneValue(items),
      sessionId,
      sessionTitle: normalizeText(namespace.contentDom?.getSessionTitle?.())
        || namespace.session?.formatSessionLabel?.(sessionId)
        || "현재 세션",
      visibleMessageId: normalizeText(namespace.contentDom?.getVisibleMessageId?.(items)),
    };
  }

  function defaultBuildDebugState() {
    const entries = namespace.panelDebug?.getEntries?.() || [];
    const statusSummary = namespace.panelDebug?.summarizeEntries?.(entries) || {};
    return {
      enabled: Boolean(namespace.panelDebug?.isEnabled?.()),
      entries: cloneValue(entries),
      errorsText: String(namespace.panelDebug?.buildErrorCopyText?.(entries) || ""),
      hasErrors: Math.max(0, Number(statusSummary.errorCount) || 0) > 0,
      statusSummary: cloneValue(statusSummary),
      text: String(namespace.panelDebug?.buildCopyText?.(entries) || ""),
    };
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.panelPageCapabilityRouter = { handle };
})(globalThis);
