#!/usr/bin/env node

const { spawn } = require("child_process");

const PROJECT_ID = "browser-extension-main";
const DEFAULT_LOCAL_ADMIN_EMAILS = Object.freeze([
  "youngtack.park@incross.com",
]);
const FIREBASE_ARGS = Object.freeze([
  "emulators:start",
  "--only",
  "auth,firestore,functions,hosting,storage",
  "--project",
  PROJECT_ID,
]);

function main() {
  const localAdminEmails = mergeList(
    DEFAULT_LOCAL_ADMIN_EMAILS,
    readDelimitedList(process.env.INOVA_LOCAL_ADMIN_EMAILS)
  );
  const env = {
    ...process.env,
    INOVA_ADMIN_EMAILS: mergeList(
      readDelimitedList(process.env.INOVA_ADMIN_EMAILS),
      localAdminEmails
    ).join(","),
  };

  if (localAdminEmails.length) {
    console.log(`[emulator:meeting-local] local admin emails: ${localAdminEmails.join(", ")}`);
  }

  const command = buildFirebaseCommand();
  const child = spawn(command.file, command.args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code === null ? 1 : code;
  });
}

function buildFirebaseCommand() {
  if (process.platform === "win32") {
    return {
      file: "cmd.exe",
      args: ["/d", "/s", "/c", "firebase", ...FIREBASE_ARGS],
    };
  }
  return {
    file: "firebase",
    args: FIREBASE_ARGS,
  };
}

function readDelimitedList(value) {
  return String(value || "")
    .split(/[,\s;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeList(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const rawEntry of Array.isArray(list) ? list : []) {
      const entry = String(rawEntry || "").trim().toLowerCase();
      if (!entry || seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      merged.push(entry);
    }
  }
  return merged;
}

main();
