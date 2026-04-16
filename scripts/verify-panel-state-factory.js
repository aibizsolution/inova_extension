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

  assert.equal(harness.mergeUiPreferencesCalls, 2);

  assert.equal(stateA.uiPreferences.activePromptTab, "library");
  assert.equal(stateA.uiPreferences.activeTool, "meeting");
  assert.equal(stateA.settings.enabled, true);
  assert.deepEqual(stateA.bookmarks, []);
  assert.equal(stateA.routeWatchInstalled, false);
  assert.equal(stateA.awaitingRouteMessages, false);
  assert.equal(stateA.lastError, "");
  assert.equal("cloudSync" in stateA, false);
  assert.equal("providerIdentityCache" in stateA, false);
  assert.equal("activeTool" in stateA, false);
  assert.equal("open" in stateA, false);
  assert.equal("panelDebugUi" in stateA, false);
  assert.equal("toolSummaries" in stateA, false);
  assert.equal("promptReview" in stateA, false);
  assert.equal("queries" in stateA, false);

  assert.notStrictEqual(stateA, stateB);
  assert.notStrictEqual(stateA.settings, stateB.settings);
  assert.notStrictEqual(stateA.uiPreferences, stateB.uiPreferences);
  assert.notStrictEqual(stateA.bookmarks, stateB.bookmarks);
  assert.notStrictEqual(stateA.pausedSessions, stateB.pausedSessions);
  assert.notStrictEqual(stateA.routeRetryTimers, stateB.routeRetryTimers);
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
  stateA.uiPreferences.activeTool = "release";
  stateA.bookmarks.push({ id: "alpha" });
  stateA.pausedSessions.alpha = true;
  stateA.routeRetryTimers.push(1);

  assert.equal(stateB.settings.enabled, true);
  assert.equal(stateB.uiPreferences.activeTool, "meeting");
  assert.deepEqual(stateB.bookmarks, []);
  assert.deepEqual(stateB.pausedSessions, {});
  assert.deepEqual(stateB.routeRetryTimers, []);

  console.log("[verify-panel-state-factory] V2 composition state factory contract passed");
}

function createHarness() {
  let mergeUiPreferencesCalls = 0;

  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
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
