(function initPromptReviewView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(review) {
    const result = review.result;
    const reviewButton = result
      ? ""
      : `<button type="button" class="inova-tool-button" data-prompt-action="review-composer"${review.canReview ? "" : ' disabled aria-disabled="true"'}>검토</button>`;
    const scoreGuide = result
      ? escapeHtml(result.scoreGuideText || "점수는 프롬프트 검토 결과를 요약한 참고값이에요.")
      : "";
    const scoreChip = result
      ? `
          <span class="inova-prompt-review__score-chip">
            ${escapeHtml(result.totalScoreChipLabel || result.totalScoreLabel)}
            <span
              class="inova-help-chip"
              tabindex="0"
              role="note"
              aria-label="${scoreGuide}"
              title="${scoreGuide}"
            >?</span>
          </span>
        `
      : "";
    const notices = [
      !review.canReview && review.capabilityError ? `<p class="inova-inline-feedback is-error">${escapeHtml(review.capabilityError)}</p>` : "",
      review.error ? `<p class="inova-inline-feedback is-error">${escapeHtml(review.error)}</p>` : "",
      review.pending ? '<div class="inova-inline-feedback">프롬프트를 검토하고 있어요.</div>' : "",
      result?.placeholderTokens?.length ? `<p class="inova-inline-feedback is-warning">다듬은 프롬프트에 ${renderTokenList(result.placeholderTokens)}처럼 대괄호로 표시된 항목이 남아 있어요. 입력창에 반영한 뒤 대괄호([]) 안의 내용을 실제 데이터로 직접 수정해 주세요.</p>` : "",
      !review.pending && !result ? '<div class="inova-bookmark-empty">입력창에 프롬프트를 적은 뒤 검토 버튼을 눌러 보세요.</div>' : "",
    ].filter(Boolean).join("");
    return `
      <section class="inova-prompt-review">
        <div class="inova-prompt-review__head">
          <div class="inova-prompt-review__title">
            <strong>프롬프트 검토</strong>
          </div>
          ${scoreChip}
        </div>
        <div class="inova-prompt-review__body">
          ${notices ? `<div class="inova-prompt-review__notices">${notices}</div>` : ""}
          ${result ? renderResult(result, review) : ""}
        </div>
        <div class="inova-tool-actions inova-prompt-review__actions">
          ${reviewButton}
        </div>
      </section>
    `;
  }

  function renderResult(result, review) {
    const formattedPrompt = escapeHtml(result.formattedPrompt || result.refinedPrompt);
    const applyButton = !review.stale
      ? `<button type="button" class="inova-tool-button inova-tool-button--compact is-primary" data-prompt-action="apply-reviewed-prompt"${review.canApply ? "" : ' disabled aria-disabled="true"'}>입력창에 반영</button>`
      : "";
    return `
      <div class="inova-prompt-review__summary">
        <div class="inova-prompt-review__score">
          <strong class="inova-prompt-review__verdict">${escapeHtml(result.verdictLabel || "조금만 다듬으면 좋아요")}</strong>
        </div>
        <p>${escapeHtml(result.summary)}</p>
      </div>
      ${result.quickImprovements.length ? `
        <section class="inova-prompt-review__section">
          <strong class="inova-prompt-review__section-title">바로 고칠 점</strong>
          <ul class="inova-prompt-review__list">
            ${result.quickImprovements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </section>
      ` : ""}
      <section class="inova-prompt-review__field">
        <div class="inova-prompt-review__field-head">
          <span>다듬은 프롬프트</span>
          <div class="inova-prompt-review__field-actions">
            <button type="button" class="inova-tool-button inova-tool-button--compact" data-prompt-action="copy-reviewed-prompt">복사</button>
            ${applyButton}
          </div>
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
