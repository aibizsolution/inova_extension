#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const {
  verifyHostedMeetingVisibilityRecoveryContract,
  verifyHostedMeetingSnapshotSyncGuardContract,
} = require("./verify-hosted-panel-runtime-contracts");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyHostedPanelHostBatching();
  verifyLocalPanelRuntimeSwitch();
  verifyPageBridgeEvents();
  verifyHostedPanelImeCompositionGuard();
  verifyHostedMeetingActionCompletionTraceContract();
  verifyHostedStartupStatusCardDelayContract();
  verifyHostedMeetingSummarySyncContract();
  verifyHostedMeetingSnapshotSyncGuardContract();
  verifyHostedMeetingVisibilityRecoveryContract();
  verifyHostedPromptTabOwnershipContract();
  verifyHostedPromptActionOwnershipContract();
  verifyHostedConversationSearchDebounceContract();
  verifyHostedStoreSearchDebounceContract();
  verifyBookmarkJumpAccessibilityContract();
  verifyHostedPromptReviewFallbackContract();
  await verifyHostedReleaseLocalDownloadUrls();
  await verifyPageAdapterContract();
  console.log("[verify-panel-render] Hosted panel host contract passed");
}

function verifyHostedPanelHostBatching() {
  const harness = createHarness();
  const stateA = createPanelState({
    handleCount: 1,
    open: true,
  });
  const stateB = createPanelState({
    bookmarksTool: {
      activeId: "bookmark-2",
      count: 2,
    },
    handleCount: 2,
    open: false,
  });

  harness.render(stateA);
  harness.render(stateB);

  assert.equal(harness.animationFrames.length, 1, "renderPanel should batch multiple renders into one frame");

  harness.flushFrame();

  assert.equal(harness.handleCount.textContent, "2");
  assert.equal(harness.root.dataset.open, "false");
  assert.equal(
    harness.frame.getAttribute("src"),
    "https://browser-extension-main.web.app/extension/panel/index.html"
  );
  assert.deepEqual(harness.bridge.allowedOrigins, ["https://browser-extension-main.web.app"]);
  assert.deepEqual(harness.bridge.resets, ["frame-src-change"]);

  harness.bridge.options.onReadyChange({ ready: true });
  const snapshot = harness.bridge.snapshots.at(-1);
  assert(snapshot, "bridge should receive a snapshot once ready");
  assert.equal(snapshot.panel.bookmarksTool.activeId, "bookmark-2");
  assert(snapshot.extensionCapabilities.includes("panel.snapshot.v1"));
}

function verifyLocalPanelRuntimeSwitch() {
  const harness = createHarness();
  harness.render(createPanelState({
    settings: {
      meetingWorkspaceTarget: "local",
      meetingWorkspaceUrlOverride: "http://127.0.0.1:5000/meeting/index.html",
    },
  }));
  harness.flushFrame();

  assert.equal(
    harness.frame.getAttribute("src"),
    "http://127.0.0.1:5000/extension/panel/index.html"
  );
  assert.deepEqual(harness.bridge.allowedOrigins, ["http://127.0.0.1:5000"]);
}

function verifyPageBridgeEvents() {
  const harness = createHarness();
  harness.ensure();

  harness.context.InovaBookmarks.contentPanel.setActiveBookmark("bookmark-alpha");
  harness.context.InovaBookmarks.contentPanel.focusBookmark("bookmark-alpha");

  assert.deepEqual(harness.bridge.events, [
    {
      domain: "page",
      payload: {
        action: "set-active-bookmark",
        bookmarkId: "bookmark-alpha",
      },
    },
    {
      domain: "page",
      payload: {
        action: "focus-bookmark",
        bookmarkId: "bookmark-alpha",
      },
    },
  ]);
}

function verifyHostedPanelImeCompositionGuard() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("inputComposition: createInputCompositionState()"),
    "hosted panel should track text composition across hosted inputs"
  );
  assert(
    hostedPanelSource.includes("function getTextInputBinding(target)"),
    "hosted panel should resolve searchable and editable text inputs through a shared binding helper"
  );
  assert(
    hostedPanelSource.includes('kind: "prompt-field"'),
    "hosted panel IME guard should cover prompt editor fields"
  );
  assert(
    hostedPanelSource.includes('kind: "prompt-publish-field"'),
    "hosted panel IME guard should cover prompt publish fields"
  );
  assert(
    hostedPanelSource.includes('kind: "search"'),
    "hosted panel IME guard should cover hosted search fields"
  );
  assert(
    hostedPanelSource.includes("applyTextInputBinding(binding, { composing: false })"),
    "hosted panel should commit the final text input value after composition ends"
  );
  assert(
    hostedPanelSource.includes('binding.field === "category-label"'),
    "hosted panel should route custom publish category input through the shared IME-safe text binding"
  );
  assert(
    hostedPanelSource.includes("state.renderDeferred = true;"),
    "hosted panel should defer rerenders while composition is active"
  );
}

function verifyHostedMeetingActionCompletionTraceContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    !hostedPanelSource.includes('action: "meeting-action"'),
    "v2 hosted meeting actions should not fall back to the top-panel meeting-action request path"
  );
  assert(
    hostedPanelSource.includes("meetingHubController.handleMeetingAction(meetingAction, detail)"),
    "v2 hosted meeting actions should stay inside the hosted meeting hub controller"
  );
}

function verifyHostedStartupStatusCardDelayContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("const STARTUP_STATUS_CARD_DELAY_MS = 450;"),
    "hosted panel should defer startup status cards to avoid flashing an info box during normal boot"
  );
  assert(
    hostedPanelSource.includes("startupStatusTimerId: 0,"),
    "hosted panel should track a startup status timer"
  );
  assert(
    hostedPanelSource.includes("startupStatusShown: false,"),
    "hosted panel should track whether the delayed startup card is already visible"
  );
  assert(
    hostedPanelSource.includes("scheduleStartupStatusCard();"),
    "hosted panel should schedule the startup status card instead of rendering it immediately"
  );
  assert(
    hostedPanelSource.includes("clearStartupStatusCard();"),
    "hosted panel should clear pending startup status cards when the extension snapshot arrives"
  );
}

function verifyHostedMeetingSummarySyncContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
  const meetingRequestHelperSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-meeting-request.js"),
    "utf8"
  );
  const bootstrapSource = fs.readFileSync(
    path.join(root, "content", "panel-bootstrap-controller.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes('action: "meeting-summary-sync"'),
    "hosted meeting hub should be able to sync a compact summary back to the top panel"
  );
  assert(
    meetingRequestHelperSource.includes('if (action === "meeting-summary-sync") {'),
    "top panel bridge should accept hosted meeting summary sync requests through the dedicated helper module"
  );
  assert(
    bootstrapSource.includes("onMeetingSummarySync: handlePanelMeetingSummarySync"),
    "panel bootstrap should forward hosted meeting summary sync callbacks into the top-panel bridge"
  );
}

function verifyHostedPromptTabOwnershipContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    !hostedPanelSource.includes('action: "prompt-tab-select"'),
    "v2 hosted prompt tab selection should not fall back to the top-panel prompt-tab-select request path"
  );
}

function verifyHostedPromptActionOwnershipContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    !hostedPanelSource.includes('action: "prompt-action"'),
    "v2 hosted prompt panel should not fall back to the top-panel prompt-action request path"
  );
  assert(
    !hostedPanelSource.includes('action: "prompt-draft-change"'),
    "v2 hosted prompt panel should not fall back to the top-panel prompt-draft-change request path"
  );
  assert(
    !hostedPanelSource.includes('action: "store-action"'),
    "v2 hosted prompt panel should not fall back to the top-panel store-action request path"
  );
  assert(
    !hostedPanelSource.includes('action: "import-file"'),
    "v2 hosted prompt panel should not fall back to the top-panel import-file request path"
  );
  assert(
    !hostedPanelSource.includes('action: "move-prompt"'),
    "v2 hosted prompt panel should not fall back to the top-panel move-prompt request path"
  );
}

function verifyHostedConversationSearchDebounceContract() {
  const conversationControllerSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "conversation-controller.js"),
    "utf8"
  );

  assert(
    conversationControllerSource.includes("searchRenderTimerId: 0"),
    "hosted conversation controller should track a deferred search render timer"
  );
  assert(
    conversationControllerSource.includes("const nextQuery = String(value ?? \"\")"),
    "hosted conversation search should keep the raw search text until filtering"
  );
  assert(
    conversationControllerSource.includes("scheduleSearchRender();"),
    "hosted conversation search should defer rerenders instead of rendering on each keystroke"
  );
  assert(
    conversationControllerSource.includes("function scheduleSearchRender()"),
    "hosted conversation controller should expose a shared deferred search render helper"
  );
  assert(
    conversationControllerSource.includes("const explicitFingerprint = normalizeText(bookmarksTool?.snapshotFingerprint);"),
    "hosted conversation controller should accept a compact snapshot fingerprint from the top panel"
  );
}

function verifyHostedStoreSearchDebounceContract() {
  const promptStoreControllerSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-store-controller.js"),
    "utf8"
  );

  assert(
    promptStoreControllerSource.includes("searchRenderTimerId: 0"),
    "hosted store controller should track a deferred search render timer"
  );
  assert(
    promptStoreControllerSource.includes("scheduleSearchRender();"),
    "hosted store search should defer rerenders during typing"
  );
  assert(
    promptStoreControllerSource.includes("if (state.searchRenderTimerId) {"),
    "hosted store search should clear pending deferred renders before submit"
  );
  assert(
    promptStoreControllerSource.includes("if (state.query === nextQuery && !options.submit)"),
    "hosted store search should avoid redundant rerenders for repeated values"
  );
}

function verifyBookmarkJumpAccessibilityContract() {
  const hostedBookmarkSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "bookmark-view.js"),
    "utf8"
  );
  const contentBookmarkSource = fs.readFileSync(
    path.join(root, "content", "bookmark-view.js"),
    "utf8"
  );

  assert(
    hostedBookmarkSource.includes('<div class="bookmark-jump" data-bookmark-id="${bookmark.id}">'),
    "hosted bookmark list should render a non-focusable bookmark jump container"
  );
  assert(
    !hostedBookmarkSource.includes('class="bookmark-jump" type="button"'),
    "hosted bookmark list should not render a hidden/focusable bookmark jump button"
  );
  assert(
    contentBookmarkSource.includes('<div class="bookmark-jump" data-bookmark-id="${bookmark.id}">'),
    "content bookmark list should mirror the hosted non-focusable bookmark jump container"
  );
}

function verifyHostedPromptReviewFallbackContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("const reviewState = resolveEffectivePromptReviewState(snapshotReviewState, hostedReviewState);"),
    "hosted prompt tool should merge snapshot review state before rendering the review tab"
  );
  assert(
    hostedPanelSource.includes("const storeState = promptStoreController.buildViewState();"),
    "hosted prompt tool should read store state directly from the hosted store controller"
  );
  assert(
    hostedPanelSource.includes("function resolveEffectivePromptReviewState(snapshotReviewState, hostedReviewState)"),
    "hosted panel should define a dedicated review-state merge helper"
  );
  assert(
    hostedPanelSource.includes("...snapshotState,"),
    "hosted panel should fall back to snapshot review data when hosted review state is still blank"
  );
  assert(
    hostedPanelSource.includes("const snapshotHasActiveState = Boolean("),
    "hosted panel should distinguish active snapshot review state from passive hosted review state"
  );
  assert(
    hostedPanelSource.includes("if (snapshotState.pending && !hostedState.pending) {"),
    "hosted panel should prefer snapshot review state while an external review request is pending"
  );
  assert(
    hostedPanelSource.includes("if (snapshotHasActiveState && !hostedHasActiveState) {"),
    "hosted panel should prefer snapshot review results when hosted review state has gone stale"
  );
}

async function verifyHostedReleaseLocalDownloadUrls() {
  const runtimeCalls = [];
  const context = vm.createContext({
    Blob: class Blob {},
    File: class File {},
    clearTimeout,
    console,
    fetch: async (url) => {
      const href = String(url);
      if (href.endsWith("/extension-v2/releases/latest.json")) {
        return {
          ok: true,
          async json() {
            return {
              release: {
                downloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/latest.zip",
                fileName: "inova-extension-1.0.0.zip",
                version: "1.0.0",
                versionDownloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/inova-extension-1.0.0.zip",
              },
            };
          },
        };
      }
      if (href.endsWith("/extension-v2/releases/history.json")) {
        return {
          ok: true,
          async json() {
            return {
              releases: [
                {
                  downloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/inova-extension-0.4.4.zip",
                  fileName: "inova-extension-0.4.4.zip",
                  version: "0.4.4",
                  versionDownloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/inova-extension-0.4.4.zip",
                },
              ],
            };
          },
        };
      }
      throw new Error(`Unexpected fetch URL: ${href}`);
    },
    globalThis: null,
    location: {
      href: "http://127.0.0.1:5000/extension-v2/panel/index.html",
    },
    setTimeout,
    URL,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    constants: {
      limits: {
        releaseCheckIntervalMs: 21600000,
      },
    },
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };

  const source = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "release-controller.js"),
    "utf8"
  );
  new vm.Script(source, {
    filename: "hosting/extension-v2/panel/release-controller.js",
  }).runInContext(context);

  const controller = context.InovaBookmarks.releaseController.create({
    getRuntimeVersion() {
      return "1.0.0";
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push(request);
      return {};
    },
    scheduleRender() {},
  });

  controller.syncPanelState(
    { activeTool: "release" },
    ["runtime.invoke.v1"]
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const viewState = controller.buildViewState();
  assert.equal(
    viewState.latest?.downloadUrl,
    "http://127.0.0.1:5000/extension-v2/downloads/latest.zip",
    "local hosted release latest download should resolve to the local downloads lane"
  );
  assert.equal(
    viewState.latest?.versionDownloadUrl,
    "http://127.0.0.1:5000/extension-v2/downloads/inova-extension-1.0.0.zip",
    "local hosted release version download should resolve to the local artifact file"
  );

  await controller.handleReleaseAction("download-latest");
  await controller.handleReleaseAction("download-version", { version: "0.4.4" });

  assert.deepEqual(
    runtimeCalls.map((call) => [call.action, call.url]),
    [
      ["browser.open-url", "http://127.0.0.1:5000/extension-v2/downloads/latest.zip"],
      ["browser.open-url", "http://127.0.0.1:5000/extension-v2/downloads/inova-extension-0.4.4.zip"],
    ],
    "local hosted release downloads should open local artifact URLs"
  );
}

async function verifyPageAdapterContract() {
  const harness = createHarness();
  harness.ensure();

  const conversationSnapshot = await harness.bridge.options.onRequest({
    domain: "page",
    payload: { action: "get-conversation-snapshot" },
  });
  assert.equal(conversationSnapshot?.handled, true);
  assert.equal(conversationSnapshot?.result?.sessionId, "session-1");
  assert.equal(conversationSnapshot?.result?.items?.length, 2);
  assert.equal(conversationSnapshot?.result?.visibleMessageId, "session-1:1:bookmark-2");

  const debugSnapshot = await harness.bridge.options.onRequest({
    domain: "page",
    payload: { action: "get-debug-state" },
  });
  assert.equal(debugSnapshot?.handled, true);
  assert.equal(debugSnapshot?.result?.statusSummary?.errorCount, 1);
  assert.equal(debugSnapshot?.result?.hasErrors, true);

  const debugDisabled = await harness.bridge.options.onRequest({
    domain: "page",
    payload: { action: "set-debug-enabled", enabled: false },
  });
  assert.equal(debugDisabled?.handled, true);
  assert.equal(debugDisabled?.result?.enabled, false);

  const debugEnabled = await harness.bridge.options.onRequest({
    domain: "page",
    payload: { action: "set-debug-enabled", enabled: true },
  });
  assert.equal(debugEnabled?.handled, true);
  assert.equal(debugEnabled?.result?.enabled, true);

  const debugCopy = await harness.bridge.options.onRequest({
    domain: "page",
    payload: { action: "copy-debug-log", errorsOnly: true },
  });
  assert.equal(debugCopy?.handled, true);
  assert.equal(debugCopy?.result?.copied, true);
  assert.equal(harness.clipboardWrites.at(-1), "error-entry");

  const jumpResult = await harness.bridge.options.onRequest({
    domain: "page",
    payload: { action: "jump-conversation-item", bookmarkId: "session-1:1:bookmark-2" },
  });
  assert.equal(jumpResult?.handled, true);
  assert.equal(jumpResult?.result?.jumped, true);
  assert.equal(harness.scrolledMessageId(), "session-1:1:bookmark-2");
}

function createHarness() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://inova.incross.com/?sid=session-1",
  });
  const context = dom.getInternalVMContext();
  const animationFrames = [];
  const clipboardWrites = [];
  const bridge = {
    allowedOrigins: [],
    events: [],
    options: null,
    resets: [],
    snapshots: [],
  };
  let debugEnabled = true;

  context.console = console;
  context.globalThis = context;
  context.navigator.clipboard = {
    writeText(text) {
      clipboardWrites.push(String(text || ""));
      return Promise.resolve();
    },
  };
  context.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  context.cancelAnimationFrame = () => {};
  context.InovaBookmarks = {
    composer: {
      applyPromptText() {
        return true;
      },
      getComposerState() {
        return { available: true, text: "draft" };
      },
    },
    contentDom: {
      collectUserMessages() {
        return [
          { id: "session-1:0:bookmark-1", normalizedText: "first", order: 0, text: "First", title: "테스트 세션" },
          { id: "session-1:1:bookmark-2", normalizedText: "second", order: 1, text: "Second", title: "테스트 세션" },
        ];
      },
      getConversationState() {
        return {
          articleCount: 2,
          hasChatLog: true,
          hasComposer: true,
          userCount: 2,
        };
      },
      getSessionTitle() {
        return "테스트 세션";
      },
      getVisibleMessageId(items = []) {
        return items.at(-1)?.id || "";
      },
      scrollToMessage(messageId) {
        context.__scrolledMessageId = messageId;
        return true;
      },
    },
    firebaseConfig: buildFirebaseConfig(),
    hostedPanelBridge: {
      create(options = {}) {
        bridge.options = options;
        return {
          attach() {},
          emitEvent(domain, payload) {
            bridge.events.push({
              domain,
              payload: cloneValue(payload),
            });
            return true;
          },
          getCapabilities() {
            return [
              "panel.snapshot.v1",
              "panel.request.v1",
              "panel.response.v1",
              "panel.event.v1",
            ];
          },
          reset(reason) {
            bridge.resets.push(reason);
          },
          setAllowedOrigin(origin) {
            bridge.allowedOrigins.push(origin);
          },
          updateSnapshot(payload) {
            bridge.snapshots.push(cloneValue(payload));
            return true;
          },
        };
      },
    },
    panelDebug: {
      buildCopyText() {
        return "all-entry";
      },
      buildErrorCopyText() {
        return "error-entry";
      },
      clearEntries() {},
      getEntries() {
        return [
          { event: "panel.test.info", level: "info", payload: {}, timestamp: "2026-01-01T00:00:00.000Z" },
          { event: "panel.test.error", level: "error", payload: { error: "boom" }, timestamp: "2026-01-01T00:00:01.000Z" },
        ];
      },
      isEnabled() {
        return debugEnabled;
      },
      setEnabled(nextEnabled) {
        debugEnabled = Boolean(nextEnabled);
        return debugEnabled;
      },
      summarizeEntries() {
        return {
          errorCount: 1,
          functionCalls: 2,
          readCount: 1,
          snapshotCount: 0,
          totalLogs: 2,
        };
      },
    },
    session: {
      formatSessionLabel(sessionId) {
        return sessionId ? `대화 ${sessionId}` : "현재 세션";
      },
      getSessionId() {
        return "session-1";
      },
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };

  [
    path.join("content", "panel-hosted-bridge-request.js"),
    path.join("content", "panel-hosted-meeting-request.js"),
    path.join("content", "panel-hosted-prompt-request.js"),
    path.join("content", "panel-hosted-runtime-request.js"),
    path.join("content", "panel-hosted-page-request.js"),
    path.join("content", "panel-hosted-shell-request.js"),
    path.join("content", "panel.js"),
  ].forEach((relativePath) => loadScript(relativePath, context));

  return {
    animationFrames,
    bridge,
    clipboardWrites,
    context,
    ensure() {
      context.InovaBookmarks.contentPanel.ensurePanel({
        onToggle() {},
      });
      return this;
    },
    flushFrame() {
      const callback = animationFrames.shift();
      assert.equal(typeof callback, "function", "Expected a queued animation frame");
      callback(Date.now());
    },
    get frame() {
      return context.document.getElementById("inova-hosted-panel-frame");
    },
    get handleCount() {
      return context.document.querySelector(".handle-count");
    },
    get root() {
      return context.document.getElementById("inova-bookmark-root");
    },
    scrolledMessageId() {
      return context.__scrolledMessageId || "";
    },
    render(state) {
      this.ensure();
      context.InovaBookmarks.contentPanel.renderPanel(state);
    },
  };
}

function createPanelState(overrides = {}) {
  const state = {
    activeTool: "bookmarks",
    bookmarksTool: {
      activeId: "",
      count: 0,
      emptyText: "",
      items: [],
      metaText: "",
      query: "",
    },
    handleCount: 0,
    handleRatio: 0.4,
    meetingTool: {
      count: 0,
      feedback: null,
      items: [],
      pending: null,
    },
    open: true,
    panelDebug: {
      collapsed: true,
      enabled: false,
      hasErrors: false,
      statusSummary: { totalLogs: 0 },
    },
    promptTool: {
      activeTab: "library",
      prompt: { items: [] },
      review: { open: false },
      store: { items: [] },
      tabs: [],
    },
    releaseTool: {
      checking: false,
      currentVersion: "0.4.5",
      history: [],
      historyLoading: false,
      latest: null,
      latestVersion: "",
      updateAvailable: false,
      versionRefreshPending: false,
    },
    settings: {
      meetingWorkspaceTarget: "production",
      meetingWorkspaceUrlOverride: "",
    },
    visible: true,
  };
  return mergeObjects(state, overrides);
}

function buildFirebaseConfig() {
  return {
    hosting: {
      panelAppUrl: "https://browser-extension-main.web.app/extension/panel/index.html",
    },
    meeting: {
      resolveRuntime(settings = {}) {
        if (settings.meetingWorkspaceTarget === "local") {
          return {
            hosting: {
              panelAppUrl: "http://127.0.0.1:5000/extension/panel/index.html",
            },
          };
        }
        return {
          hosting: {
            panelAppUrl: "https://browser-extension-main.web.app/extension/panel/index.html",
          },
        };
      },
    },
    prompt: {
      resolveRuntime(settings = {}) {
        return this.meeting?.resolveRuntime?.(settings) || {
          hosting: {
            panelAppUrl: "https://browser-extension-main.web.app/extension/panel/index.html",
          },
        };
      },
    },
  };
}

function mergeObjects(base, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return overrides === undefined ? cloneValue(base) : overrides;
  }
  const next = Array.isArray(base) ? base.slice() : { ...base };
  Object.keys(overrides).forEach((key) => {
    const overrideValue = overrides[key];
    const baseValue = base?.[key];
    if (
      overrideValue
      && typeof overrideValue === "object"
      && !Array.isArray(overrideValue)
      && baseValue
      && typeof baseValue === "object"
      && !Array.isArray(baseValue)
    ) {
      next[key] = mergeObjects(baseValue, overrideValue);
      return;
    }
    next[key] = cloneValue(overrideValue);
  });
  return next;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadScript(relativePath, context) {
  const scriptPath = path.join(root, relativePath);
  const source = fs.readFileSync(scriptPath, "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

main().catch((error) => {
  console.error(`[verify-panel-render] ${error.stack || error.message}`);
  process.exitCode = 1;
});
