#!/usr/bin/env node

const {
  DEFAULT_STORAGE_PREFIX,
  MEETING_COLLECTIONS,
  documentMatchesMeeting,
  formatScalar,
  filterStorageObjectsByMeetingId,
  getGcloudAccessToken,
  listCollectionDocuments,
  listStorageObjects,
  normalizeText,
  resolveBucketNames,
  summarizeDocument,
} = require("./meeting-data-lib");

const defaults = {
  bucketNames: [],
  meetingId: "",
  prefix: DEFAULT_STORAGE_PREFIX,
  projectId: "browser-extension-main",
  sampleSize: 3,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const accessToken = getGcloudAccessToken();
  const bucketNames = await resolveBucketNames(accessToken, options.projectId, options.bucketNames);

  console.log(`[meeting-data] project=${options.projectId}`);
  console.log(`[meeting-data] meetingId=${options.meetingId || "-"}`);
  console.log(`[meeting-data] prefix=${options.prefix}`);
  console.log(`[meeting-data] sampleSize=${options.sampleSize}`);
  console.log(`[meeting-data] buckets=${bucketNames.length ? bucketNames.join(", ") : "-"}`);

  const collectionResults = [];
  for (const collection of MEETING_COLLECTIONS) {
    const documents = (await listCollectionDocuments(accessToken, options.projectId, collection.id))
      .filter((document) => documentMatchesMeeting(document, collection, options.meetingId));
    const samples = documents.slice(0, options.sampleSize).map((document) => summarizeDocument(document, collection.samplePaths));
    const result = {
      collectionId: collection.id,
      count: documents.length,
      group: collection.group || "data",
      label: collection.label,
      samples,
    };
    collectionResults.push(result);
    printCollectionSummary(result);
  }

  const storageResults = [];
  for (const bucketName of bucketNames) {
    const storage = await listStorageObjects(accessToken, bucketName, options.prefix);
    storage.items = filterStorageObjectsByMeetingId(storage.items, options.meetingId);
    const result = {
      bucketName,
      items: storage.items,
      samples: storage.items.slice(0, options.sampleSize),
      status: storage.status,
      error: storage.error || "",
    };
    storageResults.push(result);
    printStorageSummary(result, options.prefix);
  }

  printOverallSummary(collectionResults, storageResults);
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
    if (value === "--meeting-id" || value === "--meetingId") {
      options.meetingId = normalizeText(args[index + 1]);
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

  console.log(`\n[storage] bucket=${result.bucketName} prefix=${prefix} objectCount=${result.items.length}`);
  if (!result.samples.length) {
    console.log("  samples: -");
    return;
  }
  for (const sample of result.samples) {
    console.log(`  - name=${normalizeText(sample?.name)} size=${Math.max(0, Number(sample?.size) || 0)} updated=${normalizeText(sample?.updated) || "-"}`);
  }
}

function printOverallSummary(collectionResults, storageResults) {
  const collectionTotal = collectionResults.reduce((sum, item) => sum + item.count, 0);
  const dataCollectionTotal = collectionResults
    .filter((item) => item.group === "data")
    .reduce((sum, item) => sum + item.count, 0);
  const sessionCollectionTotal = collectionResults
    .filter((item) => item.group === "session")
    .reduce((sum, item) => sum + item.count, 0);
  const storageTotal = storageResults.reduce((sum, item) => sum + item.items.length, 0);
  const collectionResiduals = collectionResults.filter((item) => item.count > 0).map((item) => `${item.label}:${item.count}`);
  const dataResiduals = collectionResults.filter((item) => item.group === "data" && item.count > 0).map((item) => `${item.label}:${item.count}`);
  const sessionResiduals = collectionResults.filter((item) => item.group === "session" && item.count > 0).map((item) => `${item.label}:${item.count}`);
  const storageResiduals = storageResults.filter((item) => item.status === "ok" && item.items.length > 0).map((item) => `${item.bucketName}:${item.items.length}`);

  console.log("\n[summary]");
  console.log(`  firestoreDocuments=${collectionTotal}`);
  console.log(`  dataFirestoreDocuments=${dataCollectionTotal}`);
  console.log(`  sessionFirestoreDocuments=${sessionCollectionTotal}`);
  console.log(`  storageObjects=${storageTotal}`);
  console.log(`  firestoreResiduals=${collectionResiduals.length ? collectionResiduals.join(", ") : "-"}`);
  console.log(`  dataResiduals=${dataResiduals.length ? dataResiduals.join(", ") : "-"}`);
  console.log(`  sessionResiduals=${sessionResiduals.length ? sessionResiduals.join(", ") : "-"}`);
  console.log(`  storageResiduals=${storageResiduals.length ? storageResiduals.join(", ") : "-"}`);

  if (collectionTotal === 0 && storageTotal === 0) {
    console.log("  회의 관련 상용 데이터가 현재 조회 기준으로 비어 있습니다.");
    return;
  }

  console.log("  회의 관련 상용 데이터가 아직 남아 있습니다. 필요할 때 삭제 스크립트로 정리하고 다시 확인하세요.");
}

main().catch((error) => {
  console.error(`[meeting-data] ${error.message}`);
  process.exit(1);
});
