(function initHostedMeetingWorkspaceMutations(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  ns.workspaceMutations = {
    createController(deps) {
      const globalObject = deps?.global || global;
      const refs = deps?.refs || {};
      const state = deps?.state || {};
      const constants = deps?.constants || {};
      const helpers = deps?.helpers || {};
      const { buildLocalPendingJob, findHistoryEntry } = ns.render;
      const { logDebug, normalizeText, normalizeTextBlock, postJson } = ns.shared;
      const CONFIG = constants.CONFIG || {};
      const MAX_NOTES_CONTEXT_ITEM_CHARS = constants.MAX_NOTES_CONTEXT_ITEM_CHARS || 0;
      const MAX_NOTES_CONTEXT_ITEMS = constants.MAX_NOTES_CONTEXT_ITEMS || 0;
      const MAX_SHARED_MEMO_CHARS = constants.MAX_SHARED_MEMO_CHARS || 0;
      const PENDING_UPLOAD_QUEUE_OPERATION_SCOPES = constants.PENDING_UPLOAD_QUEUE_OPERATION_SCOPES || {};

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      const applyRender = (...args) => helpers.applyRender?.(...args);
      const renderBlocked = (...args) => helpers.renderBlocked?.(...args);
      const requestConfirmation = (...args) => helpers.requestConfirmation?.(...args);
      const setNotice = (...args) => helpers.setNotice?.(...args);
      const cloneNotesContextItems = (...args) => helpers.cloneNotesContextItems?.(...args);
      const cloneNotesInputSnapshot = (...args) => helpers.cloneNotesInputSnapshot?.(...args);
      const persistWorkspaceSession = (...args) => controller("session")?.persistSession?.(...args);
      const clearWorkspaceSession = (...args) => controller("session")?.clearSession?.(...args);
      const runPendingUploadQueueOperation = (...args) => controller("pendingUploads")?.runPendingUploadQueueOperation?.(...args);
      const showPendingUploadQueueOperationError = (...args) => controller("pendingUploads")?.showPendingUploadQueueOperationError?.(...args);
      const deletePendingUpload = (...args) => controller("pendingUploads")?.deletePendingUpload?.(...args);
      const upsertPendingUpload = (...args) => controller("pendingUploads")?.createOrUpdatePendingUpload?.(...args);
      const syncWorkspaceLocalState = (...args) => controller("realtime")?.syncWorkspaceLocalState?.(...args);

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
      
      
      function generateClientRequestId(prefix = "mutation") {
        const normalizedPrefix = normalizeText(prefix) || "mutation";
        if (typeof global.crypto?.randomUUID === "function") {
          return `${normalizedPrefix}-${global.crypto.randomUUID()}`;
        }
        return `${normalizedPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
      
      
      function getMutationBusyKey(type) {
        switch (normalizeText(type)) {
          case "deleteMeeting":
            return "deleteMeeting";
          case "deleteRecord":
            return "deleteRecord";
          case "regenerateNotes":
            return "regenerateNotes";
          case "saveMeetingMemo":
            return "saveMeetingMemo";
          case "saveMeetingTitle":
            return "saveMeetingTitle";
          case "saveRecordContext":
            return "saveRecordContext";
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
          deleteMeeting: false,
          deleteRecord: false,
          regenerateNotes: false,
          saveMeetingMemo: false,
          saveMeetingTitle: false,
          saveRecordContext: false,
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
          resetNotesContextDraft: Boolean(options?.resetNotesContextDraft),
          resetRecordMemoDraft: Boolean(options?.resetRecordMemoDraft),
          reviewTab: normalizeText(options?.reviewTab),
          successMessage: normalizeText(options?.successMessage),
          type: normalizeText(options?.type),
        };
        syncWorkspaceMutationBusyState();
        return state.pendingMutations[requestId];
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
      
        const isCurrentSelectedRecord = mutation.recordId
          && mutation.recordId === normalizeText(state.currentDetailSelectionId || state.selectedRecordMemo.recordId);
        if (mutation.resetRecordMemoDraft && isCurrentSelectedRecord) {
          state.selectedRecordMemo.draft = state.selectedRecordMemo.saved;
        }
        if (mutation.resetNotesContextDraft && isCurrentSelectedRecord) {
          state.notesContext.draft = "";
          state.notesContext.editingId = "";
        }
        if (mutation.reviewTab && isCurrentSelectedRecord) {
          state.reviewTab = mutation.reviewTab;
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
          renderBlocked("이 탭은 여기까지입니다. 필요할 때 i-Nova 패널에서 새 회의를 열어 주세요.", {
            eyebrow: "회의 삭제 완료",
            title: "회의를 삭제했습니다",
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
          const snapshotMutation = mutation.type === "saveMeetingTitle" || mutation.type === "saveMeetingMemo"
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
      
      
      function normalizeNotesContextDraftValue(value) {
        return normalizeTextBlock(value).slice(0, MAX_NOTES_CONTEXT_ITEM_CHARS);
      }
      
      
      function readSelectedRecordReviewState(entry) {
        const savedMemo = normalizeTextBlock(
          state.currentJob?.sharedMemoSnapshot
          || entry?.remote?.sharedMemoSnapshot
          || entry?.pending?.sharedMemoSnapshot
        ).slice(0, MAX_SHARED_MEMO_CHARS);
        const contextItems = cloneNotesContextItems(
          state.currentArtifact?.notesContextItems?.length
            ? state.currentArtifact.notesContextItems
            : state.currentJob?.notesContextItems?.length
              ? state.currentJob.notesContextItems
              : entry?.remote?.notesContextItems
        );
        const notesInputSnapshot = cloneNotesInputSnapshot(
          state.currentArtifact?.notesInputSnapshot?.updatedAt
            ? state.currentArtifact.notesInputSnapshot
            : state.currentJob?.notesInputSnapshot,
          {
            contextItems,
            sharedMemo: savedMemo,
            updatedAt: normalizeText(state.currentArtifact?.notesGeneratedAt || state.currentJob?.notesGeneratedAt || state.currentJob?.updatedAt || entry?.remote?.updatedAt),
          }
        );
        return {
          contextItems,
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
      
        state.notesContext.recordId = snapshot.recordId;
        state.notesContext.items = snapshot.contextItems;
        if (selectionChanged) {
          state.notesContext.draft = "";
          state.notesContext.editingId = "";
        } else if (
          state.notesContext.editingId
          && !snapshot.contextItems.some((item) => normalizeText(item.contextId) === normalizeText(state.notesContext.editingId))
        ) {
          state.notesContext.draft = "";
          state.notesContext.editingId = "";
        }
      
        state.selectedRecordNotesInputSnapshot = {
          ...snapshot.notesInputSnapshot,
          recordId: snapshot.recordId,
        };
      }
      
      
      function updateSelectedRecordMemoDraft(value) {
        state.selectedRecordMemo.draft = normalizeTextareaDraft(value).slice(0, MAX_SHARED_MEMO_CHARS);
        applyRender();
      }
      
      
      function updateNotesContextDraft(value) {
        state.notesContext.draft = normalizeTextareaDraft(value).slice(0, MAX_NOTES_CONTEXT_ITEM_CHARS);
        applyRender();
      }
      
      
      function resetNotesContextDraft() {
        state.notesContext.draft = "";
        state.notesContext.editingId = "";
        applyRender();
      }
      
      
      function generateNotesContextId() {
        if (typeof global.crypto?.randomUUID === "function") {
          return global.crypto.randomUUID();
        }
        return `notes-context-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      
      
      function areNotesContextItemsEqual(leftItems, rightItems) {
        const left = cloneNotesContextItems(leftItems);
        const right = cloneNotesContextItems(rightItems);
        if (left.length !== right.length) {
          return false;
        }
        return left.every((item, index) =>
          normalizeText(item.contextId) === normalizeText(right[index]?.contextId)
          && normalizeTextBlock(item.text) === normalizeTextBlock(right[index]?.text)
        );
      }
      
      
      function startEditingNotesContextItem(contextId) {
        const normalizedContextId = normalizeText(contextId);
        const target = state.notesContext.items.find((item) => normalizeText(item.contextId) === normalizedContextId);
        if (!target) {
          return;
        }
        state.notesContext.editingId = normalizedContextId;
        state.notesContext.draft = target.text;
        applyRender();
        global.setTimeout(() => {
          if (!refs.notesContextInput) {
            return;
          }
          refs.notesContextInput.focus();
          if (typeof refs.notesContextInput.setSelectionRange === "function") {
            const length = refs.notesContextInput.value.length;
            refs.notesContextInput.setSelectionRange(length, length);
          }
        }, 0);
      }
      
      
      function buildUpdatedNotesContextItemsFromDraft() {
        let items = cloneNotesContextItems(state.notesContext.items);
        const text = normalizeNotesContextDraftValue(state.notesContext.draft);
        if (!text) {
          setNotice("추가 맥락이 있으면 넣어주세요.", "warning");
          applyRender();
          return null;
        }
        const editingId = normalizeText(state.notesContext.editingId);
        const duplicate = items.find((item) =>
          normalizeText(item.contextId) !== editingId
          && normalizeTextBlock(item.text) === text
        );
        if (duplicate) {
          setNotice("같은 추가 맥락이 이미 있습니다.", "warning");
          applyRender();
          return null;
        }
        const now = new Date().toISOString();
        if (editingId) {
          return items.map((item) =>
            normalizeText(item.contextId) === editingId
              ? { ...item, text, updatedAt: now }
              : item
          );
        }
        if (items.length >= MAX_NOTES_CONTEXT_ITEMS) {
          setNotice(`추가 맥락은 최대 ${MAX_NOTES_CONTEXT_ITEMS}개까지 저장할 수 있습니다.`, "warning");
          applyRender();
          return null;
        }
        return [
          ...items,
          { contextId: generateNotesContextId(), createdAt: now, text, updatedAt: now },
        ];
      }
      
      
      async function deleteNotesContextItem(contextId) {
        const normalizedContextId = normalizeText(contextId);
        const nextItems = state.notesContext.items.filter((item) => normalizeText(item.contextId) !== normalizedContextId);
        const resetDraft = normalizeText(state.notesContext.editingId) === normalizedContextId;
        await saveSelectedRecordContextItems(nextItems, {
          clearDraft: resetDraft,
          successMessage: "추가 맥락을 삭제했습니다.",
        });
      }
      
      
      async function upsertNotesContextDraft() {
        const nextItems = buildUpdatedNotesContextItemsFromDraft();
        if (!nextItems) {
          return false;
        }
        return await saveSelectedRecordContextItems(nextItems, {
          clearDraft: true,
          successMessage: state.notesContext.editingId ? "추가 맥락을 수정했습니다." : "추가 맥락을 저장했습니다.",
        });
      }
      
      
      function handleNotesContextListClick(event) {
        if (
          state.busy.deleteRecord
          || state.busy.regenerateNotes
          || state.busy.saveRecordContext
          || state.busy.saveRecordMemo
          || state.busy.saveRecordTitle
        ) {
          return;
        }
        const actionButton = event.target.closest("[data-notes-context-action]");
        if (!(actionButton instanceof global.HTMLElement)) {
          return;
        }
        const contextId = normalizeText(actionButton.dataset.notesContextId);
        if (!contextId) {
          return;
        }
        const action = normalizeText(actionButton.dataset.notesContextAction);
        if (action === "edit") {
          startEditingNotesContextItem(contextId);
          return;
        }
        if (action === "delete") {
          void deleteNotesContextItem(contextId);
        }
      }
      
      
      function escapeNotesContextHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }
      
      
      function renderNotesContextList() {
        if (!refs.notesContextList) {
          return;
        }
        const items = cloneNotesContextItems(state.notesContext.items);
        refs.notesContextList.hidden = items.length === 0;
        refs.notesContextList.innerHTML = items.map((item) => {
          const isEditing = normalizeText(state.notesContext.editingId) === normalizeText(item.contextId);
          return `
            <article class="notes-context-item">
              <div class="notes-context-item__body">${escapeNotesContextHtml(item.text).replace(/\n/g, "<br />")}</div>
              <div class="notes-context-item__actions">
                <button class="ghost-button" type="button" data-notes-context-action="edit" data-notes-context-id="${escapeNotesContextHtml(item.contextId)}">${isEditing ? "편집 중" : "수정"}</button>
                <button class="ghost-button ghost-button--soft" type="button" data-notes-context-action="delete" data-notes-context-id="${escapeNotesContextHtml(item.contextId)}">삭제</button>
              </div>
            </article>
          `;
        }).join("");
      }
      
      
      async function saveMeetingTitle() { return saveMeetingPatch({ title: normalizeText(state.meetingTitleDraft || refs.meetingTitleInput.value) }, "회의 이름을 저장했습니다.", "회의 이름을 먼저 입력해 주세요."); }
      
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
      
      
      async function saveMeetingPatch(patch, successMessage, emptyMessage) {
        if (!state.session.meetingId) return;
        if ("title" in patch && !patch.title && emptyMessage) { setNotice(emptyMessage, "error"); return applyRender(); }
        const mutationType = "title" in patch ? "saveMeetingTitle" : "saveMeetingMemo";
        const requestId = generateClientRequestId(mutationType === "saveMeetingTitle" ? "meeting-title" : "meeting-memo");
        registerPendingMutation({
          requestId,
          successMessage,
          type: mutationType,
        });
        applyRender();
        try {
          const payload = await postJson(global, CONFIG.updateMeetingTitleUrl, {
            clientRequestId: requestId,
            meetingId: state.session.meetingId,
            ...patch,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "회의 정보");
          await resolvePendingMutationsFromSnapshots();
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
      
      
      async function saveCurrentRecordTitle() {
        return saveRecordTitleForEntry(state.selectedRecordId, refs.recordTitleInput.value);
      }
      
      
      async function deleteCurrentRecord(recordId = state.selectedRecordId) {
        const normalizedRecordId = recordId instanceof global.Event ? state.selectedRecordId : recordId;
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
          const payload = await postJson(global, CONFIG.deleteMeetingResultUrl, {
            clientRequestId: requestId,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "기록 삭제");
          await resolvePendingMutationsFromSnapshots();
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
          body: "회의에 연결된 기록, 산출물, 남아 있는 임시 원본까지 함께 정리합니다. 처리 중인 기록이 있어도 지금 즉시 삭제 요청을 우선 반영하고, 남은 정리는 backend cleanup 경계에서 이어서 마칩니다.",
          confirmLabel: "회의 삭제",
          eyebrow: "회의 삭제",
          title: "이 회의 전체를 삭제할까요?",
          tone: "danger",
        })) return;
        const requestId = generateClientRequestId("delete-meeting");
        registerPendingMutation({
          requestId,
          successMessage: "회의를 삭제했습니다.",
          type: "deleteMeeting",
        });
        applyRender();
        try {
          const payload = await postJson(global, CONFIG.deleteMeetingUrl, {
            clientRequestId: requestId,
            meetingId: state.session.meetingId,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "회의 삭제");
          await resolvePendingMutationsFromSnapshots();
        } catch (error) {
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "회의를 삭제하지 못했어요."
          );
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }
      
      
      function isLegacyMeetingResultMutationError(error) {
        const message = normalizeText(error instanceof Error ? error.message : error?.message);
        return message === "수정할 회의 결과 내용이 비어 있어요.";
      }
      
      
      function buildLegacyMeetingResultMutationErrorMessage(subject) {
        const normalizedSubject = normalizeText(subject) || "회의 결과";
        return `${normalizedSubject} 저장을 지원하는 최신 함수가 아직 배포되지 않았어요. npm run deploy:functions 후 다시 시도해 주세요.`;
      }
      
      
      async function saveSelectedRecordMemo(options = {}) {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry?.remote?.jobId) {
          return false;
        }
        const nextMemo = normalizeTextareaDraft(
          global.document.activeElement === refs.detailMemoInput
            ? refs.detailMemoInput.value
            : state.selectedRecordMemo.draft
        ).slice(0, MAX_SHARED_MEMO_CHARS);
        if (!options.force && normalizeTextBlock(nextMemo) === normalizeTextBlock(state.selectedRecordMemo.saved)) {
          return true;
        }
        const requestId = generateClientRequestId("record-memo");
        if (!options.quiet) {
          registerPendingMutation({
            jobId: entry.remote.jobId,
            quiet: false,
            recordId: entry.id,
            requestId,
            resetRecordMemoDraft: true,
            successMessage: nextMemo ? "메모를 저장했습니다." : "메모를 비웠습니다.",
            type: "saveRecordMemo",
          });
        } else {
          state.busy.saveRecordMemo = true;
        }
        applyRender();
        try {
          const payload = await postJson(global, CONFIG.updateMeetingResultUrl, {
            clientRequestId: requestId,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
            sharedMemo: nextMemo,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "메모");
          if (!options.quiet) {
            await resolvePendingMutationsFromSnapshots();
          }
          return true;
        } catch (error) {
          if (isLegacyMeetingResultMutationError(error)) {
            logDebug("workspace.result.update.legacy-backend", {
              jobId: entry.remote.jobId,
              mutation: "sharedMemo",
            });
            if (!options.quiet) {
              await finalizePendingMutation(requestId, "failed", buildLegacyMeetingResultMutationErrorMessage("메모"));
            } else {
              setNotice(buildLegacyMeetingResultMutationErrorMessage("메모"), "error");
            }
            return false;
          }
          if (!options.quiet) {
            await finalizePendingMutation(
              requestId,
              "failed",
              error instanceof Error ? error.message : "메모를 저장하지 못했어요."
            );
          } else {
            setNotice(error instanceof Error ? error.message : "메모를 저장하지 못했어요.", "error");
          }
          return false;
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }
      
      
      async function saveSelectedRecordContextItems(nextItemsInput, options = {}) {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry?.remote?.jobId) {
          return false;
        }
        const nextItems = cloneNotesContextItems(nextItemsInput);
        if (!options.force && areNotesContextItemsEqual(nextItems, state.notesContext.items)) {
          if (options.clearDraft) {
            state.notesContext.draft = "";
            state.notesContext.editingId = "";
            applyRender();
          }
          return true;
        }
        const requestId = generateClientRequestId("record-context");
        registerPendingMutation({
          jobId: entry.remote.jobId,
          quiet: !options.successMessage,
          recordId: entry.id,
          requestId,
          resetNotesContextDraft: Boolean(options.clearDraft),
          successMessage: options.successMessage,
          type: "saveRecordContext",
        });
        applyRender();
        try {
          const payload = await postJson(global, CONFIG.updateMeetingResultUrl, {
            clientRequestId: requestId,
            contextItems: nextItems,
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "추가 맥락");
          await resolvePendingMutationsFromSnapshots();
          return true;
        } catch (error) {
          if (isLegacyMeetingResultMutationError(error)) {
            logDebug("workspace.result.update.legacy-backend", {
              contextItemCount: nextItems.length,
              jobId: entry.remote.jobId,
              mutation: "contextItems",
            });
            await finalizePendingMutation(requestId, "failed", buildLegacyMeetingResultMutationErrorMessage("추가 맥락"));
            return false;
          }
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "추가 맥락을 저장하지 못했어요."
          );
          return false;
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }
      
      
      async function regenerateNotes() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry?.remote?.jobId) return;
        const requestId = generateClientRequestId("regenerate-notes");
        registerPendingMutation({
          jobId: entry.remote.jobId,
          recordId: entry.id,
          requestId,
          resetNotesContextDraft: true,
          resetRecordMemoDraft: true,
          reviewTab: "notes",
          successMessage: "회의록을 업데이트했습니다.",
          type: "regenerateNotes",
        });
        state.reviewTab = "notes";
        applyRender();
        try {
          const persistedSharedMemo = normalizeTextBlock(
            global.document.activeElement === refs.detailMemoInput
              ? refs.detailMemoInput.value
              : state.selectedRecordMemo.draft
          ).slice(0, MAX_SHARED_MEMO_CHARS);
          const payload = await postJson(global, CONFIG.regenerateNotesUrl, {
            clientRequestId: requestId,
            contextItems: cloneNotesContextItems(state.notesContext.items),
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
            sharedMemo: persistedSharedMemo,
          }, state.session.meetingSessionToken);
          assertAcceptedMutationResponse(payload, requestId, "회의록 업데이트");
          await resolvePendingMutationsFromSnapshots();
        } catch (error) {
          await finalizePendingMutation(
            requestId,
            "failed",
            error instanceof Error ? error.message : "회의록을 업데이트하지 못했어요."
          );
        } finally {
          syncWorkspaceMutationBusyState();
          applyRender();
        }
      }
      
      
      function getCurrentRecordTitleForMutation(entry) {
        const activeInputValue = global.document.activeElement === refs.recordTitleInput
          ? refs.recordTitleInput?.value
          : "";
        return normalizeText(
          activeInputValue
          || refs.recordTitleInput?.value
          || state.currentJob?.title
          || entry?.remote?.title
          || entry?.pending?.meetingTitleSnapshot
          || state.meeting.title
          || state.session.title
          || "새 기록"
        );
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
            const payload = await postJson(global, CONFIG.updateMeetingResultUrl, {
              clientRequestId: requestId,
              jobId: entry.remote.jobId,
              meetingId: state.session.meetingId,
              title: nextTitle,
            }, state.session.meetingSessionToken);
            assertAcceptedMutationResponse(payload, requestId, "기록 이름");
            await resolvePendingMutationsFromSnapshots();
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
            }
          }
          if (!entry.remote?.jobId) {
            setNotice("기록 이름을 저장했습니다.", "highlight");
            await syncWorkspaceLocalState(true, "workflow");
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
      
      
      function updateMeetingTitleDraft(value) {
        state.meetingTitleDraft = normalizeText(value);
        applyRender();
      }
      
      
      function normalizeTextareaDraft(value) {
        return String(value || "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
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
      

      return {
        clearSharedMemo,
        deleteCurrentRecord,
        deleteMeeting,
        finalizePendingMutation,
        handleNotesContextListClick,
        normalizeNotesContextDraftValue,
        regenerateNotes,
        renderNotesContextList,
        resolvePendingMutationsFromSnapshots,
        resetNotesContextDraft,
        saveCurrentRecordTitle,
        saveMeetingTitle,
        saveRecordTitleForEntry,
        saveSelectedRecordContextItems,
        saveSelectedRecordMemo,
        saveSharedMemo,
        syncSelectedRecordReviewState,
        syncWorkspaceMutationBusyState,
        updateMeetingTitleDraft,
        updateNotesContextDraft,
        updateRecordMemoDraft,
        updateSelectedRecordMemoDraft,
        upsertNotesContextDraft,
      };
    },
  };
})(globalThis);
