#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyRealtimeSnapshotState();
  await verifyRuntimeReadFallbackState();
  await verifyStaleCacheFallbackState();
  await verifyEmptyFallbackState();
  await verifyInactiveRefreshIsQuiet();
  await verifyRouteStateChangeStaysQuietAfterRealtimeReady();
  console.log("[verify-meeting-manager] Meeting hub fallback contract passed");
}

async function verifyRealtimeSnapshotState() {
  const harness = createHarness({
    bridgeMode: "snapshot",
    initialMeetingHub: {},
    snapshotItems: [
      {
        excerpt: "실시간 스냅샷으로 회의 허브를 받았습니다.",
        latestArtifactId: "artifact-realtime",
        latestJobId: "job-realtime",
        meetingId: "meeting-realtime",
        status: "succeeded",
        title: "실시간 회의",
        updatedAt: "2026-04-04T08:10:00.000Z",
      },
    ],
  });

  await harness.manager.refreshState("verify-realtime");
  await harness.flush();

  assert.equal(harness.state.meetingHub.items.length, 1);
  assert.equal(harness.state.meetingHub.items[0].meetingId, "meeting-realtime");
  assert.equal(harness.state.meetingHub.degraded, false);
  assert.equal(harness.state.meetingHub.degradedReason, "");
  assert.equal(harness.state.meetingHub.dataFreshness, "fresh");
  assert.equal(harness.state.meetingHub.error, "");
  assert.equal(harness.state.meetingHub.source, "realtime");
  assert.deepEqual(
    harness.sentMessages.map((message) => message.type),
    ["inova-meeting:issue-panel-auth"],
    "Realtime snapshot should stop at panel auth and bridge snapshot"
  );
}

async function verifyRuntimeReadFallbackState() {
  const harness = createHarness({
    bridgeMode: "unavailable",
    initialMeetingHub: {},
    runtimeListMode: "success",
    runtimeItems: [
      {
        excerpt: "요청형 읽기로 최신 목록을 다시 가져왔습니다.",
        latestArtifactId: "artifact-runtime",
        latestJobId: "job-runtime",
        meetingId: "meeting-runtime",
        status: "processing",
        title: "요청형 회의",
        updatedAt: "2026-04-04T08:20:00.000Z",
      },
    ],
  });

  await harness.manager.refreshState("verify-runtime-read");
  await harness.flush();

  assert.equal(harness.state.meetingHub.items.length, 1);
  assert.equal(harness.state.meetingHub.items[0].meetingId, "meeting-runtime");
  assert.equal(harness.state.meetingHub.degraded, true);
  assert.equal(harness.state.meetingHub.degradedReason, "meeting-hub-realtime-failed");
  assert.equal(harness.state.meetingHub.dataFreshness, "fresh");
  assert.equal(harness.state.meetingHub.source, "runtime-read");
  assert.equal(
    harness.sentMessages.map((message) => message.type).join(","),
    "inova-meeting:list-meetings"
  );
}

async function verifyStaleCacheFallbackState() {
  const harness = createHarness({
    bridgeMode: "unavailable",
    initialMeetingHub: {
      checkedAt: "2026-04-04T08:00:00.000Z",
      items: [
        {
          excerpt: "이전 캐시 항목",
          latestArtifactId: "artifact-cache",
          latestJobId: "job-cache",
          meetingId: "meeting-cache",
          status: "succeeded",
          title: "캐시 회의",
          updatedAt: "2026-04-04T07:40:00.000Z",
        },
      ],
      source: "cache",
    },
    runtimeListMode: "error",
  });

  await harness.manager.refreshState("verify-stale-cache");
  await harness.flush();

  assert.equal(harness.state.meetingHub.items.length, 1);
  assert.equal(harness.state.meetingHub.items[0].meetingId, "meeting-cache");
  assert.equal(harness.state.meetingHub.degraded, true);
  assert.equal(harness.state.meetingHub.degradedReason, "meeting-hub-stale-cache");
  assert.equal(harness.state.meetingHub.dataFreshness, "stale");
  assert.equal(harness.state.meetingHub.source, "cache");
  assert(harness.state.meetingHub.error.includes("추가 읽기에도 실패했어요"));
}

async function verifyEmptyFallbackState() {
  const harness = createHarness({
    bridgeMode: "unavailable",
    initialMeetingHub: {},
    runtimeListMode: "error",
  });

  await harness.manager.refreshState("verify-empty");
  await harness.flush();

  assert.equal(harness.state.meetingHub.items.length, 0);
  assert.equal(harness.state.meetingHub.degraded, true);
  assert.equal(harness.state.meetingHub.degradedReason, "meeting-hub-empty");
  assert.equal(harness.state.meetingHub.dataFreshness, "empty");
  assert.equal(harness.state.meetingHub.source, "none");
  assert(harness.state.meetingHub.error.includes("회의 목록을 다시 불러오지 못했어요."));
}

async function verifyInactiveRefreshIsQuiet() {
  const harness = createHarness({
    activeTool: "bookmarks",
    bridgeMode: "snapshot",
    initialMeetingHub: {
      checkedAt: "2026-04-04T08:00:00.000Z",
      items: [],
      source: "none",
    },
    open: true,
  });

  await harness.manager.refreshState("verify-inactive");
  await harness.flush();

  assert.equal(harness.renderCount(), 0);
  assert.deepEqual(harness.sentMessages, []);
}

async function verifyRouteStateChangeStaysQuietAfterRealtimeReady() {
  const harness = createHarness({
    bridgeMode: "snapshot",
    initialMeetingHub: {
      checkedAt: "2026-04-04T08:00:00.000Z",
      items: [
        {
          excerpt: "기존 회의",
          latestArtifactId: "artifact-existing",
          latestJobId: "job-existing",
          meetingId: "meeting-existing",
          status: "succeeded",
          title: "기존 회의",
          updatedAt: "2026-04-04T08:00:00.000Z",
        },
      ],
      source: "realtime",
    },
    snapshotItems: [
      {
        excerpt: "실시간 스냅샷으로 회의 허브를 받았습니다.",
        latestArtifactId: "artifact-realtime",
        latestJobId: "job-realtime",
        meetingId: "meeting-realtime",
        status: "succeeded",
        title: "실시간 회의",
        updatedAt: "2026-04-04T08:10:00.000Z",
      },
    ],
  });

  await harness.manager.refreshState("verify-realtime-ready");
  await harness.flush();
  const renderCountBefore = harness.renderCount();
  const sentCountBefore = harness.sentMessages.length;

  harness.manager.handleRouteStateChange();
  await harness.flush();

  assert.equal(harness.renderCount(), renderCountBefore);
  assert.equal(harness.sentMessages.length, sentCountBefore);
}

function createHarness(options = {}) {
  const sentMessages = [];
  const scheduledTasks = [];
  const loadedScripts = [
    "shared/constants.js",
    "shared/session.js",
    "shared/storage.js",
    "shared/meeting-bridge.js",
    "shared/provider-identity.js",
    "content/meeting-panel-bridge-controller.js",
    "content/meeting-manager.js",
  ];
  let nextTimerId = 1;
  let renderCount = 0;
  const bridgeState = {
    snapshotItems: Array.isArray(options.snapshotItems) ? cloneValue(options.snapshotItems) : [],
  };
  const storageState = {
    cloudSync: {
      providerIdentity: {
        available: true,
        displayName: "Fixture User",
        email: "fixture@example.com",
        numericUserId: 1001,
        provider: "inova",
        providerUserKey: "fixture-user",
      },
    },
  };

  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentMessages.push(cloneValue(message));
          if (message.type === "inova-meeting:issue-panel-auth") {
            return {
              ok: true,
              data: {
                expiresAt: "2026-04-04T09:00:00.000Z",
                firebaseCustomToken: "fixture-custom-token",
                providerUserKey: "fixture-user",
              },
            };
          }
          if (message.type === "inova-meeting:list-meetings") {
            if (options.runtimeListMode === "error") {
              throw new Error("회의 목록을 다시 불러오지 못했어요.");
            }
            return {
              ok: true,
              data: {
                items: cloneValue(options.runtimeItems || []),
                nextCursor: "",
              },
            };
          }
          return { ok: false, error: "Unexpected runtime message" };
        },
      },
      storage: {
        local: {
          async get(keys) {
            if (keys && typeof keys === "object" && !Array.isArray(keys)) {
              return mergeDefaults(keys, storageState);
            }
            return cloneValue(storageState);
          },
          async set(partial) {
            Object.assign(storageState, cloneValue(partial || {}));
          },
        },
      },
    },
    console,
    document: createDocumentStub(options.bridgeMode, bridgeState),
    globalThis: null,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    localStorage: {
      getItem(key) {
        if (key !== "auth") {
          return null;
        }
        return JSON.stringify({
          userInfo: {
            email: "fixture@example.com",
            id: 1001,
            name: "Fixture User",
            userKey: "fixture-user",
          },
        });
      },
    },
    MessageChannel: createMessageChannelClass(options.bridgeMode, bridgeState),
    clearTimeout(timerId) {
      const task = scheduledTasks.find((entry) => entry.id === timerId);
      if (task) {
        task.cleared = true;
      }
    },
    setTimeout(callback, delay) {
      const task = { callback, cleared: false, delay, id: nextTimerId += 1 };
      scheduledTasks.push(task);
      return task.id;
    },
    structuredClone: cloneValue,
  });
  context.globalThis = context;

  for (const relativePath of loadedScripts) {
    loadScript(relativePath, context);
  }

  context.InovaBookmarks.firebaseConfig = {
    hosting: {
      meetingPanelBridgeUrl: "https://browser-extension-main.web.app/meeting-panel-bridge.html",
      originUrl: "https://browser-extension-main.web.app",
    },
  };
  context.InovaBookmarks.panelDebug = {
    isEnabled() {
      return false;
    },
    log() {},
  };

  const namespace = context.InovaBookmarks;
  const state = {
    activeTool: options.activeTool || "meeting",
    meetingHub: namespace.meetingManager.mergeMeetingHub(options.initialMeetingHub),
    open: Object.prototype.hasOwnProperty.call(options, "open") ? Boolean(options.open) : true,
  };

  return {
    manager: namespace.meetingManager.create(state, {
      render() {
        renderCount += 1;
      },
    }),
    async flush() {
      await Promise.resolve();
      const pendingTasks = scheduledTasks.splice(0);
      for (const task of pendingTasks) {
        if (!task.cleared) {
          await Promise.resolve(task.callback());
        }
      }
      await Promise.resolve();
    },
    namespace,
    renderCount: () => renderCount,
    sentMessages,
    state,
  };
}

function createDocumentStub(bridgeMode, bridgeState) {
  if (bridgeMode === "unavailable") {
    return {
      body: {
        appendChild() {},
      },
      createElement() {
        throw new Error("Bridge iframe unavailable");
      },
      getElementById() {
        return null;
      },
      hidden: false,
    };
  }

  let existingFrame = null;
  return {
    body: {
      appendChild(node) {
        existingFrame = node;
      },
    },
    createElement() {
      const listeners = new Map();
      const frame = {
        contentWindow: {
          postMessage(_message, _origin, ports) {
            const bridgePort = ports[0];
            bridgePort.onmessage = (event) => {
              const message = event?.data && typeof event.data === "object" ? event.data : {};
              if (message.type !== "init") {
                return;
              }
              bridgePort.postMessage({
                payload: {
                  checkedAt: "2026-04-04T08:10:00.000Z",
                  items: cloneValue(bridgeState.snapshotItems),
                  requestId: message.requestId,
                },
                type: "snapshot",
              });
              bridgePort.postMessage({
                payload: {
                  requestId: message.requestId,
                },
                type: "connected",
              });
            };
            bridgePort.postMessage({ type: "ready" });
          },
        },
        dataset: { loaded: "1" },
        id: "",
        setAttribute() {},
        style: {},
        tabIndex: -1,
        addEventListener(type, handler) {
          listeners.set(type, handler);
        },
        removeEventListener(type) {
          listeners.delete(type);
        },
      };
      existingFrame = frame;
      return frame;
    },
    getElementById() {
      return existingFrame;
    },
    hidden: false,
  };
}

function createMessageChannelClass(bridgeMode) {
  if (bridgeMode === "unavailable") {
    return function MessageChannelUnavailable() {
      throw new Error("MessageChannel should not be created when bridge is unavailable");
    };
  }
  return class FakeMessageChannel {
    constructor() {
      this.port1 = new FakePort();
      this.port2 = new FakePort();
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  };
}

class FakePort {
  constructor() {
    this.onmessage = null;
    this.peer = null;
  }

  postMessage(data) {
    if (typeof this.peer?.onmessage === "function") {
      this.peer.onmessage({ data: cloneValue(data) });
    }
  }

  start() {}
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
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

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-meeting-manager] ${error.message}`);
  process.exit(1);
});
