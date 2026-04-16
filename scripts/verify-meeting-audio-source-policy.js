#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const MB = 1024 * 1024;
const EXPECTED_OPENAI_SAFE_PART_BYTES = 24 * MB;
const EXPECTED_OPENAI_SAFE_SINGLE_DURATION_MS = 23 * 60 * 1000;
const EXPECTED_CHUNK_DURATION_MS = 14 * 60 * 1000;
const EXPECTED_CHUNK_OVERLAP_MS = 1500;
const EXPECTED_CHUNK_SAMPLE_RATE = 12000;

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8");
}

function main() {
  const sharedSource = readRepoFile("hosting", "meeting", "shared.js");
  const pendingUploadsSource = readRepoFile("hosting", "meeting", "workspace-pending-uploads.js");
  const meetingCreationSource = readRepoFile("functions", "features", "meeting", "meeting-creation-domain.js");
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
    sharedSource.includes("DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS = 23 * 60 * 1000"),
    "hosted single transcription duration must stay below the gpt-4o-transcribe 1400 second limit"
  );
  assert(
    sharedSource.includes("DEFAULT_SOURCE_CHUNK_DURATION_MS = 14 * 60 * 1000"),
    "hosted chunk duration should avoid over-splitting long-but-small meeting audio"
  );
  assert(
    sharedSource.includes("DEFAULT_SOURCE_CHUNK_SAMPLE_RATE = 12000"),
    "hosted chunk sample rate should keep 17 minute WAV chunks below OpenAI's 25MB upload limit"
  );
  assert(
    meetingServiceSource.includes("DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS = 23 * 60 * 1000"),
    "functions single transcription duration must stay below the gpt-4o-transcribe 1400 second limit"
  );
  assert(
    meetingCreationSource.includes("sourceMode !== \"chunked\" && source.durationMs > getMeetingSingleTranscribeMaxDurationMs()"),
    "functions must reject oversized single-source audio before sending it to OpenAI"
  );

  const context = buildHostedMeetingVmContext();
  vm.runInNewContext(sharedSource, context, { filename: "hosting/meeting/shared.js" });
  const ns = context.__INOVA_HOSTED_MEETING__;
  assert.equal(ns.shared.DEFAULT_SOURCE_TARGET_PART_BYTES, EXPECTED_OPENAI_SAFE_PART_BYTES);
  assert.equal(ns.shared.DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS, EXPECTED_OPENAI_SAFE_SINGLE_DURATION_MS);
  assert.equal(ns.shared.DEFAULT_SOURCE_CHUNK_DURATION_MS, EXPECTED_CHUNK_DURATION_MS);
  assert.equal(ns.shared.DEFAULT_SOURCE_CHUNK_SAMPLE_RATE, EXPECTED_CHUNK_SAMPLE_RATE);
  assert(
    estimateMonoWav16Bytes(EXPECTED_CHUNK_DURATION_MS, EXPECTED_CHUNK_SAMPLE_RATE) <= EXPECTED_OPENAI_SAFE_PART_BYTES,
    "default chunk WAV size must stay below the source part target"
  );
  assert.equal(
    estimateChunkPartCount(1591698, EXPECTED_CHUNK_DURATION_MS, EXPECTED_CHUNK_OVERLAP_MS),
    2,
    "a 26m31s meeting should split into two OpenAI-safe chunks, not three"
  );
  assert.equal(
    estimateChunkPartCount(30 * 60 * 1000, EXPECTED_CHUNK_DURATION_MS, EXPECTED_CHUNK_OVERLAP_MS),
    3,
    "a 30 minute meeting should not force oversized two-part chunks"
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
    controller.inferSourceMode(EXPECTED_OPENAI_SAFE_PART_BYTES, EXPECTED_OPENAI_SAFE_SINGLE_DURATION_MS),
    "single",
    "small files at the OpenAI-safe single duration should stay in single source mode"
  );
  assert.equal(
    controller.inferSourceMode(EXPECTED_OPENAI_SAFE_PART_BYTES, EXPECTED_OPENAI_SAFE_SINGLE_DURATION_MS + 1),
    "chunked",
    "small files above the gpt-4o-transcribe single-audio duration limit must use chunked source mode"
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

function estimateMonoWav16Bytes(durationMs, sampleRate) {
  const sampleCount = Math.ceil((Math.max(0, Number(durationMs) || 0) / 1000) * Math.max(1, Number(sampleRate) || 1));
  return 44 + sampleCount * 2;
}

function estimateChunkPartCount(durationMs, chunkDurationMs, overlapMs) {
  const duration = Math.max(0, Number(durationMs) || 0);
  const chunk = Math.max(1, Number(chunkDurationMs) || 1);
  if (duration <= chunk) {
    return duration > 0 ? 1 : 0;
  }
  const step = Math.max(1, chunk - Math.max(0, Number(overlapMs) || 0));
  let count = 0;
  for (let startMs = 0; startMs < duration; startMs += step) {
    count += 1;
    if (startMs + chunk >= duration) {
      break;
    }
  }
  return count;
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
