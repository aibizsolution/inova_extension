const assert = require("assert");
const { createMeetingUsageAccountingDomain } = require("../functions/features/meeting/meeting-usage-accounting-domain");
const {
  USAGE_ADMIN_DAY_COLLECTION,
  USAGE_ADMIN_MONTH_COLLECTION,
  USAGE_EVENT_COLLECTION,
  USAGE_USER_MONTH_COLLECTION,
  USAGE_USER_TOTAL_COLLECTION,
  createDeps,
  createMemoryState,
} = require("./verify-meeting-service-support");

async function verifyUsageAccountingDomainIdempotency() {
  const state = createMemoryState();
  const deps = createDeps(state);
  const domain = createMeetingUsageAccountingDomain({
    db: deps.db,
    logEvent: deps.logEvent,
    normalizeMeetingArtifact: (input) => (input && typeof input === "object" ? input : {}),
    normalizeMeetingJob: (input) => (input && typeof input === "object" ? input : {}),
    normalizeText: deps.normalizeText,
    usageCollections: {
      adminDays: USAGE_ADMIN_DAY_COLLECTION,
      adminMonths: USAGE_ADMIN_MONTH_COLLECTION,
      events: USAGE_EVENT_COLLECTION,
      userMonths: USAGE_USER_MONTH_COLLECTION,
      userTotals: USAGE_USER_TOTAL_COLLECTION,
    },
  });
  const input = {
    artifact: {
      meetingId: "meeting-usage-idempotent",
      segments: [
        { endMs: 2000, startMs: 0, text: "fixture" },
      ],
    },
    job: {
      jobId: "job-usage-idempotent",
      meetingId: "meeting-usage-idempotent",
      owner: {
        providerUserKey: "fixture-user",
      },
      source: {
        captureMode: "microphone",
        durationMs: 1000,
        mode: "single",
        requestId: "capture-usage-idempotent",
      },
    },
    processedAt: "2026-04-18T00:00:00.000Z",
  };

  const firstCommit = await domain.commitProcessedMeetingUsage(input);
  const secondCommit = await domain.commitProcessedMeetingUsage(input);

  assert.equal(firstCommit.committed, true, "first usage accounting commit should be accepted");
  assert.equal(secondCommit.committed, false, "duplicate usage accounting commit should be ignored");
  assert.equal(secondCommit.reason, "duplicate");
  const event = assertUsageCommitted(state, {
    expectedDurationMs: 2000,
    jobId: "job-usage-idempotent",
    meetingId: "meeting-usage-idempotent",
    providerUserKey: "fixture-user",
  });
  assert.equal(event.monthKey, "2026-04");
  assert.equal(event.dayKey, "2026-04-18");
}

function assertUsageCommitted(state, options = {}) {
  const event = assertUsageEvent(state, options);
  const userMonth = getDoc(
    state,
    USAGE_USER_MONTH_COLLECTION,
    `${options.providerUserKey}__${event.monthKey}`
  );
  const userTotal = getDoc(state, USAGE_USER_TOTAL_COLLECTION, options.providerUserKey);
  const adminMonth = getDoc(state, USAGE_ADMIN_MONTH_COLLECTION, event.monthKey);
  const adminDay = getDoc(state, USAGE_ADMIN_DAY_COLLECTION, event.dayKey);
  [userMonth, userTotal, adminMonth, adminDay].forEach((aggregate) => assert(aggregate));
  for (const aggregate of [userMonth, userTotal, adminMonth, adminDay]) {
    assert.equal(aggregate.processedMs, options.expectedDurationMs);
    assert.equal(aggregate.processedCount, 1);
    assert.equal(aggregate.firstProcessedAt, event.createdAt);
    assert.equal(aggregate.lastProcessedAt, event.createdAt);
  }
  assert.equal(userMonth.providerUserKey, options.providerUserKey);
  assert.equal(userMonth.monthKey, event.monthKey);
  assert.equal(userTotal.providerUserKey, options.providerUserKey);
  assert.equal(adminDay.dayKey, event.dayKey);
  assert.equal(adminDay.monthKey, event.monthKey);
  return event;
}

function assertUsageEvent(state, options = {}) {
  const event = getDoc(state, USAGE_EVENT_COLLECTION, `processed__${options.jobId}`);
  assert(event, "processed usage event should be created");
  assert.equal(event.durationMs, options.expectedDurationMs);
  assert.equal(event.eventType, "processed");
  assert.equal(event.jobId, options.jobId);
  assert.equal(event.meetingId, options.meetingId);
  assert.equal(event.providerUserKey, options.providerUserKey);
  assert.equal(event.status, "committed");
  assert.match(event.monthKey, /^\d{4}-\d{2}$/);
  assert.match(event.dayKey, /^\d{4}-\d{2}-\d{2}$/);
  return event;
}

function readUsageAggregateSnapshot(state, options = {}) {
  return {
    adminDay: getDoc(state, USAGE_ADMIN_DAY_COLLECTION, options.dayKey),
    adminMonth: getDoc(state, USAGE_ADMIN_MONTH_COLLECTION, options.monthKey),
    userMonth: getDoc(state, USAGE_USER_MONTH_COLLECTION, `${options.providerUserKey}__${options.monthKey}`),
    userTotal: getDoc(state, USAGE_USER_TOTAL_COLLECTION, options.providerUserKey),
  };
}

function getCollection(state, collectionName) {
  if (!state.collections.has(collectionName)) {
    state.collections.set(collectionName, new Map());
  }
  return state.collections.get(collectionName);
}

function getDoc(state, collectionName, docId) {
  if (!docId) {
    return null;
  }
  const collection = getCollection(state, collectionName);
  const value = collection.get(docId);
  return value == null ? null : cloneValue(value);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

module.exports = {
  assertUsageCommitted,
  assertUsageEvent,
  readUsageAggregateSnapshot,
  verifyUsageAccountingDomainIdempotency,
};
