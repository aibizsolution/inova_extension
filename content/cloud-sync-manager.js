(function initCloudSyncManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const REMOTE_PROBE_COOLDOWN_MS = 60000;
  const RETRY_DELAY_MS = 15000;

  function create(state, hooks) {
    let inflight = false;
    let timerId = 0;
    let scheduledForceRemoteProbe = false;

    return {
      handleStorageChange,
      scheduleSync,
    };

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local") {
        return;
      }

      if (changes.promptLibrary) {
        scheduleSync(520);
        return;
      }

      if (changes.cloudSync) {
        const previousCloudSync = namespace.cloudSync.mergeCloudSyncState(changes.cloudSync.oldValue);
        const nextCloudSync = namespace.cloudSync.mergeCloudSyncState(changes.cloudSync.newValue);
        if (nextCloudSync.pending?.revision && nextCloudSync.pending.revision !== previousCloudSync.pending?.revision) {
          scheduleSync(240);
        }
      }
    }

    function scheduleSync(delay = 700, forceRemoteProbe = false) {
      global.clearTimeout(timerId);
      scheduledForceRemoteProbe = scheduledForceRemoteProbe || Boolean(forceRemoteProbe);
      logDebug("cloud-sync.schedule", {
        delay,
        forceRemoteProbe: Boolean(forceRemoteProbe),
        scope: "cloud-sync",
      });
      timerId = global.setTimeout(() => {
        const forceProbe = scheduledForceRemoteProbe;
        scheduledForceRemoteProbe = false;
        syncNow(forceProbe).catch(logSyncError);
      }, delay);
    }

    async function syncNow(forceRemoteProbe = false) {
      if (inflight) {
        logDebug("cloud-sync.sync.skipped", {
          reason: "inflight",
          scope: "cloud-sync",
        });
        return;
      }

      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity.available) {
        logDebug("cloud-sync.sync.skipped", {
          reason: "no-provider",
          scope: "cloud-sync",
        });
        return;
      }

      inflight = true;
      logDebug("cloud-sync.sync.start", {
        forceRemoteProbe: Boolean(forceRemoteProbe),
        providerUserKey: namespace.session.normalizeText(providerIdentity.providerUserKey),
        scope: "cloud-sync",
      });
      try {
        const storageState = await namespace.storage.getState();
        const promptLibrary = namespace.promptLibrary.mergePromptLibrary(storageState.promptLibrary);
        let cloudSync = namespace.cloudSync.mergeCloudSyncState(storageState.cloudSync);

        if (shouldProbeRemote(promptLibrary, cloudSync, providerIdentity, forceRemoteProbe)) {
          logDebug("cloud-sync.probe.start", {
            forceRemoteProbe: Boolean(forceRemoteProbe),
            scope: "cloud-sync",
          });
          const remoteState = await sendRuntimeMessage("inova-sync:peek-prompt-library", {
            force: forceRemoteProbe,
            providerIdentity,
          });
          cloudSync = await namespace.storage.recordPromptLibraryRemoteState(remoteState, providerIdentity);

          if (shouldHydrateLocal(promptLibrary, cloudSync, remoteState)) {
            logDebug("cloud-sync.hydrate.start", {
              remoteItemCount: Math.max(0, Number(remoteState?.itemCount) || 0),
              scope: "cloud-sync",
            });
            const remote = await sendRuntimeMessage("inova-sync:load-prompt-library", {
              force: forceRemoteProbe,
              providerIdentity,
            });
            if (shouldHydrateFromLoadedLibrary(promptLibrary, cloudSync, remote)) {
              await namespace.storage.hydratePromptLibraryFromCloud(
                remote.promptLibrary,
                remote.owner || providerIdentity,
                remote.syncedAt || remoteState.lastSyncedAt || new Date().toISOString()
              );
              logDebug("cloud-sync.hydrate.success", {
                itemCount: Array.isArray(remote?.promptLibrary?.items) ? remote.promptLibrary.items.length : 0,
                scope: "cloud-sync",
              });
              return;
            }
          }
        }

        if (!namespace.cloudSync.hasPendingPromptSync(cloudSync)) {
          logDebug("cloud-sync.sync.idle", {
            scope: "cloud-sync",
          });
          return;
        }

        const syncDocument = namespace.cloudSync.buildPromptSyncDocument(promptLibrary, cloudSync);
        logDebug("cloud-sync.push.start", {
          itemCount: Array.isArray(promptLibrary.items) ? promptLibrary.items.length : 0,
          revision: namespace.session.normalizeText(cloudSync?.pending?.revision),
          scope: "cloud-sync",
        });
        const result = await sendRuntimeMessage("inova-sync:sync-prompt-library", { syncDocument });
        await namespace.storage.markPromptLibrarySynced(result.owner || providerIdentity, result.syncedAt || new Date().toISOString());
        logDebug("cloud-sync.push.success", {
          scope: "cloud-sync",
          syncedAt: namespace.session.normalizeText(result?.syncedAt),
        });
      } catch (error) {
        if (isInvalidatedContextError(error)) {
          return;
        }
        logDebug("cloud-sync.sync.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          scope: "cloud-sync",
        });
        await namespace.storage.setPromptSyncError(error instanceof Error ? error.message : String(error), providerIdentity);
        scheduleSync(RETRY_DELAY_MS);
      } finally {
        inflight = false;
        hooks.render?.();
      }
    }

    function shouldProbeRemote(localLibrary, cloudSync, providerIdentity, forceRemoteProbe = false) {
      if (!providerIdentity.available) {
        return false;
      }

      if (namespace.cloudSync.hasPendingPromptSync(cloudSync)) {
        return false;
      }

      const remoteState = cloudSync.remote || {};
      const sameUser =
        providerIdentity.providerUserKey &&
        providerIdentity.providerUserKey === namespace.session.normalizeText(remoteState.providerUserKey || "");
      const checkedAt = Date.parse(String(remoteState.checkedAt || ""));
      if (forceRemoteProbe) {
        return true;
      }
      if (sameUser && Number.isFinite(checkedAt) && Date.now() - checkedAt < REMOTE_PROBE_COOLDOWN_MS) {
        return false;
      }

      return true;
    }

    function shouldHydrateLocal(localLibrary, cloudSync, remoteState) {
      if (!remoteState?.found) {
        return false;
      }

      if (namespace.cloudSync.hasPendingPromptSync(cloudSync)) {
        return false;
      }

      const remoteItemCount = Math.max(0, Number(remoteState.itemCount) || 0);
      if (!localLibrary.items.length) {
        return remoteItemCount > 0;
      }

      if (!cloudSync.lastSyncedAt) {
        return remoteItemCount !== localLibrary.items.length;
      }

      const remoteSyncedAt = String(remoteState.lastSyncedAt || "");
      return Boolean(remoteSyncedAt && remoteSyncedAt > cloudSync.lastSyncedAt);
    }

    function shouldHydrateFromLoadedLibrary(localLibrary, cloudSync, remote) {
      if (!remote?.found || !remote?.promptLibrary) {
        return false;
      }

      if (namespace.cloudSync.hasPendingPromptSync(cloudSync)) {
        return false;
      }

      const remoteLibrary = namespace.promptLibrary.mergePromptLibrary(remote.promptLibrary);
      if (!localLibrary.items.length) {
        return remoteLibrary.items.length > 0;
      }

      const remoteSyncedAt = String(remote.syncedAt || "");
      return Boolean(remoteSyncedAt && remoteSyncedAt > cloudSync.lastSyncedAt);
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
      logDebug("cloud-sync.runtime.request", {
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
          scope: "runtime",
          tool: "prompts",
          type,
        });
        return response.data;
      } catch (error) {
        logDebug("cloud-sync.runtime.error", {
          error: error instanceof Error ? error.message : String(error || ""),
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
  }

  namespace.cloudSyncManager = {
    create,
  };
})(globalThis);
