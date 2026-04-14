(function initPanelV2CompositionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const RUNTIME_PROVIDER_IDENTITY_REQUEST = "inova-meeting:get-provider-identity";

  function create(state) {
    let hostedOwnedPromptController = null;
    let renderController = null;
    const render = () => renderController?.render();
    const panelV2ShellBridge = namespace.panelV2ShellBridge;
    if (!panelV2ShellBridge) {
      throw new Error("panelV2ShellBridge must load before panelV2CompositionController");
    }

    // v2 shell baseline keeps the shared extension-side runtime wiring.
    const panelRuntimeController = createHostedOwnedPanelRuntimeBridge(state);
    const runtimeFlags = {
      isPaused: panelRuntimeController.isPaused,
      isToolSurface: panelRuntimeController.isToolSurface,
    };
    const runtimeDiagnostics = {
      isExtensionContextInvalidatedError: panelRuntimeController.isExtensionContextInvalidatedError,
      logPanelDebug: panelRuntimeController.logPanelDebug,
    };
    const hostedOwnedIdleReleaseLifecycle = createHostedOwnedIdleReleaseLifecycleBridge();
    const hostedOwnedReleaseSnapshot = createHostedOwnedReleaseSnapshotBridge(() => state.releaseSummary);
    const providerIdentitySync = createHostedOwnedProviderIdentitySync(state, {
      ...runtimeDiagnostics,
      render,
    });
    const hostedOwnedMeetingSnapshot = createHostedOwnedMeetingSnapshotBridge();
    const panelDebugController = createHostedOwnedPanelDebugBridge(state, {
      ...runtimeFlags,
    });
    const hostedOwnedConversationBridge = createHostedOwnedConversationBridge(state, { render });
    const panelShellController = panelV2ShellBridge.createShellController(state, {
      bookmarkController: hostedOwnedConversationBridge,
      getPromptController: () => hostedOwnedPromptController,
      isExtensionContextInvalidatedError: runtimeDiagnostics.isExtensionContextInvalidatedError,
      releaseManager: hostedOwnedIdleReleaseLifecycle,
      render,
    });
    const sharedPromptController = namespace.panelV2PromptController.create(state, {
      ...runtimeFlags,
      lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
      persistActiveTool: panelShellController.persistActiveTool,
      render,
    });
    const hostedOwnedPromptSnapshot = createHostedOwnedPromptSnapshotBridge();
    hostedOwnedPromptController = sharedPromptController;

    const routeStateController = namespace.routeStateController.create(state, {
      applyUiPreferenceLock: panelShellController.applyUiPreferenceLock,
      normalizeToolId: panelShellController.normalizeToolId,
    });
    const panelLifecycleController = panelV2ShellBridge.createHostedOwnedPanelLifecycleBridge(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      releaseManager: hostedOwnedIdleReleaseLifecycle,
      render,
    });
    const panelActivityController = panelV2ShellBridge.createHostedOwnedPanelActivityBridge(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      providerIdentitySync,
      releaseManager: hostedOwnedIdleReleaseLifecycle,
      render,
    });
    const panelSurfaceController = panelV2ShellBridge.createHostedOwnedPanelSurfaceBridge(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      render,
    });
    const routeSync = namespace.routeSync.create(state, {
      onRouteStateChanged: () => false,
      refreshState: routeStateController.refreshState,
      render,
      resetRouteState: routeStateController.resetRouteState,
    });
    const routeWatchController = namespace.routeWatchController.create(state, {
      scheduleRouteSync: routeSync.scheduleRouteSync,
    });

    renderController = panelV2ShellBridge.createRenderController(state, {
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
    const panelBootstrapController = panelV2ShellBridge.createBootstrapController(state, {
      buildHostedPanelCallbacks: buildHostedOwnedPanelCallbacks,
      handlePanelToolSummarySync: handleHostedToolSummarySync,
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

    function handleHostedToolSummarySync(toolId, toolState = {}) {
      const normalizedToolId = normalizeHostedToolSummaryId(toolId);
      if (normalizedToolId === "meeting") {
        return handleHostedMeetingSummarySync(toolState);
      }
      if (normalizedToolId === "release") {
        return handleHostedReleaseSummarySync(toolState);
      }
      return false;
    }

    function handleHostedMeetingSummarySync(meetingTool = {}) {
      const nextCount = normalizeHostedMeetingCount(meetingTool?.count);
      if (normalizeHostedMeetingCount(state.meetingSummary?.count) === nextCount) {
        return false;
      }
      state.meetingSummary = { count: nextCount };
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
      const handlePanelToolSummarySync = typeof deps.handlePanelToolSummarySync === "function"
        ? deps.handlePanelToolSummarySync
        : async () => false;

      return {
        onCopyBookmark: panelBookmarkController.copyBookmarkText,
        onHandlePositionChange: panelShellController.updateHandlePosition,
        onJumpBookmark: panelBookmarkController.jumpToBookmark,
        onToolSummarySync: handlePanelToolSummarySync,
        onReleaseAction: releaseManager.handleAction,
        onSearch: panelShellController.updateQuery,
        onSearchSubmit: panelShellController.submitQuery,
        onSelectTool: panelShellController.selectTool,
        onEscape: panelPromptController.handleEscape,
        onToggle: panelLifecycleController.togglePanel,
      };
    }
  }

  function createState() {
    return {
      sessionId: "",
      sessionTitle: "",
      open: false,
      preferredOpen: false,
      activeId: "",
      activeTool: namespace.constants.defaults.uiPreferences.activeTool,
      queries: { bookmarks: "" },
      settings: { ...namespace.constants.defaults.settings },
      settingsHydrated: false,
      pausedSessions: {},
      meetingSummary: { count: 0 },
      releaseSummary: { count: 0, snapshotFingerprint: "" },
      panelDebugUi: {
        collapsed: true,
        feedback: null,
        feedbackTimer: 0,
      },
      cloudSync: namespace.cloudSync.mergeCloudSyncState(),
      uiPreferences: namespace.storage.mergeUiPreferences(),
      promptReview: { ...namespace.constants.defaults.promptReview },
      feedbackTimer: 0,
      bookmarks: [],
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

  function createHostedOwnedPanelRuntimeBridge(state) {
    return {
      isExtensionContextInvalidatedError,
      isPaused,
      isToolSurface,
      logPanelDebug,
    };

    function isPaused() {
      return Boolean(state.sessionId && state.pausedSessions[state.sessionId]);
    }

    function isToolSurface() {
      return Boolean(namespace.contentDom?.getConversationState?.().hasComposer);
    }

    function isExtensionContextInvalidatedError(error) {
      const message = normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
      return message.includes("extension context invalidated");
    }

    function logPanelDebug(event, payload) {
      namespace.panelDebug?.log?.(event, payload || {});
    }
  }

  function createHostedOwnedPanelDebugBridge(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;

    return {
      buildState() {
        return {};
      },
      async handleAction(action) {
        const normalizedAction = normalizeText(action);
        if (normalizedAction === "debug-copy") {
          await copyEntries(false);
          return true;
        }
        if (normalizedAction === "debug-copy-errors") {
          await copyEntries(true);
          return true;
        }
        if (normalizedAction === "debug-clear") {
          namespace.panelDebug?.clearEntries?.();
          return true;
        }
        return normalizedAction === "debug-toggle";
      },
      handlesAction(action) {
        return new Set(["debug-toggle", "debug-copy", "debug-copy-errors", "debug-clear"]).has(normalizeText(action));
      },
      installValidationApi() {
        delete namespace.panelDebugValidation;
      },
      syncEnabled() {
        namespace.panelDebug?.setEnabled?.(Boolean(
          namespace.panelDebug?.isLocalDebugEnabled?.(state.settings)
          && state.settings.enabled
          && isToolSurface()
          && !isPaused()
          && global.document.visibilityState === "visible"
        ));
      },
    };

    async function copyEntries(errorsOnly) {
      const entries = namespace.panelDebug?.getEntries?.() || [];
      const text = errorsOnly
        ? namespace.panelDebug?.buildErrorCopyText?.(entries)
        : namespace.panelDebug?.buildCopyText?.(entries);
      if (!normalizeText(text)) {
        return;
      }
      try {
        await global.navigator?.clipboard?.writeText?.(text);
      } catch (error) {
        namespace.panelDebug?.log?.("panel.debug.copy.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          errorsOnly: Boolean(errorsOnly),
        });
      }
    }
  }

  function createHostedOwnedProviderIdentitySync(state, deps = {}) {
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const isExtensionContextInvalidatedError = typeof deps.isExtensionContextInvalidatedError === "function"
      ? deps.isExtensionContextInvalidatedError
      : () => false;

    ensureProviderIdentityRuntimeInstalled();

    return {
      handleRuntimeMessage,
      syncToStorage,
    };

    async function syncToStorage(reason = "runtime", providedIdentity = null) {
      const providerIdentity = normalizeProviderIdentity(
        providedIdentity || namespace.providerIdentity?.getCurrent?.()
      );
      if (!providerIdentity.available || !providerIdentity.providerUserKey) {
        return false;
      }
      try {
        const currentCloudSync = await namespace.storage.getCloudSyncState();
        const currentIdentity = normalizeProviderIdentity(currentCloudSync?.providerIdentity);
        if (
          currentIdentity.providerUserKey === providerIdentity.providerUserKey
          && currentIdentity.email === providerIdentity.email
          && currentIdentity.displayName === providerIdentity.displayName
          && currentIdentity.numericUserId === providerIdentity.numericUserId
        ) {
          return false;
        }
        const nextCloudSync = namespace.cloudSync.mergeCloudSyncState(currentCloudSync, {
          providerIdentity: {
            ...currentIdentity,
            ...providerIdentity,
            available: true,
          },
        });
        state.cloudSync = nextCloudSync;
        await namespace.storage.setCloudSyncState(nextCloudSync);
        logPanelDebug("panel.identity.cached", {
          providerUserKey: normalizeText(providerIdentity.providerUserKey),
          reason: normalizeText(reason) || "runtime",
          scope: "panel-ui",
          tool: "panel",
        });
        render();
        return true;
      } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
          return false;
        }
        console.error("[i-Nova Bookmarks] provider identity cache failed", error);
        return false;
      }
    }

    function handleRuntimeMessage(message, sender, sendResponse) {
      const type = normalizeText(message?.type);
      if (type !== RUNTIME_PROVIDER_IDENTITY_REQUEST) {
        return false;
      }
      Promise.resolve().then(async () => {
        const providerIdentity = normalizeProviderIdentity(namespace.providerIdentity?.getCurrent?.());
        await syncToStorage("runtime-message", providerIdentity);
        sendResponse({
          ok: true,
          providerIdentity,
          senderUrl: normalizeText(sender?.url),
        });
      }).catch((error) => {
        sendResponse({
          error: error instanceof Error ? error.message : String(error || "현재 i-Nova 사용자 정보를 읽지 못했어요."),
          ok: false,
        });
      });
      return true;
    }
  }

  function ensureProviderIdentityRuntimeInstalled() {
    if (namespace.providerIdentitySyncRuntimeInstalled || !global.chrome?.runtime?.onMessage?.addListener) {
      return;
    }
    global.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const type = normalizeText(message?.type);
      if (type !== RUNTIME_PROVIDER_IDENTITY_REQUEST) {
        return false;
      }
      Promise.resolve().then(() => {
        sendResponse({
          ok: true,
          providerIdentity: normalizeProviderIdentity(namespace.providerIdentity?.getCurrent?.()),
          senderUrl: normalizeText(sender?.url),
        });
      }).catch((error) => {
        sendResponse({
          error: error instanceof Error ? error.message : String(error || "현재 i-Nova 사용자 정보를 읽지 못했어요."),
          ok: false,
        });
      });
      return true;
    });
    namespace.providerIdentitySyncRuntimeInstalled = true;
  }

  function normalizeProviderIdentity(identity) {
    const normalize = typeof namespace.cloudSync?.normalizeProviderIdentity === "function"
      ? namespace.cloudSync.normalizeProviderIdentity
      : (value) => value && typeof value === "object" ? value : {};
    return normalize(identity || null);
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
        return {
          count: getMeetingCount(meetingSummary),
        };
      },
      getMeetingCount,
    };

    function getMeetingCount(meetingTool = {}) {
      return normalizeHostedMeetingCount(meetingTool?.count);
    }
  }

  function createHostedOwnedPromptSnapshotBridge() {
    return {
      buildPromptSnapshot(promptToolState = {}) {
        const promptTool = promptToolState?.promptTool && typeof promptToolState.promptTool === "object"
          ? promptToolState.promptTool
          : {};
        return {
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

  function normalizeHostedMeetingCount(value) {
    return Math.max(0, Number(value) || 0);
  }

  function normalizeHostedToolSummaryId(value) {
    const normalizedToolId = normalizeText(value);
    return normalizedToolId === "meeting" || normalizedToolId === "release"
      ? normalizedToolId
      : "";
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

  namespace.panelV2CompositionController = { create, createState };
})(globalThis);
