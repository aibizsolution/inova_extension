(function initConversationController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { cloneValue, normalizeText, resolveBrowserCapabilities } = namespace.panelUtils;
  const SNAPSHOT_REFRESH_DEBOUNCE_MS = 120;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "page.adapter.v2",
  ]);

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const readConversationState = typeof browserCapabilities.readConversationState === "function"
      ? browserCapabilities.readConversationState
      : async () => ({});
    const jumpConversationItem = typeof browserCapabilities.jumpConversationItem === "function"
      ? browserCapabilities.jumpConversationItem
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};
    const traceConversation = typeof options.traceConversation === "function"
      ? options.traceConversation
      : () => {};
    const writeClipboardText = typeof browserCapabilities.writeClipboardText === "function"
      ? browserCapabilities.writeClipboardText
      : async () => ({});

    const state = {
      activeId: "",
      capabilities: [],
      conversation: {
        articleCount: 0,
        hasChatLog: false,
        hasComposer: false,
        userCount: 0,
      },
      error: "",
      initialized: false,
      items: [],
      lastLoadedAt: 0,
      loadPromise: null,
      pendingRefreshAfterLoad: false,
      refreshTimerId: 0,
      loading: false,
      query: "",
      searchRenderTimerId: 0,
      sessionId: "",
      sessionTitle: "",
      snapshotFingerprint: "",
      visibleMessageId: "",
    };

    return {
      buildViewState,
      getConversationCount,
      handleCopyBookmark,
      handleJumpBookmark,
      handleSearch,
      hasRequiredCapabilities,
      setActiveBookmark,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      if (!hasRequiredCapabilities()) {
        return;
      }

      const fallbackBookmarksTool = panelState?.bookmarksTool && typeof panelState.bookmarksTool === "object"
        ? panelState.bookmarksTool
        : {};
      hydrateFallbackState(fallbackBookmarksTool);

      if (!state.initialized) {
        state.initialized = true;
      }

      const nextFingerprint = buildSnapshotFingerprint(fallbackBookmarksTool);
      const activeConversationTool = normalizeText(panelState?.activeTool) === "bookmarks";
      const shouldRefresh = activeConversationTool && (
        state.snapshotFingerprint !== nextFingerprint
        || !state.lastLoadedAt
      );

      state.snapshotFingerprint = nextFingerprint;
      if (shouldRefresh) {
        requestLoad();
      }
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getConversationCount() {
      return Math.max(0, Number(state.items.length) || 0);
    }

    function buildViewState(fallbackBookmarksTool = {}) {
      if (!hasRequiredCapabilities()) {
        return fallbackBookmarksTool;
      }
      const items = getFilteredItems();
      return {
        activeId: normalizeText(state.activeId || state.visibleMessageId),
        count: getConversationCount(),
        emptyText: buildEmptyText(items.length),
        items,
        metaText: state.query ? `검색 결과 ${items.length}개` : buildStatusText(),
        query: state.query,
      };
    }

    async function handleCopyBookmark(bookmarkId) {
      const bookmark = state.items.find((entry) => normalizeText(entry?.id) === normalizeText(bookmarkId));
      if (!bookmark?.text) {
        return false;
      }
      const result = await writeClipboardText(bookmark.text);
      return Boolean(result?.copied);
    }

    async function handleJumpBookmark(bookmarkId) {
      const normalizedBookmarkId = normalizeText(bookmarkId);
      if (!normalizedBookmarkId) {
        return false;
      }
      state.activeId = normalizedBookmarkId;
      scheduleRender();
      const result = await jumpConversationItem(normalizedBookmarkId);
      return Boolean(result?.jumped);
    }

    function handleSearch(toolId, value) {
      if (normalizeText(toolId) !== "bookmarks") {
        return false;
      }
      const nextQuery = String(value ?? "");
      if (state.query === nextQuery) {
        return true;
      }
      state.query = nextQuery;
      scheduleSearchRender();
      return true;
    }

    function setActiveBookmark(bookmarkId) {
      state.activeId = normalizeText(bookmarkId);
    }

    async function ensureLoaded() {
      global.clearTimeout(state.refreshTimerId);
      state.refreshTimerId = 0;
      if (state.loadPromise) {
        return state.loadPromise;
      }
      state.pendingRefreshAfterLoad = false;
      const requestedFingerprint = state.snapshotFingerprint;
      const run = (async () => {
        state.loading = true;
        traceConversation("34.hosted.conversation.snapshot.start", {});
        scheduleRender();
        try {
          const snapshot = await readConversationState();
          hydrateSnapshot(snapshot);
          state.error = "";
          state.lastLoadedAt = Date.now();
          traceConversation("35.hosted.conversation.snapshot.success", {
            count: state.items.length,
          });
          return state.items;
        } catch (error) {
          state.error = getErrorMessage(error, "대화 목록을 불러오지 못했어요.");
          traceConversation("35.hosted.conversation.snapshot.error", {
            error: state.error,
          });
          return state.items;
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
        if (state.pendingRefreshAfterLoad || state.snapshotFingerprint !== requestedFingerprint) {
          state.pendingRefreshAfterLoad = false;
          requestLoad();
        }
      }
    }

    function requestLoad() {
      if (state.loadPromise) {
        state.pendingRefreshAfterLoad = true;
        return false;
      }
      if (state.refreshTimerId) {
        return false;
      }
      state.refreshTimerId = global.setTimeout(() => {
        state.refreshTimerId = 0;
        void ensureLoaded();
      }, SNAPSHOT_REFRESH_DEBOUNCE_MS);
      return true;
    }

    function hydrateFallbackState(fallbackBookmarksTool) {
      if (state.loadPromise) {
        return;
      }
      const nextItems = Array.isArray(fallbackBookmarksTool?.items)
        ? fallbackBookmarksTool.items.map(cloneValue)
        : [];
      if (nextItems.length) {
        state.items = nextItems;
      }
      const nextQuery = String(fallbackBookmarksTool?.query ?? "");
      if (nextQuery || !state.query) {
        state.query = nextQuery;
      }
      const nextActiveId = normalizeText(fallbackBookmarksTool?.activeId);
      if (nextActiveId) {
        state.activeId = nextActiveId;
      }
      const nextVisibleMessageId = normalizeText(fallbackBookmarksTool?.visibleMessageId);
      if (nextVisibleMessageId) {
        state.visibleMessageId = nextVisibleMessageId;
      }
    }

    function hydrateSnapshot(snapshot) {
      const normalizedSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
      const conversation = normalizedSnapshot.conversation && typeof normalizedSnapshot.conversation === "object"
        ? normalizedSnapshot.conversation
        : {};
      state.conversation = {
        articleCount: Math.max(0, Number(conversation.articleCount) || 0),
        hasChatLog: Boolean(conversation.hasChatLog),
        hasComposer: Boolean(conversation.hasComposer),
        userCount: Math.max(0, Number(conversation.userCount) || 0),
      };
      state.items = Array.isArray(normalizedSnapshot.items)
        ? normalizedSnapshot.items.map(cloneValue)
        : [];
      state.sessionId = normalizeText(normalizedSnapshot.sessionId);
      state.sessionTitle = normalizeText(normalizedSnapshot.sessionTitle);
      state.visibleMessageId = normalizeText(normalizedSnapshot.visibleMessageId);
      if (!state.items.some((item) => normalizeText(item?.id) === state.activeId)) {
        state.activeId = state.visibleMessageId || normalizeText(state.items[0]?.id);
      }
    }

    function buildStatusText() {
      if (state.error) {
        return "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요.";
      }
      if (state.loading && !state.items.length) {
        return "이 대화의 흐름을 불러오는 중";
      }
      if (!state.items.length) {
        return "아직 대화가 없어요";
      }
      return "";
    }

    function buildEmptyText(itemCount) {
      if (state.query) {
        return "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요.";
      }
      if (state.loading && !itemCount) {
        return "이 대화의 흐름을 불러오는 중이에요.";
      }
      if (state.error) {
        return "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요.";
      }
      return "아직 대화가 없어요.";
    }

    function getFilteredItems() {
      const normalizedQuery = normalizeText(state.query).toLowerCase();
      if (!normalizedQuery) {
        return state.items.slice();
      }
      return state.items.filter((bookmark) =>
        normalizeText(bookmark?.normalizedText || bookmark?.text).toLowerCase().includes(normalizedQuery)
      );
    }

    function buildSnapshotFingerprint(bookmarksTool) {
      const explicitFingerprint = normalizeText(bookmarksTool?.snapshotFingerprint);
      if (explicitFingerprint) {
        return explicitFingerprint;
      }
      const items = Array.isArray(bookmarksTool?.items) ? bookmarksTool.items : [];
      const firstId = normalizeText(items[0]?.id);
      const lastId = normalizeText(items.at?.(-1)?.id);
      return [
        normalizeText(bookmarksTool?.activeId),
        normalizeText(bookmarksTool?.query),
        String(Math.max(0, Number(bookmarksTool?.count) || items.length)),
        firstId,
        lastId,
      ].join("|");
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

    function getErrorMessage(error, fallback) {
      return normalizeText(error instanceof Error ? error.message : error) || fallback;
    }
  }

  namespace.conversationController = { create };
})(globalThis);
