#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const controllerPath = path.join(root, "hosting", "extension-v2", "panel", "prompt-library-controller.js");
const controllerSource = fs.readFileSync(controllerPath, "utf8");

main().then(() => {
  console.log("[verify-prompt-library-hosted-tabs] Hosted prompt tab contract passed");
});

async function main() {
  await verifyHostedPromptTabPersistenceDedupesWrites();
  await verifyHostedPromptLibraryTabSelectionAvoidsForcedReload();
}

async function verifyHostedPromptTabPersistenceDedupesWrites() {
  const persistedTabs = [];
  const controller = createController({
    invokeRuntime: async (request) => {
      if (request?.action === "storage.get-state") {
        return buildStorageState("library");
      }
      if (request?.action === "storage.update-ui-preferences") {
        persistedTabs.push(request?.partial?.activePromptTab || "");
        return {};
      }
      if (request?.action === "functions.fetch") {
        return {
          promptLibrary: {
            items: [],
            version: 1,
          },
        };
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
      });
      if (request?.action === "storage.get-state") {
        return buildStorageState("library");
      }
      if (request?.action === "functions.fetch" && request?.endpointKey === "loadInovaPromptLibraryUrl") {
        return {
          promptLibrary: {
            items: [{ id: "prompt-1", title: "Prompt", content: "Body" }],
            version: 1,
          },
        };
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
    runtimeCalls.filter((call) => call.action === "functions.fetch" && call.endpointKey === "loadInovaPromptLibraryUrl").length,
    1,
    "hosted prompt library tab selection should not force another remote reload once the library is already ready"
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
    cloudSync: {
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
