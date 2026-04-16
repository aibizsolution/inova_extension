#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const MB = 1024 * 1024;
const EXPECTED_OPENAI_SAFE_PART_BYTES = 24 * MB;

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8");
}

function main() {
  const sharedSource = readRepoFile("hosting", "meeting", "shared.js");
  const pendingUploadsSource = readRepoFile("hosting", "meeting", "workspace-pending-uploads.js");
  const meetingServiceSource = readRepoFile("functions", "features", "meeting", "meeting-service.js");

  assert(
    sharedSource.includes("DEFAULT_SOURCE_TARGET_PART_BYTES = 24 * 1024 * 1024"),
    "hosted meeting source part target must stay below OpenAI's 25MB upload limit"
  );
  assert(
    meetingServiceSource.includes("DEFAULT_SOURCE_TARGET_PART_BYTES = 24 * 1024 * 1024"),
    "functions meeting source part target must stay below OpenAI's 25MB upload limit"
  );
  assert(
    !sharedSource.includes("DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS"),
    "hosted source mode must not chunk only because a recording is longer than 20 minutes"
  );
  assert(
    !pendingUploadsSource.includes("DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS"),
    "pending upload source mode must not depend on the removed duration-only chunk threshold"
  );

  const context = buildHostedMeetingVmContext();
  vm.runInNewContext(sharedSource, context, { filename: "hosting/meeting/shared.js" });
  const ns = context.__INOVA_HOSTED_MEETING__;
  assert.equal(ns.shared.DEFAULT_SOURCE_TARGET_PART_BYTES, EXPECTED_OPENAI_SAFE_PART_BYTES);
  assert.equal(
    Object.prototype.hasOwnProperty.call(ns.shared, "DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS"),
    false
  );

  installPendingUploadControllerStubs(ns);
  vm.runInNewContext(pendingUploadsSource, context, { filename: "hosting/meeting/workspace-pending-uploads.js" });
  const controller = ns.workspacePendingUploads.createController({
    constants: {},
    helpers: {},
    state: {
      busy: { queue: {} },
      degradedNotices: {},
      meeting: {},
      pendingUploads: [],
      runtimeChunkCache: {},
    },
  });

  assert.equal(
    controller.inferSourceMode(EXPECTED_OPENAI_SAFE_PART_BYTES, 90 * 60 * 1000),
    "single",
    "duration alone should not force chunking when the file is within the OpenAI-safe upload limit"
  );
  assert.equal(
    controller.inferSourceMode(EXPECTED_OPENAI_SAFE_PART_BYTES + 1, 60 * 1000),
    "chunked",
    "files above the OpenAI-safe upload limit must use chunked source mode"
  );

  console.log("[verify-meeting-audio-source-policy] OpenAI-safe meeting source policy passed");
}

function buildHostedMeetingVmContext() {
  const context = {
    Blob,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    localStorage: createMemoryStorage(),
    location: {
      hostname: "127.0.0.1",
      href: "http://127.0.0.1:5000/meeting/index.html",
      origin: "http://127.0.0.1:5000",
      search: "",
    },
    sessionStorage: createMemoryStorage(),
    setTimeout,
  };
  context.globalThis = context;
  return context;
}

function createMemoryStorage() {
  const values = new Map();
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      const normalizedKey = String(key);
      return values.has(normalizedKey) ? values.get(normalizedKey) : null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function installPendingUploadControllerStubs(ns) {
  ns.audioChunker = {
    async prepareAudioSourceChunks() {
      throw new Error("prepareAudioSourceChunks should not run in source mode policy verify");
    },
  };
  ns.firebase = {};
  ns.render = {
    chooseSelectedRecordId() {
      return "";
    },
    findRemoteForPending() {
      return null;
    },
    normalizeJob(value) {
      return value || {};
    },
  };
  ns.storage = {
    PENDING_UPLOAD_DEBUG_SCENARIOS: {},
    blobToBase64() {
      return "";
    },
    collapseSupersededPendingUploads(items) {
      return Array.isArray(items) ? items : [];
    },
    comparePendingUploads() {
      return 0;
    },
    normalizePendingUpload(value) {
      return value || {};
    },
  };
  ns.workspaceRecovery = {};
}

main();
