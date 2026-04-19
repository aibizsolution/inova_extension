(function initAdminConsole(global) {
  const SESSION_STORAGE_KEY = "inova-admin-console-session";
  const PROJECT_ID = "browser-extension-main";
  const REGION = "asia-northeast3";
  const PRODUCTION_FUNCTIONS_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
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
    release: ["M12 3v10", "M8 7l4-4 4 4", "M5 13v5h14v-5"],
    system: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v3", "M12 19v3", "M4.9 4.9l2.1 2.1", "M17 17l2.1 2.1", "M2 12h3", "M19 12h3", "M4.9 19.1 7 17", "M17 7l2.1-2.1"],
    users: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M15 10a2.5 2.5 0 1 0 0-5", "M3 19a6 6 0 0 1 12 0", "M14 14a5 5 0 0 1 7 5"],
  });

  const state = {
    activeSectionId: "overview",
    busy: false,
    error: "",
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
      throw new Error(normalizeText(payload?.error?.message || payload?.message) || "관리자 요청에 실패했어요.");
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
      "sideAccessState",
      "sideSessionExpiresAt",
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
    setText(elements.sideAccessState, state.role || "-");
    setText(elements.sideSessionExpiresAt, formatDateTime(state.sessionExpiresAt));
    renderNavigation();
    renderActiveSection();
  }

  function renderBlocked(message) {
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
})(globalThis);
