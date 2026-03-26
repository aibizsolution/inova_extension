(function initPromptHubView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const body = state.activeTab === "store"
      ? namespace.storeView.renderBody(state.store)
      : state.activeTab === "review"
        ? namespace.promptReviewView.render(state.review)
        : namespace.promptView.renderBody(state.prompt);
    return `
      <section class="inova-tool-section inova-tool-section--prompts">
        <div class="inova-tool-subtabs" role="tablist" aria-label="프롬프트 화면 전환">
          ${state.tabs.map((tab) => `
            <button
              type="button"
              class="inova-tool-subtab ${tab.id === state.activeTab ? "is-active" : ""}"
              data-prompt-tab-id="${tab.id}"
              aria-pressed="${tab.id === state.activeTab}"
            >
              <span>${escapeHtml(tab.label)}</span>
              ${tab.count == null ? "" : `<span class="inova-tool-subtab__count">${tab.count}</span>`}
            </button>
          `).join("")}
        </div>
        ${body}
      </section>
    `;
  }

  function escapeHtml(text) {
    return String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  namespace.promptHubView = { render };
})(globalThis);
