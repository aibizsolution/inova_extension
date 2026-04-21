#!/usr/bin/env node

const assert = require("assert");
const path = require("path");

function main() {
  const namespace = global.__INOVA_HOSTED_MEETING__ = {
    notes: {
      hasMeetingNotes(input) {
        if (!input || typeof input !== "object") return false;
        return Boolean(
          String(input.summary || "").trim()
          || String(input.overview || "").trim()
          || (Array.isArray(input.actionItems) && input.actionItems.length)
          || (Array.isArray(input.decisions) && input.decisions.length)
          || (Array.isArray(input.discussionFlow) && input.discussionFlow.length)
          || (Array.isArray(input.openQuestions) && input.openQuestions.length)
          || (Array.isArray(input.risksOrDependencies) && input.risksOrDependencies.length)
        );
      },
      normalizeMeetingNotes(input) {
        return input && typeof input === "object" ? input : {};
      },
      normalizeTextArray(input) {
        return Array.isArray(input) ? input.map((item) => String(item || "").trim()).filter(Boolean) : [];
      },
    },
    shared: {
      TERMINAL_REMOTE_STATUSES: new Set(["failed", "succeeded"]),
      buildLocalSelectionId(requestId) {
        return `local:${String(requestId || "").trim()}`;
      },
      buildRemoteSelectionId(jobId) {
        return `remote:${String(jobId || "").trim()}`;
      },
      cleanPreviewText(value) {
        return String(value || "").trim();
      },
      escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      },
      formatBytes(value) {
        return String(value || "").trim();
      },
      formatDateTime(value) {
        return String(value || "").trim();
      },
      formatDuration(value) {
        return String(value || "").trim();
      },
      formatPhase(value) {
        return String(value || "").trim();
      },
      formatSegmentRange(startMs, endMs) {
        return `${startMs}-${endMs}`;
      },
      formatStatusLabel(value) {
        return String(value || "").trim();
      },
      normalizeStatus(value) {
        return String(value || "").trim();
      },
      normalizeText(value) {
        return String(value || "").trim();
      },
      normalizeTextBlock(value) {
        return String(value || "").trim();
      },
      toTimestamp(value) {
        const timestamp = Date.parse(String(value || "").trim());
        return Number.isFinite(timestamp) ? timestamp : 0;
      },
    },
    storage: {
      comparePendingUploads() {
        return 0;
      },
    },
  };

  require(path.resolve(__dirname, "..", "hosting", "meeting", "render-state.js"));
  require(path.resolve(__dirname, "..", "hosting", "meeting", "render.js"));

  const { buildHistoryEntries, chooseSelectedRecordId, findRemoteForPending } = namespace.renderState;
  const state = {
    autoFocusRecordRequestId: "capture-1",
    pendingUploads: [
      {
        createdAt: "2026-04-10T07:31:00.000Z",
        durationMs: 4000,
        jobId: "",
        requestId: "capture-1",
        status: "uploading",
        updatedAt: "2026-04-10T07:31:03.000Z",
      },
    ],
    records: [
      {
        createdAt: "2026-04-10T07:20:01.000Z",
        durationMs: 3000,
        jobId: "job-old",
        requestId: "capture-old",
        status: "succeeded",
        title: "기존 기록",
        updatedAt: "2026-04-10T07:20:04.000Z",
      },
      {
        createdAt: "2026-04-10T07:31:01.000Z",
        durationMs: 4000,
        jobId: "job-1",
        requestId: "capture-1",
        status: "queued",
        title: "신규 회의 룸!",
        updatedAt: "2026-04-10T07:31:04.000Z",
      },
    ],
  };

  const matchedRemote = findRemoteForPending(state, state.pendingUploads[0]);
  assert(matchedRemote, "Uploading pending item should match a remote record with the same requestId");
  assert.equal(matchedRemote.jobId, "job-1");

  const historyEntries = buildHistoryEntries(state);
  assert.equal(historyEntries.length, 2, "Pending and remote entries with the same requestId should merge while existing records remain visible");
  assert.equal(historyEntries[0].id, "remote:job-1");
  assert(historyEntries[0].pending, "Merged history entry should keep pending upload state");
  assert(historyEntries[0].remote, "Merged history entry should keep remote job state");
  assert.equal(
    chooseSelectedRecordId({
      ...state,
      params: {},
      selectedRecordId: "remote:job-old",
    }),
    "remote:job-1",
    "Auto-focus requestId should move selection to the newly created record once it appears"
  );

  verifyDetailHydrationView(namespace);

  console.log("[verify-meeting-render-state] Hosted meeting render-state contract passed");
}

function verifyDetailHydrationView(namespace) {
  const activeEntry = {
    id: "remote:job-ready",
    remote: {
      artifactId: "artifact-ready",
      createdAt: "2026-04-10T08:20:00.000Z",
      durationMs: 120000,
      jobId: "job-ready",
      status: "succeeded",
      title: "완료 기록",
      updatedAt: "2026-04-10T08:30:00.000Z",
    },
    status: "succeeded",
  };
  const baseState = {
    currentArtifact: null,
    currentDetailSelectionId: activeEntry.id,
    currentJob: null,
    meeting: { title: "회의 룸" },
    notice: { text: "", tone: "" },
    realtime: { artifactDocId: "" },
    selectedDetailHydrating: false,
    selectedRecordId: activeEntry.id,
  };
  const pendingArtifactView = namespace.render.buildDetailView(baseState, activeEntry);
  assert.equal(
    pendingArtifactView.isHydratingDetail,
    true,
    "Completed records should render a loading detail state until the artifact read has been attempted"
  );
  assert.equal(pendingArtifactView.notice, "상세 기록을 불러오는 중입니다.");

  const attemptedArtifactView = namespace.render.buildDetailView({
    ...baseState,
    realtime: { artifactDocId: "artifact-ready" },
  }, activeEntry);
  assert.equal(
    attemptedArtifactView.isHydratingDetail,
    false,
    "Completed records may render an empty notes state only after the artifact read has been attempted"
  );
}

main();
