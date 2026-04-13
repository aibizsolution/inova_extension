const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createPromptLibraryFirestoreNamespace } = require("./verify-prompt-library-test-helpers");

const root = path.resolve(__dirname, "..");

async function verifyHostedPromptLibraryAvoidsDuplicateReloads() {
  const runtimeCalls = [];
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
    runtimeCalls.filter((call) => call.action === "auth.issue-prompt-panel").length,
    1,
    "hosted prompt library should issue prompt panel auth once during the first prompts activation"
  );

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();

  assert.equal(
    runtimeCalls.filter((call) => call.action === "auth.issue-prompt-panel").length,
    1,
    "hosted prompt library should not reissue prompt panel auth on repeated panel sync while the Firestore subscription stays active"
  );
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = {
  verifyHostedPromptLibraryAvoidsDuplicateReloads,
};
