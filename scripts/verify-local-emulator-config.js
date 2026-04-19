#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const scriptSource = fs.readFileSync(path.join(root, "scripts", "run-meeting-local-emulator.js"), "utf8");

assert.equal(
  packageJson.scripts["emulator:meeting-local"],
  "node scripts/run-meeting-local-emulator.js",
  "emulator:meeting-local should use the local wrapper"
);
assert(
  scriptSource.includes("youngtack.park@incross.com")
    && scriptSource.includes("INOVA_ADMIN_EMAILS")
    && scriptSource.includes("INOVA_LOCAL_ADMIN_EMAILS"),
  "local emulator wrapper should inject the default local admin email and support extra local admins"
);
assert(
  scriptSource.includes("auth,firestore,functions,hosting,storage")
    && scriptSource.includes("--project")
    && scriptSource.includes("browser-extension-main"),
  "local emulator wrapper should keep the standard full-stack emulator target"
);

console.log("[verify-local-emulator-config] Local emulator config passed");
