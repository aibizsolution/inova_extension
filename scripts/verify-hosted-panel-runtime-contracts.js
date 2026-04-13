const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function readHostedPanelSource() {
  return fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
}

function verifyHostedMeetingSnapshotSyncGuardContract() {
  const hostedPanelSource = readHostedPanelSource();

  assert(
    hostedPanelSource.includes('lastControllerSyncKey: "",'),
    "hosted panel should track the last controller sync key so local rerenders do not replay stale snapshots into hosted controllers"
  );
  assert(
    hostedPanelSource.includes("syncHostedControllersIfNeeded(panelState);"),
    "hosted panel should gate controller sync behind an incoming snapshot guard"
  );
  assert(
    hostedPanelSource.includes("const nextControllerSyncKey = serializeRenderState({"),
    "hosted panel should derive controller sync keys from the incoming panel snapshot and extension capabilities"
  );
  assert(
    hostedPanelSource.includes("if (state.lastControllerSyncKey === nextControllerSyncKey) {"),
    "hosted panel should skip controller resync when the incoming snapshot has not changed"
  );
}

function verifyHostedMeetingFocusRecoveryContract() {
  const hostedPanelSource = readHostedPanelSource();

  assert(
    hostedPanelSource.includes("windowRecentlyBlurred: false,"),
    "hosted panel should track whether the window actually blurred before accepting a meeting focus refresh"
  );
  assert(
    hostedPanelSource.includes('global.addEventListener("blur", handleWindowBlur, { passive: true });'),
    "hosted panel should listen for real window blur events before treating focus as a recovery signal"
  );
  assert(
    hostedPanelSource.includes("if (!state.windowRecentlyBlurred) {"),
    "hosted panel should ignore click-driven focus events that were not preceded by a blur"
  );
  assert(
    hostedPanelSource.includes('void meetingHubController?.handleHostActivity?.("visibility-visible");'),
    "hosted panel should continue to use visibility recovery for hosted meeting refreshes"
  );
}

module.exports = {
  verifyHostedMeetingFocusRecoveryContract,
  verifyHostedMeetingSnapshotSyncGuardContract,
};
