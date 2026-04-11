#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const cleanupScriptPath = path.join(root, "scripts", "cleanup-local-branches.js");

function main() {
  verifyCleanupSkipsWhenLocalMainIsAheadOfOrigin();
  verifyCleanupDeletesOnlyAfterOriginMainCatchesUp();
  verifyCleanupDeletesSquashMergedCodexBranches();
  verifyCleanupSkipsUnmergedCodexBranches();
  console.log("[verify-branch-cleanup] Branch cleanup guard passed");
}

function verifyCleanupSkipsWhenLocalMainIsAheadOfOrigin() {
  const repo = createHarnessRepo();

  createAndCommitCodexBranch(repo, "codex/local-only");
  checkout(repo, "main");
  mergeIntoMain(repo, "codex/local-only");

  const result = runCleanup(repo);
  assert.equal(result.status, 0, readCombinedOutput(result));
  assert(branchExists(repo, "codex/local-only"), "local-only merged branch should not be deleted before origin/main catches up");
  assert(
    readCombinedOutput(result).includes("main != origin/main"),
    `expected stale main skip message, got:\n${readCombinedOutput(result)}`
  );
}

function verifyCleanupDeletesOnlyAfterOriginMainCatchesUp() {
  const repo = createHarnessRepo();

  createAndCommitCodexBranch(repo, "codex/merged-safe");
  checkout(repo, "main");
  mergeIntoMain(repo, "codex/merged-safe");
  runGit(repo, ["push", "origin", "main"]);

  const result = runCleanup(repo);
  assert.equal(result.status, 0, readCombinedOutput(result));
  assert.equal(branchExists(repo, "codex/merged-safe"), false, "merged branch should be deleted after origin/main catches up");
  assert(
    readCombinedOutput(result).includes("삭제한 로컬 작업 브랜치: codex/merged-safe"),
    `expected delete message, got:\n${readCombinedOutput(result)}`
  );
}

function verifyCleanupDeletesSquashMergedCodexBranches() {
  const repo = createHarnessRepo();

  createAndCommitCodexBranch(repo, "codex/squash-merged");
  checkout(repo, "main");
  squashMergeIntoMain(repo, "codex/squash-merged");
  runGit(repo, ["push", "origin", "main"]);

  const result = runCleanup(repo);
  assert.equal(result.status, 0, readCombinedOutput(result));
  assert.equal(branchExists(repo, "codex/squash-merged"), false, "squash-merged branch should be deleted after origin/main catches up");
  assert(
    readCombinedOutput(result).includes("삭제한 로컬 작업 브랜치: codex/squash-merged"),
    `expected squash-merged delete message, got:\n${readCombinedOutput(result)}`
  );
}

function verifyCleanupSkipsUnmergedCodexBranches() {
  const repo = createHarnessRepo();

  createAndCommitCodexBranch(repo, "codex/unmerged");
  checkout(repo, "main");

  const result = runCleanup(repo);
  assert.equal(result.status, 0, readCombinedOutput(result));
  assert(branchExists(repo, "codex/unmerged"), "unmerged branch must stay");
  assert(
    readCombinedOutput(result).includes("codex/unmerged 정리 보류"),
    `expected unmerged skip message, got:\n${readCombinedOutput(result)}`
  );
}

function createHarnessRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inova-branch-cleanup-"));
  const originDir = path.join(tempRoot, "origin.git");
  const workDir = path.join(tempRoot, "work");

  runGit(tempRoot, ["init", "--bare", originDir]);
  runGit(tempRoot, ["clone", originDir, workDir]);
  runGit(workDir, ["config", "user.name", "Inova Test"]);
  runGit(workDir, ["config", "user.email", "inova-test@example.com"]);
  runGit(workDir, ["switch", "-c", "main"]);

  fs.writeFileSync(path.join(workDir, "README.md"), "seed\n", "utf8");
  runGit(workDir, ["add", "README.md"]);
  runGit(workDir, ["commit", "-m", "seed"]);
  runGit(workDir, ["push", "-u", "origin", "main"]);

  return workDir;
}

function createAndCommitCodexBranch(repoDir, branchName) {
  checkoutNew(repoDir, branchName);
  const fileName = `${branchName.replace(/[\\/]/g, "_")}.txt`;
  fs.writeFileSync(path.join(repoDir, fileName), `${branchName}\n`, "utf8");
  runGit(repoDir, ["add", fileName]);
  runGit(repoDir, ["commit", "-m", `add ${branchName}`]);
}

function mergeIntoMain(repoDir, branchName) {
  runGit(repoDir, ["merge", "--no-ff", branchName, "-m", `merge ${branchName}`]);
}

function squashMergeIntoMain(repoDir, branchName) {
  runGit(repoDir, ["merge", "--squash", branchName]);
  runGit(repoDir, ["commit", "-m", `squash merge ${branchName}`]);
}

function checkout(repoDir, branchName) {
  runGit(repoDir, ["switch", branchName]);
}

function checkoutNew(repoDir, branchName) {
  runGit(repoDir, ["switch", "-c", branchName]);
}

function runCleanup(repoDir) {
  return spawnSync("node", [cleanupScriptPath], {
    cwd: repoDir,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function readCombinedOutput(result) {
  return `${String(result.stdout || "")}${String(result.stderr || "")}`.trim();
}

function branchExists(repoDir, branchName) {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
    cwd: repoDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0) {
    return String(result.stdout || "").trim();
  }

  const output = String(result.stderr || result.stdout || "").trim();
  throw new Error(`git ${args.join(" ")} failed in ${cwd}\n${output}`);
}

main();
