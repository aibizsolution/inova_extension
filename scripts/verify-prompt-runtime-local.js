#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyPromptRuntimeResolution();
  verifyPromptRuntimeResolutionForV2Lane();
  verifyPromptLocalWiring();
  await verifyLocalPromptBridgeAuthSessionPolicy();
  await verifyEmptyStoreLatestSnapshot();
  console.log("[verify-prompt-runtime-local] Prompt local runtime contract passed");
}

function verifyPromptRuntimeResolution() {
  const firebaseConfig = loadFirebaseConfig();
  const settings = {
    meetingWorkspaceTarget: "local",
    meetingWorkspaceUrlOverride: "http://127.0.0.1:5000/meeting/index.html",
  };
  const promptRuntime = firebaseConfig.prompt.resolveRuntime(settings);
  const meetingRuntime = firebaseConfig.meeting.resolveRuntime(settings);

  assert.equal(promptRuntime.target, "local");
  assert.equal(promptRuntime.functions.baseUrl, "http://127.0.0.1:5001/browser-extension-main/asia-northeast3");
  assert.equal(promptRuntime.hosting.originUrl, "http://127.0.0.1:5000");
  assert.equal(promptRuntime.hosting.panelAppUrl, "http://127.0.0.1:5000/extension/panel/index.html");
  assert(promptRuntime.hosting.promptPanelBridgeUrl.startsWith("http://127.0.0.1:5000/extension/prompt-panel-bridge.html"));
  assert.equal(promptRuntime.emulators.enabled, true);
  assert.equal(promptRuntime.emulators.firestoreHost, "127.0.0.1");
  assert.equal(promptRuntime.emulators.functionsPort, 5001);
  assert.equal(meetingRuntime.hosting.meetingWorkspaceUrl, "http://127.0.0.1:5000/meeting/index.html");
  assert.equal(meetingRuntime.functions.baseUrl, promptRuntime.functions.baseUrl);
}

function verifyPromptRuntimeResolutionForV2Lane() {
  const firebaseConfig = loadFirebaseConfig("v2");
  const settings = {
    meetingWorkspaceTarget: "local",
    meetingWorkspaceUrlOverride: "http://127.0.0.1:5000/meeting/index.html",
  };
  const promptRuntime = firebaseConfig.prompt.resolveRuntime(settings);

  assert.equal(promptRuntime.target, "local");
  assert.equal(promptRuntime.hosting.panelAppUrl, "http://127.0.0.1:5000/extension-v2/panel/index.html");
  assert(
    promptRuntime.hosting.promptPanelBridgeUrl.startsWith("http://127.0.0.1:5000/extension/prompt-panel-bridge.html"),
    "v2 local prompt runtime도 legacy prompt bridge 경로를 유지해야 합니다."
  );
}

function verifyPromptLocalWiring() {
  assertPattern(
    path.join("background", "service-worker.js"),
    /namespace\.firebaseConfig\?\.prompt\?\.resolveRuntime\?\.\(normalizedSettings\)/,
    "background가 prompt runtime resolver를 써야 합니다."
  );
  assertPattern(
    path.join("background", "service-worker.js"),
    /panelAuthCache\.issuePromptPanelAuth\(providerIdentity,\s*\{\s*functionsConfig\s*\}\)/,
    "background가 prompt panel auth에 runtime functions config를 넘겨야 합니다."
  );
  assertPattern(
    path.join("hosting", "extension", "prompt-panel-bridge.js"),
    /const LOCAL_BRIDGE_ORIGINS = new Set/,
    "prompt bridge에 local bridge origin 집합이 필요합니다."
  );
  assertPattern(
    path.join("hosting", "extension", "prompt-panel-bridge.js"),
    /configureFirebaseEmulators\(\)/,
    "prompt bridge가 emulator 구성 helper를 가져야 합니다."
  );
  assertPattern(
    path.join("hosting", "extension", "prompt-panel-bridge.js"),
    /auth\.useEmulator\(`http:\/\/\$\{emulatorHost\}:9099`\)/,
    "prompt bridge가 auth emulator를 연결해야 합니다."
  );
  assertPattern(
    path.join("hosting", "extension", "prompt-panel-bridge.js"),
    /db\.useEmulator\(emulatorHost,\s*8080\)/,
    "prompt bridge가 firestore emulator를 연결해야 합니다."
  );
}

async function verifyEmptyStoreLatestSnapshot() {
  const messageListeners = [];
  const portMessages = [];
  const subscriptions = new Map();
  const fakePort = {
    close() {},
    onmessage: null,
    postMessage(message) {
      portMessages.push(message);
    },
    start() {},
  };
  const fakeAuth = {
    Auth: null,
    currentUser: null,
    persistenceValues: [],
    async setPersistence() {},
    async signInWithCustomToken() {
      this.currentUser = {
        async getIdToken() {
          return "emulator-token";
        },
        async getIdTokenResult() {
          return {
            claims: {
              promptPanelExpMs: Date.now() + 60000,
              providerUserKey: "reviewer-1",
              scope: "prompt-panel",
            },
          };
        },
      };
    },
    useEmulator() {},
  };
  const fakeDb = {
    collection(name) {
      return {
        doc(id) {
          return {
            get: async () => createSnapshot({}),
            onSnapshot(onNext, onError) {
              subscriptions.set(`${name}/${id}`, { onError, onNext });
              return () => subscriptions.delete(`${name}/${id}`);
            },
          };
        },
      };
    },
    async enablePersistence() {},
    useEmulator() {},
  };
  const context = vm.createContext({
    Array,
    Date,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    Set,
    URL,
    clearTimeout,
    console,
    firebase: {
      auth: {
        Auth: {
          Persistence: {
            SESSION: "SESSION",
          },
        },
      },
      firestore: {
        setLogLevel() {},
      },
      initializeApp() {
        return {
          auth() {
            return fakeAuth;
          },
          firestore() {
            return fakeDb;
          },
        };
      },
    },
    globalThis: null,
    location: {
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:5000",
    },
    localStorage: createFakeStorage(),
    sessionStorage: createFakeStorage(),
    setTimeout,
  });
  context.globalThis = context;
  context.addEventListener = (type, handler) => {
    if (type === "message") {
      messageListeners.push(handler);
    }
  };

  loadScript(path.join("hosting", "extension", "prompt-panel-bridge.js"), context);
  assert.equal(messageListeners.length, 1, "prompt bridge가 message listener를 등록해야 합니다.");

  messageListeners[0]({
    data: {
      source: "inova-prompt-panel-client",
      type: "connect-port",
    },
    origin: "https://inova.incross.com",
    ports: [fakePort],
  });
  assert.equal(portMessages[0]?.type, "ready", "prompt bridge가 port 연결 직후 ready를 보내야 합니다.");

  await fakePort.onmessage({
    data: {
      payload: {
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        firebaseConfig: { projectId: "browser-extension-main" },
        firebaseCustomToken: "custom-token",
        firestoreCollections: {
          accountsCollection: "integration_inova_accounts",
          promptLibraryChunksCollection: "prompt_library_chunks",
          promptLibraryOrdersCollection: "prompt_library_orders",
          storeDetailCollection: "prompt_store_entry_details",
          storeFeedCollection: "prompt_store_feed_pages",
          storeSummaryCollection: "prompt_store_meta",
        },
        promptLibraryId: "prompt-library-1",
        promptPanelScope: "prompt-panel",
        providerUserKey: "reviewer-1",
      },
      requestId: 7,
      type: "connect",
    },
  });
  assert(portMessages.some((message) => message?.type === "connected"), "prompt bridge가 connect 후 connected를 보내야 합니다.");

  await fakePort.onmessage({
    data: {
      payload: {},
      requestId: 7,
      type: "subscribe-store-latest",
    },
  });

  const summarySubscription = subscriptions.get("prompt_store_meta/summary");
  const latestFeedSubscription = subscriptions.get("prompt_store_feed_pages/latest__all__0000");
  assert(summarySubscription?.onNext, "store summary 구독이 등록돼야 합니다.");
  assert(latestFeedSubscription?.onNext, "store latest 첫 페이지 구독이 등록돼야 합니다.");

  summarySubscription.onNext(createSnapshot({
    exists: false,
    metadata: { fromCache: false, hasPendingWrites: false },
  }));
  await delay(80);
  assert.equal(
    portMessages.filter((message) => message?.type === "store-latest").length,
    0,
    "첫 feed 페이지 응답 전에는 store-latest를 보내면 안 됩니다."
  );

  latestFeedSubscription.onNext(createSnapshot({
    data: {
      items: [],
      pageNumber: 0,
    },
    exists: false,
    metadata: { fromCache: false, hasPendingWrites: false },
  }));
  await delay(80);

  const storeLatestMessages = portMessages.filter((message) => message?.type === "store-latest");
  assert.equal(storeLatestMessages.length, 1, "빈 로컬 스토어도 store-latest 빈 스냅샷을 보내야 합니다.");
  assert.deepEqual(storeLatestMessages[0].payload.items, []);
  assert.equal(storeLatestMessages[0].payload.summary.totalPublished, 0);
}

async function verifyLocalPromptBridgeAuthSessionPolicy() {
  const messageListeners = [];
  const portMessages = [];
  const fakePort = {
    close() {},
    onmessage: null,
    postMessage(message) {
      portMessages.push(message);
    },
    start() {},
  };
  const fakeAuth = {
    Auth: null,
    currentUser: null,
    persistenceValues: [],
    async setPersistence(value) {
      this.persistenceValues.push(value);
    },
    async signInWithCustomToken() {
      this.currentUser = {
        async getIdToken() {
          return "emulator-token";
        },
        async getIdTokenResult() {
          return {
            claims: {
              promptPanelExpMs: Date.now() + 60000,
              providerUserKey: "reviewer-1",
              scope: "prompt-panel",
            },
          };
        },
      };
    },
    useEmulator() {},
  };
  const fakeDb = {
    collection() {
      return {
        doc() {
          return {
            get: async () => createSnapshot({}),
            onSnapshot() {
              return () => {};
            },
          };
        },
      };
    },
    async enablePersistence() {},
    useEmulator() {},
  };
  const apiKey = "AIzaSyDnVS7MmQs7wWjVPihr1MNmcALxJ0a1qPM";
  const localStorage = createFakeStorage({
    [`firebase:authUser:${apiKey}:prompt-panel-bridge`]: "{\"stale\":true}",
  });
  const sessionStorage = createFakeStorage({
    [`firebase:redirectUser:${apiKey}:prompt-panel-bridge`]: "{\"stale\":true}",
  });
  const context = vm.createContext({
    Array,
    Date,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    Set,
    URL,
    clearTimeout,
    console,
    firebase: {
      auth: {
        Auth: {
          Persistence: {
            NONE: "NONE",
            SESSION: "SESSION",
          },
        },
      },
      firestore: {
        setLogLevel() {},
      },
      initializeApp() {
        return {
          auth() {
            return fakeAuth;
          },
          firestore() {
            return fakeDb;
          },
        };
      },
    },
    globalThis: null,
    localStorage,
    location: {
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:5000",
      search: "",
    },
    sessionStorage,
    setTimeout,
  });
  context.globalThis = context;
  context.addEventListener = (type, handler) => {
    if (type === "message") {
      messageListeners.push(handler);
    }
  };

  loadScript(path.join("hosting", "extension", "prompt-panel-bridge.js"), context);
  assert.equal(messageListeners.length, 1, "prompt bridge가 message listener를 등록해야 합니다.");

  messageListeners[0]({
    data: {
      source: "inova-prompt-panel-client",
      type: "connect-port",
    },
    origin: "https://inova.incross.com",
    ports: [fakePort],
  });
  assert.equal(portMessages[0]?.type, "ready");

  await fakePort.onmessage({
    data: {
      payload: {
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        firebaseConfig: {
          apiKey,
          projectId: "browser-extension-main",
        },
        firebaseCustomToken: "custom-token",
        firestoreCollections: {
          accountsCollection: "integration_inova_accounts",
          promptLibraryChunksCollection: "prompt_library_chunks",
          promptLibraryOrdersCollection: "prompt_library_orders",
          storeDetailCollection: "prompt_store_entry_details",
          storeFeedCollection: "prompt_store_feed_pages",
          storeSummaryCollection: "prompt_store_meta",
        },
        promptLibraryId: "prompt-library-1",
        promptPanelScope: "prompt-panel",
        providerUserKey: "reviewer-1",
      },
      requestId: 1,
      type: "connect",
    },
  });

  assert.deepEqual(
    fakeAuth.persistenceValues,
    ["NONE"],
    "local prompt bridge auth는 emulator 재시작 뒤 stale session을 복원하지 않도록 NONE persistence를 사용해야 합니다."
  );
  assert.equal(
    localStorage.getItem(`firebase:authUser:${apiKey}:prompt-panel-bridge`),
    null,
    "local prompt bridge는 stale local auth session을 먼저 정리해야 합니다."
  );
  assert.equal(
    sessionStorage.getItem(`firebase:redirectUser:${apiKey}:prompt-panel-bridge`),
    null,
    "local prompt bridge는 stale session redirect state도 함께 정리해야 합니다."
  );
}

function loadFirebaseConfig(activeLane = "legacy") {
  const normalizedLane = activeLane === "v2" ? "v2" : "legacy";
  const context = vm.createContext({
    chrome: {
      runtime: {
        getManifest() {
          return { version: normalizedLane === "v2" ? "1.0.0" : "0.4.4" };
        },
      },
    },
    globalThis: null,
    URL,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    productLane: {
      getActiveLane() {
        return normalizedLane;
      },
      getLaneConfig() {
        const isV2Lane = normalizedLane === "v2";
        return {
          functions: {
            baseUrl: "https://asia-northeast3-browser-extension-main.cloudfunctions.net",
            endpointOverrides: isV2Lane
              ? {
                issueInovaPromptPanelAuthUrl: "issueInovaPromptPanelAuthV2",
                loadInovaPromptLibraryUrl: "loadInovaPromptLibraryV2",
                peekInovaPromptLibraryUrl: "peekInovaPromptLibraryV2",
                syncInovaPromptLibraryUrl: "syncInovaPromptLibraryV2",
              }
              : {},
          },
          hosting: {
            baseUrl: isV2Lane
              ? "https://browser-extension-v2.web.app/extension-v2"
              : "https://browser-extension-main.web.app/extension",
            originUrl: isV2Lane
              ? "https://browser-extension-v2.web.app"
              : "https://browser-extension-main.web.app",
          },
          id: normalizedLane,
          prompt: {
            firestoreCollections: {
              accountsCollection: isV2Lane ? "integration_inova_accounts_v2" : "integration_inova_accounts",
              promptLibraryChunksCollection: isV2Lane ? "prompt_library_chunks_v2" : "prompt_library_chunks",
              promptLibraryOrdersCollection: isV2Lane ? "prompt_library_orders_v2" : "prompt_library_orders",
              storeDetailCollection: "prompt_store_entry_details",
              storeFeedCollection: "prompt_store_feed_pages",
              storeSummaryCollection: "prompt_store_meta",
            },
            panelScope: isV2Lane ? "prompt-panel-v2" : "prompt-panel",
          },
          storagePrefix: isV2Lane ? "v2." : "",
          web: {
            projectId: "browser-extension-main",
          },
        };
      },
    },
  };

  loadScript(path.join("shared", "firebase-config.js"), context);
  return context.InovaBookmarks.firebaseConfig;
}

function assertPattern(relativePath, pattern, message) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert(pattern.test(source), message);
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function createSnapshot({ data = {}, exists = true, metadata = {} }) {
  return {
    data() {
      return data;
    },
    exists,
    metadata: {
      fromCache: Boolean(metadata.fromCache),
      hasPendingWrites: Boolean(metadata.hasPendingWrites),
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`[verify-prompt-runtime-local] ${error.stack || error.message}`);
  process.exitCode = 1;
});
