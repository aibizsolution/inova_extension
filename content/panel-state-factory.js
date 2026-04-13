(function initPanelStateFactory(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function createMeetingUiState() {
    return {
      feedback: null,
      feedbackTimer: 0,
      pending: { action: "", jobId: "", meetingId: "", startedAt: 0, title: "" },
    };
  }

  function createMeetingSummaryState() {
    return {
      count: 0,
      snapshotFingerprint: "",
    };
  }

  function createReleaseSummaryState() {
    return {
      count: 0,
      snapshotFingerprint: "",
    };
  }

  function createPanelDebugUiState() {
    return {
      collapsed: true,
      feedback: null,
      feedbackTimer: 0,
    };
  }

  function createPromptEditorState() {
    return { open: false, mode: "create", id: "", title: "", content: "", error: "" };
  }

  function createStoreState() {
    return {
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
      renderKey: 0,
      renderLimit: 20,
      loaded: false,
      loading: false,
      appliedQuery: "",
      searchTimer: 0,
      scope: "all",
      sortBy: "latest",
      source: "none",
      totalCount: 0,
    };
  }

  function createState() {
    return {
      sessionId: "",
      sessionTitle: "",
      open: false,
      preferredOpen: false,
      activeId: "",
      activeTool: namespace.constants.defaults.uiPreferences.activeTool,
      queries: { bookmarks: "", prompts: "", store: "" },
      settings: { ...namespace.constants.defaults.settings },
      settingsHydrated: false,
      pausedSessions: {},
      meetingSummary: createMeetingSummaryState(),
      releaseSummary: createReleaseSummaryState(),
      meetingHub: { ...namespace.constants.defaults.meetingHub },
      meetingUi: createMeetingUiState(),
      panelDebugUi: createPanelDebugUiState(),
      cloudSync: namespace.cloudSync.mergeCloudSyncState(),
      uiPreferences: namespace.storage.mergeUiPreferences(),
      promptLibraryLoading: false,
      promptLibraryRemoteReady: false,
      promptLibrary: namespace.promptLibrary.mergePromptLibrary(),
      promptEditor: createPromptEditorState(),
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
      store: createStoreState(),
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
  }

  namespace.panelStateFactory = { createState };
})(globalThis);
