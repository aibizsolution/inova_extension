#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  collectRequiredReleasePackagePaths,
  findMissingPaths,
  resolveReleaseRuntimeItems,
} = require("./release-package-runtime");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const runtimeItems = resolveReleaseRuntimeItems(manifest);
const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "inova-release-package-"));

try {
  for (const item of runtimeItems) {
    fs.cpSync(path.join(root, item), path.join(stagingDir, item), { force: true, recursive: true });
  }

  const missingPaths = findMissingPaths(stagingDir, collectRequiredReleasePackagePaths(manifest));
  if (missingPaths.length) {
    console.error("릴리스 패키지 검증 실패");
    for (const missingPath of missingPaths) {
      console.error(`- ${missingPath}`);
    }
    process.exit(1);
  }

  console.log("릴리스 패키지 검증 통과");
} finally {
  fs.rmSync(stagingDir, { force: true, recursive: true });
}
