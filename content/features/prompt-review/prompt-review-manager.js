(function initPromptReviewManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PROMPT_REVIEW_PROFILE_V2 = "prompt-telling-v2";
  const PROMPT_REVIEW_V2_MIN_VERSION = "0.4.5";
  const LEGACY_SCORE_GUIDE_TEXT = "점수는 프롬프트의 핵심 정보 충족도를 보는 참고값이에요.";
  const PROMPT_TELLING_SCORE_GUIDE_TEXT = "점수는 역할 지정·참고 자료·목표 설정(PRO)을 중심으로, 결과 형식·타깃 관점·말투(MPT)를 보조로 반영한 참고값이에요.";
  const STATUS_LABELS = {
    good: "충족",
    missing: "부족",
    partial: "보완 필요",
  };
  const CHECK_DEFINITIONS = {
    constraints: { id: "constraints", label: "제약사항", order: 30 },
    context: { id: "context", label: "배경/대상/상황", order: 10 },
    goal: { id: "goal", label: "원하는 결과", order: 20 },
    mode: { group: "refinement", id: "mode", label: "결과 형식", order: 40 },
    objective: { group: "core", id: "objective", label: "목표 설정", order: 30 },
    output: { id: "output", label: "출력 형식", order: 40 },
    persona: { group: "core", id: "persona", label: "역할 지정", order: 10 },
    pointofview: { group: "refinement", id: "pointOfView", label: "타깃 관점", order: 50 },
    reference: { group: "core", id: "reference", label: "참고 자료", order: 20 },
    tone: { group: "refinement", id: "tone", label: "말투", order: 60 },
  };
  const CHECK_GROUP_DEFINITIONS = {
    core: { label: "핵심 구조 (PRO)", order: 10 },
    refinement: { label: "정교화 요소 (MPT)", order: 20 },
  };

  function create(state, hooks) {
    let copyStateTimer = 0;

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
      const requiresPlaceholderConfirm = Boolean(result?.placeholderTokens?.length);
      return {
        available: composerState.available,
        canApply: Boolean(result?.refinedPrompt && !state.promptReview.pending && !stale),
        copyState: normalizeEnum(state.promptReview.copyState, ["idle", "copied", "failed"], "idle"),
        error: state.promptReview.error,
        hasText: Boolean(currentText),
        lastReviewedAt: state.promptReview.lastReviewedAt,
        open: Boolean(state.promptReview.open && composerState.available),
        pending: Boolean(state.promptReview.pending),
        placeholderConfirmation: Boolean(state.promptReview.placeholderConfirmation && requiresPlaceholderConfirm && !stale),
        result,
        requiresPlaceholderConfirm,
        stale,
        textLength: currentText.length,
      };
    }

    async function handleAction(action) {
      logReviewDebug("prompt.review.action", {
        action,
        open: Boolean(state.promptReview.open),
        pending: Boolean(state.promptReview.pending),
      });
      if (action === "activate-review") return void activateReview();
      if (action === "review-composer") return void reviewComposer();
      if (action === "apply-reviewed-prompt") return void applyReviewedPrompt();
      if (action === "copy-reviewed-prompt") return void copyReviewedPrompt();
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
      logReviewDebug("prompt.review.activate", {
        hasError: Boolean(viewState.error),
        hasResult: Boolean(viewState.result),
        hasText: Boolean(viewState.hasText),
        stale: Boolean(viewState.stale),
      });
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
      const reviewProfile = getRequestedReviewProfile();
      logReviewDebug("prompt.review.request.start", {
        promptLength: prompt.length,
        reviewProfile: reviewProfile || "legacy-v1-default",
        sessionId: state.sessionId,
      });
      if (!composerState.available) {
        return void updateState({
          error: "현재 화면에서 대화 입력창을 찾지 못했어요.",
          lastReviewedAt: "",
          open: true,
          pending: false,
          placeholderConfirmation: false,
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
          placeholderConfirmation: false,
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
          placeholderConfirmation: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
      }

      const requestId = (Number(state.promptReview.requestId) || 0) + 1;
      const sessionId = state.sessionId;
      hooks.showPromptTab?.("review");
      updateState({
        copyState: "idle",
        error: "",
        lastReviewedAt: "",
        open: true,
        pending: true,
        placeholderConfirmation: false,
        requestId,
        result: null,
        reviewedText: "",
      });
      try {
        const runtimePayload = { prompt, providerIdentity };
        if (reviewProfile) {
          runtimePayload.reviewProfile = reviewProfile;
        }
        const result = await sendRuntimeMessage("inova-review:prompt", runtimePayload);
        if (!isActiveReviewRequest(requestId, sessionId)) {
          return;
        }
        logReviewDebug("prompt.review.request.success", {
          sessionId,
          totalScore: Number(result?.totalScore) || 0,
        });
        updateState({
          copyState: "idle",
          error: "",
          lastReviewedAt: new Date().toISOString(),
          open: true,
          pending: false,
          placeholderConfirmation: false,
          requestId,
          result,
          reviewedText: prompt,
        });
      } catch (error) {
        if (!isActiveReviewRequest(requestId, sessionId)) {
          return;
        }
        logReviewDebug("prompt.review.request.error", {
          error: getErrorMessage(error),
          level: "error",
          sessionId,
        });
        updateState({
          copyState: "idle",
          error: getErrorMessage(error),
          open: true,
          pending: false,
          placeholderConfirmation: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
      }
    }

    function applyReviewedPrompt() {
      const viewState = buildViewState();
      logReviewDebug("prompt.review.apply.start", {
        canApply: Boolean(viewState.canApply),
        pending: Boolean(viewState.pending),
        placeholderConfirmation: Boolean(viewState.placeholderConfirmation),
        requiresPlaceholderConfirm: Boolean(viewState.requiresPlaceholderConfirm),
        stale: Boolean(viewState.stale),
      });
      if (viewState.pending) {
        return void updateState({ error: "프롬프트 검토가 끝난 뒤 다시 반영해 주세요." });
      }
      if (viewState.stale) {
        return void updateState({ error: "입력창 내용이 바뀌어서 이전 보완안을 바로 반영할 수 없어요. 다시 평가해 주세요." });
      }
      if (viewState.requiresPlaceholderConfirm && !viewState.placeholderConfirmation) {
        return void updateState({
          error: "",
          placeholderConfirmation: true,
        });
      }

      const refinedPrompt = String(viewState.result?.refinedPrompt || "").trim();
      if (!refinedPrompt) {
        return void updateState({ error: "반영할 보완 프롬프트가 없어요." });
      }
      if (!namespace.composer.applyPromptText(refinedPrompt, "replace")) {
        return void updateState({ error: "입력창에 보완 프롬프트를 반영하지 못했어요." });
      }
      updateState({ copyState: "idle", error: "", placeholderConfirmation: false });
    }

    async function copyReviewedPrompt() {
      const viewState = buildViewState();
      const promptText = String(viewState.result?.formattedPrompt || viewState.result?.refinedPrompt || "").trim();
      if (!promptText) {
        return void updateState({
          copyState: "failed",
          error: "복사할 보완 프롬프트가 없어요.",
        });
      }
      try {
        await global.navigator.clipboard.writeText(promptText);
        updateState({
          copyState: "copied",
          error: "",
        });
      } catch (error) {
        console.error("[i-Nova Bookmarks] prompt review copy failed", error);
        updateState({
          copyState: "failed",
          error: "보완 프롬프트를 복사하지 못했어요.",
        });
      }
      scheduleCopyStateReset();
    }

    function dismissReview() {
      global.clearTimeout(copyStateTimer);
      logReviewDebug("prompt.review.dismiss", {
        hadResult: Boolean(state.promptReview.result),
      });
      hooks.showPromptTab?.("library");
      updateState({
        copyState: "idle",
        error: "",
        open: false,
        pending: false,
        placeholderConfirmation: false,
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

    function scheduleCopyStateReset() {
      global.clearTimeout(copyStateTimer);
      copyStateTimer = global.setTimeout(() => {
        updateState({ copyState: "idle" });
      }, 1600);
    }

    async function sendRuntimeMessage(type, payload) {
      logReviewDebug("prompt.review.runtime.request", {
        backend: "firebase-function",
        type,
      });
      const response = await chrome.runtime.sendMessage({ type, ...(payload || {}) });
      if (!response?.ok) {
        throw new Error(namespace.session.normalizeText(response?.error || "") || "프롬프트 평가를 처리하지 못했어요.");
      }
      logReviewDebug("prompt.review.runtime.success", {
        backend: "firebase-function",
        type,
      });
      return response.data;
    }

    function isActiveReviewRequest(requestId, sessionId) {
      return requestId === (Number(state.promptReview.requestId) || 0) && sessionId === state.sessionId;
    }
  }

  function normalizeResult(result) {
    if (!result || typeof result !== "object") return null;
    const checks = normalizeChecks(result.checks);
    const sections = buildCheckSections(checks);
    const refinedPrompt = String(result.refinedPrompt || "").trim();
    return {
      checks,
      formattedPrompt: formatRefinedPrompt(refinedPrompt),
      placeholderTokens: detectPlaceholderTokens(refinedPrompt),
      quickImprovements: Array.isArray(result.quickImprovements) ? result.quickImprovements.filter(Boolean).map(String) : [],
      refinedPrompt,
      scoreGuideText: sections.length ? PROMPT_TELLING_SCORE_GUIDE_TEXT : LEGACY_SCORE_GUIDE_TEXT,
      sections,
      summary: String(result.summary || "").trim(),
      totalScoreLabel: `${Math.max(0, Math.min(100, Number(result.totalScore) || 0))}점`,
    };
  }

  function normalizeChecks(checks) {
    return (Array.isArray(checks) ? checks : []).map((check, index) => {
      const normalizedKey = normalizeCheckKey(check?.id || check?.label);
      const definition = CHECK_DEFINITIONS[normalizedKey];
      const status = normalizeEnum(check?.status, ["good", "partial", "missing"], "partial");
      const label = normalizeCheckLabel(check?.label, normalizedKey);
      return {
        feedback: String(check?.feedback || "").trim(),
        group: normalizeCheckGroup(check?.group, definition?.group),
        id: definition?.id || String(check?.id || "").trim(),
        label,
        order: definition?.order ?? 1000 + index,
        status,
        statusLabel: STATUS_LABELS[status] || STATUS_LABELS.partial,
      };
    }).sort((left, right) => left.order - right.order)
      .map((check) => ({
        feedback: check.feedback,
        group: check.group,
        id: check.id,
        label: check.label,
        status: check.status,
        statusLabel: check.statusLabel,
      }));
  }

  function buildCheckSections(checks) {
    const groupedChecks = Array.isArray(checks) ? checks.filter((check) => CHECK_GROUP_DEFINITIONS[check.group]) : [];
    if (!groupedChecks.length) {
      return [];
    }
    return Object.entries(CHECK_GROUP_DEFINITIONS)
      .sort((left, right) => left[1].order - right[1].order)
      .map(([groupKey, groupDefinition]) => ({
        id: groupKey,
        items: groupedChecks.filter((check) => check.group === groupKey),
        label: groupDefinition.label,
      }))
      .filter((section) => section.items.length);
  }

  function normalizeCheckLabel(label, normalizedKey = normalizeCheckKey(label)) {
    if (CHECK_DEFINITIONS[normalizedKey]?.label) {
      return CHECK_DEFINITIONS[normalizedKey].label;
    }
    const source = String(label || "").trim();
    return source
      .replace(/\s*\((context|goal|constraints?|output|persona|reference|objective|mode|point[\s_-]?of[\s_-]?view|tone)\)\s*/gi, "")
      .trim()
      || "검토 항목";
  }

  function normalizeCheckGroup(group, fallback = "") {
    const normalized = namespace.session.normalizeText(group || fallback).toLowerCase();
    return normalized === "core" || normalized === "refinement" ? normalized : "";
  }

  function normalizeCheckKey(value) {
    return namespace.session.normalizeText(value)
      .replace(/[\s()_-]+/g, "")
      .toLowerCase();
  }

  function normalizeEnum(value, allowed, fallback) {
    const normalized = namespace.session.normalizeText(value).toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function detectPlaceholderTokens(text) {
    const matches = String(text || "").matchAll(/\[([^[\]\n]{1,40})\]/g);
    const tokens = [];
    for (const match of matches) {
      const token = String(match?.[1] || "").trim();
      if (!token || !/[A-Za-z가-힣]/.test(token)) continue;
      tokens.push(`[${token}]`);
    }
    return Array.from(new Set(tokens)).slice(0, 6);
  }

  function formatRefinedPrompt(text) {
    const normalized = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!normalized) {
      return "";
    }
    if (normalized.split("\n").filter(Boolean).length >= 3) {
      return normalized;
    }
    return normalized
      .replace(/([.!?。！？…])\s+/g, "$1\n")
      .replace(/([:：])\s+(?=[^\s])/g, "$1\n")
      .replace(/\s+(?=(답변은|반드시|분량은|톤은|형식은|출력 형식은|포함할 내용은|금지 사항은|예시는|주의 사항은))/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getErrorMessage(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
    if (message.includes("Extension context invalidated")) {
      return "확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.";
    }
    return message || "프롬프트 평가를 완료하지 못했어요.";
  }

  function getRequestedReviewProfile() {
    return shouldUsePromptReviewProfileV2() ? PROMPT_REVIEW_PROFILE_V2 : "";
  }

  function shouldUsePromptReviewProfileV2() {
    const runtimeVersion = readRuntimeVersion();
    if (!runtimeVersion) {
      return false;
    }
    return compareVersions(runtimeVersion, PROMPT_REVIEW_V2_MIN_VERSION) >= 0;
  }

  function readRuntimeVersion() {
    try {
      return namespace.session.normalizeText(global.chrome?.runtime?.getManifest?.()?.version);
    } catch {
      return "";
    }
  }

  function compareVersions(left, right) {
    const leftParts = String(left || "").split(".").map((part) => Number(part) || 0);
    const rightParts = String(right || "").split(".").map((part) => Number(part) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = leftParts[index] || 0;
      const rightPart = rightParts[index] || 0;
      if (leftPart > rightPart) return 1;
      if (leftPart < rightPart) return -1;
    }
    return 0;
  }

  function logReviewDebug(event, payload) {
    namespace.panelDebug?.log?.(event, {
      scope: "prompt",
      tool: "prompts",
      ...(payload || {}),
    });
  }

  namespace.promptReviewManager = {
    create,
  };
})(globalThis);
