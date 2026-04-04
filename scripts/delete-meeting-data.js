#!/usr/bin/env node

const {
  DEFAULT_STORAGE_PREFIX,
  MEETING_COLLECTIONS,
  deleteBucketObject,
  deleteFirestoreDocument,
  documentMatchesMeeting,
  filterStorageObjectsByMeetingId,
  getGcloudAccessToken,
  listCollectionDocuments,
  listStorageObjects,
  normalizeText,
  resolveBucketNames,
  runInBatches,
  summarizeDocument,
} = require("./meeting-data-lib");

const defaults = {
  all: false,
  bucketNames: [],
  execute: false,
  meetingId: "",
  prefix: DEFAULT_STORAGE_PREFIX,
  projectId: "browser-extension-main",
  sampleSize: 3,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);

  const accessToken = getGcloudAccessToken();
  const bucketNames = await resolveBucketNames(accessToken, options.projectId, options.bucketNames);

  console.log(`[meeting-data-delete] project=${options.projectId}`);
  console.log(`[meeting-data-delete] mode=${options.all ? "all" : `meeting:${options.meetingId}`}`);
  console.log(`[meeting-data-delete] prefix=${options.prefix}`);
  console.log(`[meeting-data-delete] execute=${options.execute ? "yes" : "no"}`);
  console.log(`[meeting-data-delete] buckets=${bucketNames.length ? bucketNames.join(", ") : "-"}`);

  const collectionPlans = [];
  for (const collection of MEETING_COLLECTIONS) {
    const documents = await listCollectionDocuments(accessToken, options.projectId, collection.id);
    const matchedDocuments = options.all
      ? documents
      : documents.filter((document) => documentMatchesMeeting(document, collection, options.meetingId));
    const plan = {
      collection,
      group: collection.group || "data",
      matchedDocuments,
      samples: matchedDocuments.slice(0, options.sampleSize).map((document) => summarizeDocument(document, collection.samplePaths)),
    };
    collectionPlans.push(plan);
    printCollectionPlan(plan);
  }

  const storagePlans = [];
  for (const bucketName of bucketNames) {
    const storage = await listStorageObjects(accessToken, bucketName, options.prefix);
    const matchedObjects = options.all
      ? storage.items
      : filterStorageObjectsByMeetingId(storage.items, options.meetingId);
    const plan = {
      bucketName,
      error: storage.error || "",
      matchedObjects,
      samples: matchedObjects.slice(0, options.sampleSize),
      status: storage.status,
    };
    storagePlans.push(plan);
    printStoragePlan(plan, options.prefix);
  }

  printDeleteSummary(collectionPlans, storagePlans);

  const firestoreTargetCount = collectionPlans.reduce((sum, item) => sum + item.matchedDocuments.length, 0);
  const storageTargetCount = storagePlans.reduce((sum, item) => sum + item.matchedObjects.length, 0);
  if (!firestoreTargetCount && !storageTargetCount) {
    console.log("[meeting-data-delete] 삭제 대상이 없습니다.");
    return;
  }

  if (!options.execute) {
    console.log("[meeting-data-delete] dry-run 입니다. 실제 삭제는 --execute를 붙여 다시 실행해 주세요.");
    return;
  }

  console.log("[meeting-data-delete] 삭제를 시작합니다.");

  let deletedFirestoreCount = 0;
  for (const plan of collectionPlans) {
    const results = await runInBatches(
      plan.matchedDocuments,
      (document) => deleteFirestoreDocument(accessToken, document.name),
      20
    );
    deletedFirestoreCount += results.filter(Boolean).length;
  }

  let deletedStorageCount = 0;
  for (const plan of storagePlans) {
    if (plan.status !== "ok") {
      continue;
    }
    const results = await runInBatches(
      plan.matchedObjects,
      (item) => deleteBucketObject(accessToken, plan.bucketName, item.name),
      20
    );
    deletedStorageCount += results.filter(Boolean).length;
  }

  console.log(`[meeting-data-delete] deletedFirestore=${deletedFirestoreCount}`);
  console.log(`[meeting-data-delete] deletedStorage=${deletedStorageCount}`);

  const remainingCollections = [];
  for (const collection of MEETING_COLLECTIONS) {
    const documents = await listCollectionDocuments(accessToken, options.projectId, collection.id);
    const matchedDocuments = options.all
      ? documents
      : documents.filter((document) => documentMatchesMeeting(document, collection, options.meetingId));
    remainingCollections.push({
      collection,
      remainingCount: matchedDocuments.length,
    });
  }

  const remainingStorage = [];
  for (const bucketName of bucketNames) {
    const storage = await listStorageObjects(accessToken, bucketName, options.prefix);
    const matchedObjects = options.all
      ? storage.items
      : filterStorageObjectsByMeetingId(storage.items, options.meetingId);
    remainingStorage.push({
      bucketName,
      remainingCount: matchedObjects.length,
      status: storage.status,
    });
  }

  const remainingFirestoreCount = remainingCollections.reduce((sum, item) => sum + item.remainingCount, 0);
  const remainingStorageCount = remainingStorage.reduce((sum, item) => sum + item.remainingCount, 0);

  console.log("[meeting-data-delete] verification");
  console.log(`  remainingFirestore=${remainingFirestoreCount}`);
  console.log(`  remainingStorage=${remainingStorageCount}`);
  if (!remainingFirestoreCount && !remainingStorageCount) {
    console.log("  삭제 대상이 모두 정리되었습니다.");
    return;
  }

  console.log("  일부 데이터가 남아 있습니다. 아래 잔여 건수를 확인해 주세요.");
  for (const item of remainingCollections) {
    if (item.remainingCount > 0) {
      console.log(`  firestore ${item.collection.label}=${item.remainingCount}`);
    }
  }
  for (const item of remainingStorage) {
    if (item.status === "ok" && item.remainingCount > 0) {
      console.log(`  storage ${item.bucketName}=${item.remainingCount}`);
    }
  }
}

function parseArgs(args) {
  const options = {
    ...defaults,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = normalizeText(args[index]);
    if (value === "--all") {
      options.all = true;
      continue;
    }
    if (value === "--meeting-id") {
      options.meetingId = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--execute") {
      options.execute = true;
      continue;
    }
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

function printCollectionPlan(plan) {
  console.log(`\n[collection] ${plan.collection.label} (${plan.collection.id}) matched=${plan.matchedDocuments.length}`);
  if (!plan.samples.length) {
    console.log("  samples: -");
    return;
  }
  for (const sample of plan.samples) {
    console.log(`  - id=${sample.id} updateTime=${sample.updateTime || "-"}`);
  }
}

function printStoragePlan(plan, prefix) {
  if (plan.status === "missing") {
    console.log(`\n[storage] bucket=${plan.bucketName} prefix=${prefix} status=missing`);
    return;
  }
  if (plan.status === "error") {
    console.log(`\n[storage] bucket=${plan.bucketName} prefix=${prefix} status=error`);
    console.log(`  error=${plan.error}`);
    return;
  }
  console.log(`\n[storage] bucket=${plan.bucketName} prefix=${prefix} matched=${plan.matchedObjects.length}`);
  if (!plan.samples.length) {
    console.log("  samples: -");
    return;
  }
  for (const sample of plan.samples) {
    console.log(`  - name=${normalizeText(sample?.name)} size=${Math.max(0, Number(sample?.size) || 0)}`);
  }
}

function printDeleteSummary(collectionPlans, storagePlans) {
  const firestoreTargetCount = collectionPlans.reduce((sum, item) => sum + item.matchedDocuments.length, 0);
  const dataFirestoreTargetCount = collectionPlans
    .filter((item) => item.group === "data")
    .reduce((sum, item) => sum + item.matchedDocuments.length, 0);
  const sessionFirestoreTargetCount = collectionPlans
    .filter((item) => item.group === "session")
    .reduce((sum, item) => sum + item.matchedDocuments.length, 0);
  const storageTargetCount = storagePlans.reduce((sum, item) => sum + item.matchedObjects.length, 0);
  console.log("\n[summary]");
  console.log(`  targetFirestore=${firestoreTargetCount}`);
  console.log(`  targetDataFirestore=${dataFirestoreTargetCount}`);
  console.log(`  targetSessionFirestore=${sessionFirestoreTargetCount}`);
  console.log(`  targetStorage=${storageTargetCount}`);
}

function validateOptions(options) {
  if (options.all && options.meetingId) {
    throw new Error("--all 과 --meeting-id 는 동시에 사용할 수 없어요.");
  }
  if (!options.all && !options.meetingId) {
    throw new Error("전체 삭제는 --all, 개별 삭제는 --meeting-id <id> 중 하나가 필요해요.");
  }
}

main().catch((error) => {
  console.error(`[meeting-data-delete] ${error.message}`);
  process.exit(1);
});
