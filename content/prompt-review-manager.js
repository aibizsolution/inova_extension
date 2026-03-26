(function initPromptReviewManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const STATUS_LABELS = {
    good: "충족",
    missing: "부족",
    partial: "보완 필요",
  };
  const VERDICT_LABELS = {
    ready: "요건 충족",
    insufficient: "정보 보강 필요",
    revise: "보완 추천",
  };
  const CHECK_LABELS = {
    context: "배경/대상/상황",
    goal: "원하는 결과",
    constraints: "제약사항",
    output: "출력 형식",
  };

  function create(state, hooks) {
    return {
      buildViewState,
      consumeEscape,
      handleAction,
    };

    function buildViewState() {
      const composerState = namespace.composer.getComposerState();
      const currentText = namespace.session.normalizeText(composerState.text);
      const reviewedText = namespace.session.normalizeText(state.promptReview.reviewedText);
      const result = normalizeResult(state.promptReview.result);
      const stale = Boolean(result && reviewedText && reviewedText !== currentText);
      return {
        available: composerState.available,
        canApply: Boolean(result?.refinedPrompt && !state.promptReview.pending && !stale),
        error: state.promptReview.error,
        hasText: Boolean(currentText),
        lastReviewedAt: state.promptReview.lastReviewedAt,
        open: Boolean(state.promptReview.open && composerState.available),
        pending: Boolean(state.promptReview.pending),
        result,
        stale,
        textLength: currentText.length,
      };
    }

    async function handleAction(action) {
      if (action === "activate-review") return void activateReview();
      if (action === "review-composer") return void reviewComposer();
      if (action === "apply-reviewed-prompt") return void applyReviewedPrompt();
      if (action === "dismiss-review") return void dismissReview();
    }

    function consumeEscape() {
      if (!state.promptReview.open) return false;
      dismissReview();
      return true;
    }

    function activateReview() {
      hooks.showPromptTab?.("review");
      const viewState = buildViewState();
      if (viewState.result && !viewState.stale && !viewState.error) {
        updateState({ open: true });
        return;
      }
      reviewComposer();
    }

    async function reviewComposer() {
      if (state.promptReview.pending) return;
      const composerState = namespace.composer.getComposerState();
      const prompt = String(composerState.text || "").trim();
      if (!composerState.available) {
        return void updateState({
          error: "현재 화면에서 대화 입력창을 찾지 못했어요.",
          lastReviewedAt: "",
          open: true,
          pending: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
      }
      if (!namespace.session.normalizeText(prompt)) {
        return void updateState({
          error: "입력창에 프롬프트를 먼저 적어 주세요.",
          lastReviewedAt: "",
          open: true,
          pending: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
      }
      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity?.available) {
        return void updateState({
          error: "i-Nova 사용자 정보를 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요.",
          lastReviewedAt: "",
          open: true,
          pending: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
      }

      const requestId = (Number(state.promptReview.requestId) || 0) + 1;
      const sessionId = state.sessionId;
      hooks.showPromptTab?.("review");
      updateState({
        error: "",
        lastReviewedAt: "",
        open: true,
        pending: true,
        requestId,
        result: null,
        reviewedText: "",
      });
      try {
        const result = await sendRuntimeMessage("inova-review:prompt", { prompt, providerIdentity });
        if (!isActiveReviewRequest(requestId, sessionId)) {
          return;
        }
        updateState({
          error: "",
          lastReviewedAt: new Date().toISOString(),
          open: true,
          pending: false,
          requestId,
          result,
          reviewedText: prompt,
        });
      } catch (error) {
        if (!isActiveReviewRequest(requestId, sessionId)) {
          return;
        }
        updateState({
          error: getErrorMessage(error),
          open: true,
          pending: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
      }
    }

    function applyReviewedPrompt() {
      const viewState = buildViewState();
      if (viewState.pending) {
        return void updateState({ error: "프롬프트 검토가 끝난 뒤 다시 반영해 주세요." });
      }
      if (viewState.stale) {
        return void updateState({ error: "입력창 내용이 바뀌어서 이전 보완안을 바로 반영할 수 없어요. 다시 평가해 주세요." });
      }

      const refinedPrompt = String(viewState.result?.refinedPrompt || "").trim();
      if (!refinedPrompt) {
        return void updateState({ error: "반영할 보완 프롬프트가 없어요." });
      }
      if (!namespace.composer.applyPromptText(refinedPrompt, "replace")) {
        return void updateState({ error: "입력창에 보완 프롬프트를 반영하지 못했어요." });
      }
      updateState({ error: "" });
    }

    function dismissReview() {
      hooks.showPromptTab?.("library");
      updateState({
        error: "",
        open: false,
        pending: false,
        requestId: 0,
      });
    }

    function updateState(patch) {
      state.promptReview = {
        ...state.promptReview,
        ...(patch || {}),
      };
      hooks.render();
    }

    async function sendRuntimeMessage(type, payload) {
      const response = await chrome.runtime.sendMessage({ type, ...(payload || {}) });
      if (!response?.ok) {
        throw new Error(namespace.session.normalizeText(response?.error || "") || "프롬프트 평가를 처리하지 못했어요.");
      }
      return response.data;
    }

    function isActiveReviewRequest(requestId, sessionId) {
      return requestId === (Number(state.promptReview.requestId) || 0) && sessionId === state.sessionId;
    }
  }

  function normalizeResult(result) {
    if (!result || typeof result !== "object") return null;
    const verdict = normalizeEnum(result.verdict, ["ready", "revise", "insufficient"], "revise");
    return {
      checks: normalizeChecks(result.checks),
      quickImprovements: Array.isArray(result.quickImprovements) ? result.quickImprovements.filter(Boolean).map(String) : [],
      refinedPrompt: String(result.refinedPrompt || "").trim(),
      summary: String(result.summary || "").trim(),
      totalScoreLabel: `${Math.max(0, Math.min(100, Number(result.totalScore) || 0))}점`,
      verdict,
      verdictLabel: VERDICT_LABELS[verdict] || VERDICT_LABELS.revise,
    };
  }

  function normalizeChecks(checks) {
    return (Array.isArray(checks) ? checks : []).slice(0, 4).map((check) => {
      const status = normalizeEnum(check?.status, ["good", "partial", "missing"], "partial");
      const label = normalizeCheckLabel(check?.label);
      return {
        feedback: String(check?.feedback || "").trim(),
        label,
        status,
        statusLabel: STATUS_LABELS[status] || STATUS_LABELS.partial,
      };
    });
  }

  function normalizeCheckLabel(label) {
    const source = String(label || "").trim();
    const key = namespace.session.normalizeText(source).toLowerCase();
    if (key.includes("context")) return CHECK_LABELS.context;
    if (key.includes("goal")) return CHECK_LABELS.goal;
    if (key.includes("constraint")) return CHECK_LABELS.constraints;
    if (key.includes("output")) return CHECK_LABELS.output;
    return source.replace(/\s*\((context|goal|constraints?|output)\)\s*/gi, "").trim() || "검토 항목";
  }

  function normalizeEnum(value, allowed, fallback) {
    const normalized = namespace.session.normalizeText(value).toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function getErrorMessage(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
    if (message.includes("Extension context invalidated")) {
      return "확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.";
    }
    return message || "프롬프트 평가를 완료하지 못했어요.";
  }

  namespace.promptReviewManager = {
    create,
  };
})(globalThis);
