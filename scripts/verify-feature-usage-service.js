#!/usr/bin/env node

const assert = require("assert");
const {
  createFeatureUsageDomain,
  FEATURE_USAGE_COLLECTIONS,
} = require("../functions/features/feature-usage/feature-usage-service");

const NOW_MS = Date.parse("2026-04-18T03:00:00.000Z");

async function main() {
  await verifyDuplicateSnapshotNoop();
  await verifyMultiDeviceDeltaAggregation();
  await verifyLowerCounterReplayIgnored();
  await verifyDayKeyWindow();
  await verifyAllowlistAndCaps();
  await verifyVerifiedOwnerWinsOverClientIdentity();
  console.log("[verify-feature-usage-service] Feature usage service contract passed");
}

async function verifyDuplicateSnapshotNoop() {
  const { db, domain } = createHarness();
  const input = buildInput({
    clientInstanceId: "client-a",
    counters: {
      prompt_review: {
        completed: {
          success: 3,
        },
      },
    },
  });
  const first = await domain.commitFeatureUsageSnapshot(input);
  const second = await domain.commitFeatureUsageSnapshot(input);
  assert.equal(first.committed, true);
  assert.equal(first.deltaTotal, 3);
  assert.equal(second.committed, false);
  assert.equal(second.reason, "no-delta");
  assert.equal(readDoc(db, FEATURE_USAGE_COLLECTIONS.userDays, "user-1__2026-04-18").totalCount, 3);
  assert.equal(readDoc(db, FEATURE_USAGE_COLLECTIONS.adminDays, "2026-04-18").totalCount, 3);
  assert.equal(readDoc(db, FEATURE_USAGE_COLLECTIONS.adminDays, "2026-04-18").lastSource, undefined);
}

async function verifyMultiDeviceDeltaAggregation() {
  const { db, domain } = createHarness();
  await domain.commitFeatureUsageSnapshot(buildInput({
    clientInstanceId: "client-a",
    counters: { prompt_review: { completed: { success: 3 } } },
  }));
  await domain.commitFeatureUsageSnapshot(buildInput({
    clientInstanceId: "client-b",
    counters: { prompt_review: { completed: { success: 2 } } },
  }));
  await domain.commitFeatureUsageSnapshot(buildInput({
    clientInstanceId: "client-a",
    counters: { prompt_review: { completed: { success: 5 } } },
  }));

  const userDay = readDoc(db, FEATURE_USAGE_COLLECTIONS.userDays, "user-1__2026-04-18");
  const userMonth = readDoc(db, FEATURE_USAGE_COLLECTIONS.userMonths, "user-1__2026-04");
  assert.equal(userDay.totalCount, 7);
  assert.equal(userDay.counters.prompt_review.completed.success, 7);
  assert.equal(userDay.lastExtensionVersion, "1.0.0");
  assert.equal(userDay.lastSource.lane, "v2");
  assert.equal(userMonth.activeDayCount, 1);
  assert.equal(userMonth.lastExtensionVersion, "1.0.0");
  assert.equal(userMonth.lastSource.target, "production");
  assert.equal(userMonth.totalCount, 7);
  assert.equal(readDoc(db, FEATURE_USAGE_COLLECTIONS.adminDays, "2026-04-18").activeUserCount, 1);
}

async function verifyLowerCounterReplayIgnored() {
  const { db, domain } = createHarness();
  await domain.commitFeatureUsageSnapshot(buildInput({
    clientInstanceId: "client-a",
    counters: { prompt_library: { saved: { success: 5 } } },
  }));
  const replay = await domain.commitFeatureUsageSnapshot(buildInput({
    clientInstanceId: "client-a",
    counters: { prompt_library: { saved: { success: 2 } } },
  }));
  assert.equal(replay.committed, false);
  assert.equal(readDoc(db, FEATURE_USAGE_COLLECTIONS.userDays, "user-1__2026-04-18").totalCount, 5);
  assert.equal(
    readDoc(db, FEATURE_USAGE_COLLECTIONS.clientDays, "user-1__2026-04-18__client-a").counters.prompt_library.saved.success,
    5
  );
}

async function verifyDayKeyWindow() {
  const { domain } = createHarness();
  await assert.rejects(
    domain.commitFeatureUsageSnapshot(buildInput({ dayKey: "2026-04-10" })),
    /허용 범위/
  );
  await assert.rejects(
    domain.commitFeatureUsageSnapshot(buildInput({ dayKey: "2026-04-19" })),
    /허용 범위/
  );
}

async function verifyAllowlistAndCaps() {
  const { db, domain } = createHarness();
  await domain.commitFeatureUsageSnapshot(buildInput({
    counters: {
      meeting: {
        processed: {
          success: 500,
        },
        result_opened: {
          success: 900,
        },
      },
      conversation: {
        opened: {
          success: 2,
        },
      },
      prompt_store: {
        liked: {
          degraded: 1,
          success: 4,
        },
      },
      raw_feature: {
        clicked: {
          success: 10,
        },
      },
    },
  }));
  const userDay = readDoc(db, FEATURE_USAGE_COLLECTIONS.userDays, "user-1__2026-04-18");
  assert.equal(userDay.totalCount, 507);
  assert.equal(userDay.counters.conversation.opened.success, 2);
  assert.equal(userDay.counters.meeting.result_opened.success, 500);
  assert.equal(userDay.counters.prompt_store.liked.success, 4);
  assert.equal(userDay.counters.prompt_store.liked.degraded, 1);
  assert.equal(userDay.counters.meeting.processed, undefined);
  assert.equal(userDay.counters.raw_feature, undefined);
}

async function verifyVerifiedOwnerWinsOverClientIdentity() {
  const { db, domain } = createHarness();
  await domain.commitFeatureUsageSnapshot(buildInput({
    providerIdentity: {
      providerUserKey: "spoofed-user",
    },
    verifiedOwner: {
      displayName: "Real User",
      email: "real@example.com",
      provider: "inova",
      providerUserKey: "real-user",
    },
  }));
  const userDay = readDoc(db, FEATURE_USAGE_COLLECTIONS.userDays, "real-user__2026-04-18");
  assert.equal(userDay.owner.providerUserKey, "real-user");
  assert.equal(userDay.owner.email, "real@example.com");
  assert.equal(readDoc(db, FEATURE_USAGE_COLLECTIONS.userDays, "spoofed-user__2026-04-18"), null);
}

function buildInput(overrides = {}) {
  return {
    schemaVersion: 1,
    clientInstanceId: "client-a",
    clientSequence: 1,
    counters: {
      conversation: {
        jumped: {
          success: 1,
        },
      },
    },
    dayKey: "2026-04-18",
    providerIdentity: {
      available: true,
      displayName: "Tester",
      email: "tester@example.com",
      provider: "inova",
      providerUserKey: "user-1",
    },
    source: {
      extensionVersion: "1.0.0",
      lane: "v2",
      surface: "hosted-panel",
      target: "production",
    },
    verifiedOwner: {
      displayName: "Tester",
      email: "tester@example.com",
      provider: "inova",
      providerUserKey: "user-1",
    },
    ...overrides,
  };
}

function createHarness() {
  const db = createFakeDb();
  const domain = createFeatureUsageDomain({
    createHttpError,
    db,
    FieldValue: {
      increment(value) {
        return { __featureUsageIncrement: value };
      },
    },
    normalizeIdentity,
    normalizeText,
    now: () => NOW_MS,
  });
  return { db, domain };
}

function createFakeDb() {
  const docs = new Map();
  return {
    _docs: docs,
    collection(collectionName) {
      return {
        doc(id) {
          return {
            collectionName,
            id,
            path: `${collectionName}/${id}`,
          };
        },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(ref) {
          const data = docs.get(ref.path);
          return {
            exists: data !== undefined,
            id: ref.id,
            data: () => cloneValue(data || {}),
          };
        },
        set(ref, data, options = {}) {
          writes.push({
            data: cloneValue(data),
            merge: options.merge === true,
            ref,
          });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        const current = docs.get(write.ref.path) || {};
        docs.set(write.ref.path, applyWrite(write.merge ? current : {}, write.data));
      }
      return result;
    },
  };
}

function applyWrite(current, data) {
  const output = cloneValue(current || {});
  for (const [key, value] of Object.entries(data || {})) {
    output[key] = applyValue(output[key], value);
  }
  return output;
}

function applyValue(current, value) {
  if (value && typeof value === "object" && !Array.isArray(value) && "__featureUsageIncrement" in value) {
    return Math.max(0, Number(current) || 0) + Math.max(0, Number(value.__featureUsageIncrement) || 0);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const output = current && typeof current === "object" && !Array.isArray(current) ? cloneValue(current) : {};
    for (const [key, childValue] of Object.entries(value)) {
      output[key] = applyValue(output[key], childValue);
    }
    return output;
  }
  return cloneValue(value);
}

function readDoc(db, collectionName, id) {
  return cloneValue(db._docs.get(`${collectionName}/${id}`) || null);
}

function normalizeIdentity(identity = {}) {
  const numericUserId = identity?.numericUserId;
  return {
    available: Boolean(identity?.available || identity?.providerUserKey),
    displayName: normalizeText(identity?.displayName),
    email: normalizeText(identity?.email).toLowerCase(),
    numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
      ? null
      : Number.isFinite(Number(numericUserId))
        ? Number(numericUserId)
        : null,
    provider: normalizeText(identity?.provider || "inova") || "inova",
    providerUserKey: normalizeText(identity?.providerUserKey),
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-feature-usage-service] ${error.stack || error.message}`);
  process.exitCode = 1;
});
