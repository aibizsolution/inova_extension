(function initMeetingHubController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText, resolveBrowserCapabilities } = namespace.panelUtils;
  const LIST_LIMIT = 24;
  const MEETING_SCOPE_IDS = Object.freeze(["all", "owned", "participating"]);
  const SUPPORTED_ACTIONS = new Set([
    "open-result",
    "open-workspace",
    "cancel-revoke-share",
    "confirm-revoke-share",
    "remove-participation",
    "set-scope",
    "share",
    "revoke-share",
  ]);
  const MEETING_PARTICIPATION_HIDE_CAPABILITY_ID = "meeting.participation.hide-function";
  const MEETING_SHARE_CREATE_CAPABILITY_ID = "meeting.share.create-function";
  const MEETING_SHARE_REVOKE_CAPABILITY_ID = "meeting.share.revoke-function";
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const publishToast = typeof options.publishToast === "function"
      ? options.publishToast
      : () => false;
    const recordFeatureUsage = typeof options.featureUsageTracker?.record === "function"
      ? options.featureUsageTracker.record
      : () => {};
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};
    const traceMeeting = typeof options.traceMeeting === "function"
      ? options.traceMeeting
      : () => {};
    const traceFirestore = typeof options.traceFirestore === "function"
      ? options.traceFirestore
      : () => {};
    const invokeCapability = typeof browserCapabilities.invokeCapability === "function"
      ? browserCapabilities.invokeCapability
      : async () => ({});
    const openMeetingResult = typeof browserCapabilities.openMeetingResult === "function"
      ? browserCapabilities.openMeetingResult
      : async () => ({});
    const openMeetingWorkspace = typeof browserCapabilities.openMeetingWorkspace === "function"
      ? browserCapabilities.openMeetingWorkspace
      : async () => ({});
    const readPanelStorageState = typeof browserCapabilities.readPanelStorageState === "function"
      ? browserCapabilities.readPanelStorageState
      : async () => ({});
    const writeClipboardText = typeof browserCapabilities.writeClipboardText === "function"
      ? browserCapabilities.writeClipboardText
      : async () => ({});
    let meetingRealtime = options.meetingRealtime && typeof options.meetingRealtime === "object"
      ? options.meetingRealtime
      : null;
    let meetingParticipationRealtime = options.meetingParticipationRealtime && typeof options.meetingParticipationRealtime === "object"
      ? options.meetingParticipationRealtime
      : null;
    let meetingUsageRealtime = options.meetingUsageRealtime && typeof options.meetingUsageRealtime === "object"
      ? options.meetingUsageRealtime
      : null;
    const state = {
      activeScope: "all",
      activeTool: "",
      capabilities: [],
      checkedAt: "",
      dataFreshness: "empty",
      degraded: false,
      degradedReason: "",
      error: "",
      feedback: null,
      feedbackTimer: 0,
      initialized: false,
      initPromise: null,
      items: [],
      loadPromise: null,
      loading: false,
      ownedItems: [],
      panelOpen: false,
      participationItems: [],
      pending: createPendingState(),
      pendingReload: false,
      providerIdentity: createProviderIdentity(),
      query: "",
      revokeConfirmation: createRevokeConfirmationState(),
      settings: {
        meetingDebugConsoleEnabled: false,
        meetingWorkspaceTarget: "production",
        meetingWorkspaceUrlOverride: "",
      },
      source: "none",
      usage: createUsageState(),
      usageLoadPromise: null,
      usagePendingReload: false,
    };
    if (!meetingRealtime && namespace.meetingFirestoreClient?.create) {
      meetingRealtime = namespace.meetingFirestoreClient.create({
        browserCapabilities,
        onError: handleRealtimeError,
        onSnapshot: handleRealtimeSnapshot,
        traceFirestore,
      });
    }
    if (!meetingRealtime) {
      meetingRealtime = {
        disconnect() {},
        ensureSubscribed: async () => ({
          checkedAt: "",
          fromCache: false,
          hasPendingWrites: false,
          items: [],
        }),
      };
    }
    if (!meetingParticipationRealtime && namespace.meetingParticipationFirestoreClient?.create) {
      meetingParticipationRealtime = namespace.meetingParticipationFirestoreClient.create({
        browserCapabilities,
        onError: handleParticipationRealtimeError,
        onSnapshot: handleParticipationRealtimeSnapshot,
        traceFirestore,
      });
    }
    if (!meetingParticipationRealtime) {
      meetingParticipationRealtime = {
        disconnect() {},
        ensureSubscribed: async () => ({
          checkedAt: "",
          fromCache: false,
          hasPendingWrites: false,
          items: [],
        }),
      };
    }
    if (!meetingUsageRealtime && namespace.meetingUsageFirestoreClient?.create) {
      meetingUsageRealtime = namespace.meetingUsageFirestoreClient.create({
        browserCapabilities,
        onError: handleUsageRealtimeError,
        onSnapshot: handleUsageRealtimeSnapshot,
        traceFirestore,
      });
    }
    if (!meetingUsageRealtime) {
      meetingUsageRealtime = {
        disconnect() {},
        ensureSubscribed: async () => createUsageState(),
      };
    }

    return {
      buildViewState,
      getMeetingCount,
      handleHostActivity,
      handleMeetingAction,
      handleSearch,
      hasRequiredCapabilities,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      const nextActiveTool = normalizeText(panelState?.activeTool);
      const nextPanelOpen = Boolean(panelState?.open);
      const meetingToolBecameActive = nextActiveTool === "meeting" && state.activeTool !== "meeting";
      const panelReopenedIntoMeeting = nextActiveTool === "meeting" && nextPanelOpen && !state.panelOpen;
      state.activeTool = nextActiveTool;
      state.panelOpen = nextPanelOpen;
      state.settings = {
        ...state.settings,
        ...(panelState?.settings && typeof panelState.settings === "object" ? panelState.settings : {}),
      };
      hydrateProviderIdentityFromPanel(panelState);
      if (!hasRequiredCapabilities()) {
        meetingRealtime?.disconnect?.("capabilities-missing");
        meetingParticipationRealtime?.disconnect?.("capabilities-missing");
        meetingUsageRealtime?.disconnect?.("capabilities-missing");
        return;
      }
      if (nextActiveTool !== "meeting" || !nextPanelOpen) {
        meetingRealtime?.disconnect?.("panel-inactive");
        meetingParticipationRealtime?.disconnect?.("panel-inactive");
        meetingUsageRealtime?.disconnect?.("panel-inactive");
        return;
      }
      const shouldForceReload = meetingToolBecameActive || panelReopenedIntoMeeting;
      if (shouldForceReload || !state.initialized) {
        void ensureLoaded(shouldForceReload);
        void ensureUsageLoaded(shouldForceReload);
      }
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getMeetingCount() {
      return getMeetingCounts().all;
    }

    function buildViewState() {
      if (!hasRequiredCapabilities()) {
        return {
          count: 0,
        };
      }
      return {
        canCreateShare: hasCapability(MEETING_SHARE_CREATE_CAPABILITY_ID),
        canHideParticipation: hasCapability(MEETING_PARTICIPATION_HIDE_CAPABILITY_ID),
        canRevokeShare: hasCapability(MEETING_SHARE_REVOKE_CAPABILITY_ID),
        capabilityNotice: buildCapabilityNotice(),
        checkedAt: normalizeText(state.checkedAt),
        count: getMeetingCount(),
        counts: getMeetingCounts(),
        dataFreshness: normalizeEnum(state.dataFreshness, ["fresh", "stale", "empty"], "empty"),
        degraded: Boolean(state.degraded),
        degradedReason: normalizeText(state.degradedReason),
        error: normalizeText(state.error),
        feedback: normalizeFeedback(state.feedback),
        activeScope: normalizeMeetingScope(state.activeScope),
        items: getVisibleMeetingItems(),
        pending: normalizePending(state.pending),
        query: normalizeText(state.query),
        revokeConfirmation: { ...state.revokeConfirmation },
        source: normalizeEnum(state.source, ["realtime", "cache", "none"], "none"),
        usage: cloneUsageState(state.usage),
      };
    }

    function handleHostActivity(reason) {
      const normalizedReason = normalizeText(reason);
      if (!hasRequiredCapabilities()) {
        return false;
      }
      if (normalizedReason !== "visibility-visible") {
        return false;
      }
      if (state.activeTool !== "meeting" || !state.panelOpen) {
        return false;
      }
      if (state.loadPromise) {
        traceMeeting("66.top.meeting.host-activity.skip", {
          loading: true,
          open: state.panelOpen,
          reason: normalizedReason,
        });
        return false;
      }
      traceMeeting("66.top.meeting.host-activity.refresh", {
        open: state.panelOpen,
        reason: normalizedReason,
      });
      void ensureLoaded(true);
      void ensureUsageLoaded(true);
      return true;
    }

    async function handleMeetingAction(action, detail = {}) {
      const normalizedAction = normalizeText(action);
      if (!SUPPORTED_ACTIONS.has(normalizedAction) || !hasRequiredCapabilities()) {
        return false;
      }
      if (normalizedAction === "set-scope") {
        clearRevokeConfirmation();
        setScope(detail?.scope);
        return true;
      }
      if (state.pending.active) {
        return true;
      }
      await refreshStorageState();
      const input = buildActionInput(detail);
      const launchAction = resolveLaunchAction(normalizedAction, input);

      if (isShareActionBlocked(normalizedAction)) {
        setFeedback("회의 공유 기능이 현재 비활성화되어 있어요.", "error", 3600);
        return true;
      }

      if ((normalizedAction === "share" || normalizedAction === "revoke-share" || normalizedAction === "confirm-revoke-share" || normalizedAction === "remove-participation") && !input.meetingId) {
        setFeedback("회의 정보를 찾지 못했어요. 다시 시도해 주세요.", "error", 3600);
        return true;
      }

      if (launchAction) {
        clearRevokeConfirmation();
        await handleLaunchAction(launchAction, input);
        return true;
      }

      if (normalizedAction === "revoke-share") {
        setRevokeConfirmation(input);
        return true;
      }

      if (normalizedAction === "cancel-revoke-share") {
        clearRevokeConfirmation();
        return true;
      }

      setPending({
        action: normalizedAction === "confirm-revoke-share" ? "revoke-share" : normalizedAction,
        jobId: input.jobId,
        meetingId: input.meetingId,
        title: input.title,
      });

      try {
        if (normalizedAction === "share") {
          clearRevokeConfirmation();
          traceMeeting("63.top.meeting.bridge.share.start", input);
          const result = await invokeCapability(MEETING_SHARE_CREATE_CAPABILITY_ID, {
            ...input,
            providerIdentity: buildProviderIdentityPayload(state.providerIdentity),
          });
          const shareUrl = normalizeText(result?.shareUrl);
          if (!shareUrl) {
            throw new Error("공유 링크를 만들지 못했어요.");
          }
          patchShareState(input.meetingId, result?.share);
          const copied = await copyShareUrl(shareUrl);
          if (copied) {
            traceMeeting("64.top.meeting.bridge.share.success", {
              meetingId: input.meetingId,
              shareUrl,
            });
            setFeedback("공유 링크를 복사했습니다.", "info", 2200);
          } else {
            traceMeeting("64.top.meeting.bridge.share.copy-failed", {
              meetingId: input.meetingId,
              shareUrl,
            });
            setFeedback("공유 링크는 만들었지만 자동 복사는 실패했어요.", "error", 3600);
          }
          void ensureLoaded(true);
          return true;
        }

        if (normalizedAction === "remove-participation") {
          if (!hasCapability(MEETING_PARTICIPATION_HIDE_CAPABILITY_ID)) {
            setFeedback("참여 회의룸 목록 관리 기능이 현재 비활성화되어 있어요.", "error", 3600);
            return true;
          }
          traceMeeting("63.top.meeting.bridge.participation-hide.start", input);
          await invokeCapability(MEETING_PARTICIPATION_HIDE_CAPABILITY_ID, {
            meetingId: input.meetingId,
            participationId: input.participationId,
            providerIdentity: buildProviderIdentityPayload(state.providerIdentity),
          });
          state.participationItems = state.participationItems.filter((item) =>
            normalizeText(item.participationId) !== input.participationId
          );
          state.items = getVisibleMeetingItems();
          traceMeeting("64.top.meeting.bridge.participation-hide.success", {
            meetingId: input.meetingId,
            participationId: input.participationId,
          });
          setFeedback("목록에서 제거했습니다.", "info", 1800);
          void ensureLoaded(true);
          return true;
        }

        const revokedCount = state.revokeConfirmation.meetingId === input.meetingId
          ? state.revokeConfirmation.shareParticipantCount
          : getShareParticipantCount(input.meetingId);
        traceMeeting("63.top.meeting.bridge.revoke-share.start", input);
        const result = await invokeCapability(MEETING_SHARE_REVOKE_CAPABILITY_ID, {
          ...input,
          providerIdentity: buildProviderIdentityPayload(state.providerIdentity),
        });
        patchShareState(input.meetingId, result?.share);
        clearRevokeConfirmation();
        traceMeeting("64.top.meeting.bridge.revoke-share.success", {
          meetingId: input.meetingId,
        });
        const revokedMessage = revokedCount > 0
          ? `공유 링크를 해제했습니다. 기존 열람자 ${revokedCount}명은 더 이상 접근할 수 없습니다.`
          : "공유 링크를 해제했습니다.";
        setFeedback(revokedMessage, "info", 2600);
        void ensureLoaded(true);
        return true;
      } catch (error) {
        traceMeeting("65.top.meeting.bridge.error", {
          action: normalizedAction,
          error: readErrorMessage(error, "회의 작업을 처리하지 못했어요."),
          jobId: input.jobId,
          meetingId: input.meetingId,
        });
        setFeedback(readErrorMessage(error, "회의 작업을 처리하지 못했어요."), "error", 3600);
        return true;
      } finally {
        clearPending();
      }
    }

    function handleSearch(toolId, value) {
      if (normalizeText(toolId) !== "meeting") {
        return false;
      }
      const nextQuery = String(value || "");
      if (state.query === nextQuery) {
        return true;
      }
      state.query = nextQuery;
      state.items = getVisibleMeetingItems();
      scheduleRender();
      return true;
    }

    async function ensureInitialized() {
      if (state.initialized) {
        return true;
      }
      if (state.initPromise) {
        return state.initPromise;
      }
      state.initPromise = (async () => {
        try {
          const storageState = await readPanelStorageState();
          hydrateStorageState(storageState);
          state.initialized = true;
          return true;
        } catch (error) {
          state.error = readErrorMessage(error, "회의 허브 상태를 준비하지 못했어요.");
          return false;
        } finally {
          state.initPromise = null;
          scheduleRender();
        }
      })();
      return state.initPromise;
    }

    async function refreshStorageState() {
      try {
        const storageState = await readPanelStorageState();
        hydrateStorageState(storageState);
        state.initialized = true;
      } catch (error) {
        void error;
      }
    }

    async function ensureLoaded(force = false) {
      if (!hasRequiredCapabilities()) {
        return state.items;
      }
      const initialized = await ensureInitialized();
      if (!initialized) {
        return state.items;
      }
      if (state.loadPromise) {
        if (force) {
          state.pendingReload = true;
        }
        return state.loadPromise;
      }
      if (!state.providerIdentity.available || !normalizeText(state.providerIdentity.providerUserKey)) {
        state.checkedAt = state.checkedAt || "";
        state.degraded = false;
        state.degradedReason = "";
        state.dataFreshness = state.items.length ? "stale" : "empty";
        state.error = "사용자 정보를 확인하는 중이에요.";
        state.source = state.items.length ? "cache" : "none";
        scheduleRender();
        return state.items;
      }

      state.loading = true;
      scheduleRender();
      const run = (async () => {
        const request = {
          forceRefresh: force,
          providerIdentity: buildProviderIdentityPayload(state.providerIdentity),
          queryLimit: LIST_LIMIT,
          settings: state.settings,
        };
        const results = await Promise.allSettled([
          meetingRealtime.ensureSubscribed(request),
          meetingParticipationRealtime.ensureSubscribed(request),
        ]);
        let loaded = false;
        if (results[0].status === "fulfilled") {
          await applyOwnedSnapshotPayload(results[0].value);
          loaded = true;
        } else {
          applyLoadError(results[0].reason, "meeting-hub-firestore-unavailable");
        }
        if (results[1].status === "fulfilled") {
          await applyParticipationSnapshotPayload(results[1].value);
          loaded = true;
        } else {
          applyLoadError(results[1].reason, "meeting-participation-firestore-unavailable");
        }
        if (loaded) {
          state.items = getVisibleMeetingItems();
          scheduleRender();
        }
        return state.items;
      })();
      const tracked = run.finally(() => {
        state.loading = false;
        scheduleRender();
      });
      state.loadPromise = tracked;
      try {
        return await tracked;
      } finally {
        if (state.loadPromise === tracked) {
          state.loadPromise = null;
        }
        if (state.pendingReload) {
          state.pendingReload = false;
          void ensureLoaded(true);
        }
      }
    }

    async function handleRealtimeSnapshot(snapshot) {
      await applyOwnedSnapshotPayload(snapshot);
      state.items = getVisibleMeetingItems();
      scheduleRender();
    }

    async function handleRealtimeError(error) {
      applyLoadError(error, "meeting-hub-firestore-unavailable");
      scheduleRender();
    }

    async function handleParticipationRealtimeSnapshot(snapshot) {
      await applyParticipationSnapshotPayload(snapshot);
      state.items = getVisibleMeetingItems();
      scheduleRender();
    }

    async function handleParticipationRealtimeError(error) {
      applyLoadError(error, "meeting-participation-firestore-unavailable");
      scheduleRender();
    }

    async function ensureUsageLoaded(force = false) {
      if (!hasRequiredCapabilities()) {
        return state.usage;
      }
      const initialized = await ensureInitialized();
      if (!initialized) {
        return state.usage;
      }
      if (state.usageLoadPromise) {
        if (force) {
          state.usagePendingReload = true;
        }
        return state.usageLoadPromise;
      }
      if (!state.providerIdentity.available || !normalizeText(state.providerIdentity.providerUserKey)) {
        state.usage = {
          ...createUsageState(state.usage),
          dataFreshness: state.usage.checkedAt ? "stale" : "empty",
          degraded: false,
          degradedReason: "",
          error: "",
          source: state.usage.checkedAt ? "cache" : "none",
        };
        scheduleRender();
        return state.usage;
      }

      const run = (async () => {
        try {
          const snapshot = await meetingUsageRealtime.ensureSubscribed({
            forceRefresh: force,
            providerIdentity: buildProviderIdentityPayload(state.providerIdentity),
            settings: state.settings,
          });
          await applyUsageSnapshotPayload(snapshot);
          return state.usage;
        } catch (error) {
          applyUsageLoadError(error, "meeting-usage-firestore-unavailable");
          scheduleRender();
          return state.usage;
        }
      })();
      state.usageLoadPromise = run;
      try {
        return await run;
      } finally {
        if (state.usageLoadPromise === run) {
          state.usageLoadPromise = null;
        }
        if (state.usagePendingReload) {
          state.usagePendingReload = false;
          void ensureUsageLoaded(true);
        }
      }
    }

    async function handleUsageRealtimeSnapshot(snapshot) {
      await applyUsageSnapshotPayload(snapshot);
    }

    async function handleUsageRealtimeError(error) {
      applyUsageLoadError(error, "meeting-usage-firestore-unavailable");
      scheduleRender();
    }

    async function applyOwnedSnapshotPayload(snapshot) {
      const normalizedSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
      const items = normalizeMeetingItems(normalizedSnapshot.items);
      const fromCache = Boolean(normalizedSnapshot.fromCache);
      state.ownedItems = items;
      state.checkedAt = normalizeText(normalizedSnapshot.checkedAt) || new Date().toISOString();
      state.degraded = false;
      state.degradedReason = "";
      state.dataFreshness = fromCache ? "stale" : "fresh";
      state.error = "";
      state.source = fromCache ? "cache" : "realtime";
      scheduleRender();
    }

    async function applyParticipationSnapshotPayload(snapshot) {
      const normalizedSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
      const items = normalizeParticipationItems(normalizedSnapshot.items);
      const fromCache = Boolean(normalizedSnapshot.fromCache);
      state.participationItems = items;
      state.checkedAt = normalizeText(normalizedSnapshot.checkedAt) || state.checkedAt || new Date().toISOString();
      state.degraded = false;
      state.degradedReason = "";
      state.dataFreshness = fromCache || state.source === "cache" ? "stale" : "fresh";
      state.error = "";
      state.source = fromCache || state.source === "cache" ? "cache" : "realtime";
      scheduleRender();
    }

    async function applyUsageSnapshotPayload(snapshot) {
      const normalizedUsage = normalizeUsageSnapshot(snapshot);
      state.usage = {
        ...normalizedUsage,
        dataFreshness: normalizedUsage.fromCache ? "stale" : "fresh",
        degraded: false,
        degradedReason: "",
        error: "",
        source: normalizedUsage.fromCache ? "cache" : "realtime",
      };
      scheduleRender();
    }

    async function handleLaunchAction(action, input) {
      setPending({
        action,
        jobId: input.jobId,
        meetingId: input.meetingId,
        title: input.title,
      });
      try {
        traceMeeting("63.top.meeting.launch.requested", {
          action,
          jobId: input.jobId,
          meetingId: input.meetingId,
          title: input.title,
        });
        const providerIdentity = buildProviderIdentityPayload(state.providerIdentity);
        const openPromise = action === "open-result"
          ? openMeetingResult(input, providerIdentity)
          : openMeetingWorkspace(input, providerIdentity);
        traceMeeting("64.top.meeting.launch.dispatched", {
          action,
          jobId: input.jobId,
          meetingId: input.meetingId,
          title: input.title,
        });
        const result = await openPromise;
        traceMeeting("65.top.meeting.launch.accepted", {
          action,
          jobId: input.jobId,
          meetingId: input.meetingId,
          opened: Boolean(result?.opened),
          title: input.title,
          url: normalizeText(result?.url),
        });
        void recordFeatureUsage(
          "meeting",
          action === "open-result" ? "result_opened" : "workspace_opened",
          result?.opened ? "success" : "error",
          { providerIdentity }
        );
        setFeedback(action === "open-result" ? "결과 탭을 열었습니다." : "작업실 탭을 열었습니다.", "info", 1800);
      } catch (error) {
        traceMeeting("65.top.meeting.launch.error", {
          action,
          error: readErrorMessage(error, "작업실을 열지 못했어요. 다시 시도해 주세요."),
          jobId: input.jobId,
          meetingId: input.meetingId,
          title: input.title,
        });
        void recordFeatureUsage(
          "meeting",
          action === "open-result" ? "result_opened" : "workspace_opened",
          "error",
          { providerIdentity: buildProviderIdentityPayload(state.providerIdentity) }
        );
        setFeedback(readErrorMessage(error, "작업실을 열지 못했어요. 다시 시도해 주세요."), "error", 3600);
      } finally {
        clearPending();
      }
      return true;
    }

    function hydrateStorageState(storageState) {
      const providerIdentityCache = storageState?.providerIdentityCache && typeof storageState.providerIdentityCache === "object"
        ? storageState.providerIdentityCache
        : {};
      const providerIdentity = normalizeProviderIdentity(providerIdentityCache.providerIdentity);
      if (providerIdentity.providerUserKey || !normalizeText(state.providerIdentity.providerUserKey)) {
        state.providerIdentity = providerIdentity;
      }
      state.settings = {
        ...state.settings,
        ...(storageState?.settings && typeof storageState.settings === "object" ? storageState.settings : {}),
      };
    }

    function hydrateProviderIdentityFromPanel(panelState) {
      const providerIdentity = normalizeProviderIdentity(panelState?.providerIdentity);
      if (!providerIdentity.providerUserKey) {
        return false;
      }
      if (
        state.providerIdentity.providerUserKey === providerIdentity.providerUserKey
        && state.providerIdentity.email === providerIdentity.email
        && state.providerIdentity.displayName === providerIdentity.displayName
        && state.providerIdentity.numericUserId === providerIdentity.numericUserId
      ) {
        return false;
      }
      state.providerIdentity = providerIdentity;
      return true;
    }

    function applyLoadError(error, degradedReason = "") {
      const hasCachedItems = Array.isArray(state.items) && state.items.length > 0;
      state.checkedAt = new Date().toISOString();
      state.degraded = true;
      state.degradedReason = normalizeText(degradedReason) || (hasCachedItems ? "meeting-hub-stale-cache" : "meeting-hub-empty");
      state.dataFreshness = hasCachedItems ? "stale" : "empty";
      state.error = readErrorMessage(error, "회의 목록을 불러오지 못했어요.");
      state.source = hasCachedItems ? "cache" : "none";
    }

    function applyUsageLoadError(error, degradedReason = "") {
      const currentUsage = createUsageState(state.usage);
      state.usage = {
        ...currentUsage,
        checkedAt: currentUsage.checkedAt || new Date().toISOString(),
        dataFreshness: currentUsage.checkedAt ? "stale" : "empty",
        degraded: true,
        degradedReason: normalizeText(degradedReason) || "meeting-usage-empty",
        error: readErrorMessage(error, "회의 사용량을 불러오지 못했어요."),
        source: currentUsage.checkedAt ? (currentUsage.source || "cache") : "none",
      };
    }

    function patchShareState(meetingId, share) {
      const normalizedMeetingId = normalizeText(meetingId);
      if (!normalizedMeetingId || !Array.isArray(state.ownedItems) || !state.ownedItems.length) {
        return false;
      }
      const nextShare = normalizeShare(share);
      let changed = false;
      state.ownedItems = state.ownedItems.map((item) => {
        if (normalizeText(item?.meetingId) !== normalizedMeetingId) {
          return item;
        }
        changed = true;
        return {
          ...item,
          share: nextShare,
        };
      });
      if (changed) {
        state.items = getVisibleMeetingItems();
        scheduleRender();
      }
      return changed;
    }

    function setFeedback(text, tone = "info", timeoutMs = 2200) {
      global.clearTimeout(state.feedbackTimer);
      const nextText = normalizeText(text);
      state.feedback = null;
      state.feedbackTimer = 0;
      scheduleRender();
      if (!nextText) {
        return;
      }
      publishToast({
        contextId: normalizeText(state.pending.meetingId || state.pending.jobId || text),
        message: nextText,
        source: "meeting",
        tone: normalizeText(tone) === "error" ? "error" : "success",
        ttlMs: Math.max(0, Number(timeoutMs) || 0),
      });
    }

    function setPending(pending) {
      state.pending = {
        action: normalizeText(pending?.action),
        active: Boolean(normalizeText(pending?.action)),
        jobId: normalizeText(pending?.jobId),
        meetingId: normalizeText(pending?.meetingId),
        title: normalizeText(pending?.title),
      };
      scheduleRender();
    }

    function clearPending() {
      state.pending = createPendingState();
      scheduleRender();
    }

    async function copyShareUrl(shareUrl) {
      const normalizedShareUrl = normalizeText(shareUrl);
      if (!normalizedShareUrl) {
        return false;
      }
      try {
        const result = await writeClipboardText(normalizedShareUrl);
        return Boolean(result?.copied);
      } catch (error) {
        void error;
        return false;
      }
    }

    function hasCapability(capabilityId) {
      return state.capabilities.includes(normalizeText(capabilityId));
    }

    function setScope(scope) {
      const nextScope = normalizeMeetingScope(scope);
      if (state.activeScope === nextScope) {
        return false;
      }
      state.activeScope = nextScope;
      state.items = getVisibleMeetingItems();
      scheduleRender();
      return true;
    }

    function getMeetingCounts() {
      const ownedCount = Array.isArray(state.ownedItems) ? state.ownedItems.length : 0;
      const participatingCount = Array.isArray(state.participationItems) ? state.participationItems.length : 0;
      return {
        all: ownedCount + participatingCount,
        owned: ownedCount,
        participating: participatingCount,
      };
    }

    function getVisibleMeetingItems() {
      const scopedItems = resolveScopedItems();
      const query = normalizeText(state.query).toLowerCase();
      const filteredItems = query
        ? scopedItems.filter((item) => buildSearchText(item).includes(query))
        : scopedItems;
      return filteredItems
        .slice()
        .sort((left, right) =>
          Date.parse(normalizeText(right.updatedAt || right.createdAt)) - Date.parse(normalizeText(left.updatedAt || left.createdAt))
        )
        .slice(0, LIST_LIMIT);
    }

    function resolveScopedItems() {
      if (state.activeScope === "owned") {
        return state.ownedItems.slice();
      }
      if (state.activeScope === "participating") {
        return state.participationItems.slice();
      }
      return [...state.ownedItems, ...state.participationItems];
    }

    function buildSearchText(item) {
      return [
        item?.title,
        item?.owner?.displayName,
        item?.owner?.email,
      ].map((value) => normalizeText(value).toLowerCase()).filter(Boolean).join(" ");
    }

    function getShareParticipantCount(meetingId) {
      const normalizedMeetingId = normalizeText(meetingId);
      const item = state.ownedItems.find((candidate) => candidate.meetingId === normalizedMeetingId);
      return Math.max(0, Math.floor(Number(item?.share?.participantCount) || 0));
    }

    function setRevokeConfirmation(input = {}) {
      state.revokeConfirmation = {
        meetingId: normalizeText(input.meetingId),
        shareParticipantCount: getShareParticipantCount(input.meetingId),
        title: normalizeText(input.title),
      };
      scheduleRender();
    }

    function clearRevokeConfirmation() {
      if (!state.revokeConfirmation.meetingId) {
        return false;
      }
      state.revokeConfirmation = createRevokeConfirmationState();
      scheduleRender();
      return true;
    }

    function isShareActionBlocked(action) {
      if (action === "share") {
        return !hasCapability(MEETING_SHARE_CREATE_CAPABILITY_ID);
      }
      if (action === "revoke-share" || action === "confirm-revoke-share") {
        return !hasCapability(MEETING_SHARE_REVOKE_CAPABILITY_ID);
      }
      return false;
    }

    function buildCapabilityNotice() {
      if (
        hasCapability(MEETING_SHARE_CREATE_CAPABILITY_ID)
        && hasCapability(MEETING_SHARE_REVOKE_CAPABILITY_ID)
        && hasCapability(MEETING_PARTICIPATION_HIDE_CAPABILITY_ID)
      ) {
        return "";
      }
      return "회의 공유 또는 참여 목록 관리 기능이 현재 비활성화되어 일부 버튼을 표시하지 않습니다.";
    }

  }

  function createPendingState() {
    return {
      action: "",
      active: false,
      jobId: "",
      meetingId: "",
      title: "",
    };
  }

  function createRevokeConfirmationState() {
    return {
      meetingId: "",
      shareParticipantCount: 0,
      title: "",
    };
  }

  function createProviderIdentity() {
    return {
      available: false,
      displayName: "",
      email: "",
      numericUserId: null,
      provider: "inova",
      providerUserKey: "",
    };
  }

  function createUsageState(input = {}) {
    const usage = input && typeof input === "object" ? input : {};
    return {
      checkedAt: normalizeText(usage.checkedAt),
      dataFreshness: normalizeEnum(usage.dataFreshness, ["fresh", "stale", "empty"], "empty"),
      degraded: Boolean(usage.degraded),
      degradedReason: normalizeText(usage.degradedReason),
      error: normalizeText(usage.error),
      fromCache: Boolean(usage.fromCache),
      hasPendingWrites: Boolean(usage.hasPendingWrites),
      month: normalizeUsageMetric(usage.month),
      source: normalizeEnum(usage.source, ["realtime", "cache", "none"], "none"),
      total: normalizeUsageMetric(usage.total),
    };
  }

  function cloneUsageState(input) {
    return createUsageState(input);
  }

  function normalizeUsageSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    return {
      checkedAt: normalizeText(source.checkedAt) || new Date().toISOString(),
      fromCache: Boolean(source.fromCache),
      hasPendingWrites: Boolean(source.hasPendingWrites),
      month: normalizeUsageMetric(source.month),
      total: normalizeUsageMetric(source.total),
    };
  }

  function normalizeUsageMetric(input) {
    const metric = input && typeof input === "object" ? input : {};
    return {
      firstProcessedAt: normalizeText(metric.firstProcessedAt),
      lastProcessedAt: normalizeText(metric.lastProcessedAt),
      monthKey: normalizeText(metric.monthKey),
      processedCount: Math.max(0, Math.round(Number(metric.processedCount) || 0)),
      processedMs: Math.max(0, Math.round(Number(metric.processedMs) || 0)),
      providerUserKey: normalizeText(metric.providerUserKey),
      updatedAt: normalizeText(metric.updatedAt),
    };
  }

  function buildActionInput(detail) {
    const normalizedDetail = detail && typeof detail === "object" ? detail : {};
    return {
      artifactId: normalizeText(normalizedDetail.artifactId),
      jobId: normalizeText(normalizedDetail.jobId),
      meetingId: normalizeText(normalizedDetail.meetingId),
      participationId: normalizeText(normalizedDetail.participationId),
      sourceKind: normalizeText(normalizedDetail.sourceKind),
      title: normalizeText(normalizedDetail.title),
    };
  }

  function buildProviderIdentityPayload(providerIdentity) {
    const normalized = normalizeProviderIdentity(providerIdentity);
    return {
      available: normalized.available,
      displayName: normalized.displayName,
      email: normalized.email,
      numericUserId: normalized.numericUserId,
      provider: normalized.provider,
      providerUserKey: normalized.providerUserKey,
    };
  }

  function normalizeProviderIdentity(providerIdentity) {
    return {
      available: Boolean(providerIdentity?.available),
      displayName: normalizeText(providerIdentity?.displayName),
      email: normalizeText(providerIdentity?.email),
      numericUserId: Number.isFinite(Number(providerIdentity?.numericUserId))
        ? Number(providerIdentity.numericUserId)
        : null,
      provider: normalizeText(providerIdentity?.provider || "inova") || "inova",
      providerUserKey: normalizeText(providerIdentity?.providerUserKey),
    };
  }

  function normalizeMeetingItems(items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => !normalizeText(item?.deletedAt))
      .map((item) => ({
        accessState: "active",
        createdAt: normalizeText(item?.createdAt),
        latestArtifactId: normalizeText(item?.latestArtifactId || item?.artifactId),
        latestJobId: normalizeText(item?.latestJobId || item?.jobId),
        meetingId: normalizeText(item?.meetingId),
        owner: normalizeIdentitySummary(item?.owner),
        participationId: "",
        share: normalizeShare(item?.share),
        sourceKind: "owned",
        status: normalizeText(item?.status) || "idle",
        title: normalizeText(item?.title) || "이름 없는 회의",
        updatedAt: normalizeText(item?.updatedAt || item?.createdAt),
      }))
      .filter((item) => item.meetingId)
      .sort((left, right) =>
        Date.parse(normalizeText(right.updatedAt || right.createdAt)) - Date.parse(normalizeText(left.updatedAt || left.createdAt))
      )
      .slice(0, LIST_LIMIT);
  }

  function normalizeParticipationItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const owner = normalizeIdentitySummary(item?.owner);
        const accessState = normalizeEnum(item?.accessState, ["active", "revoked", "deleted", "domain-mismatch"], "active");
        return {
          accessState,
          createdAt: normalizeDateTimeText(item?.firstOpenedAt || item?.createdAt),
          latestArtifactId: "",
          latestJobId: "",
          meetingDocumentId: normalizeText(item?.meetingDocumentId),
          meetingId: normalizeText(item?.meetingId),
          owner,
          participationId: normalizeText(item?.participationId || item?.docId),
          share: {
            active: accessState === "active",
            createdAt: "",
            createdBy: {},
            revokedAt: accessState === "revoked" ? normalizeDateTimeText(item?.updatedAt) : "",
            shareId: normalizeText(item?.shareId),
            status: accessState === "active" ? "active" : accessState,
          },
          sourceKind: "participating",
          status: accessState === "active" ? "readonly" : "unavailable",
          title: normalizeText(item?.titleSnapshot || item?.title) || "이름 없는 회의",
          updatedAt: normalizeDateTimeText(item?.lastRefreshAt || item?.updatedAt || item?.firstOpenedAt),
        };
      })
      .filter((item) => item.meetingId && item.participationId)
      .sort((left, right) =>
        Date.parse(normalizeText(right.updatedAt || right.createdAt)) - Date.parse(normalizeText(left.updatedAt || left.createdAt))
      )
      .slice(0, LIST_LIMIT);
  }

  function normalizeIdentitySummary(identity) {
    const source = identity && typeof identity === "object" ? identity : {};
    return {
      displayName: normalizeText(source.displayName),
      email: normalizeText(source.email),
      providerUserKey: normalizeText(source.providerUserKey),
    };
  }

  function normalizeShare(share) {
    const nextShare = share && typeof share === "object" ? share : {};
    const status = normalizeText(nextShare.status);
    const shareId = normalizeText(nextShare.shareId);
    return {
      active: Boolean(nextShare.active) || (status === "active" && Boolean(shareId)),
      createdAt: normalizeText(nextShare.createdAt),
      createdBy: nextShare.createdBy && typeof nextShare.createdBy === "object"
        ? { ...nextShare.createdBy }
        : {},
      revokedAt: normalizeText(nextShare.revokedAt),
      participantCount: Math.max(0, Math.floor(Number(nextShare.participantCount) || 0)),
      lastParticipantAt: normalizeDateTimeText(nextShare.lastParticipantAt),
      participantCountUpdatedAt: normalizeDateTimeText(nextShare.participantCountUpdatedAt),
      shareId,
      status,
    };
  }

  function normalizePending(pending) {
    const action = normalizeText(pending?.action);
    return {
      action,
      active: Boolean(pending?.active) || Boolean(action),
      jobId: normalizeText(pending?.jobId),
      meetingId: normalizeText(pending?.meetingId),
      title: normalizeText(pending?.title),
    };
  }

  function normalizeFeedback(feedback) {
    const text = normalizeText(feedback?.text);
    return text
      ? {
          text,
          tone: normalizeText(feedback?.tone) || "info",
        }
      : null;
  }

  function normalizeMeetingScope(value) {
    const normalized = normalizeText(value).toLowerCase();
    return MEETING_SCOPE_IDS.includes(normalized) ? normalized : "all";
  }

  function normalizeEnum(value, allowedValues, fallback) {
    const normalized = normalizeText(value).toLowerCase();
    return Array.isArray(allowedValues) && allowedValues.includes(normalized)
      ? normalized
      : fallback;
  }

  function normalizeDateTimeText(value) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return normalizeText(value);
    }
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? "" : date.toISOString();
    }
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) {
      const nanos = Number(value.nanoseconds ?? value._nanoseconds) || 0;
      return new Date((seconds * 1000) + Math.floor(nanos / 1000000)).toISOString();
    }
    return normalizeText(value);
  }

  function readErrorMessage(error, fallbackMessage) {
    const message = normalizeText(error instanceof Error ? error.message : error);
    return message || fallbackMessage;
  }

  function resolveLaunchAction(action, input) {
    if (action === "share" || action === "revoke-share" || action === "confirm-revoke-share" || action === "cancel-revoke-share" || action === "remove-participation" || action === "set-scope") {
      return "";
    }
    if (action === "open-result" && (input?.meetingId || input?.jobId)) {
      return "open-result";
    }
    return "open-workspace";
  }

  namespace.meetingHubController = { create };
})(globalThis);
