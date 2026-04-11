#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

function main() {
  verifyFrameBatchingAndHostCaching();
  verifyToolContentCaching();
  verifyDebugRenderSkipping();
  verifyStoreSearchEscapeBehavior();
  console.log("[verify-panel-render] Panel render batching and cache contract passed");
}

function verifyFrameBatchingAndHostCaching() {
  const harness = createHarness();
  const stateA = createPanelState({
    bookmarksTool: {
      activeId: "bookmark-1",
      count: 1,
      emptyText: "",
      items: [{ id: "bookmark-1", text: "첫 질문" }],
      metaText: "1개",
      query: "첫",
    },
    handleCount: 1,
    toolCount: 1,
  });
  const stateB = createPanelState({
    bookmarksTool: {
      activeId: "bookmark-2",
      count: 2,
      emptyText: "",
      items: [{ id: "bookmark-2", text: "둘째 질문" }],
      metaText: "2개",
      query: "둘",
    },
    handleCount: 2,
    toolCount: 2,
  });

  const originalHostQuerySelector = harness.host.querySelector.bind(harness.host);
  let hostQueryCount = 0;
  harness.host.querySelector = (...args) => {
    hostQueryCount += 1;
    return originalHostQuerySelector(...args);
  };

  harness.render(stateA);
  harness.render(stateB);

  assert.equal(harness.animationFrames.length, 1, "renderPanel should batch multiple renders into one frame");
  assert.equal(harness.renderCounts.bookmarkTool, 0, "Tool HTML should not render before the animation frame runs");

  harness.flushFrame();

  assert.equal(harness.renderCounts.bookmarkTool, 1, "Only the latest state should render after batching");
  assert.equal(harness.document.querySelector("#inova-tool-total")?.textContent, "2");
  assert.equal(harness.document.querySelector(".handle-count")?.textContent, "2");
  assert.equal(harness.document.querySelector("#inova-tool-content")?.textContent.includes("둘"), true);
  assert.equal(hostQueryCount, 0, "Cached panel elements should avoid host querySelector calls during bookmarks render");
}

function verifyToolContentCaching() {
  const harness = createHarness();
  const releaseState = createPanelState({
    activeTool: "release",
    releaseTool: {
      checking: false,
      currentVersion: "0.4.4",
      degraded: false,
      degradedReason: "",
      error: "",
      history: [],
      historyLoading: false,
      latest: { version: "0.4.5" },
      latestVersion: "0.4.5",
      updateAvailable: true,
      versionRefreshPending: false,
    },
    toolCount: 1,
    toolTitle: "릴리스 안내",
    tools: buildTools("release"),
  });

  harness.render(releaseState);
  harness.flushFrame();
  harness.render(cloneValue(releaseState));
  harness.flushFrame();

  assert.equal(harness.renderCounts.releaseTool, 1, "Unchanged release state should reuse cached HTML");

  const nextReleaseState = cloneValue(releaseState);
  nextReleaseState.releaseTool.latestVersion = "0.4.6";
  nextReleaseState.releaseTool.latest.version = "0.4.6";

  harness.render(nextReleaseState);
  harness.flushFrame();

  assert.equal(harness.renderCounts.releaseTool, 2, "Changed release state should regenerate tool HTML");
}

function verifyDebugRenderSkipping() {
  const harness = createHarness();
  const disabledDebugState = createPanelState({
    panelDebug: {
      collapsed: true,
      enabled: false,
      hasErrors: false,
      statusSummary: { totalLogs: 0 },
    },
  });

  harness.render(disabledDebugState);
  harness.flushFrame();
  harness.render(cloneValue(disabledDebugState));
  harness.flushFrame();

  assert.equal(harness.renderCounts.debugLayer, 0, "Disabled debug layer should skip debug HTML rendering");
  assert.equal(harness.document.querySelector("#inova-meeting-debug-layer")?.innerHTML, "");

  const enabledDebugState = createPanelState({
    panelDebug: {
      collapsed: false,
      enabled: true,
      hasErrors: false,
      statusSummary: { totalLogs: 2 },
    },
  });

  harness.render(enabledDebugState);
  harness.flushFrame();
  harness.render(cloneValue(enabledDebugState));
  harness.flushFrame();

  assert.equal(harness.renderCounts.debugLayer, 1, "Unchanged enabled debug state should reuse cached HTML");
  assert.equal(harness.document.querySelector("#inova-meeting-debug-layer")?.dataset.debugEnabled, "true");
}

function verifyStoreSearchEscapeBehavior() {
  const harness = createHarness();
  const promptState = createPanelState({
    activeTool: "prompts",
    promptTool: {
      activeTab: "store",
      prompt: { items: [] },
      review: { open: false },
      store: {
        hasMore: false,
        items: [],
        loading: false,
        query: "fixture",
        renderKey: 0,
      },
      tabs: [],
    },
    toolCount: 4,
    toolTitle: "프롬프트",
    tools: buildTools("prompts"),
  });

  harness.render(promptState);
  harness.flushFrame();

  const search = harness.document.querySelector('[data-search-tool="store"]');
  assert.ok(search, "Expected store search input to render");

  search.value = "fixture";
  const clearEvent = new harness.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });
  search.dispatchEvent(clearEvent);

  assert.equal(clearEvent.defaultPrevented, true, "First ESC should be consumed by store search clear");
  assert.deepEqual(harness.searchCalls[0], {
    options: { composing: false },
    toolId: "store",
    value: "",
  });
  assert.deepEqual(harness.searchSubmitCalls, [{ toolId: "store", value: "" }]);
  assert.deepEqual(harness.toggleCalls, []);

  const closeEvent = new harness.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });
  search.dispatchEvent(closeEvent);

  assert.equal(closeEvent.defaultPrevented, false, "Second ESC should fall through to close");
  assert.deepEqual(harness.toggleCalls, [false]);
}

function createHarness() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://example.test",
  });
  const context = dom.getInternalVMContext();
  const animationFrames = [];
  const renderCounts = {
    bookmarkTool: 0,
    debugLayer: 0,
    meetingTool: 0,
    promptTool: 0,
    releaseTool: 0,
  };
  const searchCalls = [];
  const searchSubmitCalls = [];
  const toggleCalls = [];

  context.console = console;
  context.globalThis = context;
  context.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  context.cancelAnimationFrame = () => {};

  context.InovaBookmarks = {
    bookmarkView: {
      flashCopyState() {},
      focus() {},
      moveFocus() {
        return false;
      },
      renderTool(state) {
        renderCounts.bookmarkTool += 1;
        return `<section class="bookmark-tool">${escapeHtml(state.query)}:${state.count}</section>`;
      },
      setActive() {},
    },
    meetingView: {
      render(state) {
        renderCounts.meetingTool += 1;
        return `<section class="meeting-tool">${state.count}</section>`;
      },
      renderDebugConsole(panelDebug) {
        renderCounts.debugLayer += 1;
        const totalLogs = Number(panelDebug?.statusSummary?.totalLogs) || 0;
        return `<div class="inova-meeting-debug-console__log">${totalLogs}</div>`;
      },
    },
    panelDebug: {
      captureViewport() {},
      restoreViewport() {},
    },
    promptHubPanel: {
      handleChange() {},
      handleClick() {
        return false;
      },
      handleInput() {},
      handlePointerDown() {},
      handlePointerEnd() {},
      handlePointerMove() {},
      handleScroll() {},
      syncStoreList() {},
    },
    promptHubView: {
      render(state) {
        renderCounts.promptTool += 1;
        if (state.activeTab === "store") {
          return `
            <section class="prompt-tool">
              <input data-search-tool="store" type="search" value="${escapeHtml(state.store?.query || "")}" />
              <div class="inova-store-list" data-store-has-more="${String(Boolean(state.store?.hasMore))}" data-store-loading="${String(Boolean(state.store?.loading))}"></div>
            </section>
          `;
        }
        return `<section class="prompt-tool">${escapeHtml(state.activeTab)}</section>`;
      },
    },
    releaseView: {
      render(state) {
        renderCounts.releaseTool += 1;
        return `<section class="release-tool">${escapeHtml(state.latestVersion)}</section>`;
      },
    },
  };

  loadScript("content/panel.js", context);
  context.InovaBookmarks.contentPanel.ensurePanel({
    onSearch(toolId, value, options = {}) {
      searchCalls.push({
        options: cloneValue(options),
        toolId,
        value,
      });
    },
    onSearchSubmit(toolId, value) {
      searchSubmitCalls.push({ toolId, value });
    },
    onToggle(value) {
      toggleCalls.push(value);
    },
  });

  return {
    animationFrames,
    document: context.document,
    host: context.document.getElementById("inova-bookmark-host"),
    render: context.InovaBookmarks.contentPanel.renderPanel,
    renderCounts,
    searchCalls,
    searchSubmitCalls,
    toggleCalls,
    window: context,
    flushFrame() {
      const callback = animationFrames.shift();
      assert.equal(typeof callback, "function", "Expected a queued animation frame");
      callback(Date.now());
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
      currentVersion: "0.4.4",
      degraded: false,
      degradedReason: "",
      error: "",
      history: [],
      historyLoading: false,
      latest: null,
      latestVersion: "",
      updateAvailable: false,
      versionRefreshPending: false,
    },
    toolCount: 0,
    toolTitle: "대화 질문",
    tools: buildTools("bookmarks"),
    visible: true,
  };
  return mergeObjects(state, overrides);
}

function buildTools(activeTool) {
  return [
    { count: 3, id: "bookmarks", label: "대화" },
    { count: 4, id: "prompts", label: "프롬프트" },
    { count: 2, id: "meeting", label: "회의룸" },
    { count: 1, id: "release", label: "릴리스" },
  ].map((tool) => ({ ...tool, count: tool.id === activeTool ? tool.count : tool.count }));
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

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loadScript(relativePath, context) {
  const scriptPath = path.join(root, relativePath);
  const source = fs.readFileSync(scriptPath, "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

main();
