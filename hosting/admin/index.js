(function initAdminConsole(global) {
  const SESSION_STORAGE_KEY = "inova-admin-console-session";
  const ACTIVE_SECTION_QUERY_KEY = "section";
  const PROJECT_ID = "browser-extension-main";
  const REGION = "asia-northeast3";
  const PRODUCTION_FUNCTIONS_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
  const MAX_NOTICE_TITLE_LENGTH = 80;
  const MAX_NOTICE_BODY_LENGTH = 800;
  const MAX_NOTICE_CTA_LABEL_LENGTH = 32;
  const ACCESS_FILTERS = Object.freeze([
    { id: "all", label: "전체" },
    { id: "active", label: "관리자" },
    { id: "inactive", label: "일반 사용자" },
  ]);
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
      summary: "회원별 관리자 권한을 관리합니다.",
      title: "사용자 및 권한",
    },
    {
      eyebrow: "Notice",
      group: "Operations",
      icon: "notice",
      id: "notice",
      label: "소식 팝업",
      summary: "확장 패널 하단 소식을 작성합니다.",
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
    access: createAccessState(),
    error: "",
    notice: createNoticeState(),
    role: "",
    sessionExpiresAt: "",
    view: "loading",
    viewer: null,
  };

  const elements = {};
  let confirmController = null;
  let toastController = null;

  global.addEventListener("DOMContentLoaded", () => {
    bindElements();
    confirmController = createAdminConfirmController();
    toastController = createAdminToastController();
    bindEvents();
    renderNavigation();
    void boot();
  });

  async function boot() {
    renderLoading("관리자 권한을 확인하고 있습니다.");
    state.activeSectionId = readActiveSectionFromUrl();
    try {
      const params = new URLSearchParams(global.location.search);
      const launchToken = normalizeText(params.get("launch"));
      let session = loadStoredSession();
      let exchangedLaunch = false;
      if (launchToken) {
        session = await exchangeLaunchToken(launchToken);
        storeSession(session);
        removeLaunchParam();
        exchangedLaunch = true;
      }
      if (!session?.adminSessionToken) {
        throw new Error("관리자 콘솔 세션이 없습니다. 확장 패널에서 다시 열어 주세요.");
      }
      if (exchangedLaunch) {
        applyVerifiedSession(session);
        return;
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

  function readActiveSectionFromUrl() {
    try {
      const url = new URL(global.location.href);
      const sectionId = normalizeText(url.searchParams.get(ACTIVE_SECTION_QUERY_KEY));
      return findSection(sectionId)?.id || ADMIN_SECTIONS[0].id;
    } catch (error) {
      console.warn("[i-Nova admin] active section read failed", error);
      return ADMIN_SECTIONS[0].id;
    }
  }

  function writeActiveSectionToUrl(sectionId) {
    const section = findSection(sectionId);
    if (!section) {
      return;
    }
    try {
      const url = new URL(global.location.href);
      if (section.id === ADMIN_SECTIONS[0].id) {
        url.searchParams.delete(ACTIVE_SECTION_QUERY_KEY);
      } else {
        url.searchParams.set(ACTIVE_SECTION_QUERY_KEY, section.id);
      }
      global.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (error) {
      console.warn("[i-Nova admin] active section write failed", error);
    }
  }

  function bindElements() {
    [
      "adminShell",
      "adminSidebar",
      "adminToastSlot",
      "blockedMessage",
      "blockedPanel",
      "blockedTitle",
      "blockedIcon",
      "contentPanel",
      "loadingIcon",
      "loadingMessage",
      "loadingPanel",
      "loadingTitle",
      "navGroups",
      "pageOutlet",
      "sectionEyebrow",
      "sectionTitle",
      "sessionExpiresAt",
      "sessionPanel",
      "statusSummary",
      "viewerEmail",
      "viewerName",
      "viewerRole",
    ].forEach((id) => {
      elements[id] = global.document.getElementById(id);
    });
  }

  function bindEvents() {
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
    setText(elements.loadingTitle, "관리자 권한 확인");
    setText(elements.loadingMessage, normalizeText(message) || "관리자 권한을 확인하고 있습니다.");
    if (elements.loadingIcon) {
      elements.loadingIcon.innerHTML = renderAdminIcon("admin", {
        className: "inova-status-state__svg",
      });
    }
  }

  function renderVerified() {
    setView("verified");
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
    setText(elements.blockedTitle, "관리자 권한을 확인할 수 없습니다");
    setText(elements.blockedMessage, normalizeText(message) || "확장 패널에서 관리자 메뉴를 다시 열어 주세요.");
    if (elements.blockedIcon) {
      elements.blockedIcon.innerHTML = renderAdminIcon("admin", {
        className: "inova-status-state__svg",
      });
    }
  }

  function setView(view) {
    state.view = normalizeText(view) || "loading";
    elements.adminShell?.setAttribute("data-view", state.view);
    setHidden(elements.adminSidebar, state.view !== "verified");
    setHidden(elements.sessionPanel, state.view !== "verified");
    setHidden(elements.contentPanel, state.view !== "verified");
    setHidden(elements.loadingPanel, state.view !== "loading");
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
    if (!nextSection) {
      return;
    }
    if (nextSection.id === state.activeSectionId) {
      writeActiveSectionToUrl(nextSection.id);
      return;
    }
    state.activeSectionId = nextSection.id;
    writeActiveSectionToUrl(nextSection.id);
    renderNavigation();
    renderActiveSection();
  }

  function renderActiveSection() {
    const section = findSection(state.activeSectionId) || ADMIN_SECTIONS[0];
    setText(elements.sectionEyebrow, section.eyebrow);
    setText(elements.sectionTitle, section.title);
    setText(elements.statusSummary, section.summary);
    if (section.id === "notice") {
      elements.pageOutlet?.replaceChildren(createNoticeWorkbench());
      void ensurePanelNoticesLoaded();
      return;
    }
    if (section.id === "access") {
      elements.pageOutlet?.replaceChildren(createAccessWorkbench());
      void ensureAccessUsersLoaded();
      return;
    }
    elements.pageOutlet?.replaceChildren(createSectionPlaceholder(section));
  }

  function createAccessWorkbench() {
    const entries = readAccessEntries();
    const visibleEntries = filterAccessEntries(entries);
    const selectedEntry = readSelectedAccessEntry(entries, visibleEntries);
    const wrapper = global.document.createElement("div");
    wrapper.className = "admin-access-workbench";
    wrapper.append(
      createAccessListPanel(entries, visibleEntries, selectedEntry),
      createAccessDetailPanel(selectedEntry)
    );
    wrapper.addEventListener("input", handleAccessInput);
    wrapper.addEventListener("click", handleAccessClick);
    return wrapper;
  }

  function createAccessListPanel(entries, visibleEntries, selectedEntry) {
    const panel = global.document.createElement("section");
    panel.className = "admin-access-list";

    const filterButtons = ACCESS_FILTERS.map((filter) => {
      const isSelected = state.access.statusFilter === filter.id;
      return `
        <button type="button" data-access-filter="${escapeHtmlAttribute(filter.id)}" aria-pressed="${isSelected ? "true" : "false"}">
          ${escapeHtml(filter.label)}
        </button>`;
    }).join("");
    const rows = visibleEntries.map((entry) => createAccessListItem(entry, selectedEntry)).join("");
    const listBody = state.access.loading && !state.access.loaded
      ? '<p class="admin-access-empty">불러오는 중입니다.</p>'
      : rows || '<p class="admin-access-empty">조건에 맞는 회원이 없습니다.</p>';

    panel.innerHTML = `
      <div class="inova-section-head admin-access-panel-head">
        <h3 class="inova-section-head__title">회원 목록</h3>
        <span class="admin-access-count">${visibleEntries.length}명</span>
      </div>
      <label class="admin-access-search">
        <span>검색</span>
        <input type="search" data-access-search value="${escapeHtmlAttribute(state.access.query)}" placeholder="이름 또는 이메일 검색" />
      </label>
      <div class="admin-access-filter inova-segmented" aria-label="회원 권한 필터">
        ${filterButtons}
      </div>
      <div class="admin-access-list__items">
        ${listBody}
      </div>
    `;
    return panel;
  }

  function createAccessListItem(entry, selectedEntry) {
    const isSelected = entry.id === selectedEntry?.id;
    const status = readAccessDraftStatus(entry);
    return `
      <button type="button" class="admin-access-list__item${isSelected ? " is-selected" : ""}" data-access-select="${escapeHtmlAttribute(entry.id)}" aria-current="${isSelected ? "true" : "false"}">
        <span class="admin-access-avatar" aria-hidden="true">${escapeHtml(readAccessInitial(entry))}</span>
        <span class="admin-access-list__body">
          <strong>${escapeHtml(entry.displayName)}</strong>
          <span>${escapeHtml(entry.email || entry.providerUserKey)}</span>
        </span>
        <span class="inova-badge ${escapeHtmlAttribute(readAccessStatusClass(status))}">${escapeHtml(readAccessStatusLabel(status))}</span>
      </button>
    `;
  }

  function createAccessDetailPanel(entry) {
    const selectedEntry = entry || readAccessEntries()[0];
    if (!selectedEntry) {
      const panel = global.document.createElement("section");
      panel.className = "admin-access-detail";
      panel.innerHTML = `
        <div class="inova-section-head admin-access-panel-head">
          <h3 class="inova-section-head__title">권한 설정</h3>
        </div>
        <p class="admin-access-empty">선택할 회원이 없습니다.</p>
      `;
      return panel;
    }
    const draftStatus = readAccessDraftStatus(selectedEntry);
    const isAdmin = draftStatus === "active";
    const isDirty = isAccessDraftDirty(selectedEntry);
    const isSaving = state.access.savingId === selectedEntry.id;
    const canEdit = selectedEntry.canEdit !== false && !state.access.savingId;
    const detailEmail = selectedEntry?.email || "-";
    const detailName = selectedEntry?.displayName || "-";

    const panel = global.document.createElement("section");
    panel.className = "admin-access-detail";
    panel.innerHTML = `
      <div class="inova-section-head admin-access-panel-head">
        <h3 class="inova-section-head__title">권한 설정</h3>
      </div>
      <div class="admin-access-selected-label">선택한 회원</div>
      <div class="admin-access-profile__hero">
        <span class="admin-access-avatar is-large" aria-hidden="true">${escapeHtml(readAccessInitial(selectedEntry))}</span>
        <div>
          <strong>${escapeHtml(detailName)}</strong>
          <span>${escapeHtml(detailEmail)}</span>
        </div>
      </div>
      <div class="admin-access-permission">
        <span>관리자 권한</span>
        <div class="admin-access-permission__toggle inova-segmented" aria-label="관리자 권한 설정">
          <button type="button" data-access-role="inactive" ${canEdit ? "" : "disabled"} aria-pressed="${isAdmin ? "false" : "true"}">일반 사용자</button>
          <button type="button" data-access-role="active" ${canEdit ? "" : "disabled"} aria-pressed="${isAdmin ? "true" : "false"}">관리자</button>
        </div>
      </div>
      <div class="admin-access-actions">
        <button type="button" class="admin-primary-button is-strong" data-access-action="save" ${canEdit && isDirty ? "" : "disabled"}>${isSaving ? "저장 중" : "저장"}</button>
      </div>
    `;
    return panel;
  }

  function handleAccessInput(event) {
    const target = event.target;
    if (!target?.matches?.("[data-access-search]")) {
      return;
    }
    state.access.query = normalizeText(target.value);
    renderActiveSection();
  }

  function handleAccessClick(event) {
    const actionButton = event.target?.closest?.("[data-access-action]");
    if (actionButton) {
      const action = normalizeText(actionButton.dataset.accessAction);
      if (action === "save") {
        void saveAccessUser();
      }
      return;
    }
    const roleButton = event.target?.closest?.("[data-access-role]");
    if (roleButton) {
      writeAccessDraftStatus(state.access.selectedId, roleButton.dataset.accessRole);
      renderActiveSection();
      return;
    }
    const filterButton = event.target?.closest?.("[data-access-filter]");
    if (filterButton) {
      state.access.statusFilter = normalizeText(filterButton.dataset.accessFilter) || "all";
      renderActiveSection();
      return;
    }
    const selectButton = event.target?.closest?.("[data-access-select]");
    if (selectButton) {
      state.access.selectedId = normalizeText(selectButton.dataset.accessSelect);
      renderActiveSection();
    }
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
    wrapper.append(
      createNoticeListPanel(),
      createNoticeEditorPanel(),
      createNoticePreviewPanel()
    );
    wrapper.addEventListener("input", handleNoticeInput);
    wrapper.addEventListener("click", handleNoticeClick);
    wrapper.addEventListener("keydown", handleNoticeKeydown);
    if (noticeState.loading && !noticeState.loaded) {
      wrapper.dataset.loading = "true";
    }
    return wrapper;
  }

  function createNoticeEditorPanel() {
    const form = state.notice.form;
    const section = global.document.createElement("section");
    section.className = "admin-notice-editor";
    section.innerHTML = `
      <div class="inova-section-head admin-notice-column-head">
        <h3 class="inova-section-head__title">소식 작성</h3>
      </div>
      <form class="admin-notice-form" novalidate>
        <label class="admin-notice-field" for="panelNoticeTitle">
          <span>제목</span>
          <input id="panelNoticeTitle" data-notice-field="title" maxlength="${MAX_NOTICE_TITLE_LENGTH}" required />
        </label>
        <label class="admin-notice-field" for="panelNoticeBody">
          <span>본문 (Markdown 문법)</span>
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
            <input id="panelNoticeCtaUrl" data-notice-field="cta.url" inputmode="url" placeholder="https://inova.incross.com/" />
            <small class="admin-notice-field__hint" data-notice-feedback-for="cta.url">https 링크만 사용할 수 있습니다.</small>
          </label>
        </div>
        <div class="admin-notice-form__date-group">
          <label class="admin-notice-field" for="panelNoticeStartsAt">
            <span>노출 시작</span>
            <div class="admin-notice-date-stepper">
              <button type="button" data-notice-action="shift-start-date" data-notice-days="-1" aria-label="노출 시작 하루 앞으로">-1일</button>
              <input id="panelNoticeStartsAt" data-notice-field="startsAt" type="text" inputmode="numeric" maxlength="16" placeholder="YYYY-MM-DD 00:00" />
              <button type="button" data-notice-action="shift-start-date" data-notice-days="1" aria-label="노출 시작 하루 뒤로">+1일</button>
            </div>
          </label>
          <label class="admin-notice-field" for="panelNoticeEndsAt">
            <span>노출 종료</span>
            <div class="admin-notice-date-stepper">
              <button type="button" data-notice-action="shift-end-date" data-notice-days="-1" aria-label="노출 종료 하루 앞으로">-1일</button>
              <input id="panelNoticeEndsAt" data-notice-field="endsAt" type="text" inputmode="numeric" maxlength="16" placeholder="YYYY-MM-DD 00:00" required />
              <button type="button" data-notice-action="shift-end-date" data-notice-days="1" aria-label="노출 종료 하루 뒤로">+1일</button>
            </div>
          </label>
        </div>
        <div class="admin-notice-form__actions">
          <button type="button" class="admin-primary-button" data-notice-action="save">저장</button>
          <button type="button" class="admin-secondary-button" data-notice-action="delete" ${form.noticeId ? "" : "disabled"}>삭제</button>
        </div>
      </form>
    `;
    section.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
    setNoticeInputValue(section, "title", form.title);
    setNoticeInputValue(section, "bodyMarkdown", form.bodyMarkdown);
    setNoticeInputValue(section, "startsAt", form.startsAt);
    setNoticeInputValue(section, "endsAt", form.endsAt);
    setNoticeInputValue(section, "cta.label", form.cta.label);
    setNoticeInputValue(section, "cta.url", form.cta.url);
    renderNoticeFieldFeedback(section);
    const saving = Boolean(state.notice.savingAction);
    section.querySelectorAll("button, input, textarea").forEach((control) => {
      if (saving) {
        control.disabled = true;
      }
    });
    return section;
  }

  function createNoticePreviewPanel() {
    const section = global.document.createElement("section");
    section.className = "admin-notice-preview";
    section.setAttribute("aria-label", "패널 미리보기");
    section.innerHTML = `
      <div class="inova-section-head admin-notice-column-head">
        <h3 class="inova-section-head__title">미리보기</h3>
      </div>
      <div class="admin-notice-preview__frame" aria-hidden="true">
        <div class="admin-notice-preview__rail"></div>
        <div class="admin-notice-preview__canvas">
          <div class="admin-notice-preview__content">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <article class="admin-notice-panel-popup">
            <div class="admin-notice-panel-popup__head">
              <strong data-notice-preview-title></strong>
              <button type="button" tabindex="-1" aria-label="소식 닫기">${renderAdminIcon("close")}</button>
            </div>
            <div class="admin-notice-preview__body"></div>
            <div class="admin-notice-panel-popup__actions">
              <div class="admin-notice-preview__cta"></div>
              <button type="button" tabindex="-1">오늘 안보기</button>
            </div>
            <div class="admin-notice-panel-popup__pager">
              <div class="admin-notice-panel-popup__dots">
                <span class="is-active"></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </article>
        </div>
      </div>
    `;
    updateNoticePreview(section);
    return section;
  }

  function createNoticeListPanel() {
    const section = global.document.createElement("section");
    section.className = "admin-notice-list";
    const header = global.document.createElement("div");
    header.className = "inova-section-head admin-notice-column-head admin-notice-list__head";
    const title = global.document.createElement("h3");
    title.className = "inova-section-head__title";
    title.textContent = "등록된 소식";
    const createButton = global.document.createElement("button");
    createButton.type = "button";
    createButton.className = "admin-primary-button";
    createButton.dataset.noticeAction = "new";
    createButton.textContent = "새 소식";
    header.append(title, createButton);
    section.append(header);

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
    state.notice.notices.forEach((notice, index) => {
      const item = global.document.createElement("article");
      const displayState = readNoticeDisplayState(notice);
      const isVisible = displayState.key === "visible";
      const isPrimary = isVisible && notice.noticeId === state.notice.activeNoticeId;
      const isSelected = notice.noticeId === normalizeText(state.notice.form.noticeId);
      const isFirst = index === 0;
      const isLast = index === state.notice.notices.length - 1;
      item.className = `admin-notice-list__item ${isVisible ? "is-visible" : ""} ${isPrimary ? "is-primary" : ""} ${isSelected ? "is-selected" : ""}`;
      item.dataset.noticeLoadId = notice.noticeId;
      item.tabIndex = 0;
      item.setAttribute("aria-current", isSelected ? "true" : "false");
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `${notice.title} 편집`);
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(notice.title)}</strong>
        </div>
        <div class="admin-notice-list__meta">
          <span class="admin-notice-badge ${displayState.className}">${displayState.label}</span>
          <span class="admin-notice-order-controls">
            <button type="button" data-notice-action="move-up" data-notice-id="${escapeHtmlAttribute(notice.noticeId)}" aria-label="${escapeHtmlAttribute(notice.title)} 위로 이동" ${isFirst ? "disabled" : ""}>↑</button>
            <button type="button" data-notice-action="move-down" data-notice-id="${escapeHtmlAttribute(notice.noticeId)}" aria-label="${escapeHtmlAttribute(notice.title)} 아래로 이동" ${isLast ? "disabled" : ""}>↓</button>
          </span>
        </div>
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
      } else if (action === "new") {
        createNewNoticeForm();
      } else if (action === "delete") {
        void deletePanelNotice();
      } else if (action === "shift-start-date") {
        shiftNoticeDate("startsAt", actionButton.dataset.noticeDays, event.currentTarget);
      } else if (action === "shift-end-date") {
        shiftNoticeDate("endsAt", actionButton.dataset.noticeDays, event.currentTarget);
      } else if (action === "move-up" || action === "move-down") {
        event.preventDefault();
        event.stopPropagation();
        void movePanelNotice(actionButton.dataset.noticeId, action === "move-up" ? "up" : "down");
      }
      return;
    }
    const row = event.target?.closest?.("[data-notice-load-id]");
    if (row) {
      loadNoticeIntoForm(row.dataset.noticeLoadId);
    }
  }

  function shiftNoticeDate(field, daysInput, host) {
    const days = Number(daysInput);
    if (!Number.isInteger(days) || days === 0) {
      return;
    }
    const normalizedField = normalizeText(field);
    if (normalizedField !== "startsAt" && normalizedField !== "endsAt") {
      return;
    }
    const baseDate = readNoticeDateBase(normalizedField);
    baseDate.setDate(baseDate.getDate() + days);
    if (normalizedField === "endsAt") {
      baseDate.setHours(23, 59, 0, 0);
    } else {
      baseDate.setHours(0, 0, 0, 0);
    }
    state.notice.form[normalizedField] = toDatetimeLocalInput(baseDate.getTime());
    state.notice.fieldErrors = {
      ...state.notice.fieldErrors,
      [normalizedField]: "",
    };
    state.notice.error = "";
    setNoticeInputValue(host, normalizedField, state.notice.form[normalizedField]);
    renderNoticeFieldFeedback(host);
  }

  function readNoticeDateBase(field) {
    const date = parseDatetimeInputToDate(state.notice.form[field]);
    if (date) {
      return date;
    }
    return new Date();
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
      showAdminToast(state.notice.error, "error");
    } finally {
      state.notice.loading = false;
      if (state.activeSectionId === "notice") {
        renderActiveSection();
      }
    }
  }

  async function savePanelNotice() {
    if (!validateNoticeForm({ requireFutureEnd: false })) {
      showAdminToast(state.notice.error, "error");
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
      showAdminToast("저장되었습니다.", "success");
    });
  }

  async function deletePanelNotice() {
    const noticeId = normalizeText(state.notice.form.noticeId);
    if (!noticeId) {
      return;
    }
    const confirmed = await confirmAdminAction({
      body: "삭제한 소식은 목록에서 제거됩니다.",
      confirmLabel: "삭제",
      eyebrow: "삭제 확인",
      title: "이 소식을 삭제할까요?",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    await runNoticeMutation("delete", async () => {
      await postAdminFunction("deleteInovaAdminPanelNotice", {
        noticeId,
      });
      await loadPanelNotices({ preserveForm: true });
      state.notice.form = createPreferredNoticeForm();
      showAdminToast("삭제되었습니다.", "success");
    });
  }

  async function movePanelNotice(noticeIdInput, directionInput) {
    const noticeId = normalizeText(noticeIdInput);
    const direction = normalizeText(directionInput);
    if (!noticeId || !direction) {
      return;
    }
    await runNoticeMutation("move", async () => {
      await postAdminFunction("moveInovaAdminPanelNotice", {
        direction,
        noticeId,
      });
      await loadPanelNotices({ preserveForm: true });
      showAdminToast("순서를 변경했습니다.", "success", { ttlMs: 1800 });
    });
  }

  async function runNoticeMutation(action, task) {
    if (state.notice.savingAction) {
      return;
    }
    state.notice.savingAction = action;
    state.notice.error = "";
    renderActiveSection();
    try {
      await task();
      state.notice.fieldErrors = {};
    } catch (error) {
      state.notice.error = readErrorMessage(error);
      showAdminToast(state.notice.error, "error");
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
    state.notice.form = createNoticeFormFromNotice(notice, {
      keepNoticeId: true,
    });
    renderActiveSection();
  }

  function createNewNoticeForm() {
    state.notice.error = "";
    state.notice.fieldErrors = {};
    state.notice.form = createNoticeForm();
    renderActiveSection();
  }

  async function ensureAccessUsersLoaded() {
    if (state.access.loaded || state.access.loading) {
      return;
    }
    await loadAccessUsers();
  }

  async function loadAccessUsers() {
    state.access.loading = true;
    state.access.error = "";
    if (state.activeSectionId === "access") {
      renderActiveSection();
    }
    try {
      const result = await postAdminFunction("listInovaAdminAccessUsers");
      const users = Array.isArray(result.users)
        ? result.users.map(normalizeAccessUser).filter(Boolean)
        : [];
      state.access.entries = users;
      state.access.loaded = true;
      state.access.draftStatusById = {};
      if (!users.some((entry) => entry.id === state.access.selectedId)) {
        state.access.selectedId = users[0]?.id || "";
      }
    } catch (error) {
      state.access.error = readErrorMessage(error);
      showAdminToast(state.access.error, "error");
    } finally {
      state.access.loading = false;
      if (state.activeSectionId === "access") {
        renderActiveSection();
      }
    }
  }

  async function saveAccessUser() {
    if (state.access.savingId) {
      return;
    }
    const selectedEntry = readAccessEntries().find((entry) => entry.id === state.access.selectedId);
    if (!selectedEntry || selectedEntry.canEdit === false || !isAccessDraftDirty(selectedEntry)) {
      return;
    }
    const nextStatus = readAccessDraftStatus(selectedEntry);
    state.access.savingId = selectedEntry.id;
    state.access.error = "";
    renderActiveSection();
    try {
      const result = await postAdminFunction("saveInovaAdminAccessUser", {
        isAdmin: nextStatus === "active",
        providerUserKey: selectedEntry.providerUserKey,
        status: nextStatus,
      });
      const updatedUser = normalizeAccessUser(result.user);
      if (updatedUser) {
        state.access.entries = readAccessEntries().map((entry) => (
          entry.id === updatedUser.id ? updatedUser : entry
        ));
        delete state.access.draftStatusById[updatedUser.id];
      }
      showAdminToast("저장되었습니다.", "success");
    } catch (error) {
      state.access.error = readErrorMessage(error);
      showAdminToast(state.access.error, "error");
    } finally {
      state.access.savingId = "";
      renderActiveSection();
    }
  }

  function createAccessState() {
    return {
      draftStatusById: {},
      entries: [],
      error: "",
      loaded: false,
      loading: false,
      query: "",
      savingId: "",
      selectedId: "",
      statusFilter: "all",
    };
  }

  function readAccessEntries() {
    return Array.isArray(state.access.entries) ? state.access.entries : [];
  }

  function filterAccessEntries(entries) {
    const query = normalizeText(state.access.query).toLowerCase();
    const statusFilter = normalizeText(state.access.statusFilter) || "all";
    return entries.filter((entry) => {
      const matchesStatus = statusFilter === "all" || readAccessDraftStatus(entry) === statusFilter;
      const haystack = [
        entry.displayName,
        entry.email,
        entry.providerUserKey,
      ].join(" ").toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }

  function readSelectedAccessEntry(entries, visibleEntries) {
    const selectedId = normalizeText(state.access.selectedId);
    const selected = entries.find((entry) => entry.id === selectedId);
    if (selected && visibleEntries.some((entry) => entry.id === selected.id)) {
      return selected;
    }
    const fallback = visibleEntries[0] || entries[0] || null;
    state.access.selectedId = normalizeText(fallback?.id) || "";
    return fallback;
  }

  function readAccessInitial(entry) {
    const source = normalizeText(entry?.displayName || entry?.email || entry?.providerUserKey);
    return source.slice(0, 1).toUpperCase() || "A";
  }

  function readAccessDraftStatus(entry) {
    const entryId = normalizeText(entry?.id);
    const draftStatus = normalizeText(state.access.draftStatusById?.[entryId]).toLowerCase();
    if (draftStatus === "active" || draftStatus === "inactive") {
      return draftStatus;
    }
    return normalizeText(entry?.status).toLowerCase() === "active" ? "active" : "inactive";
  }

  function writeAccessDraftStatus(entryIdInput, statusInput) {
    const entryId = normalizeText(entryIdInput);
    const status = normalizeText(statusInput).toLowerCase();
    if (!entryId || (status !== "active" && status !== "inactive")) {
      return;
    }
    const entry = readAccessEntries().find((candidate) => candidate.id === entryId);
    if (!entry || entry.canEdit === false) {
      return;
    }
    if (normalizeText(entry.status).toLowerCase() === status) {
      delete state.access.draftStatusById[entryId];
      return;
    }
    state.access.draftStatusById[entryId] = status;
  }

  function isAccessDraftDirty(entry) {
    return readAccessDraftStatus(entry) !== (normalizeText(entry?.status).toLowerCase() === "active" ? "active" : "inactive");
  }

  function normalizeAccessUser(input = {}) {
    if (!input || typeof input !== "object") {
      return null;
    }
    const providerUserKey = normalizeText(input.providerUserKey);
    if (!providerUserKey) {
      return null;
    }
    const numericUserId = input.numericUserId;
    const status = normalizeText(input.status).toLowerCase() === "active" ? "active" : "inactive";
    return {
      canEdit: input.canEdit !== false,
      displayName: normalizeText(input.displayName) || normalizeText(input.email) || providerUserKey,
      email: normalizeText(input.email).toLowerCase(),
      id: providerUserKey,
      numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
        ? null
        : Number.isFinite(Number(numericUserId))
          ? Number(numericUserId)
          : null,
      provider: normalizeText(input.provider) || "inova",
      providerUserKey,
      status,
    };
  }

  function readAccessStatusLabel(statusInput) {
    const status = normalizeText(statusInput).toLowerCase();
    if (status === "active") {
      return "관리자";
    }
    if (status === "inactive") {
      return "일반 사용자";
    }
    return "확인 필요";
  }

  function readAccessStatusClass(statusInput) {
    const status = normalizeText(statusInput).toLowerCase();
    if (status === "active") {
      return "inova-badge--success";
    }
    if (status === "inactive") {
      return "inova-badge--muted";
    }
    return "inova-badge--muted";
  }

  function createNoticeState() {
    return {
      activeNoticeId: "",
      error: "",
      fieldErrors: {},
      form: createNoticeForm(),
      loaded: false,
      loading: false,
      notices: [],
      savingAction: "",
    };
  }

  function createNoticeForm(overrides = {}) {
    const overrideCta = overrides.cta && typeof overrides.cta === "object" ? overrides.cta : {};
    const defaultWindow = createDefaultNoticeWindow();
    return {
      bodyMarkdown: "",
      endsAt: toDatetimeLocalInput(defaultWindow.endsAt),
      noticeId: "",
      startsAt: toDatetimeLocalInput(defaultWindow.startsAt),
      title: "",
      ...overrides,
      cta: {
        label: normalizeText(overrideCta.label),
        url: normalizeText(overrideCta.url),
      },
    };
  }

  function createDefaultNoticeWindow() {
    const startsAt = new Date();
    startsAt.setHours(0, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime());
    endsAt.setDate(endsAt.getDate() + 7);
    endsAt.setHours(23, 59, 0, 0);
    return {
      endsAt: endsAt.getTime(),
      startsAt: startsAt.getTime(),
    };
  }

  function createPreferredNoticeForm() {
    const notice = state.notice.notices[0];
    return notice
      ? createNoticeFormFromNotice(notice, { keepNoticeId: true })
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
    } else if (!Number.isFinite(Date.parse(endsAtIso))) {
      fieldErrors.endsAt = "노출 종료는 YYYY-MM-DD HH:mm 형식으로 입력해 주세요.";
    } else if (options.requireFutureEnd === true && Date.parse(endsAtIso) <= Date.now()) {
      fieldErrors.endsAt = "노출 종료 시간은 현재보다 이후여야 합니다.";
    }
    if (startsAtIso && !Number.isFinite(Date.parse(startsAtIso))) {
      fieldErrors.startsAt = "노출 시작은 YYYY-MM-DD HH:mm 형식으로 입력해 주세요.";
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
        fieldErrors["cta.url"] = "CTA URL은 https://로 시작해야 합니다. 예: https://inova.incross.com/";
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
      sortOrder: Number(notice.sortOrder),
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

  function readNoticeDisplayState(notice) {
    if (normalizeText(notice?.status) === "archived") {
      return { className: "is-muted", key: "hidden", label: "비노출" };
    }
    const startsAtMs = Date.parse(normalizeText(notice?.startsAt));
    const endsAtMs = Date.parse(normalizeText(notice?.endsAt));
    const nowMs = Date.now();
    if (!Number.isFinite(endsAtMs)) {
      return { className: "is-muted", key: "hidden", label: "비노출" };
    }
    if (Number.isFinite(startsAtMs) && startsAtMs > nowMs) {
      return { className: "is-draft", key: "scheduled", label: "예정" };
    }
    if (endsAtMs <= nowMs) {
      return { className: "is-muted", key: "expired", label: "종료" };
    }
    return { className: "is-active", key: "visible", label: "노출 중" };
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
    const previewTitle = host.querySelector("[data-notice-preview-title]");
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

  function toDatetimeLocalInput(value) {
    const timestamp = typeof value === "number" ? value : Date.parse(normalizeText(value));
    if (!Number.isFinite(timestamp)) {
      return "";
    }
    const date = new Date(timestamp);
    return [
      date.getFullYear(),
      padDatePart(date.getMonth() + 1),
      padDatePart(date.getDate()),
    ].join("-") + ` ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
  }

  function fromDatetimeLocalInput(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return "";
    }
    const localDate = parseDatetimeInputToDate(normalized);
    if (localDate) {
      return localDate.toISOString();
    }
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : normalized;
  }

  function parseDatetimeInputToDate(value) {
    const match = normalizeText(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    const [, year, month, day, hour, minute] = match;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0,
      0
    );
    if (
      !Number.isFinite(date.getTime())
      || date.getFullYear() !== Number(year)
      || date.getMonth() !== Number(month) - 1
      || date.getDate() !== Number(day)
      || date.getHours() !== Number(hour)
      || date.getMinutes() !== Number(minute)
    ) {
      return null;
    }
    return date;
  }

  function padDatePart(value) {
    return String(value).padStart(2, "0");
  }

  function readPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function findSection(sectionId) {
    return ADMIN_SECTIONS.find((section) => section.id === normalizeText(sectionId));
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

  function createAdminToastController() {
    const designSystem = global.InovaDesignSystem;
    if (designSystem && typeof designSystem.createToastController === "function") {
      return designSystem.createToastController({
        slot: elements.adminToastSlot,
      });
    }
    return Object.freeze({
      hideToast: () => false,
      showToast: () => false,
    });
  }

  function createAdminConfirmController() {
    const designSystem = global.InovaDesignSystem;
    if (designSystem && typeof designSystem.createConfirmController === "function") {
      return designSystem.createConfirmController({
        root: global.document.body,
      });
    }
    return Object.freeze({
      close: () => false,
      confirm: () => Promise.resolve(false),
    });
  }

  function confirmAdminAction(options = {}) {
    return Promise.resolve(confirmController?.confirm?.(options)).then(Boolean);
  }

  function renderAdminIcon(iconName, options) {
    return global.InovaDesignSystem?.renderIcon?.(iconName, options) || "";
  }

  function showAdminToast(message, tone = "success", options = {}) {
    return Boolean(toastController?.showToast?.({
      message,
      tone,
      ...options,
    }));
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
