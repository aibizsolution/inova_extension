#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const ZERO_SHA = "0000000000000000000000000000000000000000";
const REFACTOR_PLAN_DOC = "docs/refactoring-plan.md";

const REFACTOR_PLAN_RULES = [
  {
    scope: "version-lane-policy",
    docs: [REFACTOR_PLAN_DOC],
    patterns: [
      /^shared\/product-lane\.js$/,
      /^shared\/firebase-config\.js$/,
      /^shared\/storage\.js$/,
      /^scripts\/build-release-package\.js$/,
      /^manifest\.json$/,
      /^package\.json$/,
      /^firestore\.rules$/,
      /^docs\/release-workflow\.md$/,
      /^docs\/feature-routing\.md$/,
    ],
  },
  {
    scope: "meeting-refactor-boundary",
    docs: [REFACTOR_PLAN_DOC],
    patterns: [
      /^background\/service-worker\.js$/,
      /^popup\/index\.js$/,
      /^content\/meeting-manager\.js$/,
      /^content\/meeting-view\.js$/,
      /^hosting\/meeting\//,
      /^functions\/features\/meeting\//,
      /^functions\/index\.js$/,
      /^content\/features\/meeting\/AGENTS\.md$/,
    ],
  },
  {
    scope: "prompt-v2-foundation",
    docs: [REFACTOR_PLAN_DOC],
    patterns: [
      /^functions\/features\/prompt-library\/register\.js$/,
      /^content\/features\/prompt-library\/cloud-sync-manager\.js$/,
      /^content\/features\/prompt-store\/prompt-realtime-manager\.js$/,
      /^hosting\/extension\/prompt-panel-bridge\.js$/,
    ],
  },
];

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "";
  let changedFiles;

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
  const failures = REFACTOR_PLAN_RULES
    .map((rule) => buildRuleFailure(rule, uniqueFiles))
    .filter(Boolean);

  if (failures.length > 0) {
    fail([
      "refactor-sensitive 파일이 바뀌었는데 docs/refactoring-plan.md가 같이 갱신되지 않았어요.",
      "리팩토링 진행 상태, 버전 결정 기준, 다음 시작점을 이 문서에 먼저 맞춰 주세요.",
      "",
      ...failures.flatMap((failure) => [
        `[${failure.scope}]`,
        `필수 문서: ${failure.docs.join(", ")}`,
        "감지한 변경 파일:",
        ...failure.files.map((file) => `- ${file}`),
        "",
      ]),
    ].join("\n").trim());
  }

  console.log("Refactoring plan 업데이트 가드 통과");
}

function buildRuleFailure(rule, changedFiles) {
  const impactedFiles = changedFiles.filter((filePath) => rule.patterns.some((pattern) => pattern.test(filePath)));
  if (impactedFiles.length === 0) {
    return null;
  }

  const docsUpdated = rule.docs.some((docPath) => changedFiles.includes(docPath));
  if (docsUpdated) {
    return null;
  }

  return {
    docs: rule.docs,
    files: impactedFiles,
    scope: rule.scope,
  };
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
