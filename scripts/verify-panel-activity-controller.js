#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyVisibilityHiddenAndVisibleFlow();
  await verifyWindowFocusFlow();
  console.log("[verify-panel-activity-controller] V2 shell bridge activity contract passed");
}

async function verifyVisibilityHiddenAndVisibleFlow() {
  const hiddenHarness = createHarness({
    open: false,
    visibilityState: "hidden",
  });

  hiddenHarness.controller.handleVisibilityChange();
  await hiddenHarness.flush();

  assert.deepEqual(hiddenHarness.promptRealtimeScheduleCalls, [0]);
  assert.deepEqual(hiddenHarness.promptCloudScheduleCalls, []);
  assert.deepEqual(hiddenHarness.releaseEnsureCalls, []);
  assert.equal(hiddenHarness.debugEvents.at(-1)?.event, "panel.ui.visibility.hidden");
  assert.equal(hiddenHarness.renderCalls.length, 1);

  const visibleHarness = createHarness({
    open: true,
    visibilityState: "visible",
  });
  visibleHarness.controller.handleVisibilityChange();
  await visibleHarness.flush();

  assert.deepEqual(visibleHarness.providerIdentityReasons, ["visibility-visible"]);
  assert.deepEqual(visibleHarness.promptCloudScheduleCalls, [320]);
  assert.deepEqual(visibleHarness.promptRealtimeScheduleCalls, [320]);
  assert.deepEqual(visibleHarness.releaseEnsureCalls, [{ allowCached: false, preferFresh: false }]);
  assert.equal(visibleHarness.debugEvents.at(-1)?.event, "panel.ui.visibility.visible");
}

async function verifyWindowFocusFlow() {
  const harness = createHarness({
    open: true,
    visibilityState: "visible",
  });
  harness.controller.handleWindowFocus();
  await harness.flush();

  assert.deepEqual(harness.providerIdentityReasons, ["window-focus"]);
  assert.deepEqual(harness.promptCloudScheduleCalls, [320]);
  assert.deepEqual(harness.promptRealtimeScheduleCalls, [320]);
  assert.deepEqual(harness.releaseEnsureCalls, [{ allowCached: false, preferFresh: false }]);
  assert.equal(harness.debugEvents.at(-1)?.event, "panel.ui.focus");
  assert.equal(harness.renderCalls.length, 1);
}

function createHarness(options = {}) {
  const debugEvents = [];
  const promptCloudScheduleCalls = [];
  const promptRealtimeScheduleCalls = [];
  const providerIdentityReasons = [];
  const releaseEnsureCalls = [];
  const renderCalls = [];

  const context = vm.createContext({
    console,
    document: {
      visibilityState: options.visibilityState || "visible",
    },
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {};

  loadScript("content/panel-v2-shell-bridge.js", context);

  const state = {
    open: Boolean(options.open),
  };

  const controller = context.InovaBookmarks.panelV2ShellBridge.createHostedOwnedPanelActivityBridge(state, {
    logPanelDebug(event, payload) {
      debugEvents.push({ event, payload: cloneValue(payload) });
    },
    providerIdentitySync: {
      async syncToStorage(reason) {
        providerIdentityReasons.push(reason);
        return true;
      },
    },
    releaseManager: {
      ensureChecked(allowCached, preferFresh) {
        releaseEnsureCalls.push({
          allowCached: Boolean(allowCached),
          preferFresh: Boolean(preferFresh),
        });
      },
    },
    render() {
      renderCalls.push(true);
    },
    schedulePromptCloudSyncIfNeeded(delay) {
      promptCloudScheduleCalls.push(delay);
    },
    schedulePromptRealtimeSync(delay) {
      promptRealtimeScheduleCalls.push(delay);
    },
  });

  return {
    controller,
    debugEvents,
    promptCloudScheduleCalls,
    promptRealtimeScheduleCalls,
    providerIdentityReasons,
    releaseEnsureCalls,
    renderCalls,
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
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
  console.error(`[verify-panel-activity-controller] ${error.stack || error.message}`);
  process.exit(1);
});
