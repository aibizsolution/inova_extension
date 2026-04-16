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
    "page.dispatch-named-event": { adapter: "page.dispatch-named-event" },
    "page.highlight-range": { adapter: "page.highlight-range" },
    "page.read-selection": { adapter: "page.read-selection" },
    "page.scroll-to": { adapter: "page.scroll-to" },
    "page.show-banner": { adapter: "page.show-banner" },
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
    "page.dispatch-named-event": dispatchNamedPageEvent,
    "page.highlight-range": highlightPageRange,
    "page.read-selection": readPageSelection,
    "page.scroll-to": scrollToPageTarget,
    "page.show-banner": showPageBanner,
    "trace.log": logTrace,
  });
  const PAGE_SCROLL_TARGETS = deepFreeze({
    "composer": { target: "composer" },
    "conversation.latest": { target: "conversation.latest" },
    "conversation.start": { target: "conversation.start" },
    "panel.handle": { target: "panel.handle" },
    "panel.host": { target: "panel.host" },
  });
  const PAGE_HIGHLIGHT_RANGES = deepFreeze({
    "composer": { target: "composer" },
    "conversation.latest": { target: "conversation.latest" },
    "conversation.visible": { target: "conversation.visible" },
    "panel.host": { target: "panel.host" },
  });
  const PAGE_BANNER_TEMPLATES = deepFreeze({
    "runtime.error": { tone: "error", fallbackText: "요청을 처리하지 못했어요." },
    "runtime.info": { tone: "info", fallbackText: "요청을 처리했어요." },
    "runtime.warning": { tone: "warning", fallbackText: "일부 기능이 제한되어 있어요." },
  });
  const PAGE_NAMED_EVENTS = deepFreeze({
    "panel.external-toggle": { action: "external-toggle", domain: "panel" },
  });
  const PAGE_CAPABILITY_STYLE_ID = "inova-page-capability-style";
  const PAGE_CAPABILITY_BANNER_ID = "inova-page-capability-banner";

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

  function scrollToPageTarget(payload) {
    const targetKey = normalizeText(payload?.targetKey);
    const definition = readAllowedDefinition(PAGE_SCROLL_TARGETS, targetKey, "page targetKey");
    const element = resolveNamedPageElement(definition);
    if (!element) {
      return { scrolled: false, targetKey };
    }
    element.scrollIntoView?.({
      behavior: normalizeText(payload?.behavior) === "smooth" ? "smooth" : "auto",
      block: normalizeText(payload?.block) === "center" ? "center" : "start",
    });
    return { scrolled: true, targetKey };
  }

  function highlightPageRange(payload) {
    const selectionKey = normalizeText(payload?.selectionKey);
    const definition = readAllowedDefinition(PAGE_HIGHLIGHT_RANGES, selectionKey, "page selectionKey");
    const element = resolveNamedPageElement(definition);
    if (!element) {
      return { highlighted: false, selectionKey };
    }
    ensurePageCapabilityStyle();
    element.classList.add("inova-page-capability-highlight");
    global.setTimeout(() => {
      element.classList.remove("inova-page-capability-highlight");
    }, clampDuration(payload?.durationMs, 1400, 5000));
    return { highlighted: true, selectionKey };
  }

  function showPageBanner(payload) {
    const templateKey = normalizeText(payload?.templateKey);
    const template = readAllowedDefinition(PAGE_BANNER_TEMPLATES, templateKey, "page banner templateKey");
    const params = payload?.params && typeof payload.params === "object" ? payload.params : {};
    assertNoRawBannerPayload(params);
    const message = normalizeBannerText(params.message || params.text || template.fallbackText);
    ensurePageCapabilityStyle();
    const banner = ensurePageCapabilityBanner();
    banner.dataset.tone = template.tone;
    banner.textContent = message;
    banner.hidden = false;
    global.clearTimeout(banner.__inovaHideTimer);
    banner.__inovaHideTimer = global.setTimeout(() => {
      banner.hidden = true;
      banner.textContent = "";
      banner.dataset.tone = "";
    }, clampDuration(payload?.durationMs, 2200, 8000));
    return { shown: true, templateKey };
  }

  function readPageSelection() {
    const text = normalizeSelectionText(global.getSelection?.().toString() || "");
    return {
      length: text.length,
      text,
      truncated: text.length >= 4000,
    };
  }

  function dispatchNamedPageEvent(payload) {
    const eventKey = normalizeText(payload?.eventKey);
    const definition = readAllowedDefinition(PAGE_NAMED_EVENTS, eventKey, "page eventKey");
    if (definition.domain === "panel") {
      return {
        dispatched: Boolean(namespace.contentPanel?.emitPanelEvent?.(definition.action, {
          eventKey,
          source: "page-capability",
        })),
        eventKey,
      };
    }
    return { dispatched: false, eventKey };
  }

  function readAllowedDefinition(catalog, key, label) {
    if (!key || !Object.prototype.hasOwnProperty.call(catalog, key)) {
      throw new Error(`허용되지 않은 ${label}예요.`);
    }
    return catalog[key];
  }

  function resolveNamedPageElement(definition) {
    const target = normalizeText(definition?.target);
    const selectors = namespace.constants?.selectors || {};
    if (target === "composer") {
      return querySelectorSafe(selectors.composer);
    }
    if (target === "conversation.start") {
      return querySelectorSafe(selectors.userMessage) || querySelectorSafe(selectors.chatLog);
    }
    if (target === "conversation.latest") {
      return querySelectorAllSafe(selectors.userMessage).at(-1) || querySelectorSafe(selectors.chatLog);
    }
    if (target === "conversation.visible") {
      const sessionId = namespace.session?.getSessionId?.() || "";
      const items = namespace.contentDom?.collectUserMessages?.(sessionId) || [];
      const visibleMessageId = normalizeText(namespace.contentDom?.getVisibleMessageId?.(items));
      return visibleMessageId
        ? document.querySelector(`[data-inova-bookmark-id="${CSS.escape(visibleMessageId)}"]`)
        : null;
    }
    if (target === "panel.handle") {
      return document.getElementById("inova-bookmark-handle");
    }
    if (target === "panel.host") {
      return document.getElementById("inova-bookmark-host");
    }
    return null;
  }

  function querySelectorSafe(selector) {
    return normalizeText(selector) ? document.querySelector(selector) : null;
  }

  function querySelectorAllSafe(selector) {
    return normalizeText(selector) ? Array.from(document.querySelectorAll(selector)) : [];
  }

  function ensurePageCapabilityBanner() {
    let banner = document.getElementById(PAGE_CAPABILITY_BANNER_ID);
    if (!(banner instanceof HTMLElement)) {
      banner = document.createElement("div");
      banner.id = PAGE_CAPABILITY_BANNER_ID;
      banner.hidden = true;
      banner.setAttribute("role", "status");
      document.body.appendChild(banner);
    }
    return banner;
  }

  function ensurePageCapabilityStyle() {
    if (document.getElementById(PAGE_CAPABILITY_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = PAGE_CAPABILITY_STYLE_ID;
    style.textContent = [
      ".inova-page-capability-highlight { outline: 3px solid rgba(15, 124, 137, 0.45) !important; outline-offset: 4px !important; transition: outline-color 160ms ease; }",
      "#inova-page-capability-banner { position: fixed; left: 50%; bottom: 22px; z-index: 2147483647; max-width: min(520px, calc(100vw - 32px)); transform: translateX(-50%); padding: 10px 14px; border: 1px solid rgba(15, 124, 137, 0.25); border-radius: 8px; background: #f5fbfc; color: #12333a; box-shadow: 0 10px 24px rgba(11, 31, 36, 0.16); font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }",
      '#inova-page-capability-banner[data-tone="warning"] { border-color: rgba(140, 95, 20, 0.32); background: #fff8e8; color: #51380c; }',
      '#inova-page-capability-banner[data-tone="error"] { border-color: rgba(138, 51, 68, 0.32); background: #fff1f4; color: #5a2030; }',
    ].join("\n");
    document.head.appendChild(style);
  }

  function assertNoRawBannerPayload(params) {
    ["html", "rawHtml", "script"].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(params, field)) {
        throw new Error("page banner는 raw HTML/JS payload를 받을 수 없어요.");
      }
    });
  }

  function normalizeBannerText(value) {
    const text = normalizeText(value).replace(/\s+/g, " ").slice(0, 160);
    return text || "요청을 처리했어요.";
  }

  function normalizeSelectionText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 4000);
  }

  function clampDuration(value, fallbackMs, maxMs) {
    const durationMs = Number(value);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return fallbackMs;
    }
    return Math.min(maxMs, Math.max(500, durationMs));
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
