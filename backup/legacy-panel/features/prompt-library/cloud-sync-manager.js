(function initCloudSyncManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const RETRY_DELAY_MS = 15000;

  function create(state, hooks) {
    let loadPromise = null;
    let mutationPromise = null;
    let scheduledForceRemoteLoad = false;
    let timerId = 0;

    return {
      handleRealtimeRemoteState,
      handleStorageChange,
      importPromptLibrary,
      importStorePrompt,
      loadPromptLibraryNow,
      markPromptLibraryFallback,
      movePromptItem,
      removePromptItem,
      savePromptItem,
      scheduleSync,
    };

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local") {
        return;
      }

      const cloudSyncChange = namespace.productLane?.getStorageChange?.(changes, namespace.constants.storageKeys.cloudSync) || changes.cloudSync;
      if (!cloudSyncChange) {
        return;
      }

      const previousCloudSync = namespace.cloudSync.mergeCloudSyncState(cloudSyncChange.oldValue);
      const nextCloudSync = namespace.cloudSync.mergeCloudSyncState(cloudSyncChange.newValue);
      const previousProviderUserKey = namespace.session.normalizeText(previousCloudSync.providerIdentity?.providerUserKey);
      const nextProviderUserKey = namespace.session.normalizeText(nextCloudSync.providerIdentity?.providerUserKey);
      if (previousProviderUserKey && nextProviderUserKey && previousProviderUserKey !== nextProviderUserKey) {
        state.promptLibrary = namespace.promptLibrary.mergePromptLibrary();
        state.promptLibraryRemoteReady = false;
        hooks.render?.();
      }
      if (!previousCloudSync.providerIdentity.available && nextCloudSync.providerIdentity.available) {
        scheduleSync(240, true);
      }
    }

    function scheduleSync(delay = 700, forceRemoteLoad = false) {
      global.clearTimeout(timerId);
      scheduledForceRemoteLoad = scheduledForceRemoteLoad || Boolean(forceRemoteLoad);
      logDebug("cloud-sync.schedule", {
        delay,
        forceRemoteLoad: Boolean(forceRemoteLoad),
        scope: "cloud-sync",
      });
      timerId = global.setTimeout(() => {
        const forceLoad = scheduledForceRemoteLoad;
        scheduledForceRemoteLoad = false;
        loadPromptLibraryNow(forceLoad, { reason: "scheduled" }).catch(logSyncError);
      }, delay);
    }

    async function loadPromptLibraryNow(forceRemoteLoad = false, options = {}) {
      if (mutationPromise && !options.allowDuringMutation) {
        try {
          await mutationPromise;
        } catch (error) {
          void error;
        }
        return state.promptLibrary;
      }

      if (loadPromise && !forceRemoteLoad) {
        return loadPromise;
      }

      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity.available) {
        logDebug("cloud-sync.load.skipped", {
          reason: "no-provider",
          scope: "cloud-sync",
        });
        return state.promptLibrary;
      }

      const run = loadPromptLibraryFromRemote(providerIdentity, forceRemoteLoad, options);
      if (!forceRemoteLoad) {
        loadPromise = run;
      }

      try {
        return await run;
      } finally {
        if (loadPromise === run) {
          loadPromise = null;
        }
      }
    }

    async function handleRealtimeRemoteState(remoteStateInput) {
      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity.available) {
        return;
      }

      try {
        const remoteState = normalizeRealtimeRemoteState(remoteStateInput, providerIdentity);
        state.cloudSync = await namespace.storage.recordPromptLibraryRemoteState(
          remoteState,
          providerIdentity,
          {
            dataFreshness: "fresh",
            source: "realtime",
          }
        );
        if (shouldReloadFromRealtime(remoteState)) {
          await loadPromptLibraryNow(true, {
            allowDuringMutation: true,
            reason: "realtime-meta",
            source: "realtime",
          });
        }
      } catch (error) {
        if (isInvalidatedContextError(error)) {
          return;
        }
        logDebug("cloud-sync.realtime.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          scope: "cloud-sync",
        });
        state.cloudSync = await markPromptLibraryFallback(error, {
          degradedReason: "prompt-library-realtime-failed",
          providerIdentity,
          source: "realtime",
        });
      } finally {
        hooks.render?.();
      }
    }

    async function savePromptItem(itemInput) {
      const current = await ensureAuthoritativePromptLibrary("save");
      const reason = current.items.some((item) => item.id === itemInput?.id) ? "update-prompt" : "create-prompt";
      const nextPromptLibrary = namespace.promptLibrary.upsertPromptItem(current, itemInput);
      const nextIndex = current.items.findIndex((item) => item.id === itemInput?.id);
      const nextPromptId = nextPromptLibrary.items[Math.max(0, nextIndex)]?.id || nextPromptLibrary.items[0]?.id;
      return applyRemoteMutation(
        nextPromptLibrary,
        reason,
        namespace.cloudSync.createUpsertPromptOperation(nextPromptLibrary, nextPromptId)
      );
    }

    async function removePromptItem(promptId) {
      const current = await ensureAuthoritativePromptLibrary("delete");
      const nextPromptLibrary = namespace.promptLibrary.removePromptItem(current, promptId);
      return applyRemoteMutation(
        nextPromptLibrary,
        "delete-prompt",
        namespace.cloudSync.createDeletePromptOperation(nextPromptLibrary, promptId)
      );
    }

    async function movePromptItem(dragPromptId, targetPromptId, placement) {
      const current = await ensureAuthoritativePromptLibrary("reorder");
      const nextPromptLibrary = namespace.promptLibrary.movePromptItem(current, dragPromptId, targetPromptId, placement);
      return applyRemoteMutation(
        nextPromptLibrary,
        "reorder-prompts",
        namespace.cloudSync.createReorderPromptOperation(nextPromptLibrary)
      );
    }

    async function importPromptLibrary(payload, mode) {
      const current = await ensureAuthoritativePromptLibrary("import");
      const result = namespace.promptLibrary.applyImport(current, payload, mode);
      const promptLibrary = await applyRemoteMutation(
        result.library,
        mode === "replace" ? "replace-import" : mode === "merge" ? "merge-import" : "add-import",
        namespace.cloudSync.createReplaceLibraryOperation(result.library)
      );
      return {
        ...result,
        cloudSync: state.cloudSync,
        library: promptLibrary,
      };
    }

    async function importStorePrompt(storeEntry) {
      const current = await ensureAuthoritativePromptLibrary("import-store");
      const nextPromptLibrary = namespace.promptLibrary.importStoreEntry(current, storeEntry);
      return applyRemoteMutation(
        nextPromptLibrary,
        "import-store-prompt",
        namespace.cloudSync.createUpsertPromptOperation(nextPromptLibrary, nextPromptLibrary.items[0]?.id)
      );
    }

    async function applyRemoteMutation(nextPromptLibrary, reason, operation) {
      if (mutationPromise) {
        try {
          await mutationPromise;
        } catch (error) {
          void error;
        }
      }

      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity.available) {
        throw new Error("사용자 정보를 확인하지 못했어요.");
      }

      const run = (async () => {
        setPromptLibraryLoading(true);
        hooks.render?.();
        const queuedCloudSync = namespace.cloudSync.queuePromptLibrarySyncOperation(
          state.cloudSync,
          reason,
          providerIdentity,
          nextPromptLibrary,
          operation
        );
        const syncDocument = namespace.cloudSync.buildPromptSyncDocument(nextPromptLibrary, queuedCloudSync);
        const revision = namespace.session.normalizeText(syncDocument?.sync?.revision);
        let syncSucceeded = false;
        logDebug("cloud-sync.push.start", {
          itemCount: Array.isArray(nextPromptLibrary.items) ? nextPromptLibrary.items.length : 0,
          reason,
          revision,
          scope: "cloud-sync",
        });
        try {
          await sendRuntimeMessage("inova-sync:sync-prompt-library", { syncDocument });
          syncSucceeded = true;
          const promptLibrary = await loadPromptLibraryFromRemote(providerIdentity, true, {
            reason: `${reason}-reload`,
            skipLoadingState: true,
            source: "runtime-read",
          });
          logDebug("cloud-sync.push.success", {
            itemCount: Array.isArray(promptLibrary.items) ? promptLibrary.items.length : 0,
            reason,
            revision,
            scope: "cloud-sync",
          });
          return promptLibrary;
        } catch (error) {
          if (isInvalidatedContextError(error)) {
            throw error;
          }
          const normalizedMessage = syncSucceeded
            ? "저장은 반영됐을 수 있지만 최신 요청 보관함을 다시 불러오지 못했어요. 잠시 후 다시 확인해 주세요."
            : error instanceof Error
              ? error.message
              : String(error || "");
          logDebug("cloud-sync.push.error", {
            error: normalizedMessage,
            reason,
            revision,
            scope: "cloud-sync",
          });
          state.cloudSync = await namespace.storage.setPromptSyncDegraded(
            normalizedMessage,
            providerIdentity,
            {
              degradedReason: syncSucceeded ? "prompt-library-refresh-failed" : "prompt-library-push-failed",
              source: "runtime-read",
              status: "error",
            }
          );
          throw new Error(normalizedMessage, { cause: error });
        } finally {
          setPromptLibraryLoading(false);
          hooks.render?.();
        }
      })();

      mutationPromise = run;
      try {
        return await run;
      } finally {
        if (mutationPromise === run) {
          mutationPromise = null;
        }
      }
    }

    async function ensureAuthoritativePromptLibrary(reason) {
      if (!state.promptLibraryRemoteReady) {
        await loadPromptLibraryNow(true, {
          reason: `${reason}-base`,
        });
      }
      return namespace.promptLibrary.mergePromptLibrary(state.promptLibrary);
    }

    async function loadPromptLibraryFromRemote(providerIdentity, forceRemoteLoad, options = {}) {
      const manageLoadingState = !options.skipLoadingState;
      const reason = namespace.session.normalizeText(options.reason) || (forceRemoteLoad ? "force-load" : "load");
      if (manageLoadingState) {
        setPromptLibraryLoading(true);
        hooks.render?.();
      }
      logDebug("cloud-sync.load.start", {
        forceRemoteLoad: Boolean(forceRemoteLoad),
        providerUserKey: namespace.session.normalizeText(providerIdentity.providerUserKey),
        reason,
        scope: "cloud-sync",
      });
      try {
        const remote = await sendRuntimeMessage("inova-sync:load-prompt-library", {
          force: forceRemoteLoad,
          providerIdentity,
        });
        const promptLibrary = await hydratePromptLibraryFromRemote(remote, remote.owner || providerIdentity, {
          source: namespace.session.normalizeText(options.source) || "runtime-read",
        });
        logDebug("cloud-sync.load.success", {
          found: Boolean(remote?.found),
          itemCount: Array.isArray(promptLibrary.items) ? promptLibrary.items.length : 0,
          providerUserKey: namespace.session.normalizeText(providerIdentity.providerUserKey),
          reason,
          scope: "cloud-sync",
        });
        return promptLibrary;
      } catch (error) {
        if (isInvalidatedContextError(error)) {
          throw error;
        }
        logDebug("cloud-sync.load.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          providerUserKey: namespace.session.normalizeText(providerIdentity.providerUserKey),
          reason,
          scope: "cloud-sync",
        });
        state.cloudSync = await markPromptLibraryFallback(error, {
          degradedReason: "prompt-library-load-failed",
          providerIdentity,
          source: namespace.session.normalizeText(options.source) || "runtime-read",
        });
        scheduleSync(RETRY_DELAY_MS, true);
        throw error;
      } finally {
        if (manageLoadingState) {
          setPromptLibraryLoading(false);
          hooks.render?.();
        }
      }
    }

    async function hydratePromptLibraryFromRemote(remote, providerIdentity, options = {}) {
      const owner = providerIdentity || namespace.providerIdentity.getCurrent();
      const promptLibrary = namespace.promptLibrary.mergePromptLibrary(remote?.promptLibrary);
      const remoteState = buildLoadedRemoteState(remote, owner);
      await namespace.storage.recordPromptLibraryRemoteState(remoteState, owner, {
        dataFreshness: "fresh",
        source: namespace.session.normalizeText(options.source) || "runtime-read",
      });
      const syncedAt = namespace.session.normalizeText(remote?.syncedAt)
        || remoteState.lastSyncedAt
        || remoteState.checkedAt
        || new Date().toISOString();
      const hydratedState = await namespace.storage.hydratePromptLibraryFromCloud(promptLibrary, owner, syncedAt);
      state.cloudSync = namespace.cloudSync.mergeCloudSyncState(hydratedState.cloudSync);
      state.promptLibrary = namespace.promptLibrary.mergePromptLibrary(hydratedState.promptLibrary);
      state.promptLibraryRemoteReady = true;
      return state.promptLibrary;
    }

    async function markPromptLibraryFallback(error, options = {}) {
      const providerIdentity = options.providerIdentity || namespace.providerIdentity.getCurrent();
      const message = error instanceof Error ? error.message : String(error || "");
      const hasLocalPrompts = Boolean(Array.isArray(state.promptLibrary?.items) && state.promptLibrary.items.length);
      return namespace.storage.setPromptSyncDegraded(message, providerIdentity, {
        degradedReason: namespace.session.normalizeText(options.degradedReason) || "prompt-library-sync-failed",
        dataFreshness: hasLocalPrompts ? "stale" : "empty",
        source: namespace.session.normalizeText(options.source) || "runtime-read",
        status: "error",
      });
    }

    function shouldReloadFromRealtime(remoteState) {
      if (mutationPromise) {
        return false;
      }

      if (!state.promptLibraryRemoteReady) {
        return true;
      }

      const currentItemCount = Array.isArray(state.promptLibrary?.items) ? state.promptLibrary.items.length : 0;
      const remoteItemCount = Math.max(0, Number(remoteState?.itemCount) || 0);
      if (!remoteState?.found) {
        return currentItemCount > 0;
      }
      if (remoteItemCount !== currentItemCount) {
        return true;
      }

      const currentCloudSync = namespace.cloudSync.mergeCloudSyncState(state.cloudSync);
      const remoteSyncedAt = namespace.session.normalizeText(remoteState?.lastSyncedAt);
      return Boolean(remoteSyncedAt && remoteSyncedAt > namespace.session.normalizeText(currentCloudSync.lastSyncedAt));
    }

    function buildLoadedRemoteState(remote, providerIdentity) {
      const promptLibrary = namespace.promptLibrary.mergePromptLibrary(remote?.promptLibrary);
      return normalizeRealtimeRemoteState({
        checkedAt: new Date().toISOString(),
        found: Boolean(remote?.found || promptLibrary.items.length),
        itemCount: promptLibrary.items.length,
        lastRevision: "",
        lastSyncedAt: namespace.session.normalizeText(remote?.syncedAt),
        providerUserKey: namespace.session.normalizeText(remote?.owner?.providerUserKey || providerIdentity?.providerUserKey),
        updatedAt: getLatestUpdatedAt(promptLibrary.items),
        version: Math.max(1, Number(remote?.promptLibrary?.version) || 1),
      }, providerIdentity);
    }

    function getLatestUpdatedAt(items) {
      let latest = "";
      for (const item of Array.isArray(items) ? items : []) {
        const updatedAt = namespace.session.normalizeText(item?.updatedAt);
        if (updatedAt && (!latest || updatedAt > latest)) {
          latest = updatedAt;
        }
      }
      return latest;
    }

    function setPromptLibraryLoading(nextLoading) {
      state.promptLibraryLoading = Boolean(nextLoading);
    }

    function normalizeRealtimeRemoteState(remoteState, providerIdentity) {
      const normalizedProviderUserKey = namespace.session.normalizeText(
        remoteState?.providerUserKey || providerIdentity?.providerUserKey || ""
      );
      const lastRevision = namespace.session.normalizeText(remoteState?.lastRevision || "");
      const lastSyncedAt = namespace.session.normalizeText(remoteState?.lastSyncedAt || "");
      const itemCount = Math.max(0, Number(remoteState?.itemCount) || 0);
      return {
        checkedAt: namespace.session.normalizeText(remoteState?.checkedAt || "") || new Date().toISOString(),
        found: Boolean(remoteState?.found || lastRevision || lastSyncedAt || itemCount),
        itemCount,
        lastRevision,
        lastSyncedAt,
        providerUserKey: normalizedProviderUserKey,
        updatedAt: namespace.session.normalizeText(remoteState?.updatedAt || ""),
        version: Math.max(1, Number(remoteState?.version) || 1),
      };
    }

    function logSyncError(error) {
      if (isInvalidatedContextError(error)) {
        return;
      }
      logDebug("cloud-sync.sync.error", {
        error: error instanceof Error ? error.message : String(error || ""),
        scope: "cloud-sync",
      });
      console.error("[i-Nova Bookmarks] cloud sync failed", error);
    }

    function isInvalidatedContextError(error) {
      const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
      return message.includes("Extension context invalidated");
    }

    async function sendRuntimeMessage(type, payload) {
      const operation = classifyCloudSyncRuntimeOperation(type);
      const backend = "firebase-function";
      logDebug("cloud-sync.runtime.request", {
        backend,
        operation,
        scope: "runtime",
        tool: "prompts",
        type,
      });
      try {
        const response = await chrome.runtime.sendMessage({
          type,
          ...(payload || {}),
        });
        if (!response?.ok) {
          throw new Error(namespace.session.normalizeText(response?.error || "") || "백그라운드 동기화 요청에 실패했어요.");
        }
        logDebug("cloud-sync.runtime.success", {
          backend,
          operation,
          scope: "runtime",
          tool: "prompts",
          type,
        });
        return response.data;
      } catch (error) {
        logDebug("cloud-sync.runtime.error", {
          backend,
          error: error instanceof Error ? error.message : String(error || ""),
          operation,
          scope: "runtime",
          tool: "prompts",
          type,
        });
        throw error;
      }
    }

    function logDebug(event, payload) {
      namespace.panelDebug?.log?.(event, payload || {});
    }

    function classifyCloudSyncRuntimeOperation(type) {
      const normalized = namespace.session.normalizeText(type);
      if (normalized === "inova-sync:load-prompt-library") {
        return "read";
      }
      if (normalized === "inova-sync:sync-prompt-library") {
        return "write";
      }
      return "";
    }
  }

  namespace.cloudSyncManager = {
    create,
  };
})(globalThis);
