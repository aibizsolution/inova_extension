(function initHostedMeetingShared(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  const SESSION_STORAGE_KEY = "inova-hosted-meeting-session";
  const LOCAL_STORAGE_KEY_PREFIX = "inova-hosted-meeting-session::";
  const WORKSPACE_HASH_PARAM = "ws";
  const DEBUG_PREFIX = "[Inova Hosted Meeting]";
  const ACTIVE_POLL_DELAY_MS = 1800;
  const DEFAULT_CREATE_JOB_TIMEOUT_MS = 9 * 60 * 1000;
  const DEFAULT_INLINE_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
  const DEFAULT_MAX_RECORDING_DURATION_MS = 90 * 60 * 1000;
  const DEFAULT_NOTES_MODE = "general";
  const DEFAULT_NOTES_STYLE = "default";
  const DEFAULT_RECORDING_AUDIO_BITS_PER_SECOND = 30000;
  const DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;
  const MAX_PREVIEW_TEXT_LENGTH = 180;
  const MAX_DEBUG_LOG_ENTRIES = 120;
  const TERMINAL_REMOTE_STATUSES = new Set(["succeeded", "failed"]);
  const AUTO_RETRY_PENDING_STATUSES = new Set(["local_saved", "upload_queued"]);
  const debugListeners = new Set();
  const debugEntries = [];
  let debugSequence = 0;

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

  function parsePositiveInteger(value) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function isLocalWorkspaceOrigin(globalObject) {
    try {
      const origin = new URL(String(globalObject?.location?.href || "")).origin;
      return ["http://127.0.0.1:5000", "http://localhost:5000", "http://127.0.0.1:4173", "http://localhost:4173"].includes(origin);
    } catch {
      return false;
    }
  }

  function isDebugPanelEnabled(globalObject) {
    try {
      const current = new URL(String(globalObject?.location?.href || ""));
      return isLocalWorkspaceOrigin(globalObject)
        || current.searchParams.get("debug") === "1"
        || normalizeText(globalObject?.localStorage?.getItem("__INOVA_MEETING_DEBUG__")) === "1";
    } catch {
      try {
        return isLocalWorkspaceOrigin(globalObject)
          || normalizeText(globalObject?.localStorage?.getItem("__INOVA_MEETING_DEBUG__")) === "1";
      } catch {
        return false;
      }
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
      functionsBaseUrl,
      getArtifactUrl: joinUrl(functionsBaseUrl, "getInovaMeetingArtifact"),
      getJobUrl: joinUrl(functionsBaseUrl, "getInovaMeetingJob"),
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
    try {
      globalObject.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {}
    const normalizedMeetingId = normalizeText(meetingId);
    if (normalizedMeetingId) {
      safeLocalStorageRemove(globalObject, buildWorkspaceSessionStorageKey(normalizedMeetingId));
    }
  }

  function loadPersistedWorkspaceSession(globalObject, requestedMeetingId, workspaceToken, requestedJobId) {
    const candidates = [
      { payload: buildUrlWorkspaceSession(requestedMeetingId, workspaceToken, requestedJobId), source: "url-hash" },
      { payload: safeParse(safeSessionStorageGet(globalObject, SESSION_STORAGE_KEY)), source: "session-storage" },
      {
        payload: requestedMeetingId
          ? safeParse(safeLocalStorageGet(globalObject, buildWorkspaceSessionStorageKey(requestedMeetingId)))
          : null,
        source: "local-storage",
      },
    ].filter((entry) => entry.payload);

    for (const candidate of candidates) {
      const parsed = candidate.payload;
      const meetingId = normalizeText(parsed?.meetingId);
      const token = normalizeText(parsed?.meetingSessionToken);
      const expiresAt = normalizeText(parsed?.expiresAt);
      if (!meetingId || !token) {
        continue;
      }
      if (requestedMeetingId && requestedMeetingId !== meetingId) {
        continue;
      }
      if (isExpired(expiresAt)) {
        clearPersistedWorkspaceSession(globalObject, meetingId);
        continue;
      }
      if (!safeSessionStorageGet(globalObject, SESSION_STORAGE_KEY)) {
        safeSessionStorageSet(globalObject, SESSION_STORAGE_KEY, JSON.stringify(parsed));
      }
      safeLocalStorageSet(globalObject, buildWorkspaceSessionStorageKey(meetingId), JSON.stringify(parsed));
      return { payload: parsed, source: candidate.source };
    }
    return null;
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
    if (["local_saved", "upload_queued", "uploading", "remote_queued", "on_hold"].includes(normalized)) return "queued";
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
    if (normalized === "remote_queued" || normalized === "queued") return "원격 대기";
    if (normalized === "remote_processing" || normalized === "processing") return "원격 처리";
    if (normalized === "transcribing") return "전사 중";
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
    try {
      global.console?.info?.(DEBUG_PREFIX, entry.event, entry.payload || {});
    } catch {}
    notifyDebugListeners();
  }

  global.__INOVA_HOSTED_MEETING_DEBUG__ = {
    clear: clearDebugEntries,
    entries: getDebugEntries,
    format: formatDebugEntry,
    log: logDebug,
  };

  ns.shared = {
    ACTIVE_POLL_DELAY_MS,
    AUTO_RETRY_PENDING_STATUSES,
    DEBUG_PREFIX,
    DEFAULT_NOTES_MODE,
    DEFAULT_NOTES_STYLE,
    DEFAULT_CREATE_JOB_TIMEOUT_MS,
    DEFAULT_INLINE_AUDIO_LIMIT_BYTES,
    DEFAULT_MAX_RECORDING_DURATION_MS,
    DEFAULT_RECORDING_AUDIO_BITS_PER_SECOND,
    DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS,
    LOCAL_STORAGE_KEY_PREFIX,
    MAX_PREVIEW_TEXT_LENGTH,
    SESSION_STORAGE_KEY,
    TERMINAL_REMOTE_STATUSES,
    WORKSPACE_HASH_PARAM,
    buildHeaders,
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
    readHashParam,
    resolveRecordingProfile,
    resolveConfig,
    safeLocalStorageGet,
    safeLocalStorageRemove,
    safeLocalStorageSet,
    safeParse,
    safeSessionStorageGet,
    safeSessionStorageSet,
    stopTracks,
    subscribeDebugEntries,
    toTimestamp,
  };
})(globalThis);
