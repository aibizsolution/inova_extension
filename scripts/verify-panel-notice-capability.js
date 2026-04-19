#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  verifyPanelNoticeManifestContract();
  verifyPanelNoticeRuntimeContract();
  verifyPanelNoticeHostedContract();
  console.log("[verify-panel-notice-capability] Panel notice capability contract passed");
}

function verifyPanelNoticeManifestContract() {
  const legacyManifest = readJson(path.join("hosting", "extension", "capability-manifest.json"));
  const v2Manifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
  assert.deepEqual(v2Manifest, legacyManifest, "served legacy/v2 capability manifests should stay aligned");
  assert.equal(v2Manifest.endpointKeys.readInovaPanelNoticeUrl.endpoint, "readInovaPanelNotice");
  assert.equal(v2Manifest.endpointKeys.readInovaPanelNoticeUrl.method, "POST");
  assert.deepEqual(v2Manifest.capabilities["panel.notice.read-active"], {
    auditLevel: "read",
    authMode: "access-token",
    domain: "panel",
    enabled: true,
    endpointKey: "readInovaPanelNoticeUrl",
    inputSchemaVersion: 1,
    kind: "function",
    minExtensionVersion: "1.0.0",
    outputSchemaVersion: 1,
    owner: "admin",
    schemaVersion: 1,
    service: "admin",
  });
}

function verifyPanelNoticeRuntimeContract() {
  const functionsRuntimeSource = readText(path.join("background", "functions-runtime-config.js"));
  const panelRuntimeRouterSource = readText(path.join("background", "panel-runtime-capability-router.js"));
  const catalogSource = readText(path.join("docs", "capability-catalog.md"));

  assert(
    functionsRuntimeSource.includes('"panel.notice.read-active"')
      && functionsRuntimeSource.includes('"readInovaPanelNoticeUrl"'),
    "bundled functions manifest should include the panel notice capability and endpoint fallback"
  );
  assert(
    panelRuntimeRouterSource.includes("readInovaPanelNoticeUrl")
      && panelRuntimeRouterSource.includes("panel.notice.read-active")
      && panelRuntimeRouterSource.includes("admin: () => namespace.functionsRuntimeConfig?.getDefaultFunctionsConfig?.()"),
    "runtime router compatibility manifest should recognize the admin panel notice endpoint"
  );
  assert(
    catalogSource.includes("| panel.notice.read-active | function | admin | readInovaPanelNoticeUrl | admin | panel | access-token | read | in:1/out:1 |  | 1.0.0 | yes |"),
    "generated capability catalog should include the panel notice read capability"
  );
}

function verifyPanelNoticeHostedContract() {
  const hostedHtml = readText(path.join("hosting", "extension-v2", "panel", "index.html"));
  const hostedPanelSource = readText(path.join("hosting", "extension-v2", "panel", "index.js"));
  const noticeControllerSource = readText(path.join("hosting", "extension-v2", "panel", "panel-notice-controller.js"));
  const noticeSignalSource = readText(path.join("hosting", "extension-v2", "panel", "panel-notice-signal-firestore-client.js"));
  const firestoreRulesSource = readText("firestore.rules");

  assert(
    hostedHtml.includes("./panel-notice-signal-firestore-client.js")
      && hostedHtml.indexOf("./base-firestore-client.js") < hostedHtml.indexOf("./panel-notice-signal-firestore-client.js")
      && hostedHtml.indexOf("./panel-notice-signal-firestore-client.js") < hostedHtml.indexOf("./panel-notice-controller.js"),
    "hosted panel should load the realtime notice signal client before the notice controller"
  );
  assert(
    hostedPanelSource.includes("panelNoticeController?.syncPanelState?.(panelState, effectiveCapabilities)")
      && hostedPanelSource.includes("renderPanelNoticeIfNeeded(elements.panelNotice)")
      && hostedPanelSource.includes('id="inova-panel-notice-slot"'),
    "hosted panel shell should sync, render, and reserve a bottom slot for panel notices"
  );
  assert(
    hostedPanelSource.includes("panelNoticeController?.handleClick?.(event)")
      && hostedPanelSource.includes("traceNoticeFlow"),
    "hosted panel should route notice dismissal clicks and trace notice reads separately"
  );
  assert(
    noticeControllerSource.includes('const PANEL_NOTICE_READ_CAPABILITY_ID = "panel.notice.read-active"')
      && noticeControllerSource.includes("ensureNoticeSignalSubscription")
      && noticeControllerSource.includes("panelNoticeSignalFirestoreClient")
      && noticeControllerSource.includes('refreshNotice("firestore")')
      && !noticeControllerSource.includes("NOTICE_REFRESH_INTERVAL_MS")
      && !noticeControllerSource.includes("setInterval")
      && noticeControllerSource.includes('traceNotice("hosted.notice.read.error"')
      && noticeControllerSource.includes("NOTICE_HIDE_DURATION_MS = 24 * 60 * 60 * 1000")
      && noticeControllerSource.includes("buildDismissKey(notice)")
      && !noticeControllerSource.includes("namespace.panelUtils?.normalizeText")
      && !noticeControllerSource.includes("namespace.session?.normalizeText")
      && !noticeControllerSource.includes('String(value ?? "").trim()'),
    "panel notice controller should use the active notice capability, subscribe to notice invalidation signals, avoid polling, hide read failures, persist one-day dismissal by noticeId:version, and use panelUtils"
  );
  assert(
    noticeSignalSource.includes('const SIGNAL_COLLECTION = "ops_panel_notice_signals"')
      && noticeSignalSource.includes("baseFirestoreClient")
      && noticeSignalSource.includes("createTarget")
      && !noticeSignalSource.includes("ops_panel_notices")
      && !noticeSignalSource.includes("ops_panel_notice_state"),
    "panel notice realtime client should subscribe only to the public invalidation signal doc"
  );
  assert(
    firestoreRulesSource.includes("match /ops_panel_notice_signals/{docId}")
      && firestoreRulesSource.includes('allow get: if isHostedPanelSessionActive() && docId == "current";')
      && firestoreRulesSource.includes("match /ops_panel_notices/{noticeId}")
      && firestoreRulesSource.includes("allow read, write: if false;"),
    "Firestore rules should allow hosted panels to subscribe only to the public notice invalidation signal"
  );
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

main();
