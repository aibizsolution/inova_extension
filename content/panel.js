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
    host.addEventListener("scroll", (event) => namespace.promptHubPanel?.handleScroll?.(event, host, callbacks), true);
    host.addEventListener("pointerdown", (event) => namespace.promptHubPanel?.handlePointerDown?.(event, host));
    host.addEventListener("pointermove", (event) => namespace.promptHubPanel?.handlePointerMove?.(event, host));
    host.addEventListener("pointerup", (event) => namespace.promptHubPanel?.handlePointerEnd?.(event, host, callbacks));
    host.addEventListener("pointercancel", (event) => namespace.promptHubPanel?.handlePointerEnd?.(event, host, callbacks));
    host.addEventListener("compositionstart", (event) => handleRootCompositionStart(event, host));
    host.addEventListener("compositionend", (event) => handleRootCompositionEnd(event, host, callbacks));
    host.addEventListener("search", (event) => handleRootSearch(event, callbacks), true);
    host.addEventListener("input", (event) => handleRootInput(event, host, callbacks));
    host.addEventListener("change", (event) => handleRootChange(event, callbacks));
    host.addEventListener("keydown", (event) => handleRootKeydown(event, callbacks));
    fileInput.addEventListener("change", () => { const [file] = Array.from(fileInput.files || []); if (file) callbacks.onImportFile?.(file); fileInput.value = ""; });
    return host;
  }

  function renderPanel(state) {
    const host = document.getElementById("inova-bookmark-host");
    if (!host) return;
    if (host.__searchComposition?.active) {
      host.__deferredPanelState = state;
      return;
    }
    const root = host.querySelector("#inova-bookmark-root");
    const debugLayer = host.querySelector("#inova-meeting-debug-layer");
    const focusedControl = captureFocusedControl(root);
    const previousStoreScrollTop = state.activeTool === "prompts" && state.promptTool?.activeTab === "store"
      ? host.querySelector(".inova-store-list")?.scrollTop || host.__storeScrollTop || 0
      : 0;
    root.hidden = !state.visible;
    root.dataset.open = String(state.open);
    document.body.classList.toggle("inova-bookmark-panel-open", Boolean(state.visible && state.open));
    applyHandleRatio(host, state.handleRatio);
    const toolRail = host.querySelector("#inova-tool-rail");
    const nextToolRailHtml = renderToolRail(state.tools, state.activeTool);
    if (toolRail && toolRail.innerHTML !== nextToolRailHtml) {
      toolRail.innerHTML = nextToolRailHtml;
    }
    host.querySelector("#inova-tool-title").textContent = state.toolTitle;
    host.querySelector("#inova-tool-total").textContent = String(state.toolCount);
    host.querySelector(".handle-count").textContent = String(state.handleCount);
    const toolContent = host.querySelector("#inova-tool-content");
    const nextToolContentHtml = renderToolContent(state);
    if (toolContent && toolContent.innerHTML !== nextToolContentHtml) {
      toolContent.innerHTML = nextToolContentHtml;
    }
    namespace.panelDebug?.captureViewport?.("panel-overlay", debugLayer?.querySelector(".inova-meeting-debug-console__log"));
    debugLayer.innerHTML = renderMeetingDebugLayer(state);
    syncMeetingDebugLayerDataset(debugLayer, state.panelDebug);
    namespace.panelDebug?.restoreViewport?.("panel-overlay", debugLayer?.querySelector(".inova-meeting-debug-console__log"));
    if (state.activeTool === "prompts" && state.promptTool?.activeTab === "store") namespace.promptHubPanel?.syncStoreList?.(host, host.__callbacks, previousStoreScrollTop);
    namespace.bookmarkView.setActive(state.bookmarksTool.activeId);
    restoreFocusedControl(root, focusedControl);
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
      <div id="inova-meeting-debug-layer"></div>
    `;
  }

  function renderMeetingDebugLayer(state) {
    if (!namespace.meetingView?.renderDebugConsole) {
      return "";
    }
    return namespace.meetingView.renderDebugConsole(state.panelDebug);
  }

  function syncMeetingDebugLayerDataset(debugLayer, panelDebug) {
    if (!(debugLayer instanceof global.HTMLElement)) {
      return;
    }
    const nextState = panelDebug && typeof panelDebug === "object" ? panelDebug : {};
    const totalLogs = Math.max(0, Number(nextState?.statusSummary?.totalLogs) || 0);
    debugLayer.dataset.debugEnabled = String(Boolean(nextState?.enabled));
    debugLayer.dataset.debugCollapsed = String(Boolean(nextState?.collapsed));
    debugLayer.dataset.debugEntryCount = String(totalLogs);
    debugLayer.dataset.debugHasErrors = String(Boolean(nextState?.hasErrors));
    debugLayer.dataset.debugRendered = String(Boolean(debugLayer.innerHTML));
  }

  function renderToolContent(state) {
    try {
      return state.activeTool === "prompts"
        ? namespace.promptHubView.render(state.promptTool)
        : state.activeTool === "meeting"
            ? namespace.meetingView?.render
              ? namespace.meetingView.render(state.meetingTool)
              : '<section class="inova-tool-section"><div class="inova-bookmark-empty">회의 화면을 불러오지 못했어요. 확장프로그램을 다시 로드해 주세요.</div></section>'
        : state.activeTool === "release"
            ? namespace.releaseView?.render
              ? namespace.releaseView.render(state.releaseTool)
              : '<section class="inova-tool-section"><div class="inova-bookmark-empty">릴리스 화면을 불러오지 못했어요. 확장프로그램을 다시 로드해 주세요.</div></section>'
            : namespace.bookmarkView.renderTool(state.bookmarksTool);
    } catch (error) {
      console.error("[i-Nova Bookmarks] tool render failed", error);
      return '<section class="inova-tool-section"><div class="inova-bookmark-empty">화면을 불러오지 못했어요. 확장프로그램을 다시 로드해 주세요.</div></section>';
    }
  }

  function renderToolRail(tools, activeTool) {
    return tools.map((tool) => `
      <button type="button" class="inova-tool-rail__button ${tool.id === activeTool ? "is-active" : ""}" data-tool-id="${tool.id}" aria-pressed="${tool.id === activeTool}">
        <span class="inova-tool-rail__label">${escapeHtml(tool.label)}</span>
        <span class="inova-tool-rail__count">${tool.count}</span>
      </button>
    `).join("");
  }

  function handleRootClick(event, host, callbacks) {
    if (!event.target.closest('[data-prompt-menu], [data-prompt-action="toggle-menu"]')) callbacks.onPromptAction?.("dismiss-menu");
    const toolButton = event.target.closest("[data-tool-id]");
    if (toolButton) return void callbacks.onSelectTool?.(toolButton.dataset.toolId);
    if (namespace.promptHubPanel?.handleClick?.(event, host, callbacks)) return;
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
    const meetingAction = event.target.closest("[data-meeting-action]");
    if (meetingAction) {
      return void callbacks.onMeetingAction?.(meetingAction.dataset.meetingAction, {
        artifactId: meetingAction.dataset.meetingArtifactId || "",
        jobId: meetingAction.dataset.meetingJobId || "",
        meetingId: meetingAction.dataset.meetingId || "",
        title: meetingAction.dataset.meetingTitle || "",
      });
    }
    const releaseAction = event.target.closest("[data-release-action]");
    if (releaseAction) return void callbacks.onReleaseAction?.(releaseAction.dataset.releaseAction, { version: releaseAction.dataset.releaseVersion || "" });
  }

  function handleRootCompositionStart(event, host) {
    const search = event.target.closest?.("[data-search-tool]");
    if (!(search instanceof HTMLElement)) return;
    host.__searchComposition = {
      active: true,
      toolId: search.dataset.searchTool || "",
    };
  }

  function handleRootCompositionEnd(event, host) {
    const search = event.target.closest?.("[data-search-tool]");
    if (!(search instanceof HTMLElement)) return;
    host.__searchComposition = {
      active: false,
      toolId: search.dataset.searchTool || "",
    };
    const deferredState = host.__deferredPanelState;
    delete host.__deferredPanelState;
    if (deferredState) {
      global.setTimeout(() => renderPanel(deferredState), 0);
    }
  }

  function handleRootInput(event, host, callbacks) {
    const search = event.target.closest("[data-search-tool]");
    if (search) {
      return void callbacks.onSearch?.(search.dataset.searchTool, search.value, {
        composing: Boolean(event.isComposing || host.__searchComposition?.active),
      });
    }
    namespace.promptHubPanel?.handleInput?.(event, callbacks);
  }

  function handleRootChange(event, callbacks) {
    namespace.promptHubPanel?.handleChange?.(event, callbacks);
  }

  function handleRootSearch(event, callbacks) {
    const search = event.target.closest?.("[data-search-tool]");
    if (!(search instanceof HTMLElement)) return;
    callbacks.onSearchSubmit?.(search.dataset.searchTool, search.value);
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
  function captureFocusedControl(root) {
    if (!(root instanceof HTMLElement)) return null;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
    const tagName = String(active.tagName || "").toLowerCase();
    if (!["input", "textarea", "select"].includes(tagName)) return null;
    const selector = buildFocusSelector(active);
    if (!selector) return null;
    return {
      end: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
      scrollLeft: typeof active.scrollLeft === "number" ? active.scrollLeft : 0,
      scrollTop: typeof active.scrollTop === "number" ? active.scrollTop : 0,
      selector,
      start: typeof active.selectionStart === "number" ? active.selectionStart : null,
      value: "value" in active ? String(active.value || "") : "",
    };
  }
  function restoreFocusedControl(root, snapshot) {
    if (!(root instanceof HTMLElement) || !snapshot?.selector) return;
    const next = root.querySelector(snapshot.selector);
    if (!(next instanceof HTMLElement)) return;
    next.focus({ preventScroll: true });
    if ("value" in next && typeof snapshot.value === "string" && String(next.value || "") !== snapshot.value) {
      next.value = snapshot.value;
    }
    if (typeof next.setSelectionRange === "function" && snapshot.start != null) {
      const valueLength = String(next.value || "").length;
      const start = Math.max(0, Math.min(valueLength, Number(snapshot.start) || 0));
      const end = Math.max(start, Math.min(valueLength, Number(snapshot.end) || start));
      next.setSelectionRange(start, end);
    }
    if (typeof next.scrollLeft === "number") next.scrollLeft = Number(snapshot.scrollLeft) || 0;
    if (typeof next.scrollTop === "number") next.scrollTop = Number(snapshot.scrollTop) || 0;
  }
  function buildFocusSelector(element) {
    if (!(element instanceof HTMLElement)) return "";
    const searchTool = element.dataset.searchTool;
    if (searchTool) return `[data-search-tool="${escapeSelector(searchTool)}"]`;
    const storeField = element.dataset.storeField;
    if (storeField) return `[data-store-field="${escapeSelector(storeField)}"]`;
    const promptField = element.dataset.promptField;
    if (promptField) return `[data-prompt-field="${escapeSelector(promptField)}"]`;
    const promptPublishField = element.dataset.promptPublishField;
    if (promptPublishField) {
      const promptId = element.dataset.promptId || "";
      return `[data-prompt-publish-field="${escapeSelector(promptPublishField)}"][data-prompt-id="${escapeSelector(promptId)}"]`;
    }
    if (element.id) return `#${escapeSelector(element.id)}`;
    return "";
  }
  function escapeSelector(value) {
    const text = String(value || "");
    if (global.CSS?.escape) {
      return global.CSS.escape(text);
    }
    return text.replace(/["\\]/g, "\\$&");
  }
  function escapeHtml(text) { return String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

  namespace.contentPanel = {
    ensurePanel,
    focusBookmark: namespace.bookmarkView.focus,
    renderPanel,
    setActiveBookmark: namespace.bookmarkView.setActive,
  };
})(globalThis);
