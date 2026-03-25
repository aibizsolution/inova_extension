(function initReleaseManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const CHECK_INTERVAL_MS = namespace.constants.limits.releaseCheckIntervalMs;

  function create(state, hooks) {
    return { buildViewState, ensureChecked, handleAction, handleStorageChange };

    function buildViewState() {
      try {
        const currentVersion = getCurrentVersion();
        const releaseInfo = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo);
        return {
          checking: Boolean(releaseInfo.checking),
          currentVersion,
          error: releaseInfo.error,
          history: Array.isArray(releaseInfo.history) ? releaseInfo.history : [],
          historyLoading: Boolean(releaseInfo.historyLoading),
          lastCheckedAt: releaseInfo.checkedAt,
          latest: releaseInfo.latest,
          latestVersion: releaseInfo.latest?.version || "",
          updateAvailable: namespace.releaseInfo.isUpdateAvailable(currentVersion, releaseInfo.latest?.version),
        };
      } catch (error) {
        if (!isInvalidatedContextError(error)) console.error("[i-Nova Bookmarks] release view state failed", error);
        return {
          checking: false,
          currentVersion: "알 수 없음",
          error: "",
          history: [],
          historyLoading: false,
          lastCheckedAt: "",
          latest: null,
          latestVersion: "",
          updateAvailable: false,
        };
      }
    }

    async function ensureChecked(force = false, includeHistory = false) {
      const current = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo);
      const needsLatest = force || !current.latest || !namespace.releaseInfo.isFresh(current, CHECK_INTERVAL_MS);
      const needsHistory = includeHistory && (force || !current.history.length || !namespace.releaseInfo.isHistoryFresh(current, CHECK_INTERVAL_MS));
      if (!needsLatest && !needsHistory) return;

      state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo, {
        checking: needsLatest,
        error: "",
        historyLoading: needsHistory,
      });
      hooks.render();

      try {
        const [latestPayload, historyPayload] = await Promise.all([
          needsLatest ? sendRuntimeMessage("inova-release:latest") : Promise.resolve(null),
          needsHistory ? sendRuntimeMessage("inova-release:history") : Promise.resolve(null),
        ]);
        const next = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo, {
          checkedAt: needsLatest ? new Date().toISOString() : current.checkedAt,
          error: "",
          history: historyPayload?.releases || current.history,
          historyCheckedAt: needsHistory ? new Date().toISOString() : current.historyCheckedAt,
          latest: latestPayload?.release || current.latest,
        });
        delete next.checking;
        delete next.historyLoading;
        state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(next);
        await namespace.storage.setReleaseInfo(next);
      } catch (error) {
        if (isInvalidatedContextError(error)) return;
        state.releaseInfo = namespace.releaseInfo.mergeReleaseInfo(state.releaseInfo, {
          error: error instanceof Error ? error.message : "릴리스 정보를 확인하지 못했어요.",
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
      try {
        await sendRuntimeMessage("inova-release:open-url", { url });
      } catch (error) {
        if (isInvalidatedContextError(error)) return;
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
      const response = await chrome.runtime.sendMessage({ type, ...(payload || {}) });
      if (!response?.ok) throw new Error(namespace.session.normalizeText(response?.error) || "릴리스 요청을 처리하지 못했어요.");
      return response.data;
    }
  }

  namespace.releaseManager = { create };
})(globalThis);
