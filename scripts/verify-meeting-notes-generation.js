#!/usr/bin/env node

const assert = require("assert");
const nodeCrypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createMeetingNotesDocumentDomain } = require("../functions/features/meeting/meeting-notes-document-domain");

function main() {
  verifyMeetingNotesPromptGuards();
  verifyRevisitedAgendaNormalization();
  verifyWeakDecisionNormalization();
  verifyWeakDecisionProseSoftening();
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
    "decisions는 전사에 '확정', '합의', '승인', '하기로 했다'처럼 명시적인 확정 표현이 있을 때만 작성한다.",
    "단순히 테스트를 해볼 수 있다, 검토한다, 필요하다, 재확인한다, 제안했다는 수준이면 decisions가 아니라 actionItems, openQuestions, risksOrDependencies 중 맞는 곳에 둔다.",
    "decisions에 넣을 근거가 약한 사안은 summary, overview, discussionFlow에서도 '하기로 했다', '추진하기로 했다', '진행하기로 했다', '의견을 모았다'가 아니라",
    "금지 예: '웹 API를 테스트해 보기로 했다'.",
    "confidence, status, severity 값은 한국어로 쓴다.",
    "의미가 같은 토픽/결정/액션만 합친다.",
  ]) {
    assert(
      generationSource.includes(requiredPrompt),
      `meeting notes prompt should keep evidence guard: ${requiredPrompt}`
    );
  }
}

function verifyRevisitedAgendaNormalization() {
  const notesDomain = createFixtureMeetingNotesDocumentDomain();
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

function verifyWeakDecisionNormalization() {
  const notesDomain = createFixtureMeetingNotesDocumentDomain();
  const normalized = notesDomain.normalizeMeetingNotes({
    decisions: [
      { confidence: "높음", text: "문서 분류 및 인식 기능 검증을 위해 웹 API를 우선 테스트하기로 했다." },
      { confidence: "높음", text: "신규 빌더 어드민 구축 여부는 기존 기능 확인 후 재검토한다." },
      { confidence: "높음", text: "이번 릴리스 범위는 회의 전사 안정화로 확정했다." },
    ],
  });
  assert.deepEqual(
    normalized.decisions.map((item) => item.text),
    ["이번 릴리스 범위는 회의 전사 안정화로 확정했다."],
    "meeting notes should not promote tests or rechecks into decisions"
  );
}

function verifyWeakDecisionProseSoftening() {
  const notesDomain = createFixtureMeetingNotesDocumentDomain();
  const normalized = notesDomain.normalizeMeetingNotes({
    discussionFlow: [
      {
        heading: "문서 테스트",
        narrative: "웹 API와 스튜디오를 활용한 기능 테스트를 진행하기로 했다.",
      },
    ],
    overview: "외부 파트너 연계를 추진하기로 했습니다.",
    summary: "문서 자동 분류 테스트를 진행하기로 했다.",
  });
  assert.equal(
    normalized.summary,
    "문서 자동 분류 테스트 진행 방안이 논의됐다.",
    "meeting notes summary should soften weak decision prose"
  );
  assert.equal(
    normalized.overview,
    "외부 파트너 연계 추진 방안이 논의됐다.",
    "meeting notes overview should soften weak decision prose"
  );
  assert.equal(
    normalized.discussionFlow[0].narrative,
    "웹 API와 스튜디오를 활용한 기능 테스트 진행 방안이 논의됐다.",
    "meeting notes discussion narrative should soften weak decision prose"
  );
  const extended = notesDomain.normalizeMeetingNotes({
    overview: "핵심 논리를 보고 장표에 담기로 했습니다. PER 비교표를 전면에 포함하기로 했습니다.",
    summary: "기존 어드민 기능과 중복되어 별도 구축 여부를 재검토하기로 했다.",
  });
  assert.equal(
    extended.summary,
    "기존 어드민 기능과 중복되어 별도 구축 여부 재검토 필요가 남았다.",
    "meeting notes summary should soften recheck prose"
  );
  assert.equal(
    extended.overview,
    "핵심 논리를 보고 장표에 담는 방안이 논의됐다. PER 비교표를 전면에 포함하는 방안이 논의됐다.",
    "meeting notes overview should soften include/contain prose"
  );
  const testPlan = notesDomain.normalizeMeetingNotes({
    overview: "업스테이지 스튜디오의 웹 API를 우선 테스트하기로 했다. 다른 방식도 해보기로 했다.",
  });
  assert.equal(
    testPlan.overview,
    "업스테이지 스튜디오의 웹 API를 우선 테스트 방안이 논의됐다. 다른 방식도 시도 방안이 논의됐다.",
    "meeting notes overview should soften test/try prose"
  );
  const sentenceShape = notesDomain.normalizeMeetingNotes({
    overview: "웹 API 테스트를 우선 진행하기로 방향이 정리되었습니다. 구축 여부를 내부적으로 재확인하기로 했으며, API를 우선 테스트하기로 했으며, 업스테이지가 지원하기로 했으며, 자료 조사를 즉시 진행하기로 함. 필수적인 장비 수급도 언급됐다.",
  });
  assert.equal(
    sentenceShape.overview,
    "웹 API 테스트를 우선 진행 방안이 정리됐다. 구축 여부를 내부적으로 재확인 필요가 남았으며, API를 우선 테스트 방안이 논의됐으며, 업스테이지가 지원 방안이 논의됐으며, 자료 조사를 즉시 진행 방안이 논의됨. 필요한 장비 수급도 언급됐다.",
    "meeting notes overview should soften direction/recheck/required prose"
  );
}

function createFixtureMeetingNotesDocumentDomain() {
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
  return notesDomain;
}

function normalizeFixtureText(value) {
  return String(value || "").trim();
}

function normalizeFixtureTextBlock(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

main();
