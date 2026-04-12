(function initMeetingHubController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LIST_LIMIT = 24;
  const SUPPORTED_ACTIONS = new Set([
    "open-result",
    "open-workspace",
    "share",
    "revoke-share",
  ]);
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const invokePage = typeof options.invokePage === "function"
      ? options.invokePage
      : async () => ({});
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};
    const syncTopPanelSummary = typeof options.syncTopPanelSummary === "function"
      ? options.syncTopPanelSummary
      : async () => false;
    const traceMeeting = typeof options.traceMeeting === "function"
      ? options.traceMeeting
      : () => {};
    const state = {
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
      lastCount: 0,
      lastLoadedFingerprint: "",
      loadPromise: null,
      loading: false,
      panelOpen: false,
      pending: createPendingState(),
      pendingReload: false,
      providerIdentity: createProviderIdentity(),
      settings: {
        meetingDebugConsoleEnabled: false,
        meetingWorkspaceTarget: "production",
        meetingWorkspaceUrlOverride: "",
      },
      snapshotFingerprint: "",
      source: "none",
    };

    return {
      buildViewState,
      getMeetingCount,
      handleHostActivity,
      handleMeetingAction,
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
      const fallbackMeetingTool = panelState?.meetingTool && typeof panelState.meetingTool === "object"
        ? panelState.meetingTool
        : {};
      state.settings = {
        ...state.settings,
        ...(panelState?.settings && typeof panelState.settings === "object" ? panelState.settings : {}),
      };
      state.lastCount = Math.max(0, Number(fallbackMeetingTool.count) || state.items.length || state.lastCount);
      if (!hasRequiredCapabilities()) {
        return;
      }
      const nextFingerprint = normalizeText(fallbackMeetingTool.snapshotFingerprint);
      const fingerprintChanged = Boolean(nextFingerprint) && state.snapshotFingerprint !== nextFingerprint;
      if (fingerprintChanged) {
        state.snapshotFingerprint = nextFingerprint;
      } else if (!state.snapshotFingerprint && nextFingerprint) {
        state.snapshotFingerprint = nextFingerprint;
      }
      if (nextActiveTool !== "meeting") {
        return;
      }
      const shouldForceReload = fingerprintChanged || meetingToolBecameActive || panelReopenedIntoMeeting;
      if (shouldForceReload || !state.lastLoadedFingerprint || !state.initialized) {
        void ensureLoaded(shouldForceReload);
      }
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getMeetingCount() {
      return Math.max(0, Number(state.items.length) || Number(state.lastCount) || 0);
    }

    function buildViewState(fallbackMeetingTool = {}) {
      if (!hasRequiredCapabilities()) {
        return fallbackMeetingTool;
      }
      const fallbackCount = Math.max(0, Number(fallbackMeetingTool.count) || 0);
      state.lastCount = Math.max(0, getMeetingCount() || fallbackCount);
      return {
        checkedAt: normalizeText(state.checkedAt),
        count: state.lastCount,
        dataFreshness: normalizeEnum(state.dataFreshness, ["fresh", "stale", "empty"], "empty"),
        degraded: Boolean(state.degraded),
        degradedReason: normalizeText(state.degradedReason),
        error: normalizeText(state.error),
        feedback: normalizeFeedback(state.feedback),
        items: state.items.slice(),
        pending: normalizePending(state.pending),
        source: normalizeEnum(state.source, ["runtime-read", "cache", "none"], "none"),
      };
    }

    function handleHostActivity(reason) {
      const normalizedReason = normalizeText(reason);
      if (!hasRequiredCapabilities()) {
        return false;
      }
      if (normalizedReason !== "window-focus" && normalizedReason !== "visibility-visible") {
        return false;
      }
      if (state.activeTool !== "meeting" || !state.panelOpen) {
        return false;
      }
      traceMeeting("66.top.meeting.host-activity.refresh", {
        open: state.panelOpen,
        reason: normalizedReason,
      });
      void ensureLoaded(true);
      return true;
    }

    async function handleMeetingAction(action, detail = {}) {
      const normalizedAction = normalizeText(action);
      if (!SUPPORTED_ACTIONS.has(normalizedAction) || !hasRequiredCapabilities()) {
        return false;
      }
      if (state.pending.active) {
        return true;
      }
      await refreshStorageState();
      const input = buildActionInput(detail);
      const launchAction = resolveLaunchAction(normalizedAction, input);

      if ((normalizedAction === "share" || normalizedAction === "revoke-share") && !input.meetingId) {
        setFeedback("회의 정보를 찾지 못했어요. 다시 시도해 주세요.", "error", 3600);
        return true;
      }

      if (launchAction) {
        await handleLaunchAction(launchAction, input);
        return true;
      }

      setPending({
        action: normalizedAction,
        jobId: input.jobId,
        meetingId: input.meetingId,
        title: input.title,
      });

      try {
        if (normalizedAction === "share") {
          traceMeeting("63.top.meeting.bridge.share.start", input);
          const result = await invokeRuntime({
            action: "meeting.create-share-link",
            input,
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

        traceMeeting("63.top.meeting.bridge.revoke-share.start", input);
        const result = await invokeRuntime({
          action: "meeting.revoke-share-link",
          input,
          providerIdentity: buildProviderIdentityPayload(state.providerIdentity),
        });
        patchShareState(input.meetingId, result?.share);
        traceMeeting("64.top.meeting.bridge.revoke-share.success", {
          meetingId: input.meetingId,
        });
        setFeedback("공유 링크를 해제했습니다.", "info", 2200);
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

    async function ensureInitialized() {
      if (state.initialized) {
        return true;
      }
      if (state.initPromise) {
        return state.initPromise;
      }
      state.initPromise = (async () => {
        try {
          const storageState = await invokeRuntime({ action: "storage.get-state" });
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
        const storageState = await invokeRuntime({ action: "storage.get-state" });
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
      if (!force && state.lastLoadedFingerprint && state.lastLoadedFingerprint === state.snapshotFingerprint && !state.error) {
        return state.items;
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
        try {
          const result = await invokeRuntime({
            action: "functions.fetch",
            authMode: "access-token",
            body: {
              cursor: "",
              limit: LIST_LIMIT,
              owner: buildProviderIdentityPayload(state.providerIdentity),
            },
            endpointKey: "listInovaMeetingsUrl",
            service: "meeting",
          });
          const items = normalizeMeetingItems(result?.items);
          state.items = items;
          state.checkedAt = normalizeText(result?.checkedAt) || new Date().toISOString();
          state.degraded = false;
          state.degradedReason = "";
          state.dataFreshness = "fresh";
          state.error = "";
          state.source = "runtime-read";
          state.lastCount = Math.max(0, Number(result?.totalCount) || items.length);
          await emitTopPanelSummary();
          state.lastLoadedFingerprint = state.snapshotFingerprint;
          return state.items;
        } catch (error) {
          applyLoadError(error);
          await emitTopPanelSummary();
          state.lastLoadedFingerprint = state.snapshotFingerprint;
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
        if (state.pendingReload) {
          state.pendingReload = false;
          void ensureLoaded(true);
        }
      }
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
        const requestPayload = {
          action: action === "open-result" ? "meeting.open-result" : "meeting.open-workspace",
          input,
          providerIdentity: buildProviderIdentityPayload(state.providerIdentity),
        };
        const openPromise = invokeRuntime(requestPayload);
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
        setFeedback(action === "open-result" ? "결과 탭을 열었습니다." : "작업실 탭을 열었습니다.", "info", 1800);
      } catch (error) {
        traceMeeting("65.top.meeting.launch.error", {
          action,
          error: readErrorMessage(error, "작업실을 열지 못했어요. 다시 시도해 주세요."),
          jobId: input.jobId,
          meetingId: input.meetingId,
          title: input.title,
        });
        setFeedback(readErrorMessage(error, "작업실을 열지 못했어요. 다시 시도해 주세요."), "error", 3600);
      } finally {
        clearPending();
      }
      return true;
    }

    function hydrateStorageState(storageState) {
      const cloudSync = storageState?.cloudSync && typeof storageState.cloudSync === "object"
        ? storageState.cloudSync
        : {};
      state.providerIdentity = normalizeProviderIdentity(cloudSync.providerIdentity);
      state.settings = {
        ...state.settings,
        ...(storageState?.settings && typeof storageState.settings === "object" ? storageState.settings : {}),
      };
    }

    function applyLoadError(error) {
      const hasCachedItems = Array.isArray(state.items) && state.items.length > 0;
      state.checkedAt = new Date().toISOString();
      state.degraded = true;
      state.degradedReason = hasCachedItems ? "meeting-hub-stale-cache" : "meeting-hub-empty";
      state.dataFreshness = hasCachedItems ? "stale" : "empty";
      state.error = readErrorMessage(error, "회의 목록을 불러오지 못했어요.");
      state.source = hasCachedItems ? "cache" : "none";
    }

    function patchShareState(meetingId, share) {
      const normalizedMeetingId = normalizeText(meetingId);
      if (!normalizedMeetingId || !Array.isArray(state.items) || !state.items.length) {
        return false;
      }
      const nextShare = normalizeShare(share);
      let changed = false;
      state.items = state.items.map((item) => {
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
        scheduleRender();
      }
      return changed;
    }

    function setFeedback(text, tone = "info", timeoutMs = 2200) {
      global.clearTimeout(state.feedbackTimer);
      const nextText = normalizeText(text);
      state.feedback = nextText
        ? {
            text: nextText,
            tone: normalizeText(tone) || "info",
          }
        : null;
      scheduleRender();
      if (!nextText || timeoutMs <= 0) {
        state.feedbackTimer = 0;
        return;
      }
      state.feedbackTimer = global.setTimeout(() => {
        state.feedback = null;
        state.feedbackTimer = 0;
        scheduleRender();
      }, timeoutMs);
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
        const result = await invokePage({
          action: "copy-text",
          text: normalizedShareUrl,
        });
        return Boolean(result?.copied);
      } catch (error) {
        void error;
        return false;
      }
    }

    async function emitTopPanelSummary() {
      if (!hasRequiredCapabilities()) {
        return false;
      }
      const summary = buildTopPanelSummary();
      state.snapshotFingerprint = normalizeText(summary.snapshotFingerprint) || state.snapshotFingerprint;
      try {
        await syncTopPanelSummary(summary);
        return true;
      } catch (error) {
        void error;
        return false;
      }
    }

    function buildTopPanelSummary() {
      const count = Math.max(0, Number(state.lastCount) || state.items.length || 0);
      return {
        checkedAt: normalizeText(state.checkedAt),
        count,
        dataFreshness: normalizeEnum(state.dataFreshness, ["fresh", "stale", "empty"], "empty"),
        degraded: Boolean(state.degraded),
        degradedReason: normalizeText(state.degradedReason),
        error: normalizeText(state.error),
        snapshotFingerprint: buildMeetingToolFingerprint({
          checkedAt: state.checkedAt,
          count,
          dataFreshness: state.dataFreshness,
          degraded: state.degraded,
          error: state.error,
          items: state.items,
        }),
        source: normalizeEnum(state.source, ["runtime-read", "cache", "none"], "none"),
      };
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

  function buildActionInput(detail) {
    const normalizedDetail = detail && typeof detail === "object" ? detail : {};
    return {
      artifactId: normalizeText(normalizedDetail.artifactId),
      jobId: normalizeText(normalizedDetail.jobId),
      meetingId: normalizeText(normalizedDetail.meetingId),
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
        createdAt: normalizeText(item?.createdAt),
        latestArtifactId: normalizeText(item?.latestArtifactId || item?.artifactId),
        latestJobId: normalizeText(item?.latestJobId || item?.jobId),
        meetingId: normalizeText(item?.meetingId),
        share: normalizeShare(item?.share),
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

  function buildMeetingToolFingerprint(meetingTool = {}) {
    const items = Array.isArray(meetingTool.items) ? meetingTool.items : [];
    const count = Math.max(0, Number(meetingTool.count) || items.length);
    return [
      String(count),
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

  function normalizeEnum(value, allowedValues, fallback) {
    const normalized = normalizeText(value).toLowerCase();
    return Array.isArray(allowedValues) && allowedValues.includes(normalized)
      ? normalized
      : fallback;
  }

  function readErrorMessage(error, fallbackMessage) {
    const message = normalizeText(error instanceof Error ? error.message : error);
    return message || fallbackMessage;
  }

  function resolveLaunchAction(action, input) {
    if (action === "share" || action === "revoke-share") {
      return "";
    }
    if (action === "open-result" && (input?.meetingId || input?.jobId)) {
      return "open-result";
    }
    return "open-workspace";
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  namespace.meetingHubController = { create };
})(globalThis);
