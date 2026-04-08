#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { compareVersions, findReleaseEntry, getPublicReleaseSection, readReleaseCatalog, validateReleaseEntry } = require("./release-metadata");
const {
  collectRequiredReleasePackagePaths,
  findMissingPaths,
  resolveReleaseRuntimeItems,
} = require("./release-package-runtime");

const root = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const manifestJson = readJson("manifest.json");
const version = String(packageJson.version || "");
const manifestVersion = String(manifestJson.version || "");
if (!version || version !== manifestVersion) {
  throw new Error("package.json과 manifest.json 버전이 다르거나 비어 있어요.");
}

const date = new Date().toISOString().slice(0, 10);
const productLane = inferProductLane(version);
const bundleName = `inova-extension-${version}-${date}`;
const releasesDir = path.join(root, "releases");
const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `${bundleName}-`));
const zipPath = path.join(releasesDir, `${bundleName}.zip`);
const hostingRoot = path.join(root, "hosting", productLane === "v2" ? "extension-v2" : "extension");
const hostingDownloadDir = path.join(hostingRoot, "downloads");
const hostingReleaseDir = path.join(hostingRoot, "releases");
const hostingBaseUrl = productLane === "v2"
  ? "https://browser-extension-v2.web.app/extension"
  : "https://browser-extension-main.web.app/extension";
const latestDownloadFileName = "latest.zip";
const publishedAt = new Date().toISOString();
const runtimeItems = resolveReleaseRuntimeItems(manifestJson);
const releaseCatalog = readReleaseCatalog(root);
const releaseEntry = findReleaseEntry(releaseCatalog, version);
const releaseErrors = validateReleaseEntry(releaseEntry, version);
if (releaseErrors.length) {
  throw new Error([
    `현재 버전 ${version} 의 릴리스 메타가 비어 있거나 초안 상태예요.`,
    ...releaseErrors.map((error) => `- ${error}`),
  ].join("\n"));
}

for (const item of runtimeItems) {
  fs.cpSync(path.join(root, item), path.join(stagingDir, item), { force: true, recursive: true });
}
assertReleasePackageIntegrity(stagingDir, manifestJson);
fs.mkdirSync(releasesDir, { recursive: true });
compressDirectory(stagingDir, zipPath);
fs.rmSync(stagingDir, { force: true, recursive: true });

fs.mkdirSync(hostingDownloadDir, { recursive: true });
fs.mkdirSync(hostingReleaseDir, { recursive: true });
const hostingZipPath = path.join(hostingDownloadDir, `${bundleName}.zip`);
const hostingLatestZipPath = path.join(hostingDownloadDir, latestDownloadFileName);
fs.copyFileSync(zipPath, hostingZipPath);
fs.copyFileSync(zipPath, hostingLatestZipPath);

const sizeBytes = fs.statSync(zipPath).size;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
const versionedDownloadUrl = `${hostingBaseUrl}/downloads/${bundleName}.zip`;
const latestDownloadUrl = `${hostingBaseUrl}/downloads/${latestDownloadFileName}`;
const historyRelease = buildPublishedRelease({
  version,
  releaseEntry,
  publishedAt,
  fileName: `${bundleName}.zip`,
  downloadUrl: versionedDownloadUrl,
  versionDownloadUrl: versionedDownloadUrl,
  sha256,
  sizeBytes,
});

const latestPath = path.join(hostingReleaseDir, "latest.json");
const historyPath = path.join(hostingReleaseDir, "history.json");
const latestPublishedVersion = normalizeText(readJsonSafe(latestPath)?.release?.version);
if (latestPublishedVersion && compareVersions(version, latestPublishedVersion) < 0) {
  throw new Error([
    `현재 버전 ${version} 은(는) 마지막 배포 버전 ${latestPublishedVersion} 보다 높지 않아요.`,
    "배포 전에 `npm run version:bump -- <patch|minor|major>`로 새 버전을 먼저 준비해 주세요.",
  ].join("\n"));
}
const curatedVersions = getCuratedReleaseVersions(releaseCatalog);
if (!curatedVersions.length) {
  throw new Error("releases/release-notes.json에 사용자 패널에 남길 공개 릴리스를 1개 이상 유지해 주세요.");
}
const publishedReleaseMap = buildPublishedReleaseMap({
  currentHistoryRelease: historyRelease,
  currentVersion: version,
  existingLatestRelease: readJsonSafe(latestPath)?.release,
  existingHistoryReleases: readJsonSafe(historyPath)?.releases,
  releaseCatalog,
});
const curatedHistory = curatedVersions.map((curatedVersion) => {
  const publishedRelease = publishedReleaseMap.get(curatedVersion)
    || buildPublishedReleaseFromCatalogEntry(findReleaseEntry(releaseCatalog, curatedVersion), curatedVersion, hostingBaseUrl);
  if (!publishedRelease) {
    throw new Error([
      `공개 릴리스 ${curatedVersion} 의 배포 메타를 찾지 못했어요.`,
      "releases/release-notes.json에는 실제로 배포 ZIP과 artifact 메타가 존재하는 버전만 남겨 주세요.",
    ].join("\n"));
  }
  return toHistoryPublishedRelease(publishedRelease);
});
const latestHistoryRelease = curatedHistory[0];
const latestRelease = toLatestPublishedRelease(latestHistoryRelease, latestDownloadUrl);
writeJson(latestPath, {
  product: buildProductMeta(),
  release: latestRelease,
});
writeJson(historyPath, {
  product: buildProductMeta(),
  releases: curatedHistory.slice(0, 30),
});
fs.copyFileSync(resolveLatestDownloadSourcePath({
  currentVersion: version,
  hostingDownloadDir,
  latestHistoryRelease,
  releasesDir,
  zipPath,
}), hostingLatestZipPath);
pruneCuratedReleaseArtifacts({
  curatedHistory,
  hostingDownloadDir,
  latestDownloadFileName,
  releasesDir,
});

console.log(`[release-build] version=${version}`);
console.log(`[release-build] lane=${productLane}`);
console.log(`[release-build] zip=${zipPath}`);
console.log(`[release-build] latest-zip=${hostingLatestZipPath}`);
console.log(`[release-build] latest=${latestPath}`);
console.log(`[release-build] history=${historyPath}`);

function buildProductMeta() {
  return {
    experimental: true,
    lane: productLane,
    name: "i-Nova 더하기",
    team: "AI비즈솔루션팀",
  };
}

function inferProductLane(currentVersion) {
  const [major] = String(currentVersion || "").split(".");
  return (Number.parseInt(major, 10) || 0) >= 1 ? "v2" : "legacy";
}

function assertReleasePackageIntegrity(stagingDirectory, manifest) {
  const missingPaths = findMissingPaths(stagingDirectory, collectRequiredReleasePackagePaths(manifest));
  if (!missingPaths.length) {
    return;
  }

  throw new Error([
    "release package staging 결과에 manifest 런타임 파일이 빠졌어요.",
    ...missingPaths.map((missingPath) => `- ${missingPath}`),
  ].join("\n"));
}

function compressDirectory(sourceDir, destinationPath) {
  fs.rmSync(destinationPath, { force: true });
  if (process.platform === "win32") {
    return compressDirectoryOnWindows(sourceDir, destinationPath);
  }

  const result = spawnSync("zip", ["-qr", destinationPath, "."], {
    cwd: sourceDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "ZIP 생성에 실패했어요.");
  }
}

function compressDirectoryOnWindows(sourceDir, destinationPath) {
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${escapePowerShell(sourceDir)}', '${escapePowerShell(destinationPath)}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
  ].join("; ");
  const result = spawnSync("powershell", ["-NoLogo", "-NoProfile", "-Command", command], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "ZIP 생성에 실패했어요.");
  }
}

function writeJson(targetPath, payload) {
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readJsonSafe(targetPath) {
  if (!fs.existsSync(targetPath)) return null;
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function escapePowerShell(targetPath) {
  return String(targetPath).replace(/'/g, "''");
}

function buildPublishedRelease({ version, releaseEntry, publishedAt, fileName, downloadUrl, versionDownloadUrl, sha256, sizeBytes }) {
  const publicEntry = getPublicReleaseSection(releaseEntry);
  return {
    version,
    level: normalizeText(releaseEntry.level || "patch"),
    headline: normalizeText(publicEntry.headline),
    summary: normalizeText(publicEntry.summary),
    changes: normalizeChanges(publicEntry.changes),
    publishedAt,
    fileName,
    downloadUrl,
    versionDownloadUrl: normalizeText(versionDownloadUrl || downloadUrl),
    notes: normalizeText(publicEntry.headline || publicEntry.summary || "수동 배포본"),
    sha256,
    sizeBytes,
    minSupportedVersion: version,
  };
}

function buildPublishedReleaseFromCatalogEntry(releaseEntry, version, hostingBaseUrl) {
  if (!releaseEntry || typeof releaseEntry !== "object") {
    return null;
  }

  const artifact = normalizeArtifactMetadata(releaseEntry?.artifact);
  if (!artifact.fileName) {
    return null;
  }

  const publicEntry = getPublicReleaseSection(releaseEntry);
  const versionedDownloadUrl = `${hostingBaseUrl}/downloads/${artifact.fileName}`;
  return {
    version: normalizeText(version || releaseEntry?.version),
    level: normalizeText(releaseEntry.level || "patch"),
    headline: normalizeText(publicEntry.headline),
    summary: normalizeText(publicEntry.summary),
    changes: normalizeChanges(publicEntry.changes),
    publishedAt: artifact.publishedAt,
    fileName: artifact.fileName,
    downloadUrl: versionedDownloadUrl,
    versionDownloadUrl: versionedDownloadUrl,
    notes: normalizeText(publicEntry.headline || publicEntry.summary || "수동 배포본"),
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    minSupportedVersion: normalizeText(artifact.minSupportedVersion || version || releaseEntry?.version),
  };
}

function getCuratedReleaseVersions(releaseCatalog) {
  return (Array.isArray(releaseCatalog?.versions) ? releaseCatalog.versions : [])
    .map((entry) => normalizeText(entry?.version))
    .filter(Boolean)
    .sort((left, right) => compareVersions(right, left));
}

function buildPublishedReleaseMap({ currentHistoryRelease, currentVersion, existingLatestRelease, existingHistoryReleases, releaseCatalog }) {
  const output = new Map();
  const existingReleases = normalizePublishedReleaseList([
    existingLatestRelease,
    ...(Array.isArray(existingHistoryReleases) ? existingHistoryReleases : []),
  ], releaseCatalog);

  for (const release of existingReleases) {
    output.set(release.version, toHistoryPublishedRelease(release));
  }
  output.set(currentVersion, currentHistoryRelease);
  return output;
}

function normalizePublishedReleaseList(releases, releaseCatalog) {
  return (Array.isArray(releases) ? releases : []).map((release) => normalizePublishedRelease(release, releaseCatalog)).filter(Boolean);
}

function normalizePublishedRelease(release, releaseCatalog) {
  const version = normalizeText(release?.version);
  if (!version) return null;
  const metadata = findReleaseEntry(releaseCatalog, version) || {};
  const publicEntry = getPublicReleaseSection(metadata);
  const headline = normalizeText(publicEntry.headline || release?.headline || release?.notes);
  const summary = normalizeText(publicEntry.summary || release?.summary || release?.notes);
  return {
    version,
    level: normalizeText(metadata.level || release?.level || "patch"),
    headline,
    summary,
    changes: normalizeChanges((Array.isArray(publicEntry.changes) && publicEntry.changes.length ? publicEntry.changes : release?.changes)),
    publishedAt: normalizeText(release?.publishedAt),
    fileName: normalizeText(release?.fileName),
    downloadUrl: normalizeText(release?.downloadUrl),
    versionDownloadUrl: normalizeText(release?.versionDownloadUrl || release?.downloadUrl),
    notes: normalizeText(release?.notes || headline || summary),
    sha256: normalizeText(release?.sha256),
    sizeBytes: Math.max(0, Number(release?.sizeBytes) || 0),
    minSupportedVersion: normalizeText(release?.minSupportedVersion || version),
  };
}

function toHistoryPublishedRelease(release) {
  if (!release || typeof release !== "object") {
    return null;
  }
  return {
    ...release,
    downloadUrl: normalizeText(release.versionDownloadUrl || release.downloadUrl),
    versionDownloadUrl: normalizeText(release.versionDownloadUrl || release.downloadUrl),
  };
}

function toLatestPublishedRelease(release, latestDownloadUrl) {
  if (!release || typeof release !== "object") {
    return null;
  }
  return {
    ...release,
    downloadUrl: normalizeText(latestDownloadUrl),
    versionDownloadUrl: normalizeText(release.versionDownloadUrl || release.downloadUrl),
  };
}

function resolveLatestDownloadSourcePath({ currentVersion, hostingDownloadDir, latestHistoryRelease, releasesDir, zipPath }) {
  if (normalizeText(latestHistoryRelease?.version) === normalizeText(currentVersion)) {
    return zipPath;
  }

  const fileName = normalizeText(latestHistoryRelease?.fileName);
  if (!fileName) {
    throw new Error("공개 최신 릴리스의 ZIP 파일 이름이 비어 있어 latest.zip을 갱신할 수 없어요.");
  }

  const candidatePaths = [
    path.join(hostingDownloadDir, fileName),
    path.join(releasesDir, fileName),
  ];
  const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (existingPath) {
    return existingPath;
  }

  throw new Error([
    `공개 최신 릴리스 ZIP을 찾지 못했어요: ${fileName}`,
    ...candidatePaths.map((candidatePath) => `- ${candidatePath}`),
  ].join("\n"));
}

function pruneCuratedReleaseArtifacts({ curatedHistory, hostingDownloadDir, latestDownloadFileName, releasesDir }) {
  const curatedFileNames = new Set(
    (Array.isArray(curatedHistory) ? curatedHistory : [])
      .map((release) => normalizeText(release?.fileName))
      .filter(Boolean)
  );

  pruneZipFiles(releasesDir, curatedFileNames);
  pruneZipFiles(hostingDownloadDir, new Set([latestDownloadFileName, ...curatedFileNames]));
}

function pruneZipFiles(directoryPath, allowedFileNames) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const fileName = normalizeText(entry.name);
    if (!/\.zip$/i.test(fileName)) {
      continue;
    }
    if (allowedFileNames.has(fileName)) {
      continue;
    }
    fs.rmSync(path.join(directoryPath, fileName), { force: true });
  }
}

function normalizeArtifactMetadata(artifact) {
  return {
    fileName: normalizeText(artifact?.fileName),
    minSupportedVersion: normalizeText(artifact?.minSupportedVersion),
    publishedAt: normalizeText(artifact?.publishedAt),
    sha256: normalizeText(artifact?.sha256),
    sizeBytes: Math.max(0, Number(artifact?.sizeBytes) || 0),
  };
}

function normalizeChanges(changes) {
  return (Array.isArray(changes) ? changes : [])
    .map((item) => ({
      type: normalizeText(item?.type),
      text: normalizeText(item?.text),
    }))
    .filter((item) => item.type && item.text);
}

function normalizeText(value) {
  return String(value || "").trim();
}
