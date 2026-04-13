#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyHostedMeetingFirestoreClientContract();
  await verifyHostedMeetingHubOwnership();
  await verifyHostedMeetingHubShareCopyFailure();
  await verifyHostedMeetingHubLifecycleRefreshOwnership();
  await verifyHostedMeetingHubActivityRefreshOwnership();
  await verifyHostedMeetingHubDoesNotPrefetchWhileClosed();
  await verifyHostedMeetingHubIgnoresWindowFocusWhileActive();
  await verifyHostedMeetingHubFingerprintIgnoresCheckedAt();
  console.log("[verify-meeting-hub-controller] Hosted meeting hub controller contract passed");
}

async function verifyHostedMeetingFirestoreClientContract() {
  const hostedMeetingSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "meeting-hub-controller.js"),
    "utf8"
  );
  const hostedMeetingIndexHtml = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.html"),
    "utf8"
  );
  const contentPanelSource = fs.readFileSync(
    path.join(root, "content", "panel.js"),
    "utf8"
  );
  assert(
    hostedMeetingIndexHtml.includes("./meeting-firestore-client.js"),
    "v2 hosted panel should load the dedicated meeting firestore client module"
  );
  assert(
    hostedMeetingSource.includes("namespace.meetingFirestoreClient.create"),
    "v2 hosted meeting hub should create its own firestore subscription client"
  );
  assert(
    !hostedMeetingSource.includes('action: "functions.fetch"'),
    "v2 hosted meeting hub should not keep using Functions list reads for meeting room snapshots"
  );
  assert(
    contentPanelSource.includes('channel === "firestore"'),
    "top panel trace console should render firestore events with a dedicated channel style"
  );

  const runtimeCalls = [];
  const traces = [];
  const snapshotPayloads = [];
  const queryState = {
    cacheReads: [],
    collectionNames: [],
    emulatorAuthUrls: [],
    emulatorFirestoreHosts: [],
    onSnapshotHandler: null,
    unsubscribeCount: 0,
  };
  const context = vm.createContext({
    console,
    globalThis: null,
    document: {
      createElement() {
        return {
          async: false,
          onerror: null,
          onload: null,
          set src(value) {
            this._src = value;
          },
          get src() {
            return this._src || "";
          },
        };
      },
      head: {
        appendChild(node) {
          node.onload?.();
          return node;
        },
      },
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
  context.firebase = createFakeFirebase(queryState);

  loadScript("hosting/extension-v2/panel/meeting-firestore-client.js", context);

  const client = context.InovaBookmarks.meetingFirestoreClient.create({
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      return {
        emulators: {
          authUrl: "",
          enabled: false,
          firestoreHost: "",
          firestorePort: 0,
        },
        expiresAt: "2026-04-13T12:00:00.000Z",
        firebaseConfig: {
          projectId: "browser-extension-main",
        },
        firebaseCustomToken: "panel-token-alpha",
        providerUserKey: "fixture-user",
        target: "production",
      };
    },
    onError: async () => {},
    onSnapshot: async (snapshot) => {
      snapshotPayloads.push(cloneValue(snapshot));
    },
    traceFirestore(step, payload) {
      traces.push({
        payload: cloneValue(payload),
        step,
      });
    },
  });

  const firstSnapshot = await client.ensureSubscribed({
    providerIdentity: {
      providerUserKey: "fixture-user",
    },
    queryLimit: 24,
    settings: {
      meetingWorkspaceTarget: "production",
    },
  });

  assert.equal(runtimeCalls.length, 1, "meeting firestore client should request panel auth once for a fresh subscription");
  assert.equal(runtimeCalls[0].action, "auth.issue-meeting-panel");
  assert.deepEqual(queryState.collectionNames, ["integration_inova_meetings"]);
  assert.equal(firstSnapshot.fromCache, true, "meeting firestore client should return cached Firestore data first when available");
  assert.equal(firstSnapshot.items[0].meetingId, "meeting-alpha");
  assert.equal(snapshotPayloads.length, 1, "meeting firestore client should forward the initial snapshot");

  const secondSnapshot = await client.ensureSubscribed({
    providerIdentity: {
      providerUserKey: "fixture-user",
    },
    queryLimit: 24,
    settings: {
      meetingWorkspaceTarget: "production",
    },
  });

  assert.equal(runtimeCalls.length, 1, "meeting firestore client should reuse panel auth/runtime state while the subscription stays active");
  assert.equal(secondSnapshot.items[0].meetingId, "meeting-alpha");

  queryState.onSnapshotHandler?.({
    docs: [createFirestoreDoc({
      meetingId: "meeting-beta",
      share: {
        active: true,
        shareId: "share-beta",
        status: "active",
      },
      title: "Beta",
      updatedAt: "2026-04-13T01:08:00.000Z",
    })],
    metadata: {
      fromCache: false,
      hasPendingWrites: false,
    },
  });
  await flushAsyncTurns();

  assert.equal(snapshotPayloads.length, 2, "meeting firestore client should forward live snapshot updates");
  assert.equal(snapshotPayloads[1].items[0].meetingId, "meeting-beta");
  assert(
    traces.some((entry) => entry.step === "35.hosted.firestore.snapshot"),
    "meeting firestore client should emit firestore trace events for snapshot updates"
  );

  client.disconnect("test");
  assert.equal(queryState.unsubscribeCount, 1, "meeting firestore client should detach its active snapshot listener on disconnect");
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

  let viewState = controller.buildViewState({});
  assert.equal(viewState.items.length, 1, "hosted meeting hub should load meeting items directly");
  assert.equal(viewState.items[0].meetingId, "meeting-alpha");
  assert.equal(harness.summarySyncCalls.length, 1, "hosted meeting hub should sync a compact summary back to the top panel after load");
  assert.equal(harness.summarySyncCalls[0].count, 1);
  assert.equal(typeof harness.summarySyncCalls[0].snapshotFingerprint, "string");

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

async function verifyHostedMeetingHubFingerprintIgnoresCheckedAt() {
  const harness = createHarness({
    checkedAtSequence: [
      "2026-04-13T01:02:03.000Z",
      "2026-04-13T01:05:09.000Z",
    ],
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

  const initialFingerprint = harness.summarySyncCalls[0]?.snapshotFingerprint || "";
  assert(initialFingerprint, "hosted meeting hub should emit a snapshot fingerprint after the first load");

  const visibleHandled = controller.handleHostActivity("visibility-visible");
  await flushAsyncTurns();

  assert.equal(visibleHandled, true, "hosted meeting hub should accept hosted activity refresh triggers while active");
  assert.equal(harness.summarySyncCalls.length, 2, "hosted meeting hub should emit another summary after a forced refresh");
  assert.equal(
    harness.summarySyncCalls[1].snapshotFingerprint,
    initialFingerprint,
    "meeting summary fingerprints should stay stable when only checkedAt changes across identical meeting data"
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
  const summarySyncCalls = [];
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
    scheduleRender() {},
    syncTopPanelSummary: async (meetingTool) => {
      summarySyncCalls.push(cloneValue(meetingTool));
      return { handled: true };
    },
    traceMeeting() {},
  });

  return {
    controller,
    pageCalls,
    realtimeDisconnectCalls,
    realtimeSubscribeCalls,
    runtimeCalls,
    summarySyncCalls,
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

function createFakeFirebase(queryState) {
  const fakeAuth = {
    currentUser: null,
    async setPersistence() {},
    async signInWithCustomToken(token) {
      this.currentUser = {
        async getIdToken() {
          return token;
        },
        async getIdTokenResult() {
          return {
            claims: {
              panelExpMs: Date.parse("2026-04-13T12:00:00.000Z"),
              providerUserKey: "fixture-user",
              scope: "meeting-panel",
            },
          };
        },
      };
    },
    useEmulator(url) {
      queryState.emulatorAuthUrls.push(String(url || ""));
    },
  };
  const fakeQuery = {
    get(options = {}) {
      queryState.cacheReads.push(cloneValue(options));
      return Promise.resolve({
        docs: [createFirestoreDoc()],
        metadata: {
          fromCache: true,
          hasPendingWrites: false,
        },
      });
    },
    limit() {
      return this;
    },
    onSnapshot(_options, next) {
      queryState.onSnapshotHandler = next;
      return () => {
        queryState.unsubscribeCount += 1;
      };
    },
    orderBy() {
      return this;
    },
    where() {
      return this;
    },
  };
  const fakeDb = {
    collection(name) {
      queryState.collectionNames.push(String(name || ""));
      return fakeQuery;
    },
    enablePersistence() {
      return Promise.resolve();
    },
    useEmulator(host, port) {
      queryState.emulatorFirestoreHosts.push(`${host}:${port}`);
    },
  };
  const fakeApp = {
    async delete() {},
    auth() {
      return fakeAuth;
    },
    firestore() {
      return fakeDb;
    },
    name: "inova-hosted-panel-meeting",
  };
  return {
    apps: [],
    auth: {
      Auth: {
        Persistence: {
          SESSION: "session",
        },
      },
    },
    initializeApp() {
      this.apps.push(fakeApp);
      return fakeApp;
    },
  };
}

function createFirestoreDoc(overrides = {}) {
  const data = {
    artifactId: "artifact-alpha",
    createdAt: "2026-04-13T01:00:00.000Z",
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
    ...cloneValue(overrides),
  };
  return {
    data() {
      return cloneValue(data);
    },
    id: data.meetingId,
  };
}

main().catch((error) => {
  console.error(`[verify-meeting-hub-controller] ${error.stack || error.message}`);
  process.exit(1);
});
