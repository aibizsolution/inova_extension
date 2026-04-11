(function initStoreManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LOCAL_CACHE_LIMIT = 1000;
  const INITIAL_RENDER_COUNT = 20;
  const RENDER_BATCH_SIZE = 20;
  function create(state, hooks) {
    const viewedEntryIds = new Set();
    const derivedItemsCache = createDerivedItemsCache();
    let identityRetryTimer = 0;
    let loadSequence = 0;
    return {
      applyLatestRealtimeSnapshot,
      buildViewState,
      ensureLoaded,
      handleAction,
      handleQueryChange,
      markRealtimeFallback,
      publishPrompt,
      submitQuery,
      unpublishPrompt,
    };
    function buildViewState() {
      const providerIdentity = namespace.providerIdentity.getCurrent();
      const appliedQuery = getAppliedQuery();
      const derived = getDerivedStoreState(providerIdentity.providerUserKey, appliedQuery);
      const renderLimit = getRenderLimit();
      const renderedCount = Math.min(derived.items.length, renderLimit);
      const totalCount = hasActiveQuery() ? derived.items.length : derived.categoryFilteredCount;
      const emptyText = hasActiveQuery() ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요." : state.store.scope === "mine" ? "내가 등록한 프롬프트가 아직 없어요." : "스토어에 등록된 프롬프트가 아직 없어요.";
      return {
        categories: derived.categories,
        categoryId: state.store.categoryId,
        actionPending: state.store.actionPending,
        deleteConfirmEntryId: state.store.deleteConfirmEntryId,
        degraded: Boolean(state.store.degraded),
        degradedReason: namespace.session.normalizeText(state.store.degradedReason),
        dataFreshness: normalizeDataFreshness(state.store.dataFreshness),
        detailPendingEntryId: state.store.detailPendingEntryId || "",
        emptyText,
        error: state.store.error,
        expandedEntryId: state.store.expandedEntryId,
        feedback: state.store.feedback,
        hasMore: derived.items.length > renderedCount,
        identityPending: Boolean(state.store.identityPending),
        items: derived.items.slice(0, renderedCount),
        loadedCount: derived.categoryFilteredCount,
        loaded: state.store.loaded,
        loading: state.store.loading,
        ownerScope: state.store.scope,
        providerUserKey: providerIdentity.providerUserKey,
        queryActive: hasActiveQuery(),
        queryDirty: isQueryDirty(),
        query: state.queries.store,
        renderKey: Number(state.store.renderKey) || 0,
        renderedCount,
        renderLimit,
        sortBy: state.store.sortBy,
        source: normalizeReadSource(state.store.source),
        totalCount,
      };
    }

    async function ensureLoaded(force = false, reason = "scheduled", options = {}) {
      const fallbackErrorMessage = namespace.session.normalizeText(options.errorMessage);
      const fallbackDegradedReason = namespace.session.normalizeText(options.degradedReason) || "store-realtime-failed";
      if (state.store.loading && !force) return;
      if (!force && state.store.loaded) return;
      if (shouldDeferToRealtimeStoreLatest(reason)) {
        state.store.loading = !state.store.loaded;
        state.store.identityPending = false;
        if (typeof hooks.refreshStoreLatestRealtime === "function") {
          hooks.refreshStoreLatestRealtime(reason);
        }
        hooks.render();
        return;
      }
      if (shouldSkipScheduledAllStoreRead(force, reason)) {
        state.store.loaded = true;
        state.store.loading = false;
        state.store.identityPending = false;
        hooks.render();
        return;
      }
      if (shouldUseRealtimeStoreLatest() && reason !== "fallback") {
        state.store.loading = true;
        state.store.identityPending = false;
        hooks.render();
        if (force && typeof hooks.refreshStoreLatestRealtime === "function") {
          hooks.refreshStoreLatestRealtime(reason);
        }
        return;
      }
      const sequence = ++loadSequence;
      let reloadAll = false;
      state.store.loading = true;
      hooks.render();
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        if (!providerIdentity.available) {
          state.store.identityPending = true;
          state.store.loaded = false;
          scheduleIdentityRetry();
          return;
        }
        global.clearTimeout(identityRetryTimer);
        state.store.identityPending = false;
        const data = await sendRuntimeMessage("inova-store:list", {
          filter: {
            categoryId: "all",
            limit: LOCAL_CACHE_LIMIT,
            ownerOnly: false,
            query: "",
            sortBy: "latest",
          },
          providerIdentity,
        }, { reason });
        if (sequence !== loadSequence) return;
        state.store.items = namespace.promptStore.normalizeStoreEntries(data.items);
        state.store.availableCategories = normalizeAvailableCategories(data.availableCategories, state.store.categoryId);
        state.store.totalCount = Math.max(0, Number(data.totalCount) || state.store.items.length);
        preserveRenderWindow();
        if (state.store.categoryId !== "all" && !state.store.availableCategories.some((category) => category.id === state.store.categoryId)) {
          state.store.categoryId = "all";
          state.store.loaded = false;
          reloadAll = true;
        }
        state.store.hasMore = false;
        state.store.loaded = true;
        state.store.degraded = reason === "fallback";
        state.store.degradedReason = reason === "fallback" ? fallbackDegradedReason : "";
        state.store.dataFreshness = "fresh";
        state.store.source = "runtime-read";
        state.store.error = reason === "fallback"
          ? fallbackErrorMessage || state.store.error
          : "";
      } catch (error) {
        if (sequence !== loadSequence) return;
        state.store.error = buildStoreRuntimeErrorMessage(fallbackErrorMessage, error);
        state.store.hasMore = false;
        state.store.degraded = true;
        state.store.degradedReason = hasStoreRenderableData()
          ? "store-stale-cache"
          : reason === "fallback"
            ? "store-empty"
            : "store-read-failed";
        state.store.dataFreshness = hasStoreRenderableData() ? "stale" : "empty";
        state.store.source = hasStoreRenderableData() ? "cache" : "none";
      } finally {
        if (sequence === loadSequence) {
          state.store.loading = false;
          hooks.render();
          if (reloadAll) global.setTimeout(() => ensureLoaded(true, "reload-all"), 0);
        }
      }
    }

    function handleQueryChange(_value, options = {}) {
      global.clearTimeout(state.store.searchTimer);
      if (options?.composing) {
        return;
      }
    }

    function submitQuery(value) {
      global.clearTimeout(state.store.searchTimer);
      state.queries.store = namespace.session.normalizeText(value);
      state.store.deleteConfirmEntryId = "";
      state.store.detailPendingEntryId = "";
      state.store.expandedEntryId = "";
      state.store.appliedQuery = state.queries.store;
      resetWindow();
      hooks.render();
      if (!state.store.loaded) {
        ensureLoaded().catch((error) => {
          namespace.panelDebug?.log?.("store.query.load.error", {
            error: error instanceof Error ? error.message : String(error || ""),
          });
        });
      }
    }

    async function publishPrompt(promptId, categoryId, storeTitle) {
      const prompt = state.promptLibrary.items.find((item) => item.id === promptId);
      if (!prompt) return false;
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        await sendRuntimeMessage("inova-store:publish", {
          categoryId,
          prompt: {
            content: prompt.content,
            title: storeTitle || prompt.title,
          },
          providerIdentity,
        });
        if (shouldReloadAfterMutation()) {
          await ensureLoaded(true, "publish");
        }
        setFeedback("스토어에 별도 복사본으로 등록했어요.");
        hooks.render();
        return true;
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "스토어 등록에 실패했어요.", "error");
        hooks.render();
        return false;
      }
    }

    async function unpublishPrompt(entryId) {
      if (state.store.actionPending?.type === "unpublish" && state.store.actionPending.entryId === entryId) return false;
      state.store.actionPending = { type: "unpublish", entryId };
      hooks.render();
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        await sendRuntimeMessage("inova-store:unpublish", {
          entryId,
          providerIdentity,
        });
        state.store.deleteConfirmEntryId = "";
        state.store.expandedEntryId = state.store.expandedEntryId === entryId ? "" : state.store.expandedEntryId;
        if (shouldReloadAfterMutation()) {
          await ensureLoaded(true, "unpublish");
        }
        setFeedback("스토어에서 내렸어요.");
        hooks.render();
        return true;
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "스토어에서 내리지 못했어요.", "error", entryId);
        hooks.render();
        return false;
      } finally {
        state.store.actionPending = null;
      }
    }

    async function handleAction(action, detail = {}) {
      if (action === "load-more") return void loadMore();
      if (action === "set-category") return void setCategory(detail.categoryId);
      if (action === "set-scope") return void setScope(detail.scope);
      if (action === "set-sort") return void setSort(detail.sortBy);
      if (action === "toggle-expand") return void toggleExpand(detail.entryId);
      if (action === "import") return void importEntry(detail.entryId);
      if (action === "toggle-like") return void toggleLike(detail.entryId);
      if (action === "request-unpublish") return void requestUnpublish(detail.entryId);
      if (action === "cancel-unpublish") return void cancelUnpublish(detail.entryId);
      if (action === "unpublish") return void unpublishEntry(detail.entryId);
    }

    async function setCategory(categoryId) {
      const nextCategoryId = namespace.promptStore.getCategories().some((category) => category.id === categoryId) ? categoryId : "all";
      if (state.store.categoryId === nextCategoryId) {
        return;
      }
      applyLocalFilters(() => {
        state.store.categoryId = nextCategoryId;
      });
    }
    async function setScope(scope) { await updateFilters(() => { state.store.scope = scope === "mine" ? "mine" : "all"; }); }
    async function setSort(sortBy) {
      const nextSort = ["latest", "likes", "imports", "views"].includes(sortBy) ? sortBy : "latest";
      if (state.store.sortBy === nextSort) {
        return;
      }
      applyLocalFilters(() => {
        state.store.sortBy = nextSort;
      });
    }

    async function loadMore() {
      const providerUserKey = namespace.providerIdentity.getCurrent().providerUserKey;
      const appliedQuery = getAppliedQuery();
      const totalItems = getDerivedStoreState(providerUserKey, appliedQuery).items.length;
      const currentLimit = getRenderLimit();
      if (currentLimit >= totalItems) {
        return;
      }
      state.store.renderLimit = Math.min(totalItems, currentLimit + RENDER_BATCH_SIZE);
      hooks.render();
    }

    function applyLatestRealtimeSnapshot(payload) {
      const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : {};
      const totalPublished = Math.max(0, Number(summary.totalPublished) || 0);
      const categoryCounts = summary.categories && typeof summary.categories === "object" ? summary.categories : {};
      const realtimeItems = namespace.promptStore.normalizeStoreEntries(payload?.items);
      const previousItems = Array.isArray(state.store.items) ? state.store.items : [];
      const previousById = new Map(previousItems.map((item) => [item.entryId, item]));
      state.store.items = realtimeItems.map((item) => mergeNormalizedEntry(previousById.get(item.entryId), item));
      state.store.availableCategories = normalizeAvailableCategories(
        Object.keys(categoryCounts).map((categoryId) => ({ id: categoryId })),
        state.store.categoryId
      );
      state.store.totalCount = state.store.categoryId === "all"
        ? totalPublished
        : Math.max(0, Number(categoryCounts[state.store.categoryId]) || 0);
      preserveRenderWindow();
      state.store.hasMore = false;
      state.store.degraded = false;
      state.store.degradedReason = "";
      state.store.dataFreshness = "fresh";
      state.store.identityPending = false;
      state.store.error = "";
      state.store.loaded = true;
      state.store.loading = false;
      state.store.source = "realtime";
      hooks.render();
    }

    async function toggleExpand(entryId) {
      const previousEntry = state.store.items.find((item) => item.entryId === entryId);
      state.store.expandedEntryId = state.store.expandedEntryId === entryId ? "" : entryId;
      state.store.detailPendingEntryId = state.store.expandedEntryId ? entryId : "";
      hooks.render();
      if (!state.store.expandedEntryId) return;
      if (viewedEntryIds.has(entryId) && namespace.session.normalizeText(previousEntry?.content)) return;
      try {
        const detail = typeof hooks.loadStoreDetail === "function"
          ? await hooks.loadStoreDetail(entryId)
          : null;
        state.store.detailPendingEntryId = "";
        if (previousEntry && namespace.session.normalizeText(detail?.content)) {
          viewedEntryIds.add(entryId);
          mergeEntry({
            ...previousEntry,
            content: detail.content,
            hasDetail: true,
            updatedAt: namespace.session.normalizeText(detail.updatedAt) || previousEntry.updatedAt,
          });
        }
        hooks.render();
      } catch (error) {
        state.store.detailPendingEntryId = "";
        setFeedback("상세 내용을 다시 불러와 주세요.", "error", entryId);
        namespace.panelDebug?.log?.("store.detail.error", {
          entryId,
          error: error instanceof Error ? error.message : String(error || ""),
          scope: "runtime",
          tool: "prompts",
        });
        hooks.render();
      }
    }

    function markRealtimeFallback(error) {
      const message = error instanceof Error ? error.message : "스토어 최신 목록을 실시간으로 불러오지 못했어요.";
      const hasRenderableData = hasStoreRenderableData();
      state.store.degraded = true;
      state.store.degradedReason = hasRenderableData ? "store-stale-cache" : "store-empty";
      state.store.dataFreshness = hasRenderableData ? "stale" : "empty";
      state.store.error = message;
      state.store.loaded = hasRenderableData;
      state.store.loading = false;
      state.store.source = hasRenderableData ? "cache" : "none";
      hooks.render();
      return hasRenderableData;
    }

    function buildStoreRuntimeErrorMessage(primaryMessage, secondaryError) {
      const fallbackMessage = namespace.session.normalizeText(primaryMessage);
      const runtimeMessage = namespace.session.normalizeText(
        secondaryError instanceof Error ? secondaryError.message : String(secondaryError || "")
      ) || "스토어를 불러오지 못했어요.";
      if (!fallbackMessage || fallbackMessage === runtimeMessage) {
        return runtimeMessage;
      }
      return `${fallbackMessage} 추가 읽기에도 실패했어요: ${runtimeMessage}`;
    }

    async function importEntry(entryId) {
      if (state.store.actionPending?.type === "import" && state.store.actionPending.entryId === entryId) return;
      state.store.actionPending = { type: "import", entryId };
      hooks.render();
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        const result = await sendRuntimeMessage("inova-store:import", { entryId, providerIdentity });
        if (result.entry) {
          state.promptLibrary = await namespace.storage.importStorePrompt(result.entry);
          mergeEntry(result.entry, { imported: true });
          setFeedback("스토어 프롬프트를 내 요청으로 가져왔어요.", "info", entryId);
          hooks.render();
        }
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "스토어 프롬프트를 가져오지 못했어요.", "error", entryId);
        hooks.render();
      } finally {
        state.store.actionPending = null;
      }
    }

    async function toggleLike(entryId) {
      if (state.store.actionPending?.type === "like" && state.store.actionPending.entryId === entryId) return;
      state.store.actionPending = { type: "like", entryId };
      hooks.render();
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        const result = await sendRuntimeMessage("inova-store:toggle-like", { entryId, providerIdentity });
        if (result.entry) {
          mergeEntry(result.entry, { liked: Boolean(result.entry.viewer?.liked) });
          setFeedback(result.entry.viewer?.liked ? "좋아요를 눌렀어요." : "좋아요를 취소했어요.", "info", entryId);
          hooks.render();
        }
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "좋아요를 바꾸지 못했어요.", "error", entryId);
        hooks.render();
      } finally {
        state.store.actionPending = null;
      }
    }

    function requestUnpublish(entryId) { if (!entryId) return; state.store.deleteConfirmEntryId = state.store.deleteConfirmEntryId === entryId ? "" : entryId; hooks.render(); }
    function cancelUnpublish(entryId) { if (!state.store.deleteConfirmEntryId || state.store.deleteConfirmEntryId !== entryId) return; state.store.deleteConfirmEntryId = ""; hooks.render(); }
    async function unpublishEntry(entryId) {
      const entry = state.store.items.find((item) => item.entryId === entryId);
      if (!entry) return;
      await unpublishPrompt(entry.entryId);
    }
    function mergeEntry(entry, viewerPatch = null) {
      const normalized = namespace.promptStore.normalizeStoreEntry(entry);
      const previousIndex = state.store.items.findIndex((item) => item.entryId === normalized.entryId);
      const previous = previousIndex >= 0 ? state.store.items[previousIndex] : null;
      const nextItems = state.store.items.filter((item) => item.entryId !== normalized.entryId);
      const merged = mergeNormalizedEntry(previous, normalized, viewerPatch);
      if (previousIndex >= 0 && previousIndex <= nextItems.length) {
        nextItems.splice(previousIndex, 0, merged);
      } else {
        nextItems.unshift(merged);
      }
      state.store.items = nextItems;
      state.store.loaded = true;
      preserveRenderWindow();
    }

    function mergeNormalizedEntry(previous, normalized, viewerPatch = null) {
      if (!previous) {
        return {
          ...normalized,
          viewer: { ...normalized.viewer, ...(viewerPatch || {}) },
        };
      }
      return {
        ...previous,
        ...normalized,
        content: namespace.session.normalizeText(normalized.content) ? normalized.content : previous.content,
        hasDetail: Boolean(normalized.hasDetail || previous.hasDetail || normalized.content || previous.content),
        owner: normalized.owner,
        metrics: normalized.metrics,
        summary: namespace.session.normalizeText(normalized.summary) ? normalized.summary : previous.summary,
        viewer: { ...previous.viewer, ...normalized.viewer, ...(viewerPatch || {}) },
      };
    }

    function setFeedback(message, tone = "info", entryId = "") {
      global.clearTimeout(state.store.feedbackTimer);
      state.store.feedback = message ? { entryId, message, tone } : null;
      if (!message) return;
      state.store.feedbackTimer = global.setTimeout(() => {
        state.store.feedback = null;
        hooks.render();
      }, 2600);
    }
    function scheduleIdentityRetry() {
      global.clearTimeout(identityRetryTimer);
      identityRetryTimer = global.setTimeout(() => ensureLoaded(true, "identity-retry"), 900);
    }
    async function updateFilters(apply) {
      const previousScope = state.store.scope;
      state.store.deleteConfirmEntryId = "";
      state.store.detailPendingEntryId = "";
      state.store.expandedEntryId = "";
      apply();
      resetWindow();
      if (state.store.scope === "all" && previousScope !== "all" && shouldUseRealtimeStoreLatest()) {
        state.store.loaded = false;
      }
      hooks.render();
      if (state.store.scope === "mine" && state.store.loaded) {
        return;
      }
      if (state.store.scope !== "all") {
        await ensureLoaded(true);
        return;
      }
      await ensureLoaded(false);
    }
    function hasActiveQuery() { return Boolean(getAppliedQuery()); }
    function getAppliedQuery() { return namespace.session.normalizeText(state.store.appliedQuery); }
    function getNormalizedInputQuery() { return namespace.session.normalizeText(state.queries.store); }
    function isQueryDirty() { return getNormalizedInputQuery() !== getAppliedQuery(); }
    function hasStoreRenderableData() {
      const scopedItems = getScopedStoreItems(namespace.providerIdentity.getCurrent().providerUserKey);
      return Boolean(
        Array.isArray(scopedItems) && scopedItems.length
        || Math.max(0, Number(state.store.totalCount) || 0) > 0
      );
    }
    function normalizeAvailableCategories(categories, activeCategoryId) {
      const allCategories = namespace.promptStore.getCategories();
      const available = Array.isArray(categories) ? categories : [];
      const visible = available
        .map((category) => allCategories.find((item) => item.id === namespace.session.normalizeText(category?.id).toLowerCase()))
        .filter((category, index, list) => category && category.id !== "all" && list.findIndex((item) => item?.id === category.id) === index);
      const active = allCategories.find((category) => category.id === namespace.session.normalizeText(activeCategoryId).toLowerCase());
      return [{ id: "all", label: "전체" }, ...visible, ...(active && active.id !== "all" && !visible.some((category) => category.id === active.id) ? [active] : [])];
    }
    function resetWindow() {
      state.store.limit = LOCAL_CACHE_LIMIT;
      state.store.hasMore = false;
      state.store.renderLimit = INITIAL_RENDER_COUNT;
      state.store.renderKey = (Number(state.store.renderKey) || 0) + 1;
    }
    function applyLocalFilters(apply) {
      state.store.deleteConfirmEntryId = "";
      state.store.detailPendingEntryId = "";
      state.store.expandedEntryId = "";
      apply();
      resetWindow();
      hooks.render();
      if (!state.store.loaded) {
        global.clearTimeout(state.store.searchTimer);
        state.store.searchTimer = global.setTimeout(() => ensureLoaded(), 0);
      }
    }

    function getScopedStoreItems(providerUserKey) {
      const items = Array.isArray(state.store.items) ? state.store.items : [];
      if (state.store.scope !== "mine") {
        return items;
      }
      const normalizedProviderUserKey = namespace.session.normalizeText(providerUserKey);
      if (!normalizedProviderUserKey) {
        return [];
      }
      return items.filter((item) => namespace.session.normalizeText(item?.owner?.providerUserKey) === normalizedProviderUserKey);
    }

    function getDerivedStoreState(providerUserKey, appliedQuery) {
      const itemsRef = Array.isArray(state.store.items) ? state.store.items : [];
      const availableCategoriesRef = Array.isArray(state.store.availableCategories) ? state.store.availableCategories : [];
      const normalizedProviderUserKey = namespace.session.normalizeText(providerUserKey);
      const normalizedQuery = namespace.session.normalizeText(appliedQuery).toLowerCase();
      const cacheHit = derivedItemsCache.itemsRef === itemsRef
        && derivedItemsCache.availableCategoriesRef === availableCategoriesRef
        && derivedItemsCache.providerUserKey === normalizedProviderUserKey
        && derivedItemsCache.scope === state.store.scope
        && derivedItemsCache.categoryId === state.store.categoryId
        && derivedItemsCache.sortBy === state.store.sortBy
        && derivedItemsCache.query === normalizedQuery;
      if (cacheHit) {
        return derivedItemsCache.result;
      }
      const scopedItems = getScopedStoreItems(normalizedProviderUserKey);
      const categoryFiltered = filterByCategory(scopedItems, state.store.categoryId);
      const filteredItems = filterByQuery(categoryFiltered, normalizedQuery);
      const result = {
        categories: buildAvailableCategories(scopedItems, availableCategoriesRef),
        categoryFilteredCount: categoryFiltered.length,
        items: sortStoreItems(filteredItems, state.store.sortBy),
      };
      derivedItemsCache.itemsRef = itemsRef;
      derivedItemsCache.availableCategoriesRef = availableCategoriesRef;
      derivedItemsCache.providerUserKey = normalizedProviderUserKey;
      derivedItemsCache.scope = state.store.scope;
      derivedItemsCache.categoryId = state.store.categoryId;
      derivedItemsCache.sortBy = state.store.sortBy;
      derivedItemsCache.query = normalizedQuery;
      derivedItemsCache.result = result;
      return result;
    }

    function filterByCategory(items, categoryId) {
      const normalizedCategoryId = normalizeCategoryId(categoryId);
      if (normalizedCategoryId === "all") {
        return items;
      }
      return items.filter((item) => namespace.session.normalizeText(item?.categoryId).toLowerCase() === normalizedCategoryId);
    }

    function filterByQuery(items, normalizedQuery) {
      if (!normalizedQuery) {
        return items;
      }
      return items.filter((item) => `${item.title} ${item.summary} ${item.content} ${item.owner.displayName}`.toLowerCase().includes(normalizedQuery));
    }

    function sortStoreItems(items, sortBy) {
      return items.slice().sort((left, right) => compareStoreEntries(left, right, sortBy));
    }

    function compareStoreEntries(left, right, sortBy) {
      if (sortBy === "likes") {
        return compareNumber(right.metrics.likeCount, left.metrics.likeCount)
          || compareNumber(right.metrics.importCount, left.metrics.importCount)
          || compareDate(right.publishedAt, left.publishedAt);
      }
      if (sortBy === "imports") {
        return compareNumber(right.metrics.importCount, left.metrics.importCount)
          || compareNumber(right.metrics.likeCount, left.metrics.likeCount)
          || compareDate(right.publishedAt, left.publishedAt);
      }
      if (sortBy === "views") {
        return compareNumber(right.metrics.viewCount, left.metrics.viewCount)
          || compareDate(right.publishedAt, left.publishedAt);
      }
      return compareDate(right.publishedAt, left.publishedAt) || compareNumber(right.score, left.score);
    }

    function compareNumber(left, right) {
      return Number(left || 0) - Number(right || 0);
    }

    function compareDate(left, right) {
      return Date.parse(left || "") - Date.parse(right || "");
    }

    function buildAvailableCategories(scopedItems, fallbackCategories) {
      const itemCategories = Array.isArray(scopedItems)
        ? Array.from(new Set(scopedItems.map((item) => namespace.session.normalizeText(item?.categoryId).toLowerCase()).filter(Boolean)))
          .map((categoryId) => ({ id: categoryId }))
        : [];
      if (state.store.scope === "mine") {
        return normalizeAvailableCategories(itemCategories, state.store.categoryId);
      }
      return normalizeAvailableCategories(itemCategories.length ? itemCategories : fallbackCategories, state.store.categoryId);
    }

    function normalizeCategoryId(categoryId) {
      const normalized = namespace.session.normalizeText(categoryId).toLowerCase();
      return normalized === "all" || namespace.promptStore.getCategories().some((category) => category.id === normalized)
        ? normalized
        : "other";
    }

    function getRenderLimit() {
      return Math.max(INITIAL_RENDER_COUNT, Number(state.store.renderLimit) || INITIAL_RENDER_COUNT);
    }

    function preserveRenderWindow() {
      state.store.renderLimit = getRenderLimit();
    }

    function createDerivedItemsCache() {
      return {
        availableCategoriesRef: null,
        categoryId: "",
        itemsRef: null,
        providerUserKey: "",
        query: "",
        result: null,
        scope: "",
        sortBy: "",
      };
    }

    function shouldReloadAfterMutation() {
      if (typeof hooks.shouldReloadAfterMutation === "function") {
        return Boolean(hooks.shouldReloadAfterMutation());
      }
      return true;
    }

    function normalizeDataFreshness(value) {
      const normalized = namespace.session.normalizeText(value).toLowerCase();
      return normalized === "fresh" || normalized === "stale" || normalized === "empty"
        ? normalized
        : "empty";
    }

    function normalizeReadSource(value) {
      const normalized = namespace.session.normalizeText(value).toLowerCase();
      return normalized === "realtime"
        || normalized === "runtime-read"
        || normalized === "cache"
        || normalized === "local"
        || normalized === "none"
        ? normalized
        : "none";
    }

    function shouldSkipScheduledAllStoreRead(force, reason) {
      if (force || reason !== "scheduled" || state.store.scope !== "all") {
        return false;
      }
      return Boolean(
        Array.isArray(state.store.items) && state.store.items.length
        || Math.max(0, Number(state.store.totalCount) || 0) > 0
      );
    }

    function shouldDeferToRealtimeStoreLatest(reason) {
      if (state.store.scope !== "all") {
        return false;
      }
      return reason === "scheduled";
    }

    function shouldUseRealtimeStoreLatest() {
      return Boolean(
        state.store.scope === "all"
        && typeof hooks.shouldUseStoreLatestRealtime === "function"
        && hooks.shouldUseStoreLatestRealtime()
      );
    }

    async function sendRuntimeMessage(type, payload, options = {}) {
      const operation = classifyStoreRuntimeOperation(type);
      const backend = "firebase-function";
      const reason = namespace.session.normalizeText(options?.reason);
      namespace.panelDebug?.log?.("store.runtime.request", {
        backend,
        operation,
        reason,
        scope: "runtime",
        tool: "prompts",
        type,
      });
      try {
        const response = await chrome.runtime.sendMessage({ type, ...(payload || {}) });
        if (!response?.ok) {
          throw new Error(namespace.session.normalizeText(response?.error || "") || "스토어 요청을 처리하지 못했어요.");
        }
        namespace.panelDebug?.log?.("store.runtime.success", {
          backend,
          operation,
          reason,
          scope: "runtime",
          tool: "prompts",
          type,
        });
        return response.data;
      } catch (error) {
        namespace.panelDebug?.log?.("store.runtime.error", {
          backend,
          error: error instanceof Error ? error.message : String(error || ""),
          operation,
          reason,
          scope: "runtime",
          tool: "prompts",
          type,
        });
        throw error;
      }
    }
    function classifyStoreRuntimeOperation(type) {
      const normalized = namespace.session.normalizeText(type);
      if (normalized === "inova-store:list" || normalized === "inova-store:view") {
        return "read";
      }
      if (normalized === "inova-store:publish" || normalized === "inova-store:unpublish" || normalized === "inova-store:import" || normalized === "inova-store:toggle-like") {
        return "write";
      }
      return "";
    }
  }

  namespace.storeManager = {
    create,
  };
})(globalThis);
