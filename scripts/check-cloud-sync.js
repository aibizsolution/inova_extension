#!/usr/bin/env node

const { execFileSync } = require("child_process");

const defaults = {
  projectId: "browser-extension-main",
  samples: 2,
  userKey: process.env.INOVA_PROVIDER_USER_KEY || "",
  waitSeconds: 20,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.userKey) {
    console.error("사용법: node scripts/check-cloud-sync.js --userKey <providerUserKey> [--samples 2] [--wait 20] [--project browser-extension-main]");
    process.exit(1);
  }

  console.log(`[cloud-sync] project=${options.projectId}`);
  console.log(`[cloud-sync] userKey=${options.userKey}`);
  console.log(`[cloud-sync] samples=${options.samples}, wait=${options.waitSeconds}s`);

  const snapshots = [];
  for (let index = 0; index < options.samples; index += 1) {
    const snapshot = await readSnapshot(options.projectId, options.userKey);
    snapshots.push(snapshot);
    printSnapshot(index + 1, snapshot);

    if (index < options.samples - 1) {
      await wait(options.waitSeconds * 1000);
    }
  }

  printDiffSummary(snapshots);
}

async function readSnapshot(projectId, userKey) {
  const integrationPath = `integration_inova_accounts/${userKey}`;
  const libraryPath = `prompt_libraries/inova__${userKey}`;
  const [integrationDoc, libraryDoc] = await Promise.all([
    getDocument(projectId, integrationPath),
    getDocument(projectId, libraryPath),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    integration: {
      exists: Boolean(integrationDoc),
      lastPromptSyncAt: getStringField(integrationDoc, "lastPromptSyncAt"),
      updateTime: integrationDoc?.updateTime || "",
    },
    promptLibrary: {
      exists: Boolean(libraryDoc),
      itemCount: Number(getNestedField(libraryDoc, ["promptLibrary", "itemCount"]) || 0),
      lastReason: getNestedField(libraryDoc, ["sync", "lastReason"]) || "",
      lastRevision: getNestedField(libraryDoc, ["sync", "lastRevision"]) || "",
      lastSyncedAt: getNestedField(libraryDoc, ["sync", "lastSyncedAt"]) || "",
      libraryUpdatedAt: getNestedField(libraryDoc, ["promptLibrary", "updatedAt"]) || "",
      updateTime: libraryDoc?.updateTime || "",
    },
  };
}

async function getDocument(projectId, documentPath) {
  try {
    const accessToken = getGcloudAccessToken();
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${documentPath}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Firestore 요청 실패 (${response.status}): ${text}`);
    }

    return response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "알 수 없는 오류");
    throw new Error(`${documentPath} 조회 실패: ${message}`, { cause: error });
  }
}

function getGcloudAccessToken() {
  const commands = [
    ["gcloud", ["auth", "print-access-token"]],
    ["powershell", ["-NoProfile", "-Command", "gcloud auth print-access-token"]],
    ["cmd", ["/c", "gcloud auth print-access-token"]],
  ];

  for (const [command, args] of commands) {
    try {
      const token = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (token) {
        return token;
      }
    } catch {
      continue;
    }
  }

  throw new Error("gcloud access token을 가져오지 못했어요. gcloud 로그인 상태를 확인해 주세요.");
}

function getStringField(document, fieldName) {
  const field = document?.fields?.[fieldName];
  if (!field) {
    return "";
  }
  return field.stringValue || field.timestampValue || field.integerValue || "";
}

function getNestedField(document, pathSegments) {
  let current = document?.fields;
  for (const segment of pathSegments) {
    const next = current?.[segment];
    if (!next) {
      return "";
    }

    if (next.mapValue?.fields) {
      current = next.mapValue.fields;
      continue;
    }

    return next.stringValue || next.timestampValue || next.integerValue || "";
  }

  return "";
}

function printSnapshot(index, snapshot) {
  console.log(`\n[sample ${index}] capturedAt=${snapshot.capturedAt}`);
  console.log(
    `  integration: exists=${snapshot.integration.exists} lastPromptSyncAt=${snapshot.integration.lastPromptSyncAt || "-"} updateTime=${snapshot.integration.updateTime || "-"}`
  );
  console.log(
    `  promptLibrary: exists=${snapshot.promptLibrary.exists} itemCount=${snapshot.promptLibrary.itemCount} lastReason=${snapshot.promptLibrary.lastReason || "-"} lastRevision=${snapshot.promptLibrary.lastRevision || "-"}`
  );
  console.log(
    `  promptLibrary times: lastSyncedAt=${snapshot.promptLibrary.lastSyncedAt || "-"} libraryUpdatedAt=${snapshot.promptLibrary.libraryUpdatedAt || "-"} updateTime=${snapshot.promptLibrary.updateTime || "-"}`
  );
}

function printDiffSummary(snapshots) {
  if (snapshots.length < 2) {
    return;
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const integrationChanged =
    first.integration.lastPromptSyncAt !== last.integration.lastPromptSyncAt ||
    first.integration.updateTime !== last.integration.updateTime;
  const libraryChanged =
    first.promptLibrary.lastSyncedAt !== last.promptLibrary.lastSyncedAt ||
    first.promptLibrary.lastRevision !== last.promptLibrary.lastRevision ||
    first.promptLibrary.updateTime !== last.promptLibrary.updateTime;

  console.log("\n[summary]");
  console.log(`  integration doc changed: ${integrationChanged ? "YES" : "NO"}`);
  console.log(`  prompt library doc changed: ${libraryChanged ? "YES" : "NO"}`);
  if (!integrationChanged && !libraryChanged) {
    console.log("  idle 상태에서는 불필요한 반복 업데이트가 보이지 않았습니다.");
  } else {
    console.log("  반복 갱신이 의심됩니다. sample 값을 늘리거나 브라우저 조작 직후 다시 확인하세요.");
  }
}

function parseArgs(args) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--userKey") {
      options.userKey = String(args[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (value === "--samples") {
      options.samples = Math.max(1, Number(args[index + 1] || defaults.samples));
      index += 1;
      continue;
    }
    if (value === "--wait") {
      options.waitSeconds = Math.max(1, Number(args[index + 1] || defaults.waitSeconds));
      index += 1;
      continue;
    }
    if (value === "--project") {
      options.projectId = String(args[index + 1] || defaults.projectId).trim();
      index += 1;
    }
  }
  return options;
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

main().catch((error) => {
  console.error(`[cloud-sync] ${error.message}`);
  process.exit(1);
});
