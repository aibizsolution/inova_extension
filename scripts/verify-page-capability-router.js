#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

async function main() {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <head></head>
      <body>
        <main id="chat-log">
          <article class="user-message">first question</article>
          <article class="user-message">latest question</article>
        </main>
        <textarea id="composer">draft</textarea>
        <div id="inova-bookmark-host"><button id="inova-bookmark-handle"></button></div>
      </body>
    </html>`, { url: "https://inova.incross.com/" });
  const scrolled = [];
  const panelEvents = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(options) {
    scrolled.push({ id: this.id || this.className || this.tagName, options });
  };

  const context = vm.createContext({
    CSS: {
      escape(value) {
        return String(value || "").replace(/"/g, '\\"');
      },
    },
    document: dom.window.document,
    globalThis: null,
    HTMLElement: dom.window.HTMLElement,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    getSelection() {
      return { toString: () => " selected text " };
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    constants: {
      selectors: {
        chatLog: "#chat-log",
        composer: "#composer",
        userMessage: ".user-message",
      },
    },
    contentDom: {
      collectConversationDomSnapshot() {
        return {
          articles: [{ id: "article-1", text: "first question" }],
          basis: "conversation-dom-snapshot-v1",
          modelCandidates: [{ label: "OpenAI: GPT-5.4" }],
          sessionId: "session-1",
          sessionTitle: "현재 세션",
        };
      },
      collectUserMessages() {
        return [{ id: "visible-message" }];
      },
      getVisibleMessageId() {
        return "visible-message";
      },
    },
    contentPanel: {
      emitPanelEvent(action, payload) {
        panelEvents.push({ action, payload });
        return true;
      },
    },
    session: {
      getSessionId() {
        return "session-1";
      },
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };
  dom.window.document.querySelector(".user-message").dataset.inovaBookmarkId = "visible-message";

  loadScript("content/page-capability-router.js", context);
  const router = context.InovaBookmarks.panelPageCapabilityRouter;

  assert.deepEqual(Object.keys(router.manifest).filter((key) => key.startsWith("page.")).sort(), [
    "page.dispatch-named-event",
    "page.highlight-range",
    "page.read-selection",
    "page.scroll-to",
    "page.show-banner",
  ]);

  assert.equal((await router.handle({ action: "page.scroll-to", targetKey: "composer" })).result.scrolled, true);
  assert.equal(scrolled.at(-1).id, "composer");
  await assert.rejects(
    async () => router.handle({ action: "page.scroll-to", targetKey: "#composer" }),
    /허용되지 않은 page targetKey/
  );

  assert.equal((await router.handle({ action: "page.highlight-range", selectionKey: "conversation.visible" })).result.highlighted, true);
  await assert.rejects(
    async () => router.handle({ action: "page.highlight-range", selectionKey: ".user-message" }),
    /허용되지 않은 page selectionKey/
  );

  const bannerResult = await router.handle({
    action: "page.show-banner",
    params: { message: "hello <b>safe</b>" },
    templateKey: "runtime.info",
  });
  assert.equal(bannerResult.result.shown, true);
  assert.equal(dom.window.document.getElementById("inova-page-capability-banner").textContent, "hello <b>safe</b>");
  await assert.rejects(
    async () => router.handle({ action: "page.show-banner", params: { rawHtml: "<b>no</b>" }, templateKey: "runtime.info" }),
    /raw HTML\/JS/
  );

  assert.deepEqual((await router.handle({ action: "page.read-selection" })).result, {
    length: 13,
    text: "selected text",
    truncated: false,
  });

  assert.equal((await router.handle({ action: "page.dispatch-named-event", eventKey: "panel.external-toggle" })).result.dispatched, true);
  assert.equal(panelEvents.at(-1).action, "external-toggle");
  await assert.rejects(
    async () => router.handle({ action: "page.dispatch-named-event", eventKey: "raw-event" }),
    /허용되지 않은 page eventKey/
  );

  const domSnapshot = await router.handle({ action: "conversation.read-dom-snapshot" });
  assert.equal(domSnapshot.result.basis, "conversation-dom-snapshot-v1");
  assert.equal(domSnapshot.result.articles.length, 1);

  console.log("[verify-page-capability-router] Page capability router contract passed");
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main().catch((error) => {
  console.error(`[verify-page-capability-router] ${error.stack || error.message}`);
  process.exitCode = 1;
});
