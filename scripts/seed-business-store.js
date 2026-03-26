#!/usr/bin/env node

const admin = require("../functions/node_modules/firebase-admin");
const { PUBLIC_BUSINESS_PROMPT_SEEDS } = require("./business-store-seeds");
const { rebuildStoreFeeds } = require("./rebuild-store-feeds");

const PROJECT_ID = "browser-extension-main";
const COLLECTION = "prompt_store_entries";
const DETAIL_COLLECTION = "prompt_store_entry_details";
const SYSTEM_OWNER_KEY = "system:public-business-prompt-pack";
const SYSTEM_OWNER = {
  displayName: "시스템",
  kind: "system",
  maskedEmail: "",
  providerUserKey: SYSTEM_OWNER_KEY,
};

main().catch((error) => {
  console.error("[seed-business-store] failed", error);
  process.exit(1);
});

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  const db = admin.firestore();
  const now = new Date().toISOString();
  const refs = PUBLIC_BUSINESS_PROMPT_SEEDS.map((seed) => db.collection(COLLECTION).doc(seed.entryId));
  const existingSnapshots = dryRun ? [] : await db.getAll(...refs);
  const existingMap = new Map(existingSnapshots.map((snapshot) => [snapshot.id, snapshot.data() || {}]));

  if (dryRun) {
    logDryRunSummary();
    console.log(`[seed-business-store] dry-run ${PUBLIC_BUSINESS_PROMPT_SEEDS.length} entries`);
    return;
  }

  for (let index = 0; index < PUBLIC_BUSINESS_PROMPT_SEEDS.length; index += 150) {
    const batch = db.batch();
    for (const seed of PUBLIC_BUSINESS_PROMPT_SEEDS.slice(index, index + 150)) {
      const previous = existingMap.get(seed.entryId) || null;
      const entry = buildEntry(seed, previous, now);
      const detail = buildDetailEntry(seed, now);
      batch.set(db.collection(COLLECTION).doc(seed.entryId), entry);
      batch.set(db.collection(DETAIL_COLLECTION).doc(seed.entryId), detail);
    }
    await batch.commit();
  }

  await rebuildStoreFeeds();
  console.log(`[seed-business-store] seeded ${PUBLIC_BUSINESS_PROMPT_SEEDS.length} entries`);
}

function buildEntry(seed, previous, timestamp) {
  return {
    categoryId: seed.categoryId,
    categoryLabel: seed.categoryLabel,
    entryId: seed.entryId,
    hasDetail: true,
    metrics: previous?.metrics || { importCount: 0, likeCount: 0, viewCount: 0 },
    owner: SYSTEM_OWNER,
    publishedAt: previous?.publishedAt || timestamp,
    score: Number(previous?.score) || 0,
    source: {
      references: seed.sources,
      seedId: seed.slug,
      seedKind: "system-public-business-prompts",
    },
    status: "published",
    summary: seed.summary,
    title: seed.title,
    updatedAt: timestamp,
  };
}

function buildDetailEntry(seed, timestamp) {
  return {
    content: seed.content,
    entryId: seed.entryId,
    owner: {
      kind: SYSTEM_OWNER.kind,
      providerUserKey: SYSTEM_OWNER.providerUserKey,
    },
    updatedAt: timestamp,
  };
}

function logDryRunSummary() {
  const counts = {};
  for (const seed of PUBLIC_BUSINESS_PROMPT_SEEDS) {
    counts[seed.categoryLabel] = Math.max(0, Number(counts[seed.categoryLabel]) || 0) + 1;
  }

  Object.entries(counts)
    .sort((left, right) => left[0].localeCompare(right[0], "ko"))
    .forEach(([label, count]) => {
      console.log(`[seed-business-store] ${label}: ${count}`);
    });
}
