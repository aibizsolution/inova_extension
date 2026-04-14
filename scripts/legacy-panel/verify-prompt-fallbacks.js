#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");

async function main() {
  await verifyStoreRuntimeFallbackFreshensState();
  await verifyStoreEmptyFailureStaysExplicit();
  await verifyPromptLibraryFallbackSurfacesDegradedState();
  await verifyReleaseCachedFailureStaysDegraded();
  console.log("[verify-prompt-fallbacks] Prompt/store/release fallback contract passed");
}

async function verifyStoreRuntimeFallbackFreshensState() {
  const harness = createStoreHarness({
    runtimeMode: "success",
    runtimeItems: [createStoreEntry("entry-runtime", "요청형 최신 목록")],
  });
  harness.state.store.items = [createStoreEntry("entry-cache", "캐시된 목록")];
  harness.state.store.loaded = true;
  harness.state.store.totalCount = 1;

  assert.equal(harness.manager.markRealtimeFallback(new Error("실시간 구독 실패")), true);
  assert.equal(harness.state.store.degraded, true);
  assert.equal(harness.state.store.degradedReason, "store-stale-cache");
  assert.equal(harness.state.store.dataFreshness, "stale");
  assert.equal(harness.state.store.source, "cache");

  await harness.manager.ensureLoaded(true, "fallback");

  assert.equal(harness.state.store.items[0].entryId, "entry-runtime");
  assert.equal(harness.state.store.degraded, true);
  assert.equal(harness.state.store.degradedReason, "store-realtime-failed");
  assert.equal(harness.state.store.dataFreshness, "fresh");
  assert.equal(
    ["실시간 구독 실패", "스토어 최신 목록을 실시간으로 불러오지 못했어요."].includes(harness.state.store.error),
    true
  );
  assert.equal(harness.state.store.source, "runtime-read");
}

async function verifyStoreEmptyFailureStaysExplicit() {
  const harness = createStoreHarness({
    runtimeMode: "error",
  });

  assert.equal(harness.manager.markRealtimeFallback(new Error("실시간 구독 실패")), false);
  await harness.manager.ensureLoaded(true, "fallback");

  assert.equal(harness.state.store.items.length, 0);
  assert.equal(harness.state.store.degraded, true);
  assert.equal(harness.state.store.degradedReason, "store-empty");
  assert.equal(harness.state.store.dataFreshness, "empty");
  assert.equal(harness.state.store.source, "none");
  assert.equal(
    ["스토어 요청형 읽기 실패", "Error: 스토어 요청형 읽기 실패"].includes(harness.state.store.error),
    true
  );
}

async function verifyPromptLibraryFallbackSurfacesDegradedState() {
  const context = createBaseContext();
  loadScript("shared/constants.js", context);
  loadScript("shared/session.js", context);
  loadScript("shared/cloud-sync.js", context);
  loadScript("backup/legacy-panel/shared/prompt-cloud-sync.js", context);
  loadScript("backup/legacy-panel/features/prompt-library/cloud-sync-manager.js", context);

  const namespace = context.InovaBookmarks;
  const state = {
    cloudSync: namespace.cloudSync.mergeCloudSyncState(),
    promptLibrary: {
      items: [{ content: "본문", id: "prompt-1", title: "요청 1", updatedAt: "2026-04-04T08:00:00.000Z" }],
    },
  };

  namespace.providerIdentity = {
    getCurrent() {
      return {
        available: true,
        displayName: "Fixture User",
        email: "fixture@example.com",
        numericUserId: 1001,
        provider: "inova",
        providerUserKey: "fixture-user",
      };
    },
  };
  namespace.storage = {
    async setPromptSyncDegraded(errorMessage, providerIdentity, options = {}) {
      state.cloudSync = namespace.cloudSync.setPromptSyncDegraded(state.cloudSync, errorMessage, providerIdentity, options);
      return namespace.cloudSync.mergeCloudSyncState(state.cloudSync);
    },
  };

  const manager = namespace.cloudSyncManager.create(state, {
    render() {},
  });
  const degraded = await manager.markPromptLibraryFallback(new Error("프롬프트 bridge 실패"), {
    degradedReason: "prompt-library-realtime-failed",
    source: "realtime",
  });

  assert.equal(degraded.degraded, true);
  assert.equal(degraded.degradedReason, "prompt-library-realtime-failed");
  assert.equal(degraded.dataFreshness, "stale");
  assert.equal(degraded.source, "realtime");
  assert.equal(
    ["프롬프트 bridge 실패", "Error: 프롬프트 bridge 실패"].includes(degraded.lastError),
    true
  );
}

async function verifyReleaseCachedFailureStaysDegraded() {
  const context = createBaseContext({
    chrome: {
      runtime: {
        async sendMessage() {
          throw new Error("릴리스 fetch 실패");
        },
        getManifest() {
          return { version: "0.3.21" };
        },
      },
    },
  });
  loadScript("shared/constants.js", context);
  loadScript("shared/session.js", context);
  loadScript("backup/legacy-panel/shared/release-info.js", context);
  loadScript("backup/legacy-panel/release-manager.js", context);

  const namespace = context.InovaBookmarks;
  namespace.storage = {
    async setReleaseInfo(nextReleaseInfo) {
      return namespace.releaseInfo.mergeReleaseInfo(nextReleaseInfo);
    },
  };
  namespace.panelDebug = { log() {} };

  const state = {
    releaseInfo: namespace.releaseInfo.mergeReleaseInfo({
      checkedAt: "2026-04-04T08:00:00.000Z",
      checkedForVersion: "0.3.21",
      history: [{ version: "0.3.20", headline: "이전 배포", summary: "이전 요약" }],
      latest: { version: "0.3.21", headline: "현재 배포", summary: "현재 요약" },
      source: "runtime-read",
    }),
  };

  const manager = namespace.releaseManager.create(state, {
    render() {},
  });
  await manager.ensureChecked(true, true);
  const viewState = manager.buildViewState();

  assert.equal(viewState.degraded, true);
  assert.equal(viewState.degradedReason, "release-fetch-failed");
  assert.equal(viewState.dataFreshness, "stale");
  assert.equal(viewState.source, "cache");
  assert.equal(
    ["릴리스 fetch 실패", "릴리스 정보를 확인하지 못했어요."].includes(viewState.error),
    true
  );
}

function createStoreHarness(options = {}) {
  const context = createBaseContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          if (message.type !== "inova-store:list") {
            throw new Error(`Unexpected runtime message: ${message.type}`);
          }
          if (options.runtimeMode === "error") {
            throw new Error("스토어 요청형 읽기 실패");
          }
          return {
            ok: true,
            data: {
              availableCategories: [{ id: "document" }],
              items: options.runtimeItems || [],
              totalCount: Array.isArray(options.runtimeItems) ? options.runtimeItems.length : 0,
            },
          };
        },
      },
    },
  });

  loadScript("shared/constants.js", context);
  loadScript("shared/session.js", context);
  loadScript("shared/prompt-store.js", context);
  loadScript("backup/legacy-panel/features/prompt-store/store-manager.js", context);

  const namespace = context.InovaBookmarks;
  namespace.providerIdentity = {
    getCurrent() {
      return {
        available: true,
        providerUserKey: "fixture-user",
      };
    },
  };
  namespace.storage = {
    async importStorePrompt(entry) {
      return { items: [entry] };
    },
  };
  namespace.panelDebug = { log() {} };

  const state = {
    promptLibrary: { items: [] },
    queries: { store: "" },
    store: {
      actionPending: null,
      appliedQuery: "",
      availableCategories: [],
      categoryId: "all",
      dataFreshness: "empty",
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
      items: [],
      limit: 1000,
      loaded: false,
      loading: false,
      ownerScope: "all",
      scope: "all",
      searchTimer: 0,
      sortBy: "latest",
      source: "none",
      totalCount: 0,
    },
  };

  return {
    manager: namespace.storeManager.create(state, {
      render() {},
      shouldUseStoreLatestRealtime() {
        return false;
      },
    }),
    state,
  };
}

function createStoreEntry(entryId, title) {
  return {
    categoryId: "document",
    content: `${title} 본문`,
    entryId,
    owner: {
      displayName: "Fixture User",
      kind: "user",
      maskedEmail: "fixture@...",
      providerUserKey: "fixture-user",
    },
    publishedAt: "2026-04-04T08:00:00.000Z",
    summary: `${title} 요약`,
    title,
    updatedAt: "2026-04-04T08:05:00.000Z",
    viewer: {},
  };
}

function createBaseContext(overrides = {}) {
  const base = {
    chrome: {
      runtime: {
        async sendMessage() {
          return { ok: true, data: {} };
        },
        getManifest() {
          return { version: "0.3.21" };
        },
      },
    },
    console,
    clearTimeout() {},
    setTimeout(callback) {
      callback();
      return 1;
    },
    globalThis: null,
    structuredClone: cloneValue,
  };
  const context = vm.createContext(deepMerge(base, overrides));
  context.globalThis = context;
  return context;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function deepMerge(base, patch) {
  const left = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const right = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(left[key], value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-prompt-fallbacks] ${error.stack || error.message}`);
  process.exit(1);
});
