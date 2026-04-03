#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const defaults = {
  filter: "",
  functions: [],
  limit: 120,
  projectId: readDefaultProjectId(),
  recentCount: 3,
  region: "asia-northeast3",
  sinceMinutes: 60,
};

function main() {
  const options = parseArgs(process.argv.slice(2));
  const functions = selectFunctions(loadExportedFunctions(), options);
  if (!functions.length) {
    throw new Error("조회할 함수가 없어요. --filter 또는 --functions 값을 확인하세요.");
  }

  console.log(`[function-runtime] project=${options.projectId}`);
  console.log(`[function-runtime] region=${options.region}`);
  console.log(`[function-runtime] since=${options.sinceMinutes}m limit=${options.limit}`);
  console.log(`[function-runtime] functions=${functions.length}`);

  const rows = [];
  for (const functionName of functions) {
    const serviceName = buildServiceName(functionName);
    const config = readServiceConfig(serviceName, options);
    const entries = readRequestLogs(serviceName, options);
    const summary = summarizeRequestLogs(entries, options.recentCount);
    rows.push({
      functionName,
      serviceName,
      config,
      summary,
    });
  }

  printConfigTable(rows);
  printLatencyTable(rows);
  printRecentRequests(rows, options.recentCount);
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

function readServiceConfig(serviceName, options) {
  try {
    const raw = runGcloud([
      "run",
      "services",
      "describe",
      serviceName,
      "--project",
      options.projectId,
      "--region",
      options.region,
      "--format=json",
    ]);
    const parsed = JSON.parse(raw || "{}");
    const annotations = parsed?.spec?.template?.metadata?.annotations || {};
    const limits = parsed?.spec?.template?.spec?.containers?.[0]?.resources?.limits || {};
    return {
      concurrency: parsed?.spec?.template?.spec?.containerConcurrency ?? "",
      cpu: normalizeText(limits.cpu),
      maxInstances: normalizeText(
        annotations["autoscaling.knative.dev/maxScale"]
        || annotations["run.googleapis.com/maxScale"]
      ),
      memory: normalizeText(limits.memory),
      timeoutSeconds: parsed?.spec?.template?.spec?.timeoutSeconds ?? "",
    };
  } catch (error) {
    return {
      concurrency: "",
      cpu: "",
      error: extractCommandError(error),
      maxInstances: "",
      memory: "",
      timeoutSeconds: "",
    };
  }
}

function readRequestLogs(serviceName, options) {
  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${serviceName}"`,
    'httpRequest.requestMethod!=""',
  ].join(" AND ");
  try {
    const raw = runGcloud([
      "logging",
      "read",
      filter,
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

function summarizeRequestLogs(entries, recentCount) {
  const validEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry && !entry.error)
    : [];
  const latencies = validEntries
    .map((entry) => parseLatencySeconds(entry?.httpRequest?.latency))
    .filter((value) => Number.isFinite(value));
  const slowLatencies = latencies.filter((value) => value >= 1);
  const statuses = new Map();
  const methods = new Map();
  for (const entry of validEntries) {
    const status = String(entry?.httpRequest?.status ?? "");
    const method = normalizeText(entry?.httpRequest?.requestMethod);
    if (status) {
      statuses.set(status, (statuses.get(status) || 0) + 1);
    }
    if (method) {
      methods.set(method, (methods.get(method) || 0) + 1);
    }
  }

  return {
    avgSeconds: latencies.length ? average(latencies) : null,
    error: entries?.[0]?.error || "",
    maxSeconds: latencies.length ? Math.max(...latencies) : null,
    methods: Array.from(methods.entries()).map(([name, count]) => `${name}:${count}`).join(", "),
    p50Seconds: latencies.length ? percentile(latencies, 0.5) : null,
    p95Seconds: latencies.length ? percentile(latencies, 0.95) : null,
    recent: validEntries
      .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")))
      .slice(0, recentCount)
      .map((entry) => ({
        latencySeconds: parseLatencySeconds(entry?.httpRequest?.latency),
        method: normalizeText(entry?.httpRequest?.requestMethod),
        status: String(entry?.httpRequest?.status ?? ""),
        timestamp: normalizeText(entry?.timestamp),
      })),
    requestCount: validEntries.length,
    slowAvgSeconds: slowLatencies.length ? average(slowLatencies) : null,
    slowRequestCount: slowLatencies.length,
    statuses: Array.from(statuses.entries()).map(([name, count]) => `${name}:${count}`).join(", "),
  };
}

function printConfigTable(rows) {
  console.log("\n[config]");
  console.table(rows.map((row) => ({
    function: row.functionName,
    concurrency: row.config.concurrency || "n/a",
    cpu: row.config.cpu || "n/a",
    maxInstances: row.config.maxInstances || "n/a",
    memory: row.config.memory || "n/a",
    timeoutSeconds: row.config.timeoutSeconds || "n/a",
    configError: row.config.error || "",
  })));
}

function printLatencyTable(rows) {
  console.log("\n[latency]");
  console.table(rows.map((row) => ({
    function: row.functionName,
    requests: row.summary.requestCount,
    avgSeconds: formatSeconds(row.summary.avgSeconds),
    p50Seconds: formatSeconds(row.summary.p50Seconds),
    p95Seconds: formatSeconds(row.summary.p95Seconds),
    maxSeconds: formatSeconds(row.summary.maxSeconds),
    slowRequests: row.summary.slowRequestCount,
    slowAvgSeconds: formatSeconds(row.summary.slowAvgSeconds),
    methods: row.summary.methods || "n/a",
    statuses: row.summary.statuses || "n/a",
    logError: row.summary.error || "",
  })));
}

function printRecentRequests(rows, recentCount) {
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
    row.summary.recent.slice(0, recentCount).forEach((entry) => {
      console.log(
        `  ${entry.timestamp} method=${entry.method || "-"} status=${entry.status || "-"} latency=${formatSeconds(entry.latencySeconds)}s`
      );
    });
  }
}

function parseLatencySeconds(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values, ratio) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  if (value >= 100) {
    return value.toFixed(1);
  }
  if (value >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(3);
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
    if (value === "--region") {
      options.region = normalizeText(args[index + 1]) || defaults.region;
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
  console.error(`[function-runtime] ${extractCommandError(error) || normalizeText(error?.message) || "unknown error"}`);
  process.exit(1);
}
