(function initReleaseManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const CHECK_INTERVAL_MS = namespace.constants.limits.releaseCheckIntervalMs;

  function create(state, hooks) {
    return { buildViewState, ensureChecked, handleAction, handleStorageChange };

    function buildViewState() {
      try {
        const currentVersion = getCurrentVersion();
        const releaseInfo = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo);
        const checkedForCurrentVersion = releaseInfo.checkedForVersion === currentVersion;
        const historyCheckedForCurrentVersion = releaseInfo.historyCheckedForVersion === currentVersion;
        const currentAheadOfLatest = Boolean(
          releaseInfo.latest?.version
          && checkedForCurrentVersion
          && namespace.releaseInfo.compareVersions(currentVersion, releaseInfo.latest.version) > 0
        );
        return {
          checking: Boolean(releaseInfo.checking),
          currentVersion,
          currentAheadOfLatest,
          degraded: Boolean(releaseInfo.degraded),
          degradedReason: namespace.session.normalizeText(releaseInfo.degradedReason),
          dataFreshness: namespace.session.normalizeText(releaseInfo.dataFreshness) || "empty",
          error: releaseInfo.error,
          history: Array.isArray(releaseInfo.history) ? releaseInfo.history : [],
          historyRefreshPending: Boolean(releaseInfo.history.length) && !historyCheckedForCurrentVersion,
          historyLoading: Boolean(releaseInfo.historyLoading),
          lastCheckedAt: releaseInfo.checkedAt,
          latest: releaseInfo.latest,
          latestVersion: releaseInfo.latest?.version || "",
          source: namespace.session.normalizeText(releaseInfo.source) || "none",
          updateAvailable: checkedForCurrentVersion && namespace.releaseInfo.isUpdateAvailable(currentVersion, releaseInfo.latest?.version),
          versionRefreshPending: Boolean(releaseInfo.latest) && !checkedForCurrentVersion,
        };
      } catch (error) {
        const message = isInvalidatedContextError(error)
          ? "확장프로그램이 갱신되어 릴리스 화면 상태를 다시 계산해야 합니다."
          : error instanceof Error
            ? error.message
            : "릴리스 화면 상태를 계산하지 못했어요.";
        if (!isInvalidatedContextError(error)) console.error("[i-Nova Bookmarks] release view state failed", error);
        return {
          checking: false,
          currentVersion: "알 수 없음",
          currentAheadOfLatest: false,
          degraded: true,
          degradedReason: "release-view-state-failed",
          dataFreshness: "empty",
          error: message,
          history: [],
          historyRefreshPending: false,
          historyLoading: false,
          lastCheckedAt: "",
          latest: null,
          latestVersion: "",
          source: "none",
          updateAvailable: false,
          versionRefreshPending: false,
        };
      }
    }

    async function ensureChecked(force = false, includeHistory = false) {
      const current = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo);
      const currentVersion = getCurrentVersion();
      const needsLatest = force
        || !current.latest
        || current.checkedForVersion !== currentVersion
        || !namespace.releaseInfo.isFresh(current, CHECK_INTERVAL_MS);
      const needsHistory = includeHistory && (
        force
        || !current.history.length
        || current.historyCheckedForVersion !== currentVersion
        || !namespace.releaseInfo.isHistoryFresh(current, CHECK_INTERVAL_MS)
      );
      if (!needsLatest && !needsHistory) {
        logDebug("release.check.skipped", {
          currentVersion,
          includeHistory: Boolean(includeHistory),
          scope: "release",
        });
        return;
      }

      logDebug("release.check.start", {
        currentVersion,
        force: Boolean(force),
        includeHistory: Boolean(includeHistory),
        needsHistory,
        needsLatest,
        scope: "release",
      });
      state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo, {
        checking: needsLatest,
        historyLoading: needsHistory,
      });
      hooks.render();

      try {
        const checkedAt = new Date().toISOString();
        const [latestPayload, historyPayload] = await Promise.all([
          needsLatest ? sendRuntimeMessage("inova-release:latest") : Promise.resolve(null),
          needsHistory ? sendRuntimeMessage("inova-release:history") : Promise.resolve(null),
        ]);
        const next = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo, {
          checkedAt: needsLatest ? checkedAt : current.checkedAt,
          checkedForVersion: needsLatest ? currentVersion : current.checkedForVersion,
          degraded: false,
          degradedReason: "",
          dataFreshness: "fresh",
          error: "",
          history: historyPayload?.releases || current.history,
          historyCheckedAt: needsHistory ? checkedAt : current.historyCheckedAt,
          historyCheckedForVersion: needsHistory ? currentVersion : current.historyCheckedForVersion,
          latest: latestPayload?.release || current.latest,
          source: "runtime-read",
        });
        delete next.checking;
        delete next.historyLoading;
        state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(next);
        await namespace.storage.setReleaseInfo(next);
        logDebug("release.check.success", {
          historyCount: Array.isArray(next.history) ? next.history.length : 0,
          latestVersion: namespace.session.normalizeText(next.latest?.version),
          scope: "release",
        });
      } catch (error) {
        if (isInvalidatedContextError(error)) return;
        const hasCachedData = Boolean(
          current.latest
          || (Array.isArray(current.history) && current.history.length)
          || current.checkedAt
        );
        logDebug("release.check.error", {
          error: error instanceof Error ? error.message : "릴리스 정보를 확인하지 못했어요.",
          scope: "release",
        });
        state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo, {
          degraded: true,
          degradedReason: "release-fetch-failed",
          dataFreshness: hasCachedData ? "stale" : "empty",
          error: error instanceof Error ? error.message : "릴리스 정보를 확인하지 못했어요.",
          source: hasCachedData ? "cache" : "none",
        });
        logDebug("release.check.degraded", {
          historyCount: Array.isArray(current.history) ? current.history.length : 0,
          latestVersion: namespace.session.normalizeText(current.latest?.version),
          scope: "release",
        });
      } finally {
        state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo, {
          checking: false,
          historyLoading: false,
        });
        hooks.render();
      }
    }

    async function handleAction(action, detail = {}) {
      if (action === "refresh") return void ensureChecked(true, true);
      if (action === "download-latest") return void openDownload(buildViewState().latest?.downloadUrl);
      if (action === "download-version") {
        return void openDownload(state.releaseInfo.history.find((item) => item.version === detail.version)?.downloadUrl);
      }
    }

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local" || !changes.releaseInfo) return;
      state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(changes.releaseInfo.newValue, {
        checking: state.releaseInfo.checking,
        historyLoading: state.releaseInfo.historyLoading,
      });
      hooks.render();
    }

    async function openDownload(url) {
      if (!namespace.session.normalizeText(url)) return;
      logDebug("release.download.start", {
        scope: "release",
        url,
      });
      try {
        await sendRuntimeMessage("inova-release:open-url", { url });
        logDebug("release.download.success", {
          scope: "release",
          url,
        });
      } catch (error) {
        if (isInvalidatedContextError(error)) return;
        logDebug("release.download.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          scope: "release",
          url,
        });
        throw error;
      }
    }

    function getCurrentVersion() {
      try {
        return chrome.runtime.getManifest().version;
      } catch (error) {
        if (isInvalidatedContextError(error)) return "알 수 없음";
        throw error;
      }
    }

    function isInvalidatedContextError(error) {
      const message = String(error instanceof Error ? error.message : error || "").trim();
      return message.includes("Extension context invalidated");
    }

    async function sendRuntimeMessage(type, payload) {
      const metadata = classifyReleaseRuntimeMetadata(type);
      logDebug("release.runtime.request", {
        backend: metadata.backend,
        operation: metadata.operation,
        scope: "runtime",
        tool: "release",
        type,
      });
      try {
        const response = await chrome.runtime.sendMessage({ type, ...(payload || {}) });
        if (!response?.ok) throw new Error(namespace.session.normalizeText(response?.error) || "릴리스 요청을 처리하지 못했어요.");
        logDebug("release.runtime.success", {
          backend: metadata.backend,
          operation: metadata.operation,
          scope: "runtime",
          tool: "release",
          type,
        });
        return response.data;
      } catch (error) {
        logDebug("release.runtime.error", {
          backend: metadata.backend,
          error: error instanceof Error ? error.message : String(error || ""),
          operation: metadata.operation,
          scope: "runtime",
          tool: "release",
          type,
        });
        throw error;
      }
    }

    function logDebug(event, payload) {
      namespace.panelDebug?.log?.(event, payload || {});
    }

    function classifyReleaseRuntimeMetadata(type) {
      const normalized = namespace.session.normalizeText(type);
      if (normalized === "inova-release:latest" || normalized === "inova-release:history") {
        return {
          backend: "hosting",
          operation: "read",
        };
      }
      if (normalized === "inova-release:open-url") {
        return {
          backend: "browser",
          operation: "open",
        };
      }
      return {
        backend: "",
        operation: "",
      };
    }
  }

  namespace.releaseManager = { create };
})(globalThis);
