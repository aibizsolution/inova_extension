const popupRoot = globalThis.InovaBookmarks;
const popupState = {
  settings: { ...popupRoot.constants.defaults.settings },
  pausedSessions: {},
  activeTab: { url: "", title: "" },
  currentSessionId: "",
  meetingState: popupRoot.meetingState.mergeMeetingState(),
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
    "pauseToggle",
    "enabledToggleLabel",
    "pauseToggleLabel",
    "tabLabel",
    "sessionLabel",
    "refreshButton",
    "pauseControl",
    "meetingTitle",
    "meetingBadge",
    "meetingSummary",
    "meetingHint",
  ]) {
    popupRefs[id] = document.getElementById(id);
  }
}

function bindPopupEvents() {
  popupRefs.enabledToggle.addEventListener("click", () => toggleSetting("enabled"));
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

    if (changes.meetingState) {
      popupState.meetingState = popupRoot.meetingState.mergeMeetingState(changes.meetingState.newValue);
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
  popupState.meetingState = popupRoot.meetingState.mergeMeetingState(storage.meetingState);
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
  const isPaused = Boolean(popupState.pausedSessions[popupState.currentSessionId]);
  const showPauseControl = isEnabled && isInovaTab() && Boolean(popupState.currentSessionId);
  // autoBookmark는 기본 동작으로 유지하고 popup에서는 별도 토글을 숨깁니다.

  updateSwitch(popupRefs.enabledToggle, popupRefs.enabledToggleLabel, isEnabled);
  updateSwitch(popupRefs.pauseToggle, popupRefs.pauseToggleLabel, isPaused);

  popupRefs.sitePill.textContent = isInovaTab() ? "i-Nova" : "지원 안 됨";
  popupRefs.tabLabel.textContent = formatTabLabel();
  popupRefs.sessionLabel.textContent = popupState.currentSessionId
    ? popupRoot.session.formatSessionLabel(popupState.currentSessionId)
    : "대화 화면을 열어 주세요";
  popupRefs.pauseControl.hidden = !showPauseControl;
  popupRefs.pauseToggle.disabled = !popupState.currentSessionId;
  renderMeetingCard();
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

function renderMeetingCard() {
  const view = buildMeetingViewModel();
  popupRefs.meetingTitle.textContent = view.title;
  popupRefs.meetingBadge.textContent = view.badgeLabel;
  popupRefs.meetingBadge.dataset.status = view.badgeStatus;
  popupRefs.meetingSummary.textContent = view.summary;
  popupRefs.meetingHint.textContent = view.hint;
}

function buildMeetingViewModel() {
  const meetingState = popupRoot.meetingState.mergeMeetingState(popupState.meetingState);
  const trackedSessionId = popupRoot.session.normalizeText(meetingState.session.sessionId);
  const currentSessionId = popupState.currentSessionId;
  const sameSession = Boolean(currentSessionId && trackedSessionId && currentSessionId === trackedSessionId);
  const jobStatus = popupRoot.session.normalizeText(meetingState.job.status) || "idle";
  const meetingLabel = popupRoot.session.normalizeText(meetingState.session.title)
    || (trackedSessionId ? popupRoot.session.formatSessionLabel(trackedSessionId) : "현재 대화 회의 상태");

  if (!isInovaTab()) {
    return {
      badgeLabel: "대기",
      badgeStatus: "idle",
      title: "현재 대화 회의 상태",
      summary: "i-Nova 대화를 열면 현재 회의 상태를 여기서 확인할 수 있어요.",
      hint: "브라우저 meetingState를 기준으로 현재 대화 준비 상태를 먼저 보여줍니다.",
    };
  }

  if (!currentSessionId) {
    return {
      badgeLabel: "대기",
      badgeStatus: "idle",
      title: "현재 대화 회의 상태",
      summary: "대화 화면을 열면 현재 회의 작업 상태를 바로 확인할 수 있어요.",
      hint: "지금은 현재 탭에서 session id를 읽지 못했어요.",
    };
  }

  if (sameSession && jobStatus === "queued") {
    return {
      badgeLabel: "대기",
      badgeStatus: "queued",
      title: meetingLabel,
      summary: "회의 전사 작업이 접수되어 순서를 기다리고 있어요.",
      hint: "업로드 이후 job 상태가 바뀌면 여기서 바로 반영됩니다.",
    };
  }

  if (sameSession && jobStatus === "processing") {
    const percent = Math.round(Number(meetingState.job.progress.percent) || 0);
    const phase = formatMeetingPhase(meetingState.job.progress.phase);
    return {
      badgeLabel: "진행 중",
      badgeStatus: "processing",
      title: meetingLabel,
      summary: "회의 전사를 처리하고 있어요.",
      hint: phase ? `${phase}${percent > 0 ? ` · ${percent}%` : ""}` : percent > 0 ? `${percent}%` : "상태를 확인하는 중입니다.",
    };
  }

  if (sameSession && jobStatus === "succeeded") {
    const speakerCount = Math.max(0, Number(meetingState.transcript.speakerCount) || 0);
    return {
      badgeLabel: "완료",
      badgeStatus: "succeeded",
      title: meetingLabel,
      summary: speakerCount > 0
        ? `${speakerCount}명 화자 기준으로 전사 결과가 준비됐어요.`
        : "전사 결과가 준비됐어요.",
      hint: formatMeetingLoadedAt(meetingState.transcript.loadedAt) || "artifact를 읽을 준비가 됐어요.",
    };
  }

  if (sameSession && jobStatus === "failed") {
    return {
      badgeLabel: "오류",
      badgeStatus: "failed",
      title: meetingLabel,
      summary: "회의 처리 중 문제가 생겨 다시 확인이 필요해요.",
      hint: popupRoot.session.normalizeText(meetingState.job.error) || "job 상태와 업로드 경로를 다시 확인해 주세요.",
    };
  }

  if (trackedSessionId && trackedSessionId !== currentSessionId && jobStatus !== "idle") {
    return {
      badgeLabel: formatMeetingBadgeLabel(jobStatus),
      badgeStatus: normalizeMeetingBadgeStatus(jobStatus),
      title: "다른 대화 회의 상태",
      summary: `${meetingLabel} 기준 회의 작업 상태가 남아 있어요.`,
      hint: "지금은 마지막으로 반영된 meetingState를 먼저 보여주고 있습니다.",
    };
  }

  return {
    badgeLabel: "대기",
    badgeStatus: "idle",
    title: "현재 대화 회의 상태",
    summary: "현재 대화에 연결된 회의 작업이 아직 없어요.",
    hint: "녹음과 전사 흐름이 붙으면 여기에 진행 상태가 보입니다.",
  };
}

function formatMeetingPhase(phase) {
  const normalized = popupRoot.session.normalizeText(phase);
  if (normalized === "uploading") return "업로드 중";
  if (normalized === "queued") return "대기 중";
  if (normalized === "transcribing") return "텍스트 변환";
  if (normalized === "diarizing") return "화자 분리";
  if (normalized === "finalizing") return "결과 정리";
  return normalized;
}

function formatMeetingBadgeLabel(status) {
  const normalized = popupRoot.session.normalizeText(status);
  if (normalized === "processing") return "진행 중";
  if (normalized === "succeeded") return "완료";
  if (normalized === "failed") return "오류";
  return "대기";
}

function normalizeMeetingBadgeStatus(status) {
  const normalized = popupRoot.session.normalizeText(status);
  return ["processing", "succeeded", "failed"].includes(normalized) ? normalized : "idle";
}

function formatMeetingLoadedAt(value) {
  const normalized = popupRoot.session.normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return `마지막 반영 ${parsed.toLocaleString("ko-KR", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  })}`;
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
