#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  path.join("docs", "runtime-architecture.md"),
  path.join("docs", "meeting-diarization-foundation.md"),
  path.join("fixtures", "inova-chat-session.html"),
  path.join("fixtures", "content-harness.html"),
  path.join("fixtures", "content-harness-mock.js"),
  path.join("fixtures", "popup-harness.html"),
  path.join("fixtures", "popup-harness-mock.js"),
  path.join("fixtures", "meeting-diarization", "create-job-request.json"),
  path.join("fixtures", "meeting-diarization", "create-job-response.json"),
  path.join("fixtures", "meeting-diarization", "job-status-processing.json"),
  path.join("fixtures", "meeting-diarization", "job-status-succeeded.json"),
  path.join("fixtures", "cloud-harness", "fixtures.js"),
  path.join("scripts", "cloud-harness-server.js"),
  path.join("scripts", "run-cloud-harness-server.js"),
  path.join("scripts", "verify-content-smoke.js"),
  path.join("scripts", "verify-popup-harness.js"),
  path.join("scripts", "verify-meeting-contract.js"),
  path.join("scripts", "verify-cloud-api-contract.js"),
  path.join("scripts", "verify-service-worker-harness.js"),
  path.join("scripts", "run-harness-server.js"),
  path.join("scripts", "verify-content-harness-page.js"),
];

const architectureKeywords = [
  "Popup",
  "Content Script",
  "Background Service Worker",
  "Firebase Functions",
  "Firestore / Hosting",
  "권위 있는 소스",
  "검증 표면",
  "로컬 브라우저 하네스",
  "로컬 팝업 하네스",
  "로컬 클라우드 하네스",
];

const fixtureKeywords = [
  'aria-label="채팅 기록"',
  "chat-message--user",
  "chat-input__textarea",
];

const harnessFixtureKeywords = [
  "Local Content Harness",
  'aria-label="채팅 기록"',
  "content-harness-mock.js",
];

const meetingFoundationKeywords = [
  "single-file-first",
  "temporary upload",
  "Cloud Run Job",
  "inova-meeting:create-job",
  "session",
  "job",
  "artifact",
];

function main() {
  const errors = [];

  for (const relativePath of requiredFiles) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`하네스 필수 파일이 없습니다: ${relativePath}`);
    }
  }

  const architecturePath = path.join(root, "docs", "runtime-architecture.md");
  if (fs.existsSync(architecturePath)) {
    const text = fs.readFileSync(architecturePath, "utf8");
    for (const keyword of architectureKeywords) {
      if (!text.includes(keyword)) {
        errors.push(`runtime architecture 문서에 핵심 키워드가 없습니다: ${keyword}`);
      }
    }
  }

  const fixturePath = path.join(root, "fixtures", "inova-chat-session.html");
  if (fs.existsSync(fixturePath)) {
    const text = fs.readFileSync(fixturePath, "utf8");
    for (const keyword of fixtureKeywords) {
      if (!text.includes(keyword)) {
        errors.push(`fixture에 핵심 표식이 없습니다: ${keyword}`);
      }
    }
  }

  const harnessFixturePath = path.join(root, "fixtures", "content-harness.html");
  if (fs.existsSync(harnessFixturePath)) {
    const text = fs.readFileSync(harnessFixturePath, "utf8");
    for (const keyword of harnessFixtureKeywords) {
      if (!text.includes(keyword)) {
        errors.push(`로컬 하네스 fixture에 핵심 표식이 없습니다: ${keyword}`);
      }
    }
  }

  const meetingFoundationPath = path.join(root, "docs", "meeting-diarization-foundation.md");
  if (fs.existsSync(meetingFoundationPath)) {
    const text = fs.readFileSync(meetingFoundationPath, "utf8");
    for (const keyword of meetingFoundationKeywords) {
      if (!text.includes(keyword)) {
        errors.push(`회의 기반 계약 문서에 핵심 키워드가 없습니다: ${keyword}`);
      }
    }
  }

  if (errors.length) {
    console.error("하네스 검증 실패");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("하네스 검증 통과");
}

main();
