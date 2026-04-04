importScripts("../shared/constants.js");
importScripts("../shared/session.js");
importScripts("../shared/storage.js");
importScripts("../shared/firebase-config.js");
importScripts("../shared/inova-auth.js");
importScripts("../shared/cloud-api.js");
importScripts("meeting-list-cache.js");
importScripts("panel-auth-cache.js");

const namespace = globalThis.InovaBookmarks || {};
const INOVA_ORIGIN = "https://inova.incross.com";
const RECENT_LOAD_TTL_MS = 10000;
const RECENT_PEEK_TTL_MS = 10000;
const RECENT_RELEASE_TTL_MS = 60000;
const RECENT_SYNC_TTL_MS = 30000;
const LOCAL_MEETING_WORKSPACE_URL = "http://127.0.0.1:5000/meeting/index.html";
const activeLoads = new Map();
const activePeeks = new Map();
const recentLoadResults = new Map();
const recentPeekResults = new Map();
const activeReleaseRequests = new Map();
const recentReleaseResults = new Map();
const activeSyncs = new Map();
const recentSyncResults = new Map();
const meetingListCache = namespace.meetingListCache?.create?.(getInovaAccessToken);
const panelAuthCache = namespace.panelAuthCache?.create?.(getInovaAccessToken);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || "");
  if (!type.startsWith("inova-sync:") && !type.startsWith("inova-store:") && !type.startsWith("inova-release:") && !type.startsWith("inova-review:") && !type.startsWith("inova-meeting:") && !type.startsWith("inova-prompt:")) {
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
  if (message.type === "inova-meeting:list-meetings") {
    return meetingListCache.listMeetings(message.input, message.providerIdentity);
  }
  if (message.type === "inova-meeting:issue-panel-auth") {
    return panelAuthCache.issueMeetingPanelAuth(message.providerIdentity);
  }
  if (message.type === "inova-prompt:issue-panel-auth") {
    return panelAuthCache.issuePromptPanelAuth(message.providerIdentity);
  }
  if (message.type === "inova-meeting:open-workspace") {
    return openMeetingWorkspace(message.input, message.providerIdentity, sender);
  }
  if (message.type === "inova-meeting:open-result") {
    return openMeetingResult(message.input, message.providerIdentity, sender);
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
  const normalizedSettings = await reconcileMeetingWorkspaceSettings((await namespace.storage.getState())?.settings);
  const url = new URL(await resolveMeetingWorkspacePageUrl());
  if (normalizeMeetingDebugConsoleEnabled(normalizedSettings.meetingDebugConsoleEnabled)) url.searchParams.set("debug", "1");
  const meetingId = namespace.session.normalizeText(input?.meetingId);
  const jobId = namespace.session.normalizeText(input?.jobId);
  const workspaceToken = namespace.session.normalizeText(input?.workspaceToken);
  if (meetingId) url.searchParams.set("meetingId", meetingId);
  if (jobId) url.searchParams.set("jobId", jobId);
  if (workspaceToken) url.hash = `ws=${encodeURIComponent(workspaceToken)}`;
  return url.toString();
}

async function resolveMeetingWorkspacePageUrl() {
  const normalizedSettings = await reconcileMeetingWorkspaceSettings((await namespace.storage.getState())?.settings);
  const workspaceTarget = normalizeMeetingWorkspaceTarget(normalizedSettings.meetingWorkspaceTarget);
  const url = workspaceTarget === "local" ? normalizeLocalMeetingWorkspaceUrl(normalizedSettings.meetingWorkspaceUrlOverride) : namespace.firebaseConfig?.hosting?.meetingWorkspaceUrl;
  logMeetingDebug("workspace.target", { target: workspaceTarget, url });
  return url;
}
function normalizeMeetingWorkspaceTarget(value) { return namespace.session.normalizeText(value).toLowerCase() === "local" ? "local" : "production"; }

async function reconcileMeetingWorkspaceSettings(settings) {
  const currentTarget = normalizeMeetingWorkspaceTarget(settings?.meetingWorkspaceTarget);
  const currentDebugEnabled = normalizeMeetingDebugConsoleEnabled(settings?.meetingDebugConsoleEnabled);
  const currentOverride = normalizeMeetingWorkspaceOverrideUrl(settings?.meetingWorkspaceUrlOverride);
  const nextSettings = { meetingDebugConsoleEnabled: currentDebugEnabled, meetingWorkspaceTarget: currentTarget, meetingWorkspaceUrlOverride: currentTarget === "local" ? normalizeLocalMeetingWorkspaceUrl(currentOverride) : "" };
  if (currentTarget === namespace.session.normalizeText(settings?.meetingWorkspaceTarget) && currentDebugEnabled === settings?.meetingDebugConsoleEnabled && nextSettings.meetingWorkspaceUrlOverride === currentOverride) return nextSettings;
  try {
    await namespace.storage.updateSettings(nextSettings);
  } catch (error) {
    logMeetingDebug("workspace.settings.reconcile.error", { error: error instanceof Error ? error.message : String(error || "") });
  }
  return nextSettings;
}

function normalizeMeetingDebugConsoleEnabled(value) { if (typeof value === "boolean") return value; const normalized = namespace.session.normalizeText(value).toLowerCase(); return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes"; }

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

function normalizeLocalMeetingWorkspaceUrl(value) {
  const normalized = normalizeMeetingWorkspaceOverrideUrl(value);
  if (!normalized) {
    return LOCAL_MEETING_WORKSPACE_URL;
  }
  try {
    const url = new URL(normalized);
    if (isLoopbackHostname(url.hostname)) {
      url.port = "5000";
      url.pathname = "/meeting/index.html";
      url.search = ""; url.hash = "";
      return url.toString();
    }
  } catch {}
  return LOCAL_MEETING_WORKSPACE_URL;
}

function isLoopbackHostname(value) {
  return ["127.0.0.1", "localhost"].includes(namespace.session.normalizeText(value).toLowerCase());
}

function logMeetingDebug(event, payload) {
  return;
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

function isAllowedSender(message, sender) {
  return String(sender?.url || "").startsWith(INOVA_ORIGIN)
    || message.type === "inova-release:open-url";
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
