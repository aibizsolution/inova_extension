#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");

async function main() {
  await verifyBookmarkFilteringAndMetaText();
  await verifyBookmarkEmptyAndStatusText();
  await verifyCopyBookmarkSuccessAndFailure();
  await verifyJumpBookmarkUpdatesSelection();
  console.log("[verify-panel-bookmark-controller] Legacy panel bookmark controller backup contract passed");
}

async function verifyBookmarkFilteringAndMetaText() {
  const harness = createHarness();

  harness.controller.updateQuery("회의");
  const toolState = harness.controller.buildToolState();

  assert.equal(harness.state.queries.bookmarks, "회의");
  assert.equal(harness.renderCalls.length, 1);
  assert.equal(toolState.count, 2);
  assert.equal(toolState.items.length, 1);
  assert.equal(toolState.items[0].id, "bookmark-1");
  assert.equal(toolState.metaText, "검색 결과 1개");
}

async function verifyBookmarkEmptyAndStatusText() {
  const harness = createHarness({
    autoBookmark: false,
    bookmarks: [],
  });

  const toolState = harness.controller.buildToolState();

  assert.equal(toolState.items.length, 0);
  assert.equal(toolState.emptyText, "팝업에서 대화 자동 모으기를 켜면 대화 탭을 사용할 수 있어요.");
  assert.equal(toolState.metaText, "대화 자동 모으기가 꺼져 있어요.");
}

async function verifyCopyBookmarkSuccessAndFailure() {
  const successHarness = createHarness();
  assert.equal(await successHarness.controller.copyBookmarkText("bookmark-1"), true);
  assert.deepEqual(successHarness.clipboardWrites, ["회의 요약을 부탁해"]);

  const failureHarness = createHarness({
    clipboardError: "clipboard failed",
  });
  assert.equal(await failureHarness.controller.copyBookmarkText("bookmark-1"), false);
  assert.deepEqual(failureHarness.clipboardWrites, []);
}

async function verifyJumpBookmarkUpdatesSelection() {
  const harness = createHarness();
  harness.controller.jumpToBookmark("bookmark-2");

  assert.equal(harness.state.activeId, "bookmark-2");
  assert.deepEqual(harness.activeCalls, ["bookmark-2"]);
  assert.deepEqual(harness.focusCalls, ["bookmark-2"]);
  assert.deepEqual(harness.scrollCalls, [{
    bookmarkId: "bookmark-2",
    options: { behavior: "smooth", block: "start" },
  }]);
}

function createHarness(options = {}) {
  const activeCalls = [];
  const clipboardWrites = [];
  const consoleErrors = [];
  const focusCalls = [];
  const renderCalls = [];
  const scrollCalls = [];

  const context = vm.createContext({
    console: {
      error(...args) {
        consoleErrors.push(args);
      },
      log: console.log.bind(console),
      warn: console.warn.bind(console),
    },
    globalThis: null,
    navigator: {
      clipboard: {
        async writeText(text) {
          if (options.clipboardError) {
            throw new Error(options.clipboardError);
          }
          clipboardWrites.push(text);
        },
      },
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    contentDom: {
      scrollToMessage(bookmarkId, optionsInput) {
        scrollCalls.push({
          bookmarkId,
          options: cloneValue(optionsInput),
        });
      },
    },
    contentPanel: {
      focusBookmark(bookmarkId) {
        focusCalls.push(bookmarkId);
      },
      setActiveBookmark(bookmarkId) {
        activeCalls.push(bookmarkId);
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };

  loadScript("backup/legacy-panel/panel-bookmark-controller.js", context);

  const state = {
    activeId: "",
    awaitingRouteMessages: false,
    bookmarks: cloneValue(options.bookmarks || [
      {
        id: "bookmark-1",
        normalizedText: "회의 요약을 부탁해",
        text: "회의 요약을 부탁해",
      },
      {
        id: "bookmark-2",
        normalizedText: "릴리스 메모를 정리해 줘",
        text: "릴리스 메모를 정리해 줘",
      },
    ]),
    lastError: "",
    queries: {
      bookmarks: "",
    },
    settings: {
      autoBookmark: options.autoBookmark == null ? true : Boolean(options.autoBookmark),
    },
  };

  const controller = context.InovaBookmarks.panelBookmarkController.create(state, {
    render() {
      renderCalls.push(true);
    },
  });

  return {
    activeCalls,
    clipboardWrites,
    consoleErrors,
    controller,
    focusCalls,
    renderCalls,
    scrollCalls,
    state,
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
  console.error(`[verify-panel-bookmark-controller] ${error.stack || error.message}`);
  process.exit(1);
});
