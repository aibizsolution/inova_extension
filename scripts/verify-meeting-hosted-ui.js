#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const hostedMeetingHtmlPath = path.join(root, "hosting", "meeting", "index.html");

function main() {
  const html = fs.readFileSync(hostedMeetingHtmlPath, "utf8");
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const toastNotice = document.getElementById("toastNotice");
  assert(toastNotice, "Hosted workspace should render a header toast notice slot");
  assert.equal(document.getElementById("currentNotice"), null, "Legacy inline recorder notice should be removed");

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
  const recordMoveConfirm = document.getElementById("recordMoveConfirm");
  const recordMoveList = document.getElementById("recordMoveList");
  const recordMoveOverlay = document.getElementById("recordMoveOverlay");
  const toggleTermReplacementButton = document.getElementById("toggleTermReplacementButton");

  assert(reviewTabActions, "Hosted workspace should render the shared review action row");
  assert.equal(document.getElementById("reviewSegmentsToolbar"), null, "Separate segments toolbar should be removed");
  assert(copySegmentsButton, "Hosted workspace should render the transcript copy action");
  assert(copyMeetingNotesButton, "Hosted workspace should render the meeting notes copy action");
  assert(moveRecordButton, "Hosted workspace should render the move record action in the detail action row");
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

  assert.equal(document.getElementById("sectionEditStatus"), null, "Section edit dialog should not render a separate status strip");
  assert.equal(document.querySelector("#reviewTabActions #moveRecordButton"), null, "Move record action should not live in the shared review action row");

  console.log("[verify-meeting-hosted-ui] Hosted meeting UI contract passed");
}

main();
