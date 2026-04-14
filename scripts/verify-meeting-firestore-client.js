const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

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

  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
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
        expiresAt: futureExpiryIso,
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
  assert.equal(runtimeCalls[0].action, "auth.issue-panel-session");
  assert.equal(runtimeCalls[0].panel, "meeting");
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
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "meeting-firestore-client.js"), "utf8")
      .includes("runWithSuppressedFirestorePersistenceWarning"),
    "meeting firestore client should suppress the deprecated Firestore persistence warning in the hosted console"
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
              panelExpMs: Date.parse(panelExpiryIso) || Date.now() + 10 * 60 * 1000,
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

module.exports = {
  verifyHostedMeetingFirestoreClientContract,
};
