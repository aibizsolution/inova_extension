#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_RELEASE_RUNTIME_ITEMS = ["manifest.json", "background", "content", "icons", "popup", "shared", "README.md"];

function normalizeRelativePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function isLocalRuntimePath(value) {
  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    return false;
  }
  return !/^[a-z]+:\/\//i.test(normalized) && !normalized.startsWith("data:");
}

function addManifestPath(output, value) {
  const normalized = normalizeRelativePath(value);
  if (!isLocalRuntimePath(normalized) || normalized.includes("*")) {
    return;
  }
  output.add(normalized);
}

function addManifestPathList(output, values) {
  for (const value of Array.isArray(values) ? values : []) {
    addManifestPath(output, value);
  }
}

function addManifestObjectValues(output, value) {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const entry of Object.values(value)) {
    addManifestPath(output, entry);
  }
}

function collectManifestRuntimePaths(manifest) {
  const output = new Set();
  const normalizedManifest = manifest && typeof manifest === "object" ? manifest : {};

  addManifestPath(output, normalizedManifest.background?.service_worker);
  addManifestPath(output, normalizedManifest.action?.default_popup);
  addManifestObjectValues(output, normalizedManifest.icons);
  addManifestObjectValues(output, normalizedManifest.action?.default_icon);
  addManifestPath(output, normalizedManifest.options_page);
  addManifestPath(output, normalizedManifest.options_ui?.page);
  addManifestPath(output, normalizedManifest.devtools_page);
  addManifestPath(output, normalizedManifest.side_panel?.default_path);
  addManifestObjectValues(output, normalizedManifest.chrome_url_overrides);

  for (const script of Array.isArray(normalizedManifest.content_scripts) ? normalizedManifest.content_scripts : []) {
    addManifestPathList(output, script?.js);
    addManifestPathList(output, script?.css);
  }

  for (const resource of Array.isArray(normalizedManifest.web_accessible_resources)
    ? normalizedManifest.web_accessible_resources
    : []) {
    addManifestPathList(output, resource?.resources);
  }

  return Array.from(output);
}

function isPathCoveredByItems(targetPath, items) {
  const normalizedTargetPath = normalizeRelativePath(targetPath);
  if (!normalizedTargetPath) {
    return false;
  }

  return (Array.isArray(items) ? items : []).some((item) => {
    const normalizedItem = normalizeRelativePath(item);
    if (!normalizedItem) {
      return false;
    }
    return normalizedItem === normalizedTargetPath || normalizedTargetPath.startsWith(`${normalizedItem}/`);
  });
}

function resolveReleaseRuntimeItems(manifest, baseItems = DEFAULT_RELEASE_RUNTIME_ITEMS) {
  const items = [];
  for (const item of Array.isArray(baseItems) ? baseItems : []) {
    const normalizedItem = normalizeRelativePath(item);
    if (normalizedItem && !items.includes(normalizedItem)) {
      items.push(normalizedItem);
    }
  }

  for (const manifestPath of collectManifestRuntimePaths(manifest)) {
    if (!isPathCoveredByItems(manifestPath, items)) {
      items.push(manifestPath);
    }
  }

  return items;
}

function collectRequiredReleasePackagePaths(manifest) {
  return Array.from(new Set(["manifest.json", ...collectManifestRuntimePaths(manifest)]));
}

function findMissingPaths(baseDir, relativePaths) {
  const normalizedBaseDir = path.resolve(baseDir);
  const output = [];

  for (const relativePath of Array.isArray(relativePaths) ? relativePaths : []) {
    const normalizedPath = normalizeRelativePath(relativePath);
    if (!normalizedPath) {
      continue;
    }
    if (!fs.existsSync(path.join(normalizedBaseDir, normalizedPath))) {
      output.push(normalizedPath);
    }
  }

  return output;
}

module.exports = {
  DEFAULT_RELEASE_RUNTIME_ITEMS,
  collectManifestRuntimePaths,
  collectRequiredReleasePackagePaths,
  findMissingPaths,
  isPathCoveredByItems,
  normalizeRelativePath,
  resolveReleaseRuntimeItems,
};
