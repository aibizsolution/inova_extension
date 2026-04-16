#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { verifyHostedMeetingFirestoreClientContract } = require("./verify-meeting-firestore-client");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyHostedMeetingFirestoreClientContract();
  await verifyHostedMeetingHubOwnership();
  await verifyHostedMeetingHubShareCopyFailure();
  await verifyHostedMeetingHubLifecycleRefreshOwnership();
  await verifyHostedMeetingHubActivityRefreshOwnership();
  await verifyHostedMeetingHubDoesNotPrefetchWhileClosed();
  await verifyHostedMeetingHubIgnoresWindowFocusWhileActive();
  await verifyHostedMeetingHubKeepsRealtimeCountLocal();
  verifyHostedMeetingHubDropsSummaryEchoContract();
  console.log("[verify-meeting-hub-controller] Hosted meeting hub controller contract passed");
}

async function verifyHostedMeetingHubOwnership() {
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

  let viewState = controller.buildViewState();
  assert.equal(viewState.items.length, 1, "hosted meeting hub should load meeting items directly");
  assert.equal(viewState.items[0].meetingId, "meeting-alpha");
  assert.equal(viewState.feedback, null, "hosted meeting hub should not expose legacy inline feedback after load");

  const shareHandled = await controller.handleMeetingAction("share", {
    meetingId: "meeting-alpha",
    jobId: "job-alpha",
    title: "Alpha",
  });
  assert.equal(shareHandled, true, "hosted meeting hub should fully handle share actions");
  viewState = controller.buildViewState();
  assert.equal(viewState.items[0].share.active, true, "hosted meeting hub should patch local share state after create");
  assert.equal(viewState.feedback, null, "hosted meeting hub should keep short action feedback out of inline state");
  assert.deepEqual(harness.toastCalls.at(-1), {
    contextId: "meeting-alpha",
    message: "공유 링크를 복사했습니다.",
    source: "meeting",
    tone: "success",
    ttlMs: 2200,
  });
  assert.deepEqual(harness.pageCalls[0], {
    action: "clipboard.write-text",
    text: "https://share.example/meeting-alpha",
  });

  const openHandled = await controller.handleMeetingAction("open-result", {
    meetingId: "meeting-alpha",
    jobId: "job-alpha",
    title: "Alpha",
  });
  assert.equal(openHandled, true, "hosted meeting hub should fully handle open-result actions");
  viewState = controller.buildViewState();
  assert.equal(viewState.feedback, null, "hosted meeting hub should not duplicate launch feedback inline");
  assert.deepEqual(harness.toastCalls.at(-1), {
    contextId: "meeting-alpha",
    message: "결과 탭을 열었습니다.",
    source: "meeting",
    tone: "success",
    ttlMs: 1800,
  });
  assert.equal(viewState.pending?.active, false, "hosted meeting hub should clear pending state after launch");

  assert(
    harness.runtimeCalls.some((request) => request.action === "meeting.share.create"),
    "hosted meeting hub should call runtime share actions directly"
  );
  assert(
    harness.runtimeCalls.some((request) => request.action === "meeting.result.open"),
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

  const handled = await controller.handleMeetingAction("share", {
    meetingId: "meeting-alpha",
    jobId: "job-alpha",
    title: "Alpha",
  });

  assert.equal(handled, true, "hosted meeting hub should still finish share actions when clipboard copy fails");
  const viewState = controller.buildViewState();
  assert.equal(viewState.items[0].share.active, true, "share state should stay active even when auto-copy fails");
  assert.equal(viewState.feedback, null, "hosted meeting hub should not surface short copy failures inline");
  assert.deepEqual(harness.toastCalls.at(-1), {
    contextId: "meeting-alpha",
    message: "공유 링크는 만들었지만 자동 복사는 실패했어요.",
    source: "meeting",
    tone: "error",
    ttlMs: 3600,
  });
  assert.deepEqual(harness.pageCalls[0], {
    action: "clipboard.write-text",
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

  assert.equal(harness.realtimeSubscribeCalls.length, 1);

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
  assert(
    harness.realtimeDisconnectCalls.includes("panel-inactive"),
    "hosted meeting hub should detach its Firestore subscription when the meeting tool is no longer active"
  );

  const subscribeCountBeforeMeetingReenter = harness.realtimeSubscribeCalls.length;

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
    harness.realtimeSubscribeCalls.length,
    subscribeCountBeforeMeetingReenter + 1,
    "hosted meeting hub should re-ensure its Firestore subscription when the meeting tool becomes active again"
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

  const subscribeCountBeforeReopen = harness.realtimeSubscribeCalls.length;

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
    harness.realtimeSubscribeCalls.length,
    subscribeCountBeforeReopen + 1,
    "hosted meeting hub should re-ensure its Firestore subscription when the meeting panel reopens"
  );
}

async function verifyHostedMeetingHubActivityRefreshOwnership() {
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

  const subscribeCountBeforeVisible = harness.realtimeSubscribeCalls.length;
  const visibleHandled = controller.handleHostActivity("visibility-visible");
  await flushAsyncTurns();
  assert.equal(visibleHandled, true, "hosted meeting hub should handle visible recovery itself");
  assert.equal(
    harness.realtimeSubscribeCalls.length,
    subscribeCountBeforeVisible + 1,
    "hosted meeting hub should re-ensure its Firestore subscription when the hosted document becomes visible again"
  );

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

  const focusHandled = controller.handleHostActivity("window-focus");
  await flushAsyncTurns();
  assert.equal(focusHandled, false, "hosted meeting hub should ignore focus refresh when meeting is not active");
}

async function verifyHostedMeetingHubDoesNotPrefetchWhileClosed() {
  const harness = createHarness();
  const controller = harness.controller;

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

  assert.equal(
    harness.realtimeSubscribeCalls.length,
    0,
    "hosted meeting hub should not prefetch meeting data while the meeting panel is still closed"
  );

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
    harness.realtimeSubscribeCalls.length,
    1,
    "hosted meeting hub should subscribe once when the closed meeting panel actually opens"
  );
}

async function verifyHostedMeetingHubIgnoresWindowFocusWhileActive() {
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

  const subscribeCountBeforeFocus = harness.realtimeSubscribeCalls.length;
  const focusHandled = controller.handleHostActivity("window-focus");
  await flushAsyncTurns();

  assert.equal(
    focusHandled,
    false,
    "hosted meeting hub should ignore raw window-focus activity because iframe focus changes are not a reliable stale-data signal"
  );
  assert.equal(
    harness.realtimeSubscribeCalls.length,
    subscribeCountBeforeFocus,
    "hosted meeting hub should not re-subscribe when only a raw window-focus event fires"
  );
}

async function verifyHostedMeetingHubKeepsRealtimeCountLocal() {
  const runtimeCalls = [];
  const realtimeSubscribeCalls = [];
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

  loadScript("hosting/extension-v2/panel/panel-utils.js", context);
  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/meeting-hub-controller.js", context);

  const controller = context.InovaBookmarks.meetingHubController.create({
    invokePage: async () => ({ copied: true }),
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      if (request?.action === "storage.read-panel-state") {
        return {
          providerIdentityCache: {
            providerIdentity: {
              available: true,
              provider: "inova",
              providerUserKey: "fixture-user",
            },
          },
          settings: {
            meetingWorkspaceTarget: "production",
          },
        };
      }
      throw new Error(`Unexpected runtime action: ${request?.action}`);
    },
    meetingRealtime: {
      disconnect() {},
      async ensureSubscribed(request) {
        realtimeSubscribeCalls.push(cloneValue(request));
        return buildRealtimeSnapshot();
      },
    },
    scheduleRender() {},
    traceMeeting() {},
  });

  controller.syncPanelState(
    {
      activeTool: "meeting",
      meetingTool: {
        count: 1,
        snapshotFingerprint: "meeting-alpha|1|seed",
      },
      open: true,
      settings: {
        meetingWorkspaceTarget: "production",
      },
    },
    ["runtime.invoke.v1"]
  );
  assert.equal(
    controller.buildViewState().count,
    0,
    "hosted meeting hub should keep meeting count empty until realtime data arrives instead of borrowing the top-panel summary echo during bootstrap"
  );
  await flushAsyncTurns();

  assert.equal(
    realtimeSubscribeCalls.length,
    1,
    "hosted meeting hub should subscribe once while loading local realtime data"
  );
  assert.equal(
    controller.buildViewState().count,
    1,
    "hosted meeting hub should keep hosted realtime count as the source of truth instead of reusing top-panel snapshot counts"
  );
}

function verifyHostedMeetingHubDropsSummaryEchoContract() {
  const controllerSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "meeting-hub-controller.js"),
    "utf8"
  );
  assert(
    !controllerSource.includes("syncTopPanelSummary")
      && !controllerSource.includes("emitTopPanelSummary")
      && !controllerSource.includes("buildTopPanelSummary"),
    "hosted meeting hub should not echo hosted-owned counts through the top panel"
  );
}

async function flushAsyncTurns(turns = 20) {
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
  const realtimeDisconnectCalls = [];
  const realtimeSubscribeCalls = [];
  const pageCalls = [];
  const toastCalls = [];
  const checkedAtSequence = Array.isArray(options.checkedAtSequence) && options.checkedAtSequence.length
    ? options.checkedAtSequence.slice()
    : null;
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

  loadScript("hosting/extension-v2/panel/panel-utils.js", context);
  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/meeting-hub-controller.js", context);

  const controller = context.InovaBookmarks.meetingHubController.create({
    invokePage: async (request) => {
      pageCalls.push(cloneValue(request));
      if (request?.action === "clipboard.write-text") {
        return cloneValue(options.pageCopyResult || { copied: true });
      }
      throw new Error(`Unexpected page action: ${request?.action}`);
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      if (request?.action === "storage.read-panel-state") {
        return {
          providerIdentityCache: {
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
      if (request?.action === "meeting.share.create") {
        return {
          share: {
            active: true,
            shareId: "share-alpha",
            status: "active",
          },
          shareUrl: "https://share.example/meeting-alpha",
        };
      }
      if (request?.action === "meeting.share.revoke") {
        return {
          share: {
            active: false,
            shareId: "",
            status: "revoked",
          },
        };
      }
      if (request?.action === "meeting.result.open") {
        return {
          opened: true,
          url: "https://meeting.example/result",
        };
      }
      throw new Error(`Unexpected runtime action: ${request?.action}`);
    },
    meetingRealtime: {
      disconnect(reason) {
        realtimeDisconnectCalls.push(String(reason || ""));
      },
      async ensureSubscribed(request) {
        realtimeSubscribeCalls.push(cloneValue(request));
        const nextCheckedAt = checkedAtSequence?.length
          ? checkedAtSequence.shift()
          : "2026-04-13T01:02:03.000Z";
        return buildRealtimeSnapshot({
          checkedAt: nextCheckedAt,
          fromCache: Boolean(options.firstSnapshotFromCache),
        });
      },
    },
    publishToast(payload) {
      toastCalls.push(cloneValue(payload));
      return true;
    },
    scheduleRender() {},
    traceMeeting() {},
  });

  return {
    controller,
    pageCalls,
    realtimeDisconnectCalls,
    realtimeSubscribeCalls,
    runtimeCalls,
    toastCalls,
  };
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildRealtimeSnapshot(overrides = {}) {
  return {
    checkedAt: "2026-04-13T01:02:03.000Z",
    fromCache: false,
    hasPendingWrites: false,
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
    ...cloneValue(overrides),
  };
}

main().catch((error) => {
  console.error(`[verify-meeting-hub-controller] ${error.stack || error.message}`);
  process.exit(1);
});
