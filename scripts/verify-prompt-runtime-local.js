#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifyPromptRuntimeResolution();
  verifyPromptLocalWiring();
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

try {
  main();
} catch (error) {
  console.error(`[verify-prompt-runtime-local] ${error.stack || error.message}`);
  process.exitCode = 1;
}
