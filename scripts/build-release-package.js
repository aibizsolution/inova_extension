#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const manifestJson = readJson("manifest.json");
const version = String(packageJson.version || "");
const manifestVersion = String(manifestJson.version || "");
if (!version || version !== manifestVersion) {
  throw new Error("package.json과 manifest.json 버전이 다르거나 비어 있어요.");
}

const date = new Date().toISOString().slice(0, 10);
const bundleName = `inova-extension-${version}-${date}`;
const releasesDir = path.join(root, "releases");
const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `${bundleName}-`));
const zipPath = path.join(releasesDir, `${bundleName}.zip`);
const hostingRoot = path.join(root, "hosting", "extension");
const hostingDownloadDir = path.join(hostingRoot, "downloads");
const hostingReleaseDir = path.join(hostingRoot, "releases");
const hostingBaseUrl = "https://browser-extension-main.web.app/extension";
const publishedAt = new Date().toISOString();
const runtimeItems = ["manifest.json", "background", "content", "icons", "popup", "shared", "README.md"];
const notes = getReleaseNotes();

for (const item of runtimeItems) {
  fs.cpSync(path.join(root, item), path.join(stagingDir, item), { force: true, recursive: true });
}
fs.mkdirSync(releasesDir, { recursive: true });
compressDirectory(stagingDir, zipPath);
fs.rmSync(stagingDir, { force: true, recursive: true });

fs.mkdirSync(hostingDownloadDir, { recursive: true });
fs.mkdirSync(hostingReleaseDir, { recursive: true });
const hostingZipPath = path.join(hostingDownloadDir, `${bundleName}.zip`);
fs.copyFileSync(zipPath, hostingZipPath);

const sizeBytes = fs.statSync(zipPath).size;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
const release = {
  version,
  publishedAt,
  fileName: `${bundleName}.zip`,
  downloadUrl: `${hostingBaseUrl}/downloads/${bundleName}.zip`,
  notes,
  sha256,
  sizeBytes,
  minSupportedVersion: version,
};

const latestPath = path.join(hostingReleaseDir, "latest.json");
const historyPath = path.join(hostingReleaseDir, "history.json");
const history = readJsonSafe(historyPath)?.releases || [];
const nextHistory = [release, ...history.filter((item) => String(item?.version || "") !== version)];
writeJson(latestPath, {
  product: buildProductMeta(),
  release,
});
writeJson(historyPath, {
  product: buildProductMeta(),
  releases: nextHistory.slice(0, 30),
});

console.log(`[release-build] version=${version}`);
console.log(`[release-build] zip=${zipPath}`);
console.log(`[release-build] latest=${latestPath}`);
console.log(`[release-build] history=${historyPath}`);

function buildProductMeta() {
  return {
    experimental: true,
    name: "i-Nova 더하기",
    team: "AI비즈솔루션팀",
  };
}

function compressDirectory(sourceDir, destinationPath) {
  fs.rmSync(destinationPath, { force: true });
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${escapePowerShell(sourceDir)}', '${escapePowerShell(destinationPath)}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`,
  ].join("; ");
  const result = spawnSync("powershell", ["-NoLogo", "-NoProfile", "-Command", command], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "ZIP 생성에 실패했어요.");
  }
}

function getReleaseNotes() {
  const flagIndex = process.argv.findIndex((item) => item === "--notes");
  if (flagIndex >= 0 && process.argv[flagIndex + 1]) return String(process.argv[flagIndex + 1]).trim();
  const result = spawnSync("git", ["log", "-1", "--pretty=%s"], { cwd: root, encoding: "utf8", stdio: "pipe" });
  return String(result.stdout || "").trim() || "수동 배포본";
}

function writeJson(targetPath, payload) {
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readJsonSafe(targetPath) {
  if (!fs.existsSync(targetPath)) return null;
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function escapePowerShell(targetPath) {
  return String(targetPath).replace(/'/g, "''");
}
