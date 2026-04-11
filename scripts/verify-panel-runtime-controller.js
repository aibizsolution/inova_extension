#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  const harness = createHarness();

  harness.state.sessionId = "session-1";
  harness.state.pausedSessions["session-1"] = true;
  assert.equal(harness.controller.isPaused(), true);

  harness.state.pausedSessions["session-1"] = false;
  assert.equal(harness.controller.isPaused(), false);

  harness.state.activeTool = "prompts";
  harness.state.uiPreferences.activePromptTab = "store";
  assert.equal(harness.controller.isStoreTabActive(), true);

  harness.state.uiPreferences.activePromptTab = "library";
  harness.state.uiPreferences.activeTool = "store";
  assert.equal(harness.controller.isStoreTabActive(), true);

  harness.state.activeTool = "bookmarks";
  harness.state.uiPreferences.activeTool = "meeting";
  assert.equal(harness.controller.isStoreTabActive(), false);

  harness.hasComposer = true;
  assert.equal(harness.controller.isToolSurface(), true);
  harness.hasComposer = false;
  assert.equal(harness.controller.isToolSurface(), false);

  assert.equal(harness.controller.isExtensionContextInvalidatedError(new Error("Extension Context Invalidated")), true);
  assert.equal(harness.controller.isExtensionContextInvalidatedError("network failed"), false);

  harness.controller.logPanelDebug("panel.test", { count: 1 });
  harness.controller.logPanelDebug("panel.empty");
  assert.deepEqual(harness.debugLogs, [
    { event: "panel.test", payload: { count: 1 } },
    { event: "panel.empty", payload: {} },
  ]);

  console.log("[verify-panel-runtime-controller] Panel runtime controller contract passed");
}

function createHarness() {
  const debugLogs = [];
  let hasComposer = true;

  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    contentDom: {
      getConversationState() {
        return { hasComposer };
      },
    },
    panelDebug: {
      log(event, payload) {
        debugLogs.push({
          event,
          payload: payload == null ? payload : JSON.parse(JSON.stringify(payload)),
        });
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };

  loadScript("content/panel-runtime-controller.js", context);

  const state = {
    activeTool: "bookmarks",
    pausedSessions: {},
    sessionId: "",
    uiPreferences: {
      activePromptTab: "library",
      activeTool: "bookmarks",
    },
  };

  return {
    controller: context.InovaBookmarks.panelRuntimeController.create(state),
    debugLogs,
    get hasComposer() {
      return hasComposer;
    },
    set hasComposer(value) {
      hasComposer = Boolean(value);
    },
    state,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main();
