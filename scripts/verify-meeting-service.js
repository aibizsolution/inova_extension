#!/usr/bin/env node

const assert = require("assert");
const { registerMeetingHandlers } = require("../functions/meeting-service");

async function main() {
  const state = createMemoryState();
  const owner = {
    displayName: "Harness User",
    email: "fixture@example.com",
    numericUserId: 1001,
    provider: "inova",
    providerUserKey: "fixture-user",
  };
  const handlers = registerMeetingHandlers(createDeps(state));
  const audioPayload = Buffer.from("fixture-audio-payload").toString("base64");

  const createdResponse = await invokeHandler(handlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T08:31:00.000Z",
        language: "ko",
        sessionId: "fixture-session",
        startedAt: "2026-03-30T08:20:00.000Z",
        title: "주간 스탠드업",
      },
      options: {
        redaction: "none",
        speakerLabels: true,
        summary: false,
      },
      owner,
      source: {
        captureMode: "tab-audio",
        channelCount: 1,
        durationMs: 65000,
        fileName: "fixture-session.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
    },
    method: "POST",
  });
  assert.equal(createdResponse.statusCode, 200);
  assert.equal(createdResponse.jsonBody.ok, true);
  assert.equal(createdResponse.jsonBody.data.job.status, "queued");
  assert.equal(createdResponse.jsonBody.data.job.source.uploadStatus, "uploaded");

  const createdJobId = createdResponse.jsonBody.data.job.jobId;
  const storedJobResponse = await invokeHandler(handlers.getInovaMeetingJob, {
    body: {
      jobId: createdJobId,
      owner,
      sessionId: "fixture-session",
    },
    method: "POST",
  });
  assert.equal(storedJobResponse.statusCode, 200);
  assert.equal(storedJobResponse.jsonBody.data.job.status, "succeeded");
  assert.equal(storedJobResponse.jsonBody.data.job.cleanup.sourceAudioDeleted, true);
  assert.equal(storedJobResponse.jsonBody.data.job.transcription.speakerCount, 2);
  assert.equal(storedJobResponse.jsonBody.data.job.source.uploadStatus, "deleted");

  const artifactId = storedJobResponse.jsonBody.data.job.transcript.artifactId;
  const artifactResponse = await invokeHandler(handlers.getInovaMeetingArtifact, {
    body: {
      artifactId,
      jobId: createdJobId,
      owner,
    },
    method: "POST",
  });
  assert.equal(artifactResponse.statusCode, 200);
  assert.equal(artifactResponse.jsonBody.data.artifact.artifactId, artifactId);
  assert.equal(artifactResponse.jsonBody.data.artifact.segments.length, 2);
  assert(artifactResponse.jsonBody.data.artifact.text.includes("SPEAKER_00"));

  const uploads = Array.from(state.uploads.entries());
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][1].deleted, true, "Temporary source should be deleted after transcription");
  assert.equal(state.openaiRequests.length, 1);
  assert.equal(state.openaiRequests[0].model, "gpt-4o-transcribe-diarize");
  assert.equal(state.openaiRequests[0].response_format, "diarized_json");
  assert.equal(state.openaiRequests[0].chunking_strategy, "auto");

  console.log("[verify-meeting-service] Meeting service flow passed");
}

function createDeps(state) {
  return {
    CORS_ORIGINS: ["https://inova.incross.com"],
    REGION: "asia-northeast3",
    bucket: createBucket(state),
    createHttpError(status, message) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    db: createDb(state),
    logEvent(name, payload) {
      state.events.push({ name, payload: cloneValue(payload) });
    },
    normalizeIdentity(input) {
      return {
        displayName: String(input?.displayName || "").trim(),
        email: String(input?.email || "").trim(),
        numericUserId: Number(input?.numericUserId) || 0,
        provider: String(input?.provider || "").trim(),
        providerUserKey: String(input?.providerUserKey || "").trim(),
      };
    },
    normalizeText(value) {
      return String(value || "").trim();
    },
    onRequest(_options, handler) {
      return handler;
    },
    openaiFactory() {
      return {
        audio: {
          transcriptions: {
            async create(request) {
              state.openaiRequests.push({
                chunking_strategy: request.chunking_strategy || "",
                language: request.language || "",
                model: request.model || "",
                response_format: request.response_format || "",
              });
              return {
                duration: 10.4,
                language: "ko",
                segments: [
                  {
                    end: 5.3,
                    speaker: "A",
                    start: 0,
                    text: "신규 프로모션 일정을 이번 주 안에 확정합시다.",
                  },
                  {
                    end: 10.4,
                    speaker: "B",
                    start: 5.4,
                    text: "예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
                  },
                ],
                task: "transcribe",
                text: "신규 프로모션 일정을 이번 주 안에 확정합시다. 예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
              };
            },
          },
        },
      };
    },
    sendError(response, error) {
      response.status(Number(error?.status) || 500).json({
        error: String(error?.message || "Unexpected error"),
        ok: false,
      });
    },
    async verifyInovaIdentity(providerIdentity) {
      return providerIdentity;
    },
  };
}

function createDb(state) {
  return {
    collection(name) {
      if (!state.collections.has(name)) {
        state.collections.set(name, new Map());
      }
      const collectionState = state.collections.get(name);
      return {
        doc(id) {
          const resolvedId = String(id || `doc-${state.nextId++}`);
          return {
            id: resolvedId,
            async get() {
              return {
                data() {
                  return cloneValue(collectionState.get(resolvedId));
                },
                exists: collectionState.has(resolvedId),
              };
            },
            async set(value, options = {}) {
              const nextValue = cloneValue(value);
              if (options.merge && collectionState.has(resolvedId)) {
                collectionState.set(resolvedId, deepMerge(collectionState.get(resolvedId), nextValue));
                return;
              }
              collectionState.set(resolvedId, nextValue);
            },
          };
        },
      };
    },
  };
}

function createBucket(state) {
  return {
    file(path) {
      const normalizedPath = String(path || "").trim();
      return {
        async delete() {
          const current = state.uploads.get(normalizedPath) || {};
          state.uploads.set(normalizedPath, {
            ...current,
            deleted: true,
          });
        },
        async download() {
          const current = state.uploads.get(normalizedPath);
          return [Buffer.from(current?.buffer || Buffer.alloc(0))];
        },
        async save(buffer, options = {}) {
          state.uploads.set(normalizedPath, {
            buffer: Buffer.from(buffer),
            contentType: options.contentType || "",
            deleted: false,
            metadata: cloneValue(options.metadata || {}),
          });
        },
      };
    },
  };
}

function createMemoryState() {
  return {
    collections: new Map(),
    events: [],
    nextId: 1,
    openaiRequests: [],
    uploads: new Map(),
  };
}

async function invokeHandler(handler, request) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

function createResponse() {
  return {
    jsonBody: null,
    statusCode: 200,
    json(payload) {
      this.jsonBody = cloneValue(payload);
      return this;
    },
    status(code) {
      this.statusCode = Number(code) || 500;
      return this;
    },
  };
}

function deepMerge(base, patch) {
  const nextBase = base && typeof base === "object" ? base : {};
  const nextPatch = patch && typeof patch === "object" ? patch : {};
  const result = Array.isArray(nextPatch) ? [] : { ...cloneValue(nextBase) };
  for (const [key, value] of Object.entries(nextPatch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(nextBase[key], value);
      continue;
    }
    result[key] = cloneValue(value);
  }
  return result;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-meeting-service] ${error.message}`);
  process.exit(1);
});
