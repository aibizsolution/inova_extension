(function initStoreView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    return `
      <section class="inova-tool-section inova-tool-section--store">
        ${renderBody(state)}
      </section>
    `;
  }

  function renderBody(state) {
    const globalFeedback = state.feedback?.entryId ? null : state.feedback;
    const statusText = state.queryDirty ? "엔터를 눌러 검색" : "";
    const itemsHtml = state.items.length
      ? state.items.map((item) => renderItem(item, state)).join("")
      : state.loading
        ? `<div class="inova-bookmark-empty">스토어를 불러오는 중이에요.</div>`
      : state.identityPending
        ? `<div class="inova-bookmark-empty">사용자 정보를 확인하는 중이에요.</div>`
      : `<div class="inova-bookmark-empty">${escapeHtml(state.emptyText)}</div>`;

    return `
      <div class="inova-tool-toolbar is-stacked">
        <input
          class="inova-tool-search"
          type="search"
          value="${escapeHtml(state.query)}"
          data-search-tool="store"
          placeholder="스토어에서 프롬프트 찾기"
        />
        ${statusText ? `<div class="inova-tool-toolbar__row"><div class="inova-tool-meta">${statusText}</div></div>` : ""}
        <div class="inova-store-controls">
          ${renderScopeToggle(state.ownerScope)}
          ${renderCategorySelect(state.categories, state.categoryId)}
        </div>
        <div class="inova-store-sort">
          ${renderSort("latest", "최신순", state.sortBy)}
          ${renderSort("likes", "좋아요순", state.sortBy)}
          ${renderSort("imports", "가져오기순", state.sortBy)}
          ${renderSort("views", "조회수순", state.sortBy)}
        </div>
      </div>
      ${renderFeedback(globalFeedback)}
      ${renderDegradedNotice(state)}
      ${state.error ? `<p class="inova-inline-feedback is-error">${escapeHtml(state.error)}</p>` : ""}
      <div class="inova-store-list" data-store-list="true" data-store-has-more="${state.hasMore}" data-store-loading="${state.loading}">${itemsHtml}</div>
      ${state.loading && state.items.length ? '<div class="inova-store-list__footer">더 불러오는 중...</div>' : ""}
    `;
  }

  function renderDegradedNotice(state) {
    if (!state.degraded) {
      return "";
    }
    const message = buildDegradedNotice(state);
    if (!message) {
      return "";
    }
    return `<p class="inova-inline-feedback">${escapeHtml(message)}</p>`;
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
    const expandable = Boolean(item?.hasDetail || String(item?.content || item?.summary || "").trim());
    const expanded = expandable && state.expandedEntryId === item.entryId;
    const detailPending = expanded && state.detailPendingEntryId === item.entryId && !item.content;
    const owned = item.owner.providerUserKey && item.owner.providerUserKey === state.providerUserKey;
    const systemOwned = item.owner.kind === "system";
    const itemFeedback = state.feedback?.entryId === item.entryId ? state.feedback : null;
    const deleteConfirm = state.deleteConfirmEntryId === item.entryId;
    const importing = state.actionPending?.type === "import" && state.actionPending.entryId === item.entryId;
    const liking = state.actionPending?.type === "like" && state.actionPending.entryId === item.entryId;
    const unpublishing = state.actionPending?.type === "unpublish" && state.actionPending.entryId === item.entryId;
    const actionDisabled = importing || liking || unpublishing;
    const ownerLabel = systemOwned
      ? "시스템 에이전트 스타터"
      : item.owner.maskedEmail
        ? `${item.owner.displayName} · ${item.owner.maskedEmail}`
        : item.owner.displayName;
    return `
      <article
        class="inova-prompt-item inova-store-item ${expanded ? "is-expanded" : ""}"
        data-store-card="${expandable ? "true" : "false"}"
        data-store-entry-id="${escapeHtml(item.entryId)}"
        ${expandable ? `tabindex="0" aria-label="${escapeHtml(`${item.title} 상세 ${expanded ? "접기" : "보기"}`)}"` : ""}
      >
        <div class="inova-store-item__header">
          <div class="inova-store-item__main">
            <div class="inova-store-item__eyebrow">
              <span class="inova-store-item__category">${escapeHtml(getCompactCategoryLabel(item.categoryId, item.categoryLabel))}</span>
              ${systemOwned ? '<span class="inova-store-item__source">시스템</span>' : ""}
              ${renderOwnerInfo(ownerLabel, item.publishedAt)}
            </div>
            <strong class="inova-prompt-item__title inova-store-item__title">${escapeHtml(item.title)}</strong>
          </div>
          <div class="inova-store-item__side">
            ${renderStoreMenu(item, { actionDisabled, deleteConfirm, liking, owned })}
          </div>
        </div>
        <div class="inova-store-item__summary-row" aria-label="스토어 통계">
          <div class="inova-store-item__metrics">
            ${renderMetric("views", "조회수", item.metrics.viewCount)}
            ${renderMetric("imports", "가져오기 수", item.metrics.importCount)}
            ${renderMetric("likes", "좋아요 수", item.metrics.likeCount)}
          </div>
        </div>
        ${expanded ? renderExpandedContent(item, detailPending) : ""}
        ${expanded ? renderStoreItemActions(item, { actionDisabled, importing, liking }) : ""}
        ${itemFeedback ? renderFeedback(itemFeedback) : ""}
        ${deleteConfirm ? renderDeleteConfirm(item.entryId, item.title, unpublishing) : ""}
      </article>
    `;
  }

  function renderStoreItemActions(item, options = {}) {
    return `
      <div class="inova-prompt-item__actions inova-store-item__detail-actions">
        <button
          type="button"
          class="inova-tool-button inova-tool-button--compact inova-tool-button--with-icon is-primary"
          data-store-action="import"
          data-store-entry-id="${item.entryId}"
          ${renderDisabled(options.actionDisabled)}
        >
          <span class="inova-tool-inline-icon is-import" aria-hidden="true"></span>
          <span>${options.importing ? "가져오는 중..." : "가져오기"}</span>
        </button>
        <button
          type="button"
          class="inova-tool-button inova-tool-button--compact inova-tool-button--with-icon inova-store-item__like-button ${item.viewer.liked ? "is-primary" : ""}"
          data-store-action="toggle-like"
          data-store-entry-id="${item.entryId}"
          aria-pressed="${item.viewer.liked}"
          ${renderDisabled(options.actionDisabled)}
        >
          <span class="inova-tool-inline-icon is-like" aria-hidden="true"></span>
          <span aria-hidden="true">${Number(item.metrics.likeCount) || 0}</span>
          <span class="inova-sr-only">${options.liking ? "좋아요 처리 중" : item.viewer.liked ? "좋아요 취소" : "좋아요"}</span>
        </button>
      </div>
    `;
  }

  function renderStoreMenu(item, options = {}) {
    if (!options.owned) {
      return "";
    }
    return `
      <details class="inova-prompt-item__menu inova-store-item__menu" data-store-menu="true">
        <summary class="inova-tool-button inova-tool-icon-button inova-prompt-item__menu-trigger" aria-label="스토어 항목 메뉴" title="스토어 항목 메뉴">
          <span aria-hidden="true">…</span>
          <span class="inova-sr-only">스토어 항목 메뉴</span>
        </summary>
        <div class="inova-prompt-item__menu-popover inova-store-item__menu-popover" role="menu" aria-label="스토어 항목 작업">
          ${renderStoreMenuItem("request-unpublish", item.entryId, "delete", options.deleteConfirm ? "삭제 취소" : "스토어 삭제", options.actionDisabled, !options.deleteConfirm)}
        </div>
      </details>
    `;
  }

  function renderStoreMenuItem(action, entryId, icon, label, disabled, danger = false, pressed = null) {
    return `
      <button
        type="button"
        class="inova-prompt-item__menu-item ${danger ? "is-danger" : ""}"
        data-store-action="${escapeHtml(action)}"
        data-store-entry-id="${escapeHtml(entryId)}"
        role="menuitem"
        ${pressed === null ? "" : `aria-pressed="${pressed ? "true" : "false"}"`}
        ${renderDisabled(disabled)}
      >
        <span class="inova-tool-inline-icon is-${escapeHtml(icon)}" aria-hidden="true"></span>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  function renderOwnerInfo(ownerLabel, publishedAt) {
    const dateText = formatDate(publishedAt);
    const tooltip = dateText
      ? `등록자: ${ownerLabel}\n등록일: ${dateText}`
      : `등록자: ${ownerLabel}`;
    return `
      <span class="inova-store-item__owner-info" data-store-owner-info="true" tabindex="0" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
        <span aria-hidden="true">i</span>
      </span>
    `;
  }

  function renderFeedback(feedback) {
    if (!feedback?.message) {
      return "";
    }
    return `<p class="inova-inline-feedback ${feedback.tone === "error" ? "is-error" : ""}">${escapeHtml(feedback.message)}</p>`;
  }

  function buildDegradedNotice(state) {
    if (state.dataFreshness === "stale" || state.source === "cache") {
      return "실시간 구독과 추가 읽기가 흔들려 이전에 읽은 스토어 목록을 그대로 보여주고 있어요. 최신 상태가 아닐 수 있습니다.";
    }
    if (state.dataFreshness === "empty") {
      return "스토어 최신 목록을 읽지 못해 비어 있는 상태로 남아 있어요. 잠시 후 다시 시도해 주세요.";
    }
    if (state.source === "runtime-read") {
      return "실시간 구독이 불안정해 요청형 읽기로 다시 가져온 최신 목록을 표시 중이에요.";
    }
    return "스토어 목록을 제한 모드로 표시 중이에요.";
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

  function renderExpandedContent(item, detailPending) {
    if (detailPending) {
      return '<p class="inova-store-item__summary">프롬프트를 불러오는 중이에요.</p>';
    }
    const detailText = String(item.content || item.summary || "").trim();
    if (!detailText) {
      return '<p class="inova-store-item__summary">상세 내용을 다시 불러와 주세요.</p>';
    }
    return `<p class="inova-prompt-item__content">${escapeHtmlWithLineBreaks(detailText)}</p>`;
  }

  function renderMetric(icon, label, value) {
    return `
      <span class="inova-store-metric" title="${escapeHtml(label)}">
        <span class="inova-store-metric__icon" data-icon="${icon}" aria-hidden="true"></span>
        <span class="inova-sr-only">${escapeHtml(label)} </span>
        <span>${Number(value) || 0}</span>
      </span>
    `;
  }

  function getCompactCategoryLabel(categoryId, fallbackLabel) {
    const overrides = {
      "business-product": "비즈니스",
      "developer-experience": "개발 경험",
      "language-specialists": "프레임워크",
      "meta-orchestration": "오케스트레이션",
      "quality-security": "품질/보안",
      "research-analysis": "리서치",
      "specialized-domains": "도메인",
    };
    return overrides[categoryId] || fallbackLabel || "기타";
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeHtmlWithLineBreaks(text) {
    return escapeHtml(text).replace(/\r?\n/g, "<br />");
  }

  function renderDisabled(disabled) {
    return disabled ? 'disabled aria-disabled="true"' : "";
  }

  namespace.storeView = {
    render,
    renderBody,
  };
})(globalThis);
