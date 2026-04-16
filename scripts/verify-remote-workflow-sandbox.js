#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifySandboxHtmlPolicy();
  verifySandboxRuntimeBoundary();
  await verifyHostedWorkflowHostBridge();
  console.log("[verify-remote-workflow-sandbox] Remote workflow sandbox contract passed");
}

function verifySandboxHtmlPolicy() {
  const html = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "remote-workflow-sandbox.html"),
    "utf8"
  );
  assert(html.includes("connect-src 'none'"), "remote workflow sandbox should block network connect-src");
  assert(html.includes("script-src 'self'"), "remote workflow sandbox should only load same-origin scripts");
  assert(html.includes("./remote-workflow-sandbox.js"), "remote workflow sandbox should load the fixed sandbox runtime");
  assert(!html.includes("http://"), "remote workflow sandbox should not reference raw remote URLs");
  assert(!html.includes("https://"), "remote workflow sandbox should not reference raw remote URLs");
}

function verifySandboxRuntimeBoundary() {
  let messageListener = null;
  const postedMessages = [];
  const context = vm.createContext({
    addEventListener(type, handler) {
      if (type === "message") {
        messageListener = handler;
      }
    },
    chrome: {},
    console,
    fetch() {},
    globalThis: null,
    localStorage: {},
    parent: {
      postMessage(message, targetOrigin) {
        postedMessages.push({ message, targetOrigin });
      },
    },
    sessionStorage: {},
  });
  context.globalThis = context;

  loadScript(path.join("hosting", "extension-v2", "panel", "remote-workflow-sandbox.js"), context);

  assert.equal(typeof messageListener, "function", "sandbox runtime should listen for host messages");
  assert.throws(() => context.fetch, /sandbox global is blocked: fetch/);
  assert.throws(() => context.chrome, /sandbox global is blocked: chrome/);
  assert.throws(() => context.localStorage, /sandbox global is blocked: localStorage/);

  messageListener({
    data: {
      payload: {
        bridgeApis: ["invokeCapability", "fetch", "metrics"],
        workflowArtifacts: {
          "test-workflow": {
            artifactVersion: "0.0.1",
            bundleId: "test-workflow-bundle",
            integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            scriptSlot: "remote-workflow",
          },
        },
      },
      requestId: "boot-1",
      source: "inova-remote-workflow-host",
      type: "remote-workflow.boot",
    },
  });
  assert.equal(postedMessages.at(-1)?.targetOrigin, "*");
  assert.deepEqual(postedMessages.at(-1)?.message?.payload?.bridgeApis, ["invokeCapability", "metrics"]);
  assert.deepEqual(postedMessages.at(-1)?.message?.payload?.workflowArtifactIds, ["test-workflow"]);
  assert.equal(postedMessages.at(-1)?.message?.payload?.security?.fetch, true);
  assert.equal(postedMessages.at(-1)?.message?.payload?.security?.localStorage, true);

  messageListener({
    data: {
      payload: {
        workflowId: "test.workflow.disabled",
      },
      requestId: "run-1",
      source: "inova-remote-workflow-host",
      type: "remote-workflow.run",
    },
  });
  assert.equal(postedMessages.at(-1)?.message?.ok, false);
  assert.match(postedMessages.at(-1)?.message?.error || "", /disabled until sandbox pilot/);
}

async function verifyHostedWorkflowHostBridge() {
  let messageListener = null;
  const postedMessages = [];
  const traceEvents = [];
  const browserCalls = [];
  const frameWindow = {
    postMessage(message, targetOrigin) {
      postedMessages.push({ message, targetOrigin });
    },
  };
  const frame = {
    attrs: {},
    contentWindow: frameWindow,
    hidden: false,
    parentNode: null,
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
  const document = {
    body: {
      appendChild(node) {
        node.parentNode = this;
        return node;
      },
      removeChild(node) {
        node.parentNode = null;
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "iframe");
      return frame;
    },
  };
  const context = vm.createContext({
    __INOVA_HOSTED_PANEL_ASSET_SUFFIX__: "?v=test",
    addEventListener(type, handler) {
      if (type === "message") {
        messageListener = handler;
      }
    },
    clearTimeout,
    console,
    globalThis: null,
    setTimeout,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    panelUtils: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };

  loadScript(path.join("hosting", "extension-v2", "panel", "remote-workflow-host.js"), context);
  const host = context.InovaBookmarks.remoteWorkflowHost.create({
    browserCapabilities: {
      invokeCapability: async (capabilityId, input) => {
        browserCalls.push({ capabilityId, input });
        return { invoked: true };
      },
      invokePageCapability: async (pageCapabilityId, input) => {
        browserCalls.push({ input, pageCapabilityId });
        return { pageInvoked: true };
      },
      readPanelStorageState: async () => ({ panel: true }),
      writeUiPreferences: async (partial) => ({ partial }),
    },
    document,
    trace(step, payload) {
      traceEvents.push({ payload, step });
    },
  });

  const bootPromise = host.boot({
    bridgeApis: ["invokeCapability", "fetch", "metrics"],
    workflowArtifacts: [
      {
        artifactId: "test-workflow",
        artifactVersion: "0.0.1",
        bundleId: "test-workflow-bundle",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        scriptSlot: "remote-workflow",
      },
    ],
  });
  assert.equal(frame.attrs.sandbox, "allow-scripts");
  assert(!frame.attrs.sandbox.includes("allow-same-origin"), "sandbox host must not grant same-origin privileges");
  assert.equal(frame.src, "./remote-workflow-sandbox.html?v=test");
  assert.deepEqual(postedMessages.at(-1)?.message?.payload?.bridgeApis, ["invokeCapability", "metrics"]);
  assert.deepEqual(Object.keys(postedMessages.at(-1)?.message?.payload?.workflowArtifacts || {}), ["test-workflow"]);

  messageListener({
    data: {
      ok: true,
      payload: {
        bridgeApis: ["invokeCapability", "metrics"],
        workflowArtifactIds: ["test-workflow"],
      },
      requestId: postedMessages.at(-1).message.requestId,
      source: "inova-remote-workflow-sandbox",
      type: "remote-workflow.response",
    },
    source: frameWindow,
  });
  const bootResult = await bootPromise;
  assert.deepEqual(bootResult.bridgeApis, ["invokeCapability", "metrics"]);
  assert.deepEqual(host.getState(), {
    booted: true,
    bridgeApis: ["invokeCapability", "metrics"],
    mounted: true,
  });
  assert(traceEvents.some((event) => event.step === "remote.workflow.sandbox.ready"));

  messageListener({
    data: {
      api: "invokeCapability",
      input: {
        capabilityId: "prompt.review.run",
        input: {
          prompt: "test",
        },
      },
      requestId: "bridge-1",
      source: "inova-remote-workflow-sandbox",
      type: "remote-workflow.bridge.request",
    },
    source: frameWindow,
  });
  await waitForBridgeResponse();
  assert.deepEqual(browserCalls.at(-1), {
    capabilityId: "prompt.review.run",
    input: {
      prompt: "test",
    },
  });
  assert.equal(postedMessages.at(-1)?.message?.type, "remote-workflow.bridge.response");
  assert.equal(postedMessages.at(-1)?.message?.ok, true);

  messageListener({
    data: {
      api: "fetch",
      input: {},
      requestId: "bridge-2",
      source: "inova-remote-workflow-sandbox",
      type: "remote-workflow.bridge.request",
    },
    source: frameWindow,
  });
  await waitForBridgeResponse();
  assert.equal(postedMessages.at(-1)?.message?.ok, false);
  assert.match(postedMessages.at(-1)?.message?.error || "", /not allowed: fetch/);
}

async function waitForBridgeResponse() {
  await Promise.resolve();
  await Promise.resolve();
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

main().catch((error) => {
  console.error("[verify-remote-workflow-sandbox] Failed");
  console.error(error);
  process.exit(1);
});
