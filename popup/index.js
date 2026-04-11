const popupRoot = globalThis.InovaBookmarks;
const LOCAL_MEETING_WORKSPACE_URL = "http://127.0.0.1:5000/meeting/index.html";
const SETTINGS_STORAGE_KEY = popupRoot.productLane?.buildStorageKey?.(popupRoot.constants.storageKeys.settings) || popupRoot.constants.storageKeys.settings;
// verify-docs anchor: workspaceTargetHint

const popupState = {
  refreshMessage: "",
  refreshTone: "info",
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
    "refreshInovaButton",
    "workspaceTargetProductionButton",
    "workspaceTargetLocalButton",
    "workspaceTargetHint",
    "workspaceTargetStatus",
  ]) {
    popupRefs[id] = document.getElementById(id);
  }
}

function bindPopupEvents() {
  popupRefs.workspaceTargetProductionButton.addEventListener("click", () => setMeetingWorkspaceTarget("production"));
  popupRefs.workspaceTargetLocalButton.addEventListener("click", () => setMeetingWorkspaceTarget("local"));
  popupRefs.refreshInovaButton.addEventListener("click", refreshActiveInovaTab);
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
  popupRefs.workspaceTargetHint.textContent = target === "local"
    ? "로컬을 고르면 실험실 패널, 프롬프트, 회의 hosted UI가 127.0.0.1:5000 기준으로 전환돼요. hosting만 보면 emulator:hosting, full-stack이면 emulator:meeting-local 후 i-Nova 탭을 다시 열어 주세요."
    : "상용을 고르면 실험실 패널과 회의 hosted 화면이 배포된 hosting을 사용해요. target을 바꾼 뒤 i-Nova 탭을 다시 열면 바로 확인할 수 있어요.";
  popupRefs.refreshInovaButton.textContent = target === "local" ? "로컬 다시 열기" : "i-Nova 열기";
  popupRefs.workspaceTargetStatus.hidden = !popupState.refreshMessage;
  popupRefs.workspaceTargetStatus.textContent = popupState.refreshMessage;
  popupRefs.workspaceTargetStatus.dataset.tone = popupState.refreshTone;
}

async function setMeetingWorkspaceTarget(target) {
  const normalizedTarget = normalizeMeetingWorkspaceTarget(target);
  const nextSettings = await popupRoot.storage.updateSettings({
    meetingWorkspaceTarget: normalizedTarget,
    meetingWorkspaceUrlOverride: normalizedTarget === "local" ? LOCAL_MEETING_WORKSPACE_URL : "",
  });
  popupState.settings = nextSettings;
  setRefreshMessage(
    normalizedTarget === "local"
      ? "로컬 호스팅으로 바꿨어요. i-Nova 탭을 다시 열면 hosted panel도 로컬 자산을 봅니다."
      : "상용 호스팅으로 바꿨어요. i-Nova 탭을 다시 열면 배포 자산으로 돌아갑니다."
  );
  renderPopup();
}

async function setMeetingDebugConsoleEnabled(enabled) {
  const nextSettings = await popupRoot.storage.updateSettings({
    meetingDebugConsoleEnabled: Boolean(enabled),
  });
  popupState.settings = nextSettings;
  renderPopup();
}

async function refreshActiveInovaTab() {
  const target = normalizeMeetingWorkspaceTarget(popupState.settings.meetingWorkspaceTarget);
  try {
    const tabs = await chrome.tabs.query({
      currentWindow: true,
      url: "https://inova.incross.com/*",
    });
    const activeTab = tabs.find((tab) => tab.active) || tabs[0];
    if (activeTab?.id) {
      await chrome.tabs.reload(activeTab.id);
      await chrome.tabs.update(activeTab.id, { active: true });
      setRefreshMessage(
        target === "local"
          ? "현재 i-Nova 탭을 새로고침했어요. 로컬 hosted panel로 다시 붙습니다."
          : "현재 i-Nova 탭을 새로고침했어요."
      );
      renderPopup();
      return;
    }
    await chrome.tabs.create({ url: "https://inova.incross.com/" });
    setRefreshMessage(
      target === "local"
        ? "i-Nova 새 탭을 열었어요. 로컬 hosted panel은 emulator가 켜져 있어야 보여요."
        : "i-Nova 새 탭을 열었어요."
    );
    renderPopup();
  } catch {
    setRefreshMessage("i-Nova 탭을 열지 못했어요. Chrome 탭 권한과 현재 창 상태를 확인해 주세요.", "error");
    renderPopup();
  }
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

function setRefreshMessage(message, tone = "info") {
  popupState.refreshMessage = String(message || "").trim();
  popupState.refreshTone = String(tone || "").trim() || "info";
}
