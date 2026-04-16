#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyBundledRuntimeRouterDispatch();
  console.log("[verify-runtime-capability-router] Runtime capability router contract passed");
}

async function verifyBundledRuntimeRouterDispatch() {
  const fetchCalls = [];
  const context = vm.createContext({
    fetch: async (url, options) => {
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
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    firebaseConfig: {
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

main().catch((error) => {
  console.error(`[verify-runtime-capability-router] ${error.stack || error.message}`);
  process.exitCode = 1;
});
