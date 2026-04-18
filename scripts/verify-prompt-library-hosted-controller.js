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
  installPanelUtils(context);
  installHostedCapabilityClient(context);

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
        panel: request?.panel || "",
      });
      if (request?.action === "storage.read-panel-state") {
        return {
          providerIdentityCache: {
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
      if (request?.action === "functions.invoke-endpoint") {
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
    runtimeCalls.filter((call) => call.action === "auth.issue-panel-session" && call.panel === "prompt").length,
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
    runtimeCalls.filter((call) => call.action === "auth.issue-panel-session" && call.panel === "prompt").length,
    1,
    "hosted prompt library should not reissue prompt panel auth on repeated panel sync while the Firestore subscription stays active"
  );
}

async function verifyHostedPromptLibraryRefreshesLateProviderIdentity() {
  const runtimeCalls = [];
  let storageReadCount = 0;
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
        panel: request?.panel || "",
      });
      if (request?.action === "storage.read-panel-state") {
        storageReadCount += 1;
        return {
          providerIdentityCache: {
            providerIdentity: storageReadCount === 1
              ? { available: false }
              : {
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
      return {};
    },
    scheduleRender() {},
  });

  controller.syncPanelState(
    { activeTool: "meeting" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();

  assert.equal(
    runtimeCalls.filter((call) => call.action === "auth.issue-panel-session" && call.panel === "prompt").length,
    0,
    "inactive prompt library bootstrap should not issue prompt auth before the prompt tab is opened"
  );

  controller.syncPanelState(
    { activeTool: "prompts" },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(
    runtimeCalls.filter((call) => call.action === "auth.issue-panel-session" && call.panel === "prompt").length,
    1,
    "hosted prompt library should refresh provider identity and issue prompt auth on first prompt activation"
  );
  assert.equal(
    controller.buildPromptToolState({}, { reviewOpen: false }).prompt.totalCount,
    1,
    "hosted prompt library should render remote prompts after late provider identity refresh"
  );
}

async function verifyHostedPromptLibraryRetriesAfterInitialAuthTimeout() {
  let nextTimerId = 1;
  let renderCount = 0;
  let subscribeCalls = 0;
  const timers = [];
  const context = vm.createContext({
    Blob: class Blob {},
    File: class File {},
    clearTimeout(timerId) {
      const timer = timers.find((entry) => entry.id === timerId);
      if (timer) {
        timer.cleared = true;
      }
    },
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
    setTimeout(callback, delayMs) {
      const timer = {
        callback,
        cleared: false,
        delayMs,
        id: nextTimerId,
      };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
    URL: {
      createObjectURL() {
        return "blob:prompt-library";
      },
      revokeObjectURL() {},
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    promptLibraryFirestoreClient: {
      create() {
        let activeSubscription = false;
        return {
          disconnect() {
            activeSubscription = false;
          },
          hasActiveSubscription() {
            return activeSubscription;
          },
          async ensureSubscribed() {
            subscribeCalls += 1;
            if (subscribeCalls === 1) {
              activeSubscription = false;
              throw new Error("호스팅 패널 요청 시간이 초과되었어요.");
            }
            activeSubscription = true;
            return {
              promptLibrary: {
                items: [{ id: "retry-prompt", title: "Retry Prompt", content: "Body" }],
                version: 1,
              },
            };
          },
        };
      },
    },
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

  const source = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-library-controller.js"),
    "utf8"
  );
  new vm.Script(source, {
    filename: "hosting/extension-v2/panel/prompt-library-controller.js",
  }).runInContext(context);

  const controller = context.InovaBookmarks.promptLibraryController.create({
    browserCapabilities: {
      readPanelStorageState: async () => ({
        providerIdentityCache: {
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
      }),
      writeUiPreferences: async () => ({}),
    },
    scheduleRender() {
      renderCount += 1;
    },
  });

  controller.syncPanelState(
    {
      activeTool: "prompts",
      providerIdentity: {
        available: true,
        displayName: "Prompt Tester",
        email: "prompt@example.com",
        numericUserId: 42,
        provider: "inova",
        providerUserKey: "prompt-user-1",
      },
    },
    ["page.adapter.v2", "runtime.invoke.v1", "prompt.library.sync"]
  );
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(subscribeCalls, 1, "initial hosted prompt library load should be attempted");
  assert.equal(timers.length, 1, "hosted prompt library auth timeout should schedule a retry");
  assert.equal(timers[0].delayMs, 5000, "first prompt library retry should be short enough to recover without reload");
  assert.match(
    controller.buildPromptToolState().prompt.syncNotice.detail,
    /호스팅 패널 요청 시간이 초과/,
    "timeout notice should remain visible while retry is pending"
  );

  timers[0].callback();
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(subscribeCalls, 2, "retry should attempt hosted prompt library subscription again");
  assert(renderCount > 0);
  const promptState = controller.buildPromptToolState().prompt;
  assert.equal(promptState.items.length, 1);
  assert.equal(promptState.items[0].title, "Retry Prompt");
  assert.equal(promptState.syncNotice, null);
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = {
  verifyHostedPromptLibraryAvoidsDuplicateReloads,
  verifyHostedPromptLibraryRefreshesLateProviderIdentity,
  verifyHostedPromptLibraryRetriesAfterInitialAuthTimeout,
};
