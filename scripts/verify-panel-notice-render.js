#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyPanelNoticeRenderAndDismissal();
  await verifyPanelNoticeCarousel();
  await verifyPanelNoticeSignalRemovesDeletedNotice();
  console.log("[verify-panel-notice-render] Panel notice render contract passed");
}

async function verifyPanelNoticeRenderAndDismissal() {
  const dom = new JSDOM("<!doctype html><div id=\"slot\"></div>", {
    url: "https://browser-extension-v2.web.app/extension-v2/panel/index.html",
  });
  const context = createHostedPanelContext(dom);
  loadSharedScript("design-system.js", context);
  loadHostedPanelScript("panel-utils.js", context);
  loadHostedPanelScript("panel-notice-controller.js", context);

  let activeNotice = buildNotice({ version: 1 });
  const traces = [];
  const controller = createController(context, {
    getNotice: () => activeNotice,
    traces,
  });

  controller.syncPanelState(
    { providerIdentity: { email: "viewer@example.com", providerUserKey: "viewer-1" } },
    ["panel.notice.read-active"]
  );
  await flushMicrotasks();

  const html = controller.render();
  assert(html.includes("inova-panel-notice"), "active notice should render a bottom popup");
  assert(html.includes("서비스 점검"), "active notice should render its title");
  assert(html.includes("<strong>중요</strong>"), "active notice should render sanitized Markdown HTML from the service");
  assert(traces.some((entry) => entry.step === "hosted.notice.read.success"), "successful notice reads should be traced");

  const closeButton = renderIntoSlot(dom, html).querySelector('[data-panel-notice-action="close"]');
  assert(closeButton, "notice popup should expose a close action");
  assert(closeButton.querySelector("svg"), "notice close action should render through the shared icon system");
  assert.equal(controller.handleClick(createClickEvent(closeButton)), true);
  assert.equal(controller.render(), "", "close should hide only the current controller session");

  const nextSessionController = createController(context, { getNotice: () => activeNotice });
  nextSessionController.syncPanelState(
    { providerIdentity: { email: "viewer@example.com", providerUserKey: "viewer-1" } },
    ["panel.notice.read-active"]
  );
  await flushMicrotasks();
  assert(nextSessionController.render().includes("서비스 점검"), "session close should not persist across controller sessions");

  const hideButton = renderIntoSlot(dom, nextSessionController.render()).querySelector('[data-panel-notice-action="hide-day"]');
  assert(hideButton, "notice popup should expose a one-day hide action");
  assert.equal(nextSessionController.handleClick(createClickEvent(hideButton)), true);
  assert.equal(nextSessionController.render(), "", "one-day hide should hide the current notice version");

  const hiddenController = createController(context, { getNotice: () => activeNotice });
  hiddenController.syncPanelState(
    { providerIdentity: { email: "viewer@example.com", providerUserKey: "viewer-1" } },
    ["panel.notice.read-active"]
  );
  await flushMicrotasks();
  assert.equal(hiddenController.render(), "", "one-day hide should persist through localStorage");

  activeNotice = buildNotice({ version: 2 });
  const versionChangedController = createController(context, { getNotice: () => activeNotice });
  versionChangedController.syncPanelState(
    { providerIdentity: { email: "viewer@example.com", providerUserKey: "viewer-1" } },
    ["panel.notice.read-active"]
  );
  await flushMicrotasks();
  assert(
    versionChangedController.render().includes('data-panel-notice-key="notice-1:2"'),
    "changed noticeId:version should bypass the old hide key"
  );
}

function createController(context, options = {}) {
  return context.InovaBookmarks.panelNoticeController.create({
    browserCapabilities: {
      async invokeCapability(capabilityId, input) {
        assert.equal(capabilityId, "panel.notice.read-active");
        assert.equal(input.providerIdentity.providerUserKey, "viewer-1");
        return options.getNotices
          ? { notices: options.getNotices() }
          : { notice: options.getNotice() };
      },
    },
    scheduleRender() {},
    traceNotice(step, payload) {
      options.traces?.push({ payload, step });
    },
  });
}

async function verifyPanelNoticeCarousel() {
  const dom = new JSDOM("<!doctype html><div id=\"slot\"></div>", {
    url: "https://browser-extension-v2.web.app/extension-v2/panel/index.html",
  });
  const context = createHostedPanelContext(dom);
  loadSharedScript("design-system.js", context);
  loadHostedPanelScript("panel-utils.js", context);
  loadHostedPanelScript("panel-notice-controller.js", context);
  const controller = createController(context, {
    getNotices: () => [
      buildNotice({ noticeId: "notice-1", title: "첫 공지", version: 1 }),
      buildNotice({ noticeId: "notice-2", title: "두 번째 공지", version: 1 }),
      buildNotice({ noticeId: "notice-3", title: "세 번째 공지", version: 1 }),
    ],
  });
  controller.syncPanelState(
    { providerIdentity: { email: "viewer@example.com", providerUserKey: "viewer-1" } },
    ["panel.notice.read-active"]
  );
  await flushMicrotasks();
  let slot = renderIntoSlot(dom, controller.render());
  assert.equal(slot.querySelectorAll(".inova-panel-notice__dot").length, 3, "multiple visible notices should render carousel dots");
  assert(slot.textContent.includes("첫 공지"), "carousel should render the first notice by default");
  const nextButton = slot.querySelector('[data-panel-notice-action="next"]');
  assert(nextButton, "multiple visible notices should expose a next action");
  assert(nextButton.querySelector("svg"), "notice carousel actions should render through the shared icon system");
  assert.equal(controller.handleClick(createClickEvent(nextButton)), true);
  slot = renderIntoSlot(dom, controller.render());
  assert(slot.textContent.includes("두 번째 공지"), "next action should move to the next visible notice");

  context.__timerCallbacks.length = 0;
  assert.equal(controller.handlePause(true), true, "hover/focus should pause notice carousel rotation");
  assert.equal(context.__timerCallbacks.length, 0, "paused notice carousel should not schedule auto-rotation");
  assert.equal(controller.handlePause(false), true, "leaving hover/focus should resume notice carousel rotation");
  assert.equal(context.__timerCallbacks.length, 1, "resumed notice carousel should schedule auto-rotation again");
}

async function verifyPanelNoticeSignalRemovesDeletedNotice() {
  const dom = new JSDOM("<!doctype html><div id=\"slot\"></div>", {
    url: "https://browser-extension-v2.web.app/extension-v2/panel/index.html",
  });
  const context = createHostedPanelContext(dom);
  loadSharedScript("design-system.js", context);
  loadHostedPanelScript("panel-utils.js", context);
  loadHostedPanelScript("panel-notice-controller.js", context);
  let notices = [buildNotice({ noticeId: "notice-refresh", title: "삭제될 공지", version: 1 })];
  const controller = createController(context, {
    getNotices: () => notices,
  });
  controller.syncPanelState(
    { providerIdentity: { email: "viewer@example.com", providerUserKey: "viewer-1" } },
    ["panel.notice.read-active"]
  );
  await flushMicrotasks();
  assert(controller.render().includes("삭제될 공지"), "initial panel read should render the visible notice");
  const noticeSignalClient = context.__noticeSignalClients[0];
  assert(noticeSignalClient, "panel notice should create a realtime signal subscription client");
  assert.equal(noticeSignalClient.requests.length, 1, "panel notice should subscribe once it has read capability");
  notices = [];
  await noticeSignalClient.options.onSnapshot({
    exists: true,
    reason: "delete",
    revision: "delete-1",
  });
  await flushMicrotasks();
  assert.equal(controller.render(), "", "realtime notice signals should remove notices deleted from the service");
}

function buildNotice(overrides = {}) {
  return {
    bodyHtml: "<p><strong>중요</strong> 안내입니다.</p>",
    cta: {
      label: "상세 보기",
      url: "https://example.com/notice",
    },
    endsAt: "2026-04-22T00:00:00.000Z",
    noticeId: "notice-1",
    publishedAt: "2026-04-19T01:00:00.000Z",
    startsAt: "",
    title: "서비스 점검",
    version: 1,
    ...overrides,
  };
}

function renderIntoSlot(dom, html) {
  const slot = dom.window.document.getElementById("slot");
  slot.innerHTML = html;
  return slot;
}

function createClickEvent(target) {
  return {
    target,
    preventDefault() {},
  };
}

function createHostedPanelContext(dom) {
  const timerCallbacks = [];
  const broadcastChannels = [];
  const noticeSignalClients = [];
  function FakeBroadcastChannel(name) {
    this.name = name;
    this.onmessage = null;
    broadcastChannels.push(this);
  }
  FakeBroadcastChannel.prototype.postMessage = function postMessage(message) {
    if (typeof this.onmessage === "function") {
      this.onmessage({ data: message });
    }
  };
  FakeBroadcastChannel.prototype.close = function close() {};
  const context = vm.createContext({
    BroadcastChannel: FakeBroadcastChannel,
    console,
    document: dom.window.document,
    globalThis: null,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    __broadcastChannels: broadcastChannels,
    __timerCallbacks: timerCallbacks,
    setTimeout(callback) {
      timerCallbacks.push(callback);
      return timerCallbacks.length;
    },
    clearTimeout() {},
    URL,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    panelNoticeSignalFirestoreClient: {
      create(options = {}) {
        const client = {
          disconnects: [],
          options,
          requests: [],
          disconnect(reason) {
            this.disconnects.push(reason);
          },
          ensureSubscribed(request = {}) {
            this.requests.push(request);
            return Promise.resolve().then(() => options.onSnapshot?.({
              exists: true,
              reason: "initial",
              revision: "initial-1",
            }));
          },
        };
        noticeSignalClients.push(client);
        return client;
      },
    },
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };
  context.__noticeSignalClients = noticeSignalClients;
  return context;
}

function loadHostedPanelScript(fileName, context) {
  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", fileName), "utf8"),
    {
      filename: `hosting/extension-v2/panel/${fileName}`,
    }
  ).runInContext(context);
}

function loadSharedScript(fileName, context) {
  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "shared", fileName), "utf8"),
    {
      filename: `hosting/shared/${fileName}`,
    }
  ).runInContext(context);
}

async function flushMicrotasks(turns = 5) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

main().catch((error) => {
  console.error(`[verify-panel-notice-render] ${error.stack || error.message}`);
  process.exitCode = 1;
});
