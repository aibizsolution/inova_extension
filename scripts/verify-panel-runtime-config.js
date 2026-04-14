const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function verifyPanelRuntimeResolverOwnershipContract() {
  const panelSource = fs.readFileSync(
    path.join(root, "content", "panel.js"),
    "utf8"
  );
  const panelHostRuntimeSource = fs.readFileSync(
    path.join(root, "content", "panel-host-runtime.js"),
    "utf8"
  );
  const firebaseConfigSource = fs.readFileSync(
    path.join(root, "shared", "firebase-config.js"),
    "utf8"
  );

  assert(
    panelSource.includes("panelHostRuntime.create"),
    "content panel host should delegate host runtime work through the dedicated panel host runtime helper"
  );
  assert(
    panelHostRuntimeSource.includes("namespace.firebaseConfig?.panel?.resolveRuntime?.(settings)"),
    "panel host runtime helper should resolve its runtime target through a generic panel runtime helper"
  );
  assert(
    !panelHostRuntimeSource.includes("namespace.firebaseConfig?.meeting?.resolveRuntime?.(settings)")
      && !panelHostRuntimeSource.includes("namespace.firebaseConfig?.prompt?.resolveRuntime?.(settings)"),
    "panel host runtime helper should stop choosing meeting/prompt runtime helpers directly"
  );
  assert(
    firebaseConfigSource.includes("config.panel = buildPanelConfigHelpers(config);"),
    "firebase config should expose a dedicated panel runtime helper for the shell host"
  );
}

module.exports = {
  verifyPanelRuntimeResolverOwnershipContract,
};
