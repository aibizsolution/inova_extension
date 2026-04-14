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

function verifyHostedMeetingVisibilityRecoveryContract() {
  const hostedPanelSource = readHostedPanelSource();

  assert(
    !hostedPanelSource.includes('global.addEventListener("focus", handleWindowFocus, { passive: true });'),
    "hosted meeting recovery should not rely on raw iframe window focus events"
  );
  assert(
    !hostedPanelSource.includes('global.addEventListener("blur", handleWindowBlur, { passive: true });'),
    "hosted meeting recovery should not rely on raw iframe window blur events"
  );
  assert(
    !hostedPanelSource.includes('handleHostActivity?.("window-focus")'),
    "hosted meeting recovery should not forward raw window-focus events into the hosted meeting hub"
  );
  assert(
    hostedPanelSource.includes('void meetingHubController?.handleHostActivity?.("visibility-visible");'),
    "hosted panel should use document visibility recovery for hosted meeting refreshes"
  );
}

module.exports = {
  verifyHostedMeetingVisibilityRecoveryContract,
  verifyHostedMeetingSnapshotSyncGuardContract,
};
