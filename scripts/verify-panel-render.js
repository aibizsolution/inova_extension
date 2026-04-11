#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

function main() {
  verifyHostedPanelHostBatching();
  verifyLocalPanelRuntimeSwitch();
  verifyPageBridgeEvents();
  console.log("[verify-panel-render] Hosted panel host contract passed");
}

function verifyHostedPanelHostBatching() {
  const harness = createHarness();
  const stateA = createPanelState({
    handleCount: 1,
    open: true,
    toolCount: 1,
  });
  const stateB = createPanelState({
    bookmarksTool: {
      activeId: "bookmark-2",
      count: 2,
    },
    handleCount: 2,
    open: false,
    toolCount: 2,
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
  assert.equal(snapshot.panel.toolCount, 2);
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

function createHarness() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://inova.incross.com/?sid=session-1",
  });
  const context = dom.getInternalVMContext();
  const animationFrames = [];
  const bridge = {
    allowedOrigins: [],
    events: [],
    options: null,
    resets: [],
    snapshots: [],
  };

  context.console = console;
  context.globalThis = context;
  context.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  context.cancelAnimationFrame = () => {};
  context.InovaBookmarks = {
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
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };

  loadScript(path.join("content", "panel.js"), context);

  return {
    animationFrames,
    bridge,
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
    toolCount: 0,
    toolTitle: "대화 탐색",
    tools: [],
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

main();
