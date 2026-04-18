#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyServedManifestMetricsCapability();
  verifyHostedIdentityFallbackWiring();
  await verifyBundledMetricsEndpointResolution();
  console.log("[verify-feature-usage-runtime] Feature usage runtime capability contract passed");
}

function verifyServedManifestMetricsCapability() {
  const legacyManifest = readJson(path.join("hosting", "extension", "capability-manifest.json"));
  const v2Manifest = readJson(path.join("hosting", "extension-v2", "capability-manifest.json"));
  assert.deepEqual(v2Manifest, legacyManifest, "served feature usage manifests should stay aligned");
  assert.equal(v2Manifest.endpointKeys.commitInovaFeatureUsageBatchUrl.endpoint, "commitInovaFeatureUsageBatch");
  assert.equal(v2Manifest.endpointKeys.commitInovaFeatureUsageBatchUrl.method, "POST");
  const capability = v2Manifest.capabilities["metrics.feature-usage.commit"];
  assert.equal(capability.kind, "function");
  assert.equal(capability.service, "metrics");
  assert.equal(capability.authMode, "access-token");
  assert.equal(capability.auditLevel, "write");
  assert.equal(capability.endpointKey, "commitInovaFeatureUsageBatchUrl");

  const validatorSource = fs.readFileSync(path.join(root, "background", "capability-manifest-validator.js"), "utf8");
  assert(
    validatorSource.includes('["meeting", "metrics", "prompt"]'),
    "capability manifest validator should allow only the known function services including metrics"
  );
}

function verifyHostedIdentityFallbackWiring() {
  const topPanelSource = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  const hostedIndexSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "index.js"), "utf8");
  const meetingSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "meeting-hub-controller.js"), "utf8");
  const promptLibrarySource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "prompt-library-controller.js"), "utf8");

  assert(
    topPanelSource.includes("providerIdentity: normalizeProviderIdentity(namespace.providerIdentity?.getCurrent?.()),"),
    "top panel snapshot must carry sanitized provider identity so feature usage does not depend only on extension storage"
  );
  assert(
    topPanelSource.includes("namespace.providerIdentityCache.normalizeProviderIdentity"),
    "top panel provider identity snapshot must use the shared sanitizer"
  );
  assert(
    hostedIndexSource.includes("readProviderIdentity: () => state.panelSnapshot?.providerIdentity || null,"),
    "hosted feature usage tracker must fall back to snapshot provider identity when storage read is empty"
  );
  assert(
    meetingSource.includes("hydrateProviderIdentityFromPanel(panelState);")
      && meetingSource.includes("if (providerIdentity.providerUserKey || !normalizeText(state.providerIdentity.providerUserKey))"),
    "meeting usage actions must keep snapshot provider identity when storage read is empty"
  );
  assert(
    promptLibrarySource.includes("hydrateProviderIdentityFromPanel(panelState);")
      && promptLibrarySource.includes("const storageProviderUserKey = normalizeText(providerIdentity.providerUserKey);")
      && promptLibrarySource.includes("const providerUserKey = storageProviderUserKey || normalizeText(state.providerIdentity.providerUserKey);"),
    "prompt usage actions must keep snapshot provider identity when storage read is empty"
  );
}

async function verifyBundledMetricsEndpointResolution() {
  const warnings = [];
  const context = vm.createContext({
    console: {
      warn(message, payload) {
        warnings.push({ message: String(message || ""), payload });
      },
    },
    Date,
    fetch: async () => {
      throw new Error("network unavailable");
    },
    globalThis: null,
    URL,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    cloudApi: {
      fetchCapabilityManifest: async () => {
        throw new Error("network unavailable");
      },
    },
    firebaseConfig: {
      meeting: {
        resolveRuntime() {
          return {
            emulators: { enabled: false },
            target: "production",
            web: { projectId: "browser-extension-main" },
          };
        },
      },
      web: { projectId: "browser-extension-main" },
    },
    productLane: {
      getActiveLane: () => "v2",
      getKnownHostingOrigins: () => [
        "https://browser-extension-main.web.app",
        "https://browser-extension-v2.web.app",
        "http://127.0.0.1:5000",
        "http://localhost:5000",
      ],
      getKnownLanes: () => ["legacy", "v2"],
      readManifestVersion: () => "1.0.0",
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
  };
  loadScript(path.join("background", "capability-manifest-validator.js"), context);
  loadScript(path.join("background", "functions-runtime-config.js"), context);

  const manifest = context.InovaBookmarks.functionsRuntimeConfig.getBundledCapabilityManifest();
  assert.equal(manifest.capabilities["metrics.feature-usage.commit"].service, "metrics");
  const endpoint = await context.InovaBookmarks.functionsRuntimeConfig.resolveCapabilityFunctionEndpoint({
    endpointKey: "commitInovaFeatureUsageBatchUrl",
    service: "metrics",
    settings: {
      meetingWorkspaceTarget: "production",
    },
  });
  assert.equal(endpoint.endpointPath, "commitInovaFeatureUsageBatch");
  assert.equal(
    endpoint.targetUrl,
    "https://asia-northeast3-browser-extension-main.cloudfunctions.net/commitInovaFeatureUsageBatch"
  );
  assert.equal(endpoint.service, "metrics");
  assert(warnings.some((entry) => entry.payload?.source === "bundled-fallback"));
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

main().catch((error) => {
  console.error(`[verify-feature-usage-runtime] ${error.stack || error.message}`);
  process.exitCode = 1;
});
