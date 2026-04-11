#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  const harness = createHarness();
  await harness.flush();

  assert(harness.callbacks, "Panel callbacks should be registered");
  assert.equal(typeof harness.callbacks.onMeetingAction, "function");
  assert.equal(typeof harness.callbacks.onPromptAction, "function");
  assert.equal(typeof harness.callbacks.onSelectTool, "function");
  assert.equal(typeof harness.callbacks.onToggle, "function");

  const initialPayload = harness.renderPayloads.at(-1);
  assert(initialPayload, "Panel should render at least once");
  assert.equal(initialPayload.meetingTool.count, 2);
  assert.equal(initialPayload.bookmarksTool.count, 1);
  assert.equal(initialPayload.promptTool.activeTab, "library");
  assert.equal(initialPayload.panelDebug.enabled, true);
  assert.equal(initialPayload.tools.length, 4);
  assert.equal(harness.reviewFloatEnsured, 1);
  assert.equal(harness.reviewFloatStates.at(-1)?.visible, true);

  await harness.callbacks.onCopyBookmark("bookmark-1");
  harness.callbacks.onJumpBookmark("bookmark-1");
  await harness.callbacks.onHandlePositionChange(0.61);
  harness.callbacks.onSearch("bookmarks", "회의");
  harness.callbacks.onSearchSubmit("bookmarks", "회의");

  assert.deepEqual(harness.bookmarkCopyCalls, ["bookmark-1"]);
  assert.deepEqual(harness.bookmarkJumpCalls, ["bookmark-1"]);
  assert.deepEqual(harness.handlePositionCalls, [0.61]);
  assert.deepEqual(harness.shellQueries, [{ options: {}, toolId: "bookmarks", value: "회의" }]);
  assert.deepEqual(harness.shellSubmitQueries, [{ toolId: "bookmarks", value: "회의" }]);

  await harness.callbacks.onMeetingAction("debug-toggle", {});
  assert.deepEqual(harness.debugActions, ["debug-toggle"]);
  assert.deepEqual(harness.meetingActions, []);

  await harness.callbacks.onMeetingAction("share", { meetingId: "meeting-alpha" });
  assert.deepEqual(harness.meetingActions, [{ action: "share", detail: { meetingId: "meeting-alpha" } }]);

  harness.callbacks.onPromptAction("save-prompt", { promptId: "prompt-1" });
  harness.callbacks.onPromptDraftChange("title", "새 제목");
  harness.callbacks.onSelectPromptTab("store");

  assert.deepEqual(harness.promptActions, [{ action: "save-prompt", detail: { promptId: "prompt-1" } }]);
  assert.deepEqual(harness.promptDrafts, [{ field: "title", value: "새 제목" }]);
  assert.deepEqual(harness.promptTabSelections, ["store"]);

  harness.callbacks.onToggle(false);
  assert.deepEqual(harness.toggleCalls, [false]);

  await harness.callbacks.onSelectTool("release");
  const releasePayload = harness.renderPayloads.at(-1);
  assert.equal(releasePayload.activeTool, "release");
  assert.equal(releasePayload.toolTitle, "릴리스 안내");
  assert.deepEqual(harness.shellToolSelections, ["release"]);

  console.log("[verify-panel-shell] Panel shell assembly contract passed");
}

function createHarness() {
  const controllerEvents = {
    bookmarkCopyCalls: [],
    bookmarkJumpCalls: [],
    debugActions: [],
    handlePositionCalls: [],
    meetingActions: [],
    promptActions: [],
    promptDrafts: [],
    promptTabSelections: [],
    reviewFloatStates: [],
    shellQueries: [],
    shellSubmitQueries: [],
    shellToolSelections: [],
    toggleCalls: [],
  };
  const ensureCalls = [];
  const renderPayloads = [];
  const scheduledTimeouts = [];
  const storageListeners = [];

  const context = vm.createContext({
    chrome: {
      storage: {
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
        },
      },
    },
    console,
    document: {
      addEventListener() {},
      visibilityState: "visible",
    },
    globalThis: null,
    innerWidth: 1280,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    setTimeout(callback, delay) {
      scheduledTimeouts.push({ callback, delay });
      return scheduledTimeouts.length;
    },
  });
  context.globalThis = context;
  context.addEventListener = () => {};

  context.InovaBookmarks = buildNamespace({
    controllerEvents,
    ensureCalls,
    renderPayloads,
  });

  loadScript("content/main.js", context);

  return {
    bookmarkCopyCalls: controllerEvents.bookmarkCopyCalls,
    bookmarkJumpCalls: controllerEvents.bookmarkJumpCalls,
    callbacks: ensureCalls[0]?.callbacks || null,
    debugActions: controllerEvents.debugActions,
    handlePositionCalls: controllerEvents.handlePositionCalls,
    meetingActions: controllerEvents.meetingActions,
    promptActions: controllerEvents.promptActions,
    promptDrafts: controllerEvents.promptDrafts,
    promptTabSelections: controllerEvents.promptTabSelections,
    renderPayloads,
    reviewFloatEnsured: controllerEvents.reviewFloatEnsured || 0,
    reviewFloatStates: controllerEvents.reviewFloatStates,
    shellQueries: controllerEvents.shellQueries,
    shellSubmitQueries: controllerEvents.shellSubmitQueries,
    shellToolSelections: controllerEvents.shellToolSelections,
    storageListeners,
    toggleCalls: controllerEvents.toggleCalls,
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function buildNamespace({ controllerEvents, ensureCalls, renderPayloads }) {
  const namespace = {
    cloudSync: {
      mergeCloudSyncState() {
        return {
          providerIdentity: {
            available: true,
            providerUserKey: "fixture-user",
          },
        };
      },
    },
    composerReviewFloat: {
      render(payload) {
        controllerEvents.reviewFloatStates.push(cloneValue(payload));
      },
    },
    constants: {
      defaults: {
        meetingHub: { items: [] },
        promptReview: { open: false },
        settings: {
          autoBookmark: true,
          enabled: true,
          meetingDebug: true,
        },
        uiPreferences: {
          activePromptTab: "library",
          activeTool: "meeting",
        },
      },
    },
    contentDom: {
      getConversationState() {
        return {
          articleCount: 1,
          hasChatLog: true,
          hasComposer: true,
          userCount: 1,
        };
      },
    },
    contentPanel: {
      ensurePanel(callbacks) {
        ensureCalls.push({ callbacks });
        return {};
      },
      renderPanel(payload) {
        renderPayloads.push(cloneValue(payload));
      },
    },
    panelBookmarkController: {
      create() {
        return {
          buildToolState() {
            return {
              activeId: "",
              count: 1,
              emptyText: "",
              items: [{ id: "bookmark-1" }],
              metaText: "",
              query: "",
            };
          },
          async copyBookmarkText(bookmarkId) {
            controllerEvents.bookmarkCopyCalls.push(bookmarkId);
            return true;
          },
          jumpToBookmark(bookmarkId) {
            controllerEvents.bookmarkJumpCalls.push(bookmarkId);
          },
        };
      },
    },
    panelDebug: {
      subscribe() {},
    },
    panelDebugController: {
      create() {
        return {
          buildState() {
            return {
              collapsed: false,
              enabled: true,
              hasErrors: false,
              statusSummary: { totalLogs: 0 },
            };
          },
          handleAction(action) {
            controllerEvents.debugActions.push(action);
            return Promise.resolve(true);
          },
          handlesAction(action) {
            return String(action || "").startsWith("debug");
          },
          installValidationApi() {},
          syncEnabled() {},
        };
      },
      readCollapsedPreference() {
        return false;
      },
    },
    panelLifecycleController: {
      create() {
        return {
          handleVisibilityChange() {},
          handleWindowFocus() {},
          initializeOpenState() {},
          installSurfaceWatchers() {},
          togglePanel(nextOpen) {
            controllerEvents.toggleCalls.push(nextOpen);
          },
        };
      },
    },
    panelMeetingController: {
      create(state) {
        return {
          buildToolState() {
            return {
              count: 2,
              feedback: state.meetingUi.feedback,
              items: [{ meetingId: "meeting-alpha" }, { meetingId: "meeting-beta" }],
              pending: state.meetingUi.pending,
            };
          },
          handleAction(action, detail) {
            controllerEvents.meetingActions.push({ action, detail: cloneValue(detail) });
            return Promise.resolve();
          },
        };
      },
    },
    panelPromptController: {
      create() {
        return {
          buildReviewFloatState(visible) {
            return {
              open: false,
              visible,
            };
          },
          buildToolState() {
            return {
              promptCount: 1,
              promptTool: { activeTab: "library", tabs: [] },
              promptToolCount: 1,
            };
          },
          ensureReviewFloat() {
            controllerEvents.reviewFloatEnsured = (controllerEvents.reviewFloatEnsured || 0) + 1;
          },
          ensureStoreLoaded() {},
          handleDraftChange(field, value) {
            controllerEvents.promptDrafts.push({ field, value });
          },
          handleEscape() {
            return false;
          },
          handleImportFile() {},
          handlePromptAction(action, detail) {
            controllerEvents.promptActions.push({ action, detail: cloneValue(detail) });
          },
          handleStorageChange() {},
          handleStoreAction() {},
          movePromptItem() {},
          scheduleCloudSyncIfNeeded() {},
          scheduleRealtimeSync() {},
          selectPromptTab(promptTabId) {
            controllerEvents.promptTabSelections.push(promptTabId);
          },
          async selectTool(toolId) {
            return toolId === "prompts" || toolId === "store";
          },
        };
      },
    },
    panelShellController: {
      create(state, deps) {
        return {
          buildRenderChrome(counts) {
            const releaseCount = Number(counts.release) || 0;
            const bookmarkCount = Number(counts.bookmarks) || 0;
            const meetingCount = Number(counts.meeting) || 0;
            const promptCount = Number(counts.prompts) || 0;
            const promptToolCount = Number(counts.promptTool) || 0;
            const toolCount = state.activeTool === "prompts"
              ? promptToolCount
              : state.activeTool === "meeting"
                  ? meetingCount
                  : state.activeTool === "release"
                      ? releaseCount
                      : bookmarkCount;
            return {
              handleCount: state.activeTool === "bookmarks"
                ? bookmarkCount || promptCount || meetingCount || releaseCount
                : toolCount,
              toolCount,
              toolTitle: state.activeTool === "prompts"
                ? "프롬프트"
                : state.activeTool === "meeting"
                    ? "회의 룸"
                    : state.activeTool === "release"
                        ? "릴리스 안내"
                        : "대화 탐색",
              tools: [
                { count: bookmarkCount, id: "bookmarks", label: "대화" },
                { count: meetingCount, id: "meeting", label: "회의 룸" },
                { count: promptCount, id: "prompts", label: "프롬프트" },
                { count: releaseCount, id: "release", label: "릴리스" },
              ],
            };
          },
          lockUiPreferenceSelection() {},
          normalizeToolId(toolId) {
            return toolId === "release" || toolId === "prompts" || toolId === "meeting"
              ? toolId
              : toolId === "store"
                  ? "prompts"
                  : "bookmarks";
          },
          async persistActiveTool() {},
          async selectTool(toolId) {
            controllerEvents.shellToolSelections.push(toolId);
            const promptController = deps.getPromptController?.();
            if (promptController && await promptController.selectTool(toolId)) {
              return true;
            }
            state.activeTool = toolId === "release" || toolId === "meeting" ? toolId : "bookmarks";
            deps.render?.();
            return true;
          },
          submitQuery(toolId, value) {
            controllerEvents.shellSubmitQueries.push({ toolId, value });
            return true;
          },
          async updateHandlePosition(ratio) {
            controllerEvents.handlePositionCalls.push(ratio);
          },
          updateQuery(toolId, value, options = {}) {
            controllerEvents.shellQueries.push({ options: cloneValue(options), toolId, value });
            return true;
          },
        };
      },
    },
    promptLibrary: {
      mergePromptLibrary() {
        return {
          items: [{ content: "본문", title: "프롬프트" }],
        };
      },
    },
    providerIdentitySync: {
      create() {
        return {
          syncToStorage() {
            return Promise.resolve(false);
          },
        };
      },
    },
    releaseInfo: {
      mergeReleaseInfo() {
        return {};
      },
    },
    releaseManager: {
      create() {
        return {
          buildViewState() {
            return { updateAvailable: false };
          },
          ensureChecked() {},
          handleAction() {},
          handleStorageChange() {},
        };
      },
    },
    routeStateController: {
      create(state) {
        return {
          handleStorageChange() {
            return false;
          },
          async refreshState() {
            state.bookmarks = [{ id: "bookmark-1", normalizedText: "hello", text: "Hello" }];
          },
          resetRouteState(nextSessionId) {
            state.sessionId = nextSessionId || "";
          },
        };
      },
    },
    routeSync: {
      create(state, hooks) {
        return {
          installRouteWatchers() {},
          scheduleRefresh() {},
          async syncRouteState() {
            hooks.resetRouteState("session-1", "");
            await hooks.refreshState();
            hooks.render();
          },
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      getHandleRatio() {
        return 0.4;
      },
      mergeUiPreferences(current = {}, patch = {}) {
        return {
          activePromptTab: "library",
          activeTool: "meeting",
          handleRatios: {},
          ...cloneValue(current || {}),
          ...cloneValue(patch || {}),
        };
      },
    },
  };

  namespace.meetingManager = {
    create(state, hooks) {
      return {
        handleRouteStateChange() {
          hooks.render();
        },
        handleStorageChange() {},
        scheduleSync() {},
      };
    },
  };

  return namespace;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-panel-shell] ${error.stack || error.message}`);
  process.exit(1);
});
