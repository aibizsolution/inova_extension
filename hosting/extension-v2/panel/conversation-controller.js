(function initConversationController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { cloneValue, normalizeText, resolveBrowserCapabilities } = namespace.panelUtils;
  const SNAPSHOT_REFRESH_DEBOUNCE_MS = 120;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "page.adapter.v2",
  ]);
  const CONVERSATION_DOM_SNAPSHOT_CAPABILITY_ID = "page.conversation.read-dom-snapshot";
  const CONVERSATION_READ_CAPABILITY_ID = "page.conversation.read-state";
  const CONVERSATION_JUMP_CAPABILITY_ID = "page.conversation.jump-item";
  const CLIPBOARD_WRITE_CAPABILITY_ID = "page.clipboard.write-text";

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const readConversationState = typeof browserCapabilities.readConversationState === "function"
      ? browserCapabilities.readConversationState
      : async () => ({});
    const readConversationDomSnapshot = typeof browserCapabilities.readConversationDomSnapshot === "function"
      ? browserCapabilities.readConversationDomSnapshot
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
    const recordFeatureUsage = typeof options.featureUsageTracker?.record === "function"
      ? options.featureUsageTracker.record
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
      tokenEstimate: createEmptyTokenEstimate(),
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
      ) && hasConversationReadCapability();

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
      if (!hasConversationReadCapability()) {
        return {
          activeId: "",
          canCopyBookmark: false,
          canJumpBookmark: false,
          capabilityError: "대화 읽기 기능이 현재 비활성화되어 있어요.",
          count: 0,
          emptyText: "대화 읽기 기능이 현재 비활성화되어 있어요.",
          items: [],
          metaText: "",
          query: state.query,
          tokenEstimate: createEmptyTokenEstimate(),
        };
      }
      const items = getFilteredItems();
      return {
        activeId: normalizeText(state.activeId || state.visibleMessageId),
        canCopyBookmark: hasCapability(CLIPBOARD_WRITE_CAPABILITY_ID),
        canJumpBookmark: hasCapability(CONVERSATION_JUMP_CAPABILITY_ID),
        capabilityError: buildCapabilityError(),
        count: getConversationCount(),
        emptyText: buildEmptyText(items.length),
        items,
        metaText: state.query || items.length ? buildStatusText(items) : "",
        query: state.query,
        tokenEstimate: buildEffectiveTokenEstimate(),
      };
    }

    async function handleCopyBookmark(bookmarkId) {
      if (!hasCapability(CLIPBOARD_WRITE_CAPABILITY_ID)) {
        return false;
      }
      const bookmark = state.items.find((entry) => normalizeText(entry?.id) === normalizeText(bookmarkId));
      if (!bookmark?.text) {
        return false;
      }
      const result = await writeClipboardText(bookmark.text);
      return Boolean(result?.copied);
    }

    async function handleJumpBookmark(bookmarkId) {
      const normalizedBookmarkId = normalizeText(bookmarkId);
      if (!normalizedBookmarkId || !hasCapability(CONVERSATION_JUMP_CAPABILITY_ID)) {
        return false;
      }
      state.activeId = normalizedBookmarkId;
      scheduleRender();
      const result = await jumpConversationItem(normalizedBookmarkId);
      const jumped = Boolean(result?.jumped);
      void recordFeatureUsage("conversation", "jumped", jumped ? "success" : "error");
      return jumped;
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
      if (!hasConversationReadCapability()) {
        state.error = "대화 읽기 기능이 현재 비활성화되어 있어요.";
        state.items = [];
        scheduleRender();
        return state.items;
      }
      const requestedFingerprint = state.snapshotFingerprint;
      const run = (async () => {
        state.loading = true;
        traceConversation("34.hosted.conversation.snapshot.start", {});
        scheduleRender();
        try {
          const snapshot = await readConversationSnapshot();
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
        state.tokenEstimate = summarizeItemsTokenEstimate(state.items);
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
      state.tokenEstimate = normalizeTokenEstimate(normalizedSnapshot.tokenEstimate, state.items);
      state.sessionId = normalizeText(normalizedSnapshot.sessionId);
      state.sessionTitle = normalizeText(normalizedSnapshot.sessionTitle);
      state.visibleMessageId = normalizeText(normalizedSnapshot.visibleMessageId);
      if (!state.items.some((item) => normalizeText(item?.id) === state.activeId)) {
        state.activeId = state.visibleMessageId || normalizeText(state.items[0]?.id);
      }
    }

    function buildStatusText(items = state.items) {
      const itemCount = Math.max(0, Number(items.length) || 0);
      if (state.query) {
        return `검색 결과 ${itemCount}개`;
      }
      if (state.error) {
        return "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요.";
      }
      if (state.loading && !itemCount) {
        return "이 대화의 흐름을 불러오는 중";
      }
      if (!itemCount) {
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

    function buildEffectiveTokenEstimate() {
      const estimate = normalizeTokenEstimate(state.tokenEstimate, state.items);
      if (state.query) {
        estimate.filtered = summarizeItemsTokenEstimate(getFilteredItems());
      }
      return estimate;
    }

    function normalizeTokenEstimate(rawEstimate, fallbackItems = []) {
      const estimate = rawEstimate && typeof rawEstimate === "object" ? rawEstimate : {};
      const fallback = summarizeItemsTokenEstimate(fallbackItems);
      const question = readNonNegativeNumber(estimate.question, fallback.question);
      const answer = readNonNegativeNumber(estimate.answer, fallback.answer);
      const total = readNonNegativeNumber(estimate.total, question + answer);
      return {
        answer,
        basis: normalizeText(estimate.basis) || fallback.basis,
        messageCount: readNonNegativeNumber(estimate.messageCount, fallback.messageCount),
        modelLabel: normalizeText(estimate.modelLabel || fallback.modelLabel),
        modelLabelSource: normalizeText(estimate.modelLabelSource || fallback.modelLabelSource),
        question,
        total,
        visibleMessageCount: readNonNegativeNumber(estimate.visibleMessageCount, fallback.visibleMessageCount),
      };
    }

    function summarizeItemsTokenEstimate(items) {
      const summary = createEmptyTokenEstimate();
      (Array.isArray(items) ? items : []).forEach((item) => {
        const itemEstimate = item?.tokenEstimate && typeof item.tokenEstimate === "object" ? item.tokenEstimate : {};
        const question = readNonNegativeNumber(itemEstimate.question, 0);
        const answer = readNonNegativeNumber(itemEstimate.answer, 0);
        summary.question += question;
        summary.answer += answer;
        summary.total += readNonNegativeNumber(itemEstimate.total, question + answer);
        summary.messageCount += answer > 0 ? 2 : 1;
        summary.visibleMessageCount = summary.messageCount;
      });
      return summary;
    }

    function createEmptyTokenEstimate() {
      return {
        answer: 0,
        basis: "dom-estimate-v1",
        messageCount: 0,
        modelLabel: "",
        modelLabelSource: "",
        question: 0,
        total: 0,
        visibleMessageCount: 0,
      };
    }

    function readNonNegativeNumber(value, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) {
        return Math.max(0, Number(fallback) || 0);
      }
      return Math.floor(number);
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

    function hasCapability(capabilityId) {
      return state.capabilities.includes(normalizeText(capabilityId));
    }

    function hasConversationReadCapability() {
      return hasCapability(CONVERSATION_DOM_SNAPSHOT_CAPABILITY_ID) || hasCapability(CONVERSATION_READ_CAPABILITY_ID);
    }

    async function readConversationSnapshot() {
      const parser = namespace.conversationDomParser;
      if (hasCapability(CONVERSATION_DOM_SNAPSHOT_CAPABILITY_ID) && typeof parser?.parse === "function") {
        try {
          const domSnapshot = await readConversationDomSnapshot();
          const snapshot = parser.parse(domSnapshot);
          traceConversation("34.hosted.conversation.dom-snapshot.parsed", {
            articleCount: Array.isArray(domSnapshot?.articles) ? domSnapshot.articles.length : 0,
            count: Array.isArray(snapshot?.items) ? snapshot.items.length : 0,
          });
          return snapshot;
        } catch (error) {
          traceConversation("34.hosted.conversation.dom-snapshot.error", {
            error: getErrorMessage(error, "DOM snapshot parsing failed"),
          });
          if (!hasCapability(CONVERSATION_READ_CAPABILITY_ID)) {
            throw error;
          }
        }
      }
      return readConversationState();
    }

    function buildCapabilityError() {
      const missing = [];
      if (!hasCapability(CONVERSATION_JUMP_CAPABILITY_ID)) {
        missing.push("이동");
      }
      if (!hasCapability(CLIPBOARD_WRITE_CAPABILITY_ID)) {
        missing.push("복사");
      }
      return missing.length
        ? `대화 ${missing.join("/")} 기능이 현재 비활성화되어 있어요.`
        : "";
    }

    function getErrorMessage(error, fallback) {
      return normalizeText(error instanceof Error ? error.message : error) || fallback;
    }
  }

  namespace.conversationController = { create };
})(globalThis);
