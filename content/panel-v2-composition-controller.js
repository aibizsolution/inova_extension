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
    const meetingManager = namespace.meetingManager.create(state, { render });
    const hostedOwnedMeetingLifecycle = createHostedOwnedMeetingLifecycleBridge(meetingManager);
    const hostedOwnedIdleMeetingLifecycle = createHostedOwnedIdleMeetingLifecycleBridge();
    const providerIdentitySync = namespace.providerIdentitySync.create(state, {
      ...runtimeDiagnostics,
      render,
    });
    const panelMeetingController = namespace.panelMeetingController.create(state, {
      meetingManager: hostedOwnedMeetingLifecycle,
      providerIdentitySync,
      render,
    });
    const hostedOwnedMeetingSnapshot = createHostedOwnedMeetingSnapshotBridge(panelMeetingController);
    const panelDebugController = namespace.panelDebugController.create(state, {
      ...runtimeFlags,
      render,
    });
    const panelActionController = namespace.panelActionController.create(state, {
      panelDebugController,
      panelMeetingController,
    });
    const panelBookmarkController = namespace.panelBookmarkController.create(state, { render });
    const hostedOwnedConversationSnapshot = createHostedOwnedConversationSnapshotBridge(panelBookmarkController);
    const panelShellController = namespace.panelShellController.create(state, {
      bookmarkController: panelBookmarkController,
      getPromptController: () => promptBridgeController,
      isExtensionContextInvalidatedError: runtimeDiagnostics.isExtensionContextInvalidatedError,
      meetingManager: hostedOwnedMeetingLifecycle,
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
      meetingManager: hostedOwnedMeetingLifecycle,
      releaseManager,
      render,
      schedulePromptCloudSyncIfNeeded: promptSyncBridge.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
    });
    const panelActivityController = namespace.panelActivityController.create(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager: hostedOwnedMeetingLifecycle,
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
      onRouteStateChanged: hostedOwnedMeetingLifecycle.handleRouteStateChange,
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
      panelMeetingController,
      panelPromptController: promptBridgeController,
      panelShellController,
      buildReleaseSnapshot: hostedOwnedReleaseSnapshot.buildReleaseSnapshot,
      getReleaseCount: hostedOwnedReleaseSnapshot.getReleaseCount,
      releaseManager,
    });
    const panelBootstrapController = namespace.panelBootstrapController.create(state, {
      handlePanelMeetingAction: panelActionController.handlePanelMeetingAction,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      meetingManager: hostedOwnedMeetingLifecycle,
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
  }

  function createHostedOwnedMeetingLifecycleBridge(meetingManager = {}) {
    return {
      handleRouteStateChange() {
        return false;
      },
      handleStorageChange() {},
      scheduleSync(delay) {
        return meetingManager.scheduleSync?.(delay) || false;
      },
    };
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

  function createHostedOwnedMeetingSnapshotBridge(panelMeetingController = {}) {
    return {
      buildMeetingSnapshot(meetingHub) {
        const meetingTool = panelMeetingController.buildToolState?.(meetingHub) || {};
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
      const items = Array.isArray(meetingTool.items) ? meetingTool.items : [];
      return [
        String(getMeetingCount(meetingTool)),
        normalizeText(meetingTool.checkedAt),
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

  namespace.panelV2CompositionController = { create };
})(globalThis);
