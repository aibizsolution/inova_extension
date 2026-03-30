#!/usr/bin/env node

const http = require("http");
const { URL } = require("url");
const { createHarnessState } = require("../fixtures/cloud-harness/fixtures");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4174;

function createCloudHarnessServer(options = {}) {
  const host = String(options.host || DEFAULT_HOST);
  const port = normalizePort(options.port, DEFAULT_PORT);
  const state = options.state || createHarnessState();
  const server = http.createServer((request, response) => {
    handleRequest(request, response, state).catch((error) => {
      sendJson(response, Number(error?.status) || 500, {
        ok: false,
        error: String(error?.message || "Local cloud harness failed."),
      });
    });
  });

  return {
    host,
    port,
    server,
    state,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve({
            address: server.address(),
            baseUrl: getBaseUrl(host, server.address()?.port || port),
            hostingBaseUrl: `${getBaseUrl(host, server.address()?.port || port)}/extension`,
          });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handleRequest(request, response, state) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`}`);
  state.requests.push({
    authorization: normalizeText(request.headers.authorization),
    method: request.method,
    path: requestUrl.pathname,
    recordedAt: new Date().toISOString(),
  });
  if (request.method === "GET" && requestUrl.pathname === "/extension/releases/latest.json") {
    return void sendJson(response, 200, state.releaseLatest);
  }
  if (request.method === "GET" && requestUrl.pathname === "/extension/releases/history.json") {
    return void sendJson(response, 200, state.releaseHistory);
  }

  if (request.method !== "POST") {
    return void sendJson(response, 405, {
      ok: false,
      error: "Only POST is supported for local function routes.",
    });
  }

  assertAuthorization(request);
  const body = await readJsonBody(request);

  if (requestUrl.pathname === "/peekInovaPromptLibrary") {
    return void sendJson(response, 200, { ok: true, data: cloneValue(state.promptLibraryRemote) });
  }

  if (requestUrl.pathname === "/loadInovaPromptLibrary") {
    return void sendJson(response, 200, { ok: true, data: cloneValue(state.promptLibrary) });
  }

  if (requestUrl.pathname === "/listPromptStoreEntries") {
    const filter = normalizeListFilter(body);
    const items = listStoreEntries(state.storeEntries, filter, body.owner || body.providerIdentity);
    return void sendJson(response, 200, {
      ok: true,
      data: {
        availableCategories: buildAvailableCategories(state.storeEntries, items, filter.categoryId),
        hasMore: false,
        items,
        totalCount: items.length,
      },
    });
  }

  if (requestUrl.pathname === "/reviewInovaPrompt") {
    return void sendJson(response, 200, {
      ok: true,
      data: cloneValue(state.reviewResult),
    });
  }

  if (requestUrl.pathname === "/createInovaMeetingJob") {
    return void sendJson(response, 200, {
      ok: true,
      data: cloneValue(state.meetingCreateResponse),
    });
  }

  if (requestUrl.pathname === "/getInovaMeetingJob") {
    state.meetingPollCount = Number(state.meetingPollCount || 0) + 1;
    const nextPayload = state.meetingPollCount >= 2 ? state.meetingJobSucceeded : state.meetingJobProcessing;
    return void sendJson(response, 200, {
      ok: true,
      data: cloneValue(nextPayload),
    });
  }

  if (requestUrl.pathname === "/getInovaMeetingArtifact") {
    return void sendJson(response, 200, {
      ok: true,
      data: cloneValue(state.meetingArtifact),
    });
  }

  if (requestUrl.pathname === "/publishPromptToStore") {
    const owner = normalizeOwner(body.owner);
    const prompt = normalizePrompt(body.prompt);
    const entry = {
      entryId: `store-entry-${Date.now().toString(36)}`,
      categoryId: normalizeCategoryId(body.categoryId),
      categoryLabel: toLabel(normalizeCategoryId(body.categoryId)),
      title: prompt.title || "New prompt",
      summary: buildSummary(prompt.content),
      content: prompt.content,
      owner,
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metrics: {
        importCount: 0,
        likeCount: 0,
        viewCount: 0,
      },
      viewer: {
        imported: false,
        liked: false,
        viewed: false,
      },
    };
    state.storeEntries.unshift(entry);
    return void sendJson(response, 200, { ok: true, data: { entry: cloneValue(entry) } });
  }

  if (requestUrl.pathname === "/unpublishPromptFromStore") {
    const entryId = normalizeText(body.entryId);
    state.storeEntries = state.storeEntries.filter((entry) => entry.entryId !== entryId);
    return void sendJson(response, 200, { ok: true, data: { entryId, removed: true } });
  }

  if (requestUrl.pathname === "/importPromptStoreEntry") {
    const entry = updateEntry(state, normalizeText(body.entryId), (current) => ({
      ...current,
      metrics: {
        ...current.metrics,
        importCount: Number(current.metrics.importCount || 0) + 1,
      },
      viewer: {
        ...current.viewer,
        imported: true,
      },
    }));
    return void sendJson(response, 200, { ok: true, data: { entry } });
  }

  if (requestUrl.pathname === "/togglePromptStoreLike") {
    const entry = updateEntry(state, normalizeText(body.entryId), (current) => {
      const liked = !Boolean(current.viewer?.liked);
      return {
        ...current,
        metrics: {
          ...current.metrics,
          likeCount: Math.max(0, Number(current.metrics.likeCount || 0) + (liked ? 1 : -1)),
        },
        viewer: {
          ...current.viewer,
          liked,
        },
      };
    });
    return void sendJson(response, 200, { ok: true, data: { entry } });
  }

  if (requestUrl.pathname === "/recordPromptStoreView") {
    const entry = updateEntry(state, normalizeText(body.entryId), (current) => ({
      ...current,
      metrics: {
        ...current.metrics,
        viewCount: Number(current.metrics.viewCount || 0) + 1,
      },
      viewer: {
        ...current.viewer,
        viewed: true,
      },
    }));
    return void sendJson(response, 200, { ok: true, data: { entry } });
  }

  if (requestUrl.pathname === "/syncInovaPromptLibrary") {
    const owner = normalizeOwner(body.owner);
    const promptLibrary = {
      itemCount: Math.max(0, Number(body.promptLibrary?.itemCount) || 0),
      updatedAt: normalizeText(body.promptLibrary?.updatedAt) || new Date().toISOString(),
      version: Math.max(1, Number(body.promptLibrary?.version) || 1),
    };
    const syncedAt = new Date().toISOString();
    state.promptLibrary = {
      found: true,
      libraryId: buildLibraryId(owner.providerUserKey),
      owner,
      promptLibrary: {
        ...promptLibrary,
        items: cloneValue(state.promptLibrary.promptLibrary.items || []).slice(0, promptLibrary.itemCount),
      },
      syncedAt,
    };
    state.promptLibraryRemote = {
      checkedAt: syncedAt,
      found: true,
      itemCount: promptLibrary.itemCount,
      lastRevision: normalizeText(body.sync?.revision) || state.syncRevision,
      lastSyncedAt: syncedAt,
      providerUserKey: owner.providerUserKey,
      updatedAt: promptLibrary.updatedAt,
      version: promptLibrary.version,
    };
    return void sendJson(response, 200, {
      ok: true,
      data: {
        libraryId: state.promptLibrary.libraryId,
        owner,
        promptLibrary,
        syncedAt,
      },
    });
  }

  sendJson(response, 404, {
    ok: false,
    error: `Unknown local cloud harness route: ${requestUrl.pathname}`,
  });
}

function assertAuthorization(request) {
  const authorization = normalizeText(request.headers.authorization);
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    const error = new Error("Missing bearer token.");
    error.status = 401;
    throw error;
  }
}

function listStoreEntries(entries, filter, owner) {
  const providerUserKey = normalizeText(owner?.providerUserKey);
  const query = normalizeText(filter.query).toLowerCase();
  const categoryId = normalizeCategoryId(filter.categoryId, true);
  return cloneValue(entries)
    .filter((entry) => !filter.ownerOnly || normalizeText(entry.owner?.providerUserKey) === providerUserKey)
    .filter((entry) => categoryId === "all" || entry.categoryId === categoryId)
    .filter((entry) => {
      if (!query) {
        return true;
      }
      return `${entry.title} ${entry.summary} ${entry.content} ${entry.owner?.displayName || ""}`.toLowerCase().includes(query);
    })
    .sort((left, right) => compareEntries(left, right, filter.sortBy))
    .slice(0, filter.limit);
}

function buildAvailableCategories(allEntries, visibleEntries, activeCategoryId) {
  const counts = {};
  for (const entry of allEntries) {
    const categoryId = normalizeCategoryId(entry.categoryId);
    counts[categoryId] = Math.max(0, Number(counts[categoryId]) || 0) + 1;
  }

  const ids = new Set(["all"]);
  for (const entry of visibleEntries) {
    ids.add(normalizeCategoryId(entry.categoryId));
  }
  if (normalizeCategoryId(activeCategoryId, true) !== "all") {
    ids.add(normalizeCategoryId(activeCategoryId));
  }

  return Array.from(ids)
    .filter((categoryId) => categoryId === "all" || counts[categoryId] > 0)
    .sort((left, right) => {
      if (left === "all") return -1;
      if (right === "all") return 1;
      return left.localeCompare(right);
    })
    .map((categoryId) => ({
      id: categoryId,
      label: categoryId === "all" ? "All" : toLabel(categoryId),
    }));
}

function updateEntry(state, entryId, mapper) {
  const index = state.storeEntries.findIndex((entry) => entry.entryId === entryId);
  if (index < 0) {
    const error = new Error(`Unknown store entry: ${entryId}`);
    error.status = 404;
    throw error;
  }
  state.storeEntries[index] = mapper(cloneValue(state.storeEntries[index]));
  return cloneValue(state.storeEntries[index]);
}

function compareEntries(left, right, sortBy) {
  if (sortBy === "likes") {
    return compareNumber(right.metrics.likeCount, left.metrics.likeCount) || compareDate(right.publishedAt, left.publishedAt);
  }
  if (sortBy === "imports") {
    return compareNumber(right.metrics.importCount, left.metrics.importCount) || compareDate(right.publishedAt, left.publishedAt);
  }
  if (sortBy === "views") {
    return compareNumber(right.metrics.viewCount, left.metrics.viewCount) || compareDate(right.publishedAt, left.publishedAt);
  }
  return compareDate(right.publishedAt, left.publishedAt);
}

function compareNumber(left, right) {
  return Number(left || 0) - Number(right || 0);
}

function compareDate(left, right) {
  return Date.parse(left || "") - Date.parse(right || "");
}

function normalizeListFilter(body) {
  return {
    categoryId: normalizeCategoryId(body.categoryId, true),
    limit: Math.max(1, Number(body.limit) || 24),
    ownerOnly: Boolean(body.ownerOnly),
    query: normalizeText(body.query),
    sortBy: normalizeSort(body.sortBy),
  };
}

function normalizeSort(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["latest", "likes", "imports", "views"].includes(normalized) ? normalized : "latest";
}

function normalizePrompt(prompt) {
  return {
    title: normalizeText(prompt?.title),
    content: normalizeText(prompt?.content),
  };
}

function normalizeOwner(owner) {
  return {
    displayName: normalizeText(owner?.displayName) || "Harness User",
    email: normalizeText(owner?.email).toLowerCase(),
    kind: normalizeText(owner?.kind) || "user",
    maskedEmail: normalizeText(owner?.maskedEmail) || "fi***@example.com",
    numericUserId: Number.isFinite(Number(owner?.numericUserId)) ? Number(owner.numericUserId) : null,
    provider: normalizeText(owner?.provider) || "inova",
    providerUserKey: normalizeText(owner?.providerUserKey) || "fixture-user",
  };
}

function normalizeCategoryId(value, allowAll = false) {
  const normalized = normalizeText(value).toLowerCase();
  if (allowAll && normalized === "all") {
    return "all";
  }
  return normalized || "other";
}

function buildSummary(content) {
  return normalizeText(content).slice(0, 140);
}

function buildLibraryId(providerUserKey) {
  return `inova__${normalizeText(providerUserKey)}`;
}

function toLabel(categoryId) {
  return String(categoryId || "other")
    .split("-")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePort(value, fallbackPort) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackPort;
}

function getBaseUrl(host, port) {
  return `http://${host}:${port}`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createCloudHarnessServer,
};
