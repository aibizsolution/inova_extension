(function initPanelV2CompositionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state) {
    let promptBridgeController = null;
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
    const releaseManager = namespace.releaseManager.create(state, { render });
    const hostedOwnedReleaseSnapshot = createHostedOwnedReleaseSnapshotBridge(releaseManager);
    const hostedOwnedIdleMeetingLifecycle = createHostedOwnedIdleMeetingLifecycleBridge();
    const providerIdentitySync = namespace.providerIdentitySync.create(state, {
      ...runtimeDiagnostics,
      render,
    });
    const hostedOwnedMeetingSnapshot = createHostedOwnedMeetingSnapshotBridge(namespace.meetingManager);
    const panelDebugController = namespace.panelDebugController.create(state, {
      ...runtimeFlags,
      render,
    });
    const panelBookmarkController = namespace.panelBookmarkController.create(state, { render });
    const hostedOwnedConversationSnapshot = createHostedOwnedConversationSnapshotBridge(panelBookmarkController);
    const panelShellController = namespace.panelShellController.create(state, {
      bookmarkController: panelBookmarkController,
      getPromptController: () => promptBridgeController,
      isExtensionContextInvalidatedError: runtimeDiagnostics.isExtensionContextInvalidatedError,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      releaseManager,
      render,
    });
    const sharedPromptController = namespace.panelPromptController.create(state, {
      ...runtimeFlags,
      lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
      onPromptTabSelected: () => hostedOwnedIdleMeetingLifecycle.scheduleSync(0),
      persistActiveTool: panelShellController.persistActiveTool,
      render,
    });
    const hostedOwnedPromptSnapshot = createHostedOwnedPromptSnapshotBridge();
    const panelPromptController = createHostedOwnedPromptController(sharedPromptController);
    promptBridgeController = namespace.panelPromptBridgeController.create(state, {
      panelPromptController,
    });
    const promptSyncBridge = {
      ensureStoreLoaded: promptBridgeController.ensureStoreLoaded,
      schedulePromptCloudSyncIfNeeded: promptBridgeController.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptBridgeController.schedulePromptRealtimeSync,
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
      releaseManager,
      render,
      schedulePromptCloudSyncIfNeeded: promptSyncBridge.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
    });
    const panelActivityController = namespace.panelActivityController.create(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      providerIdentitySync,
      releaseManager,
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
      buildConversationSnapshot: hostedOwnedConversationSnapshot.buildConversationSnapshot,
      getConversationCount: hostedOwnedConversationSnapshot.getConversationCount,
      buildPromptSnapshot: hostedOwnedPromptSnapshot.buildPromptSnapshot,
      getPromptCounts: hostedOwnedPromptSnapshot.getPromptCounts,
      buildMeetingSnapshot: hostedOwnedMeetingSnapshot.buildMeetingSnapshot,
      getMeetingCount: hostedOwnedMeetingSnapshot.getMeetingCount,
      panelBookmarkController,
      panelDebugController,
      panelPromptController: promptBridgeController,
      panelShellController,
      buildReleaseSnapshot: hostedOwnedReleaseSnapshot.buildReleaseSnapshot,
      getReleaseCount: hostedOwnedReleaseSnapshot.getReleaseCount,
      releaseManager,
    });
    const panelBootstrapController = namespace.panelBootstrapController.create(state, {
      handlePanelMeetingAction: async () => false,
      handlePanelMeetingSummarySync: handleHostedMeetingSummarySync,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      meetingManager: hostedOwnedIdleMeetingLifecycle,
      shouldListenMeetingStorageChanges: () => false,
      shouldPrimeMeetingSync: () => false,
      panelActivityController,
      panelBookmarkController,
      panelDebugController,
      panelLifecycleController,
      panelPromptController: promptBridgeController,
      panelShellController,
      panelSurfaceController,
      providerIdentitySync,
      releaseManager,
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
      const nextSummary = {
        checkedAt: normalizeText(meetingTool.checkedAt),
        count: Math.max(0, Number(meetingTool.count) || 0),
        dataFreshness: normalizeText(meetingTool.dataFreshness),
        degraded: Boolean(meetingTool.degraded),
        degradedReason: normalizeText(meetingTool.degradedReason),
        error: normalizeText(meetingTool.error),
        snapshotFingerprint: normalizeText(meetingTool.snapshotFingerprint),
        source: normalizeText(meetingTool.source),
      };
      if (buildMeetingSummaryKey(state.meetingHub) === buildMeetingSummaryKey(nextSummary)) {
        return false;
      }
      state.meetingHub = namespace.meetingManager.mergeMeetingHub({
        ...state.meetingHub,
        ...nextSummary,
      });
      render();
      return true;
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

  function createHostedOwnedMeetingSnapshotBridge(meetingManagerNamespace = {}) {
    const mergeMeetingHub = typeof meetingManagerNamespace.mergeMeetingHub === "function"
      ? meetingManagerNamespace.mergeMeetingHub
      : (meetingHub) => (meetingHub && typeof meetingHub === "object" ? meetingHub : {});
    return {
      buildMeetingSnapshot(meetingHub) {
        const meetingTool = mergeMeetingHub(meetingHub);
        return {
          count: getMeetingCount(meetingTool),
          snapshotFingerprint: buildMeetingSnapshotFingerprint(meetingTool),
        };
      },
      getMeetingCount,
    };

    function getMeetingCount(meetingTool = {}) {
      return Math.max(
        0,
        Number(meetingTool.count) || (Array.isArray(meetingTool.items) ? meetingTool.items.length : 0)
      );
    }

    function buildMeetingSnapshotFingerprint(meetingTool = {}) {
      const explicitFingerprint = normalizeText(meetingTool?.snapshotFingerprint);
      if (explicitFingerprint) {
        return explicitFingerprint;
      }
      const items = Array.isArray(meetingTool.items) ? meetingTool.items : [];
      return [
        String(getMeetingCount(meetingTool)),
        normalizeText(meetingTool.dataFreshness),
        meetingTool.degraded ? "1" : "0",
        normalizeText(meetingTool.error),
        items.map((item) => [
          normalizeText(item?.meetingId),
          normalizeText(item?.latestJobId || item?.jobId),
          normalizeText(item?.latestArtifactId || item?.artifactId),
          normalizeText(item?.status),
          item?.share?.active ? "1" : "0",
          normalizeText(item?.share?.status),
          normalizeText(item?.updatedAt || item?.createdAt),
        ].join("~")).join("||"),
      ].join("|");
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

  function createHostedOwnedConversationSnapshotBridge(panelBookmarkController = {}) {
    return {
      buildConversationSnapshot() {
        const bookmarkTool = panelBookmarkController.buildToolState?.() || {};
        return {
          activeId: normalizeText(bookmarkTool.activeId),
          count: getConversationCount(bookmarkTool),
          snapshotFingerprint: buildSnapshotFingerprint(bookmarkTool),
        };
      },
      getConversationCount,
    };

    function getConversationCount(bookmarkTool = {}) {
      return Math.max(
        0,
        Number(bookmarkTool.count) || (Array.isArray(bookmarkTool.items) ? bookmarkTool.items.length : 0)
      );
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
  }

  function createHostedOwnedReleaseSnapshotBridge(releaseManager = {}) {
    return {
      buildReleaseSnapshot() {
        const count = getReleaseCount();
        return {
          count,
          updateAvailable: count > 0,
        };
      },
      getReleaseCount,
    };

    function getReleaseCount() {
      const releaseState = releaseManager.buildViewState?.() || {};
      if (releaseState.updateAvailable) {
        return 1;
      }
      const snapshotCount = Number(releaseState.count) || 0;
      return snapshotCount > 0 ? snapshotCount : 0;
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
    return JSON.stringify({
      count: Math.max(0, Number(meetingTool?.count) || 0),
      dataFreshness: normalizeText(meetingTool?.dataFreshness),
      degraded: Boolean(meetingTool?.degraded),
      degradedReason: normalizeText(meetingTool?.degradedReason),
      error: normalizeText(meetingTool?.error),
      snapshotFingerprint: normalizeText(meetingTool?.snapshotFingerprint),
      source: normalizeText(meetingTool?.source),
    });
  }

  namespace.panelV2CompositionController = { create };
})(globalThis);
