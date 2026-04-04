(function initMeetingView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const normalized = normalizeState(state);
    const listMarkup = normalized.items.length
      ? normalized.items.map((item) => renderMeetingItem(item, normalized.pending)).join("")
      : renderEmptyState(normalized);
    const workspacePending = normalized.pending.active && normalized.pending.action === "open-workspace";
    const workspaceButtonLabel = workspacePending ? "작업실 여는 중..." : "새 회의하기";
    const progressNotice = normalized.pending.active
      ? `<article class="inova-release-card inova-release-card__notice is-info">
          <strong>새 탭을 여는 중입니다.</strong>
          <p>${escapeHtml(buildPendingMessage(normalized.pending))}</p>
        </article>`
      : "";
    const feedbackNotice = normalized.feedback.text
      ? `<div class="inova-release-card inova-release-card__notice${normalized.feedback.tone === "error" ? "" : " is-info"}">${escapeHtml(normalized.feedback.text)}</div>`
      : "";

    return `
      <section class="inova-tool-section inova-tool-section--meeting">
        <div class="inova-tool-toolbar">
          <div class="inova-tool-toolbar__row">
            <div class="inova-tool-toolbar__stack">
              <strong class="inova-tool-toolbar__title">최근 회의록</strong>
              <div class="inova-tool-meta inova-tool-meta--muted">${escapeHtml(normalized.subtitleText)}</div>
            </div>
          </div>
          <button
            type="button"
            class="inova-bookmark-action${workspacePending ? " is-pending" : ""}"
            data-meeting-action="open-workspace"
            ${normalized.pending.active ? "disabled" : ""}
            aria-busy="${workspacePending}"
          >
            ${escapeHtml(workspaceButtonLabel)}
          </button>
        </div>
        <div class="inova-meeting-stack">
          ${progressNotice}
          ${feedbackNotice}
          ${normalized.degradedNotice ? `<div class="inova-release-card inova-release-card__notice is-info">${escapeHtml(normalized.degradedNotice)}</div>` : ""}
          ${normalized.error ? `<div class="inova-release-card inova-release-card__notice">${escapeHtml(normalized.error)}</div>` : ""}
          <article class="inova-release-card">
            <div class="inova-release-card__head">
              <strong>회의록 목록</strong>
              <div class="inova-release-card__badges">${renderChip(`${normalized.items.length}건`, true)}</div>
            </div>
          </article>
          <div class="inova-meeting-record-list">
            ${listMarkup}
          </div>
        </div>
      </section>
    `;
  }

  function normalizeState(state) {
    const items = Array.isArray(state?.items) ? state.items.map(normalizeItem).filter((item) => item.meetingId) : [];
    const checkedAtText = formatDateTime(state?.checkedAt, "");
    const degraded = Boolean(state?.degraded);
    const dataFreshness = normalizeDataFreshness(state?.dataFreshness);
    const degradedReason = normalizeText(state?.degradedReason);
    const source = normalizeSource(state?.source);
    return {
      degraded,
      degradedNotice: buildDegradedNotice(degraded, degradedReason, dataFreshness, source),
      error: normalizeText(state?.error),
      feedback: normalizeFeedback(state?.feedback),
      hasCheckedAt: Boolean(checkedAtText),
      items,
      pending: normalizePending(state?.pending),
      subtitleText: buildSubtitleText(checkedAtText, dataFreshness, source),
    };
  }

  function normalizeItem(item) {
    const nextItem = item && typeof item === "object" ? item : {};
    return {
      latestArtifactId: normalizeText(nextItem.latestArtifactId || nextItem.artifactId),
      latestJobId: normalizeText(nextItem.latestJobId || nextItem.jobId),
      meetingId: normalizeText(nextItem.meetingId),
      shareActive: Boolean(nextItem.share?.active),
      shareStatus: normalizeText(nextItem.share?.status),
      status: normalizeText(nextItem.status) || "idle",
      title: normalizeText(nextItem.title) || "이름 없는 회의",
      updatedAt: normalizeText(nextItem.updatedAt || nextItem.createdAt),
    };
  }

  function renderMeetingItem(item, pending) {
    const meta = [
      formatDateTime(item.updatedAt, ""),
      formatStatusLabel(item.status),
    ].filter(Boolean).join(" · ");
    const isPending = pending.active
      && pending.action === "open-result"
      && pending.meetingId === item.meetingId
      && (!pending.jobId || pending.jobId === item.latestJobId);
    const sharePending = pending.active && pending.action === "share" && pending.meetingId === item.meetingId;
    const revokePending = pending.active && pending.action === "revoke-share" && pending.meetingId === item.meetingId;
    return `
      <article class="inova-meeting-record${isPending ? " is-pending" : ""}">
        <button
          type="button"
          class="inova-meeting-record__open"
          data-meeting-action="open-result"
          data-meeting-id="${escapeHtml(item.meetingId)}"
          data-meeting-job-id="${escapeHtml(item.latestJobId)}"
          data-meeting-artifact-id="${escapeHtml(item.latestArtifactId)}"
          data-meeting-title="${escapeHtml(item.title)}"
          ${pending.active ? "disabled" : ""}
          aria-busy="${isPending}"
        >
          <div class="inova-meeting-record__head">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              ${meta ? `<div class="inova-tool-meta">${escapeHtml(meta)}</div>` : ""}
            </div>
            <div class="inova-meeting-record__chips">
              ${item.shareActive ? renderChip("공유 중", true) : ""}
              ${renderChip(isPending ? "여는 중" : formatStatusLabel(item.status), false)}
            </div>
          </div>
        </button>
        <div class="inova-meeting-record__actions">
          <button
            type="button"
            class="inova-tool-button inova-tool-button--compact"
            data-meeting-action="share"
            data-meeting-id="${escapeHtml(item.meetingId)}"
            data-meeting-job-id="${escapeHtml(item.latestJobId)}"
            data-meeting-title="${escapeHtml(item.title)}"
            ${pending.active ? "disabled" : ""}
            aria-busy="${sharePending}"
          >
            ${escapeHtml(sharePending ? "복사 중..." : "공유")}
          </button>
          <button
            type="button"
            class="inova-tool-button inova-tool-button--compact is-danger"
            data-meeting-action="revoke-share"
            data-meeting-id="${escapeHtml(item.meetingId)}"
            data-meeting-job-id="${escapeHtml(item.latestJobId)}"
            data-meeting-title="${escapeHtml(item.title)}"
            ${pending.active || !item.shareActive ? "disabled" : ""}
            aria-busy="${revokePending}"
          >
            ${escapeHtml(revokePending ? "해제 중..." : "공유 해제")}
          </button>
        </div>
      </article>
    `;
  }

  function renderDebugConsole(debug) {
    return namespace.meetingDebugConsole?.renderPanel?.(debug) || "";
  }

  function renderEmptyState(state) {
    if (!state.hasCheckedAt && !state.error) {
      return `
        <article class="inova-release-card">
          <p>최근 회의록을 읽는 중입니다. 잠시만 기다려 주세요.</p>
        </article>
      `;
    }
    return `
      <article class="inova-release-card">
        <p>아직 저장된 회의록이 없습니다. 상단의 새 회의하기로 작업실을 열어 주세요.</p>
      </article>
    `;
  }

  function renderChip(text, muted) {
    const value = normalizeText(text);
    if (!value) {
      return "";
    }
    return `<span class="inova-store-item__chip${muted ? " is-muted" : ""}">${escapeHtml(value)}</span>`;
  }

  function normalizePending(pending) {
    const action = normalizeText(pending?.action);
    return {
      action,
      active: Boolean(action),
      jobId: normalizeText(pending?.jobId),
      meetingId: normalizeText(pending?.meetingId),
      title: normalizeText(pending?.title),
    };
  }

  function normalizeFeedback(feedback) {
    const text = normalizeText(feedback?.text);
    return {
      text,
      tone: normalizeText(feedback?.tone) || "info",
    };
  }

  function buildSubtitleText(checkedAtText, dataFreshness, source) {
    if (!checkedAtText) {
      return "저장된 회의록을 이곳에서 다시 엽니다.";
    }
    const freshnessLabel = dataFreshness === "stale"
      ? "오래된 데이터"
      : dataFreshness === "empty"
        ? "빈 상태"
        : source === "runtime-read"
          ? "runtime-read"
          : "";
    return freshnessLabel
      ? `최근 갱신 ${checkedAtText} · ${freshnessLabel}`
      : `최근 갱신 ${checkedAtText}`;
  }

  function buildDegradedNotice(degraded, degradedReason, dataFreshness, source) {
    if (!degraded) {
      return "";
    }
    if (dataFreshness === "stale" || source === "cache") {
      return "실시간 회의록 목록을 읽지 못해 이전에 보던 목록을 제한적으로 유지하고 있습니다.";
    }
    if (dataFreshness === "empty") {
      return "회의록 목록 읽기가 모두 실패해 현재는 빈 상태만 표시하고 있습니다.";
    }
    if (degradedReason === "meeting-hub-realtime-failed" || source === "runtime-read") {
      return "실시간 구독에 실패해 요청형 회의록 목록 읽기로 계속 표시하고 있습니다.";
    }
    return "회의록 목록을 제한된 상태로 표시하고 있습니다.";
  }

  function buildPendingMessage(pending) {
    if (pending.action === "open-result") {
      return pending.title
        ? `${pending.title} 결과 화면을 준비하고 있습니다.`
        : "결과 화면을 준비하고 있습니다.";
    }
    if (pending.action === "share") {
      return pending.title
        ? `${pending.title} 공유 링크를 준비하고 있습니다.`
        : "공유 링크를 준비하고 있습니다.";
    }
    if (pending.action === "revoke-share") {
      return pending.title
        ? `${pending.title} 공유 링크를 해제하고 있습니다.`
        : "공유 링크를 해제하고 있습니다.";
    }
    return "새 작업실을 준비하고 있습니다.";
  }

  function formatStatusLabel(status) {
    const normalized = normalizeText(status);
    if (normalized === "queued") return "대기";
    if (normalized === "processing") return "진행 중";
    if (normalized === "succeeded") return "완료";
    if (normalized === "failed") return "오류";
    return normalized || "준비";
  }

  function formatDateTime(value, fallback = "아직 없음") {
    const time = Date.parse(value || "");
    if (!time) {
      return fallback;
    }
    return new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(time);
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeDataFreshness(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized === "fresh" || normalized === "stale" || normalized === "empty"
      ? normalized
      : "empty";
  }

  function normalizeSource(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized === "realtime"
      || normalized === "runtime-read"
      || normalized === "cache"
      || normalized === "local"
      || normalized === "none"
      ? normalized
      : "none";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  namespace.meetingView = {
    render,
    renderDebugConsole,
  };
})(globalThis);
