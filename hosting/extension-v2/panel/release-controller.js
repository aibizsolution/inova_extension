(function initReleaseController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const CHECK_INTERVAL_MS = Number(namespace.constants?.limits?.releaseCheckIntervalMs) || 21600000;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const getRuntimeVersion = typeof options.getRuntimeVersion === "function"
      ? options.getRuntimeVersion
      : () => "";
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};

    const state = {
      capabilities: [],
      checking: false,
      checkedAt: "",
      checkedForVersion: "",
      dataFreshness: "empty",
      degraded: false,
      degradedReason: "",
      error: "",
      history: [],
      historyCheckedAt: "",
      historyCheckedForVersion: "",
      historyLoading: false,
      initialized: false,
      latest: null,
      source: "none",
    };

    return {
      buildViewState,
      getReleaseCount,
      handleReleaseAction,
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
      if (!state.initialized) {
        state.initialized = true;
        void ensureChecked(false, panelState?.activeTool === "release");
        return;
      }
      if (panelState?.activeTool === "release") {
        void ensureChecked(false, true);
      }
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getReleaseCount() {
      return buildViewState().updateAvailable ? 1 : 0;
    }

    function buildViewState(fallbackReleaseTool = {}) {
      if (!hasRequiredCapabilities()) {
        return fallbackReleaseTool;
      }
      const currentVersion = getCurrentVersion();
      const checkedForCurrentVersion = state.checkedForVersion === currentVersion;
      const historyCheckedForCurrentVersion = state.historyCheckedForVersion === currentVersion;
      const latestVersion = normalizeText(state.latest?.version);
      const updateAvailable = Boolean(
        latestVersion
        && checkedForCurrentVersion
        && compareVersions(currentVersion, latestVersion) < 0
      );
      return {
        checking: Boolean(state.checking),
        currentAheadOfLatest: Boolean(
          latestVersion
          && checkedForCurrentVersion
          && compareVersions(currentVersion, latestVersion) > 0
        ),
        currentVersion,
        degraded: Boolean(state.degraded),
        degradedReason: normalizeText(state.degradedReason),
        dataFreshness: normalizeEnum(state.dataFreshness, ["fresh", "stale", "empty"], "empty"),
        error: normalizeText(state.error),
        history: Array.isArray(state.history) ? state.history.slice() : [],
        historyLoading: Boolean(state.historyLoading),
        historyRefreshPending: Boolean(state.history.length) && !historyCheckedForCurrentVersion,
        lastCheckedAt: normalizeText(state.checkedAt),
        latest: state.latest,
        latestVersion,
        source: normalizeEnum(state.source, ["hosting", "cache", "none"], "none"),
        updateAvailable,
        versionRefreshPending: Boolean(state.latest) && !checkedForCurrentVersion,
      };
    }

    async function handleReleaseAction(action, detail = {}) {
      const normalizedAction = normalizeText(action);
      if (!normalizedAction) {
        return false;
      }
      if (normalizedAction === "refresh") {
        await ensureChecked(true, true);
        return true;
      }
      if (normalizedAction === "download-latest") {
        await openDownload(buildViewState().latest?.downloadUrl);
        return true;
      }
      if (normalizedAction === "download-version") {
        await openDownload(
          state.history.find((item) => normalizeText(item?.version) === normalizeText(detail.version))?.downloadUrl
        );
        return true;
      }
      return false;
    }

    async function ensureChecked(force = false, includeHistory = false) {
      const currentVersion = getCurrentVersion();
      const needsLatest = force
        || !state.latest
        || state.checkedForVersion !== currentVersion
        || !isFresh(state.checkedAt, CHECK_INTERVAL_MS);
      const needsHistory = includeHistory && (
        force
        || !state.history.length
        || state.historyCheckedForVersion !== currentVersion
        || !isFresh(state.historyCheckedAt, CHECK_INTERVAL_MS)
      );
      if (!needsLatest && !needsHistory) {
        return;
      }

      state.checking = needsLatest;
      state.historyLoading = needsHistory;
      scheduleRender();
      try {
        const checkedAt = new Date().toISOString();
        const [latestPayload, historyPayload] = await Promise.all([
          needsLatest ? fetchJson("../releases/latest.json") : Promise.resolve(null),
          needsHistory ? fetchJson("../releases/history.json") : Promise.resolve(null),
        ]);
        state.latest = latestPayload?.release || state.latest;
        state.history = Array.isArray(historyPayload?.releases) ? historyPayload.releases : state.history;
        state.checkedAt = needsLatest ? checkedAt : state.checkedAt;
        state.checkedForVersion = needsLatest ? currentVersion : state.checkedForVersion;
        state.historyCheckedAt = needsHistory ? checkedAt : state.historyCheckedAt;
        state.historyCheckedForVersion = needsHistory ? currentVersion : state.historyCheckedForVersion;
        state.degraded = false;
        state.degradedReason = "";
        state.dataFreshness = "fresh";
        state.error = "";
        state.source = "hosting";
      } catch (error) {
        const hasCachedData = Boolean(state.latest || state.history.length || state.checkedAt);
        state.degraded = true;
        state.degradedReason = "release-fetch-failed";
        state.dataFreshness = hasCachedData ? "stale" : "empty";
        state.error = getErrorMessage(error, "릴리스 정보를 확인하지 못했어요.");
        state.source = hasCachedData ? "cache" : "none";
      } finally {
        state.checking = false;
        state.historyLoading = false;
        scheduleRender();
      }
    }

    async function openDownload(url) {
      const nextUrl = normalizeText(url);
      if (!nextUrl) {
        return;
      }
      await invokeRuntime({
        action: "browser.open-url",
        url: nextUrl,
      });
    }

    async function fetchJson(relativePath) {
      const response = await fetch(new URL(relativePath, global.location.href), {
        cache: "no-store",
        method: "GET",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error("릴리스 정보를 불러오지 못했어요.");
      }
      return payload;
    }

    function getCurrentVersion() {
      return normalizeText(getRuntimeVersion()) || "알 수 없음";
    }

    function isFresh(checkedAt, ttlMs) {
      const time = Date.parse(checkedAt || "");
      return Boolean(time && time > Date.now() - ttlMs);
    }

    function compareVersions(left, right) {
      const leftParts = splitVersion(left);
      const rightParts = splitVersion(right);
      const size = Math.max(leftParts.length, rightParts.length);
      for (let index = 0; index < size; index += 1) {
        const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
        if (diff !== 0) {
          return diff;
        }
      }
      return 0;
    }

    function splitVersion(value) {
      return normalizeText(value)
        .split(".")
        .map((part) => Number.parseInt(part, 10))
        .map((part) => (Number.isFinite(part) ? part : 0));
    }

    function normalizeEnum(value, allowed, fallback) {
      const normalized = normalizeText(value).toLowerCase();
      return allowed.includes(normalized) ? normalized : fallback;
    }

    function normalizeText(value) {
      return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    }

    function getErrorMessage(error, fallback) {
      return normalizeText(error instanceof Error ? error.message : error) || fallback;
    }
  }

  namespace.releaseController = { create };
})(globalThis);
