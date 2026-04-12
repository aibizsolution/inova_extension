#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyHostedMeetingHubOwnership();
  await verifyHostedMeetingHubShareCopyFailure();
  await verifyHostedMeetingHubLifecycleRefreshOwnership();
  console.log("[verify-meeting-hub-controller] Hosted meeting hub controller contract passed");
}

async function verifyHostedMeetingHubOwnership() {
  const harness = createHarness();
  const controller = harness.controller;

  controller.syncPanelState(
    {
      activeTool: "meeting",
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  await flushAsyncTurns();

  let viewState = controller.buildViewState({});
  assert.equal(viewState.items.length, 1, "hosted meeting hub should load meeting items directly");
  assert.equal(viewState.items[0].meetingId, "meeting-alpha");

  const shareHandled = await controller.handleMeetingAction("share", {
    meetingId: "meeting-alpha",
    jobId: "job-alpha",
    title: "Alpha",
  });
  assert.equal(shareHandled, true, "hosted meeting hub should fully handle share actions");
  viewState = controller.buildViewState({});
  assert.equal(viewState.items[0].share.active, true, "hosted meeting hub should patch local share state after create");
  assert.equal(viewState.feedback?.text, "공유 링크를 복사했습니다.");
  assert.deepEqual(harness.pageCalls[0], {
    action: "copy-text",
    text: "https://share.example/meeting-alpha",
  });

  const openHandled = await controller.handleMeetingAction("open-result", {
    meetingId: "meeting-alpha",
    jobId: "job-alpha",
    title: "Alpha",
  });
  assert.equal(openHandled, true, "hosted meeting hub should fully handle open-result actions");
  viewState = controller.buildViewState({});
  assert.equal(viewState.feedback?.text, "결과 탭을 열었습니다.");
  assert.equal(viewState.pending?.active, false, "hosted meeting hub should clear pending state after launch");

  assert(
    harness.runtimeCalls.some((request) => request.action === "meeting.create-share-link"),
    "hosted meeting hub should call runtime share actions directly"
  );
  assert(
    harness.runtimeCalls.some((request) => request.action === "meeting.open-result"),
    "hosted meeting hub should call runtime open actions directly"
  );
}

async function verifyHostedMeetingHubShareCopyFailure() {
  const harness = createHarness({
    pageCopyResult: {
      copied: false,
    },
  });
  const controller = harness.controller;

  controller.syncPanelState(
    {
      activeTool: "meeting",
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  await flushAsyncTurns();

  const handled = await controller.handleMeetingAction("share", {
    meetingId: "meeting-alpha",
    jobId: "job-alpha",
    title: "Alpha",
  });

  assert.equal(handled, true, "hosted meeting hub should still finish share actions when clipboard copy fails");
  const viewState = controller.buildViewState({});
  assert.equal(viewState.items[0].share.active, true, "share state should stay active even when auto-copy fails");
  assert.equal(viewState.feedback?.text, "공유 링크는 만들었지만 자동 복사는 실패했어요.");
  assert.equal(viewState.feedback?.tone, "error");
  assert.deepEqual(harness.pageCalls[0], {
    action: "copy-text",
    text: "https://share.example/meeting-alpha",
  });
}

async function verifyHostedMeetingHubLifecycleRefreshOwnership() {
  const harness = createHarness();
  const controller = harness.controller;

  controller.syncPanelState(
    {
      activeTool: "meeting",
      open: true,
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  await flushAsyncTurns();

  assert.equal(countRuntimeCalls(harness.runtimeCalls, "functions.fetch"), 1);

  controller.syncPanelState(
    {
      activeTool: "prompts",
      open: true,
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  await flushAsyncTurns();

  const fetchCountBeforeMeetingReenter = countRuntimeCalls(harness.runtimeCalls, "functions.fetch");

  controller.syncPanelState(
    {
      activeTool: "meeting",
      open: true,
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  await flushAsyncTurns();

  assert.equal(
    countRuntimeCalls(harness.runtimeCalls, "functions.fetch"),
    fetchCountBeforeMeetingReenter + 1,
    "hosted meeting hub should reload when the meeting tool becomes active again even without a new fingerprint"
  );

  controller.syncPanelState(
    {
      activeTool: "meeting",
      open: false,
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  await flushAsyncTurns();

  const fetchCountBeforeReopen = countRuntimeCalls(harness.runtimeCalls, "functions.fetch");

  controller.syncPanelState(
    {
      activeTool: "meeting",
      open: true,
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  await flushAsyncTurns();

  assert.equal(
    countRuntimeCalls(harness.runtimeCalls, "functions.fetch"),
    fetchCountBeforeReopen + 1,
    "hosted meeting hub should reload when the panel reopens on the meeting tool even without a new fingerprint"
  );
}

async function flushAsyncTurns(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function createHarness(options = {}) {
  return createHarnessWithOptions(options);
}

function createHarnessWithOptions(options = {}) {
  const runtimeCalls = [];
  const pageCalls = [];
  const context = vm.createContext({
    clearTimeout() {},
    console,
    globalThis: null,
    setTimeout() {
      return 1;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };

  loadScript("hosting/extension-v2/panel/meeting-hub-controller.js", context);

  const controller = context.InovaBookmarks.meetingHubController.create({
    invokePage: async (request) => {
      pageCalls.push(cloneValue(request));
      if (request?.action === "copy-text") {
        return cloneValue(options.pageCopyResult || { copied: true });
      }
      throw new Error(`Unexpected page action: ${request?.action}`);
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      if (request?.action === "storage.get-state") {
        return {
          cloudSync: {
            providerIdentity: {
              available: true,
              displayName: "Fixture User",
              email: "fixture@example.com",
              numericUserId: 7,
              provider: "inova",
              providerUserKey: "fixture-user",
            },
          },
          settings: {
            meetingWorkspaceTarget: "production",
          },
        };
      }
      if (request?.action === "functions.fetch") {
        return {
          checkedAt: "2026-04-13T01:02:03.000Z",
          items: [
            {
              artifactId: "artifact-alpha",
              jobId: "job-alpha",
              meetingId: "meeting-alpha",
              share: {
                active: false,
                shareId: "",
                status: "",
              },
              status: "succeeded",
              title: "Alpha",
              updatedAt: "2026-04-13T01:01:00.000Z",
            },
          ],
          totalCount: 1,
        };
      }
      if (request?.action === "meeting.create-share-link") {
        return {
          share: {
            active: true,
            shareId: "share-alpha",
            status: "active",
          },
          shareUrl: "https://share.example/meeting-alpha",
        };
      }
      if (request?.action === "meeting.revoke-share-link") {
        return {
          share: {
            active: false,
            shareId: "",
            status: "revoked",
          },
        };
      }
      if (request?.action === "meeting.open-result") {
        return {
          opened: true,
          url: "https://meeting.example/result",
        };
      }
      throw new Error(`Unexpected runtime action: ${request?.action}`);
    },
    scheduleRender() {},
    traceMeeting() {},
  });

  return {
    controller,
    pageCalls,
    runtimeCalls,
  };
}

function countRuntimeCalls(calls, action) {
  return calls.filter((request) => request?.action === action).length;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-meeting-hub-controller] ${error.stack || error.message}`);
  process.exit(1);
});
