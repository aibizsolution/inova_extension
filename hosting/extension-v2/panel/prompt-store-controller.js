(function initPromptStoreController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LOCAL_CACHE_LIMIT = 1000;
  const INITIAL_RENDER_COUNT = 20;
  const RENDER_BATCH_SIZE = 20;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const getActivePromptTab = typeof options.getActivePromptTab === "function"
      ? options.getActivePromptTab
      : () => "library";
    const getProviderIdentity = typeof options.getProviderIdentity === "function"
      ? options.getProviderIdentity
      : () => ({ available: false });
    const importStorePrompt = typeof options.importStorePrompt === "function"
      ? options.importStorePrompt
      : async () => false;
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};

    const viewedEntryIds = new Set();
    const state = {
      actionPending: null,
      appliedQuery: "",
      availableCategories: [{ id: "all", label: "전체" }],
      capabilities: [],
      categoryId: "all",
      dataFreshness: "fresh",
      deleteConfirmEntryId: "",
      detailPendingEntryId: "",
      error: "",
      expandedEntryId: "",
      feedback: null,
      feedbackTimer: 0,
      identityPending: false,
      items: [],
      loaded: false,
      loadedScope: "",
      loading: false,
      query: "",
      searchRenderTimerId: 0,
      renderKey: 0,
      renderLimit: INITIAL_RENDER_COUNT,
      scope: "all",
      sortBy: "latest",
      source: "none",
      totalCount: 0,
      updateSequence: 0,
    };

    return {
      buildViewState,
      ensureLoaded,
      getPublishCategories,
      getStoreCount,
      handleSearch,
      handleStoreAction,
      hasRequiredCapabilities,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      if (!hasRequiredCapabilities()) {
        return;
      }
      if (panelState?.activeTool === "prompts" && getActivePromptTab() === "store") {
        void ensureLoaded(false, "activate");
      }
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getStoreCount() {
      return Math.max(0, Number(state.totalCount) || state.items.length);
    }

    function getPublishCategories() {
      return buildAvailableCategories().filter((category) => category.id !== "all");
    }

    function buildViewState() {
      const appliedQuery = normalizeText(state.appliedQuery);
      const normalizedQuery = appliedQuery.toLowerCase();
      const categoryFilteredItems = namespace.promptStoreModel?.filterEntries?.(state.items, "", state.categoryId) || [];
      const sortedItems = namespace.promptStoreModel?.sortEntries?.(
        namespace.promptStoreModel?.filterEntries?.(state.items, normalizedQuery, state.categoryId) || [],
        state.sortBy
      ) || [];
      const renderedCount = Math.min(sortedItems.length, state.renderLimit);
      const providerUserKey = normalizeText(getProviderIdentity()?.providerUserKey);
      const emptyText = appliedQuery
        ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요."
        : state.scope === "mine"
          ? "내가 등록한 프롬프트가 아직 없어요."
          : "스토어에 등록된 프롬프트가 아직 없어요.";

      return {
        actionPending: state.actionPending,
        categories: buildAvailableCategories(),
        categoryId: state.categoryId,
        dataFreshness: normalizeEnum(state.dataFreshness, ["fresh", "stale", "empty"], "fresh"),
        degraded: state.dataFreshness === "stale" || state.dataFreshness === "empty",
        degradedReason: state.dataFreshness === "empty" ? "store-empty" : state.dataFreshness === "stale" ? "store-stale-cache" : "",
        deleteConfirmEntryId: state.deleteConfirmEntryId,
        detailPendingEntryId: state.detailPendingEntryId,
        emptyText,
        error: state.error,
        expandedEntryId: state.expandedEntryId,
        feedback: state.feedback,
        hasMore: sortedItems.length > renderedCount,
        identityPending: state.identityPending,
        items: sortedItems.slice(0, renderedCount),
        loaded: state.loaded,
        loadedCount: categoryFilteredItems.length,
        loading: state.loading,
        ownerScope: state.scope,
        providerUserKey,
        query: state.query,
        queryActive: Boolean(appliedQuery),
        queryDirty: normalizeText(state.query) !== appliedQuery,
        renderKey: state.renderKey,
        renderLimit: state.renderLimit,
        renderedCount,
        sortBy: state.sortBy,
        source: normalizeEnum(state.source, ["none", "runtime-read", "cache"], "none"),
        totalCount: appliedQuery ? sortedItems.length : categoryFilteredItems.length,
      };
    }

    function handleSearch(toolId, value, options = {}) {
      if (normalizeText(toolId) !== "store") {
        return false;
      }
      const nextQuery = String(value || "");
      if (state.query === nextQuery && !options.submit) {
        return true;
      }
      state.query = nextQuery;
      if (options.submit) {
        if (state.searchRenderTimerId) {
          global.clearTimeout(state.searchRenderTimerId);
          state.searchRenderTimerId = 0;
        }
        state.appliedQuery = normalizeText(value);
        resetWindow();
        if (!state.loaded) {
          void ensureLoaded(false, "search-submit");
        }
        scheduleRender();
        return true;
      }
      scheduleSearchRender();
      return true;
    }

    async function handleStoreAction(action, detail = {}) {
      const normalizedAction = normalizeText(action);
      if (!normalizedAction) {
        return false;
      }
      if (normalizedAction === "load-more") {
        loadMore();
        return true;
      }
      if (normalizedAction === "set-category") {
        setCategory(detail.categoryId);
        return true;
      }
      if (normalizedAction === "set-scope") {
        await setScope(detail.scope);
        return true;
      }
      if (normalizedAction === "set-sort") {
        setSort(detail.sortBy);
        return true;
      }
      if (normalizedAction === "toggle-expand") {
        await toggleExpand(detail.entryId);
        return true;
      }
      if (normalizedAction === "import") {
        await importEntry(detail.entryId);
        return true;
      }
      if (normalizedAction === "toggle-like") {
        await toggleLike(detail.entryId);
        return true;
      }
      if (normalizedAction === "request-unpublish") {
        requestUnpublish(detail.entryId);
        return true;
      }
      if (normalizedAction === "cancel-unpublish") {
        cancelUnpublish(detail.entryId);
        return true;
      }
      if (normalizedAction === "unpublish") {
        await unpublishEntry(detail.entryId);
        return true;
      }
      return false;
    }

    async function ensureLoaded(force = false, reason = "scheduled") {
      void reason;
      if (state.loading && !force) {
        return;
      }
      if (!force && state.loaded && state.loadedScope === state.scope) {
        return;
      }
      const providerIdentity = getProviderIdentity();
      if (!providerIdentity?.available) {
        state.identityPending = true;
        state.loaded = false;
        state.loading = false;
        state.error = "사용자 정보를 확인하는 중이에요.";
        scheduleRender();
        return;
      }
      const sequence = state.updateSequence + 1;
      state.updateSequence = sequence;
      state.loading = true;
      state.identityPending = false;
      scheduleRender();
      try {
        const result = await invokeRuntime({
          action: "functions.invoke-endpoint",
          authMode: "access-token",
          body: {
            filter: {
              categoryId: "all",
              limit: LOCAL_CACHE_LIMIT,
              ownerOnly: state.scope === "mine",
              query: "",
              sortBy: "latest",
            },
            providerIdentity,
          },
          endpointKey: "listPromptStoreEntriesUrl",
          service: "prompt",
        });
        if (sequence !== state.updateSequence) {
          return;
        }
        state.items = namespace.promptStoreModel?.normalizeStoreEntries?.(result?.items) || [];
        state.availableCategories = normalizeAvailableCategories(result?.availableCategories, state.categoryId);
        state.totalCount = Math.max(0, Number(result?.totalCount) || state.items.length);
        state.loaded = true;
        state.loadedScope = state.scope;
        state.loading = false;
        state.error = "";
        state.source = "runtime-read";
        state.dataFreshness = "fresh";
        if (state.categoryId !== "all" && !state.availableCategories.some((category) => category.id === state.categoryId)) {
          state.categoryId = "all";
        }
      } catch (error) {
        if (sequence !== state.updateSequence) {
          return;
        }
        state.loading = false;
        state.loaded = state.items.length > 0;
        state.error = getErrorMessage(error, "스토어를 불러오지 못했어요.");
        state.source = state.items.length > 0 ? "cache" : "none";
        state.dataFreshness = state.items.length > 0 ? "stale" : "empty";
      } finally {
        if (sequence === state.updateSequence) {
          scheduleRender();
        }
      }
    }

    function setCategory(categoryId) {
      const normalizedCategoryId = normalizeText(categoryId).toLowerCase();
      const nextCategoryId = buildAvailableCategories().some((category) => category.id === normalizedCategoryId)
        ? normalizedCategoryId
        : "all";
      if (state.categoryId === nextCategoryId) {
        return;
      }
      state.categoryId = nextCategoryId;
      clearTransientState();
      resetWindow();
      scheduleRender();
    }

    async function setScope(scope) {
      const nextScope = normalizeText(scope) === "mine" ? "mine" : "all";
      if (state.scope === nextScope && state.loaded) {
        return;
      }
      state.scope = nextScope;
      clearTransientState();
      resetWindow();
      state.loaded = false;
      scheduleRender();
      await ensureLoaded(true, "scope-change");
    }

    function setSort(sortBy) {
      const nextSort = ["latest", "likes", "imports", "views"].includes(sortBy) ? sortBy : "latest";
      if (state.sortBy === nextSort) {
        return;
      }
      state.sortBy = nextSort;
      resetWindow();
      scheduleRender();
    }

    async function toggleExpand(entryId) {
      const normalizedEntryId = normalizeText(entryId);
      if (!normalizedEntryId) {
        return;
      }
      const nextExpanded = state.expandedEntryId === normalizedEntryId ? "" : normalizedEntryId;
      state.expandedEntryId = nextExpanded;
      state.deleteConfirmEntryId = "";
      state.detailPendingEntryId = nextExpanded ? normalizedEntryId : "";
      scheduleRender();
      if (!nextExpanded) {
        return;
      }

      const entry = state.items.find((item) => item.entryId === normalizedEntryId);
      const shouldRefresh = !entry?.viewer?.viewed || !normalizeText(entry?.content) || !viewedEntryIds.has(normalizedEntryId);
      if (!shouldRefresh) {
        state.detailPendingEntryId = "";
        scheduleRender();
        return;
      }
      try {
        const result = await invokeRuntime({
          action: "functions.invoke-endpoint",
          authMode: "access-token",
          body: {
            entryId: normalizedEntryId,
            providerIdentity: getProviderIdentity(),
          },
          endpointKey: "recordPromptStoreViewUrl",
          service: "prompt",
        });
        mergeEntry(result?.entry, { viewed: true });
        viewedEntryIds.add(normalizedEntryId);
        state.error = "";
      } catch (error) {
        setFeedback(getErrorMessage(error, "상세 내용을 다시 불러와 주세요."), "error", normalizedEntryId);
      } finally {
        state.detailPendingEntryId = "";
        scheduleRender();
      }
    }

    async function importEntry(entryId) {
      const normalizedEntryId = normalizeText(entryId);
      if (!normalizedEntryId || isPending("import", normalizedEntryId)) {
        return;
      }
      state.actionPending = { entryId: normalizedEntryId, type: "import" };
      scheduleRender();
      try {
        const result = await invokeRuntime({
          action: "functions.invoke-endpoint",
          authMode: "access-token",
          body: {
            entryId: normalizedEntryId,
            providerIdentity: getProviderIdentity(),
          },
          endpointKey: "importPromptStoreEntryUrl",
          service: "prompt",
        });
        if (result?.entry) {
          await importStorePrompt(result.entry);
          mergeEntry(result.entry, { imported: true });
          setFeedback("스토어 프롬프트를 내 요청으로 가져왔어요.", "info", normalizedEntryId);
        }
      } catch (error) {
        setFeedback(getErrorMessage(error, "스토어 프롬프트를 가져오지 못했어요."), "error", normalizedEntryId);
      } finally {
        state.actionPending = null;
        scheduleRender();
      }
    }

    async function toggleLike(entryId) {
      const normalizedEntryId = normalizeText(entryId);
      if (!normalizedEntryId || isPending("like", normalizedEntryId)) {
        return;
      }
      state.actionPending = { entryId: normalizedEntryId, type: "like" };
      scheduleRender();
      try {
        const result = await invokeRuntime({
          action: "functions.invoke-endpoint",
          authMode: "access-token",
          body: {
            entryId: normalizedEntryId,
            providerIdentity: getProviderIdentity(),
          },
          endpointKey: "togglePromptStoreLikeUrl",
          service: "prompt",
        });
        if (result?.entry) {
          mergeEntry(result.entry, { liked: Boolean(result.entry?.viewer?.liked) });
          setFeedback(
            result.entry?.viewer?.liked ? "좋아요를 눌렀어요." : "좋아요를 취소했어요.",
            "info",
            normalizedEntryId
          );
        }
      } catch (error) {
        setFeedback(getErrorMessage(error, "좋아요를 바꾸지 못했어요."), "error", normalizedEntryId);
      } finally {
        state.actionPending = null;
        scheduleRender();
      }
    }

    function requestUnpublish(entryId) {
      const normalizedEntryId = normalizeText(entryId);
      if (!normalizedEntryId) {
        return;
      }
      state.deleteConfirmEntryId = state.deleteConfirmEntryId === normalizedEntryId ? "" : normalizedEntryId;
      scheduleRender();
    }

    function cancelUnpublish(entryId) {
      if (state.deleteConfirmEntryId !== normalizeText(entryId)) {
        return;
      }
      state.deleteConfirmEntryId = "";
      scheduleRender();
    }

    async function unpublishEntry(entryId) {
      const normalizedEntryId = normalizeText(entryId);
      if (!normalizedEntryId || isPending("unpublish", normalizedEntryId)) {
        return;
      }
      state.actionPending = { entryId: normalizedEntryId, type: "unpublish" };
      scheduleRender();
      try {
        await invokeRuntime({
          action: "functions.invoke-endpoint",
          authMode: "access-token",
          body: {
            entryId: normalizedEntryId,
            providerIdentity: getProviderIdentity(),
          },
          endpointKey: "unpublishPromptFromStoreUrl",
          service: "prompt",
        });
        state.deleteConfirmEntryId = "";
        state.expandedEntryId = state.expandedEntryId === normalizedEntryId ? "" : state.expandedEntryId;
        state.detailPendingEntryId = "";
        state.items = state.items.filter((item) => item.entryId !== normalizedEntryId);
        state.totalCount = Math.max(0, getStoreCount() - 1);
        setFeedback("스토어에서 내렸어요.", "info", normalizedEntryId);
        await ensureLoaded(true, "unpublish");
      } catch (error) {
        setFeedback(getErrorMessage(error, "스토어에서 내리지 못했어요."), "error", normalizedEntryId);
      } finally {
        state.actionPending = null;
        scheduleRender();
      }
    }

    function loadMore() {
      const viewState = buildViewState();
      if (!viewState.hasMore || state.loading) {
        return;
      }
      state.renderLimit += RENDER_BATCH_SIZE;
      scheduleRender();
    }

    function mergeEntry(entry, viewerPatch = null) {
      const normalized = namespace.promptStoreModel?.normalizeStoreEntry?.(entry);
      if (!normalized?.entryId) {
        return;
      }
      const previousIndex = state.items.findIndex((item) => item.entryId === normalized.entryId);
      const previous = previousIndex >= 0 ? state.items[previousIndex] : null;
      const nextItems = state.items.filter((item) => item.entryId !== normalized.entryId);
      const merged = !previous
        ? {
            ...normalized,
            viewer: { ...normalized.viewer, ...(viewerPatch || {}) },
          }
        : {
            ...previous,
            ...normalized,
            content: normalizeText(normalized.content) ? normalized.content : previous.content,
            hasDetail: Boolean(normalized.hasDetail || previous.hasDetail || normalized.content || previous.content),
            summary: normalizeText(normalized.summary) ? normalized.summary : previous.summary,
            viewer: { ...previous.viewer, ...normalized.viewer, ...(viewerPatch || {}) },
          };
      if (previousIndex >= 0 && previousIndex <= nextItems.length) {
        nextItems.splice(previousIndex, 0, merged);
      } else {
        nextItems.unshift(merged);
      }
      state.items = nextItems;
      state.loaded = true;
      state.totalCount = Math.max(state.totalCount, state.items.length);
      state.renderKey += 1;
    }

    function buildAvailableCategories() {
      const categories = Array.isArray(state.availableCategories) && state.availableCategories.length
        ? state.availableCategories
        : [{ id: "all", label: "전체" }];
      if (categories.some((category) => category.id === state.categoryId)) {
        return categories;
      }
      const fallbackLabel = namespace.promptStoreModel?.getCategoryLabel?.(state.categoryId) || "기타";
      return categories.concat([{ id: state.categoryId, label: fallbackLabel }]);
    }

    function normalizeAvailableCategories(categories, activeCategoryId) {
      const visible = Array.isArray(categories) ? categories : [];
      const normalizedVisible = visible
        .map((category) => {
          const id = normalizeText(category?.id).toLowerCase();
          if (!id) {
            return null;
          }
          return {
            id: id || "all",
            label: normalizeText(
              category?.label
              || namespace.promptStoreModel?.getCategoryLabel?.(id)
              || (id === "all" ? "전체" : "기타")
            ) || "전체",
          };
        })
        .filter(Boolean);
      const normalized = [{ id: "all", label: "전체" }, ...normalizedVisible.filter((category) => category.id !== "all")];
      if (activeCategoryId && !normalized.some((category) => category.id === activeCategoryId)) {
        normalized.push({
          id: activeCategoryId,
          label: namespace.promptStoreModel?.getCategoryLabel?.(activeCategoryId) || "기타",
        });
      }
      return normalized;
    }

    function clearTransientState() {
      state.deleteConfirmEntryId = "";
      state.detailPendingEntryId = "";
      state.expandedEntryId = "";
    }

    function resetWindow() {
      state.renderKey += 1;
      state.renderLimit = INITIAL_RENDER_COUNT;
    }

    function isPending(type, entryId) {
      return state.actionPending?.type === type && state.actionPending?.entryId === entryId;
    }

    function setFeedback(message, tone = "info", entryId = "") {
      global.clearTimeout(state.feedbackTimer);
      state.feedback = message ? { entryId, message, tone } : null;
      if (!message) {
        return;
      }
      state.feedbackTimer = global.setTimeout(() => {
        state.feedback = null;
        scheduleRender();
      }, 2600);
    }

    function scheduleSearchRender() {
      if (state.searchRenderTimerId) {
        global.clearTimeout(state.searchRenderTimerId);
      }
      state.searchRenderTimerId = global.setTimeout(() => {
        state.searchRenderTimerId = 0;
        scheduleRender();
      }, 180);
    }

    function normalizeText(value) {
      return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    }

    function normalizeEnum(value, allowed, fallback) {
      const normalized = normalizeText(value);
      return allowed.includes(normalized) ? normalized : fallback;
    }

    function getErrorMessage(error, fallback) {
      return normalizeText(error instanceof Error ? error.message : error) || fallback;
    }
  }

  namespace.promptStoreController = { create };
})(globalThis);
