#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyIdentityReuseCache();
  await verifyIdentityPendingRequestDeduplication();
  console.log("[verify-functions-runtime] Functions runtime identity cache contract passed");
}

async function verifyIdentityReuseCache() {
  const fetchCalls = [];
  const runtime = loadRuntime({
    fetch: async (url, options) => {
      fetchCalls.push({
        authorization: String(options?.headers?.Authorization || ""),
        method: String(options?.method || ""),
        url: String(url || ""),
      });
      return {
        ok: true,
      };
    },
  });

  const request = createBearerRequest("token-alpha");
  const providerIdentity = {
    displayName: "Tester",
    email: "tester@example.com",
    provider: "inova",
    providerUserKey: "user-1",
  };

  const firstOwner = await runtime.verifyInovaIdentity(providerIdentity, request);
  const secondOwner = await runtime.verifyInovaIdentity(providerIdentity, request);

  assert.equal(fetchCalls.length, 1, "same token/user verification should be reused inside the warm runtime");
  assert.equal(fetchCalls[0].method, "GET");
  assert(fetchCalls[0].url.includes("/api/users/user-1/settings"));
  assert.deepEqual(firstOwner, secondOwner);
}

async function verifyIdentityPendingRequestDeduplication() {
  const fetchCalls = [];
  let resolveFetch = null;
  const runtime = loadRuntime({
    fetch: (url) => {
      fetchCalls.push(String(url || ""));
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });

  const request = createBearerRequest("token-beta");
  const providerIdentity = {
    email: "tester@example.com",
    provider: "inova",
    providerUserKey: "user-2",
  };

  const firstPromise = runtime.verifyInovaIdentity(providerIdentity, request);
  const secondPromise = runtime.verifyInovaIdentity(providerIdentity, request);

  await flushAsync();
  assert.equal(fetchCalls.length, 1, "concurrent identity checks should share one upstream verification");

  resolveFetch?.({ ok: true });
  const [firstOwner, secondOwner] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(firstOwner, secondOwner);
}

function loadRuntime(overrides = {}) {
  let context;
  context = vm.createContext({
    Buffer,
    console,
    fetch: overrides.fetch || (async () => ({ ok: true })),
    globalThis: null,
    module: { exports: {} },
    exports: {},
    process: {
      env: {},
    },
    require(moduleId) {
      if (moduleId === "crypto") {
        return require("crypto");
      }
      if (moduleId === "firebase-admin") {
        return {
          apps: [],
          firestore() {
            return {};
          },
          initializeApp() {},
          storage() {
            return {
              bucket() {
                return {};
              },
            };
          },
        };
      }
      if (moduleId === "firebase-functions/v2/https") {
        return {
          onRequest() {
            return {};
          },
        };
      }
      if (moduleId === "firebase-functions/v2/firestore") {
        return {
          onDocumentWritten() {
            return {};
          },
        };
      }
      if (moduleId === "firebase-functions/v2/scheduler") {
        return {
          onSchedule() {
            return {};
          },
        };
      }
      if (moduleId === "../shared/prompt-text-model") {
        const source = fs.readFileSync(path.join(root, "functions", "shared", "prompt-text-model.js"), "utf8");
        new vm.Script(source, {
          filename: "functions/shared/prompt-text-model.js",
        }).runInContext(context);
        return {};
      }
      if (moduleId === "../shared/prompt-store-model") {
        const source = fs.readFileSync(path.join(root, "functions", "shared", "prompt-store-model.js"), "utf8");
        new vm.Script(source, {
          filename: "functions/shared/prompt-store-model.js",
        }).runInContext(context);
        return {};
      }
      throw new Error(`Unexpected module: ${moduleId}`);
    },
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;
  const source = fs.readFileSync(path.join(root, "functions", "platform", "runtime.js"), "utf8");
  new vm.Script(source, {
    filename: "functions/platform/runtime.js",
  }).runInContext(context);
  return context.module.exports;
}

function createBearerRequest(accessToken) {
  return {
    get(headerName) {
      return String(headerName || "").toLowerCase() === "authorization"
        ? `Bearer ${accessToken}`
        : "";
    },
  };
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

main().catch((error) => {
  console.error(`[verify-functions-runtime] ${error.stack || error.message}`);
  process.exitCode = 1;
});
