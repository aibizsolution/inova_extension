const fs = require("fs");
const path = require("path");

const LEGACY_HOSTING_BASE_URL = "https://browser-extension-main.web.app/extension";
const LATEST_DOWNLOAD_FILE_NAME = "latest.zip";

function syncLegacyLatestCompatibilityAliasFromCanonical(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const canonicalRoot = path.join(root, "hosting", "extension-v2");
  const canonicalDownloadsDir = path.join(canonicalRoot, "downloads");
  const canonicalReleasesDir = path.join(canonicalRoot, "releases");
  const legacyRoot = path.join(root, "hosting", "extension");
  const legacyDownloadsDir = path.join(legacyRoot, "downloads");
  const legacyReleasesDir = path.join(legacyRoot, "releases");
  const latestPayload = readJson(path.join(canonicalReleasesDir, "latest.json"));
  const historyPayload = readJson(path.join(canonicalReleasesDir, "history.json"));
  const latestRelease = latestPayload?.release && typeof latestPayload.release === "object"
    ? latestPayload.release
    : null;
  const historyReleases = Array.isArray(historyPayload?.releases)
    ? historyPayload.releases
    : [];

  if (!latestRelease?.fileName) {
    throw new Error("v2 latest release artifact metadata is missing.");
  }
  if (!historyReleases.length) {
    throw new Error("v2 release history is empty.");
  }

  fs.mkdirSync(legacyDownloadsDir, { recursive: true });
  fs.mkdirSync(legacyReleasesDir, { recursive: true });
  for (const release of historyReleases) {
    const fileName = normalizeText(release?.fileName);
    if (!fileName) {
      continue;
    }
    copyArtifact({
      canonicalDownloadsDir,
      fileName,
      legacyDownloadsDir,
      root,
    });
  }
  copyArtifact({
    canonicalDownloadsDir,
    fileName: latestRelease.fileName,
    legacyDownloadsDir,
    outputFileName: LATEST_DOWNLOAD_FILE_NAME,
    root,
  });

  writeJson(path.join(legacyReleasesDir, "latest.json"), {
    product: latestPayload.product || historyPayload.product || {},
    release: toLegacyRelease(latestRelease, { preferLatestAlias: true }),
  });
  writeJson(path.join(legacyReleasesDir, "history.json"), {
    product: historyPayload.product || latestPayload.product || {},
    releases: historyReleases.map((release) => toLegacyRelease(release)).filter(Boolean),
  });

  return {
    latestZipPath: path.join(legacyDownloadsDir, LATEST_DOWNLOAD_FILE_NAME),
    latestJsonPath: path.join(legacyReleasesDir, "latest.json"),
    historyJsonPath: path.join(legacyReleasesDir, "history.json"),
  };
}

function copyArtifact({ canonicalDownloadsDir, fileName, legacyDownloadsDir, outputFileName, root }) {
  const sourcePath = resolveArtifactSourcePath({
    canonicalDownloadsDir,
    fileName,
    legacyDownloadsDir,
    root,
  });
  if (!sourcePath) {
    throw new Error(`release artifact not found for legacy compatibility alias: ${fileName}`);
  }
  fs.copyFileSync(sourcePath, path.join(legacyDownloadsDir, outputFileName || fileName));
}

function resolveArtifactSourcePath({ canonicalDownloadsDir, fileName, legacyDownloadsDir, root }) {
  const candidates = [
    path.join(canonicalDownloadsDir, fileName),
    path.join(root, "releases", fileName),
    path.join(legacyDownloadsDir, fileName),
  ];
  return candidates.find((candidatePath) => fs.existsSync(candidatePath)) || "";
}

function toLegacyRelease(release, options = {}) {
  const fileName = normalizeText(release?.fileName);
  if (!fileName) {
    return null;
  }
  return {
    ...release,
    downloadUrl: `${LEGACY_HOSTING_BASE_URL}/downloads/${options.preferLatestAlias ? LATEST_DOWNLOAD_FILE_NAME : fileName}`,
    versionDownloadUrl: `${LEGACY_HOSTING_BASE_URL}/downloads/${fileName}`,
  };
}

function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function writeJson(targetPath, payload) {
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  syncLegacyLatestCompatibilityAliasFromCanonical,
};
