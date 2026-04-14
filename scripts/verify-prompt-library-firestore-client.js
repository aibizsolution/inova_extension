const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function verifyHostedPromptLibraryFirestoreClientContract() {
  const futureExpiryIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const hostedPromptSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-library-controller.js"),
    "utf8"
  );
  const hostedPromptIndexHtml = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.html"),
    "utf8"
  );
  const runtimeRouterSource = fs.readFileSync(
    path.join(root, "background", "panel-runtime-capability-router.js"),
    "utf8"
  );

  assert(
    hostedPromptIndexHtml.includes("./prompt-library-firestore-client.js"),
    "v2 hosted panel should load the dedicated prompt library firestore client module"
  );
  assert(
    hostedPromptSource.includes("namespace.promptLibraryFirestoreClient?.create"),
    "v2 hosted prompt library should create its own firestore reader"
  );
  assert(
    !hostedPromptSource.includes('endpointKey: "loadInovaPromptLibraryUrl"'),
    "v2 hosted prompt library should not keep using Functions prompt-library loads"
  );
  assert(
    runtimeRouterSource.includes("enrichPromptPanelAuth"),
    "hosted prompt panel auth should be enriched with runtime firestore config"
  );

  const runtimeCalls = [];
  const traces = [];
  const snapshotPayloads = [];
  const queryState = {
    accountOnSnapshot: null,
    collectionNames: [],
    emulatorAuthUrls: [],
    emulatorFirestoreHosts: [],
    orderDocs: new Map([
      ["prompt-library-fixture", { orderedIds: ["prompt-1"] }],
    ]),
    chunkDocs: new Map([
      ["prompt-library-fixture__b00", { items: [{ id: "prompt-1", title: "Prompt", content: "Body", updatedAt: "2026-04-13T01:00:00.000Z" }] }],
    ]),
    promptPanelExpiryIso: futureExpiryIso,
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
    promptLibraryModel: {
      mergePromptLibrary(promptLibrary) {
        const items = Array.isArray(promptLibrary?.items) ? promptLibrary.items.map((item) => ({ ...item })) : [];
        return {
          items,
          version: Number(promptLibrary?.version) || 1,
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };
  context.firebase = createFakeFirebase(queryState);

  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/prompt-library-firestore-client.js", context);

  const client = context.InovaBookmarks.promptLibraryFirestoreClient.create({
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
        firebaseCustomToken: "prompt-panel-token",
        promptFirestoreCollections: {
          accountsCollection: "integration_inova_accounts_v2",
          promptLibraryChunksCollection: "prompt_library_chunks_v2",
          promptLibraryOrdersCollection: "prompt_library_orders_v2",
        },
        promptLibraryId: "prompt-library-fixture",
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
    settings: {
      meetingWorkspaceTarget: "production",
    },
  });

  assert.equal(runtimeCalls.length, 1, "prompt firestore client should request panel auth once for a fresh subscription");
  assert.equal(runtimeCalls[0].action, "auth.issue-panel-session");
  assert.equal(runtimeCalls[0].panel, "prompt");
  assert.deepEqual(queryState.collectionNames, [
    "integration_inova_accounts_v2",
    "prompt_library_orders_v2",
    "prompt_library_chunks_v2",
  ]);
  assert.equal(firstSnapshot.promptLibrary.items[0].id, "prompt-1");
  assert.equal(snapshotPayloads.length, 1, "prompt firestore client should forward the initial snapshot");

  const secondSnapshot = await client.ensureSubscribed({
    providerIdentity: {
      providerUserKey: "fixture-user",
    },
    settings: {
      meetingWorkspaceTarget: "production",
    },
  });

  assert.equal(runtimeCalls.length, 1, "prompt firestore client should reuse panel auth while the subscription stays active");
  assert.equal(secondSnapshot.promptLibrary.items[0].id, "prompt-1");

  queryState.orderDocs.set("prompt-library-fixture", { orderedIds: ["prompt-2"] });
  queryState.chunkDocs.set("prompt-library-fixture__b00", {
    items: [{ id: "prompt-2", title: "Prompt 2", content: "Body 2", updatedAt: "2026-04-13T01:05:00.000Z" }],
  });
  queryState.accountOnSnapshot?.(createAccountSnapshot({
    metadata: { fromCache: false, hasPendingWrites: false },
    promptLibraryId: "prompt-library-fixture",
    promptLibraryMeta: {
      bucketIds: ["b00"],
      itemCount: 1,
      lastRevision: "rev-2",
      updatedAt: "2026-04-13T01:05:00.000Z",
      version: 1,
    },
  }));
  await flushAsyncTurns();

  assert.equal(snapshotPayloads.length, 2, "prompt firestore client should forward live snapshot updates");
  assert.equal(snapshotPayloads[1].promptLibrary.items[0].id, "prompt-2");
  assert(
    traces.some((entry) => entry.step === "35.hosted.firestore.snapshot"),
    "prompt firestore client should emit firestore trace events for snapshot updates"
  );

  client.disconnect("test");
  assert.equal(queryState.unsubscribeCount, 1, "prompt firestore client should detach its account listener on disconnect");

  await verifyLocalPromptLibraryAuthSessionPolicy();
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

async function verifyLocalPromptLibraryAuthSessionPolicy() {
  const traces = [];
  const apiKey = "AIzaSyDnVS7MmQs7wWjVPihr1MNmcALxJ0a1qPM";
  const localStorage = createFakeStorage({
    [`firebase:authUser:${apiKey}:inova-hosted-panel-prompt-library`]: "{\"stale\":true}",
  });
  const sessionStorage = createFakeStorage({
    [`firebase:redirectUser:${apiKey}:inova-hosted-panel-prompt-library`]: "{\"stale\":true}",
  });
  const queryState = {
    accountOnSnapshot: null,
    collectionNames: [],
    emulatorAuthUrls: [],
    emulatorFirestoreHosts: [],
    orderDocs: new Map([
      ["prompt-library-fixture", { orderedIds: ["prompt-1"] }],
    ]),
    chunkDocs: new Map([
      ["prompt-library-fixture__b00", { items: [{ id: "prompt-1", title: "Prompt", content: "Body", updatedAt: "2026-04-13T01:00:00.000Z" }] }],
    ]),
  };
  const context = vm.createContext({
    console,
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
    globalThis: null,
    localStorage,
    sessionStorage,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    promptLibraryModel: {
      mergePromptLibrary(promptLibrary) {
        const items = Array.isArray(promptLibrary?.items) ? promptLibrary.items.map((item) => ({ ...item })) : [];
        return {
          items,
          version: Number(promptLibrary?.version) || 1,
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };
  context.firebase = createFakeFirebase(queryState);

  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/prompt-library-firestore-client.js", context);

  const client = context.InovaBookmarks.promptLibraryFirestoreClient.create({
    invokeRuntime: async () => ({
      emulators: {
        authUrl: "http://127.0.0.1:9099",
        enabled: true,
        firestoreHost: "127.0.0.1",
        firestorePort: 8080,
      },
      expiresAt: "2026-04-13T12:00:00.000Z",
      firebaseConfig: {
        apiKey,
        projectId: "browser-extension-main",
      },
      firebaseCustomToken: "prompt-panel-token",
      promptFirestoreCollections: {
        accountsCollection: "integration_inova_accounts_v2",
        promptLibraryChunksCollection: "prompt_library_chunks_v2",
        promptLibraryOrdersCollection: "prompt_library_orders_v2",
      },
      promptLibraryId: "prompt-library-fixture",
      promptPanelScope: "prompt-panel-v2",
      providerUserKey: "fixture-user",
      target: "local",
    }),
    onError: async () => {},
    onSnapshot: async () => {},
    traceFirestore(step, payload) {
      traces.push({
        payload: cloneValue(payload),
        step,
      });
    },
  });

  await client.ensureSubscribed({
    providerIdentity: {
      providerUserKey: "fixture-user",
    },
    settings: {
      meetingWorkspaceTarget: "local",
    },
  });

  assert.deepEqual(
    queryState.persistenceValues,
    ["none"],
    "local hosted prompt firestore client는 stale emulator session 복원을 피하기 위해 NONE persistence를 사용해야 합니다."
  );
  assert.equal(
    localStorage.getItem(`firebase:authUser:${apiKey}:inova-hosted-panel-prompt-library`),
    null,
    "local hosted prompt firestore client는 stale auth user cache를 먼저 지워야 합니다."
  );
  assert.equal(
    sessionStorage.getItem(`firebase:redirectUser:${apiKey}:inova-hosted-panel-prompt-library`),
    null,
    "local hosted prompt firestore client는 stale redirect auth state도 같이 지워야 합니다."
  );
  assert(
    traces.some((entry) => entry.step === "34.hosted.firestore.listen.start"),
    "local hosted prompt firestore client도 정리 후 정상 구독을 이어가야 합니다."
  );
}

function createFakeFirebase(queryState) {
  queryState.unsubscribeCount = 0;
  queryState.persistenceValues = Array.isArray(queryState.persistenceValues)
    ? queryState.persistenceValues
    : [];
  const promptPanelExpiryIso = String(queryState.promptPanelExpiryIso || "");
  const fakeAuth = {
    currentUser: null,
    async setPersistence(value) {
      queryState.persistenceValues.push(String(value || ""));
    },
    async signInWithCustomToken(token) {
      this.currentUser = {
        async getIdToken() {
          return token;
        },
        async getIdTokenResult() {
          return {
            claims: {
              promptPanelExpMs: Date.parse(promptPanelExpiryIso) || Date.now() + 10 * 60 * 1000,
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
  const fakeDb = {
    collection(name) {
      queryState.collectionNames.push(String(name || ""));
      return {
        doc(id) {
          const normalizedId = String(id || "");
          if (name === "integration_inova_accounts_v2") {
            return {
              get() {
                return Promise.resolve(createAccountSnapshot({
                  metadata: { fromCache: true, hasPendingWrites: false },
                  promptLibraryId: "prompt-library-fixture",
                  promptLibraryMeta: {
                    bucketIds: ["b00"],
                    itemCount: 1,
                    lastRevision: "rev-1",
                    updatedAt: "2026-04-13T01:00:00.000Z",
                    version: 1,
                  },
                }));
              },
              onSnapshot(_options, next) {
                queryState.accountOnSnapshot = next;
                return () => {
                  queryState.unsubscribeCount += 1;
                };
              },
            };
          }
          if (name === "prompt_library_orders_v2") {
            return {
              get() {
                return Promise.resolve(createDocSnapshot(queryState.orderDocs.get(normalizedId) || {}, {
                  fromCache: false,
                  hasPendingWrites: false,
                }));
              },
            };
          }
          return {
            get() {
              return Promise.resolve(createDocSnapshot(queryState.chunkDocs.get(normalizedId) || {}, {
                fromCache: false,
                hasPendingWrites: false,
              }));
            },
          };
        },
      };
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
    name: "inova-hosted-panel-prompt-library",
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
    initializeApp() {
      this.apps.push(fakeApp);
      return fakeApp;
    },
  };
}

function createFakeStorage(initialEntries = {}) {
  const map = new Map(Object.entries(initialEntries));
  return {
    get length() {
      return map.size;
    },
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    key(index) {
      return Array.from(map.keys())[Number(index)] ?? null;
    },
    removeItem(key) {
      map.delete(String(key));
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
  };
}

function createAccountSnapshot(data) {
  return {
    data() {
      return {
        promptLibraryId: data.promptLibraryId,
        promptLibraryMeta: cloneValue(data.promptLibraryMeta),
      };
    },
    exists: true,
    metadata: {
      fromCache: Boolean(data.metadata?.fromCache),
      hasPendingWrites: Boolean(data.metadata?.hasPendingWrites),
    },
  };
}

function createDocSnapshot(data, metadata = {}) {
  return {
    data() {
      return cloneValue(data);
    },
    metadata: {
      fromCache: Boolean(metadata.fromCache),
      hasPendingWrites: Boolean(metadata.hasPendingWrites),
    },
  };
}

module.exports = {
  verifyHostedPromptLibraryFirestoreClientContract,
};
