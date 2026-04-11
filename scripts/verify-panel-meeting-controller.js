#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyOpenResultSuccess();
  await verifyOpenResultFailure();
  await verifyShareSuccess();
  await verifyShareFailure();
  await verifyRevokeShareSuccess();
  await verifyRevokeShareFailure();
  console.log("[verify-panel-meeting-controller] Panel meeting controller contract passed");
}

async function verifyOpenResultSuccess() {
  const harness = createHarness();
  await harness.controller.handleAction("open-result", { meetingId: "meeting-alpha", jobId: "job-alpha", title: "Alpha" });
  assert.equal(harness.bridgeCalls.openResult.length, 1);
  assert.equal(harness.state.meetingUi.feedback.text, "결과 탭을 열었습니다.");
  assert.equal(harness.state.meetingUi.pending.action, "");
  assert.equal(harness.syncReasons[0].reason, "meeting-action:open-result");
}

async function verifyOpenResultFailure() {
  const harness = createHarness({
    openResultError: "결과 탭 열기 실패",
  });
  await harness.controller.handleAction("open-result", { meetingId: "meeting-alpha", jobId: "job-alpha" });
  assert.equal(harness.bridgeCalls.openResult.length, 1);
  assert.equal(harness.state.meetingUi.feedback.text, "결과 탭 열기 실패");
  assert.equal(harness.state.meetingUi.feedback.tone, "error");
  assert.equal(harness.state.meetingUi.pending.action, "");
}

async function verifyShareSuccess() {
  const harness = createHarness();
  await harness.controller.handleAction("share", { meetingId: "meeting-alpha", title: "Alpha" });
  assert.equal(harness.bridgeCalls.createShare.length, 1);
  assert.equal(harness.clipboardWrites[0], "https://share.example/meeting-alpha");
  assert.equal(harness.state.meetingHub.items[0].share.active, true);
  assert.equal(harness.state.meetingUi.feedback.text, "공유 링크를 복사했습니다.");
  assert.deepEqual(harness.scheduleSyncCalls, [0]);
}

async function verifyShareFailure() {
  const harness = createHarness({
    createShareResult: { shareUrl: "", share: null },
  });
  await harness.controller.handleAction("share", { meetingId: "meeting-alpha" });
  assert.equal(harness.bridgeCalls.createShare.length, 1);
  assert.equal(harness.state.meetingUi.feedback.text, "공유 링크를 만들지 못했어요.");
  assert.equal(harness.state.meetingUi.feedback.tone, "error");
  assert.equal(harness.state.meetingHub.items[0].share.active, false);
}

async function verifyRevokeShareSuccess() {
  const harness = createHarness({
    initialShare: {
      active: true,
      createdAt: "2026-04-11T10:00:00.000Z",
      createdBy: { providerUserKey: "fixture-user" },
      revokedAt: "",
      shareId: "share-alpha",
      status: "active",
    },
  });
  await harness.controller.handleAction("revoke-share", { meetingId: "meeting-alpha" });
  assert.equal(harness.bridgeCalls.revokeShare.length, 1);
  assert.equal(harness.state.meetingHub.items[0].share.active, false);
  assert.equal(harness.state.meetingUi.feedback.text, "공유 링크를 해제했습니다.");
  assert.deepEqual(harness.scheduleSyncCalls, [0]);
}

async function verifyRevokeShareFailure() {
  const harness = createHarness({
    revokeShareError: "공유 해제 실패",
    initialShare: {
      active: true,
      createdAt: "2026-04-11T10:00:00.000Z",
      createdBy: { providerUserKey: "fixture-user" },
      revokedAt: "",
      shareId: "share-alpha",
      status: "active",
    },
  });
  await harness.controller.handleAction("revoke-share", { meetingId: "meeting-alpha" });
  assert.equal(harness.bridgeCalls.revokeShare.length, 1);
  assert.equal(harness.state.meetingUi.feedback.text, "공유 해제 실패");
  assert.equal(harness.state.meetingUi.feedback.tone, "error");
  assert.equal(harness.state.meetingHub.items[0].share.active, true);
}

function createHarness(options = {}) {
  const clipboardWrites = [];
  const bridgeCalls = {
    createShare: [],
    openResult: [],
    openWorkspace: [],
    revokeShare: [],
  };
  const logEvents = [];
  const scheduleSyncCalls = [];
  const syncReasons = [];

  const context = vm.createContext({
    console,
    clearTimeout() {},
    globalThis: null,
    navigator: {
      clipboard: {
        async writeText(text) {
          clipboardWrites.push(text);
        },
      },
    },
    setTimeout() {
      return 1;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    meetingBridge: {
      async createMeetingShareLink(input) {
        bridgeCalls.createShare.push(cloneValue(input));
        if (options.createShareError) {
          throw buildContextError(context, options.createShareError);
        }
        return cloneValue(options.createShareResult || {
          shareUrl: `https://share.example/${String(input.meetingId || "").trim()}`,
          share: {
            active: true,
            createdAt: "2026-04-11T10:10:00.000Z",
            createdBy: { providerUserKey: "fixture-user" },
            revokedAt: "",
            shareId: "share-new",
            status: "active",
          },
        });
      },
      async openMeetingResult(input) {
        bridgeCalls.openResult.push(cloneValue(input));
        if (options.openResultError) {
          throw buildContextError(context, options.openResultError);
        }
        return { opened: true, url: "https://meeting.example/result" };
      },
      async openMeetingWorkspace(input) {
        bridgeCalls.openWorkspace.push(cloneValue(input));
        if (options.openWorkspaceError) {
          throw buildContextError(context, options.openWorkspaceError);
        }
        return { opened: true, url: "https://meeting.example/workspace" };
      },
      async revokeMeetingShareLink(input) {
        bridgeCalls.revokeShare.push(cloneValue(input));
        if (options.revokeShareError) {
          throw buildContextError(context, options.revokeShareError);
        }
        return {
          share: {
            active: false,
            createdAt: "",
            createdBy: {},
            revokedAt: "2026-04-11T10:20:00.000Z",
            shareId: "",
            status: "revoked",
          },
        };
      },
    },
    meetingManager: {
      mergeMeetingHub(input) {
        return {
          items: Array.isArray(input?.items) ? input.items : [],
          ...(input && typeof input === "object" ? cloneValue(input) : {}),
        };
      },
    },
    panelDebug: {
      isEnabled() {
        return false;
      },
      log(event, payload) {
        logEvents.push({ event, payload: cloneValue(payload) });
      },
    },
    providerIdentity: {
      getCurrent() {
        return {
          available: true,
          providerUserKey: "fixture-user",
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };

  loadScript("content/panel-meeting-controller.js", context);

  const state = {
    meetingHub: {
      items: [
        {
          meetingId: "meeting-alpha",
          share: cloneValue(options.initialShare || {
            active: false,
            createdAt: "",
            createdBy: {},
            revokedAt: "",
            shareId: "",
            status: "",
          }),
          title: "Alpha",
        },
      ],
    },
    meetingUi: {
      feedback: null,
      feedbackTimer: 0,
      pending: { action: "", jobId: "", meetingId: "", startedAt: 0, title: "" },
    },
    sessionTitle: "Fixture Session",
  };

  const controller = context.InovaBookmarks.panelMeetingController.create(state, {
    meetingManager: {
      scheduleSync(delay) {
        scheduleSyncCalls.push(delay);
      },
    },
    providerIdentitySync: {
      async syncToStorage(reason, identity) {
        syncReasons.push({ identity: cloneValue(identity), reason });
        return true;
      },
    },
    render() {},
  });

  return {
    bridgeCalls,
    clipboardWrites,
    controller,
    logEvents,
    scheduleSyncCalls,
    state,
    syncReasons,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function buildContextError(context, message) {
  return vm.runInContext(`new Error(${JSON.stringify(String(message || ""))})`, context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-panel-meeting-controller] ${error.stack || error.message}`);
  process.exit(1);
});
