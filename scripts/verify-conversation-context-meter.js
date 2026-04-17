const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function verifyConversationContextMeterContract() {
  const context = createHostedPanelContext();
  loadHostedPanelScript("panel-utils.js", context);
  loadHostedPanelScript("conversation-controller.js", context);
  loadHostedPanelScript("bookmark-view.js", context);

  const contextProfileConfig = {
    ...JSON.parse(fs.readFileSync(
      path.join(root, "hosting", "extension-v2", "panel", "conversation-context-profiles.json"),
      "utf8"
    )),
    loaded: true,
  };
  const profileById = new Map(contextProfileConfig.profiles.map((profile) => [profile.id, profile]));

  assert.equal(
    profileById.get("anthropic-claude-opus-4-6")?.limit,
    200000,
    "Claude Opus 4.6 should use the conservative 200K gauge baseline until i-Nova confirms extended context is automatic"
  );
  assert.equal(
    profileById.get("anthropic-claude-opus-4-6")?.extendedLimit,
    1000000,
    "Claude Opus 4.6 should keep the documented 1M extended context as metadata instead of using it as the default gauge baseline"
  );
  assert.equal(
    profileById.get("anthropic-claude-opus-4-6")?.availability,
    "optional",
    "Claude Opus 4.6 should mark 1M as optional/conditional for conservative UI signaling"
  );
  assert.equal(
    profileById.get("anthropic-claude-sonnet-4-6")?.limit,
    200000,
    "Claude Sonnet 4.6 should use the conservative 200K gauge baseline until i-Nova confirms extended context is automatic"
  );
  assert.equal(
    profileById.get("perplexity-sonar-pro")?.limit,
    200000,
    "Perplexity Sonar Pro should keep its official 200K context profile"
  );
  assert.equal(
    contextProfileConfig.defaultProfile?.limit,
    128000,
    "128K should remain a fallback only when the selected model label is missing or unmatched"
  );

  const viewState = {
    canCopyBookmark: true,
    canJumpBookmark: true,
    contextProfileConfig,
    emptyText: "",
    items: [
      {
        id: "q1",
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
    query: "",
  };

  const normalFrontierMarkup = context.InovaBookmarks.bookmarkView.renderTool({
    ...viewState,
    tokenEstimate: {
      answer: 52000,
      modelLabel: "OpenAI: GPT-5.4",
      modelLabelSource: "selected-model",
      question: 9000,
      total: 61000,
    },
  });
  assert(
    normalFrontierMarkup.includes("보통"),
    "bookmark view should use the matched 1M-class OpenAI profile instead of the 128K fallback"
  );
  assert(
    normalFrontierMarkup.includes("OpenAI GPT-5.4 공식 컨텍스트 1M급"),
    "context tooltip should name the matched OpenAI context profile"
  );
  assert(
    normalFrontierMarkup.includes("inova-token-meter__gauge-fill")
      && normalFrontierMarkup.includes("inova-token-meter__gauge-marker"),
    "context meter should render a continuous gauge with threshold markers instead of four discrete blocks"
  );

  const optionalClaudeMarkup = context.InovaBookmarks.bookmarkView.renderTool({
    ...viewState,
    tokenEstimate: {
      answer: 52000,
      modelLabel: "Anthropic: Claude Opus 4.6",
      modelLabelSource: "selected-model",
      question: 9000,
      total: 61000,
    },
  });
  assert(
    optionalClaudeMarkup.includes("늘어남"),
    "optional/ambiguous extended context should use the conservative 200K baseline for the gauge"
  );
  assert(
    optionalClaudeMarkup.includes("Claude Opus 4.6 기본 기준 200K · 옵션 확장 1M급은 게이지 제외"),
    "context tooltip should disclose optional extended context without applying it to the gauge"
  );

  const growingPerplexityMarkup = context.InovaBookmarks.bookmarkView.renderTool({
    ...viewState,
    tokenEstimate: {
      answer: 52000,
      modelLabel: "Perplexity: Sonar Pro",
      modelLabelSource: "selected-model",
      question: 9000,
      total: 61000,
    },
  });
  assert(
    growingPerplexityMarkup.includes("is-growing"),
    "bookmark view should use the matched 200K Perplexity profile when observed context starts growing"
  );
  assert(
    growingPerplexityMarkup.includes("늘어남"),
    "bookmark view should describe growing observed context without implying a model-limit percentage"
  );
  assert(
    growingPerplexityMarkup.includes("Perplexity Sonar Pro 공식 컨텍스트 200K"),
    "context tooltip should name the matched Perplexity context profile"
  );
  assert(
    growingPerplexityMarkup.includes("모델 한도 사용률이 아니라"),
    "context tooltip should state that the gauge is not a model-limit usage ratio"
  );
  assert(!growingPerplexityMarkup.includes("%"), "context meter should not render an exact percentage");

  const fallbackContextMarkup = context.InovaBookmarks.bookmarkView.renderTool({
    ...viewState,
    tokenEstimate: {
      answer: 52000,
      question: 9000,
      total: 61000,
    },
  });
  assert(
    fallbackContextMarkup.includes("늘어남"),
    "bookmark view should only use the 128K lower-bound fallback when the selected model label is missing"
  );
  assert(
    fallbackContextMarkup.includes("제공 모델 하한 fallback 기준 128K"),
    "context tooltip should disclose the fallback context profile"
  );
}

function createHostedPanelContext() {
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
  return context;
}

function loadHostedPanelScript(fileName, context) {
  new vm.Script(
    fs.readFileSync(path.join(root, "hosting", "extension-v2", "panel", fileName), "utf8"),
    {
      filename: `hosting/extension-v2/panel/${fileName}`,
    }
  ).runInContext(context);
}

module.exports = { verifyConversationContextMeterContract };
