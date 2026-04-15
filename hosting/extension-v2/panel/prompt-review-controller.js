(function initPromptReviewController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.panelUtils?.normalizeText
    || namespace.session?.normalizeText
    || ((value) => String(value ?? "").trim());
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

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const getActivePromptTab = typeof options.getActivePromptTab === "function"
      ? options.getActivePromptTab
      : () => "library";
    const getProviderIdentity = typeof options.getProviderIdentity === "function"
      ? options.getProviderIdentity
      : () => ({ available: false });
    const getRuntimeVersion = typeof options.getRuntimeVersion === "function"
      ? options.getRuntimeVersion
      : () => "";
    const publishToast = typeof options.publishToast === "function"
      ? options.publishToast
      : () => false;
    const traceReview = typeof options.traceReview === "function"
      ? options.traceReview
      : () => {};
    const applyComposerText = typeof browserCapabilities.applyComposerText === "function"
      ? browserCapabilities.applyComposerText
      : async () => ({});
    const invokeFunctionEndpoint = typeof browserCapabilities.invokeFunctionEndpoint === "function"
      ? browserCapabilities.invokeFunctionEndpoint
      : async () => ({});
    const readComposerState = typeof browserCapabilities.readComposerState === "function"
      ? browserCapabilities.readComposerState
      : async () => ({ available: false, text: "" });
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};
    const setActivePromptTab = typeof options.setActivePromptTab === "function"
      ? options.setActivePromptTab
      : async () => {};
    const writeClipboardText = typeof browserCapabilities.writeClipboardText === "function"
      ? browserCapabilities.writeClipboardText
      : async () => ({});

    let copyStateTimer = 0;
    const state = {
      composerState: { available: false, text: "" },
      copyState: "idle",
      error: "",
      lastExternalActivationRequestId: 0,
      lastReviewedAt: "",
      open: false,
      pending: false,
      placeholderConfirmation: false,
      requestId: 0,
      result: null,
      reviewedText: "",
      syncPromise: null,
    };

    return {
      buildViewState,
      consumeEscape,
      handlePromptAction,
      syncPanelState,
    };

    function syncPanelState(panelState) {
      handleExternalReviewActivation(panelState?.promptTool?.review);
      const activeTool = normalizeText(panelState?.activeTool);
      const activePromptTab = getActivePromptTab();
      if (activeTool === "prompts" && activePromptTab === "review" && state.open) {
        void refreshComposerState();
      }
    }

    function consumeEscape() {
      if (!state.open) {
        return false;
      }
      void dismissReview();
      return true;
    }

    function buildViewState() {
      const currentText = normalizeText(state.composerState.text);
      const reviewedText = normalizeText(state.reviewedText);
      const result = normalizeResult(state.result);
      const stale = Boolean(result && reviewedText && reviewedText !== currentText);
      const requiresPlaceholderConfirm = Boolean(result?.placeholderTokens?.length);
      return {
        available: Boolean(state.composerState.available),
        canApply: Boolean(result?.refinedPrompt && !state.pending && !stale),
        copyState: normalizeEnum(state.copyState, ["idle", "copied", "failed"], "idle"),
        error: state.error,
        hasText: Boolean(currentText),
        lastReviewedAt: state.lastReviewedAt,
        open: Boolean(state.open && state.composerState.available),
        pending: Boolean(state.pending),
        placeholderConfirmation: Boolean(state.placeholderConfirmation && requiresPlaceholderConfirm && !stale),
        result,
        requiresPlaceholderConfirm,
        stale,
        textLength: currentText.length,
      };
    }

    async function handlePromptAction(action) {
      const normalizedAction = normalizeText(action);
      if (normalizedAction === "activate-review") {
        await activateReview();
        return true;
      }
      if (normalizedAction === "review-composer") {
        await reviewComposer();
        return true;
      }
      if (normalizedAction === "apply-reviewed-prompt") {
        await applyReviewedPrompt();
        return true;
      }
      if (normalizedAction === "copy-reviewed-prompt") {
        await copyReviewedPrompt();
        return true;
      }
      if (normalizedAction === "dismiss-review") {
        await dismissReview();
        return true;
      }
      return false;
    }

    async function activateReview() {
      traceReview("50.hosted.review.action", {
        action: "activate-review",
      });
      await setActivePromptTab("review");
      const viewState = buildViewState();
      if (viewState.result && !viewState.stale && !viewState.error) {
        updateState({ open: true });
        return;
      }
      await reviewComposer();
    }

    async function reviewComposer() {
      traceReview("50.hosted.review.action", {
        action: "review-composer",
      });
      if (state.pending) {
        traceReview("51.hosted.review.request.skip", {
          action: "review-composer",
          reason: "pending",
        });
        return;
      }
      const composerState = await refreshComposerState(true);
      const prompt = String(composerState.text || "").trim();
      const reviewProfile = getRequestedReviewProfile(getRuntimeVersion());
      if (!composerState.available) {
        updateState({
          error: "현재 화면에서 대화 입력창을 찾지 못했어요.",
          lastReviewedAt: "",
          open: true,
          pending: false,
          placeholderConfirmation: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
        return;
      }
      if (!normalizeText(prompt)) {
        updateState({
          error: "입력창에 프롬프트를 먼저 적어 주세요.",
          lastReviewedAt: "",
          open: true,
          pending: false,
          placeholderConfirmation: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
        return;
      }
      const providerIdentity = getProviderIdentity();
      if (!providerIdentity?.available) {
        updateState({
          error: "i-Nova 사용자 정보를 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요.",
          lastReviewedAt: "",
          open: true,
          pending: false,
          placeholderConfirmation: false,
          requestId: 0,
          result: null,
          reviewedText: "",
        });
        return;
      }

      const requestId = Number(state.requestId || 0) + 1;
      await setActivePromptTab("review");
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
        traceReview("54.hosted.review.request.start", {
          action: "review-composer",
          reviewProfile: reviewProfile || "legacy-v1",
        });
        const body = {
          prompt,
          providerIdentity,
        };
        if (reviewProfile) {
          body.reviewProfile = reviewProfile;
        }
        const result = await invokeFunctionEndpoint({
          authMode: "access-token",
          body,
          endpointKey: "reviewInovaPromptUrl",
          service: "prompt",
        });
        if (requestId !== Number(state.requestId || 0)) {
          return;
        }
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
        traceReview("55.hosted.review.request.success", {
          action: "review-composer",
          reviewProfile: reviewProfile || "legacy-v1",
        });
      } catch (error) {
        if (requestId !== Number(state.requestId || 0)) {
          return;
        }
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
        traceReview("55.hosted.review.request.error", {
          action: "review-composer",
          error: getErrorMessage(error),
          reviewProfile: reviewProfile || "legacy-v1",
        });
      }
    }

    async function applyReviewedPrompt() {
      traceReview("50.hosted.review.action", {
        action: "apply-reviewed-prompt",
      });
      const viewState = buildViewState();
      if (viewState.pending) {
        updateState({ error: "프롬프트 검토가 끝난 뒤 다시 반영해 주세요." });
        traceReview("57.hosted.review.apply.error", {
          action: "apply-reviewed-prompt",
          error: "pending",
        });
        return;
      }
      if (viewState.stale) {
        updateState({ error: "입력창 내용이 바뀌어서 이전 보완안을 바로 반영할 수 없어요. 다시 평가해 주세요." });
        traceReview("57.hosted.review.apply.error", {
          action: "apply-reviewed-prompt",
          error: "stale",
        });
        return;
      }
      if (viewState.requiresPlaceholderConfirm && !viewState.placeholderConfirmation) {
        updateState({
          error: "",
          placeholderConfirmation: true,
        });
        traceReview("57.hosted.review.apply.error", {
          action: "apply-reviewed-prompt",
          error: "placeholder-confirmation-required",
        });
        return;
      }

      const refinedPrompt = String(viewState.result?.refinedPrompt || "").trim();
      if (!refinedPrompt) {
        updateState({ error: "반영할 보완 프롬프트가 없어요." });
        traceReview("57.hosted.review.apply.error", {
          action: "apply-reviewed-prompt",
          error: "missing-refined-prompt",
        });
        return;
      }
      traceReview("56.hosted.review.apply.start", {
        action: "apply-reviewed-prompt",
      });
      const result = await applyComposerText(refinedPrompt, "replace");
      if (!result?.applied) {
        updateState({ error: "입력창에 보완 프롬프트를 반영하지 못했어요." });
        traceReview("57.hosted.review.apply.error", {
          action: "apply-reviewed-prompt",
          error: "apply-failed",
        });
        return;
      }
      updateState({ copyState: "idle", error: "", placeholderConfirmation: false });
      traceReview("56.hosted.review.apply.success", {
        action: "apply-reviewed-prompt",
      });
      await refreshComposerState(true);
    }

    async function copyReviewedPrompt() {
      traceReview("50.hosted.review.action", {
        action: "copy-reviewed-prompt",
      });
      const viewState = buildViewState();
      const promptText = String(viewState.result?.formattedPrompt || viewState.result?.refinedPrompt || "").trim();
      if (!promptText) {
        updateState({
          copyState: "failed",
        });
        publishActionToast("복사할 보완 프롬프트가 없어요.", "error");
        traceReview("58.hosted.review.copy.error", {
          action: "copy-reviewed-prompt",
          error: "missing-refined-prompt",
        });
        scheduleCopyStateReset();
        return;
      }
      try {
        traceReview("58.hosted.review.copy.start", {
          action: "copy-reviewed-prompt",
        });
        const result = await writeClipboardText(promptText);
        if (!result?.copied) {
          throw new Error("copy-failed");
        }
        updateState({
          copyState: "copied",
          error: "",
        });
        publishActionToast("보완 프롬프트를 복사했어요.");
        traceReview("58.hosted.review.copy.success", {
          action: "copy-reviewed-prompt",
        });
      } catch {
        updateState({
          copyState: "failed",
        });
        publishActionToast("보완 프롬프트를 복사하지 못했어요.", "error");
        traceReview("58.hosted.review.copy.error", {
          action: "copy-reviewed-prompt",
          error: "copy-failed",
        });
      }
      scheduleCopyStateReset();
    }

    async function dismissReview() {
      global.clearTimeout(copyStateTimer);
      await setActivePromptTab("library");
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
      Object.assign(state, patch || {});
      scheduleRender();
    }

    function handleExternalReviewActivation(reviewState) {
      const requestId = Math.max(0, Number(reviewState?.requestId) || 0);
      if (!requestId || requestId === state.lastExternalActivationRequestId) {
        return;
      }
      state.lastExternalActivationRequestId = requestId;
      traceReview("52.hosted.review.external-activation", {
        requestId,
      });
      void activateReview();
    }

    function scheduleCopyStateReset() {
      global.clearTimeout(copyStateTimer);
      copyStateTimer = global.setTimeout(() => {
        updateState({ copyState: "idle" });
      }, 1600);
    }

    function publishActionToast(message, tone = "success", ttlMs = tone === "error" ? 3600 : 2200) {
      const nextMessage = normalizeText(message);
      if (!nextMessage) {
        return false;
      }
      return Boolean(publishToast({
        message: nextMessage,
        source: "prompt-review",
        tone: tone === "error" ? "error" : "success",
        ttlMs: Math.max(0, Number(ttlMs) || 0),
      }));
    }

    async function refreshComposerState(force = false) {
      if (state.syncPromise && !force) {
        return state.syncPromise;
      }
      const run = readComposerState()
        .catch(() => ({ available: false, text: "" }))
        .then((composerState) => {
          state.composerState = {
            available: Boolean(composerState?.available),
            text: String(composerState?.text || ""),
          };
          scheduleRender();
          return state.composerState;
        });
      state.syncPromise = run;
      try {
        return await run;
      } finally {
        if (state.syncPromise === run) {
          state.syncPromise = null;
        }
      }
    }
  }

  function normalizeResult(result) {
    if (!result || typeof result !== "object") {
      return null;
    }
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
    const normalized = normalizeText(group || fallback).toLowerCase();
    return normalized === "core" || normalized === "refinement" ? normalized : "";
  }

  function normalizeCheckKey(value) {
    return normalizeText(value)
      .replace(/[\s()_-]+/g, "")
      .toLowerCase();
  }

  function normalizeEnum(value, allowed, fallback) {
    const normalized = normalizeText(value).toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function detectPlaceholderTokens(text) {
    const matches = String(text || "").matchAll(/\[([^[\]\n]{1,40})\]/g);
    const tokens = [];
    for (const match of matches) {
      const token = String(match?.[1] || "").trim();
      if (!token || !/[A-Za-z가-힣]/.test(token)) {
        continue;
      }
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
    const message = normalizeText(error instanceof Error ? error.message : String(error || ""));
    if (message.includes("Extension context invalidated")) {
      return "확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.";
    }
    return message || "프롬프트 평가를 완료하지 못했어요.";
  }

  function getRequestedReviewProfile(runtimeVersion) {
    return compareVersions(runtimeVersion, PROMPT_REVIEW_V2_MIN_VERSION) >= 0
      ? PROMPT_REVIEW_PROFILE_V2
      : "";
  }

  function compareVersions(left, right) {
    const leftParts = String(left || "").split(".").map((part) => Number(part) || 0);
    const rightParts = String(right || "").split(".").map((part) => Number(part) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = leftParts[index] || 0;
      const rightPart = rightParts[index] || 0;
      if (leftPart > rightPart) {
        return 1;
      }
      if (leftPart < rightPart) {
        return -1;
      }
    }
    return 0;
  }

  function resolveBrowserCapabilities(options) {
    const providedCapabilities = options?.browserCapabilities;
    if (providedCapabilities && typeof providedCapabilities === "object") {
      return providedCapabilities;
    }
    return namespace.extensionCapabilityClient?.create?.({
      invokePage: options?.invokePage,
      invokeRuntime: options?.invokeRuntime,
    }) || {};
  }

  namespace.promptReviewController = { create };
})(globalThis);
