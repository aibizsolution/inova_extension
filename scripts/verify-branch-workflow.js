#!/usr/bin/env node

const fs = require("fs");
const { execFileSync } = require("child_process");

const MAIN_BRANCHES = new Set(["main", "master"]);
const ALLOW_BYPASS = String(process.env.INOVA_ALLOW_MAIN_BRANCH || "").trim() === "1";

function main() {
  if (ALLOW_BYPASS) {
    console.log("브랜치 워크플로 가드 우회 허용");
    return;
  }

  const mode = String(process.argv[2] || "").trim();
  if (mode === "--pre-commit") {
    verifyCommitBranch();
    return;
  }

  verifyPushTarget();
}

function verifyCommitBranch() {
  const branchName = readCurrentBranch();
  if (!MAIN_BRANCHES.has(branchName)) {
    console.log(`브랜치 워크플로 가드 통과 (${branchName})`);
    return;
  }

  fail([
    `현재 브랜치가 ${branchName} 입니다.`,
    "main 브랜치에서 직접 commit 하지 말고 작업 브랜치를 먼저 만들어 주세요.",
    "권장 형식: git switch -c codex/<task-name>",
    "긴급 예외가 꼭 필요하면 INOVA_ALLOW_MAIN_BRANCH=1 환경변수로 한 번만 우회할 수 있습니다.",
  ].join("\n"));
}

function verifyPushTarget() {
  const stdin = fs.readFileSync(0, "utf8");
  const lines = String(stdin || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [localRef, localSha, remoteRef] = line.split(/\s+/);
    if (!localRef || !localSha || !remoteRef) continue;
    if (remoteRef === "refs/heads/main") {
      fail([
        "main 브랜치로 직접 push 할 수 없게 막아 두었습니다.",
        `감지된 push: ${localRef} -> ${remoteRef}`,
        "작업 브랜치를 push 한 뒤 PR로 머지해 주세요.",
        "긴급 예외가 꼭 필요하면 INOVA_ALLOW_MAIN_BRANCH=1 환경변수로 한 번만 우회할 수 있습니다.",
      ].join("\n"));
    }
  }

  console.log("브랜치 워크플로 가드 통과");
}

function readCurrentBranch() {
  try {
    return String(execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || "").trim();
  } catch {
    fail("현재 Git 브랜치를 확인하지 못했어요.");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
