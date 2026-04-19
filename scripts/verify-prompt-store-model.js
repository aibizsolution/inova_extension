#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifyDeployCopiesMatch();
  verifyPromptTextCopiesMatch();
  verifySharedModelBehavior();
  verifyPromptStoreServiceDelegates();
  verifyPromptStoreServiceViewerFlags();
  console.log("[verify-prompt-store-model] Prompt store shared model contract passed");
}

function verifyDeployCopiesMatch() {
  const hostedSource = read("hosting/extension-v2/panel/prompt-store-model.js");
  const functionsSource = read("functions/shared/prompt-store-model.js");
  assert.equal(
    functionsSource,
    hostedSource,
    "functions/shared/prompt-store-model.js must stay byte-for-byte aligned with the hosted prompt store model"
  );
}

function verifyPromptTextCopiesMatch() {
  const hostedSource = read("hosting/extension-v2/panel/prompt-text-model.js");
  const functionsSource = read("functions/shared/prompt-text-model.js");
  assert.equal(
    functionsSource,
    hostedSource,
    "functions/shared/prompt-text-model.js must stay byte-for-byte aligned with the hosted prompt text model"
  );
}

function verifySharedModelBehavior() {
  const functionsModel = loadFunctionsModel();
  const hostedModel = loadHostedModel();

  for (const model of [functionsModel, hostedModel]) {
    assert.equal(model.buildScore({ importCount: 3, likeCount: 2, viewCount: 4 }), 25);
    assert.deepEqual(
      model.normalizePublishCategory({ categoryLabel: "고객 성공/CS" }),
      { id: "고객-성공-cs", label: "고객 성공/CS" }
    );
    assert.equal(model.normalizeFilterCategoryId(""), "all");
    assert.equal(model.normalizePublishCategoryId("all"), "other");

    const entries = model.normalizeStoreEntries([
      {
        categoryId: "marketing",
        entryId: "b",
        metrics: { importCount: 2, likeCount: 1, viewCount: 1 },
        publishedAt: "2026-04-15T00:00:00.000Z",
        summary: "summary",
        title: "Beta",
      },
      {
        categoryId: "analysis",
        entryId: "a",
        metrics: { importCount: 1, likeCount: 4, viewCount: 0 },
        publishedAt: "2026-04-14T00:00:00.000Z",
        summary: "summary",
        title: "Alpha",
      },
    ]);
    assert.deepEqual(model.sortEntries(entries, "likes").map((entry) => entry.entryId), ["a", "b"]);
    assert.deepEqual(model.filterEntries(entries, "bet", "all").map((entry) => entry.entryId), ["b"]);
  }
}

function verifyPromptStoreServiceDelegates() {
  const storeServiceSource = read("functions/features/prompt-store/store-service.js");
  const runtimeSource = read("functions/platform/runtime.js");
  assert(
    storeServiceSource.includes('require("../../shared/prompt-store-model")')
      && storeServiceSource.includes('require("../../shared/prompt-text-model")')
      && storeServiceSource.includes("globalThis.InovaBookmarks.promptStoreModel"),
    "Functions prompt store service should use the deploy-local shared prompt store model"
  );
  assert(
    runtimeSource.includes('require("../shared/prompt-text-model")')
      && runtimeSource.includes('require("../shared/prompt-store-model")')
      && runtimeSource.includes("globalThis.InovaBookmarks.promptTextModel")
      && runtimeSource.includes("globalThis.InovaBookmarks.promptStoreModel")
      && runtimeSource.includes("promptStoreModel.getDefaultStoreCategories()"),
    "Functions runtime should get prompt text normalization and store categories from shared prompt models"
  );
  [
    "likeCount * 3",
    "importCount * 5",
    "function sortEntries(entries",
    "function compareCategoryIds(",
    "function buildScore(",
  ].forEach((pattern) => assert(
    !storeServiceSource.includes(pattern),
    `Functions prompt store service should not keep duplicated prompt store model logic: ${pattern}`
  ));
}

function verifyPromptStoreServiceViewerFlags() {
  const storeServiceSource = read("functions/features/prompt-store/store-service.js");
  assert(
    storeServiceSource.includes("{ imported: true, liked: Boolean(likeSnapshot.exists), viewed: Boolean(viewSnapshot.exists) }"),
    "Store import response must preserve the viewer like/view state so the UI does not lose an existing like after import"
  );
  assert(
    storeServiceSource.includes("{ imported: Boolean(importSnapshot.exists), liked: !liked, viewed: Boolean(viewSnapshot.exists) }"),
    "Store like response must preserve viewer import/view state so one action does not clear another action flag"
  );
  assert(
    !storeServiceSource.includes("{ imported: true, liked: false, viewed: false }"),
    "Store import response must not hard-code unrelated viewer flags to false"
  );
  assert(
    !storeServiceSource.includes("{ imported: false, liked: !liked, viewed: false }"),
    "Store like response must not hard-code unrelated viewer flags to false"
  );
}

function loadHostedModel() {
  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim();
      },
    },
  };
  new vm.Script(read("hosting/extension-v2/panel/prompt-text-model.js"), {
    filename: "hosting/extension-v2/panel/prompt-text-model.js",
  }).runInContext(context);
  new vm.Script(read("hosting/extension-v2/panel/prompt-store-model.js"), {
    filename: "hosting/extension-v2/panel/prompt-store-model.js",
  }).runInContext(context);
  return context.InovaBookmarks.promptStoreModel;
}

function loadFunctionsModel() {
  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  new vm.Script(read("functions/shared/prompt-text-model.js"), {
    filename: "functions/shared/prompt-text-model.js",
  }).runInContext(context);
  new vm.Script(read("functions/shared/prompt-store-model.js"), {
    filename: "functions/shared/prompt-store-model.js",
  }).runInContext(context);
  return context.InovaBookmarks.promptStoreModel;
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

main();
