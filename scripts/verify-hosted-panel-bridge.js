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
  assert(html.includes("../../meeting/debug-console.js"), "hosted panel should reuse meeting debug renderer");
  assert(html.includes("./prompt-hub-panel.js"), "hosted panel should load prompt interaction helpers");
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
  const invokeSource = fs.readFileSync(
    path.join(root, "background", "panel-runtime-invoke.js"),
    "utf8"
  );

  assert(serviceWorkerSource.includes("inova-panel:invoke"), "background should expose hosted panel invoke route");
  assert(
    invokeSource.includes("PANEL_ALLOWED_STORAGE_KEYS"),
    "background should declare hosted storage allowlist"
  );
  assert(
    invokeSource.includes("PANEL_ALLOWED_FUNCTION_ENDPOINT_KEYS"),
    "background should declare hosted function allowlist"
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
              endpointOverrides: {},
            },
            hosting: {
              baseUrl: "https://browser-extension-v2.web.app/extension-v2",
              originUrl: "https://browser-extension-v2.web.app",
            },
            id: "v2",
            prompt: {
              firestoreCollections: {
                accountsCollection: "integration_inova_accounts_v2",
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
