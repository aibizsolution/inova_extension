#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");

async function main() {
  await verifyInitialRenderWindowAndLoadMore();
  await verifyFilterResetAndExpandPreserveWindow();
  console.log("[verify-store-render-window] Store render window contract passed");
}

async function verifyInitialRenderWindowAndLoadMore() {
  const harness = createHarness();
  const initialState = harness.manager.buildViewState();

  assert.equal(initialState.items.length, 20);
  assert.equal(initialState.renderLimit, 20);
  assert.equal(initialState.renderedCount, 20);
  assert.equal(initialState.totalCount, 45);
  assert.equal(initialState.hasMore, true);

  const bodyHtml = harness.context.InovaBookmarks.storeView.renderBody(initialState);
  assert.equal(bodyHtml.includes("총 45개 · 20개 표시"), true);

  await harness.manager.handleAction("load-more");
  const nextState = harness.manager.buildViewState();

  assert.equal(nextState.items.length, 40);
  assert.equal(nextState.renderLimit, 40);
  assert.equal(nextState.renderedCount, 40);
  assert.equal(nextState.hasMore, true);
}

async function verifyFilterResetAndExpandPreserveWindow() {
  const harness = createHarness();

  await harness.manager.handleAction("load-more");
  await harness.manager.handleAction("load-more");
  assert.equal(harness.manager.buildViewState().renderLimit, 45);

  const previousRenderKey = harness.state.store.renderKey;
  await harness.manager.handleAction("set-sort", { sortBy: "likes" });
  const sortedState = harness.manager.buildViewState();

  assert.equal(sortedState.renderLimit, 20);
  assert.equal(sortedState.renderedCount, 20);
  assert.equal(sortedState.renderKey, previousRenderKey + 1);

  await harness.manager.handleAction("load-more");
  const expandedTargetId = harness.manager.buildViewState().items[5].entryId;
  await harness.manager.handleAction("toggle-expand", { entryId: expandedTargetId });
  const expandedState = harness.manager.buildViewState();

  assert.equal(expandedState.renderLimit, 40);
  assert.equal(expandedState.expandedEntryId, expandedTargetId);

  harness.manager.submitQuery("fixture");
  const queriedState = harness.manager.buildViewState();
  assert.equal(queriedState.renderLimit, 20);
  assert.equal(queriedState.renderKey, previousRenderKey + 2);
}

function createHarness() {
  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          if (message.type === "inova-store:view") {
            return {
              ok: true,
              data: {
                content: "상세 내용",
                updatedAt: "2026-04-11T10:00:00.000Z",
              },
            };
          }
          throw new Error(`Unexpected runtime message: ${message.type}`);
        },
      },
    },
    console,
    globalThis: null,
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;

  loadScript("shared/constants.js", context);
  loadScript("shared/session.js", context);
  loadScript("shared/prompt-store.js", context);
  loadScript("backup/legacy-panel/features/prompt-store/store-manager.js", context);
  loadScript("backup/legacy-panel/store-view.js", context);

  context.InovaBookmarks.panelDebug = { log() {} };
  context.InovaBookmarks.providerIdentity = {
    getCurrent() {
      return {
        available: true,
        providerUserKey: "fixture-user",
      };
    },
  };
  context.InovaBookmarks.storage = {
    async importStorePrompt(entry) {
      return { items: [entry] };
    },
  };

  const state = {
    promptLibrary: { items: [] },
    queries: { store: "" },
    store: {
      actionPending: null,
      appliedQuery: "",
      availableCategories: [{ id: "document" }, { id: "research-analysis" }],
      categoryId: "all",
      dataFreshness: "fresh",
      degraded: false,
      degradedReason: "",
      deleteConfirmEntryId: "",
      detailPendingEntryId: "",
      error: "",
      expandedEntryId: "",
      feedback: null,
      feedbackTimer: 0,
      hasMore: false,
      identityPending: false,
      items: context.InovaBookmarks.promptStore.normalizeStoreEntries(createEntries()),
      limit: 1000,
      loaded: true,
      loading: false,
      renderKey: 0,
      renderLimit: 20,
      scope: "all",
      searchTimer: 0,
      sortBy: "latest",
      source: "runtime-read",
      totalCount: 45,
    },
  };

  return {
    context,
    manager: context.InovaBookmarks.storeManager.create(state, {
      async loadStoreDetail(entryId) {
        return {
          content: `상세:${entryId}`,
          updatedAt: "2026-04-11T10:00:00.000Z",
        };
      },
      render() {},
      shouldUseStoreLatestRealtime() {
        return false;
      },
    }),
    state,
  };
}

function createEntries() {
  return Array.from({ length: 45 }, (_, index) => ({
    categoryId: index % 2 === 0 ? "document" : "research-analysis",
    categoryLabel: index % 2 === 0 ? "문서" : "리서치",
    content: index < 3 ? "" : `fixture content ${index + 1}`,
    entryId: `entry-${index + 1}`,
    hasDetail: index < 3,
    metrics: {
      importCount: 45 - index,
      likeCount: index,
      viewCount: index * 2,
    },
    owner: {
      displayName: "Fixture User",
      kind: "user",
      maskedEmail: "f***@example.com",
      providerUserKey: "fixture-user",
    },
    publishedAt: `2026-04-${String((index % 9) + 1).padStart(2, "0")}T08:00:00.000Z`,
    summary: `fixture summary ${index + 1}`,
    title: `fixture title ${index + 1}`,
    viewer: {
      imported: false,
      liked: false,
      viewed: false,
    },
  }));
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
