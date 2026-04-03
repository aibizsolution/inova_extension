(function initHostedMeetingShared(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  const SESSION_STORAGE_KEY = "inova-hosted-meeting-session";
  const LOCAL_STORAGE_KEY_PREFIX = "inova-hosted-meeting-session::";
  const WORKSPACE_HASH_PARAM = "ws";
  const DEBUG_PREFIX = "[Inova Hosted Meeting]";
  const DEBUG_FAULTS_SESSION_STORAGE_KEY = "inova-hosted-meeting-debug-faults";
  const DEFAULT_CREATE_JOB_TIMEOUT_MS = 9 * 60 * 1000;
  const DEFAULT_INLINE_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
  const DEFAULT_SOURCE_TARGET_PART_BYTES = 20 * 1024 * 1024;
  const DEFAULT_SOURCE_MAX_BYTES = 200 * 1024 * 1024;
  const DEFAULT_SOURCE_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
  const DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS = 20 * 60 * 1000;
  const DEFAULT_SOURCE_CHUNK_DURATION_MS = 9 * 60 * 1000;
  const DEFAULT_SOURCE_CHUNK_OVERLAP_MS = 1500;
  const DEFAULT_SOURCE_CHUNK_SAMPLE_RATE = 16000;
  const DEFAULT_MAX_RECORDING_DURATION_MS = 90 * 60 * 1000;
  const DEFAULT_NOTES_MODE = "general";
  const DEFAULT_NOTES_STYLE = "default";
  const DEFAULT_RECORDING_AUDIO_BITS_PER_SECOND = 30000;
  const DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;
  const FIREBASE_WEB_CONFIG = {
    apiKey: "AIzaSyDnVS7MmQs7wWjVPihr1MNmcALxJ0a1qPM",
    appId: "1:1027279095019:web:755f1f1a02cbae0d262aae",
    authDomain: "browser-extension-main.firebaseapp.com",
    messagingSenderId: "1027279095019",
    projectId: "browser-extension-main",
    storageBucket: "browser-extension-main.firebasestorage.app",
  };
  const FIRESTORE_COLLECTIONS = {
    artifacts: "integration_inova_meeting_artifacts",
    jobs: "integration_inova_meeting_jobs",
    meetings: "integration_inova_meetings",
  };
  const MAX_PREVIEW_TEXT_LENGTH = 180;
  const MAX_DEBUG_LOG_ENTRIES = 120;
  const TERMINAL_REMOTE_STATUSES = new Set(["succeeded", "failed"]);
  const AUTO_RETRY_PENDING_STATUSES = new Set(["local_saved", "upload_queued"]);
  const debugListeners = new Set();
  const debugEntries = [];
  const debugFaults = readDebugFaultRegistry();
  let debugSequence = 0;
  let debugEnabled = false;

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeTextBlock(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim();
  }

  function normalizeTextArray(values) {
    return (Array.isArray(values) ? values : [])
      .map((value) => normalizeText(value))
      .filter(Boolean);
  }

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function readDebugFaultRegistry() {
    try {
      if (!global?.sessionStorage || typeof global.sessionStorage.getItem !== "function") {
        return Object.create(null);
      }
      const raw = normalizeText(global.sessionStorage.getItem(DEBUG_FAULTS_SESSION_STORAGE_KEY));
      if (!raw) return Object.create(null);
      const parsed = JSON.parse(raw);
      const nextRegistry = Object.create(null);
      for (const [name, count] of Object.entries(parsed || {})) {
        const normalizedName = normalizeText(name);
        if (!normalizedName) continue;
        const normalizedCount = Number(count);
        if (normalizedCount === -1) {
          nextRegistry[normalizedName] = -1;
          continue;
        }
        if (Number.isFinite(normalizedCount) && normalizedCount > 0) {
          nextRegistry[normalizedName] = Math.floor(normalizedCount);
        }
      }
      return nextRegistry;
    } catch {
      return Object.create(null);
    }
  }

  function persistDebugFaultRegistry() {
    try {
      if (!global?.sessionStorage || typeof global.sessionStorage.setItem !== "function") {
        return;
      }
      const snapshot = {};
      for (const [name, count] of Object.entries(debugFaults)) {
        const normalizedName = normalizeText(name);
        if (!normalizedName) continue;
        if (count === -1) snapshot[normalizedName] = -1;
        else if (Number.isFinite(count) && count > 0) snapshot[normalizedName] = Math.floor(count);
      }
      global.sessionStorage.setItem(DEBUG_FAULTS_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {}
  }

  function parsePositiveInteger(value) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function isLocalWorkspaceOrigin(globalObject) {
    try {
      const origin = new URL(String(globalObject?.location?.href || "")).origin;
      return ["http://127.0.0.1:5000", "http://localhost:5000"].includes(origin);
    } catch {
      return false;
    }
  }

  function isDebugPanelEnabled(globalObject) {
    try {
      const current = new URL(String(globalObject?.location?.href || ""));
      return normalizeText(current.searchParams.get("debug")) === "1";
    } catch {
      return false;
    }
  }

  function readLocalWorkspaceOverride(globalObject, searchParamName, storageKey) {
    if (!isLocalWorkspaceOrigin(globalObject)) {
      return 0;
    }
    try {
      const current = new URL(String(globalObject?.location?.href || ""));
      const fromSearch = parsePositiveInteger(current.searchParams.get(searchParamName));
      if (fromSearch > 0) {
        return fromSearch;
      }
    } catch {}
    try {
      return parsePositiveInteger(globalObject?.localStorage?.getItem(storageKey));
    } catch {
      return 0;
    }
  }

  function resolveRecordingProfile(globalObject) {
    const limitSecondsOverride = readLocalWorkspaceOverride(
      globalObject,
      "recordLimitSeconds",
      "__INOVA_MEETING_RECORD_LIMIT_SECONDS__"
    );
    const audioBitsOverride = readLocalWorkspaceOverride(
      globalObject,
      "audioBitsPerSecond",
      "__INOVA_MEETING_AUDIO_BITS_PER_SECOND__"
    );
    const maxDurationMs = Math.max(
      30 * 1000,
      limitSecondsOverride > 0 ? limitSecondsOverride * 1000 : DEFAULT_MAX_RECORDING_DURATION_MS
    );
    const audioBitsPerSecond = Math.max(
      16000,
      Math.min(64000, audioBitsOverride > 0 ? audioBitsOverride : DEFAULT_RECORDING_AUDIO_BITS_PER_SECOND)
    );
    return {
      audioBitsPerSecond,
      isLocalOverride: Boolean(limitSecondsOverride || audioBitsOverride),
      maxDurationMs,
    };
  }

  function joinUrl(baseUrl, pathName) {
    return `${normalizeBaseUrl(baseUrl)}/${String(pathName || "").replace(/^\/+/, "")}`;
  }

  function resolveConfig(override) {
    const normalizedOverride = override && typeof override === "object" ? override : {};
    const functionsBaseUrl = normalizeBaseUrl(
      normalizedOverride.functionsBaseUrl
      || "https://asia-northeast3-browser-extension-main.cloudfunctions.net"
    );
    return {
      createJobUrl: joinUrl(functionsBaseUrl, "createInovaMeetingJob"),
      deleteMeetingResultUrl: joinUrl(functionsBaseUrl, "deleteInovaMeetingResult"),
      deleteMeetingUrl: joinUrl(functionsBaseUrl, "deleteInovaMeeting"),
      exchangeLaunchUrl: joinUrl(functionsBaseUrl, "exchangeInovaMeetingLaunch"),
      firestoreCollections: {
        ...FIRESTORE_COLLECTIONS,
        ...(normalizedOverride.firestoreCollections || {}),
      },
      firebaseWebConfig: {
        ...FIREBASE_WEB_CONFIG,
        ...(normalizedOverride.firebaseWebConfig || {}),
      },
      functionsBaseUrl,
      getArtifactUrl: joinUrl(functionsBaseUrl, "getInovaMeetingArtifact"),
      getJobUrl: joinUrl(functionsBaseUrl, "getInovaMeetingJob"),
      issueWorkspaceAuthUrl: joinUrl(functionsBaseUrl, "issueInovaMeetingWorkspaceAuth"),
      listResultsUrl: joinUrl(functionsBaseUrl, "listInovaMeetingResults"),
      regenerateNotesUrl: joinUrl(functionsBaseUrl, "regenerateInovaMeetingNotes"),
      uploadSourceUrl: joinUrl(functionsBaseUrl, "uploadInovaMeetingSource"),
      updateMeetingResultUrl: joinUrl(functionsBaseUrl, "updateInovaMeetingResult"),
      updateMeetingTitleUrl: joinUrl(functionsBaseUrl, "updateInovaMeeting"),
    };
  }

  function parseParams(url) {
    try {
      const current = new URL(url);
      return {
        jobId: normalizeText(current.searchParams.get("jobId")),
        launchToken: normalizeText(current.searchParams.get("launch")),
        meetingId: normalizeText(current.searchParams.get("meetingId")),
        workspaceToken: readHashParam(current.hash, WORKSPACE_HASH_PARAM),
      };
    } catch {
      return {
        jobId: "",
        launchToken: "",
        meetingId: "",
        workspaceToken: "",
      };
    }
  }

  function buildHeaders(meetingSessionToken) {
    const headers = { "Content-Type": "application/json" };
    const token = normalizeText(meetingSessionToken);
    if (token) {
      headers.Authorization = `MeetingSession ${token}`;
    }
    return headers;
  }

  async function postJson(globalObject, url, body, meetingSessionToken, options) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1000, Number(options?.timeoutMs) || 25000);
    const timeoutId = controller ? globalObject.setTimeout(() => controller.abort(), timeoutMs) : 0;
    logDebug("http.request", {
      body,
      hasMeetingSessionToken: Boolean(normalizeText(meetingSessionToken)),
      timeoutMs,
      url,
    });
    try {
      const response = await globalObject.fetch(url, {
        body: JSON.stringify(body || {}),
        headers: buildHeaders(meetingSessionToken),
        method: "POST",
        signal: controller?.signal,
      });
      const payload = await response.json().catch(() => null);
      logDebug("http.response", {
        ok: Boolean(response.ok && payload?.ok),
        payload,
        status: Number(response.status) || 0,
        url,
      });
      if (!response.ok || !payload?.ok) {
        throw new Error(normalizeText(payload?.error || payload?.message) || "회의 클라우드 요청에 실패했어요.");
      }
      return payload.data || {};
    } catch (error) {
      if (error?.name === "AbortError") {
        logDebug("http.timeout", { url });
        throw new Error("회의 작업실 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.");
      }
      logDebug("http.error", {
        error,
        url,
      });
      throw error;
    } finally {
      if (timeoutId) {
        globalObject.clearTimeout(timeoutId);
      }
    }
  }

  function buildWorkspaceSessionStorageKey(meetingId) {
    return `${LOCAL_STORAGE_KEY_PREFIX}${normalizeText(meetingId)}`;
  }

  function safeParse(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return null;
    }
    try {
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }

  function buildStorageAccessIssue(code, options = {}) {
    return {
      code: normalizeText(code),
      errorName: normalizeText(options.errorName),
      key: normalizeText(options.key),
      message: normalizeText(options.message),
      source: normalizeText(options.source),
      storage: normalizeText(options.storage),
    };
  }

  function readStorageValueDetailed(globalObject, storage, key, source) {
    const normalizedKey = normalizeText(key);
    const normalizedStorage = normalizeText(storage);
    const normalizedSource = normalizeText(source);
    try {
      const target = normalizedStorage === "session-storage"
        ? globalObject?.sessionStorage
        : globalObject?.localStorage;
      if (!target || typeof target.getItem !== "function") {
        throw new Error(`${normalizedStorage || "storage"} unavailable`);
      }
      const value = target.getItem(normalizedKey) || "";
      return {
        issue: normalizeText(value)
          ? null
          : buildStorageAccessIssue("storage-empty", {
              key: normalizedKey,
              source: normalizedSource,
              storage: normalizedStorage,
            }),
        key: normalizedKey,
        source: normalizedSource,
        storage: normalizedStorage,
        value,
      };
    } catch (error) {
      return {
        issue: buildStorageAccessIssue("storage-read-failed", {
          errorName: normalizeText(error?.name),
          key: normalizedKey,
          message: error instanceof Error ? error.message : String(error || ""),
          source: normalizedSource,
          storage: normalizedStorage,
        }),
        key: normalizedKey,
        source: normalizedSource,
        storage: normalizedStorage,
        value: "",
      };
    }
  }

  function writeStorageValueDetailed(globalObject, storage, key, value, source) {
    const normalizedKey = normalizeText(key);
    const normalizedStorage = normalizeText(storage);
    const normalizedSource = normalizeText(source);
    try {
      const target = normalizedStorage === "session-storage"
        ? globalObject?.sessionStorage
        : globalObject?.localStorage;
      if (!target || typeof target.setItem !== "function") {
        throw new Error(`${normalizedStorage || "storage"} unavailable`);
      }
      target.setItem(normalizedKey, value);
      return null;
    } catch (error) {
      return buildStorageAccessIssue("storage-write-failed", {
        errorName: normalizeText(error?.name),
        key: normalizedKey,
        message: error instanceof Error ? error.message : String(error || ""),
        source: normalizedSource,
        storage: normalizedStorage,
      });
    }
  }

  function removeStorageValueDetailed(globalObject, storage, key, source) {
    const normalizedKey = normalizeText(key);
    const normalizedStorage = normalizeText(storage);
    const normalizedSource = normalizeText(source);
    try {
      const target = normalizedStorage === "session-storage"
        ? globalObject?.sessionStorage
        : globalObject?.localStorage;
      if (!target || typeof target.removeItem !== "function") {
        throw new Error(`${normalizedStorage || "storage"} unavailable`);
      }
      target.removeItem(normalizedKey);
      return null;
    } catch (error) {
      return buildStorageAccessIssue("storage-remove-failed", {
        errorName: normalizeText(error?.name),
        key: normalizedKey,
        message: error instanceof Error ? error.message : String(error || ""),
        source: normalizedSource,
        storage: normalizedStorage,
      });
    }
  }

  function parseStoredValueDetailed(value, key, source, storage) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return {
        issue: buildStorageAccessIssue("storage-empty", {
          key,
          source,
          storage,
        }),
        payload: null,
      };
    }
    try {
      return {
        issue: null,
        payload: JSON.parse(normalized),
      };
    } catch (error) {
      return {
        issue: buildStorageAccessIssue("storage-parse-failed", {
          errorName: normalizeText(error?.name),
          key,
          message: error instanceof Error ? error.message : String(error || ""),
          source,
          storage,
        }),
        payload: null,
      };
    }
  }

  function summarizeWorkspaceSessionIssues(issues) {
    const normalizedIssues = Array.isArray(issues) ? issues : [];
    const issue = normalizedIssues.find((entry) => ["storage-read-failed", "storage-write-failed", "storage-remove-failed", "storage-parse-failed", "storage-invalid-payload"].includes(normalizeText(entry?.code)));
    if (!issue) {
      return "";
    }
    const storageLabel = normalizeText(issue.storage) === "session-storage"
      ? "세션 저장소"
      : normalizeText(issue.storage) === "local-storage"
        ? "로컬 저장소"
        : "브라우저 저장소";
    if (normalizeText(issue.code) === "storage-read-failed") {
      return `${storageLabel}를 읽지 못했어요.`;
    }
    if (normalizeText(issue.code) === "storage-write-failed") {
      return `${storageLabel}를 저장하지 못했어요.`;
    }
    if (normalizeText(issue.code) === "storage-remove-failed") {
      return `${storageLabel}를 정리하지 못했어요.`;
    }
    if (normalizeText(issue.code) === "storage-parse-failed") {
      return `${storageLabel}에 저장된 작업실 세션을 해석하지 못했어요.`;
    }
    if (normalizeText(issue.code) === "storage-invalid-payload") {
      return `${storageLabel}에 저장된 작업실 세션 형식이 올바르지 않아요.`;
    }
    return "";
  }

  function safeSessionStorageGet(globalObject, key) {
    try {
      return globalObject.sessionStorage.getItem(key);
    } catch {
      return "";
    }
  }

  function safeSessionStorageSet(globalObject, key, value) {
    try {
      globalObject.sessionStorage.setItem(key, value);
    } catch {}
  }

  function safeLocalStorageGet(globalObject, key) {
    try {
      return globalObject.localStorage.getItem(key);
    } catch {
      return "";
    }
  }

  function safeLocalStorageSet(globalObject, key, value) {
    try {
      globalObject.localStorage.setItem(key, value);
    } catch {}
  }

  function safeLocalStorageRemove(globalObject, key) {
    try {
      globalObject.localStorage.removeItem(key);
    } catch {}
  }

  function buildUrlWorkspaceSession(meetingId, workspaceToken, jobId) {
    const normalizedMeetingId = normalizeText(meetingId);
    const normalizedToken = normalizeText(workspaceToken);
    if (!normalizedMeetingId || !normalizedToken) {
      return null;
    }
    return {
      expiresAt: "",
      jobId: normalizeText(jobId),
      meetingId: normalizedMeetingId,
      meetingSessionToken: normalizedToken,
      mode: normalizeText(jobId) ? "detail" : "create",
      sharedMemo: "",
      title: "",
    };
  }

  function buildWorkspaceHash(workspaceToken) {
    const params = new URLSearchParams();
    params.set(WORKSPACE_HASH_PARAM, normalizeText(workspaceToken));
    const serialized = params.toString();
    return serialized ? `#${serialized}` : "";
  }

  function readHashParam(hash, key) {
    const normalizedHash = String(hash || "").replace(/^#/, "");
    if (!normalizedHash) {
      return "";
    }
    try {
      return normalizeText(new URLSearchParams(normalizedHash).get(key));
    } catch {
      return "";
    }
  }

  function isExpired(value) {
    const expiryTime = Date.parse(String(value || ""));
    return Boolean(expiryTime) && expiryTime <= Date.now();
  }

  function clearPersistedWorkspaceSession(globalObject, meetingId) {
    const issues = [];
    const sessionRemoveIssue = removeStorageValueDetailed(
      globalObject,
      "session-storage",
      SESSION_STORAGE_KEY,
      "session-storage"
    );
    if (sessionRemoveIssue) {
      issues.push(sessionRemoveIssue);
    }
    const normalizedMeetingId = normalizeText(meetingId);
    if (normalizedMeetingId) {
      const localRemoveIssue = removeStorageValueDetailed(
        globalObject,
        "local-storage",
        buildWorkspaceSessionStorageKey(normalizedMeetingId),
        "local-storage"
      );
      if (localRemoveIssue) {
        issues.push(localRemoveIssue);
      }
    }
    return {
      degradedReason: summarizeWorkspaceSessionIssues(issues),
      issues,
    };
  }

  function loadPersistedWorkspaceSession(globalObject, requestedMeetingId, workspaceToken, requestedJobId) {
    const issues = [];
    const candidates = [];
    const urlPayload = buildUrlWorkspaceSession(requestedMeetingId, workspaceToken, requestedJobId);
    if (urlPayload) {
      candidates.push({
        key: WORKSPACE_HASH_PARAM,
        payload: urlPayload,
        source: "url-hash",
        storage: "url-hash",
      });
    }
    const sessionStorageEntry = readStorageValueDetailed(globalObject, "session-storage", SESSION_STORAGE_KEY, "session-storage");
    if (sessionStorageEntry.issue) {
      issues.push(sessionStorageEntry.issue);
    }
    if (normalizeText(sessionStorageEntry.value)) {
      const parsedSessionStorageEntry = parseStoredValueDetailed(
        sessionStorageEntry.value,
        sessionStorageEntry.key,
        sessionStorageEntry.source,
        sessionStorageEntry.storage
      );
      if (parsedSessionStorageEntry.issue) {
        issues.push(parsedSessionStorageEntry.issue);
      }
      if (parsedSessionStorageEntry.payload) {
        candidates.push({
          key: sessionStorageEntry.key,
          payload: parsedSessionStorageEntry.payload,
          source: sessionStorageEntry.source,
          storage: sessionStorageEntry.storage,
        });
      }
    }
    if (requestedMeetingId) {
      const localStorageKey = buildWorkspaceSessionStorageKey(requestedMeetingId);
      const localStorageEntry = readStorageValueDetailed(globalObject, "local-storage", localStorageKey, "local-storage");
      if (localStorageEntry.issue) {
        issues.push(localStorageEntry.issue);
      }
      if (normalizeText(localStorageEntry.value)) {
        const parsedLocalStorageEntry = parseStoredValueDetailed(
          localStorageEntry.value,
          localStorageEntry.key,
          localStorageEntry.source,
          localStorageEntry.storage
        );
        if (parsedLocalStorageEntry.issue) {
          issues.push(parsedLocalStorageEntry.issue);
        }
        if (parsedLocalStorageEntry.payload) {
          candidates.push({
            key: localStorageEntry.key,
            payload: parsedLocalStorageEntry.payload,
            source: localStorageEntry.source,
            storage: localStorageEntry.storage,
          });
        }
      }
    }

    for (const candidate of candidates) {
      const parsed = candidate.payload;
      const meetingId = normalizeText(parsed?.meetingId);
      const token = normalizeText(parsed?.meetingSessionToken);
      const expiresAt = normalizeText(parsed?.expiresAt);
      if (!meetingId || !token) {
        if (candidate.source !== "url-hash") {
          issues.push(buildStorageAccessIssue("storage-invalid-payload", {
            key: candidate.key,
            source: candidate.source,
            storage: candidate.storage,
          }));
        }
        continue;
      }
      if (requestedMeetingId && requestedMeetingId !== meetingId) {
        continue;
      }
      if (isExpired(expiresAt)) {
        if (candidate.source !== "url-hash") {
          issues.push(buildStorageAccessIssue("storage-expired", {
            key: candidate.key,
            source: candidate.source,
            storage: candidate.storage,
          }));
        }
        const cleared = clearPersistedWorkspaceSession(globalObject, meetingId);
        if (Array.isArray(cleared?.issues) && cleared.issues.length) {
          issues.push(...cleared.issues);
        }
        continue;
      }
      const sessionWriteIssue = writeStorageValueDetailed(
        globalObject,
        "session-storage",
        SESSION_STORAGE_KEY,
        JSON.stringify(parsed),
        "session-storage"
      );
      if (sessionWriteIssue) {
        issues.push(sessionWriteIssue);
      }
      const localWriteIssue = writeStorageValueDetailed(
        globalObject,
        "local-storage",
        buildWorkspaceSessionStorageKey(meetingId),
        JSON.stringify(parsed),
        "local-storage"
      );
      if (localWriteIssue) {
        issues.push(localWriteIssue);
      }
      return {
        degradedReason: summarizeWorkspaceSessionIssues(issues),
        issues,
        payload: parsed,
        source: candidate.source,
      };
    }
    return {
      degradedReason: summarizeWorkspaceSessionIssues(issues),
      issues,
      payload: null,
      source: "",
    };
  }

  function persistWorkspaceSessionPayload(globalObject, payload) {
    const nextPayload = payload && typeof payload === "object" ? payload : {};
    const meetingId = normalizeText(nextPayload.meetingId);
    const serialized = JSON.stringify(nextPayload);
    const issues = [];
    const sessionWriteIssue = writeStorageValueDetailed(
      globalObject,
      "session-storage",
      SESSION_STORAGE_KEY,
      serialized,
      "session-storage"
    );
    if (sessionWriteIssue) {
      issues.push(sessionWriteIssue);
    }
    if (meetingId) {
      const localWriteIssue = writeStorageValueDetailed(
        globalObject,
        "local-storage",
        buildWorkspaceSessionStorageKey(meetingId),
        serialized,
        "local-storage"
      );
      if (localWriteIssue) {
        issues.push(localWriteIssue);
      }
    }
    return {
      degradedReason: summarizeWorkspaceSessionIssues(issues),
      issues,
    };
  }

  function toTimestamp(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return 0;
    }
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function normalizeStatus(status) {
    const normalized = normalizeText(status);
    if (["local_saved", "upload_queued", "uploading", "uploading_chunks", "preparing_chunks", "remote_queued", "on_hold"].includes(normalized)) return "queued";
    if (normalized === "remote_processing") return "processing";
    if (["recording", "paused", "queued", "processing", "succeeded", "failed"].includes(normalized)) return normalized;
    return "idle";
  }

  function formatStatusLabel(status) {
    const normalized = normalizeText(status);
    if (normalized === "queued" || normalized === "remote_queued") return "대기";
    if (normalized === "processing" || normalized === "remote_processing") return "진행 중";
    if (normalized === "succeeded") return "완료";
    if (normalized === "failed") return "오류";
    if (normalized === "paused") return "일시중지";
    if (normalized === "recording") return "녹음 중";
    if (normalized === "local_saved") return "로컬 저장";
    if (normalized === "upload_queued") return "업로드 대기";
    if (normalized === "uploading") return "업로드 중";
    if (normalized === "preparing_chunks") return "분할 준비";
    if (normalized === "uploading_chunks") return "분할 업로드";
    if (normalized === "on_hold") return "보류";
    return "대기";
  }

  function formatNotesModeLabel(mode) {
    if (mode === "interview") return "인터뷰";
    if (mode === "review") return "리뷰/회고";
    if (mode === "planning") return "계획 수립";
    return "일반 회의";
  }

  function formatNotesStyleLabel(style) {
    if (style === "brief") return "간결 브리프";
    if (style === "action") return "실행 중심";
    return "기본 회의록";
  }

  function normalizeMeetingNotesMode(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ["general", "interview", "review", "planning"].includes(normalized) ? normalized : "";
  }

  function normalizeMeetingNotesStyle(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ["default", "brief", "action"].includes(normalized) ? normalized : "";
  }

  function formatPhase(phase) {
    const normalized = normalizeText(phase);
    if (normalized === "uploading" || normalized === "upload_queued") return "업로드 준비";
    if (normalized === "preparing_chunks") return "분할 준비 중";
    if (normalized === "uploading_chunks") return "분할 업로드 중";
    if (normalized === "remote_queued" || normalized === "queued") return "원격 대기";
    if (normalized === "remote_processing" || normalized === "processing") return "원격 처리";
    if (normalized === "transcribing") return "전사 중";
    if (normalized === "transcribing_chunks") return "분할 전사 중";
    if (normalized === "assembling_transcript") return "청크 병합 중";
    if (normalized === "reconciling_speakers") return "화자 정합 중";
    if (normalized === "generating_notes") return "회의 정리 중";
    if (normalized === "diarizing") return "화자 구분 중";
    if (normalized === "finalizing") return "회의록 정리 중";
    return normalized;
  }

  function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round(Number(durationMs) / 1000));
    if (!totalSeconds) return "-";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}시간 ${String(minutes).padStart(2, "0")}분 ${String(seconds).padStart(2, "0")}초`;
    if (minutes) return `${minutes}분 ${String(seconds).padStart(2, "0")}초`;
    return `${seconds}초`;
  }

  function formatBytes(sizeBytes) {
    const bytes = Math.max(0, Number(sizeBytes) || 0);
    if (!bytes) return "-";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${bytes}B`;
  }

  function formatDateTime(value, fallback) {
    const normalized = normalizeText(value);
    if (!normalized) return fallback || "-";
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return fallback || "-";
    return `${String(parsed.getMonth() + 1).padStart(2, "0")}.${String(parsed.getDate()).padStart(2, "0")} ${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
  }

  function formatDurationShort(value) {
    const totalSeconds = Math.max(0, Math.floor(Number(value) / 1000));
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }

  function formatSegmentRange(startMs, endMs) {
    return `${formatDurationShort(startMs)} - ${formatDurationShort(endMs)}`;
  }

  function buildDefaultSpeakerDisplayName(value) {
    const normalized = normalizeText(value);
    if (!normalized) return "화자";
    const diarizedMatch = normalized.match(/^SPEAKER_(\d+)$/i);
    if (diarizedMatch) {
      return `화자 ${Number.parseInt(diarizedMatch[1], 10) + 1}`;
    }
    if (/^[A-Z]$/i.test(normalized)) {
      return `화자 ${normalized.toUpperCase()}`;
    }
    return normalized;
  }

  function normalizeSpeakerAliases(input, allowedLabels) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const allowAll = !(allowedLabels instanceof Set);
    const normalized = {};
    for (const [rawLabel, rawAlias] of Object.entries(source)) {
      const label = normalizeText(rawLabel);
      const alias = normalizeTextBlock(rawAlias).replace(/\n+/g, " ").replace(/\s+/g, " ").slice(0, 80);
      if (!label || !alias) continue;
      if (!allowAll && !allowedLabels.has(label)) continue;
      if (alias === label) continue;
      normalized[label] = alias;
    }
    return normalized;
  }

  function resolveSpeakerDisplayName(value, speakerAliases) {
    const label = normalizeText(value);
    return normalizeText(speakerAliases?.[label]) || buildDefaultSpeakerDisplayName(label);
  }

  function formatSpeakerLabel(value) {
    return buildDefaultSpeakerDisplayName(value);
  }

  function cleanPreviewText(value) {
    const normalized = normalizeTextBlock(value).replace(/SPEAKER_\d+\s*:\s*/gi, "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length > MAX_PREVIEW_TEXT_LENGTH ? `${normalized.slice(0, MAX_PREVIEW_TEXT_LENGTH - 3)}...` : normalized;
  }

  function countSpeakers(segments) {
    return new Set((Array.isArray(segments) ? segments : []).map((segment) => normalizeText(segment?.speakerLabel)).filter(Boolean)).size;
  }

  function isOnline(globalObject) {
    return typeof globalObject.navigator?.onLine === "boolean" ? globalObject.navigator.onLine : true;
  }

  function isLikelyNetworkError(globalObject, error) {
    const message = normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return !isOnline(globalObject) || message.includes("network") || message.includes("fetch") || message.includes("failed to fetch") || message.includes("load failed");
  }

  function generateCaptureRequestId(globalObject) {
    if (typeof globalObject.crypto?.randomUUID === "function") {
      return globalObject.crypto.randomUUID();
    }
    return `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function pickRecorderMimeType(globalObject) {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
    for (const candidate of candidates) {
      try {
        if (typeof globalObject.MediaRecorder?.isTypeSupported !== "function" || globalObject.MediaRecorder.isTypeSupported(candidate)) {
          return candidate;
        }
      } catch {}
    }
    return "";
  }

  function stopTracks(stream) {
    const tracks = typeof stream?.getTracks === "function" ? stream.getTracks() : [];
    for (const track of tracks) {
      try {
        track.stop();
      } catch {}
    }
  }

  function normalizeDebugPayload(value, depth = 0) {
    if (depth >= 5) {
      if (value instanceof Error) {
        return {
          message: normalizeText(value.message),
          name: normalizeText(value.name),
        };
      }
      if (typeof value === "string") {
        return value.length > 320 ? `${value.slice(0, 317)}...` : value;
      }
      if (typeof value === "number" || typeof value === "boolean" || value == null) {
        return value;
      }
      if (Array.isArray(value)) {
        return {
          kind: "array",
          length: value.length,
        };
      }
      if (typeof value === "object") {
        return {
          kind: "object",
          keys: Object.keys(value).slice(0, 10),
        };
      }
      return normalizeText(value);
    }
    if (value instanceof Error) {
      return {
        message: normalizeText(value.message),
        name: normalizeText(value.name),
        stack: normalizeText(value.stack),
      };
    }
    if (Array.isArray(value)) {
      return value.slice(0, 10).map((entry) => normalizeDebugPayload(entry, depth + 1));
    }
    if (value && typeof value === "object") {
      const next = {};
      for (const [key, nestedValue] of Object.entries(value).slice(0, 16)) {
        next[key] = normalizeDebugPayload(nestedValue, depth + 1);
      }
      return next;
    }
    return value;
  }

  function getDebugEntries() {
    return debugEntries.map((entry) => ({
      ...entry,
      payload: normalizeDebugPayload(entry.payload),
    }));
  }

  function clearDebugEntries() {
    debugEntries.length = 0;
    notifyDebugListeners();
  }

  function setEnabled(nextEnabled) {
    debugEnabled = Boolean(nextEnabled);
    return debugEnabled;
  }

  function formatDebugEntry(entry) {
    const timestamp = normalizeText(entry?.timestamp);
    const event = normalizeText(entry?.event);
    const payload = entry?.payload;
    const payloadText = payload == null
      ? ""
      : typeof payload === "string"
        ? payload
        : typeof payload === "object" && !Array.isArray(payload) && !Object.keys(payload).length
          ? ""
          : JSON.stringify(payload, null, 2);
    return `${timestamp} ${event}${payloadText ? `\n${payloadText}` : ""}`.trim();
  }

  function hasDebugErrorPayload(payload) {
    const error = payload?.error;
    if (error == null) {
      return false;
    }
    if (typeof error === "string") {
      return Boolean(normalizeText(error));
    }
    if (typeof error === "object") {
      return Object.keys(error).length > 0;
    }
    return Boolean(error);
  }

  function isErrorDebugEntry(entry) {
    const event = normalizeText(entry?.event).toLowerCase();
    const tone = normalizeText(entry?.payload?.tone).toLowerCase();
    return event.includes("error")
      || event.includes("failed")
      || event.includes("timeout")
      || tone === "error"
      || hasDebugErrorPayload(entry?.payload);
  }

  function getErrorDebugEntries(entries = getDebugEntries()) {
    return (Array.isArray(entries) ? entries : []).filter((entry) => isErrorDebugEntry(entry));
  }

  function buildCopyText(entries = getDebugEntries()) {
    return (Array.isArray(entries) ? entries : []).map((entry) => formatDebugEntry(entry)).join("\n\n").trim();
  }

  function buildErrorCopyText(entries = getDebugEntries()) {
    return getErrorDebugEntries(entries).map((entry) => formatDebugEntry(entry)).join("\n\n").trim();
  }

  function summarizeEntries(entries = getDebugEntries()) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    let functionCalls = 0;
    let readCount = 0;
    let snapshotCount = 0;
    let errorCount = 0;
    for (const entry of normalizedEntries) {
      const event = normalizeText(entry?.event);
      const backend = normalizeText(entry?.payload?.backend).toLowerCase();
      const operation = normalizeText(entry?.payload?.operation).toLowerCase();
      if (event.endsWith(".request") && backend === "firebase-function") {
        functionCalls += 1;
      }
      if (event.endsWith(".request") && operation === "read") {
        readCount += 1;
      }
      if (event.includes("firestore") && event.endsWith(".snapshot")) {
        snapshotCount += 1;
      }
      if (isErrorDebugEntry(entry)) {
        errorCount += 1;
      }
    }
    return {
      errorCount,
      functionCalls,
      readCount,
      snapshotCount,
      totalLogs: normalizedEntries.length,
    };
  }

  function notifyDebugListeners() {
    const snapshot = getDebugEntries();
    for (const listener of debugListeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  function subscribeDebugEntries(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    debugListeners.add(listener);
    listener(getDebugEntries());
    return () => debugListeners.delete(listener);
  }

  function logDebug(event, payload) {
    if (!debugEnabled) {
      return null;
    }
    const entry = {
      event: normalizeText(event),
      id: ++debugSequence,
      payload: normalizeDebugPayload(payload),
      timestamp: new Date().toISOString(),
    };
    debugEntries.push(entry);
    while (debugEntries.length > MAX_DEBUG_LOG_ENTRIES) {
      debugEntries.shift();
    }
    notifyDebugListeners();
    return entry;
  }

  function getDebugFaults() {
    const snapshot = {};
    for (const [name, count] of Object.entries(debugFaults)) {
      if (!normalizeText(name)) continue;
      if (count === -1) snapshot[name] = "always";
      else if (Number.isFinite(count) && count > 0) snapshot[name] = count;
    }
    return snapshot;
  }

  function setDebugFault(name, count = true) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return getDebugFaults();
    if (count === false || count === 0) {
      delete debugFaults[normalizedName];
      persistDebugFaultRegistry();
      return getDebugFaults();
    }
    if (count === true) {
      debugFaults[normalizedName] = -1;
      persistDebugFaultRegistry();
      return getDebugFaults();
    }
    const normalizedCount = Math.max(1, Math.floor(Number(count) || 0)) || 1;
    debugFaults[normalizedName] = normalizedCount;
    persistDebugFaultRegistry();
    return getDebugFaults();
  }

  function clearDebugFault(name) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      for (const key of Object.keys(debugFaults)) {
        delete debugFaults[key];
      }
      persistDebugFaultRegistry();
      return getDebugFaults();
    }
    delete debugFaults[normalizedName];
    persistDebugFaultRegistry();
    return getDebugFaults();
  }

  function consumeDebugFault(name) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return false;
    const current = Number(debugFaults[normalizedName]);
    if (current === -1) return true;
    if (!Number.isFinite(current) || current <= 0) return false;
    if (current === 1) {
      delete debugFaults[normalizedName];
      persistDebugFaultRegistry();
      return true;
    }
    debugFaults[normalizedName] = current - 1;
    persistDebugFaultRegistry();
    return true;
  }

  debugEnabled = isDebugPanelEnabled(global);

  global.__INOVA_HOSTED_MEETING_DEBUG__ = {
    clear: clearDebugEntries,
    clearFault: clearDebugFault,
    consumeFault: consumeDebugFault,
    entries: getDebugEntries,
    faults: getDebugFaults,
    format: formatDebugEntry,
    log: logDebug,
    setFault: setDebugFault,
  };

  ns.shared = {
    AUTO_RETRY_PENDING_STATUSES,
    DEBUG_PREFIX,
    DEFAULT_NOTES_MODE,
    DEFAULT_NOTES_STYLE,
    DEFAULT_CREATE_JOB_TIMEOUT_MS,
    DEFAULT_INLINE_AUDIO_LIMIT_BYTES,
    DEFAULT_MAX_RECORDING_DURATION_MS,
    DEFAULT_RECORDING_AUDIO_BITS_PER_SECOND,
    DEFAULT_SOURCE_CHUNK_DURATION_MS,
    DEFAULT_SOURCE_CHUNK_OVERLAP_MS,
    DEFAULT_SOURCE_CHUNK_SAMPLE_RATE,
    DEFAULT_SOURCE_MAX_BYTES,
    DEFAULT_SOURCE_MAX_DURATION_MS,
    DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS,
    DEFAULT_SOURCE_TARGET_PART_BYTES,
    DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS,
    LOCAL_STORAGE_KEY_PREFIX,
    MAX_PREVIEW_TEXT_LENGTH,
    SESSION_STORAGE_KEY,
    TERMINAL_REMOTE_STATUSES,
    WORKSPACE_HASH_PARAM,
    buildHeaders,
    buildCopyText,
    buildErrorCopyText,
    buildRemoteSelectionId: (jobId) => normalizeText(jobId) ? `job:${normalizeText(jobId)}` : "",
    buildLocalSelectionId: (requestId) => normalizeText(requestId) ? `local:${normalizeText(requestId)}` : "",
    buildWorkspaceHash,
    buildWorkspaceSessionStorageKey,
    clearPersistedWorkspaceSession,
    escapeHtml: (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    formatBytes,
    formatDateTime,
    formatDuration,
    formatSegmentRange,
    formatSpeakerLabel,
    normalizeSpeakerAliases,
    resolveSpeakerDisplayName,
    formatNotesModeLabel,
    formatNotesStyleLabel,
    formatPhase,
    formatStatusLabel,
    formatDebugEntry,
    cleanPreviewText,
    clearDebugEntries,
    clearDebugFault,
    consumeDebugFault,
    countSpeakers,
    generateCaptureRequestId,
    getDebugEntries,
    isDebugPanelEnabled,
    isLikelyNetworkError,
    isLocalWorkspaceOrigin,
    isOnline,
    isExpired,
    joinUrl,
    loadPersistedWorkspaceSession,
    logDebug,
    normalizeBaseUrl,
    normalizeMeetingNotesMode,
    normalizeMeetingNotesStyle,
    normalizeStatus,
    normalizeText,
    normalizeTextArray,
    normalizeTextBlock,
    pickRecorderMimeType,
    parseParams,
    postJson,
    persistWorkspaceSessionPayload,
    readHashParam,
    resolveRecordingProfile,
    resolveConfig,
    safeLocalStorageGet,
    safeLocalStorageRemove,
    safeLocalStorageSet,
    safeParse,
    safeSessionStorageGet,
    safeSessionStorageSet,
    setDebugFault,
    setEnabled,
    stopTracks,
    subscribeDebugEntries,
    summarizeEntries,
    toTimestamp,
  };
})(globalThis);
