const { execFileSync } = require("child_process");

const DEFAULT_STORAGE_PREFIX = "tmp/meetings/";
const FIRESTORE_PAGE_SIZE = 1000;

const MEETING_COLLECTIONS = [
  {
    id: "integration_inova_meetings",
    group: "data",
    label: "meetings",
    matchPaths: ["meetingId"],
    samplePaths: ["meetingId", "title", "updatedAt", "createdAt", "deletedAt", "owner.providerUserKey"],
  },
  {
    id: "integration_inova_meeting_jobs",
    group: "data",
    label: "jobs",
    matchPaths: ["meetingId", "meeting.meetingId"],
    samplePaths: ["meetingId", "status", "notesStatus", "updatedAt", "deletedAt", "owner.providerUserKey"],
  },
  {
    id: "integration_inova_meeting_job_parts",
    group: "data",
    label: "job_parts",
    matchPaths: ["meetingId"],
    samplePaths: ["meetingId", "jobId", "status", "part.index", "updatedAt"],
  },
  {
    id: "integration_inova_meeting_job_finalizers",
    group: "data",
    label: "job_finalizers",
    matchPaths: ["meetingId"],
    samplePaths: ["meetingId", "jobId", "status", "updatedAt"],
  },
  {
    id: "integration_inova_meeting_artifacts",
    group: "data",
    label: "artifacts",
    matchPaths: ["meetingId"],
    samplePaths: ["meetingId", "jobId", "createdAt", "deletedAt", "owner.providerUserKey"],
  },
  {
    id: "integration_inova_meeting_commands",
    group: "data",
    label: "commands",
    matchPaths: ["meetingId"],
    samplePaths: ["meetingId", "jobId", "type", "status", "updatedAt"],
  },
  {
    id: "integration_inova_meeting_deletions",
    group: "data",
    label: "deletions",
    matchPaths: ["meetingId"],
    samplePaths: ["meetingId", "scope", "status", "updatedAt", "deletedAt"],
  },
  {
    id: "integration_inova_meeting_launches",
    group: "session",
    label: "launches",
    matchPaths: ["meeting.meetingId"],
    samplePaths: ["meeting.meetingId", "mode", "status", "expiresAt", "createdAt"],
  },
  {
    id: "integration_inova_meeting_workspace_sessions",
    group: "session",
    label: "workspace_sessions",
    matchPaths: ["meeting.meetingId"],
    samplePaths: ["meeting.meetingId", "mode", "status", "expiresAt", "issuedAt"],
  },
];

async function deleteBucketObject(accessToken, bucketName, objectName) {
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectName)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${bucketName}/${objectName} 삭제 실패 (${response.status}): ${text}`);
  }
  return true;
}

async function deleteFirestoreDocument(accessToken, documentName) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/${normalizeText(documentName)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${documentName} 삭제 실패 (${response.status}): ${text}`);
  }
  return true;
}

function documentMatchesMeeting(document, collection, meetingId) {
  const normalizedMeetingId = normalizeText(meetingId);
  if (!normalizedMeetingId) {
    return true;
  }

  if (
    normalizeText(collection?.id) === "integration_inova_meetings"
    && extractDocumentId(document?.name).endsWith(`__${normalizedMeetingId}`)
  ) {
    return true;
  }

  return (Array.isArray(collection?.matchPaths) ? collection.matchPaths : [])
    .some((path) => normalizeText(readFirestoreDocumentPath(document, path)) === normalizedMeetingId);
}

function extractDocumentId(documentName) {
  const normalized = normalizeText(documentName);
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

function filterStorageObjectsByMeetingId(objects, meetingId) {
  const normalizedMeetingId = normalizeText(meetingId);
  if (!normalizedMeetingId) {
    return Array.isArray(objects) ? [...objects] : [];
  }
  const marker = `/${normalizedMeetingId}/`;
  return (Array.isArray(objects) ? objects : []).filter((item) => normalizeText(item?.name).includes(marker));
}

function formatScalar(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return normalizeText(value) || "-";
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

async function listCollectionDocuments(accessToken, projectId, collectionId) {
  const documents = [];
  let pageToken = "";

  while (true) {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${collectionId}`
    );
    url.searchParams.set("pageSize", String(FIRESTORE_PAGE_SIZE));
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${collectionId} 조회 실패 (${response.status}): ${text}`);
    }

    const payload = await response.json();
    documents.push(...(Array.isArray(payload?.documents) ? payload.documents : []));
    pageToken = normalizeText(payload?.nextPageToken);
    if (!pageToken) {
      break;
    }
  }

  return documents;
}

async function listProjectBuckets(accessToken, projectId) {
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`bucket 목록 조회 실패 (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.items)
    ? payload.items.map((item) => normalizeText(item?.name)).filter(Boolean)
    : [];
}

async function listStorageObjects(accessToken, bucketName, prefix) {
  const items = [];
  let pageToken = "";

  while (true) {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o`);
    url.searchParams.set("prefix", normalizeText(prefix));
    url.searchParams.set("maxResults", "1000");
    url.searchParams.set("fields", "items(name,size,updated),nextPageToken");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 404) {
      return {
        bucketName,
        items: [],
        status: "missing",
      };
    }
    if (!response.ok) {
      const text = await response.text();
      return {
        bucketName,
        error: `storage 조회 실패 (${response.status}): ${text}`,
        items: [],
        status: "error",
      };
    }

    const payload = await response.json();
    items.push(...(Array.isArray(payload?.items) ? payload.items : []));
    pageToken = normalizeText(payload?.nextPageToken);
    if (!pageToken) {
      break;
    }
  }

  return {
    bucketName,
    items,
    status: "ok",
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function readFirestoreDocumentPath(document, path) {
  const segments = String(path || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let currentValue = { mapValue: { fields: document?.fields || {} } };

  for (const segment of segments) {
    const fields = currentValue?.mapValue?.fields;
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, segment)) {
      return "";
    }
    currentValue = fields[segment];
  }

  return decodeFirestoreValue(currentValue);
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  if (typeof value.stringValue === "string") {
    return value.stringValue;
  }
  if (typeof value.timestampValue === "string") {
    return value.timestampValue;
  }
  if (typeof value.integerValue === "string") {
    return value.integerValue;
  }
  if (typeof value.doubleValue === "number") {
    return value.doubleValue;
  }
  if (typeof value.booleanValue === "boolean") {
    return value.booleanValue;
  }
  if (value.nullValue !== undefined) {
    return "null";
  }
  if (value.arrayValue) {
    const values = Array.isArray(value.arrayValue.values) ? value.arrayValue.values : [];
    return `[${values.length} items]`;
  }
  if (value.mapValue?.fields) {
    return `{${Object.keys(value.mapValue.fields).length} keys}`;
  }
  return "";
}

async function resolveBucketNames(accessToken, projectId, extraBucketNames = []) {
  const bucketNames = new Set(
    (Array.isArray(extraBucketNames) ? extraBucketNames : [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  );

  for (const bucketName of await listProjectBuckets(accessToken, projectId)) {
    bucketNames.add(bucketName);
  }

  return Array.from(bucketNames).filter(Boolean);
}

async function runInBatches(items, worker, batchSize = 20) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const chunkResults = await Promise.all(batch.map(worker));
    results.push(...chunkResults);
  }
  return results;
}

function summarizeDocument(document, samplePaths) {
  const summary = {
    id: extractDocumentId(document?.name),
    updateTime: normalizeText(document?.updateTime),
  };

  for (const path of samplePaths) {
    summary[path] = readFirestoreDocumentPath(document, path);
  }

  return summary;
}

module.exports = {
  DEFAULT_STORAGE_PREFIX,
  MEETING_COLLECTIONS,
  deleteBucketObject,
  deleteFirestoreDocument,
  documentMatchesMeeting,
  extractDocumentId,
  filterStorageObjectsByMeetingId,
  formatScalar,
  getGcloudAccessToken,
  listCollectionDocuments,
  listStorageObjects,
  normalizeText,
  readFirestoreDocumentPath,
  resolveBucketNames,
  runInBatches,
  summarizeDocument,
};
