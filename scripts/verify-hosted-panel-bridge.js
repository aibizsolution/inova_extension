#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyPanelRuntimeResolution();
  verifyV2PanelRuntimeResolution();
  await verifyHostedPanelBridgeContract();
  verifyHostedPanelFiles("extension");
  verifyHostedPanelFiles("extension-v2");
  verifyBackgroundInvokeWiring();
  console.log("[verify-hosted-panel-bridge] Hosted panel bridge contract passed");
}

function verifyPanelRuntimeResolution() {
  const firebaseConfig = loadFirebaseConfig("legacy");
  const localRuntime = firebaseConfig.prompt.resolveRuntime({
    meetingWorkspaceTarget: "local",
    meetingWorkspaceUrlOverride: "http://127.0.0.1:5000/meeting/index.html",
  });

  assert.equal(
    firebaseConfig.hosting.panelAppUrl,
    "https://browser-extension-main.web.app/extension/panel/index.html"
  );
  assert.equal(
    localRuntime.hosting.panelAppUrl,
    "http://127.0.0.1:5000/extension/panel/index.html"
  );
}

function verifyV2PanelRuntimeResolution() {
  const firebaseConfig = loadFirebaseConfig("v2");
  const localRuntime = firebaseConfig.prompt.resolveRuntime({
    meetingWorkspaceTarget: "local",
    meetingWorkspaceUrlOverride: "http://127.0.0.1:5000/meeting/index.html",
  });

  assert.equal(
    firebaseConfig.hosting.panelAppUrl,
    "https://browser-extension-v2.web.app/extension-v2/panel/index.html"
  );
  assert.equal(
    localRuntime.hosting.panelAppUrl,
    "http://127.0.0.1:5000/extension-v2/panel/index.html"
  );
  assert.equal(
    firebaseConfig.functions.listInovaMeetingsUrl,
    "https://asia-northeast3-browser-extension-main.cloudfunctions.net/listInovaMeetings"
  );
  assert.equal(
    firebaseConfig.functions.issueInovaMeetingPanelAuthUrl,
    "https://asia-northeast3-browser-extension-main.cloudfunctions.net/issueInovaMeetingPanelAuth"
  );
  assert.equal(
    firebaseConfig.functions.loadInovaPromptLibraryUrl,
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
        action: "toggle-panel",
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

  assert(html.includes("./runtime.js"), "hosted panel should load runtime bootstrap");
  if (directoryName === "extension-v2") {
    assert(html.includes("./extension-capability-client.js"), "v2 hosted panel should load the hosted extension capability client");
    assert(html.includes("./prompt-tool-panel.js"), "v2 hosted panel should load prompt tool interaction helpers");
  } else {
    assert(html.includes("./prompt-hub-panel.js"), "legacy hosted panel should keep the prompt hub interaction helper");
  }
  if (directoryName === "extension-v2") {
    assert(!html.includes("./legacy-panel.css"), "v2 hosted panel should not load the dead legacy panel shell stylesheet");
    assert(!html.includes("./legacy-tools.css"), "v2 hosted panel should not load the dead legacy tools stylesheet");
    assert(html.includes("./conversation-controller.js"), "v2 hosted panel should load conversation controller");
    assert(html.includes("./prompt-library-model.js"), "v2 hosted panel should load prompt library model");
    assert(html.includes("./prompt-library-controller.js"), "v2 hosted panel should load prompt library controller");
    assert(html.includes("./prompt-store-model.js"), "v2 hosted panel should load prompt store model");
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
    '"cloudSync"',
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

function loadFirebaseConfig(lane) {
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
            functions: {
              baseUrl: "https://asia-northeast3-browser-extension-main.cloudfunctions.net",
              endpointOverrides: {
                issueInovaPromptPanelAuthUrl: "issueInovaPromptPanelAuthV2",
                loadInovaPromptLibraryUrl: "loadInovaPromptLibraryV2",
                peekInovaPromptLibraryUrl: "peekInovaPromptLibraryV2",
                syncInovaPromptLibraryUrl: "syncInovaPromptLibraryV2",
              },
            },
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
  };

  loadScript(path.join("shared", "firebase-config.js"), context);
  return context.InovaBookmarks.firebaseConfig;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main().catch((error) => {
  console.error(`[verify-hosted-panel-bridge] ${error.stack || error.message}`);
  process.exitCode = 1;
});
