#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  path.join("docs", "runtime-architecture.md"),
  path.join("fixtures", "inova-chat-session.html"),
  path.join("scripts", "verify-content-smoke.js"),
];

const architectureKeywords = [
  "Popup",
  "Content Script",
  "Background Service Worker",
  "Firebase Functions",
  "Firestore / Hosting",
  "권위 있는 소스",
  "검증 표면",
];

const fixtureKeywords = [
  'aria-label="채팅 기록"',
  "chat-message--user",
  "chat-input__textarea",
];

function main() {
  const errors = [];

  for (const relativePath of requiredFiles) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`하네스 필수 파일이 없습니다: ${relativePath}`);
    }
  }

  const architecturePath = path.join(root, "docs", "runtime-architecture.md");
  if (fs.existsSync(architecturePath)) {
    const text = fs.readFileSync(architecturePath, "utf8");
    for (const keyword of architectureKeywords) {
      if (!text.includes(keyword)) {
        errors.push(`runtime architecture 문서에 핵심 키워드가 없습니다: ${keyword}`);
      }
    }
  }

  const fixturePath = path.join(root, "fixtures", "inova-chat-session.html");
  if (fs.existsSync(fixturePath)) {
    const text = fs.readFileSync(fixturePath, "utf8");
    for (const keyword of fixtureKeywords) {
      if (!text.includes(keyword)) {
        errors.push(`fixture에 핵심 표식이 없습니다: ${keyword}`);
      }
    }
  }

  if (errors.length) {
    console.error("하네스 검증 실패");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("하네스 검증 통과");
}

main();
