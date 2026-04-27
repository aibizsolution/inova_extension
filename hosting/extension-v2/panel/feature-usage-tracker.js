(function initFeatureUsageTracker(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText, resolveBrowserCapabilities } = namespace.panelUtils;
  const CLIENT_ID_STORAGE_KEY = "inova.featureUsage.clientInstanceId.v1";
  const OUTBOX_PREFIX = "inova.featureUsage.outbox.v1::";
  const ONCE_PER_DAY_PREFIX = "inova.featureUsage.oncePerDay.v1::";
  const FIRST_FLUSH_DELAY_MS = 60 * 1000;
  const FLUSH_AFTER_DIRTY_COUNT = 20;
  const MAX_FLUSH_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const OUTBOX_RETENTION_DAYS = 8;
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const RESULT_KEYS = Object.freeze(["success", "error", "degraded"]);
  const ALLOWED_COUNTERS = Object.freeze({
    conversation: Object.freeze(["opened", "jumped"]),
    meeting: Object.freeze(["workspace_opened", "result_opened"]),
    prompt_library: Object.freeze(["saved", "updated", "deleted", "applied"]),
    prompt_review: Object.freeze(["completed", "applied"]),
    prompt_store: Object.freeze(["imported", "published", "unpublished", "liked"]),
    release: Object.freeze(["download_opened"]),
  });

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const commitFeatureUsageBatch = typeof browserCapabilities.commitFeatureUsageBatch === "function"
      ? browserCapabilities.commitFeatureUsageBatch
      : typeof browserCapabilities.invokeCapability === "function"
        ? (input, requestOptions) => browserCapabilities.invokeCapability("metrics.feature-usage.commit", input, requestOptions)
        : async () => ({ committed: false, reason: "missing-capability" });
    const readPanelStorageState = typeof browserCapabilities.readPanelStorageState === "function"
      ? browserCapabilities.readPanelStorageState
      : async () => ({});
    const readProviderIdentity = typeof options.readProviderIdentity === "function"
      ? options.readProviderIdentity
      : null;
    const readSource = typeof options.readSource === "function"
      ? options.readSource
      : () => ({});
    const storage = options.storage || global.localStorage || null;
    const state = {
      flushPromise: null,
      flushTimerId: 0,
      started: false,
    };

    return {
      flush,
      record,
      recordOncePerDay,
      start,
    };

    function start() {
      if (state.started) {
        return;
      }
      state.started = true;
      cleanupExpiredOutbox();
      cleanupExpiredOncePerDayMarkers();
      scheduleFlush(FIRST_FLUSH_DELAY_MS, "startup");
      global.document?.addEventListener?.("visibilitychange", () => {
        if (global.document?.visibilityState === "hidden") {
          void flush("visibilitychange");
        }
      }, { passive: true });
      global.addEventListener?.("pagehide", () => {
        void flush("pagehide");
      }, { passive: true });
    }

    async function record(feature, action, result = "success", options = {}) {
      const normalizedFeature = normalizeUsageToken(feature);
      const normalizedAction = normalizeUsageToken(action);
      const normalizedResult = RESULT_KEYS.includes(normalizeUsageToken(result)) ? normalizeUsageToken(result) : "success";
      if (!isAllowedCounter(normalizedFeature, normalizedAction)) {
        return false;
      }
      const providerIdentity = await resolveProviderIdentity(options.providerIdentity);
      if (!providerIdentity.providerUserKey || !storage) {
        return false;
      }
      const dayKey = formatKstDayKey();
      const clientInstanceId = ensureClientInstanceId();
      const outboxKey = buildOutboxKey(providerIdentity.providerUserKey, dayKey, clientInstanceId);
      const snapshot = readOutboxRecord(outboxKey) || createOutboxRecord(providerIdentity, dayKey, clientInstanceId);
      snapshot.providerIdentity = providerIdentity;
      snapshot.source = normalizeSource({ ...readSource(), ...(options.source || {}) });
      snapshot.counters = incrementCounter(snapshot.counters, normalizedFeature, normalizedAction, normalizedResult);
      snapshot.clientSequence = Math.max(0, Number(snapshot.clientSequence) || 0) + 1;
      snapshot.dirtyCount = Math.max(0, Number(snapshot.dirtyCount) || 0) + 1;
      snapshot.updatedAt = new Date().toISOString();
      writeOutboxRecord(outboxKey, snapshot);
      if (snapshot.dirtyCount >= FLUSH_AFTER_DIRTY_COUNT || shouldFlushByAge(snapshot)) {
        void flush("threshold");
      } else {
        scheduleFlush(FIRST_FLUSH_DELAY_MS, "first-action");
      }
      return true;
    }

    async function recordOncePerDay(feature, action, result = "success", options = {}) {
      const normalizedFeature = normalizeUsageToken(feature);
      const normalizedAction = normalizeUsageToken(action);
      const normalizedResult = RESULT_KEYS.includes(normalizeUsageToken(result)) ? normalizeUsageToken(result) : "success";
      if (!isAllowedCounter(normalizedFeature, normalizedAction)) {
        return false;
      }
      const providerIdentity = await resolveProviderIdentity(options.providerIdentity);
      if (!providerIdentity.providerUserKey || !storage) {
        return false;
      }
      const dayKey = formatKstDayKey();
      const onceKey = buildOncePerDayKey(providerIdentity.providerUserKey, dayKey, normalizedFeature, normalizedAction, normalizedResult);
      if (storage.getItem(onceKey)) {
        return false;
      }
      const recorded = await record(normalizedFeature, normalizedAction, normalizedResult, {
        ...options,
        providerIdentity,
      });
      if (recorded) {
        storage.setItem(onceKey, new Date().toISOString());
      }
      return recorded;
    }

    async function flush(reason = "manual") {
      if (!storage) {
        return { committed: 0, failed: 0, reason: "missing-storage" };
      }
      if (state.flushPromise) {
        return state.flushPromise;
      }
      clearScheduledFlush();
      state.flushPromise = flushOutbox(reason).finally(() => {
        state.flushPromise = null;
      });
      return state.flushPromise;
    }

    async function flushOutbox(reason) {
      let committed = 0;
      let failed = 0;
      for (const outboxKey of listOutboxKeys()) {
        const snapshot = readOutboxRecord(outboxKey);
        if (!snapshot?.dirtyCount) {
          continue;
        }
        try {
          const result = await commitFeatureUsageBatch({
            schemaVersion: 1,
            clientInstanceId: snapshot.clientInstanceId,
            clientSequence: snapshot.clientSequence,
            counters: snapshot.counters,
            dayKey: snapshot.dayKey,
            providerIdentity: snapshot.providerIdentity,
            source: snapshot.source,
          }, {
            trace: {
              reason,
              source: "feature-usage-tracker",
            },
          });
          markCommitted(outboxKey, snapshot, result);
          committed += 1;
        } catch (error) {
          snapshot.lastErrorAt = new Date().toISOString();
          snapshot.lastErrorMessage = normalizeText(error?.message).slice(0, 160);
          writeOutboxRecord(outboxKey, snapshot);
          failed += 1;
        }
      }
      cleanupExpiredOutbox();
      cleanupExpiredOncePerDayMarkers();
      return { committed, failed };
    }

    function markCommitted(outboxKey, snapshot, result) {
      const nextSnapshot = {
        ...snapshot,
        dirtyCount: 0,
        lastCommittedAt: new Date().toISOString(),
        lastCommittedReason: normalizeText(result?.reason),
        lastCommittedSequence: Math.max(0, Number(snapshot.clientSequence) || 0),
        lastDeltaTotal: Math.max(0, Number(result?.deltaTotal) || 0),
        lastErrorAt: "",
        lastErrorMessage: "",
      };
      if (isExpiredDay(nextSnapshot.dayKey)) {
        storage.removeItem(outboxKey);
        return;
      }
      writeOutboxRecord(outboxKey, nextSnapshot);
    }

    function resolveProviderIdentity(candidate) {
      const direct = normalizeProviderIdentity(candidate);
      if (direct.providerUserKey) {
        return Promise.resolve(direct);
      }
      const callbackIdentity = normalizeProviderIdentity(readProviderIdentity?.());
      if (callbackIdentity.providerUserKey) {
        return Promise.resolve(callbackIdentity);
      }
      return readPanelStorageState()
        .then((storageState) => normalizeProviderIdentity(storageState?.providerIdentityCache?.providerIdentity))
        .catch(() => normalizeProviderIdentity(null));
    }

    function ensureClientInstanceId() {
      const existing = normalizeClientInstanceId(storage.getItem(CLIENT_ID_STORAGE_KEY));
      if (existing) {
        return existing;
      }
      const generated = normalizeClientInstanceId(
        typeof global.crypto?.randomUUID === "function"
          ? global.crypto.randomUUID()
          : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
      );
      storage.setItem(CLIENT_ID_STORAGE_KEY, generated);
      return generated;
    }

    function createOutboxRecord(providerIdentity, dayKey, clientInstanceId) {
      const nowIso = new Date().toISOString();
      return {
        clientInstanceId,
        clientSequence: 0,
        counters: {},
        createdAt: nowIso,
        dayKey,
        dirtyCount: 0,
        providerIdentity,
        source: normalizeSource(readSource()),
        updatedAt: nowIso,
      };
    }

    function readOutboxRecord(outboxKey) {
      try {
        const record = JSON.parse(storage.getItem(outboxKey) || "null");
        return record && typeof record === "object" ? record : null;
      } catch {
        return null;
      }
    }

    function writeOutboxRecord(outboxKey, snapshot) {
      storage.setItem(outboxKey, JSON.stringify(sanitizeSnapshot(snapshot)));
    }

    function sanitizeSnapshot(snapshot) {
      return {
        clientInstanceId: normalizeClientInstanceId(snapshot.clientInstanceId),
        clientSequence: Math.max(0, Math.round(Number(snapshot.clientSequence) || 0)),
        counters: sanitizeCounters(snapshot.counters),
        createdAt: normalizeText(snapshot.createdAt),
        dayKey: normalizeText(snapshot.dayKey),
        dirtyCount: Math.max(0, Math.round(Number(snapshot.dirtyCount) || 0)),
        lastCommittedAt: normalizeText(snapshot.lastCommittedAt),
        lastCommittedReason: normalizeText(snapshot.lastCommittedReason),
        lastCommittedSequence: Math.max(0, Math.round(Number(snapshot.lastCommittedSequence) || 0)),
        lastDeltaTotal: Math.max(0, Math.round(Number(snapshot.lastDeltaTotal) || 0)),
        lastErrorAt: normalizeText(snapshot.lastErrorAt),
        lastErrorMessage: normalizeText(snapshot.lastErrorMessage).slice(0, 160),
        providerIdentity: normalizeProviderIdentity(snapshot.providerIdentity),
        source: normalizeSource(snapshot.source),
        updatedAt: normalizeText(snapshot.updatedAt),
      };
    }

    function sanitizeCounters(counters) {
      const output = {};
      for (const feature of Object.keys(ALLOWED_COUNTERS)) {
        for (const action of ALLOWED_COUNTERS[feature]) {
          for (const resultKey of RESULT_KEYS) {
            const count = Math.max(0, Math.floor(Number(counters?.[feature]?.[action]?.[resultKey]) || 0));
            if (count <= 0) {
              continue;
            }
            output[feature] = output[feature] || {};
            output[feature][action] = output[feature][action] || {};
            output[feature][action][resultKey] = count;
          }
        }
      }
      return output;
    }

    function listOutboxKeys() {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (normalizeText(key).startsWith(OUTBOX_PREFIX)) {
          keys.push(key);
        }
      }
      return keys;
    }

    function cleanupExpiredOutbox() {
      if (!storage) {
        return;
      }
      for (const outboxKey of listOutboxKeys()) {
        const snapshot = readOutboxRecord(outboxKey);
        if (snapshot && !snapshot.dirtyCount && isExpiredDay(snapshot.dayKey)) {
          storage.removeItem(outboxKey);
        }
      }
    }

    function listOncePerDayKeys() {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (normalizeText(key).startsWith(ONCE_PER_DAY_PREFIX)) {
          keys.push(key);
        }
      }
      return keys;
    }

    function cleanupExpiredOncePerDayMarkers() {
      if (!storage) {
        return;
      }
      for (const markerKey of listOncePerDayKeys()) {
        const dayKey = normalizeText(markerKey).match(/::([0-9]{4}-[0-9]{2}-[0-9]{2})::/)?.[1] || "";
        if (dayKey && isExpiredDay(dayKey)) {
          storage.removeItem(markerKey);
        }
      }
    }

    function scheduleFlush(delayMs) {
      if (state.flushTimerId || !global.setTimeout) {
        return;
      }
      state.flushTimerId = global.setTimeout(() => {
        state.flushTimerId = 0;
        void flush("scheduled");
      }, Math.max(1000, Number(delayMs) || FIRST_FLUSH_DELAY_MS));
    }

    function clearScheduledFlush() {
      if (!state.flushTimerId) {
        return;
      }
      global.clearTimeout?.(state.flushTimerId);
      state.flushTimerId = 0;
    }
  }

  function incrementCounter(counters, feature, action, resultKey) {
    const output = JSON.parse(JSON.stringify(counters || {}));
    output[feature] = output[feature] || {};
    output[feature][action] = output[feature][action] || {};
    output[feature][action][resultKey] = Math.max(0, Math.floor(Number(output[feature][action][resultKey]) || 0)) + 1;
    return output;
  }

  function shouldFlushByAge(snapshot) {
    const lastCommittedAt = Date.parse(normalizeText(snapshot.lastCommittedAt));
    if (!Number.isFinite(lastCommittedAt)) {
      return false;
    }
    return Date.now() - lastCommittedAt >= MAX_FLUSH_INTERVAL_MS;
  }

  function isAllowedCounter(feature, action) {
    return Array.isArray(ALLOWED_COUNTERS[feature]) && ALLOWED_COUNTERS[feature].includes(action);
  }

  function normalizeProviderIdentity(identity) {
    const source = identity && typeof identity === "object" ? identity : {};
    const numericUserId = source.numericUserId;
    return {
      available: Boolean(source.available || source.providerUserKey),
      displayName: normalizeText(source.displayName).slice(0, 120),
      email: normalizeText(source.email).toLowerCase().slice(0, 160),
      numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
        ? null
        : Number.isFinite(Number(numericUserId))
          ? Number(numericUserId)
          : null,
      provider: normalizeText(source.provider || "inova") || "inova",
      providerUserKey: normalizeText(source.providerUserKey).slice(0, 160),
    };
  }

  function normalizeSource(source) {
    const raw = source && typeof source === "object" ? source : {};
    return {
      extensionVersion: normalizeText(raw.extensionVersion).slice(0, 40),
      lane: normalizeText(raw.lane).slice(0, 20),
      surface: normalizeText(raw.surface || "hosted-panel").slice(0, 40) || "hosted-panel",
      target: normalizeText(raw.target).slice(0, 40),
    };
  }

  function normalizeUsageToken(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  }

  function normalizeClientInstanceId(value) {
    return normalizeText(value).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  }

  function buildOutboxKey(providerUserKey, dayKey, clientInstanceId) {
    return `${OUTBOX_PREFIX}${encodeURIComponent(providerUserKey)}::${dayKey}::${clientInstanceId}`;
  }

  function buildOncePerDayKey(providerUserKey, dayKey, feature, action, resultKey) {
    return `${ONCE_PER_DAY_PREFIX}${encodeURIComponent(providerUserKey)}::${dayKey}::${feature}::${action}::${resultKey}`;
  }

  function formatKstDayKey(timestampMs = Date.now()) {
    return new Date(Number(timestampMs) + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  function isExpiredDay(dayKey) {
    const baseMs = Date.parse(`${formatKstDayKey()}T00:00:00.000Z`);
    const dayMs = Date.parse(`${normalizeText(dayKey)}T00:00:00.000Z`);
    return Number.isFinite(dayMs) && baseMs - dayMs > OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  }

  namespace.featureUsageTracker = {
    create,
  };
})(globalThis);
