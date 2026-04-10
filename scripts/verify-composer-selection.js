#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const scriptOrder = [
  path.join("shared", "constants.js"),
  path.join("content", "composer.js"),
];

function main() {
  verifyChatTextareaWinsOverArtifactEditor();
  verifyEditableFallbackStillWorks();
  console.log("[verify-composer-selection] Composer selection regression check passed");
}

function verifyChatTextareaWinsOverArtifactEditor() {
  const dom = createDom(`
    <main>
      <section class="artifact-detail-panel" id="artifact-panel">
        <div class="markdown-editor">
          <div class="tiptap ProseMirror markdown-editor__content" id="artifact-editor" contenteditable="true"></div>
        </div>
      </section>
      <form id="chat-form" class="chat-input">
        <div id="chat-anchor" class="chat-input__wrapper">
          <textarea class="chat-input__textarea" id="chat-textarea"></textarea>
        </div>
      </form>
    </main>
  `);
  const { window } = dom;
  const namespace = loadComposerNamespace(dom);
  const { document } = window;

  const panel = document.getElementById("artifact-panel");
  const editor = document.getElementById("artifact-editor");
  const form = document.getElementById("chat-form");
  const anchor = document.getElementById("chat-anchor");
  const textarea = document.getElementById("chat-textarea");

  defineVisibleRect(panel, {
    top: 0,
    left: 1560,
    right: 2560,
    bottom: 1180,
    width: 1000,
    height: 1180,
  });
  defineVisibleRect(editor, {
    top: 140,
    left: 1579,
    right: 2560,
    bottom: 3029,
    width: 981,
    height: 2889,
  });
  defineEditable(editor);
  defineVisibleRect(form, {
    top: 1260,
    left: 620,
    right: 1640,
    bottom: 1368,
    width: 1020,
    height: 108,
  });
  defineVisibleRect(anchor, {
    top: 1272,
    left: 640,
    right: 1620,
    bottom: 1360,
    width: 980,
    height: 88,
  });
  defineVisibleRect(textarea, {
    top: 1296,
    left: 650,
    right: 1610,
    bottom: 1352,
    width: 960,
    height: 56,
  });

  const composer = namespace.composer.getComposerElement();
  assert.equal(composer, textarea, "chat textarea should outrank artifact editor candidates");

  const composerAnchor = namespace.composer.getComposerAnchorElement();
  assert(composerAnchor, "composer anchor should exist");
  assert.equal(
    composerAnchor.closest(".artifact-detail-panel"),
    null,
    "artifact detail panel must not be chosen as the floating button anchor"
  );
  assert.equal(
    composerAnchor.contains(textarea) || composerAnchor === textarea,
    true,
    "chosen anchor should stay attached to the chat composer area"
  );
}

function verifyEditableFallbackStillWorks() {
  const dom = createDom(`
    <main>
      <div id="editable-chat" role="textbox" contenteditable="true"></div>
    </main>
  `);
  const namespace = loadComposerNamespace(dom);
  const editable = dom.window.document.getElementById("editable-chat");

  defineVisibleRect(editable, {
    top: 1220,
    left: 720,
    right: 1620,
    bottom: 1340,
    width: 900,
    height: 120,
  });
  defineEditable(editable);

  const composer = namespace.composer.getComposerElement();
  assert.equal(composer, editable, "editable fallback should still work when textarea is absent");
}

function createDom(bodyHtml) {
  return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://inova.incross.com/chat?sid=fixture-session",
  });
}

function loadComposerNamespace(dom) {
  const { window } = dom;
  const context = dom.getInternalVMContext();
  window.console = console;
  window.InovaBookmarks = window.InovaBookmarks || {};

  for (const relativePath of scriptOrder) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(context);
  }

  return window.InovaBookmarks;
}

function defineVisibleRect(element, rect) {
  const normalized = {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() {
      return { ...normalized };
    },
  };

  Object.defineProperty(element, "offsetParent", {
    configurable: true,
    get() {
      return element.ownerDocument.body;
    },
  });
  element.getBoundingClientRect = () => normalized;
  element.getClientRects = () => [normalized];
}

function defineEditable(element) {
  Object.defineProperty(element, "isContentEditable", {
    configurable: true,
    value: true,
  });
}

main();
