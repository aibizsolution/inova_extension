#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  const sentMessages = [];
  const scheduledTasks = [];
  const consoleErrors = [];
  let nextTimerId = 1;
  let renderCount = 0;
  let storageState = {
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
    meetingHub: {
      version: 1,
      checkedAt: "",
      error: "",
      items: [],
    },
  };

  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentMessages.push(cloneValue(message));
          if (message.type === "inova-meeting:list-meetings") {
            return {
              ok: true,
              data: {
                items: [
                  {
                    meetingId: "meeting-fixture-2",
                    title: "주간 스탠드업",
                    status: "succeeded",
                    latestJobId: "meeting-job-fixture-2",
                    latestArtifactId: "meeting-artifact-fixture-2",
                    excerpt: "이번 주 프로모션 일정과 예산 초안을 정리했습니다.",
                    createdAt: "2026-03-30T08:20:00.000Z",
                    updatedAt: "2026-03-30T08:31:00.000Z",
                  },
                ],
                nextCursor: "",
              },
            };
          }
          return { ok: false, error: "Unexpected message" };
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
    console: {
      ...console,
      error(...args) {
        consoleErrors.push(args);
        console.error(...args);
      },
    },
    globalThis: null,
    localStorage: {
      getItem(key) {
        if (key === "auth") {
          return JSON.stringify({
            userInfo: {
              email: "fixture@example.com",
              id: 1001,
              name: "Fixture User",
              userKey: "fixture-user",
            },
          });
        }
        return null;
      },
    },
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

  loadScript("shared/constants.js", context);
  loadScript("shared/session.js", context);
  loadScript("shared/meeting-state.js", context);
  loadScript("shared/storage.js", context);
  loadScript("shared/meeting-bridge.js", context);
  loadScript("shared/provider-identity.js", context);
  loadScript("content/meeting-manager.js", context);

  const namespace = context.InovaBookmarks;
  const state = {
    meetingHub: namespace.meetingManager.mergeMeetingHub(),
  };
  const manager = namespace.meetingManager.create(state, {
    render() {
      renderCount += 1;
    },
  });

  manager.handleStorageChange(
    {
      cloudSync: {
        oldValue: {},
        newValue: cloneValue(storageState.cloudSync),
      },
    },
    "local"
  );
  assert(scheduledTasks.some((task) => !task.cleared), "Meeting manager should schedule a hub refresh");

  await runLatestTask(scheduledTasks);

  assert.equal(state.meetingHub.items.length, 1);
  assert.equal(state.meetingHub.items[0].meetingId, "meeting-fixture-2");
  assert.equal(storageState.meetingHub.items.length, 1);
  assert.equal(storageState.meetingHub.items[0].title, "주간 스탠드업");
  assert(renderCount > 0, "Meeting manager should request a re-render after refresh");
  assert.deepEqual(
    sentMessages.map((message) => message.type),
    ["inova-meeting:list-meetings"]
  );

  manager.handleStorageChange(
    {
      meetingHub: {
        oldValue: cloneValue(storageState.meetingHub),
        newValue: {
          version: 1,
          checkedAt: "2026-03-30T09:00:00.000Z",
          error: "",
          items: [
            {
              meetingId: "meeting-fixture-3",
              title: "런칭 체크인",
              status: "processing",
              latestJobId: "meeting-job-fixture-3",
              latestArtifactId: "",
              excerpt: "랜딩 문구와 일정 조율을 진행 중입니다.",
              createdAt: "2026-03-30T09:00:00.000Z",
              updatedAt: "2026-03-30T09:10:00.000Z",
            },
          ],
        },
      },
    },
    "local"
  );

  assert.equal(state.meetingHub.items.length, 1);
  assert.equal(state.meetingHub.items[0].meetingId, "meeting-fixture-3");

  context.chrome.runtime.sendMessage = async function invalidatedSendMessage() {
    throw new Error("Extension context invalidated.");
  };

  await manager.refreshState();

  assert.equal(
    state.meetingHub.error,
    "확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요."
  );
  assert.equal(
    consoleErrors.length,
    0,
    "Meeting manager should suppress invalidated context console errors"
  );

  console.log("[verify-meeting-manager] Meeting manager passed");
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

async function runLatestTask(tasks) {
  const task = [...tasks].reverse().find((entry) => !entry.cleared);
  assert(task, "Expected a scheduled task");
  task.callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
