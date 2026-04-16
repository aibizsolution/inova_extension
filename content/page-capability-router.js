(function initPanelPageCapabilityRouter(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.session.normalizeText;
  const PAGE_CAPABILITY_MANIFEST = deepFreeze({
    "clipboard.write-text": { adapter: "clipboard.write-text" },
    "composer.apply-text": { adapter: "composer.apply-text" },
    "composer.read-state": { adapter: "composer.read-state" },
    "conversation.jump-item": { adapter: "conversation.jump-item" },
    "conversation.read-state": { adapter: "conversation.read-state" },
    "debug.clear-log": { adapter: "debug.clear-log" },
    "debug.copy-log": { adapter: "debug.copy-log" },
    "debug.read-state": { adapter: "debug.read-state" },
    "debug.set-enabled": { adapter: "debug.set-enabled" },
    "trace.log": { adapter: "trace.log" },
  });
  const PAGE_CAPABILITY_ADAPTERS = Object.freeze({
    "clipboard.write-text": writeClipboardText,
    "composer.apply-text": applyComposerText,
    "composer.read-state": readComposerState,
    "conversation.jump-item": jumpConversationItem,
    "conversation.read-state": readConversationState,
    "debug.clear-log": clearDebugLog,
    "debug.copy-log": copyDebugLog,
    "debug.read-state": readDebugState,
    "debug.set-enabled": setDebugEnabled,
    "trace.log": logTrace,
  });

  function handle(payload, helpers = {}) {
    const action = normalizeText(payload?.action);
    const capability = PAGE_CAPABILITY_MANIFEST[action];
    if (!capability) {
      return Promise.resolve({
        handled: false,
        result: null,
      });
    }
    const adapter = PAGE_CAPABILITY_ADAPTERS[normalizeText(capability.adapter)];
    if (typeof adapter !== "function") {
      throw new Error("page capability adapter를 찾지 못했어요.");
    }
    return Promise.resolve(adapter(payload, buildPageCapabilityContext(helpers))).then((result) => ({
      handled: true,
      result,
    }));
  }

  function buildPageCapabilityContext(helpers = {}) {
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
    return {
      buildConversationSnapshot,
      buildDebugState,
      copyDebugLog,
      logConsoleTrace,
    };
  }

  function writeClipboardText(payload) {
    const text = String(payload?.text || "");
    if (!text) {
      return { copied: false };
    }
    return global.navigator.clipboard.writeText(text).then(() => ({ copied: true }));
  }

  function copyDebugLog(payload, context) {
    return context.copyDebugLog(Boolean(payload?.errorsOnly));
  }

  function clearDebugLog(_payload, context) {
    namespace.panelDebug?.clearEntries?.();
    return context.buildDebugState();
  }

  function logTrace(payload, context) {
    context.logConsoleTrace(
      normalizeText(payload?.channel) || "trace",
      normalizeText(payload?.step) || "trace",
      payload?.payload && typeof payload.payload === "object" ? payload.payload : {}
    );
    return { logged: true };
  }

  function readComposerState() {
    return namespace.composer?.getComposerState?.() || { available: false, text: "" };
  }

  function applyComposerText(payload) {
    return {
      applied: Boolean(namespace.composer?.applyPromptText?.(String(payload?.text || ""), normalizeText(payload?.mode) || "replace")),
    };
  }

  function readConversationState(_payload, context) {
    return context.buildConversationSnapshot();
  }

  function jumpConversationItem(payload) {
    const bookmarkId = normalizeText(payload?.bookmarkId || payload?.itemId);
    if (!bookmarkId) {
      return { jumped: false };
    }
    namespace.contentPanel.setActiveBookmark(bookmarkId);
    namespace.contentPanel.focusBookmark(bookmarkId);
    return {
      jumped: Boolean(namespace.contentDom?.scrollToMessage?.(bookmarkId, {
        behavior: "smooth",
        block: "start",
      })),
    };
  }

  function readDebugState(_payload, context) {
    return context.buildDebugState();
  }

  function setDebugEnabled(payload, context) {
    namespace.panelDebug?.setEnabled?.(Boolean(payload?.enabled));
    return context.buildDebugState();
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

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  namespace.panelPageCapabilityRouter = {
    handle,
    manifest: PAGE_CAPABILITY_MANIFEST,
  };
})(globalThis);
