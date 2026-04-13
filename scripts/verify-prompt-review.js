#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyLegacyReviewContract();
  verifyPromptTellingV2Contract();
  await verifyLegacyClientCompatibility();
  await verifyPromptTellingV2ClientOptIn();
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

async function verifyLegacyClientCompatibility() {
  const harness = createPromptReviewHarness({
    runtimeResponse: {
      checks: [
        { feedback: "배경이 부족합니다.", id: "context", label: "맥락", status: "missing" },
        { feedback: "목표는 비교적 명확합니다.", id: "goal", label: "목표", status: "good" },
        { feedback: "제약을 조금 더 보강해 주세요.", id: "constraints", label: "제약", status: "partial" },
        { feedback: "출력 형식을 지정해 주세요.", id: "output", label: "산출물 형식", status: "partial" },
      ],
      quickImprovements: ["대상 독자를 먼저 적어 주세요."],
      refinedPrompt: "상황과 목표를 정리해 주세요.",
      summary: "배경과 형식이 부족합니다.",
      totalScore: 61,
      verdict: "revise",
    },
    version: "0.4.4",
  });

  harness.manager.handleAction("review-composer");
  await flushAsyncWork();

  const message = harness.runtimeMessages[0];
  const viewState = harness.manager.buildViewState();
  const html = harness.context.InovaBookmarks.promptReviewView.render(viewState);

  assert.equal(Object.prototype.hasOwnProperty.call(message, "reviewProfile"), false);
  assert.equal(viewState.result.sections.length, 0);
  assert.equal(html.includes("핵심 구조 (PRO)"), false);
  assert.equal(html.includes("배경/대상/상황"), true);
}

async function verifyPromptTellingV2ClientOptIn() {
  const harness = createPromptReviewHarness({
    runtimeResponse: {
      checks: [
        { feedback: "역할은 잘 정의됐습니다.", group: "core", id: "persona", label: "역할 지정", status: "good" },
        { feedback: "참고 자료를 붙여 주세요.", group: "core", id: "reference", label: "참고 자료", status: "missing" },
        { feedback: "목표는 비교적 분명합니다.", group: "core", id: "objective", label: "목표 설정", status: "good" },
        { feedback: "결과 형식을 더 선명히 적어 주세요.", group: "refinement", id: "mode", label: "결과 형식", status: "partial" },
        { feedback: "타깃 관점이 없습니다.", group: "refinement", id: "pointOfView", label: "타깃 관점", status: "missing" },
        { feedback: "말투를 지정해 주세요.", group: "refinement", id: "tone", label: "말투", status: "partial" },
      ],
      quickImprovements: ["참고 자료 링크를 넣어 주세요.", "타깃 독자를 써 주세요."],
      refinedPrompt: "당신은 [역할]입니다.\n[참고 자료]를 참고해\n[목표]를 달성할 수 있도록\n[결과 형식]으로 작성해 주세요.\n[타깃 관점] 기준으로\n[말투]를 유지해 주세요.",
      summary: "참고 자료와 타깃 관점을 먼저 채워 주세요.",
      totalScore: 50,
      verdict: "revise",
    },
    version: "0.4.5",
  });

  harness.manager.handleAction("review-composer");
  await flushAsyncWork();

  const message = harness.runtimeMessages[0];
  const viewState = harness.manager.buildViewState();
  const html = harness.context.InovaBookmarks.promptReviewView.render(viewState);

  assert.equal(message.reviewProfile, "prompt-telling-v2");
  assert.deepEqual(
    viewState.result.sections.map((section) => section.label),
    ["핵심 구조 (PRO)", "정교화 요소 (MPT)"]
  );
  assert.equal(viewState.result.totalScoreLabel, "50점");
  assert.equal(html.includes("핵심 구조 (PRO)"), true);
  assert.equal(html.includes("정교화 요소 (MPT)"), true);
  assert.equal(html.includes("PRO"), true);
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
  loadScript("backup/legacy-panel/prompt-review-view.js", context);

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
