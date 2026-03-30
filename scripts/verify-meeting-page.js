#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const pageHtmlPath = path.join(root, "meeting", "index.html");

async function main() {
  const html = fs.readFileSync(pageHtmlPath, "utf8");
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "http://127.0.0.1:4173/meeting/index.html?sessionId=fixture-session&tabId=91&title=%EC%8B%A0%EA%B7%9C%20%ED%94%84%EB%A1%9C%EB%AA%A8%EC%85%98%20%ED%9A%8C%EC%9D%98&jobId=meeting-job-fixture-1",
  });
  const context = dom.getInternalVMContext();
  const { window } = dom;

  window.console = console;

  runScript(path.join(root, "fixtures", "meeting-page-harness-mock.js"), context, "fixtures/meeting-page-harness-mock.js");
  runScript(path.join(root, "shared", "constants.js"), context, "shared/constants.js");
  runScript(path.join(root, "shared", "session.js"), context, "shared/session.js");
  runScript(path.join(root, "shared", "meeting-state.js"), context, "shared/meeting-state.js");
  runScript(path.join(root, "shared", "meeting-bridge.js"), context, "shared/meeting-bridge.js");
  runScript(path.join(root, "shared", "storage.js"), context, "shared/storage.js");
  runScript(path.join(root, "meeting", "index.js"), context, "meeting/index.js");

  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

  await waitFor(
    () => (window.document.getElementById("transcriptText")?.textContent || "").includes("신규 프로모션"),
    "Meeting page should load the selected artifact detail"
  );

  assert(window.document.getElementById("pageTitle")?.textContent.includes("신규 프로모션 회의"));
  assert.equal(window.document.getElementById("currentBadge")?.textContent, "완료");
  assert.equal(window.document.querySelectorAll("#recordList .record-item").length, 1);
  assert.equal(window.document.getElementById("transcribeButton")?.disabled, true);
  assert.equal(window.document.getElementById("startButton")?.disabled, false);

  click(window, window.document.getElementById("startButton"));
  await waitFor(
    () => window.document.getElementById("currentBadge")?.textContent === "녹음 중",
    "Meeting page should switch to recording after start"
  );
  assert.equal(window.document.getElementById("stopButton")?.hidden, false);
  assert.equal(window.document.getElementById("stopButton")?.disabled, false);

  click(window, window.document.getElementById("stopButton"));
  await waitFor(
    () => window.document.getElementById("currentBadge")?.textContent === "녹음 완료",
    "Meeting page should switch to captured after stop"
  );
  assert.equal(window.document.getElementById("transcribeButton")?.disabled, false);
  assert((window.document.getElementById("sizeStat")?.textContent || "").includes("1.0MB"));

  click(window, window.document.getElementById("transcribeButton"));
  await waitFor(
    () => window.document.querySelectorAll("#recordList .record-item").length === 2,
    "Meeting page should append a new record after create job"
  );
  await waitFor(
    () => (window.document.getElementById("transcriptText")?.textContent || "").includes("광고 문구 초안"),
    "Meeting page should load the latest artifact detail after job success"
  );

  const harnessState = window.__INOVA_MEETING_PAGE_HARNESS__?.state;
  assert(harnessState, "Meeting page harness state should be exposed");
  assert.equal(harnessState.storage.meetingStateBySession["fixture-session"].records.length, 2);
  const messageTypes = window.__INOVA_MEETING_PAGE_HARNESS__?.runtimeMessages?.map((message) => message.type) || [];
  for (const requiredType of [
    "inova-meeting:list-results",
    "inova-meeting:get-job",
    "inova-meeting:get-artifact",
    "inova-meeting:start-capture",
    "inova-meeting:stop-capture",
    "inova-meeting:create-job",
  ]) {
    assert(messageTypes.includes(requiredType), `Meeting page harness should send ${requiredType}`);
  }

  console.log("[verify-meeting-page] Meeting page harness passed");
  process.exit(0);
}

function runScript(filePath, context, label) {
  const source = fs.readFileSync(filePath, "utf8");
  new vm.Script(source, { filename: label }).runInContext(context);
}

function click(window, element) {
  assert(element, "Meeting page harness expected a clickable element");
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitFor(check, errorMessage, timeoutMs = 3200, stepMs = 20) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (check()) {
      return;
    }
    await wait(stepMs);
  }
  throw new Error(errorMessage);
}

main().catch((error) => {
  console.error(`[verify-meeting-page] ${error.message}`);
  process.exit(1);
});
