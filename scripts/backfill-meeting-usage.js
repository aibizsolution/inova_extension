#!/usr/bin/env node

const path = require("path");
const admin = require(path.join("..", "functions", "node_modules", "firebase-admin"));
const { createMeetingUsageAccountingDomain } = require("../functions/features/meeting/meeting-usage-accounting-domain");

const DEFAULT_PROJECT_ID = "browser-extension-main";
const DEFAULT_BATCH_SIZE = 200;
const JOB_COLLECTION = "integration_inova_meeting_jobs";
const ARTIFACT_COLLECTION = "integration_inova_meeting_artifacts";
const USAGE_EVENT_COLLECTION = "integration_inova_meeting_usage_events";
const USAGE_USER_MONTH_COLLECTION = "integration_inova_meeting_usage_user_months";
const USAGE_USER_TOTAL_COLLECTION = "integration_inova_meeting_usage_user_totals";
const USAGE_ADMIN_MONTH_COLLECTION = "integration_inova_meeting_usage_admin_months";
const USAGE_ADMIN_DAY_COLLECTION = "integration_inova_meeting_usage_admin_days";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  initializeAdmin(options.projectId);
  const db = admin.firestore();
  const usageDomain = createMeetingUsageAccountingDomain({
    db,
    logEvent: options.verbose ? logUsageEvent : null,
    normalizeMeetingArtifact: normalizeFirestoreObject,
    normalizeMeetingJob: normalizeFirestoreObject,
    normalizeText,
    usageCollections: {
      adminDays: USAGE_ADMIN_DAY_COLLECTION,
      adminMonths: USAGE_ADMIN_MONTH_COLLECTION,
      events: USAGE_EVENT_COLLECTION,
      userMonths: USAGE_USER_MONTH_COLLECTION,
      userTotals: USAGE_USER_TOTAL_COLLECTION,
    },
  });

  const candidates = await collectBackfillCandidates(db, usageDomain, options);
  printPlan(candidates, options);

  if (!options.execute) {
    console.log("\n[meeting-usage-backfill] dry-run only. Add --execute to write usage events and aggregates.");
    return;
  }

  const result = await executeBackfill(candidates, usageDomain);
  printExecutionResult(result);
}

function parseArgs(args) {
  const options = {
    batchSize: DEFAULT_BATCH_SIZE,
    execute: false,
    jobId: "",
    limit: 0,
    projectId: DEFAULT_PROJECT_ID,
    providerUserKey: "",
    verbose: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = normalizeText(args[index]);
    if (value === "--execute") {
      options.execute = true;
      continue;
    }
    if (value === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (value === "--project") {
      options.projectId = normalizeText(args[index + 1]) || DEFAULT_PROJECT_ID;
      index += 1;
      continue;
    }
    if (value === "--provider-user-key" || value === "--user") {
      options.providerUserKey = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--job-id" || value === "--job") {
      options.jobId = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--limit") {
      options.limit = Math.max(0, Number(args[index + 1]) || 0);
      index += 1;
      continue;
    }
    if (value === "--batch-size") {
      options.batchSize = Math.max(1, Math.min(500, Number(args[index + 1]) || DEFAULT_BATCH_SIZE));
      index += 1;
    }
  }

  return options;
}

function initializeAdmin(projectId) {
  if (admin.apps.length) {
    return;
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
}

async function collectBackfillCandidates(db, usageDomain, options) {
  const snapshots = await loadSucceededJobSnapshots(db, options);
  const candidates = [];

  for (const snapshot of snapshots) {
    const job = normalizeFirestoreObject({
      ...snapshot.data(),
      jobId: normalizeText(snapshot.data()?.jobId) || snapshot.id,
    });
    const jobId = normalizeText(job.jobId || snapshot.id);
    const providerUserKey = normalizeText(job.owner?.providerUserKey);
    const eventId = usageDomain.buildProcessedUsageEventId(jobId);
    const eventSnapshot = await db.collection(USAGE_EVENT_COLLECTION).doc(eventId).get();

    if (eventSnapshot.exists) {
      candidates.push({
        eventId,
        job,
        jobId,
        providerUserKey,
        reason: "usage-event-exists",
        skipped: true,
      });
      continue;
    }

    const artifact = await loadArtifactForJob(db, job);
    const durationMs = usageDomain.resolveUsageDurationMs(job, artifact || {});
    const processedAt = normalizeTimestamp(
      artifact?.createdAt
      || job.completedAt
      || job.updatedAt
      || job.createdAt
      || snapshot.updateTime
    );

    const skipReason = resolveCandidateSkipReason({ durationMs, jobId, providerUserKey });
    candidates.push({
      artifact,
      durationMs,
      eventId,
      job,
      jobId,
      monthKey: usageDomain.formatMonthKey(processedAt),
      processedAt,
      providerUserKey,
      reason: skipReason,
      skipped: Boolean(skipReason),
    });
  }

  return candidates;
}

async function loadSucceededJobSnapshots(db, options) {
  if (options.jobId) {
    const snapshot = await db.collection(JOB_COLLECTION).doc(options.jobId).get();
    if (!snapshot.exists || normalizeText(snapshot.data()?.status) !== "succeeded") {
      return [];
    }
    return [snapshot];
  }

  let query = db.collection(JOB_COLLECTION)
    .where("status", "==", "succeeded")
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(options.batchSize);
  let lastSnapshot = null;
  const snapshots = [];

  while (true) {
    const currentQuery = lastSnapshot ? query.startAfter(lastSnapshot) : query;
    const page = await currentQuery.get();
    if (page.empty) {
      break;
    }
    for (const snapshot of page.docs) {
      if (options.providerUserKey && normalizeText(snapshot.data()?.owner?.providerUserKey) !== options.providerUserKey) {
        continue;
      }
      snapshots.push(snapshot);
      if (options.limit > 0 && snapshots.length >= options.limit) {
        return snapshots;
      }
    }
    lastSnapshot = page.docs[page.docs.length - 1];
  }

  return snapshots;
}

async function loadArtifactForJob(db, job) {
  const artifactId = normalizeText(job.transcript?.artifactId)
    || normalizeText(Array.isArray(job.artifacts) ? job.artifacts[0]?.artifactId : "");
  if (artifactId) {
    const snapshot = await db.collection(ARTIFACT_COLLECTION).doc(artifactId).get();
    return snapshot.exists
      ? normalizeFirestoreObject({ ...snapshot.data(), artifactId: normalizeText(snapshot.data()?.artifactId) || snapshot.id })
      : null;
  }

  const querySnapshot = await db.collection(ARTIFACT_COLLECTION)
    .where("jobId", "==", normalizeText(job.jobId))
    .limit(1)
    .get();
  if (querySnapshot.empty) {
    return null;
  }
  const snapshot = querySnapshot.docs[0];
  return normalizeFirestoreObject({ ...snapshot.data(), artifactId: normalizeText(snapshot.data()?.artifactId) || snapshot.id });
}

function resolveCandidateSkipReason({ durationMs, jobId, providerUserKey }) {
  if (!jobId) {
    return "missing-job-id";
  }
  if (!providerUserKey) {
    return "missing-provider-user-key";
  }
  if (!(durationMs > 0)) {
    return "duration-unavailable";
  }
  return "";
}

async function executeBackfill(candidates, usageDomain) {
  const result = {
    committed: [],
    skipped: [],
  };

  for (const candidate of candidates) {
    if (candidate.skipped) {
      result.skipped.push(candidate);
      continue;
    }
    const commit = await usageDomain.commitProcessedMeetingUsage({
      artifact: candidate.artifact || {},
      job: candidate.job,
      processedAt: candidate.processedAt,
    });
    if (commit.committed) {
      result.committed.push({ ...candidate, commit });
    } else {
      result.skipped.push({ ...candidate, reason: commit.reason || "not-committed" });
    }
  }

  return result;
}

function printPlan(candidates, options) {
  const pending = candidates.filter((candidate) => !candidate.skipped);
  const skipped = candidates.filter((candidate) => candidate.skipped);
  console.log(`[meeting-usage-backfill] project=${options.projectId}`);
  console.log(`[meeting-usage-backfill] mode=${options.execute ? "execute" : "dry-run"}`);
  console.log(`[meeting-usage-backfill] succeededJobs=${candidates.length}`);
  console.log(`[meeting-usage-backfill] pendingBackfill=${pending.length}`);
  console.log(`[meeting-usage-backfill] skipped=${skipped.length}`);

  printDurationSummary("pending", pending);
  printGroupedSummary("byUser", groupBy(pending, (candidate) => candidate.providerUserKey));
  printGroupedSummary("byMonth", groupBy(pending, (candidate) => candidate.monthKey));
  printSkipSummary(skipped);
  printSamples(pending);
}

function printExecutionResult(result) {
  console.log("\n[meeting-usage-backfill] execution");
  console.log(`  committed=${result.committed.length}`);
  console.log(`  skipped=${result.skipped.length}`);
  printDurationSummary("committed", result.committed);
}

function printDurationSummary(label, candidates) {
  const processedMs = candidates.reduce((sum, candidate) => sum + Math.max(0, Number(candidate.durationMs) || 0), 0);
  console.log(`[${label}] count=${candidates.length} duration=${formatDuration(processedMs)} (${processedMs}ms)`);
}

function printGroupedSummary(label, groups) {
  console.log(`\n[${label}]`);
  const entries = Array.from(groups.entries())
    .sort((left, right) => right[1].processedMs - left[1].processedMs || left[0].localeCompare(right[0]));
  if (!entries.length) {
    console.log("  -");
    return;
  }
  for (const [key, value] of entries.slice(0, 20)) {
    console.log(`  ${key || "-"}: ${formatDuration(value.processedMs)} · ${value.count}건`);
  }
  if (entries.length > 20) {
    console.log(`  ... +${entries.length - 20} more`);
  }
}

function printSkipSummary(candidates) {
  console.log("\n[skipped]");
  const groups = groupBy(candidates, (candidate) => candidate.reason || "unknown");
  if (!groups.size) {
    console.log("  -");
    return;
  }
  for (const [reason, value] of Array.from(groups.entries()).sort((left, right) => right[1].count - left[1].count)) {
    console.log(`  ${reason}: ${value.count}건`);
  }
}

function printSamples(candidates) {
  console.log("\n[samples]");
  for (const candidate of candidates.slice(0, 10)) {
    console.log(
      `  job=${candidate.jobId} user=${candidate.providerUserKey} month=${candidate.monthKey} duration=${formatDuration(candidate.durationMs)}`
    );
  }
  if (!candidates.length) {
    console.log("  -");
  }
}

function groupBy(candidates, readKey) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = normalizeText(readKey(candidate));
    const current = groups.get(key) || { count: 0, processedMs: 0 };
    current.count += 1;
    current.processedMs += Math.max(0, Number(candidate.durationMs) || 0);
    groups.set(key, current);
  }
  return groups;
}

function formatDuration(durationMs) {
  const totalMinutes = Math.max(0, Math.floor((Number(durationMs) || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}일 ${hours}시간 ${minutes}분`;
  }
  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }
  return `${minutes}분`;
}

function normalizeFirestoreObject(input) {
  if (input == null || typeof input !== "object") {
    return input;
  }
  if (typeof input.toDate === "function") {
    return input.toDate().toISOString();
  }
  if (input instanceof Date) {
    return input.toISOString();
  }
  if (Array.isArray(input)) {
    return input.map((item) => normalizeFirestoreObject(item));
  }
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, normalizeFirestoreObject(value)])
  );
}

function normalizeTimestamp(value) {
  const normalized = normalizeText(value);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeText(value) {
  if (value == null) {
    return "";
  }
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value).trim();
}

function logUsageEvent(event, payload) {
  console.log(`[${event}] ${JSON.stringify(payload)}`);
}

main().catch((error) => {
  console.error(`[meeting-usage-backfill] ${error.stack || error.message}`);
  process.exitCode = 1;
});
