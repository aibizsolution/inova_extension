#!/usr/bin/env node

const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = "browser-extension-main";
const FEED_COLLECTION = "prompt_store_feed_pages";
const SUMMARY_COLLECTION = "prompt_store_meta";
const SUMMARY_DOC_ID = "summary";
const PAGE_SIZE = 500;
const SORTS = ["latest", "likes", "imports", "views"];

if (require.main === module) {
  main().catch((error) => {
    console.error("[rebuild-store-feeds] failed", error);
    process.exit(1);
  });
}

async function main() {
  await rebuildStoreFeeds();
}

async function rebuildStoreFeeds() {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();
  const snapshot = await db.collection("prompt_store_entries")
    .where("status", "==", "published")
    .select("categoryId", "categoryLabel", "entryId", "hasDetail", "metrics", "owner", "publishedAt", "title", "updatedAt")
    .get();
  const entries = snapshot.docs.map((doc) => normalizeEntry({ entryId: doc.id, ...(doc.data() || {}) }));
  const categories = {};
  for (const entry of entries) categories[entry.categoryId] = (categories[entry.categoryId] || 0) + 1;
  const updatedAt = new Date().toISOString();
  const writes = [{ ref: db.collection(SUMMARY_COLLECTION).doc(SUMMARY_DOC_ID), type: "set", data: { categories, totalPublished: entries.length, updatedAt } }];
  const seen = new Set();

  for (const sortBy of SORTS) {
    for (const categoryId of ["all", ...Object.keys(categories)]) {
      const items = sortEntries((categoryId === "all" ? entries : entries.filter((entry) => entry.categoryId === categoryId)).map(buildFeedItem), sortBy);
      for (let pageNumber = 0; pageNumber * PAGE_SIZE < items.length; pageNumber += 1) {
        const ref = db.collection(FEED_COLLECTION).doc(`${sortBy}__${categoryId}__${String(pageNumber).padStart(4, "0")}`);
        seen.add(ref.id);
        writes.push({ ref, type: "set", data: { categoryId, itemCount: items.length, items: items.slice(pageNumber * PAGE_SIZE, (pageNumber + 1) * PAGE_SIZE), pageNumber, sortBy, updatedAt } });
      }
    }
  }

  const existing = await db.collection(FEED_COLLECTION).get();
  for (const doc of existing.docs) if (!seen.has(doc.id)) writes.push({ ref: doc.ref, type: "delete" });
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + 400)) write.type === "delete" ? batch.delete(write.ref) : batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }
  console.log(`[rebuild-store-feeds] rebuilt ${entries.length} entries into ${seen.size} feed pages`);
}

module.exports = {
  rebuildStoreFeeds,
};

function normalizeEntry(entry) {
  return {
    categoryId: String(entry?.categoryId || "other").trim() || "other",
    categoryLabel: String(entry?.categoryLabel || "기타").trim() || "기타",
    entryId: String(entry?.entryId || "").trim(),
    hasDetail: true,
    metrics: {
      importCount: Math.max(0, Number(entry?.metrics?.importCount) || 0),
      likeCount: Math.max(0, Number(entry?.metrics?.likeCount) || 0),
      viewCount: Math.max(0, Number(entry?.metrics?.viewCount) || 0),
    },
    owner: entry?.owner || { displayName: "익명", kind: "user", maskedEmail: "", providerUserKey: "" },
    publishedAt: String(entry?.publishedAt || "").trim(),
    title: String(entry?.title || "").trim(),
    updatedAt: String(entry?.updatedAt || entry?.publishedAt || "").trim(),
  };
}

function buildFeedItem(entry) {
  return {
    categoryId: entry.categoryId,
    categoryLabel: entry.categoryLabel,
    entryId: entry.entryId,
    hasDetail: entry.hasDetail,
    metrics: entry.metrics,
    owner: entry.owner,
    publishedAt: entry.publishedAt,
    title: entry.title,
    updatedAt: entry.updatedAt,
  };
}

function sortEntries(entries, sortBy) {
  return entries.slice().sort((left, right) => {
    if (sortBy === "likes") return compareNumber(right.metrics.likeCount, left.metrics.likeCount) || compareDate(right.publishedAt, left.publishedAt);
    if (sortBy === "imports") return compareNumber(right.metrics.importCount, left.metrics.importCount) || compareDate(right.publishedAt, left.publishedAt);
    if (sortBy === "views") return compareNumber(right.metrics.viewCount, left.metrics.viewCount) || compareDate(right.publishedAt, left.publishedAt);
    return compareDate(right.publishedAt, left.publishedAt);
  });
}

function compareNumber(left, right) {
  return Number(left || 0) - Number(right || 0);
}

function compareDate(left, right) {
  return Date.parse(left || "") - Date.parse(right || "");
}
