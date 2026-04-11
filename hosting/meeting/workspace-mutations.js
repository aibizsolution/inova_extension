(function initHostedMeetingWorkspaceMutations(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
const SECTION_LABELS = Object.freeze({
  actionItems: "후속 실행 항목",
  decisions: "주요 결정 사항",
  discussionFlow: "논의 흐름",
  openQuestions: "추가 결정 필요 사항",
  overview: "회의 개요",
  risksOrDependencies: "리스크 및 제약",
});

  ns.workspaceMutations = {
    createController(deps) {
      const globalObject = deps?.global || global;
      const refs = deps?.refs || {};
      const state = deps?.state || {};
      const constants = deps?.constants || {};
      const helpers = deps?.helpers || {};
      const {
        buildLocalPendingJob,
        buildMeetingNotesSectionPreview,
        findHistoryEntry,
        getMeetingNotesSectionLabel,
        normalizeArtifact,
        normalizeJob,
        normalizeRecord,
        renderNotesSection,
      } = ns.render;
      const { escapeHtml, logDebug, normalizeText, normalizeTextBlock, postJson } = ns.shared;
      const CONFIG = constants.CONFIG || {};
      const MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS = constants.MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS || 1600;
      const MAX_MEETING_TERM_REPLACEMENTS = constants.MAX_MEETING_TERM_REPLACEMENTS || 24;
      const MAX_MEETING_TERM_REPLACEMENT_TEXT_CHARS = constants.MAX_MEETING_TERM_REPLACEMENT_TEXT_CHARS || 120;
      const MAX_SHARED_MEMO_CHARS = constants.MAX_SHARED_MEMO_CHARS || 0;
      const PENDING_UPLOAD_QUEUE_OPERATION_SCOPES = constants.PENDING_UPLOAD_QUEUE_OPERATION_SCOPES || {};

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      const applyRender = (...args) => helpers.applyRender?.(...args);
      const cloneNotesInputSnapshot = (...args) => helpers.cloneNotesInputSnapshot?.(...args);
      const cloneTermReplacements = (...args) => helpers.cloneTermReplacements?.(...args);
      const createEmptyRecordMoveState = (...args) => helpers.createEmptyRecordMoveState?.(...args) || {
        error: "",
        items: [],
        loadRequestId: "",
        loading: false,
        open: false,
        recordId: "",
        selectedMeetingId: "",
        submitting: false,
      };
      const createEmptySectionEditState = (...args) => helpers.createEmptySectionEditState?.(...args);
      const renderBlocked = (...args) => helpers.renderBlocked?.(...args);
      const requestConfirmation = (...args) => helpers.requestConfirmation?.(...args);
      const setNotice = (...args) => helpers.setNotice?.(...args);
      const persistWorkspaceSession = (...args) => controller("session")?.persistSession?.(...args);
      const clearWorkspaceSession = (...args) => controller("session")?.clearSession?.(...args);
      const refreshWorkspace = (...args) => controller("realtime")?.refreshWorkspace?.(...args);
      const runPendingUploadQueueOperation = (...args) => controller("pendingUploads")?.runPendingUploadQueueOperation?.(...args);
      const showPendingUploadQueueOperationError = (...args) => controller("pendingUploads")?.showPendingUploadQueueOperationError?.(...args);
      const deletePendingUpload = (...args) => controller("pendingUploads")?.deletePendingUpload?.(...args);
      const handleLocalQueueAction = (...args) => controller("pendingUploads")?.handleLocalQueueAction?.(...args);
      const upsertPendingUpload = (...args) => controller("pendingUploads")?.createOrUpdatePendingUpload?.(...args);
      const syncWorkspaceLocalState = (...args) => controller("realtime")?.syncWorkspaceLocalState?.(...args);

      function resolveSectionLabel(sectionKey) {
        const normalized = normalizeText(sectionKey);
        return typeof getMeetingNotesSectionLabel === "function"
          ? getMeetingNotesSectionLabel(normalized)
          : SECTION_LABELS[normalized] || "회의 정리";
      }

      function normalizeWorkspaceMutation(mutation) {
        const nextMutation = mutation && typeof mutation === "object" ? mutation : {};
        return {
          completedAt: normalizeText(nextMutation.completedAt),
          error: normalizeText(nextMutation.error),
          requestedAt: normalizeText(nextMutation.requestedAt),
          requestId: normalizeText(nextMutation.requestId),
          status: normalizeText(nextMutation.status),
          type: normalizeText(nextMutation.type),
        };
      }

      function normalizeTextareaDraft(value) {
        return String(value || "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
      }

      function generateClientRequestId(prefix = "mutation") {
        const normalizedPrefix = normalizeText(prefix) || "mutation";
        if (typeof globalObject.crypto?.randomUUID === "function") {
          return `${normalizedPrefix}-${globalObject.crypto.randomUUID()}`;
        }
        return `${normalizedPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }

      function getMutationBusyKey(type) {
        switch (normalizeText(type)) {
          case "applySectionEdit":
            return "applySectionEdit";
          case "deleteMeeting":
            return "deleteMeeting";
          case "deleteRecord":
            return "deleteRecord";
          case "moveRecord":
            return "moveRecord";
          case "previewSectionEdit":
            return "previewSectionEdit";
          case "saveMeetingMemo":
            return "saveMeetingMemo";
          case "saveMeetingTermReplacements":
            return "saveMeetingTermReplacements";
          case "saveMeetingTitle":
            return "saveMeetingTitle";
          case "saveRecordMemo":
            return "saveRecordMemo";
          case "saveRecordTitle":
            return "saveRecordTitle";
          default:
            return "";
        }
      }

      function getSelectedRecordWorkspaceMutation() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        return normalizeWorkspaceMutation(
          state.currentJob?.workspaceMutation?.requestId
            ? state.currentJob.workspaceMutation
            : entry?.remote?.workspaceMutation
        );
      }

      function syncWorkspaceMutationBusyState() {
        const nextBusy = {
          applySectionEdit: false,
          deleteMeeting: false,
          deleteRecord: false,
          moveRecord: false,
          previewSectionEdit: false,
          queue: state.busy.queue || Object.create(null),
          saveMeetingMemo: false,
          saveMeetingTermReplacements: false,
          saveMeetingTitle: false,
          saveRecordMemo: false,
          saveRecordTitle: false,
        };
        Object.values(state.pendingMutations || {}).forEach((mutation) => {
          const busyKey = getMutationBusyKey(mutation?.type);
          if (busyKey) {
            nextBusy[busyKey] = true;
          }
        });
        const meetingMutation = normalizeWorkspaceMutation(state.meeting?.workspaceMutation);
        if (["queued", "processing"].includes(meetingMutation.status)) {
          const busyKey = getMutationBusyKey(meetingMutation.type);
          if (busyKey) {
            nextBusy[busyKey] = true;
          }
        }
        const selectedRecordMutation = getSelectedRecordWorkspaceMutation();
        if (["queued", "processing"].includes(selectedRecordMutation.status)) {
          const busyKey = getMutationBusyKey(selectedRecordMutation.type);
          if (busyKey) {
            nextBusy[busyKey] = true;
          }
        }
        Object.assign(state.busy, nextBusy);
      }

      function registerPendingMutation(options) {
        const requestId = normalizeText(options?.requestId);
        if (!requestId) {
          return null;
        }
        state.pendingMutations[requestId] = {
          jobId: normalizeText(options?.jobId),
          pendingRequestId: normalizeText(options?.pendingRequestId),
          quiet: Boolean(options?.quiet),
          recordId: normalizeText(options?.recordId),
          requestId,
          successMessage: normalizeText(options?.successMessage),
          type: normalizeText(options?.type),
        };
        syncWorkspaceMutationBusyState();
        return state.pendingMutations[requestId];
      }

      async function finalizePendingMutation(requestId, outcome, errorMessage) {
        const normalizedRequestId = normalizeText(requestId);
        const mutation = state.pendingMutations[normalizedRequestId];
        if (!mutation) {
          syncWorkspaceMutationBusyState();
          return false;
        }
        delete state.pendingMutations[normalizedRequestId];
        syncWorkspaceMutationBusyState();

        if (outcome === "failed") {
          setNotice(normalizeText(errorMessage) || "회의 변경 사항을 반영하지 못했어요.", "error");
          applyRender();
          return true;
        }

        if (mutation.type === "deleteMeeting") {
          try {
            await runPendingUploadQueueOperation(
              () => state.queueStore.clearMeeting(state.session.meetingId),
              {
                context: {
                  phase: "workspace-delete",
                  reason: "workspace-delete",
                },
                scope: PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.cleanup,
              }
            );
          } catch (error) {
            showPendingUploadQueueOperationError(error, "브라우저에 남아 있는 로컬 녹음을 정리하지 못했어요.");
          }
          clearWorkspaceSession();
          renderBlocked("이 탭은 여기까지입니다. 필요할 때 i-Nova 패널에서 새 회의 룸을 열어 주세요.", {
            eyebrow: "회의 룸 삭제 완료",
            title: "회의 룸을 삭제했습니다",
            tone: "complete",
          });
          return true;
        }

        if (mutation.type === "deleteRecord" && mutation.pendingRequestId) {
          try {
            await deletePendingUpload(mutation.pendingRequestId, {
              context: {
                phase: "record-delete",
                reason: "record-delete",
              },
            });
          } catch (error) {
            showPendingUploadQueueOperationError(error, "브라우저에 남아 있는 로컬 녹음을 정리하지 못했어요.");
          }
        }

        if (!mutation.quiet && mutation.successMessage) {
          setNotice(mutation.successMessage, "highlight");
        }
        applyRender();
        return true;
      }

      async function resolvePendingMutationsFromSnapshots() {
        const pendingMutations = Object.values(state.pendingMutations || {});
        for (const mutation of pendingMutations) {
          if (!mutation?.requestId) {
            continue;
          }
          if (mutation.type === "deleteMeeting") {
            if (normalizeText(state.meeting?.deletedAt)) {
              await finalizePendingMutation(mutation.requestId, "succeeded");
            }
            continue;
          }
          if (mutation.type === "deleteRecord") {
            const stillExists = state.records.some((record) => normalizeText(record.jobId) === mutation.jobId);
            if (!stillExists) {
              await finalizePendingMutation(mutation.requestId, "succeeded");
            }
            continue;
          }
          if (mutation.type === "moveRecord") {
            const stillExists = state.records.some((record) => normalizeText(record.jobId) === mutation.jobId);
            if (!stillExists) {
              await finalizePendingMutation(mutation.requestId, "succeeded");
            }
            continue;
          }
          const snapshotMutation = ["saveMeetingTitle", "saveMeetingMemo", "saveMeetingTermReplacements"].includes(mutation.type)
            ? normalizeWorkspaceMutation(state.meeting?.workspaceMutation)
            : normalizeWorkspaceMutation(
                state.records.find((record) => normalizeText(record.jobId) === mutation.jobId)?.workspaceMutation
                  || (normalizeText(state.currentJob?.jobId) === mutation.jobId ? state.currentJob?.workspaceMutation : null)
              );
          if (snapshotMutation.requestId !== mutation.requestId) {
            continue;
          }
          if (snapshotMutation.status === "succeeded") {
            await finalizePendingMutation(mutation.requestId, "succeeded");
          } else if (snapshotMutation.status === "failed") {
            await finalizePendingMutation(mutation.requestId, "failed", snapshotMutation.error);
          }
        }
        syncWorkspaceMutationBusyState();
      }

      function buildMeetingMutationContractErrorMessage(subject) {
        const normalizedSubject = normalizeText(subject) || "회의 작업";
        return `${normalizedSubject} 반영을 지원하는 최신 함수가 아직 배포되지 않았어요. npm run deploy:functions 후 다시 시도해 주세요.`;
      }

      function assertAcceptedMutationResponse(payload, requestId, subject) {
        const normalizedRequestId = normalizeText(requestId);
        const payloadRequestId = normalizeText(payload?.requestId);
        if (payload?.accepted === true && payloadRequestId === normalizedRequestId) {
          return;
        }
        throw new Error(buildMeetingMutationContractErrorMessage(subject));
      }

      function compareTermReplacements(leftItems, rightItems) {
        const left = cloneTermReplacements(leftItems);
        const right = cloneTermReplacements(rightItems);
        if (left.length !== right.length) {
          return false;
        }
        return left.every((item, index) =>
          normalizeText(item.from) === normalizeText(right[index]?.from)
          && normalizeText(item.to) === normalizeText(right[index]?.to)
        );
      }

      function isTermReplacementDirty() {
        return !compareTermReplacements(state.termReplacementState.items, state.termReplacementState.saved);
      }

      function resetSectionEditPreviewState(options = {}) {
        const nextState = createEmptySectionEditState();
        nextState.recordId = normalizeText(options.recordId ?? state.sectionEdit.recordId);
        nextState.jobId = normalizeText(options.jobId ?? state.sectionEdit.jobId);
        nextState.open = Boolean(options.open ?? state.sectionEdit.open);
        nextState.sectionKey = normalizeText(options.sectionKey ?? state.sectionEdit.sectionKey) || "overview";
        nextState.instruction = options.preserveInstruction
          ? normalizeTextareaDraft(options.instruction ?? state.sectionEdit.instruction).slice(0, MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS)
          : "";
        nextState.statusText = normalizeText(options.statusText);
        nextState.statusTone = normalizeText(options.statusTone);
        state.sectionEdit = nextState;
      }

      function normalizeRecordMoveTarget(item) {
        const nextItem = item && typeof item === "object" ? item : {};
        return {
          meetingId: normalizeText(nextItem.meetingId),
          title: normalizeText(nextItem.title) || "이름 없는 회의 룸",
          updatedAt: normalizeText(nextItem.updatedAt || nextItem.createdAt),
        };
      }

      function closeRecordMoveDialog() {
        state.recordMove = createEmptyRecordMoveState();
        applyRender();
      }

      function renderRecordMoveDialog() {
        if (!refs.recordMoveOverlay || !refs.recordMoveDialog) {
          return;
        }
        const dialogState = state.recordMove && typeof state.recordMove === "object"
          ? state.recordMove
          : createEmptyRecordMoveState();
        refs.recordMoveOverlay.hidden = !dialogState.open;
        if (!dialogState.open) {
          return;
        }
        if (refs.recordMoveDialogTitle) {
          refs.recordMoveDialogTitle.textContent = "이동할 회의 룸 선택";
        }
        const items = Array.isArray(dialogState.items) ? dialogState.items : [];
        if (refs.recordMoveList) {
          refs.recordMoveList.innerHTML = items.map((item) => {
            const meetingId = normalizeText(item.meetingId);
            const isSelected = meetingId && meetingId === normalizeText(dialogState.selectedMeetingId);
            return `
              <button
                type="button"
                class="record-move__item${isSelected ? " is-selected" : ""}"
                data-move-meeting-id="${escapeHtml(meetingId)}"
                role="option"
                aria-selected="${isSelected ? "true" : "false"}"
              >
                ${escapeHtml(item.title)}
              </button>
            `;
          }).join("");
        }
        const noticeText = dialogState.loading
          ? "회의 룸 목록을 불러오는 중입니다."
          : normalizeText(dialogState.error)
            ? dialogState.error
            : !items.length
              ? "이동할 다른 회의 룸이 없습니다."
              : "";
        if (refs.recordMoveNotice) {
          refs.recordMoveNotice.hidden = !noticeText;
          refs.recordMoveNotice.textContent = noticeText;
          refs.recordMoveNotice.dataset.tone = normalizeText(dialogState.error) ? "error" : "";
        }
        if (refs.recordMoveConfirm) {
          refs.recordMoveConfirm.disabled = dialogState.loading
            || dialogState.submitting
            || !normalizeText(dialogState.selectedMeetingId);
          refs.recordMoveConfirm.textContent = dialogState.submitting ? "이동 중" : "이동";
        }
      }

      async function loadRecordMoveTargets() {
        if (!normalizeText(CONFIG.listMeetingsUrl)) {
          throw new Error(buildMeetingMutationContractErrorMessage("회의 룸 목록"));
        }
        const items = [];
        const seen = new Set();
        let cursor = "";
        for (let page = 0; page < 10; page += 1) {
          const payload = await postJson(globalObject, CONFIG.listMeetingsUrl, {
            cursor,
            limit: 24,
          }, state.session.meetingSessionToken);
          const nextItems = (Array.isArray(payload?.items) ? payload.items : [])
            .map(normalizeRecordMoveTarget)
            .filter((item) => item.meetingId)
            .filter((item) => item.meetingId !== normalizeText(state.session.meetingId))
            .filter((item) => {
              const key = normalizeText(item.meetingId);
              if (!key || seen.has(key)) {
                return false;
              }
              seen.add(key);
              return true;
            });
          items.push(...nextItems);
          const nextCursor = normalizeText(payload?.nextCursor);
          if (!nextCursor) {
            break;
          }
          cursor = nextCursor;
        }
        return items.sort((left, right) => {
          const rightTime = Date.parse(normalizeText(right.updatedAt || "")) || 0;
          const leftTime = Date.parse(normalizeText(left.updatedAt || "")) || 0;
          return rightTime - leftTime;
        });
      }

      async function openRecordMoveDialog(recordId = state.selectedRecordId) {
        const normalizedRecordId = recordId instanceof globalObject.Event ? state.selectedRecordId : recordId;
        const entry = findHistoryEntry(state, normalizedRecordId);
        if (!entry?.remote?.jobId || normalizeText(entry.remote.status) !== "succeeded") {
          return false;
        }
        const loadRequestId = generateClientRequestId("move-record-dialog");
        state.recordMove = {
          error: "",
          items: [],
          loadRequestId,
          loading: true,
          open: true,
          recordId: entry.id,
          selectedMeetingId: "",
          submitting: false,
        };
        applyRender();
        try {
          const items = await loadRecordMoveTargets();
          if (!state.recordMove.open || normalizeText(state.recordMove.loadRequestId) !== loadRequestId) {
            return false;
          }
          state.recordMove = {
            ...state.recordMove,
            error: "",
            items,
            loading: false,
            selectedMeetingId: "",
          };
          applyRender();
          return true;
        } catch (error) {
          if (!state.recordMove.open || normalizeText(state.recordMove.loadRequestId) !== loadRequestId) {
            return false;
          }
          state.recordMove = {
            ...state.recordMove,
            error: error instanceof Error ? error.message : "회의 룸 목록을 불러오지 못했어요.",
            items: [],
            loading: false,
            selectedMeetingId: "",
          };
          applyRender();
          return false;
        }
      }

      function handleRecordMoveListClick(event) {
        const target = event?.target?.closest?.("[data-move-meeting-id]");
        if (!target) {
          return;
        }
        state.recordMove = {
          ...state.recordMove,
          selectedMeetingId: normalizeText(target.dataset.moveMeetingId),
        };
        applyRender();
      }

      async function moveCurrentRecord() {
        const targetMeetingId = normalizeText(state.recordMove?.selectedMeetingId);
        const entry = findHistoryEntry(state, state.recordMove?.recordId || state.selectedRecordId);
        if (!entry?.remote?.jobId || !targetMeetingId) {
          return false;
        }
        if (!normalizeText(CONFIG.moveMeetingResultUrl)) {
          setNotice(buildMeetingMutationContractErrorMessage("기록 이동"), "error");
          applyRender();
          return false;
        }
        const requestId = generateClientRequestId("move-record");
        registerPendingMutation({
          jobId: entry.remote.jobId,
          quiet: true,
          recordId: entry.id,
          requestId,
          type: "moveRecord",
        });
        state.recordMove = {
          ...state.recordMove,
          error: "",
          submitting: true,
        };
        applyRender();
        try {
          const payload = await postJson(globalObject, CONFIG.moveMeetingResultUrl, {
            clientRequestId: requestId,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
            targetMeetingId,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "기록 이동");
          closeRecordMoveDialog();
          setNotice("기록을 다른 회의 룸으로 이동했습니다.", "highlight");
          await refreshWorkspace(false, "move-record");
          await resolvePendingMutationsFromSnapshots();
          return true;
        } catch (error) {
          state.recordMove = {
            ...state.recordMove,
            error: error instanceof Error ? error.message : "기록을 이동하지 못했어요.",
            submitting: false,
          };
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "기록을 이동하지 못했어요."
          );
          return false;
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      function syncTermReplacementState() {
        const saved = cloneTermReplacements(state.meeting?.termReplacements);
        const meetingId = normalizeText(state.meeting?.meetingId || state.session.meetingId);
        const meetingChanged = normalizeText(state.termReplacementState.meetingId) !== meetingId;
        const shouldReplaceDraft = meetingChanged || !isTermReplacementDirty();
        state.termReplacementState.saved = saved;
        state.termReplacementState.meetingId = meetingId;
        if (shouldReplaceDraft) {
          state.termReplacementState.items = saved;
        }
        if (meetingChanged) {
          state.termReplacementState.draftFrom = "";
          state.termReplacementState.draftTo = "";
          state.termReplacementState.open = false;
        }
      }

      function readSelectedRecordReviewState(entry) {
        const savedMemo = normalizeTextBlock(
          state.currentJob?.sharedMemoSnapshot
          || entry?.remote?.sharedMemoSnapshot
          || entry?.pending?.sharedMemoSnapshot
        ).slice(0, MAX_SHARED_MEMO_CHARS);
        const notesInputSnapshot = cloneNotesInputSnapshot(
          state.currentArtifact?.notesInputSnapshot?.updatedAt
            ? state.currentArtifact.notesInputSnapshot
            : state.currentJob?.notesInputSnapshot,
          {
            sharedMemo: savedMemo,
            updatedAt: normalizeText(
              state.currentArtifact?.notesGeneratedAt
              || state.currentJob?.notesGeneratedAt
              || state.currentJob?.updatedAt
              || entry?.remote?.updatedAt
            ),
          }
        );
        return {
          notesInputSnapshot,
          recordId: normalizeText(entry?.id || state.currentDetailSelectionId),
          savedMemo,
        };
      }

      function isSelectedRecordMemoDirty() {
        return normalizeTextBlock(state.selectedRecordMemo.draft) !== normalizeTextBlock(state.selectedRecordMemo.saved);
      }

      function syncSelectedRecordReviewState(entry) {
        const snapshot = readSelectedRecordReviewState(entry);
        const selectionChanged = normalizeText(state.selectedRecordMemo.recordId) !== snapshot.recordId;

        if (selectionChanged || !isSelectedRecordMemoDirty()) {
          state.selectedRecordMemo.draft = snapshot.savedMemo;
        }
        state.selectedRecordMemo.recordId = snapshot.recordId;
        state.selectedRecordMemo.saved = snapshot.savedMemo;
        state.selectedRecordNotesInputSnapshot = {
          ...snapshot.notesInputSnapshot,
          recordId: snapshot.recordId,
        };

        syncTermReplacementState();

        const nextJobId = normalizeText(entry?.remote?.jobId);
        if (selectionChanged || normalizeText(state.sectionEdit.jobId) !== nextJobId) {
          resetSectionEditPreviewState({
            jobId: nextJobId,
            preserveInstruction: false,
            recordId: snapshot.recordId,
            sectionKey: state.sectionEdit.sectionKey,
          });
        } else {
          state.sectionEdit.recordId = snapshot.recordId;
          state.sectionEdit.jobId = nextJobId;
        }
      }

      function updateMeetingTitleDraft(value) {
        state.meetingTitleDraft = normalizeText(value);
        applyRender();
      }

      function updateRecordMemoDraft(value) {
        const nextValue = normalizeTextareaDraft(value);
        state.recordMemoDraft = nextValue;
        state.recordMemoSaved = nextValue;
        state.session.sharedMemo = nextValue;
        persistWorkspaceSession();
        refs.sharedMemoNotice.hidden = true;
        refs.sharedMemoNotice.textContent = "";
        applyRender();
      }

      function updateSelectedRecordMemoDraft(value) {
        state.selectedRecordMemo.draft = normalizeTextareaDraft(value).slice(0, MAX_SHARED_MEMO_CHARS);
        applyRender();
      }

      function updateTermReplacementDraft(field, value) {
        const nextValue = normalizeText(value).slice(0, MAX_MEETING_TERM_REPLACEMENT_TEXT_CHARS);
        if (field === "from") {
          state.termReplacementState.draftFrom = nextValue;
        } else if (field === "to") {
          state.termReplacementState.draftTo = nextValue;
        }
        applyRender();
      }

      function addTermReplacementDraft() {
        const from = normalizeText(state.termReplacementState.draftFrom).slice(0, MAX_MEETING_TERM_REPLACEMENT_TEXT_CHARS);
        const to = normalizeText(state.termReplacementState.draftTo).slice(0, MAX_MEETING_TERM_REPLACEMENT_TEXT_CHARS);
        if (!from || !to) {
          setNotice("기존 표현과 바꿀 표현을 모두 입력해 주세요.", "warning");
          applyRender();
          return false;
        }
        if (normalizeText(from).toLowerCase() === normalizeText(to).toLowerCase()) {
          setNotice("같은 표현끼리는 치환할 수 없습니다.", "warning");
          applyRender();
          return false;
        }
        if (state.termReplacementState.items.some((item) => normalizeText(item.from).toLowerCase() === from.toLowerCase())) {
          setNotice("같은 기존 표현은 회의 안에서 한 번만 등록할 수 있습니다.", "warning");
          applyRender();
          return false;
        }
        if (state.termReplacementState.items.length >= MAX_MEETING_TERM_REPLACEMENTS) {
          setNotice(`용어 치환은 최대 ${MAX_MEETING_TERM_REPLACEMENTS}개까지 저장할 수 있습니다.`, "warning");
          applyRender();
          return false;
        }
        state.termReplacementState.items = cloneTermReplacements([
          ...state.termReplacementState.items,
          { from, to },
        ]);
        state.termReplacementState.draftFrom = "";
        state.termReplacementState.draftTo = "";
        applyRender();
        return true;
      }

      function resetTermReplacements() {
        state.termReplacementState.items = cloneTermReplacements(state.termReplacementState.saved);
        state.termReplacementState.draftFrom = "";
        state.termReplacementState.draftTo = "";
        applyRender();
      }

      function clearTermReplacements() {
        state.termReplacementState.items = [];
        state.termReplacementState.draftFrom = "";
        state.termReplacementState.draftTo = "";
        applyRender();
      }

      function removeTermReplacementAt(indexInput) {
        const index = Math.max(-1, Number(indexInput));
        if (index < 0 || index >= state.termReplacementState.items.length) {
          return;
        }
        state.termReplacementState.items = state.termReplacementState.items.filter((_, itemIndex) => itemIndex !== index);
        applyRender();
      }

      function handleTermReplacementListClick(event) {
        const target = event.target.closest("[data-term-replacement-remove-index]");
        if (!(target instanceof globalObject.HTMLElement)) {
          return;
        }
        removeTermReplacementAt(target.dataset.termReplacementRemoveIndex);
      }

      function updateSectionEditSectionKey(value) {
        const nextSectionKey = normalizeText(value) || "overview";
        const changed = nextSectionKey !== normalizeText(state.sectionEdit.sectionKey);
        state.sectionEdit.sectionKey = nextSectionKey;
        if (changed) {
          state.sectionEdit.baseRevisionToken = "";
          state.sectionEdit.previewSectionData = null;
          state.sectionEdit.previewSectionKey = "";
          state.sectionEdit.statusText = "";
          state.sectionEdit.statusTone = "";
        }
        applyRender();
      }

      function updateSectionEditInstruction(value) {
        const nextInstruction = normalizeTextareaDraft(value).slice(0, MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS);
        const changed = nextInstruction !== normalizeText(state.sectionEdit.instruction);
        state.sectionEdit.instruction = nextInstruction;
        if (changed) {
          state.sectionEdit.baseRevisionToken = "";
          state.sectionEdit.previewSectionData = null;
          state.sectionEdit.previewSectionKey = "";
          state.sectionEdit.statusText = "";
          state.sectionEdit.statusTone = "";
        }
        applyRender();
      }

      function toggleTermReplacementPanel() {
        state.termReplacementState.open = !state.termReplacementState.open;
        applyRender();
      }

      function openSectionEdit(sectionKeyInput) {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry?.remote?.jobId) {
          setNotice("섹션 수정을 하려면 완료된 기록을 선택해 주세요.", "warning");
          applyRender();
          return false;
        }
        const nextSectionKey = normalizeText(sectionKeyInput) || "overview";
        const sameRecord = normalizeText(state.sectionEdit.recordId) === normalizeText(entry.id);
        const sameSection = normalizeText(state.sectionEdit.sectionKey) === nextSectionKey;
        if (!sameRecord || !sameSection) {
          resetSectionEditPreviewState({
            jobId: entry.remote.jobId,
            open: true,
            preserveInstruction: false,
            recordId: entry.id,
            sectionKey: nextSectionKey,
          });
        } else {
          state.sectionEdit.open = true;
          state.sectionEdit.jobId = entry.remote.jobId;
          state.sectionEdit.recordId = entry.id;
          state.sectionEdit.sectionKey = nextSectionKey;
        }
        state.reviewTab = "notes";
        applyRender();
        return true;
      }

      function closeSectionEdit() {
        if (!state.sectionEdit.open) {
          return false;
        }
        if (state.busy.applySectionEdit || state.busy.previewSectionEdit) {
          return false;
        }
        state.sectionEdit.open = false;
        applyRender();
        return true;
      }

      function handleMeetingNotesSectionAction(event) {
        const target = event.target?.closest?.("[data-notes-section-action='edit']");
        if (!(target instanceof globalObject.HTMLElement)) {
          return false;
        }
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        return openSectionEdit(target.dataset.sectionKey);
      }

      function resetSectionEditPreview() {
        resetSectionEditPreviewState({
          jobId: state.sectionEdit.jobId,
          open: state.sectionEdit.open,
          preserveInstruction: true,
          recordId: state.sectionEdit.recordId,
          sectionKey: state.sectionEdit.sectionKey,
        });
        applyRender();
      }

      function isLegacyMeetingResultMutationError(error) {
        const message = normalizeText(error instanceof Error ? error.message : error?.message);
        return message === "수정할 회의 결과 내용이 비어 있어요.";
      }

      function buildLegacyMeetingResultMutationErrorMessage(subject) {
        const normalizedSubject = normalizeText(subject) || "회의 결과";
        return `${normalizedSubject} 저장을 지원하는 최신 함수가 아직 배포되지 않았어요. npm run deploy:functions 후 다시 시도해 주세요.`;
      }

      function patchSelectedRecordTitle(jobId, nextTitle) {
        const normalizedJobId = normalizeText(jobId);
        const normalizedTitle = normalizeText(nextTitle);
        if (!normalizedJobId || !normalizedTitle) {
          return;
        }
        if (normalizeText(state.currentJob?.jobId) === normalizedJobId) {
          state.currentJob = normalizeJob({
            ...state.currentJob,
            resultTitle: normalizedTitle,
            title: normalizedTitle,
          }, state.meeting.title);
        }
        state.records = (Array.isArray(state.records) ? state.records : []).map((record) =>
          normalizeText(record?.jobId) === normalizedJobId
            ? normalizeRecord({
                ...record,
                resultTitle: normalizedTitle,
                title: normalizedTitle,
              })
            : record
        );
      }

      function patchSelectedRecordMemo(jobId, nextMemo) {
        const normalizedJobId = normalizeText(jobId);
        const normalizedMemo = normalizeTextBlock(nextMemo);
        if (normalizeText(state.currentJob?.jobId) === normalizedJobId) {
          state.currentJob = normalizeJob({
            ...state.currentJob,
            context: {
              sharedMemoSnapshot: normalizedMemo,
            },
            sharedMemoSnapshot: normalizedMemo,
          }, state.meeting.title);
        }
        state.records = (Array.isArray(state.records) ? state.records : []).map((record) =>
          normalizeText(record?.jobId) === normalizedJobId
            ? normalizeRecord({
                ...record,
                sharedMemoSnapshot: normalizedMemo,
              })
            : record
        );
      }

      function patchSelectedRecordNotes(jobId, notes, title, requestId) {
        const normalizedJobId = normalizeText(jobId);
        const normalizedTitle = normalizeText(title);
        const updatedAt = new Date().toISOString();
        const workspaceMutation = {
          completedAt: updatedAt,
          error: "",
          requestedAt: updatedAt,
          requestId: normalizeText(requestId),
          status: "succeeded",
          type: "applySectionEdit",
        };

        if (normalizeText(state.currentJob?.jobId) === normalizedJobId) {
          state.currentJob = normalizeJob({
            ...state.currentJob,
            meetingNotes: notes,
            title: normalizedTitle || state.currentJob.title,
            updatedAt,
            workspaceMutation,
          }, state.meeting.title);
        }
        if (normalizeText(state.currentJob?.jobId) === normalizedJobId && state.currentArtifact) {
          state.currentArtifact = normalizeArtifact({
            ...state.currentArtifact,
            notes,
          });
        }
        state.records = (Array.isArray(state.records) ? state.records : []).map((record) =>
          normalizeText(record?.jobId) === normalizedJobId
            ? normalizeRecord({
                ...record,
                resultTitle: normalizedTitle || record.resultTitle || record.title,
                title: normalizedTitle || record.title,
                updatedAt,
                workspaceMutation,
              })
            : record
        );
      }

      async function saveMeetingPatch(patch, successMessage, emptyMessage) {
        if (!state.session.meetingId) return;
        if ("title" in patch && !patch.title && emptyMessage) {
          setNotice(emptyMessage, "error");
          applyRender();
          return;
        }
        const mutationType = patch.termReplacements
          ? "saveMeetingTermReplacements"
          : "title" in patch
            ? "saveMeetingTitle"
            : "saveMeetingMemo";
        const requestId = generateClientRequestId(
          mutationType === "saveMeetingTitle"
            ? "meeting-title"
            : mutationType === "saveMeetingTermReplacements"
              ? "meeting-terms"
              : "meeting-memo"
        );
        registerPendingMutation({
          requestId,
          successMessage,
          type: mutationType,
        });
        applyRender();
        try {
          const payload = await postJson(globalObject, CONFIG.updateMeetingTitleUrl, {
            clientRequestId: requestId,
            meetingId: state.session.meetingId,
            ...patch,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, mutationType === "saveMeetingTermReplacements" ? "용어 치환" : "회의 정보");
          if (mutationType === "saveMeetingTitle" && normalizeText(patch.title)) {
            state.meeting.title = normalizeText(patch.title);
            state.meetingTitleDraft = normalizeText(patch.title);
          }
          if (mutationType === "saveMeetingTermReplacements") {
            state.meeting.termReplacements = cloneTermReplacements(patch.termReplacements);
            state.termReplacementState.saved = cloneTermReplacements(patch.termReplacements);
            state.termReplacementState.items = cloneTermReplacements(patch.termReplacements);
            state.termReplacementState.open = false;
            resetSectionEditPreviewState({
              jobId: state.sectionEdit.jobId,
              open: state.sectionEdit.open,
              preserveInstruction: true,
              recordId: state.sectionEdit.recordId,
              sectionKey: state.sectionEdit.sectionKey,
            });
            await refreshWorkspace(true, "workflow");
          }
          await finalizePendingMutation(requestId, "succeeded");
        } catch (error) {
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "회의 정보를 저장하지 못했어요."
          );
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      async function saveMeetingTitle() {
        return saveMeetingPatch(
          { title: normalizeText(state.meetingTitleDraft || refs.meetingTitleInput.value) },
          "회의 이름을 저장했습니다.",
          "회의 이름을 먼저 입력해 주세요."
        );
      }

      async function saveMeetingTermReplacements() {
        if (!state.session.meetingId) {
          return false;
        }
        if (!isTermReplacementDirty()) {
          setNotice("적용할 용어 치환 변경이 없습니다.", "highlight");
          applyRender();
          return true;
        }
        return saveMeetingPatch(
          { termReplacements: cloneTermReplacements(state.termReplacementState.items) },
          "용어 치환 규칙을 저장했습니다. 이 회의의 정리 결과에 반영됩니다."
        );
      }

      async function saveSharedMemo() {
        updateRecordMemoDraft(refs.sharedMemoInput.value);
        setNotice(
          normalizeTextBlock(refs.sharedMemoInput.value)
            ? "기록 메모를 자동 보관했습니다."
            : "기록 메모를 비웠습니다.",
          "highlight"
        );
        applyRender();
      }

      async function clearSharedMemo() {
        refs.sharedMemoInput.value = "";
        state.recordMemoDraft = "";
        state.recordMemoSaved = "";
        state.session.sharedMemo = "";
        persistWorkspaceSession();
        refs.sharedMemoNotice.hidden = true;
        refs.sharedMemoNotice.textContent = "";
        setNotice("기록 메모를 비웠습니다.", "highlight");
        applyRender();
      }

      async function saveSelectedRecordMemo(options = {}) {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry?.remote?.jobId) {
          return false;
        }
        const nextMemo = normalizeTextareaDraft(
          globalObject.document.activeElement === refs.detailMemoInput
            ? refs.detailMemoInput.value
            : state.selectedRecordMemo.draft
        ).slice(0, MAX_SHARED_MEMO_CHARS);
        if (!options.force && normalizeTextBlock(nextMemo) === normalizeTextBlock(state.selectedRecordMemo.saved)) {
          return true;
        }
        const requestId = generateClientRequestId("record-memo");
        registerPendingMutation({
          jobId: entry.remote.jobId,
          quiet: Boolean(options.quiet),
          recordId: entry.id,
          requestId,
          successMessage: nextMemo ? "메모를 저장했습니다." : "메모를 비웠습니다.",
          type: "saveRecordMemo",
        });
        applyRender();
        try {
          const payload = await postJson(globalObject, CONFIG.updateMeetingResultUrl, {
            clientRequestId: requestId,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
            sharedMemo: nextMemo,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "메모");
          state.selectedRecordMemo.saved = normalizeTextBlock(nextMemo);
          state.selectedRecordMemo.draft = normalizeTextBlock(nextMemo);
          patchSelectedRecordMemo(entry.remote.jobId, nextMemo);
          await finalizePendingMutation(requestId, "succeeded");
          return true;
        } catch (error) {
          if (isLegacyMeetingResultMutationError(error)) {
            logDebug("workspace.result.update.legacy-backend", {
              jobId: entry.remote.jobId,
              mutation: "sharedMemo",
            });
            await finalizePendingMutation(requestId, "failed", buildLegacyMeetingResultMutationErrorMessage("메모"));
            return false;
          }
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "메모를 저장하지 못했어요."
          );
          return false;
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      async function saveRecordTitleForEntry(recordId, nextTitleInput) {
        const entry = findHistoryEntry(state, recordId);
        const nextTitle = normalizeText(nextTitleInput);
        if (!entry || !nextTitle) return;
        const requestId = entry.remote?.jobId ? generateClientRequestId("record-title") : "";
        if (entry.remote?.jobId) {
          registerPendingMutation({
            jobId: entry.remote.jobId,
            recordId: entry.id,
            requestId,
            successMessage: "기록 이름을 저장했습니다.",
            type: "saveRecordTitle",
          });
        } else {
          state.busy.saveRecordTitle = true;
        }
        applyRender();
        try {
          if (entry.remote?.jobId) {
            const payload = await postJson(globalObject, CONFIG.updateMeetingResultUrl, {
              clientRequestId: requestId,
              jobId: entry.remote.jobId,
              meetingId: state.session.meetingId,
              title: nextTitle,
            }, state.session.meetingSessionToken);
            assertAcceptedMutationResponse(payload, requestId, "기록 이름");
            patchSelectedRecordTitle(entry.remote.jobId, nextTitle);
            await finalizePendingMutation(requestId, "succeeded");
          }
          if (entry.pending?.requestId) {
            const nextPending = { ...entry.pending, meetingTitleSnapshot: nextTitle };
            await upsertPendingUpload(nextPending, {
              context: {
                phase: "record-title",
                reason: "record-title",
              },
            });
            if (!entry.remote?.jobId) {
              state.currentJob = buildLocalPendingJob(nextPending);
              setNotice("기록 이름을 저장했습니다.", "highlight");
              await syncWorkspaceLocalState(true, "workflow");
            }
          }
        } catch (error) {
          if (entry.remote?.jobId) {
            await finalizePendingMutation(
              requestId,
              "failed",
              error instanceof Error ? error.message : "기록 이름을 저장하지 못했어요."
            );
          } else {
            setNotice(error instanceof Error ? error.message : "기록 이름을 저장하지 못했어요.", "error");
          }
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      async function saveCurrentRecordTitle() {
        return saveRecordTitleForEntry(state.selectedRecordId, refs.recordTitleInput.value);
      }

      async function previewSectionEdit() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry?.remote?.jobId) {
          setNotice("섹션 수정을 하려면 완료된 기록을 선택해 주세요.", "warning");
          applyRender();
          return false;
        }
        const sectionKey = normalizeText(state.sectionEdit.sectionKey) || "overview";
        const instruction = normalizeTextareaDraft(state.sectionEdit.instruction).slice(0, MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS);
        if (!instruction) {
          setNotice("섹션 수정 요청을 입력해 주세요.", "warning");
          applyRender();
          return false;
        }
        const requestId = generateClientRequestId("section-preview");
        registerPendingMutation({
          jobId: entry.remote.jobId,
          quiet: true,
          recordId: entry.id,
          requestId,
          type: "previewSectionEdit",
        });
        state.reviewTab = "notes";
        applyRender();
        try {
          const payload = await postJson(globalObject, CONFIG.previewMeetingResultSectionEditUrl, {
            clientRequestId: requestId,
            instruction,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
            sectionKey,
          }, state.session.meetingSessionToken);
          state.sectionEdit.baseRevisionToken = normalizeText(payload.baseRevisionToken);
          state.sectionEdit.previewSectionData = payload.sectionData && typeof payload.sectionData === "object"
            ? JSON.parse(JSON.stringify(payload.sectionData))
            : null;
          state.sectionEdit.previewSectionKey = normalizeText(payload.sectionKey || sectionKey) || sectionKey;
          await finalizePendingMutation(requestId, "succeeded");
          return true;
        } catch (error) {
          state.sectionEdit.baseRevisionToken = "";
          state.sectionEdit.previewSectionData = null;
          state.sectionEdit.previewSectionKey = "";
          state.sectionEdit.statusText = "";
          state.sectionEdit.statusTone = "";
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "섹션 미리보기를 만들지 못했어요."
          );
          return false;
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      async function applySectionEdit() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry?.remote?.jobId) {
          setNotice("섹션 수정을 적용할 완료 기록이 필요합니다.", "warning");
          applyRender();
          return false;
        }
        if (!state.sectionEdit.baseRevisionToken || !state.sectionEdit.previewSectionData) {
          setNotice("먼저 섹션 미리보기를 만들어 주세요.", "warning");
          applyRender();
          return false;
        }
        const requestId = generateClientRequestId("section-apply");
        registerPendingMutation({
          jobId: entry.remote.jobId,
          quiet: true,
          recordId: entry.id,
          requestId,
          successMessage: "선택한 섹션을 적용했습니다.",
          type: "applySectionEdit",
        });
        state.reviewTab = "notes";
        applyRender();
        try {
          const payload = await postJson(globalObject, CONFIG.applyMeetingResultSectionEditUrl, {
            baseRevisionToken: state.sectionEdit.baseRevisionToken,
            clientRequestId: requestId,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
            sectionData: state.sectionEdit.previewSectionData,
            sectionKey: normalizeText(state.sectionEdit.previewSectionKey || state.sectionEdit.sectionKey),
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "섹션 수정");
          patchSelectedRecordNotes(entry.remote.jobId, payload.notes, payload.title, payload.requestId);
          resetSectionEditPreviewState({
            jobId: entry.remote.jobId,
            open: false,
            preserveInstruction: false,
            recordId: entry.id,
            sectionKey: normalizeText(payload.sectionKey || state.sectionEdit.sectionKey),
          });
          setNotice(`${resolveSectionLabel(payload.sectionKey || state.sectionEdit.sectionKey)} 섹션을 반영했습니다.`, "highlight");
          await finalizePendingMutation(requestId, "succeeded");
          return true;
        } catch (error) {
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "섹션 수정을 적용하지 못했어요."
          );
          return false;
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      async function deleteCurrentRecord(recordId = state.selectedRecordId) {
        const normalizedRecordId = recordId instanceof globalObject.Event ? state.selectedRecordId : recordId;
        const entry = findHistoryEntry(state, normalizedRecordId);
        if (!entry) return;
        if (!entry.remote?.jobId && entry.pending?.requestId) {
          return handleLocalQueueAction("delete", entry.pending.requestId);
        }
        if (!entry.remote?.jobId) return;
        if (!await requestConfirmation({
          body: "전사와 정리 결과가 함께 삭제되며, 되돌릴 수 없습니다.",
          confirmLabel: "기록 삭제",
          eyebrow: "기록 삭제",
          title: "선택한 기록을 삭제할까요?",
          tone: "danger",
        })) return;
        const requestId = generateClientRequestId("delete-record");
        registerPendingMutation({
          jobId: entry.remote.jobId,
          pendingRequestId: entry.pending?.requestId,
          recordId: entry.id,
          requestId,
          successMessage: "선택한 기록을 삭제했습니다.",
          type: "deleteRecord",
        });
        applyRender();
        try {
          const payload = await postJson(globalObject, CONFIG.deleteMeetingResultUrl, {
            clientRequestId: requestId,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "기록 삭제");
          await refreshWorkspace(true, "workflow");
          await finalizePendingMutation(requestId, "succeeded");
        } catch (error) {
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "기록을 삭제하지 못했어요."
          );
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      async function deleteMeeting() {
        if (!state.session.meetingId) return;
        if (!await requestConfirmation({
          body: "회의 룸에 연결된 기록, 산출물, 남아 있는 임시 원본까지 함께 정리합니다. 처리 중인 기록이 있어도 지금 즉시 삭제 요청을 우선 반영하고, 남은 정리는 backend cleanup 경계에서 이어서 마칩니다.",
          confirmLabel: "회의 룸 삭제",
          eyebrow: "회의 룸 삭제",
          title: "이 회의 룸 전체를 삭제할까요?",
          tone: "danger",
        })) return;
        const requestId = generateClientRequestId("delete-meeting");
        registerPendingMutation({
          requestId,
          successMessage: "회의 룸을 삭제했습니다.",
          type: "deleteMeeting",
        });
        applyRender();
        try {
          const payload = await postJson(globalObject, CONFIG.deleteMeetingUrl, {
            clientRequestId: requestId,
            meetingId: state.session.meetingId,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "회의 룸 삭제");
          state.meeting.deletedAt = new Date().toISOString();
          await finalizePendingMutation(requestId, "succeeded");
        } catch (error) {
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "회의 룸을 삭제하지 못했어요."
          );
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }

      function canRenderNotesTools() {
        if (state.reviewTab === "segments" || state.reviewTab === "memo") return false;
        const entry = findHistoryEntry(state, state.selectedRecordId);
        const remoteStatus = normalizeText(state.currentJob?.status || entry?.remote?.status);
        return Boolean(
          entry?.remote?.jobId
          && !state.auth?.readOnly
          && remoteStatus === "succeeded"
        );
      }

      function renderTermReplacementList() {
        if (!refs.termReplacementList) {
          return;
        }
        const items = cloneTermReplacements(state.termReplacementState.items);
        refs.termReplacementList.hidden = false;
        if (!items.length) {
          refs.termReplacementList.innerHTML = `<div class="notice-box">아직 등록된 용어 치환이 없습니다.</div>`;
          return;
        }
        refs.termReplacementList.innerHTML = items.map((item, index) => `
          <article class="notes-term-item">
            <div class="notes-term-item__body">
              <strong class="notes-term-item__from">${escapeHtml(item.from)}</strong>
              <span class="notes-term-item__arrow">→</span>
              <span class="notes-term-item__to">${escapeHtml(item.to)}</span>
            </div>
            <button class="ghost-button ghost-button--soft" type="button" data-term-replacement-remove-index="${index}">삭제</button>
          </article>
        `).join("");
      }

      function renderSectionEditPreview() {
        if (!refs.sectionEditPreviewCard || !refs.sectionEditPreviewBody || !refs.sectionEditPreviewTitle) {
          return;
        }
        const sectionKey = normalizeText(state.sectionEdit.previewSectionKey || state.sectionEdit.sectionKey);
        if (!sectionKey || !state.sectionEdit.previewSectionData) {
          refs.sectionEditPreviewCard.hidden = true;
          refs.sectionEditPreviewBody.innerHTML = "";
          refs.sectionEditPreviewTitle.textContent = "미리보기";
          return;
        }
        const sectionModel = buildMeetingNotesSectionPreview(sectionKey, state.sectionEdit.previewSectionData);
        refs.sectionEditPreviewCard.hidden = false;
        refs.sectionEditPreviewTitle.textContent = `${resolveSectionLabel(sectionKey)} 미리보기`;
        refs.sectionEditPreviewBody.innerHTML = sectionModel
          ? renderNotesSection(sectionModel)
          : `<div class="notice-box" data-tone="warning">미리보기 결과를 표시할 수 없습니다.</div>`;
      }

      function renderMeetingNotesTools() {
        const showTools = canRenderNotesTools();
        if (refs.toggleTermReplacementButton) refs.toggleTermReplacementButton.hidden = !showTools;
        if (!showTools) {
          if (refs.termReplacementPanel) refs.termReplacementPanel.hidden = true;
          if (refs.sectionEditOverlay) refs.sectionEditOverlay.hidden = true;
          return;
        }

        renderTermReplacementList();
        renderSectionEditPreview();

        const readOnly = Boolean(state.auth?.readOnly);
        const selectedRecordBusy = Boolean(
          state.busy.applySectionEdit
          || state.busy.deleteRecord
          || state.busy.moveRecord
          || state.busy.previewSectionEdit
          || state.busy.saveRecordMemo
          || state.busy.saveRecordTitle
        );
        const termBusy = Boolean(state.busy.saveMeetingTermReplacements);
        const termDraftReady = Boolean(
          normalizeText(state.termReplacementState.draftFrom)
          && normalizeText(state.termReplacementState.draftTo)
        );
        const termDirty = isTermReplacementDirty();
        const sectionEditOpen = Boolean(state.sectionEdit.open);

        if (refs.termReplacementDirtyBadge) refs.termReplacementDirtyBadge.hidden = !termDirty;
        if (refs.termReplacementPanel) refs.termReplacementPanel.hidden = !state.termReplacementState.open;
        if (refs.toggleTermReplacementButton) {
          const labelSpan = refs.toggleTermReplacementButton.querySelector("span:first-child");
          if (labelSpan) labelSpan.textContent = "용어 치환";
          refs.toggleTermReplacementButton.setAttribute("aria-expanded", state.termReplacementState.open ? "true" : "false");
        }
        if (refs.termReplacementFromInput) refs.termReplacementFromInput.disabled = readOnly || termBusy;
        if (refs.termReplacementToInput) refs.termReplacementToInput.disabled = readOnly || termBusy;
        if (refs.termReplacementAddButton) refs.termReplacementAddButton.disabled = readOnly || termBusy || !termDraftReady;
        if (refs.termReplacementResetButton) refs.termReplacementResetButton.disabled = readOnly || termBusy || !termDirty;
        if (refs.termReplacementClearButton) refs.termReplacementClearButton.disabled = readOnly || termBusy || !state.termReplacementState.items.length;
        if (refs.saveTermReplacementsButton) {
          refs.saveTermReplacementsButton.disabled = readOnly || termBusy || !termDirty;
          refs.saveTermReplacementsButton.textContent = termBusy ? "적용 중" : "용어 치환 적용하기";
        }

        if (refs.sectionEditOverlay) refs.sectionEditOverlay.hidden = !sectionEditOpen;
        if (refs.closeSectionEditButton) refs.closeSectionEditButton.disabled = selectedRecordBusy;
        if (refs.sectionEditDialogTitle) refs.sectionEditDialogTitle.textContent = resolveSectionLabel(state.sectionEdit.sectionKey);
        if (refs.sectionEditInstructionInput) refs.sectionEditInstructionInput.disabled = readOnly || selectedRecordBusy;
        if (refs.previewSectionEditButton) {
          refs.previewSectionEditButton.disabled = readOnly
            || selectedRecordBusy
            || !normalizeText(state.sectionEdit.sectionKey)
            || !normalizeText(state.sectionEdit.instruction);
          refs.previewSectionEditButton.textContent = state.busy.previewSectionEdit ? "미리보기 생성 중" : "미리보기 만들기";
        }
        if (refs.cancelSectionEditButton) {
          const hasAnyPreviewState = Boolean(
            state.sectionEdit.baseRevisionToken
            || state.sectionEdit.previewSectionData
          );
          refs.cancelSectionEditButton.disabled = readOnly || selectedRecordBusy || !hasAnyPreviewState;
        }
        if (refs.applySectionEditButton) {
          const hasPreview = Boolean(state.sectionEdit.baseRevisionToken && state.sectionEdit.previewSectionData);
          refs.applySectionEditButton.disabled = readOnly || selectedRecordBusy || !hasPreview;
          refs.applySectionEditButton.textContent = state.busy.applySectionEdit ? "적용 중" : "이 섹션만 적용";
        }
        if (refs.sectionEditStatus) {
          refs.sectionEditStatus.hidden = !normalizeText(state.sectionEdit.statusText);
          refs.sectionEditStatus.textContent = state.sectionEdit.statusText;
          refs.sectionEditStatus.dataset.tone = normalizeText(state.sectionEdit.statusTone);
        }
      }

      return {
        addTermReplacementDraft,
        applySectionEdit,
        clearSharedMemo,
        clearTermReplacements,
        closeRecordMoveDialog,
        closeSectionEdit,
        deleteCurrentRecord,
        deleteMeeting,
        finalizePendingMutation,
        handleMeetingNotesSectionAction,
        handleRecordMoveListClick,
        handleTermReplacementListClick,
        moveCurrentRecord,
        openRecordMoveDialog,
        openSectionEdit,
        previewSectionEdit,
        renderRecordMoveDialog,
        renderMeetingNotesTools,
        resetSectionEditPreview,
        resetTermReplacements,
        resolvePendingMutationsFromSnapshots,
        saveCurrentRecordTitle,
        saveMeetingTermReplacements,
        saveMeetingTitle,
        saveRecordTitleForEntry,
        saveSelectedRecordMemo,
        saveSharedMemo,
        syncSelectedRecordReviewState,
        syncWorkspaceMutationBusyState,
        toggleTermReplacementPanel,
        updateMeetingTitleDraft,
        updateRecordMemoDraft,
        updateSectionEditInstruction,
        updateSectionEditSectionKey,
        updateSelectedRecordMemoDraft,
        updateTermReplacementDraft,
      };
    },
  };
})(globalThis);
