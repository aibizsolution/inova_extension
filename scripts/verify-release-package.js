#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { compareVersions, findReleaseEntry, readReleaseCatalog } = require("./release-metadata");
const {
  collectRequiredReleasePackagePaths,
  findMissingPaths,
  resolveReleaseRuntimeItems,
} = require("./release-package-runtime");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
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
  verifyHostedReleaseArtifacts();

  console.log("릴리스 패키지 검증 통과");
} finally {
  fs.rmSync(stagingDir, { force: true, recursive: true });
}

function verifyHostedReleaseArtifacts() {
  const version = normalizeText(packageJson.version || manifest.version);
  const lane = inferProductLane(version);
  const laneDirectory = lane === "v2" ? "extension-v2" : "extension";
  const downloadBasePath = lane === "v2" ? "/extension-v2/downloads/" : "/extension/downloads/";
  const hostingRoot = path.join(root, "hosting", laneDirectory);
  const downloadsDir = path.join(hostingRoot, "downloads");
  const latestPath = path.join(hostingRoot, "releases", "latest.json");
  const historyPath = path.join(hostingRoot, "releases", "history.json");
  const latestPayload = readJson(latestPath);
  const historyPayload = readJson(historyPath);
  const latestRelease = latestPayload?.release && typeof latestPayload.release === "object"
    ? latestPayload.release
    : {};
  const historyReleases = Array.isArray(historyPayload?.releases) ? historyPayload.releases : [];
  const releaseCatalog = readReleaseCatalog(root);
  const curatedVersions = (Array.isArray(releaseCatalog?.versions) ? releaseCatalog.versions : [])
    .map((entry) => normalizeText(entry?.version))
    .filter(Boolean)
    .sort((left, right) => compareVersions(right, left));

  const errors = [];

  if (normalizeText(latestPayload?.product?.lane) !== lane) {
    errors.push(`latest.json의 lane이 현재 버전 lane(${lane})과 다릅니다.`);
  }
  if (normalizeText(historyPayload?.product?.lane) !== lane) {
    errors.push(`history.json의 lane이 현재 버전 lane(${lane})과 다릅니다.`);
  }
  if (!historyReleases.length) {
    errors.push("history.json에 공개 릴리스가 1개 이상 있어야 합니다.");
  }

  if (historyReleases.length) {
    const firstHistoryRelease = historyReleases[0];
    if (normalizeText(latestRelease.version) !== normalizeText(firstHistoryRelease?.version)) {
      errors.push("latest.json의 version이 history.json 첫 엔트리와 다릅니다.");
    }
    if (normalizeText(latestRelease.versionDownloadUrl) !== normalizeText(firstHistoryRelease?.versionDownloadUrl || firstHistoryRelease?.downloadUrl)) {
      errors.push("latest.json의 versionDownloadUrl이 history 첫 엔트리와 다릅니다.");
    }
  }

  if (normalizeText(latestRelease.downloadUrl) && !normalizeText(latestRelease.downloadUrl).includes(`${downloadBasePath}latest.zip`)) {
    errors.push(`latest.json의 downloadUrl은 현재 lane 최신 ZIP 경로(${downloadBasePath}latest.zip)를 가리켜야 합니다.`);
  }

  const expectedHistoryVersions = curatedVersions.slice(0, 30);
  const actualHistoryVersions = historyReleases.map((release) => normalizeText(release?.version)).filter(Boolean);
  if (JSON.stringify(actualHistoryVersions) !== JSON.stringify(expectedHistoryVersions)) {
    errors.push("history.json의 공개 버전 목록이 releases/release-notes.json curated 목록과 다릅니다.");
  }

  for (let index = 0; index < historyReleases.length; index += 1) {
    const current = historyReleases[index];
    const next = historyReleases[index + 1];
    if (next && compareVersions(normalizeText(current?.version), normalizeText(next?.version)) <= 0) {
      errors.push("history.json의 버전 목록은 내림차순이어야 합니다.");
      break;
    }
  }

  for (const release of historyReleases) {
    const versionKey = normalizeText(release?.version);
    const fileName = normalizeText(release?.fileName);
    if (!fileName) {
      errors.push(`history.json의 ${versionKey || "(unknown)"} 엔트리에 fileName이 없습니다.`);
      continue;
    }

    const artifactPath = path.join(downloadsDir, fileName);
    if (!fs.existsSync(artifactPath)) {
      errors.push(`현재 lane downloads에 공개 ZIP이 없습니다: ${fileName}`);
      continue;
    }

    const releaseDownloadUrl = normalizeText(release?.downloadUrl);
    const releaseVersionDownloadUrl = normalizeText(release?.versionDownloadUrl || release?.downloadUrl);
    if (releaseDownloadUrl && !releaseDownloadUrl.includes(`${downloadBasePath}${fileName}`)) {
      errors.push(`${versionKey} downloadUrl이 현재 lane artifact 경로와 다릅니다.`);
    }
    if (releaseVersionDownloadUrl && !releaseVersionDownloadUrl.includes(`${downloadBasePath}${fileName}`)) {
      errors.push(`${versionKey} versionDownloadUrl이 현재 lane artifact 경로와 다릅니다.`);
    }

    const releaseEntry = findReleaseEntry(releaseCatalog, versionKey);
    const artifact = releaseEntry?.artifact && typeof releaseEntry.artifact === "object"
      ? releaseEntry.artifact
      : null;
    if (!artifact) {
      errors.push(`${versionKey} artifact가 releases/release-notes.json에 없습니다.`);
      continue;
    }

    if (normalizeText(artifact.fileName) !== fileName) {
      errors.push(`${versionKey} fileName이 releases/release-notes.json artifact와 다릅니다.`);
    }
    if (normalizeText(artifact.publishedAt) !== normalizeText(release?.publishedAt)) {
      errors.push(`${versionKey} publishedAt이 releases/release-notes.json artifact와 다릅니다.`);
    }
    if (normalizeText(artifact.sha256) !== normalizeText(release?.sha256)) {
      errors.push(`${versionKey} sha256이 releases/release-notes.json artifact와 다릅니다.`);
    }
    if (Math.max(0, Number(artifact.sizeBytes) || 0) !== Math.max(0, Number(release?.sizeBytes) || 0)) {
      errors.push(`${versionKey} sizeBytes가 releases/release-notes.json artifact와 다릅니다.`);
    }
    if (normalizeText(artifact.minSupportedVersion) !== normalizeText(release?.minSupportedVersion)) {
      errors.push(`${versionKey} minSupportedVersion이 releases/release-notes.json artifact와 다릅니다.`);
    }
  }

  const latestZipPath = path.join(downloadsDir, "latest.zip");
  if (!fs.existsSync(latestZipPath)) {
    errors.push("현재 lane downloads에 latest.zip이 없습니다.");
  } else if (historyReleases.length) {
    const currentArtifactPath = path.join(downloadsDir, normalizeText(historyReleases[0]?.fileName));
    if (fs.existsSync(currentArtifactPath)) {
      const latestZipSize = fs.statSync(latestZipPath).size;
      const currentArtifactSize = fs.statSync(currentArtifactPath).size;
      if (latestZipSize !== currentArtifactSize) {
        errors.push("latest.zip 크기가 history 첫 공개 버전 ZIP과 다릅니다.");
      }
    }
  }

  if (errors.length) {
    console.error("릴리스 패키지 검증 실패");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
}

function inferProductLane(currentVersion) {
  const [major] = String(currentVersion || "").split(".");
  return (Number.parseInt(major, 10) || 0) >= 1 ? "v2" : "legacy";
}

function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function normalizeText(value) {
  return String(value || "").trim();
}
