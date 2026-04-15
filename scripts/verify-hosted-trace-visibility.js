const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function verifyHostedTraceVisibilityContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
  const conversationSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "conversation-controller.js"),
    "utf8"
  );
  const releaseSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "release-controller.js"),
    "utf8"
  );
  const panelTraceSource = fs.readFileSync(
    path.join(root, "content", "panel-console-trace.js"),
    "utf8"
  );
  const topPanelSource = fs.readFileSync(
    path.join(root, "content", "panel.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("traceConversation: traceConversationFlow"),
    "hosted panel should wire conversation tracing into the conversation controller"
  );
  assert(
    hostedPanelSource.includes("traceRelease: traceReleaseFlow"),
    "hosted panel should wire release tracing into the release controller"
  );
  assert(
    conversationSource.includes('traceConversation("34.hosted.conversation.snapshot.start"'),
    "conversation controller should trace snapshot requests"
  );
  assert(
    releaseSource.includes('traceRelease("34.hosted.release.fetch.start"'),
    "release controller should trace release fetch requests"
  );
  assert(
    panelTraceSource.includes('"hosted.panel-auth.start"'),
    "top panel should keep hosted panel-auth traces visible"
  );
  assert(
    panelTraceSource.includes('"hosted.firestore.listen.start"'),
    "top panel should keep hosted firestore traces visible"
  );
  assert(
    panelTraceSource.includes('"hosted.conversation.snapshot.start"'),
    "top panel should keep conversation snapshot traces visible"
  );
  assert(
    panelTraceSource.includes('"hosted.release.fetch.start"'),
    "top panel should keep release fetch traces visible"
  );
  assert(
    panelTraceSource.includes("function buildPanelSnapshotTracePayload(state = {})"),
    "top panel snapshot push traces should flow through a dedicated panel trace payload helper"
  );
  assert(
    panelTraceSource.includes("const activePromptTab = normalizeText(panelSnapshot?.uiPreferences?.activePromptTab);"),
    "top panel snapshot push traces should derive from the raw panel snapshot instead of feature-local state"
  );
  assert(
    !panelTraceSource.includes("state?.open")
      && !panelTraceSource.includes("state?.visible"),
    "top panel snapshot push traces should not fall back to removed top-level render payload fields"
  );
  assert(
    panelTraceSource.includes('"hosted.release.fetch.start"')
      && panelTraceSource.includes('"hosted.firestore.listen.start"'),
    "feature-aware always-visible trace policy should live in the dedicated panel trace helper instead of the host"
  );
  assert(
    topPanelSource.includes("buildPanelSnapshotTracePayload: traceController.buildPanelSnapshotTracePayload"),
    "top panel host should pass the panel trace helper through to the dedicated host runtime instead of rebuilding snapshot trace payloads inline"
  );
  assert(
    topPanelSource.includes("const traceController = panelConsoleTrace.create({"),
    "top panel host should create its console trace logger through the dedicated trace helper"
  );
  assert(
    !topPanelSource.includes('"hosted.release.fetch.start"')
      && !topPanelSource.includes('"hosted.firestore.listen.start"')
      && !topPanelSource.includes("promptTool?.review")
      && !topPanelSource.includes("state?.promptTool?.activeTab")
      && !topPanelSource.includes("state?.uiPreferences?.activePromptTab"),
    "top panel host should stop carrying feature-local trace policy or prompt review/tab detail directly"
  );
}

module.exports = {
  verifyHostedTraceVisibilityContract,
};
