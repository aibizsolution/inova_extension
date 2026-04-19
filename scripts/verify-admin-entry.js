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
      && adminControllerSource.includes("state.accessPendingKey")
      && adminControllerSource.includes("ensureLaunchPrepared")
      && adminControllerSource.includes("readLaunchTokenForOpen")
      && adminControllerSource.includes("admin.launch.prefetch.hit")
      && adminControllerSource.includes("function openAdminUrl")
      && adminControllerSource.includes("function openBlankAdminWindow")
      && adminControllerSource.includes("function navigatePreparedAdminWindow")
      && adminControllerSource.includes('global.open(adminUrl, "_blank")')
      && adminControllerSource.includes('global.open("about:blank", "_blank")')
      && adminControllerSource.includes('mode: "web-window"')
      && adminControllerSource.includes('mode: "runtime-broker"')
      && adminControllerSource.includes("clearPreparedLaunch"),
    "admin entry controller should gate rendering on server capability checks, prefetch launch tokens, and prefer controllable web-open before runtime fallback"
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
  const designSystemCss = readText(path.join("hosting", "shared", "design-system.css"));
  const designSystemJs = readText(path.join("hosting", "shared", "design-system.js"));
  const designSystemDoc = readText(path.join("docs", "design-system.md"));
  const pageSource = readText(path.join("hosting", "admin", "index.js"));
  const firebaseConfig = readText("firebase.json");
  const adminServiceSource = readText(path.join("functions", "features", "admin", "admin-service.js"));
  const functionsIndexSource = readText(path.join("functions", "index.js"));

  assert(
    html.includes('<link rel="stylesheet" href="/shared/design-system.css" />')
      && html.includes('<script src="/shared/design-system.js" defer></script>')
      && html.includes('<script src="index.js" defer></script>')
      && html.includes('id="adminToastSlot"')
      && html.includes("data-inova-toast-slot"),
    "hosted admin page should load the shared design system before its controller and expose a toast slot"
  );
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
      && html.includes('id="loadingPanel"')
      && html.includes('class="admin-loading inova-status-state"')
      && !html.includes("세션 컨텍스트")
      && !html.includes('id="statusBadge"')
      && !html.includes('id="refreshButton"')
      && !html.includes('id="sideAccessState"')
      && !html.includes('id="sideSessionExpiresAt"')
      && html.indexOf('id="sessionPanel"') < html.indexOf('class="admin-topbar"'),
    "hosted admin page should expose a menu-driven shell with the session context as the first main content block"
  );
  assert(
    css.includes(".admin-sidebar")
      && css.includes(".admin-nav__item")
      && css.includes(".admin-main")
      && css.includes(".admin-page-layout")
      && css.includes(".admin-page-outlet")
      && css.includes(".admin-notice-badge")
      && css.includes("grid-template-columns: 360px minmax(440px, 1fr) 458px")
      && css.includes("overflow: hidden")
      && css.includes(".admin-notice-preview__frame")
      && css.includes(".admin-notice-panel-popup")
      && !css.includes(".admin-notice-feedback")
      && !css.includes(".admin-notice-secondary")
      && !css.includes(".admin-notice-toggle")
      && !css.includes(".admin-topbar__actions")
      && !css.includes(".admin-badge")
      && !css.includes(".admin-icon-button")
      && !css.includes(".admin-side-context")
      && css.includes('.admin-shell[data-view="verified"] .admin-topbar')
      && css.includes("min-width: 1120px")
      && css.includes('.admin-shell[data-view="loading"]')
      && css.includes('.admin-shell[data-view="loading"] .admin-main')
      && css.includes('.admin-shell[data-view="loading"] .admin-topbar')
      && css.includes(".admin-loading")
      && css.includes("place-items: center"),
    "hosted admin styles should keep a PC-width menu/outlet layout without a duplicate side context panel"
  );
  assert(
    designSystemCss.includes(".inova-toast-slot")
      && designSystemCss.includes(".inova-toast")
      && designSystemCss.includes(".inova-dialog-overlay")
      && designSystemCss.includes(".inova-dialog")
      && designSystemCss.includes(".inova-section-head")
      && designSystemCss.includes(".inova-section-head__title")
      && designSystemCss.includes(".inova-badge")
      && designSystemCss.includes(".inova-badge--success")
      && designSystemCss.includes(".inova-segmented")
      && designSystemCss.includes(".toast-notice")
      && designSystemCss.includes("position: fixed")
      && designSystemJs.includes("function createConfirmController")
      && designSystemJs.includes("function createDeferredSearchController")
      && designSystemJs.includes("function createToastController")
      && designSystemJs.includes("function renderIcon")
      && designSystemJs.includes("chevron-left")
      && designSystemJs.includes("chevron-right")
      && designSystemJs.includes("showToast")
      && designSystemDoc.includes("짧은 저장/삭제/복사/이동 결과")
      && designSystemDoc.includes("window.confirm")
      && designSystemDoc.includes("createConfirmController")
      && designSystemDoc.includes("Deferred Search")
      && designSystemDoc.includes("createDeferredSearchController")
      && designSystemDoc.includes("focus와 caret")
      && designSystemDoc.includes("renderIcon")
      && designSystemDoc.includes("Section Header")
      && designSystemDoc.includes("Badge")
      && designSystemDoc.includes("Segmented Control")
      && designSystemDoc.includes("design system toast"),
    "shared design system should own reusable hosted toast/icon/dialog primitives and usage guidance"
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
      && pageSource.includes("let exchangedLaunch = false")
      && pageSource.includes("if (exchangedLaunch)")
      && pageSource.includes('const ACTIVE_SECTION_QUERY_KEY = "section"')
      && pageSource.includes("readActiveSectionFromUrl")
      && pageSource.includes("writeActiveSectionToUrl")
      && pageSource.includes("url.searchParams.set(ACTIVE_SECTION_QUERY_KEY, section.id)")
      && pageSource.includes('typeof payload?.error === "string"')
      && pageSource.includes('url.searchParams.delete("launch")')
      && !pageSource.includes("refreshSession")
      && !pageSource.includes("setBadge"),
    "hosted admin page should exchange launch tokens, remove query secrets, skip redundant bootstrap after fresh exchange, and verify restored AdminSession"
  );
  assert(
    pageSource.includes("const ADMIN_SECTIONS = Object.freeze")
      && pageSource.includes('id: "notice"')
      && pageSource.includes("소식 팝업")
      && pageSource.includes("function setView")
      && pageSource.includes("createAccessWorkbench")
      && pageSource.includes("createAccessDetailPanel")
      && pageSource.includes("admin-access-filter inova-segmented")
      && pageSource.includes("inova-badge")
      && pageSource.includes("회원 목록")
      && pageSource.includes("listInovaAdminAccessUsers")
      && pageSource.includes("saveInovaAdminAccessUser")
      && pageSource.includes("ensureAccessUsersLoaded")
      && pageSource.includes("createAdminDeferredSearchController")
      && pageSource.includes("handleAccessCompositionStart")
      && pageSource.includes("handleAccessCompositionEnd")
      && pageSource.includes("handleAccessSearch")
      && pageSource.includes("readAccessSearchFocusState")
      && pageSource.includes("restoreAccessSearchFocus")
      && pageSource.includes("details.rawValue")
      && pageSource.includes("MAX_ACCESS_ORGANIZATION_LENGTH")
      && pageSource.includes("data-access-organization")
      && pageSource.includes("draftOrganizationById")
      && pageSource.includes("readAccessDraftOrganization")
      && pageSource.includes("writeAccessDraftOrganization")
      && pageSource.includes("canSaveAccessUser")
      && pageSource.includes("팀명 또는 본부명")
      && pageSource.includes("조직")
      && pageSource.includes("lastActivityAt")
      && pageSource.includes("readAccessLastActivityLabel")
      && pageSource.includes("admin-access-meta")
      && pageSource.includes("마지막 활동")
      && pageSource.includes("ADMIN_ACCESS_LAST_ACTIVITY_HELP_TEXT")
      && pageSource.includes("실험실 기능 사용량 집계의 최근 기록")
      && pageSource.includes("admin-help-chip")
      && css.includes(".admin-access-meta")
      && css.includes(".admin-access-meta__label")
      && css.includes(".admin-help-chip")
      && css.includes(".admin-access-field")
      && pageSource.includes("data-access-action=\"save\"")
      && pageSource.includes("data-access-role=\"active\"")
      && pageSource.includes("admin-access-permission__toggle inova-segmented")
      && pageSource.includes("일반 사용자")
      && pageSource.includes("저장 중")
      && !pageSource.includes("admin-access-fields")
      && !pageSource.includes("전체 회의 리스트")
      && !pageSource.includes("보기 가능")
      && !pageSource.includes("보기 불가")
      && !pageSource.includes("변경 기능")
      && !pageSource.includes("보유")
      && !pageSource.includes("준비 중")
      && !pageSource.includes("관리자 이메일")
      && !pageSource.includes("name@incross.com")
      && !pageSource.includes("관리자 권한 부여")
      && !pageSource.includes("admin-access-grant")
      && !pageSource.includes("createAccessPolicyPanel")
      && !pageSource.includes("권한 소스")
      && !pageSource.includes("세션 흐름")
      && !pageSource.includes("Provider Key")
      && !pageSource.includes("AdminSession 재검증")
      && !pageSource.includes("state.access.query = normalizeText(target.value)")
      && pageSource.includes("loadingPanel")
      && pageSource.includes("loadingIcon")
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
      && adminServiceSource.includes('const ACCOUNT_COLLECTION_V2 = "integration_inova_accounts_v2"')
      && adminServiceSource.includes('const FEATURE_USAGE_USER_MONTH_COLLECTION = "integration_inova_feature_usage_user_months"')
      && adminServiceSource.includes("MAX_ADMIN_ACCESS_ORGANIZATION_LENGTH")
      && adminServiceSource.includes('const PANEL_NOTICE_COLLECTION = "ops_panel_notices"')
      && adminServiceSource.includes('const PANEL_NOTICE_SIGNAL_COLLECTION = "ops_panel_notice_signals"')
      && adminServiceSource.includes('const PANEL_NOTICE_STATE_COLLECTION = "ops_panel_notice_state"')
      && adminServiceSource.includes("writePanelNoticeState")
      && adminServiceSource.includes("listAdminAccessUsers")
      && adminServiceSource.includes("saveAdminAccessUser")
      && adminServiceSource.includes("normalizeAdminAccessOrganization")
      && adminServiceSource.includes("readAdminAccessOrganizationSource")
      && adminServiceSource.includes("normalizeAdminAccessActivityAt")
      && adminServiceSource.includes("pickLaterAdminAccessActivityAt")
      && adminServiceSource.includes("createPanelNoticeSignalRevision")
      && adminServiceSource.includes("hashSecret")
      && adminServiceSource.includes("관리자 권한이 더 이상 유효하지 않아요."),
    "admin service should own server-side access checks, hashed token storage, and revocation checks"
  );
  assert(
    functionsIndexSource.includes('require("./features/admin/admin-service")')
      && functionsIndexSource.includes("exports.checkInovaAdminAccess")
      && functionsIndexSource.includes("exports.issueInovaAdminLaunch")
      && functionsIndexSource.includes("exports.exchangeInovaAdminLaunch")
      && functionsIndexSource.includes("exports.listInovaAdminAccessUsers")
      && functionsIndexSource.includes("exports.readInovaAdminBootstrap")
      && functionsIndexSource.includes("exports.readInovaPanelNotice")
      && functionsIndexSource.includes("exports.saveInovaAdminAccessUser")
      && functionsIndexSource.includes("exports.deleteInovaAdminPanelNotice")
      && functionsIndexSource.includes("exports.moveInovaAdminPanelNotice")
      && functionsIndexSource.includes("exports.saveInovaAdminPanelNotice")
      && functionsIndexSource.includes("exports.publishInovaAdminPanelNotice")
      && functionsIndexSource.includes("exports.archiveInovaAdminPanelNotice"),
    "functions/index.js should export the admin access, session, and panel notice endpoints"
  );
  assert(
    pageSource.includes("listInovaAdminPanelNotices")
      && pageSource.includes("saveInovaAdminPanelNotice")
      && pageSource.includes("deleteInovaAdminPanelNotice")
      && pageSource.includes("moveInovaAdminPanelNotice")
      && pageSource.includes("renderAdminNoticeMarkdownPreview")
      && pageSource.includes("readNoticeDisplayState")
      && pageSource.includes("createNoticePreviewPanel")
      && pageSource.includes("inova-section-head")
      && pageSource.includes("inova-section-head__title")
      && pageSource.includes("소식 작성")
      && pageSource.includes("미리보기")
      && pageSource.includes("data-notice-preview-title")
      && !pageSource.includes("admin-notice-preview__head")
      && !pageSource.includes(">Preview<")
      && pageSource.includes("validateNoticeForm")
      && pageSource.includes("normalizeCtaUrlInput")
      && pageSource.includes("data-notice-feedback-for=\"cta.url\"")
      && pageSource.includes("data-notice-field=\"startsAt\"")
      && pageSource.includes("data-notice-field=\"endsAt\"")
      && pageSource.includes('type="text" inputmode="numeric" maxlength="16" placeholder="YYYY-MM-DD 00:00"')
      && !pageSource.includes('type="datetime-local"')
      && pageSource.includes("data-notice-action=\"shift-start-date\"")
      && pageSource.includes("data-notice-action=\"shift-end-date\"")
      && pageSource.includes("function shiftNoticeDate")
      && pageSource.includes("function createDefaultNoticeWindow")
      && pageSource.includes("setHours(23, 59, 0, 0)")
      && pageSource.includes('normalizedField === "endsAt"')
      && pageSource.includes("function parseDatetimeInputToDate")
      && pageSource.includes("function padDatePart")
      && pageSource.includes("setHours(0, 0, 0, 0)")
      && pageSource.includes('createButton.dataset.noticeAction = "new"')
      && pageSource.includes("data-notice-action=\"delete\"")
      && pageSource.includes("data-notice-action=\"move-up\"")
      && pageSource.includes("data-notice-action=\"move-down\"")
      && pageSource.includes("data-notice-action=\"save\"")
      && pageSource.includes("createAdminConfirmController")
      && pageSource.includes("confirmAdminAction")
      && pageSource.includes("createAdminToastController")
      && pageSource.includes("showAdminToast")
      && pageSource.includes("InovaDesignSystem")
      && pageSource.includes("renderAdminIcon(\"admin\"")
      && html.includes("inova-status-state")
      && html.includes("inova-status-state__icon")
      && designSystemCss.includes(".inova-status-state")
      && designSystemCss.includes("white-space: nowrap")
      && !pageSource.includes("function publishPanelNoticeChange")
      && !pageSource.includes("BroadcastChannel")
      && !pageSource.includes("inova-panel-notice-signal")
      && !pageSource.includes("panel-notice.changed")
      && pageSource.includes("is-selected")
      && pageSource.includes('item.setAttribute("aria-current", isSelected ? "true" : "false")')
      && !pageSource.includes("admin-notice-feedback")
      && !pageSource.includes("global.confirm")
      && !pageSource.includes("togglePanelNoticeVisibility")
      && !pageSource.includes("data-notice-action=\"toggle-visibility\"")
      && !pageSource.includes("예약 노출 옵션")
      && !pageSource.includes("현재 노출 중"),
    "hosted admin page should expose a simple period-based panel notice editor without manual visibility toggles"
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
