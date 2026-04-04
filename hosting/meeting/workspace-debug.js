(function initHostedMeetingWorkspaceDebug(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  ns.workspaceDebug = {
    createController(deps) {
      const globalObject = deps?.global || global;
      const refs = deps?.refs || {};
      const state = deps?.state || {};
      const constants = deps?.constants || {};
      const helpers = deps?.helpers || {};
      const debugConsole = ns.debugConsole;
      const {
        buildCopyText,
        buildErrorCopyText,
        clearDebugEntries,
        getDebugEntries,
        isDebugPanelEnabled,
        logDebug,
        normalizeText,
        safeLocalStorageSet,
        setEnabled: setDebugEnabled,
        subscribeDebugEntries,
        summarizeEntries,
      } = ns.shared;
      const {
        buildDetailView,
        buildMeetingNotesCopyText,
        buildSegmentCopyText,
        findHistoryEntry,
      } = ns.render;

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      function buildHostedDebugConsoleButtonsSnapshot(panelElement) {
        const buttons = panelElement?.querySelectorAll?.("[data-debug-action]");
        return Array.from(buttons || []).map((button) => ({
          action: normalizeText(button?.dataset?.debugAction),
          disabled: Boolean(button?.disabled),
          id: normalizeText(button?.id),
          label: normalizeText(button?.textContent),
        }));
      }

      function buildDebugPanelState(entries = getDebugEntries()) {
        const normalizedEntries = Array.isArray(entries) ? entries : [];
        const summary = summarizeEntries(normalizedEntries);
        return debugConsole?.buildState?.({
          collapsed: state.debugPanelCollapsed,
          enabled: Boolean(refs.debugPanel && !refs.debugPanel.hidden),
          feedback: state.debugNotice,
          statusSummary: summary,
          text: buildCopyText(normalizedEntries),
        }) || {
          collapsed: state.debugPanelCollapsed,
          enabled: Boolean(refs.debugPanel && !refs.debugPanel.hidden),
          feedback: state.debugNotice,
          hasErrors: Math.max(0, Number(summary?.errorCount) || 0) > 0,
          statusSummary: summary,
          statusText: "",
          text: normalizeText(buildCopyText(normalizedEntries)) || "아직 로그가 없습니다.",
        };
      }

      function buildHostedDebugConsoleStateSnapshot(entries = getDebugEntries()) {
        const normalizedEntries = Array.isArray(entries) ? entries : [];
        const panelElement = refs.debugPanel;
        const stateSnapshot = buildDebugPanelState(normalizedEntries);
        const buttons = buildHostedDebugConsoleButtonsSnapshot(panelElement);
        const statusElement = panelElement?.querySelector?.("#debugStatus");
        const noticeElement = panelElement?.querySelector?.("#debugNotice");
        const logElement = panelElement?.querySelector?.("#debugLog");
        return {
          buttons,
          hasAuthCard: Boolean(panelElement?.querySelector?.(".debug-auth-card")),
          collapsed: Boolean(stateSnapshot?.collapsed),
          enabled: Boolean(stateSnapshot?.enabled),
          entryCount: normalizedEntries.length,
          feedback: {
            text: normalizeText(stateSnapshot?.feedback?.text),
            tone: normalizeText(stateSnapshot?.feedback?.tone) || "info",
          },
          hasErrors: Boolean(stateSnapshot?.hasErrors),
          hasFabBadge: Boolean(panelElement?.querySelector?.("#debugFabBadge")),
          hasFabButton: Boolean(panelElement?.querySelector?.("#debugFabButton")),
          hasLog: Boolean(logElement),
          hasSegmentCluster: Boolean(panelElement?.querySelector?.(".segment-cluster")),
          hasToolbar: Boolean(panelElement?.querySelector?.(".debug-panel__toolbar")),
          logText: normalizeText(logElement?.textContent || stateSnapshot?.text),
          noticeText: normalizeText(noticeElement?.textContent || stateSnapshot?.feedback?.text),
          rendered: Boolean(panelElement && panelElement.innerHTML),
          statusText: normalizeText(statusElement?.textContent || stateSnapshot?.statusText),
        };
      }

      function buildHostedDebugConsoleValidationChecks(snapshot) {
        const checks = [
          {
            label: "hosted debug console이 활성화됨",
            passed: Boolean(snapshot?.enabled),
            actual: snapshot?.enabled ? "enabled" : "disabled",
          },
          {
            label: "debug console markup이 렌더됨",
            passed: Boolean(snapshot?.rendered),
            actual: snapshot?.rendered ? "rendered" : "empty",
          },
        ];
        const actions = Array.isArray(snapshot?.buttons)
          ? snapshot.buttons.map((button) => normalizeText(button?.action)).filter(Boolean)
          : [];
        if (snapshot?.collapsed) {
          checks.push(
            {
              label: "collapsed 상태에서는 fab toggle이 보임",
              passed: Boolean(snapshot?.hasFabButton) && actions.includes("toggle"),
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
        const requiredActions = ["copy", "copy-errors", "clear", "toggle"];
        checks.push(
          {
            label: "expanded 상태에서는 auth 카드가 보임",
            passed: Boolean(snapshot?.hasAuthCard),
            actual: snapshot?.hasAuthCard ? "auth-card" : "missing",
          },
          {
            label: "expanded 상태에서는 toolbar가 보임",
            passed: Boolean(snapshot?.hasToolbar),
            actual: snapshot?.hasToolbar ? "toolbar" : "missing",
          },
          {
            label: "segment-cluster 구조가 유지됨",
            passed: Boolean(snapshot?.hasSegmentCluster),
            actual: snapshot?.hasSegmentCluster ? "segment-cluster" : "missing",
          },
          {
            label: "expanded 버튼 4종이 모두 렌더됨",
            passed: requiredActions.every((action) => actions.includes(action)),
            actual: actions.join(","),
          },
          {
            label: "status text가 비어 있지 않음",
            passed: Boolean(normalizeText(snapshot?.statusText)),
            actual: normalizeText(snapshot?.statusText),
          },
          {
            label: "log text가 비어 있지 않음",
            passed: Boolean(normalizeText(snapshot?.logText)),
            actual: normalizeText(snapshot?.logText).slice(0, 120),
          }
        );
        return checks;
      }

      function validateHostedDebugConsoleWorkspace(options = {}) {
        const snapshot = buildHostedDebugConsoleStateSnapshot(options?.entries);
        const checks = buildHostedDebugConsoleValidationChecks(snapshot);
        return {
          checks,
          collapsed: Boolean(snapshot?.collapsed),
          entryCount: Math.max(0, Number(snapshot?.entryCount) || 0),
          passed: checks.every((check) => Boolean(check?.passed)),
          snapshot,
        };
      }

      function syncDebugPanelCollapsedUi(options = {}) {
        const persist = options.persist !== false;
        if (persist) {
          safeLocalStorageSet(
            globalObject,
            constants.DEBUG_PANEL_COLLAPSED_STORAGE_KEY,
            state.debugPanelCollapsed ? "1" : "0"
          );
        }
        render(getDebugEntries());
      }

      function toggleDebugPanelCollapsed() {
        state.debugPanelCollapsed = !state.debugPanelCollapsed;
        syncDebugPanelCollapsedUi({ persist: true });
      }

      function forceExpand(options = {}) {
        if (!refs.debugPanel || refs.debugPanel.hidden || !state.debugPanelCollapsed) {
          render(getDebugEntries());
          return;
        }
        state.debugPanelCollapsed = false;
        syncDebugPanelCollapsedUi({ persist: options.persist === true });
      }

      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function renderAuthStatePanel() {
        const authMode = normalizeText(state.auth?.accessMode || state.auth?.accessDecision || "unknown");
        const rows = [
          ["authMode", authMode || "unknown"],
          ["extensionBridge", normalizeText(state.auth?.extensionBridge) || "not-requested"],
          ["inovaLogin", state.auth?.inovaLogin ? "yes" : "no"],
          ["accessDecision", normalizeText(state.auth?.accessDecision) || "unknown"],
          ["reason", normalizeText(state.auth?.reason) || "-"],
          ["viewer", normalizeText(state.auth?.viewer) || "-"],
          ["bypassMode", normalizeText(state.auth?.bypassMode) || "-"],
        ];
        return `
          <article class="debug-auth-card">
            <div class="debug-auth-card__head">
              <strong>인증 상태</strong>
              ${normalizeText(state.auth?.bypassMode) ? '<span class="debug-auth-card__badge">DEV BYPASS</span>' : ""}
            </div>
            <dl class="debug-auth-card__grid">
              ${rows.map(([label, value]) => `
                <div class="debug-auth-card__row">
                  <dt>${escapeHtml(label)}</dt>
                  <dd>${escapeHtml(value)}</dd>
                </div>
              `).join("")}
            </dl>
          </article>
        `;
      }

      function render(entries = getDebugEntries()) {
        if (!refs.debugPanel) return;
        if (refs.debugPanel.hidden) {
          refs.debugPanel.innerHTML = "";
          return;
        }
        const previousViewport = debugConsole?.captureLogViewport?.(refs.debugPanel.querySelector("#debugLog")) || null;
        const debugMarkup = debugConsole?.renderWorkspace?.(buildDebugPanelState(entries)) || "";
        refs.debugPanel.innerHTML = state.debugPanelCollapsed
          ? debugMarkup
          : `${renderAuthStatePanel()}${debugMarkup}`;
        const nextLog = refs.debugPanel.querySelector("#debugLog");
        if (!nextLog) return;
        debugConsole?.restoreLogViewport?.(nextLog, previousViewport);
      }

      function setup() {
        if (!refs.debugPanel) return;
        const enabled = isDebugPanelEnabled(globalObject);
        setDebugEnabled(enabled);
        if (refs.meetingShell) {
          refs.meetingShell.dataset.debugPanel = String(enabled);
        }
        state.unsubscribeDebug?.();
        state.unsubscribeDebug = null;
        refs.debugPanel.hidden = !enabled;
        render(getDebugEntries());
        if (!enabled) return;
        syncDebugPanelCollapsedUi({ persist: false });
        state.unsubscribeDebug = subscribeDebugEntries((entries) => render(entries));
        logDebug("workspace.debug.enabled", {
          href: globalObject.location.href,
        });
      }

      function clearDebugLogPanel() {
        clearDebugEntries();
        logDebug("workspace.debug.cleared", {});
        helpers.setDebugNotice?.("디버그 로그를 비웠습니다.", "highlight");
        helpers.applyRender?.();
      }

      async function copyDebugLog() {
        const text = normalizeText(buildCopyText(getDebugEntries()));
        if (!text) return;
        try {
          if (typeof globalObject.navigator?.clipboard?.writeText === "function") {
            await globalObject.navigator.clipboard.writeText(text);
            helpers.setDebugNotice?.("디버그 로그를 복사했습니다.", "highlight");
          } else {
            throw new Error("Clipboard API unavailable");
          }
        } catch {
          helpers.setDebugNotice?.("클립보드 권한이 없어 로그 복사를 완료하지 못했어요.", "error");
        }
        helpers.applyRender?.();
      }

      async function copyDebugErrors() {
        const text = normalizeText(buildErrorCopyText(getDebugEntries()));
        if (!text) {
          helpers.setDebugNotice?.("복사할 오류 로그가 없습니다.", "highlight");
          helpers.applyRender?.();
          return;
        }
        try {
          if (typeof globalObject.navigator?.clipboard?.writeText === "function") {
            await globalObject.navigator.clipboard.writeText(text);
            helpers.setDebugNotice?.("오류 로그를 복사했습니다.", "highlight");
          } else {
            throw new Error("Clipboard API unavailable");
          }
        } catch {
          helpers.setDebugNotice?.("클립보드 권한이 없어 오류 로그 복사를 완료하지 못했어요.", "error");
        }
        helpers.applyRender?.();
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

      function handlePanelClick(event) {
        const action = normalizeText(event.target?.closest?.("[data-debug-action]")?.dataset?.debugAction);
        if (!action) return;
        if (action === "copy") {
          void copyDebugLog();
          return;
        }
        if (action === "copy-errors") {
          void copyDebugErrors();
          return;
        }
        if (action === "clear") {
          clearDebugLogPanel();
          return;
        }
        if (action === "toggle") {
          toggleDebugPanelCollapsed();
        }
      }

      function exposeDebugApi() {
        const debugApi = globalObject.__INOVA_HOSTED_MEETING_DEBUG__ = globalObject.__INOVA_HOSTED_MEETING_DEBUG__ || {};
        debugApi.debugConsoleState = buildHostedDebugConsoleStateSnapshot;
        debugApi.debugConsoleValidation = {
          checkWorkspace: validateHostedDebugConsoleWorkspace,
        };
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
        forceExpand,
        handlePanelClick,
        render,
        setup,
      };
    },
  };
})(globalThis);
