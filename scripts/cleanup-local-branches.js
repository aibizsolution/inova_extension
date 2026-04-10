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

  const upstreamRef = readUpstreamRef(currentBranch);
  if (!upstreamRef) {
    console.log(`로컬 브랜치 정리 생략 (${currentBranch} upstream 없음)`);
    return;
  }

  const remoteName = readRemoteName(upstreamRef);
  if (!remoteName) {
    console.log(`로컬 브랜치 정리 생략 (${upstreamRef} remote 해석 실패)`);
    return;
  }

  if (!fetchRemote(remoteName)) {
    console.log(`로컬 브랜치 정리 생략 (${remoteName} fetch 실패)`);
    return;
  }

  if (!refsPointToSameCommit(`refs/heads/${currentBranch}`, upstreamRef)) {
    console.log(`로컬 브랜치 정리 생략 (${currentBranch} != ${upstreamRef})`);
    return;
  }

  const cleanupTargets = readGitLines(["for-each-ref", "--format=%(refname:short)", "refs/heads"]).filter(
    (branchName) => CODEx_BRANCH_PATTERN.test(branchName) && branchName !== currentBranch
  );
  if (!cleanupTargets.length) {
    console.log("정리할 로컬 작업 브랜치가 없습니다.");
    return;
  }

  const deletedBranches = [];
  const skippedBranches = [];
  for (const branchName of cleanupTargets) {
    if (!isAncestor(`refs/heads/${branchName}`, upstreamRef)) {
      skippedBranches.push(branchName);
      console.log(`[branch-cleanup] ${branchName} 정리 보류: ${upstreamRef} 기준 미병합`);
      continue;
    }

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
  } else if (!skippedBranches.length) {
    console.log("삭제된 로컬 작업 브랜치는 없습니다.");
  }
}

function readCurrentBranch() {
  const branchName = String(
    execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || ""
  ).trim();
  if (!branchName) {
    throw new Error("현재 Git 브랜치를 확인하지 못했어요.");
  }
  return branchName;
}

function readUpstreamRef(branchName) {
  try {
    return String(
      execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branchName}@{upstream}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }) || ""
    ).trim();
  } catch (error) {
    return "";
  }
}

function readRemoteName(upstreamRef) {
  const match = String(upstreamRef || "").match(/^([^/]+)\//);
  return match ? match[1] : "";
}

function fetchRemote(remoteName) {
  const result = spawnSync("git", ["fetch", remoteName, "--prune"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0) {
    return true;
  }

  const message = String(result.stderr || result.stdout || "").trim();
  console.warn(`[branch-cleanup] ${remoteName} fetch 실패: ${message || "알 수 없는 오류"}`);
  return false;
}

function refsPointToSameCommit(leftRef, rightRef) {
  try {
    return readCommit(leftRef) === readCommit(rightRef);
  } catch (error) {
    console.warn(`[branch-cleanup] ref 비교 실패: ${leftRef} <-> ${rightRef}`);
    return false;
  }
}

function isAncestor(ancestorRef, descendantRef) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestorRef, descendantRef], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

function readCommit(ref) {
  return String(
    execFileSync("git", ["rev-parse", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || ""
  ).trim();
}

function readGitLines(args) {
  return String(
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || ""
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

main();
