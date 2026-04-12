(function initMeetingHubController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LIST_LIMIT = 24;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

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
      initialized: false,
      initPromise: null,
      items: [],
      lastCount: 0,
      lastLoadedFingerprint: "",
      loadPromise: null,
      loading: false,
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
      handleMeetingAction,
      hasRequiredCapabilities,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
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
      if (normalizeText(panelState?.activeTool) !== "meeting") {
        return;
      }
      if (fingerprintChanged || !state.lastLoadedFingerprint || !state.initialized) {
        void ensureLoaded(fingerprintChanged, fingerprintChanged ? "snapshot" : state.initialized ? "activate" : "bootstrap");
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
        feedback: normalizeFeedback(fallbackMeetingTool.feedback),
        items: state.items.slice(),
        pending: normalizePending(fallbackMeetingTool.pending),
        source: normalizeEnum(state.source, ["runtime-read", "cache", "none"], "none"),
      };
    }

    async function handleMeetingAction() {
      return false;
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
          state.lastLoadedFingerprint = state.snapshotFingerprint;
          return state.items;
        } catch (error) {
          applyLoadError(error);
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
      active: Boolean(action),
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

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  namespace.meetingHubController = { create };
})(globalThis);
