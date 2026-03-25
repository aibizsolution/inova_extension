(function initStoreView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const globalFeedback = state.feedback?.entryId ? null : state.feedback;
    const itemsHtml = state.items.length
      ? state.items.map((item) => renderItem(item, state)).join("")
      : state.loading
        ? `<div class="inova-bookmark-empty">스토어를 불러오는 중이에요.</div>`
      : state.identityPending
        ? `<div class="inova-bookmark-empty">사용자 정보를 확인하는 중이에요.</div>`
      : `<div class="inova-bookmark-empty">${escapeHtml(state.emptyText)}</div>`;

    return `
      <section class="inova-tool-section inova-tool-section--store">
        <div class="inova-tool-toolbar is-stacked">
          <input
            class="inova-tool-search"
            type="search"
            value="${escapeHtml(state.query)}"
            data-search-tool="store"
            placeholder="스토어에서 프롬프트 찾기"
          />
        <div class="inova-tool-toolbar__row">
          <div class="inova-tool-meta">${state.loading ? "불러오는 중" : `총 ${state.totalCount}개`}</div>
          <div class="inova-tool-actions inova-tool-actions--toolbar">
            <button type="button" class="inova-tool-button" data-store-action="refresh" ${renderDisabled(state.loading)}>${state.loading ? "새로고침 중..." : "새로고침"}</button>
          </div>
          </div>
          <div class="inova-store-controls">
            ${renderScopeToggle(state.ownerScope)}
            ${renderCategorySelect(state.categories, state.categoryId)}
          </div>
          <div class="inova-store-sort">
            ${renderSort("latest", "최신순", state.sortBy)}
            ${renderSort("likes", "좋아요순", state.sortBy)}
            ${renderSort("imports", "가져오기순", state.sortBy)}
          </div>
        </div>
        ${renderFeedback(globalFeedback)}
        ${state.error ? `<p class="inova-inline-feedback is-error">${escapeHtml(state.error)}</p>` : ""}
        <div class="inova-store-list">${itemsHtml}</div>
      </section>
    `;
  }

  function renderCategorySelect(categories, activeCategoryId) {
    return `
      <label class="inova-tool-select-field">
        <span>카테고리</span>
        <select class="inova-tool-select" data-store-field="category">
          ${categories.map((category) => `
            <option value="${category.id}" ${category.id === activeCategoryId ? "selected" : ""}>${escapeHtml(category.label)}</option>
          `).join("")}
        </select>
      </label>
    `;
  }

  function renderScopeToggle(activeScope) {
    return `
      <div class="inova-tool-select-field">
        <span>보기 범위</span>
        <div class="inova-scope-toggle" role="tablist" aria-label="스토어 보기 범위">
          <button
            type="button"
            class="inova-scope-toggle__button ${activeScope === "all" ? "is-active" : ""}"
            data-store-action="set-scope"
            data-store-scope="all"
          ><span class="inova-scope-toggle__icon" aria-hidden="true"></span>전체</button>
          <button
            type="button"
            class="inova-scope-toggle__button ${activeScope === "mine" ? "is-active" : ""}"
            data-store-action="set-scope"
            data-store-scope="mine"
          ><span class="inova-scope-toggle__icon is-user" aria-hidden="true"></span>내 등록</button>
        </div>
      </div>
    `;
  }

  function renderSort(sortBy, label, activeSort) {
    return `
      <button
        type="button"
        class="inova-tool-pill ${sortBy === activeSort ? "is-active" : ""}"
        data-store-action="set-sort"
        data-store-sort="${sortBy}"
      >${escapeHtml(label)}</button>
    `;
  }

  function renderItem(item, state) {
    const expandable = Boolean(String(item?.content || "").trim());
    const expanded = expandable && state.expandedEntryId === item.entryId;
    const owned = item.owner.providerUserKey && item.owner.providerUserKey === state.providerUserKey;
    const itemFeedback = state.feedback?.entryId === item.entryId ? state.feedback : null;
    const deleteConfirm = state.deleteConfirmEntryId === item.entryId;
    const importing = state.actionPending?.type === "import" && state.actionPending.entryId === item.entryId;
    const liking = state.actionPending?.type === "like" && state.actionPending.entryId === item.entryId;
    const unpublishing = state.actionPending?.type === "unpublish" && state.actionPending.entryId === item.entryId;
    return `
      <article class="inova-prompt-item inova-store-item ${expanded ? "is-expanded" : ""}">
        <div class="inova-prompt-item__head">
          <div class="inova-prompt-item__title-row">
            <span class="inova-store-item__badge">${escapeHtml(item.categoryLabel)}</span>
            <strong class="inova-prompt-item__title">${escapeHtml(item.title)}</strong>
          </div>
          <div class="inova-prompt-item__meta">
            <span class="inova-prompt-item__date">${formatDate(item.publishedAt)}</span>
            ${expandable
              ? `<button type="button" class="inova-tool-button inova-tool-button--compact" data-store-action="toggle-expand" data-store-entry-id="${item.entryId}">
                  ${expanded ? "닫기" : "보기"}
                </button>`
              : ""}
          </div>
        </div>
        <div class="inova-store-item__owner">${escapeHtml(item.owner.displayName)}${item.owner.maskedEmail ? ` · ${escapeHtml(item.owner.maskedEmail)}` : ""}</div>
        ${expanded ? `<p class="inova-prompt-item__content">${escapeHtml(item.content)}</p>` : ""}
        <div class="inova-store-item__metrics">
          <span>조회 ${item.metrics.viewCount}</span>
          <span>가져오기 ${item.metrics.importCount}</span>
          <span>좋아요 ${item.metrics.likeCount}</span>
        </div>
        <div class="inova-prompt-item__actions">
          <button
            type="button"
            class="inova-tool-button is-primary"
            data-store-action="import"
            data-store-entry-id="${item.entryId}"
            ${renderDisabled(importing || liking || unpublishing)}
          >${importing ? "가져오는 중..." : "내 요청으로 가져오기"}</button>
          ${owned
            ? `<button type="button" class="inova-tool-button" data-store-action="request-unpublish" data-store-entry-id="${item.entryId}" ${renderDisabled(importing || liking || unpublishing)}>${deleteConfirm ? "닫기" : "스토어 삭제"}</button>`
            : ""}
          <button
            type="button"
            class="inova-tool-button ${item.viewer.liked ? "is-primary" : ""}"
            data-store-action="toggle-like"
            data-store-entry-id="${item.entryId}"
            ${renderDisabled(importing || liking || unpublishing)}
          >${liking ? "처리 중..." : item.viewer.liked ? "좋아요 취소" : "좋아요"}</button>
        </div>
        ${itemFeedback ? renderFeedback(itemFeedback) : ""}
        ${deleteConfirm ? renderDeleteConfirm(item.entryId, item.title, unpublishing) : ""}
      </article>
    `;
  }

  function renderFeedback(feedback) {
    if (!feedback?.message) {
      return "";
    }
    return `<p class="inova-inline-feedback ${feedback.tone === "error" ? "is-error" : ""}">${escapeHtml(feedback.message)}</p>`;
  }

  function renderDeleteConfirm(entryId, title, pending) {
    return `
      <section class="inova-inline-feedback is-warning">
        <strong>${escapeHtml(title)}</strong>
        <span>이 스토어 항목을 내릴까요? 이미 가져간 사용자 요청은 그대로 유지돼요.</span>
        <div class="inova-tool-actions">
          <button type="button" class="inova-tool-button is-danger" data-store-action="unpublish" data-store-entry-id="${entryId}" ${renderDisabled(pending)}>${pending ? "삭제 중..." : "정말 삭제"}</button>
          <button type="button" class="inova-tool-button" data-store-action="cancel-unpublish" data-store-entry-id="${entryId}" ${renderDisabled(pending)}>취소</button>
        </div>
      </section>
    `;
  }

  function formatDate(value) {
    const time = Date.parse(value || "");
    if (!time) {
      return "";
    }
    return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(time);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderDisabled(disabled) {
    return disabled ? 'disabled aria-disabled="true"' : "";
  }

  namespace.storeView = {
    render,
  };
})(globalThis);
