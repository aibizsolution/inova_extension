#!/usr/bin/env node

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifySandboxHtmlPolicy();
  await verifySandboxRuntimeBoundary();
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

async function verifySandboxRuntimeBoundary() {
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
    clearTimeout,
    setTimeout,
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
  await waitForBridgeResponse();
  assert.equal(postedMessages.at(-1)?.message?.ok, false);
  assert.match(postedMessages.at(-1)?.message?.error || "", /disabled until sandbox pilot/);

  messageListener({
    data: {
      payload: {
        input: {
          capabilityId: "prompt.review.run",
          prompt: "test",
        },
        pilotEnabled: true,
        workflow: {
          artifactId: "test-workflow",
          artifactVersion: "0.0.1",
          output: "$steps.invokeReview",
          steps: [
            {
              bridgeApi: "invokeCapability",
              id: "invokeReview",
              input: {
                capabilityId: "$input.capabilityId",
                input: {
                  prompt: "$input.prompt",
                },
              },
              type: "bridge",
            },
          ],
          workflowId: "test.workflow.disabled",
        },
      },
      requestId: "run-2",
      source: "inova-remote-workflow-host",
      type: "remote-workflow.run",
    },
  });
  const bridgeRequest = postedMessages.at(-1)?.message;
  assert.equal(bridgeRequest?.type, "remote-workflow.bridge.request");
  assert.equal(bridgeRequest?.api, "invokeCapability");
  assert.deepEqual(bridgeRequest?.input, {
    capabilityId: "prompt.review.run",
    input: {
      prompt: "test",
    },
  });
  messageListener({
    data: {
      ok: true,
      payload: {
        reviewed: true,
      },
      requestId: bridgeRequest.requestId,
      source: "inova-remote-workflow-host",
      type: "remote-workflow.bridge.response",
    },
  });
  await waitForBridgeResponse();
  assert.equal(postedMessages.at(-1)?.message?.type, "remote-workflow.response");
  assert.equal(postedMessages.at(-1)?.message?.ok, true);
  assert.deepEqual(postedMessages.at(-1)?.message?.payload?.output, {
    reviewed: true,
  });
}

async function verifyHostedWorkflowHostBridge() {
  let messageListener = null;
  const postedMessages = [];
  const traceEvents = [];
  const browserCalls = [];
  const fetchCalls = [];
  const artifactWorkflow = {
    artifactId: "test-workflow",
    artifactVersion: "0.0.1",
    output: "$steps.invokeReview",
    steps: [
      {
        bridgeApi: "invokeCapability",
        id: "invokeReview",
        input: {
          capabilityId: "prompt.review.run",
          input: {
            prompt: "$input.prompt",
          },
        },
        type: "bridge",
      },
    ],
    workflowId: "test.workflow.disabled",
  };
  const artifactSource = JSON.stringify(artifactWorkflow);
  const artifactIntegrity = `sha256-${crypto.createHash("sha256").update(artifactSource).digest("base64")}`;
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
    crypto: globalThis.crypto,
    fetch: async (url, options) => {
      fetchCalls.push({ options, url });
      return {
        ok: true,
        text: async () => artifactSource,
      };
    },
    globalThis: null,
    setTimeout,
    TextEncoder,
    btoa(value) {
      return Buffer.from(value, "binary").toString("base64");
    },
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
        integrity: artifactIntegrity,
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

  const artifactRunStartIndex = postedMessages.length;
  const artifactRunPromise = host.runWorkflow({
    artifactId: "test-workflow",
    input: {
      prompt: "artifact-test",
    },
    pilotEnabled: true,
  });
  await waitForNextPostedMessageType(postedMessages, artifactRunStartIndex, "remote-workflow.run");
  assert.deepEqual(fetchCalls, [
    {
      options: {
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      },
      url: "./workflows/test-workflow-bundle/0.0.1.json",
    },
  ]);
  const artifactRunRequest = postedMessages.at(-1)?.message;
  assert.equal(artifactRunRequest?.type, "remote-workflow.run");
  assert.equal(artifactRunRequest?.payload?.workflow?.workflowId, "test.workflow.disabled");
  assert.equal(artifactRunRequest?.payload?.workflow?.steps?.[0]?.input?.input?.prompt, "$input.prompt");
  messageListener({
    data: {
      ok: true,
      payload: {
        output: {
          reviewed: true,
        },
      },
      requestId: artifactRunRequest.requestId,
      source: "inova-remote-workflow-sandbox",
      type: "remote-workflow.response",
    },
    source: frameWindow,
  });
  assert.deepEqual(await artifactRunPromise, {
    output: {
      reviewed: true,
    },
  });

  const workflowRunStartIndex = postedMessages.length;
  const workflowRunPromise = host.runWorkflow({
    input: {
      prompt: "host-test",
    },
    pilotEnabled: true,
    workflow: {
      artifactId: "test-workflow",
      artifactVersion: "0.0.1",
      output: "$steps.invokeReview",
      steps: [
        {
          bridgeApi: "invokeCapability",
          id: "invokeReview",
          input: {
            capabilityId: "prompt.review.run",
            input: {
              prompt: "$input.prompt",
            },
          },
          type: "bridge",
        },
      ],
      workflowId: "test.workflow.disabled",
    },
  });
  await waitForNextPostedMessageType(postedMessages, workflowRunStartIndex, "remote-workflow.run");
  const workflowRunRequest = postedMessages.at(-1)?.message;
  assert.equal(workflowRunRequest?.type, "remote-workflow.run");
  assert.equal(workflowRunRequest?.payload?.pilotEnabled, true);
  assert.equal(workflowRunRequest?.payload?.workflow?.steps?.[0]?.bridgeApi, "invokeCapability");
  messageListener({
    data: {
      ok: true,
      payload: {
        output: {
          reviewed: true,
        },
      },
      requestId: workflowRunRequest.requestId,
      source: "inova-remote-workflow-sandbox",
      type: "remote-workflow.response",
    },
    source: frameWindow,
  });
  assert.deepEqual(await workflowRunPromise, {
    output: {
      reviewed: true,
    },
  });

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

function waitForAsyncTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForNextPostedMessageType(messages, startIndex, type) {
  for (let index = 0; index < 20; index += 1) {
    if (messages.length > startIndex && messages.at(-1)?.message?.type === type) {
      return;
    }
    await waitForAsyncTurn();
  }
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
