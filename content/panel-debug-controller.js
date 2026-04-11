(function initPanelDebugController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const MEETING_DEBUG_COLLAPSED_KEY = "__INOVA_MEETING_PANEL_DEBUG_COLLAPSED__";
  const DEBUG_ACTIONS = new Set(["debug-toggle", "debug-copy", "debug-copy-errors", "debug-clear"]);

  function create(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const render = typeof deps.render === "function" ? deps.render : () => {};

    async function handleAction(action) {
      if (action === "debug-toggle") {
        toggleCollapsed();
        return true;
      }
      if (action === "debug-copy") {
        await copyEntries(false);
        return true;
      }
      if (action === "debug-copy-errors") {
        await copyEntries(true);
        return true;
      }
      if (action === "debug-clear") {
        namespace.panelDebug?.clearEntries?.();
        setFeedback("디버그 로그를 비웠습니다.", "info", 1600);
        return true;
      }
      return false;
    }

    function buildState() {
      const enabled = shouldEnable();
      const entries = enabled ? (namespace.panelDebug?.getEntries?.() || []) : [];
      const summary = enabled ? (namespace.panelDebug?.summarizeEntries?.(entries) || {}) : {};
      const statusSummary = {
        errorCount: Math.max(0, Number(summary?.errorCount) || 0),
        functionCalls: Math.max(0, Number(summary?.functionCalls) || 0),
        readCount: Math.max(0, Number(summary?.readCount) || 0),
        snapshotCount: Math.max(0, Number(summary?.snapshotCount) || 0),
        totalLogs: Math.max(0, Number(entries.length) || 0),
      };
      return namespace.meetingDebugConsole?.buildState?.({
        collapsed: Boolean(state.panelDebugUi.collapsed),
        enabled,
        feedback: normalizeFeedback(state.panelDebugUi.feedback),
        hasErrors: statusSummary.errorCount > 0,
        statusSummary,
        text: enabled
          ? (namespace.panelDebug?.buildCopyText?.(entries) || "아직 로그가 없습니다.")
          : "",
      }) || {
        collapsed: Boolean(state.panelDebugUi.collapsed),
        enabled,
        feedback: normalizeFeedback(state.panelDebugUi.feedback),
        hasErrors: statusSummary.errorCount > 0,
        statusSummary,
        statusText: enabled
          ? `함수 ${statusSummary.functionCalls}건 · 읽기 ${statusSummary.readCount}건 · 리스너 ${statusSummary.snapshotCount}건 · 오류 ${statusSummary.errorCount}건`
          : "함수 0건 · 읽기 0건 · 리스너 0건 · 오류 0건",
        text: enabled
          ? (namespace.panelDebug?.buildCopyText?.(entries) || "아직 로그가 없습니다.")
          : "",
      };
    }

    function handlesAction(action) {
      return DEBUG_ACTIONS.has(namespace.session.normalizeText(action));
    }

    function installValidationApi() {
      namespace.panelDebugValidation = {
        check: validateDebugConsole,
        state: buildDebugStateSnapshot,
      };
    }

    function syncEnabled() {
      namespace.panelDebug?.setEnabled?.(shouldEnable());
    }

    function buildDebugButtonsSnapshot(debugLayer) {
      const buttons = debugLayer?.querySelectorAll?.("[data-meeting-action]");
      return Array.from(buttons || [])
        .map((button) => ({
          action: namespace.session.normalizeText(button?.dataset?.meetingAction),
          disabled: Boolean(button?.disabled),
          label: namespace.session.normalizeText(button?.textContent),
        }))
        .filter((button) => button.action.startsWith("debug-"));
    }

    function buildDebugStateSnapshot(entries = namespace.panelDebug?.getEntries?.() || []) {
      const normalizedEntries = Array.isArray(entries) ? entries : [];
      const debugState = buildState();
      const debugLayer = global.document.getElementById("inova-meeting-debug-layer");
      const logElement = debugLayer?.querySelector?.(".inova-meeting-debug-console__log");
      const feedbackElement = debugLayer?.querySelector?.(".inova-meeting-debug-console__feedback");
      const statusElement = debugLayer?.querySelector?.(".inova-meeting-debug-console__status");
      return {
        buttons: buildDebugButtonsSnapshot(debugLayer),
        collapsed: Boolean(debugState?.collapsed),
        enabled: Boolean(debugState?.enabled),
        entryCount: normalizedEntries.length,
        feedback: normalizeFeedback(debugState?.feedback),
        hasErrors: Boolean(debugState?.hasErrors),
        hasFabBadge: Boolean(debugLayer?.querySelector?.(".inova-meeting-debug-fab__badge")),
        hasFabButton: Boolean(debugLayer?.querySelector?.(".inova-meeting-debug-fab[data-meeting-action=\"debug-toggle\"]")),
        hasLog: Boolean(logElement),
        logText: namespace.session.normalizeText(logElement?.textContent || debugState?.text),
        noticeText: namespace.session.normalizeText(feedbackElement?.textContent || debugState?.feedback?.text),
        rendered: Boolean(debugLayer && debugLayer.innerHTML),
        statusText: namespace.session.normalizeText(statusElement?.getAttribute("aria-label") || debugState?.statusText),
      };
    }

    function buildValidationChecks(snapshot) {
      const checks = [
        {
          label: "panel meeting debug console이 활성화됨",
          passed: Boolean(snapshot?.enabled),
          actual: snapshot?.enabled ? "enabled" : "disabled",
        },
        {
          label: "panel debug console markup이 렌더됨",
          passed: Boolean(snapshot?.rendered),
          actual: snapshot?.rendered ? "rendered" : "empty",
        },
      ];
      const actions = Array.isArray(snapshot?.buttons)
        ? snapshot.buttons.map((button) => namespace.session.normalizeText(button?.action)).filter(Boolean)
        : [];
      if (snapshot?.collapsed) {
        checks.push(
          {
            label: "collapsed 상태에서는 debug toggle fab만 보임",
            passed: actions.length === 1 && actions[0] === "debug-toggle" && Boolean(snapshot?.hasFabButton),
            actual: actions.join(","),
          },
          {
            label: "오류가 있으면 fab badge가 보임",
            passed: !snapshot?.hasErrors || Boolean(snapshot?.hasFabBadge),
            actual: snapshot?.hasFabBadge ? "badge" : "no-badge",
          }
        );
        return checks;
      }
      const requiredActions = ["debug-copy", "debug-copy-errors", "debug-clear", "debug-toggle"];
      checks.push(
        {
          label: "expanded 버튼 4종이 모두 렌더됨",
          passed: requiredActions.every((action) => actions.includes(action)),
          actual: actions.join(","),
        },
        {
          label: "status text가 비어 있지 않음",
          passed: Boolean(namespace.session.normalizeText(snapshot?.statusText)),
          actual: namespace.session.normalizeText(snapshot?.statusText),
        },
        {
          label: "log text가 비어 있지 않음",
          passed: Boolean(namespace.session.normalizeText(snapshot?.logText)),
          actual: namespace.session.normalizeText(snapshot?.logText).slice(0, 120),
        }
      );
      return checks;
    }

    async function copyEntries(errorsOnly) {
      const entries = namespace.panelDebug?.getEntries?.() || [];
      const text = errorsOnly
        ? namespace.panelDebug?.buildErrorCopyText?.(entries)
        : namespace.panelDebug?.buildCopyText?.(entries);
      if (!namespace.session.normalizeText(text)) {
        setFeedback(errorsOnly ? "복사할 디버그 오류 로그가 없습니다." : "복사할 디버그 로그가 없습니다.", "info", 1600);
        return;
      }
      try {
        await global.navigator.clipboard.writeText(text);
        setFeedback(errorsOnly ? "디버그 오류 로그를 복사했습니다." : "디버그 로그를 복사했습니다.", "info", 1800);
      } catch (error) {
        setFeedback("클립보드에 디버그 로그를 복사하지 못했습니다.", "error", 2200);
        namespace.panelDebug?.log?.("panel.debug.copy.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          errorsOnly: Boolean(errorsOnly),
        });
      }
    }

    function setFeedback(text, tone = "info", timeoutMs = 1800) {
      global.clearTimeout(state.panelDebugUi.feedbackTimer);
      const nextText = namespace.session.normalizeText(text);
      state.panelDebugUi.feedback = nextText
        ? {
            text: nextText,
            tone: namespace.session.normalizeText(tone) || "info",
          }
        : null;
      render();
      if (!nextText || timeoutMs <= 0) {
        state.panelDebugUi.feedbackTimer = 0;
        return;
      }
      state.panelDebugUi.feedbackTimer = global.setTimeout(() => {
        state.panelDebugUi.feedback = null;
        state.panelDebugUi.feedbackTimer = 0;
        render();
      }, timeoutMs);
    }

    function shouldEnable() {
      return Boolean(
        namespace.panelDebug?.isLocalDebugEnabled?.(state.settings)
        && state.settings.enabled
        && isToolSurface()
        && !isPaused()
        && global.document.visibilityState === "visible"
      );
    }

    function toggleCollapsed() {
      state.panelDebugUi.collapsed = !state.panelDebugUi.collapsed;
      writeCollapsedPreference(state.panelDebugUi.collapsed);
      render();
    }

    function validateDebugConsole() {
      const snapshot = buildDebugStateSnapshot();
      const checks = buildValidationChecks(snapshot);
      return {
        checks,
        collapsed: Boolean(snapshot?.collapsed),
        entryCount: Math.max(0, Number(snapshot?.entryCount) || 0),
        passed: checks.every((check) => Boolean(check?.passed)),
        snapshot,
      };
    }

    return {
      buildState,
      handleAction,
      handlesAction,
      installValidationApi,
      syncEnabled,
    };
  }

  function normalizeFeedback(feedback) {
    const text = namespace.session.normalizeText(feedback?.text);
    return {
      text,
      tone: namespace.session.normalizeText(feedback?.tone) || "info",
    };
  }

  function readCollapsedPreference() {
    try {
      return global.localStorage?.getItem(MEETING_DEBUG_COLLAPSED_KEY) !== "0";
    } catch (error) {
      console.warn("[i-Nova Bookmarks] meeting debug collapsed read failed", error);
      return true;
    }
  }

  function writeCollapsedPreference(collapsed) {
    try {
      global.localStorage?.setItem(MEETING_DEBUG_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch (error) {
      console.warn("[i-Nova Bookmarks] meeting debug collapsed write failed", error);
    }
  }

  namespace.panelDebugController = {
    create,
    readCollapsedPreference,
  };
})(globalThis);
