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
  assert.deepEqual(harness.showPromptTabs, ["review"]);
  assert.deepEqual(harness.manager.buildReviewSignalState(), { requestId: 1 });
  assert.equal(harness.runtimeMessages.length, 0);
  assert.equal(viewState.available, true);
  assert.equal(viewState.hasText, true);
  assert.equal(viewState.pending, false);
  assert.equal(viewState.result, null);
}

function verifyHostedPromptReviewContract() {
  const hostedControllerSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "prompt-review-controller.js"), "utf8");
  const hostedIndexSource = fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", "index.js"), "utf8");
  const panelTraceSource = fs.readFileSync(path.join(root, "content", "panel-console-trace.js"), "utf8");
  const topPanelSource = fs.readFileSync(path.join(root, "content", "panel.js"), "utf8");
  const shellBridgeSource = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  const promptReviewManagerSource = fs.readFileSync(path.join(root, "content", "features", "prompt-review", "prompt-review-manager.js"), "utf8");

  assert.equal(
    hostedControllerSource.includes('action: "clipboard.write-text"'),
    true,
    "hosted prompt review copy should delegate through the stable top page clipboard.write-text capability"
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
    shellBridgeSource.includes("const panelTrace = buildPanelTracePayload({"),
    true,
    "v2 shell bridge should build a dedicated panelTrace payload for top panel snapshot tracing"
  );
  assert.equal(
    shellBridgeSource.includes('reviewOpen: activeTool === "prompts" && promptTab === "review"'),
    true,
    "v2 shell bridge should derive prompt review visibility from prompt tab selection instead of snapshot review state"
  );
  assert.equal(
    panelTraceSource.includes('const panelTrace = state?.panelTrace && typeof state.panelTrace === "object"')
      && topPanelSource.includes("const traceController = panelConsoleTrace.create({"),
    true,
    "top panel trace helper should consume the prebuilt panelTrace payload and the host should wire that helper in"
  );
  assert.equal(
    promptReviewManagerSource.includes("buildReviewSignalState"),
    true,
    "content prompt review manager should expose a minimal hosted handoff signal builder"
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
}

function createPromptReviewHarness(options = {}) {
  const runtimeMessages = [];
  const renderCalls = [];
  const showPromptTabs = [];
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
    constants: {
      defaults: {
        promptReview: {
          copyState: "idle",
          error: "",
          lastReviewedAt: "",
          open: false,
          pending: false,
          placeholderConfirmation: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        },
      },
    },
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
    promptReview: {
      copyState: "idle",
      error: "",
      lastReviewedAt: "",
      open: false,
      pending: false,
      placeholderConfirmation: false,
      requestId: 0,
      result: null,
      reviewedText: "",
    },
    sessionId: "session-1",
  };

  return {
    context,
    manager: context.InovaBookmarks.promptReviewManager.create(state, {
      render() {
        renderCalls.push(true);
      },
      showPromptTab(promptTabId) {
        showPromptTabs.push(promptTabId);
      },
    }),
    renderCalls,
    runtimeMessages,
    showPromptTabs,
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
