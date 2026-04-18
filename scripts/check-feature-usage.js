#!/usr/bin/env node

const path = require("path");

const DEFAULT_PROJECT_ID = "browser-extension-main";
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;
const USER_DAY_COLLECTION = "integration_inova_feature_usage_user_days";
const RESULT_KEYS = ["success", "error", "degraded"];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const docs = options.fixture
    ? buildFixtureDocs()
    : await loadUserDayDocs(options);
  const summary = summarizeFeatureUsageDocs(docs, options);
  printSummary(summary, options);
}

async function loadUserDayDocs(options) {
  const admin = require(path.join("..", "functions", "node_modules", "firebase-admin"));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: options.projectId,
    });
  }
  const db = admin.firestore();
  const snapshot = await db.collection(USER_DAY_COLLECTION)
    .where("dayKey", ">=", options.startDayKey)
    .where("dayKey", "<=", options.endDayKey)
    .orderBy("dayKey", "desc")
    .limit(Math.max(options.limit * Math.max(1, options.days), options.limit))
    .get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...normalizeFirestoreObject(doc.data()),
  }));
}

function summarizeFeatureUsageDocs(docs, options = {}) {
  const startDayKey = normalizeText(options.startDayKey) || shiftDayKey(formatKstDayKey(), -DEFAULT_DAYS + 1);
  const endDayKey = normalizeText(options.endDayKey) || formatKstDayKey();
  const users = new Map();
  const featureTotals = {};

  for (const doc of Array.isArray(docs) ? docs : []) {
    const dayKey = normalizeText(doc.dayKey);
    if (dayKey && (dayKey < startDayKey || dayKey > endDayKey)) {
      continue;
    }
    const providerUserKey = normalizeText(doc.providerUserKey || doc.owner?.providerUserKey);
    if (!providerUserKey) {
      continue;
    }
    const user = users.get(providerUserKey) || createUserSummary(providerUserKey, doc.owner);
    users.set(providerUserKey, user);
    user.activeDayKeys.add(dayKey || normalizeText(doc.id).split("__").at(-1) || "");
    user.email = user.email || normalizeText(doc.owner?.email).toLowerCase();
    user.displayName = user.displayName || normalizeText(doc.owner?.displayName);
    user.numericUserId = user.numericUserId ?? normalizeNumericUserId(doc.owner?.numericUserId);
    user.firstUsed = pickEarlier(user.firstUsed, doc.firstUsedAt || dayKey);
    user.lastUsed = pickLater(user.lastUsed, doc.lastUsedAt || dayKey);
    forEachCounter(doc.counters, (feature, action, resultKey, count) => {
      user.totalCount += count;
      user.features[feature] = user.features[feature] || createFeatureSummary();
      user.features[feature][resultKey] += count;
      user.features[feature].total += count;
      user.actions[`${feature}.${action}.${resultKey}`] = (user.actions[`${feature}.${action}.${resultKey}`] || 0) + count;
      featureTotals[feature] = featureTotals[feature] || createFeatureSummary();
      featureTotals[feature][resultKey] += count;
      featureTotals[feature].total += count;
    });
  }

  const rankedUsers = Array.from(users.values())
    .map((user) => ({
      ...user,
      activeDays: Array.from(user.activeDayKeys).filter(Boolean).length,
      activeDayKeys: Array.from(user.activeDayKeys).filter(Boolean).sort(),
    }))
    .sort((left, right) => right.totalCount - left.totalCount || left.providerUserKey.localeCompare(right.providerUserKey));
  return {
    endDayKey,
    featureTotals,
    rankedUsers,
    startDayKey,
    totalUsers: rankedUsers.length,
  };
}

function printSummary(summary, options) {
  const rankedUsers = summary.rankedUsers.slice(0, options.limit);
  console.log(`[feature-usage] project=${options.fixture ? "fixture" : options.projectId}`);
  console.log(`[feature-usage] window=${summary.startDayKey}..${summary.endDayKey}`);
  console.log(`[feature-usage] users=${summary.totalUsers}`);
  console.log("\n[top-users]");
  if (!rankedUsers.length) {
    console.log("  -");
  }
  rankedUsers.forEach((user, index) => {
    console.log(`  ${index + 1}. providerUserKey=${user.providerUserKey} total=${user.totalCount} activeDays=${user.activeDays} first=${user.firstUsed || "-"} last=${user.lastUsed || "-"}`);
    console.log(`     email=${user.email || "-"} displayName=${user.displayName || "-"} numericUserId=${user.numericUserId ?? "-"}`);
    console.log(`     features=${formatFeatureSummary(user.features)}`);
  });
  console.log("\n[feature-totals]");
  const featureEntries = Object.entries(summary.featureTotals)
    .sort((left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0]));
  if (!featureEntries.length) {
    console.log("  -");
  }
  featureEntries.forEach(([feature, totals]) => {
    console.log(`  ${feature}: ${formatResultSummary(totals)}`);
  });
}

function parseArgs(args) {
  const options = {
    days: DEFAULT_DAYS,
    fixture: false,
    limit: DEFAULT_LIMIT,
    projectId: DEFAULT_PROJECT_ID,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = normalizeText(args[index]);
    if (value === "--fixture") {
      options.fixture = true;
      continue;
    }
    if (value === "--project") {
      options.projectId = normalizeText(args[index + 1]) || DEFAULT_PROJECT_ID;
      index += 1;
      continue;
    }
    if (value === "--days") {
      options.days = Math.max(1, Math.min(90, Number(args[index + 1]) || DEFAULT_DAYS));
      index += 1;
      continue;
    }
    if (value === "--limit") {
      options.limit = Math.max(1, Math.min(100, Number(args[index + 1]) || DEFAULT_LIMIT));
      index += 1;
    }
  }
  options.endDayKey = formatKstDayKey();
  options.startDayKey = shiftDayKey(options.endDayKey, -options.days + 1);
  return options;
}

function buildFixtureDocs() {
  return [
    {
      dayKey: formatKstDayKey(),
      firstUsedAt: `${formatKstDayKey()}T01:00:00.000Z`,
      lastUsedAt: `${formatKstDayKey()}T02:00:00.000Z`,
      owner: {
        displayName: "Kim Tester",
        email: "kim@example.com",
        numericUserId: 101,
        providerUserKey: "user-kim",
      },
      providerUserKey: "user-kim",
      counters: {
        prompt_review: {
          completed: {
            success: 4,
          },
        },
        prompt_library: {
          applied: {
            success: 2,
          },
        },
      },
    },
    {
      dayKey: formatKstDayKey(),
      firstUsedAt: `${formatKstDayKey()}T03:00:00.000Z`,
      lastUsedAt: `${formatKstDayKey()}T03:20:00.000Z`,
      owner: {
        displayName: "Lee Tester",
        email: "lee@example.com",
        numericUserId: 202,
        providerUserKey: "user-lee",
      },
      providerUserKey: "user-lee",
      counters: {
        meeting: {
          workspace_opened: {
            degraded: 1,
            success: 3,
          },
        },
        release: {
          download_opened: {
            error: 1,
          },
        },
      },
    },
  ];
}

function createUserSummary(providerUserKey, owner = {}) {
  return {
    actions: {},
    activeDayKeys: new Set(),
    displayName: normalizeText(owner?.displayName),
    email: normalizeText(owner?.email).toLowerCase(),
    features: {},
    firstUsed: "",
    lastUsed: "",
    numericUserId: normalizeNumericUserId(owner?.numericUserId),
    providerUserKey,
    totalCount: 0,
  };
}

function createFeatureSummary() {
  return {
    degraded: 0,
    error: 0,
    success: 0,
    total: 0,
  };
}

function forEachCounter(counters, callback) {
  for (const feature of Object.keys(counters || {})) {
    for (const action of Object.keys(counters?.[feature] || {})) {
      for (const resultKey of RESULT_KEYS) {
        const count = Math.max(0, Math.floor(Number(counters?.[feature]?.[action]?.[resultKey]) || 0));
        if (count > 0) {
          callback(feature, action, resultKey, count);
        }
      }
    }
  }
}

function formatFeatureSummary(features) {
  const entries = Object.entries(features || {})
    .sort((left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0]));
  return entries.length
    ? entries.map(([feature, totals]) => `${feature}(${formatResultSummary(totals)})`).join(", ")
    : "-";
}

function formatResultSummary(totals) {
  return `success=${totals.success || 0} error=${totals.error || 0} degraded=${totals.degraded || 0} total=${totals.total || 0}`;
}

function normalizeFirestoreObject(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeFirestoreObject);
  }
  if (value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeFirestoreObject(child)]));
  }
  return value;
}

function normalizeNumericUserId(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function pickEarlier(left, right) {
  if (!left) return normalizeText(right);
  if (!right) return normalizeText(left);
  return normalizeText(left) <= normalizeText(right) ? normalizeText(left) : normalizeText(right);
}

function pickLater(left, right) {
  if (!left) return normalizeText(right);
  if (!right) return normalizeText(left);
  return normalizeText(left) >= normalizeText(right) ? normalizeText(left) : normalizeText(right);
}

function formatKstDayKey(timestampMs = Date.now()) {
  return new Date(Number(timestampMs) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDayKey(dayKey, offsetDays) {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeText(value) {
  return String(value || "").trim();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[feature-usage] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildFixtureDocs,
  summarizeFeatureUsageDocs,
};
