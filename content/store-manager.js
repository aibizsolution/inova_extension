(function initStoreManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LIST_LIMIT = 60;

  function create(state, hooks) {
    const viewedEntryIds = new Set();
    let identityRetryTimer = 0;
    let loadSequence = 0;

    return {
      buildViewState,
      ensureLoaded,
      publishPrompt,
      unpublishPrompt,
      handleAction,
    };

    function buildViewState() {
      const filtered = namespace.promptStore.filterEntries(state.store.items, state.queries.store, state.store.categoryId);
      const items = namespace.promptStore.sortEntries(filtered, state.store.sortBy);
      const providerUserKey = namespace.providerIdentity.getCurrent().providerUserKey;
      return {
        categories: namespace.promptStore.getCategories(),
        categoryId: state.store.categoryId,
        actionPending: state.store.actionPending,
        deleteConfirmEntryId: state.store.deleteConfirmEntryId,
        emptyText: state.queries.store
          ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요."
          : state.store.scope === "mine"
            ? "내가 등록한 프롬프트가 아직 없어요."
            : "스토어에 등록된 프롬프트가 아직 없어요.",
        error: state.store.error,
        expandedEntryId: state.store.expandedEntryId,
        feedback: state.store.feedback,
        identityPending: Boolean(state.store.identityPending),
        items,
        loaded: state.store.loaded,
        loading: state.store.loading,
        ownerScope: state.store.scope,
        providerUserKey,
        query: state.queries.store,
        sortBy: state.store.sortBy,
        totalCount: items.length,
      };
    }

    async function ensureLoaded(force = false) {
      if (state.store.loading && !force) return;
      if (!force && state.store.loaded) return;

      const sequence = ++loadSequence;
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
            limit: LIST_LIMIT,
            ownerOnly: state.store.scope === "mine",
            query: state.queries.store,
            sortBy: state.store.sortBy,
          },
          providerIdentity,
        });
        if (sequence !== loadSequence) return;
        state.store.items = namespace.promptStore.normalizeStoreEntries(data.items);
        state.store.loaded = true;
      } catch (error) {
        if (sequence !== loadSequence) return;
        state.store.error = error instanceof Error ? error.message : "스토어를 불러오지 못했어요.";
      } finally {
        if (sequence !== loadSequence) return;
        state.store.loading = false;
        hooks.render();
      }
    }

    async function publishPrompt(promptId, categoryId, storeTitle) {
      const prompt = state.promptLibrary.items.find((item) => item.id === promptId);
      if (!prompt) {
        return false;
      }

      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        const result = await sendRuntimeMessage("inova-store:publish", {
          categoryId,
          prompt: {
            content: prompt.content,
            title: storeTitle || prompt.title,
          },
          providerIdentity,
        });
        mergeEntry(result.entry);
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
        state.store.items = state.store.items.filter((item) => item.entryId !== entryId);
        state.store.deleteConfirmEntryId = "";
        state.store.expandedEntryId = state.store.expandedEntryId === entryId ? "" : state.store.expandedEntryId;
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
      state.store.deleteConfirmEntryId = "";
      state.store.categoryId = namespace.promptStore.getCategories().some((category) => category.id === categoryId) ? categoryId : "all";
      state.store.expandedEntryId = "";
      hooks.render();
      await ensureLoaded(true);
    }

    async function setScope(scope) {
      state.store.deleteConfirmEntryId = "";
      state.store.scope = scope === "mine" ? "mine" : "all";
      state.store.expandedEntryId = "";
      hooks.render();
      await ensureLoaded(true);
    }

    async function setSort(sortBy) {
      state.store.deleteConfirmEntryId = "";
      state.store.sortBy = ["latest", "likes", "imports", "views"].includes(sortBy) ? sortBy : "latest";
      state.store.expandedEntryId = "";
      hooks.render();
      await ensureLoaded(true);
    }

    async function toggleExpand(entryId) {
      state.store.expandedEntryId = state.store.expandedEntryId === entryId ? "" : entryId;
      hooks.render();
      if (!state.store.expandedEntryId || viewedEntryIds.has(entryId)) {
        return;
      }

      viewedEntryIds.add(entryId);
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        const result = await sendRuntimeMessage("inova-store:view", { entryId, providerIdentity });
        if (result.entry) {
          mergeEntry(result.entry, { viewed: true });
          hooks.render();
        }
      } catch {}
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

    function requestUnpublish(entryId) {
      if (!entryId) return;
      state.store.deleteConfirmEntryId = state.store.deleteConfirmEntryId === entryId ? "" : entryId;
      hooks.render();
    }

    function cancelUnpublish(entryId) {
      if (!state.store.deleteConfirmEntryId || state.store.deleteConfirmEntryId !== entryId) return;
      state.store.deleteConfirmEntryId = "";
      hooks.render();
    }

    async function unpublishEntry(entryId) {
      const entry = state.store.items.find((item) => item.entryId === entryId);
      if (!entry) return;
      await unpublishPrompt(entry.entryId);
    }

    function mergeEntry(entry, viewerPatch = null) {
      const normalized = namespace.promptStore.normalizeStoreEntry(entry);
      const previous = state.store.items.find((item) => item.entryId === normalized.entryId);
      const nextItems = state.store.items.filter((item) => item.entryId !== normalized.entryId);
      const merged = previous
        ? {
            ...previous,
            ...normalized,
            metrics: normalized.metrics,
            owner: normalized.owner,
            viewer: {
              ...previous.viewer,
              ...normalized.viewer,
              ...(viewerPatch || {}),
            },
          }
        : normalized;
      nextItems.unshift(merged);
      state.store.items = nextItems;
      state.store.loaded = true;
    }

    function setFeedback(message, tone = "info", entryId = "") {
      global.clearTimeout(state.store.feedbackTimer);
      state.store.feedback = message ? { entryId, message, tone } : null;
      if (!message) {
        return;
      }
      state.store.feedbackTimer = global.setTimeout(() => {
        state.store.feedback = null;
        hooks.render();
      }, 2600);
    }

    function scheduleIdentityRetry() {
      global.clearTimeout(identityRetryTimer);
      identityRetryTimer = global.setTimeout(() => ensureLoaded(true), 900);
    }

    async function sendRuntimeMessage(type, payload) {
      const response = await chrome.runtime.sendMessage({
        type,
        ...(payload || {}),
      });
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
