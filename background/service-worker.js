importScripts("../shared/constants.js", "../shared/session.js", "../shared/firebase-config.js", "../shared/inova-auth.js", "../shared/cloud-api.js");

const namespace = globalThis.InovaBookmarks || {};
const INOVA_ORIGIN = "https://inova.incross.com";
const RECENT_LOAD_TTL_MS = 10000;
const RECENT_PEEK_TTL_MS = 10000;
const RECENT_RELEASE_TTL_MS = 60000;
const RECENT_SYNC_TTL_MS = 30000;
const activeLoads = new Map();
const activePeeks = new Map();
const recentLoadResults = new Map();
const recentPeekResults = new Map();
const activeReleaseRequests = new Map();
const recentReleaseResults = new Map();
const activeSyncs = new Map();
const recentSyncResults = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || "");
  if (!type.startsWith("inova-sync:") && !type.startsWith("inova-store:") && !type.startsWith("inova-release:")) {
    return false;
  }

  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error), ok: false }));

  return true;
});

async function handleMessage(message, sender) {
  if (!String(sender?.url || "").startsWith(INOVA_ORIGIN) && message.type !== "inova-release:open-url") {
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
