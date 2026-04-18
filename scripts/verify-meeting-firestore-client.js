const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const USAGE_USER_MONTH_COLLECTION = "integration_inova_meeting_usage_user_months";
const USAGE_USER_TOTAL_COLLECTION = "integration_inova_meeting_usage_user_totals";

async function verifyHostedMeetingFirestoreClientContract() {
  const futureExpiryIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const hostedMeetingSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "meeting-hub-controller.js"),
    "utf8"
  );
  const hostedMeetingIndexHtml = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.html"),
    "utf8"
  );
  const panelTraceSource = fs.readFileSync(
    path.join(root, "content", "panel-console-trace.js"),
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
    panelTraceSource.includes('channel === "firestore"'),
    "top panel trace console should render firestore events with a dedicated channel style"
  );

  const runtimeCalls = [];
  const traces = [];
  const snapshotPayloads = [];
  const queryState = {
    cacheReads: [],
    collectionNames: [],
    docRefs: [],
    emulatorAuthUrls: [],
    emulatorFirestoreHosts: [],
    onDocSnapshotHandlers: [],
    onSnapshotHandler: null,
    usageDocUnsubscribeCount: 0,
    unsubscribeCount: 0,
    usageDocs: {
      [`${USAGE_USER_MONTH_COLLECTION}/fixture-user__2026-04`]: {
        monthKey: "2026-04",
        processedCount: 23,
        processedMs: 428 * 60000,
        providerUserKey: "fixture-user",
        updatedAt: "2026-04-13T01:02:03.000Z",
      },
      [`${USAGE_USER_TOTAL_COLLECTION}/fixture-user`]: {
        processedCount: 148,
        processedMs: 3039 * 60000,
        providerUserKey: "fixture-user",
        updatedAt: "2026-04-13T01:02:03.000Z",
      },
    },
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
  queryState.panelExpiryIso = futureExpiryIso;
  context.firebase = createFakeFirebase(queryState);

  loadScript("hosting/extension-v2/panel/panel-utils.js", context);
  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/panel-firestore-session-client.js", context);
  loadScript("hosting/extension-v2/panel/base-firestore-client.js", context);
  loadScript("hosting/extension-v2/panel/meeting-firestore-client.js", context);
  loadScript("hosting/extension-v2/panel/meeting-usage-firestore-client.js", context);

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
        expiresAt: futureExpiryIso,
        firebaseConfig: {
          projectId: "browser-extension-main",
        },
        firebaseCustomToken: "panel-token-alpha",
        panelScope: "prompt-panel-v2",
        promptPanelScope: "prompt-panel-v2",
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
  assert.equal(runtimeCalls[0].action, "auth.issue-panel-session");
  assert.equal(runtimeCalls[0].panel, "hosted");
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
  assert(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "panel-firestore-session-client.js"), "utf8")
      .includes("runWithSuppressedFirestorePersistenceWarning"),
    "shared firestore session coordinator should suppress the deprecated Firestore persistence warning in the hosted console"
  );

  const usageSnapshotPayloads = [];
  const usageClient = context.InovaBookmarks.meetingUsageFirestoreClient.create({
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      return {
        emulators: {
          authUrl: "",
          enabled: false,
          firestoreHost: "",
          firestorePort: 0,
        },
        expiresAt: futureExpiryIso,
        firebaseConfig: {
          projectId: "browser-extension-main",
        },
        firebaseCustomToken: "panel-token-alpha",
        panelScope: "prompt-panel-v2",
        promptPanelScope: "prompt-panel-v2",
        providerUserKey: "fixture-user",
        target: "production",
      };
    },
    onError: async () => {},
    onSnapshot: async (snapshot) => {
      usageSnapshotPayloads.push(cloneValue(snapshot));
    },
    traceFirestore(step, payload) {
      traces.push({
        payload: cloneValue(payload),
        step,
      });
    },
  });

  const usageSnapshot = await usageClient.ensureSubscribed({
    monthKey: "2026-04",
    providerIdentity: {
      providerUserKey: "fixture-user",
    },
    settings: {
      meetingWorkspaceTarget: "production",
    },
  });

  assert.deepEqual(
    queryState.collectionNames.slice(-2),
    [USAGE_USER_MONTH_COLLECTION, USAGE_USER_TOTAL_COLLECTION],
    "meeting usage client should open only the two usage aggregate collections"
  );
  assert.deepEqual(
    queryState.docRefs,
    [
      { collectionName: USAGE_USER_MONTH_COLLECTION, id: "fixture-user__2026-04" },
      { collectionName: USAGE_USER_TOTAL_COLLECTION, id: "fixture-user" },
    ],
    "meeting usage client should subscribe to exact month and total docs"
  );
  assert.equal(usageSnapshot.month.processedMs, 428 * 60000);
  assert.equal(usageSnapshot.month.processedCount, 23);
  assert.equal(usageSnapshot.total.processedMs, 3039 * 60000);
  assert.equal(usageSnapshot.total.processedCount, 148);
  assert.equal(usageSnapshotPayloads.length >= 1, true, "meeting usage client should forward usage snapshots");
  usageClient.disconnect("test");
  assert.equal(queryState.usageDocUnsubscribeCount, 2, "meeting usage client should detach both doc listeners on disconnect");

  await verifyDisconnectCancelsInFlightMeetingFirestoreSubscription(futureExpiryIso);
}

async function flushAsyncTurns(turns = 20) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

async function verifyDisconnectCancelsInFlightMeetingFirestoreSubscription(futureExpiryIso) {
  const runtimeCalls = [];
  const traces = [];
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
  queryState.panelExpiryIso = futureExpiryIso;
  context.firebase = createFakeFirebase(queryState);

  loadScript("hosting/extension-v2/panel/panel-utils.js", context);
  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/panel-firestore-session-client.js", context);
  loadScript("hosting/extension-v2/panel/base-firestore-client.js", context);
  loadScript("hosting/extension-v2/panel/meeting-firestore-client.js", context);

  let resolveRuntimeAuth;
  const runtimeAuth = new Promise((resolve) => {
    resolveRuntimeAuth = resolve;
  });
  const client = context.InovaBookmarks.meetingFirestoreClient.create({
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      return runtimeAuth;
    },
    onError: async () => {},
    onSnapshot: async () => {},
    traceFirestore(step, payload) {
      traces.push({
        payload: cloneValue(payload),
        step,
      });
    },
  });

  const pendingSubscription = client.ensureSubscribed({
    providerIdentity: {
      providerUserKey: "fixture-user",
    },
    queryLimit: 24,
    settings: {
      meetingWorkspaceTarget: "production",
    },
  });
  await flushAsyncTurns();
  assert.equal(runtimeCalls.length, 1, "meeting firestore client should begin panel auth before opening a listener");

  client.disconnect("room-switch");
  resolveRuntimeAuth({
    emulators: {
      authUrl: "",
      enabled: false,
      firestoreHost: "",
      firestorePort: 0,
    },
    expiresAt: futureExpiryIso,
    firebaseConfig: {
      projectId: "browser-extension-main",
    },
    firebaseCustomToken: "panel-token-delayed",
    panelScope: "prompt-panel-v2",
    promptPanelScope: "prompt-panel-v2",
    providerUserKey: "fixture-user",
    target: "production",
  });

  const disconnectedSnapshot = await withTimeout(pendingSubscription, 1000);
  assert.equal(disconnectedSnapshot, null, "disconnect should settle an in-flight subscription without publishing stale data");
  assert.deepEqual(queryState.collectionNames, [], "disconnect should prevent stale in-flight subscriptions from opening Firestore listeners");
  assert.equal(queryState.unsubscribeCount, 0, "disconnect before listener creation should not leave a dangling listener");
}

async function withTimeout(promise, timeoutMs) {
  let timerId = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timerId = setTimeout(() => reject(new Error("Timed out waiting for in-flight subscription to settle")), timeoutMs);
      }),
    ]);
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createFakeFirebase(queryState) {
  const panelExpiryIso = String(queryState.panelExpiryIso || "");
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
              promptPanelExpMs: Date.parse(panelExpiryIso) || Date.now() + 10 * 60 * 1000,
              providerUserKey: "fixture-user",
              scope: "prompt-panel-v2",
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
      const collectionName = String(name || "");
      queryState.collectionNames.push(collectionName);
      if (collectionName === USAGE_USER_MONTH_COLLECTION || collectionName === USAGE_USER_TOTAL_COLLECTION) {
        return createFakeDocCollection(queryState, collectionName);
      }
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
    name: "inova-hosted-panel",
  };
  return {
    apps: [],
    auth: {
      Auth: {
        Persistence: {
          NONE: "none",
          SESSION: "session",
        },
      },
    },
    firestore: {},
    initializeApp() {
      this.apps.push(fakeApp);
      return fakeApp;
    },
  };
}

function createFakeDocCollection(queryState, collectionName) {
  return {
    doc(id) {
      const docId = String(id || "");
      queryState.docRefs.push({ collectionName, id: docId });
      return {
        id: docId,
        get(options = {}) {
          queryState.cacheReads.push({
            collectionName,
            id: docId,
            options: cloneValue(options),
          });
          return Promise.resolve(createUsageFirestoreDoc(queryState, collectionName, docId));
        },
        onSnapshot(_options, next) {
          queryState.onDocSnapshotHandlers.push({ collectionName, id: docId, next });
          next(createUsageFirestoreDoc(queryState, collectionName, docId));
          return () => {
            queryState.unsubscribeCount += 1;
            queryState.usageDocUnsubscribeCount += 1;
          };
        },
      };
    },
  };
}

function createUsageFirestoreDoc(queryState, collectionName, docId) {
  const data = queryState.usageDocs?.[`${collectionName}/${docId}`];
  return {
    data() {
      return cloneValue(data || {});
    },
    exists: Boolean(data),
    id: docId,
    metadata: {
      fromCache: true,
      hasPendingWrites: false,
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

module.exports = {
  verifyHostedMeetingFirestoreClientContract,
};
