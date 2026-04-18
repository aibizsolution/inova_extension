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
const { verifyHostedPromptCapabilityActionGates } = require("./verify-prompt-library-capability-gates");
const {
  verifyHostedPromptLibraryAvoidsDuplicateReloads,
  verifyHostedPromptLibraryRefreshesLateProviderIdentity,
  verifyHostedPromptLibraryRetriesAfterInitialAuthTimeout,
} = require("./verify-prompt-library-hosted-controller");

const root = path.resolve(__dirname, "..");
const HOSTED_PROMPT_CAPABILITIES = Object.freeze([
  "page.adapter.v2",
  "runtime.invoke.v1",
  "prompt.library.sync",
  "prompt.store.publish",
]);

function main() {
  verifyPromptLibraryHostedLaneContract();
  verifyPromptLibraryMetadataRoundTripContract();
  return Promise.all([
    verifyHostedPromptEditorViewLabels(),
    verifyHostedPromptCapabilityActionGates(),
    verifyHostedPromptPublishUsesFunctionsFetch(),
    verifyHostedPromptTabSelectionDoesNotWaitForPersistence(),
    verifyHostedPromptReviewRequestAutofocus(),
    verifyHostedPromptTabSelectionSurvivesLateStorageHydration(),
    verifyHostedPromptReviewTabVisibility(),
    verifyHostedPromptTextInputDebouncesRender(),
    verifyHostedPromptLibraryAvoidsDuplicateReloads(),
    verifyHostedPromptLibraryRefreshesLateProviderIdentity(),
    verifyHostedPromptLibraryRetriesAfterInitialAuthTimeout(),
  ]).then(() => {
    console.log("[verify-prompt-library-remote-first] Prompt library remote-first contract passed");
  });
}

function verifyPromptLibraryHostedLaneContract() {
  const stateFactory = read(path.join("content", "panel-v2-composition-controller.js"));
  const routeStateController = read(path.join("content", "route-state-controller.js"));
  const sharedProviderIdentityCache = read(path.join("shared", "provider-identity-cache.js"));
  const sharedStorage = read(path.join("shared", "storage.js"));
  const backupPromptCloudSync = read(path.join("backup", "legacy-panel", "shared", "prompt-cloud-sync.js"));
  const backupPromptStorage = read(path.join("backup", "legacy-panel", "shared", "prompt-storage.js"));
  assert(!/\bpromptLibraryLoading\b/.test(stateFactory), "active v2 panel state는 dead prompt library loading mirror를 유지하면 안 됩니다.");
  assert(!/\bpromptLibraryRemoteReady\b/.test(stateFactory), "active v2 panel state는 dead prompt library ready mirror를 유지하면 안 됩니다.");
  assert(!/\bpromptLibrary:\s/.test(stateFactory), "active v2 panel state는 hosted-owned prompt library cache를 직접 들지 않아야 합니다.");
  assert(!/\bpromptEditor:\s*\{/.test(stateFactory), "active v2 panel state는 hosted-owned prompt editor bucket을 직접 들지 않아야 합니다.");
  assert(!/\bstore:\s*\{/.test(stateFactory), "active v2 panel state는 hosted-owned store bucket을 직접 들지 않아야 합니다.");
  assert(!/\bmergePromptLibrary\b/.test(routeStateController), "active route hydration은 hosted-owned prompt library cache를 다시 merge하면 안 됩니다.");
  assert(!/\bqueuePromptLibrarySyncOperation\b/.test(sharedProviderIdentityCache), "active shared/provider-identity-cache.js는 dormant prompt sync operation builder를 다시 들지 않아야 합니다.");
  assert(!/\bcreateReplaceLibraryOperation\b/.test(sharedProviderIdentityCache), "active shared/provider-identity-cache.js는 dormant prompt library replace helper를 다시 들지 않아야 합니다.");
  assert(!/\bfunction getPromptLibrary\b/.test(sharedStorage), "active shared/storage.js는 dormant prompt library CRUD helper를 다시 들지 않아야 합니다.");
  assert(!/\bfunction savePromptItem\b/.test(sharedStorage), "active shared/storage.js는 dormant prompt save helper를 다시 들지 않아야 합니다.");
  assert(/\bqueuePromptLibrarySyncOperation\b/.test(backupPromptCloudSync), "legacy prompt sync operation helper는 backup shared lane에 남아 있어야 합니다.");
  assert(/\bfunction getPromptLibrary\b/.test(backupPromptStorage), "legacy prompt storage helper는 backup shared lane에 남아 있어야 합니다.");

  const promptFeatureDoc = read(path.join("content", "features", "prompt-library", "AGENTS.md"));
  assert(/DB 정본/.test(promptFeatureDoc), "prompt-library AGENTS에 DB 정본 invariant가 필요합니다.");
  assert(/server ack/.test(promptFeatureDoc) || /서버 ack/.test(promptFeatureDoc), "prompt-library AGENTS에 server-ack invariant가 필요합니다.");
  assert(/activeTab/.test(promptFeatureDoc) && /review handoff signal/.test(promptFeatureDoc), "prompt-library AGENTS에 v2 top-panel 최소 snapshot 경계가 필요합니다.");
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
      if (request?.action === "functions.invoke-endpoint" || request?.capabilityId === "prompt.library.sync") {
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
    HOSTED_PROMPT_CAPABILITIES
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
  const toastCalls = [];
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
    ensureStoreLoaded(...args) {
      ensureStoreLoadedCalls.push(args);
      return Promise.resolve();
    },
    getStoreCategories() {
      return storeCategories;
    },
    publishToast(payload) {
      toastCalls.push(JSON.parse(JSON.stringify(payload)));
      return true;
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push({
        action: request?.action,
        body: { ...(request?.body || request?.input || {}) },
        capabilityId: request?.capabilityId || "",
        endpointKey: request?.endpointKey || "",
        partial: request?.partial ? { ...request.partial } : null,
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
      if (request?.action === "functions.invoke-endpoint" && request?.endpointKey === "loadInovaPromptLibraryUrl") {
        return {
          promptLibrary: {
            items: [{ id: "prompt-1", title: "Accessibility Tester", content: "본문" }],
            version: 1,
          },
        };
      }
      if (request?.action === "functions.invoke-endpoint" && request?.endpointKey === "publishPromptToStoreUrl") {
        return {
          entry: {
            entryId: "entry-1",
          },
        };
      }
      if (request?.action === "capabilities.invoke" && request?.capabilityId === "prompt.store.publish") {
        return {
          entry: {
            entryId: "entry-1",
          },
        };
      }
      if (isUiPreferencesWriteRequest(request)) {
        persistedTabs.push(readUiPreferencesPartial(request).activePromptTab || "");
        return {};
      }
      return {};
    },
    scheduleRender() {},
  });

  controller.syncPanelState(
    { activeTool: "prompts" },
    HOSTED_PROMPT_CAPABILITIES
  );
  await flushAsync();
  await flushAsync();
  await flushAsync();

  await controller.handlePromptAction("open-publish", { promptId: "prompt-1" });
  await controller.handlePromptAction("set-publish-title", { title: "스토어 제목" });
  await controller.handlePromptAction("set-publish-category", { categoryId: "document" });
  await controller.handlePromptAction("confirm-publish", { promptId: "prompt-1" });

  assert.equal(
    runtimeCalls.filter((call) => call.capabilityId === "prompt.store.publish").length,
    1,
    "hosted prompt publish should call the prompt store publish capability"
  );
  assert.deepEqual(
    ensureStoreLoadedCalls,
    [[false, "open-publish"], [true, "publish"]],
    "hosted prompt publish should refresh the hosted store after publishing"
  );
  const publishCall = runtimeCalls.find((call) => call.capabilityId === "prompt.store.publish");
  assert.equal(publishCall?.body?.categoryId, "document");
  assert.equal(publishCall?.body?.categoryLabel, "문서");
  const viewState = controller.buildPromptToolState({}, { reviewOpen: false });
  assert.equal(viewState.activeTab, "store");
  assert.equal(viewState.prompt.publishPromptId, "");
  assert.equal(viewState.prompt.feedback, null, "hosted prompt publish should keep short action feedback out of inline prompt state");
  assert.deepEqual(toastCalls.at(-1), {
    contextId: "prompt-1",
    message: "스토어에 별도 복사본으로 등록했어요.",
    source: "prompt-library",
    tone: "success",
    ttlMs: 2200,
  });
  assert(persistedTabs.includes("store"), "hosted prompt publish should persist the store tab after success");
  storeCategories = [];
  await controller.handlePromptAction("open-publish", { promptId: "prompt-1" });
  await controller.handlePromptAction("set-publish-title", { title: "스토어 제목" });
  await controller.handlePromptAction("set-publish-category-label", { categoryLabel: "접근성 검토" });
  await controller.handlePromptAction("confirm-publish", { promptId: "prompt-1" });

  const customPublishCall = runtimeCalls.filter((call) => call.capabilityId === "prompt.store.publish").at(-1);
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
    ensureStoreLoaded: async () => {},
    invokeRuntime: async (request) => {
      if (isUiPreferencesWriteRequest(request)) {
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
      if (request?.action === "storage.read-panel-state") {
        return storagePromise;
      }
      return {};
    },
    scheduleRender() {},
  });

  controller.syncPanelState(
    { activeTool: "prompts" },
    HOSTED_PROMPT_CAPABILITIES
  );
  await flushAsync();

  await controller.handleSelectPromptTab("review");

  resolveStorage({
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

async function verifyHostedPromptReviewRequestAutofocus() {
  const reviewTraces = [];
  const persistedPreferences = [];
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
      if (isUiPreferencesWriteRequest(request)) {
        persistedPreferences.push({ ...readUiPreferencesPartial(request) });
        return {};
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
      activeTool: "bookmarks",
      promptTool: {
        review: {
          requestId: 3,
        },
      },
    },
    HOSTED_PROMPT_CAPABILITIES
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
  assert.equal(reviewTraces[0]?.payload?.reason, "external-review-request");
  assert.equal(reviewTraces[0]?.payload?.requestId, 3);
  assert.deepEqual(
    persistedPreferences.at(-1),
    {
      activePromptTab: "review",
      activeTool: "prompts",
    },
    "external review handoff should let hosted persist prompt tab/tool activation even when the top snapshot is not already on prompts"
  );
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

function isUiPreferencesWriteRequest(request) {
  return request?.action === "storage.write-ui-preferences"
    || (request?.action === "capabilities.invoke" && request?.capabilityId === "panel.ui-preferences.write");
}

function readUiPreferencesPartial(request) {
  return request?.action === "capabilities.invoke" ? request?.input?.partial || {} : request?.partial || {};
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
