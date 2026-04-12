#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifyPromptLibraryRemoteFirstWiring();
  verifyPromptLibraryMetadataRoundTripContract();
  return verifyHostedPromptLibraryAvoidsDuplicateReloads().then(() => {
    console.log("[verify-prompt-library-remote-first] Prompt library remote-first contract passed");
  });
}

function verifyPromptLibraryRemoteFirstWiring() {
  const cloudSyncManager = read(path.join("content", "features", "prompt-library", "cloud-sync-manager.js"));
  assert(/savePromptItem/.test(cloudSyncManager), "cloud sync manager가 remote save entrypoint를 가져야 합니다.");
  assert(/removePromptItem/.test(cloudSyncManager), "cloud sync manager가 remote delete entrypoint를 가져야 합니다.");
  assert(/movePromptItem/.test(cloudSyncManager), "cloud sync manager가 remote reorder entrypoint를 가져야 합니다.");
  assert(/importPromptLibrary/.test(cloudSyncManager), "cloud sync manager가 remote import entrypoint를 가져야 합니다.");
  assert(/importStorePrompt/.test(cloudSyncManager), "cloud sync manager가 remote store import entrypoint를 가져야 합니다.");
  assert(/loadPromptLibraryNow/.test(cloudSyncManager), "cloud sync manager가 remote load entrypoint를 가져야 합니다.");
  assert(/sendRuntimeMessage\("inova-sync:load-prompt-library"/.test(cloudSyncManager), "cloud sync manager가 remote load를 직접 호출해야 합니다.");
  assert(/sendRuntimeMessage\("inova-sync:sync-prompt-library"/.test(cloudSyncManager), "cloud sync manager가 remote sync를 직접 호출해야 합니다.");

  const promptManager = read(path.join("content", "features", "prompt-library", "prompt-manager.js"));
  assert(!/namespace\.storage\.savePromptItem/.test(promptManager), "prompt manager는 local-first save를 직접 호출하면 안 됩니다.");
  assert(!/namespace\.storage\.removePromptItem/.test(promptManager), "prompt manager는 local-first delete를 직접 호출하면 안 됩니다.");
  assert(!/namespace\.storage\.importPromptLibrary/.test(promptManager), "prompt manager는 local-first import를 직접 호출하면 안 됩니다.");
  assert(/hooks\.savePromptItem/.test(promptManager), "prompt manager는 remote save hook을 써야 합니다.");
  assert(/hooks\.removePromptItem/.test(promptManager), "prompt manager는 remote delete hook을 써야 합니다.");
  assert(/hooks\.importPromptLibrary/.test(promptManager), "prompt manager는 remote import hook을 써야 합니다.");

  const promptHubController = read(path.join("content", "prompt-hub-controller.js"));
  assert(!/namespace\.storage\.movePromptItem/.test(promptHubController), "prompt hub controller는 local-first reorder를 직접 호출하면 안 됩니다.");
  assert(/cloudSyncManager\.movePromptItem/.test(promptHubController), "prompt hub controller는 remote reorder를 써야 합니다.");

  const storeManager = read(path.join("content", "features", "prompt-store", "store-manager.js"));
  assert(/hooks\.importStorePrompt/.test(storeManager), "store manager는 remote store import hook을 지원해야 합니다.");

  const stateFactory = read(path.join("content", "panel-state-factory.js"));
  assert(/promptLibraryLoading/.test(stateFactory), "panel state에 prompt library loading state가 필요합니다.");
  assert(/promptLibraryRemoteReady/.test(stateFactory), "panel state에 prompt library remote readiness가 필요합니다.");

  const promptFeatureDoc = read(path.join("content", "features", "prompt-library", "AGENTS.md"));
  assert(/DB 정본/.test(promptFeatureDoc), "prompt-library AGENTS에 DB 정본 invariant가 필요합니다.");
  assert(/server ack/.test(promptFeatureDoc) || /서버 ack/.test(promptFeatureDoc), "prompt-library AGENTS에 server-ack invariant가 필요합니다.");
}

function verifyPromptLibraryMetadataRoundTripContract() {
  const register = read(path.join("functions", "features", "prompt-library", "register.js"));
  assert(/importedFrom:\s*normalizeImportedFrom/.test(register), "prompt library sync가 importedFrom 메타를 저장해야 합니다.");
  assert(/storePublication:\s*normalizeStorePublication/.test(register), "prompt library sync가 storePublication 메타를 저장해야 합니다.");
  assert(/function normalizeImportedFrom/.test(register), "prompt library register에 importedFrom normalizer가 필요합니다.");
  assert(/function normalizeStorePublication/.test(register), "prompt library register에 storePublication normalizer가 필요합니다.");
}

async function verifyHostedPromptLibraryAvoidsDuplicateReloads() {
  const runtimeCalls = [];
  const context = vm.createContext({
    Blob: class Blob {},
    File: class File {},
    console,
    document: {
      createElement() {
        return {
          click() {},
        };
      },
    },
    globalThis: null,
    navigator: {},
    setTimeout,
    URL: {
      createObjectURL() {
        return "blob:prompt-library";
      },
      revokeObjectURL() {},
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

  const source = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-library-controller.js"),
    "utf8"
  );
  new vm.Script(source, {
    filename: "hosting/extension-v2/panel/prompt-library-controller.js",
  }).runInContext(context);

  const controller = context.InovaBookmarks.promptLibraryController.create({
    invokeRuntime: async (request) => {
      runtimeCalls.push({
        action: request?.action,
        endpointKey: request?.endpointKey || "",
      });
      if (request?.action === "storage.get-state") {
        return {
          cloudSync: {
            providerIdentity: {
              available: true,
              displayName: "Prompt Tester",
              email: "prompt@example.com",
              numericUserId: 42,
              provider: "inova",
              providerUserKey: "prompt-user-1",
            },
          },
          uiPreferences: {
            activePromptTab: "library",
          },
        };
      }
      if (request?.action === "functions.fetch") {
        return {
          promptLibrary: {
            items: [{ id: "prompt-1", title: "Prompt", content: "Body" }],
            version: 1,
          },
        };
      }
      return {};
    },
    scheduleRender() {},
  });

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(
    runtimeCalls.filter((call) => call.action === "functions.fetch" && call.endpointKey === "loadInovaPromptLibraryUrl").length,
    1,
    "hosted prompt library should fetch once during the first prompts activation"
  );

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();

  assert.equal(
    runtimeCalls.filter((call) => call.action === "functions.fetch" && call.endpointKey === "loadInovaPromptLibraryUrl").length,
    1,
    "hosted prompt library should not refetch the same remote library on repeated panel sync"
  );
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

try {
  Promise.resolve(main()).catch((error) => {
    console.error(`[verify-prompt-library-remote-first] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
} catch (error) {
  console.error(`[verify-prompt-library-remote-first] ${error.stack || error.message}`);
  process.exitCode = 1;
}
