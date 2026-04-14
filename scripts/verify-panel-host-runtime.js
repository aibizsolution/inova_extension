#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

async function verifyPanelHostRuntimeContract() {
  verifyPanelHostRuntimeModuleSplit();
  verifyHostedPanelHostBatching();
  verifyLocalPanelRuntimeSwitch();
  verifyPageBridgeEvents();
  await verifyPageAdapterContract();
}

function verifyPanelHostRuntimeModuleSplit() {
  const panelSource = fs.readFileSync(path.join(root, "content", "panel.js"), "utf8");
  const hostRuntimeSource = fs.readFileSync(path.join(root, "content", "panel-host-runtime.js"), "utf8");

  assert(
    /panelHostRuntime\.create/.test(panelSource),
    "content/panel.js should delegate host runtime work through panelHostRuntime.create"
  );
  assert(
    !/function syncHostedFrame/.test(panelSource),
    "content/panel.js should stop carrying the hosted frame sync inline once host runtime moves to its own helper"
  );
  assert(
    /function syncHostedFrame/.test(hostRuntimeSource),
    "content/panel-host-runtime.js should own hosted frame sync once panel.js delegates host runtime work"
  );
}

function verifyHostedPanelHostBatching() {
  const harness = createHarness();
  const stateA = createPanelState({
    handleCount: 1,
    open: true,
  });
  const stateB = createPanelState({
    panelSnapshot: {
      bookmarksTool: {
        activeId: "bookmark-2",
        count: 2,
      },
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
  const hostedPanelBridgeStub = {
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
    hostedPanelBridge: hostedPanelBridgeStub,
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

  loadScript(path.join("content", "hosted-panel-bridge.js"), context);
  context.InovaBookmarks.hostedPanelBridge = hostedPanelBridgeStub;
  loadScript(path.join("content", "panel-console-trace.js"), context);
  loadScript(path.join("content", "panel-host-runtime.js"), context);
  loadScript(path.join("content", "panel.js"), context);

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
    handleCount: 0,
    handleRatio: 0.4,
    open: true,
    settings: {
      meetingWorkspaceTarget: "production",
      meetingWorkspaceUrlOverride: "",
    },
    panelSnapshot: {
      activeTool: "bookmarks",
      bookmarksTool: {
        activeId: "",
        count: 0,
        emptyText: "",
        items: [],
        metaText: "",
        query: "",
      },
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
      settingsHydrated: true,
      visible: true,
    },
    visible: true,
  };
  const merged = mergeObjects(state, overrides);
  merged.panelSnapshot = mergeObjects(merged.panelSnapshot, {
    open: merged.open,
    settings: merged.settings,
    visible: merged.visible,
  });
  return merged;
}

function buildFirebaseConfig() {
  const meeting = {
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
  };
  return {
    hosting: {
      panelAppUrl: "https://browser-extension-main.web.app/extension/panel/index.html",
    },
    meeting,
    panel: {
      resolveRuntime(settings = {}) {
        return meeting.resolveRuntime(settings);
      },
    },
    prompt: {
      resolveRuntime(settings = {}) {
        return meeting.resolveRuntime(settings) || {
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

module.exports = {
  verifyPanelHostRuntimeContract,
};

if (require.main === module) {
  verifyPanelHostRuntimeContract().then(() => {
    console.log("[verify-panel-host-runtime] Panel host runtime contract passed");
  }).catch((error) => {
    console.error(`[verify-panel-host-runtime] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
