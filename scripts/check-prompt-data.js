#!/usr/bin/env node

const {
  extractDocumentId,
  getGcloudAccessToken,
  listCollectionDocuments,
  normalizeText,
} = require("./meeting-data-lib");

const defaults = {
  projectId: "browser-extension-main",
  sampleSize: 5,
  storeEntryId: "",
  userKey: process.env.INOVA_PROVIDER_USER_KEY || "",
  promptId: "",
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.userKey && !options.storeEntryId)) {
    printUsage(options.help ? 0 : 1);
    return;
  }

  const accessToken = getGcloudAccessToken();
  console.log(`[prompt-data] project=${options.projectId}`);
  if (options.userKey) {
    await printPromptLibraryState(accessToken, options);
  }
  if (options.storeEntryId) {
    await printPromptStoreState(accessToken, options);
  }
}

async function printPromptLibraryState(accessToken, options) {
  console.log(`\n[prompt-library] userKey=${options.userKey}`);
  const account = await getDocument(accessToken, options.projectId, `integration_inova_accounts_v2/${options.userKey}`);
  if (!account) {
    console.log("  account_v2: missing");
    return;
  }

  const accountData = decodeDocumentData(account);
  const promptLibraryId = normalizeText(accountData.promptLibraryId);
  const meta = accountData.promptLibraryMeta && typeof accountData.promptLibraryMeta === "object"
    ? accountData.promptLibraryMeta
    : {};
  const bucketIds = normalizeArray(meta.bucketIds);
  console.log(`  account_v2: exists updateTime=${normalizeText(account.updateTime) || "-"}`);
  console.log(`  promptLibraryId=${promptLibraryId || "-"}`);
  console.log(`  meta.itemCount=${Number(meta.itemCount) || 0} meta.bucketIds=${bucketIds.length ? bucketIds.join(",") : "-"}`);

  if (!promptLibraryId) {
    return;
  }

  const libraryDoc = await getDocument(accessToken, options.projectId, `prompt_libraries_v2/${promptLibraryId}`);
  const libraryData = decodeDocumentData(libraryDoc);
  const libraryItemCount = Math.max(0, Number(libraryData.promptLibrary?.itemCount) || 0);
  const libraryMetaItemCount = Math.max(0, Number(libraryData.promptLibraryMeta?.itemCount) || 0);
  const order = await getDocument(accessToken, options.projectId, `prompt_library_orders_v2/${promptLibraryId}`);
  const orderedIds = normalizeArray(decodeDocumentData(order).orderedIds);
  const chunkIds = bucketIds.length ? bucketIds : ["b00"];
  const chunks = [];
  for (const bucketId of chunkIds) {
    const chunkDocId = `${promptLibraryId}__${bucketId}`;
    const chunk = await getDocument(accessToken, options.projectId, `prompt_library_chunks_v2/${chunkDocId}`);
    const items = normalizeArray(decodeDocumentData(chunk).items);
    chunks.push({ bucketId, chunkDocId, exists: Boolean(chunk), items });
  }

  const itemIds = Array.from(new Set(chunks.flatMap((chunk) => chunk.items.map((item) => normalizeText(item?.id)).filter(Boolean))));
  const metaItemCount = Math.max(0, Number(meta.itemCount) || 0);
  console.log(`  library: exists=${Boolean(libraryDoc)} itemCount=${libraryItemCount} metaItemCount=${libraryMetaItemCount}`);
  console.log(`  order: exists=${Boolean(order)} orderedCount=${orderedIds.length}`);
  console.log(`  chunks: ${chunks.map((chunk) => `${chunk.bucketId}:${chunk.exists ? chunk.items.length : "missing"}`).join(", ") || "-"}`);
  console.log(`  chunkItemCount=${itemIds.length} accountMetaItemCount=${metaItemCount} countCheck=${allCountsMatch([metaItemCount, libraryItemCount, libraryMetaItemCount, orderedIds.length, itemIds.length]) ? "PASS_MATCH" : "WARN_MISMATCH"}`);
  console.log(`  itemIds.sample=${itemIds.slice(0, options.sampleSize).join(", ") || "-"}`);

  const promptId = normalizeText(options.promptId);
  if (promptId) {
    const presentInOrder = orderedIds.includes(promptId);
    const presentInChunks = chunks.some((chunk) => chunk.items.some((item) => normalizeText(item?.id) === promptId));
    console.log(`  promptId=${promptId}`);
    console.log(`  presentInOrder=${presentInOrder ? "YES" : "NO"}`);
    console.log(`  presentInChunks=${presentInChunks ? "YES" : "NO"}`);
    console.log(`  deleteCheck=${!presentInOrder && !presentInChunks ? "PASS_ABSENT" : "FAIL_STILL_PRESENT"}`);
  }
}

async function printPromptStoreState(accessToken, options) {
  const entryId = normalizeText(options.storeEntryId);
  console.log(`\n[prompt-store] entryId=${entryId}`);
  const entry = await getDocument(accessToken, options.projectId, `prompt_store_entries/${entryId}`);
  const detail = await getDocument(accessToken, options.projectId, `prompt_store_entry_details/${entryId}`);
  const entryData = decodeDocumentData(entry);
  const feedDocs = await listCollectionDocuments(accessToken, options.projectId, "prompt_store_feed_pages");
  const feedHits = [];
  for (const feedDoc of feedDocs) {
    const data = decodeDocumentData(feedDoc);
    const items = normalizeArray(data.items);
    if (items.some((item) => normalizeText(item?.entryId) === entryId)) {
      feedHits.push(extractDocumentId(feedDoc.name));
    }
  }

  console.log(`  entry: exists=${Boolean(entry)} status=${normalizeText(entryData.status) || "-"} hasDetail=${String(Boolean(entryData.hasDetail))} removedAt=${normalizeText(entryData.removedAt) || "-"}`);
  console.log(`  detail: exists=${Boolean(detail)}`);
  console.log(`  feedsContainingEntry=${feedHits.length ? feedHits.join(", ") : "-"}`);

  const removed = Boolean(entry)
    && normalizeText(entryData.status) === "removed"
    && !entryData.hasDetail
    && !detail
    && feedHits.length === 0;
  console.log(`  unpublishCheck=${removed ? "PASS_REMOVED" : "FAIL_STILL_VISIBLE_OR_INCOMPLETE"}`);
}

async function getDocument(accessToken, projectId, documentPath) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${documentPath}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${documentPath} 조회 실패 (${response.status}): ${text}`);
  }
  return response.json();
}

function decodeDocumentData(document) {
  const fields = document?.fields;
  if (!fields || typeof fields !== "object") {
    return {};
  }
  const data = {};
  for (const [key, value] of Object.entries(fields)) {
    data[key] = decodeFirestoreValue(value);
  }
  return data;
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue) || 0;
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue) || 0;
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (value.arrayValue) {
    return (Array.isArray(value.arrayValue.values) ? value.arrayValue.values : []).map(decodeFirestoreValue);
  }
  if (value.mapValue?.fields) {
    const data = {};
    for (const [key, child] of Object.entries(value.mapValue.fields)) {
      data[key] = decodeFirestoreValue(child);
    }
    return data;
  }
  return null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function allCountsMatch(counts) {
  const normalized = counts.map((count) => Math.max(0, Number(count) || 0));
  return normalized.every((count) => count === normalized[0]);
}

function parseArgs(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const value = normalizeText(args[index]);
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--project") {
      options.projectId = normalizeText(args[index + 1]) || defaults.projectId;
      index += 1;
      continue;
    }
    if (value === "--user-key" || value === "--userKey") {
      options.userKey = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--prompt-id" || value === "--promptId") {
      options.promptId = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--store-entry-id" || value === "--storeEntryId") {
      options.storeEntryId = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--sample-size") {
      options.sampleSize = Math.max(1, Number(args[index + 1]) || defaults.sampleSize);
      index += 1;
    }
  }
  return options;
}

function printUsage(exitCode) {
  console.log("사용법:");
  console.log("  npm.cmd run check:prompt-data -- --user-key <providerUserKey> [--prompt-id <promptId>]");
  console.log("  npm.cmd run check:prompt-data -- --store-entry-id <entryId>");
  console.log("  npm.cmd run check:prompt-data -- --user-key <providerUserKey> --prompt-id <promptId> --store-entry-id <entryId>");
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`[prompt-data] ${error.message}`);
  process.exit(1);
});
