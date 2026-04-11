(function initPromptToolView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    const activeTab = state?.activeTab || "library";
    const body = activeTab === "library"
      ? namespace.promptView?.renderBody?.(state.prompt) || renderPromptPlaceholder("내 요청을 준비하는 중이에요.")
      : activeTab === "review"
        ? namespace.promptReviewView?.render?.(state.review) || renderPromptPlaceholder("프롬프트 검토를 준비하는 중이에요.")
      : activeTab === "store"
        ? renderPlaceholder(state.storePlaceholder)
        : renderPlaceholder(state.reviewPlaceholder);

    return `
      <section class="inova-tool-section inova-tool-section--prompts">
        <div class="inova-tool-subtabs" role="tablist" aria-label="프롬프트 화면 전환">
          ${tabs.map((tab) => `
            <button
              type="button"
              class="inova-tool-subtab ${tab.id === activeTab ? "is-active" : ""}"
              data-prompt-tab-id="${escapeHtml(tab.id)}"
              aria-pressed="${tab.id === activeTab}"
            >
              <span>${escapeHtml(tab.label)}</span>
              ${tab.count == null ? "" : `<span class="inova-tool-subtab__count">${Number(tab.count) || 0}</span>`}
            </button>
          `).join("")}
        </div>
        ${body}
      </section>
    `;
  }

  function renderPlaceholder(placeholder) {
    return `
      <section class="inova-tool-section">
        <div class="inova-bookmark-empty">
          <strong>${escapeHtml(placeholder?.title || "화면 준비 중")}</strong>
          <div>${escapeHtml(placeholder?.body || "다음 단계에서 이 탭의 hosted ownership을 이동합니다.")}</div>
        </div>
      </section>
    `;
  }

  function renderPromptPlaceholder(message) {
    return `<div class="inova-bookmark-empty">${escapeHtml(message)}</div>`;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  namespace.promptToolView = { render };
})(globalThis);
