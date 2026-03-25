(function initStoreManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PAGE_SIZE = 500;
  const SEARCH_LIMIT = 500;
  function create(state, hooks) {
    const viewedEntryIds = new Set();
    let identityRetryTimer = 0;
    let loadSequence = 0;
    return { buildViewState, ensureLoaded, handleQueryChange, publishPrompt, unpublishPrompt, handleAction };
    function buildViewState() {
      const filtered = namespace.promptStore.filterEntries(state.store.items, state.queries.store, state.store.categoryId);
      const items = namespace.promptStore.sortEntries(filtered, state.store.sortBy);
      const providerUserKey = namespace.providerIdentity.getCurrent().providerUserKey;
      const totalCount = hasActiveQuery() ? items.length : Math.max(0, Number(state.store.totalCount) || state.store.items.length);
      const emptyText = state.queries.store ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요." : state.store.scope === "mine" ? "내가 등록한 프롬프트가 아직 없어요." : "스토어에 등록된 프롬프트가 아직 없어요.";
      return {
        categories: getAvailableCategories(),
        categoryId: state.store.categoryId,
        actionPending: state.store.actionPending,
        deleteConfirmEntryId: state.store.deleteConfirmEntryId,
        detailPendingEntryId: state.store.detailPendingEntryId || "",
        emptyText,
        error: state.store.error,
        expandedEntryId: state.store.expandedEntryId,
        feedback: state.store.feedback,
        hasMore: Boolean(state.store.hasMore) && !hasActiveQuery(),
        identityPending: Boolean(state.store.identityPending),
        items,
        loadedCount: state.store.items.length,
        loaded: state.store.loaded,
        loading: state.store.loading,
        ownerScope: state.store.scope,
        providerUserKey,
        query: state.queries.store,
        sortBy: state.store.sortBy,
        totalCount,
      };
    }

    async function ensureLoaded(force = false) {
      if (state.store.loading && !force) return;
      if (!force && state.store.loaded) return;
      const sequence = ++loadSequence;
      const limit = getRequestLimit();
      let reloadAll = false;
      state.store.loading = true;
      state.store.error = "";
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
            categoryId: state.store.categoryId,
            limit,
            ownerOnly: state.store.scope === "mine",
            query: state.queries.store,
            sortBy: state.store.sortBy,
          },
          providerIdentity,
        });
        if (sequence !== loadSequence) return;
        state.store.items = namespace.promptStore.normalizeStoreEntries(data.items);
        state.store.availableCategories = normalizeAvailableCategories(data.availableCategories, state.store.categoryId);
        state.store.totalCount = Math.max(0, Number(data.totalCount) || state.store.items.length);
        if (state.store.categoryId !== "all" && !state.store.availableCategories.some((category) => category.id === state.store.categoryId)) {
          state.store.categoryId = "all";
          state.store.loaded = false;
          reloadAll = true;
        }
        state.store.hasMore = Boolean(data.hasMore) && !hasActiveQuery();
        state.store.loaded = true;
      } catch (error) {
        if (sequence !== loadSequence) return;
        state.store.error = error instanceof Error ? error.message : "스토어를 불러오지 못했어요.";
        state.store.hasMore = false;
      } finally {
        if (sequence !== loadSequence) return;
        state.store.loading = false;
        hooks.render();
        if (reloadAll) global.setTimeout(() => ensureLoaded(true), 0);
      }
    }

    function handleQueryChange() {
      global.clearTimeout(state.store.searchTimer);
      state.store.limit = PAGE_SIZE;
      state.store.hasMore = false;
      hooks.render();
      if (!hasActiveQuery()) {
        state.store.searchTimer = global.setTimeout(() => ensureLoaded(true), 0);
        return;
      }
      if (!shouldRemoteSearch()) return;
      state.store.searchTimer = global.setTimeout(() => ensureLoaded(true), 320);
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
        await ensureLoaded(true);
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
        await ensureLoaded(true);
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
      if (action === "refresh") return void ensureLoaded(true);
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

    async function setCategory(categoryId) { await updateFilters(() => { state.store.categoryId = namespace.promptStore.getCategories().some((category) => category.id === categoryId) ? categoryId : "all"; }); }
    async function setScope(scope) { await updateFilters(() => { state.store.scope = scope === "mine" ? "mine" : "all"; }); }
    async function setSort(sortBy) { await updateFilters(() => { state.store.sortBy = ["latest", "likes", "imports", "views"].includes(sortBy) ? sortBy : "latest"; }); }

    async function loadMore() {
      if (state.store.loading || !state.store.hasMore || hasActiveQuery()) return;
      state.store.limit += PAGE_SIZE;
      await ensureLoaded(true);
    }

    async function toggleExpand(entryId) {
      const previousEntry = state.store.items.find((item) => item.entryId === entryId);
      state.store.expandedEntryId = state.store.expandedEntryId === entryId ? "" : entryId;
      state.store.detailPendingEntryId = state.store.expandedEntryId ? entryId : "";
      hooks.render();
      if (!state.store.expandedEntryId || viewedEntryIds.has(entryId)) return;

      viewedEntryIds.add(entryId);
      if (previousEntry) mergeEntry({ ...previousEntry, metrics: { ...previousEntry.metrics, viewCount: previousEntry.metrics.viewCount + 1 } }, { viewed: true });
      hooks.render();
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        const result = await sendRuntimeMessage("inova-store:view", { entryId, providerIdentity });
        if (result.entry) {
          const nextEntry = previousEntry && Number(result.entry?.metrics?.viewCount) < previousEntry.metrics.viewCount + 1
            ? { ...result.entry, metrics: { ...result.entry.metrics, viewCount: previousEntry.metrics.viewCount + 1 } }
            : result.entry;
          state.store.detailPendingEntryId = "";
          mergeEntry(nextEntry, { viewed: true });
          hooks.render();
        }
      } catch {
        viewedEntryIds.delete(entryId);
        state.store.detailPendingEntryId = "";
        if (previousEntry) mergeEntry(previousEntry);
        hooks.render();
      }
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
      const previous = state.store.items.find((item) => item.entryId === normalized.entryId);
      const nextItems = state.store.items.filter((item) => item.entryId !== normalized.entryId);
      const merged = previous ? { ...previous, ...normalized, metrics: normalized.metrics, owner: normalized.owner, viewer: { ...previous.viewer, ...normalized.viewer, ...(viewerPatch || {}) } } : normalized;
      nextItems.unshift(merged);
      state.store.items = nextItems;
      state.store.loaded = true;
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
      identityRetryTimer = global.setTimeout(() => ensureLoaded(true), 900);
    }
    async function updateFilters(apply) {
      state.store.deleteConfirmEntryId = "";
      state.store.detailPendingEntryId = "";
      state.store.expandedEntryId = "";
      apply();
      resetWindow();
      hooks.render();
      await ensureLoaded(true);
    }
    function getRequestLimit() {
      return shouldRemoteSearch() ? SEARCH_LIMIT : Math.max(PAGE_SIZE, Number(state.store.limit) || PAGE_SIZE);
    }
    function hasActiveQuery() { return Boolean(namespace.session.normalizeText(state.queries.store)); }
    function shouldRemoteSearch() { return namespace.session.normalizeText(state.queries.store).length >= 2; }
    function getAvailableCategories() { return normalizeAvailableCategories(state.store.availableCategories, state.store.categoryId); }
    function normalizeAvailableCategories(categories, activeCategoryId) {
      const allCategories = namespace.promptStore.getCategories();
      const available = Array.isArray(categories) ? categories : [];
      const visible = available
        .map((category) => allCategories.find((item) => item.id === namespace.session.normalizeText(category?.id).toLowerCase()))
        .filter((category, index, list) => category && category.id !== "all" && list.findIndex((item) => item?.id === category.id) === index);
      const active = allCategories.find((category) => category.id === namespace.session.normalizeText(activeCategoryId).toLowerCase());
      return [{ id: "all", label: "전체" }, ...visible, ...(active && active.id !== "all" && !visible.some((category) => category.id === active.id) ? [active] : [])];
    }
    function resetWindow() { state.store.limit = PAGE_SIZE; state.store.hasMore = false; }
    async function sendRuntimeMessage(type, payload) {
      const response = await chrome.runtime.sendMessage({ type, ...(payload || {}) });
      if (!response?.ok) {
        throw new Error(namespace.session.normalizeText(response?.error || "") || "스토어 요청을 처리하지 못했어요.");
      }
      return response.data;
    }
  }

  namespace.storeManager = {
    create,
  };
})(globalThis);
