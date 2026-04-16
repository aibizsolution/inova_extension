#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyServedCapabilityManifests();
  await verifyRemoteManifestBundledFallbackIsVisible();
  await verifyRemoteManifestValidationFailuresAreVisible();
  await verifyBundledRuntimeRouterDispatch();
  console.log("[verify-runtime-capability-router] Runtime capability router contract passed");
}

function verifyServedCapabilityManifests() {
  const legacyManifest = readJson(path.join("hosting", "extension", "capability-manifest.json"));
  const v2Manifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
  assert.deepEqual(v2Manifest, legacyManifest, "served legacy/v2 capability manifests should stay aligned");
  assert.equal(v2Manifest.schemaVersion, 1);
  assert.equal(v2Manifest.minExtensionVersion, "1.0.0");
  assert.equal(
    v2Manifest.targets.production.functionsBaseUrl,
    "https://asia-northeast3-browser-extension-main.cloudfunctions.net"
  );
  assert.equal(
    v2Manifest.targets.local.functionsBaseUrl,
    "http://127.0.0.1:5001/browser-extension-main/asia-northeast3"
  );
  assert.equal(v2Manifest.endpointKeys.reviewInovaPromptUrl.endpoint, "reviewInovaPrompt");
  assert.equal(v2Manifest.capabilities["prompt.review.run"].endpointKey, "reviewInovaPromptUrl");
  assert.equal(v2Manifest.capabilities["prompt.review.run"].kind, "function");
  assert.equal(v2Manifest.capabilities["prompt.review.run"].inputSchemaVersion, 1);
  assert.equal(v2Manifest.capabilities["panel.ui-preferences.write"].kind, "storage.write-ui-preferences");
  assert.equal(v2Manifest.capabilities["panel.ui-preferences.write"].service, "storage");
  assert.equal(v2Manifest.capabilities["page.composer.read-state"].kind, "page.capability");
  assert.equal(v2Manifest.capabilities["page.composer.read-state"].pageCapabilityId, "composer.read-state");
  assert.equal(v2Manifest.capabilities["release.download.open"].kind, "browser.open-url");
  assert.deepEqual(v2Manifest.capabilities["release.download.open"].templateKeys, ["release.download"]);
  assert.deepEqual(v2Manifest.workflowArtifacts, {});
  assert.equal(v2Manifest.lanes.v2.endpointOverrides.syncInovaPromptLibraryUrl, "syncInovaPromptLibraryV2");
}

async function verifyRemoteManifestBundledFallbackIsVisible() {
  const warnings = [];
  const context = createRuntimeContext({
    console: {
      warn(message, payload) {
        warnings.push({
          message: String(message || ""),
          payload,
        });
      },
    },
    fetch: async () => {
      throw new Error("network unavailable");
    },
  });
  loadScript(path.join("background", "capability-manifest-validator.js"), context);
  loadScript(path.join("background", "functions-runtime-config.js"), context);

  const result = await context.InovaBookmarks.functionsRuntimeConfig.getActiveCapabilityManifest();
  assert.equal(result.source, "bundled-fallback");
  assert.equal(result.degraded, true);
  assert.equal(result.manifest.endpointKeys.reviewInovaPromptUrl.endpoint, "reviewInovaPrompt");
  assert(
    warnings.some((entry) => entry.message.includes("capability manifest degraded")
      && entry.payload?.source === "bundled-fallback"),
    "remote manifest fetch failure should be visible before falling back to bundled baseline"
  );
}

async function verifyRemoteManifestValidationFailuresAreVisible() {
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.expiresAt = "2020-01-01T00:00:00.000Z";
    },
    "expired manifest should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.targets.production.functionsBaseUrl = "https://example.invalid/functions";
    },
    "unknown Functions origin should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.endpointKeys.reviewInovaPromptUrl.method = "GET";
    },
    "unsupported endpoint method should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      delete manifest.capabilities["prompt.review.run"].inputSchemaVersion;
    },
    "missing capability schema should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      delete manifest.capabilities["prompt.review.run"].auditLevel;
    },
    "missing capability audit metadata should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["prompt.review.run"].authMode = "none";
    },
    "write capability without auth should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["page.composer.read-state"].pageCapabilityId = "raw.dom-script";
    },
    "unknown page capability should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      addTestWorkflowArtifact(manifest);
      manifest.capabilities["test.workflow.enabled"] = buildTestWorkflowCapability({ enabled: true });
    },
    "enabled workflow capability should fall back visibly before sandbox pilot"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      addTestWorkflowArtifact(manifest);
      manifest.capabilities["test.workflow.no-kill-switch"] = buildTestWorkflowCapability({
        killSwitch: null,
      });
    },
    "workflow capability without kill switch metadata should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["test.workflow.missing-artifact"] = buildTestWorkflowCapability({
        artifactId: "missing-workflow",
        workflowId: "test.workflow.missing-artifact",
      });
    },
    "workflow capability without artifact registry should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      addTestWorkflowArtifact(manifest, {
        scriptSlot: "raw-browser-context",
      });
      manifest.capabilities["test.workflow.bad-slot"] = buildTestWorkflowCapability({
        workflowId: "test.workflow.bad-slot",
      });
    },
    "workflow artifact with unknown scriptSlot should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      addTestWorkflowArtifact(manifest, {
        artifactVersion: "0.0.2",
      });
      manifest.capabilities["test.workflow.version-mismatch"] = buildTestWorkflowCapability({
        workflowId: "test.workflow.version-mismatch",
      });
    },
    "workflow artifact version mismatch should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["https://example.test/raw"] = {
        ...manifest.capabilities["prompt.review.run"],
      };
    },
    "raw URL capabilityId should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["test.function.missing-flag"] = {
        ...manifest.capabilities["prompt.review.run"],
        enabled: false,
      };
    },
    "test capability without testOnly metadata should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["fixture.test-only.enabled"] = {
        ...manifest.capabilities["prompt.review.run"],
        testOnly: true,
      };
    },
    "testOnly capability enabled in production should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["prompt.review.run"].deprecatedAt = "2026-05-31";
    },
    "deprecated capability without replacement should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.capabilities["prompt.review.run"].deprecatedAt = "2026-05-31";
      manifest.capabilities["prompt.review.run"].replacementId = "prompt.review.missing";
    },
    "deprecated capability with unknown replacement should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.aliases = {
        "prompt.review.old": {
          replacementId: "prompt.review.missing",
          removeAfter: "2030-01-01T00:00:00.000Z",
        },
      };
    },
    "alias with unknown replacement should fall back visibly"
  );
  await verifyRejectedManifestMutation(
    (manifest) => {
      manifest.aliases = {
        "prompt.review.old": {
          replacementId: "prompt.review.run",
        },
      };
    },
    "alias without removeAfter should fall back visibly"
  );
}

async function verifyRejectedManifestMutation(mutator, message) {
  const warnings = [];
  const remoteManifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
  mutator(remoteManifest);
  const context = createRuntimeContext({
    console: {
      warn(warningMessage, payload) {
        warnings.push({
          message: String(warningMessage || ""),
          payload,
        });
      },
    },
    fetch: async () => ({
      async json() {
        return remoteManifest;
      },
      ok: true,
      status: 200,
    }),
  });
  loadScript(path.join("background", "capability-manifest-validator.js"), context);
  loadScript(path.join("background", "functions-runtime-config.js"), context);
  const result = await context.InovaBookmarks.functionsRuntimeConfig.getActiveCapabilityManifest();
  assert.equal(result.source, "bundled-fallback", message);
  assert.equal(result.degraded, true, message);
  assert(
    warnings.some((entry) => entry.message.includes("capability manifest degraded")
      && entry.payload?.source === "bundled-fallback"),
    message
  );
}

async function verifyBundledRuntimeRouterDispatch() {
  const fetchCalls = [];
  const openedUrls = [];
  const remoteManifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
  remoteManifest.aliases = {
    "prompt.review.old": {
      owner: "runtime-platform",
      replacementId: "prompt.review.run",
      removeAfter: "2030-01-01T00:00:00.000Z",
    },
  };
  remoteManifest.lanes.v2.endpointOverrides.reviewInovaPromptUrl = "reviewInovaPromptRemoteV2";
  remoteManifest.capabilities["prompt.store.list"].deprecatedAt = "2026-05-31";
  remoteManifest.capabilities["prompt.store.list"].replacementId = "prompt.store.import";
  remoteManifest.capabilities["fixture.future.function"] = {
    ...remoteManifest.capabilities["prompt.review.run"],
    minExtensionVersion: "99.0.0",
  };
  remoteManifest.capabilities["fixture.killed.function"] = {
    ...remoteManifest.capabilities["prompt.review.run"],
    killSwitch: {
      enabled: true,
    },
  };
  remoteManifest.capabilities["fixture.lane.function"] = {
    ...remoteManifest.capabilities["prompt.review.run"],
    lane: "legacy",
  };
  remoteManifest.capabilities["test.function.disabled"] = {
    ...remoteManifest.capabilities["prompt.review.run"],
    enabled: false,
    testOnly: true,
  };
  addTestWorkflowArtifact(remoteManifest);
  remoteManifest.capabilities["test.workflow.disabled"] = buildTestWorkflowCapability({ enabled: false });
  const context = createRuntimeContext({
    fetch: async (url, options) => {
      if (String(url || "").endsWith("/capability-manifest.json")) {
        return {
          async json() {
            return remoteManifest;
          },
          ok: true,
          status: 200,
        };
      }
      fetchCalls.push({
        authorization: String(options?.headers?.Authorization || ""),
        body: JSON.parse(String(options?.body || "{}")),
        method: String(options?.method || ""),
        url: String(url || ""),
      });
      return {
        async json() {
          return {
            data: {
              echoed: true,
            },
            ok: true,
          };
        },
        ok: true,
      };
    },
    console,
  });
  context.createMeetingShareLink = async () => ({ ok: true });
  context.getInovaAccessToken = async () => "access-token-1";
  context.getMeetingFunctionsConfig = async () => ({
    listInovaMeetingsUrl: "https://example.test/listInovaMeetings",
  });
  context.getPromptFunctionsConfig = async () => ({
    reviewInovaPromptUrl: "https://example.test/reviewInovaPrompt",
  });
  context.getPromptRuntimeConfig = async () => ({
    emulators: {
      authUrl: "",
      enabled: false,
      firestoreHost: "",
      firestorePort: 0,
    },
    prompt: {
      firestoreCollections: {},
    },
    hosting: {
      baseUrl: "https://browser-extension-v2.web.app/extension-v2",
    },
    target: "production",
    web: {
      projectId: "browser-extension-main",
    },
  });
  context.openBrowserUrl = async (url) => {
    openedUrls.push(String(url || ""));
    return { opened: true, url: String(url || "") };
  };
  context.issueMeetingPanelAuth = async () => ({
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    panelScope: "meeting-panel",
  });
  context.issuePromptPanelAuth = async () => ({
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    panelScope: "prompt-panel-v2",
    promptPanelScope: "prompt-panel-v2",
  });
  context.openMeetingResult = async () => ({ opened: true });
  context.openMeetingWorkspace = async () => ({ opened: true });
  context.revokeMeetingShareLink = async () => ({ ok: true });

  loadScript(path.join("background", "capability-manifest-validator.js"), context);
  loadScript(path.join("background", "functions-runtime-config.js"), context);
  loadScript(path.join("background", "panel-runtime-capability-router.js"), context);

  const router = context.InovaBookmarks.panelRuntimeCapabilityRouter;
  const storageSnapshot = await router.handle({
    action: "storage.read-panel-state",
  });
  assert.deepEqual(storageSnapshot, {
    providerIdentityCache: {
      providerUserKey: "user-1",
    },
    settings: {
      meetingWorkspaceTarget: "production",
    },
    uiPreferences: {
      activeTool: "prompts",
    },
  });

  const nextPreferences = await router.handle({
    action: "storage.write-ui-preferences",
    partial: {
      activeTool: "release",
    },
  });
  assert.deepEqual(nextPreferences, {
    activeTool: "release",
  });
  const hostedAuth = await router.handle({
    action: "auth.issue-panel-session",
    panel: "hosted",
    providerIdentity: {
      providerUserKey: "user-1",
    },
  });
  assert.equal(hostedAuth.panelScope, "prompt-panel-v2");

  const handshake = await router.handle({
    action: "capabilities.handshake",
    requestedCapabilityIds: ["prompt.review.run"],
  });
  assert.equal(handshake.manifestVersion, remoteManifest.manifestVersion);
  assert.equal(handshake.source, "remote");
  assert(handshake.runtimeActions.includes("capabilities.handshake"));
  assert(handshake.runtimeActions.includes("capabilities.invoke"));
  assert.deepEqual(
    handshake.bridgeApis,
    readJson(path.join("contracts", "extension-contract.json")).sandboxBridgeApis,
    "handshake should expose only the contracted sandbox bridge API allowlist"
  );
  assert.deepEqual(handshake.capabilityAliases, [
    {
      aliasId: "prompt.review.old",
      owner: "runtime-platform",
      removeAfter: "2030-01-01T00:00:00.000Z",
      replacementId: "prompt.review.run",
      replacementKind: "function",
    },
  ]);
  assert(handshake.enabledCapabilityIds.includes("prompt.review.run"));
  assert(handshake.enabledCapabilityIds.includes("panel.ui-preferences.write"));
  assert(handshake.enabledCapabilityIds.includes("page.composer.read-state"));
  assert(handshake.enabledCapabilityIds.includes("release.download.open"));
  assert.equal(
    handshake.capabilities.find((capability) => capability.capabilityId === "prompt.review.run")?.enabled,
    true
  );
  assert.equal(
    handshake.capabilities.find((capability) => capability.capabilityId === "page.composer.read-state")?.pageCapabilityId,
    "composer.read-state"
  );
  const deprecatedCapability = handshake.capabilities.find((capability) => capability.capabilityId === "prompt.store.list");
  assert.equal(deprecatedCapability?.deprecatedAt, "2026-05-31");
  assert.equal(deprecatedCapability?.replacementId, "prompt.store.import");
  const futureCapability = handshake.capabilities.find((capability) => capability.capabilityId === "fixture.future.function");
  assert.equal(futureCapability?.enabled, false);
  assert.equal(futureCapability?.minExtensionVersion, "99.0.0");
  assert.equal(futureCapability?.minExtensionVersionSupported, false);
  assert(!handshake.enabledCapabilityIds.includes("fixture.future.function"));
  const killedCapability = handshake.capabilities.find((capability) => capability.capabilityId === "fixture.killed.function");
  assert.equal(killedCapability?.enabled, false);
  assert.equal(killedCapability?.killSwitch, true);
  assert(!handshake.enabledCapabilityIds.includes("fixture.killed.function"));
  const laneCapability = handshake.capabilities.find((capability) => capability.capabilityId === "fixture.lane.function");
  assert.equal(laneCapability?.enabled, false);
  assert.equal(laneCapability?.lane, "legacy");
  assert(!handshake.enabledCapabilityIds.includes("fixture.lane.function"));
  const testOnlyCapability = handshake.capabilities.find((capability) => capability.capabilityId === "test.function.disabled");
  assert.equal(testOnlyCapability?.enabled, false);
  assert.equal(testOnlyCapability?.testOnly, true);
  assert(!handshake.enabledCapabilityIds.includes("test.function.disabled"));
  const workflowCapability = handshake.capabilities.find((capability) => capability.capabilityId === "test.workflow.disabled");
  assert.equal(workflowCapability?.enabled, false);
  assert.equal(workflowCapability?.workflowId, "test.workflow.disabled");
  assert.equal(workflowCapability?.artifactId, "test-workflow");
  assert.equal(workflowCapability?.artifactVersion, "0.0.1");
  assert(!handshake.enabledCapabilityIds.includes("test.workflow.disabled"));

  const semanticPreferences = await router.handle({
    action: "capabilities.invoke",
    capabilityId: "panel.ui-preferences.write",
    input: {
      partial: {
        activeTool: "meeting",
      },
    },
  });
  assert.deepEqual(semanticPreferences, {
    activeTool: "meeting",
  });

  const invokeResult = await router.handle({
    action: "functions.invoke-endpoint",
    authMode: "access-token",
    body: {
      prompt: "test",
    },
    endpointKey: "reviewInovaPromptUrl",
    service: "prompt",
  });
  assert.deepEqual(invokeResult, {
    echoed: true,
  });
  assert.deepEqual(fetchCalls, [
    {
      authorization: "Bearer access-token-1",
      body: {
        prompt: "test",
      },
      method: "POST",
      url: "https://asia-northeast3-browser-extension-main.cloudfunctions.net/reviewInovaPromptRemoteV2",
    },
  ]);

  const capabilityInvokeResult = await router.handle({
    action: "capabilities.invoke",
    capabilityId: "prompt.review.run",
    input: {
      prompt: "capability-id",
    },
  });
  assert.deepEqual(capabilityInvokeResult, {
    echoed: true,
  });
  assert.deepEqual(fetchCalls.at(-1), {
    authorization: "Bearer access-token-1",
    body: {
      prompt: "capability-id",
    },
    method: "POST",
    url: "https://asia-northeast3-browser-extension-main.cloudfunctions.net/reviewInovaPromptRemoteV2",
  });
  const aliasInvokeResult = await router.handle({
    action: "capabilities.invoke",
    capabilityId: "prompt.review.old",
    input: {
      prompt: "alias",
    },
  });
  assert.deepEqual(aliasInvokeResult, {
    echoed: true,
  });
  assert.deepEqual(fetchCalls.at(-1), {
    authorization: "Bearer access-token-1",
    body: {
      prompt: "alias",
    },
    method: "POST",
    url: "https://asia-northeast3-browser-extension-main.cloudfunctions.net/reviewInovaPromptRemoteV2",
  });

  await assert.rejects(
    router.handle({
      action: "functions.invoke-endpoint",
      endpointKey: "loadInovaPromptLibraryUrl",
      service: "prompt",
    }),
    /허용되지 않은 Functions endpoint 요청이에요/
  );
  await assert.rejects(
    router.handle({
      action: "capabilities.invoke",
      capabilityId: "https://example.test/raw",
      input: {},
    }),
    /허용되지 않은 capabilityId예요/
  );
  await assert.rejects(
    router.handle({
      action: "capabilities.invoke",
      capabilityId: "fixture.future.function",
      input: {},
    }),
    /현재 확장 버전에서 capability를 사용할 수 없어요/
  );
  await assert.rejects(
    router.handle({
      action: "capabilities.invoke",
      capabilityId: "fixture.killed.function",
      input: {},
    }),
    /capability kill switch가 켜져 있어요/
  );
  await assert.rejects(
    router.handle({
      action: "capabilities.invoke",
      capabilityId: "fixture.lane.function",
      input: {},
    }),
    /현재 lane에서 capability를 사용할 수 없어요/
  );
  await assert.rejects(
    router.handle({
      action: "capabilities.invoke",
      capabilityId: "test.function.disabled",
      input: {},
    }),
    /test-only capability는 실행할 수 없어요/
  );
  const releaseOpenResult = await router.handle({
    action: "capabilities.invoke",
    capabilityId: "release.download.open",
    input: {
      fileName: "latest.zip",
      templateKey: "release.download",
    },
  });
  assert.deepEqual(releaseOpenResult, {
    opened: true,
    url: "https://browser-extension-v2.web.app/extension-v2/downloads/latest.zip",
  });
  assert.deepEqual(openedUrls, [
    "https://browser-extension-v2.web.app/extension-v2/downloads/latest.zip",
  ]);
  await assert.rejects(
    router.handle({
      action: "capabilities.invoke",
      capabilityId: "release.download.open",
      input: {
        fileName: "https://example.test/raw.zip",
        templateKey: "release.download",
      },
    }),
    /허용되지 않은 release download 파일명이에요/
  );

  const disabledContext = createRuntimeContext({
    fetch: async (url) => {
      if (String(url || "").endsWith("/capability-manifest.json")) {
        const disabledManifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
        disabledManifest.capabilities["prompt.review.run"].enabled = false;
        return {
          async json() {
            return disabledManifest;
          },
          ok: true,
          status: 200,
        };
      }
      return {
        async json() {
          return { data: {}, ok: true };
        },
        ok: true,
      };
    },
  });
  disabledContext.getInovaAccessToken = async () => "access-token-1";
  loadScript(path.join("background", "capability-manifest-validator.js"), disabledContext);
  loadScript(path.join("background", "functions-runtime-config.js"), disabledContext);
  loadScript(path.join("background", "panel-runtime-capability-router.js"), disabledContext);
  const disabledHandshake = await disabledContext.InovaBookmarks.panelRuntimeCapabilityRouter.handle({
    action: "capabilities.handshake",
  });
  assert.equal(
    disabledHandshake.capabilities.find((capability) => capability.capabilityId === "prompt.review.run")?.enabled,
    false
  );
  assert(!disabledHandshake.enabledCapabilityIds.includes("prompt.review.run"));
  await assert.rejects(
    disabledContext.InovaBookmarks.panelRuntimeCapabilityRouter.handle({
      action: "capabilities.invoke",
      capabilityId: "prompt.review.run",
      input: {},
    }),
    /capability가 비활성화되어 있어요/
  );
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function createRuntimeContext(overrides = {}) {
  const context = vm.createContext({
    console: overrides.console || console,
    Date,
    fetch: overrides.fetch || (async () => ({ ok: true })),
    globalThis: null,
    URL,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    firebaseConfig: {
      hosting: {
        baseUrl: "https://browser-extension-v2.web.app/extension-v2",
      },
      meeting: {
        resolveRuntime() {
          return {
            emulators: {
              authUrl: "",
              enabled: false,
              firestoreHost: "",
              firestorePort: 0,
            },
            target: "production",
            web: {
              projectId: "browser-extension-main",
            },
          };
        },
      },
      web: {
        projectId: "browser-extension-main",
      },
    },
    productLane: {
      getActiveLane() {
        return "v2";
      },
      getKnownHostingOrigins() {
        return [
          "https://browser-extension-main.web.app",
          "https://browser-extension-v2.web.app",
          "http://127.0.0.1:5000",
          "http://localhost:5000",
        ];
      },
      getKnownLanes() {
        return ["legacy", "v2"];
      },
      readManifestVersion() {
        return "1.0.0";
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      async getState() {
        return {
          pausedSessions: {
            stale: true,
          },
          providerIdentityCache: {
            providerUserKey: "user-1",
          },
          settings: {
            meetingWorkspaceTarget: "production",
          },
          uiPreferences: {
            activeTool: "prompts",
          },
        };
      },
      async updateUiPreferences(partial) {
        return {
          activeTool: String(partial?.activeTool || ""),
        };
      },
    },
  };
  return context;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function buildTestWorkflowCapability(overrides = {}) {
  return {
    artifactId: "test-workflow",
    artifactVersion: "0.0.1",
    auditLevel: "read",
    authMode: "none",
    domain: "test",
    enabled: false,
    inputSchemaVersion: 1,
    kind: "workflow",
    killSwitch: {
      enabled: false,
    },
    minExtensionVersion: "1.0.0",
    outputSchemaVersion: 1,
    owner: "runtime-platform",
    schemaVersion: 1,
    service: "workflow",
    testOnly: true,
    workflowId: "test.workflow.disabled",
    ...overrides,
  };
}

function addTestWorkflowArtifact(manifest, overrides = {}) {
  manifest.workflowArtifacts = {
    ...(manifest.workflowArtifacts || {}),
    "test-workflow": {
      artifactVersion: "0.0.1",
      bundleId: "test-workflow-bundle",
      integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      scriptSlot: "remote-workflow",
      ...overrides,
    },
  };
}

main().catch((error) => {
  console.error(`[verify-runtime-capability-router] ${error.stack || error.message}`);
  process.exitCode = 1;
});
