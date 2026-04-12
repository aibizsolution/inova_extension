(function initHostedDebugController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const POLL_INTERVAL_MS = 1200;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "page.adapter.v2",
  ]);

  function create(options = {}) {
    const invokePage = typeof options.invokePage === "function"
      ? options.invokePage
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};

    const state = {
      capabilities: [],
      collapsed: true,
      debugState: createDebugState(),
      feedback: null,
      feedbackTimer: 0,
      loadPromise: null,
      panelVisible: false,
      pollTimer: 0,
      requestedEnabled: false,
      settings: {
        enabled: true,
        meetingDebugConsoleEnabled: false,
      },
    };

    return {
      buildViewState,
      handleDebugAction,
      hasRequiredCapabilities,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      if (!hasRequiredCapabilities()) {
        stopPolling();
        return;
      }

      state.panelVisible = Boolean(panelState?.visible);
      state.settings = {
        ...state.settings,
        ...(panelState?.settings && typeof panelState.settings === "object" ? panelState.settings : {}),
      };

      const shouldEnable = readShouldEnable();
      if (state.requestedEnabled !== shouldEnable) {
        void setEnabled(shouldEnable);
        return;
      }
      if (shouldEnable) {
        if (!state.loadPromise && !state.debugState.checkedAt) {
          void refreshDebugState();
        }
        schedulePolling();
        return;
      }
      stopPolling();
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function buildViewState() {
      if (!hasRequiredCapabilities()) {
        return createDebugState();
      }
      const currentState = state.debugState;
      return {
        collapsed: currentState.enabled ? Boolean(state.collapsed) : true,
        enabled: Boolean(currentState.enabled),
        feedback: normalizeFeedback(state.feedback),
        hasErrors: Boolean(currentState.hasErrors),
        statusSummary: cloneValue(currentState.statusSummary),
        statusText: namespace.meetingDebugConsole?.buildStatusText?.(currentState.statusSummary)
          || "함수 0건 · 읽기 0건 · 리스너 0건 · 오류 0건",
        text: currentState.text || "아직 로그가 없습니다.",
      };
    }

    async function handleDebugAction(action) {
      const normalizedAction = normalizeText(action);
      if (!normalizedAction.startsWith("debug-")) {
        return false;
      }
      if (normalizedAction === "debug-toggle") {
        state.collapsed = !state.collapsed;
        scheduleRender();
        return true;
      }
      if (normalizedAction === "debug-clear") {
        const nextState = await invokePage({ action: "clear-debug-log" });
        hydrateDebugState(nextState);
        setFeedback("디버그 로그를 비웠습니다.", "info", 1600);
        schedulePolling();
        return true;
      }
      if (normalizedAction === "debug-copy" || normalizedAction === "debug-copy-errors") {
        const copied = await invokePage({
          action: "copy-debug-log",
          errorsOnly: normalizedAction === "debug-copy-errors",
        });
        if (copied?.copied) {
          setFeedback(
            normalizedAction === "debug-copy-errors" ? "디버그 오류 로그를 복사했습니다." : "디버그 로그를 복사했습니다.",
            "info",
            1800
          );
        } else {
          setFeedback(
            normalizedAction === "debug-copy-errors" ? "복사할 디버그 오류 로그가 없습니다." : "복사할 디버그 로그가 없습니다.",
            "info",
            1600
          );
        }
        schedulePolling();
        return true;
      }
      return false;
    }

    async function setEnabled(nextEnabled) {
      state.requestedEnabled = Boolean(nextEnabled);
      try {
        const nextState = await invokePage({
          action: "set-debug-enabled",
          enabled: state.requestedEnabled,
        });
        hydrateDebugState(nextState);
      } catch (error) {
        hydrateDebugState({
          ...createDebugState(),
          enabled: false,
          hasErrors: true,
          text: getErrorMessage(error, "디버그 상태를 준비하지 못했어요."),
        });
      }
      if (state.requestedEnabled) {
        schedulePolling();
      } else {
        stopPolling();
      }
      scheduleRender();
    }

    async function refreshDebugState() {
      if (state.loadPromise) {
        return state.loadPromise;
      }
      const run = (async () => {
        try {
          const nextState = await invokePage({ action: "get-debug-state" });
          hydrateDebugState(nextState);
          return state.debugState;
        } catch (error) {
          state.debugState = {
            ...state.debugState,
            checkedAt: new Date().toISOString(),
            hasErrors: true,
            text: getErrorMessage(error, "디버그 상태를 읽지 못했어요."),
          };
          return state.debugState;
        } finally {
          scheduleRender();
        }
      })();
      state.loadPromise = run;
      try {
        return await run;
      } finally {
        if (state.loadPromise === run) {
          state.loadPromise = null;
        }
      }
    }

    function schedulePolling() {
      stopPolling();
      if (!readShouldEnable()) {
        return;
      }
      state.pollTimer = global.setTimeout(() => {
        state.pollTimer = 0;
        void refreshDebugState().finally(() => {
          schedulePolling();
        });
      }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      global.clearTimeout(state.pollTimer);
      state.pollTimer = 0;
    }

    function readShouldEnable() {
      return Boolean(state.panelVisible && state.settings.enabled && state.settings.meetingDebugConsoleEnabled);
    }

    function hydrateDebugState(nextState) {
      const normalizedState = nextState && typeof nextState === "object" ? nextState : {};
      state.debugState = {
        checkedAt: new Date().toISOString(),
        enabled: Boolean(normalizedState.enabled),
        hasErrors: Boolean(normalizedState.hasErrors),
        statusSummary: {
          errorCount: Math.max(0, Number(normalizedState?.statusSummary?.errorCount) || 0),
          functionCalls: Math.max(0, Number(normalizedState?.statusSummary?.functionCalls) || 0),
          readCount: Math.max(0, Number(normalizedState?.statusSummary?.readCount) || 0),
          snapshotCount: Math.max(0, Number(normalizedState?.statusSummary?.snapshotCount) || 0),
          totalLogs: Math.max(0, Number(normalizedState?.statusSummary?.totalLogs) || 0),
        },
        text: normalizeText(normalizedState.text) || "아직 로그가 없습니다.",
      };
    }

    function setFeedback(text, tone = "info", timeoutMs = 1800) {
      global.clearTimeout(state.feedbackTimer);
      const nextText = normalizeText(text);
      state.feedback = nextText
        ? {
            text: nextText,
            tone: normalizeText(tone) || "info",
          }
        : null;
      scheduleRender();
      if (!nextText || timeoutMs <= 0) {
        state.feedbackTimer = 0;
        return;
      }
      state.feedbackTimer = global.setTimeout(() => {
        state.feedback = null;
        state.feedbackTimer = 0;
        scheduleRender();
      }, timeoutMs);
    }

    function createDebugState() {
      return {
        checkedAt: "",
        enabled: false,
        hasErrors: false,
        statusSummary: {
          errorCount: 0,
          functionCalls: 0,
          readCount: 0,
          snapshotCount: 0,
          totalLogs: 0,
        },
        text: "",
      };
    }

    function normalizeText(value) {
      return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    }

    function normalizeFeedback(feedback) {
      return {
        text: normalizeText(feedback?.text),
        tone: normalizeText(feedback?.tone) || "info",
      };
    }

    function getErrorMessage(error, fallback) {
      return normalizeText(error instanceof Error ? error.message : error) || fallback;
    }

    function cloneValue(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }
  }

  namespace.debugController = { create };
})(globalThis);
