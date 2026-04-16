(function initPromptReviewView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(review) {
    const result = review.result;
    const applyLabel = review.requiresPlaceholderConfirm && !review.placeholderConfirmation
      ? "대괄호 내용 확인 후 반영"
      : review.requiresPlaceholderConfirm
      ? "대괄호 포함 그대로 반영"
      : "입력창에 반영";
    const applyButton = result && !review.stale
      ? `<button type="button" class="inova-tool-button is-primary" data-prompt-action="apply-reviewed-prompt"${review.canApply ? "" : ' disabled aria-disabled="true"'}>${applyLabel}</button>`
      : "";
    const reviewButton = result
      ? ""
      : `<button type="button" class="inova-tool-button" data-prompt-action="review-composer"${review.canReview ? "" : ' disabled aria-disabled="true"'}>검토</button>`;
    const notices = [
      !review.canReview && review.capabilityError ? `<p class="inova-inline-feedback is-error">${escapeHtml(review.capabilityError)}</p>` : "",
      review.error ? `<p class="inova-inline-feedback is-error">${escapeHtml(review.error)}</p>` : "",
      review.stale ? '<p class="inova-inline-feedback is-warning">입력창 내용이 바뀌었어요. 검토 버튼을 누르면 현재 문장 기준으로 바로 다시 평가해요.</p>' : "",
      review.placeholderConfirmation ? `<p class="inova-inline-feedback is-warning">보완 프롬프트에 ${renderTokenList(result?.placeholderTokens || [])}처럼 대괄호로 표시된 항목이 남아 있어요. 그대로 반영하면 대괄호 안 내용도 함께 들어갑니다. 그대로 반영하려면 버튼을 한 번 더 눌러 주세요.</p>` : "",
      review.pending ? '<div class="inova-inline-feedback">프롬프트를 검토하고 있어요.</div>' : "",
      result?.placeholderTokens?.length ? `<p class="inova-inline-feedback is-warning">보완 프롬프트에 ${renderTokenList(result.placeholderTokens)}처럼 대괄호로 표시된 항목이 남아 있어요. 입력창에 반영한 뒤 대괄호([]) 안의 내용을 실제 데이터로 직접 수정해 주세요.</p>` : "",
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
          ${reviewButton}
        </div>
      </section>
    `;
  }

  function renderResult(result) {
    const scoreGuide = escapeHtml(result.scoreGuideText || "점수는 프롬프트 검토 결과를 요약한 참고값이에요.");
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
          <button type="button" class="inova-tool-button inova-tool-button--compact" data-prompt-action="copy-reviewed-prompt">복사</button>
        </div>
        <textarea rows="10" name="inova-reviewed-prompt" readonly>${formattedPrompt}</textarea>
      </section>
      ${renderChecks(result)}
    `;
  }

  function renderChecks(result) {
    if (Array.isArray(result.sections) && result.sections.length) {
      return `
        <div class="inova-prompt-review__checks">
          ${result.sections.map((section) => `
            <section class="inova-prompt-review__check-group">
              <strong class="inova-prompt-review__check-group-title">${escapeHtml(section.label)}</strong>
              ${section.items.map(renderCheckCard).join("")}
            </section>
          `).join("")}
        </div>
      `;
    }
    return `
      <div class="inova-prompt-review__checks">
        ${result.checks.map(renderCheckCard).join("")}
      </div>
    `;
  }

  function renderCheckCard(check) {
    return `
      <article class="inova-prompt-review__check">
        <div class="inova-prompt-review__check-head">
          <strong>${escapeHtml(check.label)}</strong>
          <span class="inova-prompt-review__status is-${escapeHtml(check.status)}">${escapeHtml(check.statusLabel)}</span>
        </div>
        <p>${escapeHtml(check.feedback)}</p>
      </article>
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
