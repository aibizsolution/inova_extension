#!/usr/bin/env node

const assert = require("assert");
const nodeCrypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createMeetingNotesDocumentDomain } = require("../functions/features/meeting/meeting-notes-document-domain");

function main() {
  verifyMeetingNotesPromptGuards();
  verifyRevisitedAgendaNormalization();
  verifyLongMeetingNotesSectionsArePreserved();
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
    "권장했다/필수다/반드시 해야 한다 같은 평가형 표현보다",
    "항목 수를 맞추기 위해 내용을 만들지 않는다.",
    "근거가 1개면 1개만 작성하고",
    "담당자나 기한이 없어도 기존 기능 재확인, API 규격 협의, 데이터 조사, 자료 작성 요청, 보고처럼 실제 후속 행동이 명시되었으면 actionItems에 남기고",
    "discussionFlow는 단순 토픽 목록이 아니라 실제 논의 흐름을 보존한다.",
    "다시 나온 A가 새 결정, 조건, 반론, 리스크를 만들었을 때 별도 discussionFlow 항목으로 남긴다.",
    "같은 주제라는 이유만으로 서로 다른 결정, 서로 다른 미결정 사항, 서로 다른 리스크를 하나로 합치지 않는다.",
    "다음 숫자는 목표 개수가 아니라 안전 상한이다",
    "discussionFlow 최대 12개",
    "actionItems 최대 12개",
    "openQuestions 최대 12개",
    "sourceTrace는 summary, 주요 discussionFlow, actionItems/openQuestions/risksOrDependencies 근거를 합쳐 정확히 6개 작성한다.",
    "decisions는 전사에 '확정', '합의', '승인', '하기로 했다'처럼 명시적인 확정 표현이 있을 때만 작성한다.",
    "단순히 테스트를 해볼 수 있다, 검토한다, 필요하다, 재확인한다, 제안했다는 수준이면 decisions가 아니라 actionItems, openQuestions, risksOrDependencies 중 맞는 곳에 둔다.",
    "decisions에 넣을 근거가 약한 사안은 summary, overview, discussionFlow에서도 '하기로 했다', '추진하기로 했다', '진행하기로 했다', '의견을 모았다'가 아니라",
    "금지 예: '웹 API를 테스트해 보기로 했다'.",
    "confidence, status, severity 값은 한국어로 쓴다.",
    "구체적인 후속 행동과 미결정 질문/리스크가 함께 있으면 하나를 다른 하나로 대체하지 말고",
    "아직 확인해야 할 후속 쟁점이나 실행 제약이 나오면 openQuestions 또는 risksOrDependencies에 빠뜨리지 않는다.",
    "sourceTrace[] itemRef는 summary, overview, discussionFlow[0], actionItems[0]처럼 어떤 회의록 항목의 근거인지 식별 가능하게 적는다.",
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

function verifyLongMeetingNotesSectionsArePreserved() {
  const notesDomain = createFixtureMeetingNotesDocumentDomain();
  const normalized = notesDomain.normalizeMeetingNotes({
    actionItems: Array.from({ length: 8 }, (_, index) => ({
      source: "manual",
      status: "요청됨",
      task: `BytePlus 후속 실행 항목 ${index + 1}`,
    })),
    discussionFlow: Array.from({ length: 10 }, (_, index) => ({
      heading: `BytePlus 논의 흐름 ${index + 1}`,
      keyPoints: [
        `Seedream 확인 포인트 ${index + 1}-1`,
        `Seedance 확인 포인트 ${index + 1}-2`,
        `보안 확인 포인트 ${index + 1}-3`,
        `가격 확인 포인트 ${index + 1}-4`,
        `레퍼런스 확인 포인트 ${index + 1}-5`,
      ],
      narrative: `BytePlus Seed 계열 소개 중 서로 다른 논의 흐름 ${index + 1}이 다뤄졌다.`,
    })),
    openQuestions: Array.from({ length: 7 }, (_, index) => `BytePlus 추가 결정 필요 사항 ${index + 1}`),
    risksOrDependencies: Array.from({ length: 6 }, (_, index) => ({
      severity: "중간",
      text: `BytePlus 리스크 및 제약 ${index + 1}`,
    })),
  });
  assert.equal(normalized.discussionFlow.length, 10, "meeting notes should preserve long discussion flow sections");
  assert.equal(normalized.discussionFlow[0].keyPoints.length, 5, "meeting notes should preserve detailed discussion key points");
  assert.equal(normalized.openQuestions.length, 7, "meeting notes should preserve long open question sections");
  assert.equal(normalized.risksOrDependencies.length, 6, "meeting notes should preserve long risk sections");
  assert.equal(normalized.actionItems.length, 8, "meeting notes should preserve long action sections");
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
    "업스테이지 스튜디오의 웹 API를 우선 테스트하는 방안이 논의됐다. 다른 방식도 시도하는 방안이 논의됐다.",
    "meeting notes overview should soften test/try prose"
  );
  const sentenceShape = notesDomain.normalizeMeetingNotes({
    overview: "웹 API 테스트를 우선 진행하기로 방향이 정리되었습니다. 구축 여부를 내부적으로 재확인하기로 했으며, API를 우선 테스트하기로 했으며, 업스테이지가 지원하기로 했으며, 자료 조사를 즉시 진행하기로 함. 필수적인 장비 수급도 언급됐다.",
  });
  assert.equal(
    sentenceShape.overview,
    "웹 API 테스트를 우선 진행하는 방안이 정리됐다. 구축 여부를 내부적으로 재확인할 필요가 남았으며, API를 우선 테스트하는 방안이 논의됐으며, 업스테이지의 지원 방안이 논의됐으며, 자료 조사를 즉시 진행하는 방안이 논의됨. 필요한 장비 수급도 언급됐다.",
    "meeting notes overview should soften direction/recheck/required prose"
  );
  const recommendationTone = notesDomain.normalizeMeetingNotes({
    summary: "파인튜닝은 권장하지 않았으며, RAG를 권장했다. EWS 도입이 권장되었으며.",
  });
  assert.equal(
    recommendationTone.summary,
    "파인튜닝은 적합하지 않다는 의견을 냈으며, RAG를 대안으로 제시했다. EWS 도입이 대안으로 제시됐으며.",
    "meeting notes summary should avoid recommendation-style overclaim prose"
  );
  const consensusTone = notesDomain.normalizeMeetingNotes({
    overview: "스튜디오 API 테스트를 진행하기로 논의했다. 발표를 30분 이내로 진행하기로 합의했다. 파트너사 연계를 검토하는 방향으로 의견이 모였다. 기존 사업의 연장선상에 있음을 보여주어야 한다는 데 의견이 모였다.",
  });
  assert.equal(
    consensusTone.overview,
    "스튜디오 API 테스트 진행 방안이 논의됐다. 발표를 30분 이내로 진행하는 방안이 정리됐다. 파트너사 연계를 검토하는 방향이 논의됐다. 기존 사업의 연장선상에 있음을 보여주어야 한다는 논의가 있었다.",
    "meeting notes overview should soften weak consensus prose"
  );
}

function createFixtureMeetingNotesDocumentDomain() {
  const notesDomain = createMeetingNotesDocumentDomain({
    buildTranscriptExcerpt(value) {
      return normalizeFixtureTextBlock(value).slice(0, 120);
    },
    crypto: nodeCrypto,
    limits: {
      MAX_MEETING_NOTES_ACTION_ITEMS: 12,
      MAX_MEETING_NOTES_DECISIONS: 8,
      MAX_MEETING_NOTES_OPEN_QUESTIONS: 12,
      MAX_MEETING_NOTES_RISKS: 10,
      MAX_MEETING_NOTES_SOURCE_TRACE: 6,
      MAX_MEETING_NOTES_TOPIC_COUNT: 12,
      MAX_MEETING_NOTES_TOPIC_KEY_POINTS: 6,
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
