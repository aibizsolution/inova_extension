#!/usr/bin/env node

const { execSync } = require("child_process");

const defaults = {
  projectId: "browser-extension-main",
  sinceMinutes: 10,
  limit: 200,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`[function-logs] project=${options.projectId}`);
  console.log(`[function-logs] since=${options.sinceMinutes}m`);

  const syncLogs = readLogs(options.projectId, 'resource.type="cloud_run_revision" AND resource.labels.service_name:"syncinovapromptlibrary"', options);
  const peekLogs = readLogs(options.projectId, 'resource.type="cloud_run_revision" AND resource.labels.service_name:"peekinovapromptlibrary"', options);
  const loadLogs = readLogs(options.projectId, 'resource.type="cloud_run_revision" AND resource.labels.service_name:"loadinovapromptlibrary"', options);
  const entries = [...syncLogs, ...peekLogs, ...loadLogs].sort((left, right) => String(left.timestamp || "").localeCompare(String(right.timestamp || "")));

  printSummary(entries);
}

function readLogs(projectId, filter, options) {
  const raw = runGcloudLoggingRead(filter, projectId, options);

  try {
    return JSON.parse(raw || "[]");
  } catch (error) {
    throw new Error(`로그 JSON 파싱 실패: ${error.message}`);
  }
}

function printSummary(entries) {
  const eventCounts = new Map();
  const requestCounts = new Map();
  const recentEvents = [];

  for (const entry of entries) {
    const serviceName = entry?.resource?.labels?.service_name || "";
    const requestUrl = entry?.httpRequest?.requestUrl || "";
    if (requestUrl.includes("loadInovaPromptLibrary")) {
      requestCounts.set("load.request", (requestCounts.get("load.request") || 0) + 1);
    }
    if (requestUrl.includes("peekInovaPromptLibrary")) {
      requestCounts.set("peek.request", (requestCounts.get("peek.request") || 0) + 1);
    }
    if (requestUrl.includes("syncInovaPromptLibrary")) {
      requestCounts.set("sync.request", (requestCounts.get("sync.request") || 0) + 1);
    }

    const event = entry?.jsonPayload?.event || "";
    if (event) {
      eventCounts.set(event, (eventCounts.get(event) || 0) + 1);
      recentEvents.push({
        event,
        payload: entry?.jsonPayload?.payload || {},
        serviceName,
        timestamp: entry?.timestamp || "",
      });
    }
  }

  console.log("\n[summary]");
  for (const name of ["load.request", "load.start", "load.success", "load.error", "peek.request", "peek.start", "peek.success", "peek.error", "sync.request", "sync.start", "sync.success", "sync.error"]) {
    const count = requestCounts.get(name) || eventCounts.get(name) || 0;
    console.log(`  ${name}: ${count}`);
  }

  if (recentEvents.length) {
    console.log("\n[recent events]");
    recentEvents.slice(-12).forEach((entry) => {
      console.log(
        `  ${entry.timestamp} ${entry.event} reason=${entry.payload.reason || "-"} revision=${entry.payload.revision || "-"} itemCount=${entry.payload.itemCount ?? "-"}`
      );
    });
  }

  const syncRequests = requestCounts.get("sync.request") || 0;
  const syncSuccess = eventCounts.get("sync.success") || 0;
  if (syncRequests > 1 || syncSuccess > 1) {
    console.log("\n[hint]");
    console.log("  최근 구간에 sync 호출이 여러 번 보입니다. 저장 1회 기준으로는 과호출 여부를 추가 확인하세요.");
  }
}

function runGcloudLoggingRead(filter, projectId, options) {
  const safeFilter = String(filter || "").replace(/"/g, '\\"');
  const command = [
    "gcloud.cmd logging read",
    `"${safeFilter}"`,
    `--project ${projectId}`,
    `--freshness=${options.sinceMinutes}m`,
    `--limit ${options.limit}`,
    "--format=json",
  ].join(" ");

  try {
    return execSync(command, {
      encoding: "utf8",
      shell: "cmd.exe",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    const suffix = stderr ? ` ${stderr}` : "";
    throw new Error(`gcloud logging read를 실행하지 못했어요.${suffix}`.trim());
  }
}

function parseArgs(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--project") {
      options.projectId = String(args[index + 1] || defaults.projectId).trim();
      index += 1;
      continue;
    }
    if (value === "--since") {
      options.sinceMinutes = Math.max(1, Number(args[index + 1] || defaults.sinceMinutes));
      index += 1;
      continue;
    }
    if (value === "--limit") {
      options.limit = Math.max(1, Number(args[index + 1] || defaults.limit));
      index += 1;
    }
  }
  return options;
}

main().catch((error) => {
  console.error(`[function-logs] ${error.message}`);
  process.exit(1);
});
