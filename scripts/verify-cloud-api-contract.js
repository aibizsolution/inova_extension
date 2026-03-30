#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createCloudHarnessServer } = require("./cloud-harness-server");
const { MEETING_CREATE_REQUEST, PROVIDER_IDENTITY } = require("../fixtures/cloud-harness/fixtures");

const root = path.resolve(__dirname, "..");
const accessToken = "fixture-access-token";

async function main() {
  const harness = createCloudHarnessServer({ port: 0 });
  const { baseUrl, hostingBaseUrl } = await harness.listen();

  try {
    const context = createHarnessContext(baseUrl, hostingBaseUrl);
    const namespace = loadCloudApiNamespace(context);
    const providerIdentity = cloneValue(PROVIDER_IDENTITY);

    assert(namespace.firebaseConfig.functions.reviewInovaPromptUrl.startsWith(baseUrl), "Functions base URL override should point to the local cloud harness");
    assert(namespace.firebaseConfig.hosting.latestReleaseUrl.startsWith(hostingBaseUrl), "Hosting base URL override should point to the local cloud harness");

    const peek = await namespace.cloudApi.peekInovaPromptLibrary(providerIdentity, accessToken);
    assert.equal(peek.found, true);
    assert.equal(peek.itemCount, 2);

    const load = await namespace.cloudApi.loadInovaPromptLibrary(providerIdentity, accessToken);
    assert.equal(load.found, true);
    assert.equal(load.promptLibrary.itemCount, 2);
    assert.equal(load.promptLibrary.items.length, 2);

    const list = await namespace.cloudApi.listPromptStoreEntries(
      { categoryId: "all", limit: 10, ownerOnly: false, query: "", sortBy: "latest" },
      providerIdentity,
      accessToken
    );
    assert.equal(list.items.length, 2);
    assert.equal(list.totalCount, 2);

    const review = await namespace.cloudApi.reviewInovaPrompt("Review this prompt.", providerIdentity, accessToken);
    assert.equal(review.verdict, "revise");
    assert(review.refinedPrompt.includes("executive"), "Review fixture should return the refined prompt");

    const meetingJob = await namespace.cloudApi.createInovaMeetingJob(
      cloneValue(MEETING_CREATE_REQUEST),
      providerIdentity,
      accessToken
    );
    assert.equal(meetingJob.job.status, "queued");
    assert.equal(meetingJob.job.sessionId, MEETING_CREATE_REQUEST.meeting.sessionId);

    const meetingProcessing = await namespace.cloudApi.getInovaMeetingJob(
      {
        jobId: meetingJob.job.jobId,
        sessionId: meetingJob.job.sessionId,
      },
      providerIdentity,
      accessToken
    );
    assert.equal(meetingProcessing.job.status, "processing");

    const meetingSucceeded = await namespace.cloudApi.getInovaMeetingJob(
      {
        jobId: meetingJob.job.jobId,
        sessionId: meetingJob.job.sessionId,
      },
      providerIdentity,
      accessToken
    );
    assert.equal(meetingSucceeded.job.status, "succeeded");

    const meetingArtifact = await namespace.cloudApi.getInovaMeetingArtifact(
      {
        artifactId: meetingSucceeded.job.transcript.artifactId,
        jobId: meetingJob.job.jobId,
      },
      providerIdentity,
      accessToken
    );
    assert.equal(meetingArtifact.artifact.artifactId, meetingSucceeded.job.transcript.artifactId);
    assert.equal(meetingArtifact.artifact.segments.length > 0, true);

    const publish = await namespace.cloudApi.publishPromptToStore(
      { title: "Local publish", content: "Create a concise executive summary." },
      "meeting",
      providerIdentity,
      accessToken
    );
    assert(publish.entry.entryId, "Publish should return a new store entry");
    assert.equal(publish.entry.categoryId, "meeting");

    const like = await namespace.cloudApi.togglePromptStoreLike(publish.entry.entryId, providerIdentity, accessToken);
    assert.equal(like.entry.viewer.liked, true);
    assert.equal(like.entry.metrics.likeCount, 1);

    const view = await namespace.cloudApi.recordPromptStoreView(publish.entry.entryId, providerIdentity, accessToken);
    assert.equal(view.entry.viewer.viewed, true);
    assert.equal(view.entry.metrics.viewCount, 1);

    const imported = await namespace.cloudApi.importPromptStoreEntry(publish.entry.entryId, providerIdentity, accessToken);
    assert.equal(imported.entry.viewer.imported, true);
    assert.equal(imported.entry.metrics.importCount, 1);

    const listMine = await namespace.cloudApi.listPromptStoreEntries(
      { categoryId: "all", limit: 10, ownerOnly: true, query: "", sortBy: "latest" },
      providerIdentity,
      accessToken
    );
    assert(listMine.items.some((entry) => entry.entryId === publish.entry.entryId), "Owner-only list should include the published fixture entry");

    const unpublish = await namespace.cloudApi.unpublishPromptFromStore(publish.entry.entryId, providerIdentity, accessToken);
    assert.equal(unpublish.removed, true);

    const syncDocument = {
      owner: providerIdentity,
      promptLibrary: {
        itemCount: 1,
        updatedAt: "2026-03-30T10:00:00.000Z",
        version: 2,
      },
      sync: {
        reason: "local-harness",
        revision: "fixture-revision-2",
      },
    };
    const sync = await namespace.cloudApi.syncInovaPromptLibrary(syncDocument, accessToken);
    assert.equal(sync.owner.providerUserKey, providerIdentity.providerUserKey);
    assert.equal(sync.promptLibrary.itemCount, 1);
    assert.equal(sync.promptLibrary.version, 2);

    const latestResponse = await fetch(`${hostingBaseUrl}/releases/latest.json`);
    const latestRelease = await latestResponse.json();
    assert.equal(latestRelease.version, "0.3.8");

    const historyResponse = await fetch(`${hostingBaseUrl}/releases/history.json`);
    const releaseHistory = await historyResponse.json();
    assert(Array.isArray(releaseHistory), "Release history fixture should return an array");
    assert.equal(releaseHistory[0]?.version, "0.3.7");

    console.log("[verify-cloud-api-contract] Local cloud harness contract passed");
  } finally {
    await harness.close();
  }
}

function createHarnessContext(baseUrl, hostingBaseUrl) {
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console,
    fetch,
    location: { href: "http://127.0.0.1/" },
    setTimeout,
    __INOVA_FIREBASE_CONFIG_OVERRIDE__: {
      functions: {
        baseUrl,
      },
      hosting: {
        baseUrl: hostingBaseUrl,
      },
    },
  };
  context.globalThis = context;
  return vm.createContext(context);
}

function loadCloudApiNamespace(context) {
  runScript(path.join(root, "shared", "constants.js"), context, "shared/constants.js");
  runScript(path.join(root, "shared", "session.js"), context, "shared/session.js");
  runScript(path.join(root, "shared", "firebase-config.js"), context, "shared/firebase-config.js");
  runScript(path.join(root, "shared", "cloud-api.js"), context, "shared/cloud-api.js");
  return context.InovaBookmarks;
}

function runScript(filePath, context, label) {
  const source = fs.readFileSync(filePath, "utf8");
  new vm.Script(source, { filename: label }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-cloud-api-contract] ${error.message}`);
  process.exit(1);
});
