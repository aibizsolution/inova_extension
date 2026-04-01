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
const MEETING_DEBUG_PREFIX = "[Inova Meeting SW]";
const LOCAL_MEETING_WORKSPACE_URL = "http://127.0.0.1:5000/meeting/index.html";
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
  if (message.type === "inova-meeting:list-meetings") {
    return listMeetings(message.input, message.providerIdentity);
  }
  if (message.type === "inova-meeting:list-results") {
    return listMeetingResults(message.input, message.providerIdentity);
  }
  if (message.type === "inova-meeting:open-workspace") {
    return openMeetingWorkspace(message.input, message.providerIdentity, sender);
  }
  if (message.type === "inova-meeting:open-result") {
    return openMeetingResult(message.input, message.providerIdentity, sender);
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
  const createdRecorderDocument = await ensureOffscreenRecorderDocument();
  try {
    const streamId = captureInput.streamId || await chrome.tabCapture.getMediaStreamId({
      targetTabId: captureInput.sourceTabId,
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
    const currentMeetingState = await namespace.storage.getMeetingState(captureInput.meetingId);
    const nextMeetingState = namespace.meetingState.applyMeetingCaptureStarted(currentMeetingState, response);
    await namespace.storage.setMeetingState(captureInput.meetingId, nextMeetingState);
    return response;
  } catch (error) {
    if (createdRecorderDocument) {
      await closeOffscreenRecorderDocument().catch(() => {});
    }
    throw normalizeMeetingCaptureError(error);
  }
}

async function stopMeetingCapture(input) {
  const response = ensureMeetingCaptureResponse(
    await chrome.runtime.sendMessage({
      data: {
        meetingId: namespace.session.normalizeText(input?.meetingId),
      },
      target: "offscreen",
      type: "inova-meeting:stop-capture",
    }),
    "녹음을 마무리하지 못했어요."
  );
  const meetingId = namespace.session.normalizeText(response?.meeting?.meetingId);
  if (meetingId) {
    const currentMeetingState = await namespace.storage.getMeetingState(meetingId);
    const nextMeetingState = namespace.meetingState.applyMeetingCaptureFinished(currentMeetingState, response);
    await namespace.storage.setMeetingState(meetingId, nextMeetingState);
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
  const meetingId = namespace.session.normalizeText(payload?.job?.meetingId);
  const sessionId = namespace.session.normalizeText(payload?.job?.sessionId);
  if (!jobId) {
    return payload;
  }

  try {
    const latestPayload = await namespace.cloudApi.getInovaMeetingJob(
      {
        jobId,
        meetingId,
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

async function listMeetings(input, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.listInovaMeetings(input, providerIdentity, accessToken);
}

async function listMeetingResults(input, providerIdentity) {
  const accessToken = await getInovaAccessToken();
  return namespace.cloudApi.listInovaMeetingResults(input, providerIdentity, accessToken);
}

async function handleMeetingRecorderFailed(payload) {
  const meetingId = namespace.session.normalizeText(payload?.meeting?.meetingId);
  await closeOffscreenRecorderDocument().catch(() => {});
  if (!meetingId) {
    return { handled: false };
  }
  const currentMeetingState = await namespace.storage.getMeetingState(meetingId);
  const nextMeetingState = namespace.meetingState.applyMeetingCaptureFailed(currentMeetingState, payload);
  await namespace.storage.setMeetingState(meetingId, nextMeetingState);
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

async function openMeetingWorkspace(input, providerIdentity, sender) {
  return openHostedMeetingPage("create", input, providerIdentity, sender);
}

async function openMeetingResult(input, providerIdentity, sender) {
  return openHostedMeetingPage("detail", input, providerIdentity, sender);
}

async function openHostedMeetingPage(mode, input, providerIdentity, sender) {
  try {
    logMeetingDebug("open.start", {
      input: input || {},
      mode,
      senderTabId: Number(sender?.tab?.id) || 0,
      senderTitle: namespace.session.normalizeText(sender?.tab?.title),
      senderUrl: namespace.session.normalizeText(sender?.url),
    });
    const launch = await issueMeetingLaunch(mode, input, providerIdentity, sender);
    const workspace = await exchangeMeetingLaunch(launch);
    logMeetingDebug("tabs.create", {
      finalUrl: workspace.url,
      hasWorkspaceHash: String(workspace.url || "").includes("#ws="),
      launchMeetingId: namespace.session.normalizeText(launch?.meeting?.meetingId),
      meetingId: namespace.session.normalizeText(workspace?.meeting?.meetingId),
      mode,
    });
    await chrome.tabs.create({ url: workspace.url });
    return {
      expiresAt: workspace.expiresAt || launch.expiresAt || "",
      meeting: workspace.meeting || launch.meeting || {},
      opened: true,
      url: workspace.url,
    };
  } catch (error) {
    logMeetingDebug("open.error", {
      error: error instanceof Error ? error.message : String(error || ""),
      mode,
    });
    throw error;
  }
}

async function issueMeetingLaunch(mode, input, providerIdentity, sender) {
  try {
    const owner = await resolveMeetingProviderIdentity(providerIdentity);
    if (!owner?.providerUserKey) {
      throw new Error("현재 i-Nova 사용자 정보를 아직 확인하지 못했어요. i-Nova 탭을 다시 연 뒤 시도해 주세요.");
    }
    const accessToken = await getInovaAccessToken();
    const requestPayload = {
      jobId: namespace.session.normalizeText(input?.jobId),
      meetingId: namespace.session.normalizeText(input?.meetingId),
      mode,
      suggestedTitle: namespace.session.normalizeText(input?.title || sender?.tab?.title) || "새 회의",
    };
    logMeetingDebug("launch.issue.request", {
      ...requestPayload,
      providerUserKey: owner.providerUserKey,
    });
    const launch = await namespace.cloudApi.issueInovaMeetingLaunch(
      requestPayload,
      owner,
      accessToken
    );
    logMeetingDebug("launch.issue.success", {
      hasLaunchToken: Boolean(namespace.session.normalizeText(launch?.launchToken)),
      meetingId: namespace.session.normalizeText(launch?.meeting?.meetingId),
      mode,
      workspaceUrl: namespace.session.normalizeText(launch?.workspaceUrl),
    });
    return launch;
  } catch (error) {
    logMeetingDebug("launch.issue.error", {
      error: error instanceof Error ? error.message : String(error || ""),
      mode,
    });
    throw error;
  }
}

async function exchangeMeetingLaunch(launch) {
  try {
    const launchToken = namespace.session.normalizeText(launch?.launchToken);
    if (!launchToken) {
      throw new Error("회의 작업실 열기 토큰이 없어요. 다시 시도해 주세요.");
    }
    logMeetingDebug("launch.exchange.request", {
      launchTokenPreview: `${launchToken.slice(0, 12)}...`,
      meetingId: namespace.session.normalizeText(launch?.meeting?.meetingId),
    });
    const exchange = await namespace.cloudApi.exchangeInovaMeetingLaunch({ launchToken });
    const meetingId = namespace.session.normalizeText(exchange?.meeting?.meetingId || launch?.meeting?.meetingId);
    const workspaceToken = namespace.session.normalizeText(exchange?.meetingSessionToken);
    if (!meetingId || !workspaceToken) {
      throw new Error("회의 작업실 세션을 만들지 못했어요. 다시 시도해 주세요.");
    }
    const finalUrl = await buildHostedMeetingSessionUrl({
      jobId: namespace.session.normalizeText(exchange?.jobId || launch?.jobId),
      meetingId,
      workspaceToken,
    });
    logMeetingDebug("launch.exchange.success", {
      finalUrl,
      hasWorkspaceHash: finalUrl.includes("#ws="),
      jobId: namespace.session.normalizeText(exchange?.jobId || launch?.jobId),
      meetingId,
      workspaceTokenPreview: `${workspaceToken.slice(0, 12)}...`,
    });
    return {
      expiresAt: namespace.session.normalizeText(exchange?.expiresAt),
      meeting: {
        meetingId,
        title: namespace.session.normalizeText(exchange?.meeting?.title || launch?.meeting?.title),
      },
      url: finalUrl,
    };
  } catch (error) {
    logMeetingDebug("launch.exchange.error", {
      error: error instanceof Error ? error.message : String(error || ""),
      meetingId: namespace.session.normalizeText(launch?.meeting?.meetingId),
    });
    throw error;
  }
}

async function buildHostedMeetingSessionUrl(input) {
  const baseUrl = await resolveMeetingWorkspacePageUrl();
  const url = new URL(baseUrl);
  if (namespace.session.normalizeText(input?.meetingId)) {
    url.searchParams.set("meetingId", namespace.session.normalizeText(input.meetingId));
  }
  if (namespace.session.normalizeText(input?.jobId)) {
    url.searchParams.set("jobId", namespace.session.normalizeText(input.jobId));
  }
  if (namespace.session.normalizeText(input?.workspaceToken)) {
    url.hash = `ws=${encodeURIComponent(namespace.session.normalizeText(input.workspaceToken))}`;
  }
  return url.toString();
}

async function resolveMeetingWorkspacePageUrl() {
  const storageState = await namespace.storage.getState();
  const workspaceTarget = normalizeMeetingWorkspaceTarget(storageState?.settings?.meetingWorkspaceTarget);
  if (workspaceTarget === "local") {
    logMeetingDebug("workspace.target", {
      target: workspaceTarget,
      url: LOCAL_MEETING_WORKSPACE_URL,
    });
    return LOCAL_MEETING_WORKSPACE_URL;
  }
  const overrideUrl = normalizeMeetingWorkspaceOverrideUrl(storageState?.settings?.meetingWorkspaceUrlOverride);
  if (overrideUrl) {
    logMeetingDebug("workspace.override.legacy", { url: overrideUrl });
    return overrideUrl;
  }
  const hostedUrl = namespace.firebaseConfig?.hosting?.meetingWorkspaceUrl;
  logMeetingDebug("workspace.target", {
    target: workspaceTarget,
    url: hostedUrl,
  });
  return hostedUrl;
}

function normalizeMeetingWorkspaceTarget(value) {
  return namespace.session.normalizeText(value).toLowerCase() === "local" ? "local" : "production";
}

function normalizeMeetingWorkspaceOverrideUrl(value) {
  const normalized = namespace.session.normalizeText(value);
  if (!normalized) {
    return "";
  }
  try {
    const url = new URL(normalized);
    const pathname = String(url.pathname || "");
    if (/\/meeting\/index\.html$/i.test(pathname)) {
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    const basePath = pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/meeting/index.html`.replace(/\/{2,}/g, "/");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    logMeetingDebug("workspace.override.invalid", { value: normalized });
    return "";
  }
}

function logMeetingDebug(event, payload) {
  try {
    console.info(MEETING_DEBUG_PREFIX, event, payload || {});
  } catch {}
}

async function resolveMeetingProviderIdentity(providerIdentity) {
  const normalized = normalizeProviderIdentity(providerIdentity);
  if (normalized.providerUserKey) {
    return normalized;
  }
  const storageState = await namespace.storage.getState();
  return normalizeProviderIdentity(storageState?.cloudSync?.providerIdentity);
}

function normalizeProviderIdentity(providerIdentity) {
  return {
    displayName: namespace.session.normalizeText(providerIdentity?.displayName),
    email: namespace.session.normalizeText(providerIdentity?.email).toLowerCase(),
    numericUserId: Number.isFinite(Number(providerIdentity?.numericUserId)) ? Number(providerIdentity.numericUserId) : null,
    provider: namespace.session.normalizeText(providerIdentity?.provider) || "inova",
    providerUserKey: namespace.session.normalizeText(providerIdentity?.providerUserKey),
  };
}

async function ensureOffscreenRecorderDocument() {
  const contexts = await listRuntimeContexts();
  const hasRecorder = contexts.some((entry) =>
    entry?.contextType === "OFFSCREEN_DOCUMENT"
    && String(entry?.documentUrl || "").includes(OFFSCREEN_RECORDER_URL)
  );
  if (hasRecorder) {
    return false;
  }
  if (activeOffscreenCreation) {
    await activeOffscreenCreation;
    return false;
  }
  activeOffscreenCreation = chrome.offscreen.createDocument({
    justification: "Record tab audio for i-Nova meeting capture",
    reasons: ["USER_MEDIA"],
    url: OFFSCREEN_RECORDER_URL,
  });
  try {
    await activeOffscreenCreation;
    return true;
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

async function requestDesktopTabStreamId() {
  if (typeof chrome.desktopCapture?.chooseDesktopMedia !== "function") {
    throw new Error("현재 브라우저에서 탭 공유 선택창을 열 수 없어요.");
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(["tab", "audio"], (streamId, options) => {
        const errorMessage = namespace.session.normalizeText(chrome.runtime?.lastError?.message);
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }
        const normalizedStreamId = namespace.session.normalizeText(streamId);
        if (!normalizedStreamId) {
          reject(new Error("탭 공유 선택이 취소되었어요. 다시 시도해 주세요."));
          return;
        }
        if (options && options.canRequestAudioTrack === false) {
          reject(new Error("탭 공유 창에서 오디오 공유를 켠 뒤 다시 시도해 주세요."));
          return;
        }
        resolve(normalizedStreamId);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function normalizeMeetingCaptureInput(input) {
  const sourceTabId = Number(input?.sourceTabId || input?.tabId);
  const meetingId = namespace.session.normalizeText(input?.meetingId);
  const streamId = namespace.session.normalizeText(input?.streamId);
  const title = namespace.session.normalizeText(input?.title) || "새 회의";
  const captureMode = namespace.session.normalizeText(input?.captureMode) || "tab-audio";
  if (!meetingId) {
    throw new Error("회의 ID를 찾지 못했어요.");
  }
  if (captureMode === "tab-audio") {
    if (!Number.isInteger(sourceTabId) || sourceTabId <= 0) {
      throw new Error("현재 탭을 찾지 못해서 녹음을 시작할 수 없어요.");
    }
  } else if (captureMode === "desktop-audio") {
    if (!streamId) {
      throw new Error("탭 공유 선택 결과를 찾지 못했어요. 다시 시도해 주세요.");
    }
  } else {
    throw new Error("지금 단계에서는 탭 오디오 녹음만 지원해요.");
  }
  return {
    captureMode,
    meetingId,
    sourceTabId,
    streamId,
    title,
  };
}

function isInternalMeetingRecorderMessage(message, sender) {
  return String(message?.type || "").startsWith("inova-meeting:recorder-")
    && String(sender?.url || "").startsWith("chrome-extension://");
}

function isExtensionMeetingControlMessage(message, sender) {
  return String(message?.type || "").startsWith("inova-meeting:")
    && String(sender?.url || "").startsWith("chrome-extension://");
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
    throw normalizeMeetingCaptureError(errorMessage || fallbackMessage);
  }
  return response;
}

function normalizeMeetingCaptureError(error) {
  const message = namespace.session.normalizeText(error?.message || error);
  if (!message) {
    return new Error("녹음을 시작하지 못했어요.");
  }
  if (message.includes("Extension has not been invoked for the current page")) {
    return new Error("이 탭에서 녹음을 시작하려면 확장 아이콘을 한 번 연 뒤 다시 시도해 주세요. 크롬이 tabCapture 대상을 현재 페이지에 대해 승인하지 않았어요.");
  }
  if (message.includes("Chrome pages cannot be captured")) {
    return new Error("현재 선택된 탭은 크롬 내부 페이지라서 녹음할 수 없어요. i-Nova 탭으로 돌아가 확장 아이콘을 한 번 연 뒤 다시 시도해 주세요.");
  }
  return error instanceof Error ? error : new Error(message);
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
