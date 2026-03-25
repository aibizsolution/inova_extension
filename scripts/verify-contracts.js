#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(root, "contracts", "extension-contract.json"), "utf8")
);

const errors = [];

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
}

for (const file of listSourceFiles(root)) {
  const lineCount = countLines(path.join(root, file));
  if (lineCount > contract.maxLinesPerSourceFile) {
    errors.push(`파일이 너무 큽니다 (${lineCount} lines): ${file}`);
  }
}

const sharedStoragePath = path.join(root, "shared", "storage.js");
if (fs.existsSync(sharedStoragePath)) {
  const sharedStorage = fs.readFileSync(sharedStoragePath, "utf8");
  for (const key of contract.requiredStorageKeys) {
    if (!sharedStorage.includes(key)) {
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

if (errors.length) {
  console.error("구조 계약 검증 실패");
  for (const error of errors) {
    console.error(`- ${error}`);
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
