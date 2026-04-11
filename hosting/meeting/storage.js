(function initHostedMeetingStorage(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const { clearDebugFault, consumeDebugFault, normalizeText, normalizeTextBlock, setDebugFault } = ns.shared;

  const PENDING_UPLOAD_LOCAL_STORAGE_KEY = "inova-hosted-meeting-pending-uploads";
  const PENDING_UPLOAD_DB_NAME = "inova-hosted-meeting-workspace";
  const PENDING_UPLOAD_STORE_NAME = "pending-uploads";
  const PENDING_UPLOAD_DIAGNOSTIC_OPERATIONS = Object.freeze({
    clearMeeting: "clearMeeting",
    delete: "delete",
    listByMeeting: "listByMeeting",
    put: "put",
  });
  const PENDING_UPLOAD_DEBUG_FAULTS = Object.freeze({
    indexedDbDelete: "pending-uploads:indexeddb-delete-failed",
    indexedDbOpen: "pending-uploads:indexeddb-open-failed",
    indexedDbRead: "pending-uploads:indexeddb-read-failed",
    indexedDbWrite: "pending-uploads:indexeddb-write-failed",
    localStorageInvalidPayload: "pending-uploads:local-storage-invalid-payload",
    localStorageParse: "pending-uploads:local-storage-parse-failed",
    localStorageRead: "pending-uploads:local-storage-read-failed",
    localStorageWrite: "pending-uploads:local-storage-write-failed",
  });
  const PENDING_UPLOAD_DEBUG_SCENARIOS = Object.freeze({
    loadIndexedDbOpen: Object.freeze({
      expectedFlow: "load degraded",
      fault: PENDING_UPLOAD_DEBUG_FAULTS.indexedDbOpen,
      key: "queue-load-indexeddb-open",
      summary: "작업실 진입 시 IndexedDB open 실패를 재현합니다.",
      trigger: "작업실 새로고침 또는 재진입",
    }),
    loadIndexedDbRead: Object.freeze({
      expectedFlow: "load degraded",
      fault: PENDING_UPLOAD_DEBUG_FAULTS.indexedDbRead,
      key: "queue-load-indexeddb-read",
      summary: "작업실 진입 시 IndexedDB read 실패를 재현합니다.",
      trigger: "작업실 새로고침 또는 재진입",
    }),
    loadLocalRead: Object.freeze({
      expectedFlow: "load degraded",
      fault: PENDING_UPLOAD_DEBUG_FAULTS.localStorageRead,
      key: "queue-load-local-read",
      summary: "localStorage read 실패를 재현합니다.",
      trigger: "작업실 새로고침 또는 재진입",
    }),
    loadLocalParse: Object.freeze({
      expectedFlow: "load degraded",
      fault: PENDING_UPLOAD_DEBUG_FAULTS.localStorageParse,
      key: "queue-load-local-parse",
      summary: "localStorage parse 실패를 재현합니다.",
      trigger: "작업실 새로고침 또는 재진입",
    }),
    persistIndexedDbWrite: Object.freeze({
      expectedFlow: "persist degraded / action error",
      fault: PENDING_UPLOAD_DEBUG_FAULTS.indexedDbWrite,
      key: "queue-persist-indexeddb-write",
      summary: "IndexedDB write 실패를 재현합니다.",
      trigger: "로컬 큐 상태 변경 작업 1회",
    }),
    persistLocalWrite: Object.freeze({
      expectedFlow: "persist degraded / action error",
      fault: PENDING_UPLOAD_DEBUG_FAULTS.localStorageWrite,
      key: "queue-persist-local-write",
      summary: "localStorage write 실패를 재현합니다.",
      trigger: "로컬 큐 상태 변경 작업 1회",
    }),
    cleanupIndexedDbDelete: Object.freeze({
      expectedFlow: "cleanup degraded / action error",
      fault: PENDING_UPLOAD_DEBUG_FAULTS.indexedDbDelete,
      key: "queue-cleanup-indexeddb-delete",
      summary: "IndexedDB delete 실패를 재현합니다.",
      trigger: "로컬 큐 삭제 작업 1회",
    }),
  });

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
      "indexeddb-delete-failed",
      "indexeddb-open-failed",
      "indexeddb-read-failed",
      "indexeddb-unavailable",
      "indexeddb-write-failed",
      "local-storage-invalid-payload",
      "local-storage-parse-failed",
      "local-storage-read-failed",
      "local-storage-write-failed",
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
    if (code === "indexeddb-read-failed") {
      return "브라우저 로컬 보관 큐의 IndexedDB 데이터를 읽지 못했어요.";
    }
    if (code === "indexeddb-write-failed") {
      return "브라우저 로컬 보관 큐의 IndexedDB 데이터를 저장하지 못했어요.";
    }
    if (code === "indexeddb-delete-failed") {
      return "브라우저 로컬 보관 큐의 IndexedDB 데이터를 정리하지 못했어요.";
    }
    if (code === "local-storage-read-failed") {
      return "브라우저 로컬 보관 큐를 읽지 못했어요.";
    }
    if (code === "local-storage-write-failed") {
      return "브라우저 로컬 보관 큐를 저장하지 못했어요.";
    }
    if (code === "local-storage-parse-failed") {
      return "브라우저 로컬 보관 큐를 해석하지 못했어요.";
    }
    if (code === "local-storage-invalid-payload") {
      return "브라우저 로컬 보관 큐 형식이 올바르지 않아요.";
    }
    return "";
  }

  function createPendingUploadStorageDiagnostics(operation, issues = []) {
    const normalizedIssues = Array.isArray(issues) ? issues.filter(Boolean) : [];
    return {
      degradedReason: summarizePendingUploadStorageIssues(normalizedIssues),
      issues: normalizedIssues,
      operation: normalizeText(operation),
    };
  }

  function recordPendingUploadStorageIssue(issues, issue) {
    if (!Array.isArray(issues) || !issue) {
      return;
    }
    issues.push(issue);
  }

  function consumePendingUploadStorageDebugFault(name) {
    return typeof consumeDebugFault === "function" && consumeDebugFault(name);
  }

  function getPendingUploadDebugScenario(name) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return null;
    return Object.values(PENDING_UPLOAD_DEBUG_SCENARIOS).find((scenario) => (
      normalizeText(scenario?.key) === normalizedName
      || normalizeText(scenario?.fault) === normalizedName
    )) || null;
  }

  function getPendingUploadDebugScenarios() {
    const snapshot = {};
    for (const scenario of Object.values(PENDING_UPLOAD_DEBUG_SCENARIOS)) {
      if (!normalizeText(scenario?.key)) continue;
      snapshot[scenario.key] = {
        expectedFlow: normalizeText(scenario.expectedFlow),
        fault: normalizeText(scenario.fault),
        summary: normalizeText(scenario.summary),
        trigger: normalizeText(scenario.trigger),
      };
    }
    return snapshot;
  }

  function armPendingUploadDebugScenario(name, count = 1) {
    const scenario = getPendingUploadDebugScenario(name);
    if (!scenario) {
      throw new Error(`알 수 없는 pending upload debug scenario: ${normalizeText(name) || "(empty)"}`);
    }
    const normalizedCount = count === true ? true : Math.max(1, Math.floor(Number(count) || 0)) || 1;
    if (typeof setDebugFault === "function") {
      setDebugFault(scenario.fault, normalizedCount);
    }
    return {
      ...scenario,
      armedCount: normalizedCount === true ? "always" : normalizedCount,
    };
  }

  function clearPendingUploadDebugScenario(name) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      for (const scenario of Object.values(PENDING_UPLOAD_DEBUG_SCENARIOS)) {
        if (typeof clearDebugFault === "function") {
          clearDebugFault(scenario.fault);
        }
      }
      return getPendingUploadDebugScenarios();
    }
    const scenario = getPendingUploadDebugScenario(normalizedName);
    if (scenario && typeof clearDebugFault === "function") {
      clearDebugFault(scenario.fault);
      return {
        cleared: scenario.key,
        fault: scenario.fault,
      };
    }
    if (typeof clearDebugFault === "function") {
      clearDebugFault(normalizedName);
    }
    return {
      cleared: normalizedName,
      fault: normalizedName,
    };
  }

  function buildPendingUploadStorageDebugFaultError(message) {
    const error = new Error(normalizeText(message) || "pending upload storage debug fault injected");
    error.name = "InjectedDebugFault";
    return error;
  }

  function getPendingUploadStorageDebugFaultName(failureCode) {
    const normalizedFailureCode = normalizeText(failureCode);
    if (normalizedFailureCode === "indexeddb-read-failed") return PENDING_UPLOAD_DEBUG_FAULTS.indexedDbRead;
    if (normalizedFailureCode === "indexeddb-write-failed") return PENDING_UPLOAD_DEBUG_FAULTS.indexedDbWrite;
    if (normalizedFailureCode === "indexeddb-delete-failed") return PENDING_UPLOAD_DEBUG_FAULTS.indexedDbDelete;
    return "";
  }

  async function runPendingUploadStoreRequest(store, method, args, issues, failureCode) {
    const debugFaultName = getPendingUploadStorageDebugFaultName(failureCode);
    if (consumePendingUploadStorageDebugFault(debugFaultName)) {
      const error = buildPendingUploadStorageDebugFaultError(`${failureCode} debug fault injected`);
      recordPendingUploadStorageIssue(issues, buildPendingUploadStorageIssue(failureCode, {
        errorName: normalizeText(error.name),
        message: error.message,
        storage: "indexeddb",
      }));
      throw error;
    }
    return runPendingUploadStorageRequest(store[method](...(Array.isArray(args) ? args : [])), issues, failureCode);
  }

  async function runPendingUploadStorageRequest(request, issues, failureCode) {
    try {
      return await runIdbRequest(request);
    } catch (error) {
      recordPendingUploadStorageIssue(issues, buildPendingUploadStorageIssue(failureCode, {
        errorName: normalizeText(error?.name),
        message: error instanceof Error ? error.message : String(error || ""),
        storage: "indexeddb",
      }));
      throw error;
    }
  }

  function readLocalStorageValueDetailed(target, key) {
    const normalizedKey = normalizeText(key);
    if (consumePendingUploadStorageDebugFault(PENDING_UPLOAD_DEBUG_FAULTS.localStorageRead)) {
      return {
        issue: buildPendingUploadStorageIssue("local-storage-read-failed", {
          errorName: "InjectedDebugFault",
          key: normalizedKey,
          message: "local-storage-read-failed debug fault injected",
          storage: "local-storage",
        }),
        value: "",
      };
    }
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
    if (consumePendingUploadStorageDebugFault(PENDING_UPLOAD_DEBUG_FAULTS.localStorageInvalidPayload)) {
      return {
        issue: buildPendingUploadStorageIssue("local-storage-invalid-payload", {
          key,
          message: "local-storage-invalid-payload debug fault injected",
          storage: "local-storage",
        }),
        items: [],
      };
    }
    if (consumePendingUploadStorageDebugFault(PENDING_UPLOAD_DEBUG_FAULTS.localStorageParse)) {
      return {
        issue: buildPendingUploadStorageIssue("local-storage-parse-failed", {
          errorName: "InjectedDebugFault",
          key,
          message: "local-storage-parse-failed debug fault injected",
          storage: "local-storage",
        }),
        items: [],
      };
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

  function writeLocalStorageValueDetailed(target, key, value) {
    const normalizedKey = normalizeText(key);
    if (consumePendingUploadStorageDebugFault(PENDING_UPLOAD_DEBUG_FAULTS.localStorageWrite)) {
      return buildPendingUploadStorageIssue("local-storage-write-failed", {
        errorName: "InjectedDebugFault",
        key: normalizedKey,
        message: "local-storage-write-failed debug fault injected",
        storage: "local-storage",
      });
    }
    try {
      if (!target?.localStorage || typeof target.localStorage.setItem !== "function") {
        throw new Error("local-storage unavailable");
      }
      target.localStorage.setItem(normalizedKey, value);
      return null;
    } catch (error) {
      return buildPendingUploadStorageIssue("local-storage-write-failed", {
        errorName: normalizeText(error?.name),
        key: normalizedKey,
        message: error instanceof Error ? error.message : String(error || ""),
        storage: "local-storage",
      });
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
    const publishedPartCount = parts.length
      ? Math.min(uploadedPartCount, Math.max(0, Number(item.publishedPartCount) || 0))
      : 0;
    const supersededJobIds = Array.from(new Set(
      (Array.isArray(item.supersededJobIds) ? item.supersededJobIds : [item.supersededJobId])
        .map((jobId) => normalizeText(jobId))
        .filter(Boolean)
    ));
    const requestId = normalizeText(item.requestId);
    const supersededRequestIds = Array.from(new Set(
      (Array.isArray(item.supersededRequestIds) ? item.supersededRequestIds : [item.supersededRequestId])
        .map((value) => normalizeText(value))
        .filter((value) => Boolean(value) && value !== requestId)
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
      publishedPartCount,
      preparedPartCount: Math.max(0, Number(item.preparedPartCount) || parts.length),
      requestId,
      sharedMemoSnapshot: normalizeTextBlock(item.sharedMemoSnapshot),
      sizeBytes: Math.max(0, Number(item.sizeBytes) || Number(item.blob?.size) || 0),
      sourceMode: normalizeText(item.sourceMode) || (parts.length ? "chunked" : "single"),
      startedAt: normalizeText(item.startedAt),
      storageObject: normalizeText(item.storageObject),
      status: normalizePendingStatus(item.status, Boolean(item.hold)),
      supersededJobIds,
      supersededRequestIds,
      uploadedPartCount: Math.max(0, Number(item.uploadedPartCount) || uploadedPartCount),
      updatedAt: normalizeText(item.updatedAt) || new Date().toISOString(),
    };
  }

  function collapseSupersededPendingUploads(items) {
    const normalizedItems = (Array.isArray(items) ? items : []).map(normalizePendingUpload);
    const supersededRequestIds = new Set(
      normalizedItems.flatMap((item) => Array.isArray(item?.supersededRequestIds) ? item.supersededRequestIds : [])
        .map((requestId) => normalizeText(requestId))
        .filter(Boolean)
    );
    return normalizedItems.filter((item) => !supersededRequestIds.has(normalizeText(item?.requestId)));
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
    let lastDiagnostics = createPendingUploadStorageDiagnostics("");

    return {
      async clearMeeting(meetingId) {
        const normalizedMeetingId = normalizeText(meetingId);
        await runWithDiagnostics(PENDING_UPLOAD_DIAGNOSTIC_OPERATIONS.clearMeeting, async (issues) => {
          const items = await listByMeetingInternal(normalizedMeetingId, issues);
          for (const item of items) {
            await deletePendingUploadInternal(item.requestId, issues);
          }
        });
      },
      async delete(requestId) {
        await runWithDiagnostics(PENDING_UPLOAD_DIAGNOSTIC_OPERATIONS.delete, async (issues) => {
          await deletePendingUploadInternal(requestId, issues);
        });
      },
      async listByMeeting(meetingId) {
        return runWithDiagnostics(PENDING_UPLOAD_DIAGNOSTIC_OPERATIONS.listByMeeting, async (issues) => {
          return listByMeetingInternal(meetingId, issues);
        });
      },
      async put(item) {
        await runWithDiagnostics(PENDING_UPLOAD_DIAGNOSTIC_OPERATIONS.put, async (issues) => {
          const normalized = normalizePendingUpload(item);
          const supersededRequestIds = (Array.isArray(normalized.supersededRequestIds) ? normalized.supersededRequestIds : [])
            .map((requestId) => normalizeText(requestId))
            .filter(Boolean);
          const db = await openDb(issues);
          if (db) {
            const store = db.transaction(PENDING_UPLOAD_STORE_NAME, "readwrite").objectStore(PENDING_UPLOAD_STORE_NAME);
            await Promise.all([
              runPendingUploadStoreRequest(
                store,
                "put",
                [await serializePendingUpload(normalized, false)],
                issues,
                "indexeddb-write-failed"
              ),
              ...supersededRequestIds.map((requestId) => runPendingUploadStoreRequest(
                store,
                "delete",
                [requestId],
                issues,
                "indexeddb-delete-failed"
              )),
            ]);
            return;
          }
          const items = await readLocalItems(issues);
          const serialized = await serializePendingUpload(normalized, true);
          await writeLocalItems([serialized, ...items.filter((current) => {
            const currentRequestId = normalizeText(current.requestId);
            return currentRequestId !== normalized.requestId && !supersededRequestIds.includes(currentRequestId);
          })], issues);
        });
      },
      consumeDiagnostics() {
        const nextDiagnostics = lastDiagnostics;
        lastDiagnostics = createPendingUploadStorageDiagnostics("");
        return nextDiagnostics;
      },
    };

    function setDiagnostics(operation, issues) {
      lastDiagnostics = createPendingUploadStorageDiagnostics(operation, issues);
    }

    async function runWithDiagnostics(operation, action) {
      const issues = [];
      try {
        const result = await action(issues);
        setDiagnostics(operation, issues);
        return result;
      } catch (error) {
        setDiagnostics(operation, issues);
        throw error;
      }
    }

    async function listByMeetingInternal(meetingId, issues) {
      const normalizedMeetingId = normalizeText(meetingId);
      const db = await openDb(issues);
      if (db) {
        const items = await runPendingUploadStoreRequest(
          db.transaction(PENDING_UPLOAD_STORE_NAME, "readonly").objectStore(PENDING_UPLOAD_STORE_NAME),
          "getAll",
          [],
          issues,
          "indexeddb-read-failed"
        );
        return Promise.all((Array.isArray(items) ? items : []).filter((item) => normalizeText(item.meetingId) === normalizedMeetingId).map(deserializePendingUpload));
      }
      const localItems = await readLocalItems(issues);
      return Promise.all(localItems.filter((item) => normalizeText(item.meetingId) === normalizedMeetingId).map(deserializePendingUpload));
    }

    async function deletePendingUploadInternal(requestId, issues) {
      const normalizedRequestId = normalizeText(requestId);
      if (!normalizedRequestId) return;
      const db = await openDb(issues);
      if (db) {
        await runPendingUploadStoreRequest(
          db.transaction(PENDING_UPLOAD_STORE_NAME, "readwrite").objectStore(PENDING_UPLOAD_STORE_NAME),
          "delete",
          [normalizedRequestId],
          issues,
          "indexeddb-delete-failed"
        );
        return;
      }
      const items = await readLocalItems(issues);
      const nextItems = items.filter((item) => normalizeText(item.requestId) !== normalizedRequestId);
      await writeLocalItems(nextItems, issues);
    }

    async function openDb(issues) {
      const nextIssues = Array.isArray(issues) ? issues : [];
      if (fallbackToLocalStorage) {
        if (indexedDbFallbackIssue) {
          recordPendingUploadStorageIssue(nextIssues, indexedDbFallbackIssue);
        }
        return null;
      }
      if (typeof target.indexedDB?.open !== "function") {
        fallbackToLocalStorage = true;
        indexedDbFallbackIssue = buildPendingUploadStorageIssue("indexeddb-unavailable", {
          storage: "indexeddb",
        });
        recordPendingUploadStorageIssue(nextIssues, indexedDbFallbackIssue);
        return null;
      }
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          if (consumePendingUploadStorageDebugFault(PENDING_UPLOAD_DEBUG_FAULTS.indexedDbOpen)) {
            reject(buildPendingUploadStorageDebugFaultError("indexeddb-open-failed debug fault injected"));
            return;
          }
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
        recordPendingUploadStorageIssue(nextIssues, indexedDbFallbackIssue);
        return null;
      }
    }

    async function readLocalItems(issues) {
      const nextIssues = Array.isArray(issues) ? issues : [];
      const storageEntry = readLocalStorageValueDetailed(target, PENDING_UPLOAD_LOCAL_STORAGE_KEY);
      recordPendingUploadStorageIssue(nextIssues, storageEntry.issue);
      if (!normalizeText(storageEntry.value)) {
        return [];
      }
      const parsedEntry = parsePendingUploadItemsDetailed(storageEntry.value, PENDING_UPLOAD_LOCAL_STORAGE_KEY);
      recordPendingUploadStorageIssue(nextIssues, parsedEntry.issue);
      return Array.isArray(parsedEntry.items) ? parsedEntry.items : [];
    }

    async function writeLocalItems(items, issues) {
      const nextIssues = Array.isArray(issues) ? issues : [];
      const issue = writeLocalStorageValueDetailed(target, PENDING_UPLOAD_LOCAL_STORAGE_KEY, JSON.stringify(items || []));
      recordPendingUploadStorageIssue(nextIssues, issue);
    }
  }

  ns.storage = {
    DEBUG_FAULTS: PENDING_UPLOAD_DEBUG_FAULTS,
    DEBUG_SCENARIOS: PENDING_UPLOAD_DEBUG_SCENARIOS,
    blobToBase64,
    collapseSupersededPendingUploads,
    comparePendingUploads,
    createPendingUploadStore,
    normalizePendingUpload,
    normalizePendingStatus,
  };

  const debugApi = global.__INOVA_HOSTED_MEETING_DEBUG__ = global.__INOVA_HOSTED_MEETING_DEBUG__ || {};
  debugApi.queueFaults = {
    arm: armPendingUploadDebugScenario,
    clear: clearPendingUploadDebugScenario,
    scenarios: getPendingUploadDebugScenarios,
  };
})(globalThis);
