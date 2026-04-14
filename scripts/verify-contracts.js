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

  const contentScript = Array.isArray(manifest.content_scripts) ? manifest.content_scripts[0] : null;
  const jsFiles = contentScript?.js || [];
  const cssFiles = contentScript?.css || [];

  for (const file of contract.manifestContentScripts) {
    if (!jsFiles.includes(file)) {
      errors.push(`manifest content script 누락: ${file}`);
    }
  }

  for (const file of contract.manifestContentCss) {
    if (!cssFiles.includes(file)) {
      errors.push(`manifest content css 누락: ${file}`);
    }
  }

  for (const permission of contract.requiredPermissions || []) {
    if (!(manifest.permissions || []).includes(permission)) {
      errors.push(`manifest permission 누락: ${permission}`);
    }
  }
}

const popupPath = path.join(root, "popup", "index.html");
if (fs.existsSync(popupPath)) {
  const popupHtml = fs.readFileSync(popupPath, "utf8");
  for (const file of contract.popupScripts || []) {
    if (!popupHtml.includes(file)) {
      errors.push(`popup script 누락: ${file}`);
    }
  }
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
