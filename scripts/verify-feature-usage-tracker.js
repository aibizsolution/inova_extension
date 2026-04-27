#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const NOW_MS = Date.parse("2026-04-18T03:00:00.000Z");

async function main() {
  await verifyFirstUsageCreatesDurableSnapshot();
  await verifyProviderIdentityCallbackFallback();
  await verifyConversationOpenedOncePerDay();
  await verifyFlushFailureRetriesOnNextFlush();
  await verifyThresholdFlushAndSanitization();
  console.log("[verify-feature-usage-tracker] Feature usage tracker contract passed");
}

async function verifyFirstUsageCreatesDurableSnapshot() {
  const storage = createLocalStorage();
  const timers = [];
  const { tracker } = createTrackerHarness({
    storage,
    timers,
  });

  const recorded = await tracker.record("prompt_review", "completed", "success", {
    source: {
      extensionVersion: "1.0.0",
      lane: "v2",
      rawContent: "should-not-store",
      url: "https://example.invalid/raw",
    },
  });

  assert.equal(recorded, true);
  assert.equal(timers.at(-1)?.delayMs, 60000, "first meaningful action should schedule a 60s flush");
  const outbox = readSingleOutbox(storage);
  assert.equal(outbox.dayKey, "2026-04-18");
  assert.equal(outbox.dirtyCount, 1);
  assert.equal(outbox.counters.prompt_review.completed.success, 1);
  assert.equal(JSON.stringify(outbox).includes("should-not-store"), false);
  assert.equal(JSON.stringify(outbox).includes("example.invalid"), false);
  assert.equal(Array.isArray(outbox.events), false);
}

async function verifyProviderIdentityCallbackFallback() {
  const storage = createLocalStorage();
  const { tracker } = createTrackerHarness({
    readPanelStorageState: async () => ({}),
    readProviderIdentity: () => ({
      available: true,
      displayName: "Snapshot User",
      email: "snapshot@example.com",
      numericUserId: 99,
      provider: "inova",
      providerUserKey: "snapshot-user",
    }),
    storage,
  });

  const recorded = await tracker.record("conversation", "jumped", "success");

  assert.equal(recorded, true);
  const outbox = readSingleOutbox(storage);
  assert.equal(outbox.providerIdentity.providerUserKey, "snapshot-user");
  assert.equal(outbox.providerIdentity.email, "snapshot@example.com");
  assert.equal(outbox.providerIdentity.numericUserId, 99);
  assert.equal(outbox.counters.conversation.jumped.success, 1);
}

async function verifyConversationOpenedOncePerDay() {
  const storage = createLocalStorage();
  const { tracker } = createTrackerHarness({
    storage,
  });

  const first = await tracker.recordOncePerDay("conversation", "opened", "success");
  const second = await tracker.recordOncePerDay("conversation", "opened", "success");

  assert.equal(first, true);
  assert.equal(second, false);
  const outbox = readSingleOutbox(storage);
  assert.equal(outbox.counters.conversation.opened.success, 1);
  assert.equal(outbox.counters.conversation.jumped, undefined);
}

async function verifyFlushFailureRetriesOnNextFlush() {
  const storage = createLocalStorage();
  let shouldFail = true;
  const commitCalls = [];
  const { tracker } = createTrackerHarness({
    storage,
    commitFeatureUsageBatch: async (payload) => {
      commitCalls.push(cloneValue(payload));
      if (shouldFail) {
        throw new Error("network down");
      }
      return {
        committed: true,
        deltaTotal: 1,
      };
    },
  });

  await tracker.record("conversation", "jumped", "success");
  const failed = await tracker.flush("test-failure");
  assert.equal(failed.failed, 1);
  assert.equal(readSingleOutbox(storage).dirtyCount, 1, "failed flush should keep the dirty outbox snapshot");

  shouldFail = false;
  const retried = await tracker.flush("test-retry");
  assert.equal(retried.committed, 1);
  assert.equal(commitCalls.length, 2);
  const outbox = readSingleOutbox(storage);
  assert.equal(outbox.dirtyCount, 0);
  assert.equal(outbox.lastCommittedSequence, 1);
}

async function verifyThresholdFlushAndSanitization() {
  const storage = createLocalStorage();
  const commitCalls = [];
  const { tracker } = createTrackerHarness({
    storage,
    commitFeatureUsageBatch: async (payload) => {
      commitCalls.push(cloneValue(payload));
      return {
        committed: true,
        deltaTotal: 20,
      };
    },
  });

  for (let index = 0; index < 20; index += 1) {
    await tracker.record("prompt_store", "liked", "success", {
      providerIdentity: {
        available: true,
        displayName: "Tester",
        email: "tester@example.com",
        provider: "inova",
        providerUserKey: "user-1",
      },
      source: {
        browserFingerprint: "should-not-store",
        extensionVersion: "1.0.0",
        ip: "127.0.0.1",
        target: "production",
        userAgent: "raw-agent",
      },
    });
  }
  await flushAsync();

  assert.equal(commitCalls.length, 1, "dirty count threshold should trigger a background flush");
  assert.equal(commitCalls[0].counters.prompt_store.liked.success, 20);
  assert.deepEqual(Object.keys(commitCalls[0].source).sort(), ["extensionVersion", "lane", "surface", "target"]);
  assert.equal(JSON.stringify(commitCalls[0]).includes("raw-agent"), false);
  assert.equal(JSON.stringify(commitCalls[0]).includes("127.0.0.1"), false);
  assert.equal(readSingleOutbox(storage).dirtyCount, 0);
}

function createTrackerHarness(overrides = {}) {
  const storage = overrides.storage || createLocalStorage();
  const timers = overrides.timers || [];
  const context = vm.createContext({
    clearTimeout() {},
    console,
    crypto: {
      randomUUID: () => "client-instance-1",
    },
    Date: createFakeDate(),
    document: {
      addEventListener() {},
      visibilityState: "visible",
    },
    globalThis: null,
    localStorage: storage,
    Math,
    setTimeout(callback, delayMs) {
      timers.push({ callback, delayMs });
      return timers.length;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    panelUtils: {
      normalizeText(value) {
        return String(value || "").trim();
      },
      resolveBrowserCapabilities() {
        return {
          commitFeatureUsageBatch: overrides.commitFeatureUsageBatch || (async () => ({ committed: true, deltaTotal: 1 })),
          readPanelStorageState: overrides.readPanelStorageState || (async () => ({
            providerIdentityCache: {
              providerIdentity: {
                available: true,
                displayName: "Tester",
                email: "tester@example.com",
                provider: "inova",
                providerUserKey: "user-1",
              },
            },
          })),
        };
      },
    },
  };
  loadScript(path.join("hosting", "extension-v2", "panel", "feature-usage-tracker.js"), context);
  const tracker = context.InovaBookmarks.featureUsageTracker.create({
    browserCapabilities: context.InovaBookmarks.panelUtils.resolveBrowserCapabilities(),
    readProviderIdentity: overrides.readProviderIdentity,
    readSource: () => ({
      extensionVersion: "1.0.0",
      lane: "v2",
      surface: "hosted-panel",
    }),
    storage,
  });
  return { context, storage, timers, tracker };
}

function createLocalStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function readSingleOutbox(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (String(key || "").startsWith("inova.featureUsage.outbox.v1::")) {
      keys.push(key);
    }
  }
  assert.equal(keys.length, 1);
  return JSON.parse(storage.getItem(keys[0]));
}

function createFakeDate() {
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) {
      return new Date(args.length ? Date(...args) : NOW_MS).toString();
    }
    return args.length ? new Date(...args) : new Date(NOW_MS);
  }
  FakeDate.now = () => NOW_MS;
  FakeDate.parse = Date.parse;
  FakeDate.UTC = Date.UTC;
  FakeDate.prototype = Date.prototype;
  return FakeDate;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

main().catch((error) => {
  console.error(`[verify-feature-usage-tracker] ${error.stack || error.message}`);
  process.exitCode = 1;
});
