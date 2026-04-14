#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");

async function main() {
  const sentMessages = [];
  let storageState = {
    meetingStateByMeetingId: {
      "meeting-alpha": {
        selectedRecordId: "job:meeting-job-1",
      },
    },
  };

  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentMessages.push(cloneValue(message));
          return {
            ok: true,
            data: {
              echoedType: message.type,
              items: [],
              opened: message.type === "inova-meeting:open-workspace" || message.type === "inova-meeting:open-result",
            },
          };
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
            storageState = {
              ...storageState,
              ...cloneValue(partial || {}),
            };
          },
        },
      },
    },
    console,
    globalThis: null,
    location: { href: "https://inova.incross.com/chat?sid=fixture-session" },
    structuredClone: cloneValue,
  });
  context.globalThis = context;

  loadScript("shared/constants.js", context);
  loadScript("shared/session.js", context);
  loadScript("shared/storage.js", context);
  loadScript("backup/legacy-panel/shared/meeting-bridge.js", context);

  const namespace = context.InovaBookmarks;
  const removedPrimaryStateKey = ["meeting", "State"].join("");
  const removedSessionScopedStateKey = ["meeting", "State", "By", "Session"].join("");
  const removedPrimaryStateGetter = ["get", "Meeting", "State"].join("");
  const removedSessionScopedStateGetter = ["get", "Meeting", "State", "By", "Session"].join("");

  assert.equal(namespace.constants.storageKeys.meetingStateByMeetingId, "meetingStateByMeetingId");
  assert.equal(Object.prototype.hasOwnProperty.call(namespace.constants.storageKeys, removedPrimaryStateKey), false);
  assert.equal(Object.prototype.hasOwnProperty.call(namespace.constants.storageKeys, removedSessionScopedStateKey), false);
  assert.equal(typeof namespace.storage.getMeetingStateByMeetingId, "function");
  assert.equal(typeof namespace.storage[removedPrimaryStateGetter], "undefined");
  assert.equal(typeof namespace.storage[removedSessionScopedStateGetter], "undefined");

  const storedState = await namespace.storage.getMeetingStateByMeetingId();
  assert.deepEqual(storedState, storageState.meetingStateByMeetingId);

  const storageUnavailableContext = vm.createContext({
    chrome: {},
    console,
    globalThis: null,
    structuredClone: cloneValue,
  });
  storageUnavailableContext.globalThis = storageUnavailableContext;
  loadScript("shared/constants.js", storageUnavailableContext);
  loadScript("shared/session.js", storageUnavailableContext);
  loadScript("shared/storage.js", storageUnavailableContext);
  await assert.rejects(
    () => storageUnavailableContext.InovaBookmarks.storage.getState(),
    (error) => error?.code === "storage-unavailable"
  );

  const invalidatedStorageContext = vm.createContext({
    chrome: {
      storage: {
        local: {
          async get() {
            throw new Error("Extension context invalidated.");
          },
        },
      },
    },
    console,
    globalThis: null,
    structuredClone: cloneValue,
  });
  invalidatedStorageContext.globalThis = invalidatedStorageContext;
  loadScript("shared/constants.js", invalidatedStorageContext);
  loadScript("shared/session.js", invalidatedStorageContext);
  loadScript("shared/storage.js", invalidatedStorageContext);
  await assert.rejects(
    () => invalidatedStorageContext.InovaBookmarks.storage.getState(),
    (error) => error?.code === "extension-context-invalidated"
  );

  await namespace.meetingBridge.issuePanelAuth({ providerUserKey: "fixture-user" });
  await namespace.meetingBridge.listMeetings({ limit: 5 }, { providerUserKey: "fixture-user" });
  await namespace.meetingBridge.openMeetingWorkspace({ meetingId: "meeting-alpha" }, { providerUserKey: "fixture-user" });
  await namespace.meetingBridge.openMeetingResult({ meetingId: "meeting-alpha", jobId: "meeting-job-1" }, { providerUserKey: "fixture-user" });

  assert.deepEqual(
    sentMessages.map((message) => message.type),
    [
      "inova-meeting:issue-panel-auth",
      "inova-meeting:list-meetings",
      "inova-meeting:open-workspace",
      "inova-meeting:open-result",
    ]
  );

  assert(sentMessages.every((message) => !String(message.type || "").includes("create-job")));
  assert(sentMessages.every((message) => !String(message.type || "").includes("get-job")));
  assert(sentMessages.every((message) => !String(message.type || "").includes("get-artifact")));
  assert(sentMessages.every((message) => !String(message.type || "").includes("start-capture")));
  assert(sentMessages.every((message) => !String(message.type || "").includes("stop-capture")));

  console.log("[verify-meeting-state] hosted-only meeting storage and bridge passed");
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
  console.error(`[verify-meeting-state] ${error.message}`);
  process.exit(1);
});
