#!/usr/bin/env node

const path = require("path");
const { syncLegacyLatestCompatibilityAliasFromCanonical } = require("./release-compat-alias");

const result = syncLegacyLatestCompatibilityAliasFromCanonical({
  root: path.resolve(__dirname, ".."),
});

console.log(`[release-compat] latest-zip=${result.latestZipPath}`);
console.log(`[release-compat] latest=${result.latestJsonPath}`);
console.log(`[release-compat] history=${result.historyJsonPath}`);
