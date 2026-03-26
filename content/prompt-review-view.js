(function initPromptReviewView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(review) {
    const result = review.result;
    const applyLabel = review.stale ? "다시 평가 후 반영" : "입력창에 반영";
    const applyButton = result
      ? `<button type="button" class="inova-tool-button is-primary" data-prompt-action="apply-reviewed-prompt"${review.canApply ? "" : ' disabled aria-disabled="true"'}>${applyLabel}</button>`
      : "";
    const notices = [
      review.error ? `<p class="inova-inline-feedback is-error">${escapeHtml(review.error)}</p>` : "",
      review.stale ? '<p class="inova-inline-feedback is-warning">입력창 내용이 바뀌었어요. 다시 평가하면 현재 문장 기준으로 보완안을 새로 만들어요.</p>' : "",
      review.pending ? '<div class="inova-inline-feedback">프롬프트를 검토하고 있어요.</div>' : "",
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
          ${result ? renderResult(result) : ""}
        </div>
        <div class="inova-tool-actions inova-prompt-review__actions">
          ${applyButton}
          <button type="button" class="inova-tool-button" data-prompt-action="review-composer">다시 평가</button>
        </div>
      </section>
    `;
  }

  function renderResult(result) {
    const verdictTone = result.verdict === "ready" ? "good" : result.verdict === "insufficient" ? "missing" : "partial";
    return `
      <div class="inova-prompt-review__summary">
        <div class="inova-prompt-review__score">
          <strong>${escapeHtml(result.totalScoreLabel)}</strong>
          <span class="inova-prompt-review__status is-${escapeHtml(verdictTone)}">${escapeHtml(result.verdictLabel)}</span>
        </div>
        <p>${escapeHtml(result.summary)}</p>
      </div>
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
      ${result.quickImprovements.length ? `
        <section class="inova-prompt-review__section">
          <strong class="inova-prompt-review__section-title">빠른 보완 포인트</strong>
          <ul class="inova-prompt-review__list">
            ${result.quickImprovements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </section>
      ` : ""}
      <label class="inova-prompt-review__field">
        <span>보완 프롬프트</span>
        <textarea rows="10" readonly>${escapeHtml(result.refinedPrompt)}</textarea>
      </label>
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

  namespace.promptReviewView = {
    render,
  };
})(globalThis);
