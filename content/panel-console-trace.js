(function initPanelConsoleTrace(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const TRACE_REPEAT_IDLE_MS = 1600;
  const ALWAYS_VISIBLE_TRACE_LABELS = [
    "hosted.click.detected",
    "hosted.conversation.snapshot.error",
    "hosted.conversation.snapshot.start",
    "hosted.conversation.snapshot.success",
    "hosted.firestore.auth.refresh",
    "hosted.firestore.auth.reuse",
    "hosted.firestore.auth.sign-in",
    "hosted.firestore.disconnect",
    "hosted.firestore.error",
    "hosted.firestore.listen.start",
    "hosted.firestore.reuse",
    "hosted.firestore.snapshot",
    "hosted.panel-auth.error",
    "hosted.panel-auth.start",
    "hosted.panel-auth.success",
    "hosted.panel-auth.timeout",
    "hosted.release.fetch.error",
    "hosted.release.fetch.start",
    "hosted.release.fetch.success",
    "hosted.review.action",
    "hosted.review.apply.error",
    "hosted.review.apply.start",
    "hosted.review.apply.success",
    "hosted.review.copy.error",
    "hosted.review.copy.start",
    "hosted.review.copy.success",
    "hosted.review.request.error",
    "hosted.review.request.skip",
    "hosted.review.request.start",
    "hosted.review.request.success",
    "page.functions.review.error",
    "page.functions.review.start",
    "page.functions.review.success",
    "prompt.review.request.error",
    "prompt.review.request.start",
    "prompt.review.request.success",
    "top.panel.bridge.attached",
    "top.panel.bridge.error",
    "top.panel.bridge.not-ready",
    "top.panel.bridge.ready",
    "top.panel.ensure.reuse",
    "top.panel.frame.error",
    "top.panel.frame.load",
    "top.panel.frame.src.set",
    "top.panel.handshake.timeout",
    "top.panel.host.created",
    "top.panel.snapshot.push",
  ];
  const QUIET_TRACE_LABELS = new Set([
    "hosted.listeners.bound",
    "hosted.message.received",
    "hosted.ready.ping.fire",
    "hosted.ready.ping.scheduled",
    "hosted.render.flush",
    "hosted.request.success",
    "hosted.snapshot.applied",
    "hosted.snapshot.received",
    "top.panel.bridge.request.completed",
    "top.panel.bridge.request.received",
  ]);

  function create(deps = {}) {
    const isDebugEnabled = typeof deps.isDebugEnabled === "function" ? deps.isDebugEnabled : () => false;
    const normalizeText = typeof deps.normalizeText === "function"
      ? deps.normalizeText
      : (value) => String(value || "").trim();
    let traceSequence = 0;
    let lastTraceEntry = null;
    let traceRepeatTimer = 0;

    return {
      buildPanelSnapshotTracePayload,
      log,
    };

    function log(channel, step, payload = {}) {
      const normalizedChannel = normalizeText(channel) || "trace";
      const normalizedStep = normalizeText(step) || "trace";
      const normalizedLabel = normalizedStep.replace(/^\d+\./, "") || "trace";
      const detail = payload && typeof payload === "object" ? payload : {};
      if (!isDebugEnabled() && !ALWAYS_VISIBLE_TRACE_LABELS.includes(normalizedLabel)) {
        return false;
      }
      if (shouldSkipTraceStep(normalizedLabel, detail)) {
        return false;
      }
      const summary = buildTraceSummary(normalizedLabel, detail);
      const fingerprint = `${normalizedChannel}|${normalizedLabel}|${summary}`;
      if (lastTraceEntry?.fingerprint === fingerprint) {
        lastTraceEntry.repeatCount += 1;
        scheduleTraceRepeatFlush();
        return true;
      }
      flushRepeatedTraceSummary();
      lastTraceEntry = {
        channel: normalizedChannel,
        fingerprint,
        label: normalizedLabel,
        repeatCount: 0,
        summary,
      };
      emitTraceLine(normalizedChannel, formatTraceLine(normalizedLabel, summary));
      scheduleTraceRepeatFlush();
      return true;
    }

    function buildPanelSnapshotTracePayload(state = {}) {
      const panelSnapshot = state?.panelSnapshot && typeof state.panelSnapshot === "object"
        ? state.panelSnapshot
        : {};
      const activeTool = normalizeText(panelSnapshot?.activeTool || panelSnapshot?.uiPreferences?.activeTool);
      const activePromptTab = normalizeText(panelSnapshot?.uiPreferences?.activePromptTab);
      return {
        activeTool,
        open: Boolean(panelSnapshot.open),
        reviewOpen: activeTool === "prompts" && activePromptTab === "review",
        visible: Boolean(panelSnapshot.visible),
      };
    }

    function shouldSkipTraceStep(label, payload) {
      if (QUIET_TRACE_LABELS.has(label)) {
        return true;
      }
      return label === "top.panel.snapshot.push"
        && !payload?.activeTool
        && !payload?.open
        && !payload?.visible;
    }

    function buildTraceSummary(label, payload = {}) {
      const parts = [];
      const requestAction = normalizeText(payload.action);
      const requestDomain = normalizeText(payload.domain);
      const requestTarget = [requestDomain, requestAction].filter(Boolean).join("/");
      if (requestTarget) {
        parts.push(requestTarget);
      }
      [
        ["meeting", payload.meetingId],
        ["job", payload.jobId],
        ["artifact", payload.artifactId],
        ["tool", payload.activeTool],
        ["tab", payload.promptTab],
        ["title", payload.toolTitle],
        ["count", normalizeTraceCount(payload.count)],
        ["meetings", normalizeTraceCount(payload.meetingCount)],
        ["open", normalizeTraceBoolean(payload, "open")],
        ["review", normalizeTraceBoolean(payload, "reviewOpen")],
        ["snapshot", normalizeTraceBoolean(payload, "snapshotOpen")],
        ["available", normalizeTraceBoolean(payload, "available")],
        ["pending", normalizeTraceBoolean(payload, "pending")],
        ["result", normalizeTraceBoolean(payload, "hasResult")],
        ["text", normalizeTraceBoolean(payload, "hasText")],
        ["visible", normalizeTraceBoolean(payload, "visible")],
        ["ready", normalizeTraceBoolean(payload, "ready")],
        ["target", payload.target],
        ["purpose", payload.purpose],
        ["reader", payload.reader],
        ["wrapped", normalizeTraceBoolean(payload, "wrapped")],
        ["reason", payload.reason],
        ["message", payload.message],
        ["error", payload.error],
        ["src", summarizeTraceUrl(payload.frameSrc)],
        ["url", summarizeTraceUrl(payload.panelUrl)],
        ["origin", summarizeTraceUrl(payload.origin)],
        ["file", summarizeTraceUrl(payload.filename)],
      ].forEach(([key, value]) => appendTracePart(parts, key, value));
      if (!parts.length && label === "hosted.render.waiting-snapshot") {
        appendTracePart(parts, "ready", normalizeTraceBoolean(payload, "bridgeReady"));
      }
      return parts.filter(Boolean).join(", ");
    }

    function appendTracePart(parts, key, value) {
      const normalizedValue = normalizeText(value);
      if (normalizedValue) {
        parts.push(`${key}=${normalizedValue}`);
      }
    }

    function normalizeTraceBoolean(payload, key) {
      return !payload || !Object.prototype.hasOwnProperty.call(payload, key) ? "" : payload[key] ? "yes" : "no";
    }

    function normalizeTraceCount(value) {
      if (value == null || value === "") {
        return "";
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? String(numeric) : normalizeText(value);
    }

    function summarizeTraceUrl(value) {
      const normalized = normalizeText(value);
      if (!normalized) {
        return "";
      }
      try {
        const parsed = new URL(normalized);
        const path = `${parsed.host}${parsed.pathname}`;
        return path.length > 72 ? `${path.slice(0, 48)}...${path.slice(-18)}` : path;
      } catch {
        return normalized.length > 72 ? `${normalized.slice(0, 48)}...${normalized.slice(-18)}` : normalized;
      }
    }

    function formatTraceLine(label, summary) {
      return summary ? `${label} | ${summary}` : label;
    }

    function emitTraceLine(channel, text) {
      traceSequence += 1;
      const style = channel === "functions"
        ? "color:#b45309;font-weight:600"
        : channel === "meeting"
          ? "color:#0f766e"
          : channel === "firestore"
            ? "color:#1d4ed8;font-weight:600"
            : "";
      style
        ? console.log(`%c[inova:${channel} #${traceSequence}] ${text}`, style)
        : console.log(`[inova:${channel} #${traceSequence}] ${text}`);
    }

    function scheduleTraceRepeatFlush() {
      global.clearTimeout(traceRepeatTimer);
      traceRepeatTimer = global.setTimeout(() => {
        traceRepeatTimer = 0;
        flushRepeatedTraceSummary();
      }, TRACE_REPEAT_IDLE_MS);
    }

    function flushRepeatedTraceSummary() {
      if (!lastTraceEntry) {
        return;
      }
      global.clearTimeout(traceRepeatTimer);
      traceRepeatTimer = 0;
      if (lastTraceEntry.repeatCount > 0) {
        emitTraceLine(
          lastTraceEntry.channel,
          `same event repeated ${lastTraceEntry.repeatCount} more times | ${formatTraceLine(lastTraceEntry.label, lastTraceEntry.summary)}`
        );
      }
      lastTraceEntry = null;
    }
  }

  namespace.panelConsoleTrace = {
    ...(namespace.panelConsoleTrace || {}),
    create,
  };
})(globalThis);
