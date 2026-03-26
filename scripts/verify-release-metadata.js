#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  compareVersions,
  findReleaseEntry,
  readReleaseCatalog,
  validateReleaseEntry,
} = require("./release-metadata");

const root = path.resolve(__dirname, "..");
const ZERO_SHA = "0000000000000000000000000000000000000000";
const PACKAGE_PATH = "package.json";
const MANIFEST_PATH = "manifest.json";
const RELEASE_NOTES_PATH = "releases/release-notes.json";
const FEATURE_PATH_PATTERNS = [
  /^background\//,
  /^content\//,
  /^functions\//,
  /^popup\//,
  /^shared\//,
  /^contracts\//,
  /^firebase\.json$/,
  /^firestore\.(?:indexes\.json|rules)$/,
  /^manifest\.json$/,
];

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "";
  const snapshots = mode === "--staged"
    ? [buildStagedSnapshot()]
    : mode === "--range"
      ? [buildRangeSnapshot(args[1])]
      : buildPushSnapshots(fs.readFileSync(0, "utf8"), args[0] || "origin");

  const featureSnapshots = snapshots.filter((snapshot) => snapshot.featureFiles.length > 0);
  if (!featureSnapshots.length) {
    console.log("릴리스 메타 가드 통과");
    return;
  }

  featureSnapshots.forEach(validateSnapshot);
  console.log("릴리스 메타 가드 통과");
}

function buildStagedSnapshot() {
  const changedFiles = getChangedFilesForArgs(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return createSnapshot("staged 변경", changedFiles, {
    packageJson: readJsonFromIndex(PACKAGE_PATH) || readJsonFromFile(PACKAGE_PATH),
    manifestJson: readJsonFromIndex(MANIFEST_PATH) || readJsonFromFile(MANIFEST_PATH),
    releaseCatalog: readReleaseCatalogFromIndex() || readReleaseCatalog(root),
    baseVersions: [readVersionFromRef("HEAD", PACKAGE_PATH), readVersionFromRef("HEAD", MANIFEST_PATH)].filter(Boolean),
  });
}

function buildRangeSnapshot(range) {
  if (!range) {
    fail("`--range` 다음에 비교 범위를 넣어 주세요. 예: --range origin/main..HEAD");
  }
  const changedFiles = getChangedFilesForArgs(["diff", "--name-only", "--diff-filter=ACMR", range]);
  const baseRef = extractRangeBase(range);
  const targetRef = extractRangeTarget(range);
  return createSnapshot(`범위 ${range}`, changedFiles, {
    packageJson: readJsonFromRef(targetRef, PACKAGE_PATH) || readJsonFromFile(PACKAGE_PATH),
    manifestJson: readJsonFromRef(targetRef, MANIFEST_PATH) || readJsonFromFile(MANIFEST_PATH),
    releaseCatalog: readReleaseCatalogFromRef(targetRef) || readReleaseCatalog(root),
    baseVersions: [readVersionFromRef(baseRef, PACKAGE_PATH), readVersionFromRef(baseRef, MANIFEST_PATH)].filter(Boolean),
  });
}

function buildPushSnapshots(stdin, remoteName) {
  const lines = String(stdin || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length === 4 && parts[1] !== ZERO_SHA)
    .map(([localRef, localSha, remoteRef, remoteSha]) => {
      const baseSha = remoteSha !== ZERO_SHA ? remoteSha : resolveNewBranchBase(localSha, remoteName);
      const diffArgs = baseSha
        ? ["diff", "--name-only", "--diff-filter=ACMR", `${baseSha}..${localSha}`]
        : ["show", "--pretty=", "--name-only", "--diff-filter=ACMR", localSha];
      return createSnapshot(`${localRef} -> ${remoteRef}`, getChangedFilesForArgs(diffArgs), {
        packageJson: readJsonFromRef(localSha, PACKAGE_PATH) || readJsonFromFile(PACKAGE_PATH),
        manifestJson: readJsonFromRef(localSha, MANIFEST_PATH) || readJsonFromFile(MANIFEST_PATH),
        releaseCatalog: readReleaseCatalogFromRef(localSha) || readReleaseCatalog(root),
        baseVersions: baseSha ? [readVersionFromRef(baseSha, PACKAGE_PATH), readVersionFromRef(baseSha, MANIFEST_PATH)].filter(Boolean) : [],
      });
    });
}

function createSnapshot(label, changedFiles, payload) {
  const uniqueFiles = Array.from(new Set((changedFiles || []).filter(Boolean)));
  return {
    label,
    changedFiles: uniqueFiles,
    featureFiles: uniqueFiles.filter(isFeatureFacingFile),
    packageJson: payload.packageJson || {},
    manifestJson: payload.manifestJson || {},
    releaseCatalog: payload.releaseCatalog || readReleaseCatalog(root),
    baseVersions: Array.isArray(payload.baseVersions) ? payload.baseVersions.filter(Boolean) : [],
  };
}

function validateSnapshot(snapshot) {
  const currentVersion = String(snapshot.packageJson.version || "").trim();
  const manifestVersion = String(snapshot.manifestJson.version || "").trim();

  if (!currentVersion || currentVersion !== manifestVersion) {
    fail(`[${snapshot.label}] feature 변경이 있는데 package.json과 manifest.json 버전이 다르거나 비어 있어요.`);
  }

  const requiredMetadataFiles = [PACKAGE_PATH, MANIFEST_PATH, RELEASE_NOTES_PATH];
  const missingMetadataFiles = requiredMetadataFiles.filter((filePath) => !snapshot.changedFiles.includes(filePath));
  if (missingMetadataFiles.length) {
    fail([
      `[${snapshot.label}] feature 변경이 감지되었지만 버전/릴리스 메타 파일이 함께 바뀌지 않았어요.`,
      "다음 파일을 같이 업데이트해 주세요.",
      ...missingMetadataFiles.map((filePath) => `- ${filePath}`),
      "",
      "감지한 feature 변경 파일:",
      ...snapshot.featureFiles.map((filePath) => `- ${filePath}`),
    ].join("\n"));
  }

  snapshot.baseVersions.forEach((baseVersion) => {
    if (baseVersion && compareVersions(currentVersion, baseVersion) <= 0) {
      fail(`[${snapshot.label}] 현재 버전 ${currentVersion} 이(가) 기준 버전 ${baseVersion} 보다 높지 않아요. feature 변경에는 버전 상승이 필요합니다.`);
    }
  });

  const releaseEntry = findReleaseEntry(snapshot.releaseCatalog, currentVersion);
  const releaseErrors = validateReleaseEntry(releaseEntry, currentVersion);
  if (releaseErrors.length) {
    fail([
      `[${snapshot.label}] 현재 버전 ${currentVersion} 의 릴리스 메타가 비어 있거나 초안 상태예요.`,
      ...releaseErrors.map((error) => `- ${error}`),
      "",
      `확인 파일: ${RELEASE_NOTES_PATH}`,
    ].join("\n"));
  }
}

function extractRangeBase(range) {
  const normalized = String(range || "").trim();
  if (!normalized) return "HEAD";
  if (normalized.includes("...")) return normalized.split("...")[0] || "HEAD";
  if (normalized.includes("..")) return normalized.split("..")[0] || "HEAD";
  return normalized;
}

function extractRangeTarget(range) {
  const normalized = String(range || "").trim();
  if (!normalized) return "HEAD";
  if (normalized.includes("...")) return normalized.split("...")[1] || "HEAD";
  if (normalized.includes("..")) return normalized.split("..")[1] || "HEAD";
  return "HEAD";
}

function resolveNewBranchBase(localSha, remoteName) {
  const remoteHeadRef = readGitLines(["symbolic-ref", "-q", `refs/remotes/${remoteName}/HEAD`], { allowFailure: true })[0];
  if (remoteHeadRef) {
    const mergeBase = readGitLines(["merge-base", localSha, remoteHeadRef], { allowFailure: true })[0];
    if (mergeBase) {
      return mergeBase;
    }
  }

  const remoteRefs = readGitLines(["for-each-ref", "--format=%(refname)", `refs/remotes/${remoteName}`], { allowFailure: true });
  for (const remoteRef of remoteRefs) {
    const mergeBase = readGitLines(["merge-base", localSha, remoteRef], { allowFailure: true })[0];
    if (mergeBase) {
      return mergeBase;
    }
  }

  return "";
}

function getChangedFilesForArgs(args) {
  return readGitLines(args).filter(Boolean);
}

function readVersionFromRef(ref, relativePath) {
  return String(readJsonFromRef(ref, relativePath)?.version || "").trim();
}

function readJsonFromFile(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readJsonFromIndex(relativePath) {
  return readJsonFromGitObject(`:${toGitPath(relativePath)}`);
}

function readJsonFromRef(ref, relativePath) {
  const normalizedRef = String(ref || "").trim();
  if (!normalizedRef) return null;
  return readJsonFromGitObject(`${normalizedRef}:${toGitPath(relativePath)}`);
}

function readJsonFromGitObject(target) {
  try {
    const payload = execFileSync("git", ["show", target], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(String(payload || "{}"));
  } catch (error) {
    return null;
  }
}

function readReleaseCatalogFromIndex() {
  return normalizeReleaseCatalog(readJsonFromIndex(RELEASE_NOTES_PATH));
}

function readReleaseCatalogFromRef(ref) {
  return normalizeReleaseCatalog(readJsonFromRef(ref, RELEASE_NOTES_PATH));
}

function normalizeReleaseCatalog(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    schemaVersion: 1,
    ...payload,
    versions: Array.isArray(payload.versions) ? payload.versions.slice() : [],
  };
}

function readGitLines(args, options = {}) {
  try {
    const output = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return String(output || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if (options.allowFailure) {
      return [];
    }
    const stderr = String(error.stderr || "").trim();
    fail(stderr || `git ${args.join(" ")} 실행에 실패했어요.`);
  }
}

function isFeatureFacingFile(filePath) {
  return FEATURE_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function toGitPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
