(function initContentPanel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  function ensurePanel(callbacks) {
    let host = document.getElementById("inova-bookmark-host");
    if (host) return host;
    host = document.createElement("div");
    host.id = "inova-bookmark-host";
    host.innerHTML = buildMarkup();
    document.body.appendChild(host);
    const root = host.querySelector("#inova-bookmark-root");
    const handle = host.querySelector("#inova-bookmark-handle");
    const close = host.querySelector("#inova-bookmark-close");
    const search = host.querySelector("#inova-bookmark-search");
    const results = host.querySelector("#inova-bookmark-results");
    installHandleInteractions(host, handle, callbacks);
    close.addEventListener("click", () => callbacks.onToggle(false));
    search.addEventListener("input", (event) => callbacks.onSearch(event.target.value));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.dataset.open === "true") callbacks.onToggle(false);
    });
    results.addEventListener("click", async (event) => {
      const copyButton = event.target.closest("[data-copy-bookmark-id]");
      if (copyButton) {
        const copied = await callbacks.onCopy?.(copyButton.dataset.copyBookmarkId);
        flashCopyState(copyButton, copied);
        return;
      }
      const button = event.target.closest("[data-bookmark-id]");
      if (!button) return;
      button.closest(".inova-bookmark-item")?.focus({ preventScroll: true });
      callbacks.onJump(button.dataset.bookmarkId);
    });
    results.addEventListener("keydown", (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (moveBookmarkFocus(results, event.target, event.key === "ArrowDown" ? 1 : -1)) {
          event.preventDefault();
        }
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const item = event.target.closest("[data-bookmark-id]");
      if (!item || event.target.closest("[data-copy-bookmark-id]")) return;
      event.preventDefault();
      item.closest(".inova-bookmark-item")?.focus({ preventScroll: true });
      callbacks.onJump(item.dataset.bookmarkId);
    });
    return host;
  }
  function installHandleInteractions(host, handle, callbacks) {
    const dragState = {
      dragging: false,
      moved: false,
      pointerId: -1,
      startRatio: 0,
      startY: 0,
    };
    handle.addEventListener("click", (event) => {
      if (dragState.moved) {
        event.preventDefault();
        dragState.moved = false;
        return;
      }
      callbacks.onToggle();
    });
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragState.dragging = true;
      dragState.moved = false;
      dragState.pointerId = event.pointerId;
      dragState.startY = event.clientY;
      dragState.startRatio = readHandleRatio(host);
      handle.classList.add("is-dragging");
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragState.dragging || event.pointerId !== dragState.pointerId) return;
      const deltaY = event.clientY - dragState.startY;
      const nextRatio = getDraggedHandleRatio(dragState.startRatio, deltaY, handle.offsetHeight);
      if (Math.abs(deltaY) > 6) dragState.moved = true;
      applyHandleRatio(host, nextRatio);
    });
    handle.addEventListener("pointerup", (event) => finishHandleDrag(event, host, handle, callbacks, dragState));
    handle.addEventListener("pointercancel", (event) => finishHandleDrag(event, host, handle, callbacks, dragState));
  }
  function finishHandleDrag(event, host, handle, callbacks, dragState) {
    if (!dragState.dragging || event.pointerId !== dragState.pointerId) return;
    const nextRatio = readHandleRatio(host);
    dragState.dragging = false;
    dragState.pointerId = -1;
    handle.classList.remove("is-dragging");
    handle.releasePointerCapture?.(event.pointerId);
    if (dragState.moved) callbacks.onHandlePositionChange(nextRatio);
  }
  function getDraggedHandleRatio(startRatio, deltaY, handleHeight) {
    const trackHeight = getHandleTrackHeight(handleHeight);
    if (trackHeight <= 0) return startRatio;
    return clampRatio(startRatio + deltaY / trackHeight);
  }
  function getHandleTrackHeight(handleHeight) {
    const viewportHeight = global.innerHeight || document.documentElement.clientHeight || 0;
    const safeTop = viewportHeight <= 760 ? 72 : 96;
    const safeBottom = viewportHeight <= 760 ? 18 : 24;
    return Math.max(1, viewportHeight - safeTop - safeBottom - handleHeight);
  }
  function applyHandleRatio(host, value) {
    host.style.setProperty("--handle-ratio", String(clampRatio(value)));
  }
  function readHandleRatio(host) {
    const ratio = Number.parseFloat(host.style.getPropertyValue("--handle-ratio"));
    return clampRatio(Number.isFinite(ratio) ? ratio : 0.4);
  }
  function clampRatio(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }
  function buildMarkup() {
    return `
      <div id="inova-bookmark-root" data-open="false" aria-live="polite">
        <button id="inova-bookmark-handle" type="button" aria-label="질문 모아보기 열기" title="드래그해서 위치를 바꿀 수 있어요">
          <span class="handle-count">0</span>
          <span class="handle-label"><span>질</span><span>문</span></span>
        </button>
        <div id="inova-bookmark-panel">
          <header id="inova-bookmark-header">
            <div id="inova-bookmark-title-row">
              <div id="inova-bookmark-title">
                <div class="bookmark-title-main">
                  <strong>질문 모아보기</strong>
                  <span id="inova-bookmark-total" class="inova-bookmark-badge inova-bookmark-badge--header">0</span>
                </div>
              </div>
              <button id="inova-bookmark-close" type="button" aria-label="질문 모아보기 닫기">닫기</button>
            </div>
            <input id="inova-bookmark-search" type="search" placeholder="이 대화에서 질문 찾기" />
            <div id="inova-bookmark-meta" hidden>
              <span id="inova-bookmark-status">아직 질문이 없어요</span>
            </div>
          </header>
          <section id="inova-bookmark-results"></section>
        </div>
      </div>
    `;
  }

  function renderPanel(state) {
    const host = document.getElementById("inova-bookmark-host");
    if (!host) return;
    const root = host.querySelector("#inova-bookmark-root");
    const total = host.querySelector("#inova-bookmark-total");
    const meta = host.querySelector("#inova-bookmark-meta");
    const status = host.querySelector("#inova-bookmark-status");
    const search = host.querySelector("#inova-bookmark-search");
    const results = host.querySelector("#inova-bookmark-results");
    const handleCount = host.querySelector(".handle-count");
    root.hidden = !state.visible;
    root.dataset.open = String(state.open);
    document.body.classList.toggle("inova-bookmark-panel-open", Boolean(state.visible && state.open));
    applyHandleRatio(host, state.handleRatio);
    search.value = state.query || "";
    search.tabIndex = state.open ? 0 : -1;
    total.textContent = String(state.bookmarks.length);
    status.textContent = getMetaText(state);
    meta.hidden = !shouldShowMeta(state);
    handleCount.textContent = String(state.bookmarks.length);
    results.innerHTML = state.filteredBookmarks.length
      ? state.filteredBookmarks
          .map((bookmark) => renderBookmark(bookmark, state.query))
          .join("")
      : `<div class="inova-bookmark-empty">${state.emptyText}</div>`;
    setActiveBookmark(state.activeId);
  }
  function shouldShowMeta(state) {
    if (state.query) return true;
    return state.filteredBookmarks.length === 0;
  }
  function getMetaText(state) {
    if (state.query) return `검색 결과 ${state.filteredBookmarks.length}개`;
    return state.statusText;
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
        <button
          class="bookmark-jump"
          type="button"
          data-bookmark-id="${bookmark.id}"
          tabindex="-1"
          aria-hidden="true"
        >
          <span class="bookmark-text">${renderQuestionText(bookmark.text, query)}</span>
        </button>
      </article>
    `;
  }

  function flashCopyState(button, copied) {
    if (!(button instanceof HTMLElement)) return;
    button.innerHTML = renderCopyIcon(copied ? "copied" : "failed");
    button.classList.toggle("is-copied", Boolean(copied));
    button.classList.toggle("is-failed", !copied);
    button.setAttribute("title", copied ? "복사됨" : "복사 실패");
    global.clearTimeout(Number(button.dataset.resetTimer || 0));
    button.dataset.resetTimer = String(
      global.setTimeout(() => {
        button.innerHTML = renderCopyIcon();
        button.classList.remove("is-copied", "is-failed");
        button.setAttribute("title", "질문 복사");
      }, copied ? 1200 : 1500)
    );
  }

  function renderCopyIcon(state = "default") {
    if (state === "copied") return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2 6.4 11 12.5 4.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    if (state === "failed") return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M5 5 11 11M11 5 5 11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>';
    return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><rect x="5.2" y="3.2" width="7.1" height="9" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M3.7 10.6H3A1.3 1.3 0 0 1 1.7 9.3V4.6A1.3 1.3 0 0 1 3 3.3h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>';
  }
  function renderQuestionText(text, query) {
    const preview = namespace.session.clipPreview(text);
    const normalizedQuery = namespace.session.normalizeText(query || "");
    if (!normalizedQuery) return escapeHtml(preview);
    const lowerPreview = preview.toLowerCase();
    const lowerQuery = normalizedQuery.toLowerCase();
    const start = lowerPreview.indexOf(lowerQuery);
    if (start === -1) return escapeHtml(preview);
    const end = start + normalizedQuery.length;
    return [
      escapeHtml(preview.slice(0, start)),
      `<mark class="bookmark-highlight">${escapeHtml(preview.slice(start, end))}</mark>`,
      escapeHtml(preview.slice(end)),
    ].join("");
  }
  function escapeHtml(text) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setActiveBookmark(bookmarkId) {
    const results = document.getElementById("inova-bookmark-results");
    if (!results) return;
    for (const item of results.querySelectorAll(".inova-bookmark-item.is-active")) item.classList.remove("is-active");
    if (!bookmarkId) return;
    const activeItem = results.querySelector(`.inova-bookmark-item[data-bookmark-id="${CSS.escape(bookmarkId)}"]`);
    activeItem?.classList.add("is-active");
    syncActiveBookmarkPosition(results, activeItem);
  }
  function syncActiveBookmarkPosition(results, activeItem) {
    if (!(activeItem instanceof HTMLElement)) return;
    const items = Array.from(results.querySelectorAll(".inova-bookmark-item"));
    const index = items.indexOf(activeItem);
    if (index === -1) return;
    if (index === 0) return void results.scrollTo({ top: 0, behavior: "smooth" });
    if (index === items.length - 1) return void results.scrollTo({ top: results.scrollHeight - results.clientHeight, behavior: "smooth" });
    activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function focusBookmark(bookmarkId) {
    if (!bookmarkId) return;
    document
      .querySelector(`.inova-bookmark-item[data-bookmark-id="${CSS.escape(bookmarkId)}"]`)
      ?.focus({ preventScroll: true });
  }
  function moveBookmarkFocus(results, target, step) {
    const items = Array.from(results.querySelectorAll(".inova-bookmark-item"));
    if (!items.length) return false;
    const current = target.closest(".inova-bookmark-item");
    if (!current) return false;
    const index = items.indexOf(current);
    if (index === -1) return false;
    const nextIndex = Math.min(items.length - 1, Math.max(0, index + step));
    if (nextIndex === index) return true;
    const nextItem = items[nextIndex];
    nextItem.focus({ preventScroll: true });
    nextItem.scrollIntoView({ block: "nearest" });
    nextItem.click();
    return true;
  }
  namespace.contentPanel = {
    ensurePanel,
    focusBookmark,
    renderPanel,
    setActiveBookmark,
  };
})(globalThis);
