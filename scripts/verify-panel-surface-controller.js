#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifySurfaceWatcherInstallationAndComposerRecovery();
  verifySurfaceWatcherComposerLoss();
  console.log("[verify-panel-surface-controller] Panel surface controller contract passed");
}

function verifySurfaceWatcherInstallationAndComposerRecovery() {
  const harness = createHarness({
    conversationState: {
      articleCount: 0,
      hasChatLog: false,
      hasComposer: false,
      userCount: 0,
    },
    preferredOpen: true,
    storeTabActive: true,
  });

  harness.controller.installSurfaceWatchers();
  assert.equal(harness.state.surfaceSignature, "false|false|0|0");
  assert.equal(harness.intervals.length, 1);
  assert.equal(harness.intervals[0].delay, 600);

  harness.conversationState = {
    articleCount: 1,
    hasChatLog: true,
    hasComposer: true,
    userCount: 1,
  };
  harness.intervals[0].callback();

  assert.equal(harness.state.open, true);
  assert.equal(harness.state.surfaceSignature, "true|true|1|1");
  assert.deepEqual(harness.ensureStoreLoadedCalls, [true]);
  assert.deepEqual(harness.meetingScheduleCalls, [120]);
  assert.deepEqual(harness.promptRealtimeScheduleCalls, [120]);
  assert.equal(harness.renderCalls.length, 1);
  assert.equal(harness.debugEvents.length, 1);
  assert.equal(harness.debugEvents[0].event, "panel.ui.surface.changed");
}

function verifySurfaceWatcherComposerLoss() {
  const harness = createHarness({
    conversationState: {
      articleCount: 2,
      hasChatLog: true,
      hasComposer: true,
      userCount: 1,
    },
    preferredOpen: false,
    storeTabActive: false,
  });

  harness.controller.installSurfaceWatchers();
  harness.conversationState = {
    articleCount: 2,
    hasChatLog: true,
    hasComposer: false,
    userCount: 1,
  };
  harness.intervals[0].callback();

  assert.deepEqual(harness.ensureStoreLoadedCalls, []);
  assert.deepEqual(harness.meetingScheduleCalls, [0]);
  assert.deepEqual(harness.promptRealtimeScheduleCalls, [120]);
  assert.equal(harness.renderCalls.length, 1);
}

function createHarness(options = {}) {
  const debugEvents = [];
  const ensureStoreLoadedCalls = [];
  const intervals = [];
  const meetingScheduleCalls = [];
  const promptRealtimeScheduleCalls = [];
  const renderCalls = [];

  const context = vm.createContext({
    console,
    globalThis: null,
    clearInterval() {},
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
  });
  context.globalThis = context;

  let conversationState = {
    articleCount: 0,
    hasChatLog: false,
    hasComposer: false,
    userCount: 0,
    ...(options.conversationState || {}),
  };

  context.InovaBookmarks = {
    contentDom: {
      getConversationState() {
        return cloneValue(conversationState);
      },
    },
  };

  loadScript("content/panel-surface-controller.js", context);

  const state = {
    open: false,
    preferredOpen: Boolean(options.preferredOpen),
    surfacePollTimer: 0,
    surfaceSignature: "",
  };

  const controller = context.InovaBookmarks.panelSurfaceController.create(state, {
    ensureStoreLoaded() {
      ensureStoreLoadedCalls.push(true);
    },
    isStoreTabActive() {
      return Boolean(options.storeTabActive);
    },
    logPanelDebug(event, payload) {
      debugEvents.push({ event, payload: cloneValue(payload) });
    },
    meetingManager: {
      scheduleSync(delay) {
        meetingScheduleCalls.push(delay);
      },
    },
    render() {
      renderCalls.push(true);
    },
    schedulePromptRealtimeSync(delay) {
      promptRealtimeScheduleCalls.push(delay);
    },
  });

  return {
    controller,
    debugEvents,
    ensureStoreLoadedCalls,
    get conversationState() {
      return conversationState;
    },
    intervals,
    meetingScheduleCalls,
    promptRealtimeScheduleCalls,
    renderCalls,
    set conversationState(value) {
      conversationState = cloneValue(value);
    },
    state,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main();
