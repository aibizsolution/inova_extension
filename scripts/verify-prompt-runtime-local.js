#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyPromptRuntimeResolution();
  verifyPromptLocalWiring();
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
  assert(promptRuntime.hosting.promptPanelBridgeUrl.startsWith("http://127.0.0.1:5000/extension/prompt-panel-bridge.html"));
  assert.equal(promptRuntime.emulators.enabled, true);
  assert.equal(promptRuntime.emulators.firestoreHost, "127.0.0.1");
  assert.equal(promptRuntime.emulators.functionsPort, 5001);
  assert.equal(meetingRuntime.hosting.meetingWorkspaceUrl, "http://127.0.0.1:5000/meeting/index.html");
  assert.equal(meetingRuntime.functions.baseUrl, promptRuntime.functions.baseUrl);
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
    path.join("content", "features", "prompt-store", "prompt-realtime-manager.js"),
    /namespace\.firebaseConfig\?\.prompt\?\.resolveRuntime\?\.\(state\.settings\)/,
    "prompt realtime manager가 state.settings 기준 runtime을 계산해야 합니다."
  );
  assertPattern(
    path.join("content", "features", "prompt-store", "prompt-realtime-manager.js"),
    /runtimeConfig\?\.hosting\?\.promptPanelBridgeUrl/,
    "prompt realtime manager가 runtime bridge URL을 써야 합니다."
  );
  assertPattern(
    path.join("content", "features", "prompt-store", "prompt-realtime-manager.js"),
    /runtimeConfig\?\.hosting\?\.originUrl/,
    "prompt realtime manager가 runtime bridge origin을 써야 합니다."
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

function loadFirebaseConfig() {
  const context = vm.createContext({
    chrome: {
      runtime: {
        getManifest() {
          return { version: "0.4.4" };
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
        return "legacy";
      },
      getLaneConfig() {
        return {
          functions: {
            baseUrl: "https://asia-northeast3-browser-extension-main.cloudfunctions.net",
            endpointOverrides: {},
          },
          hosting: {
            baseUrl: "https://browser-extension-main.web.app/extension",
            originUrl: "https://browser-extension-main.web.app",
          },
          id: "legacy",
          prompt: {
            firestoreCollections: {
              accountsCollection: "integration_inova_accounts",
              storeDetailCollection: "prompt_store_entry_details",
              storeFeedCollection: "prompt_store_feed_pages",
              storeSummaryCollection: "prompt_store_meta",
            },
            panelScope: "prompt-panel",
          },
          storagePrefix: "",
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`[verify-prompt-runtime-local] ${error.stack || error.message}`);
  process.exitCode = 1;
});
