#!/usr/bin/env node

const { execFileSync, spawnSync } = require("child_process");

const MAIN_BRANCHES = new Set(["main", "master"]);
const CODEx_BRANCH_PATTERN = /^codex\//;
const SKIP_CLEANUP = String(process.env.INOVA_SKIP_BRANCH_CLEANUP || "").trim() === "1";

function main() {
  if (SKIP_CLEANUP) {
    console.log("로컬 브랜치 정리 건너뜀");
    return;
  }

  const currentBranch = readCurrentBranch();
  if (!MAIN_BRANCHES.has(currentBranch)) {
    console.log(`로컬 브랜치 정리 생략 (${currentBranch})`);
    return;
  }

  const mergedBranches = readGitLines(["branch", "--format=%(refname:short)", "--merged"]);
  const cleanupTargets = mergedBranches.filter((branchName) => CODEx_BRANCH_PATTERN.test(branchName) && branchName !== currentBranch);
  if (!cleanupTargets.length) {
    console.log("정리할 로컬 작업 브랜치가 없습니다.");
    return;
  }

  const deletedBranches = [];
  for (const branchName of cleanupTargets) {
    const result = spawnSync("git", ["branch", "-d", branchName], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.status === 0) {
      deletedBranches.push(branchName);
      continue;
    }

    const message = String(result.stderr || result.stdout || "").trim();
    console.warn(`[branch-cleanup] ${branchName} 삭제 생략: ${message || "알 수 없는 오류"}`);
  }

  if (deletedBranches.length) {
    console.log(`삭제한 로컬 작업 브랜치: ${deletedBranches.join(", ")}`);
  } else {
    console.log("삭제된 로컬 작업 브랜치는 없습니다.");
  }
}

function readCurrentBranch() {
  const branchName = String(execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }) || "").trim();
  if (!branchName) {
    throw new Error("현재 Git 브랜치를 확인하지 못했어요.");
  }
  return branchName;
}

function readGitLines(args) {
  return String(execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }) || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

main();
