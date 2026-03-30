#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const ZERO_SHA = "0000000000000000000000000000000000000000";
const README_PATH = "README.md";
const FEATURE_PATH_PATTERNS = [
  /^background\//,
  /^content\//,
  /^functions\//,
  /^meeting\//,
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
  let changedFiles = [];

  if (mode === "--staged") {
    changedFiles = getChangedFilesForArgs(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  } else if (mode === "--range") {
    const range = args[1];
    if (!range) {
      fail("`--range` 다음에 비교 범위를 넣어 주세요. 예: --range origin/main..HEAD");
    }
    changedFiles = getChangedFilesForArgs(["diff", "--name-only", "--diff-filter=ACMR", range]);
  } else {
    const remoteName = args[0] || "origin";
    const stdin = fs.readFileSync(0, "utf8");
    changedFiles = getChangedFilesForPush(stdin, remoteName);
  }

  const uniqueFiles = Array.from(new Set(changedFiles.filter(Boolean)));
  const featureFiles = uniqueFiles.filter(isFeatureFacingFile);
  const readmeChanged = uniqueFiles.includes(README_PATH);

  if (featureFiles.length > 0 && !readmeChanged) {
    fail([
      "기능 관련 파일이 바뀌었는데 README.md 변경이 함께 잡히지 않았어요.",
      "README.md도 같이 업데이트한 뒤 다시 push 해 주세요.",
      "",
      "감지한 기능 변경 파일:",
      ...featureFiles.map((file) => `- ${file}`),
    ].join("\n"));
  }

  console.log("README 업데이트 가드 통과");
}

function getChangedFilesForPush(stdin, remoteName) {
  const lines = String(stdin || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const files = new Set();
  for (const line of lines) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha) {
      continue;
    }
    if (localSha === ZERO_SHA) {
      continue;
    }

    const baseSha = remoteSha !== ZERO_SHA ? remoteSha : resolveNewBranchBase(localSha, remoteName);
    const diffArgs = baseSha
      ? ["diff", "--name-only", "--diff-filter=ACMR", `${baseSha}..${localSha}`]
      : ["show", "--pretty=", "--name-only", "--diff-filter=ACMR", localSha];

    for (const file of getChangedFilesForArgs(diffArgs)) {
      files.add(file);
    }
  }

  return Array.from(files);
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
  if (!remoteRefs.length) {
    return "";
  }

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

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
