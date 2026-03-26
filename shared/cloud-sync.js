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

  function queuePromptLibrarySyncOperation(currentState, reason, providerIdentity, promptLibrary, operation) {
    const identity = normalizeProviderIdentity(providerIdentity);
    const nextOperation = normalizePendingOperation(operation) || createReplaceLibraryOperation(promptLibrary);
    return mergeCloudSyncState(currentState, {
      status: identity.available ? "queued" : "blocked",
      providerIdentity: identity,
      pending: {
        operation: currentState?.pending?.operation ? createReplaceLibraryOperation(promptLibrary) : nextOperation,
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
      schemaVersion: 2,
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
      promptLibrary: buildPromptLibraryMeta(library),
      operation: normalizePendingOperation(syncState.pending?.operation) || createReplaceLibraryOperation(library),
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
      operation: normalizePendingOperation(nextPending?.operation) || normalizePendingOperation(currentPending?.operation),
    };
  }

  function createReplaceLibraryOperation(promptLibrary) {
    const library = namespace.promptLibrary.mergePromptLibrary(promptLibrary);
    return {
      type: "replace-library",
      orderedIds: getPromptOrderIds(library),
      promptLibrary: {
        itemCount: library.items.length,
        items: library.items.map(clonePromptItem),
        updatedAt: getLatestUpdatedAt(library.items),
        version: library.version,
      },
    };
  }

  function createUpsertPromptOperation(promptLibrary, promptId) {
    const library = namespace.promptLibrary.mergePromptLibrary(promptLibrary);
    const item = library.items.find((entry) => entry.id === promptId);
    if (!item) return createReplaceLibraryOperation(library);
    return {
      type: "upsert-item",
      item: clonePromptItem(item),
      orderedIds: getPromptOrderIds(library),
    };
  }

  function createDeletePromptOperation(promptLibrary, promptId) {
    const library = namespace.promptLibrary.mergePromptLibrary(promptLibrary);
    return {
      type: "delete-item",
      promptId: namespace.session.normalizeText(promptId),
      orderedIds: getPromptOrderIds(library),
    };
  }

  function createReorderPromptOperation(promptLibrary) {
    const library = namespace.promptLibrary.mergePromptLibrary(promptLibrary);
    return {
      type: "reorder-library",
      orderedIds: getPromptOrderIds(library),
    };
  }

  function buildPromptLibraryMeta(library) {
    return {
      itemCount: library.items.length,
      updatedAt: getLatestUpdatedAt(library.items),
      version: library.version,
    };
  }

  function normalizePendingOperation(operation) {
    const type = namespace.session.normalizeText(operation?.type);
    if (type === "replace-library") {
      const library = namespace.promptLibrary.mergePromptLibrary(operation?.promptLibrary);
      return {
        type,
        orderedIds: getPromptOrderIds(library),
        promptLibrary: {
          itemCount: library.items.length,
          items: library.items.map(clonePromptItem),
          updatedAt: getLatestUpdatedAt(library.items),
          version: library.version,
        },
      };
    }
    if (type === "upsert-item") {
      const item = clonePromptItem(operation?.item);
      return item
        ? {
            type,
            item,
            orderedIds: normalizeOrderedIds(operation?.orderedIds),
          }
        : null;
    }
    if (type === "delete-item") {
      const promptId = namespace.session.normalizeText(operation?.promptId);
      return promptId
        ? {
            type,
            promptId,
            orderedIds: normalizeOrderedIds(operation?.orderedIds),
          }
        : null;
    }
    if (type === "reorder-library") {
      return {
        type,
        orderedIds: normalizeOrderedIds(operation?.orderedIds),
      };
    }
    return null;
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
    if (!item?.id || !namespace.session.normalizeText(item?.title || "") || !namespace.session.normalizeText(item?.content || "")) {
      return null;
    }
    return {
      content: item.content,
      createdAt: item.createdAt,
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
    };
  }

  function getPromptOrderIds(library) {
    return library.items.map((item) => item.id);
  }

  function normalizeOrderedIds(orderedIds) {
    const seen = new Set();
    const nextIds = [];
    for (const orderedId of orderedIds || []) {
      const promptId = namespace.session.normalizeText(orderedId);
      if (!promptId || seen.has(promptId)) continue;
      seen.add(promptId);
      nextIds.push(promptId);
    }
    return nextIds;
  }

  namespace.cloudSync = {
    buildPromptSyncDocument,
    createDeletePromptOperation,
    createReorderPromptOperation,
    createReplaceLibraryOperation,
    createUpsertPromptOperation,
    hasPendingPromptSync,
    markPromptLibrarySynced,
    mergeCloudSyncState,
    queuePromptLibrarySyncOperation,
    recordPromptLibraryRemoteState,
    setPromptSyncError,
  };
})(globalThis);
