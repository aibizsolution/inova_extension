(function initPanelNoticeController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText, readErrorMessage } = namespace.panelUtils;
  const PANEL_NOTICE_READ_CAPABILITY_ID = "panel.notice.read-active";
  const NOTICE_HIDE_STORAGE_PREFIX = "inova-panel-notice-hide:";
  const NOTICE_HIDE_DURATION_MS = 24 * 60 * 60 * 1000;

  function create(options = {}) {
    const browserCapabilities = options.browserCapabilities || {};
    const scheduleRender = typeof options.scheduleRender === "function" ? options.scheduleRender : () => {};
    const traceNotice = typeof options.traceNotice === "function" ? options.traceNotice : () => {};
    const state = {
      error: "",
      loadedKey: "",
      loading: false,
      notice: null,
      pendingKey: "",
      providerIdentity: null,
      sessionDismissedKeys: new Set(),
    };

    return {
      buildViewState,
      handleClick,
      render,
      syncPanelState,
    };

    function syncPanelState(panelState = {}, capabilityIds = []) {
      const providerIdentity = normalizeProviderIdentity(panelState.providerIdentity);
      state.providerIdentity = providerIdentity;
      const capabilitySet = new Set((Array.isArray(capabilityIds) ? capabilityIds : []).map(normalizeText));
      if (!providerIdentity.providerUserKey || !capabilitySet.has(PANEL_NOTICE_READ_CAPABILITY_ID)) {
        resetNotice();
        return;
      }
      const loadKey = serializeLoadKey(providerIdentity);
      if (state.loadedKey === loadKey || state.pendingKey === loadKey) {
        return;
      }
      void loadNotice(providerIdentity, loadKey);
    }

    function buildViewState() {
      return {
        error: state.error,
        loading: state.loading,
        notice: state.notice ? { ...state.notice } : null,
      };
    }

    function render() {
      const notice = state.notice;
      if (!notice?.noticeId || isNoticeDismissed(notice)) {
        return "";
      }
      const dismissKey = buildDismissKey(notice);
      const cta = normalizeHttpsCta(notice.cta);
      return `
        <aside class="inova-panel-notice" role="status" aria-live="polite" data-panel-notice-key="${escapeHtml(dismissKey)}">
          <div class="inova-panel-notice__main">
            <strong class="inova-panel-notice__title">${escapeHtml(notice.title)}</strong>
            <div class="inova-panel-notice__body">${notice.bodyHtml}</div>
          </div>
          <div class="inova-panel-notice__actions">
            ${cta ? `<a class="inova-panel-notice__cta" href="${escapeHtmlAttribute(cta.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cta.label)}</a>` : ""}
            <button type="button" class="inova-panel-notice__button" data-panel-notice-action="hide-day">하루동안 안보기</button>
            <button type="button" class="inova-panel-notice__button inova-panel-notice__button--icon" data-panel-notice-action="close" aria-label="소식 닫기">닫기</button>
          </div>
        </aside>
      `;
    }

    function handleClick(event) {
      const target = getEventElementTarget(event);
      const actionButton = target?.closest?.("[data-panel-notice-action]");
      if (!actionButton) {
        return false;
      }
      const notice = state.notice;
      const action = normalizeText(actionButton.dataset.panelNoticeAction);
      if (!notice?.noticeId || !action) {
        return false;
      }
      event?.preventDefault?.();
      const dismissKey = buildDismissKey(notice);
      if (action === "close") {
        state.sessionDismissedKeys.add(dismissKey);
        traceNotice("hosted.notice.dismiss.session", { noticeId: notice.noticeId, version: notice.version });
        scheduleRender();
        return true;
      }
      if (action === "hide-day") {
        storeHideUntil(dismissKey, Date.now() + NOTICE_HIDE_DURATION_MS);
        traceNotice("hosted.notice.dismiss.day", { noticeId: notice.noticeId, version: notice.version });
        scheduleRender();
        return true;
      }
      return false;
    }

    async function loadNotice(providerIdentity, loadKey) {
      if (typeof browserCapabilities.invokeCapability !== "function") {
        resetNotice();
        return;
      }
      state.loading = true;
      state.pendingKey = loadKey;
      state.error = "";
      try {
        const result = await browserCapabilities.invokeCapability(PANEL_NOTICE_READ_CAPABILITY_ID, {
          providerIdentity,
        });
        if (state.pendingKey !== loadKey) {
          return;
        }
        state.loadedKey = loadKey;
        state.notice = normalizeNotice(result?.notice);
        traceNotice("hosted.notice.read.success", {
          hasNotice: Boolean(state.notice),
          noticeId: normalizeText(state.notice?.noticeId),
        });
      } catch (error) {
        if (state.pendingKey !== loadKey) {
          return;
        }
        state.loadedKey = loadKey;
        state.notice = null;
        state.error = readErrorMessage(error, "소식을 불러오지 못했어요.");
        traceNotice("hosted.notice.read.error", { error: state.error });
      } finally {
        if (state.pendingKey === loadKey) {
          state.pendingKey = "";
          state.loading = false;
          scheduleRender();
        }
      }
    }

    function resetNotice() {
      const hadState = Boolean(state.notice || state.error || state.loadedKey || state.pendingKey || state.loading);
      state.error = "";
      state.loadedKey = "";
      state.loading = false;
      state.notice = null;
      state.pendingKey = "";
      if (hadState) {
        scheduleRender();
      }
    }

    function isNoticeDismissed(notice) {
      const dismissKey = buildDismissKey(notice);
      if (!dismissKey) {
        return true;
      }
      if (state.sessionDismissedKeys.has(dismissKey)) {
        return true;
      }
      return readHideUntil(dismissKey) > Date.now();
    }
  }

  function normalizeNotice(noticeInput) {
    const notice = noticeInput && typeof noticeInput === "object" ? noticeInput : {};
    const noticeId = normalizeText(notice.noticeId);
    const title = normalizeText(notice.title);
    const bodyHtml = normalizeText(notice.bodyHtml);
    if (!noticeId || !title || !bodyHtml) {
      return null;
    }
    return {
      bodyHtml,
      cta: normalizeHttpsCta(notice.cta),
      endsAt: normalizeText(notice.endsAt),
      noticeId,
      publishedAt: normalizeText(notice.publishedAt),
      startsAt: normalizeText(notice.startsAt),
      title,
      version: readPositiveVersion(notice.version),
    };
  }

  function normalizeHttpsCta(ctaInput) {
    const cta = ctaInput && typeof ctaInput === "object" ? ctaInput : {};
    const label = normalizeText(cta.label);
    const url = normalizeText(cta.url);
    if (!label || !url || !isHttpsUrl(url)) {
      return null;
    }
    return { label, url };
  }

  function normalizeProviderIdentity(providerIdentity) {
    const input = providerIdentity && typeof providerIdentity === "object" ? providerIdentity : {};
    const numericUserId = input.numericUserId;
    return {
      displayName: normalizeText(input.displayName),
      email: normalizeText(input.email).toLowerCase(),
      numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
        ? null
        : Number.isFinite(Number(numericUserId))
          ? Number(numericUserId)
          : null,
      provider: normalizeText(input.provider) || "inova",
      providerUserKey: normalizeText(input.providerUserKey),
    };
  }

  function serializeLoadKey(providerIdentity) {
    return [
      normalizeText(providerIdentity.providerUserKey),
      normalizeText(providerIdentity.email),
    ].join(":");
  }

  function buildDismissKey(notice) {
    const noticeId = normalizeText(notice?.noticeId);
    if (!noticeId) {
      return "";
    }
    return `${noticeId}:${readPositiveVersion(notice?.version)}`;
  }

  function readPositiveVersion(value) {
    const version = Number(value);
    return Number.isInteger(version) && version > 0 ? version : 1;
  }

  function readHideUntil(dismissKey) {
    const storageKey = `${NOTICE_HIDE_STORAGE_PREFIX}${dismissKey}`;
    try {
      const hideUntil = Number(global.localStorage?.getItem(storageKey));
      if (!Number.isFinite(hideUntil) || hideUntil <= Date.now()) {
        global.localStorage?.removeItem(storageKey);
        return 0;
      }
      return hideUntil;
    } catch {
      return 0;
    }
  }

  function storeHideUntil(dismissKey, hideUntil) {
    try {
      global.localStorage?.setItem(`${NOTICE_HIDE_STORAGE_PREFIX}${dismissKey}`, String(Math.max(0, Number(hideUntil) || 0)));
    } catch {
      // localStorage can be unavailable in restricted contexts; session dismissal remains available.
    }
  }

  function isHttpsUrl(value) {
    try {
      return new URL(normalizeText(value)).protocol === "https:";
    } catch {
      return false;
    }
  }

  function getEventElementTarget(event) {
    const target = event?.target;
    if (target instanceof global.HTMLElement) {
      return target;
    }
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const pathElement = path.find((entry) => entry instanceof global.HTMLElement);
    if (pathElement) {
      return pathElement;
    }
    if (target?.parentElement instanceof global.HTMLElement) {
      return target.parentElement;
    }
    return null;
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

  namespace.panelNoticeController = { create };
})(globalThis);
