(function initMeetingDebug(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const MAX_DEBUG_ENTRIES = 120;
  const VIEWPORT_BOTTOM_THRESHOLD_PX = 28;
  const NOISY_EVENT_WINDOWS_MS = {
    "route.refresh.start": 5000,
    "route.refresh.success": 5000,
    "panel.bridge.detach": 1200,
    "panel.ui.surface.changed": 800,
    "prompt.panel.bridge.detach": 1200,
  };
  const debugEntries = [];
  const debugListeners = new Set();
  const noisyEventState = new Map();
  const viewportStates = new Map();
  let debugEnabled = false;
  let debugSequence = 0;

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = normalizeText(value).toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
  }

  function normalizePayload(value) {
    if (!value || typeof value !== "object") {
      return normalizePrimitive(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => normalizePayload(item));
    }
    const next = {};
    for (const [key, current] of Object.entries(value)) {
      next[key] = normalizePayload(current);
    }
    return next;
  }

  function splitPayloadMeta(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        level: "",
        payload: normalizePayload(value),
        scope: "",
        tool: "",
      };
    }
    const next = { ...value };
    const level = normalizeText(next.level);
    const scope = normalizeText(next.scope);
    const tool = normalizeText(next.tool);
    delete next.level;
    delete next.scope;
    delete next.tool;
    return {
      level,
      payload: normalizePayload(next),
      scope,
      tool,
    };
  }

  function normalizePrimitive(value) {
    if (value == null) return "";
    if (value instanceof Error) {
      return {
        message: normalizeText(value.message),
        name: normalizeText(value.name),
        stack: normalizeText(value.stack),
      };
    }
    if (typeof value === "string") return normalizeText(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    return String(value);
  }

  function isLocalDebugEnabled(settings) {
    return normalizeBoolean(settings?.meetingDebugConsoleEnabled);
  }

  function setEnabled(nextEnabled) {
    const normalized = Boolean(nextEnabled);
    if (debugEnabled === normalized) {
      return debugEnabled;
    }
    debugEnabled = normalized;
    return debugEnabled;
  }

  function isEnabled() {
    return debugEnabled;
  }

  function getEntries() {
    return debugEntries.map((entry) => ({
      ...entry,
      payload: normalizePayload(entry.payload),
    }));
  }

  function clearEntries() {
    debugEntries.length = 0;
    noisyEventState.clear();
    notifyListeners();
  }

  function buildViewportState(element) {
    if (!(element instanceof global.HTMLElement)) {
      return null;
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    return {
      scrollTop: Math.max(0, Number(element.scrollTop) || 0),
      stickToBottom: maxScrollTop - element.scrollTop <= VIEWPORT_BOTTOM_THRESHOLD_PX,
    };
  }

  function captureViewport(key, element) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      return null;
    }
    const state = buildViewportState(element);
    if (state) {
      viewportStates.set(normalizedKey, state);
    }
    return state;
  }

  function restoreViewport(key, element) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey || !(element instanceof global.HTMLElement)) {
      return;
    }
    const state = viewportStates.get(normalizedKey);
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (!state) {
      element.scrollTop = maxScrollTop;
      viewportStates.set(normalizedKey, buildViewportState(element));
      return;
    }
    element.scrollTop = state.stickToBottom
      ? maxScrollTop
      : Math.min(Math.max(0, Number(state.scrollTop) || 0), maxScrollTop);
    viewportStates.set(normalizedKey, buildViewportState(element));
  }

  function syncViewportText(key, element, text) {
    const normalizedKey = normalizeText(key);
    if (!(element instanceof global.HTMLElement)) {
      return;
    }
    if (normalizedKey) {
      captureViewport(normalizedKey, element);
    }
    const nextText = typeof text === "string" && text ? text : "아직 로그가 없습니다.";
    if (element.textContent !== nextText) {
      element.textContent = nextText;
    }
    if (normalizedKey) {
      restoreViewport(normalizedKey, element);
      return;
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = maxScrollTop;
  }

  function formatEntry(entry) {
    const timestamp = normalizeText(entry?.timestamp);
    const event = normalizeText(entry?.event);
    const payload = entry?.payload;
    const payloadText = payload == null
      ? ""
      : typeof payload === "string"
        ? payload
        : typeof payload === "object" && !Array.isArray(payload) && !Object.keys(payload).length
          ? ""
          : JSON.stringify(payload, null, 2);
    return `${timestamp} ${event}${payloadText ? `\n${payloadText}` : ""}`.trim();
  }

  function inferScope(event, payloadScope) {
    if (payloadScope) {
      return payloadScope;
    }
    const normalizedEvent = normalizeText(event).toLowerCase();
    if (!normalizedEvent) {
      return "panel-ui";
    }
    if (normalizedEvent.startsWith("route.")) {
      return "route";
    }
    if (normalizedEvent.startsWith("cloud-sync.")) {
      return "cloud-sync";
    }
    if (normalizedEvent.startsWith("prompt.")) {
      return "prompt";
    }
    if (normalizedEvent.startsWith("release.")) {
      return "release";
    }
    if (normalizedEvent.startsWith("panel.firestore.")) {
      return "firestore";
    }
    if (normalizedEvent.startsWith("panel.storage.")) {
      return "storage";
    }
    if (normalizedEvent.startsWith("bridge.") || normalizedEvent.includes(".runtime.")) {
      return "runtime";
    }
    if (
      normalizedEvent.startsWith("panel.auth.")
      || normalizedEvent.startsWith("panel.bridge.")
      || normalizedEvent.startsWith("panel.fallback.")
      || normalizedEvent.startsWith("panel.refresh.")
    ) {
      return "meeting";
    }
    if (normalizedEvent.startsWith("panel.action.") || normalizedEvent.startsWith("panel.debug.") || normalizedEvent.startsWith("panel.ui.")) {
      return "panel-ui";
    }
    return "panel-ui";
  }

  function inferTool(event, payloadTool, scope) {
    if (payloadTool) {
      return payloadTool;
    }
    const normalizedEvent = normalizeText(event).toLowerCase();
    if (scope === "prompt") {
      return "prompts";
    }
    if (scope === "release") {
      return "release";
    }
    if (scope === "cloud-sync") {
      return "prompts";
    }
    if (scope === "route" || scope === "storage") {
      return "bookmarks";
    }
    if (scope === "meeting" || scope === "firestore") {
      return "meeting";
    }
    if (normalizedEvent.startsWith("panel.action.")) {
      return "meeting";
    }
    return "panel";
  }

  function inferLevel(event, payloadLevel, payload) {
    if (payloadLevel) {
      return payloadLevel;
    }
    const normalizedEvent = normalizeText(event).toLowerCase();
    if (
      normalizedEvent.includes("error")
      || normalizedEvent.includes("failed")
      || normalizedEvent.includes("timeout")
      || normalizeText(payload?.error)
    ) {
      return "error";
    }
    return "info";
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    debugListeners.add(listener);
    listener(getEntries());
    return () => debugListeners.delete(listener);
  }

  function log(event, payload) {
    if (!debugEnabled) {
      return null;
    }
    const normalizedEvent = normalizeText(event);
    const payloadParts = splitPayloadMeta(payload);
    const entry = {
      event: normalizedEvent,
      id: ++debugSequence,
      level: inferLevel(normalizedEvent, payloadParts.level, payloadParts.payload),
      payload: payloadParts.payload,
      scope: inferScope(normalizedEvent, payloadParts.scope),
      timestamp: new Date().toISOString(),
      tool: inferTool(normalizedEvent, payloadParts.tool, inferScope(normalizedEvent, payloadParts.scope)),
    };
    if (shouldSkipNoisyEntry(entry)) {
      return null;
    }
    debugEntries.push(entry);
    while (debugEntries.length > MAX_DEBUG_ENTRIES) {
      debugEntries.shift();
    }
    notifyListeners();
    return entry;
  }

  function shouldSkipNoisyEntry(entry) {
    const windowMs = NOISY_EVENT_WINDOWS_MS[normalizeText(entry?.event)] || 0;
    if (!windowMs) {
      return false;
    }
    const eventKey = normalizeText(entry?.event);
    const signature = JSON.stringify(entry?.payload || {});
    const previous = noisyEventState.get(eventKey);
    const now = Date.now();
    noisyEventState.set(eventKey, {
      signature,
      time: now,
    });
    return Boolean(previous && previous.signature === signature && now - previous.time <= windowMs);
  }

  function isErrorEntry(entry) {
    const event = normalizeText(entry?.event).toLowerCase();
    return normalizeText(entry?.level).toLowerCase() === "error"
      || event.includes("error")
      || event.includes("failed")
      || event.includes("timeout")
      || Boolean(normalizeText(entry?.payload?.error))
      || normalizeText(entry?.payload?.tone).toLowerCase() === "error";
  }

  function getErrorEntries(entries = getEntries()) {
    return (Array.isArray(entries) ? entries : []).filter(isErrorEntry);
  }

  function buildCopyText(entries = getEntries()) {
    return buildDigestText(entries, {
      emptyText: "아직 로그가 없습니다.",
      maxEntries: 24,
      title: "meeting-debug-summary",
    });
  }

  function buildErrorCopyText(entries = getEntries()) {
    return buildDigestText(getErrorEntries(entries), {
      emptyText: "오류 로그가 없습니다.",
      maxEntries: 16,
      title: "meeting-debug-errors",
    });
  }

  function buildDigestText(entries, options = {}) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    if (!normalizedEntries.length) {
      return normalizeText(options.emptyText) || "";
    }
    const summary = summarizeEntries(normalizedEntries);
    const maxEntries = Math.max(1, Number(options.maxEntries) || 20);
    const recentEntries = normalizedEntries.slice(-maxEntries);
    const omittedCount = Math.max(0, normalizedEntries.length - recentEntries.length);
    const lines = [
      `[${normalizeText(options.title) || "meeting-debug"}] total=${summary.totalLogs} errors=${summary.errorCount} functions=${summary.functionCalls} reads=${summary.readCount} snapshots=${summary.snapshotCount}`,
    ];
    if (omittedCount > 0) {
      lines.push(`[summary] older entries omitted=${omittedCount}`);
    }
    lines.push("");
    return `${lines.join("\n")}${recentEntries.map((entry) => formatEntry(entry)).join("\n\n")}`.trim();
  }

  function summarizeEntries(entries = getEntries()) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    let functionCalls = 0;
    let readCount = 0;
    let snapshotCount = 0;
    let errorCount = 0;
    for (const entry of normalizedEntries) {
      const event = normalizeText(entry?.event);
      const scope = normalizeText(entry?.scope);
      const isRequestEvent = event.endsWith(".request");
      const backend = normalizeText(entry?.payload?.backend).toLowerCase();
      const operation = normalizeText(entry?.payload?.operation).toLowerCase();
      if (isRequestEvent && backend === "firebase-function") {
        functionCalls += 1;
      }
      if (isRequestEvent && operation === "read") {
        readCount += 1;
      }
      if (scope === "firestore" && event.endsWith(".snapshot")) {
        snapshotCount += 1;
      }
      if (isErrorEntry(entry)) {
        errorCount += 1;
      }
    }
    return {
      errorCount,
      functionCalls,
      readCount,
      snapshotCount,
      totalLogs: normalizedEntries.length,
    };
  }

  function notifyListeners() {
    const snapshot = getEntries();
    for (const listener of debugListeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  const api = {
    buildCopyText,
    buildErrorCopyText,
    captureViewport,
    clearEntries,
    formatEntry,
    getEntries,
    getErrorEntries,
    isEnabled,
    isErrorEntry,
    isLocalDebugEnabled,
    log,
    restoreViewport,
    setEnabled,
    subscribe,
    summarizeEntries,
    syncViewportText,
  };

  namespace.meetingDebug = api;
  namespace.panelDebug = api;
})(globalThis);
