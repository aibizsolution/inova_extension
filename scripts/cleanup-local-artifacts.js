#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const rootFilePatterns = [
  /^firebase-debug\.log(?:\..+)?$/i,
  /^firestore-debug\.log(?:\..+)?$/i,
  /^tmp-emulators-.*\.log(?:\..+)?$/i,
  /^.*\.log(?:\..+)?$/i,
];

const directoryTargets = [
  {
    relativeDir: ".codex-local",
    patterns: [/^.*\.log(?:\..+)?$/i],
  },
  {
    relativeDir: ".codex-logs",
    patterns: [/^.*\.log(?:\..+)?$/i],
  },
  {
    relativeDir: ".codex-temp",
    patterns: [/^.*\.log(?:\..+)?$/i],
  },
  {
    relativeDir: ".playwright-cli",
    patterns: [/^.*\.log(?:\..+)?$/i, /^page-.*\.yml$/i],
  },
  {
    relativeDir: ".playwright-mcp",
    patterns: [/^.*\.log(?:\..+)?$/i, /^page-.*\.yml$/i],
  },
  {
    relativeDir: "logs",
    patterns: [/^.*\.log(?:\..+)?$/i],
  },
];

function main() {
  const deleted = [];
  const failed = [];
  const skipped = [];

  for (const target of directoryTargets) {
    const absoluteDir = path.join(root, target.relativeDir);
    if (!fs.existsSync(absoluteDir)) {
      continue;
    }
    removeArtifactsRecursively(absoluteDir, target.patterns, deleted, failed, skipped);
    removeDirectoryIfEmpty(absoluteDir);
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !matchesPattern(entry.name, rootFilePatterns)) {
      continue;
    }
    removeFile(path.join(root, entry.name), deleted, failed, skipped);
  }

  if (deleted.length) {
    console.log(`[cleanup-local-artifacts] Removed ${deleted.length} artifact file(s)`);
  } else {
    console.log("[cleanup-local-artifacts] No artifact files to remove");
  }

  if (skipped.length) {
    console.log(`[cleanup-local-artifacts] Skipped ${skipped.length} active/locked artifact file(s)`);
  }

  if (failed.length) {
    console.warn("[cleanup-local-artifacts] Some artifact files could not be removed:");
    for (const entry of failed) {
      console.warn(`- ${entry.path}: ${entry.error}`);
    }
  }
}

function removeArtifactsRecursively(directoryPath, patterns, deleted, failed, skipped) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      removeArtifactsRecursively(absolutePath, patterns, deleted, failed, skipped);
      removeDirectoryIfEmpty(absolutePath);
      continue;
    }
    if (!entry.isFile() || !matchesPattern(entry.name, patterns)) {
      continue;
    }
    removeFile(absolutePath, deleted, failed, skipped);
  }
}

function removeFile(absolutePath, deleted, failed, skipped) {
  try {
    fs.unlinkSync(absolutePath);
    deleted.push(path.relative(root, absolutePath));
  } catch (error) {
    if (isSkippableError(error)) {
      skipped.push(path.relative(root, absolutePath));
      return;
    }
    failed.push({
      error: error instanceof Error ? error.message : String(error || "unknown error"),
      path: path.relative(root, absolutePath),
    });
  }
}

function matchesPattern(fileName, patterns) {
  return patterns.some((pattern) => pattern.test(String(fileName || "")));
}

function isSkippableError(error) {
  const code = String(error?.code || "").toUpperCase();
  return code === "EBUSY" || code === "EPERM" || code === "ENOENT";
}

function removeDirectoryIfEmpty(directoryPath) {
  try {
    const entries = fs.readdirSync(directoryPath);
    if (entries.length === 0) {
      fs.rmdirSync(directoryPath);
    }
  } catch {
    // Ignore cleanup-only directory removal errors.
  }
}

main();
