#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const ZERO_SHA = "0000000000000000000000000000000000000000";

const E2E_DOC_RULES = [
  {
    feature: "meeting",
    docs: ["docs/e2e/features/meeting.md"],
    patterns: [
      /^hosting\/extension-v2\/panel\/meeting.*\.js$/,
      /^hosting\/meeting\/.*\.(js|html|css)$/,
      /^functions\/features\/meeting\/.*\.(js|json)$/,
      /^background\/meeting-workspace-capability\.js$/,
    ],
  },
  {
    feature: "conversation",
    docs: ["docs/e2e-browser-workflow.md"],
    patterns: [
      /^hosting\/extension-v2\/panel\/conversation.*\.js$/,
      /^content\/dom\.js$/,
      /^content\/page-capability-router\.js$/,
      /^content\/route-/,
    ],
  },
  {
    feature: "prompt",
    docs: ["docs/e2e-browser-workflow.md"],
    patterns: [
      /^hosting\/extension-v2\/panel\/prompt.*\.js$/,
      /^hosting\/extension-v2\/panel\/store.*\.js$/,
      /^content\/features\/prompt-/,
      /^functions\/features\/prompt-/,
      /^functions\/shared\/prompt-/,
    ],
  },
  {
    feature: "release",
    docs: ["docs/e2e-browser-workflow.md"],
    patterns: [
      /^hosting\/extension-v2\/panel\/release.*\.js$/,
      /^releases\/release-notes\.json$/,
      /^scripts\/build-release-package\.js$/,
      /^scripts\/verify-release-/,
    ],
  },
  {
    feature: "runtime-security-deploy",
    docs: ["docs/e2e-browser-workflow.md"],
    patterns: [
      /^background\/cloud-api-client\.js$/,
      /^background\/functions-runtime-config\.js$/,
      /^background\/panel-runtime-capability-router\.js$/,
      /^hosting\/extension-v2\/capability-manifest\.json$/,
      /^hosting\/extension\/capability-manifest\.json$/,
      /^firestore\.rules$/,
      /^firestore\.indexes\.json$/,
      /^firebase\.json$/,
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

  const uniqueFiles = Array.from(new Set(changedFiles.map(normalizePath).filter(Boolean)));
  const failures = E2E_DOC_RULES
    .map((rule) => buildRuleFailure(rule, uniqueFiles))
    .filter(Boolean);

  if (failures.length > 0) {
    fail([
      "E2E 문서 가드 실패: 사용자-visible 기능/권한/배포 검증 변경에 대응하는 브라우저 테스트 문서가 빠졌습니다.",
      "상용 배포나 PR 전, 감지된 기능의 실제 버튼/탭/DB 확인 항목을 문서에 반영하세요.",
      "",
      ...failures.flatMap((failure) => [
        `[${failure.feature}]`,
        `필요 문서: ${failure.docs.join(", ")}`,
        "감지한 변경 파일:",
        ...failure.files.map((file) => `- ${file}`),
        "",
      ]),
    ].join("\n").trim());
  }

  console.log("E2E 문서 가드 통과");
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
    feature: rule.feature,
    files: impactedFiles,
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
  for (const remoteRef of remoteRefs) {
    const mergeBase = readGitLines(["merge-base", localSha, remoteRef], { allowFailure: true })[0];
    if (mergeBase) {
      return mergeBase;
    }
  }

  return "";
}

function getChangedFilesForArgs(args) {
  return readGitLines(args).map(normalizePath).filter(Boolean);
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

function normalizePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
