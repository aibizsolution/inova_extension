#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyPromptToolSelectionPersistsLibrary();
  await verifyStoreAliasSelectionLoadsStore();
  await verifyQueryRoutingAndToolState();
  await verifyReviewFloatAndSyncScheduling();
  console.log("[verify-panel-prompt-controller] Panel prompt controller contract passed");
}

async function verifyPromptToolSelectionPersistsLibrary() {
  const harness = createHarness({
    activePromptTab: "store",
    activeTool: "bookmarks",
    uiPreferenceTool: "bookmarks",
  });

  const handled = await harness.controller.selectTool("prompts");
  assert.equal(handled, true);
  assert.deepEqual(harness.selectPromptTabs, ["library"]);
  assert.equal(harness.state.activeTool, "prompts");
  assert.deepEqual(harness.persistSelections[0], {
    activePromptTab: "library",
    activeTool: "prompts",
  });
  assert.deepEqual(harness.promptTabSelections, ["library"]);
}

async function verifyStoreAliasSelectionLoadsStore() {
  const harness = createHarness();

  const handled = await harness.controller.selectTool("store");
  assert.equal(handled, true);
  assert.deepEqual(harness.selectPromptTabs, ["store"]);
  assert.equal(harness.ensureStoreLoadedCalls.length, 1);
  assert.deepEqual(harness.persistSelections[0], {
    activePromptTab: "store",
    activeTool: "prompts",
  });
}

async function verifyQueryRoutingAndToolState() {
  const harness = createHarness();

  assert.equal(harness.controller.updateQuery("prompts", "회의"), true);
  const promptToolState = harness.controller.buildToolState();
  assert.equal(harness.state.queries.prompts, "회의");
  assert.equal(harness.renderCalls.length, 1);
  assert.equal(promptToolState.promptTool.prompt.items.length, 1);
  assert.equal(promptToolState.promptCount, 2);

  assert.equal(harness.controller.updateQuery("store", "공개", { composing: true }), true);
  assert.equal(harness.state.queries.store, "공개");
  assert.deepEqual(harness.storeQueryCalls[0], {
    options: { composing: true },
    value: "공개",
  });

  assert.equal(harness.controller.submitQuery("store", "공개"), true);
  assert.deepEqual(harness.storeSubmitCalls, ["공개"]);

  harness.controller.handlePromptAction("save-prompt", { promptId: "prompt-1" });
  harness.controller.handleStoreAction("toggle-like", { entryId: "store-1" });
  harness.controller.handleDraftChange("title", "새 제목");
  harness.controller.handleImportFile({ name: "prompts.json" });
  harness.controller.movePromptItem("prompt-1", "prompt-2", "after");

  assert.deepEqual(harness.promptActionCalls[0], {
    action: "save-prompt",
    detail: { promptId: "prompt-1" },
  });
  assert.deepEqual(harness.storeActionCalls[0], {
    action: "toggle-like",
    detail: { entryId: "store-1" },
  });
  assert.deepEqual(harness.draftChanges[0], { field: "title", value: "새 제목" });
  assert.deepEqual(harness.importCalls, ["prompts.json"]);
  assert.deepEqual(harness.moveCalls[0], {
    dragPromptId: "prompt-1",
    placement: "after",
    targetPromptId: "prompt-2",
  });
}

async function verifyReviewFloatAndSyncScheduling() {
  const harness = createHarness({
    activePromptTab: "library",
    activeTool: "prompts",
    promptReviewState: { available: true, open: true, pending: false, textLength: 12 },
  });

  harness.controller.ensureReviewFloat();
  const reviewFloatState = harness.controller.buildReviewFloatState(false);
  assert.equal(reviewFloatState.open, true);
  assert.equal(reviewFloatState.visible, false);
  assert.equal(harness.ensureReviewFloatCalls.length, 1);

  harness.controller.scheduleRealtimeSync(260);
  harness.controller.scheduleCloudSyncIfNeeded(1800);
  assert.deepEqual(harness.realtimeScheduleCalls, [260]);
  assert.deepEqual(harness.cloudSyncScheduleCalls, [1800]);

  harness.context.document.visibilityState = "hidden";
  harness.state.open = false;
  harness.controller.scheduleCloudSyncIfNeeded(320);
  assert.deepEqual(harness.cloudSyncScheduleCalls, [1800]);

  harness.controller.handleStorageChange({ promptLibrary: { newValue: { items: [] } } }, "local");
  assert.deepEqual(harness.storageChangeCalls[0], {
    areaName: "local",
    changes: { promptLibrary: { newValue: { items: [] } } },
  });
}

function createHarness(options = {}) {
  const cloudSyncScheduleCalls = [];
  const draftChanges = [];
  const ensureReviewFloatCalls = [];
  const ensureStoreLoadedCalls = [];
  const importCalls = [];
  const moveCalls = [];
  const persistSelections = [];
  const promptActionCalls = [];
  const promptTabSelections = [];
  const realtimeScheduleCalls = [];
  const renderCalls = [];
  const selectPromptTabs = [];
  const storageChangeCalls = [];
  const storeActionCalls = [];
  const storeQueryCalls = [];
  const storeSubmitCalls = [];

  const context = vm.createContext({
    console,
    document: {
      visibilityState: "visible",
    },
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    cloudSync: {
      hasPendingPromptSync(cloudSyncState) {
        return Boolean(cloudSyncState?.pending?.revision);
      },
    },
    cloudSyncManager: {
      create() {
        return {
          handleRealtimeRemoteState() {},
          handleStorageChange(changes, areaName) {
            storageChangeCalls.push({
              areaName,
              changes: cloneValue(changes),
            });
          },
          markPromptLibraryFallback() {
            return Promise.resolve({});
          },
          scheduleSync(delay) {
            cloudSyncScheduleCalls.push(delay);
          },
        };
      },
    },
    composerReviewFloat: {
      ensure(config) {
        ensureReviewFloatCalls.push(config);
      },
    },
    promptHubRuntime: {
      create(state, runtimeOptions) {
        return {
          promptHubController: {
            handleEscape() {
              return true;
            },
            handlePromptAction(action, detail = {}) {
              promptActionCalls.push({ action, detail: cloneValue(detail) });
            },
            handleStoreAction(action, detail = {}) {
              storeActionCalls.push({ action, detail: cloneValue(detail) });
            },
            movePromptItem(dragPromptId, targetPromptId, placement) {
              moveCalls.push({ dragPromptId, placement, targetPromptId });
            },
            async selectPromptTab(promptTabId) {
              selectPromptTabs.push(promptTabId);
              const normalizedPromptTab = runtimeOptions.normalizePromptTab(promptTabId);
              state.activeTool = "prompts";
              state.uiPreferences = context.InovaBookmarks.storage.mergeUiPreferences(state.uiPreferences, {
                activePromptTab: normalizedPromptTab,
                activeTool: "prompts",
              });
              runtimeOptions.lockUiPreferenceSelection("prompts", normalizedPromptTab);
              runtimeOptions.onPromptTabSelected(normalizedPromptTab);
              realtimeScheduleCalls.push(120);
              if (normalizedPromptTab === "store") {
                ensureStoreLoadedCalls.push({ reason: "select-tab" });
              }
              runtimeOptions.render();
              await runtimeOptions.persistActiveTool("prompts", normalizedPromptTab);
            },
          },
          promptManager: {
            buildViewState(promptItems) {
              return {
                items: cloneValue(promptItems),
              };
            },
            handleImportFile(file) {
              importCalls.push(String(file?.name || ""));
            },
            updateDraft(field, value) {
              draftChanges.push({ field, value });
            },
          },
          promptRealtimeManager: {
            scheduleSync(delay) {
              realtimeScheduleCalls.push(delay);
            },
          },
          promptReviewManager: {
            buildViewState() {
              return cloneValue(options.promptReviewState || {
                available: true,
                open: false,
                pending: false,
                textLength: 0,
              });
            },
            handleAction() {},
          },
          storeManager: {
            buildViewState() {
              return {
                items: cloneValue(state.store.items),
              };
            },
            ensureLoaded(...args) {
              ensureStoreLoadedCalls.push(cloneValue(args));
            },
            handleQueryChange(value, queryOptions = {}) {
              storeQueryCalls.push({
                options: cloneValue(queryOptions),
                value,
              });
            },
            submitQuery(value) {
              storeSubmitCalls.push(value);
            },
          },
        };
      },
    },
    promptHubState: {
      buildPromptRenderState({ promptItems, promptManager, promptReviewManager, state: promptState, storeManager }) {
        const promptViewState = promptManager.buildViewState(promptItems);
        const reviewState = promptReviewManager.buildViewState();
        const activePromptTab = context.InovaBookmarks.promptHubState.getActivePromptTab(promptState, reviewState.open);
        const storeState = storeManager.buildViewState();
        const promptCount = Array.isArray(promptState.promptLibrary?.items) ? promptState.promptLibrary.items.length : 0;
        const storeCount = Math.max(0, Number(promptState.store?.totalCount) || promptState.store?.items?.length || 0);
        return {
          activePromptTab,
          promptCount,
          promptTool: {
            activeTab: activePromptTab,
            prompt: promptViewState,
            review: reviewState,
            store: storeState,
            tabs: [],
          },
          promptToolCount: activePromptTab === "store" ? storeCount : promptCount,
        };
      },
      getActivePromptTab(promptState, reviewOpen = promptState?.promptReview?.open) {
        const nextTab = promptState?.uiPreferences?.activeTool === "store"
          ? "store"
          : context.InovaBookmarks.promptHubState.normalizePromptTab(promptState?.uiPreferences?.activePromptTab);
        return nextTab === "review" && !reviewOpen ? "library" : nextTab;
      },
      normalizePromptTab(promptTabId) {
        return promptTabId === "store" || promptTabId === "review" ? promptTabId : "library";
      },
      shouldRunPromptCloudSync(promptState, args = {}) {
        return Boolean(
          args.hasPendingPromptSync?.(promptState.cloudSync)
          || (
            promptState.open
            && promptState.activeTool === "prompts"
            && context.InovaBookmarks.promptHubState.getActivePromptTab(promptState, promptState.promptReview?.open) === "library"
            && args.isToolSurface?.()
            && args.visibilityState === "visible"
          )
        );
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      mergeUiPreferences(current = {}, patch = {}) {
        return {
          activePromptTab: "library",
          activeTool: "bookmarks",
          ...cloneValue(current),
          ...cloneValue(patch),
        };
      },
      async updateUiPreferences(patch = {}) {
        return {
          activePromptTab: "library",
          activeTool: "bookmarks",
          ...cloneValue(patch),
        };
      },
    },
  };

  loadScript("backup/legacy-panel/panel-prompt-controller.js", context);

  const state = {
    activeTool: options.activeTool || "prompts",
    cloudSync: cloneValue(options.cloudSync || {}),
    open: options.open == null ? true : Boolean(options.open),
    promptLibrary: {
      items: [
        { content: "회의 내용을 정리해 줘", id: "prompt-1", title: "회의 정리" },
        { content: "릴리스 노트를 요약해 줘", id: "prompt-2", title: "릴리스 요약" },
      ],
    },
    promptLibraryRemoteReady: options.promptLibraryRemoteReady == null ? true : Boolean(options.promptLibraryRemoteReady),
    promptReview: {
      open: Boolean(options.promptReviewState?.open),
    },
    queries: {
      prompts: "",
      store: "",
    },
    settings: {
      enabled: true,
    },
    store: {
      items: [{ entryId: "store-1", title: "공개 프롬프트" }],
      totalCount: 2,
    },
    uiPreferences: {
      activePromptTab: options.activePromptTab || "library",
      activeTool: options.uiPreferenceTool || options.activeTool || "prompts",
    },
  };

  const controller = context.InovaBookmarks.panelPromptController.create(state, {
    isPaused() {
      return false;
    },
    isToolSurface() {
      return true;
    },
    lockUiPreferenceSelection(activeTool, activePromptTab) {
      state.uiPreferenceLock = { activePromptTab, activeTool };
    },
    onPromptTabSelected(promptTabId) {
      promptTabSelections.push(promptTabId);
    },
    async persistActiveTool(nextTool, nextPromptTab) {
      const nextSelection = {
        activePromptTab: nextPromptTab,
        activeTool: nextTool,
      };
      persistSelections.push(cloneValue(nextSelection));
      state.uiPreferences = await context.InovaBookmarks.storage.updateUiPreferences(nextSelection);
    },
    render() {
      renderCalls.push(true);
    },
  });

  return {
    cloudSyncScheduleCalls,
    context,
    controller,
    draftChanges,
    ensureReviewFloatCalls,
    ensureStoreLoadedCalls,
    importCalls,
    moveCalls,
    persistSelections,
    promptActionCalls,
    promptTabSelections,
    realtimeScheduleCalls,
    renderCalls,
    selectPromptTabs,
    state,
    storageChangeCalls,
    storeActionCalls,
    storeQueryCalls,
    storeSubmitCalls,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-panel-prompt-controller] ${error.stack || error.message}`);
  process.exit(1);
});
