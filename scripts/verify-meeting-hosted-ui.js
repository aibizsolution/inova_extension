#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const hostedMeetingHtmlPath = path.join(root, "hosting", "meeting", "index.html");
const hostedMeetingCssPath = path.join(root, "hosting", "meeting", "index.css");
const hostedDesignSystemCssPath = path.join(root, "hosting", "shared", "design-system.css");
const hostedMeetingRenderPath = path.join(root, "hosting", "meeting", "render.js");
const hostedMeetingRenderStatePath = path.join(root, "hosting", "meeting", "render-state.js");
const hostedMeetingRealtimePath = path.join(root, "hosting", "meeting", "workspace-realtime.js");
const hostedMeetingMutationsPath = path.join(root, "hosting", "meeting", "workspace-mutations.js");
const hostedMeetingNotesPath = path.join(root, "hosting", "meeting", "notes.js");
const hostedMeetingDebugPath = path.join(root, "hosting", "meeting", "workspace-debug.js");
const hostedMeetingPendingUploadsPath = path.join(root, "hosting", "meeting", "workspace-pending-uploads.js");

function createEmptySectionEditState() {
  return {
    baseRevisionToken: "",
    instruction: "",
    jobId: "",
    mode: "ai",
    open: false,
    previewSectionData: null,
    previewSectionKey: "",
    recordId: "",
    sectionKey: "",
    statusText: "",
    statusTone: "",
  };
}

function loadHostedMeetingRuntime() {
  const context = {
    console,
    crypto: {
      randomUUID: () => "verify-random-id",
    },
    document: {},
    location: { origin: "https://browser-extension-v2.web.app" },
  };
  context.globalThis = context;
  context.window = context;
  context.__INOVA_HOSTED_MEETING__ = {
    storage: {
      comparePendingUploads: () => 0,
    },
  };
  for (const filePath of [
    path.join(root, "hosting", "meeting", "shared.js"),
    hostedMeetingNotesPath,
    hostedMeetingRenderStatePath,
    hostedMeetingRenderPath,
    hostedMeetingMutationsPath,
  ]) {
    vm.runInNewContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
  }
  return context;
}

async function verifyManualOverviewEditPayload() {
  const runtime = loadHostedMeetingRuntime();
  const ns = runtime.__INOVA_HOSTED_MEETING__;
  const originalNotes = ns.notes.normalizeMeetingNotes({
    meetingMeta: {
      datetime: "2026-07-06 10:00",
      participants: ["홍길동", "김코덱스"],
      purpose: "기존 회의 목적",
      title: "기존 제목",
    },
    overview: "기존 회의 개요",
    summary: "기존 핵심 요약",
  });
  let postedBody = null;
  ns.shared.postJson = async (_globalObject, _url, body) => {
    postedBody = body;
    return {
      accepted: true,
      notes: ns.notes.normalizeMeetingNotes({
        ...originalNotes,
        ...body.sectionData,
      }),
      requestId: body.clientRequestId,
      sectionKey: body.sectionKey,
      title: "기존 제목",
    };
  };

  const state = {
    auth: {},
    busy: { queue: Object.create(null) },
    currentArtifact: { notes: originalNotes },
    currentJob: {
      jobId: "job-1",
      meetingNotes: originalNotes,
      status: "succeeded",
      title: "기존 제목",
    },
    meeting: { title: "기존 회의", termReplacements: [] },
    meetingTitleDraft: "기존 회의",
    pendingMutations: Object.create(null),
    pendingUploads: [],
    records: [{
      jobId: "job-1",
      meetingId: "meeting-1",
      resultTitle: "기존 제목",
      status: "succeeded",
      updatedAt: "2026-07-06T00:00:00.000Z",
    }],
    reviewTab: "notes",
    sectionEdit: createEmptySectionEditState(),
    selectedRecordId: "job:job-1",
    session: { meetingId: "meeting-1", meetingSessionToken: "session-token" },
    termReplacementState: { draftFrom: "", draftTo: "", items: [], open: false, saved: [] },
  };
  const notices = [];
  const controller = ns.workspaceMutations.createController({
    constants: {
      CONFIG: {
        applyMeetingResultSectionEditUrl: "/apply-section",
      },
    },
    helpers: {
      applyRender: () => {},
      cloneTermReplacements: (items) => JSON.parse(JSON.stringify(Array.isArray(items) ? items : [])),
      createEmptySectionEditState,
      setNotice: (message, tone) => notices.push({ message, tone }),
    },
    state,
  });

  assert.equal(controller.openSectionEdit("overview", "manual"), true);
  controller.updateSectionEditInstruction("일시\n2026-07-06 11:00\n\n참여자\n홍길동\n\n목적\n새 회의 목적\n\n개요\n대괄호를 지운 새 회의 개요");
  assert.equal(await controller.applySectionEdit(), true);
  assert(postedBody, "Manual overview save should post a section edit payload");
  assert.equal(postedBody.sectionKey, "overview");
  assert.equal(postedBody.editMode, "manual");
  assert.equal(postedBody.sectionData.meetingMeta.datetime, "2026-07-06 11:00");
  assert.deepEqual(postedBody.sectionData.meetingMeta.participants, ["홍길동"]);
  assert.equal(postedBody.sectionData.meetingMeta.purpose, "새 회의 목적");
  assert.equal(postedBody.sectionData.overview, "대괄호를 지운 새 회의 개요");

  postedBody = null;
  assert.equal(controller.openSectionEdit("overview", "manual"), true);
  controller.updateSectionEditInstruction("표식 없이 통째로 바꾼 회의 개요");
  assert.equal(await controller.applySectionEdit(), true);
  assert(postedBody, "Plain manual overview save should post a section edit payload");
  assert.equal(postedBody.sectionData.meetingMeta.purpose, "새 회의 목적");
  assert.equal(postedBody.sectionData.overview, "표식 없이 통째로 바꾼 회의 개요");
}

async function verifyMeetingNotesRetryPayload() {
  const runtime = loadHostedMeetingRuntime();
  const ns = runtime.__INOVA_HOSTED_MEETING__;
  let postedBody = null;
  ns.shared.postJson = async (_globalObject, _url, body) => {
    postedBody = body;
    return {
      accepted: true,
      requestId: body.clientRequestId,
    };
  };
  const state = {
    auth: {},
    busy: { queue: Object.create(null) },
    currentArtifact: { notes: {} },
    currentJob: {
      jobId: "job-retry-1",
      meetingNotes: {},
      notesStatus: "degraded",
      status: "succeeded",
    },
    meeting: {},
    pendingMutations: Object.create(null),
    pendingUploads: [],
    records: [{
      jobId: "job-retry-1",
      meetingId: "meeting-retry-1",
      status: "succeeded",
    }],
    selectedRecordId: "job:job-retry-1",
    session: {
      meetingId: "meeting-retry-1",
      meetingSessionToken: "session-token",
    },
  };
  const controller = ns.workspaceMutations.createController({
    constants: {
      CONFIG: {
        updateMeetingResultUrl: "/update-result",
      },
    },
    helpers: {
      applyRender: () => {},
      setNotice: () => {},
    },
    state,
  });

  assert.equal(await controller.retryMeetingNotes(), true);
  assert(postedBody, "Meeting notes retry should post a mutation request");
  assert.equal(postedBody.action, "retry_notes");
  assert.equal(postedBody.jobId, "job-retry-1");
  assert.equal(postedBody.meetingId, "meeting-retry-1");
}

function verifyLowQualityTranscriptDisplay() {
  const runtime = loadHostedMeetingRuntime();
  const ns = runtime.__INOVA_HOSTED_MEETING__;
  const pureNoise = Array.from({ length: 80 }, () => "네").join(" ");
  const pureLaughNoise = "하".repeat(80);
  const meaningfulWithTail = `저희는 제품 생성보다는 생성 쪽에 관심이 있습니다. ${Array.from({ length: 50 }, () => "네").join(" ")}`;
  const meaningfulWithLaughTail = `저희는 제품 생성보다는 생성 쪽에 관심이 있습니다. ${"하".repeat(50)}`;
  const pureResult = ns.render.classifyTranscriptQuality(pureNoise);
  const pureLaughResult = ns.render.classifyTranscriptQuality(pureLaughNoise);
  const mixedResult = ns.render.classifyTranscriptQuality(meaningfulWithTail);
  const mixedLaughResult = ns.render.classifyTranscriptQuality(meaningfulWithLaughTail);

  assert.equal(pureResult.isLowQuality, true, "Pure repeated filler transcript should be classified as low quality");
  assert.equal(pureLaughResult.isLowQuality, true, "Pure repeated laugh transcript should be classified as low quality");
  assert.equal(mixedResult.isLowQuality, false, "Meaningful transcript with a noisy tail should stay visible by default");
  assert.equal(mixedLaughResult.isLowQuality, false, "Meaningful transcript with a laugh tail should stay visible by default");

  const display = ns.render.buildSegmentDisplayItems([
    { startMs: 0, endMs: 5000, text: pureNoise },
    { startMs: 5000, endMs: 10000, text: meaningfulWithTail },
    { startMs: 10000, endMs: 15000, text: pureLaughNoise },
  ]);
  assert.equal(display.totalCount, 3, "Segment display model should keep the original segment total");
  assert.equal(display.hiddenCount, 2, "Segment display model should hide pure low-quality repetitions by default");
  assert.equal(display.visibleItems.length, 1, "Segment display model should keep meaningful segments visible");

  const expanded = ns.render.buildSegmentDisplayItems([
    { startMs: 0, endMs: 5000, text: pureNoise },
    { startMs: 5000, endMs: 10000, text: meaningfulWithTail },
    { startMs: 10000, endMs: 15000, text: pureLaughNoise },
  ], { showLowQualitySegments: true });
  assert.equal(expanded.hiddenCount, 0, "Expanded segment display should not hide low-quality segments");
  assert.equal(expanded.visibleItems.length, 3, "Expanded segment display should show all segments");
}

async function main() {
  const html = fs.readFileSync(hostedMeetingHtmlPath, "utf8");
  const css = fs.readFileSync(hostedMeetingCssPath, "utf8");
  const designSystemCss = fs.readFileSync(hostedDesignSystemCssPath, "utf8");
  const renderJs = fs.readFileSync(hostedMeetingRenderPath, "utf8");
  const realtimeJs = fs.readFileSync(hostedMeetingRealtimePath, "utf8");
  const mutationsJs = fs.readFileSync(hostedMeetingMutationsPath, "utf8");
  const notesJs = fs.readFileSync(hostedMeetingNotesPath, "utf8");
  const debugJs = fs.readFileSync(hostedMeetingDebugPath, "utf8");
  const pendingUploadsJs = fs.readFileSync(hostedMeetingPendingUploadsPath, "utf8");
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const toastNotice = document.getElementById("toastNotice");
  const blockedState = document.getElementById("blockedState");
  assert(toastNotice, "Hosted workspace should render a header toast notice slot");
  assert(html.includes('/shared/design-system.css'), "Hosted workspace should load shared design system styles");
  assert(html.includes('/shared/design-system.js'), "Hosted workspace should load shared design system behavior");
  assert.equal(document.getElementById("currentNotice"), null, "Legacy inline recorder notice should be removed");
  assert(blockedState, "Hosted workspace should render a blocked state");
  assert(
    blockedState.classList.contains("inova-status-state"),
    "Hosted workspace blocked state should use the shared status-state design system primitive"
  );
  assert.equal(
    document.querySelector(".blocked-state__card"),
    null,
    "Hosted workspace blocked state should not use a private blocked card wrapper"
  );
  assert(
    document.getElementById("blockedIcon")?.classList.contains("inova-status-state__icon"),
    "Hosted workspace blocked state should render the shared status icon slot"
  );
  assert(
    designSystemCss.includes('.inova-status-state[data-tone="warning"]')
      && designSystemCss.includes('.inova-status-state[data-tone="complete"]'),
    "Shared status state should support warning and complete meeting tones"
  );
  assert(
    /\.blocked-state\s*\{[\s\S]*position:\s*fixed;[\s\S]*top:\s*50%;[\s\S]*left:\s*50%;[\s\S]*transform:\s*translate\(-50%,\s*-50%\);/.test(css),
    "Hosted workspace blocked state should be centered in the viewport"
  );

  const headerEditorRow = document.querySelector(".workspace-header__editor-row");
  const deleteMeetingButton = document.getElementById("deleteMeetingButton");
  assert(headerEditorRow, "Hosted workspace should render the editor row");
  assert(deleteMeetingButton, "Hosted workspace should render the delete meeting action");
  assert(
    headerEditorRow.contains(deleteMeetingButton),
    "Delete meeting action should live in the editor row, not the header toolbar"
  );

  const reviewTabActions = document.getElementById("reviewTabActions");
  const copySegmentsButton = document.getElementById("copySegmentsButton");
  const segmentQualityBadge = document.getElementById("segmentQualityBadge");
  const toggleLowQualitySegmentsButton = document.getElementById("toggleLowQualitySegmentsButton");
  const copyMeetingNotesButton = document.getElementById("copyMeetingNotesButton");
  const retryMeetingNotesButton = document.getElementById("retryMeetingNotesButton");
  const moveRecordButton = document.getElementById("moveRecordButton");
  const downloadRecordButton = document.getElementById("downloadRecordButton");
  const recordMoveConfirm = document.getElementById("recordMoveConfirm");
  const recordMoveList = document.getElementById("recordMoveList");
  const recordMoveOverlay = document.getElementById("recordMoveOverlay");
  const toggleTermReplacementButton = document.getElementById("toggleTermReplacementButton");

  assert(reviewTabActions, "Hosted workspace should render the shared review action row");
  assert.equal(document.getElementById("reviewSegmentsToolbar"), null, "Separate segments toolbar should be removed");
  assert(copySegmentsButton, "Hosted workspace should render the transcript copy action");
  assert(segmentQualityBadge, "Hosted workspace should render the low-quality transcript hidden-count badge");
  assert(toggleLowQualitySegmentsButton, "Hosted workspace should render the low-quality transcript visibility toggle");
  assert(copyMeetingNotesButton, "Hosted workspace should render the meeting notes copy action");
  assert(retryMeetingNotesButton, "Hosted workspace should render the meeting notes retry action");
  assert(
    realtimeJs.includes("selectionChanged || forceRefresh || pendingMutationJustCompleted"),
    "Completed meeting mutations should refresh same-id artifacts without a page reload"
  );
  assert(moveRecordButton, "Hosted workspace should render the move record action in the detail action row");
  assert(downloadRecordButton, "Hosted workspace should render the local source download action in the detail action row");
  assert.equal(
    String(downloadRecordButton.textContent || "").trim(),
    "원본 다운로드",
    "Hosted workspace download action should make clear it downloads the local original source"
  );
  assert(recordMoveOverlay, "Hosted workspace should render the dedicated move record overlay");
  assert(recordMoveList, "Hosted workspace should render the move target list");
  assert(recordMoveConfirm, "Hosted workspace should render the move confirm action");
  assert(toggleTermReplacementButton, "Hosted workspace should render the term replacement toggle");
  assert(
    reviewTabActions.contains(copySegmentsButton) && reviewTabActions.contains(copyMeetingNotesButton),
    "Copy actions should share the review action row"
  );
  assert(
    reviewTabActions.contains(segmentQualityBadge) && reviewTabActions.contains(toggleLowQualitySegmentsButton),
    "Low-quality transcript controls should stay in the shared review action row"
  );
  assert(
    reviewTabActions.contains(toggleTermReplacementButton),
    "Term replacement toggle should share the review action row"
  );

  const termReplacementHelp = toggleTermReplacementButton.querySelector(".review-tab-action-button__help");
  assert(
    toggleTermReplacementButton.classList.contains("review-tab-action-button"),
    "Term replacement toggle should use the shared action button treatment"
  );
  assert(termReplacementHelp, "Term replacement toggle should include an inline help affordance");
  assert(
    String(termReplacementHelp.getAttribute("data-tooltip") || "").includes("모든 회의 정리"),
    "Term replacement help tooltip should describe meeting-wide application"
  );
  assert(
    !css.includes(".toast-notice") && /\.toast-notice\s*\{[\s\S]*position:\s*fixed;/.test(designSystemCss),
    "Hosted workspace toast notice should use the shared fixed-position design system style"
  );
  assert(
    renderJs.includes("이 기록은 회의 정리가 없는 기록입니다. 원문 탭에서 전사를 확인할 수 있습니다."),
    "Hosted workspace should explain empty notes as a notes-state message instead of reusing the degraded warning copy"
  );
  assert(
    mutationsJs.includes("용어 치환 규칙을 저장했습니다. 이 회의의 정리 결과에 반영됩니다."),
    "Term replacement save flow should use the updated save feedback copy"
  );
  assert(
    mutationsJs.includes("state.termReplacementState.open = false;"),
    "Term replacement save flow should close the panel after a successful save"
  );
  assert(
    !html.includes('id="debugPanel"') && !html.includes("debug-console.js"),
    "Hosted meeting should not load or render the in-page debug console UI"
  );
  assert(
    debugJs.includes('mode: "browser-console"') && debugJs.includes("[inova:${channel} #${traceSequence}]"),
    "Hosted meeting debug logging should emit extension-style browser console trace lines"
  );
  assert(
    debugJs.includes("same event repeated ${lastTraceEntry.repeatCount} more times"),
    "Hosted meeting browser console trace should collapse repeated events like the extension panel trace"
  );

  assert(document.getElementById("sectionEditDialogEyebrow"), "Section edit dialog should render a mode eyebrow");
  assert(document.getElementById("sectionEditHelpText"), "Section edit dialog should render mode-specific help text");
  assert.equal(document.getElementById("sectionEditStatus"), null, "Section edit dialog should not render a separate status strip");
  assert(
    renderJs.includes('data-notes-section-action="manual-edit"')
      && renderJs.includes('data-notes-section-action="ai-edit"')
      && renderJs.includes('data-notes-section-action="delete"'),
    "Meeting notes section header should expose manual edit, AI edit, and delete actions"
  );
  assert(
    css.includes(".notes-section__action--danger") && css.includes(".notes-section__action--ai"),
    "Meeting notes section actions should have distinct AI and delete affordances"
  );
  assert(
    mutationsJs.includes("buildManualSectionPayload")
      && mutationsJs.includes("deleteMeetingNotesSection")
      && mutationsJs.includes('editMode: "manual"'),
    "Meeting notes section actions should support manual save and delete through the hosted mutation controller"
  );
  assert(
    mutationsJs.includes("[참여자]\\n")
      && mutationsJs.includes("parseManualOverviewParticipants")
      && mutationsJs.includes("meetingMeta: overviewDraft.meetingMeta"),
    "Manual overview editing should expose and save editable participant metadata"
  );
  assert(
    mutationsJs.includes("const marker = `(?:\\\\[${label}\\\\]|${label})`;")
      && mutationsJs.includes("normalizeTextBlock(text)"),
    "Manual overview editing should save both bracketless overview blocks and plain overview text"
  );
  assert(
    notesJs.includes("const MAX_DISCUSSION_FLOW_COUNT = 12")
      && notesJs.includes("const MAX_ACTION_COUNT = 12")
      && notesJs.includes("const MAX_OPEN_QUESTION_COUNT = 12")
      && notesJs.includes("const MAX_RISK_COUNT = 10"),
    "Hosted notes normalizer should preserve long manual meeting-note sections"
  );
  assert(
    mutationsJs.includes("moveRecordLocalCopyToMeeting")
      && pendingUploadsJs.includes("movePendingUploadToMeeting")
      && pendingUploadsJs.includes("workspace.pending-upload.move-meeting"),
    "Record move should move the local original copy to the target meeting instead of leaving it in the source room"
  );
  assert.equal(document.querySelector("#reviewTabActions #moveRecordButton"), null, "Move record action should not live in the shared review action row");

  await verifyManualOverviewEditPayload();
  await verifyMeetingNotesRetryPayload();
  verifyLowQualityTranscriptDisplay();
  console.log("[verify-meeting-hosted-ui] Hosted meeting UI contract passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
