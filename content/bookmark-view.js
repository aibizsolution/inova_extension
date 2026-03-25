(function initBookmarkView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function renderTool(state) {
    const listHtml = state.items.length
      ? state.items.map((bookmark) => renderBookmark(bookmark, state.query)).join("")
      : `<div class="inova-bookmark-empty">${escapeHtml(state.emptyText)}</div>`;

    return `
      <section class="inova-tool-section">
        <div class="inova-tool-toolbar is-stacked">
          <input
            class="inova-tool-search"
            type="search"
            value="${escapeHtml(state.query)}"
            data-search-tool="bookmarks"
            placeholder="이 대화에서 질문 찾기"
          />
          ${state.metaText ? `<div class="inova-tool-meta">${escapeHtml(state.metaText)}</div>` : ""}
        </div>
        <div id="inova-bookmark-results">${listHtml}</div>
      </section>
    `;
  }

  function renderBookmark(bookmark, query) {
    return `
      <article
        class="inova-bookmark-item"
        data-bookmark-id="${bookmark.id}"
        tabindex="0"
        title="${escapeHtml(bookmark.text)}"
        aria-label="${bookmark.order}번 질문으로 이동"
      >
        <span class="bookmark-topline">
          <span class="bookmark-index">${bookmark.order}</span>
          <button
            class="bookmark-copy"
            type="button"
            data-copy-bookmark-id="${bookmark.id}"
            aria-label="${bookmark.order}번 질문 복사"
            title="질문 복사"
          >${renderCopyIcon()}</button>
        </span>
        <button class="bookmark-jump" type="button" data-bookmark-id="${bookmark.id}" tabindex="-1" aria-hidden="true">
          <span class="bookmark-text">${renderQuestionText(bookmark.text, query)}</span>
        </button>
      </article>
    `;
  }

  function renderCopyIcon(state = "default") {
    if (state === "copied") return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2 6.4 11 12.5 4.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    if (state === "failed") return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M5 5 11 11M11 5 5 11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>';
    return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><rect x="5.2" y="3.2" width="7.1" height="9" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M3.7 10.6H3A1.3 1.3 0 0 1 1.7 9.3V4.6A1.3 1.3 0 0 1 3 3.3h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>';
  }

  function renderQuestionText(text, query) {
    const preview = namespace.session.clipPreview(text);
    const normalizedQuery = namespace.session.normalizeText(query || "").toLowerCase();
    if (!normalizedQuery) {
      return escapeHtml(preview);
    }

    const lowerPreview = preview.toLowerCase();
    const start = lowerPreview.indexOf(normalizedQuery);
    if (start === -1) {
      return escapeHtml(preview);
    }

    const end = start + normalizedQuery.length;
    return `${escapeHtml(preview.slice(0, start))}<mark class="bookmark-highlight">${escapeHtml(preview.slice(start, end))}</mark>${escapeHtml(preview.slice(end))}`;
  }

  function flashCopyState(button, copied) {
    button.innerHTML = renderCopyIcon(copied ? "copied" : "failed");
    button.classList.toggle("is-copied", Boolean(copied));
    button.classList.toggle("is-failed", !copied);
    button.setAttribute("title", copied ? "복사됨" : "복사 실패");
    global.clearTimeout(Number(button.dataset.resetTimer || 0));
    button.dataset.resetTimer = String(global.setTimeout(() => resetCopyButton(button), copied ? 1200 : 1500));
  }

  function resetCopyButton(button) {
    button.innerHTML = renderCopyIcon();
    button.classList.remove("is-copied", "is-failed");
    button.setAttribute("title", "질문 복사");
  }

  function setActive(bookmarkId) {
    const results = document.getElementById("inova-bookmark-results");
    if (!results) {
      return;
    }

    results.querySelectorAll(".inova-bookmark-item.is-active").forEach((item) => item.classList.remove("is-active"));
    if (!bookmarkId) {
      return;
    }

    const activeItem = results.querySelector(`.inova-bookmark-item[data-bookmark-id="${CSS.escape(bookmarkId)}"]`);
    activeItem?.classList.add("is-active");
    activeItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function focus(bookmarkId) {
    document
      .querySelector(`.inova-bookmark-item[data-bookmark-id="${CSS.escape(bookmarkId)}"]`)
      ?.focus({ preventScroll: true });
  }

  function moveFocus(target, step) {
    const results = document.getElementById("inova-bookmark-results");
    if (!results) {
      return false;
    }

    const items = Array.from(results.querySelectorAll(".inova-bookmark-item"));
    const current = target.closest(".inova-bookmark-item");
    const index = current ? items.indexOf(current) : -1;
    if (index === -1) {
      return false;
    }

    const nextItem = items[Math.min(items.length - 1, Math.max(0, index + step))];
    if (!nextItem) {
      return false;
    }

    nextItem.focus({ preventScroll: true });
    nextItem.scrollIntoView({ block: "nearest" });
    return true;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  namespace.bookmarkView = {
    flashCopyState,
    focus,
    moveFocus,
    renderTool,
    setActive,
  };
})(globalThis);
