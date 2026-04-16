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

const root = path.resolve(__dirname, "..");

async function verifyHostedPromptCapabilityActionGates() {
  const runtimeCalls = [];
  const toastCalls = [];
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
        const items = Array.isArray(promptLibrary?.items)
          ? promptLibrary.items.map((item) => ({ ...item }))
          : [];
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
  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "prompt-library-controller.js"), "utf8"),
    {
      filename: "hosting/extension-v2/panel/prompt-library-controller.js",
    }
  ).runInContext(context);

  const controller = context.InovaBookmarks.promptLibraryController.create({
    invokeRuntime: async (request) => {
      runtimeCalls.push({
        action: request?.action || "",
        capabilityId: request?.capabilityId || "",
      });
      if (request?.action === "storage.read-panel-state") {
        return {
          providerIdentityCache: {
            providerIdentity: {
              available: true,
              providerUserKey: "prompt-user-1",
            },
          },
          uiPreferences: {
            activePromptTab: "library",
          },
        };
      }
      return {};
    },
    publishToast(payload) {
      toastCalls.push(JSON.parse(JSON.stringify(payload)));
      return true;
    },
    scheduleRender() {},
  });

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();

  const disabledView = controller.buildPromptToolState().prompt;
  assert.equal(disabledView.canSync, false, "hosted prompt library should expose disabled sync capability in view state");
  assert.equal(disabledView.canPublishToStore, false, "hosted prompt library should expose disabled publish capability in view state");

  await controller.handlePromptAction("create");

  assert.equal(
    controller.buildPromptToolState().prompt.editor.open,
    false,
    "hosted prompt library should not open a write editor when sync capability is missing"
  );
  assert.equal(
    toastCalls.at(-1)?.message,
    "요청 보관함 동기화 기능이 현재 비활성화되어 있어요.",
    "blocked hosted prompt library writes should surface an explicit capability error"
  );
  assert.equal(
    runtimeCalls.some((call) => call.capabilityId === "prompt.library.sync"),
    false,
    "blocked hosted prompt library writes should not invoke the missing sync capability"
  );
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

if (require.main === module) {
  verifyHostedPromptCapabilityActionGates().then(() => {
    console.log("[verify-prompt-library-capability-gates] Hosted prompt capability gates passed");
  });
}

module.exports = {
  verifyHostedPromptCapabilityActionGates,
};
