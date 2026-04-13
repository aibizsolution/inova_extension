#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createPromptLibraryFirestoreNamespace } = require("./verify-prompt-library-test-helpers");
const { verifyHostedPromptLibraryAvoidsDuplicateReloads } = require("./verify-prompt-library-hosted-controller");

const root = path.resolve(__dirname, "..");

function main() {
  verifyPromptLibraryHostedLaneContract();
  verifyPromptLibraryMetadataRoundTripContract();
  return Promise.all([
    verifyHostedPromptEditorViewLabels(),
    verifyHostedPromptPublishUsesFunctionsFetch(),
    verifyHostedPromptTabSelectionDoesNotWaitForPersistence(),
    verifyHostedPromptReviewPendingAutofocus(),
    verifyHostedPromptTabSelectionSurvivesLateStorageHydration(),
    verifyHostedPromptReviewTabVisibility(),
    verifyHostedPromptTextInputDebouncesRender(),
    verifyHostedPromptLibraryAvoidsDuplicateReloads(),
  ]).then(() => {
    console.log("[verify-prompt-library-remote-first] Prompt library remote-first contract passed");
  });
}

function verifyPromptLibraryHostedLaneContract() {
  const stateFactory = read(path.join("content", "panel-v2-composition-controller.js"));
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

async function verifyHostedPromptEditorViewLabels() {
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

  await controller.handlePromptAction("create");
  const createView = controller.buildPromptToolState().prompt.editor;
  assert.equal(createView.titleText, "새 요청 추가");
  assert.equal(createView.submitLabel, "추가");
  assert.equal(createView.description, "반복해서 쓰는 요청을 저장해 두세요.");

  await controller.handlePromptAction("edit", { promptId: "prompt-1" });
  const editView = controller.buildPromptToolState().prompt.editor;
  assert.equal(editView.titleText, "요청 수정");
  assert.equal(editView.submitLabel, "저장");
  assert.equal(editView.description, "저장 후 바로 다시 사용할 수 있어요.");
}

async function verifyHostedPromptTextInputDebouncesRender() {
  let renderCount = 0;
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
    invokeRuntime: async () => ({}),
    scheduleRender() {
      renderCount += 1;
    },
  });

  await controller.handlePromptAction("create");
  renderCount = 0;

  controller.handlePromptDraftChange("title", "안");
  controller.handleSearch("prompts", "안");

  await flushAsync();
  assert.equal(renderCount, 0, "text input changes should not render immediately");

  await wait(220);
  assert.equal(renderCount, 1, "text input changes should collapse into one deferred render");
}

async function verifyHostedPromptPublishUsesFunctionsFetch() {
  const runtimeCalls = [];
  const ensureStoreLoadedCalls = [];
  const persistedTabs = [];
  let storeCategories = [
    { id: "document", label: "문서" },
    { id: "other", label: "기타" },
  ];
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
    promptStoreModel: {
      getCategories() {
        return [
          { id: "document", label: "문서" },
          { id: "other", label: "기타" },
        ];
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
    ensureStoreLoaded(...args) {
      ensureStoreLoadedCalls.push(args);
      return Promise.resolve();
    },
    getStoreCategories() {
      return storeCategories;
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push({
        action: request?.action,
        body: { ...(request?.body || {}) },
        endpointKey: request?.endpointKey || "",
        partial: request?.partial ? { ...request.partial } : null,
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
      if (request?.action === "functions.fetch" && request?.endpointKey === "loadInovaPromptLibraryUrl") {
        return {
          promptLibrary: {
            items: [{ id: "prompt-1", title: "Accessibility Tester", content: "본문" }],
            version: 1,
          },
        };
      }
      if (request?.action === "functions.fetch" && request?.endpointKey === "publishPromptToStoreUrl") {
        return {
          entry: {
            entryId: "entry-1",
          },
        };
      }
      if (request?.action === "storage.update-ui-preferences") {
        persistedTabs.push(request?.partial?.activePromptTab || "");
        return {};
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

  await controller.handlePromptAction("open-publish", { promptId: "prompt-1" });
  await controller.handlePromptAction("set-publish-title", { title: "스토어 제목" });
  await controller.handlePromptAction("set-publish-category", { categoryId: "document" });
  await controller.handlePromptAction("confirm-publish", { promptId: "prompt-1" });

  assert.equal(
    runtimeCalls.filter((call) => call.endpointKey === "publishPromptToStoreUrl").length,
    1,
    "hosted prompt publish should call the prompt store publish function endpoint"
  );
  assert.deepEqual(
    ensureStoreLoadedCalls,
    [[false, "open-publish"], [true, "publish"]],
    "hosted prompt publish should refresh the hosted store after publishing"
  );
  const publishCall = runtimeCalls.find((call) => call.endpointKey === "publishPromptToStoreUrl");
  assert.equal(publishCall?.body?.categoryId, "document");
  assert.equal(publishCall?.body?.categoryLabel, "문서");
  const viewState = controller.buildPromptToolState({}, { reviewOpen: false });
  assert.equal(viewState.activeTab, "store");
  assert.equal(viewState.prompt.publishPromptId, "");
  assert.equal(viewState.prompt.feedback?.message, "스토어에 별도 복사본으로 등록했어요.");
  assert(persistedTabs.includes("store"), "hosted prompt publish should persist the store tab after success");
  storeCategories = [];
  await controller.handlePromptAction("open-publish", { promptId: "prompt-1" });
  await controller.handlePromptAction("set-publish-title", { title: "스토어 제목" });
  await controller.handlePromptAction("set-publish-category-label", { categoryLabel: "접근성 검토" });
  await controller.handlePromptAction("confirm-publish", { promptId: "prompt-1" });

  const customPublishCall = runtimeCalls.filter((call) => call.endpointKey === "publishPromptToStoreUrl").at(-1);
  assert.equal(customPublishCall?.body?.categoryId, "", "custom category publish should leave categoryId generation to the backend");
  assert.equal(customPublishCall?.body?.categoryLabel, "접근성 검토");
}

async function verifyHostedPromptTabSelectionDoesNotWaitForPersistence() {
  let resolvePersistence;
  const persistencePromise = new Promise((resolve) => {
    resolvePersistence = resolve;
  });
  let renderCount = 0;
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
    ensureStoreLoaded: async () => {},
    invokeRuntime: async (request) => {
      if (request?.action === "storage.update-ui-preferences") {
        return persistencePromise;
      }
      return {};
    },
    scheduleRender() {
      renderCount += 1;
    },
  });

  const selectionPromise = controller.handleSelectPromptTab("store");
  const viewState = controller.buildPromptToolState({}, { reviewOpen: false });
  assert.equal(viewState.activeTab, "store", "hosted prompt tab selection should update immediately before persistence resolves");
  assert.equal(renderCount, 1, "hosted prompt tab selection should schedule an immediate rerender");
  resolvePersistence({});
  await selectionPromise;
}

async function verifyHostedPromptTabSelectionSurvivesLateStorageHydration() {
  let resolveStorage;
  const storagePromise = new Promise((resolve) => {
    resolveStorage = resolve;
  });
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
      if (request?.action === "storage.get-state") {
        return storagePromise;
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

  await controller.handleSelectPromptTab("review");

  resolveStorage({
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
  });

  await flushAsync();
  await flushAsync();

  const viewState = controller.buildPromptToolState({}, { reviewOpen: true });
  assert.equal(
    viewState.activeTab,
    "review",
    "late storage hydration should not override an explicit hosted prompt tab selection"
  );
}

async function verifyHostedPromptReviewPendingAutofocus() {
  const reviewTraces = [];
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
      return {};
    },
    scheduleRender() {},
    traceReview(step, payload) {
      reviewTraces.push({ payload: { ...(payload || {}) }, step });
    },
  });

  controller.syncPanelState(
    {
      activeTool: "prompts",
      promptTool: {
        review: {
          pending: true,
        },
      },
    },
    ["page.adapter.v2", "runtime.invoke.v1"]
  );

  await flushAsync();
  await flushAsync();

  const viewState = controller.buildPromptToolState({}, { reviewOpen: true });
  assert.equal(
    viewState.activeTab,
    "review",
    "a fresh external review request should autofocus the hosted prompt review tab"
  );
  assert.equal(reviewTraces[0]?.step, "71.hosted.review.autofocus");
}

async function verifyHostedPromptReviewTabVisibility() {
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
    invokeRuntime: async () => ({}),
    scheduleRender() {},
  });

  let viewState = controller.buildPromptToolState({}, { reviewOpen: false });
  assert.deepEqual(
    viewState.tabs.map((tab) => tab.id),
    ["library", "store"],
    "hosted prompt tabs should hide review until a review result is actually open"
  );
  assert.equal(viewState.activeTab, "library");

  await controller.handleSelectPromptTab("review");

  viewState = controller.buildPromptToolState({}, { reviewOpen: false });
  assert.deepEqual(
    viewState.tabs.map((tab) => tab.id),
    ["library", "store"],
    "persisted review selection should not surface a hidden review tab"
  );
  assert.equal(
    viewState.activeTab,
    "library",
    "hidden review tab should fall back to the library view"
  );

  viewState = controller.buildPromptToolState({}, { reviewOpen: true });
  assert.deepEqual(
    viewState.tabs.map((tab) => tab.id),
    ["library", "store", "review"],
    "hosted prompt tabs should surface review only when review state is open"
  );
  assert.equal(viewState.activeTab, "review");
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
