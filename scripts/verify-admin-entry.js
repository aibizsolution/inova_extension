#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyManifestAdminCapabilities();
  verifyHostedPanelAdminGate();
  verifyAdminPageContract();
  await verifyAdminRuntimeDispatch();
  await verifyAdminConsoleUrlAdapter();
  console.log("[verify-admin-entry] Admin entry contract passed");
}

function verifyManifestAdminCapabilities() {
  const legacyManifest = readJson(path.join("hosting", "extension", "capability-manifest.json"));
  const v2Manifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
  assert.deepEqual(v2Manifest, legacyManifest, "served legacy/v2 capability manifests should stay aligned");
  assert.equal(v2Manifest.endpointKeys.checkInovaAdminAccessUrl.endpoint, "checkInovaAdminAccess");
  assert.equal(v2Manifest.endpointKeys.issueInovaAdminLaunchUrl.endpoint, "issueInovaAdminLaunch");
  assert.equal(v2Manifest.endpointKeys.exchangeInovaAdminLaunchUrl.endpoint, "exchangeInovaAdminLaunch");
  assert.equal(v2Manifest.endpointKeys.readInovaAdminBootstrapUrl.endpoint, "readInovaAdminBootstrap");
  assert.equal(v2Manifest.endpointKeys.readInovaPanelNoticeUrl.endpoint, "readInovaPanelNotice");
  assert.equal(v2Manifest.capabilities["admin.access.check"].kind, "function");
  assert.equal(v2Manifest.capabilities["admin.access.check"].authMode, "access-token");
  assert.equal(v2Manifest.capabilities["admin.access.check"].endpointKey, "checkInovaAdminAccessUrl");
  assert.equal(v2Manifest.capabilities["admin.launch.issue-function"].kind, "function");
  assert.equal(v2Manifest.capabilities["admin.launch.issue-function"].authMode, "access-token");
  assert.equal(v2Manifest.capabilities["admin.launch.issue-function"].endpointKey, "issueInovaAdminLaunchUrl");
  assert.equal(v2Manifest.capabilities["panel.notice.read-active"].kind, "function");
  assert.equal(v2Manifest.capabilities["panel.notice.read-active"].service, "admin");
  assert.equal(v2Manifest.capabilities["panel.notice.read-active"].authMode, "access-token");
  assert.equal(v2Manifest.capabilities["panel.notice.read-active"].endpointKey, "readInovaPanelNoticeUrl");
}

function verifyHostedPanelAdminGate() {
  const html = readText(path.join("hosting", "extension-v2", "panel", "index.html"));
  const hostedPanelSource = readText(path.join("hosting", "extension-v2", "panel", "index.js"));
  const adminControllerSource = readText(path.join("hosting", "extension-v2", "panel", "admin-entry-controller.js"));
  const extensionCapabilityClientSource = readText(path.join("hosting", "extension-v2", "panel", "extension-capability-client.js"));
  const serviceWorkerSource = readText(path.join("background", "service-worker.js"));
  const runtimeRouterSource = readText(path.join("background", "panel-runtime-capability-router.js"));
  const functionsRuntimeSource = readText(path.join("background", "functions-runtime-config.js"));
  const validatorSource = readText(path.join("background", "capability-manifest-validator.js"));

  assert(html.includes("./admin-entry-controller.js"), "v2 hosted panel should load the admin entry controller");
  assert(
    hostedPanelSource.includes("adminEntryController?.syncPanelState?.(panelState, effectiveCapabilities)")
      && hostedPanelSource.includes("adminEntryController?.shouldShowEntry?.()")
      && hostedPanelSource.includes("tools.push(adminEntryController.buildToolItem())"),
    "hosted panel should add the admin tool only after server access is verified"
  );
  assert(
    hostedPanelSource.includes('normalizeText(toolId) === "admin"')
      && hostedPanelSource.includes("adminEntryController?.handleOpen?.()"),
    "admin tool selection should launch a new tab instead of becoming active panel content"
  );
  assert(
    adminControllerSource.includes('const ADMIN_ACCESS_CHECK_CAPABILITY_ID = "admin.access.check"')
      && adminControllerSource.includes('const ADMIN_LAUNCH_ISSUE_CAPABILITY_ID = "admin.launch.issue-function"')
      && adminControllerSource.includes("browserCapabilities.openAdminConsole")
      && adminControllerSource.includes("state.status === \"allowed\"")
      && adminControllerSource.includes("state.accessPendingKey"),
    "admin entry controller should gate rendering on current server capability checks"
  );
  assert(
    extensionCapabilityClientSource.includes("function openAdminConsole")
      && extensionCapabilityClientSource.includes('action: "admin.console.open"'),
    "hosted capability client should expose a narrow admin console open helper"
  );
  assert(
    serviceWorkerSource.includes('importScripts("admin-console-capability.js");')
      && serviceWorkerSource.includes("openAdminConsole: adminConsoleCapability.openConsole"),
    "background service worker should preload the admin console browser adapter"
  );
  assert(
    runtimeRouterSource.includes('"admin.console.open"')
      && runtimeRouterSource.includes("openAdminConsole(request?.input, request?.providerIdentity)"),
    "background runtime router should expose admin console opening as a stable runtime capability"
  );
  assert(
    functionsRuntimeSource.includes('"admin.access.check"')
      && functionsRuntimeSource.includes('"admin.launch.issue-function"')
      && functionsRuntimeSource.includes('"panel.notice.read-active"')
      && functionsRuntimeSource.includes('"checkInovaAdminAccessUrl"')
      && functionsRuntimeSource.includes('"readInovaPanelNoticeUrl"')
      && functionsRuntimeSource.includes('"readInovaAdminBootstrapUrl"'),
    "background bundled functions config should include admin endpoints and capabilities"
  );
  assert(
    validatorSource.includes('"admin"')
      && validatorSource.includes('"meeting"')
      && validatorSource.includes('"prompt"'),
    "remote capability manifest validator should allow the admin function service"
  );
}

function verifyAdminPageContract() {
  const html = readText(path.join("hosting", "admin", "index.html"));
  const css = readText(path.join("hosting", "admin", "index.css"));
  const pageSource = readText(path.join("hosting", "admin", "index.js"));
  const firebaseConfig = readText("firebase.json");
  const adminServiceSource = readText(path.join("functions", "features", "admin", "admin-service.js"));
  const functionsIndexSource = readText(path.join("functions", "index.js"));

  assert(html.includes('<script src="index.js" defer></script>'), "hosted admin page should load its controller");
  assert(
    html.includes('id="adminShell"')
      && html.includes('data-view="loading"')
      && html.includes('id="adminSidebar"')
      && html.includes('aria-label="관리자 메뉴"')
      && html.includes('id="navGroups"')
      && html.includes('id="sessionPanel"')
      && html.includes('id="contentPanel"')
      && html.includes('class="admin-page-layout"')
      && html.includes('id="pageOutlet"')
      && html.includes('id="sideAccessState"')
      && html.includes('id="sideSessionExpiresAt"'),
    "hosted admin page should expose a menu-driven shell with session, content outlet, side context, and blocked regions"
  );
  assert(
    css.includes(".admin-sidebar")
      && css.includes(".admin-nav__item")
      && css.includes(".admin-main")
      && css.includes(".admin-page-layout")
      && css.includes(".admin-page-outlet")
      && css.includes(".admin-side-context")
      && css.includes("min-width: 1120px")
      && css.includes('.admin-shell[data-view="loading"]'),
    "hosted admin styles should keep a PC-width menu/outlet layout and explicit view state primitives"
  );
  assert(
    !html.includes('id="moduleGrid"')
      && !css.includes(".admin-module-card")
      && !pageSource.includes("ADMIN_MODULES"),
    "hosted admin page should not use the old one-page module-card shell"
  );
  assert(
    !html.includes("admin-sidebar-session")
      && !html.includes("sidebarViewerEmail")
      && !html.includes("접속 계정")
      && !pageSource.includes("sidebarViewerEmail"),
    "hosted admin sidebar should stay navigation-only and avoid duplicating session identity"
  );
  assert(
    pageSource.includes("exchangeInovaAdminLaunch")
      && pageSource.includes("readInovaAdminBootstrap")
      && pageSource.includes("AdminSession")
      && pageSource.includes("sessionStorage")
      && pageSource.includes('url.searchParams.delete("launch")'),
    "hosted admin page should exchange launch tokens, remove query secrets, and verify AdminSession"
  );
  assert(
    pageSource.includes("const ADMIN_SECTIONS = Object.freeze")
      && pageSource.includes('id: "notice"')
      && pageSource.includes("소식 팝업")
      && pageSource.includes("function setView")
      && pageSource.includes("function renderNavigation")
      && pageSource.includes("function renderActiveSection")
      && pageSource.includes("function setActiveSection")
      && pageSource.includes("function applyVerifiedSession"),
    "hosted admin page should centralize view state and render future admin sections through a stable menu/outlet slot"
  );
  assert(
    firebaseConfig.includes('"source": "admin/**"')
      && firebaseConfig.match(/"source": "admin\/\*\*"/g)?.length === 2,
    "hosting should serve admin assets with no-cache headers on both targets"
  );
  assert(
    adminServiceSource.includes('const ADMIN_USER_COLLECTION = "ops_admin_users"')
      && adminServiceSource.includes('const ADMIN_LAUNCH_COLLECTION = "ops_admin_launches"')
      && adminServiceSource.includes('const ADMIN_SESSION_COLLECTION = "ops_admin_sessions"')
      && adminServiceSource.includes('const PANEL_NOTICE_COLLECTION = "ops_panel_notices"')
      && adminServiceSource.includes('const PANEL_NOTICE_STATE_COLLECTION = "ops_panel_notice_state"')
      && adminServiceSource.includes("hashSecret")
      && adminServiceSource.includes("관리자 권한이 더 이상 유효하지 않아요."),
    "admin service should own server-side access checks, hashed token storage, and revocation checks"
  );
  assert(
    functionsIndexSource.includes('require("./features/admin/admin-service")')
      && functionsIndexSource.includes("exports.checkInovaAdminAccess")
      && functionsIndexSource.includes("exports.issueInovaAdminLaunch")
      && functionsIndexSource.includes("exports.exchangeInovaAdminLaunch")
      && functionsIndexSource.includes("exports.readInovaAdminBootstrap")
      && functionsIndexSource.includes("exports.readInovaPanelNotice")
      && functionsIndexSource.includes("exports.saveInovaAdminPanelNotice")
      && functionsIndexSource.includes("exports.publishInovaAdminPanelNotice")
      && functionsIndexSource.includes("exports.archiveInovaAdminPanelNotice"),
    "functions/index.js should export the admin access, session, and panel notice endpoints"
  );
  assert(
    pageSource.includes("listInovaAdminPanelNotices")
      && pageSource.includes("saveInovaAdminPanelNotice")
      && pageSource.includes("publishInovaAdminPanelNotice")
      && pageSource.includes("archiveInovaAdminPanelNotice")
      && pageSource.includes("renderAdminNoticeMarkdownPreview")
      && pageSource.includes("data-notice-action=\"save\"")
      && pageSource.includes("data-notice-action=\"publish\"")
      && pageSource.includes("data-notice-action=\"archive\""),
    "hosted admin page should expose the panel notice editor, preview, and save/publish/archive actions through the notice outlet"
  );
}

async function verifyAdminRuntimeDispatch() {
  const context = vm.createContext({
    console,
    globalThis: null,
    openAdminConsole: async (input, providerIdentity) => ({
      launchToken: String(input?.launchToken || ""),
      opened: true,
      providerUserKey: String(providerIdentity?.providerUserKey || ""),
    }),
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      async getState() {
        return {};
      },
      async updateUiPreferences(partial) {
        return partial || {};
      },
    },
  };
  loadScript(path.join("background", "panel-runtime-capability-router.js"), context);
  const result = await context.InovaBookmarks.panelRuntimeCapabilityRouter.handle({
    action: "admin.console.open",
    input: {
      launchToken: "launch.fixture",
    },
    providerIdentity: {
      providerUserKey: "admin-user-1",
    },
  });
  assert.deepEqual(result, {
    launchToken: "launch.fixture",
    opened: true,
    providerUserKey: "admin-user-1",
  });
}

async function verifyAdminConsoleUrlAdapter() {
  const openedUrls = [];
  const context = vm.createContext({
    console,
    globalThis: null,
    URL,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    browserCapability: {
      async openUrl(url) {
        openedUrls.push(String(url || ""));
        return { tabId: 42 };
      },
    },
    firebaseConfig: {
      hosting: {
        originUrl: "https://browser-extension-v2.web.app",
      },
    },
    functionsRuntimeConfig: {
      async getPromptRuntimeConfig() {
        return {
          hosting: {
            originUrl: "http://127.0.0.1:5000",
          },
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      async getState() {
        return { settings: { meetingWorkspaceTarget: "local" } };
      },
    },
  };
  loadScript(path.join("background", "admin-console-capability.js"), context);
  const result = await context.InovaBookmarks.adminConsoleCapability.openConsole({
    launchToken: "launch.fixture",
  }, {
    providerUserKey: "admin-user-1",
  });
  assert.deepEqual(openedUrls, ["http://127.0.0.1:5000/admin/index.html?launch=launch.fixture"]);
  assert.equal(result.tabId, 42);
  assert.equal(result.providerUserKey, "admin-user-1");
}

function loadScript(relativePath, context) {
  const source = readText(relativePath);
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

main().catch((error) => {
  console.error(`[verify-admin-entry] ${error.stack || error.message}`);
  process.exitCode = 1;
});
