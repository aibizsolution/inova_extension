#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyExtensionCapabilityClientPageAllowlist();
  console.log("[verify-extension-capability-client] Extension capability client contract passed");
}

async function verifyExtensionCapabilityClientPageAllowlist() {
  const pageCalls = [];
  const runtimeCalls = [];
  const workflowCalls = [];
  const context = vm.createContext({
    console,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };

  loadScript(path.join("hosting", "extension-v2", "panel", "extension-capability-client.js"), context);

  const browserCapabilities = context.InovaBookmarks.extensionCapabilityClient.create({
    invokePage: async (request) => {
      pageCalls.push(cloneValue(request));
      return { ok: true };
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push(cloneValue(request));
      return {
        bridgeApis: ["invokeCapability", "metrics"],
        capabilities: [
          {
            capabilityId: "page.composer.read-state",
            enabled: true,
            kind: "page.capability",
            pageCapabilityId: "composer.read-state",
          },
          {
            capabilityId: "page.raw.disabled",
            enabled: false,
            kind: "page.capability",
            minExtensionVersionSupported: true,
            pageCapabilityId: "composer.read-state",
          },
          {
            capabilityId: "prompt.review.run",
            enabled: true,
            kind: "function",
            requestTimeoutMs: 75000,
          },
          {
            capabilityId: "metrics.feature-usage.commit",
            enabled: true,
            kind: "function",
          },
          {
            artifactId: "test-workflow",
            artifactVersion: "0.0.1",
            capabilityId: "test.workflow.run",
            enabled: true,
            kind: "workflow",
            workflowId: "test.workflow.run",
          },
          {
            artifactId: "test-workflow",
            artifactVersion: "0.0.1",
            capabilityId: "test.workflow.disabled",
            enabled: false,
            kind: "workflow",
            workflowId: "test.workflow.disabled",
          },
          {
            capabilityId: "panel.ui-preferences.write",
            enabled: false,
            kind: "storage.write-ui-preferences",
          },
        ],
        capabilityAliases: [
          {
            aliasId: "page.composer.read",
            replacementId: "page.composer.read-state",
          },
        ],
        enabledCapabilityIds: ["prompt.review.run", "page.composer.read-state"],
      };
    },
    invokeWorkflow: async (capability, input, options) => {
      workflowCalls.push({
        capability: cloneValue(capability),
        input: cloneValue(input),
        options: cloneValue(options),
      });
      return { workflow: true };
    },
  });

  await browserCapabilities.invokePageCapability("composer.read-state", {
    action: "trace.log",
    extra: "kept",
  });
  assert.deepEqual(pageCalls.at(-1), {
    action: "composer.read-state",
    extra: "kept",
  });
  await assert.rejects(
    async () => browserCapabilities.invokePageCapability("raw.dom-script", {}),
    /허용되지 않은 page capability예요/
  );

  const catalog = await browserCapabilities.readCapabilityCatalog({ reason: "test" });
  assert.deepEqual(runtimeCalls.at(-1), {
    action: "capabilities.handshake",
    reason: "test",
  });
  assert(catalog.bridgeApis.includes("invokeCapability"));
  assert(catalog.bridgeApis.includes("invokePageCapability"));
  assert(catalog.pageCapabilityIds.includes("composer.read-state"));
  assert(catalog.pageCapabilityIds.includes("conversation.read-dom-snapshot"));
  assert(catalog.pageCapabilityIds.includes("clipboard.write-text"));
  await browserCapabilities.readConversationDomSnapshot();
  assert.deepEqual(pageCalls.at(-1), {
    action: "conversation.read-dom-snapshot",
  });
  await browserCapabilities.invokeCapability("prompt.review.run", { prompt: "검토" });
  assert.deepEqual(runtimeCalls.at(-1), {
    action: "capabilities.invoke",
    capabilityId: "prompt.review.run",
    input: { prompt: "검토" },
    requestTimeoutMs: 75000,
    trace: null,
  });
  await browserCapabilities.commitFeatureUsageBatch({
    dayKey: "2026-04-18",
  });
  assert.deepEqual(runtimeCalls.at(-1), {
    action: "capabilities.invoke",
    capabilityId: "metrics.feature-usage.commit",
    input: { dayKey: "2026-04-18" },
    trace: null,
  });

  await browserCapabilities.invokeCapability("page.composer.read-state", {
    extra: "semantic",
  });
  assert.deepEqual(pageCalls.at(-1), {
    action: "composer.read-state",
    extra: "semantic",
  });

  await browserCapabilities.invokeCapability("page.composer.read", {
    extra: "alias",
  });
  assert.deepEqual(pageCalls.at(-1), {
    action: "composer.read-state",
    extra: "alias",
  });

  await assert.rejects(
    async () => browserCapabilities.invokeCapability("page.raw.disabled", {}),
    /capability가 비활성화되어 있어요/
  );

  const workflowResult = await browserCapabilities.invokeCapability(
    "test.workflow.run",
    { prompt: "workflow" },
    { pilotEnabled: true }
  );
  assert.deepEqual(workflowResult, { workflow: true });
  assert.equal(workflowCalls.at(-1)?.capability?.workflowId, "test.workflow.run");
  assert.equal(workflowCalls.at(-1)?.capability?.artifactId, "test-workflow");
  assert.deepEqual(workflowCalls.at(-1)?.input, { prompt: "workflow" });
  assert.deepEqual(workflowCalls.at(-1)?.options, { pilotEnabled: true });
  await assert.rejects(
    async () => browserCapabilities.invokeCapability("test.workflow.disabled", {}),
    /capability가 비활성화되어 있어요/
  );
  const runtimeCallCountBeforeDisabledStorage = runtimeCalls.length;
  await assert.rejects(
    async () => browserCapabilities.writeUiPreferences({ activeTool: "meeting" }),
    /capability가 비활성화되어 있어요/
  );
  assert.equal(
    runtimeCalls.length,
    runtimeCallCountBeforeDisabledStorage,
    "disabled non-page capabilities should be blocked by the hosted client before runtime dispatch"
  );
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function loadScript(relativePath, context) {
  const fullPath = path.join(root, relativePath);
  const source = fs.readFileSync(fullPath, "utf8");
  vm.runInContext(source, context, { filename: fullPath });
}

main().catch((error) => {
  console.error("[verify-extension-capability-client] Failed");
  console.error(error);
  process.exit(1);
});
