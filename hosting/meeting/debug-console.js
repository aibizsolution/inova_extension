(function initMeetingDebugConsole(global) {
  const panelNamespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const hostedNamespace = (global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {});
  const VIEWPORT_BOTTOM_THRESHOLD_PX = 28;

  const PANEL_RENDER_OPTIONS = {
    buttons: [
      { attributes: { "data-meeting-action": "debug-copy", type: "button" }, label: "복사" },
      { attributes: { "data-meeting-action": "debug-copy-errors", type: "button" }, label: "오류" },
      { attributes: { "data-meeting-action": "debug-clear", type: "button" }, label: "비우기" },
      { attributes: { "data-meeting-action": "debug-toggle", type: "button" }, label: "접기" },
    ],
    fab: {
      buttonAttributes: { "aria-label": "디버그 콘솔 열기", "data-meeting-action": "debug-toggle", type: "button" },
      wrapperClassName: "inova-meeting-debug-fab-wrap",
    },
  };

  const WORKSPACE_RENDER_OPTIONS = {
    body: {
      attributes: { id: "debugPanelBody" },
      className: "debug-panel__body",
      tag: "div",
    },
    buttons: [
      { attributes: { "data-debug-action": "copy", id: "copyDebugButton", type: "button" }, className: "secondary-button", label: "복사" },
      { attributes: { "data-debug-action": "copy-errors", id: "copyDebugErrorsButton", type: "button" }, className: "secondary-button", label: "오류" },
      { attributes: { "data-debug-action": "clear", id: "clearDebugButton", type: "button" }, className: "ghost-button ghost-button--soft", label: "비우기" },
      { attributes: { "data-debug-action": "toggle", id: "toggleDebugPanelButton", type: "button" }, className: "ghost-button ghost-button--soft", label: "접기" },
    ],
    containerAttributes: { id: "debugPanelCard" },
    containerClassName: "panel-card panel-card--debug",
    containerTag: "article",
    fab: {
      badgeAttributes: { id: "debugFabBadge" },
      badgeClassName: "debug-panel__fab-badge",
      buttonAttributes: { "aria-label": "디버그 콘솔 열기", "data-debug-action": "toggle", id: "debugFabButton", type: "button" },
      buttonClassName: "debug-panel__fab",
      iconClassName: "debug-panel__fab-icon",
    },
    feedback: {
      attributes: { "aria-live": "polite", id: "debugNotice" },
      className: "debug-panel__notice",
    },
    log: {
      attributes: { id: "debugLog" },
      className: "debug-log",
    },
    status: {
      attributes: { "aria-live": "polite", id: "debugStatus" },
    },
    segmentClassName: "segment-cluster",
    toolbarClassName: "debug-panel__toolbar",
  };

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function joinClasses(...classNames) {
    return classNames.map((className) => normalizeText(className)).filter(Boolean).join(" ");
  }

  function buildAttributes(attributes = {}) {
    return Object.entries(attributes)
      .filter(([, value]) => value !== false && value != null && value !== "")
      .map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`)
      .join("");
  }

  function normalizeFeedback(feedback) {
    const text = normalizeText(feedback?.text);
    return {
      text,
      tone: normalizeText(feedback?.tone) || "info",
    };
  }

  function normalizeSummary(summary) {
    const nextSummary = summary && typeof summary === "object" ? summary : {};
    return {
      errorCount: Math.max(0, Number(nextSummary.errorCount) || 0),
      functionCalls: Math.max(0, Number(nextSummary.functionCalls) || 0),
      readCount: Math.max(0, Number(nextSummary.readCount) || 0),
      snapshotCount: Math.max(0, Number(nextSummary.snapshotCount) || 0),
      totalLogs: Math.max(0, Number(nextSummary.totalLogs) || 0),
    };
  }

  function buildStatusText(summary) {
    const normalizedSummary = normalizeSummary(summary);
    return `로그 ${normalizedSummary.totalLogs}건 · 함수 ${normalizedSummary.functionCalls}건 · 읽기 ${normalizedSummary.readCount}건 · 스냅샷 ${normalizedSummary.snapshotCount}건 · 오류 ${normalizedSummary.errorCount}건`;
  }

  function buildState(state) {
    const enabled = Boolean(state?.enabled);
    const statusSummary = normalizeSummary(state?.statusSummary);
    return {
      collapsed: enabled ? Boolean(state?.collapsed) : true,
      enabled,
      feedback: normalizeFeedback(state?.feedback),
      hasErrors: Boolean(state?.hasErrors) || statusSummary.errorCount > 0,
      statusSummary,
      statusText: normalizeText(state?.statusText) || buildStatusText(statusSummary),
      text: normalizeText(state?.text || state?.entriesText) || "아직 로그가 없습니다.",
    };
  }

  function renderStatus(summary, statusText, options = {}) {
    const normalizedSummary = normalizeSummary(summary);
    const items = [
      renderStatusItem("로그", normalizedSummary.totalLogs),
      renderStatusItem("함수", normalizedSummary.functionCalls),
      renderStatusItem("읽기", normalizedSummary.readCount),
      renderStatusItem("스냅샷", normalizedSummary.snapshotCount),
      renderStatusItem("오류", normalizedSummary.errorCount, normalizedSummary.errorCount > 0),
    ].join("");
    return `<span class="${joinClasses("inova-meeting-debug-console__status", options.className)}"${buildAttributes({ "aria-label": normalizeText(statusText) || buildStatusText(normalizedSummary), ...(options.attributes || {}) })}>${items}</span>`;
  }

  function renderStatusItem(label, count, isError = false) {
    return `<span class="inova-meeting-debug-console__status-item${isError ? " is-error" : ""}">${escapeHtml(label)} ${Math.max(0, Number(count) || 0)}건</span>`;
  }

  function renderButtons(buttons = []) {
    return buttons.map((button) => {
      const attributes = button?.attributes && typeof button.attributes === "object" ? button.attributes : {};
      return `<button class="${joinClasses("inova-meeting-debug-console__button", button?.className)}"${buildAttributes(attributes)}>${escapeHtml(button?.label)}</button>`;
    }).join("");
  }

  function renderFab(hasErrors, options = {}) {
    const buttonMarkup = `<button class="${joinClasses("inova-meeting-debug-fab", options.buttonClassName)}"${buildAttributes(options.buttonAttributes)}><span class="${joinClasses("inova-meeting-debug-fab__icon", options.iconClassName)}" aria-hidden="true"></span>${hasErrors ? `<span class="${joinClasses("inova-meeting-debug-fab__badge", options.badgeClassName)}"${buildAttributes(options.badgeAttributes)}></span>` : ""}</button>`;
    if (!normalizeText(options.wrapperClassName)) {
      return buttonMarkup;
    }
    return `<div class="${escapeHtml(options.wrapperClassName)}">${buttonMarkup}</div>`;
  }

  function renderFeedback(feedback, options = {}) {
    const normalizedFeedback = normalizeFeedback(feedback);
    if (!normalizedFeedback.text) {
      return "";
    }
    return `<div class="${joinClasses("inova-meeting-debug-console__feedback", options.className, normalizedFeedback.tone === "error" ? "is-error" : "")}"${buildAttributes(options.attributes)}>${escapeHtml(normalizedFeedback.text)}</div>`;
  }

  function renderLog(text, options = {}) {
    return `<pre class="${joinClasses("inova-meeting-debug-console__log", options.className)}"${buildAttributes(options.attributes)}>${escapeHtml(text)}</pre>`;
  }

  function wrapBody(content, options) {
    if (!options || !content) {
      return content;
    }
    const tagName = normalizeText(options.tag) || "div";
    return `<${tagName} class="${escapeHtml(normalizeText(options.className))}"${buildAttributes(options.attributes)}>${content}</${tagName}>`;
  }

  function renderConsole(state, options = {}) {
    const view = buildState(state);
    if (!view.enabled) {
      return "";
    }
    if (view.collapsed) {
      return renderFab(view.hasErrors, options.fab);
    }
    const tagName = normalizeText(options.containerTag) || "aside";
    const toolbarMarkup = `<div class="${joinClasses("inova-meeting-debug-console__toolbar", options.toolbarClassName)}"${buildAttributes(options.toolbarAttributes)}><div class="${joinClasses("inova-meeting-debug-console__segment", options.segmentClassName)}">${renderButtons(options.buttons)}</div>${renderStatus(view.statusSummary, view.statusText, options.status)}</div>`;
    const feedbackMarkup = renderFeedback(view.feedback, options.feedback);
    const logMarkup = wrapBody(renderLog(view.text, options.log), options.body);
    return `<${tagName} class="${joinClasses("inova-meeting-debug-console", options.containerClassName)}"${buildAttributes({ "aria-label": "디버그 콘솔", ...(options.containerAttributes || {}) })}>${toolbarMarkup}${feedbackMarkup}${logMarkup}</${tagName}>`;
  }

  function captureLogViewport(element) {
    if (!(element instanceof global.HTMLElement)) {
      return null;
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    return {
      scrollTop: Math.max(0, Number(element.scrollTop) || 0),
      stickToBottom: maxScrollTop - element.scrollTop <= VIEWPORT_BOTTOM_THRESHOLD_PX,
    };
  }

  function restoreLogViewport(element, viewportState) {
    if (!(element instanceof global.HTMLElement) || !viewportState) {
      return;
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = viewportState.stickToBottom
      ? maxScrollTop
      : Math.min(Math.max(0, Number(viewportState.scrollTop) || 0), maxScrollTop);
  }

  const api = {
    buildState,
    buildStatusText,
    captureLogViewport,
    renderPanel: (state) => renderConsole(state, PANEL_RENDER_OPTIONS),
    renderWorkspace: (state) => renderConsole(state, WORKSPACE_RENDER_OPTIONS),
    restoreLogViewport,
  };

  panelNamespace.meetingDebugConsole = api;
  hostedNamespace.debugConsole = api;
})(globalThis);
