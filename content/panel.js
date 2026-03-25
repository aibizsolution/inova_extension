(function initContentPanel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function ensurePanel(callbacks) {
    let host = document.getElementById("inova-bookmark-host");
    if (host) { host.__callbacks = callbacks; return host; }
    host = document.createElement("div");
    host.id = "inova-bookmark-host";
    host.__callbacks = callbacks;
    host.innerHTML = buildMarkup();
    document.body.appendChild(host);

    const handle = host.querySelector("#inova-bookmark-handle");
    const close = host.querySelector("#inova-tool-close");
    const fileInput = host.querySelector("#inova-prompt-import-file");

    installHandleInteractions(host, handle, callbacks);
    close.addEventListener("click", () => callbacks.onToggle(false));
    host.addEventListener("click", (event) => handleRootClick(event, host, callbacks));
    host.addEventListener("scroll", (event) => handleStoreScroll(event, host, callbacks), true);
    host.addEventListener("pointerdown", (event) => handlePromptPointerDown(event, host));
    host.addEventListener("pointermove", (event) => handlePromptPointerMove(event, host));
    host.addEventListener("pointerup", (event) => handlePromptPointerEnd(event, host, callbacks));
    host.addEventListener("pointercancel", (event) => handlePromptPointerEnd(event, host, callbacks));
    host.addEventListener("input", (event) => handleRootInput(event, callbacks));
    host.addEventListener("change", (event) => handleRootChange(event, callbacks));
    host.addEventListener("keydown", (event) => handleRootKeydown(event, callbacks));
    fileInput.addEventListener("change", () => {
      const [file] = Array.from(fileInput.files || []);
      if (file) callbacks.onImportFile?.(file);
      fileInput.value = "";
    });

    return host;
  }

  function renderPanel(state) {
    const host = document.getElementById("inova-bookmark-host");
    if (!host) return;
    const root = host.querySelector("#inova-bookmark-root");
    const previousStoreScrollTop = state.activeTool === "store" ? host.querySelector(".inova-store-list")?.scrollTop || host.__storeScrollTop || 0 : 0;
    root.hidden = !state.visible;
    root.dataset.open = String(state.open);
    document.body.classList.toggle("inova-bookmark-panel-open", Boolean(state.visible && state.open));
    applyHandleRatio(host, state.handleRatio);

    host.querySelector("#inova-tool-rail").innerHTML = renderToolRail(state.tools, state.activeTool);
    host.querySelector("#inova-tool-title").textContent = state.toolTitle;
    host.querySelector("#inova-tool-total").textContent = String(state.toolCount);
    host.querySelector(".handle-count").textContent = String(state.handleCount);
    host.querySelector("#inova-tool-content").innerHTML = state.activeTool === "prompts"
      ? namespace.promptView.render(state.promptTool)
      : state.activeTool === "store"
        ? namespace.storeView.render(state.storeTool)
        : namespace.bookmarkView.renderTool(state.bookmarksTool);
    if (state.activeTool === "store") syncStoreList(host, host.__callbacks, previousStoreScrollTop);

    namespace.bookmarkView.setActive(state.bookmarksTool.activeId);
  }

  function buildMarkup() {
    return `
      <div id="inova-bookmark-root" data-open="false" aria-live="polite">
        <button id="inova-bookmark-handle" type="button" aria-label="실험실 패널 열기" title="드래그해서 위치를 바꿀 수 있어요">
          <span class="handle-count">0</span>
          <span class="handle-label"><span>실</span><span>험</span><span>실</span></span>
        </button>
        <div id="inova-bookmark-panel">
          <div class="inova-tool-shell">
            <nav id="inova-tool-rail" aria-label="실험실 전환"></nav>
            <section class="inova-tool-body">
              <header id="inova-tool-header">
                <div class="bookmark-title-main">
                  <strong id="inova-tool-title">실험실</strong>
                  <span id="inova-tool-total" class="inova-bookmark-badge inova-bookmark-badge--header">0</span>
                </div>
                <button id="inova-tool-close" type="button" aria-label="도구 패널 닫기">닫기</button>
              </header>
              <div id="inova-tool-content"></div>
            </section>
          </div>
          <input id="inova-prompt-import-file" type="file" accept="application/json,.json" hidden />
        </div>
      </div>
    `;
  }

  function renderToolRail(tools, activeTool) {
    return tools
      .map(
        (tool) => `
          <button
            type="button"
            class="inova-tool-rail__button ${tool.id === activeTool ? "is-active" : ""}"
            data-tool-id="${tool.id}"
            aria-pressed="${tool.id === activeTool}"
          >
            <span class="inova-tool-rail__label">${escapeHtml(tool.label)}</span>
            <span class="inova-tool-rail__count">${tool.count}</span>
          </button>
        `
      )
      .join("");
  }

  function handleRootClick(event, host, callbacks) {
    if (!event.target.closest('[data-prompt-menu], [data-prompt-action="toggle-menu"]')) callbacks.onPromptAction?.("dismiss-menu");
    const toolButton = event.target.closest("[data-tool-id]");
    if (toolButton) return void callbacks.onSelectTool?.(toolButton.dataset.toolId);
    const copyButton = event.target.closest("[data-copy-bookmark-id]");
    if (copyButton) {
      callbacks.onCopyBookmark?.(copyButton.dataset.copyBookmarkId).then((copied) => {
        namespace.bookmarkView.flashCopyState(copyButton, copied);
      });
      return;
    }
    const bookmarkButton = event.target.closest("[data-bookmark-id]");
    if (bookmarkButton && !event.target.closest("[data-copy-bookmark-id]")) {
      bookmarkButton.closest(".inova-bookmark-item")?.focus({ preventScroll: true });
      return void callbacks.onJumpBookmark?.(bookmarkButton.dataset.bookmarkId);
    }
    const promptAction = event.target.closest("[data-prompt-action]");
    if (promptAction) {
      if (promptAction.dataset.promptAction === "import") return void host.querySelector("#inova-prompt-import-file")?.click();
      return void callbacks.onPromptAction?.(promptAction.dataset.promptAction, {
        categoryId: promptAction.dataset.categoryId || "",
        insertMode: promptAction.dataset.insertMode || "",
        promptId: promptAction.dataset.promptId || "",
      });
    }
    const storeAction = event.target.closest("[data-store-action]");
    if (storeAction) {
      return void callbacks.onStoreAction?.(storeAction.dataset.storeAction, {
        categoryId: storeAction.dataset.storeCategory || "",
        entryId: storeAction.dataset.storeEntryId || "",
        scope: storeAction.dataset.storeScope || "",
        sortBy: storeAction.dataset.storeSort || "",
      });
    }
    const importMode = event.target.closest("[data-import-mode]");
    if (importMode) {
      callbacks.onPromptAction?.("set-import-mode", {
        importMode: importMode.dataset.importMode || "merge",
      });
    }
  }

  function handleRootInput(event, callbacks) {
    const search = event.target.closest("[data-search-tool]");
    if (search) return void callbacks.onSearch?.(search.dataset.searchTool, search.value);
    const field = event.target.closest("[data-prompt-field]");
    if (field) callbacks.onPromptDraftChange?.(field.dataset.promptField, field.value);
    const publishField = event.target.closest("[data-prompt-publish-field]");
    if (publishField?.dataset.promptPublishField === "title") {
      callbacks.onPromptAction?.("set-publish-title", {
        promptId: publishField.dataset.promptId || "",
        title: publishField.value || "",
      });
    }
  }

  function handleRootChange(event, callbacks) {
    const storeField = event.target.closest("[data-store-field]");
    if (storeField) return void callbacks.onStoreAction?.("set-category", { categoryId: storeField.value || "all" });
    const promptSelect = event.target.closest("[data-prompt-select]");
    if (promptSelect?.dataset.promptSelect === "publish-category") callbacks.onPromptAction?.("set-publish-category", { categoryId: promptSelect.value || "" });
  }

  function handlePromptPointerDown(event, host) {
    const handle = event.target.closest("[data-prompt-drag-handle]");
    if (!(handle instanceof HTMLElement) || event.button !== 0) return;
    const item = handle.closest("[data-prompt-id]");
    const promptId = handle.dataset.promptDragHandle || "";
    if (!promptId || !(item instanceof HTMLElement)) return;
    host.__promptDrag = { handle, placement: "before", promptId, targetPromptId: "" };
    item.classList.add("is-drag-source");
    handle.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);
    host.dataset.dragPointerId = String(event.pointerId);
    event.preventDefault();
  }

  function handlePromptPointerMove(event, host) {
    if (host.dataset.dragPointerId !== String(event.pointerId)) return;
    const dragState = host.__promptDrag;
    if (!dragState?.promptId) return;
    const item = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-prompt-id]");
    if (!(item instanceof HTMLElement)) {
      dragState.targetPromptId = "";
      return void clearPromptDropIndicators(host);
    }
    const targetPromptId = item.dataset.promptId || "";
    if (!targetPromptId || targetPromptId === dragState.promptId) {
      dragState.targetPromptId = "";
      return void clearPromptDropIndicators(host);
    }
    dragState.targetPromptId = targetPromptId;
    dragState.placement = getDropPlacement(item, event.clientY);
    setPromptDropIndicator(host, item, dragState.placement);
  }

  function handlePromptPointerEnd(event, host, callbacks) {
    if (host.dataset.dragPointerId !== String(event.pointerId)) return;
    const dragState = host.__promptDrag;
    dragState?.handle?.releasePointerCapture?.(event.pointerId);
    const dragPromptId = dragState?.promptId || "";
    const targetPromptId = dragState?.targetPromptId || "";
    const placement = dragState?.placement || "before";
    clearPromptDragState(host);
    if (event.type === "pointerup" && dragPromptId && targetPromptId && dragPromptId !== targetPromptId) {
      callbacks.onMovePrompt?.(dragPromptId, targetPromptId, placement);
    }
  }

  function handleRootKeydown(event, callbacks) {
    const root = document.getElementById("inova-bookmark-root");
    if (event.key === "Escape" && root?.dataset.open === "true") {
      if (callbacks.onEscape?.()) { event.preventDefault(); return; }
      return void callbacks.onToggle?.(false);
    }
    if (!(event.target instanceof HTMLElement)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (namespace.bookmarkView.moveFocus(event.target, event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest("[data-bookmark-id]");
    if (!item || event.target.closest("[data-copy-bookmark-id]")) return;
    event.preventDefault();
    callbacks.onJumpBookmark?.(item.dataset.bookmarkId);
  }

  function handleStoreScroll(event, host, callbacks) {
    const list = event.target instanceof HTMLElement ? event.target.closest(".inova-store-list") : null;
    if (!(list instanceof HTMLElement)) return;
    host.__storeScrollTop = list.scrollTop;
    if (list.dataset.storeHasMore !== "true" || list.dataset.storeLoading === "true" || list.scrollHeight - list.clientHeight - list.scrollTop > 72) return;
    callbacks.onStoreAction?.("load-more");
  }

  function installHandleInteractions(host, handle, callbacks) {
    const dragState = { dragging: false, moved: false, pointerId: -1, startRatio: 0, startY: 0 };
    handle.addEventListener("click", (event) => {
      if (dragState.moved) {
        event.preventDefault();
        dragState.moved = false;
        return;
      }
      callbacks.onToggle?.();
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
      if (Math.abs(deltaY) > 6) dragState.moved = true;
      applyHandleRatio(host, clampRatio(dragState.startRatio + deltaY / getHandleTrackHeight(handle.offsetHeight)));
    });
    ["pointerup", "pointercancel"].forEach((type) => handle.addEventListener(type, (event) => finishHandleDrag(event, host, handle, callbacks, dragState)));
  }

  function finishHandleDrag(event, host, handle, callbacks, dragState) {
    if (!dragState.dragging || event.pointerId !== dragState.pointerId) return;
    dragState.dragging = false;
    dragState.pointerId = -1;
    handle.classList.remove("is-dragging");
    handle.releasePointerCapture?.(event.pointerId);
    if (dragState.moved) callbacks.onHandlePositionChange?.(readHandleRatio(host));
  }

  function getHandleTrackHeight(handleHeight) {
    const viewportHeight = global.innerHeight || document.documentElement.clientHeight || 0;
    return Math.max(1, viewportHeight - (viewportHeight <= 760 ? 90 : 120) - handleHeight);
  }
  function applyHandleRatio(host, value) { host.style.setProperty("--handle-ratio", String(clampRatio(value))); }
  function readHandleRatio(host) { const ratio = Number.parseFloat(host.style.getPropertyValue("--handle-ratio")); return clampRatio(Number.isFinite(ratio) ? ratio : 0.4); }
  function clampRatio(value) { return Math.min(1, Math.max(0, Number(value) || 0)); }
  function getDropPlacement(item, clientY) { const rect = item.getBoundingClientRect(); return clientY > rect.top + rect.height / 2 ? "after" : "before"; }
  function setPromptDropIndicator(host, targetItem, placement) { clearPromptDropIndicators(host); targetItem.classList.add(placement === "after" ? "is-drop-after" : "is-drop-before"); }
  function clearPromptDropIndicators(host) { host.querySelectorAll(".inova-prompt-item.is-drop-before, .inova-prompt-item.is-drop-after").forEach((item) => item.classList.remove("is-drop-before", "is-drop-after")); }
  function clearPromptDragState(host) {
    clearPromptDropIndicators(host);
    host.__promptDrag?.handle?.classList.remove("is-dragging");
    host.querySelectorAll(".inova-prompt-item.is-drag-source").forEach((item) => item.classList.remove("is-drag-source"));
    delete host.__promptDrag;
    delete host.dataset.dragPointerId;
  }
  function syncStoreList(host, callbacks, scrollTop) {
    const list = host.querySelector(".inova-store-list");
    if (!(list instanceof HTMLElement)) return;
    if (scrollTop > 0) list.scrollTop = scrollTop;
    host.__storeScrollTop = list.scrollTop;
    if (callbacks?.onStoreAction && list.dataset.storeHasMore === "true" && list.dataset.storeLoading !== "true" && list.scrollHeight <= list.clientHeight + 24) global.setTimeout(() => callbacks.onStoreAction("load-more"), 0);
  }
  function escapeHtml(text) { return String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

  namespace.contentPanel = {
    ensurePanel,
    focusBookmark: namespace.bookmarkView.focus,
    renderPanel,
    setActiveBookmark: namespace.bookmarkView.setActive,
  };
})(globalThis);
