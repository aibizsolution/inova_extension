(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PANEL_OPEN_KEY = "inova-plus.panel-open";
  const MEETING_DEBUG_COLLAPSED_KEY = "__INOVA_MEETING_PANEL_DEBUG_COLLAPSED__";
  const UI_PREFERENCE_LOCK_MS = 1500;
  const state = {
    sessionId: "",
    sessionTitle: "",
    open: false,
    preferredOpen: false,
    activeId: "",
    activeTool: namespace.constants.defaults.uiPreferences.activeTool,
    queries: { bookmarks: "", prompts: "", store: "" },
    settings: { ...namespace.constants.defaults.settings },
    pausedSessions: {},
    meetingHub: { ...namespace.constants.defaults.meetingHub },
    meetingUi: {
      feedback: null,
      feedbackTimer: 0,
      pending: { action: "", jobId: "", meetingId: "", startedAt: 0, title: "" },
    },
    panelDebugUi: {
      collapsed: readMeetingDebugCollapsed(),
      feedback: null,
      feedbackTimer: 0,
    },
    cloudSync: namespace.cloudSync.mergeCloudSyncState(),
    releaseInfo: namespace.releaseInfo.mergeReleaseInfo(),
    uiPreferences: namespace.storage.mergeUiPreferences(),
    promptLibrary: namespace.promptLibrary.mergePromptLibrary(),
    promptEditor: { open: false, mode: "create", id: "", title: "", content: "", error: "" },
    promptImportReview: null,
    promptMenuId: "",
    promptDeleteConfirmId: "",
    promptPendingInsert: null,
    promptActionPending: null,
    promptPublishPromptId: "",
    promptPublishCategoryId: "document",
    promptPublishTitle: "",
    promptPublishError: "",
    promptFeedback: null,
    promptReview: { ...namespace.constants.defaults.promptReview },
    feedbackTimer: 0,
    bookmarks: [],
    store: {
      availableCategories: [],
      categoryId: "all",
      dataFreshness: "empty",
      degraded: false,
      degradedReason: "",
      error: "",
      expandedEntryId: "",
      feedback: null,
      feedbackTimer: 0,
      actionPending: null,
      deleteConfirmEntryId: "",
      hasMore: false,
      identityPending: false,
      items: [],
      limit: 1000,
      loaded: false,
      loading: false,
      appliedQuery: "",
      searchTimer: 0,
      scope: "all",
      sortBy: "latest",
      source: "none",
      totalCount: 0,
    },
    observer: null,
    surfacePollTimer: 0,
    surfaceSignature: "",
    syncTimer: 0,
    routeWatchInstalled: false,
    routePollTimer: 0,
    routeRetryTimers: [],
    lastRouteKey: "",
    routeBaselineSignature: "",
    routeWaitStartedAt: 0,
    awaitingRouteMessages: false,
    uiPreferenceLock: null,
    lastError: "",
  };
  const promptHubState = namespace.promptHubState;
  const normalizePromptTab = (promptTabId) => promptHubState.normalizePromptTab(promptTabId);
  const getActivePromptTab = (reviewOpen = state.promptReview.open) => promptHubState.getActivePromptTab(state, reviewOpen);
  const isStoreTabActive = () => promptHubState.isStoreTabActive(state);
  const isPromptLibraryTabActive = () => promptHubState.isPromptLibraryTabActive(state);
  const shouldRunPromptCloudSync = () => promptHubState.shouldRunPromptCloudSync(state, {
    hasPendingPromptSync: (cloudSyncState) => namespace.cloudSync.hasPendingPromptSync(cloudSyncState),
    isToolSurface,
    visibilityState: document.visibilityState,
  });
  const releaseManager = namespace.releaseManager.create(state, { render });
  const cloudSyncManager = namespace.cloudSyncManager.create(state, { render });
  const {
    promptHubController,
    promptManager,
    promptRealtimeManager,
    promptReviewManager,
    storeManager,
  } = namespace.promptHubRuntime.create(state, {
    cloudSyncManager,
    getActivePromptTab,
    isToolSurface,
    lockUiPreferenceSelection,
    normalizePromptTab,
    onSelectPromptTab: () => meetingManager.scheduleSync(0),
    persistActiveTool,
    render,
  });
  const meetingManager = namespace.meetingManager.create(state, { render });
  const providerIdentitySync = namespace.providerIdentitySync.create(state, {
    isExtensionContextInvalidatedError,
    logPanelDebug,
    render,
  });
  const routeSync = namespace.routeSync.create(state, {
    ensureStoreLoaded: () => storeManager.ensureLoaded(),
    normalizeToolId,
    onRouteStateChanged: meetingManager.handleRouteStateChange,
    render,
  });
  bootstrapContent().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));
  async function bootstrapContent() {
    state.preferredOpen = readPanelOpenPreference();
    state.open = state.preferredOpen;
    void providerIdentitySync.syncToStorage("bootstrap");
    namespace.contentPanel.ensurePanel({
      onCopyBookmark: copyBookmarkText,
      onHandlePositionChange: updateHandlePosition,
      onImportFile: promptManager.handleImportFile,
      onJumpBookmark: jumpToBookmark,
      onMeetingAction: handleMeetingAction,
      onMovePrompt: promptHubController.movePromptItem,
      onPromptAction: promptHubController.handlePromptAction,
      onPromptDraftChange: promptManager.updateDraft,
      onSelectPromptTab: promptHubController.selectPromptTab,
      onReleaseAction: releaseManager.handleAction,
      onStoreAction: promptHubController.handleStoreAction,
      onEscape: promptHubController.handleEscape,
      onSearch: updateQuery,
      onSearchSubmit: submitQuery,
      onSelectTool: selectTool,
      onToggle: togglePanel,
    });
    syncPanelMeetingDebugValidationApi();
    namespace.composerReviewFloat?.ensure?.({
      buildState: buildPromptReviewFloatState,
      onAction: promptReviewManager.handleAction,
    });
    routeSync.installRouteWatchers();
    installSurfaceWatchers();
    global.addEventListener("resize", render, { passive: true });
    global.addEventListener("focus", handleWindowFocus, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
    chrome.storage.onChanged?.addListener(routeSync.handleStorageChange);
    chrome.storage.onChanged?.addListener(cloudSyncManager.handleStorageChange);
    chrome.storage.onChanged?.addListener(meetingManager.handleStorageChange);
    chrome.storage.onChanged?.addListener(releaseManager.handleStorageChange);
    chrome.runtime.onMessage?.addListener(providerIdentitySync.handleRuntimeMessage);
    namespace.panelDebug?.subscribe?.(() => {
      render();
    });
    await routeSync.syncRouteState(true);
    meetingManager.scheduleSync(260);
    promptRealtimeManager.scheduleSync(260);
    if (shouldRunPromptCloudSync()) {
      cloudSyncManager.scheduleSync(1800);
    }
    if (isStoreTabActive()) storeManager.ensureLoaded();
    if (state.open || state.activeTool === "release") releaseManager.ensureChecked(false, state.activeTool === "release");
    [450, 1200].forEach((delay) => global.setTimeout(routeSync.scheduleRefresh, delay));
  }
  function render() {
    syncMeetingDebugEnabled();
    const visible = state.settings.enabled && isToolSurface() && !isPaused();
    const bookmarkItems = getFilteredBookmarks();
    const promptItems = getFilteredPrompts();
    const promptRenderState = promptHubState.buildPromptRenderState({
      promptItems,
      promptManager,
      promptReviewManager,
      state,
      storeManager,
    });
    const meetingTool = buildMeetingToolState(state.meetingHub);
    const panelDebug = buildMeetingDebugState();
    const releaseState = releaseManager.buildViewState();
    const bookmarkCount = state.bookmarks.length;
    const promptCount = promptRenderState.promptCount;
    const meetingCount = meetingTool.count;
    const releaseCount = releaseState.updateAvailable ? 1 : 0;
    const storeCount = promptRenderState.storeCount;
    const promptToolCount = promptRenderState.promptToolCount;
    const toolCounts = {
      bookmarks: bookmarkCount,
      meeting: meetingCount,
      prompts: promptToolCount,
      release: releaseCount,
    };
    const activeToolCount = Object.prototype.hasOwnProperty.call(toolCounts, state.activeTool)
      ? toolCounts[state.activeTool]
      : 0;
    namespace.contentPanel.renderPanel({
      activeTool: state.activeTool,
      bookmarksTool: {
        activeId: state.activeId,
        emptyText: buildBookmarkEmptyText(),
        items: bookmarkItems,
        metaText: state.queries.bookmarks ? `검색 결과 ${bookmarkItems.length}개` : buildBookmarkStatusText(),
        query: state.queries.bookmarks,
      },
      handleCount: state.activeTool === "bookmarks"
        ? bookmarkCount || promptCount || meetingCount || releaseCount
        : activeToolCount,
      meetingTool,
      releaseTool: releaseState,
      handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
      open: state.open,
      panelDebug,
      promptTool: promptRenderState.promptTool,
      toolCount: activeToolCount,
      toolTitle: state.activeTool === "prompts"
        ? "프롬프트"
        : state.activeTool === "meeting"
            ? "회의록"
            : state.activeTool === "release"
                ? "릴리스 안내"
                : "대화 탐색",
      tools: [
        { id: "bookmarks", label: "대화", count: bookmarkCount },
        { id: "meeting", label: "회의", count: meetingCount },
        { id: "prompts", label: "프롬프트", count: promptCount },
        { id: "release", label: "릴리스", count: releaseCount },
      ],
      visible,
    });
    namespace.composerReviewFloat?.render?.(buildPromptReviewFloatState(visible));
  }
  function buildBookmarkEmptyText() { return state.queries.bookmarks ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요." : !state.settings.autoBookmark ? "팝업에서 대화 자동 모으기를 켜면 대화 탭을 사용할 수 있어요." : state.awaitingRouteMessages ? "이 대화의 흐름을 불러오는 중이에요." : "아직 대화가 없어요."; }
  function buildBookmarkStatusText() { return state.lastError ? "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요." : !state.settings.autoBookmark ? "대화 자동 모으기가 꺼져 있어요." : state.awaitingRouteMessages ? "대화를 불러오는 중" : !state.bookmarks.length ? "아직 대화가 없어요" : ""; }
  function getFilteredBookmarks() { const query = namespace.session.normalizeText(state.queries.bookmarks).toLowerCase(); return query ? state.bookmarks.filter((bookmark) => bookmark.normalizedText.includes(query)) : state.bookmarks; }
  function getFilteredPrompts() { const query = namespace.session.normalizeText(state.queries.prompts).toLowerCase(); return query ? state.promptLibrary.items.filter((item) => `${item.title} ${item.content}`.toLowerCase().includes(query)) : state.promptLibrary.items; }
  function updateQuery(toolId, value, options = {}) {
    const queryKey = toolId === "store" ? "store" : normalizeToolId(toolId);
    state.queries[queryKey] = value || "";
    if (toolId === "store") {
      storeManager.handleQueryChange(state.queries.store, options);
      return;
    }
    render();
  }
  function submitQuery(toolId, value) {
    const queryKey = toolId === "store" ? "store" : normalizeToolId(toolId);
    state.queries[queryKey] = value || "";
    if (toolId === "store") {
      storeManager.submitQuery(state.queries.store);
      return;
    }
    render();
  }
  async function selectTool(toolId) {
    if (toolId === "store") return void promptHubController.selectPromptTab("store");
    state.activeTool = normalizeToolId(toolId);
    const nextPromptTab = state.activeTool === "prompts" ? "library" : getActivePromptTab();
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
      activePromptTab: nextPromptTab,
      activeTool: state.activeTool,
    });
    lockUiPreferenceSelection(state.activeTool, nextPromptTab);
    if (state.activeTool === "prompts" && nextPromptTab === "store") storeManager.ensureLoaded();
    meetingManager.scheduleSync(state.activeTool === "meeting" ? 120 : 0);
    promptRealtimeManager.scheduleSync(120);
    if (state.activeTool === "release") releaseManager.ensureChecked(false, true);
    render();
    await persistActiveTool(state.activeTool, nextPromptTab);
  }
  async function persistActiveTool(nextTool = state.activeTool, nextPromptTab = getActivePromptTab()) {
    try {
      state.uiPreferences = await namespace.storage.updateUiPreferences({
        activePromptTab: normalizePromptTab(nextPromptTab),
        activeTool: normalizeToolId(nextTool),
      });
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        return;
      }
      console.error("[i-Nova Bookmarks] active tool save failed", error);
    }
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
      activeTool: state.activeTool,
      handleRatios: { [bucket]: handleRatio },
    });
    render();
    try {
      await namespace.storage.updateUiPreferences({
        activeTool: state.activeTool,
        handleRatios: { [bucket]: handleRatio },
      });
    } catch (error) {
      console.error("[i-Nova Bookmarks] handle position save failed", error);
    }
  }
  async function handleMeetingAction(action, detail = {}) {
    if (action === "debug-toggle") {
      toggleMeetingDebugCollapsed();
      return;
    }
    if (action === "debug-copy") {
      await copyMeetingDebugEntries(false);
      return;
    }
    if (action === "debug-copy-errors") {
      await copyMeetingDebugEntries(true);
      return;
    }
    if (action === "debug-clear") {
      namespace.panelDebug?.clearEntries?.();
      setPanelDebugFeedback("디버그 로그를 비웠습니다.", "info", 1600);
      return;
    }
    if (namespace.session.normalizeText(state.meetingUi.pending.action)) {
      return;
    }
    const providerIdentity = namespace.providerIdentity.getCurrent();
    await providerIdentitySync.syncToStorage(`meeting-action:${action}`, providerIdentity);
    const input = {
      jobId: namespace.session.normalizeText(detail.jobId),
      meetingId: namespace.session.normalizeText(detail.meetingId),
      title: namespace.session.normalizeText(detail.title || state.sessionTitle),
    };
    const pendingAction = action === "open-result"
      ? "open-result"
      : action === "share"
        ? "share"
        : action === "revoke-share"
          ? "revoke-share"
          : "open-workspace";
    setMeetingPending({
      action: pendingAction,
      jobId: input.jobId,
      meetingId: input.meetingId,
      startedAt: Date.now(),
      title: input.title,
    });
    logMeetingAction("click", {
      action,
      jobId: input.jobId,
      meetingId: input.meetingId,
      providerUserKey: namespace.session.normalizeText(providerIdentity?.providerUserKey),
      title: input.title,
    });
    try {
      if (action === "open-result" && (input.meetingId || input.jobId)) {
        const result = await namespace.meetingBridge.openMeetingResult(input, providerIdentity);
        logMeetingAction("success", {
          action,
          jobId: input.jobId,
          meetingId: input.meetingId,
          opened: Boolean(result?.opened),
          url: namespace.session.normalizeText(result?.url),
        });
        setMeetingFeedback("결과 탭을 열었습니다.", "info", 1800);
        return;
      }
      if (action === "share" && input.meetingId) {
        const result = await namespace.meetingBridge.createMeetingShareLink(input, providerIdentity);
        const shareUrl = namespace.session.normalizeText(result?.shareUrl);
        if (!shareUrl) {
          throw new Error("공유 링크를 만들지 못했어요.");
        }
        await navigator.clipboard.writeText(shareUrl);
        logMeetingAction("success", {
          action,
          meetingId: input.meetingId,
          shareUrl,
        });
        setMeetingFeedback("공유 링크를 복사했습니다.", "info", 2200);
        meetingManager.scheduleSync(0);
        return;
      }
      if (action === "revoke-share" && input.meetingId) {
        await namespace.meetingBridge.revokeMeetingShareLink(input, providerIdentity);
        logMeetingAction("success", {
          action,
          meetingId: input.meetingId,
        });
        setMeetingFeedback("공유 링크를 해제했습니다.", "info", 2200);
        meetingManager.scheduleSync(0);
        return;
      }
      const result = await namespace.meetingBridge.openMeetingWorkspace(input, providerIdentity);
      logMeetingAction("success", {
        action: "open-workspace",
        jobId: input.jobId,
        meetingId: input.meetingId,
        opened: Boolean(result?.opened),
        url: namespace.session.normalizeText(result?.url),
      });
      setMeetingFeedback("작업실 탭을 열었습니다.", "info", 1800);
    } catch (error) {
      logMeetingAction("error", {
        action,
        error: error instanceof Error ? error.message : String(error || ""),
        jobId: input.jobId,
        meetingId: input.meetingId,
      });
      if (namespace.panelDebug?.isEnabled?.()) {
        console.error("[i-Nova Bookmarks] meeting page open failed", error);
      }
      setMeetingFeedback(error instanceof Error ? error.message : "작업실을 열지 못했어요. 다시 시도해 주세요.", "error", 3600);
    } finally {
      clearMeetingPending();
    }
  }
  function setMeetingPending(pending) {
    state.meetingUi.pending = {
      action: namespace.session.normalizeText(pending?.action),
      jobId: namespace.session.normalizeText(pending?.jobId),
      meetingId: namespace.session.normalizeText(pending?.meetingId),
      startedAt: Math.max(0, Number(pending?.startedAt) || Date.now()),
      title: namespace.session.normalizeText(pending?.title),
    };
    render();
  }
  function clearMeetingPending() {
    state.meetingUi.pending = { action: "", jobId: "", meetingId: "", startedAt: 0, title: "" };
    render();
  }
  function setMeetingFeedback(text, tone = "info", timeoutMs = 2200) {
    global.clearTimeout(state.meetingUi.feedbackTimer);
    const nextText = namespace.session.normalizeText(text);
    state.meetingUi.feedback = nextText
      ? {
          text: nextText,
          tone: namespace.session.normalizeText(tone) || "info",
        }
      : null;
    render();
    if (!nextText || timeoutMs <= 0) {
      state.meetingUi.feedbackTimer = 0;
      return;
    }
    state.meetingUi.feedbackTimer = global.setTimeout(() => {
      state.meetingUi.feedback = null;
      state.meetingUi.feedbackTimer = 0;
      render();
    }, timeoutMs);
  }
  function syncMeetingDebugEnabled() {
    namespace.panelDebug?.setEnabled?.(shouldEnableMeetingDebug());
  }
  function shouldEnableMeetingDebug() {
    return Boolean(
      namespace.panelDebug?.isLocalDebugEnabled?.(state.settings)
      && state.settings.enabled
      && isToolSurface()
      && !isPaused()
      && document.visibilityState === "visible"
    );
  }
  function buildMeetingDebugState() {
    const enabled = shouldEnableMeetingDebug();
    const entries = enabled ? (namespace.panelDebug?.getEntries?.() || []) : [];
    const summary = enabled
      ? (namespace.panelDebug?.summarizeEntries?.(entries) || {})
      : {};
    const statusSummary = {
      errorCount: Math.max(0, Number(summary?.errorCount) || 0),
      functionCalls: Math.max(0, Number(summary?.functionCalls) || 0),
      readCount: Math.max(0, Number(summary?.readCount) || 0),
      snapshotCount: Math.max(0, Number(summary?.snapshotCount) || 0),
      totalLogs: Math.max(0, Number(entries.length) || 0),
    };
    return namespace.meetingDebugConsole?.buildState?.({
      collapsed: Boolean(state.panelDebugUi.collapsed),
      enabled,
      feedback: normalizePanelDebugFeedback(state.panelDebugUi.feedback),
      hasErrors: statusSummary.errorCount > 0,
      statusSummary,
      text: enabled
        ? (namespace.panelDebug?.buildCopyText?.(entries) || "아직 로그가 없습니다.")
        : "",
    }) || {
      collapsed: Boolean(state.panelDebugUi.collapsed),
      enabled,
      feedback: normalizePanelDebugFeedback(state.panelDebugUi.feedback),
      hasErrors: statusSummary.errorCount > 0,
      statusSummary,
      statusText: enabled
        ? `로그 ${statusSummary.totalLogs}건 · 함수 ${statusSummary.functionCalls}건 · 읽기 ${statusSummary.readCount}건 · 스냅샷 ${statusSummary.snapshotCount}건 · 오류 ${statusSummary.errorCount}건`
        : "로그 0건 · 함수 0건 · 읽기 0건 · 스냅샷 0건 · 오류 0건",
      text: enabled
        ? (namespace.panelDebug?.buildCopyText?.(entries) || "아직 로그가 없습니다.")
        : "",
    };
  }
  function buildPanelMeetingDebugButtonsSnapshot(debugLayer) {
    const buttons = debugLayer?.querySelectorAll?.("[data-meeting-action]");
    return Array.from(buttons || [])
      .map((button) => ({
        action: namespace.session.normalizeText(button?.dataset?.meetingAction),
        disabled: Boolean(button?.disabled),
        label: namespace.session.normalizeText(button?.textContent),
      }))
      .filter((button) => button.action.startsWith("debug-"));
  }
  function buildPanelMeetingDebugStateSnapshot(entries = namespace.panelDebug?.getEntries?.() || []) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const debugState = buildMeetingDebugState();
    const debugLayer = document.getElementById("inova-meeting-debug-layer");
    const logElement = debugLayer?.querySelector?.(".inova-meeting-debug-console__log");
    const feedbackElement = debugLayer?.querySelector?.(".inova-meeting-debug-console__feedback");
    const statusElement = debugLayer?.querySelector?.(".inova-meeting-debug-console__status");
    return {
      buttons: buildPanelMeetingDebugButtonsSnapshot(debugLayer),
      collapsed: Boolean(debugState?.collapsed),
      enabled: Boolean(debugState?.enabled),
      entryCount: normalizedEntries.length,
      feedback: normalizePanelDebugFeedback(debugState?.feedback),
      hasErrors: Boolean(debugState?.hasErrors),
      hasFabBadge: Boolean(debugLayer?.querySelector?.(".inova-meeting-debug-fab__badge")),
      hasFabButton: Boolean(debugLayer?.querySelector?.(".inova-meeting-debug-fab[data-meeting-action=\"debug-toggle\"]")),
      hasLog: Boolean(logElement),
      logText: namespace.session.normalizeText(logElement?.textContent || debugState?.text),
      noticeText: namespace.session.normalizeText(feedbackElement?.textContent || debugState?.feedback?.text),
      rendered: Boolean(debugLayer && debugLayer.innerHTML),
      statusText: namespace.session.normalizeText(statusElement?.getAttribute("aria-label") || debugState?.statusText),
    };
  }
  function buildPanelMeetingDebugValidationChecks(snapshot) {
    const checks = [
      {
        label: "panel meeting debug console이 활성화됨",
        passed: Boolean(snapshot?.enabled),
        actual: snapshot?.enabled ? "enabled" : "disabled",
      },
      {
        label: "panel debug console markup이 렌더됨",
        passed: Boolean(snapshot?.rendered),
        actual: snapshot?.rendered ? "rendered" : "empty",
      },
    ];
    const actions = Array.isArray(snapshot?.buttons)
      ? snapshot.buttons.map((button) => namespace.session.normalizeText(button?.action)).filter(Boolean)
      : [];
    if (snapshot?.collapsed) {
      checks.push(
        {
          label: "collapsed 상태에서는 debug toggle fab만 보임",
          passed: actions.length === 1 && actions[0] === "debug-toggle" && Boolean(snapshot?.hasFabButton),
          actual: actions.join(","),
        },
        {
          label: "오류가 있으면 fab badge가 보임",
          passed: !snapshot?.hasErrors || Boolean(snapshot?.hasFabBadge),
          actual: snapshot?.hasFabBadge ? "badge" : "no-badge",
        }
      );
      return checks;
    }
    const requiredActions = ["debug-copy", "debug-copy-errors", "debug-clear", "debug-toggle"];
    checks.push(
      {
        label: "expanded 버튼 4종이 모두 렌더됨",
        passed: requiredActions.every((action) => actions.includes(action)),
        actual: actions.join(","),
      },
      {
        label: "status text가 비어 있지 않음",
        passed: Boolean(namespace.session.normalizeText(snapshot?.statusText)),
        actual: namespace.session.normalizeText(snapshot?.statusText),
      },
      {
        label: "log text가 비어 있지 않음",
        passed: Boolean(namespace.session.normalizeText(snapshot?.logText)),
        actual: namespace.session.normalizeText(snapshot?.logText).slice(0, 120),
      }
    );
    return checks;
  }
  function validatePanelMeetingDebugConsole() {
    const snapshot = buildPanelMeetingDebugStateSnapshot();
    const checks = buildPanelMeetingDebugValidationChecks(snapshot);
    return {
      checks,
      collapsed: Boolean(snapshot?.collapsed),
      entryCount: Math.max(0, Number(snapshot?.entryCount) || 0),
      passed: checks.every((check) => Boolean(check?.passed)),
      snapshot,
    };
  }
  function syncPanelMeetingDebugValidationApi() {
    namespace.panelDebugValidation = {
      check: validatePanelMeetingDebugConsole,
      state: buildPanelMeetingDebugStateSnapshot,
    };
  }
  function toggleMeetingDebugCollapsed() {
    state.panelDebugUi.collapsed = !state.panelDebugUi.collapsed;
    writeMeetingDebugCollapsed(state.panelDebugUi.collapsed);
    render();
  }
  async function copyMeetingDebugEntries(errorsOnly) {
    const entries = namespace.panelDebug?.getEntries?.() || [];
    const text = errorsOnly
      ? namespace.panelDebug?.buildErrorCopyText?.(entries)
      : namespace.panelDebug?.buildCopyText?.(entries);
    if (!namespace.session.normalizeText(text)) {
      setPanelDebugFeedback(errorsOnly ? "복사할 디버그 오류 로그가 없습니다." : "복사할 디버그 로그가 없습니다.", "info", 1600);
      return;
    }
    try {
      await global.navigator.clipboard.writeText(text);
      setPanelDebugFeedback(errorsOnly ? "디버그 오류 로그를 복사했습니다." : "디버그 로그를 복사했습니다.", "info", 1800);
    } catch (error) {
      setPanelDebugFeedback("클립보드에 디버그 로그를 복사하지 못했습니다.", "error", 2200);
      namespace.panelDebug?.log?.("panel.debug.copy.error", {
        error: error instanceof Error ? error.message : String(error || ""),
        errorsOnly: Boolean(errorsOnly),
      });
    }
  }
  function setPanelDebugFeedback(text, tone = "info", timeoutMs = 1800) {
    global.clearTimeout(state.panelDebugUi.feedbackTimer);
    const nextText = namespace.session.normalizeText(text);
    state.panelDebugUi.feedback = nextText
      ? {
          text: nextText,
          tone: namespace.session.normalizeText(tone) || "info",
        }
      : null;
    render();
    if (!nextText || timeoutMs <= 0) {
      state.panelDebugUi.feedbackTimer = 0;
      return;
    }
    state.panelDebugUi.feedbackTimer = global.setTimeout(() => {
      state.panelDebugUi.feedback = null;
      state.panelDebugUi.feedbackTimer = 0;
      render();
    }, timeoutMs);
  }
  function normalizePanelDebugFeedback(feedback) {
    const text = namespace.session.normalizeText(feedback?.text);
    return {
      text,
      tone: namespace.session.normalizeText(feedback?.tone) || "info",
    };
  }
  function isExtensionContextInvalidatedError(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return message.includes("extension context invalidated");
  }
  function logMeetingAction(event, payload) {
    namespace.panelDebug?.log?.(`panel.action.${namespace.session.normalizeText(event)}`, payload || {});
  }
  function logPanelDebug(event, payload) {
    namespace.panelDebug?.log?.(event, payload || {});
  }
  function togglePanel(nextOpen, persist = true) {
    state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
    if (persist) {
      state.preferredOpen = state.open;
      writePanelOpenPreference(state.open);
    }
    if (shouldRunPromptCloudSync()) cloudSyncManager.scheduleSync(220);
    meetingManager.scheduleSync(state.open ? 220 : 0);
    promptRealtimeManager.scheduleSync(state.open ? 220 : 0);
    if (state.open && isStoreTabActive()) storeManager.ensureLoaded();
    if (state.open) releaseManager.ensureChecked(false, state.activeTool === "release");
    logPanelDebug("panel.ui.toggle", {
      open: state.open,
      scope: "panel-ui",
      tool: "panel",
    });
    render();
  }
  function jumpToBookmark(bookmarkId) {
    state.activeId = bookmarkId;
    namespace.contentPanel.setActiveBookmark(bookmarkId);
    namespace.contentPanel.focusBookmark(bookmarkId);
    namespace.contentDom.scrollToMessage(bookmarkId, { block: "start", behavior: "smooth" });
  }
  function isPaused() {
    return Boolean(state.sessionId && state.pausedSessions[state.sessionId]);
  }
  function readPanelOpenPreference() {
    try {
      const saved = global.sessionStorage?.getItem(PANEL_OPEN_KEY);
      return saved == null ? false : saved === "true";
    } catch (error) {
      console.warn("[i-Nova Bookmarks] panel open preference read failed", error);
      return false;
    }
  }
  function readMeetingDebugCollapsed() {
    try {
      return global.localStorage?.getItem(MEETING_DEBUG_COLLAPSED_KEY) !== "0";
    } catch (error) {
      console.warn("[i-Nova Bookmarks] meeting debug collapsed read failed", error);
      return true;
    }
  }
  function writeMeetingDebugCollapsed(collapsed) {
    try {
      global.localStorage?.setItem(MEETING_DEBUG_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch (error) {
      console.warn("[i-Nova Bookmarks] meeting debug collapsed write failed", error);
    }
  }
  function writePanelOpenPreference(open) {
    try {
      global.sessionStorage?.setItem(PANEL_OPEN_KEY, String(Boolean(open)));
    } catch (error) {
      console.warn("[i-Nova Bookmarks] panel open preference write failed", error);
    }
  }
  function normalizeToolId(toolId) {
    return toolId === "release" || toolId === "prompts" || toolId === "meeting"
      ? toolId
      : toolId === "store"
          ? "prompts"
          : "bookmarks";
  }
  function lockUiPreferenceSelection(activeTool, activePromptTab) {
    state.uiPreferenceLock = {
      activePromptTab: normalizePromptTab(activePromptTab),
      activeTool: normalizeToolId(activeTool),
      until: Date.now() + UI_PREFERENCE_LOCK_MS,
    };
  }
  function isToolSurface() { return namespace.contentDom.getConversationState().hasComposer; }
  function buildPromptReviewFloatState(visible = state.settings.enabled && isToolSurface() && !isPaused()) {
    return {
      ...promptReviewManager.buildViewState(),
      visible,
    };
  }
  function installSurfaceWatchers() {
    state.surfaceSignature = getSurfaceSignature();
    if (state.surfacePollTimer) global.clearInterval(state.surfacePollTimer);
    state.surfacePollTimer = global.setInterval(() => {
      const nextSignature = getSurfaceSignature();
      if (nextSignature === state.surfaceSignature) return;
      const previousSurface = parseSurfaceSignature(state.surfaceSignature);
      const nextSurface = parseSurfaceSignature(nextSignature);
      const hadComposer = previousSurface.hasComposer;
      const hasComposer = nextSurface.hasComposer;
      state.surfaceSignature = nextSignature;
      if (!hadComposer && hasComposer && state.preferredOpen) state.open = true;
      if (!hadComposer && hasComposer && isStoreTabActive()) storeManager.ensureLoaded();
      meetingManager.scheduleSync(hasComposer ? 120 : 0);
      promptRealtimeManager.scheduleSync(120);
      if (previousSurface.hasComposer !== nextSurface.hasComposer || previousSurface.hasChatLog !== nextSurface.hasChatLog) {
        logPanelDebug("panel.ui.surface.changed", {
          hadChatLog: previousSurface.hasChatLog,
          hadComposer,
          hasChatLog: nextSurface.hasChatLog,
          hasComposer,
          scope: "panel-ui",
          tool: "panel",
        });
      }
      render();
    }, 600);
  }
  function getSurfaceSignature() {
    const conversation = namespace.contentDom.getConversationState();
    return `${conversation.hasComposer}|${conversation.hasChatLog}|${conversation.articleCount}|${conversation.userCount}`;
  }
  function parseSurfaceSignature(signature) {
    const [hasComposer, hasChatLog] = String(signature || "").split("|");
    return {
      hasChatLog: hasChatLog === "true",
      hasComposer: hasComposer === "true",
    };
  }
  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      meetingManager.scheduleSync(0);
      promptRealtimeManager.scheduleSync(0);
      logPanelDebug("panel.ui.visibility.hidden", {
        scope: "panel-ui",
        tool: "panel",
      });
      render();
      return;
    }
    void providerIdentitySync.syncToStorage("visibility-visible");
    if (shouldRunPromptCloudSync()) {
      cloudSyncManager.scheduleSync(320);
    }
    meetingManager.scheduleSync(320);
    promptRealtimeManager.scheduleSync(320);
    if (state.open) releaseManager.ensureChecked();
    logPanelDebug("panel.ui.visibility.visible", {
      scope: "panel-ui",
      tool: "panel",
    });
    render();
  }
  function handleWindowFocus() {
    void providerIdentitySync.syncToStorage("window-focus");
    if (shouldRunPromptCloudSync()) {
      cloudSyncManager.scheduleSync(320);
    }
    meetingManager.scheduleSync(320);
    promptRealtimeManager.scheduleSync(320);
    if (state.open) releaseManager.ensureChecked();
    logPanelDebug("panel.ui.focus", {
      scope: "panel-ui",
      tool: "panel",
    });
    render();
  }
  function buildMeetingToolState(meetingHub) {
    const normalized = namespace.meetingManager.mergeMeetingHub(meetingHub);
    return {
      ...normalized,
      count: Array.isArray(normalized.items) ? normalized.items.length : 0,
      feedback: state.meetingUi.feedback,
      pending: state.meetingUi.pending,
    };
  }
})(globalThis);
