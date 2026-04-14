#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  const harness = createHarness();
  const stateA = harness.factory.createState();
  const stateB = harness.factory.createState();

  assert.equal(harness.mergeCloudSyncCalls, 2);
  assert.equal(harness.mergeUiPreferencesCalls, 2);

  assert.equal(stateA.activeTool, "meeting");
  assert.equal(stateA.panelDebugUi.collapsed, true);
  assert.equal(stateA.cloudSync.providerIdentity.providerUserKey, "fixture-user");
  assert.equal(stateA.releaseSummary.count, 0);
  assert.equal(stateA.releaseSummary.snapshotFingerprint, "");
  assert.equal(stateA.uiPreferences.activePromptTab, "library");
  assert.equal(stateA.promptReview.open, false);
  assert.equal(stateA.routeWatchInstalled, false);

  assert.notStrictEqual(stateA, stateB);
  assert.notStrictEqual(stateA.settings, stateB.settings);
  assert.notStrictEqual(stateA.meetingSummary, stateB.meetingSummary);
  assert.notStrictEqual(stateA.releaseSummary, stateB.releaseSummary);
  assert.notStrictEqual(stateA.panelDebugUi, stateB.panelDebugUi);
  assert.notStrictEqual(stateA.promptReview, stateB.promptReview);
  assert.notStrictEqual(stateA.queries, stateB.queries);
  assert.equal("meetingHub" in stateA, false);
  assert.equal("meetingUi" in stateA, false);
  [
    "promptLibraryLoading",
    "promptLibraryRemoteReady",
    "promptLibrary",
    "promptEditor",
    "promptImportReview",
    "promptMenuId",
    "promptDeleteConfirmId",
    "promptPendingInsert",
    "promptActionPending",
    "promptPublishPromptId",
    "promptPublishCategoryId",
    "promptPublishTitle",
    "promptPublishError",
    "promptFeedback",
    "store",
  ].forEach((key) => assert.equal(key in stateA, false, `state should drop dead hosted-owned prompt residue ${key}`));

  stateA.settings.enabled = false;
  stateA.meetingSummary.count = 7;
  stateA.releaseSummary.count = 1;
  stateA.promptReview.open = true;
  stateA.queries.bookmarks = "alpha";

  assert.equal(stateB.settings.enabled, true);
  assert.equal(stateB.meetingSummary.count, 0);
  assert.equal(stateB.releaseSummary.count, 0);
  assert.equal(stateB.promptReview.open, false);
  assert.equal(stateB.queries.bookmarks, "");

  console.log("[verify-panel-state-factory] V2 composition state factory contract passed");
}

function createHarness() {
  let mergeCloudSyncCalls = 0;
  let mergeUiPreferencesCalls = 0;

  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    cloudSync: {
      mergeCloudSyncState() {
        mergeCloudSyncCalls += 1;
        return {
          providerIdentity: {
            available: true,
            providerUserKey: "fixture-user",
          },
        };
      },
    },
    constants: {
      defaults: {
        promptReview: { open: false },
        settings: {
          autoBookmark: true,
          enabled: true,
          meetingDebug: true,
        },
        uiPreferences: {
          activePromptTab: "library",
          activeTool: "meeting",
        },
      },
    },
    storage: {
      mergeUiPreferences() {
        mergeUiPreferencesCalls += 1;
        return {
          activePromptTab: "library",
          activeTool: "meeting",
          handleRatios: {},
        };
      },
    },
  };

  loadScript("content/panel-v2-composition-controller.js", context);

  return {
    factory: context.InovaBookmarks.panelV2CompositionController,
    get mergeCloudSyncCalls() {
      return mergeCloudSyncCalls;
    },
    get mergeUiPreferencesCalls() {
      return mergeUiPreferencesCalls;
    },
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main();
