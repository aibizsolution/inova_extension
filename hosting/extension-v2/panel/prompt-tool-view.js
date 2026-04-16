(function initPromptToolView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    const activeTab = state?.activeTab || "library";
    const reviewState = normalizePromptReviewState(state?.review);
    const storeState = normalizeStoreState(state?.store);
    const body = activeTab === "library"
      ? namespace.promptView?.renderBody?.(state.prompt) || renderPromptPlaceholder("내 요청을 준비하는 중이에요.")
      : activeTab === "review"
        ? namespace.promptReviewView?.render?.(reviewState) || renderPromptPlaceholder("프롬프트 검토를 준비하는 중이에요.")
      : activeTab === "store"
        ? namespace.storeView?.renderBody?.(storeState) || renderPromptPlaceholder("스토어를 준비하는 중이에요.")
        : renderPromptPlaceholder("프롬프트 화면을 준비하는 중이에요.");

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

  function normalizePromptReviewState(review) {
    const nextReview = review && typeof review === "object" ? review : {};
    return {
      available: Boolean(nextReview.available),
      canReview: nextReview.canReview !== false,
      canApply: Boolean(nextReview.canApply),
      capabilityError: String(nextReview.capabilityError || ""),
      copyState: String(nextReview.copyState || "idle"),
      error: String(nextReview.error || ""),
      hasText: Boolean(nextReview.hasText),
      lastReviewedAt: String(nextReview.lastReviewedAt || ""),
      open: Boolean(nextReview.open),
      pending: Boolean(nextReview.pending),
      placeholderConfirmation: Boolean(nextReview.placeholderConfirmation),
      requiresPlaceholderConfirm: Boolean(nextReview.requiresPlaceholderConfirm),
      result: nextReview.result || null,
      stale: Boolean(nextReview.stale),
      textLength: Math.max(0, Number(nextReview.textLength) || 0),
    };
  }

  function normalizeStoreState(store) {
    const nextStore = store && typeof store === "object" ? store : {};
    return {
      actionPending: nextStore.actionPending || null,
      categories: Array.isArray(nextStore.categories) ? nextStore.categories : [],
      categoryId: String(nextStore.categoryId || "all"),
      dataFreshness: String(nextStore.dataFreshness || "fresh"),
      degraded: Boolean(nextStore.degraded),
      deleteConfirmEntryId: String(nextStore.deleteConfirmEntryId || ""),
      detailPendingEntryId: String(nextStore.detailPendingEntryId || ""),
      emptyText: String(nextStore.emptyText || "스토어를 준비하는 중이에요."),
      error: String(nextStore.error || ""),
      canImport: nextStore.canImport !== false,
      canLike: nextStore.canLike !== false,
      canRecordView: nextStore.canRecordView !== false,
      canUnpublish: nextStore.canUnpublish !== false,
      expandedEntryId: String(nextStore.expandedEntryId || ""),
      feedback: nextStore.feedback || null,
      hasMore: Boolean(nextStore.hasMore),
      identityPending: Boolean(nextStore.identityPending),
      items: Array.isArray(nextStore.items) ? nextStore.items : [],
      loaded: Boolean(nextStore.loaded),
      loadedCount: Math.max(0, Number(nextStore.loadedCount) || 0),
      loading: Boolean(nextStore.loading),
      ownerScope: String(nextStore.ownerScope || "all"),
      providerUserKey: String(nextStore.providerUserKey || ""),
      query: String(nextStore.query || ""),
      queryActive: Boolean(nextStore.queryActive),
      queryDirty: Boolean(nextStore.queryDirty),
      renderKey: Math.max(0, Number(nextStore.renderKey) || 0),
      renderLimit: Math.max(0, Number(nextStore.renderLimit) || 0),
      renderedCount: Math.max(0, Number(nextStore.renderedCount) || 0),
      sortBy: String(nextStore.sortBy || "latest"),
      source: String(nextStore.source || "none"),
      totalCount: Math.max(0, Number(nextStore.totalCount) || 0),
    };
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
