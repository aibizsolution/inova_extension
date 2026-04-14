(function initCloudSync(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants?.defaults?.cloudSync || {
    version: 1,
    status: "idle",
    degraded: false,
    degradedReason: "",
    dataFreshness: "empty",
    source: "none",
    providerIdentity: {
      provider: "inova",
      available: false,
      providerUserKey: "",
      email: "",
      displayName: "",
      numericUserId: null,
    },
    pending: null,
    lastSyncedAt: "",
    lastError: "",
    remote: {
      checkedAt: "",
      found: false,
      itemCount: 0,
      lastRevision: "",
      lastSyncedAt: "",
      providerUserKey: "",
      updatedAt: "",
      version: 1,
    },
  };

  function mergeCloudSyncState(...states) {
    return states.reduce(
      (merged, nextState) => ({
        ...merged,
        ...(nextState || {}),
        degraded: Boolean((nextState || {}).degraded ?? merged.degraded),
        degradedReason: Object.prototype.hasOwnProperty.call(nextState || {}, "degradedReason")
          ? namespace.session.normalizeText((nextState || {}).degradedReason)
          : merged.degradedReason,
        dataFreshness: normalizeDataFreshness((nextState || {}).dataFreshness, merged.dataFreshness),
        source: normalizeReadSource((nextState || {}).source, merged.source),
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

  function normalizeDataFreshness(value, fallback = "empty") {
    const normalized = namespace.session.normalizeText(value).toLowerCase();
    if (normalized === "fresh" || normalized === "stale" || normalized === "empty") {
      return normalized;
    }
    return namespace.session.normalizeText(fallback).toLowerCase() || "empty";
  }

  function normalizeReadSource(value, fallback = "none") {
    const normalized = namespace.session.normalizeText(value).toLowerCase();
    if (normalized === "realtime" || normalized === "runtime-read" || normalized === "cache" || normalized === "local" || normalized === "none") {
      return normalized;
    }
    return namespace.session.normalizeText(fallback).toLowerCase() || "none";
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

  namespace.cloudSync = {
    mergeCloudSyncState,
    normalizeProviderIdentity,
  };
})(globalThis);
