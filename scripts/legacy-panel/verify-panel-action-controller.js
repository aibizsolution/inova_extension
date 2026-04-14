#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");

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

  const lazyHarness = createHarness({
    lazyMeetingController: true,
  });
  assert.equal(lazyHarness.meetingControllerCreateCalls, 0);
  await lazyHarness.controller.handlePanelMeetingAction("share", { meetingId: "meeting-3" });
  assert.equal(lazyHarness.meetingControllerCreateCalls, 1);
  assert.deepEqual(lazyHarness.meetingActions, [
    { action: "share", detail: { meetingId: "meeting-3" } },
  ]);

  console.log("[verify-panel-action-controller] Panel action controller contract passed");
}

function createHarness(options = {}) {
  const debugActions = [];
  const meetingActions = [];
  let meetingControllerCreateCalls = 0;

  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {};

  loadScript("backup/legacy-panel/panel-action-controller.js", context);

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
      getPanelMeetingController: options.lazyMeetingController
        ? () => {
          meetingControllerCreateCalls += 1;
          return {
            async handleAction(action, detail) {
              meetingActions.push({
                action,
                detail: detail == null ? detail : JSON.parse(JSON.stringify(detail)),
              });
            },
          };
        }
        : undefined,
    }),
    debugActions,
    get meetingControllerCreateCalls() {
      return meetingControllerCreateCalls;
    },
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
