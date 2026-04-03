(function initHostedMeetingStorage(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const { normalizeText, normalizeTextBlock, safeLocalStorageSet } = ns.shared;

  const PENDING_UPLOAD_LOCAL_STORAGE_KEY = "inova-hosted-meeting-pending-uploads";
  const PENDING_UPLOAD_DB_NAME = "inova-hosted-meeting-workspace";
  const PENDING_UPLOAD_STORE_NAME = "pending-uploads";

  function buildPendingUploadStorageIssue(code, options = {}) {
    return {
      code: normalizeText(code),
      errorName: normalizeText(options.errorName),
      key: normalizeText(options.key),
      message: normalizeText(options.message),
      storage: normalizeText(options.storage),
    };
  }

  function summarizePendingUploadStorageIssues(issues) {
    const normalizedIssues = Array.isArray(issues) ? issues : [];
    const issue = normalizedIssues.find((entry) => [
      "indexeddb-open-failed",
      "indexeddb-unavailable",
      "local-storage-invalid-payload",
      "local-storage-parse-failed",
      "local-storage-read-failed",
    ].includes(normalizeText(entry?.code)));
    if (!issue) {
      return "";
    }
    const code = normalizeText(issue.code);
    if (code === "indexeddb-unavailable") {
      return "브라우저 로컬 보관 큐에서 IndexedDB를 사용할 수 없어요.";
    }
    if (code === "indexeddb-open-failed") {
      return "브라우저 로컬 보관 큐의 IndexedDB를 열지 못했어요.";
    }
    if (code === "local-storage-read-failed") {
      return "브라우저 로컬 보관 큐를 읽지 못했어요.";
    }
    if (code === "local-storage-parse-failed") {
      return "브라우저 로컬 보관 큐를 해석하지 못했어요.";
    }
    if (code === "local-storage-invalid-payload") {
      return "브라우저 로컬 보관 큐 형식이 올바르지 않아요.";
    }
    return "";
  }

  function readLocalStorageValueDetailed(target, key) {
    const normalizedKey = normalizeText(key);
    try {
      if (!target?.localStorage || typeof target.localStorage.getItem !== "function") {
        throw new Error("local-storage unavailable");
      }
      const value = target.localStorage.getItem(normalizedKey) || "";
      return {
        issue: normalizeText(value)
          ? null
          : buildPendingUploadStorageIssue("local-storage-empty", {
              key: normalizedKey,
              storage: "local-storage",
            }),
        value,
      };
    } catch (error) {
      return {
        issue: buildPendingUploadStorageIssue("local-storage-read-failed", {
          errorName: normalizeText(error?.name),
          key: normalizedKey,
          message: error instanceof Error ? error.message : String(error || ""),
          storage: "local-storage",
        }),
        value: "",
      };
    }
  }

  function parsePendingUploadItemsDetailed(value, key) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return { items: [] };
    }
    try {
      const parsed = JSON.parse(normalized);
      if (!Array.isArray(parsed)) {
        return {
          issue: buildPendingUploadStorageIssue("local-storage-invalid-payload", {
            key,
            storage: "local-storage",
          }),
          items: [],
        };
      }
      return {
        items: parsed,
      };
    } catch (error) {
      return {
        issue: buildPendingUploadStorageIssue("local-storage-parse-failed", {
          errorName: normalizeText(error?.name),
          key,
          message: error instanceof Error ? error.message : String(error || ""),
          storage: "local-storage",
        }),
        items: [],
      };
    }
  }

  async function blobToBase64(blob) {
    if (blob && typeof blob.arrayBuffer === "function") {
      return arrayBufferToBase64(await blob.arrayBuffer());
    }
    if (blob && typeof blob.text === "function") {
      const text = await blob.text();
      if (typeof global.Buffer !== "undefined") {
        return global.Buffer.from(text, "utf8").toString("base64");
      }
      return global.btoa(unescape(encodeURIComponent(text)));
    }
    if (typeof global.FileReader === "function") {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new global.FileReader();
        reader.onerror = () => reject(new Error("녹음 데이터를 읽지 못했어요."));
        reader.onload = () => resolve(normalizeText(reader.result));
        reader.readAsDataURL(blob);
      });
      return String(dataUrl).split(",").pop() || "";
    }
    throw new Error("녹음 데이터를 직렬화하지 못했어요.");
  }

  function base64ToBlob(base64, mimeType) {
    const normalized = normalizeText(base64);
    if (!normalized) {
      return new global.Blob([], { type: normalizeText(mimeType) || "audio/webm" });
    }
    if (typeof global.Buffer !== "undefined") {
      return new global.Blob([global.Buffer.from(normalized, "base64")], { type: normalizeText(mimeType) || "audio/webm" });
    }
    const binary = global.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new global.Blob([bytes], { type: normalizeText(mimeType) || "audio/webm" });
  }

  function arrayBufferToBase64(buffer) {
    if (typeof global.Buffer !== "undefined") {
      return global.Buffer.from(buffer).toString("base64");
    }
    let binary = "";
    for (const byte of new Uint8Array(buffer)) {
      binary += String.fromCharCode(byte);
    }
    return global.btoa(binary);
  }

  function normalizePendingStatus(status, hold) {
    if (hold) {
      return "on_hold";
    }
    const normalized = normalizeText(status);
    return ["local_saved", "preparing_chunks", "upload_queued", "uploading", "uploading_chunks", "remote_queued", "remote_processing", "succeeded", "failed", "on_hold"].includes(normalized)
      ? normalized
      : "local_saved";
  }

  function normalizePendingPart(input, index) {
    const part = input && typeof input === "object" ? input : {};
    const startMs = Math.max(0, Number(part.startMs) || 0);
    const endMs = Math.max(startMs, Number(part.endMs) || startMs);
    return {
      endMs,
      index: Math.max(0, Number(part.index) || index),
      overlapMs: Math.max(0, Number(part.overlapMs) || 0),
      requestId: normalizeText(part.requestId),
      sizeBytes: Math.max(0, Number(part.sizeBytes) || 0),
      startMs,
      storageObject: normalizeText(part.storageObject),
      uploadStatus: normalizeText(part.uploadStatus) || (normalizeText(part.storageObject) ? "uploaded" : ""),
    };
  }

  function normalizePendingUpload(input) {
    const item = input && typeof input === "object" ? input : {};
    const parts = (Array.isArray(item.parts) ? item.parts : []).map(normalizePendingPart).sort((left, right) => left.index - right.index || left.startMs - right.startMs);
    const uploadedPartCount = parts.filter((part) => normalizeText(part.storageObject)).length;
    const supersededJobIds = Array.from(new Set(
      (Array.isArray(item.supersededJobIds) ? item.supersededJobIds : [item.supersededJobId])
        .map((jobId) => normalizeText(jobId))
        .filter(Boolean)
    ));
    return {
      blob: item.blob instanceof global.Blob ? item.blob : new global.Blob([], { type: normalizeText(item.mimeType) || "audio/webm" }),
      captureMode: normalizeText(item.captureMode) || "microphone",
      channelCount: Math.max(1, Number(item.channelCount) || 1),
      createdAt: normalizeText(item.createdAt) || new Date().toISOString(),
      durationMs: Math.max(0, Number(item.durationMs) || 0),
      endedAt: normalizeText(item.endedAt),
      hold: Boolean(item.hold),
      jobId: normalizeText(item.jobId),
      lastError: normalizeText(item.lastError),
      meetingId: normalizeText(item.meetingId),
      meetingTitleSnapshot: normalizeText(item.meetingTitleSnapshot),
      mimeType: normalizeText(item.mimeType) || normalizeText(item.blob?.type) || "audio/webm",
      originalSizeBytes: Math.max(0, Number(item.originalSizeBytes) || Number(item.sizeBytes) || Number(item.blob?.size) || 0),
      parts,
      preparedPartCount: Math.max(0, Number(item.preparedPartCount) || parts.length),
      requestId: normalizeText(item.requestId),
      sharedMemoSnapshot: normalizeTextBlock(item.sharedMemoSnapshot),
      sizeBytes: Math.max(0, Number(item.sizeBytes) || Number(item.blob?.size) || 0),
      sourceMode: normalizeText(item.sourceMode) || (parts.length ? "chunked" : "single"),
      startedAt: normalizeText(item.startedAt),
      storageObject: normalizeText(item.storageObject),
      status: normalizePendingStatus(item.status, Boolean(item.hold)),
      supersededJobIds,
      uploadedPartCount: Math.max(0, Number(item.uploadedPartCount) || uploadedPartCount),
      updatedAt: normalizeText(item.updatedAt) || new Date().toISOString(),
    };
  }

  function comparePendingUploads(left, right) {
    return ns.shared.toTimestamp(right.updatedAt || right.createdAt) - ns.shared.toTimestamp(left.updatedAt || left.createdAt);
  }

  async function serializePendingUpload(item, serializeBlobToBase64) {
    const normalized = normalizePendingUpload(item);
    if (serializeBlobToBase64) {
      return {
        ...normalized,
        blob: undefined,
        blobBase64: await blobToBase64(normalized.blob),
      };
    }
    return { ...normalized, blobBase64: "" };
  }

  async function deserializePendingUpload(item) {
    const normalized = item && typeof item === "object" ? { ...item } : {};
    const blob = normalized.blob instanceof global.Blob
      ? normalized.blob
      : base64ToBlob(normalizeText(normalized.blobBase64), normalizeText(normalized.mimeType));
    return normalizePendingUpload({ ...normalized, blob });
  }

  function runIdbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 요청에 실패했어요."));
    });
  }

  function createPendingUploadStore(target) {
    let dbPromise = null;
    let fallbackToLocalStorage = false;
    let indexedDbFallbackIssue = null;
    let lastDiagnostics = createStorageDiagnostics("");

    return {
      async clearMeeting(meetingId) {
        const items = await this.listByMeeting(meetingId);
        await Promise.all(items.map((item) => this.delete(item.requestId)));
      },
      async delete(requestId) {
        const normalizedRequestId = normalizeText(requestId);
        if (!normalizedRequestId) return;
        const db = await openDb();
        if (db) {
          await runIdbRequest(db.transaction(PENDING_UPLOAD_STORE_NAME, "readwrite").objectStore(PENDING_UPLOAD_STORE_NAME).delete(normalizedRequestId));
          return;
        }
        const items = await readLocalItems();
        await writeLocalItems(items.filter((item) => normalizeText(item.requestId) !== normalizedRequestId));
      },
      async listByMeeting(meetingId) {
        const normalizedMeetingId = normalizeText(meetingId);
        const issues = [];
        const db = await openDb(issues);
        if (db) {
          const items = await runIdbRequest(db.transaction(PENDING_UPLOAD_STORE_NAME, "readonly").objectStore(PENDING_UPLOAD_STORE_NAME).getAll());
          setDiagnostics("listByMeeting", issues);
          return Promise.all((Array.isArray(items) ? items : []).filter((item) => normalizeText(item.meetingId) === normalizedMeetingId).map(deserializePendingUpload));
        }
        const localItems = await readLocalItems(issues);
        setDiagnostics("listByMeeting", issues);
        return Promise.all(localItems.filter((item) => normalizeText(item.meetingId) === normalizedMeetingId).map(deserializePendingUpload));
      },
      async put(item) {
        const normalized = normalizePendingUpload(item);
        const db = await openDb();
        if (db) {
          await runIdbRequest(db.transaction(PENDING_UPLOAD_STORE_NAME, "readwrite").objectStore(PENDING_UPLOAD_STORE_NAME).put(await serializePendingUpload(normalized, false)));
          return;
        }
        const items = await readLocalItems();
        const serialized = await serializePendingUpload(normalized, true);
        await writeLocalItems([serialized, ...items.filter((current) => normalizeText(current.requestId) !== normalized.requestId)]);
      },
      consumeDiagnostics() {
        const nextDiagnostics = lastDiagnostics;
        lastDiagnostics = createStorageDiagnostics("");
        return nextDiagnostics;
      },
    };

    function createStorageDiagnostics(operation, issues = []) {
      const normalizedIssues = Array.isArray(issues) ? issues : [];
      return {
        degradedReason: summarizePendingUploadStorageIssues(normalizedIssues),
        issues: normalizedIssues,
        operation: normalizeText(operation),
      };
    }

    function setDiagnostics(operation, issues) {
      lastDiagnostics = createStorageDiagnostics(operation, issues);
    }

    async function openDb(issues) {
      const nextIssues = Array.isArray(issues) ? issues : [];
      if (fallbackToLocalStorage) {
        if (indexedDbFallbackIssue) {
          nextIssues.push(indexedDbFallbackIssue);
        }
        return null;
      }
      if (typeof target.indexedDB?.open !== "function") {
        fallbackToLocalStorage = true;
        indexedDbFallbackIssue = buildPendingUploadStorageIssue("indexeddb-unavailable", {
          storage: "indexeddb",
        });
        nextIssues.push(indexedDbFallbackIssue);
        return null;
      }
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const request = target.indexedDB.open(PENDING_UPLOAD_DB_NAME, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PENDING_UPLOAD_STORE_NAME)) {
              db.createObjectStore(PENDING_UPLOAD_STORE_NAME, { keyPath: "requestId" });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("IndexedDB를 열지 못했어요."));
        });
      }
      try {
        return await dbPromise;
      } catch (error) {
        fallbackToLocalStorage = true;
        indexedDbFallbackIssue = buildPendingUploadStorageIssue("indexeddb-open-failed", {
          errorName: normalizeText(error?.name),
          message: error instanceof Error ? error.message : String(error || ""),
          storage: "indexeddb",
        });
        nextIssues.push(indexedDbFallbackIssue);
        return null;
      }
    }

    async function readLocalItems(issues) {
      const nextIssues = Array.isArray(issues) ? issues : [];
      const storageEntry = readLocalStorageValueDetailed(target, PENDING_UPLOAD_LOCAL_STORAGE_KEY);
      if (storageEntry.issue) {
        nextIssues.push(storageEntry.issue);
      }
      if (!normalizeText(storageEntry.value)) {
        return [];
      }
      const parsedEntry = parsePendingUploadItemsDetailed(storageEntry.value, PENDING_UPLOAD_LOCAL_STORAGE_KEY);
      if (parsedEntry.issue) {
        nextIssues.push(parsedEntry.issue);
      }
      return Array.isArray(parsedEntry.items) ? parsedEntry.items : [];
    }

    async function writeLocalItems(items) {
      ns.shared.safeLocalStorageSet(target, PENDING_UPLOAD_LOCAL_STORAGE_KEY, JSON.stringify(items || []));
    }
  }

  ns.storage = {
    blobToBase64,
    comparePendingUploads,
    createPendingUploadStore,
    normalizePendingUpload,
    normalizePendingStatus,
  };
})(globalThis);
