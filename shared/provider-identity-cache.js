(function initProviderIdentityCache(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants.defaults.providerIdentityCache;
  const normalizeText = namespace.session.normalizeText;

  function mergeProviderIdentityCacheState(...states) {
    return states.reduce(
      (merged, nextState) => ({
        version: Math.max(1, Number(nextState?.version) || merged.version || 1),
        providerIdentity: {
          ...merged.providerIdentity,
          ...normalizeProviderIdentity((nextState || {}).providerIdentity),
        },
      }),
      {
        ...defaults,
        providerIdentity: { ...defaults.providerIdentity },
      }
    );
  }

  function normalizeProviderIdentity(identity) {
    const providerUserKey = normalizeText(identity?.providerUserKey || "");
    const email = normalizeText(identity?.email || "").toLowerCase();
    const displayName = normalizeText(identity?.displayName || identity?.name || "");
    const numericUserId = Number.isFinite(Number(identity?.numericUserId))
      ? Number(identity.numericUserId)
      : Number.isFinite(Number(identity?.id))
        ? Number(identity.id)
        : null;

    return {
      provider: normalizeText(identity?.provider || "inova") || "inova",
      available: Boolean(providerUserKey || email),
      providerUserKey,
      email,
      displayName,
      numericUserId,
    };
  }

  namespace.providerIdentityCache = {
    mergeProviderIdentityCacheState,
    normalizeProviderIdentity,
  };
})(globalThis);
