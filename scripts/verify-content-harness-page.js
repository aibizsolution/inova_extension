#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const harnessHtmlPath = path.join(root, "fixtures", "content-harness.html");
const harnessMockPath = path.join(root, "fixtures", "content-harness-mock.js");
const manifestPath = path.join(root, "manifest.json");

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts[0]?.js || [] : [];
  const html = fs.readFileSync(harnessHtmlPath, "utf8");
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "http://127.0.0.1:4173/fixtures/content-harness.html?sid=fixture-session",
  });
  const context = dom.getInternalVMContext();
  const { window } = dom;

  window.console = console;

  runScript(harnessMockPath, context, "fixtures/content-harness-mock.js");
  for (const relativePath of contentScripts) {
    runScript(path.join(root, relativePath), context, relativePath);
  }

  await waitFor(
    () => window.document.getElementById("inova-bookmark-root")?.dataset.open === "true",
    "Harness page should finish initial panel boot"
  );

  const host = window.document.getElementById("inova-bookmark-host");
  assert(host, "Harness page should create the injected panel host");

  const rootNode = window.document.getElementById("inova-bookmark-root");
  assert(rootNode, "Harness page should render the panel root");
  assert.equal(rootNode.hidden, false);
  assert.equal(rootNode.dataset.open, "true");

  await waitFor(
    () => window.document.querySelectorAll(".inova-bookmark-item").length === 3,
    "Harness page should populate bookmark handles after route sync fallback"
  );

  const toolButtons = Array.from(window.document.querySelectorAll("#inova-tool-rail [data-tool-id]"));
  assert.equal(toolButtons.length, 3);

  const bookmarkItems = Array.from(window.document.querySelectorAll(".inova-bookmark-item"));
  assert.equal(bookmarkItems.length, 3);

  click(window, getToolButton(window, "prompts"));
  await waitFor(
    () => Boolean(window.document.querySelector(".inova-tool-subtabs")),
    "Prompt hub should render in harness mode"
  );
  assert(window.document.querySelector(".inova-tool-subtabs"), "Prompt hub should render in harness mode");

  click(window, window.document.querySelector('[data-prompt-tab-id="store"]'));
  await waitFor(
    () => Boolean(window.document.querySelector(".inova-store-item")),
    "Store view should load against fake runtime responses"
  );
  assert(window.document.querySelector(".inova-store-item"), "Store view should load against fake runtime responses");

  click(window, getToolButton(window, "release"));
  await waitFor(
    () => (window.document.getElementById("inova-tool-content")?.textContent || "").includes("0.3.8"),
    "Release view should render fake release metadata"
  );
  const releaseText = window.document.getElementById("inova-tool-content")?.textContent || "";
  assert(releaseText.includes("0.3.8"), "Release view should render fake release metadata");

  console.log("[verify-content-harness-page] Local browser harness boot passed");
  process.exit(0);
}

function runScript(filePath, context, label) {
  const source = fs.readFileSync(filePath, "utf8");
  new vm.Script(source, { filename: label }).runInContext(context);
}

function click(window, element) {
  assert(element, "Harness verification expected a clickable element");
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function getToolButton(window, toolId) {
  return Array.from(window.document.querySelectorAll("#inova-tool-rail [data-tool-id]")).find(
    (button) => button.dataset.toolId === toolId
  );
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
  console.error(`[verify-content-harness-page] ${error.message}`);
  process.exit(1);
});
