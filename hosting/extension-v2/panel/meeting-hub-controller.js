(function initMeetingHubController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const ACTIVE_REFRESH_TTL_MS = 30 * 1000;
  const LIST_LIMIT = 24;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);
  const RETRY_COOLDOWN_MS = 15 * 1000;

  function create(options = {}) {
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};

    const state = {
      capabilities: [],
      checkedAt: "",
      dataFreshness: "empty",
      degraded: false,
      degradedReason: "",
      error: "",
      feedback: null,
      feedbackTimer: 0,
      initialized: false,
      initializing: false,
      items: [],
      lastLoadProviderKey: "",
      lastLoadRequestedAt: 0,
      loadPromise: null,
      loading: false,
      pending: createPendingState(),
      providerIdentity: createProviderIdentity(),
      settings: {
        meetingDebugConsoleEnabled: false,
      },
      source: "none",
      wasMeetingToolActive: false,
    };

    return {
      buildViewState,
      getMeetingCount,
      handleMeetingAction,
      hasRequiredCapabilities,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
      if (!hasRequiredCapabilities()) {
        return;
      }
      const meetingToolActive = normalizeText(panelState?.activeTool) === "meeting";
      const becameActive = meetingToolActive && !state.wasMeetingToolActive;
      state.wasMeetingToolActive = meetingToolActive;
      state.settings = {
        ...state.settings,
        ...(panelState?.settings && typeof panelState.settings === "object" ? panelState.settings : {}),
      };
      if (state.initialized || state.initializing) {
        if (shouldRefreshMeetingList(meetingToolActive, becameActive)) {
          void ensureLoaded(false, becameActive ? "activate" : "sync");
        }
        return;
      }
      void ensureInitialized(panelState);
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getMeetingCount() {
      return Array.isArray(state.items) ? state.items.length : 0;
    }

    function buildViewState(fallbackMeetingTool = {}) {
      if (!hasRequiredCapabilities()) {
        return fallbackMeetingTool;
      }
      return {
        checkedAt: state.checkedAt,
        count: getMeetingCount(),
        dataFreshness: state.dataFreshness,
        degraded: state.degraded,
        degradedReason: state.degradedReason,
        error: state.error,
        feedback: state.feedback,
        items: state.items.slice(),
        pending: { ...state.pending },
        source: state.source,
      };
    }

    async function handleMeetingAction(action, detail = {}) {
      const normalizedAction = normalizeText(action);
      if (!normalizedAction) {
        return false;
      }
      await ensureInitialized({ activeTool: "meeting" });
      if (state.pending.action) {
        return true;
      }
      const input = {
        jobId: normalizeText(detail.jobId),
        meetingId: normalizeText(detail.meetingId),
        title: normalizeText(detail.title),
      };
      setPending({
        action: resolvePendingAction(normalizedAction),
        jobId: input.jobId,
        meetingId: input.meetingId,
        startedAt: Date.now(),
        title: input.title,
      });
      try {
        if (normalizedAction === "share" && input.meetingId) {
          const result = await invokeRuntime({
            action: "meeting.create-share-link",
            input,
            providerIdentity: buildProviderIdentityPayload(),
          });
          const shareUrl = normalizeText(result?.shareUrl);
          if (!shareUrl) {
            throw new Error("공유 링크를 만들지 못했어요.");
          }
          await global.navigator.clipboard.writeText(shareUrl);
          patchShareState(input.meetingId, result?.share);
          setFeedback("공유 링크를 복사했습니다.", "info", 2200);
          return true;
        }
        if (normalizedAction === "revoke-share" && input.meetingId) {
          const result = await invokeRuntime({
            action: "meeting.revoke-share-link",
            input,
            providerIdentity: buildProviderIdentityPayload(),
          });
          patchShareState(input.meetingId, result?.share);
          setFeedback("공유 링크를 해제했습니다.", "info", 2200);
          return true;
        }

        await invokeRuntime({
          action: normalizedAction === "open-result" ? "meeting.open-result" : "meeting.open-workspace",
          input: {
            ...input,
            jobId: normalizedAction === "open-result" ? input.jobId : "",
          },
          providerIdentity: buildProviderIdentityPayload(),
        });
        setFeedback(normalizedAction === "open-result" ? "결과 탭을 열었습니다." : "작업실 탭을 열었습니다.", "info", 1800);
        return true;
      } catch (error) {
        setFeedback(getErrorMessage(error, "작업실을 열지 못했어요. 다시 시도해 주세요."), "error", 3600);
        return true;
      } finally {
        clearPending();
      }
    }

    async function ensureInitialized(panelState) {
      if (state.initialized || state.initializing) {
        return;
      }
      state.initializing = true;
      try {
        const storageState = await invokeRuntime({ action: "storage.get-state" });
        hydrateStorageState(storageState);
        state.initialized = true;
        if (panelState?.activeTool === "meeting") {
          void ensureLoaded(false, "bootstrap");
        }
      } catch (error) {
        state.error = getErrorMessage(error, "회의 허브 상태를 준비하지 못했어요.");
        state.degraded = true;
        state.degradedReason = "meeting-hub-init-failed";
      } finally {
        state.initializing = false;
        scheduleRender();
      }
    }

    async function ensureLoaded(force = false, reason = "scheduled") {
      void reason;
      if (state.loadPromise && !force) {
        return state.loadPromise;
      }
      state.lastLoadRequestedAt = Date.now();
      state.lastLoadProviderKey = normalizeText(state.providerIdentity.providerUserKey);
      if (!state.providerIdentity.available) {
        state.error = "사용자 정보를 확인하지 못했어요.";
        state.degraded = true;
        state.degradedReason = "identity-required";
        state.dataFreshness = "empty";
        scheduleRender();
        return state.items;
      }

      const run = (async () => {
        state.loading = true;
        scheduleRender();
        try {
          const result = await invokeRuntime({
            action: "functions.fetch",
            authMode: "access-token",
            body: {
              limit: LIST_LIMIT,
              owner: buildProviderIdentityPayload(),
            },
            endpointKey: "listInovaMeetingsUrl",
            service: "meeting",
          });
          state.items = normalizeMeetingItems(result?.items);
          state.checkedAt = new Date().toISOString();
          state.dataFreshness = "fresh";
          state.degraded = false;
          state.degradedReason = "";
          state.error = "";
          state.source = "runtime-read";
          return state.items;
        } catch (error) {
          state.checkedAt = new Date().toISOString();
          state.error = getErrorMessage(error, "회의 목록을 불러오지 못했어요.");
          state.degraded = true;
          state.degradedReason = state.items.length ? "meeting-hub-stale-cache" : "meeting-hub-empty";
          state.dataFreshness = state.items.length ? "stale" : "empty";
          state.source = state.items.length ? "cache" : "none";
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
      }
    }

    function shouldRefreshMeetingList(meetingToolActive, becameActive) {
      if (!meetingToolActive || state.initializing || state.loading || state.loadPromise) {
        return false;
      }
      const providerUserKey = normalizeText(state.providerIdentity.providerUserKey);
      const loadAgeMs = state.lastLoadRequestedAt ? Date.now() - state.lastLoadRequestedAt : Number.POSITIVE_INFINITY;
      if (!state.lastLoadRequestedAt || state.lastLoadProviderKey !== providerUserKey) {
        return true;
      }
      if (!state.checkedAt || state.dataFreshness !== "fresh") {
        return loadAgeMs >= RETRY_COOLDOWN_MS;
      }
      if (becameActive) {
        return loadAgeMs >= ACTIVE_REFRESH_TTL_MS;
      }
      return false;
    }

    function hydrateStorageState(storageState) {
      const cloudSync = storageState?.cloudSync && typeof storageState.cloudSync === "object"
        ? storageState.cloudSync
        : {};
      const providerIdentity = cloudSync.providerIdentity && typeof cloudSync.providerIdentity === "object"
        ? cloudSync.providerIdentity
        : {};
      state.providerIdentity = {
        available: Boolean(providerIdentity.available),
        displayName: normalizeText(providerIdentity.displayName),
        email: normalizeText(providerIdentity.email),
        numericUserId: Number.isFinite(Number(providerIdentity.numericUserId))
          ? Number(providerIdentity.numericUserId)
          : null,
        provider: normalizeText(providerIdentity.provider || "inova") || "inova",
        providerUserKey: normalizeText(providerIdentity.providerUserKey),
      };
      const settings = storageState?.settings && typeof storageState.settings === "object"
        ? storageState.settings
        : {};
      state.settings = {
        ...state.settings,
        ...settings,
      };
    }

    function buildProviderIdentityPayload() {
      return {
        available: Boolean(state.providerIdentity.available),
        displayName: state.providerIdentity.displayName,
        email: state.providerIdentity.email,
        numericUserId: state.providerIdentity.numericUserId,
        provider: state.providerIdentity.provider,
        providerUserKey: state.providerIdentity.providerUserKey,
      };
    }

    function patchShareState(meetingId, share) {
      const normalizedMeetingId = normalizeText(meetingId);
      if (!normalizedMeetingId) {
        return;
      }
      let changed = false;
      state.items = state.items.map((item) => {
        if (normalizeText(item?.meetingId) !== normalizedMeetingId) {
          return item;
        }
        changed = true;
        return {
          ...item,
          share: normalizeShare(share),
        };
      });
      if (changed) {
        scheduleRender();
      }
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
        jobId: normalizeText(pending?.jobId),
        meetingId: normalizeText(pending?.meetingId),
        startedAt: Math.max(0, Number(pending?.startedAt) || Date.now()),
        title: normalizeText(pending?.title),
      };
      scheduleRender();
    }

    function clearPending() {
      state.pending = createPendingState();
      scheduleRender();
    }

    function normalizeMeetingItems(items) {
      return (Array.isArray(items) ? items : [])
        .filter((item) => !normalizeText(item?.deletedAt))
        .map((item) => ({
          ...(item && typeof item === "object" ? item : {}),
          latestArtifactId: normalizeText(item?.latestArtifactId || item?.artifactId),
          latestJobId: normalizeText(item?.latestJobId || item?.jobId),
          meetingId: normalizeText(item?.meetingId),
          share: normalizeShare(item?.share),
          status: normalizeText(item?.status) || "idle",
          title: normalizeText(item?.title) || "이름 없는 회의",
          updatedAt: normalizeText(item?.updatedAt || item?.createdAt),
        }))
        .filter((item) => item.meetingId)
        .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    }

    function normalizeShare(share) {
      if (share && typeof share === "object") {
        return {
          active: Boolean(share.active),
          createdAt: normalizeText(share.createdAt),
          createdBy: share.createdBy && typeof share.createdBy === "object" ? { ...share.createdBy } : {},
          revokedAt: normalizeText(share.revokedAt),
          shareId: normalizeText(share.shareId),
          status: normalizeText(share.status),
        };
      }
      return {
        active: false,
        createdAt: "",
        createdBy: {},
        revokedAt: "",
        shareId: "",
        status: "",
      };
    }

    function createPendingState() {
      return { action: "", jobId: "", meetingId: "", startedAt: 0, title: "" };
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

    function resolvePendingAction(action) {
      if (action === "open-result") return "open-result";
      if (action === "share") return "share";
      if (action === "revoke-share") return "revoke-share";
      return "open-workspace";
    }

    function normalizeText(value) {
      return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    }

    function getErrorMessage(error, fallback) {
      return normalizeText(error instanceof Error ? error.message : error) || fallback;
    }
  }

  namespace.meetingHubController = { create };
})(globalThis);
