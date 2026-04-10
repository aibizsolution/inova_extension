#!/usr/bin/env node

const assert = require("assert");
const path = require("path");

function main() {
  const namespace = global.__INOVA_HOSTED_MEETING__ = {
    notes: {
      normalizeMeetingNotes(input) {
        return input && typeof input === "object" ? input : {};
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
      formatDateTime(value) {
        return String(value || "").trim();
      },
      formatPhase(value) {
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

  const { buildHistoryEntries, findRemoteForPending } = namespace.renderState;
  const state = {
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
  assert.equal(historyEntries.length, 1, "Pending and remote entries with the same requestId should render as one history card");
  assert.equal(historyEntries[0].id, "remote:job-1");
  assert(historyEntries[0].pending, "Merged history entry should keep pending upload state");
  assert(historyEntries[0].remote, "Merged history entry should keep remote job state");

  console.log("[verify-meeting-render-state] Hosted meeting render-state merge contract passed");
}

main();
