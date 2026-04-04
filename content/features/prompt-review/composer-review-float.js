(function initComposerReviewFloat(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const HOST_ID = "inova-composer-review-host";
  const ROOT_ID = "inova-composer-review-root";
  const TRACKING_DURATION_MS = 320;
  const VIEWPORT_MARGIN = 12;

  function ensure(callbacks) {
    let host = document.getElementById(HOST_ID);
    if (host) {
      host.__callbacks = callbacks;
      syncPanelStateObserver(host);
      return host;
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    host.innerHTML = `<div id="${ROOT_ID}" hidden></div>`;
    host.__callbacks = callbacks;
    host.__resizeObserver = new ResizeObserver(() => scheduleRender(host));
    host.addEventListener("pointerdown", handlePointerDown, true);
    host.addEventListener("click", (event) => handleClick(event, host), true);
    document.addEventListener("focusin", (event) => handleFocusIn(event, host), true);
    document.addEventListener("input", (event) => handleComposerInput(event, host), true);
    document.addEventListener("transitionrun", (event) => handleTransitionEvent(event, host), true);
    document.addEventListener("transitionend", (event) => handleTransitionEvent(event, host), true);
    global.addEventListener("resize", () => scheduleRender(host), { passive: true });
    global.addEventListener("scroll", () => scheduleRender(host), { capture: true, passive: true });
    document.body.appendChild(host);
    syncAnchor(host);
    syncPanelStateObserver(host);
    return host;
  }

  function render(state) {
    const host = document.getElementById(HOST_ID);
    if (!host) return;

    const root = host.querySelector(`#${ROOT_ID}`);
    const anchor = syncAnchor(host);
    const visible = Boolean(state?.visible && anchor);
    root.hidden = !visible;
    if (!visible) return;

    root.dataset.compact = String(global.innerWidth < 760 || anchor.getBoundingClientRect().width < 520);
    updateMarkup(root, state, root.dataset.compact === "true");
    applyPosition(root, anchor.getBoundingClientRect());
  }

  function syncAnchor(host) {
    const nextAnchor = namespace.composer.getComposerAnchorElement?.() || namespace.composer.getComposerElement?.() || null;
    if (host.__anchorElement === nextAnchor) return nextAnchor;
    if (host.__anchorElement) host.__resizeObserver?.unobserve(host.__anchorElement);
    host.__anchorElement = nextAnchor;
    if (nextAnchor) host.__resizeObserver?.observe(nextAnchor);
    return nextAnchor;
  }

  function handlePointerDown(event) {
    if (!event.target.closest?.("[data-composer-review-action]")) return;
    event.stopPropagation();
  }

  function handleClick(event, host) {
    const action = event.target.closest?.("[data-composer-review-action]");
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    host.__callbacks?.onAction?.(action.dataset.composerReviewAction || "");
  }

  function handleComposerInput(event, host) {
    const composer = namespace.composer.getComposerElement?.();
    if (!composer || (event.target !== composer && !composer.contains?.(event.target))) return;
    scheduleRender(host);
  }

  function handleFocusIn(event, host) {
    if (event.target instanceof Element && event.target.closest?.(`#${HOST_ID}`)) return;
    scheduleRender(host);
  }

  function scheduleRender(host) {
    if (host.__frame) return;
    host.__frame = global.requestAnimationFrame(() => {
      host.__frame = 0;
      host.__callbacks?.buildState && render(host.__callbacks.buildState());
    });
  }

  function beginTracking(host, durationMs = TRACKING_DURATION_MS) {
    const deadline = Date.now() + durationMs;
    host.__trackingUntil = Math.max(host.__trackingUntil || 0, deadline);
    if (host.__trackingFrame) return;
    const step = () => {
      host.__trackingFrame = 0;
      scheduleRender(host);
      if ((host.__trackingUntil || 0) <= Date.now()) return;
      host.__trackingFrame = global.requestAnimationFrame(step);
    };
    host.__trackingFrame = global.requestAnimationFrame(step);
  }

  function syncPanelStateObserver(host) {
    const root = document.getElementById("inova-bookmark-root");
    if (host.__panelRoot === root) return;
    host.__panelStateObserver?.disconnect?.();
    host.__panelRoot = root || null;
    if (!root) return;
    host.__panelStateObserver = new MutationObserver(() => {
      scheduleRender(host);
      beginTracking(host);
    });
    host.__panelStateObserver.observe(root, {
      attributes: true,
      attributeFilter: ["data-open"],
    });
  }

  function handleTransitionEvent(event, host) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest?.(".main-content, #inova-bookmark-panel, #inova-bookmark-handle")) return;
    beginTracking(host);
  }

  function applyPosition(root, rect) {
    const button = root.querySelector(".inova-composer-review__button");
    const buttonRect = button?.getBoundingClientRect();
    const width = Math.max(56, Math.ceil(buttonRect?.width || 112));
    const height = Math.max(34, Math.ceil(buttonRect?.height || 34));
    const left = clamp(rect.right - 12 - width, VIEWPORT_MARGIN, global.innerWidth - VIEWPORT_MARGIN - width);
    const top = clamp(rect.top + 16, VIEWPORT_MARGIN, global.innerHeight - VIEWPORT_MARGIN - height);
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
  }

  function updateMarkup(root, state, compact) {
    const button = root.querySelector(".inova-composer-review__button") || createButton(root);
    const buttonLabel = state.pending ? "검토 중..." : compact ? "검토" : "프롬프트 검토";
    button.className = `inova-composer-review__button ${state.pending ? "is-pending" : ""}`.trim();
    button.dataset.composerReviewAction = state.pending ? "" : "activate-review";
    button.disabled = Boolean(state.pending || !state.available || (!state.hasText && !state.result));
    button.setAttribute("aria-disabled", String(button.disabled));
    button.querySelector(".inova-composer-review__button-text").textContent = buttonLabel;
  }

  function createButton(root) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inova-composer-review__button";
    button.innerHTML = '<span class="inova-composer-review__button-text"></span>';
    root.replaceChildren(button);
    return button;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  namespace.composerReviewFloat = {
    ensure,
    render,
  };
})(globalThis);
