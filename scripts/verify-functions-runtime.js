#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyCorsOrigins();
  verifyStorageBucketResolution();
  verifySecretManagerWiring();
  await verifyIdentityReuseCache();
  await verifyIdentityPendingRequestDeduplication();
  console.log("[verify-functions-runtime] Functions runtime identity cache contract passed");
}

function verifyCorsOrigins() {
  const runtime = loadRuntime();
  assert(
    runtime.CORS_ORIGINS.includes("https://browser-extension-main.web.app")
      && runtime.CORS_ORIGINS.includes("https://browser-extension-v2.web.app")
      && runtime.CORS_ORIGINS.includes("http://127.0.0.1:5000"),
    "Functions CORS should allow legacy hosting, v2 hosting, and local hosted workspace origins"
  );
}

function verifyStorageBucketResolution() {
  const configBucketRuntime = loadRuntime({
    env: {
      FIREBASE_CONFIG: JSON.stringify({
        projectId: "browser-extension-main",
        storageBucket: "browser-extension-main.firebasestorage.app",
      }),
    },
  });
  assert.equal(
    configBucketRuntime.bucket?.name,
    "browser-extension-main.firebasestorage.app",
    "Functions should use FIREBASE_CONFIG.storageBucket for meeting temporary audio by default"
  );

  const reservedOverrideRuntime = loadRuntime({
    env: {
      FIREBASE_CONFIG: JSON.stringify({
        projectId: "browser-extension-main",
        storageBucket: "browser-extension-main.firebasestorage.app",
      }),
      STORAGE_BUCKET_URL: "gcf-v2-uploads-1027279095019.asia-northeast3.cloudfunctions.appspot.com",
    },
  });
  assert.equal(
    reservedOverrideRuntime.bucket?.name,
    "browser-extension-main.firebasestorage.app",
    "Functions must not use Cloud Functions deployment buckets as meeting temporary audio storage"
  );

  const explicitBucketRuntime = loadRuntime({
    env: {
      FIREBASE_CONFIG: JSON.stringify({
        projectId: "browser-extension-main",
        storageBucket: "browser-extension-main.firebasestorage.app",
      }),
      STORAGE_BUCKET_URL: "gs://custom-meeting-temp-bucket/",
    },
  });
  assert.equal(
    explicitBucketRuntime.bucket?.name,
    "custom-meeting-temp-bucket",
    "Functions should still allow explicit app storage bucket overrides"
  );
}

function verifySecretManagerWiring() {
  const indexPath = path.join(root, "functions", "index.js");
  const source = fs.readFileSync(indexPath, "utf8");
  assert(
    /defineSecret\("INOVA_EXTENSION_AI_PROVIDER_CONFIG"\)/.test(source),
    "INOVA_EXTENSION_AI_PROVIDER_CONFIG must be declared as the single i-Nova AI provider Secret Manager secret"
  );
  assert(
    !/defineSecret\("INOVA_EXTENSION_OPENAI_API_KEY"\)/.test(source)
      && !/defineSecret\("INOVA_EXTENSION_OPENROUTER_API_KEY"\)/.test(source),
    "AI provider keys must not be mounted as separate Secret Manager secrets"
  );
  for (const exportName of [
    "processQueuedInovaMeetingJob",
    "processQueuedInovaMeetingJobPart",
    "finalizeChunkedInovaMeetingJob",
    "processQueuedInovaMeetingCommand",
  ]) {
    const pattern = new RegExp(`exports\\.${exportName}\\s*=\\s*onDocumentWritten\\(\\s*withAIProviderSecret\\(`);
    assert(pattern.test(source), `${exportName} must mount the single AI provider config secret from Secret Manager`);
  }
  assert(
    /registerPromptReviewHandlers\(\{[\s\S]*onRequest:\s*onAIProviderRequest/.test(source),
    "Prompt review function must mount INOVA_EXTENSION_AI_PROVIDER_CONFIG from Secret Manager"
  );
  assert(
    /registerMeetingHandlers\(\{[\s\S]*onOpenAIRequest:\s*onAIProviderRequest/.test(source),
    "Meeting AI HTTP handlers must receive the AI provider secret onRequest wrapper"
  );
  assert(
    source.includes('require("./features/feature-usage/feature-usage-service")')
      && source.includes("exports.commitInovaFeatureUsageBatch"),
    "Feature usage commit endpoint must be registered and exported from functions/index.js"
  );
  assert(
    source.includes('require("./features/admin/admin-service")')
      && source.includes("exports.checkInovaAdminAccess")
      && source.includes("exports.issueInovaAdminLaunch")
      && source.includes("exports.exchangeInovaAdminLaunch")
      && source.includes("exports.readInovaAdminBootstrap")
      && source.includes("exports.readInovaPanelNotice")
      && source.includes("exports.listInovaAdminPanelNotices")
      && source.includes("exports.saveInovaAdminPanelNotice")
      && source.includes("exports.publishInovaAdminPanelNotice")
      && source.includes("exports.archiveInovaAdminPanelNotice"),
    "Admin access, launch, exchange, bootstrap, and panel notice endpoints must be registered and exported from functions/index.js"
  );
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
      env: { ...(overrides.env || {}) },
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
              bucket(name) {
                return { name };
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
