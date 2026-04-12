(function initPromptLibraryController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "page.adapter.v2",
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const invokePage = typeof options.invokePage === "function"
      ? options.invokePage
      : async () => ({});
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
    const ensureStoreLoaded = typeof options.ensureStoreLoaded === "function"
      ? options.ensureStoreLoaded
      : async () => {};
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};
    const traceReview = typeof options.traceReview === "function"
      ? options.traceReview
      : () => {};

    const state = {
      actionPending: null,
      activeTab: "library",
      activeTabUserSelected: false,
      capabilities: [],
      deletePromptId: "",
      editor: createEditor(),
      feedback: null,
      importReview: null,
      initialized: false,
      initializing: false,
      lastError: "",
      lastMutationError: "",
      loadPromise: null,
      loading: false,
      menuPromptId: "",
      pendingInsert: null,
      promptLibrary: namespace.promptLibraryModel?.mergePromptLibrary?.() || { items: [], version: 1 },
      promptLibraryRemoteReady: false,
      loadedProviderUserKey: "",
      providerIdentity: {
        available: false,
        displayName: "",
        email: "",
        numericUserId: null,
        provider: "inova",
        providerUserKey: "",
      },
      publishCategoryId: "",
      publishError: "",
      publishPromptId: "",
      publishTitle: "",
      query: "",
      reviewPendingAutofocused: false,
      textInputRenderTimer: 0,
      syncNotice: null,
      syncing: false,
    };

    return {
      buildPromptToolState,
      getActiveTab,
      getPromptCount,
      getProviderIdentity,
      handleImportFile,
      handleMovePrompt,
      handlePromptAction,
      handlePromptDraftChange,
      handleSearch,
      handleSelectPromptTab,
      hasRequiredCapabilities,
      importStorePrompt,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      syncExternalReviewActivation(panelState?.promptTool?.review);
      if (!hasRequiredCapabilities()) {
        return;
      }
      if (panelState?.activeTool === "prompts" || !state.initialized) {
        void ensureInitialized(panelState);
      }
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getPromptCount() {
      return Array.isArray(state.promptLibrary?.items) ? state.promptLibrary.items.length : 0;
    }

    function getActiveTab() {
      return state.activeTab;
    }

    function getProviderIdentity() {
      return {
        ...state.providerIdentity,
      };
    }

    function buildPromptToolState(fallbackPromptTool = {}, options = {}) {
      const promptCount = getPromptCount();
      const storeCount = Math.max(
        0,
        Number(fallbackPromptTool?.tabs?.find?.((tab) => tab.id === "store")?.count)
          || Number(fallbackPromptTool?.store?.totalCount)
          || 0
      );
      const reviewOpen = Boolean(options.reviewOpen || fallbackPromptTool?.review?.open);
      return {
        activeTab: getEffectiveActiveTab(state.activeTab, reviewOpen),
        prompt: buildPromptViewState(),
        reviewPlaceholder: {
          body: "검토 탭의 hosted ownership은 다음 단계에서 이동합니다.",
          title: "검토 이동 준비 중",
        },
        storePlaceholder: {
          body: "스토어 탭의 hosted ownership은 다음 단계에서 이동합니다.",
          title: "스토어 이동 준비 중",
        },
        tabs: buildPromptTabs(promptCount, storeCount, reviewOpen),
      };
    }

    function buildPromptViewState() {
      const items = filterPromptItems(state.promptLibrary?.items || [], state.query);
      return {
        actionPending: state.actionPending,
        deletePromptId: state.deletePromptId,
        editor: buildEditorView(),
        emptyText: state.query
          ? "검색 결과가 없어요. 다른 표현으로 찾아보세요."
          : "자주 쓰는 요청을 추가해 두면 여기서 바로 입력창에 넣을 수 있어요.",
        feedback: state.feedback,
        importReview: state.importReview,
        items,
        loading: state.loading,
        menuPromptId: state.menuPromptId,
        pendingInsert: state.pendingInsert,
        publishCategoryId: state.publishCategoryId,
        publishError: state.publishError,
        publishPromptId: state.publishPromptId,
        publishTitle: state.publishTitle,
        query: state.query,
        storeCategories: namespace.promptStoreModel?.getCategories?.() || [],
        syncNotice: state.syncNotice,
        totalCount: getPromptCount(),
      };
    }

    function buildEditorView() {
      if (!state.editor?.open) {
        return { open: false };
      }
      return {
        ...state.editor,
        actionPending: state.actionPending,
        description: state.editor.mode === "edit"
          ? "저장 후 바로 다시 사용할 수 있어요."
          : "반복해서 쓰는 요청을 저장해 두세요.",
        submitLabel: state.editor.mode === "edit" ? "저장" : "추가",
        titleText: state.editor.mode === "edit" ? "요청 수정" : "새 요청 추가",
      };
    }

    function handleSearch(toolId, value) {
      if (normalizeText(toolId) !== "prompts") {
        return false;
      }
      const nextQuery = String(value || "");
      if (state.query === nextQuery) {
        return true;
      }
      state.query = nextQuery;
      scheduleTextInputRender();
      return true;
    }

    async function handleSelectPromptTab(promptTabId) {
      const nextTab = normalizePromptTab(promptTabId);
      state.activeTab = nextTab;
      state.activeTabUserSelected = true;
      state.reviewPendingAutofocused = nextTab === "review";
      await persistActivePromptTab(nextTab);
      if (nextTab === "library") {
        void ensurePromptLibraryLoaded(true, "prompt-tab-select");
      }
      scheduleRender();
      return true;
    }

    function handlePromptDraftChange(field, value) {
      if (!state.editor.open) {
        return false;
      }
      const key = normalizeText(field);
      if (key !== "title" && key !== "content") {
        return false;
      }
      const nextValue = String(value || "");
      if (String(state.editor[key] || "") === nextValue && !state.editor.error) {
        return true;
      }
      state.editor = {
        ...state.editor,
        [key]: nextValue,
        error: "",
      };
      scheduleTextInputRender();
      return true;
    }

    async function handleImportFile(file) {
      if (!(file instanceof global.File)) {
        return false;
      }
      try {
        await ensurePromptLibraryLoaded(true, "import-file");
        const text = await file.text();
        const payload = namespace.promptLibraryModel.parseImportText(text);
        const result = namespace.promptLibraryModel.applyImport(state.promptLibrary, payload, "add");
        await syncPromptLibrary(result.library, "add-import");
        state.feedback = createFeedback(`가져오기 완료: 추가 ${result.summary.added}개, 건너뜀 ${result.summary.skipped}개`);
        state.importReview = null;
        clearMenuState();
      } catch (error) {
        state.feedback = createFeedback(readErrorMessage(error, "가져오기 파일을 읽지 못했어요."), "error");
      }
      scheduleRender();
      return true;
    }

    async function importStorePrompt(storeEntry) {
      await ensurePromptLibraryLoaded(true, "import-store-prompt");
      const nextPromptLibrary = namespace.promptLibraryModel.importStoreEntry(state.promptLibrary, storeEntry);
      await syncPromptLibrary(nextPromptLibrary, "import-store-prompt");
      return state.promptLibrary;
    }

    async function handleMovePrompt(dragPromptId, targetPromptId, placement) {
      if (state.activeTab !== "library") {
        return false;
      }
      try {
        await ensurePromptLibraryLoaded(true, "move-prompt");
        const nextPromptLibrary = namespace.promptLibraryModel.movePromptItem(
          state.promptLibrary,
          normalizeText(dragPromptId),
          normalizeText(targetPromptId),
          normalizeText(placement) || "before"
        );
        await syncPromptLibrary(nextPromptLibrary, "reorder-prompts");
      } catch (error) {
        state.feedback = createFeedback(readErrorMessage(error, "요청 순서를 바꾸지 못했어요."), "error");
      }
      scheduleRender();
      return true;
    }

    async function handlePromptAction(action, detail = {}) {
      const normalizedAction = normalizeText(action);
      if (!normalizedAction) {
        return false;
      }
      if (normalizedAction === "create") {
        state.editor = createEditor();
        state.editor.open = true;
        clearMenuState();
        scheduleRender();
        return true;
      }
      if (normalizedAction === "edit") {
        const item = findPromptById(detail.promptId);
        if (!item) {
          return true;
        }
        state.editor = {
          content: item.content,
          error: "",
          id: item.id,
          mode: "edit",
          open: true,
          title: item.title,
        };
        clearMenuState();
        scheduleRender();
        return true;
      }
      if (normalizedAction === "toggle-menu") {
        const promptId = normalizeText(detail.promptId);
        state.menuPromptId = state.menuPromptId === promptId ? "" : promptId;
        state.deletePromptId = "";
        scheduleRender();
        return true;
      }
      if (normalizedAction === "dismiss-menu") {
        if (state.menuPromptId || state.deletePromptId) {
          clearMenuState();
          scheduleRender();
        }
        return true;
      }
      if (normalizedAction === "request-delete" || normalizedAction === "delete") {
        state.menuPromptId = "";
        state.deletePromptId = normalizeText(detail.promptId);
        scheduleRender();
        return true;
      }
      if (normalizedAction === "cancel-delete") {
        state.deletePromptId = "";
        scheduleRender();
        return true;
      }
      if (normalizedAction === "confirm-delete") {
        await confirmDelete(normalizeText(detail.promptId));
        return true;
      }
      if (normalizedAction === "cancel-editor") {
        state.editor = createEditor();
        scheduleRender();
        return true;
      }
      if (normalizedAction === "save-editor") {
        await saveEditor();
        return true;
      }
      if (normalizedAction === "use") {
        try {
          await prepareInsert(normalizeText(detail.promptId));
        } catch (error) {
          state.feedback = createFeedback(readErrorMessage(error, "입력창에 넣지 못했어요."), "error");
          scheduleRender();
        }
        return true;
      }
      if (normalizedAction === "confirm-insert") {
        try {
          await applyInsert(normalizeText(detail.insertMode) || "replace");
        } catch (error) {
          state.feedback = createFeedback(readErrorMessage(error, "입력창에 넣지 못했어요."), "error");
          scheduleRender();
        }
        return true;
      }
      if (normalizedAction === "cancel-insert") {
        state.pendingInsert = null;
        scheduleRender();
        return true;
      }
      if (normalizedAction === "export") {
        exportLibrary();
        return true;
      }
      if (normalizedAction === "apply-import" || normalizedAction === "cancel-import" || normalizedAction === "set-import-mode") {
        state.importReview = null;
        scheduleRender();
        return true;
      }
      if (normalizedAction === "open-publish") {
        openPublish(normalizeText(detail.promptId));
        return true;
      }
      if (normalizedAction === "cancel-publish") {
        cancelPublish();
        return true;
      }
      if (normalizedAction === "set-publish-category") {
        setPublishCategory(normalizeText(detail.categoryId));
        return true;
      }
      if (normalizedAction === "set-publish-title") {
        setPublishTitle(detail.title);
        return true;
      }
      if (normalizedAction === "confirm-publish") {
        await confirmPublish(normalizeText(detail.promptId));
        return true;
      }
      return false;
    }

    async function saveEditor() {
      const title = normalizeText(state.editor.title);
      const content = String(state.editor.content || "").trim();
      if (!title || !content) {
        state.editor = {
          ...state.editor,
          error: "이름과 본문을 모두 입력해 주세요.",
        };
        scheduleRender();
        return;
      }
      await ensurePromptLibraryLoaded(true, "save-editor");
      const wasEdit = state.editor.mode === "edit";
      state.actionPending = { type: "save-editor" };
      scheduleRender();
      try {
        const nextPromptLibrary = namespace.promptLibraryModel.upsertPromptItem(state.promptLibrary, {
          content,
          id: state.editor.id,
          title,
        });
        await syncPromptLibrary(nextPromptLibrary, wasEdit ? "update-prompt" : "create-prompt");
        state.editor = createEditor();
        clearMenuState();
        state.feedback = createFeedback(wasEdit ? "요청을 수정했어요." : "요청을 추가했어요.");
      } catch (error) {
        state.feedback = createFeedback(readErrorMessage(error, "요청을 저장하지 못했어요."), "error");
      } finally {
        state.actionPending = null;
        scheduleRender();
      }
    }

    async function confirmDelete(promptId) {
      const normalizedPromptId = normalizeText(promptId || state.deletePromptId);
      if (!normalizedPromptId) {
        return;
      }
      await ensurePromptLibraryLoaded(true, "delete-prompt");
      state.actionPending = { promptId: normalizedPromptId, type: "delete" };
      scheduleRender();
      try {
        const nextPromptLibrary = namespace.promptLibraryModel.removePromptItem(state.promptLibrary, normalizedPromptId);
        await syncPromptLibrary(nextPromptLibrary, "delete-prompt");
        if (state.editor.id === normalizedPromptId) {
          state.editor = createEditor();
        }
        clearMenuState();
        state.feedback = createFeedback("요청을 삭제했어요.");
      } catch (error) {
        state.feedback = createFeedback(readErrorMessage(error, "요청을 삭제하지 못했어요."), "error");
      } finally {
        state.actionPending = null;
        state.deletePromptId = "";
        scheduleRender();
      }
    }

    function openPublish(promptId) {
      const prompt = findPromptById(promptId);
      if (!prompt) {
        return;
      }
      state.menuPromptId = "";
      state.deletePromptId = "";
      state.publishPromptId = prompt.id;
      state.publishCategoryId = normalizePublishCategoryId(state.publishCategoryId || "document");
      state.publishTitle = prompt.title || "";
      state.publishError = "";
      scheduleRender();
    }

    function cancelPublish() {
      if (!state.publishPromptId) {
        return;
      }
      state.publishPromptId = "";
      state.publishTitle = "";
      state.publishError = "";
      scheduleRender();
    }

    function setPublishCategory(categoryId) {
      state.publishCategoryId = normalizePublishCategoryId(categoryId);
      state.publishError = "";
      scheduleRender();
    }

    function setPublishTitle(title) {
      state.publishTitle = String(title || "");
      if (!state.publishError) {
        return;
      }
      state.publishError = "";
      scheduleRender();
    }

    async function confirmPublish(promptId = state.publishPromptId) {
      const normalizedPromptId = normalizeText(promptId || state.publishPromptId);
      if (!normalizedPromptId) {
        return;
      }
      if (state.actionPending?.type === "publish" && state.actionPending.promptId === normalizedPromptId) {
        return;
      }
      const prompt = findPromptById(normalizedPromptId);
      if (!prompt) {
        return;
      }
      const publishTitle = normalizeText(state.publishTitle);
      if (!publishTitle) {
        state.publishError = "스토어 제목을 입력해 주세요.";
        scheduleRender();
        return;
      }
      if (!state.providerIdentity.available) {
        state.publishError = "사용자 정보를 확인하지 못했어요.";
        scheduleRender();
        return;
      }
      state.actionPending = { type: "publish", promptId: normalizedPromptId };
      scheduleRender();
      try {
        await invokeRuntime({
          action: "functions.fetch",
          authMode: "access-token",
          body: {
            categoryId: normalizePublishCategoryId(state.publishCategoryId || "document"),
            prompt: {
              content: prompt.content,
              title: publishTitle,
            },
            providerIdentity: {
              available: state.providerIdentity.available,
              displayName: state.providerIdentity.displayName,
              email: state.providerIdentity.email,
              numericUserId: state.providerIdentity.numericUserId,
              provider: state.providerIdentity.provider,
              providerUserKey: state.providerIdentity.providerUserKey,
            },
          },
          endpointKey: "publishPromptToStoreUrl",
          service: "prompt",
        });
        state.publishPromptId = "";
        state.publishTitle = "";
        state.publishError = "";
        state.feedback = createFeedback("스토어에 별도 복사본으로 등록했어요.", "info", normalizedPromptId);
        await ensureStoreLoaded(true, "publish");
      } catch (error) {
        state.feedback = createFeedback(readErrorMessage(error, "스토어에 등록하지 못했어요."), "error", normalizedPromptId);
      } finally {
        state.actionPending = null;
        scheduleRender();
      }
    }

    async function prepareInsert(promptId) {
      const prompt = findPromptById(promptId);
      if (!prompt) {
        return;
      }
      const composerState = await invokePage({ action: "get-composer-state" });
      if (!composerState?.available) {
        state.feedback = createFeedback("대화 입력창을 찾지 못했어요.", "error", promptId);
        scheduleRender();
        return;
      }
      if (normalizeText(composerState.text)) {
        state.pendingInsert = {
          promptId: prompt.id,
          title: prompt.title,
        };
        scheduleRender();
        return;
      }
      await applyInsert("replace", prompt.id);
    }

    async function applyInsert(mode, promptId = state.pendingInsert?.promptId) {
      const prompt = findPromptById(promptId);
      if (!prompt) {
        return;
      }
      const result = await invokePage({
        action: "apply-prompt-text",
        mode: normalizeText(mode) || "replace",
        text: prompt.content,
      });
      state.pendingInsert = null;
      state.feedback = createFeedback(
        result?.applied
          ? `"${prompt.title}" 요청을 입력창에 넣었어요.`
          : "입력창에 넣지 못했어요.",
        result?.applied ? "info" : "error",
        prompt.id
      );
      scheduleRender();
    }

    function exportLibrary() {
      const payload = namespace.promptLibraryModel.buildExportPayload(state.promptLibrary);
      const blob = new global.Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = global.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `inova-prompts-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 0);
      state.feedback = createFeedback("요청 보관함을 JSON 파일로 내보냈어요.");
      scheduleRender();
    }

    function scheduleTextInputRender() {
      if (state.textInputRenderTimer) {
        global.clearTimeout(state.textInputRenderTimer);
      }
      state.textInputRenderTimer = global.setTimeout(() => {
        state.textInputRenderTimer = 0;
        scheduleRender();
      }, 180);
    }

    async function ensureInitialized(panelState) {
      if (state.initialized || state.initializing) {
        if (panelState?.activeTool === "prompts" && state.activeTab === "library") {
          void ensurePromptLibraryLoaded(false, "activate");
        }
        return;
      }
      state.initializing = true;
      try {
        const storageState = await invokeRuntime({ action: "storage.get-state" });
        hydrateStorageState(storageState);
        state.initialized = true;
        if (panelState?.activeTool === "prompts" && state.activeTab === "library") {
          void ensurePromptLibraryLoaded(false, "bootstrap");
        }
      } catch (error) {
        state.lastError = readErrorMessage(error, "요청 보관함 상태를 준비하지 못했어요.");
        state.syncNotice = buildLoadNotice(state.lastError, getPromptCount());
      } finally {
        state.initializing = false;
        scheduleRender();
      }
    }

    async function ensurePromptLibraryLoaded(force) {
      if (state.loadPromise && !force) {
        return state.loadPromise;
      }
      const providerUserKey = normalizeText(state.providerIdentity?.providerUserKey);
      if (
        !force
        && state.promptLibraryRemoteReady
        && !state.lastError
        && providerUserKey
        && state.loadedProviderUserKey === providerUserKey
      ) {
        return state.promptLibrary;
      }
      if (!state.providerIdentity.available) {
        state.syncNotice = buildLoadNotice("사용자 정보를 확인하지 못했어요.", getPromptCount());
        scheduleRender();
        return state.promptLibrary;
      }
      const run = (async () => {
        state.loading = true;
        scheduleRender();
        try {
          const remote = await invokeRuntime({
            action: "functions.fetch",
            authMode: "access-token",
            body: {
              providerIdentity: {
                available: state.providerIdentity.available,
                displayName: state.providerIdentity.displayName,
                email: state.providerIdentity.email,
                numericUserId: state.providerIdentity.numericUserId,
                provider: state.providerIdentity.provider,
                providerUserKey: state.providerIdentity.providerUserKey,
              },
            },
            endpointKey: "loadInovaPromptLibraryUrl",
            service: "prompt",
          });
          state.promptLibrary = namespace.promptLibraryModel.mergePromptLibrary(remote?.promptLibrary);
          state.promptLibraryRemoteReady = true;
          state.loadedProviderUserKey = providerUserKey;
          state.lastError = "";
          if (!state.lastMutationError) {
            state.syncNotice = null;
          }
          return state.promptLibrary;
        } catch (error) {
          state.lastError = readErrorMessage(error, "요청 보관함을 불러오지 못했어요.");
          state.syncNotice = buildLoadNotice(state.lastError, getPromptCount());
          if (!force) {
            return state.promptLibrary;
          }
          throw error;
        } finally {
          state.loading = false;
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

    async function syncPromptLibrary(nextPromptLibrary, reason) {
      if (!state.providerIdentity.available) {
        throw new Error("사용자 정보를 확인하지 못했어요.");
      }
      state.syncing = true;
      state.lastMutationError = "";
      state.syncNotice = null;
      scheduleRender();
      try {
        const syncDocument = namespace.promptLibraryModel.buildReplaceSyncDocument(
          nextPromptLibrary,
          state.providerIdentity
        );
        syncDocument.sync.reason = normalizeText(reason) || "manual";
        await invokeRuntime({
          action: "functions.fetch",
          authMode: "access-token",
          body: syncDocument,
          endpointKey: "syncInovaPromptLibraryUrl",
          service: "prompt",
        });
        state.promptLibrary = namespace.promptLibraryModel.mergePromptLibrary(nextPromptLibrary);
        await ensurePromptLibraryLoaded(true, `${normalizeText(reason) || "manual"}-reload`);
      } catch (error) {
        state.lastMutationError = readErrorMessage(error, "클라우드 처리 중 문제가 생겼어요.");
        state.syncNotice = buildMutationNotice(state.lastMutationError);
        throw error;
      } finally {
        state.syncing = false;
        scheduleRender();
      }
    }

    async function persistActivePromptTab(promptTabId) {
      await invokeRuntime({
        action: "storage.update-ui-preferences",
        partial: {
          activePromptTab: normalizePromptTab(promptTabId),
          activeTool: "prompts",
        },
      }).catch(() => {});
    }

    function hydrateStorageState(storageState) {
      const cloudSync = storageState?.cloudSync && typeof storageState.cloudSync === "object"
        ? storageState.cloudSync
        : {};
      const providerIdentity = cloudSync.providerIdentity && typeof cloudSync.providerIdentity === "object"
        ? cloudSync.providerIdentity
        : {};
      const uiPreferences = storageState?.uiPreferences && typeof storageState.uiPreferences === "object"
        ? storageState.uiPreferences
        : {};
      const providerUserKey = normalizeText(providerIdentity.providerUserKey);
      if (state.loadedProviderUserKey && state.loadedProviderUserKey !== providerUserKey) {
        state.promptLibraryRemoteReady = false;
      }
      state.providerIdentity = {
        available: Boolean(providerIdentity.available),
        displayName: normalizeText(providerIdentity.displayName),
        email: normalizeText(providerIdentity.email),
        numericUserId: Number.isFinite(Number(providerIdentity.numericUserId))
          ? Number(providerIdentity.numericUserId)
          : null,
        provider: normalizeText(providerIdentity.provider || "inova") || "inova",
        providerUserKey,
      };
      if (!state.activeTabUserSelected) {
        state.activeTab = normalizePromptTab(uiPreferences.activePromptTab);
      }
    }

    function syncExternalReviewActivation(reviewState) {
      const pending = Boolean(reviewState?.pending);
      if (!pending) {
        state.reviewPendingAutofocused = false;
        return;
      }
      if (state.reviewPendingAutofocused) {
        return;
      }
      state.reviewPendingAutofocused = true;
      if (state.activeTab === "review") {
        return;
      }
      state.activeTab = "review";
      state.activeTabUserSelected = true;
      traceReview("71.hosted.review.autofocus", {
        pending: true,
        promptTab: "review",
        reason: "external-review-pending",
      });
      scheduleRender();
      void persistActivePromptTab("review");
    }

    function findPromptById(promptId) {
      const normalizedPromptId = normalizeText(promptId);
      return (state.promptLibrary?.items || []).find((item) => item.id === normalizedPromptId) || null;
    }

    function clearMenuState() {
      state.deletePromptId = "";
      state.menuPromptId = "";
      state.publishCategoryId = "";
      state.publishError = "";
      state.publishPromptId = "";
      state.publishTitle = "";
    }
  }

  function createEditor() {
    return {
      content: "",
      error: "",
      id: "",
      mode: "create",
      open: false,
      title: "",
    };
  }

  function normalizePromptTab(promptTabId) {
    const normalized = normalizeText(promptTabId);
    return normalized === "store" || normalized === "review"
      ? normalized
      : "library";
  }

  function normalizePublishCategoryId(categoryId) {
    const normalized = normalizeText(categoryId).toLowerCase();
    const categories = namespace.promptStoreModel?.getCategories?.() || [];
    return categories.some((category) => category.id === normalized)
      ? normalized
      : "document";
  }

  function getEffectiveActiveTab(promptTabId, reviewOpen) {
    const normalized = normalizePromptTab(promptTabId);
    return normalized === "review" && !reviewOpen
      ? "library"
      : normalized;
  }

  function buildPromptTabs(promptCount, storeCount, reviewOpen) {
    const tabs = [
      { count: promptCount, id: "library", label: "내 요청" },
      { count: storeCount, id: "store", label: "스토어" },
    ];
    if (reviewOpen) {
      tabs.push({ count: null, id: "review", label: "검토" });
    }
    return tabs;
  }

  function filterPromptItems(items, query) {
    const normalizedQuery = normalizeText(query).toLowerCase();
    if (!normalizedQuery) {
      return Array.isArray(items) ? items : [];
    }
    return (Array.isArray(items) ? items : []).filter((item) => `${item.title} ${item.content}`.toLowerCase().includes(normalizedQuery));
  }

  function buildLoadNotice(message, itemCount) {
    return {
      detail: normalizeText(message),
      message: itemCount > 0
        ? "클라우드 요청 보관함 상태 확인이 불안정해 마지막으로 불러온 요청을 그대로 보여주고 있어요."
        : "클라우드 요청 보관함을 아직 읽지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
  }

  function buildMutationNotice(message) {
    return {
      detail: normalizeText(message),
      message: "클라우드 요청 보관함 갱신이 실패했어요. 마지막으로 불러온 요청을 그대로 보여주고 있어요.",
    };
  }

  function createFeedback(message, tone = "info", promptId = "") {
    return {
      message: normalizeText(message),
      promptId: normalizeText(promptId),
      tone: tone === "error" ? "error" : "info",
    };
  }

  function readErrorMessage(error, fallbackMessage) {
    return normalizeText(error instanceof Error ? error.message : error) || normalizeText(fallbackMessage);
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  namespace.promptLibraryController = {
    create,
    REQUIRED_EXTENSION_CAPABILITIES,
  };
})(globalThis);
