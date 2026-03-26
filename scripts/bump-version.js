#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  buildDraftReleaseEntry,
  findReleaseEntry,
  inferReleaseLevel,
  readReleaseCatalog,
  upsertReleaseEntry,
  writeReleaseCatalog,
} = require("./release-metadata");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "manifest.json");
const input = String(process.argv[2] || "patch").trim();
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const manifestJson = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const currentVersion = String(packageJson.version || manifestJson.version || "0.1.0");
const nextVersion = resolveNextVersion(currentVersion, input);
const releaseLevel = inferReleaseLevel(currentVersion, nextVersion);
const releaseCatalog = readReleaseCatalog(root);
const existingReleaseEntry = findReleaseEntry(releaseCatalog, nextVersion);

packageJson.version = nextVersion;
manifestJson.version = nextVersion;

fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`);
if (!existingReleaseEntry) {
  writeReleaseCatalog(root, upsertReleaseEntry(releaseCatalog, buildDraftReleaseEntry(nextVersion, releaseLevel)));
}
console.log(`[bump-version] ${currentVersion} -> ${nextVersion}`);
if (!existingReleaseEntry) {
  console.log(`[bump-version] draft release note created: releases/release-notes.json (${releaseLevel})`);
}

function resolveNextVersion(current, next) {
  if (!/^\d+\.\d+\.\d+$/.test(next) && !["major", "minor", "patch"].includes(next)) {
    throw new Error("버전 인자는 patch, minor, major 또는 x.y.z 형식이어야 합니다.");
  }
  if (/^\d+\.\d+\.\d+$/.test(next)) return next;
  const parts = current.split(".").map((value) => Number.parseInt(value, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (next === "major") return `${parts[0] + 1}.0.0`;
  if (next === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}
