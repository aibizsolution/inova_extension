const popupRoot = globalThis.InovaBookmarks;
const popupMeetingConfig = popupRoot.firebaseConfig.meeting;
const LOCAL_MEETING_WORKSPACE_URL = popupMeetingConfig.normalizeWorkspaceUrlOverride("");
const SETTINGS_STORAGE_KEY = popupRoot.productLane?.buildStorageKey?.(popupRoot.constants.storageKeys.settings) || popupRoot.constants.storageKeys.settings;

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
  const normalizedSettings = popupMeetingConfig.normalizeSettings(popupState.settings);
  const target = normalizedSettings.meetingWorkspaceTarget;
  const debugEnabled = normalizedSettings.meetingDebugConsoleEnabled;
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
  const normalizedTarget = popupMeetingConfig.normalizeWorkspaceTarget(target);
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

async function reconcileMeetingWorkspaceSettings(settings) {
  const normalizedSettings = popupMeetingConfig.normalizeSettings(settings);
  const nextSettings = {
    ...popupRoot.constants.defaults.settings,
    ...(settings || {}),
    ...normalizedSettings,
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
