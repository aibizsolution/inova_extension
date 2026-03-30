#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "meeting-diarization");

async function main() {
  const createRequest = readJson("create-job-request.json");
  const createResponse = readJson("create-job-response.json");
  const processingResponse = readJson("job-status-processing.json");
  const succeededResponse = readJson("job-status-succeeded.json");
  const providerIdentity = createRequest.owner;
  const sentMessages = [];
  let jobPollCount = 0;
  let storageState = {};

  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentMessages.push(cloneValue(message));
          if (message.type === "inova-meeting:create-job") {
            return { ok: true, data: cloneValue(createResponse) };
          }
          if (message.type === "inova-meeting:get-job") {
            jobPollCount += 1;
            return { ok: true, data: cloneValue(jobPollCount >= 2 ? succeededResponse : processingResponse) };
          }
          if (message.type === "inova-meeting:get-artifact") {
            return {
              ok: true,
              data: {
                artifact: {
                  artifactId: succeededResponse.job.transcript.artifactId,
                  jobId: succeededResponse.job.jobId,
                  text: succeededResponse.job.transcript.text,
                  segments: cloneValue(succeededResponse.job.transcript.segments),
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
    location: { href: "https://inova.incross.com/chat?sid=fixture-session" },
    structuredClone: cloneValue,
  });
  context.globalThis = context;

  loadScript("shared/constants.js", context);
  loadScript("shared/session.js", context);
  loadScript("shared/meeting-state.js", context);
  loadScript("shared/storage.js", context);
  loadScript("shared/meeting-bridge.js", context);

  const namespace = context.InovaBookmarks;
  assert(namespace.constants.storageKeys.meetingState === "meetingState");
  assert(namespace.constants.storageKeys.meetingStateBySession === "meetingStateBySession");

  const draft = namespace.meetingState.createDraftMeetingState(createRequest);
  assert.equal(draft.session.sessionId, createRequest.meeting.sessionId);
  assert.equal(draft.capture.status, "captured");
  assert.equal(draft.capture.captureMode, createRequest.source.captureMode);

  const storedDraft = await namespace.storage.setMeetingState(draft);
  assert.equal(storedDraft.session.sessionId, createRequest.meeting.sessionId);
  assert.equal(
    (await namespace.storage.getMeetingState(createRequest.meeting.sessionId)).capture.sizeBytes,
    createRequest.source.sizeBytes
  );
  assert.equal(
    (await namespace.storage.getMeetingStateBySession())[createRequest.meeting.sessionId].session.sessionId,
    createRequest.meeting.sessionId
  );

  const created = await namespace.meetingBridge.createMeetingJob(createRequest, providerIdentity);
  assert.equal(created.job.status, "queued");
  const queuedState = namespace.meetingState.applyMeetingJobCreated(storedDraft, created);
  assert.equal(queuedState.job.jobId, created.job.jobId);
  assert.equal(namespace.meetingState.shouldPollMeetingJob(queuedState), true);

  const processing = await namespace.meetingBridge.getMeetingJob(
    namespace.meetingState.buildMeetingJobLookup(queuedState),
    providerIdentity
  );
  assert.equal(processing.job.status, "processing");
  const processingState = namespace.meetingState.applyMeetingJobSnapshot(queuedState, processing);
  assert.equal(processingState.job.progress.phase, "transcribing");
  assert.equal(namespace.meetingState.shouldPollMeetingJob(processingState), true);

  const succeeded = await namespace.meetingBridge.getMeetingJob(
    namespace.meetingState.buildMeetingJobLookup(processingState),
    providerIdentity
  );
  assert.equal(succeeded.job.status, "succeeded");
  const succeededState = namespace.meetingState.applyMeetingJobSnapshot(processingState, succeeded);
  assert.equal(succeededState.job.sourceAudioDeleted, true);
  assert.equal(namespace.meetingState.shouldPollMeetingJob(succeededState), false);

  const artifact = await namespace.meetingBridge.getMeetingArtifact(
    namespace.meetingState.buildMeetingArtifactLookup(succeededState),
    providerIdentity
  );
  const finalState = namespace.meetingState.applyMeetingArtifact(succeededState, artifact);
  assert.equal(finalState.transcript.artifactId, succeeded.job.transcript.artifactId);
  assert.equal(finalState.transcript.segments.length, 2);
  assert(finalState.transcript.text.includes("SPEAKER_00"));

  await namespace.storage.setMeetingState(finalState);
  const restoredState = await namespace.storage.getMeetingState(createRequest.meeting.sessionId);
  assert.equal(restoredState.job.status, "succeeded");
  assert.equal(restoredState.transcript.segments.length, 2);

  assert.deepEqual(
    sentMessages.map((message) => message.type),
    ["inova-meeting:create-job", "inova-meeting:get-job", "inova-meeting:get-job", "inova-meeting:get-artifact"]
  );

  console.log("[verify-meeting-state] Meeting state and bridge passed");
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, fileName), "utf8"));
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
