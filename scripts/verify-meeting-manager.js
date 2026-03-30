#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "meeting-diarization");

async function main() {
  const processingResponse = readJson("job-status-processing.json");
  const succeededResponse = readJson("job-status-succeeded.json");
  const activeSessionId = processingResponse.job.sessionId;
  const sentMessages = [];
  const scheduledTasks = [];
  let nextTimerId = 1;
  let renderCount = 0;
  let storageState = {
    meetingStateBySession: {
      [activeSessionId]: {
        capture: {
          captureMode: "mixed-audio",
          durationMs: 480000,
          mimeType: "audio/webm",
          sizeBytes: 4200000,
          status: "uploaded",
        },
        job: {
          jobId: processingResponse.job.jobId,
          progress: {
            percent: 24,
            phase: "transcribing",
          },
          status: "processing",
        },
        session: {
          sessionId: activeSessionId,
          title: "주간 스탠드업",
        },
      },
    },
    meetingState: {
      capture: {
        captureMode: "mixed-audio",
        durationMs: 480000,
        mimeType: "audio/webm",
        sizeBytes: 4200000,
        status: "uploaded",
      },
      job: {
        jobId: processingResponse.job.jobId,
        progress: {
          percent: 24,
          phase: "transcribing",
        },
        status: "processing",
      },
      session: {
        sessionId: activeSessionId,
        title: "주간 스탠드업",
      },
    },
  };

  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentMessages.push(cloneValue(message));
          if (message.type === "inova-meeting:get-job") {
            const payload = cloneValue(succeededResponse);
            payload.job.transcript = {
              artifactId: payload.job.transcript.artifactId,
              segments: [],
              text: "",
            };
            payload.job.transcription = {
              speakerCount: 0,
            };
            return { ok: true, data: payload };
          }
          if (message.type === "inova-meeting:get-artifact") {
            return {
              ok: true,
              data: {
                artifact: {
                  artifactId: succeededResponse.job.transcript.artifactId,
                  jobId: succeededResponse.job.jobId,
                  segments: cloneValue(succeededResponse.job.transcript.segments),
                  text: succeededResponse.job.transcript.text,
                },
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
    console,
    globalThis: null,
    localStorage: {
      getItem(key) {
        if (key === "auth") {
          return JSON.stringify({
            userInfo: {
              email: "ytgoon@example.com",
              id: 101,
              name: "YT",
              userKey: "fixture-user",
            },
          });
        }
        return null;
      },
    },
    location: {
      href: `https://inova.incross.com/chat?sid=${activeSessionId}`,
      pathname: "/chat",
      search: `?sid=${activeSessionId}`,
    },
    setTimeout(callback, delay) {
      const task = { callback, cleared: false, delay, id: nextTimerId += 1 };
      scheduledTasks.push(task);
      return task.id;
    },
    clearTimeout(timerId) {
      const task = scheduledTasks.find((entry) => entry.id === timerId);
      if (task) {
        task.cleared = true;
      }
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
    meetingState: namespace.meetingState.mergeMeetingState(),
    sessionId: activeSessionId,
  };
  const manager = namespace.meetingManager.create(state, {
    render() {
      renderCount += 1;
    },
  });

  manager.handleStorageChange(
    {
      meetingStateBySession: {
        oldValue: {},
        newValue: cloneValue(storageState.meetingStateBySession),
      },
      meetingState: {
        oldValue: namespace.meetingState.mergeMeetingState(),
        newValue: cloneValue(storageState.meetingState),
      },
    },
    "local"
  );
  assert(scheduledTasks.some((task) => !task.cleared), "Meeting manager should schedule a poll for active jobs");

  await runLatestTask(scheduledTasks);

  assert.equal(state.meetingState.job.status, "succeeded");
  assert.equal(state.meetingState.transcript.segments.length, 2);
  assert.equal(storageState.meetingState.job.status, "succeeded");
  assert.equal(storageState.meetingStateBySession[activeSessionId].job.status, "succeeded");
  assert.equal(storageState.meetingState.transcript.segments.length, 2);
  assert.equal(storageState.meetingStateBySession[activeSessionId].transcript.segments.length, 2);
  assert.deepEqual(
    sentMessages.map((message) => message.type),
    ["inova-meeting:get-job", "inova-meeting:get-artifact"]
  );
  assert(renderCount > 0, "Meeting manager should request a re-render");

  sentMessages.length = 0;
  state.sessionId = "other-session";
  await manager.refreshState();
  assert.equal(sentMessages.length, 0);

  console.log("[verify-meeting-manager] Meeting manager passed");
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, fileName), "utf8"));
}

async function runLatestTask(tasks) {
  const task = [...tasks].reverse().find((entry) => !entry.cleared);
  assert(task, "Expected a scheduled task");
  task.cleared = true;
  task.callback();
  await flushAsyncWork();
}

async function flushAsyncWork() {
  for (let index = 0; index < 2; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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
