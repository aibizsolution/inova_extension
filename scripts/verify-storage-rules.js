#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ACTIVE_CLIENT_DIRS = [
  "background",
  "content",
  "hosting",
  "popup",
  "shared",
];
const CLIENT_STORAGE_SDK_PATTERNS = [
  /\bfirebase\s*\.\s*storage\s*\(/,
  /\bgetStorage\s*\(/,
  /\bconnectStorageEmulator\s*\(/,
  /\buploadBytes(?:Resumable)?\s*\(/,
  /\bgetDownloadURL\s*\(/,
  /\bdeleteObject\s*\(/,
  /\blistAll\s*\(/,
];

const storageRulesPath = path.join(ROOT, "storage.rules");
const storageRules = fs.readFileSync(storageRulesPath, "utf8");

assert(
  /allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(storageRules),
  "storage.rules should deny direct client reads and writes by default"
);
assert(
  !/allow\s+read\s*,\s*write\s*:\s*if\s+request\.auth\s*!=\s*null\s*;/.test(storageRules),
  "storage.rules must not allow the whole bucket to any authenticated user"
);

for (const dir of ACTIVE_CLIENT_DIRS) {
  const absoluteDir = path.join(ROOT, dir);
  if (!fs.existsSync(absoluteDir)) continue;
  for (const filePath of walkFiles(absoluteDir)) {
    if (!/\.(?:js|html)$/i.test(filePath)) continue;
    const source = fs.readFileSync(filePath, "utf8");
    const matchedPattern = CLIENT_STORAGE_SDK_PATTERNS.find((pattern) => pattern.test(source));
    assert(
      !matchedPattern,
      `active client must not directly call Firebase Storage SDK: ${path.relative(ROOT, filePath)}`
    );
  }
}

console.log("[verify-storage-rules] Storage rules and client boundary passed");

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
      continue;
    }
    if (entry.isFile()) {
      yield entryPath;
    }
  }
}
