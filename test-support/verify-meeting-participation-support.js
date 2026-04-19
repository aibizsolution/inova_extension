const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { registerMeetingWorkspaceAuthHandlers } = require("../functions/features/meeting/meeting-workspace-auth-service");
const {
  MEETING_COLLECTION,
  createDeps,
  createMemoryState,
  invokeHandler,
} = require("./verify-meeting-service-support");

const ROOT = path.resolve(__dirname, "..");
const PARTICIPATION_COLLECTION = "integration_inova_meeting_participations";
const MEETING_PARTICIPATION_CAPABILITIES = Object.freeze([
  "runtime.invoke.v1",
  "meeting.participation.hide-function",
  "meeting.share.create-function",
  "meeting.share.revoke-function",
]);

async function verifyMeetingParticipationAccessFlow() {
  const owner = {
    displayName: "Owner User",
    email: "owner@example.com",
    numericUserId: 2001,
    provider: "inova",
    providerUserKey: "owner-user",
  };
  const viewer = {
    displayName: "Viewer User",
    email: "viewer@example.com",
    numericUserId: 3001,
    provider: "inova",
    providerUserKey: "viewer-user",
  };
  const secondViewer = {
    displayName: "Second Viewer",
    email: "second@example.com",
    numericUserId: 3002,
    provider: "inova",
    providerUserKey: "second-viewer",
  };
  const state = createMemoryState();
  const handlers = registerMeetingWorkspaceAuthHandlers(createDeps(state));
  const meetingId = "meeting-share-shortcut-1";
  const meetingDocumentId = `${owner.providerUserKey}__${meetingId}`;
  const participationId = `${viewer.providerUserKey}__${owner.providerUserKey}__${meetingId}`;
  const secondParticipationId = `${secondViewer.providerUserKey}__${owner.providerUserKey}__${meetingId}`;

  getCollection(state, MEETING_COLLECTION).set(meetingDocumentId, {
    createdAt: "2026-04-18T01:00:00.000Z",
    meetingId,
    owner,
    share: {},
    status: "idle",
    title: "Shared Planning",
    updatedAt: "2026-04-18T01:00:00.000Z",
  });

  const shareCreated = await invokeHandler(handlers.createInovaMeetingShareLink, {
    body: { meetingId, owner },
    method: "POST",
  });
  assert.equal(shareCreated.statusCode, 200);
  const shareToken = shareCreated.jsonBody.data.shareToken;
  assert.equal(getDoc(state, MEETING_COLLECTION, meetingDocumentId).share.participantCount, 0);

  const ownerSelfShareAccess = await authorizeWorkspace(handlers, {
    meetingId,
    providerIdentity: owner,
    shareToken,
  });
  assert.equal(ownerSelfShareAccess.jsonBody.data.accessDecision, "allowed");
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, `${owner.providerUserKey}__${owner.providerUserKey}__${meetingId}`), null);

  const firstShareAccess = await authorizeWorkspace(handlers, {
    meetingId,
    providerIdentity: viewer,
    shareToken,
  });
  assert.equal(firstShareAccess.jsonBody.data.accessDecision, "allowed");
  assert.equal(firstShareAccess.jsonBody.data.readOnly, true);
  assert.equal(firstShareAccess.jsonBody.data.participationId, participationId);
  assert.equal(state.customTokens.at(-1).claims.scope, "meeting-workspace-share");
  assert.equal(state.customTokens.at(-1).claims.ownerProviderUserKey, owner.providerUserKey);
  assert.equal(state.customTokens.at(-1).claims.viewerProviderUserKey, viewer.providerUserKey);

  const firstParticipation = getDoc(state, PARTICIPATION_COLLECTION, participationId);
  assert.equal(firstParticipation.accessState, "active");
  assert.equal(firstParticipation.hidden, false);
  assert.equal(firstParticipation.meetingDocumentId, meetingDocumentId);
  assert.equal(firstParticipation.source, "share-link");
  assert.equal(firstParticipation.titleSnapshot, "Shared Planning");
  assert.equal(firstParticipation.viewer.providerUserKey, viewer.providerUserKey);
  assert.equal(firstParticipation.owner.providerUserKey, owner.providerUserKey);
  assert.equal(getDoc(state, MEETING_COLLECTION, meetingDocumentId).share.participantCount, 1);
  assert(getDoc(state, MEETING_COLLECTION, meetingDocumentId).share.lastParticipantAt);

  const repeatedShareAccess = await authorizeWorkspace(handlers, {
    meetingId,
    participationCache: firstShareAccess.jsonBody.data.participation,
    providerIdentity: viewer,
    shareToken,
  });
  assert.equal(repeatedShareAccess.jsonBody.data.accessDecision, "allowed");
  assert.deepEqual(getDoc(state, PARTICIPATION_COLLECTION, participationId), firstParticipation);
  assert.equal(getDoc(state, MEETING_COLLECTION, meetingDocumentId).share.participantCount, 1);

  const secondShareAccess = await authorizeWorkspace(handlers, {
    meetingId,
    providerIdentity: secondViewer,
    shareToken,
  });
  assert.equal(secondShareAccess.jsonBody.data.accessDecision, "allowed");
  assert.equal(secondShareAccess.jsonBody.data.participationId, secondParticipationId);
  assert.equal(getDoc(state, MEETING_COLLECTION, meetingDocumentId).share.participantCount, 2);

  getCollection(state, MEETING_COLLECTION).set(meetingDocumentId, {
    ...getDoc(state, MEETING_COLLECTION, meetingDocumentId),
    title: "Shared Planning Updated",
    updatedAt: "2026-04-18T02:00:00.000Z",
  });
  const underThrottleAccess = await authorizeWorkspace(handlers, {
    meetingId,
    participationId,
    providerIdentity: viewer,
  });
  assert.equal(underThrottleAccess.jsonBody.data.accessDecision, "allowed");
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).titleSnapshot, "Shared Planning");

  getCollection(state, PARTICIPATION_COLLECTION).set(participationId, {
    ...getDoc(state, PARTICIPATION_COLLECTION, participationId),
    lastRefreshAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
  });
  const overThrottleAccess = await authorizeWorkspace(handlers, {
    meetingId,
    participationId,
    providerIdentity: viewer,
  });
  assert.equal(overThrottleAccess.jsonBody.data.accessDecision, "allowed");
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).titleSnapshot, "Shared Planning Updated");

  const hideResult = await invokeHandler(handlers.hideInovaMeetingParticipation, {
    body: { meetingId, participationId, providerIdentity: viewer },
    method: "POST",
  });
  assert.equal(hideResult.statusCode, 200);
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).hidden, true);

  const hiddenAccess = await authorizeWorkspace(handlers, {
    meetingId,
    participationId,
    providerIdentity: viewer,
  });
  assert.equal(hiddenAccess.jsonBody.data.accessDecision, "denied");

  const restoredShareAccess = await authorizeWorkspace(handlers, {
    meetingId,
    providerIdentity: viewer,
    shareToken,
  });
  assert.equal(restoredShareAccess.jsonBody.data.accessDecision, "allowed");
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).hidden, false);
  assert.equal(getDoc(state, MEETING_COLLECTION, meetingDocumentId).share.participantCount, 2);

  const forbiddenHide = await invokeHandler(handlers.hideInovaMeetingParticipation, {
    body: {
      meetingId,
      participationId,
      providerIdentity: {
        displayName: "Other Viewer",
        email: "other@example.com",
        numericUserId: 3002,
        provider: "inova",
        providerUserKey: "other-viewer",
      },
    },
    method: "POST",
  });
  assert.equal(forbiddenHide.statusCode, 404);
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).hidden, false);

  const shareRevoked = await invokeHandler(handlers.revokeInovaMeetingShareLink, {
    body: { meetingId, owner },
    method: "POST",
  });
  assert.equal(shareRevoked.statusCode, 200);
  assert.equal(shareRevoked.jsonBody.data.revokedParticipationCount, 2);
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).hidden, false);
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).accessState, "revoked");
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, secondParticipationId).hidden, false);
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, secondParticipationId).accessState, "revoked");

  const revokedAccess = await authorizeWorkspace(handlers, {
    meetingId,
    participationId,
    providerIdentity: viewer,
  });
  assert.equal(revokedAccess.jsonBody.data.accessDecision, "denied");
  assert.equal(revokedAccess.jsonBody.data.reason, "share-revoked");
  assert.equal(getDoc(state, PARTICIPATION_COLLECTION, participationId).accessState, "revoked");

  const shareRecreated = await invokeHandler(handlers.createInovaMeetingShareLink, {
    body: { meetingId, owner },
    method: "POST",
  });
  assert.equal(shareRecreated.statusCode, 200);
  assert.notEqual(shareRecreated.jsonBody.data.share.shareId, shareCreated.jsonBody.data.share.shareId);
  assert.equal(getDoc(state, MEETING_COLLECTION, meetingDocumentId).share.participantCount, 0);
}

async function verifyHostedMeetingHubParticipationTabsSearchAndHide() {
  const participationId = "fixture-viewer__fixture-owner__meeting-shared";
  const harness = createHubHarness({
    participationSnapshot: {
      items: [
        {
          accessState: "active",
          lastRefreshAt: "2026-04-13T02:01:00.000Z",
          meetingDocumentId: "fixture-owner__meeting-shared",
          meetingId: "meeting-shared",
          owner: {
            displayName: "Owner User",
            email: "owner@example.com",
            providerUserKey: "fixture-owner",
          },
          participationId,
          shareId: "share-shared",
          titleSnapshot: "Shared Beta",
        },
      ],
    },
  });

  harness.controller.syncPanelState(
    {
      activeTool: "meeting",
      open: true,
      settings: { meetingWorkspaceTarget: "production" },
    },
    MEETING_PARTICIPATION_CAPABILITIES
  );
  await flushAsyncTurns();

  let viewState = harness.controller.buildViewState();
  assert.equal(viewState.counts.all, 2);
  assert.equal(viewState.counts.owned, 1);
  assert.equal(viewState.counts.participating, 1);
  assert.equal(harness.participationSubscribeCalls[0].providerIdentity.providerUserKey, "fixture-user");

  await harness.controller.handleMeetingAction("set-scope", { scope: "participating" });
  viewState = harness.controller.buildViewState();
  assert.equal(viewState.items.length, 1);
  assert.equal(viewState.items[0].sourceKind, "participating");

  assert.equal(harness.controller.handleSearch("meeting", "owner@example.com"), true);
  assert.equal(harness.controller.buildViewState().items.length, 1);
  harness.controller.handleSearch("meeting", "missing-room");
  assert.equal(harness.controller.buildViewState().items.length, 0);
  assert.equal(harness.participationSubscribeCalls.length, 1);

  harness.controller.handleSearch("meeting", "");
  const hideHandled = await harness.controller.handleMeetingAction("remove-participation", {
    meetingId: "meeting-shared",
    participationId,
    sourceKind: "participating",
    title: "Shared Beta",
  });
  assert.equal(hideHandled, true);
  assert(
    harness.runtimeCalls.some((request) =>
      request.action === "capabilities.invoke"
        && request.capabilityId === "meeting.participation.hide-function"
        && request.input?.participationId === participationId)
  );
  assert.deepEqual(harness.toastCalls.at(-1), {
    contextId: "meeting-shared",
    message: "목록에서 제거했습니다.",
    source: "meeting",
    tone: "success",
    ttlMs: 1800,
  });
}

function verifyMeetingParticipationRulesAndIndexes() {
  const firestoreRulesSource = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  assert(
    firestoreRulesSource.includes("match /integration_inova_meeting_participations/{docId}")
      && firestoreRulesSource.includes("function matchesMeetingParticipationPanel(resourceData)")
      && firestoreRulesSource.includes("resourceData.viewer.providerUserKey == request.auth.token.providerUserKey")
      && firestoreRulesSource.includes("allow write: if false;")
  );
  const firestoreIndexes = JSON.parse(fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8")).indexes || [];
  assert(
    firestoreIndexes.some((index) =>
      index.collectionGroup === PARTICIPATION_COLLECTION
        && hasIndexField(index, "viewer.providerUserKey", "ASCENDING")
        && hasIndexField(index, "hidden", "ASCENDING")
        && hasIndexField(index, "lastRefreshAt", "DESCENDING"))
  );
  assert(
    firestoreIndexes.some((index) =>
      index.collectionGroup === PARTICIPATION_COLLECTION
        && hasIndexField(index, "owner.providerUserKey", "ASCENDING")
        && hasIndexField(index, "meetingId", "ASCENDING")
        && hasIndexField(index, "shareId", "ASCENDING")
        && hasIndexField(index, "hidden", "ASCENDING"))
  );
}

async function authorizeWorkspace(handlers, body) {
  const result = await invokeHandler(handlers.authorizeInovaMeetingWorkspaceAccess, {
    body,
    method: "POST",
  });
  assert.equal(result.statusCode, 200);
  return result;
}

function createHubHarness(options = {}) {
  const runtimeCalls = [];
  const participationSubscribeCalls = [];
  const toastCalls = [];
  const context = vm.createContext({
    clearTimeout() {},
    console,
    globalThis: null,
    setTimeout() {
      return 1;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };
  loadScript("hosting/extension-v2/panel/panel-utils.js", context);
  loadScript("hosting/extension-v2/panel/extension-capability-client.js", context);
  loadScript("hosting/extension-v2/panel/meeting-hub-controller.js", context);

  const controller = context.InovaBookmarks.meetingHubController.create({
    invokePage: async () => ({ copied: true }),
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      if (request?.action === "storage.read-panel-state") {
        return {
          providerIdentityCache: {
            providerIdentity: {
              available: true,
              displayName: "Fixture User",
              email: "fixture@example.com",
              numericUserId: 7,
              provider: "inova",
              providerUserKey: "fixture-user",
            },
          },
          settings: { meetingWorkspaceTarget: "production" },
        };
      }
      if (request?.action === "capabilities.invoke" && request?.capabilityId === "meeting.participation.hide-function") {
        return {
          hidden: true,
          meetingId: request.input?.meetingId || "",
          participationId: request.input?.participationId || "",
        };
      }
      throw new Error(`Unexpected runtime action: ${request?.action}`);
    },
    meetingRealtime: {
      disconnect() {},
      async ensureSubscribed() {
        return {
          checkedAt: "2026-04-13T01:02:03.000Z",
          fromCache: false,
          hasPendingWrites: false,
          items: [
            {
              artifactId: "artifact-alpha",
              jobId: "job-alpha",
              meetingId: "meeting-alpha",
              share: { active: false, shareId: "", status: "" },
              status: "succeeded",
              title: "Alpha",
              updatedAt: "2026-04-13T01:01:00.000Z",
            },
          ],
        };
      },
    },
    meetingParticipationRealtime: {
      disconnect() {},
      async ensureSubscribed(request) {
        participationSubscribeCalls.push(cloneValue(request));
        return {
          checkedAt: "2026-04-13T01:02:03.000Z",
          fromCache: false,
          hasPendingWrites: false,
          items: [],
          ...cloneValue(options.participationSnapshot),
        };
      },
    },
    publishToast(payload) {
      toastCalls.push(cloneValue(payload));
      return true;
    },
    scheduleRender() {},
    traceMeeting() {},
  });
  return { controller, participationSubscribeCalls, runtimeCalls, toastCalls };
}

function getCollection(state, collectionName) {
  if (!state.collections.has(collectionName)) {
    state.collections.set(collectionName, new Map());
  }
  return state.collections.get(collectionName);
}

function getDoc(state, collectionName, docId) {
  const collection = getCollection(state, collectionName);
  const value = collection.get(docId);
  return value == null ? null : cloneValue(value);
}

async function flushAsyncTurns(turns = 20) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasIndexField(index, fieldPath, order) {
  return (index.fields || []).some((field) => field.fieldPath === fieldPath && field.order === order);
}

module.exports = {
  verifyHostedMeetingHubParticipationTabsSearchAndHide,
  verifyMeetingParticipationAccessFlow,
  verifyMeetingParticipationRulesAndIndexes,
};
