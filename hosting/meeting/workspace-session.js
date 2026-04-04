(function initHostedMeetingWorkspaceSession(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  function createController(deps) {
    const shared = ns.shared;
    const render = ns.render;
    const {
      CONFIG,
      DEBUG_PANEL_COLLAPSED_STORAGE_KEY,
      DEGRADED_NOTICE_CODES,
      SESSION_STORAGE_KEY,
      applyRender,
      createEmptyWorkspaceMutationState,
      disposeWorkspaceRealtime,
      global: globalObject,
      refs,
      state,
      setDegradedNotice,
      clearDegradedNotice,
    } = deps;
    const {
      buildRemoteSelectionId,
      buildWorkspaceHash,
      buildWorkspaceSessionStorageKey,
      clearPersistedWorkspaceSession,
      loadPersistedWorkspaceSession,
      logDebug,
      normalizeText,
      normalizeTextBlock,
      parseParams,
      persistWorkspaceSessionPayload,
      postJson,
      safeLocalStorageGet,
    } = shared;
    const { findHistoryEntry } = render;
      function hasSessionRestoreBlockingIssue(issueCodes) {
        const normalizedCodes = Array.isArray(issueCodes) ? issueCodes : [];
        return normalizedCodes.some((code) => ["storage-invalid-payload", "storage-parse-failed", "storage-read-failed"].includes(normalizeText(code)));
      }


      function hasSessionRestoreWarningIssue(issueCodes) {
        const normalizedCodes = Array.isArray(issueCodes) ? issueCodes : [];
        return normalizedCodes.some((code) => ["storage-invalid-payload", "storage-parse-failed", "storage-read-failed", "storage-write-failed"].includes(normalizeText(code)));
      }


      function buildMissingSessionBlockedOptions() {
        if (!state.sessionRestore.hasBlockingIssue) {
          return {
            message: "직접 주소를 붙여 넣어 열면 회의 세션을 확인할 수 없습니다. i-Nova 패널의 회의 허브에서 다시 열어 주세요.",
          };
        }
        return {
          eyebrow: "세션 복원 실패",
          message: `${state.sessionRestore.degradedReason || "브라우저 저장소에서 회의 작업 세션을 다시 읽지 못했어요."} i-Nova 패널의 회의 허브에서 회의 화면을 다시 열어 새 세션을 받아 주세요.`,
          title: "저장된 회의 작업 세션을 다시 읽지 못했습니다",
          tone: "warning",
        };
      }


      function buildSessionRestoreDegradedNotice() {
        const reason = normalizeText(state.sessionRestore.degradedReason) || "브라우저 저장소에 회의 작업 세션을 다시 저장하거나 읽는 중 문제가 있었습니다.";
        return `${reason} 현재 화면은 계속 사용할 수 있지만, 다음 새로고침이나 재진입에서 세션 복원이 제한될 수 있습니다.`;
      }


      function buildSessionPersistDegradedNotice(reason) {
        const normalizedReason = normalizeText(reason) || "브라우저 저장소에 회의 작업 세션을 저장하지 못했어요.";
        return `${normalizedReason} 현재 탭에서는 작업을 계속할 수 있지만, 다음 새로고침이나 재진입에서는 최신 회의 상태가 복원되지 않을 수 있습니다.`;
      }


      function surfaceSessionRestoreNotice() {
        if (!state.sessionRestore.hasWarningIssue || !state.session.meetingSessionToken || !state.session.meetingId) {
          return;
        }
        setDegradedNotice(DEGRADED_NOTICE_CODES.sessionRestore, buildSessionRestoreDegradedNotice(), "warning");
      }


      function applyPersistWorkspaceSessionResult(result) {
        applyDegradedDiagnostics("sessionPersist", result, {
          buildNotice: (degradedReason) => buildSessionPersistDegradedNotice(degradedReason),
          degradedEvent: "workspace.session.persist.degraded",
          noticeCode: DEGRADED_NOTICE_CODES.sessionPersist,
          recoveredEvent: "workspace.session.persist.recovered",
        });
      }


      async function exchangeLaunch(launchToken) {
        logDebug("workspace.launch.exchange.start", { launchToken: Boolean(normalizeText(launchToken)) });
        const payload = await postJson(global, CONFIG.exchangeLaunchUrl, { launchToken });
        const meetingId = normalizeText(payload?.meeting?.meetingId);
        if (!meetingId || !normalizeText(payload?.meetingSessionToken)) throw new Error("회의 작업 세션을 만들지 못했어요. 패널에서 다시 시도해 주세요.");
        state.mode = normalizeText(payload?.mode) === "detail" ? "detail" : "create";
        state.session = { expiresAt: normalizeText(payload?.expiresAt), meetingId, meetingSessionToken: normalizeText(payload?.meetingSessionToken), mode: state.mode, sharedMemo: normalizeTextBlock(payload?.meeting?.sharedMemo), title: normalizeText(payload?.meeting?.title) };
        state.meeting = { deletedAt: "", meetingId, pendingLocalCount: 0, sharedMemo: state.session.sharedMemo, title: state.session.title, updatedAt: "", workspaceMutation: createEmptyWorkspaceMutationState() };
        state.selectedRecordId = normalizeText(payload?.jobId) ? buildRemoteSelectionId(payload.jobId) : "";
        logDebug("workspace.launch.exchange.success", {
          jobId: payload?.jobId,
          meetingId,
          mode: state.mode,
        });
        persistWorkspaceSession();
      }


      function restoreWorkspaceSession() {
        const restored = loadPersistedWorkspaceSession(global, normalizeText(state.params.meetingId), state.params.workspaceToken, state.params.jobId);
        const restoreIssues = Array.isArray(restored?.issues) ? restored.issues : [];
        const degradedReason = normalizeText(restored?.degradedReason);
        const issueCodes = restoreIssues.map((issue) => normalizeText(issue?.code)).filter(Boolean);
        state.sessionRestore = {
          degradedReason,
          hasBlockingIssue: hasSessionRestoreBlockingIssue(issueCodes),
          hasWarningIssue: hasSessionRestoreWarningIssue(issueCodes),
          issueCodes,
          source: normalizeText(restored?.source),
        };
        logDebug("workspace.session.restore", {
          degradedReason,
          hasRestoredPayload: Boolean(restored?.payload),
          issueCodes,
          issueCount: restoreIssues.length,
          meetingId: state.params.meetingId,
          source: restored?.source || "",
          workspaceToken: Boolean(state.params.workspaceToken),
        });
        if (degradedReason) {
          logDebug("workspace.session.restore.degraded", {
            degradedReason,
            issues: restoreIssues,
            meetingId: state.params.meetingId,
            source: restored?.source || "",
          });
        }
        if (!restored?.payload) return;
        const parsed = restored.payload;
        state.mode = normalizeText(parsed?.mode) === "detail" ? "detail" : "create";
        state.session = { expiresAt: normalizeText(parsed?.expiresAt), meetingId: normalizeText(parsed?.meetingId), meetingSessionToken: normalizeText(parsed?.meetingSessionToken), mode: state.mode, sharedMemo: normalizeTextBlock(parsed?.sharedMemo), title: normalizeText(parsed?.title) };
        state.meeting = { deletedAt: "", meetingId: state.session.meetingId, pendingLocalCount: 0, sharedMemo: state.session.sharedMemo, title: state.session.title, updatedAt: "", workspaceMutation: createEmptyWorkspaceMutationState() };
        state.selectedRecordId = normalizeText(state.params.jobId || parsed?.jobId) ? buildRemoteSelectionId(state.params.jobId || parsed?.jobId) : "";
        state.supersededRemoteJobIds = loadSupersededRemoteJobIds(state.session.meetingId);
      }


      function collectSupersededRemoteJobIds() {
        return Array.from(new Set(
          (Array.isArray(state.pendingUploads) ? state.pendingUploads : [])
            .flatMap((pending) => Array.isArray(pending?.supersededJobIds) ? pending.supersededJobIds : [pending?.supersededJobId])
            .map((jobId) => normalizeText(jobId))
            .filter(Boolean)
        ));
      }


      function loadSupersededRemoteJobIds(meetingId) {
        const normalizedMeetingId = normalizeText(meetingId);
        const rawEntries = [];
        if (normalizedMeetingId) {
          rawEntries.push(safeLocalStorageGet(global, buildWorkspaceSessionStorageKey(normalizedMeetingId)));
        }
        try {
          rawEntries.push(global.sessionStorage?.getItem?.(SESSION_STORAGE_KEY) || "");
        } catch {}
        for (const rawEntry of rawEntries) {
          if (!normalizeText(rawEntry)) continue;
          try {
            const parsed = JSON.parse(rawEntry);
            if (normalizedMeetingId && normalizeText(parsed?.meetingId) && normalizeText(parsed.meetingId) !== normalizedMeetingId) {
              continue;
            }
            return Array.from(new Set(
              (Array.isArray(parsed?.supersededRemoteJobIds) ? parsed.supersededRemoteJobIds : [])
                .map((jobId) => normalizeText(jobId))
                .filter(Boolean)
            ));
          } catch {}
        }
        return [];
      }


      function persistWorkspaceSession() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        const payload = {
          expiresAt: state.session.expiresAt,
          jobId: normalizeText(entry?.remote?.jobId || entry?.pending?.jobId),
          meetingId: state.session.meetingId,
          meetingSessionToken: state.session.meetingSessionToken,
          mode: state.mode,
          sharedMemo: normalizeTextBlock(state.recordMemoDraft || state.recordMemoSaved),
          supersededRemoteJobIds: collectSupersededRemoteJobIds(),
          title: normalizeText(state.meeting.title || state.session.title),
        };
        state.supersededRemoteJobIds = payload.supersededRemoteJobIds;
        applyPersistWorkspaceSessionResult(persistWorkspaceSessionPayload(global, payload));
        replaceCleanUrl();
      }

      function clearWorkspaceSession() {
        const cleared = clearPersistedWorkspaceSession(global, state.session.meetingId);
        const degradedReason = normalizeText(cleared?.degradedReason);
        const issues = Array.isArray(cleared?.issues) ? cleared.issues : [];
        if (degradedReason) {
          logDebug("workspace.session.clear.degraded", {
            degradedReason,
            issues,
            meetingId: state.session.meetingId,
          });
        }
        disposeWorkspaceRealtime({ clearAuthCache: true });
      }

      function replaceCleanUrl() { const currentUrl = new URL(global.location.href); const preserveDebug = currentUrl.searchParams.get("debug") === "1"; const nextUrl = new URL(global.location.href); nextUrl.search = ""; nextUrl.hash = ""; if (preserveDebug) nextUrl.searchParams.set("debug", "1"); if (state.session.meetingId) nextUrl.searchParams.set("meetingId", state.session.meetingId); const entry = findHistoryEntry(state, state.selectedRecordId); const jobId = normalizeText(entry?.remote?.jobId || entry?.pending?.jobId); if (jobId) nextUrl.searchParams.set("jobId", jobId); if (state.session.meetingSessionToken) nextUrl.hash = buildWorkspaceHash(state.session.meetingSessionToken); global.history.replaceState({}, "", nextUrl.toString()); state.params = parseParams(nextUrl.toString()); }

    async function bootSession() {
      if (state.params.launchToken) {
        await exchangeLaunch(state.params.launchToken);
      } else {
        restoreWorkspaceSession();
      }
      return state.session;
    }

    return {
      bootSession,
      buildMissingSessionBlockedOptions,
      clearSession: clearWorkspaceSession,
      exchangeLaunch,
      persistSession: persistWorkspaceSession,
      replaceCleanUrl,
      restoreSession: restoreWorkspaceSession,
      surfaceSessionRestoreNotice,
    };
  }

  ns.workspaceSession = { createController };
})(globalThis);
