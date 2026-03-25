(function initPromptView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const showEmptyState = !state.items.length && !state.editor?.open && !state.importReview;
    const hasInlineFeedback = state.feedback?.promptId && state.items.some((item) => item.id === state.feedback.promptId);
    const itemsHtml = state.items.length
      ? state.items.map((item) => renderPromptItem(item, state)).join("")
      : showEmptyState
        ? `<div class="inova-bookmark-empty">${escapeHtml(state.emptyText)}</div>`
        : "";

    return `
      <section class="inova-tool-section inova-tool-section--prompts">
        <div class="inova-tool-toolbar is-stacked">
          <input
            class="inova-tool-search"
            type="search"
            value="${escapeHtml(state.query)}"
            data-search-tool="prompts"
            placeholder="자주 쓰는 요청 찾기"
          />
          <div class="inova-tool-toolbar__row">
            <div class="inova-tool-meta">총 ${state.totalCount}개</div>
            <div class="inova-tool-actions inova-tool-actions--toolbar">
              <button type="button" class="inova-tool-button is-primary" data-prompt-action="create">추가</button>
              <button type="button" class="inova-tool-button" data-prompt-action="import">가져오기</button>
              <button
                type="button"
                class="inova-tool-button"
                data-prompt-action="export"
                ${state.totalCount ? "" : "disabled"}
              >내보내기</button>
            </div>
        </div>
        </div>
        ${hasInlineFeedback ? "" : renderFeedback(state.feedback)}
        ${renderImportReview(state.importReview)}
        ${renderEditor(state.editor)}
        <div class="inova-prompt-list">${itemsHtml}</div>
      </section>
    `;
  }

  function renderPromptItem(item, state) {
    const menuOpen = state.menuPromptId === item.id;
    const deleteConfirm = state.deletePromptId === item.id;
    const pendingInsert = state.pendingInsert?.promptId === item.id;
    const itemFeedback = state.feedback?.promptId === item.id ? state.feedback : null;
    const publishOpen = state.publishPromptId === item.id;
    const deletePending = state.actionPending?.type === "delete" && state.actionPending.promptId === item.id;
    const publishPending = state.actionPending?.type === "publish" && state.actionPending.promptId === item.id;

    return `
      <article class="inova-prompt-item" data-prompt-id="${item.id}">
        <div class="inova-prompt-item__head">
          <div class="inova-prompt-item__title-row">
            <button
              type="button"
              class="inova-prompt-drag-handle"
              data-prompt-drag-handle="${item.id}"
              aria-label="${escapeHtml(item.title)} 순서 변경"
              title="드래그해서 순서를 바꿀 수 있어요"
            >⋮⋮</button>
            <strong class="inova-prompt-item__title">${escapeHtml(item.title)}</strong>
          </div>
          <div class="inova-prompt-item__meta">
            <span class="inova-prompt-item__date">${formatDate(item.updatedAt)}</span>
            <button type="button" class="inova-tool-button inova-tool-button--compact" data-prompt-action="toggle-menu" data-prompt-id="${item.id}" ${renderDisabled(deletePending || publishPending)}>
              ${menuOpen ? "닫기" : "관리"}
            </button>
          </div>
        </div>
        <p class="inova-prompt-item__content">${escapeHtml(item.content)}</p>
        <div class="inova-prompt-item__actions">
          <button type="button" class="inova-tool-button is-primary" data-prompt-action="use" data-prompt-id="${item.id}">
            입력창에 넣기
          </button>
        </div>
        ${itemFeedback ? renderFeedback(itemFeedback) : ""}
        ${pendingInsert ? renderPendingInsert() : ""}
        ${menuOpen ? renderPromptMenu(item.id, deletePending || publishPending) : ""}
        ${publishOpen ? renderPublishForm(item.id, state.storeCategories, state.publishCategoryId, state.publishTitle, state.publishError, publishPending) : ""}
        ${deleteConfirm ? renderDeleteConfirm(item.id, item.title, deletePending) : ""}
      </article>
    `;
  }

  function renderPromptMenu(promptId, disabled) {
    return `
      <div class="inova-prompt-item__menu" data-prompt-menu>
        <button type="button" class="inova-tool-button" data-prompt-action="edit" data-prompt-id="${promptId}" ${renderDisabled(disabled)}>수정</button>
        <button type="button" class="inova-tool-button" data-prompt-action="open-publish" data-prompt-id="${promptId}" ${renderDisabled(disabled)}>스토어 등록</button>
        <button type="button" class="inova-tool-button is-danger" data-prompt-action="request-delete" data-prompt-id="${promptId}" ${renderDisabled(disabled)}>삭제</button>
      </div>
    `;
  }

  function renderPublishForm(promptId, categories, activeCategoryId, publishTitle, publishError, pending) {
    return `
      <section class="inova-inline-feedback">
        <strong>스토어 등록</strong>
        <span>스토어에는 별도 복사본으로 올라가요. 나중에 내 요청을 수정해도 스토어 항목은 바뀌지 않아요.</span>
        <label class="inova-prompt-field">
          <span>스토어 제목</span>
          <input
            type="text"
            value="${escapeHtml(publishTitle || "")}"
            data-prompt-publish-field="title"
            data-prompt-id="${promptId}"
            placeholder="스토어에서 보여줄 제목"
            ${renderDisabled(pending)}
          />
        </label>
        <label class="inova-tool-select-field">
          <span>카테고리</span>
          <select class="inova-tool-select" data-prompt-select="publish-category" data-prompt-id="${promptId}" ${renderDisabled(pending)}>
            ${categories.map((category) => `
              <option value="${category.id}" ${category.id === activeCategoryId ? "selected" : ""}>${escapeHtml(category.label)}</option>
            `).join("")}
          </select>
        </label>
        ${publishError ? `<p class="inova-inline-feedback is-error">${escapeHtml(publishError)}</p>` : ""}
        <div class="inova-tool-actions">
          <button type="button" class="inova-tool-button is-primary" data-prompt-action="confirm-publish" data-prompt-id="${promptId}" ${renderDisabled(pending)}>${pending ? "등록 중..." : "등록"}</button>
          <button type="button" class="inova-tool-button" data-prompt-action="cancel-publish" ${renderDisabled(pending)}>취소</button>
        </div>
      </section>
    `;
  }

  function renderDeleteConfirm(promptId, title, pending) {
    return `
      <section class="inova-inline-feedback is-warning">
        <strong>${escapeHtml(title)}</strong>
        <span>이 요청을 삭제할까요? 삭제 후에는 바로 복구되지 않아요.</span>
        <div class="inova-tool-actions">
          <button type="button" class="inova-tool-button is-danger" data-prompt-action="confirm-delete" data-prompt-id="${promptId}" ${renderDisabled(pending)}>${pending ? "삭제 중..." : "삭제"}</button>
          <button type="button" class="inova-tool-button" data-prompt-action="cancel-delete" ${renderDisabled(pending)}>취소</button>
        </div>
      </section>
    `;
  }

  function renderEditor(editor) {
    if (!editor?.open) {
      return "";
    }
    const pending = editor.actionPending?.type === "save-editor";

    return `
      <section class="inova-prompt-editor">
        <div class="inova-prompt-editor__head">
          <div class="inova-prompt-editor__headline">
            <strong>${escapeHtml(editor.titleText)}</strong>
            <span
              class="inova-help-chip"
              tabindex="0"
              aria-label="${escapeHtml(editor.description)}"
              title="${escapeHtml(editor.description)}"
            >?</span>
          </div>
        </div>
        <div class="inova-prompt-editor__fields">
          <label class="inova-prompt-field">
            <span>이름</span>
            <input
              type="text"
              value="${escapeHtml(editor.title)}"
              data-prompt-field="title"
              placeholder="예: 회의록 정리"
              ${renderDisabled(pending)}
            />
          </label>
          <label class="inova-prompt-field">
            <span>본문</span>
            <textarea rows="7" data-prompt-field="content" placeholder="입력창에 바로 넣을 요청을 적어 주세요." ${renderDisabled(pending)}>${escapeHtml(editor.content)}</textarea>
          </label>
        </div>
        ${editor.error ? `<p class="inova-inline-feedback is-error">${escapeHtml(editor.error)}</p>` : ""}
        <div class="inova-tool-actions inova-prompt-editor__actions">
          <button type="button" class="inova-tool-button is-primary" data-prompt-action="save-editor" ${renderDisabled(pending)}>${pending ? "저장 중..." : escapeHtml(editor.submitLabel)}</button>
          <button type="button" class="inova-tool-button" data-prompt-action="cancel-editor" ${renderDisabled(pending)}>취소</button>
        </div>
      </section>
    `;
  }

  function renderPendingInsert() {
    return `
      <section class="inova-inline-feedback">
        <span>입력창에 내용이 이미 있어요. 어떻게 넣을지 선택해 주세요.</span>
        <div class="inova-tool-actions">
          <button type="button" class="inova-tool-button is-primary" data-prompt-action="confirm-insert" data-insert-mode="replace">덮어쓰기</button>
          <button type="button" class="inova-tool-button" data-prompt-action="confirm-insert" data-insert-mode="append">이어붙이기</button>
          <button type="button" class="inova-tool-button" data-prompt-action="cancel-insert">취소</button>
        </div>
      </section>
    `;
  }

  function renderImportReview(review) {
    if (!review) {
      return "";
    }

    return `
      <section class="inova-import-review">
        <div class="inova-import-review__head">
          <strong>${escapeHtml(review.fileName || "가져오기 파일")}</strong>
          <span>${escapeHtml(review.libraryName || "요청 묶음")}</span>
        </div>
        <div class="inova-import-review__summary">
          <span>들어오는 항목 ${review.summary.incoming}개</span>
          <span>추가 ${review.summary.added}개</span>
          <span>업데이트 ${review.summary.updated}개</span>
          <span>건너뜀 ${review.summary.skipped}개</span>
          ${review.mode === "replace" ? `<span>교체 대상 ${review.summary.removed}개</span>` : ""}
        </div>
        <div class="inova-import-review__modes">
          ${["add", "merge", "replace"].map((mode) => renderImportMode(mode, review.mode)).join("")}
        </div>
        <p class="inova-import-review__help">${getImportModeHelp(review.mode)}</p>
        ${review.confirmReplace ? '<p class="inova-inline-feedback is-warning">현재 보관함을 완전히 바꾸려면 한 번 더 확인해 주세요.</p>' : ""}
        <div class="inova-tool-actions">
          <button type="button" class="inova-tool-button ${review.confirmReplace ? "is-danger" : "is-primary"}" data-prompt-action="apply-import">${review.confirmReplace ? "완전 교체 실행" : "가져오기 적용"}</button>
          <button type="button" class="inova-tool-button" data-prompt-action="cancel-import">취소</button>
        </div>
      </section>
    `;
  }

  function renderImportMode(mode, activeMode) {
    return `
      <button
        type="button"
        class="inova-tool-pill ${mode === activeMode ? "is-active" : ""}"
        data-import-mode="${mode}"
      >${getImportModeLabel(mode)}</button>
    `;
  }

  function renderFeedback(feedback) {
    if (!feedback?.message) {
      return "";
    }

    return `<p class="inova-inline-feedback ${feedback.tone === "error" ? "is-error" : ""}">${escapeHtml(feedback.message)}</p>`;
  }

  function renderDisabled(disabled) {
    return disabled ? 'disabled aria-disabled="true"' : "";
  }

  function getImportModeLabel(mode) {
    if (mode === "add") return "추가";
    if (mode === "merge") return "병합";
    return "완전 교체";
  }

  function getImportModeHelp(mode) {
    if (mode === "add") return "겹치는 항목은 건너뛰고 새로운 요청만 추가해요.";
    if (mode === "merge") return "같은 요청은 덮어쓰고, 없는 요청은 새로 추가해요.";
    return "현재 보관함을 비우고 가져온 요청 묶음으로 바꿔요.";
  }

  function formatDate(value) {
    const time = Date.parse(value || "");
    if (!time) {
      return "";
    }

    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
    }).format(time);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  namespace.promptView = {
    render,
  };
})(globalThis);
