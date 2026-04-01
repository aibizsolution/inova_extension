const popupRoot = globalThis.InovaBookmarks;
const LOCAL_MEETING_WORKSPACE_URL = "http://127.0.0.1:5000/meeting/index.html";

const popupState = {
  settings: { ...popupRoot.constants.defaults.settings },
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
    "workspaceTargetProductionButton",
    "workspaceTargetLocalButton",
    "workspaceTargetHint",
  ]) {
    popupRefs[id] = document.getElementById(id);
  }
}

function bindPopupEvents() {
  popupRefs.workspaceTargetProductionButton.addEventListener("click", () => setMeetingWorkspaceTarget("production"));
  popupRefs.workspaceTargetLocalButton.addEventListener("click", () => setMeetingWorkspaceTarget("local"));
}

function listenPopupStorage() {
  if (!chrome?.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.settings) {
      return;
    }

    popupState.settings = {
      ...popupRoot.constants.defaults.settings,
      ...(changes.settings.newValue || {}),
    };
    renderPopup();
  });
}

async function refreshPopup() {
  const storage = await popupRoot.storage.getState();
  popupState.settings = {
    ...popupRoot.constants.defaults.settings,
    ...(storage.settings || {}),
  };
  renderPopup();
}

function renderPopup() {
  const target = normalizeMeetingWorkspaceTarget(popupState.settings.meetingWorkspaceTarget);
  popupRefs.workspaceTargetProductionButton.dataset.selected = String(target === "production");
  popupRefs.workspaceTargetLocalButton.dataset.selected = String(target === "local");
  popupRefs.workspaceTargetProductionButton.setAttribute("aria-pressed", String(target === "production"));
  popupRefs.workspaceTargetLocalButton.setAttribute("aria-pressed", String(target === "local"));
  popupRefs.workspaceTargetHint.textContent = target === "local"
    ? "로컬 호스팅을 사용합니다. 패널에서 회의를 열면 http://127.0.0.1:5000/meeting/index.html로 연결됩니다."
    : "상용 호스팅을 사용합니다. 패널에서 회의를 열면 배포된 hosted 작업실로 연결됩니다.";
}

async function setMeetingWorkspaceTarget(target) {
  const normalizedTarget = normalizeMeetingWorkspaceTarget(target);
  const nextSettings = await popupRoot.storage.updateSettings({
    meetingWorkspaceTarget: normalizedTarget,
    meetingWorkspaceUrlOverride: normalizedTarget === "local" ? LOCAL_MEETING_WORKSPACE_URL : "",
  });
  popupState.settings = nextSettings;
  renderPopup();
}

function normalizeMeetingWorkspaceTarget(value) {
  return String(value || "").trim().toLowerCase() === "local" ? "local" : "production";
}
