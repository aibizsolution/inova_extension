const popupRoot = globalThis.InovaBookmarks;
const popupState = {
  settings: { ...popupRoot.constants.defaults.settings },
  pausedSessions: {},
  activeTab: { url: "", title: "" },
  currentSessionId: "",
};

const popupRefs = {};

document.addEventListener("DOMContentLoaded", bootstrapPopup);

async function bootstrapPopup() {
  cachePopupRefs();
  bindPopupEvents();
  await refreshPopup();
  listenPopupStorage();
}

function cachePopupRefs() {
  for (const id of [
    "sitePill",
    "syncStatus",
    "enabledToggle",
    "autoBookmarkToggle",
    "pauseToggle",
    "enabledToggleLabel",
    "autoBookmarkToggleLabel",
    "pauseToggleLabel",
    "tabLabel",
    "sessionLabel",
    "refreshButton",
  ]) {
    popupRefs[id] = document.getElementById(id);
  }
}

function bindPopupEvents() {
  popupRefs.enabledToggle.addEventListener("click", () => toggleSetting("enabled"));
  popupRefs.autoBookmarkToggle.addEventListener("click", () => toggleSetting("autoBookmark"));
  popupRefs.pauseToggle.addEventListener("click", togglePause);
  popupRefs.refreshButton.addEventListener("click", refreshPopup);
}

function listenPopupStorage() {
  if (!chrome?.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.settings) {
      popupState.settings = {
        ...popupRoot.constants.defaults.settings,
        ...(changes.settings.newValue || {}),
      };
    }

    if (changes.pausedSessions) {
      popupState.pausedSessions = changes.pausedSessions.newValue || {};
    }

    renderPopup();
  });
}

async function refreshPopup() {
  setPopupStatus("읽는 중");
  const [storage, activeTab] = await Promise.all([
    popupRoot.storage.getState(),
    getActiveTab(),
  ]);

  popupState.settings = storage.settings || { ...popupRoot.constants.defaults.settings };
  popupState.pausedSessions = storage.pausedSessions || {};
  popupState.activeTab = activeTab;
  popupState.currentSessionId = popupRoot.session.getSessionId(activeTab.url);

  renderPopup();
  setPopupStatus("적용됨");
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { title: tab?.title || "", url: tab?.url || "" };
  } catch {
    return { title: "", url: "" };
  }
}

function renderPopup() {
  const isEnabled = Boolean(popupState.settings.enabled);
  const isAutoBookmark = Boolean(popupState.settings.autoBookmark);
  const isPaused = Boolean(popupState.pausedSessions[popupState.currentSessionId]);

  updateSwitch(popupRefs.enabledToggle, popupRefs.enabledToggleLabel, isEnabled);
  updateSwitch(popupRefs.autoBookmarkToggle, popupRefs.autoBookmarkToggleLabel, isAutoBookmark);
  updateSwitch(popupRefs.pauseToggle, popupRefs.pauseToggleLabel, isPaused);

  popupRefs.sitePill.textContent = isInovaTab() ? "i-Nova" : "다른 사이트";
  popupRefs.tabLabel.textContent = formatTabLabel();
  popupRefs.sessionLabel.textContent = popupState.currentSessionId
    ? popupRoot.session.formatSessionLabel(popupState.currentSessionId)
    : "대화 화면을 열어 주세요";
  popupRefs.pauseToggle.disabled = !popupState.currentSessionId;
}

function updateSwitch(button, label, on) {
  button.dataset.on = String(on);
  button.setAttribute("aria-checked", String(on));
  label.textContent = on ? "켜짐" : "꺼짐";
}

function formatTabLabel() {
  if (!popupState.activeTab.url) {
    return "현재 사이트";
  }

  try {
    const url = new URL(popupState.activeTab.url);
    return url.hostname === "inova.incross.com" ? "inova.incross.com" : `${url.hostname} (지원 안 됨)`;
  } catch {
    return popupState.activeTab.title || "현재 사이트";
  }
}

function isInovaTab() {
  try {
    return new URL(popupState.activeTab.url).hostname === "inova.incross.com";
  } catch {
    return false;
  }
}

async function toggleSetting(key) {
  const next = await popupRoot.storage.updateSettings({
    [key]: !popupState.settings[key],
  });

  popupState.settings = next;
  renderPopup();
  setPopupStatus("적용됨");
}

async function togglePause() {
  if (!popupState.currentSessionId) {
    setPopupStatus("대화 없음");
    return;
  }

  const nextPaused = !popupState.pausedSessions[popupState.currentSessionId];
  popupState.pausedSessions = await popupRoot.storage.setSessionPaused(
    popupState.currentSessionId,
    nextPaused
  );
  renderPopup();
  setPopupStatus("적용됨");
}

function setPopupStatus(text) {
  popupRefs.syncStatus.textContent = text;
}
