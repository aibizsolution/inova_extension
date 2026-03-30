#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createCloudHarnessServer } = require("./cloud-harness-server");
const { MEETING_CREATE_REQUEST, PROVIDER_IDENTITY } = require("../fixtures/cloud-harness/fixtures");

const root = path.resolve(__dirname, "..");
const backgroundRoot = path.join(root, "background");
const accessToken = "fixture-access-token";

async function main() {
  const harness = createCloudHarnessServer({ port: 0 });
  const { baseUrl, hostingBaseUrl } = await harness.listen();

  try {
    const runtime = createServiceWorkerRuntime(baseUrl, hostingBaseUrl);
    runScript(path.join(backgroundRoot, "service-worker.js"), runtime.context, "background/service-worker.js");
    assert.equal(typeof runtime.listener, "function", "Service worker should register a runtime message listener");

    const validSender = {
      url: "https://inova.incross.com/chat?sid=fixture-session",
    };

    const storeResponse = await sendMessage(
      runtime.listener,
      {
        type: "inova-store:list",
        filter: { categoryId: "all", limit: 10, ownerOnly: false, query: "", sortBy: "latest" },
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    assert.equal(storeResponse.ok, true);
    assert.equal(storeResponse.data.items.length, 2);

    const peekFirst = await sendMessage(
      runtime.listener,
      {
        type: "inova-sync:peek-prompt-library",
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    const peekSecond = await sendMessage(
      runtime.listener,
      {
        type: "inova-sync:peek-prompt-library",
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    assert.equal(peekFirst.ok, true);
    assert.equal(peekSecond.ok, true);

    const reviewResponse = await sendMessage(
      runtime.listener,
      {
        type: "inova-review:prompt",
        prompt: "Rewrite this draft for an executive audience.",
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    assert.equal(reviewResponse.ok, true);
    assert.equal(reviewResponse.data.verdict, "revise");

    const meetingCreate = await sendMessage(
      runtime.listener,
      {
        type: "inova-meeting:create-job",
        input: cloneValue(MEETING_CREATE_REQUEST),
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    assert.equal(meetingCreate.ok, true);
    assert.equal(meetingCreate.data.job.status, "queued");

    const meetingProcessing = await sendMessage(
      runtime.listener,
      {
        type: "inova-meeting:get-job",
        input: {
          jobId: meetingCreate.data.job.jobId,
          sessionId: meetingCreate.data.job.sessionId,
        },
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    assert.equal(meetingProcessing.ok, true);
    assert.equal(meetingProcessing.data.job.status, "processing");

    const meetingSucceeded = await sendMessage(
      runtime.listener,
      {
        type: "inova-meeting:get-job",
        input: {
          jobId: meetingCreate.data.job.jobId,
          sessionId: meetingCreate.data.job.sessionId,
        },
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    assert.equal(meetingSucceeded.ok, true);
    assert.equal(meetingSucceeded.data.job.status, "succeeded");

    const meetingArtifact = await sendMessage(
      runtime.listener,
      {
        type: "inova-meeting:get-artifact",
        input: {
          artifactId: meetingSucceeded.data.job.transcript.artifactId,
          jobId: meetingCreate.data.job.jobId,
        },
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      validSender
    );
    assert.equal(meetingArtifact.ok, true);
    assert.equal(meetingArtifact.data.artifact.segments.length > 0, true);

    const latestFirst = await sendMessage(
      runtime.listener,
      {
        type: "inova-release:latest",
      },
      validSender
    );
    const latestSecond = await sendMessage(
      runtime.listener,
      {
        type: "inova-release:latest",
      },
      validSender
    );
    assert.equal(latestFirst.ok, true);
    assert.equal(latestFirst.data.version, "0.3.8");
    assert.equal(latestSecond.ok, true);

    const openRelease = await sendMessage(
      runtime.listener,
      {
        type: "inova-release:open-url",
        url: "https://example.com/inova-extension-0.3.8.zip",
      },
      {
        url: "https://example.com/not-inova",
      }
    );
    assert.equal(openRelease.ok, true);
    assert.equal(runtime.tabsOpened.length, 1);
    assert.equal(runtime.tabsOpened[0].url, "https://example.com/inova-extension-0.3.8.zip");

    const invalidSender = await sendMessage(
      runtime.listener,
      {
        type: "inova-store:list",
        filter: { categoryId: "all", limit: 10, ownerOnly: false, query: "", sortBy: "latest" },
        providerIdentity: cloneValue(PROVIDER_IDENTITY),
      },
      {
        url: "https://example.com/not-inova",
      }
    );
    assert.equal(invalidSender.ok, false);
    assert(String(invalidSender.error || "").includes("i-Nova"), "Non-i-Nova senders should be rejected");

    assert.equal(runtime.cookieReads.length >= 3, true);
    assert.equal(runtime.cookieReads[0].name, "accessToken");

    const storeRequests = harness.state.requests.filter((request) => request.path === "/listPromptStoreEntries");
    const peekRequests = harness.state.requests.filter((request) => request.path === "/peekInovaPromptLibrary");
    const meetingCreateRequests = harness.state.requests.filter((request) => request.path === "/createInovaMeetingJob");
    const meetingJobRequests = harness.state.requests.filter((request) => request.path === "/getInovaMeetingJob");
    const meetingArtifactRequests = harness.state.requests.filter((request) => request.path === "/getInovaMeetingArtifact");
    const latestRequests = harness.state.requests.filter((request) => request.path === "/extension/releases/latest.json");
    assert.equal(storeRequests.length, 1);
    assert.equal(peekRequests.length, 1, "Peek should be served from service worker cache on the second request");
    assert.equal(meetingCreateRequests.length, 1);
    assert.equal(meetingJobRequests.length, 2);
    assert.equal(meetingArtifactRequests.length, 1);
    assert.equal(latestRequests.length, 1, "Latest release should be served from service worker cache on the second request");
    assert.equal(storeRequests[0].authorization, `Bearer ${accessToken}`);
    assert.equal(meetingCreateRequests[0].authorization, `Bearer ${accessToken}`);

    console.log("[verify-service-worker-harness] Service worker routing passed");
  } finally {
    await harness.close();
  }
}

function createServiceWorkerRuntime(baseUrl, hostingBaseUrl) {
  let messageListener = null;
  const tabsOpened = [];
  const cookieReads = [];
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console,
    fetch,
    setTimeout,
    __INOVA_FIREBASE_CONFIG_OVERRIDE__: {
      functions: {
        baseUrl,
      },
      hosting: {
        baseUrl: hostingBaseUrl,
      },
    },
    chrome: {
      cookies: {
        async get(details) {
          cookieReads.push(cloneValue(details));
          return { value: accessToken };
        },
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
      },
      tabs: {
        async create(details) {
          tabsOpened.push(cloneValue(details));
          return { id: tabsOpened.length };
        },
      },
    },
    importScripts(...relativePaths) {
      for (const relativePath of relativePaths) {
        runScript(path.resolve(backgroundRoot, relativePath), context, relativePath);
      }
    },
    location: { href: "chrome-extension://fixture/background/service-worker.js" },
  };
  context.globalThis = context;

  return {
    context: vm.createContext(context),
    get listener() {
      return messageListener;
    },
    tabsOpened,
    cookieReads,
  };
}

function sendMessage(listener, message, sender) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        reject(new Error(`Timed out waiting for service worker response: ${message.type}`));
      }
    }, 3000);

    const keepAlive = listener(message, sender, (response) => {
      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
    });

    if (keepAlive === false) {
      settled = true;
      clearTimeout(timeoutId);
      resolve({ ok: false, error: "Listener ignored the message." });
    }
  });
}

function runScript(filePath, context, label) {
  const source = fs.readFileSync(filePath, "utf8");
  new vm.Script(source, { filename: label }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-service-worker-harness] ${error.message}`);
  process.exit(1);
});
