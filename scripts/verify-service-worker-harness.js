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
    const popupSender = {
      url: "chrome-extension://fixture/popup/index.html",
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
      popupSender
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

    const captureStart = await sendMessage(
      runtime.listener,
      {
        type: "inova-meeting:start-capture",
        input: {
          captureMode: "tab-audio",
          sessionId: "fixture-session",
          tabId: 81,
          title: "주간 스탠드업",
        },
      },
      popupSender
    );
    assert.equal(captureStart.ok, true);
    assert.equal(captureStart.data.capture.status, "recording");
    assert.equal(runtime.streamIdRequests.length, 1);
    assert.equal(runtime.streamIdRequests[0].targetTabId, 81);
    assert.equal(runtime.offscreen.createdCount, 1);
    assert.equal(runtime.storageState.meetingStateBySession["fixture-session"].capture.status, "recording");

    const captureStop = await sendMessage(
      runtime.listener,
      {
        type: "inova-meeting:stop-capture",
        input: {
          sessionId: "fixture-session",
        },
      },
      popupSender
    );
    assert.equal(captureStop.ok, true);
    assert.equal(captureStop.data.capture.status, "captured");
    assert.equal(runtime.offscreen.closedCount, 1);
    assert.equal(runtime.storageState.meetingStateBySession["fixture-session"].capture.status, "captured");

    const recorderFailure = await sendMessage(
      runtime.listener,
      {
        type: "inova-meeting:recorder-failed",
        payload: {
          capture: {
            captureMode: "tab-audio",
            error: "오디오 권한이 차단됐어요.",
          },
          error: "오디오 권한이 차단됐어요.",
          meeting: {
            sessionId: "fixture-session",
            title: "주간 스탠드업",
          },
        },
      },
      {
        url: "chrome-extension://fixture/offscreen/meeting-recorder.html",
      }
    );
    assert.equal(recorderFailure.ok, true);
    assert.equal(recorderFailure.data.handled, true);
    assert.equal(runtime.storageState.meetingStateBySession["fixture-session"].capture.status, "error");

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
    assert.deepEqual(
      runtime.runtimeMessages.map((message) => message.type),
      ["inova-meeting:start-capture", "inova-meeting:stop-capture"]
    );

    console.log("[verify-service-worker-harness] Service worker routing passed");
  } finally {
    await harness.close();
  }
}

function createServiceWorkerRuntime(baseUrl, hostingBaseUrl) {
  let messageListener = null;
  const tabsOpened = [];
  const cookieReads = [];
  const runtimeMessages = [];
  const streamIdRequests = [];
  let storageState = {};
  let captureState = null;
  const offscreen = {
    closedCount: 0,
    createdCount: 0,
    documentOpen: false,
  };
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console,
    fetch,
    setTimeout,
    structuredClone: cloneValue,
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
        async getContexts() {
          return offscreen.documentOpen
            ? [
                {
                  contextType: "OFFSCREEN_DOCUMENT",
                  documentUrl: "chrome-extension://fixture/offscreen/meeting-recorder.html",
                },
              ]
            : [];
        },
        async sendMessage(message) {
          runtimeMessages.push(cloneValue(message));
          if (message?.target !== "offscreen") {
            throw new Error(`Unexpected runtime target: ${message?.type}`);
          }
          if (message.type === "inova-meeting:start-capture") {
            captureState = {
              captureMode: cloneValue(message.data.captureMode),
              mimeType: "audio/webm;codecs=opus",
              sessionId: cloneValue(message.data.sessionId),
              title: cloneValue(message.data.title),
            };
            return {
              capture: {
                captureMode: captureState.captureMode,
                mimeType: captureState.mimeType,
                status: "recording",
              },
              meeting: {
                sessionId: captureState.sessionId,
                title: captureState.title,
              },
            };
          }
          if (message.type === "inova-meeting:stop-capture") {
            const stoppedSessionId = cloneValue(message.data.sessionId || captureState?.sessionId || "");
            const stoppedTitle = cloneValue(captureState?.title || "");
            captureState = null;
            return {
              capture: {
                captureMode: "tab-audio",
                durationMs: 65000,
                mimeType: "audio/webm;codecs=opus",
                sizeBytes: 1048576,
                status: "captured",
              },
              meeting: {
                sessionId: stoppedSessionId,
                title: stoppedTitle,
              },
            };
          }
          throw new Error(`Unexpected offscreen message: ${message.type}`);
        },
      },
      storage: {
        local: {
          async get(keys) {
            if (keys && typeof keys === "object" && !Array.isArray(keys)) {
              return mergeDefaults(keys, storageState);
            }
            if (Array.isArray(keys)) {
              return keys.reduce((result, key) => {
                result[key] = cloneValue(storageState[key]);
                return result;
              }, {});
            }
            if (typeof keys === "string") {
              return { [keys]: cloneValue(storageState[keys]) };
            }
            return cloneValue(storageState);
          },
          async set(partial) {
            storageState = {
              ...storageState,
              ...cloneValue(partial || {}),
            };
          },
        },
      },
      offscreen: {
        async closeDocument() {
          if (offscreen.documentOpen) {
            offscreen.closedCount += 1;
            offscreen.documentOpen = false;
          }
        },
        async createDocument() {
          offscreen.createdCount += 1;
          offscreen.documentOpen = true;
        },
      },
      tabCapture: {
        async getMediaStreamId(details) {
          streamIdRequests.push(cloneValue(details));
          return `stream-${Number(details?.targetTabId) || 0}`;
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
    offscreen,
    runtimeMessages,
    storageState: new Proxy(
      {},
      {
        get(_target, key) {
          return storageState[key];
        },
      }
    ),
    streamIdRequests,
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

function mergeDefaults(defaults, values) {
  const result = {};
  for (const [key, defaultValue] of Object.entries(defaults || {})) {
    const nextValue = values == null ? undefined : values[key];
    if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
      result[key] = mergeDefaults(defaultValue, nextValue || {});
      continue;
    }
    result[key] = nextValue !== undefined ? cloneValue(nextValue) : cloneValue(defaultValue);
  }
  for (const [key, value] of Object.entries(values || {})) {
    if (!(key in result)) {
      result[key] = cloneValue(value);
    }
  }
  return result;
}

main().catch((error) => {
  console.error(`[verify-service-worker-harness] ${error.message}`);
  process.exit(1);
});
