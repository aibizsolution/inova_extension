(function initInovaDesignSystem(global) {
  const DEFAULT_SEARCH_DELAY_MS = 260;
  const DEFAULT_TOAST_TTL_MS = 2400;
  const ERROR_TOAST_TTL_MS = 3600;
  const ICON_PATHS = Object.freeze({
    admin: [
      "M12 3 4 6v5c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10V6z",
      "M9.5 12.5 11 14l3.5-4",
    ],
    bookmarks: [
      "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
      "M7 11h10",
      "M7 15h6",
      "M7 7h8",
    ],
    "chevron-left": ["M15 18l-6-6 6-6"],
    "chevron-right": ["M9 18l6-6-6-6"],
    close: ["M18 6 6 18", "M6 6l12 12"],
    meeting: [
      "M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
      "M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1",
    ],
    prompts: [
      "M2 6h4",
      "M2 10h4",
      "M2 14h4",
      "M2 18h4",
      { attrs: { height: "20", rx: "2", width: "16", x: "4", y: "2" }, tag: "rect" },
      "M9.5 8h5",
      "M9.5 12H16",
      "M9.5 16H14",
    ],
    release: [
      "M12 15V3",
      "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
      "m7 10 5 5 5-5",
    ],
  });
  const TOAST_TONES = new Set(["error", "highlight", "info", "success", "warning"]);

  function createDeferredSearchController(options = {}) {
    const delayMs = Math.max(0, Number(options.delayMs) || DEFAULT_SEARCH_DELAY_MS);
    const normalizeValue = typeof options.normalize === "function" ? options.normalize : normalizeText;
    const onSearch = typeof options.onSearch === "function" ? options.onSearch : () => false;
    let composing = false;
    let pendingValue = String(options.initialValue || "");
    let committedValue = normalizeValue(pendingValue);
    let timerId = 0;

    function handleInput(value, inputOptions = {}) {
      pendingValue = String(value || "");
      if (composing || inputOptions.composing === true) {
        clearTimer();
        return false;
      }
      scheduleCommit();
      return true;
    }

    function handleCompositionStart() {
      composing = true;
      clearTimer();
      return true;
    }

    function handleCompositionEnd(value) {
      composing = false;
      pendingValue = String(value || "");
      scheduleCommit(0);
      return true;
    }

    function flush(value) {
      if (arguments.length > 0) {
        pendingValue = String(value || "");
      }
      clearTimer();
      return commit();
    }

    function cancel() {
      clearTimer();
      pendingValue = committedValue;
      composing = false;
    }

    function scheduleCommit(delayOverride) {
      clearTimer();
      const nextDelayMs = Number.isFinite(Number(delayOverride)) ? Math.max(0, Number(delayOverride)) : delayMs;
      timerId = global.setTimeout(commit, nextDelayMs);
    }

    function clearTimer() {
      if (!timerId) {
        return;
      }
      global.clearTimeout(timerId);
      timerId = 0;
    }

    function commit() {
      timerId = 0;
      const nextValue = normalizeValue(pendingValue);
      if (nextValue === committedValue) {
        return false;
      }
      committedValue = nextValue;
      onSearch(nextValue, {
        rawValue: pendingValue,
      });
      return true;
    }

    return Object.freeze({
      cancel,
      flush,
      handleCompositionEnd,
      handleCompositionStart,
      handleInput,
    });
  }

  function createToastController(options = {}) {
    const slot = resolveElement(options.slot || options.slotSelector || "[data-inova-toast-slot]");
    let activeToastId = "";
    let timerId = 0;
    let sequence = 0;

    function showToast(input = {}) {
      const toast = normalizeToastPayload(input);
      if (!slot || !toast.message) {
        return false;
      }
      clearTimer();
      activeToastId = toast.id;
      slot.hidden = false;
      slot.innerHTML = renderToastMarkup(toast);
      if (toast.ttlMs > 0) {
        timerId = global.setTimeout(() => {
          hideToast(toast.id);
        }, toast.ttlMs);
      }
      return true;
    }

    function hideToast(toastId = "") {
      if (toastId && toastId !== activeToastId) {
        return false;
      }
      clearTimer();
      activeToastId = "";
      if (slot) {
        slot.hidden = true;
        slot.innerHTML = "";
      }
      return true;
    }

    function clearTimer() {
      if (!timerId) {
        return;
      }
      global.clearTimeout(timerId);
      timerId = 0;
    }

    function normalizeToastPayload(input) {
      const payload = typeof input === "string" ? { message: input } : input || {};
      const tone = normalizeToastTone(payload.tone);
      const explicitTtlMs = Number(payload.ttlMs);
      sequence += 1;
      return {
        id: normalizeText(payload.id) || `toast-${Date.now()}-${sequence}`,
        live: normalizeText(payload.live) || (tone === "error" ? "assertive" : "polite"),
        message: normalizeText(payload.message),
        role: normalizeText(payload.role) || (tone === "error" ? "alert" : "status"),
        tone,
        ttlMs: Number.isFinite(explicitTtlMs)
          ? Math.max(0, explicitTtlMs)
          : tone === "error" ? ERROR_TOAST_TTL_MS : DEFAULT_TOAST_TTL_MS,
      };
    }

    return Object.freeze({
      hideToast,
      showToast,
    });
  }

  function createConfirmController(options = {}) {
    const root = resolveElement(options.root || options.rootSelector) || global.document?.body || null;
    let overlay = null;
    let activeResolve = null;
    let restoreFocus = null;

    function confirm(input = {}) {
      if (!root) {
        return Promise.resolve(false);
      }
      close(false);
      const dialog = normalizeConfirmPayload(input);
      restoreFocus = global.document?.activeElement || null;
      overlay = global.document.createElement("div");
      overlay.className = "inova-dialog-overlay";
      overlay.innerHTML = renderConfirmMarkup(dialog);
      overlay.addEventListener("click", handleOverlayClick);
      overlay.addEventListener("keydown", handleOverlayKeydown);
      root.append(overlay);
      global.setTimeout?.(() => {
        overlay?.querySelector("[data-inova-dialog-action=\"confirm\"]")?.focus?.();
      }, 0);
      return new Promise((resolve) => {
        activeResolve = resolve;
      });
    }

    function handleOverlayClick(event) {
      const action = normalizeText(event.target?.closest?.("[data-inova-dialog-action]")?.dataset?.inovaDialogAction);
      if (action === "confirm") {
        close(true);
        return;
      }
      if (action === "cancel" || event.target === overlay) {
        close(false);
      }
    }

    function handleOverlayKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    }

    function close(confirmed) {
      const resolve = activeResolve;
      activeResolve = null;
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
      restoreFocus?.focus?.();
      restoreFocus = null;
      resolve?.(Boolean(confirmed));
    }

    return Object.freeze({
      close,
      confirm,
    });
  }

  function resolveElement(input) {
    if (typeof input === "string") {
      return global.document?.querySelector(input) || null;
    }
    if (typeof global.HTMLElement === "function" && input instanceof global.HTMLElement) {
      return input;
    }
    return null;
  }

  function normalizeToastTone(value) {
    const tone = normalizeText(value).toLowerCase();
    if (tone === "info") {
      return "highlight";
    }
    return TOAST_TONES.has(tone) ? tone : "success";
  }

  function renderIcon(iconName, options = {}) {
    const paths = ICON_PATHS[normalizeIconName(iconName)] || ICON_PATHS.bookmarks;
    const className = normalizeText(options.className);
    const ariaHidden = options.ariaHidden === false ? "false" : "true";
    const focusable = options.focusable === true ? "true" : "false";
    return `
      <svg${className ? ` class="${escapeHtmlAttribute(className)}"` : ""} viewBox="0 0 24 24" focusable="${focusable}" aria-hidden="${ariaHidden}">
        ${paths.map(renderIconShape).join("")}
      </svg>
    `;
  }

  function renderIconShape(shape) {
    if (typeof shape === "string") {
      return `<path d="${escapeHtmlAttribute(shape)}"></path>`;
    }
    if (normalizeText(shape?.tag) === "rect") {
      return `<rect ${renderAttributes(shape.attrs)}></rect>`;
    }
    return `<path d="${escapeHtmlAttribute(shape?.d)}"${shape?.attrs ? ` ${renderAttributes(shape.attrs)}` : ""}></path>`;
  }

  function renderAttributes(attrs = {}) {
    return Object.entries(attrs)
      .map(([key, value]) => `${escapeHtmlAttribute(key)}="${escapeHtmlAttribute(value)}"`)
      .join(" ");
  }

  function normalizeIconName(value) {
    const iconName = normalizeText(value).toLowerCase();
    if (iconName === "x") {
      return "close";
    }
    return iconName || "bookmarks";
  }

  function renderToastMarkup(toast) {
    const tone = escapeHtmlAttribute(toast.tone);
    return `
      <div class="inova-toast is-${tone}" data-tone="${tone}" role="${escapeHtmlAttribute(toast.role)}" aria-live="${escapeHtmlAttribute(toast.live)}" aria-atomic="true">
        <span class="inova-toast__message">${escapeHtml(toast.message)}</span>
      </div>
    `;
  }

  function normalizeConfirmPayload(input) {
    const payload = input && typeof input === "object" ? input : {};
    const tone = normalizeText(payload.tone).toLowerCase() === "danger" ? "danger" : "default";
    return {
      body: normalizeText(payload.body),
      cancelLabel: normalizeText(payload.cancelLabel) || "취소",
      confirmLabel: normalizeText(payload.confirmLabel) || "확인",
      eyebrow: normalizeText(payload.eyebrow) || "확인",
      title: normalizeText(payload.title) || "이 작업을 진행할까요?",
      tone,
    };
  }

  function renderConfirmMarkup(dialog) {
    const bodyId = `inova-dialog-body-${Date.now()}`;
    const titleId = `inova-dialog-title-${Date.now()}`;
    return `
      <section class="inova-dialog" data-tone="${escapeHtmlAttribute(dialog.tone)}" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${bodyId}" tabindex="-1">
        <p class="inova-dialog__eyebrow">${escapeHtml(dialog.eyebrow)}</p>
        <h2 id="${titleId}" class="inova-dialog__title">${escapeHtml(dialog.title)}</h2>
        <p id="${bodyId}" class="inova-dialog__body">${escapeHtml(dialog.body)}</p>
        <div class="inova-dialog__actions">
          <button type="button" class="inova-dialog__button" data-inova-dialog-action="cancel">${escapeHtml(dialog.cancelLabel)}</button>
          <button type="button" class="inova-dialog__button ${dialog.tone === "danger" ? "inova-dialog__button--danger" : ""}" data-inova-dialog-action="confirm">${escapeHtml(dialog.confirmLabel)}</button>
        </div>
      </section>
    `;
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  const existing = global.InovaDesignSystem && typeof global.InovaDesignSystem === "object"
    ? global.InovaDesignSystem
    : {};
  global.InovaDesignSystem = Object.freeze({
    ...existing,
    createConfirmController,
    createDeferredSearchController,
    createToastController,
    normalizeToastTone,
    renderIcon,
  });
})(globalThis);
