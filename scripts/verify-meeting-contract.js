#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { createCloudHarnessServer } = require("./cloud-harness-server");
const { createHarnessState } = require("../fixtures/cloud-harness/fixtures");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "meeting-diarization");
const allowedCaptureModes = new Set(["tab-audio", "microphone", "mixed-audio"]);
const docKeywords = [
  "single-file-first",
  "temporary upload",
  "Cloud Run Job",
  "inova-meeting:create-job",
  "inova-meeting:get-job",
  "inova-meeting:get-artifact",
  "session",
  "job",
  "artifact",
  "source audio",
];

async function main() {
  const errors = [];
  const docText = fs.readFileSync(path.join(root, "docs", "meeting-diarization-foundation.md"), "utf8");
  for (const keyword of docKeywords) {
    if (!docText.includes(keyword)) {
      errors.push(`회의 계약 문서에 핵심 키워드가 없습니다: ${keyword}`);
    }
  }

  const createRequest = readJson("create-job-request.json");
  const createResponse = readJson("create-job-response.json");
  const processingResponse = readJson("job-status-processing.json");
  const succeededResponse = readJson("job-status-succeeded.json");

  validateCreateRequest(createRequest, errors);
  validateCrossFixtureConsistency(createRequest, createResponse, processingResponse, succeededResponse, errors);
  validateSucceededPayload(succeededResponse, errors);

  const harnessState = createHarnessState();
  const server = createCloudHarnessServer({ port: 0, state: harnessState });
  const listening = await server.listen();

  try {
    const created = await postJson(`${listening.baseUrl}/createInovaMeetingJob`, createRequest);
    const processing = await postJson(`${listening.baseUrl}/getInovaMeetingJob`, {
      jobId: created.job.jobId,
      sessionId: created.job.sessionId,
    });
    const succeeded = await postJson(`${listening.baseUrl}/getInovaMeetingJob`, {
      jobId: created.job.jobId,
      sessionId: created.job.sessionId,
    });
    const artifact = await postJson(`${listening.baseUrl}/getInovaMeetingArtifact`, {
      artifactId: succeeded.job.transcript.artifactId,
      jobId: created.job.jobId,
    });

    validateRouteResponses(created, processing, succeeded, artifact, errors);
    validateRequestTrace(harnessState.requests, errors);
  } finally {
    await server.close();
  }

  if (errors.length) {
    console.error("[verify-meeting-contract] 회의 계약 검증 실패");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("[verify-meeting-contract] Meeting contract passed");
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, fileName), "utf8"));
}

function validateCreateRequest(createRequest, errors) {
  if (!allowedCaptureModes.has(String(createRequest?.source?.captureMode || ""))) {
    errors.push("create-job-request.json 에 알 수 없는 captureMode가 있습니다.");
  }
  if (!String(createRequest?.meeting?.sessionId || "").trim()) {
    errors.push("create-job-request.json 에 meeting.sessionId가 없습니다.");
  }
  if (!String(createRequest?.owner?.providerUserKey || "").trim()) {
    errors.push("create-job-request.json 에 owner.providerUserKey가 없습니다.");
  }
  if (!(Number(createRequest?.source?.sizeBytes) > 0)) {
    errors.push("create-job-request.json 에 source.sizeBytes가 0보다 커야 합니다.");
  }
  if (!(Number(createRequest?.source?.durationMs) > 0)) {
    errors.push("create-job-request.json 에 source.durationMs가 0보다 커야 합니다.");
  }
  if (createRequest?.options?.speakerLabels !== true) {
    errors.push("create-job-request.json 은 speakerLabels=true 를 기준으로 해야 합니다.");
  }
}

function validateCrossFixtureConsistency(createRequest, createResponse, processingResponse, succeededResponse, errors) {
  const expectedSessionId = String(createRequest?.meeting?.sessionId || "");
  const createdJob = createResponse?.job || {};
  const processingJob = processingResponse?.job || {};
  const succeededJob = succeededResponse?.job || {};

  if (createdJob.status !== "queued") {
    errors.push("create-job-response.json 은 status=queued 여야 합니다.");
  }
  if (processingJob.status !== "processing") {
    errors.push("job-status-processing.json 은 status=processing 이어야 합니다.");
  }
  if (succeededJob.status !== "succeeded") {
    errors.push("job-status-succeeded.json 은 status=succeeded 이어야 합니다.");
  }
  if (createdJob.sessionId !== expectedSessionId) {
    errors.push("create-job-response.json 의 sessionId가 request와 다릅니다.");
  }
  if (processingJob.sessionId !== createdJob.sessionId || succeededJob.sessionId !== createdJob.sessionId) {
    errors.push("meeting fixture들의 sessionId가 서로 다릅니다.");
  }
  if (!createdJob.jobId || processingJob.jobId !== createdJob.jobId || succeededJob.jobId !== createdJob.jobId) {
    errors.push("meeting fixture들의 jobId가 서로 다릅니다.");
  }
}

function validateSucceededPayload(succeededResponse, errors) {
  const job = succeededResponse?.job || {};
  const segments = Array.isArray(job?.transcript?.segments) ? job.transcript.segments : [];
  if (!segments.length) {
    errors.push("job-status-succeeded.json 에 transcript.segments 가 비어 있습니다.");
    return;
  }
  if (job?.cleanup?.sourceAudioDeleted !== true) {
    errors.push("job-status-succeeded.json 에 cleanup.sourceAudioDeleted=true 가 필요합니다.");
  }
  if (!(Number(job?.transcription?.speakerCount) >= 1)) {
    errors.push("job-status-succeeded.json 에 speakerCount가 필요합니다.");
  }
  let previousEnd = -1;
  for (const segment of segments) {
    if (!String(segment?.speakerLabel || "").trim()) {
      errors.push("transcript segment에 speakerLabel이 비어 있습니다.");
      break;
    }
    if (!String(segment?.text || "").trim()) {
      errors.push("transcript segment에 text가 비어 있습니다.");
      break;
    }
    if (!(Number(segment?.startMs) >= 0) || !(Number(segment?.endMs) > Number(segment?.startMs))) {
      errors.push("transcript segment의 startMs/endMs가 올바르지 않습니다.");
      break;
    }
    if (Number(segment.startMs) < previousEnd) {
      errors.push("transcript segment가 시간순으로 정렬되어 있지 않습니다.");
      break;
    }
    previousEnd = Number(segment.endMs);
  }
}

function validateRouteResponses(created, processing, succeeded, artifact, errors) {
  if (created?.job?.status !== "queued") {
    errors.push("createInovaMeetingJob route 응답이 queued가 아닙니다.");
  }
  if (processing?.job?.status !== "processing") {
    errors.push("첫 getInovaMeetingJob route 응답이 processing이 아닙니다.");
  }
  if (succeeded?.job?.status !== "succeeded") {
    errors.push("두 번째 getInovaMeetingJob route 응답이 succeeded가 아닙니다.");
  }
  if (artifact?.artifact?.artifactId !== succeeded?.job?.transcript?.artifactId) {
    errors.push("getInovaMeetingArtifact route 응답이 transcript artifact와 연결되지 않습니다.");
  }
  if (!Array.isArray(artifact?.artifact?.segments) || !artifact.artifact.segments.length) {
    errors.push("getInovaMeetingArtifact route 응답에 segments가 없습니다.");
  }
}

function validateRequestTrace(requests, errors) {
  const paths = Array.isArray(requests) ? requests.map((entry) => entry.path) : [];
  const expected = [
    "/createInovaMeetingJob",
    "/getInovaMeetingJob",
    "/getInovaMeetingJob",
    "/getInovaMeetingArtifact",
  ];
  if (paths.length < expected.length) {
    errors.push("meeting contract verify 중 local cloud harness request trace가 부족합니다.");
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (paths[index] !== expected[index]) {
      errors.push(`meeting request trace 순서가 다릅니다: ${paths[index]} != ${expected[index]}`);
      break;
    }
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Request failed: ${url}`);
  }
  return payload.data;
}

main().catch((error) => {
  console.error(`[verify-meeting-contract] ${error.message}`);
  process.exit(1);
});
