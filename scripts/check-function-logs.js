#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const defaults = {
  errorsOnly: false,
  filter: "",
  functions: [],
  limit: 80,
  projectId: readDefaultProjectId(),
  recentCount: 6,
  sinceMinutes: 60,
};

function main() {
  const options = parseArgs(process.argv.slice(2));
  const functions = selectFunctions(loadExportedFunctions(), options);
  if (!functions.length) {
    throw new Error("조회할 함수가 없어요. --filter 또는 --functions 값을 확인하세요.");
  }

  console.log(`[function-logs] project=${options.projectId}`);
  console.log(`[function-logs] since=${options.sinceMinutes}m limit=${options.limit}`);
  console.log(`[function-logs] functions=${functions.length}`);
  console.log(`[function-logs] mode=${options.errorsOnly ? "errors-only" : "all"}`);

  const rows = [];
  for (const functionName of functions) {
    const serviceName = buildServiceName(functionName);
    const entries = readServiceLogs(serviceName, options);
    rows.push({
      functionName,
      serviceName,
      summary: summarizeLogs(entries, options.recentCount),
    });
  }

  printSummary(rows);
  printRecent(rows);
}

function loadExportedFunctions() {
  const filePath = path.join(process.cwd(), "functions", "index.js");
  const source = fs.readFileSync(filePath, "utf8");
  const matches = [...source.matchAll(/^exports\.(\w+)\s*=/gm)];
  return matches.map((match) => match[1]).sort((left, right) => left.localeCompare(right));
}

function selectFunctions(functionNames, options) {
  const explicit = new Set(options.functions.map((value) => value.trim()).filter(Boolean));
  return functionNames.filter((name) => {
    if (explicit.size && !explicit.has(name)) {
      return false;
    }
    if (options.filter && !name.toLowerCase().includes(options.filter.toLowerCase())) {
      return false;
    }
    return true;
  });
}

function buildServiceName(functionName) {
  return String(functionName || "").toLowerCase();
}

function readServiceLogs(serviceName, options) {
  const filterParts = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${serviceName}"`,
  ];

  if (options.errorsOnly) {
    filterParts.push(
      [
        "severity>=ERROR",
        'textPayload:"Memory limit"',
        'textPayload:"timed out"',
        'textPayload:"deadline"',
        'textPayload:"Exception"',
        'jsonPayload.message:"Memory limit"',
        'jsonPayload.message:"timed out"',
      ].join(" OR ")
    );
  }

  try {
    const raw = runGcloud([
      "logging",
      "read",
      filterParts.join(" AND "),
      "--project",
      options.projectId,
      `--freshness=${options.sinceMinutes}m`,
      "--limit",
      String(options.limit),
      "--format=json",
    ]);
    return JSON.parse(raw || "[]");
  } catch (error) {
    return [{
      error: extractCommandError(error),
      timestamp: "",
    }];
  }
}

function summarizeLogs(entries, recentCount) {
  const validEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry && !entry.error)
    : [];
  const eventCounts = new Map();
  const issueCounts = new Map();
  const severityCounts = new Map();
  let requestCount = 0;
  let requestErrorCount = 0;

  for (const entry of validEntries) {
    const severity = getSeverity(entry);
    if (severity) {
      severityCounts.set(severity, (severityCounts.get(severity) || 0) + 1);
    }

    const eventName = normalizeText(entry?.jsonPayload?.event);
    if (eventName) {
      eventCounts.set(eventName, (eventCounts.get(eventName) || 0) + 1);
    }

    const status = Number(entry?.httpRequest?.status);
    if (normalizeText(entry?.httpRequest?.requestMethod)) {
      requestCount += 1;
      if (Number.isFinite(status) && status >= 500) {
        requestErrorCount += 1;
      }
    }

    for (const issue of detectIssues(entry)) {
      issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
    }
  }

  const recent = validEntries
    .slice()
    .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")))
    .slice(0, recentCount)
    .map(describeEntry);

  return {
    error: entries?.[0]?.error || "",
    entryCount: validEntries.length,
    issueSummary: formatCountMap(issueCounts),
    recent,
    requestCount,
    requestErrorCount,
    severitySummary: formatCountMap(severityCounts),
    topEvents: formatTopCounts(eventCounts, 5),
  };
}

function printSummary(rows) {
  console.log("\n[summary]");
  console.table(rows.map((row) => ({
    function: row.functionName,
    entries: row.summary.entryCount,
    requests: row.summary.requestCount,
    requestErrors: row.summary.requestErrorCount,
    severities: row.summary.severitySummary || "n/a",
    topEvents: row.summary.topEvents || "n/a",
    issues: row.summary.issueSummary || "n/a",
    logError: row.summary.error || "",
  })));
}

function printRecent(rows) {
  console.log("\n[recent]");
  for (const row of rows) {
    console.log(`- ${row.functionName}`);
    if (row.summary.error) {
      console.log(`  logError: ${row.summary.error}`);
      continue;
    }
    if (!row.summary.recent.length) {
      console.log("  recent: none");
      continue;
    }
    for (const entry of row.summary.recent) {
      console.log(`  ${entry.timestamp} [${entry.severity}] ${entry.kind} ${entry.message}`);
    }
  }
}

function describeEntry(entry) {
  const eventName = normalizeText(entry?.jsonPayload?.event);
  if (eventName) {
    return {
      kind: "event",
      message: `${eventName}${formatPayloadHints(entry?.jsonPayload?.payload)}`,
      severity: getSeverity(entry) || "DEFAULT",
      timestamp: normalizeText(entry?.timestamp),
    };
  }

  const method = normalizeText(entry?.httpRequest?.requestMethod);
  if (method) {
    const status = normalizeText(String(entry?.httpRequest?.status ?? ""));
    const latency = formatLatency(entry?.httpRequest?.latency);
    const url = normalizeText(entry?.httpRequest?.requestUrl);
    return {
      kind: "request",
      message: `${method} status=${status || "-"} latency=${latency}${url ? ` url=${trimMiddle(url, 72)}` : ""}`,
      severity: getSeverity(entry) || "DEFAULT",
      timestamp: normalizeText(entry?.timestamp),
    };
  }

  const message = normalizeText(firstLine(
    normalizeText(entry?.textPayload)
    || normalizeText(entry?.jsonPayload?.message)
    || normalizeText(entry?.protoPayload?.status?.message)
  ));
  return {
    kind: "log",
    message: trimMiddle(message || "(message 없음)", 120),
    severity: getSeverity(entry) || "DEFAULT",
    timestamp: normalizeText(entry?.timestamp),
  };
}

function detectIssues(entry) {
  const issues = [];
  const message = [
    normalizeText(entry?.textPayload),
    normalizeText(entry?.jsonPayload?.message),
    normalizeText(entry?.protoPayload?.status?.message),
  ].join(" ").toLowerCase();
  const status = Number(entry?.httpRequest?.status);
  const severity = getSeverity(entry);

  if (message.includes("memory limit")) {
    issues.push("oom");
  }
  if (message.includes("timed out") || message.includes("deadline")) {
    issues.push("timeout");
  }
  if (message.includes("container instance was found to be using too much memory")) {
    issues.push("container-oom");
  }
  if (message.includes("starting new instance")) {
    issues.push("autoscaling");
  }
  if (Number.isFinite(status) && status >= 500) {
    issues.push("request-5xx");
  }
  if (severity === "ERROR" || severity === "CRITICAL" || severity === "ALERT" || severity === "EMERGENCY") {
    issues.push("error-log");
  }
  return issues;
}

function formatPayloadHints(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const keys = [
    "meetingId",
    "jobId",
    "partId",
    "partIndex",
    "requestId",
    "reason",
    "status",
    "code",
    "phase",
    "chunkIndex",
    "itemCount",
  ];
  const hints = [];
  for (const key of keys) {
    const value = payload[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (typeof value === "object") {
      continue;
    }
    hints.push(`${key}=${String(value)}`);
    if (hints.length >= 4) {
      break;
    }
  }
  return hints.length ? ` ${hints.join(" ")}` : "";
}

function formatTopCounts(map, limit) {
  if (!map.size) {
    return "";
  }
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => `${name}:${count}`)
    .join(", ");
}

function formatCountMap(map) {
  if (!map.size) {
    return "";
  }
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => `${name}:${count}`)
    .join(", ");
}

function formatLatency(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "n/a";
  }
  return normalized;
}

function getSeverity(entry) {
  const severity = normalizeText(entry?.severity).toUpperCase();
  if (severity) {
    return severity;
  }
  const status = Number(entry?.httpRequest?.status);
  if (Number.isFinite(status) && status >= 500) {
    return "ERROR";
  }
  return "";
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/, 1)[0];
}

function trimMiddle(value, maxLength) {
  const normalized = String(value || "");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const head = Math.max(10, Math.floor((maxLength - 3) / 2));
  const tail = Math.max(10, maxLength - head - 3);
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

function parseArgs(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--project") {
      options.projectId = normalizeText(args[index + 1]) || defaults.projectId;
      index += 1;
      continue;
    }
    if (value === "--since") {
      options.sinceMinutes = Math.max(1, Number(args[index + 1]) || defaults.sinceMinutes);
      index += 1;
      continue;
    }
    if (value === "--limit") {
      options.limit = Math.max(1, Number(args[index + 1]) || defaults.limit);
      index += 1;
      continue;
    }
    if (value === "--filter") {
      options.filter = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--functions") {
      options.functions = String(args[index + 1] || "")
        .split(",")
        .map((item) => normalizeText(item))
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (value === "--recent") {
      options.recentCount = Math.max(1, Number(args[index + 1]) || defaults.recentCount);
      index += 1;
      continue;
    }
    if (value === "--errors-only") {
      options.errorsOnly = true;
    }
  }
  return options;
}

function readDefaultProjectId() {
  try {
    const filePath = path.join(process.cwd(), ".firebaserc");
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeText(parsed?.projects?.default) || "browser-extension-main";
  } catch {
    return "browser-extension-main";
  }
}

function runGcloud(args) {
  const command = ["gcloud.cmd", ...args.map(quoteForCmd)].join(" ");
  return execSync(command, {
    encoding: "utf8",
    shell: "cmd.exe",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 90000,
    windowsHide: true,
  }).trim();
}

function quoteForCmd(value) {
  const normalized = String(value ?? "");
  if (!normalized || /\s|"/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function extractCommandError(error) {
  const stderr = normalizeText(error?.stderr || "");
  const message = normalizeText(error?.message || "");
  return stderr || message;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

try {
  main();
} catch (error) {
  console.error(`[function-logs] ${extractCommandError(error) || normalizeText(error?.message) || "unknown error"}`);
  process.exit(1);
}
