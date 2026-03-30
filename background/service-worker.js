importScripts(
  "../shared/constants.js",
  "../shared/session.js",
  "../shared/meeting-state.js",
  "../shared/storage.js",
  "../shared/firebase-config.js",
  "../shared/inova-auth.js",
  "../shared/cloud-api.js"
);

const namespace = globalThis.InovaBookmarks || {};
const INOVA_ORIGIN = "https://inova.incross.com";
const RECENT_LOAD_TTL_MS = 10000;
const RECENT_PEEK_TTL_MS = 10000;
const RECENT_RELEASE_TTL_MS = 60000;
const RECENT_SYNC_TTL_MS = 30000;
const OFFSCREEN_RECORDER_URL = "offscreen/meeting-recorder.html";
const activeLoads = new Map();
const activePeeks = new Map();
const recentLoadResults = new Map();
const recentPeekResults = new Map();
const activeReleaseRequests = new Map();
const recentReleaseResults = new Map();
const activeSyncs = new Map();
const recentSyncResults = new Map();
let activeOffscreenCreation = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || "");
  if (message?.target === "offscreen") {
    return false;
  }
  if (!type.startsWith("inova-sync:") && !type.startsWith("inova-store:") && !type.startsWith("inova-release:") && !type.startsWith("inova-review:") && !type.startsWith("inova-meeting:")) {
    return false;
  }
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error), ok: false }));
  return true;
});

async function handleMessage(message, sender) {
  if (!isAllowedSender(message, sender)) {
    throw new Error("i-Nova 화면에서만 클라우드 동기화를 실행할 수 있어요.");
  }
  if (message.type === "inova-sync:load-prompt-library") {
    return loadPromptLibrary(message.providerIdentity, message.force);
  }
  if (message.type === "inova-sync:peek-prompt-library") {
    return peekPromptLibrary(message.providerIdentity, message.force);
  }
  if (message.type === "inova-store:list") {
    return listPromptStoreEntries(message.filter, message.providerIdentity);
  }
  if (message.type === "inova-store:publish") {
    return publishPromptToStore(message.prompt, message.categoryId, message.providerIdentity);
  }
  if (message.type === "inova-store:unpublish") {
    return unpublishPromptFromStore(message.entryId, message.providerIdentity);
  }
  if (message.type === "inova-store:import") {
    return importPromptStoreEntry(message.entryId, message.providerIdentity);
  }
  if (message.type === "inova-store:toggle-like") {
    return togglePromptStoreLike(message.entryId, message.providerIdentity);
  }
  if (message.type === "inova-store:view") {
    return recordPromptStoreView(message.entryId, message.providerIdentity);
  }
  if (message.type === "inova-review:prompt") {
    return reviewPromptDraft(message.prompt, message.providerIdentity);
  }
  if (message.type === "inova-meeting:create-job") {
    return createMeetingJob(message.input, message.providerIdentity);
  }
  if (message.type === "inova-meeting:start-capture") {
    return startMeetingCapture(message.input);
  }
  if (message.type === "inova-meeting:stop-capture") {
    return stopMeetingCapture(message.input);
  }
  if (message.type === "inova-meeting:get-job") {
    return getMeetingJob(message.input, message.providerIdentity);
  }
  if (message.type === "inova-meeting:get-artifact") {
    return getMeetingArtifact(message.input, message.providerIdentity);
  }
  if (message.type === "inova-meeting:recorder-failed") {
    return handleMeetingRecorderFailed(message.payload);
  }
  if (message.type === "inova-release:latest") {
    return fetchReleaseJson("latest");
  }
  if (message.type === "inova-release:history") {
    return fetchReleaseJson("history");
  }
  if (message.type === "inova-release:open-url") {
    return openReleaseUrl(message.url);
  }
  if (message.type === "inova-sync:sync-prompt-library") {
    return syncPromptLibrary(message.syncDocument);
  }
  throw new Error("지원하지 않는 동기화 요청이에요.");
}

async function getInovaAccessToken() {
  const cookie = await chrome.cookies.get({
    name: "accessToken",
    url: INOVA_ORIGIN,
  });
  if (cookie?.value) {
    return cookie.value;
  }
  return namespace.inovaAuth.getAccessToken(true);
}

async function listPromptStoreEntries(filter, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.listPromptStoreEntries(filter, providerIdentity, accessToken);
}

async function publishPromptToStore(prompt, categoryId, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.publishPromptToStore(prompt, categoryId, providerIdentity, accessToken);
}

async function unpublishPromptFromStore(entryId, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.unpublishPromptFromStore(entryId, providerIdentity, accessToken);
}

async function importPromptStoreEntry(entryId, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.importPromptStoreEntry(entryId, providerIdentity, accessToken);
}

async function togglePromptStoreLike(entryId, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.togglePromptStoreLike(entryId, providerIdentity, accessToken);
}

async function recordPromptStoreView(entryId, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.recordPromptStoreView(entryId, providerIdentity, accessToken);
}

async function reviewPromptDraft(prompt, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.reviewInovaPrompt(prompt, providerIdentity, accessToken);
}

async function startMeetingCapture(input) {
  const captureInput = normalizeMeetingCaptureInput(input);
  await ensureOffscreenRecorderDocument();
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: captureInput.tabId,
    });
    const response = ensureMeetingCaptureResponse(
      await chrome.runtime.sendMessage({
        data: {
          ...captureInput,
          streamId,
        },
        target: "offscreen",
        type: "inova-meeting:start-capture",
      }),
      "녹음을 시작하지 못했어요."
    );
    const currentMeetingState = await namespace.storage.getMeetingState(captureInput.sessionId);
    const nextMeetingState = namespace.meetingState.applyMeetingCaptureStarted(currentMeetingState, response);
    await namespace.storage.setMeetingState(captureInput.sessionId, nextMeetingState);
    return response;
  } catch (error) {
    await closeOffscreenRecorderDocument().catch(() => {});
    throw error;
  }
}

async function stopMeetingCapture(input) {
  const response = ensureMeetingCaptureResponse(
    await chrome.runtime.sendMessage({
      data: {
        sessionId: namespace.session.normalizeText(input?.sessionId),
      },
      target: "offscreen",
      type: "inova-meeting:stop-capture",
    }),
    "녹음을 마무리하지 못했어요."
  );
  const sessionId = namespace.session.normalizeText(response?.meeting?.sessionId);
  if (sessionId) {
    const currentMeetingState = await namespace.storage.getMeetingState(sessionId);
    const nextMeetingState = namespace.meetingState.applyMeetingCaptureFinished(currentMeetingState, response);
    await namespace.storage.setMeetingState(sessionId, nextMeetingState);
  }
  return response;
}

async function createMeetingJob(input, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  const requestBody = namespace.cloudApi.buildCreateInovaMeetingJobRequest(input, providerIdentity);
  const offscreenResponse = await tryCreateMeetingJobFromOffscreen(requestBody, accessToken);
  if (offscreenResponse) {
    return tryRefreshMeetingJobSnapshot(offscreenResponse, providerIdentity, accessToken);
  }
  return namespace.cloudApi.createInovaMeetingJob(input, providerIdentity, accessToken);
}

async function tryCreateMeetingJobFromOffscreen(requestBody, accessToken) {
  const contexts = await listRuntimeContexts();
  const hasRecorder = contexts.some((entry) =>
    entry?.contextType === "OFFSCREEN_DOCUMENT"
    && String(entry?.documentUrl || "").includes(OFFSCREEN_RECORDER_URL)
  );
  if (!hasRecorder) {
    return null;
  }

  const response = ensureMeetingJobResponse(
    await chrome.runtime.sendMessage({
      data: {
        accessToken,
        requestBody,
        url: namespace.firebaseConfig.functions.createInovaMeetingJobUrl,
      },
      target: "offscreen",
      type: "inova-meeting:create-job",
    }),
    "전사 작업을 접수하지 못했어요."
  );
  await closeOffscreenRecorderDocument().catch(() => {});
  return response;
}

async function tryRefreshMeetingJobSnapshot(payload, providerIdentity, accessToken) {
  const jobId = namespace.session.normalizeText(payload?.job?.jobId);
  const sessionId = namespace.session.normalizeText(payload?.job?.sessionId);
  if (!jobId) {
    return payload;
  }

  try {
    const latestPayload = await namespace.cloudApi.getInovaMeetingJob(
      {
        jobId,
        sessionId,
      },
      providerIdentity,
      accessToken
    );
    if (namespace.session.normalizeText(latestPayload?.job?.jobId)) {
      return latestPayload;
    }
  } catch {}
  return payload;
}

async function getMeetingJob(input, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.getInovaMeetingJob(input, providerIdentity, accessToken);
}

async function getMeetingArtifact(input, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.getInovaMeetingArtifact(input, providerIdentity, accessToken);
}

async function handleMeetingRecorderFailed(payload) {
  const sessionId = namespace.session.normalizeText(payload?.meeting?.sessionId);
  await closeOffscreenRecorderDocument().catch(() => {});
  if (!sessionId) {
    return { handled: false };
  }
  const currentMeetingState = await namespace.storage.getMeetingState(sessionId);
  const nextMeetingState = namespace.meetingState.applyMeetingCaptureFailed(currentMeetingState, payload);
  await namespace.storage.setMeetingState(sessionId, nextMeetingState);
  return { handled: true };
}

async function syncPromptLibrary(syncDocument) {
  const revision = namespace.session.normalizeText(syncDocument?.sync?.revision || "");
  cleanupRecentSyncs();

  if (revision) {
    const recent = recentSyncResults.get(revision);
    if (recent && recent.expiresAt > Date.now()) {
      return recent.result;
    }

    if (activeSyncs.has(revision)) {
      return activeSyncs.get(revision);
    }
  }

  const run = (async () => {
    const accessToken = await getInovaAccessToken();
    const result = await namespace.cloudApi.syncInovaPromptLibrary(syncDocument, accessToken);
    if (revision) {
      recentSyncResults.set(revision, {
        expiresAt: Date.now() + RECENT_SYNC_TTL_MS,
        result,
      });
    }
    return result;
  })();

  if (revision) {
    activeSyncs.set(revision, run);
  }

  try {
    return await run;
  } finally {
    if (revision) {
      activeSyncs.delete(revision);
    }
  }
}

async function loadPromptLibrary(providerIdentity, force = false) {
  const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
  cleanupRecentLoads();

  if (!force && providerUserKey) {
    const recent = recentLoadResults.get(providerUserKey);
    if (recent && recent.expiresAt > Date.now()) {
      return recent.result;
    }

    if (activeLoads.has(providerUserKey)) {
      return activeLoads.get(providerUserKey);
    }
  }

  const run = (async () => {
    const accessToken = await getInovaAccessToken();
    const result = await namespace.cloudApi.loadInovaPromptLibrary(providerIdentity, accessToken);
    if (providerUserKey) {
      recentLoadResults.set(providerUserKey, {
        expiresAt: Date.now() + RECENT_LOAD_TTL_MS,
        result,
      });
    }
    return result;
  })();

  if (providerUserKey) {
    activeLoads.set(providerUserKey, run);
  }

  try {
    return await run;
  } finally {
    if (providerUserKey) {
      activeLoads.delete(providerUserKey);
    }
  }
}

async function peekPromptLibrary(providerIdentity, force = false) {
  const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
  cleanupRecentPeeks();

  if (!force && providerUserKey) {
    const recent = recentPeekResults.get(providerUserKey);
    if (recent && recent.expiresAt > Date.now()) {
      return recent.result;
    }

    if (activePeeks.has(providerUserKey)) {
      return activePeeks.get(providerUserKey);
    }
  }

  const run = (async () => {
    const accessToken = await getInovaAccessToken();
    const result = await namespace.cloudApi.peekInovaPromptLibrary(providerIdentity, accessToken);
    if (providerUserKey) {
      recentPeekResults.set(providerUserKey, {
        expiresAt: Date.now() + RECENT_PEEK_TTL_MS,
        result,
      });
    }
    return result;
  })();

  if (providerUserKey) {
    activePeeks.set(providerUserKey, run);
  }

  try {
    return await run;
  } finally {
    if (providerUserKey) {
      activePeeks.delete(providerUserKey);
    }
  }
}

async function fetchReleaseJson(kind) {
  cleanupRecentReleases();
  const releaseKey = kind === "history" ? "history" : "latest";
  const recent = recentReleaseResults.get(releaseKey);
  if (recent && recent.expiresAt > Date.now()) return recent.result;
  if (activeReleaseRequests.has(releaseKey)) return activeReleaseRequests.get(releaseKey);

  const url = releaseKey === "history"
    ? namespace.firebaseConfig.hosting.releaseHistoryUrl
    : namespace.firebaseConfig.hosting.latestReleaseUrl;
  const run = (async () => {
    const response = await fetch(url, { cache: "no-store", method: "GET" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error("릴리스 정보를 불러오지 못했어요.");
    recentReleaseResults.set(releaseKey, {
      expiresAt: Date.now() + RECENT_RELEASE_TTL_MS,
      result: payload,
    });
    return payload;
  })();

  activeReleaseRequests.set(releaseKey, run);
  try {
    return await run;
  } finally {
    activeReleaseRequests.delete(releaseKey);
  }
}

async function openReleaseUrl(url) {
  const nextUrl = namespace.session.normalizeText(url);
  if (!nextUrl) throw new Error("열 링크가 없어요.");
  await chrome.tabs.create({ url: nextUrl });
  return { opened: true };
}

async function ensureOffscreenRecorderDocument() {
  const contexts = await listRuntimeContexts();
  const hasRecorder = contexts.some((entry) =>
    entry?.contextType === "OFFSCREEN_DOCUMENT"
    && String(entry?.documentUrl || "").includes(OFFSCREEN_RECORDER_URL)
  );
  if (hasRecorder) {
    return;
  }
  if (activeOffscreenCreation) {
    await activeOffscreenCreation;
    return;
  }
  activeOffscreenCreation = chrome.offscreen.createDocument({
    justification: "Record tab audio for i-Nova meeting capture",
    reasons: ["USER_MEDIA"],
    url: OFFSCREEN_RECORDER_URL,
  });
  try {
    await activeOffscreenCreation;
  } finally {
    activeOffscreenCreation = null;
  }
}

async function closeOffscreenRecorderDocument() {
  if (typeof chrome.offscreen?.closeDocument !== "function") {
    return;
  }
  const contexts = await listRuntimeContexts();
  const hasRecorder = contexts.some((entry) =>
    entry?.contextType === "OFFSCREEN_DOCUMENT"
    && String(entry?.documentUrl || "").includes(OFFSCREEN_RECORDER_URL)
  );
  if (hasRecorder) {
    await chrome.offscreen.closeDocument();
  }
}

async function listRuntimeContexts() {
  if (typeof chrome.runtime.getContexts !== "function") {
    return [];
  }
  return chrome.runtime.getContexts({});
}

function normalizeMeetingCaptureInput(input) {
  const tabId = Number(input?.tabId);
  const sessionId = namespace.session.normalizeText(input?.sessionId);
  const title = namespace.session.normalizeText(input?.title) || namespace.session.formatSessionLabel(sessionId);
  const captureMode = namespace.session.normalizeText(input?.captureMode) || "tab-audio";
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error("현재 탭을 찾지 못해서 녹음을 시작할 수 없어요.");
  }
  if (!sessionId) {
    throw new Error("현재 대화 session id를 찾지 못했어요.");
  }
  if (captureMode !== "tab-audio") {
    throw new Error("지금 단계에서는 tab-audio 녹음만 지원해요.");
  }
  return {
    captureMode,
    sessionId,
    tabId,
    title,
  };
}

function isInternalMeetingRecorderMessage(message, sender) {
  return String(message?.type || "").startsWith("inova-meeting:recorder-")
    && String(sender?.url || "").startsWith("chrome-extension://");
}

function isExtensionMeetingControlMessage(message, sender) {
  const type = String(message?.type || "");
  if (!["inova-meeting:create-job", "inova-meeting:start-capture", "inova-meeting:stop-capture"].includes(type)) {
    return false;
  }
  return String(sender?.url || "").startsWith("chrome-extension://");
}

function isAllowedSender(message, sender) {
  return String(sender?.url || "").startsWith(INOVA_ORIGIN)
    || message.type === "inova-release:open-url"
    || isInternalMeetingRecorderMessage(message, sender)
    || isExtensionMeetingControlMessage(message, sender);
}

function ensureMeetingCaptureResponse(response, fallbackMessage) {
  const errorMessage = namespace.session.normalizeText(response?.error || response?.capture?.error);
  if (namespace.session.normalizeText(response?.capture?.status) === "error" || errorMessage) {
    throw new Error(errorMessage || fallbackMessage);
  }
  return response;
}

function ensureMeetingJobResponse(response, fallbackMessage) {
  const errorMessage = namespace.session.normalizeText(response?.error || response?.job?.error);
  if (errorMessage) {
    throw new Error(errorMessage || fallbackMessage);
  }
  if (!namespace.session.normalizeText(response?.job?.jobId)) {
    throw new Error(fallbackMessage);
  }
  return response;
}

function cleanupRecentLoads() {
  const now = Date.now();
  for (const [providerUserKey, entry] of recentLoadResults.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentLoadResults.delete(providerUserKey);
    }
  }
}

function cleanupRecentPeeks() {
  const now = Date.now();
  for (const [providerUserKey, entry] of recentPeekResults.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentPeekResults.delete(providerUserKey);
    }
  }
}

function cleanupRecentSyncs() {
  const now = Date.now();
  for (const [revision, entry] of recentSyncResults.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentSyncResults.delete(revision);
    }
  }
}

function cleanupRecentReleases() {
  const now = Date.now();
  for (const [key, entry] of recentReleaseResults.entries()) {
    if (!entry || entry.expiresAt <= now) recentReleaseResults.delete(key);
  }
}
