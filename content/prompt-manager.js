(function initPromptManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, hooks) {
    return {
      buildViewState,
      consumeEscape,
      handleAction,
      handleImportFile,
      updateDraft,
    };
    function buildViewState(items) {
      const review = state.promptImportReview
        ? { ...state.promptImportReview, summary: namespace.promptLibrary.previewImport(state.promptLibrary, state.promptImportReview.payload, state.promptImportReview.mode) }
        : null;
      const pendingPrompt = state.promptPendingInsert ? getPromptById(state.promptPendingInsert.promptId) : null;

      return {
        deletePromptId: state.promptDeleteConfirmId,
        editor: buildEditorView(),
        emptyText: state.queries.prompts
          ? "검색 결과가 없어요. 다른 표현으로 찾아보세요."
          : "자주 쓰는 요청을 추가해 두면 여기서 바로 입력창에 넣을 수 있어요.",
        actionPending: state.promptActionPending,
        feedback: state.promptFeedback,
        importReview: review,
        items,
        menuPromptId: state.promptMenuId,
        pendingInsert: pendingPrompt ? { promptId: pendingPrompt.id, title: pendingPrompt.title } : null,
        publishCategoryId: state.promptPublishCategoryId,
        publishError: state.promptPublishError,
        publishPromptId: state.promptPublishPromptId,
        publishTitle: state.promptPublishTitle,
        query: state.queries.prompts,
        storeCategories: namespace.promptStore.getCategories().filter((category) => category.id !== "all"),
        totalCount: state.promptLibrary.items.length,
      };
    }
    function buildEditorView() {
      if (!state.promptEditor.open) return { open: false };
      return {
        ...state.promptEditor,
        actionPending: state.promptActionPending,
        description: state.promptEditor.mode === "edit" ? "저장 후 바로 다시 사용할 수 있어요." : "반복해서 쓰는 요청을 저장해 두세요.",
        submitLabel: state.promptEditor.mode === "edit" ? "저장" : "추가",
        titleText: state.promptEditor.mode === "edit" ? "요청 수정" : "새 요청 추가",
      };
    }
    function createPromptEditor(item = null) { return { open: false, mode: item ? "edit" : "create", id: item?.id || "", title: item?.title || "", content: item?.content || "", error: "" }; }
    function resetPublishState() { state.promptPublishPromptId = ""; state.promptPublishTitle = ""; state.promptPublishError = ""; }
    function updateDraft(field, value) { if (!state.promptEditor.open) return; const hadError = Boolean(state.promptEditor.error); state.promptEditor = { ...state.promptEditor, [field]: value, error: "" }; if (hadError) hooks.render(); }
    async function handleAction(action, detail = {}) {
      if (action === "create") return void openEditor();
      if (action === "edit") return void openEditor(getPromptById(detail.promptId));
      if (action === "toggle-menu") return void toggleMenu(detail.promptId);
      if (action === "dismiss-menu") return void dismissMenu();
      if (action === "request-delete" || action === "delete") return void requestDelete(detail.promptId);
      if (action === "cancel-delete") return void cancelDelete();
      if (action === "confirm-delete") return void confirmDelete(detail.promptId);
      if (action === "open-publish") return void openPublish(detail.promptId);
      if (action === "cancel-publish") return void cancelPublish();
      if (action === "set-publish-category") return void setPublishCategory(detail.categoryId);
      if (action === "set-publish-title") return void setPublishTitle(detail.title);
      if (action === "confirm-publish") return void confirmPublish(detail.promptId);
      if (action === "cancel-editor") return void closeEditor();
      if (action === "save-editor") return void saveEditor();
      if (action === "use") return void prepareInsert(detail.promptId);
      if (action === "confirm-insert") return void applyInsert(detail.insertMode || "replace");
      if (action === "cancel-insert") return void cancelInsert();
      if (action === "export") return void exportLibrary();
      if (action === "apply-import") return void applyImport();
      if (action === "cancel-import") return void cancelImport();
      if (action === "set-import-mode") return void setImportMode(detail.importMode);
    }
    function openEditor(item = null) {
      logDebug("prompt.editor.open", {
        mode: item ? "edit" : "create",
        promptId: namespace.session.normalizeText(item?.id),
        scope: "prompt",
      });
      state.promptEditor = { ...createPromptEditor(item), open: true };
      state.promptImportReview = null;
      state.promptMenuId = "";
      state.promptDeleteConfirmId = "";
      state.promptPendingInsert = null;
      resetPublishState();
      setFeedback("");
      hooks.render();
    }
    function closeEditor() { state.promptEditor = createPromptEditor(); hooks.render(); }
    async function saveEditor() {
      if (state.promptActionPending?.type === "save-editor") return;
      const title = namespace.session.normalizeText(state.promptEditor.title);
      const content = String(state.promptEditor.content || "").trim();
      if (!title || !content) {
        state.promptEditor = { ...state.promptEditor, error: "이름과 본문을 모두 입력해 주세요." };
        hooks.render();
        return;
      }

      const wasEdit = state.promptEditor.mode === "edit";
      logDebug("prompt.save.start", {
        mode: wasEdit ? "edit" : "create",
        promptId: namespace.session.normalizeText(state.promptEditor.id),
        scope: "prompt",
      });
      state.promptActionPending = { type: "save-editor" };
      hooks.render();
      try {
        state.promptLibrary = await namespace.storage.savePromptItem({ content, id: state.promptEditor.id, title });
        state.promptEditor = createPromptEditor();
        state.promptMenuId = "";
        state.promptDeleteConfirmId = "";
        resetPublishState();
        setFeedback(wasEdit ? "요청을 수정했어요." : "요청을 추가했어요.");
        logDebug("prompt.save.success", {
          mode: wasEdit ? "edit" : "create",
          promptCount: Array.isArray(state.promptLibrary.items) ? state.promptLibrary.items.length : 0,
          scope: "prompt",
        });
      } catch (error) {
        setFeedback(getActionErrorMessage(error, "요청을 저장하지 못했어요."), "error");
        logDebug("prompt.save.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          mode: wasEdit ? "edit" : "create",
          scope: "prompt",
        });
        reportActionError("save prompt failed", error);
      } finally {
        state.promptActionPending = null;
      }
      hooks.render();
    }
    function toggleMenu(promptId) {
      const prompt = getPromptById(promptId);
      if (!prompt) return;
      state.promptDeleteConfirmId = "";
      state.promptMenuId = state.promptMenuId === promptId ? "" : promptId;
      hooks.render();
    }
    function dismissMenu() {
      if (!state.promptMenuId && !state.promptDeleteConfirmId) return;
      state.promptMenuId = "";
      state.promptDeleteConfirmId = "";
      hooks.render();
    }
    function requestDelete(promptId) {
      const prompt = getPromptById(promptId);
      if (!prompt) return;
      state.promptMenuId = "";
      state.promptDeleteConfirmId = state.promptDeleteConfirmId === promptId ? "" : promptId;
      resetPublishState();
      hooks.render();
    }
    function cancelDelete() { if (!state.promptDeleteConfirmId) return; state.promptDeleteConfirmId = ""; hooks.render(); }
    async function confirmDelete(promptId = state.promptDeleteConfirmId) {
      if (state.promptActionPending?.type === "delete" && state.promptActionPending.promptId === promptId) return;
      const prompt = getPromptById(promptId);
      if (!prompt) { state.promptDeleteConfirmId = ""; hooks.render(); return; }
      state.promptActionPending = { type: "delete", promptId };
      logDebug("prompt.delete.start", {
        promptId,
        scope: "prompt",
      });
      hooks.render();
      try {
        state.promptLibrary = await namespace.storage.removePromptItem(promptId);
        state.promptDeleteConfirmId = "";
        state.promptMenuId = "";
        resetPublishState();
        if (state.promptEditor.id === promptId) state.promptEditor = createPromptEditor();
        setFeedback("요청을 삭제했어요.");
        logDebug("prompt.delete.success", {
          promptId,
          promptCount: Array.isArray(state.promptLibrary.items) ? state.promptLibrary.items.length : 0,
          scope: "prompt",
        });
      } catch (error) {
        setFeedback(getActionErrorMessage(error, "요청을 삭제하지 못했어요."), "error");
        logDebug("prompt.delete.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          promptId,
          scope: "prompt",
        });
        reportActionError("delete prompt failed", error);
      } finally {
        state.promptActionPending = null;
      }
      hooks.render();
    }
    function prepareInsert(promptId) {
      const prompt = getPromptById(promptId);
      const composerState = namespace.composer.getComposerState();
      if (!prompt) return;
      state.promptMenuId = "";
      state.promptDeleteConfirmId = "";
      if (!composerState.available) {
        setFeedback("대화 입력창을 찾지 못했어요.", "error", promptId);
        logDebug("prompt.use.error", {
          error: "대화 입력창을 찾지 못했어요.",
          promptId,
          scope: "prompt",
        });
        hooks.render();
        return;
      }

      logDebug("prompt.use.start", {
        promptId,
        scope: "prompt",
      });
      if (namespace.session.normalizeText(composerState.text)) { state.promptPendingInsert = { promptId }; hooks.render(); return; }
      applyInsert("replace", promptId);
    }
    function cancelInsert() { state.promptPendingInsert = null; hooks.render(); }
    function applyInsert(mode, promptId = state.promptPendingInsert?.promptId) {
      const prompt = getPromptById(promptId);
      if (!prompt) return;
      const success = namespace.composer.applyPromptText(prompt.content, mode);
      state.promptPendingInsert = null;
      setFeedback(success ? `"${prompt.title}" 요청을 입력창에 넣었어요.` : "입력창에 넣지 못했어요.", success ? "info" : "error", promptId);
      logDebug(success ? "prompt.use.success" : "prompt.use.error", {
        mode,
        promptId,
        scope: "prompt",
      });
      hooks.render();
    }
    async function handleImportFile(file) {
      logDebug("prompt.import.start", {
        fileName: namespace.session.normalizeText(file?.name),
        scope: "prompt",
      });
      try {
        const text = await namespace.contentFiles.readTextFile(file);
        const payload = namespace.promptLibrary.parseImportText(text);
        state.promptImportReview = { confirmReplace: false, fileName: file.name, libraryName: payload.libraryName, mode: "merge", payload };
        state.promptEditor = createPromptEditor();
        state.promptMenuId = "";
        state.promptDeleteConfirmId = "";
        state.promptPendingInsert = null;
        resetPublishState();
        state.activeTool = "prompts";
        state.uiPreferences.activeTool = "prompts";
        state.uiPreferences.activePromptTab = "library";
        await hooks.persistActiveTool("prompts", "library");
        setFeedback("");
        logDebug("prompt.import.success", {
          fileName: namespace.session.normalizeText(file?.name),
          scope: "prompt",
        });
      } catch (error) {
        setFeedback(getActionErrorMessage(error, "가져오기 파일을 읽지 못했어요."), "error");
        logDebug("prompt.import.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          fileName: namespace.session.normalizeText(file?.name),
          scope: "prompt",
        });
        reportActionError("import file failed", error);
      }
      hooks.render();
    }
    function setImportMode(mode) { if (!state.promptImportReview) return; state.promptImportReview = { ...state.promptImportReview, confirmReplace: false, mode: ["add", "merge", "replace"].includes(mode) ? mode : "merge" }; hooks.render(); }
    async function applyImport() {
      if (!state.promptImportReview) return;
      if (state.promptImportReview.mode === "replace" && !state.promptImportReview.confirmReplace) {
        state.promptImportReview = { ...state.promptImportReview, confirmReplace: true }; hooks.render(); return;
      }

      logDebug("prompt.import.apply.start", {
        mode: namespace.session.normalizeText(state.promptImportReview.mode),
        scope: "prompt",
      });
      try {
        const result = await namespace.storage.importPromptLibrary(state.promptImportReview.payload, state.promptImportReview.mode);
        state.promptLibrary = result.library;
        state.promptImportReview = null;
        setFeedback(
          `가져오기 완료: 추가 ${result.summary.added}개, 업데이트 ${result.summary.updated}개, 건너뜀 ${result.summary.skipped}개`
        );
        logDebug("prompt.import.apply.success", {
          added: Number(result?.summary?.added) || 0,
          scope: "prompt",
          skipped: Number(result?.summary?.skipped) || 0,
          updated: Number(result?.summary?.updated) || 0,
        });
      } catch (error) {
        setFeedback(getActionErrorMessage(error, "요청 가져오기를 적용하지 못했어요."), "error");
        logDebug("prompt.import.apply.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          scope: "prompt",
        });
        reportActionError("apply import failed", error);
      }
      hooks.render();
    }
    function cancelImport() { state.promptImportReview = null; resetPublishState(); hooks.render(); }
    function exportLibrary() {
      if (!state.promptLibrary.items.length) return;
      namespace.contentFiles.downloadJson(buildExportFilename(), namespace.promptLibrary.buildExportPayload(state.promptLibrary));
      setFeedback("요청 보관함을 JSON 파일로 내보냈어요.");
      logDebug("prompt.export.success", {
        promptCount: Array.isArray(state.promptLibrary.items) ? state.promptLibrary.items.length : 0,
        scope: "prompt",
      });
      hooks.render();
    }
    function buildExportFilename() { return `inova-prompts-${new Date().toISOString().slice(0, 10)}.json`; }
    function getPromptById(promptId) { return state.promptLibrary.items.find((item) => item.id === promptId) || null; }
    function openPublish(promptId) {
      const prompt = getPromptById(promptId);
      if (!prompt) return;
      logDebug("prompt.publish.open", {
        promptId,
        scope: "prompt",
      });
      state.promptMenuId = "";
      state.promptDeleteConfirmId = "";
      state.promptPublishPromptId = promptId;
      state.promptPublishCategoryId = state.promptPublishCategoryId || "document";
      state.promptPublishTitle = prompt.title || "";
      state.promptPublishError = "";
      hooks.render();
    }
    function cancelPublish() { if (!state.promptPublishPromptId) return; resetPublishState(); hooks.render(); }
    function setPublishCategory(categoryId) {
      state.promptPublishCategoryId = namespace.promptStore.getCategories().some((category) => category.id === categoryId)
        ? categoryId
        : "document";
      state.promptPublishError = "";
      hooks.render();
    }
    function setPublishTitle(title) {
      state.promptPublishTitle = String(title || "");
      if (!state.promptPublishError) return;
      state.promptPublishError = "";
      hooks.render();
    }
    async function confirmPublish(promptId = state.promptPublishPromptId) {
      if (!promptId) return;
      if (state.promptActionPending?.type === "publish" && state.promptActionPending.promptId === promptId) return;
      const publishTitle = namespace.session.normalizeText(state.promptPublishTitle);
      if (!publishTitle) {
        state.promptPublishError = "스토어 제목을 입력해 주세요.";
        hooks.render();
        return;
      }
      state.promptActionPending = { type: "publish", promptId };
      logDebug("prompt.publish.start", {
        categoryId: namespace.session.normalizeText(state.promptPublishCategoryId),
        promptId,
        scope: "prompt",
        title: publishTitle,
      });
      hooks.render();
      try {
        const published = await hooks.publishPrompt?.(promptId, state.promptPublishCategoryId, publishTitle);
        if (published) {
          state.promptPublishPromptId = "";
          state.promptPublishTitle = "";
          state.promptPublishError = "";
          setFeedback("스토어에 복사본으로 등록했어요.", "info", promptId);
          logDebug("prompt.publish.success", {
            categoryId: namespace.session.normalizeText(state.promptPublishCategoryId),
            promptId,
            scope: "prompt",
            title: publishTitle,
          });
        }
      } catch (error) {
        setFeedback(getActionErrorMessage(error, "스토어에 등록하지 못했어요."), "error", promptId);
        logDebug("prompt.publish.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          promptId,
          scope: "prompt",
          title: publishTitle,
        });
        reportActionError("publish prompt failed", error);
      } finally {
        state.promptActionPending = null;
      }
      hooks.render();
    }
    function consumeEscape() {
      if (state.promptEditor.open) { closeEditor(); return true; }
      if (state.promptImportReview) { cancelImport(); return true; }
      if (state.promptPendingInsert) { cancelInsert(); return true; }
      if (state.promptPublishPromptId) { cancelPublish(); return true; }
      if (state.promptDeleteConfirmId) { cancelDelete(); return true; }
      if (state.promptMenuId) { dismissMenu(); return true; }
      return false;
    }
    function setFeedback(message, tone = "info", promptId = "") {
      global.clearTimeout(state.feedbackTimer);
      state.promptFeedback = message ? { message, promptId, tone } : null;
      if (!message) return;
      state.feedbackTimer = global.setTimeout(() => {
        state.promptFeedback = null;
        hooks.render();
      }, 2600);
    }
    function getActionErrorMessage(error, fallback) {
      const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
      if (message.includes("Extension context invalidated")) {
        return "확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.";
      }
      return fallback;
    }
    function reportActionError(action, error) {
      const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
      if (message.includes("Extension context invalidated")) {
        return;
      }
      console.error(`[i-Nova Bookmarks] ${action}`, error);
    }
    function logDebug(event, payload) {
      namespace.panelDebug?.log?.(event, payload || {});
    }
  }
  namespace.promptManager = {
    create,
  };
})(globalThis);
