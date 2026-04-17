#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "fixtures", "inova-chat-session.html");
const scriptOrder = [
  path.join("shared", "constants.js"),
  path.join("shared", "session.js"),
  path.join("content", "dom.js"),
];

function main() {
  const fixtureHtml = fs.readFileSync(fixturePath, "utf8");
  const dom = new JSDOM(fixtureHtml, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://inova.incross.com/chat?sid=fixture-session",
  });
  const { window } = dom;
  const context = dom.getInternalVMContext();

  window.console = console;
  window.scrollTo = () => {};
  if (!window.CSS) {
    window.CSS = { escape: escapeCssValue };
  } else if (typeof window.CSS.escape !== "function") {
    window.CSS.escape = escapeCssValue;
  }

  for (const relativePath of scriptOrder) {
    const fullPath = path.join(root, relativePath);
    const source = fs.readFileSync(fullPath, "utf8");
    const script = new vm.Script(source, { filename: relativePath });
    script.runInContext(context);
  }

  const namespace = window.InovaBookmarks;
  assert(namespace, "InovaBookmarks namespace should be available");
  const sessionId = namespace.session.getSessionId(window.location.href);
  assert.equal(sessionId, "fixture-session");

  const state = namespace.contentDom.getConversationState();
  assert.equal(state.hasChatLog, true);
  assert.equal(state.hasComposer, true);
  assert.equal(state.articleCount, 6);
  assert.equal(state.assistantCount, 3);
  assert.equal(state.messageCount, 6);
  assert.equal(state.userCount, 3);

  const sessionTitle = namespace.contentDom.getSessionTitle();
  assert.equal(sessionTitle, "신규 프로모션 회의");

  const messages = namespace.contentDom.collectUserMessages(sessionId);
  assert.equal(messages.length, 3);

  const expectedTexts = [
    "이번 분기 런칭 일정 다시 정리해 주세요.",
    "오프라인 행사 예산은 얼마까지 가능한가요?",
    "다음 주까지 필요한 액션 아이템만 추려 주세요.",
  ];

  messages.forEach((message, index) => {
    const expectedText = expectedTexts[index];
    assert.equal(message.order, index + 1);
    assert.equal(message.text, expectedText);
    assert(Number(message.tokenEstimate?.question) > 0, "question token estimate should be attached to each bookmark");
    assert(Number(message.tokenEstimate?.answer) > 0, "answer token estimate should be paired from the following assistant article");
    assert.equal(
      message.tokenEstimate.total,
      message.tokenEstimate.question + message.tokenEstimate.answer
    );
    assert.equal(
      message.id,
      namespace.session.buildMessageId(sessionId, index + 1, expectedText)
    );
  });

  const signature = namespace.contentDom.getUserMessageSignature();
  assert.equal(signature, expectedTexts.join("||"));

  const messageNodes = Array.from(window.document.querySelectorAll('[aria-label="채팅 메시지 목록"] > article'))
    .filter((node) => !node.firstElementChild?.getAttribute("aria-label"));
  messageNodes.forEach((node, index) => {
    assert.equal(node.dataset.inovaBookmarkId, messages[index].id);
  });

  const snapshot = namespace.contentDom.collectConversationSnapshot(sessionId);
  assert.equal(snapshot.items.length, 3);
  assert.equal(snapshot.conversation.assistantCount, 3);
  assert(snapshot.tokenEstimate.total > snapshot.tokenEstimate.question);
  assert.equal(snapshot.tokenEstimate.basis, "dom-estimate-v1");

  const domSnapshot = namespace.contentDom.collectConversationDomSnapshot(sessionId);
  assert.equal(domSnapshot.basis, "conversation-dom-snapshot-v1");
  assert.equal(domSnapshot.articles.length, 6);
  assert.equal(domSnapshot.articles[0].id, messages[0].id);
  assert.equal(domSnapshot.articles[1].firstChildAriaLabel, "Google: Gemini 3 Pro");
  assert.equal(domSnapshot.articles[1].roleHint, "assistant");

  console.log("[verify-content-smoke] DOM smoke check passed");
}

function escapeCssValue(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

main();
