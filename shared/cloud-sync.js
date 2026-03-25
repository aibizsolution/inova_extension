(function initCloudSync(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants.defaults.cloudSync;

  function mergeCloudSyncState(...states) {
    return states.reduce(
      (merged, nextState) => ({
        ...merged,
        ...(nextState || {}),
        providerIdentity: {
          ...merged.providerIdentity,
          ...normalizeProviderIdentity((nextState || {}).providerIdentity),
        },
        pending: mergePending(merged.pending, (nextState || {}).pending),
        remote: {
          ...merged.remote,
          ...normalizeRemoteState((nextState || {}).remote),
        },
      }),
      {
        ...defaults,
        providerIdentity: { ...defaults.providerIdentity },
        pending: null,
        remote: { ...defaults.remote },
      }
    );
  }

  function queuePromptLibrarySync(currentState, reason, providerIdentity) {
    const identity = normalizeProviderIdentity(providerIdentity);
    return mergeCloudSyncState(currentState, {
      status: identity.available ? "queued" : "blocked",
      providerIdentity: identity,
      pending: {
        queuedAt: new Date().toISOString(),
        reason: normalizeReason(reason),
        revision: createSyncRevision(),
      },
      lastError: "",
    });
  }

  function markPromptLibrarySynced(currentState, providerIdentity, syncedAt = new Date().toISOString()) {
    return mergeCloudSyncState(currentState, {
      status: "synced",
      providerIdentity: normalizeProviderIdentity(providerIdentity),
      pending: null,
      lastError: "",
      lastSyncedAt: syncedAt,
    });
  }

  function setPromptSyncError(currentState, errorMessage, providerIdentity) {
    return mergeCloudSyncState(currentState, {
      status: "error",
      providerIdentity: normalizeProviderIdentity(providerIdentity),
      lastError: String(errorMessage || "").trim(),
    });
  }

  function recordPromptLibraryRemoteState(currentState, remoteState, providerIdentity) {
    return mergeCloudSyncState(currentState, {
      providerIdentity: normalizeProviderIdentity(providerIdentity),
      remote: normalizeRemoteState(remoteState),
    });
  }

  function hasPendingPromptSync(currentState) {
    return Boolean(mergeCloudSyncState(currentState).pending?.revision);
  }

  function buildPromptSyncDocument(promptLibrary, currentState) {
    const library = namespace.promptLibrary.mergePromptLibrary(promptLibrary);
    const syncState = mergeCloudSyncState(currentState);
    return {
      schemaVersion: 1,
      projectId: namespace.firebaseConfig.project.projectId,
      region: namespace.firebaseConfig.project.region,
      provider: syncState.providerIdentity.provider,
      owner: {
        available: syncState.providerIdentity.available,
        displayName: syncState.providerIdentity.displayName,
        email: syncState.providerIdentity.email,
        numericUserId: syncState.providerIdentity.numericUserId,
        providerUserKey: syncState.providerIdentity.providerUserKey,
      },
      promptLibrary: {
        itemCount: library.items.length,
        items: library.items.map(clonePromptItem),
        updatedAt: getLatestUpdatedAt(library.items),
        version: library.version,
      },
      sync: {
        exportedAt: new Date().toISOString(),
        lastError: syncState.lastError,
        lastSyncedAt: syncState.lastSyncedAt,
        queuedAt: syncState.pending?.queuedAt || "",
        reason: syncState.pending?.reason || "",
        revision: syncState.pending?.revision || "",
        status: syncState.status,
      },
    };
  }

  function normalizeProviderIdentity(identity) {
    const providerUserKey = namespace.session.normalizeText(identity?.providerUserKey || "");
    const email = namespace.session.normalizeText(identity?.email || "").toLowerCase();
    const displayName = namespace.session.normalizeText(identity?.displayName || identity?.name || "");
    const numericUserId = Number.isFinite(Number(identity?.numericUserId))
      ? Number(identity.numericUserId)
      : Number.isFinite(Number(identity?.id))
        ? Number(identity.id)
        : null;

    return {
      provider: namespace.session.normalizeText(identity?.provider || "inova") || "inova",
      available: Boolean(providerUserKey || email),
      providerUserKey,
      email,
      displayName,
      numericUserId,
    };
  }

  function normalizeRemoteState(remoteState) {
    return {
      checkedAt: namespace.session.normalizeText(remoteState?.checkedAt || ""),
      found: Boolean(remoteState?.found),
      itemCount: Math.max(0, Number(remoteState?.itemCount) || 0),
      lastRevision: namespace.session.normalizeText(remoteState?.lastRevision || ""),
      lastSyncedAt: namespace.session.normalizeText(remoteState?.lastSyncedAt || ""),
      providerUserKey: namespace.session.normalizeText(remoteState?.providerUserKey || ""),
      updatedAt: namespace.session.normalizeText(remoteState?.updatedAt || ""),
      version: Math.max(1, Number(remoteState?.version) || 1),
    };
  }

  function mergePending(currentPending, nextPending) {
    if (nextPending === null) {
      return null;
    }

    if (!currentPending && nextPending == null) {
      return null;
    }

    return {
      ...(currentPending || {}),
      ...(nextPending || {}),
    };
  }

  function normalizeReason(reason) {
    const normalized = namespace.session.normalizeText(reason || "");
    return normalized || "manual";
  }

  function createSyncRevision() {
    return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getLatestUpdatedAt(items) {
    let latest = "";
    for (const item of items || []) {
      const updatedAt = String(item?.updatedAt || "");
      if (updatedAt && (!latest || updatedAt > latest)) {
        latest = updatedAt;
      }
    }
    return latest;
  }

  function clonePromptItem(item) {
    return {
      content: item.content,
      createdAt: item.createdAt,
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
    };
  }

  namespace.cloudSync = {
    buildPromptSyncDocument,
    hasPendingPromptSync,
    markPromptLibrarySynced,
    mergeCloudSyncState,
    queuePromptLibrarySync,
    recordPromptLibraryRemoteState,
    setPromptSyncError,
  };
})(globalThis);
