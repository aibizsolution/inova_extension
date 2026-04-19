(function initPanelNoticeController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText, readErrorMessage } = namespace.panelUtils;
  const PANEL_NOTICE_READ_CAPABILITY_ID = "panel.notice.read-active";
  const PANEL_NOTICE_SIGNAL_CHANNEL = "inova-panel-notice";
  const PANEL_NOTICE_SIGNAL_STORAGE_KEY = "inova-panel-notice-signal";
  const PANEL_NOTICE_SIGNAL_TYPE = "panel-notice.changed";
  const NOTICE_HIDE_STORAGE_PREFIX = "inova-panel-notice-hide:";
  const NOTICE_HIDE_DURATION_MS = 24 * 60 * 60 * 1000;
  const NOTICE_ROTATION_INTERVAL_MS = 5000;

  function create(options = {}) {
    const browserCapabilities = options.browserCapabilities || {};
    const scheduleRender = typeof options.scheduleRender === "function" ? options.scheduleRender : () => {};
    const traceFirestore = typeof options.traceFirestore === "function" ? options.traceFirestore : () => {};
    const traceNotice = typeof options.traceNotice === "function" ? options.traceNotice : () => {};
    const noticeSignalClient = namespace.panelNoticeSignalFirestoreClient?.create?.({
      browserCapabilities,
      onError: handleNoticeSignalError,
      onSnapshot: handleNoticeSignalSnapshot,
      traceFirestore,
    }) || null;
    const state = {
      error: "",
      activeIndex: 0,
      canRead: false,
      lastSignalId: "",
      loadedKey: "",
      loading: false,
      notice: null,
      notices: [],
      paused: false,
      pendingKey: "",
      providerIdentity: null,
      queuedRefreshReason: "",
      rotationTimer: 0,
      sessionDismissedKeys: new Set(),
      signalChannel: null,
      signalSnapshotKey: "",
      settings: {},
    };
    setupSignalListeners();

    return {
      buildViewState,
      handleClick,
      handlePause,
      render,
      syncPanelState,
    };

    function syncPanelState(panelState = {}, capabilityIds = []) {
      const providerIdentity = normalizeProviderIdentity(panelState.providerIdentity);
      state.providerIdentity = providerIdentity;
      state.settings = panelState?.settings && typeof panelState.settings === "object"
        ? { ...panelState.settings }
        : {};
      const capabilitySet = new Set((Array.isArray(capabilityIds) ? capabilityIds : []).map(normalizeText));
      state.canRead = Boolean(providerIdentity.providerUserKey && capabilitySet.has(PANEL_NOTICE_READ_CAPABILITY_ID));
      if (!state.canRead) {
        resetNotice();
        return;
      }
      ensureNoticeSignalSubscription(providerIdentity);
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
        notices: state.notices.map((notice) => ({ ...notice })),
      };
    }

    function render() {
      const notices = readVisibleNotices();
      if (!notices.length) {
        clearAutoRotate();
        return "";
      }
      state.activeIndex = normalizeActiveIndex(state.activeIndex, notices.length);
      const notice = notices[state.activeIndex];
      const dismissKey = buildDismissKey(notice);
      const cta = normalizeHttpsCta(notice.cta);
      const hasMultiple = notices.length > 1;
      return `
        <aside class="inova-panel-notice" role="status" aria-live="polite" data-panel-notice-key="${escapeHtml(dismissKey)}">
          <div class="inova-panel-notice__main">
            <div class="inova-panel-notice__head">
              <strong class="inova-panel-notice__title">${escapeHtml(notice.title)}</strong>
              <div class="inova-panel-notice__head-actions">
                ${hasMultiple ? `
                  <button type="button" class="inova-panel-notice__button inova-panel-notice__button--icon" data-panel-notice-action="prev" aria-label="이전 소식">${renderPanelIcon("chevron-left")}</button>
                  <button type="button" class="inova-panel-notice__button inova-panel-notice__button--icon" data-panel-notice-action="next" aria-label="다음 소식">${renderPanelIcon("chevron-right")}</button>
                ` : ""}
                <button type="button" class="inova-panel-notice__button inova-panel-notice__button--icon" data-panel-notice-action="close" aria-label="소식 닫기">${renderPanelIcon("close")}</button>
              </div>
            </div>
            <div class="inova-panel-notice__body">${notice.bodyHtml}</div>
            <div class="inova-panel-notice__actions">
              ${cta ? `<a class="inova-panel-notice__cta" href="${escapeHtmlAttribute(cta.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cta.label)}</a>` : ""}
              <button type="button" class="inova-panel-notice__button" data-panel-notice-action="hide-day" aria-label="하루동안 안보기">하루동안 안보기</button>
            </div>
            ${hasMultiple ? `<div class="inova-panel-notice__pager">${renderNoticeDots(notices, state.activeIndex)}</div>` : ""}
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
      const notices = readVisibleNotices();
      const notice = notices[normalizeActiveIndex(state.activeIndex, notices.length)];
      const action = normalizeText(actionButton.dataset.panelNoticeAction);
      if (!notice?.noticeId || !action) {
        return false;
      }
      event?.preventDefault?.();
      const dismissKey = buildDismissKey(notice);
      if (action === "close") {
        state.sessionDismissedKeys.add(dismissKey);
        traceNotice("hosted.notice.dismiss.session", { noticeId: notice.noticeId, version: notice.version });
        moveToNextVisibleNotice();
        scheduleRender();
        return true;
      }
      if (action === "hide-day") {
        storeHideUntil(dismissKey, Date.now() + NOTICE_HIDE_DURATION_MS);
        traceNotice("hosted.notice.dismiss.day", { noticeId: notice.noticeId, version: notice.version });
        moveToNextVisibleNotice();
        scheduleRender();
        return true;
      }
      if (action === "next" || action === "prev") {
        moveNoticeIndex(action === "next" ? 1 : -1);
        traceNotice("hosted.notice.navigate", { action, noticeId: notice.noticeId, version: notice.version });
        scheduleRender();
        scheduleAutoRotate();
        return true;
      }
      if (action === "select") {
        const nextIndex = Number(actionButton.dataset.panelNoticeIndex);
        if (Number.isInteger(nextIndex) && nextIndex >= 0) {
          state.activeIndex = nextIndex;
        }
        traceNotice("hosted.notice.navigate", { action, index: state.activeIndex });
        scheduleRender();
        scheduleAutoRotate();
        return true;
      }
      return false;
    }

    function handlePause(paused) {
      const nextPaused = Boolean(paused);
      if (state.paused === nextPaused) {
        return false;
      }
      state.paused = nextPaused;
      if (state.paused) {
        clearAutoRotate();
      } else {
        scheduleAutoRotate();
      }
      traceNotice("hosted.notice.rotation.pause", { paused: state.paused });
      return true;
    }

    async function loadNotice(providerIdentity, loadKey) {
      if (typeof browserCapabilities.invokeCapability !== "function") {
        resetNotice();
        return;
      }
      if (state.pendingKey === loadKey) {
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
        state.notices = normalizeNoticeList(result);
        state.notice = state.notices[0] || null;
        state.activeIndex = normalizeActiveIndex(state.activeIndex, state.notices.length);
        traceNotice("hosted.notice.read.success", {
          count: state.notices.length,
          hasNotice: Boolean(state.notice),
          noticeId: normalizeText(state.notice?.noticeId),
        });
        scheduleAutoRotate();
      } catch (error) {
        if (state.pendingKey !== loadKey) {
          return;
        }
        state.loadedKey = loadKey;
        state.notice = null;
        state.notices = [];
        state.error = readErrorMessage(error, "소식을 불러오지 못했어요.");
        traceNotice("hosted.notice.read.error", { error: state.error });
        clearAutoRotate();
      } finally {
        if (state.pendingKey === loadKey) {
          const queuedRefreshReason = state.queuedRefreshReason;
          state.queuedRefreshReason = "";
          state.pendingKey = "";
          state.loading = false;
          scheduleRender();
          if (queuedRefreshReason) {
            refreshNotice(queuedRefreshReason);
          }
        }
      }
    }

    function resetNotice() {
      const hadState = Boolean(state.notice || state.error || state.loadedKey || state.pendingKey || state.loading);
      state.error = "";
      state.activeIndex = 0;
      state.canRead = false;
      state.loadedKey = "";
      state.loading = false;
      state.notice = null;
      state.notices = [];
      state.pendingKey = "";
      state.queuedRefreshReason = "";
      state.signalSnapshotKey = "";
      noticeSignalClient?.disconnect?.("notice-reset");
      clearAutoRotate();
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

    function readVisibleNotices() {
      return state.notices.filter((notice) => notice?.noticeId && !isNoticeDismissed(notice));
    }

    function moveToNextVisibleNotice() {
      const notices = readVisibleNotices();
      state.activeIndex = normalizeActiveIndex(state.activeIndex, notices.length);
      scheduleAutoRotate();
    }

    function moveNoticeIndex(delta) {
      const notices = readVisibleNotices();
      if (!notices.length) {
        state.activeIndex = 0;
        clearAutoRotate();
        return;
      }
      state.activeIndex = normalizeActiveIndex(state.activeIndex + delta, notices.length);
    }

    function scheduleAutoRotate() {
      clearAutoRotate();
      if (state.paused || readVisibleNotices().length < 2 || typeof global.setTimeout !== "function") {
        return;
      }
      state.rotationTimer = global.setTimeout(() => {
        state.rotationTimer = 0;
        moveNoticeIndex(1);
        scheduleRender();
        scheduleAutoRotate();
      }, NOTICE_ROTATION_INTERVAL_MS);
    }

    function clearAutoRotate() {
      if (state.rotationTimer && typeof global.clearTimeout === "function") {
        global.clearTimeout(state.rotationTimer);
      }
      state.rotationTimer = 0;
    }

    function refreshNotice(reason = "signal") {
      if (!state.canRead) {
        return false;
      }
      const providerIdentity = normalizeProviderIdentity(state.providerIdentity);
      const loadKey = serializeLoadKey(providerIdentity);
      if (!providerIdentity.providerUserKey || !loadKey) {
        return false;
      }
      if (state.pendingKey === loadKey) {
        state.queuedRefreshReason = reason;
        return true;
      }
      traceNotice("hosted.notice.refresh", { reason });
      void loadNotice(providerIdentity, loadKey);
      return true;
    }

    function ensureNoticeSignalSubscription(providerIdentity) {
      if (typeof noticeSignalClient?.ensureSubscribed !== "function") {
        return false;
      }
      void noticeSignalClient.ensureSubscribed({
        providerIdentity,
        settings: state.settings,
      }).catch(handleNoticeSignalError);
      return true;
    }

    function handleNoticeSignalSnapshot(snapshot) {
      const signalKey = normalizeNoticeSignalSnapshotKey(snapshot);
      if (!signalKey) {
        return;
      }
      if (!state.signalSnapshotKey) {
        state.signalSnapshotKey = signalKey;
        traceNotice("hosted.notice.signal.ready", { source: "firestore" });
        return;
      }
      if (state.signalSnapshotKey === signalKey) {
        return;
      }
      state.signalSnapshotKey = signalKey;
      refreshNotice("firestore");
    }

    function handleNoticeSignalError(error) {
      traceNotice("hosted.notice.signal.error", {
        error: readErrorMessage(error, "소식 변경 신호를 구독하지 못했어요."),
      });
    }

    function normalizeNoticeSignalSnapshotKey(snapshot) {
      if (!snapshot || typeof snapshot !== "object") {
        return "";
      }
      if (!snapshot.exists) {
        return "missing";
      }
      return normalizeText(snapshot.revision || snapshot.updatedAt);
    }

    function setupSignalListeners() {
      if (typeof global.BroadcastChannel === "function") {
        try {
          state.signalChannel = new global.BroadcastChannel(PANEL_NOTICE_SIGNAL_CHANNEL);
          state.signalChannel.onmessage = (event) => handleNoticeSignal(event?.data, "broadcast");
        } catch (error) {
          traceNotice("hosted.notice.signal.error", { error: readErrorMessage(error, "소식 변경 신호를 연결하지 못했어요.") });
        }
      }
      if (typeof global.addEventListener === "function") {
        global.addEventListener("storage", (event) => {
          if (event?.key === PANEL_NOTICE_SIGNAL_STORAGE_KEY) {
            handleNoticeSignal(event.newValue, "storage");
          }
        });
      }
    }

    function handleNoticeSignal(input, source) {
      const signal = normalizeNoticeSignal(input);
      if (signal.type !== PANEL_NOTICE_SIGNAL_TYPE || !signal.id || signal.id === state.lastSignalId) {
        return;
      }
      state.lastSignalId = signal.id;
      refreshNotice(source);
    }

    function normalizeNoticeSignal(input) {
      if (typeof input === "string") {
        try {
          return normalizeNoticeSignal(JSON.parse(input));
        } catch {
          return { id: "", type: "" };
        }
      }
      const signal = input && typeof input === "object" ? input : {};
      return {
        id: normalizeText(signal.id),
        type: normalizeText(signal.type),
      };
    }
  }

  function renderNoticeDots(notices, activeIndex) {
    return `
      <div class="inova-panel-notice__dots" aria-label="소식 이동">
        ${notices.map((_, index) => `
          <button type="button" class="inova-panel-notice__dot ${index === activeIndex ? "is-active" : ""}" data-panel-notice-action="select" data-panel-notice-index="${index}" aria-label="${index + 1}번째 소식 보기"></button>
        `).join("")}
      </div>
    `;
  }

  function renderPanelIcon(iconName) {
    return global.InovaDesignSystem?.renderIcon?.(iconName) || "";
  }

  function normalizeNoticeList(result) {
    const list = Array.isArray(result?.notices) ? result.notices : [result?.notice];
    const seen = new Set();
    return list
      .map(normalizeNotice)
      .filter((notice) => {
        const key = buildDismissKey(notice);
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function normalizeActiveIndex(index, length) {
    if (!Number.isInteger(length) || length <= 0) {
      return 0;
    }
    const nextIndex = Number(index);
    if (!Number.isFinite(nextIndex)) {
      return 0;
    }
    return ((Math.trunc(nextIndex) % length) + length) % length;
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
