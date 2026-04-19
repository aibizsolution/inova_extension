#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyRuntimePrepareOpenContract();
  await verifyMeetingHubWebOpenFirst();
  console.log("[verify-controllable-tab-open] Controllable tab open contract passed");
}

function verifyRuntimePrepareOpenContract() {
  const routerSource = readText("background/panel-runtime-capability-router.js");
  const serviceWorkerSource = readText("background/service-worker.js");
  const meetingCapabilitySource = readText("background/meeting-workspace-capability.js");
  const clientSource = readText("hosting/extension-v2/panel/extension-capability-client.js");

  assert(
    routerSource.includes('"meeting.result.prepare-open"')
      && routerSource.includes('"meeting.workspace.prepare-open"')
      && routerSource.includes("prepareMeetingResultOpen(request?.input, request?.providerIdentity)")
      && routerSource.includes("prepareMeetingWorkspaceOpen(request?.input, request?.providerIdentity)"),
    "runtime router should expose meeting prepare-open actions separately from background tab open fallback"
  );
  assert(
    serviceWorkerSource.includes("prepareMeetingResultOpen: meetingWorkspaceCapability.prepareResultOpen")
      && serviceWorkerSource.includes("prepareMeetingWorkspaceOpen: meetingWorkspaceCapability.prepareWorkspaceOpen"),
    "service worker should publish meeting prepare-open adapters to the runtime router"
  );
  assert(
    meetingCapabilitySource.includes("function prepareHostedMeetingPage")
      && meetingCapabilitySource.includes("prepareResultOpen")
      && meetingCapabilitySource.includes("prepareWorkspaceOpen"),
    "meeting workspace capability should prepare URLs without opening a Chrome tab"
  );
  assert(
    clientSource.includes("prepareMeetingResultOpen")
      && clientSource.includes("prepareMeetingWorkspaceOpen")
      && clientSource.includes('action: "meeting.result.prepare-open"')
      && clientSource.includes('action: "meeting.workspace.prepare-open"'),
    "hosted capability client should expose semantic prepare-open helpers"
  );
}

async function verifyMeetingHubWebOpenFirst() {
  const runtimeCalls = [];
  const openedWindows = [];
  const context = vm.createContext({
    clearTimeout() {},
    console,
    globalThis: null,
    open(url, target) {
      const openedWindow = {
        closed: false,
        initialUrl: String(url || ""),
        location: {
          href: String(url || ""),
        },
        target: String(target || ""),
        close() {
          this.closed = true;
        },
      };
      openedWindows.push(openedWindow);
      return openedWindow;
    },
    setTimeout() {
      return 1;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };

  loadScript("hosting/extension-v2/panel/panel-utils.js", context);
  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/meeting-hub-controller.js", context);

  const controller = context.InovaBookmarks.meetingHubController.create({
    invokePage: async () => {
      throw new Error("page calls are not expected for meeting tab open");
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      if (request?.action === "storage.read-panel-state") {
        return {
          providerIdentityCache: {
            providerIdentity: {
              available: true,
              provider: "inova",
              providerUserKey: "fixture-user",
            },
          },
          settings: {
            meetingWorkspaceTarget: "production",
          },
        };
      }
      if (request?.action === "meeting.result.prepare-open") {
        return {
          meeting: {
            meetingId: request?.input?.meetingId || "meeting-alpha",
            title: request?.input?.title || "Alpha",
          },
          opened: false,
          tabId: 0,
          url: "https://meeting.example/result",
        };
      }
      if (request?.action === "meeting.result.open") {
        throw new Error("background tab open fallback should not run when web-open succeeds");
      }
      throw new Error(`Unexpected runtime action: ${request?.action}`);
    },
    meetingRealtime: {
      disconnect() {},
      async ensureSubscribed() {
        return {
          checkedAt: "2026-04-13T01:02:03.000Z",
          fromCache: false,
          hasPendingWrites: false,
          items: [],
        };
      },
    },
    publishToast() {
      return true;
    },
    scheduleRender() {},
    traceMeeting() {},
  });

  controller.syncPanelState({
    activeTool: "meeting",
    open: true,
    providerIdentity: {
      available: true,
      provider: "inova",
      providerUserKey: "fixture-user",
    },
    settings: {
      meetingWorkspaceTarget: "production",
    },
  }, ["runtime.invoke.v1"]);
  await flushAsyncTurns();

  const handled = await controller.handleMeetingAction("open-result", {
    jobId: "job-alpha",
    meetingId: "meeting-alpha",
    title: "Alpha",
  });

  assert.equal(handled, true);
  assert(runtimeCalls.some((request) => request.action === "meeting.result.prepare-open"));
  assert(!runtimeCalls.some((request) => request.action === "meeting.result.open"));
  assert.equal(openedWindows.length, 1);
  assert.equal(openedWindows[0].initialUrl, "about:blank");
  assert.equal(openedWindows[0].target, "_blank");
  assert.equal(openedWindows[0].location.href, "https://meeting.example/result");
}

async function flushAsyncTurns(turns = 20) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

function loadScript(relativePath, context) {
  const source = readText(relativePath);
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error("[verify-controllable-tab-open] Failed");
  console.error(error);
  process.exit(1);
});
