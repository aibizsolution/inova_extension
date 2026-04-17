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
const { verifyConversationContextMeterContract } = require("./verify-conversation-context-meter");
const { verifyConversationFocusContract } = require("./verify-conversation-focus");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyPanelHostRuntimeContract();
  verifyPanelRuntimeResolverOwnershipContract();
  verifyHostedPanelImeCompositionGuard();
  verifyHostedMeetingActionCompletionTraceContract();
  verifyHostedStartupStatusCardDelayContract();
  verifyHostedPanelChromeSyncContract();
  verifyHostedNormalizeTextUsesPanelUtils();
  verifyHostedMeetingSummarySyncContract();
  verifyHostedMeetingSnapshotSyncGuardContract();
  verifyHostedMeetingVisibilityRecoveryContract();
  verifyHostedPromptTabOwnershipContract();
  verifyHostedPromptActionOwnershipContract();
  verifyHostedTraceVisibilityContract();
  verifyHostedConversationSearchDebounceContract();
  await verifyHostedConversationCapabilityGates();
  verifyConversationContextMeterContract();
  await verifyConversationFocusContract();
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
  const meetingControllerSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "meeting-hub-controller.js"),
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
    !hostedPanelSource.includes("syncTopPanelSummary")
      && !hostedPanelSource.includes('syncToolSummary("meeting"'),
    "hosted meeting hub should not sync hosted-owned counts back through the top panel"
  );
  assert(
    !bridgeRequestSource.includes('if (action === "tool-summary-sync")'),
    "top panel bridge should not accept removed hosted meeting summary sync requests"
  );
  assert(
    !bootstrapSource.includes("onToolSummarySync")
      && !bootstrapSource.includes("handlePanelToolSummarySync"),
    "panel bootstrap should not forward hosted meeting summary sync callbacks into the top-panel bridge"
  );
  assert(
    !meetingControllerSource.includes("syncTopPanelSummary")
      && !meetingControllerSource.includes("emitTopPanelSummary"),
    "hosted meeting controller should keep count state local instead of echoing it through extension"
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
  assert(
    hostedPanelSource.includes("function normalizePanelSnapshot(panel)"),
    "hosted panel should normalize incoming raw panel snapshots before rendering"
  );
  assert(
    hostedPanelSource.includes("activeTool: normalizeHostedToolId(nextPanel.activeTool || uiPreferences.activeTool),"),
    "hosted panel should derive activeTool from snapshot uiPreferences when the top panel no longer sends it as a view field"
  );
}

function verifyHostedNormalizeTextUsesPanelUtils() {
  [
    "base-firestore-client.js",
    "conversation-controller.js",
    "extension-capability-client.js",
    "index.js",
    "meeting-firestore-client.js",
    "meeting-hub-controller.js",
    "panel-firestore-session-client.js",
    "panel-utils.js",
    "prompt-library-controller.js",
    "prompt-library-firestore-client.js",
    "prompt-library-model.js",
    "prompt-review-controller.js",
    "prompt-store-controller.js",
    "prompt-store-firestore-client.js",
    "release-controller.js",
  ].forEach((fileName) => {
    const source = fs.readFileSync(
      path.join(root, "hosting", "extension-v2", "panel", fileName),
      "utf8"
    );
    assert(
      !source.includes("namespace.panelUtils?.normalizeText")
        && !source.includes("namespace.session?.normalizeText")
        && !source.includes('String(value ?? "").trim()'),
      `${fileName} should use the shared hosted/session normalizeText contract instead of redefining the fallback`
    );
  });
}

function verifyHostedPanelChromeSyncContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "hosted-panel-bridge.js"),
    "utf8"
  );
  const shellBridgeSource = fs.readFileSync(
    path.join(root, "content", "panel-v2-shell-bridge.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("function syncPanelChromeIfNeeded(chromeState = {})"),
    "hosted panel should own top panel chrome sync decisions"
  );
  assert(
    hostedPanelSource.includes('action: "panel-chrome-sync"'),
    "hosted panel should send handle count updates through panel-chrome-sync"
  );
  assert(
    hostedPanelSource.includes("handleCount: effectiveToolCount"),
    "hosted panel should sync the effective active tool count to the top handle"
  );
  assert(
    hostedPanelSource.includes("open: panelState.open")
      && hostedPanelSource.includes("function setHostedPanelOpen(nextOpen)")
      && hostedPanelSource.includes("function buildEffectivePanelState(panelSnapshot)"),
    "hosted panel should own panel open state and sync it to the top host chrome"
  );
  assert(
    hostedPanelSource.includes('persistHostedUiPreferences({ panelOpen: open === true }, "panel-open")')
      && !hostedPanelSource.includes("persistOpen"),
    "hosted panel should persist open through hosted-owned uiPreferences instead of content chrome sync persistence"
  );
  assert(
    hostedPanelSource.includes("if (!panelSnapshot || state.panelOpenHydrated)")
      && !hostedPanelSource.includes("panelSnapshot.visible === true"),
    "hosted panel should accept content snapshot open only as the initial hydration seed"
  );
  assert(
    hostedPanelSource.includes('action === "external-toggle"'),
    "hosted panel should own external handle toggle events instead of letting content calculate open state"
  );
  assert(
    bridgeRequestSource.includes('if (action === "panel-chrome-sync")'),
    "top panel bridge should accept hosted panel chrome sync requests"
  );
  assert(
    !bridgeRequestSource.includes("persistOpen"),
    "top panel bridge should not carry panel open persistence flags after hosted owns uiPreferences persistence"
  );
  assert(
    shellBridgeSource.includes("onPanelChromeSync(chromeState)"),
    "v2 shell bridge should expose a compact panel chrome sync callback"
  );
  assert(
    !shellBridgeSource.includes("buildHandleCount"),
    "v2 shell bridge should not keep hosted-owned handle count calculation"
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
  assert(
    !conversationControllerSource.includes("SNAPSHOT_REFRESH_INTERVAL_MS = 10000"),
    "hosted conversation controller should not keep the old 10s snapshot refresh throttle"
  );
  assert(
    conversationControllerSource.includes("SNAPSHOT_REFRESH_DEBOUNCE_MS = 120"),
    "hosted conversation controller should coalesce snapshot changes through a short debounce"
  );
  assert(
    conversationControllerSource.includes("pendingRefreshAfterLoad: false"),
    "hosted conversation controller should track a queued refresh while a snapshot read is in flight"
  );
  assert(
    conversationControllerSource.includes("state.pendingRefreshAfterLoad = true;"),
    "hosted conversation controller should queue a follow-up read instead of dropping snapshot changes during an active load"
  );
}

async function verifyHostedConversationCapabilityGates() {
  const pageCalls = [];
  const context = vm.createContext({
    clearTimeout() {},
    console,
    document: {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
    },
    globalThis: null,
    setTimeout(callback) {
      if (typeof callback === "function") {
        void Promise.resolve().then(callback);
      }
      return 1;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      clipPreview(value) {
        return String(value ?? "");
      },
      normalizeText(value) {
        return String(value ?? "").trim();
      },
    },
  };
  loadHostedPanelScript("panel-utils.js", context);
  loadHostedPanelScript("conversation-dom-parser.js", context);
  loadHostedPanelScript("conversation-controller.js", context);
  loadHostedPanelScript("bookmark-view.js", context);

  const controller = context.InovaBookmarks.conversationController.create({
    browserCapabilities: {
      async jumpConversationItem(bookmarkId) {
        pageCalls.push({ action: "conversation.jump-item", bookmarkId });
        return { jumped: true };
      },
      async readConversationState() {
        pageCalls.push({ action: "conversation.read-state" });
        return {
          items: [
            {
              id: "q1",
              normalizedText: "hello",
              order: 1,
              text: "Hello",
              tokenEstimate: {
                answer: 34,
                hasAnswer: true,
                question: 2,
                total: 36,
              },
            },
          ],
          tokenEstimate: {
            answer: 34,
            basis: "dom-estimate-v1",
            messageCount: 2,
            modelLabel: "OpenAI: GPT-5.4",
            modelLabelSource: "selected-model",
            question: 2,
            total: 36,
            visibleMessageCount: 2,
          },
          visibleMessageId: "q1",
        };
      },
      async readConversationDomSnapshot() {
        pageCalls.push({ action: "conversation.read-dom-snapshot" });
        return {
          articles: [
            {
              id: "q1",
              order: 1,
              roleHint: "user",
              text: "Hello",
            },
            {
              firstChildAriaLabel: "OpenAI: GPT-5.4",
              id: "a1",
              order: 2,
              text: "OpenAI: GPT-5.4 response",
            },
          ],
          basis: "conversation-dom-snapshot-v1",
          conversation: {
            articleCount: 2,
            hasChatLog: true,
            hasComposer: true,
          },
          modelCandidates: [
            { label: "OpenAI: GPT-5.4", text: "OpenAI: GPT-5.4" },
          ],
          sessionId: "session-1",
          sessionTitle: "현재 세션",
          visibleMessageId: "q1",
        };
      },
      async writeClipboardText(text) {
        pageCalls.push({ action: "clipboard.write-text", text });
        return { copied: true };
      },
    },
    scheduleRender() {},
    traceConversation() {},
  });
  const panelState = {
    activeTool: "bookmarks",
    bookmarksTool: {
      count: 1,
      snapshotFingerprint: "q1|1",
    },
  };

  controller.syncPanelState(panelState, ["page.adapter.v2"]);
  await flushMicrotasks();
  let viewState = controller.buildViewState({});
  assert.equal(viewState.count, 0, "conversation view should not expose stale items when read capability is missing");
  assert.equal(viewState.canJumpBookmark, false, "conversation jump should be disabled when jump capability is missing");
  assert.equal(viewState.canCopyBookmark, false, "conversation copy should be disabled when clipboard capability is missing");
  assert.match(viewState.capabilityError, /대화 읽기 기능이 현재 비활성화/);
  assert.deepEqual(pageCalls, [], "conversation controller should not call page adapter when read capability is missing");

  const gatedMarkup = context.InovaBookmarks.bookmarkView.renderTool({
    canCopyBookmark: false,
    canJumpBookmark: false,
    capabilityError: "대화 이동/복사 기능이 현재 비활성화되어 있어요.",
    emptyText: "",
    items: [
      {
        id: "q1",
        order: 1,
        text: "Hello",
      },
    ],
    query: "",
  });
  assert(!gatedMarkup.includes('data-bookmark-id="q1"'), "bookmark view should hide jump targets when jump capability is missing");
  assert(!gatedMarkup.includes('data-copy-bookmark-id="q1"'), "bookmark view should hide copy targets when clipboard capability is missing");
  assert(gatedMarkup.includes("대화 이동/복사 기능이 현재 비활성화"), "bookmark view should render capability-disabled copy/jump reason");

  controller.syncPanelState(panelState, [
    "page.adapter.v2",
    "page.clipboard.write-text",
    "page.conversation.jump-item",
    "page.conversation.read-dom-snapshot",
    "page.conversation.read-state",
  ]);
  await flushMicrotasks();
  viewState = controller.buildViewState({});
  assert.equal(viewState.count, 1, "conversation view should load items when read capability is negotiated");
  assert.equal(viewState.tokenEstimate.total, 4, "conversation view should expose hosted parser estimates from the DOM snapshot");
  assert.equal(viewState.tokenEstimate.modelLabel, "OpenAI: GPT-5.4", "conversation view should preserve the selected model label from the page snapshot");
  assert.equal(viewState.tokenEstimate.modelLabelSource, "selected-model", "conversation view should preserve the selected model label source");
  assert.equal(viewState.canJumpBookmark, true);
  assert.equal(viewState.canCopyBookmark, true);
  const tokenMarkup = context.InovaBookmarks.bookmarkView.renderTool(viewState);
  assert(tokenMarkup.includes("예상 컨텍스트"), "bookmark view should render a conversation context meter when estimates are available");
  assert(tokenMarkup.includes("inova-context-help"), "bookmark view should render the context explanation in a help tooltip");
  assert(tokenMarkup.includes("inova-token-meter__gauge"), "bookmark view should render a compact context length signal");
  assert(!tokenMarkup.includes("현재 DOM 기준"), "bookmark view should keep DOM-basis explanation inside the tooltip instead of inline copy");
  assert(tokenMarkup.includes("bookmark-context-meta"), "bookmark view should render compact per-bookmark context estimates");
  assert(!tokenMarkup.includes("Q 2"), "bookmark view should not add a visible Q/A metadata row to each bookmark");
  assert.equal(await controller.handleJumpBookmark("q1"), true);
  assert.equal(await controller.handleCopyBookmark("q1"), true);
  assert.deepEqual(pageCalls.map((call) => call.action), [
    "conversation.read-dom-snapshot",
    "conversation.jump-item",
    "clipboard.write-text",
  ]);
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
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
  const promptToolPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-tool-panel.js"),
    "utf8"
  );

  assert(
    hostedBookmarkSource.includes('<div class="bookmark-jump"${canJumpBookmark ?')
      && hostedBookmarkSource.includes('data-bookmark-id="${escapeHtml(bookmark.id)}"'),
    "hosted bookmark list should render a non-focusable bookmark jump container"
  );
  assert(
    !hostedBookmarkSource.includes('class="bookmark-jump" type="button"'),
    "hosted bookmark list should not render a hidden/focusable bookmark jump button"
  );
  assert(
    hostedBookmarkSource.includes("bookmark-context-meta")
      && !hostedBookmarkSource.includes("bookmark-content"),
    "hosted bookmark list should keep per-bookmark context metadata compact instead of adding a third visual row"
  );
  assert(
    hostedPanelSource.includes("conversation-context-profiles.json")
      && hostedBookmarkSource.includes("contextProfileConfig")
      && !hostedBookmarkSource.includes("MODEL_CONTEXT_PROFILES"),
    "hosted conversation context thresholds should load from a hosted config file instead of hardcoding model limits in the view"
  );
  assert(
    hostedPanelSource.includes("event.composedPath()")
      && promptToolPanelSource.includes("event.composedPath()"),
    "hosted click delegation should resolve SVG icon click targets through composedPath before checking data attributes"
  );
}

function verifyHostedPromptReviewFallbackContract() {
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );
  const promptToolViewSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-tool-view.js"),
    "utf8"
  );

  assert(
    hostedPanelSource.includes("const reviewState = resolveEffectivePromptReviewState(snapshotReviewState, hostedReviewState);"),
    "hosted prompt tool should merge snapshot review state before rendering the review tab"
  );
  assert(
    hostedPanelSource.includes("const storeState = promptStoreController?.buildViewState"),
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
  assert(
    !promptToolViewSource.includes("다음 단계에서 이 탭의 hosted ownership을 이동합니다."),
    "active hosted prompt tool view should stop rendering next-stage placeholder fallback copy once store/review tabs are hosted"
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
    !hostedPanelSource.includes("syncTopPanelSummary")
      && !hostedPanelSource.includes('syncToolSummary("release"'),
    "hosted release controller should not sync hosted-owned counts back through the top panel"
  );
  assert(
    !hostedPanelSource.includes('action: "release-action"'),
    "v2 hosted release actions should not fall back to the top-panel release-action request path"
  );
  assert(
    !releaseControllerSource.includes("emitTopPanelSummary")
      && !releaseControllerSource.includes("syncTopPanelSummary"),
    "hosted release controller should keep release summary state local"
  );
  assert(
    !bridgeRequestSource.includes('if (action === "tool-summary-sync")'),
    "top panel bridge should not accept removed hosted release summary sync requests"
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

  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "panel-utils.js"), "utf8"),
    {
      filename: "hosting/extension-v2/panel/panel-utils.js",
    }
  ).runInContext(context);
  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "extension-capability-client.js"), "utf8"),
    {
      filename: "hosting/extension-v2/panel/extension-capability-client.js",
    }
  ).runInContext(context);
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
    ["runtime.invoke.v1", "release.download.open"]
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

  assert.deepEqual(
    runtimeCalls.map((call) => [call.action, call.capabilityId, call.input]),
    [
      ["capabilities.invoke", "release.download.open", {
        fileName: "latest.zip",
        templateKey: "release.download",
      }],
    ],
    "hosted release should request download through the release capability without passing a raw URL"
  );
}

function loadHostedPanelScript(fileName, context) {
  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", fileName), "utf8"),
    {
      filename: `hosting/extension-v2/panel/${fileName}`,
    }
  ).runInContext(context);
}

async function flushMicrotasks(turns = 5) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

main().catch((error) => {
  console.error(`[verify-panel-render] ${error.stack || error.message}`);
  process.exitCode = 1;
});
