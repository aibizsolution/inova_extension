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
        bridgeApis: ["invokeCapability"],
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
  assert(catalog.pageCapabilityIds.includes("clipboard.write-text"));

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
