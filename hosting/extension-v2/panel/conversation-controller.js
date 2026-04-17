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
  const CONVERSATION_FOCUS_EVALUATE_CAPABILITY_ID = "conversation.focus.evaluate";
  const CLIPBOARD_WRITE_CAPABILITY_ID = "page.clipboard.write-text";
  const FOCUS_EVALUATION_USER_MESSAGE_LIMIT = 32;
  const FOCUS_MIN_LATEST_CHARS = 12;
  const FOCUS_MIN_USER_MESSAGES = 3;

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const invokeCapability = typeof browserCapabilities.invokeCapability === "function"
      ? browserCapabilities.invokeCapability
      : null;
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
    const getProviderIdentity = typeof options.getProviderIdentity === "function"
      ? options.getProviderIdentity
      : () => ({ available: false });
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
      focusEvaluationPendingKey: "",
      focusEvaluationRequestId: 0,
      focusSignal: createEmptyFocusSignal(),
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
      userMessages: [],
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
          focusSignal: createEmptyFocusSignal(),
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
        focusSignal: getVisibleFocusSignal(),
        items,
        metaText: state.query ? `검색 결과 ${items.length}개` : buildStatusText(),
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
        state.userMessages = buildUserMessagesFromItems(state.items);
        requestFocusEvaluation();
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
      state.userMessages = normalizeUserMessages(normalizedSnapshot.userMessages, state.items);
      state.sessionId = normalizeText(normalizedSnapshot.sessionId);
      state.sessionTitle = normalizeText(normalizedSnapshot.sessionTitle);
      state.visibleMessageId = normalizeText(normalizedSnapshot.visibleMessageId);
      if (!state.items.some((item) => normalizeText(item?.id) === state.activeId)) {
        state.activeId = state.visibleMessageId || normalizeText(state.items[0]?.id);
      }
      requestFocusEvaluation();
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

    function requestFocusEvaluation() {
      const request = buildFocusEvaluationRequest();
      if (!request) {
        clearFocusSignal();
        return false;
      }
      if (state.focusEvaluationPendingKey === request.key || state.focusSignal.key === request.key) {
        return false;
      }

      const requestId = state.focusEvaluationRequestId + 1;
      state.focusEvaluationRequestId = requestId;
      state.focusEvaluationPendingKey = request.key;
      if (state.focusSignal.visible) {
        state.focusSignal = createEmptyFocusSignal();
        scheduleRender();
      }
      traceConversation("36.hosted.conversation.focus.start", {
        userMessageCount: request.input.userMessages.length,
      });
      invokeCapability(CONVERSATION_FOCUS_EVALUATE_CAPABILITY_ID, request.input, {
        trace: {
          reason: "conversation-focus",
          source: "conversation-controller",
        },
      }).then((result) => {
        if (state.focusEvaluationRequestId !== requestId) {
          return;
        }
        state.focusSignal = normalizeFocusSignal(result, request.key);
        traceConversation("37.hosted.conversation.focus.success", {
          confidence: state.focusSignal.confidence,
          visible: state.focusSignal.visible,
        });
      }).catch((error) => {
        if (state.focusEvaluationRequestId !== requestId) {
          return;
        }
        state.focusSignal = createEmptyFocusSignal();
        traceConversation("37.hosted.conversation.focus.error", {
          error: getErrorMessage(error, "conversation focus evaluation failed"),
        });
      }).finally(() => {
        if (state.focusEvaluationRequestId !== requestId) {
          return;
        }
        state.focusEvaluationPendingKey = "";
        scheduleRender();
      });
      return true;
    }

    function buildFocusEvaluationRequest() {
      if (!hasCapability(CONVERSATION_FOCUS_EVALUATE_CAPABILITY_ID) || typeof invokeCapability !== "function") {
        return null;
      }
      const providerIdentity = normalizeProviderIdentity(getProviderIdentity());
      if (!providerIdentity.available || !providerIdentity.providerUserKey) {
        return null;
      }
      const userMessages = normalizeUserMessages(state.userMessages, state.items);
      if (userMessages.length < FOCUS_MIN_USER_MESSAGES) {
        return null;
      }
      const latestMessage = userMessages[userMessages.length - 1];
      if (!latestMessage || latestMessage.text.length < FOCUS_MIN_LATEST_CHARS || isLowSignalFocusText(latestMessage.text)) {
        return null;
      }
      return {
        input: {
          providerIdentity,
          userMessages: userMessages.slice(-FOCUS_EVALUATION_USER_MESSAGE_LIMIT).map((message, index, slicedMessages) => ({
            charLen: message.text.length,
            text: message.text,
            turnIndex: Math.max(1, Number(message.turnIndex) || (userMessages.length - slicedMessages.length + index + 1)),
          })),
        },
        key: buildFocusEvaluationKey(userMessages),
      };
    }

    function normalizeProviderIdentity(providerIdentity) {
      const identity = providerIdentity && typeof providerIdentity === "object" ? providerIdentity : {};
      return {
        available: Boolean(identity.available),
        displayName: normalizeText(identity.displayName),
        email: normalizeText(identity.email),
        numericUserId: Number.isFinite(Number(identity.numericUserId)) ? Number(identity.numericUserId) : 0,
        provider: normalizeText(identity.provider || "inova") || "inova",
        providerUserKey: normalizeText(identity.providerUserKey),
      };
    }

    function clearFocusSignal() {
      if (!state.focusSignal.visible && !state.focusEvaluationPendingKey) {
        return;
      }
      state.focusEvaluationRequestId += 1;
      state.focusEvaluationPendingKey = "";
      state.focusSignal = createEmptyFocusSignal();
      scheduleRender();
    }

    function normalizeFocusSignal(result, key) {
      const payload = result && typeof result === "object" ? result : {};
      const confidence = readRatio(payload.confidence, 0);
      const splitRecommended = payload.splitRecommended === true
        && confidence >= 0.75
        && normalizeText(payload.nextAction).toLowerCase() === "split";
      if (!splitRecommended) {
        return {
          ...createEmptyFocusSignal(),
          key,
        };
      }
      const reasonCodes = Array.isArray(payload.decisionReasonCodes)
        ? payload.decisionReasonCodes.map((code) => normalizeText(code)).filter(Boolean).slice(0, 4)
        : [];
      return {
        confidence,
        key,
        reasonCodes,
        tooltip: buildFocusSignalTooltip(confidence, reasonCodes),
        visible: true,
      };
    }

    function buildFocusSignalTooltip(confidence, reasonCodes) {
      const reasonText = formatFocusReasonText(reasonCodes);
      const confidenceText = Math.round(confidence * 100);
      return [
        "최근 질문이 이전 흐름과 분리된 새 주제일 가능성이 높아요.",
        "사용자 질문만 기준으로 보수적으로 판단했으며, 새 대화로 나누면 답변 품질을 유지하기 쉬울 수 있어요.",
        reasonText ? `근거: ${reasonText}.` : "",
        `신뢰도 ${confidenceText}%.`,
      ].filter(Boolean).join(" ");
    }

    function formatFocusReasonText(reasonCodes) {
      const labels = {
        high_reexplanation_cost: "다시 설명해야 할 정보가 많음",
        independent_goal: "독립된 목표",
        low_context_dependency: "이전 문맥 의존이 낮음",
        topic_shift: "주제 전환",
      };
      return (Array.isArray(reasonCodes) ? reasonCodes : [])
        .map((code) => labels[code] || "")
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
    }

    function getVisibleFocusSignal() {
      return state.focusSignal.visible
        ? cloneValue(state.focusSignal)
        : createEmptyFocusSignal();
    }

    function createEmptyFocusSignal() {
      return {
        confidence: 0,
        key: "",
        reasonCodes: [],
        tooltip: "",
        visible: false,
      };
    }

    function normalizeUserMessages(messages, fallbackItems = []) {
      const source = Array.isArray(messages) && messages.length
        ? messages
        : buildUserMessagesFromItems(fallbackItems);
      return source.map((message, index) => {
        const text = normalizeText(message?.text);
        if (!text) {
          return null;
        }
        return {
          charLen: text.length,
          id: normalizeText(message?.id),
          messageOrder: Math.max(1, Number(message?.messageOrder) || Number(message?.order) || index + 1),
          text,
          tokenEstimate: readNonNegativeNumber(message?.tokenEstimate, 0),
          turnIndex: Math.max(1, Number(message?.turnIndex) || index + 1),
        };
      }).filter(Boolean);
    }

    function buildUserMessagesFromItems(items = []) {
      return (Array.isArray(items) ? items : []).map((item, index) => {
        const text = normalizeText(item?.text);
        return {
          charLen: text.length,
          id: normalizeText(item?.id),
          messageOrder: Math.max(1, Number(item?.messageOrder) || index + 1),
          text,
          tokenEstimate: readNonNegativeNumber(item?.tokenEstimate?.question, 0),
          turnIndex: index + 1,
        };
      }).filter((message) => message.text);
    }

    function buildFocusEvaluationKey(userMessages) {
      const compact = (Array.isArray(userMessages) ? userMessages : [])
        .map((message) => [
          Math.max(1, Number(message?.turnIndex) || 0),
          normalizeText(message?.id),
          normalizeText(message?.text).length,
          hashText(message?.text),
        ].join(":"))
        .join("|");
      return [
        normalizeText(state.sessionId) || "current",
        String((Array.isArray(userMessages) ? userMessages : []).length),
        hashText(compact),
      ].join("|");
    }

    function isLowSignalFocusText(text) {
      const compact = normalizeText(text)
        .replace(/[ㅋㅎㅠㅜ\s\d_]+/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, "")
        .trim();
      return compact.length < 4;
    }

    function readRatio(value, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1) {
        return fallback;
      }
      return Math.round(number * 1000) / 1000;
    }

    function hashText(text) {
      let hash = 0;
      for (const char of normalizeText(text)) {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash |= 0;
      }
      return Math.abs(hash).toString(36);
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
