(function initHostedMeetingWorkspaceDebug(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const TRACE_REPEAT_IDLE_MS = 1600;

  ns.workspaceDebug = {
    createController(deps) {
      const globalObject = deps?.global || global;
      const refs = deps?.refs || {};
      const state = deps?.state || {};
      const helpers = deps?.helpers || {};
      const {
        buildCopyText,
        getDebugEntries,
        getDebugStatsSummary,
        getRetainedErrorDebugEntries,
        isDebugConsoleEnabled,
        logDebug,
        normalizeText,
        setEnabled: setDebugEnabled,
        subscribeDebugEntries,
      } = ns.shared;
      const {
        buildDetailView,
        buildMeetingNotesCopyText,
        buildSegmentCopyText,
        findHistoryEntry,
      } = ns.render;
      let consoleTraceEnabled = false;
      let lastPrintedEntryId = 0;
      let lastTraceEntry = null;
      let traceRepeatTimer = 0;
      let traceSequence = 0;

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      function buildHostedDebugConsoleStateSnapshot(entries = getDebugEntries()) {
        const normalizedEntries = Array.isArray(entries) ? entries : [];
        const summary = getDebugStatsSummary();
        return {
          buttons: [],
          collapsed: false,
          enabled: consoleTraceEnabled,
          entryCount: normalizedEntries.length,
          feedback: { text: "", tone: "info" },
          hasErrors: Math.max(0, Number(summary?.errorCount) || 0) > 0,
          hasFabBadge: false,
          hasFabButton: false,
          hasLog: false,
          hasSegmentCluster: false,
          hasToolbar: false,
          lastPrintedEntryId,
          logText: buildDebugConsoleText(normalizedEntries),
          mode: "browser-console",
          noticeText: "",
          rendered: false,
          statusText: buildStatusText(summary),
        };
      }

      function buildHostedDebugConsoleValidationChecks(snapshot) {
        const latestEntryId = getLatestEntryId(getDebugEntries());
        return [
          {
            label: "hosted meeting console trace가 활성화됨",
            passed: Boolean(snapshot?.enabled),
            actual: snapshot?.enabled ? "enabled" : "disabled",
          },
          {
            label: "화면 디버그 패널을 렌더하지 않음",
            passed: !snapshot?.rendered && !snapshot?.hasFabButton && !snapshot?.hasToolbar,
            actual: snapshot?.rendered ? "rendered" : "browser-console",
          },
          {
            label: "debug helper 로그 버퍼에 접근 가능함",
            passed: Number.isFinite(Number(snapshot?.entryCount)),
            actual: String(Math.max(0, Number(snapshot?.entryCount) || 0)),
          },
          {
            label: "콘솔 trace가 최신 로그 id까지 소비함",
            passed: !snapshot?.enabled || lastPrintedEntryId >= latestEntryId,
            actual: `${lastPrintedEntryId}/${latestEntryId}`,
          },
        ];
      }

      function buildRecentDebugEntrySnapshot(options = {}) {
        const limit = Math.max(1, Math.min(80, Number(options?.entriesLimit) || Number(options?.limit) || 40));
        return getDebugEntries()
          .slice(-limit)
          .map((entry) => ({
            event: normalizeText(entry?.event),
            payload: entry?.payload && typeof entry.payload === "object" ? { ...entry.payload } : entry?.payload ?? null,
            timestamp: normalizeText(entry?.timestamp),
          }));
      }

      function buildPendingSyncEvidence(options = {}) {
        const queueLimit = Math.max(1, Math.min(50, Number(options?.queueLimit) || Number(options?.limit) || 20));
        return {
          debugConsole: buildHostedDebugConsoleStateSnapshot(getDebugEntries()),
          href: normalizeText(globalObject.location?.href),
          meetingId: normalizeText(state.session?.meetingId || state.params?.meetingId),
          queueSnapshot: controller("pendingUploads")?.buildPendingUploadQueueStateSnapshot?.({ limit: queueLimit }) || null,
          recentDebugEntries: buildRecentDebugEntrySnapshot({
            entriesLimit: options?.entriesLimit,
          }),
          selectedRecordId: normalizeText(state.selectedRecordId),
        };
      }

      function printPendingSyncEvidence(options = {}) {
        const evidence = buildPendingSyncEvidence(options);
        const consoleRef = globalObject.console;
        const pendingUploads = Array.isArray(evidence?.queueSnapshot?.pendingUploads) ? evidence.queueSnapshot.pendingUploads : [];
        const recentQueueEvents = Array.isArray(evidence?.queueSnapshot?.recentQueueEvents)
          ? evidence.queueSnapshot.recentQueueEvents.map((entry) => ({
              event: normalizeText(entry?.event),
              payload: entry?.payload && typeof entry.payload === "object" ? JSON.stringify(entry.payload) : normalizeText(entry?.payload),
              timestamp: normalizeText(entry?.timestamp),
            }))
          : [];
        const recentDebugEntries = Array.isArray(evidence?.recentDebugEntries)
          ? evidence.recentDebugEntries.map((entry) => ({
              event: normalizeText(entry?.event),
              payload: entry?.payload && typeof entry.payload === "object" ? JSON.stringify(entry.payload) : normalizeText(entry?.payload),
              timestamp: normalizeText(entry?.timestamp),
            }))
          : [];
        const summary = {
          href: evidence?.href || "",
          meetingId: evidence?.meetingId || "",
          pendingLocalCount: Math.max(0, Number(evidence?.queueSnapshot?.pendingLocalCount) || 0),
          recentDebugEntryCount: recentDebugEntries.length,
          recentQueueEventCount: recentQueueEvents.length,
          selectedRecordId: evidence?.selectedRecordId || "",
        };
        if (typeof consoleRef?.groupCollapsed === "function") {
          consoleRef.groupCollapsed("[Inova Hosted Meeting] pending sync evidence");
        }
        if (typeof consoleRef?.log === "function") {
          consoleRef.log("summary", summary);
          consoleRef.log("evidence", evidence);
        }
        if (typeof consoleRef?.table === "function") {
          if (pendingUploads.length) {
            consoleRef.table(pendingUploads);
          }
          if (recentQueueEvents.length) {
            consoleRef.table(recentQueueEvents);
          }
          if (recentDebugEntries.length) {
            consoleRef.table(recentDebugEntries);
          }
        }
        if (typeof consoleRef?.groupEnd === "function") {
          consoleRef.groupEnd();
        }
        return evidence;
      }

      function buildAuthSnapshotText() {
        const rows = [
          ["authMode", normalizeText(state.auth?.accessMode || state.auth?.accessDecision || "unknown") || "unknown"],
          ["extensionBridge", normalizeText(state.auth?.extensionBridge) || "not-requested"],
          ["inovaLogin", state.auth?.inovaLogin ? "yes" : "no"],
          ["accessDecision", normalizeText(state.auth?.accessDecision) || "unknown"],
          ["reason", normalizeText(state.auth?.reason) || "-"],
          ["viewer", normalizeText(state.auth?.viewer) || "-"],
          ["bypassMode", normalizeText(state.auth?.bypassMode) || "-"],
        ];
        return ["[auth]", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
      }

      function buildDebugConsoleText(entries = getDebugEntries()) {
        const logText = normalizeText(buildCopyText(Array.isArray(entries) ? entries : [])) || "아직 로그가 없습니다.";
        return `${buildAuthSnapshotText()}\n\n${logText}`;
      }

      function buildStatusText(summary = getDebugStatsSummary()) {
        const functionCalls = Math.max(0, Number(summary?.functionCalls) || 0);
        const readCount = Math.max(0, Number(summary?.readCount) || 0);
        const snapshotCount = Math.max(0, Number(summary?.snapshotCount) || 0);
        const errorCount = Math.max(0, Number(summary?.errorCount) || 0);
        return `함수 ${functionCalls}건 · 읽기 ${readCount}건 · 리스너 ${snapshotCount}건 · 오류 ${errorCount}건`;
      }

      function validateHostedDebugConsoleWorkspace(options = {}) {
        const snapshot = buildHostedDebugConsoleStateSnapshot(options?.entries);
        const checks = buildHostedDebugConsoleValidationChecks(snapshot);
        return {
          checks,
          collapsed: false,
          entryCount: Math.max(0, Number(snapshot?.entryCount) || 0),
          passed: checks.every((check) => Boolean(check?.passed)),
          snapshot,
        };
      }

      function setup() {
        const enabled = isDebugConsoleEnabled(globalObject);
        consoleTraceEnabled = enabled;
        setDebugEnabled(enabled);
        if (refs.meetingShell) {
          refs.meetingShell.dataset.debugConsole = String(enabled);
        }
        state.unsubscribeDebug?.();
        state.unsubscribeDebug = null;
        lastPrintedEntryId = 0;
        lastTraceEntry = null;
        if (!enabled) {
          return;
        }
        state.unsubscribeDebug = subscribeDebugEntries((entries) => printConsoleEntries(entries));
        logDebug("workspace.debug.console.enabled", {
          href: globalObject.location.href,
          mode: "browser-console",
        });
      }

      function printConsoleEntries(entries) {
        if (!consoleTraceEnabled) {
          return;
        }
        for (const entry of Array.isArray(entries) ? entries : []) {
          const entryId = Math.max(0, Number(entry?.id) || 0);
          if (!entryId || entryId <= lastPrintedEntryId) {
            continue;
          }
          lastPrintedEntryId = entryId;
          emitTraceEntry(entry);
        }
      }

      function emitTraceEntry(entry) {
        const channel = resolveTraceChannel(entry);
        const label = normalizeText(entry?.event) || "trace";
        const summary = buildTraceSummary(entry?.payload);
        const fingerprint = `${channel}|${label}|${summary}`;
        if (lastTraceEntry?.fingerprint === fingerprint) {
          lastTraceEntry.repeatCount += 1;
          scheduleTraceRepeatFlush();
          return;
        }
        flushRepeatedTraceSummary();
        lastTraceEntry = {
          channel,
          fingerprint,
          label,
          repeatCount: 0,
          summary,
        };
        emitTraceLine(channel, formatTraceLine(label, summary), isErrorTraceEntry(entry));
        scheduleTraceRepeatFlush();
      }

      function resolveTraceChannel(entry) {
        const event = normalizeText(entry?.event).toLowerCase();
        if (event.startsWith("firestore.")) return "firestore";
        if (event.startsWith("http.") || event.includes("function") || event.includes("source-upload")) return "functions";
        return "meeting";
      }

      function buildTraceSummary(payload) {
        const detail = payload && typeof payload === "object" ? payload : {};
        const parts = [];
        [
          ["meeting", detail.meetingId],
          ["job", detail.jobId],
          ["artifact", detail.artifactId],
          ["record", detail.recordId || detail.selectedRecordId],
          ["request", detail.requestId],
          ["count", normalizeTraceCount(detail.count ?? detail.resultCount)],
          ["pending", normalizeTraceCount(detail.pendingLocalCount)],
          ["readOnly", normalizeTraceBoolean(detail, "readOnly")],
          ["ok", normalizeTraceBoolean(detail, "ok")],
          ["target", detail.target],
          ["phase", detail.phase],
          ["status", detail.status],
          ["source", detail.source],
          ["reason", detail.reason],
          ["mode", detail.mode],
          ["timeout", normalizeTraceCount(detail.timeoutMs)],
          ["message", detail.message],
          ["error", summarizeTraceError(detail.error)],
          ["url", summarizeTraceUrl(detail.url || detail.href)],
        ].forEach(([key, value]) => appendTracePart(parts, key, value));
        if (!parts.length && payload && typeof payload !== "object") {
          appendTracePart(parts, "message", payload);
        }
        return parts.filter(Boolean).join(", ");
      }

      function appendTracePart(parts, key, value) {
        const normalizedValue = normalizeTraceValue(value);
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

      function normalizeTraceValue(value) {
        if (value == null || value === "") {
          return "";
        }
        if (typeof value === "boolean") {
          return value ? "yes" : "no";
        }
        if (typeof value === "number") {
          return Number.isFinite(value) ? String(value) : "";
        }
        if (typeof value === "string") {
          return summarizeTraceText(value);
        }
        if (Array.isArray(value)) {
          return `array(${value.length})`;
        }
        if (typeof value === "object") {
          return summarizeTraceError(value) || `object(${Object.keys(value).slice(0, 4).join(",")})`;
        }
        return summarizeTraceText(value);
      }

      function summarizeTraceText(value) {
        const normalized = normalizeText(value).replace(/\s+/g, " ");
        return normalized.length > 96 ? `${normalized.slice(0, 72)}...${normalized.slice(-18)}` : normalized;
      }

      function summarizeTraceError(value) {
        if (!value) {
          return "";
        }
        if (typeof value === "string") {
          return summarizeTraceText(value);
        }
        const message = normalizeText(value.message);
        const name = normalizeText(value.name);
        return summarizeTraceText([name, message].filter(Boolean).join(": "));
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
          return summarizeTraceText(normalized);
        }
      }

      function formatTraceLine(label, summary) {
        return summary ? `${label} | ${summary}` : label;
      }

      function emitTraceLine(channel, text, isError = false) {
        traceSequence += 1;
        const style = channel === "functions"
          ? "color:#b45309;font-weight:600"
          : channel === "meeting"
            ? "color:#0f766e"
            : channel === "firestore"
              ? "color:#1d4ed8;font-weight:600"
              : "";
        const line = `%c[inova:${channel} #${traceSequence}] ${text}`;
        const consoleMethod = isError && typeof globalObject.console?.warn === "function" ? "warn" : "log";
        if (style) {
          globalObject.console?.[consoleMethod]?.(line, style);
        } else {
          globalObject.console?.[consoleMethod]?.(`[inova:${channel} #${traceSequence}] ${text}`);
        }
      }

      function scheduleTraceRepeatFlush() {
        globalObject.clearTimeout(traceRepeatTimer);
        traceRepeatTimer = globalObject.setTimeout(() => {
          traceRepeatTimer = 0;
          flushRepeatedTraceSummary();
        }, TRACE_REPEAT_IDLE_MS);
      }

      function flushRepeatedTraceSummary() {
        if (!lastTraceEntry) {
          return;
        }
        globalObject.clearTimeout(traceRepeatTimer);
        traceRepeatTimer = 0;
        if (lastTraceEntry.repeatCount > 0) {
          emitTraceLine(
            lastTraceEntry.channel,
            `same event repeated ${lastTraceEntry.repeatCount} more times | ${formatTraceLine(lastTraceEntry.label, lastTraceEntry.summary)}`
          );
        }
        lastTraceEntry = null;
      }

      function getLatestEntryId(entries) {
        return (Array.isArray(entries) ? entries : []).reduce((max, entry) => Math.max(max, Number(entry?.id) || 0), 0);
      }

      function isErrorTraceEntry(entry) {
        const event = normalizeText(entry?.event).toLowerCase();
        const payload = entry?.payload && typeof entry.payload === "object" ? entry.payload : {};
        const tone = normalizeText(payload?.tone).toLowerCase();
        return event.includes("error")
          || event.includes("failed")
          || event.includes("timeout")
          || tone === "error"
          || Boolean(summarizeTraceError(payload?.error));
      }

      async function copyMeetingNotes() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        const detailView = buildDetailView(state, entry);
        const text = buildMeetingNotesCopyText(detailView.meetingNotes);
        if (!text) {
          helpers.setNotice?.("복사할 회의 정리가 아직 없습니다.", "warning");
          helpers.applyRender?.();
          return;
        }
        try {
          if (typeof globalObject.navigator?.clipboard?.writeText === "function") {
            await globalObject.navigator.clipboard.writeText(text);
            helpers.setNotice?.("회의 정리를 복사했습니다.", "highlight");
          } else {
            throw new Error("Clipboard API unavailable");
          }
        } catch {
          helpers.setNotice?.("클립보드 권한이 없어 회의 정리 복사를 완료하지 못했어요.", "error");
        }
        helpers.applyRender?.();
      }

      async function copySegmentsText() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        const detailView = buildDetailView(state, entry);
        const text = buildSegmentCopyText(detailView.segments, detailView.transcriptText);
        if (!text) {
          helpers.setNotice?.("복사할 전사가 아직 없습니다.", "warning");
          helpers.applyRender?.();
          return;
        }
        try {
          if (typeof globalObject.navigator?.clipboard?.writeText === "function") {
            await globalObject.navigator.clipboard.writeText(text);
            helpers.setNotice?.("발화 구간을 시간대 포함 텍스트로 복사했습니다.", "highlight");
          } else {
            throw new Error("Clipboard API unavailable");
          }
        } catch {
          helpers.setNotice?.("클립보드 권한이 없어 전사 복사를 완료하지 못했어요.", "error");
        }
        helpers.applyRender?.();
      }

      function exposeDebugApi() {
        const debugApi = globalObject.__INOVA_HOSTED_MEETING_DEBUG__ = globalObject.__INOVA_HOSTED_MEETING_DEBUG__ || {};
        debugApi.debugConsoleState = buildHostedDebugConsoleStateSnapshot;
        debugApi.debugConsoleValidation = {
          checkWorkspace: validateHostedDebugConsoleWorkspace,
        };
        debugApi.errors = getRetainedErrorDebugEntries;
        debugApi.stats = getDebugStatsSummary;
        debugApi.collectPendingSyncEvidence = buildPendingSyncEvidence;
        debugApi.printPendingSyncEvidence = printPendingSyncEvidence;
        debugApi.queueState = (...args) => controller("pendingUploads")?.buildPendingUploadQueueStateSnapshot?.(...args);
        debugApi.queueSandbox = {
          active: () => Boolean(state.debugLocalQueueSandbox),
          clear: (...args) => controller("pendingUploads")?.clearDebugLocalQueueSandboxPendingUploads?.(...args),
          runAction: (...args) => controller("pendingUploads")?.runDebugLocalQueueSandboxAction?.(...args),
          seedPending: (...args) => controller("pendingUploads")?.seedDebugLocalQueueSandboxPendingUpload?.(...args),
        };
        debugApi.queueValidation = {
          check: (...args) => controller("pendingUploads")?.validatePendingUploadQueueScenario?.(...args),
        };
      }

      return {
        copyMeetingNotes,
        copySegmentsText,
        exposeDebugApi,
        setup,
      };
    },
  };
})(globalThis);
