(function initAdminConsole(global) {
  const SESSION_STORAGE_KEY = "inova-admin-console-session";
  const ACTIVE_SECTION_QUERY_KEY = "section";
  const PROJECT_ID = "browser-extension-main";
  const REGION = "asia-northeast3";
  const PRODUCTION_FUNCTIONS_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
  const MAX_NOTICE_TITLE_LENGTH = 80;
  const MAX_NOTICE_BODY_LENGTH = 800;
  const MAX_NOTICE_CTA_LABEL_LENGTH = 32;
  const MAX_ACCESS_ORGANIZATION_LENGTH = 80;
  const ADMIN_ACCESS_LAST_ACTIVITY_HELP_TEXT = "마지막 활동은 실험실 기능 사용량 집계의 최근 기록 기준입니다. 대화 패널 열기/이동, 프롬프트 저장/적용/삭제, 프롬프트 검토/적용, 스토어 가져오기/좋아요/게시/삭제, 회의 작업실/결과 열기, 릴리스 다운로드 열기 같은 기능 사용 이벤트가 성공/오류/제한 상태로 기록되면 갱신됩니다.";
  const ACCESS_USAGE_FEATURE_LABELS = Object.freeze({
    conversation: "대화 기능",
    meeting: "회의 룸",
    prompt_library: "프롬프트 보관함",
    prompt_review: "프롬프트 검토",
    prompt_store: "스토어",
    release: "릴리스",
  });
  const ACCESS_FILTERS = Object.freeze([
    { id: "all", label: "전체" },
    { id: "active", label: "관리자" },
    { id: "inactive", label: "일반 사용자" },
  ]);
  const ADMIN_SECTIONS = Object.freeze([
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
  ]);
  const NAV_ICON_PATHS = Object.freeze({
    chart: ["M4 19V5", "M4 19h16", "M8 16v-4", "M12 16V8", "M16 16v-7"],
    dashboard: ["M4 5h7v6H4z", "M13 5h7v4h-7z", "M13 11h7v8h-7z", "M4 13h7v6H4z"],
    notice: ["M4 5h16v11H7l-3 3z", "M8 9h8", "M8 12h5"],
    users: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M15 10a2.5 2.5 0 1 0 0-5", "M3 19a6 6 0 0 1 12 0", "M14 14a5 5 0 0 1 7 5"],
  });

  const state = {
    activeSectionId: "access",
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
  let accessSearchController = null;
  let confirmController = null;
  let toastController = null;

  global.addEventListener("DOMContentLoaded", () => {
    bindElements();
    accessSearchController = createAdminDeferredSearchController({
      onSearch: applyAccessSearch,
    });
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
    wrapper.addEventListener("compositionstart", handleAccessCompositionStart);
    wrapper.addEventListener("compositionend", handleAccessCompositionEnd);
    wrapper.addEventListener("search", handleAccessSearch);
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
        <input type="search" data-access-search value="${escapeHtmlAttribute(state.access.searchDraft)}" placeholder="이름 또는 이메일 검색" />
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
          ${entry.organization ? `<span>${escapeHtml(entry.organization)}</span>` : ""}
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
    const isSaving = state.access.savingId === selectedEntry.id;
    const canEditRole = selectedEntry.canEdit !== false && !state.access.savingId;
    const canEditOrganization = !state.access.savingId;
    const detailEmail = selectedEntry?.email || "-";
    const detailName = selectedEntry?.displayName || "-";
    const detailOrganization = readAccessDraftOrganization(selectedEntry);
    const detailLastActivity = readAccessLastActivityLabel(selectedEntry);
    const detailExtensionVersion = readAccessExtensionVersionLabel(selectedEntry);

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
          <button type="button" data-access-role="inactive" ${canEditRole ? "" : "disabled"} aria-pressed="${isAdmin ? "false" : "true"}">일반 사용자</button>
          <button type="button" data-access-role="active" ${canEditRole ? "" : "disabled"} aria-pressed="${isAdmin ? "true" : "false"}">관리자</button>
        </div>
      </div>
      <label class="admin-access-field">
        <span>조직</span>
        <input type="text" data-access-organization maxlength="${MAX_ACCESS_ORGANIZATION_LENGTH}" value="${escapeHtmlAttribute(detailOrganization)}" placeholder="팀명 또는 본부명" ${canEditOrganization ? "" : "disabled"} />
      </label>
      <div class="admin-access-actions">
        <button type="button" class="admin-primary-button is-strong" data-access-action="save" ${canSaveAccessUser(selectedEntry) ? "" : "disabled"}>${isSaving ? "저장 중" : "저장"}</button>
      </div>
      <div class="admin-access-meta" aria-label="회원 활동 정보">
        <div class="admin-access-meta__label">
          <span class="admin-access-meta__label-text">마지막 활동</span>
          <span class="admin-help-chip" tabindex="0" aria-label="${escapeHtmlAttribute(ADMIN_ACCESS_LAST_ACTIVITY_HELP_TEXT)}" title="${escapeHtmlAttribute(ADMIN_ACCESS_LAST_ACTIVITY_HELP_TEXT)}">?</span>
        </div>
        <strong>${escapeHtml(detailLastActivity)}</strong>
        <span class="admin-access-meta__sub">마지막 이용 버전 ${escapeHtml(detailExtensionVersion)}</span>
      </div>
      ${createAccessUsagePanel(selectedEntry)}
    `;
    return panel;
  }

  function createAccessUsagePanel(entry) {
    const featureCount = readAccessUsageFeatureTotal(entry);
    const meetingMonthMinutes = readAccessUsageMeetingMonthMinutes(entry);
    const meetingMonthCount = readAccessUsageMeetingMonthCount(entry);
    const meetingMinutes = readAccessUsageMeetingMinutes(entry);
    const meetingCount = readAccessUsageMeetingCount(entry);
    const featureUsage = normalizeAccessUsageFeatureUsage(entry?.featureUsage);
    const featureRecordCount = Object.keys(featureUsage).length;
    return `
      <section class="admin-access-usage" aria-label="선택 회원 이용 기록">
        <div class="admin-access-usage__head">
          <span>이용 기록</span>
          <small>${escapeHtml(featureRecordCount ? `${formatUsageNumber(featureRecordCount)}개 기능` : "기록 없음")}</small>
        </div>
        <div class="admin-access-usage__metrics">
          ${createAccessUsageMetric("기능 사용", `${formatUsageNumber(featureCount)}회`)}
          ${createAccessUsageMetric("회의 처리", `
            <span class="admin-access-usage__split">
              <span>이번 달 <strong>${escapeHtml(`${formatUsageDuration(meetingMonthMinutes)} · ${formatUsageNumber(meetingMonthCount)}건`)}</strong></span>
              <span>전체 <strong>${escapeHtml(`${formatUsageDuration(meetingMinutes)} · ${formatUsageNumber(meetingCount)}건`)}</strong></span>
            </span>
          `, { htmlValue: true })}
        </div>
        <div class="admin-access-usage__records">
          <div class="admin-access-usage__record-head" aria-hidden="true">
            <span>기능</span>
            <span>사용 횟수</span>
          </div>
          ${createAccessUsageRecordRows(featureUsage)}
        </div>
      </section>
    `;
  }

  function createAccessUsageMetric(label, value, options = {}) {
    return `
      <div>
        <span>${escapeHtml(label)}</span>
        ${options.htmlValue === true ? value : `<strong>${escapeHtml(value)}</strong>`}
      </div>
    `;
  }

  function createAccessUsageRecordRows(featureUsage) {
    const rows = Object.entries(normalizeAccessUsageFeatureUsage(featureUsage))
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko-KR"))
      .map(([label, count]) => `
        <div class="admin-access-usage__record-row">
          <span>${escapeHtml(formatAccessUsageFeatureLabel(label))}</span>
          <strong>${escapeHtml(`${formatUsageNumber(count)}회`)}</strong>
        </div>
      `);
    return rows.join("") || '<p class="admin-access-empty">기능 사용 기록이 없습니다.</p>';
  }

  function formatAccessUsageFeatureLabel(featureId) {
    const normalizedFeatureId = normalizeText(featureId);
    return ACCESS_USAGE_FEATURE_LABELS[normalizedFeatureId] || normalizedFeatureId;
  }

  function handleAccessInput(event) {
    const target = event.target;
    if (target?.matches?.("[data-access-search]")) {
      state.access.searchDraft = String(target.value || "");
      accessSearchController?.handleInput?.(target.value, {
        composing: Boolean(event.isComposing),
      });
      return;
    }
    if (target?.matches?.("[data-access-organization]")) {
      writeAccessDraftOrganization(state.access.selectedId, target.value);
      updateAccessSaveButton(event.currentTarget);
    }
  }

  function handleAccessCompositionStart(event) {
    if (!event.target?.matches?.("[data-access-search]")) {
      return;
    }
    accessSearchController?.handleCompositionStart?.();
  }

  function handleAccessCompositionEnd(event) {
    const target = event.target;
    if (!target?.matches?.("[data-access-search]")) {
      return;
    }
    state.access.searchDraft = String(target.value || "");
    accessSearchController?.handleCompositionEnd?.(target.value);
  }

  function handleAccessSearch(event) {
    const target = event.target;
    if (!target?.matches?.("[data-access-search]")) {
      return;
    }
    state.access.searchDraft = String(target.value || "");
    accessSearchController?.flush?.(target.value);
  }

  function handleAccessClick(event) {
    if (event.target?.closest?.("[data-access-search]")) {
      return;
    }
    accessSearchController?.flush?.(state.access.searchDraft);
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
    body.textContent = "이 메뉴의 운영 화면은 아직 연결되지 않았습니다. 기능을 붙일 때는 이 outlet 안에서 독립적으로 확장합니다.";

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
              <button type="button" tabindex="-1">하루동안 안보기</button>
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
      state.access.entries = users.sort(compareAccessEntries);
      state.access.loaded = true;
      state.access.draftStatusById = {};
      state.access.draftOrganizationById = {};
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
    if (!canSaveAccessUser(selectedEntry)) {
      return;
    }
    const nextStatus = readAccessDraftStatus(selectedEntry);
    state.access.savingId = selectedEntry.id;
    state.access.error = "";
    renderActiveSection();
    try {
      const result = await postAdminFunction("saveInovaAdminAccessUser", {
        isAdmin: nextStatus === "active",
        organization: readAccessDraftOrganization(selectedEntry),
        providerUserKey: selectedEntry.providerUserKey,
        status: nextStatus,
      });
      const updatedUser = normalizeAccessUser(result.user);
      if (updatedUser) {
        state.access.entries = readAccessEntries().map((entry) => (
          entry.id === updatedUser.id ? updatedUser : entry
        ));
        delete state.access.draftStatusById[updatedUser.id];
        delete state.access.draftOrganizationById[updatedUser.id];
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
      draftOrganizationById: {},
      entries: [],
      error: "",
      loaded: false,
      loading: false,
      query: "",
      savingId: "",
      searchDraft: "",
      selectedId: "",
      statusFilter: "all",
    };
  }

  function applyAccessSearch(query, details = {}) {
    const focusState = readAccessSearchFocusState();
    const nextQuery = normalizeText(query);
    const nextDraft = typeof details.rawValue === "string" ? details.rawValue : nextQuery;
    state.access.query = nextQuery;
    state.access.searchDraft = nextDraft;
    if (state.activeSectionId === "access") {
      renderActiveSection();
      restoreAccessSearchFocus(focusState);
    }
  }

  function readAccessSearchFocusState() {
    const activeElement = global.document?.activeElement;
    if (!activeElement?.matches?.("[data-access-search]")) {
      return null;
    }
    return {
      selectionDirection: activeElement.selectionDirection || "none",
      selectionEnd: Number(activeElement.selectionEnd),
      selectionStart: Number(activeElement.selectionStart),
    };
  }

  function restoreAccessSearchFocus(focusState) {
    if (!focusState) {
      return;
    }
    const input = elements.pageOutlet?.querySelector?.("[data-access-search]");
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    if (typeof input.setSelectionRange !== "function") {
      return;
    }
    const valueLength = String(input.value || "").length;
    const selectionStart = clampNumber(focusState.selectionStart, 0, valueLength);
    const selectionEnd = clampNumber(focusState.selectionEnd, selectionStart, valueLength);
    input.setSelectionRange(selectionStart, selectionEnd, focusState.selectionDirection);
  }

  function readAccessEntries() {
    return Array.isArray(state.access.entries) ? state.access.entries : [];
  }

  function normalizeAccessUsageFeatureUsage(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {};
    }
    return Object.fromEntries(Object.entries(input)
      .map(([label, count]) => [normalizeText(label), Math.max(0, Number(count) || 0)])
      .filter(([label, count]) => label && count > 0));
  }

  function readAccessUsageFeatureTotal(entry) {
    const explicitCount = Number(entry?.featureCount);
    const featureUsageTotal = Object.values(normalizeAccessUsageFeatureUsage(entry?.featureUsage))
      .reduce((total, count) => total + count, 0);
    if (featureUsageTotal > 0) {
      return featureUsageTotal;
    }
    return Math.max(0, Number.isFinite(explicitCount) ? explicitCount : 0);
  }

  function readAccessUsageMeetingMinutes(entry) {
    return Math.max(0, Math.round(Number(entry?.meetingMinutes) || 0));
  }

  function readAccessUsageMeetingCount(entry) {
    return Math.max(0, Math.round(Number(entry?.meetingCount) || 0));
  }

  function readAccessUsageMeetingMonthMinutes(entry) {
    return Math.max(0, Math.round(Number(entry?.meetingMonthMinutes) || 0));
  }

  function readAccessUsageMeetingMonthCount(entry) {
    return Math.max(0, Math.round(Number(entry?.meetingMonthCount) || 0));
  }

  function formatUsageNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Math.max(0, Number(value) || 0));
  }

  function formatUsageDuration(minutesInput) {
    const minutes = Math.max(0, Math.round(Number(minutesInput) || 0));
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`;
    }
    return `${minutes}분`;
  }

  function filterAccessEntries(entries) {
    const query = normalizeText(state.access.query).toLowerCase();
    const statusFilter = normalizeText(state.access.statusFilter) || "all";
    return entries.filter((entry) => {
      const matchesStatus = statusFilter === "all" || readAccessDraftStatus(entry) === statusFilter;
      const haystack = [
        entry.displayName,
        entry.email,
        entry.organization,
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

  function readAccessDraftOrganization(entry) {
    const entryId = normalizeText(entry?.id);
    if (!entryId) {
      return "";
    }
    if (Object.prototype.hasOwnProperty.call(state.access.draftOrganizationById, entryId)) {
      return String(state.access.draftOrganizationById[entryId] || "");
    }
    return normalizeText(entry?.organization);
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

  function writeAccessDraftOrganization(entryIdInput, organizationInput) {
    const entryId = normalizeText(entryIdInput);
    if (!entryId) {
      return;
    }
    const entry = readAccessEntries().find((candidate) => candidate.id === entryId);
    if (!entry) {
      return;
    }
    const nextOrganization = String(organizationInput || "").slice(0, MAX_ACCESS_ORGANIZATION_LENGTH);
    if (normalizeText(entry.organization) === normalizeText(nextOrganization)) {
      delete state.access.draftOrganizationById[entryId];
      return;
    }
    state.access.draftOrganizationById[entryId] = nextOrganization;
  }

  function isAccessRoleDraftDirty(entry) {
    return readAccessDraftStatus(entry) !== (normalizeText(entry?.status).toLowerCase() === "active" ? "active" : "inactive");
  }

  function isAccessOrganizationDraftDirty(entry) {
    return normalizeText(readAccessDraftOrganization(entry)) !== normalizeText(entry?.organization);
  }

  function canSaveAccessUser(entry) {
    if (!entry || state.access.savingId) {
      return false;
    }
    if (isAccessOrganizationDraftDirty(entry)) {
      return true;
    }
    return entry.canEdit !== false && isAccessRoleDraftDirty(entry);
  }

  function updateAccessSaveButton(host) {
    const button = host?.querySelector?.("[data-access-action=\"save\"]");
    const entry = readAccessEntries().find((candidate) => candidate.id === state.access.selectedId);
    if (button) {
      button.disabled = !canSaveAccessUser(entry);
    }
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
    const featureUsage = normalizeAccessUsageFeatureUsage(input.featureUsage || input.featureTotals);
    const featureCount = readAccessUsageFeatureTotal({
      featureCount: input.featureCount,
      featureUsage,
    });
    return {
      canEdit: input.canEdit !== false,
      displayName: normalizeText(input.displayName) || normalizeText(input.email) || providerUserKey,
      email: normalizeText(input.email).toLowerCase(),
      extensionVersion: normalizeAccessExtensionVersion(input.extensionVersion || input.lastExtensionVersion),
      extensionVersionCheckedAt: normalizeText(input.extensionVersionCheckedAt || input.lastExtensionVersionAt),
      featureCount,
      featureUsage,
      id: providerUserKey,
      lastActivityAt: normalizeText(input.lastActivityAt),
      meetingMonthCount: readAccessUsageMeetingMonthCount(input),
      meetingMonthMinutes: readAccessUsageMeetingMonthMinutes(input),
      meetingCount: readAccessUsageMeetingCount(input),
      meetingMinutes: readAccessUsageMeetingMinutes(input),
      numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
        ? null
        : Number.isFinite(Number(numericUserId))
          ? Number(numericUserId)
          : null,
      provider: normalizeText(input.provider) || "inova",
      providerUserKey,
      organization: normalizeText(input.organization),
      status,
    };
  }

  function compareAccessEntries(left, right) {
    const leftActivity = Date.parse(normalizeText(left?.lastActivityAt));
    const rightActivity = Date.parse(normalizeText(right?.lastActivityAt));
    const leftHasActivity = Number.isFinite(leftActivity);
    const rightHasActivity = Number.isFinite(rightActivity);
    if (leftHasActivity || rightHasActivity) {
      if (!leftHasActivity) {
        return 1;
      }
      if (!rightHasActivity) {
        return -1;
      }
      if (leftActivity !== rightActivity) {
        return rightActivity - leftActivity;
      }
    }
    const leftStatus = normalizeText(left?.status).toLowerCase();
    const rightStatus = normalizeText(right?.status).toLowerCase();
    if (leftStatus !== rightStatus) {
      return leftStatus === "active" ? -1 : 1;
    }
    const leftName = normalizeText(left?.displayName || left?.email || left?.providerUserKey).toLowerCase();
    const rightName = normalizeText(right?.displayName || right?.email || right?.providerUserKey).toLowerCase();
    return leftName.localeCompare(rightName, "ko-KR");
  }

  function readAccessLastActivityLabel(entry) {
    const formatted = formatDateTime(entry?.lastActivityAt);
    return formatted === "-" ? "기록 없음" : formatted;
  }

  function readAccessExtensionVersionLabel(entry) {
    const version = normalizeAccessExtensionVersion(entry?.extensionVersion);
    return version ? `v${version}` : "기록 없음";
  }

  function normalizeAccessExtensionVersion(value) {
    return normalizeText(value).replace(/^v/i, "").slice(0, 40);
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
      if (error) {
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-invalid");
      }
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

  function createAdminDeferredSearchController(options = {}) {
    const designSystem = global.InovaDesignSystem;
    if (designSystem && typeof designSystem.createDeferredSearchController === "function") {
      return designSystem.createDeferredSearchController(options);
    }
    return Object.freeze({
      cancel: () => false,
      flush: (value) => {
        options.onSearch?.(normalizeText(value));
        return true;
      },
      handleCompositionEnd: (value) => {
        options.onSearch?.(normalizeText(value));
        return true;
      },
      handleCompositionStart: () => true,
      handleInput: (value) => {
        options.onSearch?.(normalizeText(value));
        return true;
      },
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

  function clampNumber(value, min, max) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return min;
    }
    return Math.min(max, Math.max(min, numericValue));
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
