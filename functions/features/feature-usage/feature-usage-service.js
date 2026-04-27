const SCHEMA_VERSION = 1;
const MAX_FEATURES_PER_BATCH = 8;
const MAX_ACTIONS_PER_FEATURE = 12;
const MAX_COUNTER_VALUE = 500;
const MAX_USER_DAY_TOTAL = 3000;
const ACCEPTED_DAY_WINDOW_DAYS = 7;
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
const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "providerIdentity",
  "dayKey",
  "clientInstanceId",
  "clientSequence",
  "source",
  "counters",
]);
const FEATURE_USAGE_COLLECTIONS = Object.freeze({
  adminDays: "integration_inova_feature_usage_admin_days",
  adminMonths: "integration_inova_feature_usage_admin_months",
  clientDays: "integration_inova_feature_usage_client_days",
  userDays: "integration_inova_feature_usage_user_days",
  userMonths: "integration_inova_feature_usage_user_months",
});

function registerFeatureUsageHandlers(deps) {
  const {
    CORS_ORIGINS,
    REGION,
    createHttpError,
    logEvent,
    normalizeIdentity,
    normalizeText,
    onRequest,
    sendError,
    verifyInovaIdentity,
  } = deps;
  const domain = createFeatureUsageDomain(deps);

  const commitInovaFeatureUsageBatch = onRequest({
    cors: CORS_ORIGINS,
    region: REGION,
    timeoutSeconds: 30,
  }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      assertAllowedPayloadFields(request.body, createHttpError, normalizeText);
      const providerIdentity = normalizeIdentity(request.body?.providerIdentity);
      const owner = await verifyInovaIdentity(providerIdentity, request);
      const result = await domain.commitFeatureUsageSnapshot({
        ...request.body,
        verifiedOwner: owner,
      });
      logEvent?.("feature_usage.commit", {
        committed: Boolean(result.committed),
        dayKey: result.dayKey,
        deltaTotal: result.deltaTotal || 0,
        providerUserKey: owner.providerUserKey,
        reason: result.reason || "",
      });
      response.json({ ok: true, data: result });
    } catch (error) {
      logEvent?.("feature_usage.commit.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    commitInovaFeatureUsageBatch,
  };
}

function createFeatureUsageDomain(deps) {
  const {
    createHttpError = createDefaultHttpError,
    db,
    FieldValue,
    now = () => Date.now(),
    normalizeIdentity = normalizeIdentityFallback,
    normalizeText = normalizeTextFallback,
    usageCollections,
  } = deps;
  const collections = {
    ...FEATURE_USAGE_COLLECTIONS,
    ...(usageCollections && typeof usageCollections === "object" ? usageCollections : {}),
  };
  const increment = typeof FieldValue?.increment === "function"
    ? (value) => FieldValue.increment(value)
    : (value) => ({ __featureUsageIncrement: value });

  async function commitFeatureUsageSnapshot(input = {}) {
    if (!db?.collection || typeof db.runTransaction !== "function") {
      throw createHttpError(500, "feature usage 저장소가 준비되지 않았어요.");
    }
    const verifiedOwner = normalizeOwner(input.verifiedOwner || input.owner);
    if (!verifiedOwner.providerUserKey) {
      throw createHttpError(401, "검증된 i-Nova 사용자가 없어요.");
    }
    const batch = normalizeUsageBatch(input, verifiedOwner);
    const clientDayRef = db.collection(collections.clientDays).doc(buildClientDayDocId(batch));
    const userDayRef = db.collection(collections.userDays).doc(buildUserDayDocId(batch.providerUserKey, batch.dayKey));
    const userMonthRef = db.collection(collections.userMonths).doc(buildUserMonthDocId(batch.providerUserKey, batch.monthKey));
    const adminDayRef = db.collection(collections.adminDays).doc(batch.dayKey);
    const adminMonthRef = db.collection(collections.adminMonths).doc(batch.monthKey);

    return db.runTransaction(async (transaction) => {
      const clientDaySnapshot = await transaction.get(clientDayRef);
      const userDaySnapshot = await transaction.get(userDayRef);
      const userMonthSnapshot = await transaction.get(userMonthRef);
      const previousCounters = normalizeCounters(readSnapshotData(clientDaySnapshot)?.counters);
      const deltaCounters = computeDeltaCounters(batch.counters, previousCounters);
      const deltaTotal = sumCounters(deltaCounters);
      if (deltaTotal <= 0) {
        return {
          clientInstanceId: batch.clientInstanceId,
          clientSequence: batch.clientSequence,
          committed: false,
          dayKey: batch.dayKey,
          deltaTotal: 0,
          reason: "no-delta",
        };
      }

      const nowIso = new Date(now()).toISOString();
      const userDayExists = Boolean(userDaySnapshot?.exists);
      const userMonthExists = Boolean(userMonthSnapshot?.exists);
      const clientDayData = {
        aggregateScope: "client-day",
        clientInstanceId: batch.clientInstanceId,
        clientSequence: batch.clientSequence,
        counters: batch.counters,
        dayKey: batch.dayKey,
        lastDeltaCounters: deltaCounters,
        lastDeltaTotal: deltaTotal,
        lastCommittedAt: nowIso,
        monthKey: batch.monthKey,
        owner: batch.owner,
        providerUserKey: batch.providerUserKey,
        source: batch.source,
        totalCount: sumCounters(batch.counters),
        updatedAt: nowIso,
      };
      if (!clientDaySnapshot?.exists) {
        clientDayData.createdAt = nowIso;
      }

      transaction.set(clientDayRef, clientDayData, { merge: true });
      transaction.set(
        userDayRef,
        buildAggregateMutation({
          activeDayIncrement: userDayExists ? 0 : 1,
          aggregateScope: "user-day",
          dayKey: batch.dayKey,
          deltaCounters,
          deltaTotal,
          docId: userDayRef.id,
          existing: readSnapshotData(userDaySnapshot),
          monthKey: batch.monthKey,
          nowIso,
          owner: batch.owner,
          providerUserKey: batch.providerUserKey,
          source: batch.source,
        }),
        { merge: true }
      );
      transaction.set(
        userMonthRef,
        buildAggregateMutation({
          activeDayIncrement: userDayExists ? 0 : 1,
          aggregateScope: "user-month",
          dayKey: batch.dayKey,
          deltaCounters,
          deltaTotal,
          docId: userMonthRef.id,
          existing: readSnapshotData(userMonthSnapshot),
          monthKey: batch.monthKey,
          nowIso,
          owner: batch.owner,
          providerUserKey: batch.providerUserKey,
          source: batch.source,
        }),
        { merge: true }
      );
      transaction.set(
        adminDayRef,
        buildAggregateMutation({
          activeUserIncrement: userDayExists ? 0 : 1,
          aggregateScope: "admin-day",
          dayKey: batch.dayKey,
          deltaCounters,
          deltaTotal,
          docId: adminDayRef.id,
          monthKey: batch.monthKey,
          nowIso,
        }),
        { merge: true }
      );
      transaction.set(
        adminMonthRef,
        buildAggregateMutation({
          activeUserIncrement: userMonthExists ? 0 : 1,
          aggregateScope: "admin-month",
          deltaCounters,
          deltaTotal,
          docId: adminMonthRef.id,
          monthKey: batch.monthKey,
          nowIso,
        }),
        { merge: true }
      );

      return {
        clientInstanceId: batch.clientInstanceId,
        clientSequence: batch.clientSequence,
        committed: true,
        dayKey: batch.dayKey,
        deltaCounters,
        deltaTotal,
      };
    });
  }

  function normalizeUsageBatch(input, verifiedOwner) {
    if (Number(input.schemaVersion) !== SCHEMA_VERSION) {
      throw createHttpError(400, "feature usage schemaVersion이 맞지 않아요.");
    }
    const providerUserKey = normalizeText(verifiedOwner.providerUserKey);
    const dayKey = normalizeDayKey(input.dayKey);
    assertAcceptedDayKey(dayKey);
    const clientInstanceId = normalizeClientInstanceId(input.clientInstanceId);
    if (!clientInstanceId) {
      throw createHttpError(400, "clientInstanceId가 없어요.");
    }
    const counters = normalizeCounters(input.counters);
    return {
      clientInstanceId,
      clientSequence: Math.max(0, Math.round(Number(input.clientSequence) || 0)),
      counters,
      dayKey,
      monthKey: dayKey.slice(0, 7),
      owner: normalizeOwner(verifiedOwner),
      providerUserKey,
      source: normalizeSource(input.source),
    };
  }

  function normalizeCounters(rawCounters) {
    const output = {};
    let featureCount = 0;
    let total = 0;
    for (const feature of Object.keys(ALLOWED_COUNTERS)) {
      if (featureCount >= MAX_FEATURES_PER_BATCH || total >= MAX_USER_DAY_TOTAL) {
        break;
      }
      const rawFeatureCounters = rawCounters?.[feature];
      if (!rawFeatureCounters || typeof rawFeatureCounters !== "object" || Array.isArray(rawFeatureCounters)) {
        continue;
      }
      let actionCount = 0;
      for (const action of ALLOWED_COUNTERS[feature]) {
        if (actionCount >= MAX_ACTIONS_PER_FEATURE || total >= MAX_USER_DAY_TOTAL) {
          break;
        }
        const rawActionCounters = rawFeatureCounters[action];
        if (!rawActionCounters || typeof rawActionCounters !== "object" || Array.isArray(rawActionCounters)) {
          continue;
        }
        let actionAdded = false;
        for (const resultKey of RESULT_KEYS) {
          if (total >= MAX_USER_DAY_TOTAL) {
            break;
          }
          const count = Math.min(
            MAX_COUNTER_VALUE,
            Math.max(0, Math.floor(Number(rawActionCounters[resultKey]) || 0))
          );
          if (count <= 0) {
            continue;
          }
          const accepted = Math.min(count, MAX_USER_DAY_TOTAL - total);
          output[feature] = output[feature] || {};
          output[feature][action] = output[feature][action] || {};
          output[feature][action][resultKey] = accepted;
          total += accepted;
          actionAdded = true;
        }
        if (actionAdded) {
          actionCount += 1;
        }
      }
      if (output[feature]) {
        featureCount += 1;
      }
    }
    return output;
  }

  function assertAcceptedDayKey(dayKey) {
    const todayKey = formatKstDayKey(now());
    const oldestKey = shiftDayKey(todayKey, -ACCEPTED_DAY_WINDOW_DAYS);
    if (dayKey < oldestKey || dayKey > todayKey) {
      throw createHttpError(400, "feature usage dayKey가 허용 범위를 벗어났어요.");
    }
  }

  function normalizeDayKey(value) {
    const dayKey = normalizeText(value);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dayKey)) {
      throw createHttpError(400, "feature usage dayKey 형식이 올바르지 않아요.");
    }
    return dayKey;
  }

  function normalizeClientInstanceId(value) {
    return normalizeText(value).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  }

  function normalizeSource(source) {
    const raw = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    return {
      extensionVersion: normalizeText(raw.extensionVersion).slice(0, 40),
      lane: normalizeText(raw.lane).slice(0, 20),
      surface: normalizeText(raw.surface || "hosted-panel").slice(0, 40) || "hosted-panel",
      target: normalizeText(raw.target).slice(0, 40),
    };
  }

  function normalizeOwner(owner) {
    const normalized = normalizeIdentity(owner);
    return {
      displayName: normalizeText(normalized.displayName).slice(0, 120),
      email: normalizeText(normalized.email).toLowerCase().slice(0, 160),
      numericUserId: Number.isFinite(Number(normalized.numericUserId)) ? Number(normalized.numericUserId) : null,
      provider: normalizeText(normalized.provider || "inova").slice(0, 40) || "inova",
      providerUserKey: normalizeText(normalized.providerUserKey).slice(0, 160),
    };
  }

  function buildAggregateMutation(options) {
    const {
      activeDayIncrement = 0,
      activeUserIncrement = 0,
      aggregateScope,
      dayKey = "",
      deltaCounters,
      deltaTotal,
      docId,
      existing = {},
      monthKey = "",
      nowIso,
      owner = null,
      providerUserKey = "",
      source = null,
    } = options;
    const mutation = {
      aggregateScope,
      docId,
      firstUsedAt: normalizeText(existing.firstUsedAt) || nowIso,
      lastUsedAt: nowIso,
      monthKey,
      totalCount: increment(deltaTotal),
      updatedAt: nowIso,
    };
    if (dayKey) {
      mutation.dayKey = dayKey;
    }
    if (providerUserKey) {
      mutation.providerUserKey = providerUserKey;
      mutation.owner = owner;
    }
    const sourceSummary = buildSourceSummary(source);
    if (sourceSummary) {
      mutation.lastSource = sourceSummary;
      if (sourceSummary.extensionVersion) {
        mutation.lastExtensionVersion = sourceSummary.extensionVersion;
        mutation.lastExtensionVersionAt = nowIso;
      }
    }
    if (activeDayIncrement > 0 && dayKey) {
      mutation.activeDayCount = increment(activeDayIncrement);
      mutation.activeDayKeys = {
        [dayKey]: true,
      };
    }
    if (activeUserIncrement > 0) {
      mutation.activeUserCount = increment(activeUserIncrement);
    }
    Object.assign(mutation, buildCounterIncrementFields(deltaCounters));
    return mutation;
  }

  function buildSourceSummary(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return null;
    }
    const normalized = normalizeSource(source);
    if (!normalized.extensionVersion && !normalized.lane && !normalized.target && !normalized.surface) {
      return null;
    }
    return normalized;
  }

  function buildCounterIncrementFields(deltaCounters) {
    const counters = {};
    const featureTotals = {};
    const resultTotals = {};
    forEachCounter(deltaCounters, (feature, action, resultKey, count) => {
      counters[feature] = counters[feature] || {};
      counters[feature][action] = counters[feature][action] || {};
      counters[feature][action][resultKey] = increment(count);
      featureTotals[feature] = (featureTotals[feature] || 0) + count;
      resultTotals[resultKey] = (resultTotals[resultKey] || 0) + count;
    });
    return {
      counters,
      featureTotals: Object.fromEntries(Object.entries(featureTotals).map(([key, count]) => [key, increment(count)])),
      resultTotals: Object.fromEntries(Object.entries(resultTotals).map(([key, count]) => [key, increment(count)])),
    };
  }

  return {
    buildClientDayDocId,
    buildUserDayDocId,
    buildUserMonthDocId,
    commitFeatureUsageSnapshot,
    computeDeltaCounters,
    formatKstDayKey,
    normalizeCounters,
    sumCounters,
  };
}

function assertPostRequest(request, createHttpError) {
  if (request.method !== "POST") {
    throw createHttpError(405, "POST 요청만 지원해요.");
  }
}

function assertAllowedPayloadFields(payload, createHttpError, normalizeText = normalizeTextFallback) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const unknownField = Object.keys(body).find((field) => !ALLOWED_TOP_LEVEL_FIELDS.has(field));
  if (unknownField) {
    throw createHttpError(400, `허용되지 않은 feature usage 필드예요: ${normalizeText(unknownField)}`);
  }
}

function computeDeltaCounters(incomingCounters, previousCounters) {
  const deltaCounters = {};
  forEachCounter(incomingCounters, (feature, action, resultKey, incomingCount) => {
    const previousCount = Math.max(0, Math.floor(Number(previousCounters?.[feature]?.[action]?.[resultKey]) || 0));
    const delta = Math.max(0, incomingCount - previousCount);
    if (delta <= 0) {
      return;
    }
    deltaCounters[feature] = deltaCounters[feature] || {};
    deltaCounters[feature][action] = deltaCounters[feature][action] || {};
    deltaCounters[feature][action][resultKey] = delta;
  });
  return deltaCounters;
}

function sumCounters(counters) {
  let total = 0;
  forEachCounter(counters, (...entry) => {
    total += entry[3];
  });
  return total;
}

function forEachCounter(counters, callback) {
  for (const feature of Object.keys(counters || {})) {
    for (const action of Object.keys(counters?.[feature] || {})) {
      for (const resultKey of Object.keys(counters?.[feature]?.[action] || {})) {
        const count = Math.max(0, Math.floor(Number(counters[feature][action][resultKey]) || 0));
        if (count > 0) {
          callback(feature, action, resultKey, count);
        }
      }
    }
  }
}

function buildClientDayDocId(batch) {
  return [
    sanitizeDocIdPart(batch.providerUserKey),
    sanitizeDocIdPart(batch.dayKey),
    sanitizeDocIdPart(batch.clientInstanceId),
  ].join("__");
}

function buildUserDayDocId(providerUserKey, dayKey) {
  return `${sanitizeDocIdPart(providerUserKey)}__${sanitizeDocIdPart(dayKey)}`;
}

function buildUserMonthDocId(providerUserKey, monthKey) {
  return `${sanitizeDocIdPart(providerUserKey)}__${sanitizeDocIdPart(monthKey)}`;
}

function sanitizeDocIdPart(value) {
  return encodeURIComponent(String(value || "").trim()).replace(/\./g, "%2E");
}

function readSnapshotData(snapshot) {
  return snapshot?.exists && typeof snapshot.data === "function" ? snapshot.data() || {} : {};
}

function formatKstDayKey(timestampMs = Date.now()) {
  return new Date(Number(timestampMs) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDayKey(dayKey, offsetDays) {
  const baseMs = Date.parse(`${dayKey}T00:00:00.000Z`);
  return new Date(baseMs + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeIdentityFallback(identity = {}) {
  const numericUserId = identity?.numericUserId;
  return {
    displayName: normalizeTextFallback(identity?.displayName),
    email: normalizeTextFallback(identity?.email).toLowerCase(),
    numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
      ? null
      : Number.isFinite(Number(numericUserId))
        ? Number(numericUserId)
        : null,
    provider: normalizeTextFallback(identity?.provider || "inova") || "inova",
    providerUserKey: normalizeTextFallback(identity?.providerUserKey),
  };
}

function normalizeTextFallback(value) {
  return String(value || "").trim();
}

function createDefaultHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  ALLOWED_COUNTERS,
  FEATURE_USAGE_COLLECTIONS,
  createFeatureUsageDomain,
  registerFeatureUsageHandlers,
};
