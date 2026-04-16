#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyLegacyReviewContract();
  verifyPromptTellingV2Contract();
  verifyHostedPromptReviewContract();
  await verifyHostedPromptReviewRerunBehavior();
  await verifyExtensionReviewHandoff();
  console.log("[verify-prompt-review] Prompt review contract passed");
}

function verifyLegacyReviewContract() {
  const helpers = loadPromptReviewServiceHelpers();
  const legacyProfile = helpers.REVIEW_PROFILES.LEGACY_V1;
  const legacySchema = helpers.buildReviewSchema(helpers.getReviewProfileConfig(legacyProfile));
  const normalized = helpers.normalizeReviewResult(
    {
      checks: [
        { feedback: "형식을 더 분명히 적어 주세요.", id: "output", label: "산출물 형식", status: "partial" },
        { feedback: "현재 상황을 더 알려 주세요.", id: "context", label: "맥락", status: "missing" },
        { feedback: "원하는 결과는 잘 드러나요.", id: "goal", label: "목표", status: "good" },
        { feedback: "제약 조건을 조금 더 구체화해 주세요.", id: "constraints", label: "제약", status: "partial" },
      ],
      quickImprovements: ["현재 상황을 먼저 적어 주세요."],
      refinedPrompt: "정리해 주세요.",
      summary: "맥락이 부족해요.",
      totalScore: 82,
      verdict: "revise",
    },
    "정리해 줘",
    legacyProfile
  );

  assert.equal(helpers.normalizeReviewProfile(""), legacyProfile);
  assert.equal(legacySchema.required.includes("totalScore"), true);
  assert.deepEqual(
    normalized.checks.map((check) => check.id),
    ["context", "goal", "constraints", "output"]
  );
  assert.equal(normalized.checks.some((check) => Object.hasOwn(check, "group")), false);
  assert.equal(normalized.totalScore, 82);
}

function verifyPromptTellingV2Contract() {
  const helpers = loadPromptReviewServiceHelpers();
  const v2Profile = helpers.REVIEW_PROFILES.PROMPT_TELLING_V2;
  const v2Schema = helpers.buildReviewSchema(helpers.getReviewProfileConfig(v2Profile));
  const normalized = helpers.normalizeReviewResult(
    {
      checks: [
        { feedback: "목표는 비교적 분명합니다.", id: "objective", label: "목표 설정", status: "good" },
        { feedback: "말투를 더 분명히 적어 주세요.", id: "tone", label: "말투", status: "missing" },
        { feedback: "결과 형식은 일부만 보입니다.", id: "mode", label: "결과 형식", status: "partial" },
        { feedback: "참고 자료가 부족합니다.", id: "reference", label: "참고 자료", status: "partial" },
        { feedback: "타깃 관점이 없습니다.", id: "pointOfView", label: "타깃 관점", status: "missing" },
        { feedback: "역할은 잘 설정됐습니다.", id: "persona", label: "역할 지정", status: "good" },
      ],
      quickImprovements: ["역할을 먼저 적어 주세요.", "참고 예시를 붙여 주세요.", "타깃 관점을 써 주세요.", "말투를 써 주세요.", "초과 항목"],
      refinedPrompt: "당신은 [역할]입니다.",
      summary: "참고 자료와 타깃 관점을 보완해 주세요.",
      verdict: "revise",
    },
    "카피를 써 줘",
    v2Profile
  );

  assert.equal(v2Schema.required.includes("totalScore"), false);
  assert.deepEqual(
    normalized.checks.map((check) => check.id),
    ["persona", "reference", "objective", "mode", "pointOfView", "tone"]
  );
  assert.deepEqual(
    normalized.checks.map((check) => check.group),
    ["core", "core", "core", "refinement", "refinement", "refinement"]
  );
  assert.equal(normalized.totalScore, 63);
  assert.deepEqual(normalized.quickImprovements.length, 4);
}

async function verifyExtensionReviewHandoff() {
  const harness = createPromptReviewHarness({
    version: "1.0.0",
  });

  harness.manager.handleAction("activate-review");
  await flushAsyncWork();

  const viewState = harness.manager.buildViewState();
  assert.deepEqual(harness.manager.buildReviewSignalState(), { requestId: 1 });
  assert.equal(harness.runtimeMessages.length, 0);
  assert.equal("activeTool" in harness.state, false);
  assert.equal(harness.state.uiPreferences.activePromptTab, "library");
  assert.equal(viewState.available, true);
  assert.equal(viewState.hasText, true);
  assert.equal("pending" in viewState, false);
  assert.equal("result" in viewState, false);
}

function verifyHostedPromptReviewContract() {
  const hostedControllerSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "prompt-review-controller.js"), "utf8");
  const hostedReviewViewSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "prompt-review-view.js"), "utf8");
  const capabilityClientSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "extension-capability-client.js"), "utf8");
  const hostedIndexSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "index.js"), "utf8");
  const panelTraceSource = fs.readFileSync(path.join(root, "content", "panel-console-trace.js"), "utf8");
  const topPanelSource = fs.readFileSync(path.join(root, "content", "panel.js"), "utf8");
  const compositionSource = fs.readFileSync(path.join(root, "content", "panel-v2-composition-controller.js"), "utf8");
  const composerReviewFloatSource = fs.readFileSync(path.join(root, "content", "features", "prompt-review", "composer-review-float.js"), "utf8");
  const shellBridgeSource = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  const promptShellControllerSource = fs.readFileSync(path.join(root, "content", "panel-v2-prompt-controller.js"), "utf8");
  const promptReviewManagerSource = fs.readFileSync(path.join(root, "content", "features", "prompt-review", "prompt-review-manager.js"), "utf8");

  assert.equal(
    hostedControllerSource.includes("const writeClipboardText = typeof browserCapabilities.writeClipboardText === \"function\"")
      && capabilityClientSource.includes('invokePageCapability("clipboard.write-text"'),
    true,
    "hosted prompt review copy should delegate through the hosted capability client and the stable top page clipboard.write-text capability"
  );
  assert.equal(
    hostedControllerSource.includes('traceReview("54.hosted.review.request.start"'),
    true,
    "hosted prompt review should trace review request start"
  );
  assert.equal(
    hostedControllerSource.includes('traceReview("58.hosted.review.copy.start"'),
    true,
    "hosted prompt review should trace copy start"
  );
  assert.equal(
    hostedControllerSource.includes("handleExternalReviewActivation(panelState?.promptTool?.review);"),
    true,
    "hosted prompt review should react to external review handoff signals from the top snapshot"
  );
  assert.equal(
    hostedControllerSource.includes('traceReview("52.hosted.review.external-activation"'),
    true,
    "hosted prompt review should trace external review activations"
  );
  assert.equal(
    !hostedControllerSource.includes("hydrateFromSnapshotReviewState"),
    true,
    "hosted prompt review should stop hydrating result/open state out of the top snapshot"
  );
  assert.equal(
    hostedIndexSource.includes("promptReviewController?.consumeEscape?.()"),
    true,
    "hosted panel should let the hosted prompt review controller consume Escape before delegating to the top panel"
  );
  assert.equal(
    hostedIndexSource.includes("return callbacks.onToggle(false);")
      && hostedIndexSource.includes("function setHostedPanelOpen(nextOpen)")
      && !hostedIndexSource.includes('action: "escape"'),
    true,
    "hosted panel should close through hosted-owned panel open state after hosted review declines Escape, not through a separate content escape action"
  );
  assert.equal(
    hostedIndexSource.includes("traceReview: traceReviewFlow"),
    true,
    "hosted panel should wire review tracing into prompt review controller"
  );
  assert.equal(
    panelTraceSource.includes('"hosted.review.request.start"'),
    true,
    "top panel should keep hosted review request traces visible"
  );
  assert.equal(
    !shellBridgeSource.includes("panelTrace"),
    true,
    "v2 shell bridge should stop shaping a hosted-owned panelTrace payload"
  );
  assert.equal(
    panelTraceSource.includes('reviewOpen: activeTool === "prompts" && activePromptTab === "review"'),
    true,
    "top panel trace helper should derive prompt review visibility from snapshot uiPreferences instead of snapshot review state"
  );
  assert.equal(
    panelTraceSource.includes("const activePromptTab = normalizeText(panelSnapshot?.uiPreferences?.activePromptTab);")
      && topPanelSource.includes("const traceController = panelConsoleTrace.create({"),
    true,
    "top panel trace helper should derive trace payload from the snapshot and the host should wire that helper in"
  );
  assert.equal(
    promptReviewManagerSource.includes("buildReviewSignalState"),
    true,
    "content prompt review manager should expose a minimal hosted handoff signal builder"
  );
  assert.equal(
    !promptReviewManagerSource.includes("showPromptTab")
      && !promptShellControllerSource.includes("state.activeTool = \"prompts\"")
      && !promptShellControllerSource.includes("state.open = true")
      && !promptShellControllerSource.includes("persistActiveTool")
      && !promptShellControllerSource.includes("lockUiPreferenceSelection"),
    true,
    "content prompt review handoff should publish only a requestId signal and should not mutate hosted-owned panel/tool/tab state"
  );
  assert.equal(
    !compositionSource.includes("promptReview:"),
    true,
    "v2 composition state should not keep a hosted-owned prompt review view bucket"
  );
  assert.equal(
    !promptReviewManagerSource.includes("state.promptReview"),
    true,
    "content prompt review manager should keep only a private monotonic handoff signal instead of mutating shared panel state"
  );
  assert.equal(
    !promptReviewManagerSource.includes("pending: false")
      && !promptReviewManagerSource.includes("result: null")
      && !composerReviewFloatSource.includes("state.pending")
      && !composerReviewFloatSource.includes("state.result")
      && !composerReviewFloatSource.includes("검토 중"),
    true,
    "composer review float should stay a request trigger only and should not pretend to mirror hosted pending/result state"
  );
  assert.equal(
    !promptReviewManagerSource.includes("chrome.runtime.sendMessage"),
    true,
    "content prompt review manager should stop issuing runtime review requests directly"
  );
  assert.equal(
    !promptReviewManagerSource.includes("review-runtime-timeout"),
    true,
    "content prompt review manager should no longer carry the legacy runtime timeout flow"
  );
  assert.equal(
    !promptReviewManagerSource.includes("applyReviewedPrompt"),
    true,
    "content prompt review manager should stop carrying hosted-owned apply/copy result flows"
  );
  assert.equal(
    hostedControllerSource.includes("hasCapability(PROMPT_REVIEW_RUN_CAPABILITY_ID)")
      && hostedControllerSource.includes("capability-disabled")
      && hostedReviewViewSource.includes("review.canReview"),
    true,
    "hosted prompt review should hide disabled capability execution behind the negotiated capability id gate"
  );
  assert.equal(
    !hostedReviewViewSource.includes("다시 평가 후 반영")
      && !hostedReviewViewSource.includes(">다시 평가</button>"),
    true,
    "hosted prompt review should not render stale bottom action buttons for rerun flows"
  );
  assert.equal(
    hostedControllerSource.includes("reason: \"same-text\"")
      && hostedControllerSource.includes("이미 같은 내용으로 검토했어요."),
    true,
    "hosted prompt review should toast instead of re-running when the composer text matches the last reviewed text"
  );
}

async function verifyHostedPromptReviewRerunBehavior() {
  let composerText = "초기 프롬프트";
  const reviewCalls = [];
  const toasts = [];
  const context = vm.createContext({
    clearTimeout,
    console,
    globalThis: null,
    setTimeout,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    panelUtils: {
      normalizeText(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim();
      },
      resolveBrowserCapabilities(options = {}) {
        return options.browserCapabilities || {};
      },
    },
  };
  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "prompt-review-controller.js"), "utf8"),
    { filename: "hosting/extension-v2/panel/prompt-review-controller.js" }
  ).runInContext(context);
  const controller = context.InovaBookmarks.promptReviewController.create({
    browserCapabilities: {
      async applyComposerText() {
        return { applied: true };
      },
      async invokeCapability(_capabilityId, body) {
        reviewCalls.push(body);
        return {
          checks: [],
          quickImprovements: ["보완"],
          refinedPrompt: `${body.prompt} 보완`,
          summary: "요약",
          totalScore: 75,
        };
      },
      async readComposerState() {
        return { available: true, text: composerText };
      },
      async writeClipboardText() {
        return { copied: true };
      },
    },
    getProviderIdentity: () => ({ available: true, providerUserKey: "user-1" }),
    getRuntimeVersion: () => "1.0.0",
    publishToast: (toast) => {
      toasts.push(toast);
      return true;
    },
    scheduleRender() {},
    setActivePromptTab: async () => true,
    traceReview() {},
  });
  controller.syncPanelState({ activeTool: "prompts" }, ["prompt.review.run"]);

  await controller.handlePromptAction("activate-review");
  assert.equal(reviewCalls.length, 1, "first review activation should run the prompt review capability");
  assert.equal(reviewCalls[0].prompt, "초기 프롬프트");

  composerText = "수정된 프롬프트";
  await controller.handlePromptAction("activate-review");
  assert.equal(reviewCalls.length, 2, "changed composer text should re-run review immediately");
  assert.equal(reviewCalls[1].prompt, "수정된 프롬프트");

  await controller.handlePromptAction("activate-review");
  assert.equal(reviewCalls.length, 2, "same composer text should not re-run review");
  assert.equal(
    toasts.at(-1)?.message,
    "이미 같은 내용으로 검토했어요.",
    "same composer text should show a toast"
  );
}

function createPromptReviewHarness(options = {}) {
  const runtimeMessages = [];
  const renderCalls = [];
  const version = String(options.version || "0.4.4");
  const context = vm.createContext({
    chrome: {
      runtime: {
        getManifest() {
          return { version };
        },
        async sendMessage(message) {
          runtimeMessages.push(cloneValue(message));
          return {
            data: cloneValue(options.runtimeResponse || {}),
            ok: true,
          };
        },
      },
    },
    clearTimeout,
    console,
    globalThis: null,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    setTimeout,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    composer: {
      applyPromptText() {
        return true;
      },
      getComposerState() {
        return {
          available: true,
          text: "광고 카피를 작성해 줘",
        };
      },
    },
    constants: { defaults: {} },
    panelDebug: {
      log() {},
    },
    providerIdentity: {
      getCurrent() {
        return {
          available: true,
          providerUserKey: "fixture-user",
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value ?? "")
          .replace(/\s+/g, " ")
          .trim();
      },
    },
  };

  loadScript("content/features/prompt-review/prompt-review-manager.js", context);

  const state = {
    sessionId: "session-1",
    uiPreferences: {
      activePromptTab: "library",
      activeTool: "bookmarks",
    },
  };

  return {
    context,
    manager: context.InovaBookmarks.promptReviewManager.create(state, {
      render() {
        renderCalls.push(true);
      },
    }),
    renderCalls,
    runtimeMessages,
    state,
  };
}

function loadPromptReviewServiceHelpers() {
  const relativePath = path.join("functions", "features", "prompt-review", "prompt-review-service.js");
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const module = { exports: {} };
  const context = vm.createContext({
    console,
    exports: module.exports,
    module,
    require(name) {
      if (name === "firebase-admin/firestore") {
        return {
          FieldValue: {
            serverTimestamp() {
              return { __type: "serverTimestamp" };
            },
          },
        };
      }
      if (name === "openai") {
        return class FakeOpenAI {};
      }
      return require(name);
    },
  });
  new vm.Script(source, { filename: relativePath }).runInContext(context);
  return module.exports.__test__;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

main().catch((error) => {
  console.error(`[verify-prompt-review] ${error.stack || error.message}`);
  process.exitCode = 1;
});
