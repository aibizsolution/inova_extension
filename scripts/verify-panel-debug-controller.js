#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyDebugStateAndValidation();
  await verifyDebugActions();
  console.log("[verify-panel-debug-controller] Panel debug controller contract passed");
}

async function verifyDebugStateAndValidation() {
  const harness = createHarness();
  harness.controller.syncEnabled();
  assert.deepEqual(harness.enabledFlags, [true]);

  harness.context.document.visibilityState = "hidden";
  harness.controller.syncEnabled();
  assert.deepEqual(harness.enabledFlags, [true, false]);

  harness.context.document.visibilityState = "visible";
  harness.controller.installValidationApi();
  const validation = harness.context.InovaBookmarks.panelDebugValidation.check();
  assert.equal(validation.passed, true);
  assert.equal(validation.snapshot.rendered, true);
  assert.equal(validation.snapshot.statusText, "함수 2건 · 읽기 1건 · 리스너 1건 · 오류 1건");
}

async function verifyDebugActions() {
  const harness = createHarness();
  assert.equal(harness.controller.handlesAction("debug-toggle"), true);
  assert.equal(harness.controller.handlesAction("share"), false);

  await harness.controller.handleAction("debug-copy");
  assert.deepEqual(harness.clipboardWrites, ["all logs"]);
  assert.equal(harness.state.panelDebugUi.feedback.text, "디버그 로그를 복사했습니다.");

  await harness.controller.handleAction("debug-copy-errors");
  assert.deepEqual(harness.clipboardWrites, ["all logs", "error logs"]);
  assert.equal(harness.state.panelDebugUi.feedback.text, "디버그 오류 로그를 복사했습니다.");

  await harness.controller.handleAction("debug-clear");
  assert.equal(harness.clearCalls.length, 1);
  assert.equal(harness.state.panelDebugUi.feedback.text, "디버그 로그를 비웠습니다.");

  await harness.controller.handleAction("debug-toggle");
  assert.equal(harness.state.panelDebugUi.collapsed, true);
  assert.equal(harness.localStorageState.__INOVA_MEETING_PANEL_DEBUG_COLLAPSED__, "1");
}

function createHarness() {
  const clipboardWrites = [];
  const clearCalls = [];
  const enabledFlags = [];
  const localStorageState = {};
  const renderCalls = [];

  const debugLayer = buildDebugLayer();
  const context = vm.createContext({
    console,
    clearTimeout() {},
    globalThis: null,
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(localStorageState, key) ? localStorageState[key] : null;
      },
      setItem(key, value) {
        localStorageState[key] = String(value);
      },
    },
    navigator: {
      clipboard: {
        async writeText(text) {
          clipboardWrites.push(text);
        },
      },
    },
    document: {
      getElementById(id) {
        return id === "inova-meeting-debug-layer" ? debugLayer : null;
      },
      visibilityState: "visible",
    },
    setTimeout() {
      return 1;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    panelDebug: {
      buildCopyText() {
        return "all logs";
      },
      buildErrorCopyText() {
        return "error logs";
      },
      clearEntries() {
        clearCalls.push(true);
      },
      getEntries() {
        return [{ id: 1, level: "info" }, { id: 2, level: "error" }];
      },
      isLocalDebugEnabled() {
        return true;
      },
      log() {},
      setEnabled(flag) {
        enabledFlags.push(Boolean(flag));
      },
      summarizeEntries() {
        return {
          errorCount: 1,
          functionCalls: 2,
          readCount: 1,
          snapshotCount: 1,
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };

  loadScript("content/panel-debug-controller.js", context);

  const state = {
    panelDebugUi: {
      collapsed: false,
      feedback: null,
      feedbackTimer: 0,
    },
    settings: {
      enabled: true,
      meetingDebug: true,
    },
  };
  const controller = context.InovaBookmarks.panelDebugController.create(state, {
    isPaused() {
      return false;
    },
    isToolSurface() {
      return true;
    },
    render() {
      renderCalls.push(true);
    },
  });

  return {
    clearCalls,
    clipboardWrites,
    context,
    controller,
    enabledFlags,
    localStorageState,
    renderCalls,
    state,
  };
}

function buildDebugLayer() {
  const logElement = { textContent: "함수 호출 로그" };
  const feedbackElement = { textContent: "복사 완료" };
  const statusElement = {
    getAttribute(name) {
      return name === "aria-label" ? "함수 2건 · 읽기 1건 · 리스너 1건 · 오류 1건" : "";
    },
  };
  const buttons = [
    { dataset: { meetingAction: "debug-copy" }, disabled: false, textContent: "복사" },
    { dataset: { meetingAction: "debug-copy-errors" }, disabled: false, textContent: "오류" },
    { dataset: { meetingAction: "debug-clear" }, disabled: false, textContent: "비우기" },
    { dataset: { meetingAction: "debug-toggle" }, disabled: false, textContent: "접기" },
  ];
  return {
    innerHTML: "<div>debug</div>",
    querySelector(selector) {
      if (selector === ".inova-meeting-debug-console__log") return logElement;
      if (selector === ".inova-meeting-debug-console__feedback") return feedbackElement;
      if (selector === ".inova-meeting-debug-console__status") return statusElement;
      if (selector === ".inova-meeting-debug-fab__badge") return { textContent: "!" };
      if (selector === ".inova-meeting-debug-fab[data-meeting-action=\"debug-toggle\"]") return { textContent: "toggle" };
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-meeting-action]" ? buttons : [];
    },
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main().catch((error) => {
  console.error(`[verify-panel-debug-controller] ${error.stack || error.message}`);
  process.exit(1);
});
