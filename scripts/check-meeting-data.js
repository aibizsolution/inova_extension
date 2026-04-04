#!/usr/bin/env node

const { execFileSync } = require("child_process");

const defaults = {
  bucketNames: [],
  prefix: "tmp/meetings/",
  projectId: "browser-extension-main",
  sampleSize: 3,
};

const COLLECTIONS = [
  {
    id: "integration_inova_meetings",
    label: "meetings",
    samplePaths: ["title", "updatedAt", "createdAt", "deletedAt"],
  },
  {
    id: "integration_inova_meeting_jobs",
    label: "jobs",
    samplePaths: ["meetingId", "status", "notesStatus", "updatedAt", "deletedAt"],
  },
  {
    id: "integration_inova_meeting_job_parts",
    label: "job_parts",
    samplePaths: ["jobId", "status", "partIndex", "updatedAt"],
  },
  {
    id: "integration_inova_meeting_job_finalizers",
    label: "job_finalizers",
    samplePaths: ["jobId", "status", "updatedAt"],
  },
  {
    id: "integration_inova_meeting_artifacts",
    label: "artifacts",
    samplePaths: ["meetingId", "jobId", "createdAt", "deletedAt"],
  },
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const accessToken = getGcloudAccessToken();
  const bucketNames = await resolveBucketNames(accessToken, options);

  console.log(`[meeting-data] project=${options.projectId}`);
  console.log(`[meeting-data] prefix=${options.prefix}`);
  console.log(`[meeting-data] sampleSize=${options.sampleSize}`);
  console.log(`[meeting-data] buckets=${bucketNames.length ? bucketNames.join(", ") : "-"}`);

  const collectionResults = [];
  for (const collection of COLLECTIONS) {
    const result = await readCollectionSummary(accessToken, options.projectId, collection, options.sampleSize);
    collectionResults.push(result);
    printCollectionSummary(result);
  }

  const storageResults = [];
  for (const bucketName of bucketNames) {
    const result = await readStorageSummary(accessToken, bucketName, options.prefix, options.sampleSize);
    storageResults.push(result);
    printStorageSummary(result, options.prefix);
  }

  printOverallSummary(collectionResults, storageResults);
}

async function readCollectionSummary(accessToken, projectId, collection, sampleSize) {
  const count = await countCollectionDocuments(accessToken, projectId, collection.id);
  const samples = count > 0 ? await listCollectionSamples(accessToken, projectId, collection, sampleSize) : [];
  return {
    collectionId: collection.id,
    count,
    label: collection.label,
    samples,
  };
}

async function countCollectionDocuments(accessToken, projectId, collectionId) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runAggregationQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredAggregationQuery: {
          aggregations: [{ alias: "count", count: {} }],
          structuredQuery: {
            from: [{ collectionId }],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${collectionId} count 조회 실패 (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const aggregateCount = payload?.[0]?.result?.aggregateFields?.count?.integerValue;
  return Math.max(0, Number(aggregateCount) || 0);
}

async function listCollectionSamples(accessToken, projectId, collection, sampleSize) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${collection.id}?pageSize=${encodeURIComponent(String(sampleSize))}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${collection.id} sample 조회 실패 (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const documents = Array.isArray(payload?.documents) ? payload.documents : [];
  return documents.map((document) => summarizeDocument(document, collection.samplePaths));
}

function summarizeDocument(document, samplePaths) {
  const summary = {
    id: extractDocumentId(document?.name),
    updateTime: normalizeText(document?.updateTime),
  };

  for (const path of samplePaths) {
    summary[path] = readFirestoreDocumentPath(document, path);
  }

  return summary;
}

async function resolveBucketNames(accessToken, options) {
  const bucketNames = new Set(
    (options.bucketNames || [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  );

  for (const derivedBucket of [
    `${options.projectId}.firebasestorage.app`,
    `${options.projectId}.appspot.com`,
  ]) {
    bucketNames.add(derivedBucket);
  }

  for (const bucketName of await listProjectBuckets(accessToken, options.projectId)) {
    bucketNames.add(bucketName);
  }

  return Array.from(bucketNames).filter(Boolean);
}

async function listProjectBuckets(accessToken, projectId) {
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`bucket 목록 조회 실패 (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.items)
    ? payload.items.map((bucket) => normalizeText(bucket?.name)).filter(Boolean)
    : [];
}

async function readStorageSummary(accessToken, bucketName, prefix, sampleSize) {
  let objectCount = 0;
  let pageToken = "";
  const samples = [];

  while (true) {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o`);
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("maxResults", "1000");
    url.searchParams.set("fields", "items(name,size,updated),nextPageToken");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 404) {
      return {
        bucketName,
        objectCount: 0,
        samples: [],
        status: "missing",
      };
    }

    if (!response.ok) {
      const text = await response.text();
      return {
        bucketName,
        error: `storage 조회 실패 (${response.status}): ${text}`,
        objectCount: 0,
        samples: [],
        status: "error",
      };
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    objectCount += items.length;
    if (samples.length < sampleSize) {
      for (const item of items) {
        if (samples.length >= sampleSize) {
          break;
        }
        samples.push({
          name: normalizeText(item?.name),
          size: Math.max(0, Number(item?.size) || 0),
          updated: normalizeText(item?.updated),
        });
      }
    }

    pageToken = normalizeText(payload?.nextPageToken);
    if (!pageToken) {
      break;
    }
  }

  return {
    bucketName,
    objectCount,
    samples,
    status: "ok",
  };
}

function printCollectionSummary(result) {
  console.log(`\n[collection] ${result.label} (${result.collectionId}) count=${result.count}`);
  if (!result.samples.length) {
    console.log("  samples: -");
    return;
  }
  for (const sample of result.samples) {
    console.log(`  - id=${sample.id} updateTime=${sample.updateTime || "-"}`);
    for (const [key, value] of Object.entries(sample)) {
      if (key === "id" || key === "updateTime") {
        continue;
      }
      if (value === "") {
        continue;
      }
      console.log(`    ${key}=${formatScalar(value)}`);
    }
  }
}

function printStorageSummary(result, prefix) {
  if (result.status === "missing") {
    console.log(`\n[storage] bucket=${result.bucketName} prefix=${prefix} status=missing`);
    return;
  }

  if (result.status === "error") {
    console.log(`\n[storage] bucket=${result.bucketName} prefix=${prefix} status=error`);
    console.log(`  error=${result.error}`);
    return;
  }

  console.log(`\n[storage] bucket=${result.bucketName} prefix=${prefix} objectCount=${result.objectCount}`);
  if (!result.samples.length) {
    console.log("  samples: -");
    return;
  }
  for (const sample of result.samples) {
    console.log(`  - name=${sample.name} size=${sample.size} updated=${sample.updated || "-"}`);
  }
}

function printOverallSummary(collectionResults, storageResults) {
  const collectionTotal = collectionResults.reduce((sum, item) => sum + item.count, 0);
  const storageTotal = storageResults.reduce((sum, item) => sum + item.objectCount, 0);
  const collectionResiduals = collectionResults.filter((item) => item.count > 0).map((item) => `${item.label}:${item.count}`);
  const storageResiduals = storageResults.filter((item) => item.status === "ok" && item.objectCount > 0).map((item) => `${item.bucketName}:${item.objectCount}`);

  console.log("\n[summary]");
  console.log(`  firestoreDocuments=${collectionTotal}`);
  console.log(`  storageObjects=${storageTotal}`);
  console.log(`  firestoreResiduals=${collectionResiduals.length ? collectionResiduals.join(", ") : "-"}`);
  console.log(`  storageResiduals=${storageResiduals.length ? storageResiduals.join(", ") : "-"}`);

  if (collectionTotal === 0 && storageTotal === 0) {
    console.log("  회의 관련 상용 데이터가 현재 조회 기준으로 비어 있습니다.");
    return;
  }

  console.log("  회의 관련 상용 데이터가 아직 남아 있습니다. 삭제 후 다시 확인하세요.");
}

function readFirestoreDocumentPath(document, path) {
  const segments = String(path || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let currentValue = { mapValue: { fields: document?.fields || {} } };

  for (const segment of segments) {
    const fields = currentValue?.mapValue?.fields;
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, segment)) {
      return "";
    }
    currentValue = fields[segment];
  }

  return decodeFirestoreValue(currentValue);
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  if (typeof value.stringValue === "string") {
    return value.stringValue;
  }
  if (typeof value.timestampValue === "string") {
    return value.timestampValue;
  }
  if (typeof value.integerValue === "string") {
    return value.integerValue;
  }
  if (typeof value.doubleValue === "number") {
    return value.doubleValue;
  }
  if (typeof value.booleanValue === "boolean") {
    return value.booleanValue;
  }
  if (value.nullValue !== undefined) {
    return "null";
  }
  if (value.arrayValue) {
    const values = Array.isArray(value.arrayValue.values) ? value.arrayValue.values : [];
    return `[${values.length} items]`;
  }
  if (value.mapValue?.fields) {
    return `{${Object.keys(value.mapValue.fields).length} keys}`;
  }
  return "";
}

function extractDocumentId(documentName) {
  const normalized = normalizeText(documentName);
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

function formatScalar(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return normalizeText(value) || "-";
}

function getGcloudAccessToken() {
  const commands = [
    ["gcloud", ["auth", "print-access-token"]],
    ["powershell", ["-NoProfile", "-Command", "gcloud auth print-access-token"]],
    ["cmd", ["/c", "gcloud auth print-access-token"]],
  ];

  for (const [command, args] of commands) {
    try {
      const token = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (token) {
        return token;
      }
    } catch {
      continue;
    }
  }

  throw new Error("gcloud access token을 가져오지 못했어요. gcloud 로그인 상태를 확인해 주세요.");
}

function parseArgs(args) {
  const options = {
    ...defaults,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = normalizeText(args[index]);
    if (value === "--project") {
      options.projectId = normalizeText(args[index + 1]) || defaults.projectId;
      index += 1;
      continue;
    }
    if (value === "--prefix") {
      options.prefix = normalizeText(args[index + 1]) || defaults.prefix;
      index += 1;
      continue;
    }
    if (value === "--sample-size") {
      options.sampleSize = Math.max(1, Number(args[index + 1]) || defaults.sampleSize);
      index += 1;
      continue;
    }
    if (value === "--bucket") {
      const bucketName = normalizeText(args[index + 1]);
      if (bucketName) {
        options.bucketNames = [...options.bucketNames, bucketName];
      }
      index += 1;
    }
  }

  return options;
}

function normalizeText(value) {
  return String(value || "").trim();
}

main().catch((error) => {
  console.error(`[meeting-data] ${error.message}`);
  process.exit(1);
});
