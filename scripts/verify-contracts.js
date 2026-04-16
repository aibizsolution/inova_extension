#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(root, "contracts", "extension-contract.json"), "utf8")
);

const errors = [];
const oversizedFiles = [];

for (const file of contract.requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`필수 파일이 없습니다: ${file}`);
  }
}

const manifestPath = path.join(root, "manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.action?.default_popup !== contract.manifestPopup) {
    errors.push(`manifest popup 경로가 계약과 다릅니다: ${manifest.action?.default_popup}`);
  }
  for (const [size, iconPath] of Object.entries(contract.manifestIcons || {})) {
    if (manifest.icons?.[size] !== iconPath) {
      errors.push(`manifest icon 경로가 계약과 다릅니다 (${size}): ${manifest.icons?.[size] || ""}`);
    }
  }
  for (const [size, iconPath] of Object.entries(contract.manifestActionIcons || {})) {
    if (manifest.action?.default_icon?.[size] !== iconPath) {
      errors.push(`manifest action icon 경로가 계약과 다릅니다 (${size}): ${manifest.action?.default_icon?.[size] || ""}`);
    }
  }

  const mainContentScript = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.find((entry) => Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*"))
    : null;
  const meetingWorkspaceScript = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.find((entry) => Array.isArray(entry?.js) && entry.js.includes("content/meeting-workspace-bridge.js"))
    : null;
  const jsFiles = mainContentScript?.js || [];
  const cssFiles = mainContentScript?.css || [];

  for (const file of contract.manifestContentScripts) {
    if (!jsFiles.includes(file)) {
      errors.push(`manifest content script 누락: ${file}`);
    }
  }
  assertOrder(jsFiles, [
    "shared/constants.js",
    "shared/firestore-collections.js",
    "shared/product-lane.js",
    "shared/firebase-config.js",
  ], "manifest content script shared config load order");

  for (const file of contract.manifestContentCss) {
    if (!cssFiles.includes(file)) {
      errors.push(`manifest content css 누락: ${file}`);
    }
  }

  for (const file of contract.manifestMeetingWorkspaceScripts || []) {
    if (!(meetingWorkspaceScript?.js || []).includes(file)) {
      errors.push(`manifest meeting workspace content script 누락: ${file}`);
    }
  }

  const webAccessibleEntries = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  const webAccessibleResources = webAccessibleEntries.flatMap((entry) => Array.isArray(entry?.resources) ? entry.resources : []);
  for (const file of contract.webAccessibleResources || []) {
    if (!webAccessibleResources.includes(file)) {
      errors.push(`manifest web accessible resource 누락: ${file}`);
    }
  }
  const webAccessibleMatches = webAccessibleEntries.flatMap((entry) => Array.isArray(entry?.matches) ? entry.matches : []);
  for (const match of contract.webAccessibleMatches || []) {
    if (!webAccessibleMatches.includes(match)) {
      errors.push(`manifest web accessible match 누락: ${match}`);
    }
  }

  for (const match of contract.manifestMeetingWorkspaceMatches || []) {
    if (!(meetingWorkspaceScript?.matches || []).includes(match)) {
      errors.push(`manifest meeting workspace match 누락: ${match}`);
    }
  }

  for (const permission of contract.requiredPermissions || []) {
    if (!(manifest.permissions || []).includes(permission)) {
      errors.push(`manifest permission 누락: ${permission}`);
    }
  }
  for (const permission of manifest.permissions || []) {
    if (!(contract.requiredPermissions || []).includes(permission)) {
      errors.push(`manifest permission이 계약 밖으로 넓어졌습니다: ${permission}`);
    }
  }
  for (const permission of contract.requiredHostPermissions || []) {
    if (!(manifest.host_permissions || []).includes(permission)) {
      errors.push(`manifest host permission 누락: ${permission}`);
    }
  }
  for (const permission of manifest.host_permissions || []) {
    if (!(contract.requiredHostPermissions || []).includes(permission)) {
      errors.push(`manifest host permission이 계약 밖으로 넓어졌습니다: ${permission}`);
    }
  }
  verifyExtensionPageFrameSrc(manifest);
}

const popupPath = path.join(root, "popup", "index.html");
if (fs.existsSync(popupPath)) {
  const popupHtml = fs.readFileSync(popupPath, "utf8");
  for (const file of contract.popupScripts || []) {
    if (!popupHtml.includes(file)) {
      errors.push(`popup script 누락: ${file}`);
    }
  }
  assertOrder(extractScriptSources(popupHtml), [
    "../shared/constants.js",
    "../shared/firestore-collections.js",
    "../shared/product-lane.js",
    "../shared/firebase-config.js",
  ], "popup shared config load order");
}

for (const file of listSourceFiles(root)) {
  const lineCount = countLines(path.join(root, file));
  if (lineCount > contract.maxLinesPerSourceFile) {
    errors.push(`파일이 너무 큽니다 (${lineCount} lines): ${file}`);
    oversizedFiles.push(file);
  }
}

const sharedStoragePath = path.join(root, "shared", "storage.js");
const sharedConstantsPath = path.join(root, "shared", "constants.js");
if (fs.existsSync(sharedStoragePath) || fs.existsSync(sharedConstantsPath)) {
  const sharedStorage = fs.existsSync(sharedStoragePath)
    ? fs.readFileSync(sharedStoragePath, "utf8")
    : "";
  const sharedConstants = fs.existsSync(sharedConstantsPath)
    ? fs.readFileSync(sharedConstantsPath, "utf8")
    : "";
  for (const key of contract.requiredStorageKeys) {
    if (!sharedStorage.includes(key) && !sharedConstants.includes(key)) {
      errors.push(`storage 계약 키가 없습니다: ${key}`);
    }
  }
}

const contentDirectory = path.join(root, "content");
const sharedDirectory = path.join(root, "shared");
if (countJavaScriptFiles(contentDirectory) < 3) {
  errors.push("content 모듈 수가 부족합니다. 최소 3개 파일로 분리해야 합니다.");
}
if (countJavaScriptFiles(sharedDirectory) < 3) {
  errors.push("shared 모듈 수가 부족합니다. 최소 3개 파일로 분리해야 합니다.");
}
verifyActiveSharedRootCatalog();
verifyActiveBackgroundRootCatalog();
verifyActiveContentRootCatalog();
verifyActivePopupRootCatalog();
verifyHostedCapabilityCatalog();
verifySandboxBridgeApiCatalog();
verifyBackgroundMessageCatalog();

assertFileExists("scripts/legacy-panel/verify-prompt-fallbacks.js");
assertFileExists("scripts/verify-functions-runtime.js");
assertFileExists("scripts/verify-hosted-panel-bridge.js");
assertFileExists("scripts/verify-prompt-library-remote-first.js");
assertFileExists("scripts/verify-prompt-review.js");
assertFileExists("scripts/verify-prompt-runtime-local.js");
assertFileExists("eslint.config.js");
assertNoPattern("backup/legacy-panel/prompt-hub-runtime.js", /onPromptLibraryFallback:\s*\(\)\s*=>\s*\{\s*\}/, "prompt library fallback가 no-op이면 안 됩니다.");
assertNoPattern("backup/legacy-panel/meeting-manager.js", /source:\s*"fallback"/, "meeting hub는 fallback success처럼 source를 표기하면 안 됩니다.");
assertNoPattern("backup/legacy-panel/features/prompt-store/store-manager.js", /source:\s*"fallback"/, "store manager는 fallback success처럼 source를 표기하면 안 됩니다.");
assertNoPattern("functions/features/meeting/meeting-service.js", /revisionRequest/, "meeting notes API에 legacy revisionRequest alias가 남아 있으면 안 됩니다.");
assertNoBareCatch("background/service-worker.js");
assertNoBareCatch("content/main.js");
assertNoBareCatch("backup/legacy-panel/meeting-manager.js");
assertNoBareCatch("backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js");
assertNoBareCatch("shared/storage.js");
assertInlineOnlyGating("functions/features/meeting/meeting-service.js");
assertPattern("functions/features/prompt-store/store-service.js", /categoryLabels:/, "prompt store summary는 category label map을 함께 저장해야 합니다.");
assertPattern("functions/features/prompt-store/store-service.js", /function normalizePublishCategory\s*\(/, "prompt store publish는 custom category normalization helper를 가져야 합니다.");

if (errors.length) {
  console.error("구조 계약 검증 실패");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  if (oversizedFiles.length) {
    console.error("- 구조/길이 가드는 회피 대상이 아닙니다. 이 메시지는 해당 파일에 책임을 더 싣지 말고 경계를 다시 나누라는 뜻입니다.");
    console.error("- 가드를 피하려고 관련 없는 파일에 state, 분기, 우회 render, 진단 helper를 옮겨 싣지 말고, 새 책임을 가진 모듈로 분리하세요.");
  }
  process.exit(1);
}

console.log("구조 계약 검증 통과");

function listSourceFiles(baseDir) {
  const queue = ["background", "content", "shared", "popup", "scripts"];
  const output = [];

  while (queue.length) {
    const relative = queue.shift();
    const fullPath = path.join(baseDir, relative);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(fullPath)) {
        queue.push(path.join(relative, entry));
      }
      continue;
    }

    if (/\.(js|css|html)$/.test(relative)) {
      output.push(relative);
    }
  }

  return output;
}

function countLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).length;
}

function countJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .length;
}

function assertFileExists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    errors.push(`필수 검증 스크립트가 없습니다: ${relativePath}`);
  }
}

function assertNoPattern(relativePath, pattern, message) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }
  const source = fs.readFileSync(fullPath, "utf8");
  if (pattern.test(source)) {
    errors.push(`${message} (${relativePath})`);
  }
}

function assertNoBareCatch(relativePath) {
  assertNoPattern(relativePath, /catch\s*\{\s*\}/, "bare catch가 남아 있으면 안 됩니다.");
}

function assertPattern(relativePath, pattern, message) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }
  const source = fs.readFileSync(fullPath, "utf8");
  if (!pattern.test(source)) {
    errors.push(`${message} (${relativePath})`);
  }
}

function assertOrder(items, orderedSubset, label) {
  let previousIndex = -1;
  for (const item of orderedSubset) {
    const index = items.indexOf(item);
    if (index < 0) {
      errors.push(`${label} 항목 누락: ${item}`);
      continue;
    }
    if (index <= previousIndex) {
      errors.push(`${label} 순서 오류: ${orderedSubset.join(" -> ")}`);
      return;
    }
    previousIndex = index;
  }
}

function extractScriptSources(html) {
  return Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)).map((match) => match[1]);
}

function assertInlineOnlyGating(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }
  const source = fs.readFileSync(fullPath, "utf8");
  if (!/function\s+shouldAllowInlineOnlyMeetingSource\s*\(/.test(source)) {
    errors.push(`meeting inline-only gating helper가 없습니다: ${relativePath}`);
  }
  if (!source.includes("if (!options.allowInlineOnly)")) {
    errors.push(`meeting inline-only가 local/dev/test로 좁혀지지 않았습니다: ${relativePath}`);
  }
}

function verifyHostedCapabilityCatalog() {
  const pageCapabilityActions = new Set(contract.pageCapabilityActions || []);
  const runtimeCapabilityActions = new Set(contract.runtimeCapabilityActions || []);
  if (!pageCapabilityActions.size) {
    errors.push("page capability catalog가 비어 있습니다.");
  }
  if (!runtimeCapabilityActions.size) {
    errors.push("runtime capability catalog가 비어 있습니다.");
  }
  verifyPageCapabilityRouterManifest(pageCapabilityActions);
  verifyHostedPageCapabilityClientAllowlist(pageCapabilityActions);

  const hostedPanelDir = path.join(root, "hosting", "extension-v2", "panel");
  if (!fs.existsSync(hostedPanelDir)) {
    errors.push("v2 hosted panel 디렉터리를 찾지 못했습니다.");
    return;
  }

  for (const entry of fs.readdirSync(hostedPanelDir)) {
    if (!entry.endsWith(".js")) {
      continue;
    }
    const relativePath = path.join("hosting", "extension-v2", "panel", entry);
    const source = fs.readFileSync(path.join(hostedPanelDir, entry), "utf8");
    verifyCapabilityCallsInSource(source, relativePath, "invokePage", pageCapabilityActions, "page");
    verifyCapabilityCallsInSource(source, relativePath, "invokeRuntime", runtimeCapabilityActions, "runtime");
    verifyCapabilityTransportIsolation(source, relativePath, entry);
  }
}

function verifyHostedPageCapabilityClientAllowlist(pageCapabilityActions) {
  const clientPath = path.join(root, "hosting", "extension-v2", "panel", "extension-capability-client.js");
  const clientSource = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, "utf8") : "";
  const allowlistMatch = clientSource.match(/const PAGE_CAPABILITY_IDS = Object\.freeze\(\[(?<body>[\s\S]*?)\n\s{2}\]\);/);
  if (!allowlistMatch?.groups?.body) {
    errors.push("extension-capability-client.js가 PAGE_CAPABILITY_IDS allowlist를 선언하지 않습니다.");
    return;
  }
  const allowlistIds = new Set(
    Array.from(allowlistMatch.groups.body.matchAll(/^\s+"([^"]+)",?$/gm), (match) => match[1]).filter(Boolean)
  );
  compareCapabilitySet(pageCapabilityActions, allowlistIds, "hosted page capability client allowlist");
}

function verifySandboxBridgeApiCatalog() {
  const sandboxBridgeApis = new Set(contract.sandboxBridgeApis || []);
  if (!sandboxBridgeApis.size) {
    errors.push("sandbox bridge API catalog가 비어 있습니다.");
    return;
  }

  const routerPath = path.join(root, "background", "panel-runtime-capability-router.js");
  const routerSource = fs.existsSync(routerPath) ? fs.readFileSync(routerPath, "utf8") : "";
  const allowlistMatch = routerSource.match(/const SANDBOX_BRIDGE_API_ALLOWLIST = Object\.freeze\(\[(?<body>[\s\S]*?)\n\]\);/);
  if (!allowlistMatch?.groups?.body) {
    errors.push("background/panel-runtime-capability-router.js가 SANDBOX_BRIDGE_API_ALLOWLIST를 선언하지 않습니다.");
    return;
  }

  const actualApis = new Set(
    Array.from(allowlistMatch.groups.body.matchAll(/^\s+"([^"]+)",?$/gm), (match) => match[1]).filter(Boolean)
  );
  compareCapabilitySet(sandboxBridgeApis, actualApis, "sandbox bridge API allowlist");
  [
    "chrome",
    "eval",
    "fetch",
    "localStorage",
    "querySelector",
    "selector",
    "sessionStorage",
    "storage",
  ].forEach((forbiddenApi) => {
    if (actualApis.has(forbiddenApi)) {
      errors.push(`sandbox bridge API allowlist가 금지 API를 노출합니다: ${forbiddenApi}`);
    }
  });
}

function verifyPageCapabilityRouterManifest(pageCapabilityActions) {
  const routerPath = path.join(root, "content", "page-capability-router.js");
  const routerSource = fs.existsSync(routerPath) ? fs.readFileSync(routerPath, "utf8") : "";
  const manifestMatch = routerSource.match(/const PAGE_CAPABILITY_MANIFEST = deepFreeze\(\{(?<body>[\s\S]*?)\n\s{2}\}\);/);
  if (!manifestMatch?.groups?.body) {
    errors.push("content/page-capability-router.js가 PAGE_CAPABILITY_MANIFEST를 선언하지 않습니다.");
    return;
  }
  const manifestIds = new Set(
    Array.from(manifestMatch.groups.body.matchAll(/^\s+"([^"]+)":\s*\{/gm), (match) => match[1]).filter(Boolean)
  );
  compareCapabilitySet(pageCapabilityActions, manifestIds, "page capability router manifest");
}

function compareCapabilitySet(expectedIds, actualIds, label) {
  for (const capabilityId of expectedIds) {
    if (!actualIds.has(capabilityId)) {
      errors.push(`${label} 누락: ${capabilityId}`);
    }
  }
  for (const capabilityId of actualIds) {
    if (!expectedIds.has(capabilityId)) {
      errors.push(`${label}가 계약 밖으로 넓어졌습니다: ${capabilityId}`);
    }
  }
}

function verifyActiveSharedRootCatalog() {
  const activeSharedRootFiles = new Set(contract.activeSharedRootFiles || []);
  if (!activeSharedRootFiles.size) {
    errors.push("active shared root catalog가 비어 있습니다.");
    return;
  }

  if (!fs.existsSync(sharedDirectory)) {
    errors.push("shared 디렉터리를 찾지 못했습니다.");
    return;
  }

  const actualSharedRootFiles = new Set(
    fs.readdirSync(sharedDirectory)
      .filter((file) => file.endsWith(".js"))
      .map((file) => path.posix.join("shared", file))
  );

  for (const file of activeSharedRootFiles) {
    if (!actualSharedRootFiles.has(file)) {
      errors.push(`active shared root catalog 누락: ${file}`);
    }
  }

  for (const file of actualSharedRootFiles) {
    if (!activeSharedRootFiles.has(file)) {
      errors.push(`active shared root에 계약 밖 helper가 다시 들어왔습니다: ${file}`);
    }
  }
}

function verifyActiveBackgroundRootCatalog() {
  const activeBackgroundRootFiles = new Set(contract.activeBackgroundRootFiles || []);
  if (!activeBackgroundRootFiles.size) {
    errors.push("active background root catalog가 비어 있습니다.");
    return;
  }

  const backgroundDirectory = path.join(root, "background");
  if (!fs.existsSync(backgroundDirectory)) {
    errors.push("background 디렉터리를 찾지 못했습니다.");
    return;
  }

  const actualBackgroundRootFiles = new Set(
    fs.readdirSync(backgroundDirectory)
      .filter((file) => file.endsWith(".js"))
      .map((file) => path.posix.join("background", file))
  );

  for (const file of activeBackgroundRootFiles) {
    if (!actualBackgroundRootFiles.has(file)) {
      errors.push(`active background root catalog 누락: ${file}`);
    }
  }

  for (const file of actualBackgroundRootFiles) {
    if (!activeBackgroundRootFiles.has(file)) {
      errors.push(`active background root에 계약 밖 helper가 다시 들어왔습니다: ${file}`);
    }
  }
}

function verifyActiveContentRootCatalog() {
  const activeContentRootFiles = new Set(contract.activeContentRootFiles || []);
  const activeContentFeatureFiles = new Set(contract.activeContentFeatureFiles || []);
  if (!activeContentRootFiles.size) {
    errors.push("active content root catalog가 비어 있습니다.");
    return;
  }

  if (!fs.existsSync(contentDirectory)) {
    errors.push("content 디렉터리를 찾지 못했습니다.");
    return;
  }

  const actualContentRootFiles = new Set(
    fs.readdirSync(contentDirectory)
      .filter((file) => /\.(js|css|html)$/.test(file))
      .map((file) => path.posix.join("content", file))
  );

  for (const file of activeContentRootFiles) {
    if (!actualContentRootFiles.has(file)) {
      errors.push(`active content root catalog 누락: ${file}`);
    }
  }

  for (const file of actualContentRootFiles) {
    if (!activeContentRootFiles.has(file)) {
      errors.push(`active content root에 계약 밖 runtime asset이 다시 들어왔습니다: ${file}`);
    }
  }

  const promptReviewDirectory = path.join(root, "content", "features", "prompt-review");
  const actualPromptReviewFiles = fs.existsSync(promptReviewDirectory)
    ? new Set(
        fs.readdirSync(promptReviewDirectory)
          .filter((file) => file.endsWith(".js"))
          .map((file) => path.posix.join("content", "features", "prompt-review", file))
      )
    : new Set();

  for (const file of activeContentFeatureFiles) {
    if (!actualPromptReviewFiles.has(file)) {
      errors.push(`active content feature catalog 누락: ${file}`);
    }
  }

  for (const file of actualPromptReviewFiles) {
    if (!activeContentFeatureFiles.has(file)) {
      errors.push(`active content feature root에 계약 밖 runtime file이 다시 들어왔습니다: ${file}`);
    }
  }
}

function verifyActivePopupRootCatalog() {
  const activePopupRootFiles = new Set(contract.activePopupRootFiles || []);
  if (!activePopupRootFiles.size) {
    errors.push("active popup root catalog가 비어 있습니다.");
    return;
  }

  const popupDirectory = path.join(root, "popup");
  if (!fs.existsSync(popupDirectory)) {
    errors.push("popup 디렉터리를 찾지 못했습니다.");
    return;
  }

  const actualPopupRootFiles = new Set(
    fs.readdirSync(popupDirectory)
      .filter((file) => /\.(js|css|html)$/.test(file))
      .map((file) => path.posix.join("popup", file))
  );

  for (const file of activePopupRootFiles) {
    if (!actualPopupRootFiles.has(file)) {
      errors.push(`active popup root catalog 누락: ${file}`);
    }
  }

  for (const file of actualPopupRootFiles) {
    if (!activePopupRootFiles.has(file)) {
      errors.push(`active popup root에 계약 밖 runtime asset이 다시 들어왔습니다: ${file}`);
    }
  }
}

function verifyBackgroundMessageCatalog() {
  const backgroundMessageTypes = new Set(contract.backgroundMessageTypes || []);
  if (!backgroundMessageTypes.size) {
    errors.push("background message catalog가 비어 있습니다.");
    return;
  }

  const serviceWorkerPath = path.join(root, "background", "service-worker.js");
  if (!fs.existsSync(serviceWorkerPath)) {
    errors.push("background/service-worker.js를 찾지 못했습니다.");
    return;
  }

  const serviceWorkerSource = fs.readFileSync(serviceWorkerPath, "utf8");
  const catalogMatch = serviceWorkerSource.match(
    /const\s+ACTIVE_BACKGROUND_MESSAGE_TYPES\s*=\s*Object\.freeze\(\[(?<values>[\s\S]*?)\]\);/
  );
  if (!catalogMatch?.groups?.values) {
    errors.push("background/service-worker.js가 ACTIVE_BACKGROUND_MESSAGE_TYPES catalog를 선언하지 않습니다.");
    return;
  }

  const actualMessageTypes = new Set(
    Array.from(catalogMatch.groups.values.matchAll(/"([^"]+)"/g), (match) => String(match[1] || "").trim()).filter(Boolean)
  );

  for (const action of backgroundMessageTypes) {
    if (!actualMessageTypes.has(action)) {
      errors.push(`background message catalog 누락: ${action}`);
    }
  }

  for (const action of actualMessageTypes) {
    if (!backgroundMessageTypes.has(action)) {
      errors.push(`background/service-worker.js가 계약에 없는 top-level message를 노출합니다: ${action}`);
    }
  }
}

function verifyCapabilityCallsInSource(source, relativePath, calleeName, allowedActions, capabilityType) {
  const actionPattern = new RegExp(`${calleeName}\\s*\\(\\s*\\{[\\s\\S]{0,220}?action:\\s*"([^"]+)"`, "g");
  let match;
  while ((match = actionPattern.exec(source))) {
    const action = String(match[1] || "").trim();
    if (!allowedActions.has(action)) {
      errors.push(`${relativePath}가 계약에 없는 ${capabilityType} capability action을 호출합니다: ${action}`);
    }
  }
}

function verifyCapabilityTransportIsolation(source, relativePath, entryName) {
  if (entryName === "extension-capability-client.js") {
    return;
  }
  if (/invokePage\s*\(\s*\{[\s\S]{0,220}?action:\s*"/.test(source)) {
    errors.push(`${relativePath}에 raw page capability action literal이 남아 있습니다. transport 문자열은 extension-capability-client.js로 모아야 합니다.`);
  }
  if (/invokeRuntime\s*\(\s*\{[\s\S]{0,220}?action:\s*"/.test(source)) {
    errors.push(`${relativePath}에 raw runtime capability action literal이 남아 있습니다. transport 문자열은 extension-capability-client.js로 모아야 합니다.`);
  }
}

function verifyExtensionPageFrameSrc(manifest) {
  const csp = String(manifest?.content_security_policy?.extension_pages || "");
  if (!csp) {
    errors.push("manifest extension_pages CSP가 없습니다.");
    return;
  }

  const frameSrcMatch = csp.match(/frame-src\s+([^;]+)/i);
  if (!frameSrcMatch?.[1]) {
    errors.push("manifest extension_pages CSP에 frame-src가 없습니다.");
    return;
  }

  const actualOrigins = new Set(
    frameSrcMatch[1]
      .split(/\s+/)
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const expectedOrigins = new Set(contract.extensionPageFrameSrcOrigins || []);

  for (const origin of expectedOrigins) {
    if (!actualOrigins.has(origin)) {
      errors.push(`manifest frame-src origin 누락: ${origin}`);
    }
  }

  for (const origin of actualOrigins) {
    if (!expectedOrigins.has(origin)) {
      errors.push(`manifest frame-src origin이 계약 밖으로 넓어졌습니다: ${origin}`);
    }
  }
}
