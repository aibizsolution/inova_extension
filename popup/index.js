const popupRoot = globalThis.InovaBookmarks;
const LOCAL_MEETING_WORKSPACE_URL = "http://127.0.0.1:5000/meeting/index.html";
const SETTINGS_STORAGE_KEY = popupRoot.productLane?.buildStorageKey?.(popupRoot.constants.storageKeys.settings) || popupRoot.constants.storageKeys.settings;
// verify-docs anchor: workspaceTargetHint

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
    "debugConsoleOffButton",
    "debugConsoleOnButton",
    "workspaceTargetProductionButton",
    "workspaceTargetLocalButton",
  ]) {
    popupRefs[id] = document.getElementById(id);
  }
}

function bindPopupEvents() {
  popupRefs.workspaceTargetProductionButton.addEventListener("click", () => setMeetingWorkspaceTarget("production"));
  popupRefs.workspaceTargetLocalButton.addEventListener("click", () => setMeetingWorkspaceTarget("local"));
  popupRefs.debugConsoleOffButton.addEventListener("click", () => setMeetingDebugConsoleEnabled(false));
  popupRefs.debugConsoleOnButton.addEventListener("click", () => setMeetingDebugConsoleEnabled(true));
}

function listenPopupStorage() {
  if (!chrome?.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const settingsChange = changes?.[SETTINGS_STORAGE_KEY];
    if (areaName !== "local" || !settingsChange) {
      return;
    }

    popupState.settings = {
      ...popupRoot.constants.defaults.settings,
      ...(settingsChange.newValue || {}),
    };
    renderPopup();
  });
}

async function refreshPopup() {
  const storage = await popupRoot.storage.getState();
  const nextSettings = await reconcileMeetingWorkspaceSettings({
    ...popupRoot.constants.defaults.settings,
    ...(storage.settings || {}),
  });
  popupState.settings = nextSettings;
  renderPopup();
}

function renderPopup() {
  const target = normalizeMeetingWorkspaceTarget(popupState.settings.meetingWorkspaceTarget);
  const debugEnabled = normalizeMeetingDebugConsoleEnabled(popupState.settings.meetingDebugConsoleEnabled);
  popupRefs.workspaceTargetProductionButton.dataset.selected = String(target === "production");
  popupRefs.workspaceTargetLocalButton.dataset.selected = String(target === "local");
  popupRefs.workspaceTargetProductionButton.setAttribute("aria-pressed", String(target === "production"));
  popupRefs.workspaceTargetLocalButton.setAttribute("aria-pressed", String(target === "local"));
  popupRefs.debugConsoleOffButton.dataset.selected = String(!debugEnabled);
  popupRefs.debugConsoleOnButton.dataset.selected = String(debugEnabled);
  popupRefs.debugConsoleOffButton.setAttribute("aria-pressed", String(!debugEnabled));
  popupRefs.debugConsoleOnButton.setAttribute("aria-pressed", String(debugEnabled));
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

async function setMeetingDebugConsoleEnabled(enabled) {
  const nextSettings = await popupRoot.storage.updateSettings({
    meetingDebugConsoleEnabled: Boolean(enabled),
  });
  popupState.settings = nextSettings;
  renderPopup();
}

function normalizeMeetingWorkspaceTarget(value) {
  return String(value || "").trim().toLowerCase() === "local" ? "local" : "production";
}

function normalizeMeetingDebugConsoleEnabled(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

async function reconcileMeetingWorkspaceSettings(settings) {
  const currentTarget = normalizeMeetingWorkspaceTarget(settings?.meetingWorkspaceTarget);
  const currentDebugEnabled = normalizeMeetingDebugConsoleEnabled(settings?.meetingDebugConsoleEnabled);
  const currentOverride = normalizeMeetingWorkspaceOverrideUrl(settings?.meetingWorkspaceUrlOverride);
  const nextSettings = {
    ...popupRoot.constants.defaults.settings,
    ...(settings || {}),
    meetingDebugConsoleEnabled: currentDebugEnabled,
    meetingWorkspaceTarget: currentTarget,
    meetingWorkspaceUrlOverride: currentTarget === "local" ? currentOverride : "",
  };
  if (
    nextSettings.meetingDebugConsoleEnabled !== settings?.meetingDebugConsoleEnabled
    || nextSettings.meetingWorkspaceTarget !== settings?.meetingWorkspaceTarget
    || nextSettings.meetingWorkspaceUrlOverride !== settings?.meetingWorkspaceUrlOverride
  ) {
    return popupRoot.storage.updateSettings({
      meetingDebugConsoleEnabled: nextSettings.meetingDebugConsoleEnabled,
      meetingWorkspaceTarget: nextSettings.meetingWorkspaceTarget,
      meetingWorkspaceUrlOverride: nextSettings.meetingWorkspaceUrlOverride,
    });
  }
  return nextSettings;
}

function normalizeMeetingWorkspaceOverrideUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return LOCAL_MEETING_WORKSPACE_URL;
  }
  try {
    const url = new URL(normalized);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      url.port = "5000";
      url.pathname = "/meeting/index.html";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {}
  return LOCAL_MEETING_WORKSPACE_URL;
}
