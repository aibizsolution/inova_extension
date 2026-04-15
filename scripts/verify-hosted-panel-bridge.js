#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyPanelRuntimeResolution();
  await verifyV2PanelRuntimeResolution();
  await verifyHostedPanelBridgeContract();
  await verifySharedFirestoreSessionAuthReuse();
  verifyHostedPanelFiles("extension");
  verifyHostedPanelFiles("extension-v2");
  verifyBackgroundInvokeWiring();
  console.log("[verify-hosted-panel-bridge] Hosted panel bridge contract passed");
}

async function verifyPanelRuntimeResolution() {
  const runtimeContext = loadRuntimeContext("legacy");
  const localRuntime = await runtimeContext.functionsRuntimeConfig.getPromptRuntimeConfig({
    meetingWorkspaceTarget: "local",
    meetingWorkspaceUrlOverride: "http://127.0.0.1:5000/meeting/index.html",
  });

  assert.equal(
    runtimeContext.firebaseConfig.hosting.panelAppUrl,
    "https://browser-extension-main.web.app/extension/panel/index.html"
  );
  assert.equal(
    localRuntime.hosting.panelAppUrl,
    "http://127.0.0.1:5000/extension/panel/index.html"
  );
}

async function verifyV2PanelRuntimeResolution() {
  const runtimeContext = loadRuntimeContext("v2");
  const localRuntime = await runtimeContext.functionsRuntimeConfig.getPromptRuntimeConfig({
    meetingWorkspaceTarget: "local",
    meetingWorkspaceUrlOverride: "http://127.0.0.1:5000/meeting/index.html",
  });

  assert.equal(
    runtimeContext.firebaseConfig.hosting.panelAppUrl,
    "https://browser-extension-v2.web.app/extension-v2/panel/index.html"
  );
  assert.equal(
    localRuntime.hosting.panelAppUrl,
    "http://127.0.0.1:5000/extension-v2/panel/index.html"
  );
  assert.equal(
    runtimeContext.functionsRuntimeConfig.getDefaultFunctionsConfig().listInovaMeetingsUrl,
    "https://asia-northeast3-browser-extension-main.cloudfunctions.net/listInovaMeetings"
  );
  assert.equal(
    runtimeContext.functionsRuntimeConfig.getDefaultFunctionsConfig().issueInovaMeetingPanelAuthUrl,
    "https://asia-northeast3-browser-extension-main.cloudfunctions.net/issueInovaMeetingPanelAuth"
  );
  assert.equal(
    runtimeContext.functionsRuntimeConfig.getDefaultFunctionsConfig().loadInovaPromptLibraryUrl,
    "https://asia-northeast3-browser-extension-main.cloudfunctions.net/loadInovaPromptLibraryV2"
  );
}

async function verifyHostedPanelBridgeContract() {
  let messageListener = null;
  const postedMessages = [];
  const readyChanges = [];
  const requests = [];
  const fakeSource = {
    postMessage(message, targetOrigin) {
      postedMessages.push({ message, targetOrigin });
    },
  };
  const context = vm.createContext({
    URL,
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.addEventListener = (type, handler) => {
    if (type === "message") {
      messageListener = handler;
    }
  };
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };

  loadScript(path.join("content", "hosted-panel-bridge.js"), context);

  const bridge = context.InovaBookmarks.hostedPanelBridge.create({
    onReadyChange(change) {
      readyChanges.push(change);
    },
    async onRequest(request) {
      requests.push(request);
      return {
        handled: true,
        result: { ok: true },
      };
    },
  });

  bridge.attach();
  bridge.setAllowedOrigin("https://browser-extension-main.web.app");

  await messageListener({
    data: {
      bridgeVersion: 1,
      capabilities: ["panel.snapshot.v1"],
      requestId: "ready-1",
      source: "inova-hosted-panel-app",
      type: "ready",
    },
    origin: "https://browser-extension-main.web.app",
    source: fakeSource,
  });

  assert.equal(readyChanges.at(-1)?.ready, true, "bridge should become ready after handshake");
  assert.equal(bridge.getState().ready, true, "bridge state should report ready");

  bridge.updateSnapshot({
    panel: {
      open: true,
    },
  });

  const snapshotMessage = postedMessages.at(-1);
  assert.equal(snapshotMessage?.targetOrigin, "https://browser-extension-main.web.app");
  assert.equal(snapshotMessage?.message?.type, "snapshot");
  assert.equal(snapshotMessage?.message?.source, "inova-hosted-panel-extension");
  assert(
    snapshotMessage?.message?.capabilities?.includes("page.adapter.v2"),
    "extension bridge should advertise the v2 page adapter capability"
  );

  await messageListener({
    data: {
      bridgeVersion: 1,
      domain: "panel",
      payload: {
        action: "panel-chrome-sync",
        handleCount: 3,
        open: true,
        visible: true,
      },
      requestId: "request-1",
      source: "inova-hosted-panel-app",
      type: "request",
    },
    origin: "https://browser-extension-main.web.app",
    source: fakeSource,
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requests.length, 1, "bridge should forward hosted requests");
  assert.equal(requests[0].domain, "panel");

  const responseMessage = postedMessages.filter((entry) => entry?.message?.type === "response").at(-1);
  assert.equal(responseMessage?.message?.type, "response");
  assert.equal(responseMessage?.message?.payload?.handled, true);
  assert.deepEqual(responseMessage?.message?.payload?.result, { ok: true });
}

async function verifySharedFirestoreSessionAuthReuse() {
  const runtimeCalls = [];
  const traces = [];
  const queryState = {
    authEmulatorConfigureCount: 0,
    firestoreEmulatorConfigureCount: 0,
    signInCount: 0,
  };
  const futureExpiryIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
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
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };
  context.firebase = createSharedSessionFakeFirebase(queryState, futureExpiryIso);

  loadScript(path.join("hosting", "extension-v2", "panel", "panel-utils.js"), context);
  loadScript(path.join("hosting", "extension-v2", "panel", "extension-capability-client.js"), context);
  loadScript(path.join("hosting", "extension-v2", "panel", "panel-firestore-session-client.js"), context);

  const browserCapabilities = context.InovaBookmarks.extensionCapabilityClient.create({
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      return {
        emulators: {
          authUrl: "http://127.0.0.1:9099",
          enabled: true,
          firestoreHost: "127.0.0.1",
          firestorePort: 8080,
        },
        expiresAt: futureExpiryIso,
        firebaseConfig: {
          apiKey: "fixture-api-key",
          projectId: "browser-extension-main",
        },
        firebaseCustomToken: "hosted-panel-token",
        panelScope: "prompt-panel-v2",
        promptFirestoreCollections: {
          accountsCollection: "integration_inova_accounts_v2",
          promptLibraryChunksCollection: "prompt_library_chunks_v2",
          promptLibraryOrdersCollection: "prompt_library_orders_v2",
          storeEntriesCollection: "prompt_store_entries",
        },
        promptLibraryId: "v2__inova__fixture-user",
        promptPanelScope: "prompt-panel-v2",
        providerUserKey: "fixture-user",
        target: "local",
      };
    },
  });
  const providerIdentity = {
    providerUserKey: "fixture-user",
  };

  await context.InovaBookmarks.panelFirestoreSessionClient.ensureSession({
    browserCapabilities,
    panel: "meeting",
    providerIdentity,
    purpose: "meeting",
    settings: {
      meetingWorkspaceTarget: "local",
    },
    traceFirestore(step, payload) {
      traces.push({ payload: cloneValue(payload), step });
    },
  });
  await context.InovaBookmarks.panelFirestoreSessionClient.ensureSession({
    browserCapabilities,
    panel: "prompt",
    providerIdentity,
    purpose: "prompt-library",
    settings: {
      meetingWorkspaceTarget: "local",
    },
    traceFirestore(step, payload) {
      traces.push({ payload: cloneValue(payload), step });
    },
  });

  assert.equal(runtimeCalls.length, 1, "shared Firestore session should issue hosted panel auth once across meeting and prompt readers");
  assert.equal(runtimeCalls[0].panel, "hosted", "shared Firestore session should request the canonical hosted panel auth scope");
  assert.equal(queryState.signInCount, 1, "shared Firestore session should sign in Firebase Auth once across meeting and prompt readers");
  assert.equal(queryState.authEmulatorConfigureCount, 1, "shared Firestore session should configure Auth emulator once before cross-feature reuse");
  assert.equal(queryState.firestoreEmulatorConfigureCount, 1, "shared Firestore session should configure Firestore emulator once before cross-feature reuse");
  assert(
    traces.some((entry) => entry.step === "34.hosted.firestore.auth.reuse" && entry.payload?.reader === "prompt-library"),
    "shared Firestore session should reuse the first Firebase auth session for the next feature reader"
  );
}

function createSharedSessionFakeFirebase(queryState, expiresAt) {
  const fakeAuth = {
    currentUser: null,
    async setPersistence() {},
    async signInWithCustomToken(token) {
      queryState.signInCount += 1;
      this.currentUser = {
        async getIdToken() {
          return token;
        },
        async getIdTokenResult() {
          return {
            claims: {
              promptPanelExpMs: Date.parse(expiresAt) || Date.now() + 10 * 60 * 1000,
              providerUserKey: "fixture-user",
              scope: "prompt-panel-v2",
            },
          };
        },
      };
    },
    useEmulator() {
      if (queryState.signInCount > 0) {
        throw new Error("Auth emulator must be configured before sign-in");
      }
      queryState.authEmulatorConfigureCount += 1;
    },
  };
  const fakeDb = {
    enablePersistence() {
      return Promise.resolve();
    },
    useEmulator() {
      queryState.firestoreEmulatorConfigureCount += 1;
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

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function verifyHostedPanelFiles(directoryName) {
  const baseDir = path.join(root, "hosting", directoryName, "panel");
  const html = fs.readFileSync(
    path.join(baseDir, "index.html"),
    "utf8"
  );
  const indexJs = fs.readFileSync(
    path.join(baseDir, "index.js"),
    "utf8"
  );
  const panelFiles = directoryName === "extension-v2"
    ? fs.readdirSync(baseDir)
      .filter((fileName) => fileName.endsWith("-firestore-client.js"))
      .map((fileName) => ({
        fileName,
        source: fs.readFileSync(path.join(baseDir, fileName), "utf8"),
      }))
    : [];
  const sharedFirestoreSessionJs = directoryName === "extension-v2"
    ? fs.readFileSync(path.join(baseDir, "panel-firestore-session-client.js"), "utf8")
    : "";
  const baseFirestoreClientJs = directoryName === "extension-v2"
    ? fs.readFileSync(path.join(baseDir, "base-firestore-client.js"), "utf8")
    : "";
  const promptStoreControllerJs = directoryName === "extension-v2"
    ? fs.readFileSync(path.join(baseDir, "prompt-store-controller.js"), "utf8")
    : "";

  assert(html.includes("./runtime.js"), "hosted panel should load runtime bootstrap");
  if (directoryName === "extension-v2") {
    assert(html.includes("./panel-utils.js"), "v2 hosted panel should load shared panel utilities");
    assert(html.includes("./base-firestore-client.js"), "v2 hosted panel should load the shared Firestore reader lifecycle factory");
    assert(html.includes("./extension-capability-client.js"), "v2 hosted panel should load the hosted extension capability client");
    assert(
      html.indexOf("./panel-utils.js") > html.indexOf("./runtime.js")
        && html.indexOf("./panel-utils.js") < html.indexOf("./panel-firestore-session-client.js")
        && html.indexOf("./panel-firestore-session-client.js") > html.indexOf("./extension-capability-client.js")
        && html.indexOf("./base-firestore-client.js") > html.indexOf("./panel-firestore-session-client.js")
        && html.indexOf("./base-firestore-client.js") < html.indexOf("./prompt-library-firestore-client.js")
        && html.indexOf("./base-firestore-client.js") < html.indexOf("./meeting-firestore-client.js")
        && html.indexOf("./base-firestore-client.js") < html.indexOf("./prompt-store-firestore-client.js"),
      "v2 hosted panel should load panel utilities, the shared Firestore session coordinator, and the base reader factory before feature Firestore clients"
    );
    assert(html.includes("./prompt-tool-panel.js"), "v2 hosted panel should load prompt tool interaction helpers");
  } else {
    assert(html.includes("./prompt-hub-panel.js"), "legacy hosted panel should keep the prompt hub interaction helper");
  }
  if (directoryName === "extension-v2") {
    assert(!html.includes("./legacy-panel.css"), "v2 hosted panel should not load the dead legacy panel shell stylesheet");
    assert(!html.includes("./legacy-tools.css"), "v2 hosted panel should not load the dead legacy tools stylesheet");
    assert(html.includes("./conversation-controller.js"), "v2 hosted panel should load conversation controller");
    assert(html.includes("./panel-firestore-session-client.js"), "v2 hosted panel should load the shared Firestore session coordinator");
    assert(html.includes("./prompt-library-model.js"), "v2 hosted panel should load prompt library model");
    assert(html.includes("./prompt-library-controller.js"), "v2 hosted panel should load prompt library controller");
    assert(html.includes("./prompt-store-model.js"), "v2 hosted panel should load prompt store model");
    assert(html.includes("./prompt-store-firestore-client.js"), "v2 hosted panel should load prompt store Firestore client");
    assert(html.includes("./prompt-tool-view.js"), "v2 hosted panel should load prompt tool view");
    assert(!html.includes("./prompt-hub-view.js"), "v2 hosted panel should not load the dead promptHubView fallback");
    assert(html.includes("./prompt-review-controller.js"), "v2 hosted panel should load prompt review controller");
    assert(html.includes("./prompt-store-controller.js"), "v2 hosted panel should load prompt store controller");
    assert(html.includes("./meeting-hub-controller.js"), "v2 hosted panel should load meeting hub controller");
    assert(html.includes("./release-controller.js"), "v2 hosted panel should load release controller");
    assert(indexJs.includes("conversationController"), "v2 hosted panel should wire hosted conversation ownership");
    assert(indexJs.includes("promptLibraryController"), "v2 hosted panel should wire hosted prompt library ownership");
    assert(indexJs.includes("promptReviewController"), "v2 hosted panel should wire hosted prompt review ownership");
    assert(indexJs.includes("promptStoreController"), "v2 hosted panel should wire hosted prompt store ownership");
    assert(indexJs.includes("meetingHubController"), "v2 hosted panel should wire hosted meeting ownership");
    assert(indexJs.includes("releaseController"), "v2 hosted panel should wire hosted release ownership");
    assert(indexJs.includes("const browserCapabilities = namespace.extensionCapabilityClient?.create?.({"), "v2 hosted panel should create a shared browser capability client");
    assert(sharedFirestoreSessionJs.includes("firebase.initializeApp"), "shared Firestore session coordinator should own Firebase app creation");
    assert(sharedFirestoreSessionJs.includes("signInWithCustomToken"), "shared Firestore session coordinator should own Firebase auth sign-in");
    assert(sharedFirestoreSessionJs.includes("namespace.panelUtils"), "shared Firestore session coordinator should reuse hosted panel utilities");
    assert(sharedFirestoreSessionJs.includes('const AUTH_PANEL = "hosted"'), "shared Firestore session coordinator should request one hosted panel auth scope");
    assert(sharedFirestoreSessionJs.includes('const HOSTED_APP_NAME = "inova-hosted-panel"'), "shared Firestore session coordinator should reserve one hosted app name");
    assert(sharedFirestoreSessionJs.includes("issuePanelSession(AUTH_PANEL"), "shared Firestore session coordinator should own hosted panel auth issuing");
    assert(baseFirestoreClientJs.includes("panelFirestoreSessionClient.ensureSession"), "base Firestore reader factory should consume the shared Firestore session coordinator");
    assert(baseFirestoreClientJs.includes("namespace.panelUtils"), "base Firestore reader factory should reuse hosted panel utilities");
    assert(baseFirestoreClientJs.includes("loadCachedSnapshot"), "base Firestore reader factory should own cached snapshot loading");
    assert(baseFirestoreClientJs.includes("publishSnapshot"), "base Firestore reader factory should own snapshot de-duplication and publishing");
    assert(
      fs.readFileSync(path.join(root, "background", "panel-runtime-capability-router.js"), "utf8")
        .includes('if (panel === "hosted")'),
      "background runtime should support the shared hosted panel auth scope"
    );
    assert(
      fs.readFileSync(path.join(root, "firestore.rules"), "utf8")
        .includes("function isHostedPanelSessionActive()"),
      "Firestore rules should explicitly define the shared hosted panel read session"
    );
    panelFiles
      .filter((entry) => !["panel-firestore-session-client.js", "base-firestore-client.js"].includes(entry.fileName))
      .forEach((entry) => {
        assert(
          entry.source.includes("baseFirestoreClient?.createBaseFirestoreClient"),
          `${entry.fileName} should use the shared Firestore reader lifecycle factory`
        );
        assert(
          entry.source.includes("namespace.panelUtils"),
          `${entry.fileName} should reuse hosted panel utilities`
        );
        [
          "app: null",
          "auth: null",
          "db: null",
          "firebase.initializeApp",
          "signInWithCustomToken",
          "SDK_SOURCES",
          "FIREBASE_VERSION",
          "auth.issue-panel-session",
          "persistencePromise",
          "runtimeKey",
          "sdkPromise",
        ].forEach((forbiddenPattern) => assert(
          !entry.source.includes(forbiddenPattern),
          `${entry.fileName} should not recreate Firestore SDK/auth/session ownership`
        ));
      });
    assert(!promptStoreControllerJs.includes('endpointKey: "listPromptStoreEntriesUrl"'), "v2 hosted store list should use Firestore subscription instead of the list Function");
    assert(promptStoreControllerJs.includes("storeFirestoreClient.ensureSubscribed"), "v2 hosted store controller should subscribe through the Firestore client");
  }
  assert(
    indexJs.includes("확장 업데이트 필요"),
    "hosted panel should show an explicit update-needed state"
  );
}

function verifyBackgroundInvokeWiring() {
  const serviceWorkerSource = fs.readFileSync(
    path.join(root, "background", "service-worker.js"),
    "utf8"
  );
  const routerSource = fs.readFileSync(
    path.join(root, "background", "panel-runtime-capability-router.js"),
    "utf8"
  );
  const invokeSource = fs.readFileSync(
    path.join(root, "background", "panel-runtime-invoke.js"),
    "utf8"
  );

  assert(serviceWorkerSource.includes("inova-panel:invoke"), "background should expose hosted panel invoke route");
  assert(
    serviceWorkerSource.includes('importScripts("panel-runtime-capability-router.js");'),
    "background service worker should preload the hosted runtime capability router before the invoke shim"
  );
  assert(
    serviceWorkerSource.includes('importScripts("functions-runtime-config.js");'),
    "background service worker should preload the dedicated functions runtime config helper"
  );
  assert(
    invokeSource.includes("namespace.panelRuntimeCapabilityRouter.handle(request)"),
    "background invoke shim should delegate runtime capability handling through panelRuntimeCapabilityRouter"
  );
  assert(
    !invokeSource.includes('action === "storage.read-panel-state"'),
    "background invoke shim should stop carrying inline runtime action handlers once panelRuntimeCapabilityRouter owns them"
  );
  assert(
    routerSource.includes("PANEL_RUNTIME_STORAGE_STATE_KEYS"),
    "background runtime capability router should declare the compact hosted storage-state allowlist"
  );
  assert(
    routerSource.includes("PANEL_ALLOWED_FUNCTION_ENDPOINT_KEYS"),
    "background runtime capability router should declare the hosted function allowlist"
  );
  [
    '"providerIdentityCache"',
    '"settings"',
    '"uiPreferences"',
  ].forEach((storageKey) => assert(
    routerSource.includes(storageKey),
    `background hosted runtime should keep ${storageKey} in the compact storage-state contract`
  ));
  [
    '"meetingHub"',
    '"meetingStateByMeetingId"',
    '"pausedSessions"',
    '"productLaneMigration"',
    '"promptLibrary"',
    '"releaseInfo"',
  ].forEach((storageKey) => assert(
    !routerSource.includes(storageKey),
    `background hosted runtime should drop the inactive storage-state residue ${storageKey}`
  ));
  [
    'action === "storage.get"',
    'action === "storage.set"',
    'action === "storage.update-settings"',
    'action === "storage.set-session-paused"',
  ].forEach((actionSurface) => assert(
    !routerSource.includes(actionSurface),
    `background hosted runtime should drop the inactive storage action ${actionSurface}`
  ));
  assert(
    routerSource.includes("readHostedPanelStorageState"),
    "background should build a dedicated compact hosted storage-state snapshot"
  );
  [
    'action === "storage.read-panel-state"',
    'action === "storage.write-ui-preferences"',
    'action === "auth.issue-panel-session"',
    'action === "functions.invoke-endpoint"',
    'action === "browser.open-url"',
    'action === "meeting.workspace.open"',
    'action === "meeting.result.open"',
    'action === "meeting.share.create"',
    'action === "meeting.share.revoke"',
  ].forEach((actionSurface) => assert(
    routerSource.includes(actionSurface),
    `background hosted runtime should keep the canonical runtime action ${actionSurface}`
  ));
  [
    'action === "storage.get-state"',
    'action === "storage.update-ui-preferences"',
    'action === "auth.issue-prompt-panel"',
    'action === "auth.issue-meeting-panel"',
    'action === "functions.fetch"',
    'action === "release.open-url"',
    'action === "meeting.open-workspace"',
    'action === "meeting.open-result"',
    'action === "meeting.create-share-link"',
    'action === "meeting.revoke-share-link"',
  ].forEach((actionSurface) => assert(
    !routerSource.includes(actionSurface),
    `background hosted runtime should drop the legacy runtime action ${actionSurface}`
  ));
  assert(
    !routerSource.includes('"loadInovaPromptLibraryUrl"')
      && !routerSource.includes('"peekInovaPromptLibraryUrl"'),
    "background hosted prompt runtime surface should drop dead prompt-library read endpoint fallbacks"
  );
  assert(
    invokeSource.includes("invokeHostedPanelRequest"),
    "background should implement hosted request router"
  );
}

function loadRuntimeContext(lane) {
  const context = vm.createContext({
    chrome: {
      runtime: {
        getManifest() {
          return { version: lane === "v2" ? "1.0.0" : "0.4.5" };
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
        return lane;
      },
      getLaneConfig() {
        if (lane === "v2") {
          return {
            hosting: {
              baseUrl: "https://browser-extension-v2.web.app/extension-v2",
              originUrl: "https://browser-extension-v2.web.app",
            },
            id: "v2",
            prompt: {
              firestoreCollections: {
                accountsCollection: "integration_inova_accounts_v2",
                promptLibraryChunksCollection: "prompt_library_chunks_v2",
                promptLibraryOrdersCollection: "prompt_library_orders_v2",
                storeDetailCollection: "prompt_store_entry_details",
                storeFeedCollection: "prompt_store_feed_pages",
                storeSummaryCollection: "prompt_store_meta",
              },
              panelScope: "prompt-panel-v2",
            },
            storagePrefix: "v2.",
            web: {
              projectId: "browser-extension-main",
            },
          };
        }
        return {
          hosting: {
            baseUrl: "https://browser-extension-main.web.app/extension",
            originUrl: "https://browser-extension-main.web.app",
          },
          id: "legacy",
          prompt: {
            firestoreCollections: {
              accountsCollection: "integration_inova_accounts",
              promptLibraryChunksCollection: "prompt_library_chunks",
              promptLibraryOrdersCollection: "prompt_library_orders",
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
    storage: {
      async getState() {
        return { settings: {} };
      },
      async updateSettings(nextSettings) {
        return nextSettings;
      },
    },
  };

  loadScript(path.join("shared", "firestore-collections.js"), context);
  loadScript(path.join("shared", "firebase-config.js"), context);
  loadScript(path.join("background", "functions-runtime-config.js"), context);
  return context.InovaBookmarks;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main().catch((error) => {
  console.error(`[verify-hosted-panel-bridge] ${error.stack || error.message}`);
  process.exitCode = 1;
});
