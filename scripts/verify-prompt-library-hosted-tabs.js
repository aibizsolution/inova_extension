#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  createPromptLibraryFirestoreNamespace,
  installHostedCapabilityClient,
  installPanelUtils,
} = require("./verify-prompt-library-test-helpers");
const { verifyHostedPromptLibraryFirestoreClientContract } = require("./verify-prompt-library-firestore-client");

const root = path.resolve(__dirname, "..");
const controllerPath = path.join(root, "hosting", "extension-v2", "panel", "prompt-library-controller.js");
const controllerSource = fs.readFileSync(controllerPath, "utf8");

main().then(() => {
  console.log("[verify-prompt-library-hosted-tabs] Hosted prompt tab contract passed");
});

async function main() {
  await verifyHostedPromptLibraryFirestoreClientContract();
  verifyHostedPromptToolStateDropsPlaceholderFallback();
  await verifyHostedPromptTabPersistenceDedupesWrites();
  await verifyHostedPromptLibraryTabSelectionAvoidsForcedReload();
  await verifyHostedPromptLibraryActivationDuringInitStillLoads();
}

function verifyHostedPromptToolStateDropsPlaceholderFallback() {
  assert(
    !controllerSource.includes("reviewPlaceholder:"),
    "hosted prompt library tool state should stop carrying review placeholder fallback once the hosted review controller owns the tab"
  );
  assert(
    !controllerSource.includes("storePlaceholder:"),
    "hosted prompt library tool state should stop carrying store placeholder fallback once the hosted store controller owns the tab"
  );
}

async function verifyHostedPromptTabPersistenceDedupesWrites() {
  const persistedTabs = [];
  const controller = createController({
    invokeRuntime: async (request) => {
      if (request?.action === "storage.read-panel-state") {
        return buildStorageState("library");
      }
      if (request?.action === "storage.write-ui-preferences") {
        persistedTabs.push(request?.partial?.activePromptTab || "");
        return {};
      }
      return {};
    },
  });

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();
  await flushAsync();
  await controller.handleSelectPromptTab("store");
  await flushAsync();
  await controller.handleSelectPromptTab("store");
  await flushAsync();

  assert.deepEqual(
    persistedTabs,
    ["store"],
    "hosted prompt tab persistence should avoid duplicate writes for the same active tab"
  );
}

async function verifyHostedPromptLibraryTabSelectionAvoidsForcedReload() {
  const runtimeCalls = [];
  const controller = createController({
    ensureStoreLoaded: async () => {},
    invokeRuntime: async (request) => {
      runtimeCalls.push({
        action: request?.action,
        endpointKey: request?.endpointKey || "",
        panel: request?.panel || "",
      });
      if (request?.action === "storage.read-panel-state") {
        return buildStorageState("library");
      }
      return {};
    },
  });

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();
  await flushAsync();
  await controller.handleSelectPromptTab("store");
  await flushAsync();
  await controller.handleSelectPromptTab("library");
  await flushAsync();
  await flushAsync();

  assert.equal(
    runtimeCalls.filter((call) => call.action === "auth.issue-panel-session" && call.panel === "prompt").length,
    1,
    "hosted prompt library tab selection should not reissue prompt panel auth while the hosted library subscription stays active"
  );
}

async function verifyHostedPromptLibraryActivationDuringInitStillLoads() {
  let resolveStorageState = () => {};
  const runtimeCalls = [];
  const storageStatePromise = new Promise((resolve) => {
    resolveStorageState = resolve;
  });
  const controller = createController({
    invokeRuntime: async (request) => {
      runtimeCalls.push({
        action: request?.action || "",
        panel: request?.panel || "",
      });
      if (request?.action === "storage.read-panel-state") {
        return storageStatePromise;
      }
      return {};
    },
  });

  controller.syncPanelState(
    { activeTool: "release" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();

  resolveStorageState(buildStorageState("library"));
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(
    runtimeCalls.filter((call) => call.action === "auth.issue-panel-session" && call.panel === "prompt").length,
    1,
    "release-to-prompts activation should still start prompt panel auth after late storage hydration finishes"
  );
}

function createController(options = {}) {
  const context = vm.createContext({
    Blob: class Blob {},
    File: class File {},
    clearTimeout,
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
    promptLibraryFirestoreClient: createPromptLibraryFirestoreNamespace(),
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
  installPanelUtils(context);
  installHostedCapabilityClient(context);
  new vm.Script(controllerSource, {
    filename: "hosting/extension-v2/panel/prompt-library-controller.js",
  }).runInContext(context);
  return context.InovaBookmarks.promptLibraryController.create({
    scheduleRender() {},
    ...options,
  });
}

function buildStorageState(activePromptTab) {
  return {
    providerIdentityCache: {
      providerIdentity: {
        available: true,
        providerUserKey: "prompt-user-1",
      },
    },
    uiPreferences: {
      activePromptTab,
    },
  };
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
