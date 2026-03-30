#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const popupHtmlPath = path.join(root, "fixtures", "popup-harness.html");

async function main() {
  const html = fs.readFileSync(popupHtmlPath, "utf8");
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "http://127.0.0.1:4173/fixtures/popup-harness.html",
  });
  const context = dom.getInternalVMContext();
  const { window } = dom;

  window.console = console;

  runScript(path.join(root, "fixtures", "popup-harness-mock.js"), context, "fixtures/popup-harness-mock.js");
  runScript(path.join(root, "shared", "constants.js"), context, "shared/constants.js");
  runScript(path.join(root, "shared", "session.js"), context, "shared/session.js");
  runScript(path.join(root, "shared", "storage.js"), context, "shared/storage.js");
  runScript(path.join(root, "popup", "index.js"), context, "popup/index.js");

  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

  await waitFor(
    () => window.document.getElementById("syncStatus")?.textContent === "적용됨",
    "Popup harness should finish initial refresh"
  );

  assert.equal(window.document.getElementById("sitePill")?.textContent, "i-Nova");
  assert(window.document.getElementById("tabLabel")?.textContent.includes("inova.incross.com"));
  assert(window.document.getElementById("sessionLabel")?.textContent.includes("대화 "));
  assert.equal(window.document.getElementById("pauseControl")?.hidden, false);
  assert.equal(window.document.getElementById("enabledToggle")?.getAttribute("aria-checked"), "true");

  click(window, window.document.getElementById("pauseToggle"));
  await waitFor(
    () => window.document.getElementById("pauseToggle")?.getAttribute("aria-checked") === "true",
    "Popup harness should update pause state"
  );
  assert.equal(window.__INOVA_POPUP_HARNESS__.state.storage.pausedSessions["fixture-session"], true);

  click(window, window.document.getElementById("enabledToggle"));
  await waitFor(
    () => window.document.getElementById("enabledToggle")?.getAttribute("aria-checked") === "false",
    "Popup harness should update enabled state"
  );
  assert.equal(window.document.getElementById("pauseControl")?.hidden, true);

  window.__INOVA_POPUP_HARNESS__.setActiveTab({
    title: "Example",
    url: "https://example.com",
  });
  click(window, window.document.getElementById("refreshButton"));
  await waitFor(
    () => window.document.getElementById("sitePill")?.textContent === "지원 안 됨",
    "Popup harness should reflect non-i-Nova tabs after refresh"
  );
  assert.equal(window.document.getElementById("sessionLabel")?.textContent, "대화 화면을 열어 주세요");

  console.log("[verify-popup-harness] Popup harness passed");
}

function runScript(filePath, context, label) {
  const source = fs.readFileSync(filePath, "utf8");
  new vm.Script(source, { filename: label }).runInContext(context);
}

function click(window, element) {
  assert(element, "Popup harness expected a clickable element");
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitFor(check, errorMessage, timeoutMs = 2000, stepMs = 20) {
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
  console.error(`[verify-popup-harness] ${error.message}`);
  process.exit(1);
});
