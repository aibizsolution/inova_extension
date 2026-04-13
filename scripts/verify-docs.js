#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(root, "contracts", "extension-contract.json"), "utf8")
);
const requiredFiles = [
  "manifest.json",
  "README.md",
  path.join(".githooks", "pre-push"),
  path.join("scripts", "verify-refactor-plan-update.js"),
  path.join("docs", "feature-spec.md"),
  path.join("docs", "feature-routing.md"),
  path.join("docs", "lint-workflow.md"),
  "popup/index.html",
  "popup/index.js",
  path.join("content", "features", "conversation", "AGENTS.md"),
  path.join("content", "features", "prompt-library", "AGENTS.md"),
  path.join("content", "features", "prompt-store", "AGENTS.md"),
  path.join("content", "features", "prompt-review", "AGENTS.md"),
  path.join("content", "features", "meeting", "AGENTS.md"),
  path.join("content", "features", "release", "AGENTS.md"),
  path.join("hosting", "meeting", "index.html"),
  path.join("hosting", "meeting", "index.js"),
  path.join("hosting", "meeting", "workspace-session.js"),
  path.join("hosting", "meeting", "workspace-realtime.js"),
  path.join("hosting", "meeting", "workspace-capture.js"),
  path.join("hosting", "meeting", "workspace-pending-uploads.js"),
  path.join("hosting", "meeting", "workspace-mutations.js"),
  path.join("hosting", "meeting", "workspace-debug.js"),
  path.join("hosting", "meeting", "shared.js"),
  path.join("background", "panel-runtime-invoke.js"),
  path.join("hosting", "extension", "panel", "index.html"),
  path.join("hosting", "extension", "panel", "index.css"),
  path.join("hosting", "extension", "panel", "index.js"),
  path.join("hosting", "extension", "panel", "runtime.js"),
  path.join("hosting", "extension", "panel", "prompt-hub-panel.js"),
  path.join("scripts", "install-git-hooks.js"),
  "shared/prompt-library.js",
  path.join("scripts", "verify-feature-doc-update.js"),
  path.join("scripts", "verify-hosted-panel-bridge.js"),
  path.join("scripts", "verify-panel-bookmark-controller.js"),
  path.join("scripts", "verify-panel-prompt-controller.js"),
  path.join("scripts", "verify-panel-shell-controller.js"),
  path.join("scripts", "verify-panel-activity-controller.js"),
  path.join("scripts", "verify-panel-surface-controller.js"),
  path.join("scripts", "verify-panel-render-controller.js"),
  path.join("scripts", "verify-panel-bootstrap-controller.js"),
  path.join("scripts", "verify-panel-state-factory.js"),
  path.join("scripts", "verify-panel-runtime-controller.js"),
  path.join("scripts", "verify-panel-action-controller.js"),
  path.join("scripts", "verify-panel-prompt-bridge-controller.js"),
  path.join("scripts", "verify-prompt-library-remote-first.js"),
  path.join("scripts", "verify-prompt-runtime-local.js"),
  path.join("scripts", "verify-prompt-review.js"),
  path.join("scripts", "verify-route-state-controller.js"),
  path.join("scripts", "verify-route-watch-controller.js"),
  "content/main.js",
  "content/hosted-panel-bridge.js",
  "content/panel-activity-controller.js",
  "content/panel-bookmark-controller.js",
  "content/panel-shell-controller.js",
  "content/panel-prompt-controller.js",
  "content/panel-surface-controller.js",
  "content/panel-render-controller.js",
  "content/panel-bootstrap-controller.js",
  "content/panel-state-factory.js",
  "content/panel-runtime-controller.js",
  "content/panel-action-controller.js",
  "content/panel-prompt-bridge-controller.js",
  "content/panel-composition-controller.js",
  "content/route-state-controller.js",
  "content/route-watch-controller.js",
  "content/prompt-hub-state.js",
  "content/prompt-hub-panel.js",
  "content/prompt-hub-controller.js",
  "content/prompt-hub-runtime.js",
  "content/features/prompt-library/files.js",
  "content/features/prompt-library/prompt-manager.js",
  "content/panel.css",
  "content/tools.css",
];

const keywordGroups = [
  {
    name: "팝업 작업실 연결 설정",
    patterns: [/팝업\s*작업실\s*연결\s*설정/i, /상용\s*호스팅/i, /로컬\s*호스팅/i],
  },
  {
    name: "질문 자동 모으기",
    patterns: [/질문\s*자동\s*모으기/, /질문\s*모아보기/, /현재\s*대화/],
  },
  {
    name: "우측 슬라이드 패널",
    patterns: [/우측\s*슬라이드\s*패널/, /슬라이드\s*패널/, /오른쪽\s*슬라이드/],
  },
  {
    name: "대화 안에서 찾기",
    patterns: [/대화\s*안에서\s*찾기/, /이\s*대화에서\s*질문\s*찾기/, /검색\s*패널/],
  },
  {
    name: "자주 쓰는 요청",
    patterns: [/자주\s*쓰는\s*요청/, /요청\s*보관함/, /입력창에\s*바로\s*넣/],
  },
  {
    name: "요청 가져오기/내보내기",
    patterns: [/가져오기/, /내보내기/, /완전\s*교체|병합|추가/],
  },
  {
    name: "모듈 구조",
    patterns: [/shared/i, /meetingWorkspaceTarget/, /settings/],
  },
];

const readmeOnlyKeywordGroups = [
  {
    name: "Feature 문서 가드",
    patterns: [/pre-push/i, /feature\s+`AGENTS\.md`/i, /hooks:install|verify:feature-doc-guard/],
  },
  {
    name: "Lint 가이드 링크",
    patterns: [/docs\/lint-workflow\.md/i, /lint-workflow/i],
  },
  {
    name: "Lint 명령",
    patterns: [/npm run lint/i, /lint를 포함/i],
  },
];

const featureDocContracts = [
  {
    feature: "conversation",
    doc: path.join("content", "features", "conversation", "AGENTS.md"),
    expectedFiles: [
      "content/dom.js",
      "content/bookmark-view.js",
      "content/route-sync.js",
      "content/route-state-controller.js",
      "content/route-watch-controller.js",
      "content/panel-bookmark-controller.js",
      "content/panel-surface-controller.js",
      "content/panel-activity-controller.js",
      "content/panel-shell-controller.js",
    ],
  },
  {
    feature: "prompt-library",
    doc: path.join("content", "features", "prompt-library", "AGENTS.md"),
    expectedFiles: [
      "content/features/prompt-library/prompt-manager.js",
      "content/features/prompt-library/prompt-view.js",
      "content/features/prompt-library/files.js",
      "shared/prompt-library.js",
    ],
  },
  {
    feature: "prompt-store",
    doc: path.join("content", "features", "prompt-store", "AGENTS.md"),
    expectedFiles: [
      "content/features/prompt-store/store-manager.js",
      "content/features/prompt-store/store-view.js",
      "content/features/prompt-store/prompt-realtime-manager.js",
      "shared/prompt-store.js",
    ],
  },
  {
    feature: "prompt-review",
    doc: path.join("content", "features", "prompt-review", "AGENTS.md"),
    expectedFiles: [
      "content/features/prompt-review/prompt-review-manager.js",
      "content/features/prompt-review/prompt-review-view.js",
      "content/features/prompt-review/composer-review-float.js",
    ],
  },
  {
    feature: "meeting",
    doc: path.join("content", "features", "meeting", "AGENTS.md"),
    expectedFiles: [
      "content/meeting-manager.js",
      "content/meeting-view.js",
      "hosting/meeting/index.js",
      "popup/index.js",
    ],
  },
  {
    feature: "release",
    doc: path.join("content", "features", "release", "AGENTS.md"),
    expectedFiles: [
      "content/release-manager.js",
      "content/release-view.js",
      "shared/release-info.js",
    ],
  },
];

const codeChecks = [
  {
    file: path.join(".githooks", "pre-commit"),
    patterns: [/verify-refactor-plan-update\.js/, /verify-feature-doc-update\.js/, /verify-release-metadata\.js/],
  },
  {
    file: path.join(".githooks", "pre-push"),
    patterns: [/verify-refactor-plan-update\.js/, /verify-feature-doc-update\.js/, /verify-release-metadata\.js/],
  },
  {
    file: "manifest.json",
    patterns: [
      /"default_popup"\s*:\s*"popup\/index\.html"/,
      /"shared\/constants\.js"/,
      /"content\/hosted-panel-bridge\.js"/,
      /"content\/main\.js"/,
      /"content\/panel\.css"/,
      /"content\/tools\.css"/,
      /"matches"\s*:\s*\[\s*"https:\/\/inova\.incross\.com\/\*"\s*\]/s,
    ],
  },
  {
    file: "popup/index.js",
    patterns: [/meetingWorkspaceTarget/, /meetingWorkspaceUrlOverride/, /updateSettings/, /workspaceTargetHint/],
  },
  {
    file: "content/main.js",
    patterns: [
      /panelStateFactory/,
      /panelCompositionController/,
      /panelCompositionController\??\.bootstrap/,
    ],
  },
  {
    file: "hosting/meeting/index.js",
    patterns: [
      /createPendingUploadStore/,
      /createControllers/,
      /workspaceCapture|workspacePendingUploads|workspaceSession|workspaceRealtime|workspaceMutations|workspaceDebug/,
    ],
  },
  {
    file: "hosting/meeting/workspace-session.js",
    patterns: [/bootSession/, /persistSession/, /replaceCleanUrl/],
  },
  {
    file: "hosting/meeting/workspace-realtime.js",
    patterns: [/refreshWorkspace/, /handleBackgroundRefresh/, /disposeRealtime/],
  },
  {
    file: "hosting/meeting/workspace-capture.js",
    patterns: [/getUserMedia/, /MediaRecorder/, /startCapture/, /stopCapture/],
  },
  {
    file: "hosting/meeting/workspace-pending-uploads.js",
    patterns: [/createOrUpdatePendingUpload/, /retryPendingUploads/, /syncPendingUploadsWithRemote/],
  },
  {
    file: "hosting/meeting/workspace-mutations.js",
    patterns: [/saveMeetingTitle/, /saveMeetingTermReplacements/, /saveRecordTitleForEntry/, /renderMeetingNotesTools/],
  },
  {
    file: "hosting/meeting/workspace-debug.js",
    patterns: [/setup/, /handlePanelClick/, /exposeDebugApi/],
  },
  {
    file: "content/route-sync.js",
    patterns: [
      /scheduleRouteSync/,
      /scheduleRefresh/,
      /syncRouteState/,
    ],
  },
  {
    file: "content/route-state-controller.js",
    patterns: [
      /collectUserMessages/,
      /refreshState/,
      /handleStorageChange/,
    ],
  },
  {
    file: "content/route-watch-controller.js",
    patterns: [
      /installRouteWatchers/,
      /wrapHistoryMethod/,
      /startRoutePolling/,
    ],
  },
  {
    file: "content/panel-bootstrap-controller.js",
    patterns: [
      /ensurePanel/,
      /syncRouteState/,
      /chrome\??\.storage/,
    ],
  },
  {
    file: "content/hosted-panel-bridge.js",
    patterns: [
      /bridgeVersion/,
      /panel\.snapshot\.v1/,
      /type:\s*"response"/,
    ],
  },
  {
    file: "content/panel.js",
    patterns: [
      /inova-hosted-panel-frame/,
      /panelAppUrl/,
      /panelHostedBridgeRequest\?\.handle\?\./,
    ],
  },
  {
    file: "shared/firebase-config.js",
    patterns: [
      /panelAppUrl/,
      /joinUrl\(baseUrl,\s*"panel\/index\.html"\)/,
    ],
  },
  {
    file: path.join("hosting", "extension", "panel", "index.js"),
    patterns: [
      /inova-hosted-panel-app/,
      /확장 업데이트 필요/,
      /function\s+renderToolContent/,
    ],
  },
  {
    file: path.join("hosting", "extension", "panel", "runtime.js"),
    patterns: [
      /clipPreview/,
      /panelDebug/,
    ],
  },
  {
    file: "content/panel-state-factory.js",
    patterns: [
      /createState/,
      /mergeCloudSyncState/,
      /mergeUiPreferences/,
      /readCollapsedPreference/,
    ],
  },
  {
    file: "content/panel-runtime-controller.js",
    patterns: [
      /isPaused/,
      /isStoreTabActive/,
      /isExtensionContextInvalidatedError/,
      /logPanelDebug/,
    ],
  },
  {
    file: "content/panel-action-controller.js",
    patterns: [
      /handlePanelMeetingAction/,
      /handlesAction/,
      /handleAction/,
    ],
  },
  {
    file: "content/panel-prompt-bridge-controller.js",
    patterns: [
      /ensureStoreLoaded/,
      /schedulePromptCloudSyncIfNeeded/,
      /schedulePromptRealtimeSync/,
      /handleStorageChange/,
    ],
  },
  {
    file: "content/panel-composition-controller.js",
    patterns: [
      /panelRuntimeController/,
      /panelPromptBridgeController/,
      /panelRenderController/,
      /panelBootstrapController/,
    ],
  },
  {
    file: "content/panel-render-controller.js",
    patterns: [
      /buildHandleCount/,
      /renderPanel/,
      /buildReviewFloatState/,
    ],
  },
  {
    file: "content/panel-activity-controller.js",
    patterns: [
      /handleVisibilityChange/,
      /handleWindowFocus/,
      /visibilityState/,
    ],
  },
  {
    file: "content/panel-surface-controller.js",
    patterns: [
      /installSurfaceWatchers/,
      /getConversationState/,
      /surfacePollTimer/,
    ],
  },
  {
    file: "content/dom.js",
    patterns: [
      /MutationObserver/,
      /data-inova-bookmark-id/,
    ],
  },
  {
    file: "shared/constants.js",
    patterns: [
      /\.chat-message--user/,
      /pausedSessions/,
    ],
  },
  {
    file: "shared/session.js",
    patterns: [
      /searchParams\.get\("sid"\)/,
      /buildMessageId/,
    ],
  },
  {
    file: "shared/storage.js",
    patterns: [
      /chrome\.storage\.local/,
      /pausedSessions/,
      /promptLibrary/,
      /updateSettings/,
    ],
  },
  {
    file: "background/service-worker.js",
    patterns: [
      /inova-panel:invoke/,
      /panel-runtime-invoke\.js/,
      /invokeHostedPanelRequest/,
    ],
  },
  {
    file: path.join("background", "panel-runtime-invoke.js"),
    patterns: [
      /PANEL_ALLOWED_STORAGE_KEYS/,
      /PANEL_ALLOWED_FUNCTION_ENDPOINT_KEYS/,
      /invokeHostedPanelRequest/,
    ],
  },
  {
    file: "shared/prompt-library.js",
    patterns: [
      /parseImportText/,
      /buildExportPayload/,
      /applyImport/,
    ],
  },
  {
    file: "content/features/prompt-library/prompt-manager.js",
    patterns: [
      /handleImportFile/,
      /applyPromptText/,
      /downloadJson/,
    ],
  },
];

function main() {
  const errors = [];

  for (const file of requiredFiles) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`필수 파일이 없습니다: ${file}`);
    }
  }

  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath, errors);
  if (manifest) {
    const popupOk = manifest.action && manifest.action.default_popup === contract.manifestPopup;
    const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    const hasContentScript = contentScripts.some((entry) => {
      const js = Array.isArray(entry.js) ? entry.js : [];
      const css = Array.isArray(entry.css) ? entry.css : [];
      const matches = Array.isArray(entry.matches) ? entry.matches : [];
      return (
        contract.manifestContentScripts.every((file) => js.includes(file)) &&
        contract.manifestContentCss.every((file) => css.includes(file)) &&
        matches.includes("https://inova.incross.com/*")
      );
    });

    if (!popupOk) {
      errors.push(`manifest.json에 default_popup = ${contract.manifestPopup} 이 없습니다.`);
    }
    if (!hasContentScript) {
      errors.push("manifest.json에 inova.incross.com용 content script 선언이 없습니다.");
    }
  }

  for (const file of ["README.md", path.join("docs", "feature-spec.md")]) {
    const text = readText(path.join(root, file), errors);
    if (!text) continue;
    for (const group of keywordGroups) {
      if (!group.patterns.some((pattern) => pattern.test(text))) {
        errors.push(`${file}에 핵심 기능 키워드가 부족합니다: ${group.name}`);
      }
    }
  }

  const readmeText = readText(path.join(root, "README.md"), errors);
  if (readmeText) {
    for (const group of readmeOnlyKeywordGroups) {
      if (!group.patterns.some((pattern) => pattern.test(readmeText))) {
        errors.push(`README.md에 핵심 운영 키워드가 부족합니다: ${group.name}`);
      }
    }
  }

  for (const check of codeChecks) {
    const text = readText(path.join(root, check.file), errors);
    if (!text) continue;
    for (const pattern of check.patterns) {
      if (!pattern.test(text)) {
        errors.push(`${check.file}에 필요한 구현 단서가 없습니다: ${pattern}`);
      }
    }
  }

  validateFeatureDocs(errors);

  for (const keyword of contract.requiredDocKeywords) {
    const spec = readText(path.join(root, "docs", "feature-spec.md"), errors);
    if (!readmeText.includes(keyword) && !spec.includes(keyword)) {
      errors.push(`문서에 계약 키워드가 없습니다: ${keyword}`);
    }
  }

  if (errors.length > 0) {
    console.error("문서/코드 검증 실패");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("문서/코드 검증 통과");
}

function readText(filePath, errors) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    errors.push(`파일을 읽을 수 없습니다: ${path.relative(root, filePath)} (${error.message})`);
    return "";
  }
}

function readJson(filePath, errors) {
  const text = readText(filePath, errors);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`JSON 파싱 실패: ${path.relative(root, filePath)} (${error.message})`);
    return null;
  }
}

function validateFeatureDocs(errors) {
  const routingDocPath = path.join(root, "docs", "feature-routing.md");
  const routingText = readText(routingDocPath, errors);

  for (const feature of featureDocContracts) {
    const featureDocPath = path.join(root, feature.doc);
    const featureDocText = readText(featureDocPath, errors);

    for (const file of feature.expectedFiles) {
      const fullPath = path.join(root, file);
      if (!fs.existsSync(fullPath)) {
        errors.push(`${feature.feature} feature 문서가 가리키는 파일이 없습니다: ${file}`);
        continue;
      }

      if (!featureDocText.includes(file)) {
        errors.push(`${feature.doc}에 feature 핵심 파일이 빠졌습니다: ${file}`);
      }

      if (routingText && !routingText.includes(file)) {
        errors.push(`docs/feature-routing.md에 feature 시작 파일이 빠졌습니다: ${feature.feature} / ${file}`);
      }
    }
  }
}

main();
