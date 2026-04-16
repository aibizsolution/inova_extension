#!/usr/bin/env node

const assert = require("assert");
const { createMeetingProcessingRuntimeDomain } = require("../functions/features/meeting/meeting-processing-runtime-domain");

async function main() {
  await verifyDegenerateTranscriptRetriesOnce();
  await verifyRepeatedTranscriptFailsExplicitly();
  console.log("[verify-meeting-transcription-quality] transcript repetition guard passed");
}

async function verifyDegenerateTranscriptRetriesOnce() {
  const responses = [createRepeatedTranscriptFixture(), createCleanTranscriptFixture()];
  const calls = [];
  const runtime = createRuntimeDomain({
    calls,
    responses,
  });
  const transcript = await runtime.transcribeQueuedMeetingSource(createInlineSourceFixture(), { language: "ko" });
  assert.equal(calls.length, 2, "degenerate transcript should retry once");
  assert.equal(transcript.segments.length, 2);
  assert.equal(transcript.text.includes("스타트업에 신성장"), false);
}

async function verifyRepeatedTranscriptFailsExplicitly() {
  const runtime = createRuntimeDomain({
    responses: [createRepeatedTranscriptFixture(), createRepeatedTranscriptFixture()],
  });
  await assert.rejects(
    () => runtime.transcribeQueuedMeetingSource(createInlineSourceFixture(), { language: "ko" }),
    /전사 결과가 같은 문장을 비정상적으로 반복/
  );
}

function createRuntimeDomain({ calls = [], responses = [] }) {
  let cursor = 0;
  return createMeetingProcessingRuntimeDomain({
    OpenAI: {
      async toFile(_buffer, fileName, options) {
        return {
          name: fileName,
          type: options?.type || "",
        };
      },
    },
    buildTranscriptText(segments) {
      return (Array.isArray(segments) ? segments : [])
        .map((segment) => normalizeText(segment.text))
        .filter(Boolean)
        .join(" ");
    },
    bucket: null,
    createHttpError(status, message) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    defaultMeetingProcessRetryLimit: 2,
    defaultSourcePartOverlapMs: 1500,
    getClient() {
      return {
        audio: {
          transcriptions: {
            async create(request) {
              calls.push(request);
              const response = responses[Math.min(cursor, responses.length - 1)];
              cursor += 1;
              return response;
            },
          },
        },
      };
    },
    getMeetingModel() {
      return "gpt-4o-transcribe";
    },
    normalizeMeetingSource(input) {
      return {
        captureMode: normalizeText(input?.captureMode),
        durationMs: Math.max(0, Number(input?.durationMs) || 0),
        fileName: normalizeText(input?.fileName),
        inlineAudioBase64: normalizeText(input?.inlineAudioBase64),
        mimeType: normalizeText(input?.mimeType),
        mode: normalizeText(input?.mode) || "single",
        parts: Array.isArray(input?.parts) ? input.parts : [],
        storageObject: normalizeText(input?.storageObject),
      };
    },
    normalizeMeetingSourcePart(input, index) {
      return {
        ...input,
        index,
      };
    },
    normalizeText,
    normalizeTranscriptionResponse(response) {
      return {
        segments: Array.isArray(response?.segments) ? response.segments : [],
        text: normalizeText(response?.text),
      };
    },
    retryableMeetingProcessStatuses: new Set([408, 409, 429, 500, 502, 503, 504]),
    resegmentTranscriptForReview(segments) {
      return Array.isArray(segments) ? segments : [];
    },
  });
}

function createInlineSourceFixture() {
  return {
    captureMode: "microphone",
    durationMs: 182738,
    fileName: "fixture.m4a",
    inlineAudioBase64: Buffer.from("fixture-audio").toString("base64"),
    mimeType: "audio/mp4",
    mode: "single",
    parts: [],
  };
}

function createRepeatedTranscriptFixture() {
  const repeated = Array.from({ length: 28 }, () => "스타트업에 신성장 본 거 내가 꼭 제발 반응 좀 나고.").join(" ");
  return {
    segments: [
      {
        endMs: 60000,
        startMs: 0,
        text: repeated,
      },
    ],
    text: repeated,
  };
}

function createCleanTranscriptFixture() {
  return {
    segments: [
      {
        endMs: 23000,
        startMs: 0,
        text: "기존 실험은 더 짧게 만들 수 있지만 일정은 장담하기 어렵다고 이야기했다.",
      },
      {
        endMs: 67000,
        startMs: 23000,
        text: "업체 계약과 인플루언서 섭외, 입점 준비가 전체 일정에 영향을 준다는 내용이 나왔다.",
      },
    ],
    text: "기존 실험은 더 짧게 만들 수 있지만 일정은 장담하기 어렵다고 이야기했다. 업체 계약과 인플루언서 섭외, 입점 준비가 전체 일정에 영향을 준다는 내용이 나왔다.",
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

main().catch((error) => {
  console.error(`[verify-meeting-transcription-quality] ${error.stack || error.message}`);
  process.exit(1);
});
