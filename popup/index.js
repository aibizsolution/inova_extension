const popupRoot = globalThis.InovaBookmarks;
const popupState = {
  settings: { ...popupRoot.constants.defaults.settings },
  providerIdentity: {
    available: false,
    displayName: "",
    email: "",
    numericUserId: null,
    provider: "inova",
    providerUserKey: "",
  },
  pausedSessions: {},
  activeTab: { id: 0, url: "", title: "" },
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
    "meetingOpenButton",
  ]) {
    popupRefs[id] = document.getElementById(id);
  }
}

function bindPopupEvents() {
  popupRefs.enabledToggle.addEventListener("click", () => toggleSetting("enabled"));
  popupRefs.pauseToggle.addEventListener("click", togglePause);
  popupRefs.refreshButton.addEventListener("click", refreshPopup);
  popupRefs.meetingOpenButton.addEventListener("click", openMeetingWorkspace);
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

    if (changes.cloudSync) {
      popupState.providerIdentity = normalizeProviderIdentity(changes.cloudSync.newValue?.providerIdentity);
    }

    if (changes.meetingStateBySession || changes.meetingState) {
      syncMeetingStateForCurrentSession().then(renderPopup);
      return;
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
  popupState.providerIdentity = normalizeProviderIdentity(storage.cloudSync?.providerIdentity);
  popupState.pausedSessions = storage.pausedSessions || {};
  popupState.activeTab = activeTab;
  popupState.currentSessionId = popupRoot.session.getSessionId(activeTab.url);
  await syncMeetingStateForCurrentSession();

  renderPopup();
  setPopupStatus("적용됨");
}

async function syncMeetingStateForCurrentSession() {
  popupState.meetingState = await popupRoot.storage.getMeetingState(popupState.currentSessionId);
  return popupState.meetingState;
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { id: Number(tab?.id) || 0, title: tab?.title || "", url: tab?.url || "" };
  } catch {
    return { id: 0, title: "", url: "" };
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
  popupRefs.meetingOpenButton.textContent = view.openLabel;
  popupRefs.meetingOpenButton.disabled = Boolean(view.openDisabled);
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
      openDisabled: true,
      openLabel: "회의 페이지 열기",
      title: "현재 대화 회의 상태",
      summary: "i-Nova 대화를 열면 현재 회의 상태를 여기서 확인할 수 있어요.",
      hint: "녹음과 전사 관리는 전용 회의 페이지에서만 처리합니다.",
    };
  }

  if (!currentSessionId) {
    return {
      badgeLabel: "대기",
      badgeStatus: "idle",
      openDisabled: true,
      openLabel: "회의 페이지 열기",
      title: "현재 대화 회의 상태",
      summary: "대화 화면을 열면 현재 회의 작업 상태를 바로 확인할 수 있어요.",
      hint: "지금은 현재 탭에서 session id를 읽지 못했어요.",
    };
  }

  if (sameSession && meetingState.capture.status === "recording") {
    return {
      badgeLabel: "녹음 중",
      badgeStatus: "recording",
      openDisabled: false,
      openLabel: "회의 페이지 열기",
      title: meetingLabel,
      summary: "현재 탭 오디오를 녹음 중입니다.",
      hint: "녹음 종료와 전사 접수는 회의 페이지에서 이어서 진행합니다.",
    };
  }

  if (sameSession && meetingState.capture.status === "captured" && jobStatus === "idle") {
    return {
      badgeLabel: "녹음 완료",
      badgeStatus: "captured",
      openDisabled: false,
      openLabel: "회의 페이지 열기",
      title: meetingLabel,
      summary: "녹음이 저장되었습니다.",
      hint: `${buildCapturedHint(meetingState.capture)} · 회의 페이지에서 전사를 시작할 수 있어요.`,
    };
  }

  if (sameSession && meetingState.capture.status === "error") {
    return {
      badgeLabel: "오류",
      badgeStatus: "failed",
      openDisabled: false,
      openLabel: "회의 페이지 열기",
      title: meetingLabel,
      summary: "회의 녹음을 시작하거나 마무리하는 중 문제가 생겼어요.",
      hint: popupRoot.session.normalizeText(meetingState.capture.error) || "다시 시도해 주세요.",
    };
  }

  if (sameSession && jobStatus === "queued") {
    return {
      badgeLabel: "대기",
      badgeStatus: "queued",
      openDisabled: false,
      openLabel: "결과 확인하기",
      title: meetingLabel,
      summary: "회의 전사 작업이 접수되어 순서를 기다리고 있어요.",
      hint: "상세 상태와 결과 리스트는 회의 페이지에서 확인합니다.",
    };
  }

  if (sameSession && jobStatus === "processing") {
    const percent = Math.round(Number(meetingState.job.progress.percent) || 0);
    const phase = formatMeetingPhase(meetingState.job.progress.phase);
    return {
      badgeLabel: "진행 중",
      badgeStatus: "processing",
      openDisabled: false,
      openLabel: "결과 확인하기",
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
      openDisabled: false,
      openLabel: "결과 확인하기",
      title: meetingLabel,
      summary: speakerCount > 0
        ? `${speakerCount}명 화자 기준으로 전사 결과가 준비됐어요.`
        : "전사 결과가 준비됐어요.",
      hint: `${formatMeetingLoadedAt(meetingState.transcript.loadedAt) || "artifact를 읽을 준비가 됐어요."} 회의 페이지에서 다시 열 수 있어요.`,
    };
  }

  if (sameSession && jobStatus === "failed") {
    return {
      badgeLabel: "오류",
      badgeStatus: "failed",
      openDisabled: false,
      openLabel: "회의 페이지 열기",
      title: meetingLabel,
      summary: "회의 처리 중 문제가 생겨 다시 확인이 필요해요.",
      hint: popupRoot.session.normalizeText(meetingState.job.error) || "job 상태와 업로드 경로를 다시 확인해 주세요.",
    };
  }

  if (trackedSessionId && trackedSessionId !== currentSessionId && jobStatus !== "idle") {
    return {
      badgeLabel: formatMeetingBadgeLabel(jobStatus),
      badgeStatus: normalizeMeetingBadgeStatus(jobStatus),
      openDisabled: false,
      openLabel: "회의 페이지 열기",
      title: "다른 대화 회의 상태",
      summary: `${meetingLabel} 기준 회의 작업 상태가 남아 있어요.`,
      hint: "회의 페이지를 열면 현재 대화 기준 결과와 이전 결과 리스트를 함께 볼 수 있습니다.",
    };
  }

  return {
    badgeLabel: "대기",
    badgeStatus: "idle",
    openDisabled: false,
    openLabel: "회의 페이지 열기",
    title: "현재 대화 회의 상태",
    summary: "현재 대화에 연결된 회의 작업이 아직 없어요.",
    hint: "새 회의는 전용 페이지에서 시작하고, 결과도 거기서 다시 확인합니다.",
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
  if (normalized === "recording") return "녹음 중";
  if (normalized === "captured") return "녹음 완료";
  if (normalized === "processing") return "진행 중";
  if (normalized === "succeeded") return "완료";
  if (normalized === "failed") return "오류";
  return "대기";
}

function normalizeMeetingBadgeStatus(status) {
  const normalized = popupRoot.session.normalizeText(status);
  return ["recording", "captured", "processing", "succeeded", "failed"].includes(normalized) ? normalized : "idle";
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

function buildCapturedHint(capture) {
  const parts = [];
  const durationMs = Number(capture?.durationMs) || 0;
  const sizeBytes = Number(capture?.sizeBytes) || 0;
  if (durationMs > 0) {
    parts.push(formatDuration(durationMs));
  }
  if (sizeBytes > 0) {
    parts.push(formatSize(sizeBytes));
  }
  return parts.length ? parts.join(" · ") : "이제 업로드와 전사 단계로 넘길 수 있어요.";
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}초`;
  }
  return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
}

function formatSize(sizeBytes) {
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)}MB`;
  }
  return `${Math.max(1, Math.round(sizeBytes / 1024))}KB`;
}

async function openMeetingWorkspace() {
  if (!isInovaTab() || !popupState.currentSessionId || !popupState.activeTab.id) {
    setPopupStatus("대화 화면을 열어 주세요");
    return;
  }
  try {
    setPopupStatus("회의 페이지 여는 중");
    const meetingState = popupRoot.meetingState.mergeMeetingState(await syncMeetingStateForCurrentSession());
    const input = {
      artifactId: popupRoot.session.normalizeText(meetingState.transcript.artifactId || meetingState.job.artifactId),
      jobId: popupRoot.session.normalizeText(meetingState.job.jobId),
      sessionId: popupState.currentSessionId,
      tabId: popupState.activeTab.id,
      title: meetingState.session.title || popupState.activeTab.title || popupRoot.session.formatSessionLabel(popupState.currentSessionId),
    };
    await popupRoot.meetingBridge.openMeetingWorkspace(input);
    setPopupStatus("회의 페이지 열림");
  } catch (error) {
    setPopupStatus(error instanceof Error ? error.message : "회의 페이지를 열지 못했어요.");
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

function normalizeProviderIdentity(identity) {
  const providerUserKey = popupRoot.session.normalizeText(identity?.providerUserKey);
  return {
    available: Boolean(identity?.available) && Boolean(providerUserKey),
    displayName: popupRoot.session.normalizeText(identity?.displayName),
    email: popupRoot.session.normalizeText(identity?.email).toLowerCase(),
    numericUserId: Number.isFinite(Number(identity?.numericUserId)) ? Number(identity.numericUserId) : null,
    provider: popupRoot.session.normalizeText(identity?.provider) || "inova",
    providerUserKey,
  };
}
