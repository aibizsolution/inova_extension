#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  verifyHostedMeetingVisibilityRecoveryContract,
  verifyHostedMeetingSnapshotSyncGuardContract,
} = require("./verify-hosted-panel-runtime-contracts");
const { verifyPanelRuntimeResolverOwnershipContract } = require("./verify-panel-runtime-config");
const { verifyPanelHostRuntimeContract } = require("./verify-panel-host-runtime");
const { verifyHostedTraceVisibilityContract } = require("./verify-hosted-trace-visibility");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyPanelHostRuntimeContract();
  verifyPanelRuntimeResolverOwnershipContract();
  verifyHostedPanelImeCompositionGuard();
  verifyHostedMeetingActionCompletionTraceContract();
  verifyHostedStartupStatusCardDelayContract();
  verifyHostedMeetingSummarySyncContract();
  verifyHostedMeetingSnapshotSyncGuardContract();
  verifyHostedMeetingVisibilityRecoveryContract();
  verifyHostedPromptTabOwnershipContract();
  verifyHostedPromptActionOwnershipContract();
  verifyHostedTraceVisibilityContract();
  verifyHostedConversationSearchDebounceContract();
  verifyHostedStoreSearchDebounceContract();
  verifyBookmarkJumpAccessibilityContract();
  verifyHostedPromptReviewFallbackContract();
  verifyHostedReleaseSummarySyncContract();
  await verifyHostedReleaseLocalDownloadUrls();
  console.log("[verify-panel-render] Hosted panel host contract passed");
}

function verifyHostedPanelImeCompositionGuard() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("inputComposition: createInputCompositionState()"),
    "hosted panel should track text composition across hosted inputs"
  );
  assert(
    hostedPanelSource.includes("function getTextInputBinding(target)"),
    "hosted panel should resolve searchable and editable text inputs through a shared binding helper"
  );
  assert(
    hostedPanelSource.includes('kind: "prompt-field"'),
    "hosted panel IME guard should cover prompt editor fields"
  );
  assert(
    hostedPanelSource.includes('kind: "prompt-publish-field"'),
    "hosted panel IME guard should cover prompt publish fields"
  );
  assert(
    hostedPanelSource.includes('kind: "search"'),
    "hosted panel IME guard should cover hosted search fields"
  );
  assert(
    hostedPanelSource.includes("applyTextInputBinding(binding, { composing: false })"),
    "hosted panel should commit the final text input value after composition ends"
  );
  assert(
    hostedPanelSource.includes('binding.field === "category-label"'),
    "hosted panel should route custom publish category input through the shared IME-safe text binding"
  );
  assert(
    hostedPanelSource.includes("state.renderDeferred = true;"),
    "hosted panel should defer rerenders while composition is active"
  );
}

function verifyHostedMeetingActionCompletionTraceContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    !hostedPanelSource.includes('action: "meeting-action"'),
    "v2 hosted meeting actions should not fall back to the top-panel meeting-action request path"
  );
  assert(
    hostedPanelSource.includes("meetingHubController.handleMeetingAction(meetingAction, detail)"),
    "v2 hosted meeting actions should stay inside the hosted meeting hub controller"
  );
}

function verifyHostedStartupStatusCardDelayContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("const STARTUP_STATUS_CARD_DELAY_MS = 450;"),
    "hosted panel should defer startup status cards to avoid flashing an info box during normal boot"
  );
  assert(
    hostedPanelSource.includes("startupStatusTimerId: 0,"),
    "hosted panel should track a startup status timer"
  );
  assert(
    hostedPanelSource.includes("startupStatusShown: false,"),
    "hosted panel should track whether the delayed startup card is already visible"
  );
  assert(
    hostedPanelSource.includes("scheduleStartupStatusCard();"),
    "hosted panel should schedule the startup status card instead of rendering it immediately"
  );
  assert(
    hostedPanelSource.includes("clearStartupStatusCard();"),
    "hosted panel should clear pending startup status cards when the extension snapshot arrives"
  );
}

function verifyHostedMeetingSummarySyncContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "hosted-panel-bridge.js"),
    "utf8"
  );
  const bootstrapSource = fs.readFileSync(
    path.join(root, "content", "panel-v2-shell-bridge.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes('syncTopPanelSummary: (meetingTool = {}) => syncToolSummary("meeting", meetingTool),'),
    "hosted meeting hub should be able to sync a compact summary back to the top panel"
  );
  assert(
    bridgeRequestSource.includes('if (action === "tool-summary-sync") {'),
    "top panel bridge should accept hosted meeting summary sync requests through the shared hosted bridge helper"
  );
  assert(
    bootstrapSource.includes("onToolSummarySync: handlePanelToolSummarySync"),
    "panel bootstrap should forward hosted meeting summary sync callbacks into the top-panel bridge"
  );
  assert(
    hostedPanelSource.includes("return meetingHubController.buildViewState();"),
    "hosted meeting render should read meeting tool state from the hosted controller once capabilities are available"
  );
  assert(
    hostedPanelSource.includes("if (meetingHubController?.hasRequiredCapabilities?.()) {"),
    "hosted meeting render should branch on hosted controller capability before reading effective meeting counts"
  );
}

function verifyHostedPromptTabOwnershipContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    !hostedPanelSource.includes('action: "prompt-tab-select"'),
    "v2 hosted prompt tab selection should not fall back to the top-panel prompt-tab-select request path"
  );
}

function verifyHostedPromptActionOwnershipContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    !hostedPanelSource.includes('action: "prompt-action"'),
    "v2 hosted prompt panel should not fall back to the top-panel prompt-action request path"
  );
  assert(
    !hostedPanelSource.includes('action: "prompt-draft-change"'),
    "v2 hosted prompt panel should not fall back to the top-panel prompt-draft-change request path"
  );
  assert(
    !hostedPanelSource.includes('action: "store-action"'),
    "v2 hosted prompt panel should not fall back to the top-panel store-action request path"
  );
  assert(
    !hostedPanelSource.includes('action: "import-file"'),
    "v2 hosted prompt panel should not fall back to the top-panel import-file request path"
  );
  assert(
    !hostedPanelSource.includes('action: "move-prompt"'),
    "v2 hosted prompt panel should not fall back to the top-panel move-prompt request path"
  );
  assert(
    !hostedPanelSource.includes("namespace.promptHubView?.render?.(panelState.promptTool)"),
    "v2 hosted prompt panel should not fall back to the dead promptHubView renderer once promptToolView owns the shell"
  );
}

function verifyHostedConversationSearchDebounceContract() {
  const conversationControllerSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "conversation-controller.js"),
    "utf8"
  );

  assert(
    conversationControllerSource.includes("searchRenderTimerId: 0"),
    "hosted conversation controller should track a deferred search render timer"
  );
  assert(
    conversationControllerSource.includes("const nextQuery = String(value ?? \"\")"),
    "hosted conversation search should keep the raw search text until filtering"
  );
  assert(
    conversationControllerSource.includes("scheduleSearchRender();"),
    "hosted conversation search should defer rerenders instead of rendering on each keystroke"
  );
  assert(
    conversationControllerSource.includes("function scheduleSearchRender()"),
    "hosted conversation controller should expose a shared deferred search render helper"
  );
  assert(
    conversationControllerSource.includes("const explicitFingerprint = normalizeText(bookmarksTool?.snapshotFingerprint);"),
    "hosted conversation controller should accept a compact snapshot fingerprint from the top panel"
  );
}

function verifyHostedStoreSearchDebounceContract() {
  const promptStoreControllerSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-store-controller.js"),
    "utf8"
  );

  assert(
    promptStoreControllerSource.includes("searchRenderTimerId: 0"),
    "hosted store controller should track a deferred search render timer"
  );
  assert(
    promptStoreControllerSource.includes("scheduleSearchRender();"),
    "hosted store search should defer rerenders during typing"
  );
  assert(
    promptStoreControllerSource.includes("if (state.searchRenderTimerId) {"),
    "hosted store search should clear pending deferred renders before submit"
  );
  assert(
    promptStoreControllerSource.includes("if (state.query === nextQuery && !options.submit)"),
    "hosted store search should avoid redundant rerenders for repeated values"
  );
}

function verifyBookmarkJumpAccessibilityContract() {
  const hostedBookmarkSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "bookmark-view.js"),
    "utf8"
  );

  assert(
    hostedBookmarkSource.includes('<div class="bookmark-jump" data-bookmark-id="${bookmark.id}">'),
    "hosted bookmark list should render a non-focusable bookmark jump container"
  );
  assert(
    !hostedBookmarkSource.includes('class="bookmark-jump" type="button"'),
    "hosted bookmark list should not render a hidden/focusable bookmark jump button"
  );
}

function verifyHostedPromptReviewFallbackContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("const reviewState = resolveEffectivePromptReviewState(snapshotReviewState, hostedReviewState);"),
    "hosted prompt tool should merge snapshot review state before rendering the review tab"
  );
  assert(
    hostedPanelSource.includes("const storeState = promptStoreController.buildViewState();"),
    "hosted prompt tool should read store state directly from the hosted store controller"
  );
  assert(
    hostedPanelSource.includes("function resolveEffectivePromptReviewState(snapshotReviewState, hostedReviewState)"),
    "hosted panel should define a dedicated review-state merge helper"
  );
  assert(
    hostedPanelSource.includes("...snapshotState,"),
    "hosted panel should fall back to snapshot review data when hosted review state is still blank"
  );
  assert(
    hostedPanelSource.includes("const snapshotHasActiveState = Boolean("),
    "hosted panel should distinguish active snapshot review state from passive hosted review state"
  );
  assert(
    hostedPanelSource.includes("if (snapshotState.pending && !hostedState.pending) {"),
    "hosted panel should prefer snapshot review state while an external review request is pending"
  );
  assert(
    hostedPanelSource.includes("if (snapshotHasActiveState && !hostedHasActiveState) {"),
    "hosted panel should prefer snapshot review results when hosted review state has gone stale"
  );
}

function verifyHostedReleaseSummarySyncContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
  const releaseControllerSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "release-controller.js"),
    "utf8"
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "hosted-panel-bridge.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes('syncTopPanelSummary: (releaseTool = {}) => syncToolSummary("release", releaseTool),'),
    "hosted release controller should be able to sync a compact release summary back to the top panel"
  );
  assert(
    !hostedPanelSource.includes('action: "release-action"'),
    "v2 hosted release actions should not fall back to the top-panel release-action request path"
  );
  assert(
    releaseControllerSource.includes("await emitTopPanelSummary();"),
    "hosted release controller should emit a compact top-panel summary after release checks settle"
  );
  assert(
    bridgeRequestSource.includes('if (action === "tool-summary-sync") {'),
    "top panel bridge should accept hosted release summary sync requests through the shared hosted bridge helper"
  );
}

async function verifyHostedReleaseLocalDownloadUrls() {
  const runtimeCalls = [];
  const context = vm.createContext({
    Blob: class Blob {},
    File: class File {},
    clearTimeout,
    console,
    fetch: async (url) => {
      const href = String(url);
      if (href.endsWith("/extension-v2/releases/latest.json")) {
        return {
          ok: true,
          async json() {
            return {
              release: {
                downloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/latest.zip",
                fileName: "inova-extension-1.0.0.zip",
                version: "1.0.0",
                versionDownloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/inova-extension-1.0.0.zip",
              },
            };
          },
        };
      }
      if (href.endsWith("/extension-v2/releases/history.json")) {
        return {
          ok: true,
          async json() {
            return {
              releases: [
                {
                  downloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/inova-extension-0.4.4.zip",
                  fileName: "inova-extension-0.4.4.zip",
                  version: "0.4.4",
                  versionDownloadUrl: "https://browser-extension-v2.web.app/extension-v2/downloads/inova-extension-0.4.4.zip",
                },
              ],
            };
          },
        };
      }
      throw new Error(`Unexpected fetch URL: ${href}`);
    },
    globalThis: null,
    location: {
      href: "http://127.0.0.1:5000/extension-v2/panel/index.html",
    },
    setTimeout,
    URL,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    constants: {
      limits: {
        releaseCheckIntervalMs: 21600000,
      },
    },
    session: {
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };

  const source = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "release-controller.js"),
    "utf8"
  );
  new vm.Script(source, {
    filename: "hosting/extension-v2/panel/release-controller.js",
  }).runInContext(context);

  const controller = context.InovaBookmarks.releaseController.create({
    getRuntimeVersion() {
      return "1.0.0";
    },
    invokeRuntime: async (request) => {
      runtimeCalls.push(request);
      return {};
    },
    scheduleRender() {},
  });

  controller.syncPanelState(
    { activeTool: "release" },
    ["runtime.invoke.v1"]
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const viewState = controller.buildViewState();
  assert.equal(
    viewState.latest?.downloadUrl,
    "http://127.0.0.1:5000/extension-v2/downloads/latest.zip",
    "local hosted release latest download should resolve to the local downloads lane"
  );
  assert.equal(
    viewState.latest?.versionDownloadUrl,
    "http://127.0.0.1:5000/extension-v2/downloads/inova-extension-1.0.0.zip",
    "local hosted release version download should resolve to the local artifact file"
  );

  await controller.handleReleaseAction("download-latest");
  await controller.handleReleaseAction("download-version", { version: "0.4.4" });

  assert.deepEqual(
    runtimeCalls.map((call) => [call.action, call.url]),
    [
      ["browser.open-url", "http://127.0.0.1:5000/extension-v2/downloads/latest.zip"],
      ["browser.open-url", "http://127.0.0.1:5000/extension-v2/downloads/inova-extension-0.4.4.zip"],
    ],
    "local hosted release downloads should open local artifact URLs"
  );
}

main().catch((error) => {
  console.error(`[verify-panel-render] ${error.stack || error.message}`);
  process.exitCode = 1;
});
