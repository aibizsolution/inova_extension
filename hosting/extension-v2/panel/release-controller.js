(function initReleaseController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.panelUtils?.normalizeText
    || namespace.session?.normalizeText
    || ((value) => String(value ?? "").trim());
  const CHECK_INTERVAL_MS = Number(namespace.constants?.limits?.releaseCheckIntervalMs) || 21600000;
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const getRuntimeVersion = typeof options.getRuntimeVersion === "function"
      ? options.getRuntimeVersion
      : () => "";
    const openBrowserUrl = typeof browserCapabilities.openBrowserUrl === "function"
      ? browserCapabilities.openBrowserUrl
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};
    const traceRelease = typeof options.traceRelease === "function"
      ? options.traceRelease
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
        void ensureChecked(false, false);
        return;
      }
      if (panelState?.activeTool === "release") {
        void ensureChecked(false, false);
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
        state.latest = normalizeReleaseRecord(latestPayload?.release, { preferLatestAlias: true }) || state.latest;
        state.history = Array.isArray(historyPayload?.releases)
          ? historyPayload.releases.map((item) => normalizeReleaseRecord(item)).filter(Boolean)
          : state.history;
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
      await openBrowserUrl(nextUrl);
    }

    async function fetchJson(relativePath) {
      const startedAt = Date.now();
      traceRelease("34.hosted.release.fetch.start", {
        message: normalizeText(relativePath),
      });
      try {
        const response = await fetch(new URL(relativePath, global.location.href), {
          cache: "no-store",
          method: "GET",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
          throw new Error("릴리스 정보를 불러오지 못했어요.");
        }
        traceRelease("35.hosted.release.fetch.success", {
          message: normalizeText(relativePath),
          reason: `${Math.max(0, Date.now() - startedAt)}ms`,
        });
        return payload;
      } catch (error) {
        traceRelease("35.hosted.release.fetch.error", {
          error: getErrorMessage(error, "릴리스 정보를 불러오지 못했어요."),
          message: normalizeText(relativePath),
          reason: `${Math.max(0, Date.now() - startedAt)}ms`,
        });
        throw error;
      }
    }

    function normalizeReleaseRecord(release, options = {}) {
      if (!release || typeof release !== "object") {
        return null;
      }
      const versionFileName = readArtifactFileName(release.versionDownloadUrl)
        || readArtifactFileName(release.downloadUrl)
        || normalizeText(release.fileName);
      return {
        ...release,
        downloadUrl: resolveArtifactUrl(
          release.downloadUrl,
          options.preferLatestAlias ? "latest.zip" : versionFileName
        ),
        versionDownloadUrl: resolveArtifactUrl(
          release.versionDownloadUrl || release.downloadUrl,
          versionFileName
        ),
      };
    }

    function resolveArtifactUrl(rawUrl, fallbackFileName = "") {
      const normalizedUrl = normalizeText(rawUrl);
      if (!shouldUseLocalArtifactUrls()) {
        return normalizedUrl;
      }
      const artifactFileName = readArtifactFileName(normalizedUrl) || normalizeText(fallbackFileName);
      if (!artifactFileName) {
        return normalizedUrl;
      }
      return new URL(`../downloads/${encodeURIComponent(artifactFileName)}`, global.location.href).href;
    }

    function readArtifactFileName(rawUrl) {
      const normalizedUrl = normalizeText(rawUrl);
      if (!normalizedUrl) {
        return "";
      }
      try {
        const pathname = new URL(normalizedUrl, global.location.href).pathname || "";
        return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "");
      } catch {
        const fragments = normalizedUrl.split("/").filter(Boolean);
        return decodeURIComponent(fragments.at(-1) || "");
      }
    }

    function shouldUseLocalArtifactUrls() {
      try {
        const hostname = normalizeText(new URL(global.location.href).hostname).toLowerCase();
        return hostname === "127.0.0.1" || hostname === "localhost";
      } catch {
        return false;
      }
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

    function getErrorMessage(error, fallback) {
      return normalizeText(error instanceof Error ? error.message : error) || fallback;
    }

    function resolveBrowserCapabilities(createOptions) {
      const providedCapabilities = createOptions?.browserCapabilities;
      if (providedCapabilities && typeof providedCapabilities === "object") {
        return providedCapabilities;
      }
      return namespace.extensionCapabilityClient?.create?.({
        invokePage: createOptions?.invokePage,
        invokeRuntime: createOptions?.invokeRuntime,
      }) || {};
    }
  }

  namespace.releaseController = { create };
})(globalThis);
