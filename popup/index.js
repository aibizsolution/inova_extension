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
  try {
    cachePopupRefs();
    bindPopupEvents();
    await refreshPopup();
    listenPopupStorage();
  } catch (error) {
    showPopupError(error, "bootstrap");
  }
}

function cachePopupRefs() {
  for (const id of [
    "debugConsoleOffButton",
    "debugConsoleOnButton",
    "popupStatusMessage",
    "workspaceTargetProductionButton",
    "workspaceTargetLocalButton",
  ]) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Popup required element is missing: ${id}`);
    }
    popupRefs[id] = element;
  }
}

function bindPopupEvents() {
  popupRefs.workspaceTargetProductionButton.addEventListener("click", () => runPopupAction(() => setMeetingWorkspaceTarget("production")));
  popupRefs.workspaceTargetLocalButton.addEventListener("click", () => runPopupAction(() => setMeetingWorkspaceTarget("local")));
  popupRefs.debugConsoleOffButton.addEventListener("click", () => runPopupAction(() => setMeetingDebugConsoleEnabled(false)));
  popupRefs.debugConsoleOnButton.addEventListener("click", () => runPopupAction(() => setMeetingDebugConsoleEnabled(true)));
}

function listenPopupStorage() {
  if (!chrome?.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    try {
      const settingsChange = changes?.[SETTINGS_STORAGE_KEY];
      if (areaName !== "local" || !settingsChange) {
        return;
      }

      popupState.settings = {
        ...popupRoot.constants.defaults.settings,
        ...(settingsChange.newValue || {}),
      };
      renderPopup();
    } catch (error) {
      showPopupError(error, "storage-change");
    }
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
  setPopupStatus("ready");
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

async function runPopupAction(action) {
  try {
    setPopupControlsDisabled(true);
    await action();
  } catch (error) {
    showPopupError(error, "action");
  } finally {
    setPopupControlsDisabled(false);
  }
}

function showPopupError(error, stage) {
  const message = getErrorMessage(error, "팝업 설정을 불러오지 못했어요. 확장을 다시 로드한 뒤 다시 시도해 주세요.");
  console.error("[i-Nova Popup] failed", {
    message,
    stage,
  });
  setPopupStatus("error", message);
}

function setPopupStatus(status, message = "") {
  document.body.dataset.status = status;
  const statusMessage = popupRefs.popupStatusMessage;
  if (!(statusMessage instanceof HTMLElement)) {
    return;
  }
  const visibleMessage = String(message || "").trim();
  statusMessage.hidden = !visibleMessage;
  statusMessage.textContent = visibleMessage;
}

function setPopupControlsDisabled(disabled) {
  for (const key of [
    "debugConsoleOffButton",
    "debugConsoleOnButton",
    "workspaceTargetProductionButton",
    "workspaceTargetLocalButton",
  ]) {
    if (popupRefs[key] instanceof HTMLButtonElement) {
      popupRefs[key].disabled = Boolean(disabled);
    }
  }
}

function getErrorMessage(error, fallback) {
  return String(error instanceof Error ? error.message : error || fallback).trim() || fallback;
}
