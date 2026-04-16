#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyServedCapabilityManifests();
  await verifyRemoteManifestBundledFallbackIsVisible();
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

async function verifyBundledRuntimeRouterDispatch() {
  const fetchCalls = [];
  const remoteManifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
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
    target: "production",
    web: {
      projectId: "browser-extension-main",
    },
  });
  context.issueMeetingPanelAuth = async () => ({
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    panelScope: "meeting-panel",
  });
  context.issuePromptPanelAuth = async () => ({
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    panelScope: "prompt-panel-v2",
    promptPanelScope: "prompt-panel-v2",
  });
  context.openBrowserUrl = async (url) => ({
    opened: true,
    url,
  });
  context.openMeetingResult = async () => ({ opened: true });
  context.openMeetingWorkspace = async () => ({ opened: true });
  context.revokeMeetingShareLink = async () => ({ ok: true });

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
      method: "POST",
      url: "https://example.test/reviewInovaPrompt",
    },
  ]);

  await assert.rejects(
    router.handle({
      action: "functions.invoke-endpoint",
      endpointKey: "loadInovaPromptLibraryUrl",
      service: "prompt",
    }),
    /허용되지 않은 Functions endpoint 요청이에요/
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

main().catch((error) => {
  console.error(`[verify-runtime-capability-router] ${error.stack || error.message}`);
  process.exitCode = 1;
});
