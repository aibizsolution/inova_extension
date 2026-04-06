(function initPromptReviewView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const SCORE_GUIDE_TEXT = "점수는 맥락, 목표, 제약, 출력 형식 4개 기준만 본 참고값이에요.";

  function render(review) {
    const result = review.result;
    const applyLabel = review.stale
      ? "다시 평가 후 반영"
      : review.requiresPlaceholderConfirm && !review.placeholderConfirmation
      ? "대괄호 내용 확인 후 반영"
      : review.requiresPlaceholderConfirm
      ? "대괄호 포함 그대로 반영"
      : "입력창에 반영";
    const applyButton = result
      ? `<button type="button" class="inova-tool-button is-primary" data-prompt-action="apply-reviewed-prompt"${review.canApply ? "" : ' disabled aria-disabled="true"'}>${applyLabel}</button>`
      : "";
    const notices = [
      review.error ? `<p class="inova-inline-feedback is-error">${escapeHtml(review.error)}</p>` : "",
      review.stale ? '<p class="inova-inline-feedback is-warning">입력창 내용이 바뀌었어요. 다시 평가하면 현재 문장 기준으로 보완안을 새로 만들어요.</p>' : "",
      review.placeholderConfirmation ? `<p class="inova-inline-feedback is-warning">보완 프롬프트에 ${renderTokenList(result?.placeholderTokens || [])}처럼 대괄호로 표시된 항목이 남아 있어요. 그대로 반영하면 대괄호 안 내용도 함께 들어갑니다. 그대로 반영하려면 버튼을 한 번 더 눌러 주세요.</p>` : "",
      review.pending ? '<div class="inova-inline-feedback">프롬프트를 검토하고 있어요.</div>' : "",
      result?.placeholderTokens?.length ? `<p class="inova-inline-feedback is-warning">보완 프롬프트에 ${renderTokenList(result.placeholderTokens)}처럼 대괄호로 표시된 항목이 남아 있어요. 입력창에 반영한 뒤 대괄호([]) 안의 내용을 실제 데이터로 직접 수정해 주세요.</p>` : "",
      '<p class="inova-inline-feedback">이 검토는 외부 AI 모델이 현재 입력 내용을 바탕으로 만든 참고 의견이에요. 민감한 내용은 넣지 않는 편이 안전해요.</p>',
      !review.pending && !result ? '<div class="inova-bookmark-empty">입력창에 프롬프트를 적은 뒤 검토 버튼을 눌러 보세요.</div>' : "",
    ].filter(Boolean).join("");
    return `
      <section class="inova-prompt-review">
        <div class="inova-prompt-review__head">
          <div>
            <strong>프롬프트 검토</strong>
            ${review.lastReviewedAt ? `<p>${escapeHtml(formatDateTime(review.lastReviewedAt))}</p>` : ""}
          </div>
        </div>
        <div class="inova-prompt-review__body">
          ${notices ? `<div class="inova-prompt-review__notices">${notices}</div>` : ""}
          ${result ? renderResult(result, review) : ""}
        </div>
        <div class="inova-tool-actions inova-prompt-review__actions">
          ${applyButton}
          <button type="button" class="inova-tool-button" data-prompt-action="review-composer">다시 평가</button>
        </div>
      </section>
    `;
  }

  function renderResult(result, review) {
    const scoreGuide = escapeHtml(SCORE_GUIDE_TEXT);
    const copyLabel = review.copyState === "copied"
      ? "복사됨"
      : review.copyState === "failed"
      ? "다시 시도"
      : "복사";
    const formattedPrompt = escapeHtml(result.formattedPrompt || result.refinedPrompt);
    return `
      <div class="inova-prompt-review__summary">
        <div class="inova-prompt-review__score">
          <strong>총점 ${escapeHtml(result.totalScoreLabel)}</strong>
          <span
            class="inova-help-chip"
            tabindex="0"
            role="note"
            aria-label="${scoreGuide}"
            title="${scoreGuide}"
          >?</span>
        </div>
        <p>${escapeHtml(result.summary)}</p>
      </div>
      ${result.quickImprovements.length ? `
        <section class="inova-prompt-review__section">
          <strong class="inova-prompt-review__section-title">빠른 보완 포인트</strong>
          <ul class="inova-prompt-review__list">
            ${result.quickImprovements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </section>
      ` : ""}
      <section class="inova-prompt-review__field">
        <div class="inova-prompt-review__field-head">
          <span>보완 프롬프트</span>
          <button type="button" class="inova-tool-button inova-tool-button--compact" data-prompt-action="copy-reviewed-prompt">${escapeHtml(copyLabel)}</button>
        </div>
        <textarea rows="10" readonly>${formattedPrompt}</textarea>
      </section>
      <div class="inova-prompt-review__checks">
        ${result.checks.map((check) => `
          <article class="inova-prompt-review__check">
            <div class="inova-prompt-review__check-head">
              <strong>${escapeHtml(check.label)}</strong>
              <span class="inova-prompt-review__status is-${escapeHtml(check.status)}">${escapeHtml(check.statusLabel)}</span>
            </div>
            <p>${escapeHtml(check.feedback)}</p>
          </article>
        `).join("")}
      </div>
    `;
  }

  function formatDateTime(value) {
    const time = Date.parse(value || "");
    if (!time) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(time);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderTokenList(tokens) {
    return tokens.map((token) => `<code>${escapeHtml(token)}</code>`).join(" ");
  }

  namespace.promptReviewView = {
    render,
  };
})(globalThis);
