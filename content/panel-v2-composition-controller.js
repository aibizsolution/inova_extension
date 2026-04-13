(function initPanelV2CompositionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state) {
    let hostedOwnedPromptController = null;
    let renderController = null;
    const render = () => renderController?.render();

    // v2 shell baseline keeps the shared extension-side runtime wiring.
    const panelRuntimeController = namespace.panelRuntimeController.create(state);
    const runtimeFlags = {
      isPaused: panelRuntimeController.isPaused,
      isStoreTabActive: panelRuntimeController.isStoreTabActive,
      isToolSurface: panelRuntimeController.isToolSurface,
    };
    const runtimeDiagnostics = {
      isExtensionContextInvalidatedError: panelRuntimeController.isExtensionContextInvalidatedError,
      logPanelDebug: panelRuntimeController.logPanelDebug,
    };
    const hostedOwnedIdleMeetingLifecycle = createHostedOwnedIdleMeetingLifecycleBridge();
    const hostedOwnedIdleReleaseLifecycle = createHostedOwnedIdleReleaseLifecycleBridge();
    const hostedOwnedReleaseSnapshot = createHostedOwnedReleaseSnapshotBridge(() => state.releaseSummary);
    const providerIdentitySync = namespace.providerIdentitySync.create(state, {
      ...runtimeDiagnostics,
      render,
    });
    const hostedOwnedMeetingSnapshot = createHostedOwnedMeetingSnapshotBridge();
    const panelDebugController = namespace.panelDebugController.create(state, {
      ...runtimeFlags,
      render,
    });
    const hostedOwnedConversationBridge = createHostedOwnedConversationBridge(state, { render });
    const panelShellController = namespace.panelShellController.create(state, {
      bookmarkController: hostedOwnedConversationBridge,
      getPromptController: () => hostedOwnedPromptController,
      isExtensionContextInvalidatedError: runtimeDiagnostics.isExtensionContextInvalidatedError,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      releaseManager: hostedOwnedIdleReleaseLifecycle,
      render,
    });
    const sharedPromptController = namespace.panelV2PromptController.create(state, {
      ...runtimeFlags,
      lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
      onPromptTabSelected: () => hostedOwnedIdleMeetingLifecycle.scheduleSync(0),
      persistActiveTool: panelShellController.persistActiveTool,
      render,
    });
    const hostedOwnedPromptSnapshot = createHostedOwnedPromptSnapshotBridge();
    hostedOwnedPromptController = createHostedOwnedPromptController(sharedPromptController);
    const promptSyncBridge = {
      ensureStoreLoaded: hostedOwnedPromptController.ensureStoreLoaded,
      schedulePromptCloudSyncIfNeeded: hostedOwnedPromptController.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: hostedOwnedPromptController.schedulePromptRealtimeSync,
    };

    const routeStateController = namespace.routeStateController.create(state, {
      applyUiPreferenceLock: panelShellController.applyUiPreferenceLock,
      ensureStoreLoaded: promptSyncBridge.ensureStoreLoaded,
      normalizeToolId: panelShellController.normalizeToolId,
    });
    const panelLifecycleController = namespace.panelLifecycleController.create(state, {
      ensureStoreLoaded: promptSyncBridge.ensureStoreLoaded,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      releaseManager: hostedOwnedIdleReleaseLifecycle,
      render,
      schedulePromptCloudSyncIfNeeded: promptSyncBridge.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
    });
    const panelActivityController = namespace.panelActivityController.create(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      providerIdentitySync,
      releaseManager: hostedOwnedIdleReleaseLifecycle,
      render,
      schedulePromptCloudSyncIfNeeded: promptSyncBridge.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
    });
    const panelSurfaceController = namespace.panelSurfaceController.create(state, {
      ensureStoreLoaded: promptSyncBridge.ensureStoreLoaded,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      render,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
    });
    const routeSync = namespace.routeSync.create(state, {
      onRouteStateChanged: hostedOwnedIdleMeetingLifecycle.handleRouteStateChange,
      refreshState: routeStateController.refreshState,
      render,
      resetRouteState: routeStateController.resetRouteState,
    });
    const routeWatchController = namespace.routeWatchController.create(state, {
      scheduleRouteSync: routeSync.scheduleRouteSync,
    });

    renderController = namespace.panelRenderController.create(state, {
      isPaused: runtimeFlags.isPaused,
      isToolSurface: runtimeFlags.isToolSurface,
      buildConversationSnapshot: hostedOwnedConversationBridge.buildConversationSnapshot,
      getConversationCount: hostedOwnedConversationBridge.getConversationCount,
      buildPromptSnapshot: hostedOwnedPromptSnapshot.buildPromptSnapshot,
      getPromptCounts: hostedOwnedPromptSnapshot.getPromptCounts,
      buildMeetingSnapshot: hostedOwnedMeetingSnapshot.buildMeetingSnapshot,
      getMeetingCount: hostedOwnedMeetingSnapshot.getMeetingCount,
      panelDebugController,
      panelPromptController: hostedOwnedPromptController,
      panelShellController,
      buildReleaseSnapshot: hostedOwnedReleaseSnapshot.buildReleaseSnapshot,
      getReleaseCount: hostedOwnedReleaseSnapshot.getReleaseCount,
    });
    const panelBootstrapController = namespace.panelBootstrapController.create(state, {
      buildHostedPanelCallbacks: buildHostedOwnedPanelCallbacks,
      handlePanelMeetingSummarySync: handleHostedMeetingSummarySync,
      handlePanelReleaseSummarySync: handleHostedReleaseSummarySync,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      shouldListenMeetingStorageChanges: () => false,
      shouldPrimeMeetingSync: () => false,
      panelActivityController,
      panelBookmarkController: hostedOwnedConversationBridge,
      panelDebugController,
      panelLifecycleController,
      panelPromptController: hostedOwnedPromptController,
      panelShellController,
      panelSurfaceController,
      providerIdentitySync,
      releaseManager: hostedOwnedIdleReleaseLifecycle,
      render,
      routeStateController,
      routeSync,
      routeWatchController,
    });

    return {
      bootstrap() {
        return panelBootstrapController.bootstrap();
      },
    };

    function handleHostedMeetingSummarySync(meetingTool = {}) {
      const nextSummary = normalizeHostedMeetingSummary(meetingTool);
      if (buildMeetingSummaryKey(state.meetingSummary) === buildMeetingSummaryKey(nextSummary)) {
        return false;
      }
      state.meetingSummary = nextSummary;
      render();
      return true;
    }

    function handleHostedReleaseSummarySync(releaseTool = {}) {
      const nextSummary = normalizeHostedReleaseSummary(releaseTool);
      if (buildReleaseSummaryKey(state.releaseSummary) === buildReleaseSummaryKey(nextSummary)) {
        return false;
      }
      state.releaseSummary = nextSummary;
      render();
      return true;
    }

    function buildHostedOwnedPanelCallbacks(deps = {}) {
      const panelBookmarkController = deps.panelBookmarkController || { copyBookmarkText() {}, jumpToBookmark() {} };
      const panelLifecycleController = deps.panelLifecycleController || { togglePanel() {} };
      const panelPromptController = deps.panelPromptController || { handleEscape() {} };
      const panelShellController = deps.panelShellController || {
        selectTool() {},
        submitQuery() {},
        updateHandlePosition() {},
        updateQuery() {},
      };
      const releaseManager = deps.releaseManager || { handleAction() {} };
      const handlePanelMeetingSummarySync = typeof deps.handlePanelMeetingSummarySync === "function"
        ? deps.handlePanelMeetingSummarySync
        : async () => false;
      const handlePanelReleaseSummarySync = typeof deps.handlePanelReleaseSummarySync === "function"
        ? deps.handlePanelReleaseSummarySync
        : async () => false;

      return {
        onCopyBookmark: panelBookmarkController.copyBookmarkText,
        onHandlePositionChange: panelShellController.updateHandlePosition,
        onJumpBookmark: panelBookmarkController.jumpToBookmark,
        onMeetingSummarySync: handlePanelMeetingSummarySync,
        onReleaseSummarySync: handlePanelReleaseSummarySync,
        onReleaseAction: releaseManager.handleAction,
        onSearch: panelShellController.updateQuery,
        onSearchSubmit: panelShellController.submitQuery,
        onSelectTool: panelShellController.selectTool,
        onEscape: panelPromptController.handleEscape,
        onToggle: panelLifecycleController.togglePanel,
      };
    }
  }

  function createHostedOwnedIdleMeetingLifecycleBridge() {
    return {
      handleRouteStateChange() {
        return false;
      },
      handleStorageChange() {},
      scheduleSync() {
        return false;
      },
    };
  }

  function createHostedOwnedIdleReleaseLifecycleBridge() {
    return {
      buildViewState() {
        return {
          count: 0,
          snapshotFingerprint: "",
          updateAvailable: false,
        };
      },
      handleAction() {
        return false;
      },
      handleStorageChange() {},
      ensureChecked() {
        return false;
      },
    };
  }

  function createHostedOwnedMeetingSnapshotBridge() {
    return {
      buildMeetingSnapshot(meetingSummary) {
        const meetingTool = normalizeHostedMeetingSummary(meetingSummary);
        return {
          count: getMeetingCount(meetingTool),
          snapshotFingerprint: buildMeetingSnapshotFingerprint(meetingTool),
        };
      },
      getMeetingCount,
    };

    function getMeetingCount(meetingTool = {}) {
      return Math.max(0, Number(meetingTool.count) || 0);
    }

    function buildMeetingSnapshotFingerprint(meetingTool = {}) {
      const explicitFingerprint = normalizeText(meetingTool?.snapshotFingerprint);
      if (explicitFingerprint) {
        return explicitFingerprint;
      }
      return String(getMeetingCount(meetingTool));
    }
  }

  function createHostedOwnedPromptController(panelPromptController = {}) {
    return {
      ...panelPromptController,
      ensureStoreLoaded() {},
      handleStorageChange() {},
      scheduleCloudSyncIfNeeded() {},
      scheduleRealtimeSync() {},
    };
  }

  function createHostedOwnedPromptSnapshotBridge() {
    return {
      buildPromptSnapshot(promptToolState = {}) {
        const promptTool = promptToolState?.promptTool && typeof promptToolState.promptTool === "object"
          ? promptToolState.promptTool
          : {};
        return {
          activeTab: normalizeText(promptTool.activeTab) || "library",
          review: normalizePromptReviewSnapshot(promptTool.review),
        };
      },
      getPromptCounts(promptToolState = {}) {
        return {
          promptCount: Math.max(0, Number(promptToolState.promptCount) || 0),
          promptToolCount: Math.max(0, Number(promptToolState.promptToolCount) || 0),
        };
      },
    };
  }

  function createHostedOwnedConversationBridge(state, deps = {}) {
    const render = typeof deps.render === "function" ? deps.render : () => {};

    return {
      buildToolState,
      buildConversationSnapshot() {
        const bookmarkTool = buildToolState();
        return {
          activeId: normalizeText(bookmarkTool.activeId),
          count: getConversationCount(bookmarkTool),
          snapshotFingerprint: buildSnapshotFingerprint(bookmarkTool),
        };
      },
      copyBookmarkText,
      getConversationCount,
      jumpToBookmark,
      submitQuery,
      updateQuery,
    };

    function buildToolState() {
      const items = getFilteredBookmarks();
      return {
        activeId: state.activeId,
        count: Array.isArray(state.bookmarks) ? state.bookmarks.length : 0,
        emptyText: buildEmptyText(),
        items,
        metaText: state.queries.bookmarks ? `검색 결과 ${items.length}개` : buildStatusText(),
        query: state.queries.bookmarks,
      };
    }

    async function copyBookmarkText(bookmarkId) {
      const bookmark = Array.isArray(state.bookmarks)
        ? state.bookmarks.find((entry) => normalizeText(entry?.id) === normalizeText(bookmarkId))
        : null;
      const writeText = global.navigator?.clipboard?.writeText;
      if (!bookmark?.text) {
        return false;
      }
      if (typeof writeText !== "function") {
        return false;
      }
      try {
        await writeText.call(global.navigator.clipboard, bookmark.text);
        return true;
      } catch (error) {
        console.error("[i-Nova Bookmarks] copy failed", error);
        return false;
      }
    }

    function getConversationCount(bookmarkTool = {}) {
      return Math.max(
        0,
        Number(bookmarkTool.count) || (Array.isArray(bookmarkTool.items) ? bookmarkTool.items.length : 0)
      );
    }

    function jumpToBookmark(bookmarkId) {
      const normalizedBookmarkId = normalizeText(bookmarkId);
      state.activeId = normalizedBookmarkId;
      namespace.contentPanel?.setActiveBookmark?.(normalizedBookmarkId);
      namespace.contentPanel?.focusBookmark?.(normalizedBookmarkId);
      namespace.contentDom?.scrollToMessage?.(normalizedBookmarkId, { behavior: "smooth", block: "start" });
      return true;
    }

    function submitQuery(value) {
      state.queries.bookmarks = value || "";
      render();
      return true;
    }

    function updateQuery(value) {
      state.queries.bookmarks = value || "";
      render();
      return true;
    }

    function buildSnapshotFingerprint(bookmarkTool = {}) {
      const items = Array.isArray(bookmarkTool.items) ? bookmarkTool.items : [];
      return [
        normalizeText(bookmarkTool.activeId),
        String(getConversationCount(bookmarkTool)),
        normalizeText(items[0]?.id),
        normalizeText(items.at?.(-1)?.id),
      ].join("|");
    }

    function buildEmptyText() {
      return state.queries.bookmarks
        ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요."
        : !state.settings.autoBookmark
            ? "팝업에서 대화 자동 모으기를 켜면 대화 탭을 사용할 수 있어요."
            : state.awaitingRouteMessages
                ? "이 대화의 흐름을 불러오는 중이에요."
                : "아직 대화가 없어요.";
    }

    function buildStatusText() {
      return state.lastError
        ? "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요."
        : !state.settings.autoBookmark
            ? "대화 자동 모으기가 꺼져 있어요."
            : state.awaitingRouteMessages
                ? "대화를 불러오는 중"
                : !state.bookmarks.length
                    ? "아직 대화가 없어요"
                    : "";
    }

    function getFilteredBookmarks() {
      const query = normalizeText(state.queries.bookmarks).toLowerCase();
      return query
        ? state.bookmarks.filter((bookmark) => normalizeText(bookmark?.normalizedText || bookmark?.text).toLowerCase().includes(query))
        : state.bookmarks;
    }
  }

  function createHostedOwnedReleaseSnapshotBridge(getReleaseSummary = () => ({})) {
    return {
      buildReleaseSnapshot() {
        const releaseTool = normalizeHostedReleaseSummary(getReleaseSummary());
        const count = getReleaseCount(releaseTool);
        return {
          count,
          snapshotFingerprint: buildReleaseSnapshotFingerprint(releaseTool),
          updateAvailable: count > 0,
        };
      },
      getReleaseCount,
    };

    function getReleaseCount(releaseTool = normalizeHostedReleaseSummary(getReleaseSummary())) {
      return Math.max(0, Number(releaseTool.count) || 0);
    }

    function buildReleaseSnapshotFingerprint(releaseTool = {}) {
      const explicitFingerprint = normalizeText(releaseTool?.snapshotFingerprint);
      if (explicitFingerprint) {
        return explicitFingerprint;
      }
      return String(getReleaseCount(releaseTool));
    }
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  function normalizePromptReviewSnapshot(reviewState) {
    if (!reviewState || typeof reviewState !== "object") {
      return {};
    }
    return {
      available: Boolean(reviewState.available),
      copyState: normalizeText(reviewState.copyState),
      error: normalizeText(reviewState.error),
      lastReviewedAt: normalizeText(reviewState.lastReviewedAt),
      open: Boolean(reviewState.open),
      pending: Boolean(reviewState.pending),
      placeholderConfirmation: Boolean(reviewState.placeholderConfirmation),
      result: reviewState.result && typeof reviewState.result === "object"
        ? JSON.parse(JSON.stringify(reviewState.result))
        : null,
    };
  }

  function buildMeetingSummaryKey(meetingTool) {
    const normalizedMeetingTool = normalizeHostedMeetingSummary(meetingTool);
    return JSON.stringify({
      count: normalizedMeetingTool.count,
      snapshotFingerprint: normalizedMeetingTool.snapshotFingerprint,
    });
  }

  function normalizeHostedMeetingSummary(meetingTool) {
    const normalizedMeetingTool = meetingTool && typeof meetingTool === "object" ? meetingTool : {};
    return {
      count: Math.max(0, Number(normalizedMeetingTool.count) || 0),
      snapshotFingerprint: normalizeText(normalizedMeetingTool.snapshotFingerprint),
    };
  }

  function buildReleaseSummaryKey(releaseTool) {
    const normalizedReleaseTool = normalizeHostedReleaseSummary(releaseTool);
    return JSON.stringify({
      count: normalizedReleaseTool.count,
      snapshotFingerprint: normalizedReleaseTool.snapshotFingerprint,
    });
  }

  function normalizeHostedReleaseSummary(releaseTool) {
    const normalizedReleaseTool = releaseTool && typeof releaseTool === "object" ? releaseTool : {};
    return {
      count: Math.max(0, Number(normalizedReleaseTool.count) || 0),
      snapshotFingerprint: normalizeText(normalizedReleaseTool.snapshotFingerprint),
    };
  }

  namespace.panelV2CompositionController = { create };
})(globalThis);
