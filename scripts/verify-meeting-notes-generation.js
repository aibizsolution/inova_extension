#!/usr/bin/env node

const assert = require("assert");
const nodeCrypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createMeetingNotesDocumentDomain } = require("../functions/features/meeting/meeting-notes-document-domain");

function main() {
  verifyMeetingNotesPromptGuards();
  verifyRevisitedAgendaNormalization();
  console.log("[verify-meeting-notes-generation] prompt and normalizer guards passed");
}

function verifyMeetingNotesPromptGuards() {
  const generationSource = fs.readFileSync(
    path.join(__dirname, "..", "functions", "features", "meeting", "meeting-notes-generation-domain.js"),
    "utf8"
  );
  for (const requiredPrompt of [
    "항목 수를 맞추기 위해 내용을 만들지 않는다.",
    "근거가 1개면 1개만 작성하고",
    "discussionFlow는 단순 토픽 목록이 아니라 실제 논의 흐름을 보존한다.",
    "다시 나온 A가 새 결정, 조건, 반론, 리스크를 만들었을 때 별도 discussionFlow 항목으로 남긴다.",
    "같은 주제라는 이유만으로 서로 다른 결정, 서로 다른 미결정 사항, 서로 다른 리스크를 하나로 합치지 않는다.",
    "다음 숫자는 목표 개수가 아니라 안전 상한이다",
    "의미가 같은 토픽/결정/액션만 합친다.",
  ]) {
    assert(
      generationSource.includes(requiredPrompt),
      `meeting notes prompt should keep evidence guard: ${requiredPrompt}`
    );
  }
}

function verifyRevisitedAgendaNormalization() {
  const notesDomain = createMeetingNotesDocumentDomain({
    buildTranscriptExcerpt(value) {
      return normalizeFixtureTextBlock(value).slice(0, 120);
    },
    crypto: nodeCrypto,
    limits: {
      MAX_MEETING_NOTES_ACTION_ITEMS: 5,
      MAX_MEETING_NOTES_DECISIONS: 5,
      MAX_MEETING_NOTES_OPEN_QUESTIONS: 3,
      MAX_MEETING_NOTES_RISKS: 3,
      MAX_MEETING_NOTES_SOURCE_TRACE: 6,
      MAX_MEETING_NOTES_TOPIC_COUNT: 4,
      MAX_MEETING_NOTES_TOPIC_KEY_POINTS: 4,
    },
    normalizeText: normalizeFixtureText,
    normalizeTextBlock: normalizeFixtureTextBlock,
    supportedNotesStatuses: new Set(["degraded", "skipped", "succeeded"]),
  });
  const normalized = notesDomain.normalizeMeetingNotes({
    discussionFlow: [
      {
        heading: "플랫폼 일정",
        keyPoints: ["업체 계약 확인 필요"],
        narrative: "첫 라운드에서는 업체 계약 일정이 변수로 언급됐다.",
      },
      {
        heading: "플랫폼 일정",
        keyPoints: ["인플루언서 섭외 일정 확인"],
        narrative: "후반에는 인플루언서 섭외와 입점 준비가 새 변수로 추가됐다.",
      },
      {
        heading: "플랫폼 일정",
        keyPoints: ["업체 계약 확인 필요"],
        narrative: "첫 라운드에서는 업체 계약 일정이 변수로 언급됐다.",
      },
    ],
  });
  assert.equal(
    normalized.discussionFlow.length,
    2,
    "meeting notes should preserve revisited agenda rounds while deduping exact duplicates"
  );
}

function normalizeFixtureText(value) {
  return String(value || "").trim();
}

function normalizeFixtureTextBlock(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

main();
