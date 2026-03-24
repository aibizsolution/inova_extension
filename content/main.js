(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PANEL_OPEN_KEY = "inova-plus.panel-open";
  const ROUTE_FALLBACK_MS = 1600;
  const state = {
    sessionId: "",
    sessionTitle: "",
    open: false,
    preferredOpen: false,
    query: "",
    activeId: "",
    settings: { ...namespace.constants.defaults.settings },
    pausedSessions: {},
    uiPreferences: namespace.storage.mergeUiPreferences(),
    bookmarks: [],
    observer: null,
    syncTimer: 0,
    routeWatchInstalled: false,
    routePollTimer: 0,
    routeRetryTimers: [],
    lastRouteKey: "",
    routeBaselineSignature: "",
    routeWaitStartedAt: 0,
    awaitingRouteMessages: false,
    lastError: "",
  };
  bootstrapContent().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));
  async function bootstrapContent() {
    state.preferredOpen = readPanelOpenPreference();
    state.open = state.preferredOpen;
    namespace.contentPanel.ensurePanel({
      onCopy: copyBookmarkText,
      onHandlePositionChange: updateHandlePosition,
      onJump: jumpToBookmark,
      onSearch: updateQuery,
      onToggle: togglePanel,
    });
    state.lastRouteKey = getRouteKey();
    installRouteWatchers();
    global.addEventListener("resize", render, { passive: true });
    chrome.storage.onChanged?.addListener(handleStorageChange);
    await syncRouteState(true);
    [450, 1200].forEach((delay) => global.setTimeout(scheduleRefresh, delay));
  }
  function scheduleRefresh() {
    global.clearTimeout(state.syncTimer);
    state.syncTimer = global.setTimeout(() => {
      refreshState().catch((error) => {
        console.error("[i-Nova Bookmarks] refresh failed", error);
      });
    }, 120);
  }
  function scheduleRouteSync() {
    global.setTimeout(() => {
      syncRouteState().catch((error) => {
        console.error("[i-Nova Bookmarks] route sync failed", error);
      });
    }, 0);
  }
  async function refreshState() {
    try {
      const storageState = await namespace.storage.getState();
      state.settings = storageState.settings || { ...namespace.constants.defaults.settings };
      state.pausedSessions = storageState.pausedSessions || {};
      state.uiPreferences = namespace.storage.mergeUiPreferences(storageState.uiPreferences);
      if (state.sessionId) state.sessionTitle = namespace.contentDom.getSessionTitle();
      state.bookmarks = readLiveBookmarks();
      state.lastError = "";
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error("[i-Nova Bookmarks] refresh state failed", error);
    }
    render();
  }
  async function syncRouteState(force = false) {
    const nextSessionId = namespace.session.getSessionId();
    const sessionChanged = nextSessionId !== state.sessionId;
    state.lastRouteKey = getRouteKey();
    if (!force && !sessionChanged) return;

    disconnectObserver();
    clearRouteRetryTimers();
    resetRouteState(nextSessionId, namespace.contentDom.getUserMessageSignature());
    render();

    if (!nextSessionId) return void namespace.contentDom.setCurrentMessage("");

    state.observer = namespace.contentDom.observeMessages(scheduleRefresh);
    scheduleRouteRetryTimers();
    await refreshState();
  }
  function resetRouteState(nextSessionId, previousSignature) {
    state.sessionId = nextSessionId || "";
    state.sessionTitle = nextSessionId ? namespace.contentDom.getSessionTitle() : "";
    state.open = nextSessionId ? state.preferredOpen : false;
    state.query = "";
    state.activeId = "";
    state.bookmarks = [];
    state.lastError = "";
    state.routeBaselineSignature = nextSessionId ? previousSignature : "";
    state.awaitingRouteMessages = Boolean(nextSessionId);
    state.routeWaitStartedAt = nextSessionId ? Date.now() : 0;
    namespace.contentDom.setCurrentMessage("");
  }
  function scheduleRouteRetryTimers() {
    for (const delay of [180, 500, 900, 1600, 2600]) {
      state.routeRetryTimers.push(global.setTimeout(scheduleRefresh, delay));
    }
  }
  function clearRouteRetryTimers() {
    for (const timerId of state.routeRetryTimers) {
      global.clearTimeout(timerId);
    }
    state.routeRetryTimers = [];
  }
  function readLiveBookmarks() {
    if (!shouldCollectLiveMessages()) return ((state.awaitingRouteMessages = false), (state.routeBaselineSignature = ""), []);
    const liveBookmarks = namespace.contentDom.collectUserMessages(state.sessionId);
    const liveSignature = namespace.contentDom.getUserMessageSignature();
    if (shouldKeepWaiting(liveBookmarks, liveSignature)) return [];
    state.awaitingRouteMessages = false;
    state.routeBaselineSignature = liveSignature;
    return liveBookmarks;
  }
  function shouldCollectLiveMessages() {
    return Boolean(state.sessionId) && state.settings.enabled && state.settings.autoBookmark && !isPaused();
  }
  function shouldKeepWaiting(liveBookmarks, liveSignature) {
    if (!state.awaitingRouteMessages) return false;
    const conversation = namespace.contentDom.getConversationState();
    const routeLoaded = Boolean(liveSignature) && liveSignature !== state.routeBaselineSignature;
    const emptyConversationReady = conversation.hasChatLog && conversation.hasComposer && conversation.articleCount === 0;
    const readyWithoutBaseline = !state.routeBaselineSignature && liveBookmarks.length > 0;
    const becameEmpty = !liveBookmarks.length && !liveSignature && emptyConversationReady;
    const waitedLongEnough = Date.now() - state.routeWaitStartedAt > ROUTE_FALLBACK_MS;
    return !(routeLoaded || readyWithoutBaseline || becameEmpty || waitedLongEnough);
  }
  function isPaused() {
    return Boolean(state.pausedSessions[state.sessionId]);
  }
  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") return;
    if (changes.settings) state.settings = { ...namespace.constants.defaults.settings, ...(changes.settings.newValue || {}) };
    if (changes.pausedSessions) state.pausedSessions = changes.pausedSessions.newValue || {};
    if (changes.uiPreferences) state.uiPreferences = namespace.storage.mergeUiPreferences(changes.uiPreferences.newValue);
    scheduleRefresh();
  }
  function render() {
    const hasSession = Boolean(state.sessionId);
    const visible = hasSession && state.settings.enabled && state.settings.autoBookmark && !isPaused();
    const loading = visible && state.settings.autoBookmark && state.awaitingRouteMessages;
    const filteredBookmarks = filterBookmarks();
    namespace.contentPanel.renderPanel({
      activeId: state.activeId,
      autoBookmark: state.settings.autoBookmark,
      bookmarks: state.bookmarks,
      emptyText: buildEmptyText(hasSession, loading),
      enabled: state.settings.enabled,
      filteredBookmarks,
      handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
      open: state.open,
      query: state.query,
      sessionLabel: state.sessionTitle || namespace.session.formatSessionLabel(state.sessionId),
      statusText: buildStatusText(loading),
      visible,
    });
  }
  function buildEmptyText(hasSession, loading) {
    if (state.query) return "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요.";
    if (!state.settings.autoBookmark) return "팝업에서 질문 자동 모으기를 켜면 여기서 바로 볼 수 있어요.";
    if (loading) return "이 대화의 질문을 불러오는 중이에요.";
    if (hasSession) return "아직 질문이 없어요.";
    return "대화에 들어가면 사용할 수 있어요.";
  }
  function filterBookmarks() {
    const query = namespace.session.normalizeText(state.query).toLowerCase();
    return query ? state.bookmarks.filter((bookmark) => bookmark.normalizedText.includes(query)) : state.bookmarks;
  }
  function buildStatusText(loading) {
    if (state.lastError) return "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요.";
    if (!state.settings.enabled) return "이 사이트에서 사용이 꺼져 있어요.";
    if (isPaused()) return "이 대화에서 일시 중지됨";
    if (!state.settings.autoBookmark) return "질문 자동 모으기가 꺼져 있어요.";
    if (loading) return "질문을 불러오는 중";
    if (!state.bookmarks.length) return "아직 질문이 없어요";
    return "";
  }
  function updateQuery(value) {
    state.query = value || "";
    render();
  }
  async function copyBookmarkText(bookmarkId) {
    const bookmark = state.bookmarks.find((entry) => entry.id === bookmarkId);
    if (!bookmark?.text) return false;
    try {
      await navigator.clipboard.writeText(bookmark.text);
      return true;
    } catch (error) {
      console.error("[i-Nova Bookmarks] copy failed", error);
      return false;
    }
  }
  async function updateHandlePosition(nextRatio) {
    const bucket = namespace.storage.getViewportBucket(global.innerWidth);
    const handleRatio = namespace.storage.normalizeHandleRatio(nextRatio, bucket);
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
      ...(state.uiPreferences || {}),
      handleRatios: { [bucket]: handleRatio },
    });
    render();
    try {
      await namespace.storage.updateUiPreferences({
        handleRatios: { [bucket]: handleRatio },
      });
    } catch (error) {
      console.error("[i-Nova Bookmarks] handle position save failed", error);
    }
  }
  function togglePanel(nextOpen, persist = true) {
    state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
    if (persist) {
      state.preferredOpen = state.open;
      writePanelOpenPreference(state.open);
    }
    render();
  }
  function jumpToBookmark(bookmarkId) {
    state.activeId = bookmarkId;
    namespace.contentPanel.setActiveBookmark(bookmarkId);
    namespace.contentPanel.focusBookmark(bookmarkId);
    namespace.contentDom.scrollToMessage(bookmarkId, { block: "start", behavior: "smooth" });
  }
  function disconnectObserver() {
    if (!state.observer) return;
    state.observer.disconnect();
    state.observer = null;
  }
  function installRouteWatchers() {
    if (state.routeWatchInstalled) return;
    wrapHistoryMethod("pushState");
    wrapHistoryMethod("replaceState");
    global.addEventListener("popstate", scheduleRouteSync);
    global.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleRouteSync();
    });
    document.addEventListener("click", handleDocumentClick, true);
    startRoutePolling();
    state.routeWatchInstalled = true;
  }
  function wrapHistoryMethod(methodName) {
    const original = history[methodName];
    history[methodName] = function wrappedHistoryState(...args) {
      const result = original.apply(this, args);
      scheduleRouteSync();
      return result;
    };
  }
  function handleDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("a, button, [role='button']")) return;
    global.setTimeout(scheduleRouteSync, 80);
    global.setTimeout(scheduleRouteSync, 350);
  }
  function startRoutePolling() {
    if (state.routePollTimer) global.clearInterval(state.routePollTimer);
    state.routePollTimer = global.setInterval(() => {
      const nextRouteKey = getRouteKey();
      if (nextRouteKey === state.lastRouteKey) return;
      state.lastRouteKey = nextRouteKey;
      scheduleRouteSync();
    }, 400);
  }
  function getRouteKey() {
    return `${global.location.pathname}${global.location.search}`;
  }
  function readPanelOpenPreference() {
    try {
      const saved = global.sessionStorage?.getItem(PANEL_OPEN_KEY);
      return saved == null ? false : saved === "true";
    } catch {
      return false;
    }
  }
  function writePanelOpenPreference(open) {
    try {
      global.sessionStorage?.setItem(PANEL_OPEN_KEY, String(Boolean(open)));
    } catch {}
  }
})(globalThis);
