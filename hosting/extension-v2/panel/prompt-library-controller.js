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
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};

    const state = {
      actionPending: null,
      activeTab: "library",
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

    function buildPromptToolState(fallbackPromptTool = {}) {
      const promptCount = getPromptCount();
      const storeCount = Math.max(
        0,
        Number(fallbackPromptTool?.tabs?.find?.((tab) => tab.id === "store")?.count)
          || Number(fallbackPromptTool?.store?.totalCount)
          || 0
      );
      return {
        activeTab: state.activeTab,
        prompt: buildPromptViewState(),
        reviewPlaceholder: {
          body: "검토 탭의 hosted ownership은 다음 단계에서 이동합니다.",
          title: "검토 이동 준비 중",
        },
        storePlaceholder: {
          body: "스토어 탭의 hosted ownership은 다음 단계에서 이동합니다.",
          title: "스토어 이동 준비 중",
        },
        tabs: [
          { count: promptCount, id: "library", label: "내 요청" },
          { count: storeCount, id: "store", label: "스토어" },
          { count: null, id: "review", label: "검토" },
        ],
      };
    }

    function buildPromptViewState() {
      const items = filterPromptItems(state.promptLibrary?.items || [], state.query);
      return {
        actionPending: state.actionPending,
        deletePromptId: state.deletePromptId,
        editor: state.editor,
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
        storeCategories: [],
        syncNotice: state.syncNotice,
        totalCount: getPromptCount(),
      };
    }

    function handleSearch(toolId, value) {
      if (normalizeText(toolId) !== "prompts") {
        return false;
      }
      state.query = String(value || "");
      scheduleRender();
      return true;
    }

    async function handleSelectPromptTab(promptTabId) {
      const nextTab = normalizePromptTab(promptTabId);
      state.activeTab = nextTab;
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
      state.editor = {
        ...state.editor,
        [key]: String(value || ""),
        error: "",
      };
      scheduleRender();
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
      if (
        normalizedAction === "open-publish"
        || normalizedAction === "cancel-publish"
        || normalizedAction === "set-publish-category"
        || normalizedAction === "set-publish-title"
        || normalizedAction === "confirm-publish"
      ) {
        state.feedback = createFeedback("스토어 등록은 다음 단계에서 hosted ownership으로 이동합니다.", "error");
        scheduleRender();
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
      state.activeTab = normalizePromptTab(uiPreferences.activePromptTab);
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
