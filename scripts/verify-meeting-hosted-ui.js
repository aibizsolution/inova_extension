#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const hostedMeetingHtmlPath = path.join(root, "hosting", "meeting", "index.html");
const hostedMeetingCssPath = path.join(root, "hosting", "meeting", "index.css");
const hostedDesignSystemCssPath = path.join(root, "hosting", "shared", "design-system.css");
const hostedMeetingRenderPath = path.join(root, "hosting", "meeting", "render.js");
const hostedMeetingMutationsPath = path.join(root, "hosting", "meeting", "workspace-mutations.js");
const hostedMeetingNotesPath = path.join(root, "hosting", "meeting", "notes.js");
const hostedMeetingDebugPath = path.join(root, "hosting", "meeting", "workspace-debug.js");
const hostedMeetingPendingUploadsPath = path.join(root, "hosting", "meeting", "workspace-pending-uploads.js");

function main() {
  const html = fs.readFileSync(hostedMeetingHtmlPath, "utf8");
  const css = fs.readFileSync(hostedMeetingCssPath, "utf8");
  const designSystemCss = fs.readFileSync(hostedDesignSystemCssPath, "utf8");
  const renderJs = fs.readFileSync(hostedMeetingRenderPath, "utf8");
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
  const copyMeetingNotesButton = document.getElementById("copyMeetingNotesButton");
  const moveRecordButton = document.getElementById("moveRecordButton");
  const downloadRecordButton = document.getElementById("downloadRecordButton");
  const recordMoveConfirm = document.getElementById("recordMoveConfirm");
  const recordMoveList = document.getElementById("recordMoveList");
  const recordMoveOverlay = document.getElementById("recordMoveOverlay");
  const toggleTermReplacementButton = document.getElementById("toggleTermReplacementButton");

  assert(reviewTabActions, "Hosted workspace should render the shared review action row");
  assert.equal(document.getElementById("reviewSegmentsToolbar"), null, "Separate segments toolbar should be removed");
  assert(copySegmentsButton, "Hosted workspace should render the transcript copy action");
  assert(copyMeetingNotesButton, "Hosted workspace should render the meeting notes copy action");
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

  console.log("[verify-meeting-hosted-ui] Hosted meeting UI contract passed");
}

main();
