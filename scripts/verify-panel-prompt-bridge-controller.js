#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  const harness = createHarness();

  assert.deepEqual(harness.controller.buildToolState(), { id: "tool-state" });
  assert.deepEqual(harness.controller.buildReviewFloatState(true), { id: "review-state", visible: true });

  harness.controller.ensureReviewFloat();
  harness.controller.ensureStoreLoaded("route-refresh");
  harness.controller.handleDraftChange("title", "새 제목");
  harness.controller.handlePromptAction("save-prompt", { promptId: "prompt-1" });
  harness.controller.handleStoreAction("toggle-like", { entryId: "store-1" });
  harness.controller.handleStorageChange({ promptLibrary: { newValue: { items: [] } } }, "local");
  harness.controller.handleImportFile({ name: "prompts.json" });
  harness.controller.movePromptItem("prompt-1", "prompt-2", "after");
  harness.controller.selectPromptTab("store");
  await harness.controller.selectTool("prompts");
  harness.controller.updateQuery("prompts", "회의");
  harness.controller.submitQuery("store", "공개");
  harness.controller.handleEscape();
  harness.controller.scheduleCloudSyncIfNeeded(1800);
  harness.controller.schedulePromptCloudSyncIfNeeded(220);
  harness.controller.scheduleRealtimeSync(260);
  harness.controller.schedulePromptRealtimeSync(120);

  assert.deepEqual(harness.calls, [
    { name: "ensureReviewFloat", args: [] },
    { name: "ensureStoreLoaded", args: ["route-refresh"] },
    { name: "handleDraftChange", args: ["title", "새 제목"] },
    { name: "handlePromptAction", args: ["save-prompt", { promptId: "prompt-1" }] },
    { name: "handleStoreAction", args: ["toggle-like", { entryId: "store-1" }] },
    { name: "handleStorageChange", args: [{ promptLibrary: { newValue: { items: [] } } }, "local"] },
    { name: "handleImportFile", args: [{ name: "prompts.json" }] },
    { name: "movePromptItem", args: ["prompt-1", "prompt-2", "after"] },
    { name: "selectPromptTab", args: ["store"] },
    { name: "selectTool", args: ["prompts"] },
    { name: "updateQuery", args: ["prompts", "회의"] },
    { name: "submitQuery", args: ["store", "공개"] },
    { name: "handleEscape", args: [] },
    { name: "scheduleCloudSyncIfNeeded", args: [1800] },
    { name: "scheduleCloudSyncIfNeeded", args: [220] },
    { name: "scheduleRealtimeSync", args: [260] },
    { name: "scheduleRealtimeSync", args: [120] },
  ]);

  console.log("[verify-panel-prompt-bridge-controller] Panel prompt bridge controller contract passed");
}

function createHarness() {
  const calls = [];

  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {};

  loadScript("content/panel-prompt-bridge-controller.js", context);

  const panelPromptController = {
    buildReviewFloatState(visible) {
      return { id: "review-state", visible };
    },
    buildToolState() {
      return { id: "tool-state" };
    },
    ensureReviewFloat(...args) {
      calls.push({ name: "ensureReviewFloat", args: cloneValue(args) });
    },
    ensureStoreLoaded(...args) {
      calls.push({ name: "ensureStoreLoaded", args: cloneValue(args) });
    },
    handleDraftChange(...args) {
      calls.push({ name: "handleDraftChange", args: cloneValue(args) });
    },
    handleEscape(...args) {
      calls.push({ name: "handleEscape", args: cloneValue(args) });
      return true;
    },
    handleImportFile(...args) {
      calls.push({ name: "handleImportFile", args: cloneValue(args) });
    },
    handlePromptAction(...args) {
      calls.push({ name: "handlePromptAction", args: cloneValue(args) });
    },
    handleStorageChange(...args) {
      calls.push({ name: "handleStorageChange", args: cloneValue(args) });
    },
    handleStoreAction(...args) {
      calls.push({ name: "handleStoreAction", args: cloneValue(args) });
    },
    movePromptItem(...args) {
      calls.push({ name: "movePromptItem", args: cloneValue(args) });
    },
    scheduleCloudSyncIfNeeded(...args) {
      calls.push({ name: "scheduleCloudSyncIfNeeded", args: cloneValue(args) });
    },
    scheduleRealtimeSync(...args) {
      calls.push({ name: "scheduleRealtimeSync", args: cloneValue(args) });
    },
    selectPromptTab(...args) {
      calls.push({ name: "selectPromptTab", args: cloneValue(args) });
    },
    async selectTool(...args) {
      calls.push({ name: "selectTool", args: cloneValue(args) });
      return true;
    },
    submitQuery(...args) {
      calls.push({ name: "submitQuery", args: cloneValue(args) });
      return true;
    },
    updateQuery(...args) {
      calls.push({ name: "updateQuery", args: cloneValue(args) });
      return true;
    },
  };

  return {
    calls,
    controller: context.InovaBookmarks.panelPromptBridgeController.create({}, {
      panelPromptController,
    }),
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-panel-prompt-bridge-controller] ${error.stack || error.message}`);
  process.exit(1);
});
