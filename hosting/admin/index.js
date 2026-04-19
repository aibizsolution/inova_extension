(function initAdminConsole(global) {
  const SESSION_STORAGE_KEY = "inova-admin-console-session";
  const PROJECT_ID = "browser-extension-main";
  const REGION = "asia-northeast3";
  const PRODUCTION_FUNCTIONS_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
  const MAX_NOTICE_TITLE_LENGTH = 80;
  const MAX_NOTICE_BODY_LENGTH = 800;
  const MAX_NOTICE_CTA_LABEL_LENGTH = 32;
  const ADMIN_SECTIONS = Object.freeze([
    {
      eyebrow: "Overview",
      group: "Console",
      icon: "dashboard",
      id: "overview",
      label: "개요",
      summary: "관리자 세션과 메뉴 구조를 확인하는 기본 화면입니다.",
      title: "관리자 홈",
    },
    {
      eyebrow: "Access",
      group: "Operations",
      icon: "users",
      id: "access",
      label: "사용자 및 권한",
      summary: "관리자 계정, 권한, 접근 정책 화면이 들어갈 자리입니다.",
      title: "사용자 및 권한",
    },
    {
      eyebrow: "Notice",
      group: "Operations",
      icon: "notice",
      id: "notice",
      label: "소식 팝업",
      summary: "확장 패널 하단에 노출할 전사 단일 소식을 편집하고 발행합니다.",
      title: "소식 팝업",
    },
    {
      eyebrow: "Runtime",
      group: "Operations",
      icon: "system",
      id: "runtime",
      label: "시스템 운영",
      summary: "Functions, Hosting, capability manifest 운영 상태 화면이 들어갈 자리입니다.",
      title: "시스템 운영",
    },
    {
      eyebrow: "Insights",
      group: "Insights",
      icon: "chart",
      id: "usage",
      label: "사용량",
      summary: "기능 사용량과 운영 지표 화면이 들어갈 자리입니다.",
      title: "사용량",
    },
    {
      eyebrow: "Audit",
      group: "Insights",
      icon: "audit",
      id: "audit",
      label: "감사 로그",
      summary: "관리자 작업 이력과 감사 로그 화면이 들어갈 자리입니다.",
      title: "감사 로그",
    },
    {
      eyebrow: "Release",
      group: "Release",
      icon: "release",
      id: "release",
      label: "배포 및 릴리스",
      summary: "배포 상태와 릴리스 운영 화면이 들어갈 자리입니다.",
      title: "배포 및 릴리스",
    },
  ]);
  const NAV_ICON_PATHS = Object.freeze({
    audit: ["M12 3l7 3v6c0 4.2-2.7 7.5-7 9-4.3-1.5-7-4.8-7-9V6l7-3z", "M9.5 12l1.7 1.7 3.3-3.9"],
    chart: ["M4 19V5", "M4 19h16", "M8 16v-4", "M12 16V8", "M16 16v-7"],
    dashboard: ["M4 5h7v6H4z", "M13 5h7v4h-7z", "M13 11h7v8h-7z", "M4 13h7v6H4z"],
    notice: ["M4 5h16v11H7l-3 3z", "M8 9h8", "M8 12h5"],
    release: ["M12 3v10", "M8 7l4-4 4 4", "M5 13v5h14v-5"],
    system: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v3", "M12 19v3", "M4.9 4.9l2.1 2.1", "M17 17l2.1 2.1", "M2 12h3", "M19 12h3", "M4.9 19.1 7 17", "M17 7l2.1-2.1"],
    users: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M15 10a2.5 2.5 0 1 0 0-5", "M3 19a6 6 0 0 1 12 0", "M14 14a5 5 0 0 1 7 5"],
  });

  const state = {
    activeSectionId: "overview",
    adminSessionToken: "",
    busy: false,
    error: "",
    notice: createNoticeState(),
    role: "",
    sessionExpiresAt: "",
    view: "loading",
    viewer: null,
  };

  const elements = {};

  global.addEventListener("DOMContentLoaded", () => {
    bindElements();
    bindEvents();
    renderNavigation();
    void boot();
  });

  async function boot() {
    renderLoading("관리자 권한을 확인하고 있습니다.");
    try {
      const params = new URLSearchParams(global.location.search);
      const launchToken = normalizeText(params.get("launch"));
      let session = loadStoredSession();
      if (launchToken) {
        session = await exchangeLaunchToken(launchToken);
        storeSession(session);
        removeLaunchParam();
      }
      if (!session?.adminSessionToken) {
        throw new Error("관리자 콘솔 세션이 없습니다. 확장 패널에서 다시 열어 주세요.");
      }
      const bootstrap = await readBootstrap(session.adminSessionToken);
      applyVerifiedSession({
        ...session,
        role: bootstrap.role,
        sessionExpiresAt: bootstrap.sessionExpiresAt,
        viewer: bootstrap.viewer,
      });
    } catch (error) {
      clearStoredSession();
      state.error = readErrorMessage(error);
      renderBlocked(state.error);
    }
  }

  async function refreshSession() {
    if (state.busy) {
      return;
    }
    state.busy = true;
    setRefreshBusy(true);
    try {
      const session = loadStoredSession();
      if (!session?.adminSessionToken) {
        throw new Error("관리자 콘솔 세션이 없습니다. 확장 패널에서 다시 열어 주세요.");
      }
      const bootstrap = await readBootstrap(session.adminSessionToken);
      applyVerifiedSession({
        ...session,
        role: bootstrap.role,
        sessionExpiresAt: bootstrap.sessionExpiresAt,
        viewer: bootstrap.viewer,
      });
    } catch (error) {
      clearStoredSession();
      state.error = readErrorMessage(error);
      renderBlocked(state.error);
    } finally {
      state.busy = false;
      setRefreshBusy(false);
    }
  }

  function applyVerifiedSession(session) {
    storeSession(session);
    state.adminSessionToken = normalizeText(session.adminSessionToken);
    state.error = "";
    state.role = normalizeText(session.role) || "admin";
    state.sessionExpiresAt = normalizeText(session.sessionExpiresAt);
    state.viewer = normalizeViewer(session.viewer);
    renderVerified();
  }

  async function exchangeLaunchToken(launchToken) {
    const result = await postFunction("exchangeInovaAdminLaunch", {
      launchToken,
    });
    return {
      adminSessionToken: normalizeText(result.adminSessionToken),
      role: normalizeText(result.role),
      sessionExpiresAt: normalizeText(result.sessionExpiresAt),
      viewer: normalizeViewer(result.viewer),
    };
  }

  function readBootstrap(adminSessionToken) {
    return postFunction("readInovaAdminBootstrap", {}, {
      Authorization: `AdminSession ${adminSessionToken}`,
    });
  }

  function postAdminFunction(functionName, body = {}) {
    const adminSessionToken = normalizeText(state.adminSessionToken || loadStoredSession()?.adminSessionToken);
    if (!adminSessionToken) {
      throw new Error("관리자 콘솔 세션이 없습니다. 확장 패널에서 다시 열어 주세요.");
    }
    return postFunction(functionName, body, {
      Authorization: `AdminSession ${adminSessionToken}`,
    });
  }

  async function postFunction(functionName, body, headers = {}) {
    const response = await fetch(`${resolveFunctionsBaseUrl()}/${functionName}`, {
      body: JSON.stringify(body || {}),
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const payloadError = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
      throw new Error(normalizeText(payloadError || payload?.message) || "관리자 요청에 실패했어요.");
    }
    return payload?.data || {};
  }

  function resolveFunctionsBaseUrl() {
    const { hostname, protocol } = global.location;
    const isLocal = protocol === "http:" && ["127.0.0.1", "localhost"].includes(normalizeText(hostname).toLowerCase());
    if (isLocal) {
      return `http://${hostname}:5001/${PROJECT_ID}/${REGION}`;
    }
    return PRODUCTION_FUNCTIONS_BASE_URL;
  }

  function loadStoredSession() {
    try {
      const raw = normalizeText(global.sessionStorage?.getItem(SESSION_STORAGE_KEY));
      if (!raw) {
        return null;
      }
      const session = JSON.parse(raw);
      if (!session || typeof session !== "object") {
        return null;
      }
      return {
        adminSessionToken: normalizeText(session.adminSessionToken),
        role: normalizeText(session.role),
        sessionExpiresAt: normalizeText(session.sessionExpiresAt),
        viewer: normalizeViewer(session.viewer),
      };
    } catch (error) {
      console.warn("[i-Nova admin] stored session reset", error);
      return null;
    }
  }

  function storeSession(session) {
    try {
      global.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        adminSessionToken: normalizeText(session?.adminSessionToken),
        role: normalizeText(session?.role),
        sessionExpiresAt: normalizeText(session?.sessionExpiresAt),
        viewer: normalizeViewer(session?.viewer),
      }));
    } catch (error) {
      console.warn("[i-Nova admin] stored session write failed", error);
    }
  }

  function clearStoredSession() {
    try {
      global.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
    } catch (error) {
      console.warn("[i-Nova admin] stored session clear failed", error);
    }
  }

  function removeLaunchParam() {
    const url = new URL(global.location.href);
    url.searchParams.delete("launch");
    global.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function bindElements() {
    [
      "adminShell",
      "adminSidebar",
      "blockedMessage",
      "blockedPanel",
      "blockedTitle",
      "contentEyebrow",
      "contentPanel",
      "contentSummary",
      "contentTitle",
      "navGroups",
      "pageOutlet",
      "refreshButton",
      "sectionEyebrow",
      "sectionTitle",
      "sessionExpiresAt",
      "sessionPanel",
      "statusBadge",
      "statusSummary",
      "viewerEmail",
      "viewerName",
      "viewerRole",
    ].forEach((id) => {
      elements[id] = global.document.getElementById(id);
    });
  }

  function bindEvents() {
    elements.refreshButton?.addEventListener("click", () => {
      void refreshSession();
    });
    elements.navGroups?.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-section-id]");
      if (button) {
        setActiveSection(button.dataset.sectionId);
      }
    });
  }

  function renderLoading(message) {
    setView("loading");
    setText(elements.sectionEyebrow, "Loading");
    setText(elements.sectionTitle, "관리자 권한 확인");
    setText(elements.statusSummary, message);
    setBadge("loading", "확인 중");
  }

  function renderVerified() {
    setView("verified");
    setText(elements.statusSummary, "권한 확인이 완료되었습니다.");
    setBadge("verified", "확인됨");
    setText(elements.viewerName, state.viewer?.displayName || state.viewer?.providerUserKey || "-");
    setText(elements.viewerEmail, state.viewer?.email || "-");
    setText(elements.viewerRole, state.role || "-");
    setText(elements.sessionExpiresAt, formatDateTime(state.sessionExpiresAt));
    renderNavigation();
    renderActiveSection();
  }

  function renderBlocked(message) {
    state.adminSessionToken = "";
    setView("blocked");
    setText(elements.sectionEyebrow, "Blocked");
    setText(elements.sectionTitle, "관리자 권한 차단");
    setText(elements.statusSummary, "관리자 권한 확인이 중단되었습니다.");
    setBadge("blocked", "차단됨");
    setText(elements.blockedTitle, "관리자 권한을 확인할 수 없습니다");
    setText(elements.blockedMessage, normalizeText(message) || "확장 패널에서 관리자 메뉴를 다시 열어 주세요.");
  }

  function setView(view) {
    state.view = normalizeText(view) || "loading";
    elements.adminShell?.setAttribute("data-view", state.view);
    setHidden(elements.adminSidebar, state.view !== "verified");
    setHidden(elements.sessionPanel, state.view !== "verified");
    setHidden(elements.contentPanel, state.view !== "verified");
    setHidden(elements.blockedPanel, state.view !== "blocked");
  }

  function renderNavigation() {
    if (!elements.navGroups) {
      return;
    }
    elements.navGroups.replaceChildren(...createNavigationGroups());
  }

  function createNavigationGroups() {
    const groups = [];
    ADMIN_SECTIONS.forEach((section) => {
      let group = groups.find((entry) => entry.name === section.group);
      if (!group) {
        group = { name: section.group, sections: [] };
        groups.push(group);
      }
      group.sections.push(section);
    });
    return groups.map(createNavigationGroup);
  }

  function createNavigationGroup(group) {
    const wrapper = global.document.createElement("section");
    wrapper.className = "admin-nav__group";

    const heading = global.document.createElement("h2");
    heading.className = "admin-nav__heading";
    heading.textContent = normalizeText(group.name);

    const list = global.document.createElement("div");
    list.className = "admin-nav__list";
    group.sections.forEach((section) => {
      list.append(createNavigationButton(section));
    });

    wrapper.append(heading, list);
    return wrapper;
  }

  function createNavigationButton(section) {
    const button = global.document.createElement("button");
    button.className = "admin-nav__item";
    button.dataset.sectionId = section.id;
    button.type = "button";
    if (section.id === state.activeSectionId) {
      button.setAttribute("aria-current", "page");
    }
    button.append(createNavigationIcon(section.icon));

    const label = global.document.createElement("span");
    label.textContent = section.label;
    button.append(label);
    return button;
  }

  function createNavigationIcon(icon) {
    const wrapper = global.document.createElement("span");
    wrapper.className = "admin-nav__icon";
    wrapper.setAttribute("aria-hidden", "true");

    const svg = global.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("focusable", "false");

    (NAV_ICON_PATHS[icon] || NAV_ICON_PATHS.dashboard).forEach((data) => {
      const path = global.document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", data);
      svg.append(path);
    });
    wrapper.append(svg);
    return wrapper;
  }

  function setActiveSection(sectionId) {
    const nextSection = findSection(sectionId);
    if (!nextSection || nextSection.id === state.activeSectionId) {
      return;
    }
    state.activeSectionId = nextSection.id;
    renderNavigation();
    renderActiveSection();
  }

  function renderActiveSection() {
    const section = findSection(state.activeSectionId) || ADMIN_SECTIONS[0];
    setText(elements.sectionEyebrow, section.eyebrow);
    setText(elements.sectionTitle, section.title);
    setText(elements.contentEyebrow, section.eyebrow);
    setText(elements.contentTitle, section.title);
    setText(elements.contentSummary, section.summary);
    if (section.id === "notice") {
      elements.pageOutlet?.replaceChildren(createNoticeWorkbench());
      void ensurePanelNoticesLoaded();
      return;
    }
    elements.pageOutlet?.replaceChildren(createSectionPlaceholder(section));
  }

  function createSectionPlaceholder(section) {
    const placeholder = global.document.createElement("div");
    placeholder.className = "admin-empty-state";
    placeholder.dataset.sectionId = section.id;

    const title = global.document.createElement("strong");
    title.textContent = section.title;

    const body = global.document.createElement("p");
    body.textContent = section.id === "overview"
      ? "기능을 한 화면에 누적하지 않고, 왼쪽 메뉴에서 선택한 운영 화면을 이 본문 영역에 연결합니다."
      : "이 메뉴의 운영 화면은 아직 연결되지 않았습니다. 기능을 붙일 때는 이 outlet 안에서 독립적으로 확장합니다.";

    placeholder.append(title, body);
    return placeholder;
  }

  function createNoticeWorkbench() {
    const noticeState = state.notice;
    const wrapper = global.document.createElement("div");
    wrapper.className = "admin-notice-workbench";
    const secondary = global.document.createElement("div");
    secondary.className = "admin-notice-secondary";
    secondary.append(
      createNoticeStatusPanel(),
      createNoticeListPanel()
    );
    wrapper.append(
      createNoticeEditorPanel(),
      secondary
    );
    wrapper.addEventListener("input", handleNoticeInput);
    wrapper.addEventListener("click", handleNoticeClick);
    wrapper.addEventListener("keydown", handleNoticeKeydown);
    if (noticeState.loading && !noticeState.loaded) {
      wrapper.dataset.loading = "true";
    }
    return wrapper;
  }

  function createNoticeStatusPanel() {
    const noticeState = state.notice;
    const activeNotice = findNoticeById(noticeState.activeNoticeId);
    const panel = global.document.createElement("section");
    panel.className = "admin-notice-status";

    const title = global.document.createElement("strong");
    title.textContent = activeNotice ? "현재 노출 중" : "현재 노출 없음";

    const summary = global.document.createElement("p");
    summary.textContent = noticeState.loading && !noticeState.loaded
      ? "소식 상태를 불러오는 중입니다."
      : activeNotice
        ? activeNotice.title
        : "발행된 소식이 없습니다.";

    const badge = global.document.createElement("span");
    badge.className = `admin-notice-badge ${activeNotice ? "is-active" : "is-muted"}`;
    badge.textContent = activeNotice ? "노출 중" : "중지됨";

    const meta = global.document.createElement("dl");
    meta.className = "admin-notice-status__meta";
    [
      ["시작", activeNotice?.startsAt ? formatDateTime(activeNotice.startsAt) : "즉시"],
      ["종료", activeNotice?.endsAt ? formatDateTime(activeNotice.endsAt) : "-"],
      ["버전", activeNotice?.version ? String(activeNotice.version) : "-"],
    ].forEach(([label, value]) => {
      const item = global.document.createElement("div");
      const dt = global.document.createElement("dt");
      const dd = global.document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      item.append(dt, dd);
      meta.append(item);
    });

    const header = global.document.createElement("div");
    header.className = "admin-notice-status__head";
    header.append(title, badge);
    panel.append(header, summary, meta);
    if (noticeState.error || noticeState.feedback) {
      const feedback = global.document.createElement("p");
      feedback.className = `admin-notice-feedback ${noticeState.error ? "is-error" : "is-success"}`;
      feedback.textContent = noticeState.error || noticeState.feedback;
      panel.append(feedback);
    }
    return panel;
  }

  function createNoticeEditorPanel() {
    const form = state.notice.form;
    const section = global.document.createElement("section");
    section.className = "admin-notice-editor";
    section.innerHTML = `
      <form class="admin-notice-form" novalidate>
        <div class="admin-notice-form__row">
          <label class="admin-notice-field" for="panelNoticeTitle">
            <span>제목</span>
            <input id="panelNoticeTitle" data-notice-field="title" maxlength="${MAX_NOTICE_TITLE_LENGTH}" required />
          </label>
          <label class="admin-notice-field" for="panelNoticeEndsAt">
            <span>노출 종료</span>
            <input id="panelNoticeEndsAt" data-notice-field="endsAt" type="datetime-local" required />
          </label>
        </div>
        <label class="admin-notice-field" for="panelNoticeBody">
          <span>본문 Markdown</span>
          <textarea id="panelNoticeBody" data-notice-field="bodyMarkdown" maxlength="${MAX_NOTICE_BODY_LENGTH}" rows="9" required></textarea>
        </label>
        <div class="admin-notice-form__row">
          <label class="admin-notice-field" for="panelNoticeCtaLabel">
            <span>CTA 라벨</span>
            <input id="panelNoticeCtaLabel" data-notice-field="cta.label" maxlength="${MAX_NOTICE_CTA_LABEL_LENGTH}" placeholder="자세히" />
            <small class="admin-notice-field__hint">링크가 없으면 비워 두세요.</small>
          </label>
          <label class="admin-notice-field" for="panelNoticeCtaUrl">
            <span>CTA URL</span>
            <input id="panelNoticeCtaUrl" data-notice-field="cta.url" inputmode="url" placeholder="https://www.naver.com" />
            <small class="admin-notice-field__hint" data-notice-feedback-for="cta.url">https 링크만 사용할 수 있습니다.</small>
          </label>
        </div>
        <details class="admin-notice-advanced">
          <summary>예약 노출 옵션</summary>
          <label class="admin-notice-field" for="panelNoticeStartsAt">
            <span>노출 시작</span>
            <input id="panelNoticeStartsAt" data-notice-field="startsAt" type="datetime-local" />
            <small class="admin-notice-field__hint">비워 두면 발행 즉시 노출됩니다.</small>
          </label>
        </details>
        <div class="admin-notice-form__actions">
          <button type="button" class="admin-primary-button" data-notice-action="save">저장</button>
          <button type="button" class="admin-primary-button is-strong" data-notice-action="publish">발행</button>
          <button type="button" class="admin-secondary-button" data-notice-action="archive">노출 중지</button>
        </div>
      </form>
      <section class="admin-notice-preview" aria-label="소식 미리보기">
        <div class="admin-notice-preview__head">
          <span>Preview</span>
          <strong></strong>
        </div>
        <div class="admin-notice-preview__body"></div>
        <div class="admin-notice-preview__cta"></div>
      </section>
    `;
    section.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
    setNoticeInputValue(section, "title", form.title);
    setNoticeInputValue(section, "bodyMarkdown", form.bodyMarkdown);
    setNoticeInputValue(section, "startsAt", form.startsAt);
    setNoticeInputValue(section, "endsAt", form.endsAt);
    setNoticeInputValue(section, "cta.label", form.cta.label);
    setNoticeInputValue(section, "cta.url", form.cta.url);
    renderNoticeFieldFeedback(section);
    updateNoticePreview(section);
    const saving = Boolean(state.notice.savingAction);
    section.querySelectorAll("button, input, textarea").forEach((control) => {
      if (saving) {
        control.disabled = true;
      }
    });
    const archiveButton = section.querySelector('[data-notice-action="archive"]');
    if (archiveButton) {
      archiveButton.disabled = saving || !state.notice.activeNoticeId;
    }
    return section;
  }

  function createNoticeListPanel() {
    const section = global.document.createElement("section");
    section.className = "admin-notice-list";
    const title = global.document.createElement("h3");
    title.textContent = "최근 공지";
    section.append(title);

    if (state.notice.loading && !state.notice.loaded) {
      const loading = global.document.createElement("p");
      loading.className = "admin-notice-list__empty";
      loading.textContent = "불러오는 중입니다.";
      section.append(loading);
      return section;
    }

    if (!state.notice.notices.length) {
      const empty = global.document.createElement("p");
      empty.className = "admin-notice-list__empty";
      empty.textContent = "저장된 소식이 없습니다.";
      section.append(empty);
      return section;
    }

    const list = global.document.createElement("div");
    list.className = "admin-notice-list__items";
    state.notice.notices.forEach((notice) => {
      const item = global.document.createElement("article");
      const isActive = notice.noticeId === state.notice.activeNoticeId;
      item.className = `admin-notice-list__item ${isActive ? "is-active" : ""}`;
      item.dataset.noticeLoadId = notice.noticeId;
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `${notice.title} 편집`);
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(notice.title)}</strong>
          <span>${escapeHtml(formatNoticeWindow(notice))}</span>
        </div>
        <span class="admin-notice-badge ${isActive ? "is-active" : getNoticeStatusTone(notice.status)}">${escapeHtml(isActive ? "노출 중" : getNoticeStatusLabel(notice.status))}</span>
      `;
      list.append(item);
    });
    section.append(list);
    return section;
  }

  function handleNoticeInput(event) {
    const field = normalizeText(event.target?.dataset?.noticeField);
    if (!field) {
      return;
    }
    writeNoticeFormField(field, event.target.value);
    updateNoticePreview(event.currentTarget);
  }

  function handleNoticeClick(event) {
    const actionButton = event.target?.closest?.("[data-notice-action]");
    if (actionButton) {
      const action = normalizeText(actionButton.dataset.noticeAction);
      if (action === "save") {
        void savePanelNotice();
      } else if (action === "publish") {
        void publishPanelNotice();
      } else if (action === "archive") {
        void archivePanelNotice();
      }
      return;
    }
    const row = event.target?.closest?.("[data-notice-load-id]");
    if (row) {
      loadNoticeIntoForm(row.dataset.noticeLoadId);
    }
  }

  function handleNoticeKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const row = event.target?.closest?.("[data-notice-load-id]");
    if (!row) {
      return;
    }
    event.preventDefault();
    loadNoticeIntoForm(row.dataset.noticeLoadId);
  }

  async function ensurePanelNoticesLoaded() {
    if (state.notice.loaded || state.notice.loading) {
      return;
    }
    await loadPanelNotices({ preserveForm: false });
  }

  async function loadPanelNotices(options = {}) {
    state.notice.loading = true;
    state.notice.error = "";
    if (state.activeSectionId === "notice") {
      renderActiveSection();
    }
    try {
      const result = await postAdminFunction("listInovaAdminPanelNotices");
      const notices = Array.isArray(result.notices)
        ? result.notices.map(normalizeAdminNotice).filter(Boolean)
        : [];
      state.notice.activeNoticeId = normalizeText(result.activeNoticeId);
      state.notice.loaded = true;
      state.notice.notices = notices;
      if (!options.preserveForm) {
        state.notice.form = createPreferredNoticeForm();
      }
    } catch (error) {
      state.notice.error = readErrorMessage(error);
    } finally {
      state.notice.loading = false;
      if (state.activeSectionId === "notice") {
        renderActiveSection();
      }
    }
  }

  async function savePanelNotice() {
    if (!validateNoticeForm({ requireFutureEnd: false })) {
      renderActiveSection();
      return;
    }
    await runNoticeMutation("save", async () => {
      const result = await postAdminFunction("saveInovaAdminPanelNotice", {
        notice: buildNoticePayloadFromForm(),
      });
      const savedNotice = normalizeAdminNotice(result.notice);
      await loadPanelNotices({ preserveForm: true });
      if (savedNotice) {
        state.notice.form = createNoticeFormFromNotice(savedNotice, { keepNoticeId: true });
      }
      state.notice.feedback = "저장되었습니다.";
    });
  }

  async function publishPanelNotice() {
    if (!validateNoticeForm({ requireFutureEnd: true })) {
      renderActiveSection();
      return;
    }
    await runNoticeMutation("publish", async () => {
      const result = await postAdminFunction("publishInovaAdminPanelNotice", {
        notice: buildNoticePayloadFromForm(),
      });
      const publishedNotice = normalizeAdminNotice(result.notice);
      await loadPanelNotices({ preserveForm: true });
      if (publishedNotice) {
        state.notice.form = createNoticeFormFromNotice(publishedNotice, { keepNoticeId: false });
      }
      state.notice.feedback = "발행되었습니다.";
    });
  }

  async function archivePanelNotice() {
    await runNoticeMutation("archive", async () => {
      await postAdminFunction("archiveInovaAdminPanelNotice", {
        noticeId: state.notice.activeNoticeId,
      });
      await loadPanelNotices({ preserveForm: false });
      state.notice.feedback = "노출을 중지했습니다.";
    });
  }

  async function runNoticeMutation(action, task) {
    if (state.notice.savingAction) {
      return;
    }
    state.notice.savingAction = action;
    state.notice.error = "";
    state.notice.feedback = "";
    renderActiveSection();
    try {
      await task();
      state.notice.fieldErrors = {};
    } catch (error) {
      state.notice.error = readErrorMessage(error);
    } finally {
      state.notice.savingAction = "";
      renderActiveSection();
    }
  }

  function loadNoticeIntoForm(noticeId) {
    const notice = findNoticeById(noticeId);
    if (!notice) {
      return;
    }
    state.notice.error = "";
    state.notice.fieldErrors = {};
    state.notice.feedback = "";
    state.notice.form = createNoticeFormFromNotice(notice, {
      keepNoticeId: normalizeText(notice.status) === "draft",
    });
    renderActiveSection();
  }

  function createNoticeState() {
    return {
      activeNoticeId: "",
      error: "",
      fieldErrors: {},
      feedback: "",
      form: createNoticeForm(),
      loaded: false,
      loading: false,
      notices: [],
      savingAction: "",
    };
  }

  function createNoticeForm(overrides = {}) {
    const overrideCta = overrides.cta && typeof overrides.cta === "object" ? overrides.cta : {};
    return {
      bodyMarkdown: "",
      endsAt: toDatetimeLocalInput(Date.now() + 7 * 24 * 60 * 60 * 1000),
      noticeId: "",
      startsAt: "",
      title: "",
      ...overrides,
      cta: {
        label: normalizeText(overrideCta.label),
        url: normalizeText(overrideCta.url),
      },
    };
  }

  function createPreferredNoticeForm() {
    const activeNotice = findNoticeById(state.notice.activeNoticeId);
    if (activeNotice) {
      return createNoticeFormFromNotice(activeNotice, { keepNoticeId: false });
    }
    const draftNotice = state.notice.notices.find((notice) => normalizeText(notice.status) === "draft");
    return draftNotice
      ? createNoticeFormFromNotice(draftNotice, { keepNoticeId: true })
      : createNoticeForm();
  }

  function createNoticeFormFromNotice(notice, options = {}) {
    return createNoticeForm({
      bodyMarkdown: normalizeText(notice?.bodyMarkdown),
      cta: {
        label: normalizeText(notice?.cta?.label),
        url: normalizeText(notice?.cta?.url),
      },
      endsAt: toDatetimeLocalInput(notice?.endsAt),
      noticeId: options.keepNoticeId ? normalizeText(notice?.noticeId) : "",
      startsAt: toDatetimeLocalInput(notice?.startsAt),
      title: normalizeText(notice?.title),
    });
  }

  function buildNoticePayloadFromForm() {
    const form = state.notice.form;
    const ctaLabel = normalizeText(form.cta.label);
    const ctaUrl = normalizeCtaUrlInput(form.cta.url);
    return {
      bodyMarkdown: normalizeText(form.bodyMarkdown),
      cta: ctaLabel || ctaUrl
        ? {
            label: ctaLabel,
            url: ctaUrl,
          }
        : null,
      endsAt: fromDatetimeLocalInput(form.endsAt),
      noticeId: normalizeText(form.noticeId),
      startsAt: fromDatetimeLocalInput(form.startsAt),
      title: normalizeText(form.title),
    };
  }

  function writeNoticeFormField(field, value) {
    const nextValue = String(value || "");
    state.notice.fieldErrors = {
      ...state.notice.fieldErrors,
      [field]: "",
    };
    state.notice.error = "";
    state.notice.feedback = "";
    if (field === "cta.label") {
      state.notice.form.cta.label = normalizeText(nextValue);
      return;
    }
    if (field === "cta.url") {
      state.notice.form.cta.url = normalizeText(nextValue);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(state.notice.form, field)) {
      state.notice.form[field] = nextValue;
    }
  }

  function validateNoticeForm(options = {}) {
    const form = state.notice.form;
    const fieldErrors = {};
    const title = normalizeText(form.title);
    const bodyMarkdown = normalizeText(form.bodyMarkdown);
    const endsAtIso = fromDatetimeLocalInput(form.endsAt);
    const startsAtIso = fromDatetimeLocalInput(form.startsAt);
    const ctaLabel = normalizeText(form.cta.label);
    const ctaUrlRaw = normalizeText(form.cta.url);
    const ctaUrl = normalizeCtaUrlInput(ctaUrlRaw);

    if (!title) {
      fieldErrors.title = "제목을 입력해 주세요.";
    } else if (title.length > MAX_NOTICE_TITLE_LENGTH) {
      fieldErrors.title = `제목은 ${MAX_NOTICE_TITLE_LENGTH}자 이하로 입력해 주세요.`;
    }
    if (!bodyMarkdown) {
      fieldErrors.bodyMarkdown = "본문을 입력해 주세요.";
    } else if (bodyMarkdown.length > MAX_NOTICE_BODY_LENGTH) {
      fieldErrors.bodyMarkdown = `본문은 ${MAX_NOTICE_BODY_LENGTH}자 이하로 입력해 주세요.`;
    }
    if (!endsAtIso) {
      fieldErrors.endsAt = "노출 종료 시간을 입력해 주세요.";
    } else if (options.requireFutureEnd === true && Date.parse(endsAtIso) <= Date.now()) {
      fieldErrors.endsAt = "노출 종료 시간은 현재보다 이후여야 합니다.";
    }
    if (startsAtIso && endsAtIso && Date.parse(startsAtIso) >= Date.parse(endsAtIso)) {
      fieldErrors.startsAt = "노출 시작 시간은 종료 시간보다 빨라야 합니다.";
    }
    if (ctaLabel || ctaUrlRaw) {
      if (!ctaLabel) {
        fieldErrors["cta.label"] = "CTA 라벨을 입력하거나 URL을 비워 주세요.";
      }
      if (!ctaUrlRaw) {
        fieldErrors["cta.url"] = "CTA URL을 입력하거나 라벨을 비워 주세요.";
      } else if (!isHttpsUrl(ctaUrl)) {
        fieldErrors["cta.url"] = "CTA URL은 https://로 시작해야 합니다. 예: https://www.naver.com";
      } else {
        state.notice.form.cta.url = ctaUrl;
      }
    }
    state.notice.fieldErrors = fieldErrors;
    const firstError = Object.values(fieldErrors).find(Boolean) || "";
    state.notice.error = firstError;
    return !firstError;
  }

  function normalizeAdminNotice(noticeInput) {
    const notice = noticeInput && typeof noticeInput === "object" ? noticeInput : {};
    const noticeId = normalizeText(notice.noticeId);
    if (!noticeId) {
      return null;
    }
    return {
      archivedAt: normalizeText(notice.archivedAt),
      bodyHtml: normalizeText(notice.bodyHtml),
      bodyMarkdown: normalizeText(notice.bodyMarkdown),
      createdAt: normalizeText(notice.createdAt),
      cta: normalizeHttpsCta(notice.cta),
      endsAt: normalizeText(notice.endsAt),
      noticeId,
      publishedAt: normalizeText(notice.publishedAt),
      startsAt: normalizeText(notice.startsAt),
      status: normalizeText(notice.status) || "draft",
      title: normalizeText(notice.title),
      updatedAt: normalizeText(notice.updatedAt),
      version: readPositiveInteger(notice.version) || 1,
    };
  }

  function findNoticeById(noticeId) {
    const normalizedId = normalizeText(noticeId);
    return state.notice.notices.find((notice) => notice.noticeId === normalizedId) || null;
  }

  function setNoticeInputValue(host, field, value) {
    const input = host.querySelector(`[data-notice-field="${cssEscape(field)}"]`);
    if (input) {
      input.value = normalizeText(value);
    }
  }

  function renderNoticeFieldFeedback(host) {
    if (!host) {
      return;
    }
    const fieldErrors = state.notice.fieldErrors || {};
    host.querySelectorAll("[data-notice-field]").forEach((input) => {
      const field = normalizeText(input.dataset.noticeField);
      const error = normalizeText(fieldErrors[field]);
      input.toggleAttribute("aria-invalid", Boolean(error));
      input.closest(".admin-notice-field")?.classList.toggle("is-invalid", Boolean(error));
    });
    host.querySelectorAll("[data-notice-feedback-for]").forEach((feedback) => {
      const field = normalizeText(feedback.dataset.noticeFeedbackFor);
      const error = normalizeText(fieldErrors[field]);
      if (error) {
        feedback.textContent = error;
      } else if (field === "cta.url") {
        feedback.textContent = "https 링크만 사용할 수 있습니다.";
      }
      feedback.classList.toggle("is-error", Boolean(error));
    });
  }

  function updateNoticePreview(host) {
    if (!host) {
      return;
    }
    const form = state.notice.form;
    const previewTitle = host.querySelector(".admin-notice-preview__head strong");
    const previewBody = host.querySelector(".admin-notice-preview__body");
    const previewCta = host.querySelector(".admin-notice-preview__cta");
    if (previewTitle) {
      previewTitle.textContent = form.title || "제목 없음";
    }
    if (previewBody) {
      previewBody.innerHTML = renderAdminNoticeMarkdownPreview(form.bodyMarkdown);
    }
    if (previewCta) {
      const cta = normalizeHttpsCta(form.cta);
      previewCta.innerHTML = cta
        ? `<a href="${escapeHtmlAttribute(cta.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cta.label)}</a>`
        : "";
    }
  }

  function renderAdminNoticeMarkdownPreview(markdown) {
    const blocks = [];
    let paragraphLines = [];
    let listItems = [];
    normalizeText(markdown).split(/\r?\n/).forEach((line) => {
      const trimmed = normalizeText(line);
      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }
      const listMatch = line.match(/^\s*-\s+(.+)$/);
      if (listMatch) {
        flushParagraph();
        listItems.push(`<li>${renderInlineAdminNoticeMarkdown(listMatch[1])}</li>`);
        return;
      }
      flushList();
      paragraphLines.push(renderInlineAdminNoticeMarkdown(line));
    });
    flushParagraph();
    flushList();
    return blocks.join("") || '<p class="admin-notice-preview__empty">본문 미리보기</p>';

    function flushParagraph() {
      if (!paragraphLines.length) {
        return;
      }
      blocks.push(`<p>${paragraphLines.join("<br>")}</p>`);
      paragraphLines = [];
    }

    function flushList() {
      if (!listItems.length) {
        return;
      }
      blocks.push(`<ul>${listItems.join("")}</ul>`);
      listItems = [];
    }
  }

  function renderInlineAdminNoticeMarkdown(value) {
    const source = String(value || "");
    const linkPattern = /\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)/g;
    let html = "";
    let lastIndex = 0;
    let match = linkPattern.exec(source);
    while (match) {
      html += renderInlineAdminNoticeText(source.slice(lastIndex, match.index));
      html += `<a href="${escapeHtmlAttribute(match[2])}" target="_blank" rel="noopener noreferrer">${renderInlineAdminNoticeText(match[1])}</a>`;
      lastIndex = match.index + match[0].length;
      match = linkPattern.exec(source);
    }
    html += renderInlineAdminNoticeText(source.slice(lastIndex));
    return html;
  }

  function renderInlineAdminNoticeText(value) {
    return escapeHtml(value)
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  }

  function normalizeHttpsCta(ctaInput) {
    const cta = ctaInput && typeof ctaInput === "object" ? ctaInput : {};
    const label = normalizeText(cta.label);
    const url = normalizeCtaUrlInput(cta.url);
    if (!label || !url || !isHttpsUrl(url)) {
      return null;
    }
    return { label, url };
  }

  function normalizeCtaUrlInput(value) {
    const url = normalizeText(value);
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return url;
    }
    return `https://${url}`;
  }

  function isHttpsUrl(value) {
    try {
      return new URL(normalizeText(value)).protocol === "https:";
    } catch {
      return false;
    }
  }

  function formatNoticeWindow(notice) {
    const startsAt = notice?.startsAt ? formatDateTime(notice.startsAt) : "즉시";
    const endsAt = notice?.endsAt ? formatDateTime(notice.endsAt) : "-";
    return `${startsAt} - ${endsAt}`;
  }

  function getNoticeStatusLabel(status) {
    const normalized = normalizeText(status);
    if (normalized === "published") {
      return "발행됨";
    }
    if (normalized === "archived") {
      return "중지됨";
    }
    return "임시 저장";
  }

  function getNoticeStatusTone(status) {
    const normalized = normalizeText(status);
    if (normalized === "published") {
      return "is-active";
    }
    if (normalized === "archived") {
      return "is-muted";
    }
    return "is-draft";
  }

  function toDatetimeLocalInput(value) {
    const timestamp = typeof value === "number" ? value : Date.parse(normalizeText(value));
    if (!Number.isFinite(timestamp)) {
      return "";
    }
    const date = new Date(timestamp);
    const localDate = new Date(timestamp - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
  }

  function fromDatetimeLocalInput(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return "";
    }
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : normalized;
  }

  function readPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function findSection(sectionId) {
    return ADMIN_SECTIONS.find((section) => section.id === normalizeText(sectionId));
  }

  function setBadge(tone, text) {
    elements.statusBadge?.setAttribute("data-tone", tone);
    setText(elements.statusBadge, text);
  }

  function setRefreshBusy(busy) {
    if (elements.refreshButton) {
      elements.refreshButton.disabled = busy;
    }
  }

  function setHidden(element, hidden) {
    if (element) {
      element.hidden = hidden;
    }
  }

  function setText(element, text) {
    if (element) {
      element.textContent = normalizeText(text);
    }
  }

  function normalizeViewer(viewer) {
    const input = viewer && typeof viewer === "object" ? viewer : {};
    return {
      displayName: normalizeText(input.displayName),
      email: normalizeText(input.email).toLowerCase(),
      provider: normalizeText(input.provider) || "inova",
      providerUserKey: normalizeText(input.providerUserKey),
    };
  }

  function formatDateTime(value) {
    const timestamp = Date.parse(normalizeText(value));
    if (!Number.isFinite(timestamp)) {
      return "-";
    }
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  }

  function readErrorMessage(error) {
    return normalizeText(error instanceof Error ? error.message : error) || "관리자 요청에 실패했어요.";
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function cssEscape(value) {
    const text = String(value || "");
    if (global.CSS?.escape) {
      return global.CSS.escape(text);
    }
    return text.replace(/["\\]/g, "\\$&");
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
})(globalThis);
