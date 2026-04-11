#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  const debugHarness = createHarness({
    handlesAction(action) {
      return action === "debug-toggle";
    },
  });
  await debugHarness.controller.handlePanelMeetingAction("debug-toggle", { meetingId: "meeting-1" });
  assert.deepEqual(debugHarness.debugActions, ["debug-toggle"]);
  assert.deepEqual(debugHarness.meetingActions, []);

  const meetingHarness = createHarness({
    handlesAction() {
      return false;
    },
  });
  await meetingHarness.controller.handlePanelMeetingAction("share", { meetingId: "meeting-2" });
  assert.deepEqual(meetingHarness.debugActions, []);
  assert.deepEqual(meetingHarness.meetingActions, [
    { action: "share", detail: { meetingId: "meeting-2" } },
  ]);

  console.log("[verify-panel-action-controller] Panel action controller contract passed");
}

function createHarness(options = {}) {
  const debugActions = [];
  const meetingActions = [];

  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {};

  loadScript("content/panel-action-controller.js", context);

  return {
    controller: context.InovaBookmarks.panelActionController.create({}, {
      panelDebugController: {
        async handleAction(action) {
          debugActions.push(action);
        },
        handlesAction: typeof options.handlesAction === "function"
          ? options.handlesAction
          : () => false,
      },
      panelMeetingController: {
        async handleAction(action, detail) {
          meetingActions.push({
            action,
            detail: detail == null ? detail : JSON.parse(JSON.stringify(detail)),
          });
        },
      },
    }),
    debugActions,
    meetingActions,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main().catch((error) => {
  console.error(`[verify-panel-action-controller] ${error.stack || error.message}`);
  process.exit(1);
});
