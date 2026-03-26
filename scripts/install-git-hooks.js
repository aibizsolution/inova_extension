#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hookPath = path.join(root, ".githooks", "pre-push");

function main() {
  if (!fs.existsSync(hookPath)) {
    console.error("Git 훅 파일이 없습니다: .githooks/pre-push");
    process.exit(1);
  }

  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      cwd: root,
      stdio: "inherit",
    });
  } catch (error) {
    console.error(`Git hooksPath를 설정하지 못했어요: ${error.message}`);
    process.exit(1);
  }

  console.log("이 저장소의 Git hooksPath를 .githooks 로 설정했습니다.");
}

main();
