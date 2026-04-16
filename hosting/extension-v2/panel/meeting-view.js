(function initMeetingView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const normalized = normalizeState(state);
    const listMarkup = normalized.items.length
      ? normalized.items.map((item) => renderMeetingItem(item, normalized.pending)).join("")
      : renderEmptyState(normalized);
    const workspacePending = normalized.pending.active && normalized.pending.action === "open-workspace";
    const workspaceButtonLabel = workspacePending ? "작업실 여는 중..." : "새 회의 룸 생성";
    const feedbackNotice = normalized.feedback.text && normalized.feedback.tone === "error"
      ? `<div class="inova-release-card inova-release-card__notice">${escapeHtml(normalized.feedback.text)}</div>`
      : "";

    return `
      <section class="inova-tool-section inova-tool-section--meeting">
        <div class="inova-tool-toolbar inova-tool-toolbar--meeting">
          <div class="inova-tool-toolbar__row inova-tool-toolbar__row--meeting">
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
        </div>
        <div class="inova-meeting-stack">
          ${feedbackNotice}
          ${normalized.degradedNotice ? `<div class="inova-release-card inova-release-card__notice is-info">${escapeHtml(normalized.degradedNotice)}</div>` : ""}
          ${normalized.error ? `<div class="inova-release-card inova-release-card__notice">${escapeHtml(normalized.error)}</div>` : ""}
          <div class="inova-tool-inline-summary">
            <strong>목록</strong>
            <span class="inova-tool-inline-summary__meta">총 ${escapeHtml(String(normalized.items.length))}건</span>
          </div>
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
    };
  }

  function normalizeItem(item) {
    const nextItem = item && typeof item === "object" ? item : {};
    const share = normalizeShare(nextItem.share);
    return {
      latestArtifactId: normalizeText(nextItem.latestArtifactId || nextItem.artifactId),
      latestJobId: normalizeText(nextItem.latestJobId || nextItem.jobId),
      meetingId: normalizeText(nextItem.meetingId),
      shareActive: share.active,
      shareStatus: share.status,
      status: normalizeText(nextItem.status) || "idle",
      title: normalizeText(nextItem.title) || "이름 없는 회의",
      updatedAt: normalizeText(nextItem.updatedAt || nextItem.createdAt),
    };
  }

  function renderMeetingItem(item, pending) {
    const isPending = pending.active
      && pending.action === "open-result"
      && pending.meetingId === item.meetingId
      && (!pending.jobId || pending.jobId === item.latestJobId);
    const sharePending = pending.active && pending.action === "share" && pending.meetingId === item.meetingId;
    const revokePending = pending.active && pending.action === "revoke-share" && pending.meetingId === item.meetingId;
    const presentation = deriveMeetingPresentation(item, {
      isPending,
      revokePending,
      sharePending,
    });
    return `
      <article
        class="inova-meeting-record${isPending ? " is-pending" : ""}${pending.active ? " is-disabled" : ""}"
        data-meeting-action="open-result"
        data-meeting-card="true"
        data-meeting-id="${escapeHtml(item.meetingId)}"
        data-meeting-job-id="${escapeHtml(item.latestJobId)}"
        data-meeting-artifact-id="${escapeHtml(item.latestArtifactId)}"
        data-meeting-title="${escapeHtml(item.title)}"
        tabindex="${pending.active ? "-1" : "0"}"
        aria-busy="${isPending}"
        aria-disabled="${pending.active}"
        aria-label="${escapeHtml(`${item.title} ${presentation.openLabel}`)}"
      >
        <div class="inova-meeting-record__head">
          <div class="inova-meeting-record__content">
            <div class="inova-meeting-record__title-row">
              <strong>${escapeHtml(item.title)}</strong>
            </div>
            ${presentation.meta ? `<div class="inova-tool-meta inova-tool-meta--muted">${escapeHtml(presentation.meta)}</div>` : ""}
            ${presentation.description ? `<p class="inova-meeting-record__summary">${escapeHtml(presentation.description)}</p>` : ""}
          </div>
          <div class="inova-meeting-record__chips">
            ${renderMeetingStatus(presentation.statusLabel, presentation.statusTone)}
          </div>
        </div>
        <div class="inova-meeting-record__actions">
          <div class="inova-meeting-record__secondary">
          <button
            type="button"
            class="inova-tool-button inova-tool-button--compact inova-meeting-record__secondary-button"
            data-meeting-action="share"
            data-meeting-id="${escapeHtml(item.meetingId)}"
            data-meeting-job-id="${escapeHtml(item.latestJobId)}"
            data-meeting-title="${escapeHtml(item.title)}"
            ${pending.active ? "disabled" : ""}
            aria-busy="${sharePending}"
          >
            ${escapeHtml(presentation.shareLabel)}
          </button>
          ${item.shareActive || revokePending ? `
          <button
            type="button"
            class="inova-tool-button inova-tool-button--compact inova-meeting-record__secondary-button is-danger"
            data-meeting-action="revoke-share"
            data-meeting-id="${escapeHtml(item.meetingId)}"
            data-meeting-job-id="${escapeHtml(item.latestJobId)}"
            data-meeting-title="${escapeHtml(item.title)}"
            ${pending.active ? "disabled" : ""}
            aria-busy="${revokePending}"
          >
            ${escapeHtml(revokePending ? "해제 중..." : "공유 해제")}
          </button>`
            : ""}
          </div>
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
          <p>목록을 불러오는 중입니다. 잠시만 기다려 주세요.</p>
        </article>
      `;
    }
    return `
      <article class="inova-release-card">
        <strong>아직 회의 룸이 없습니다.</strong>
        <p>상단의 새 회의 룸 생성으로 작업실을 열고, 녹음이나 파일 업로드로 첫 기록을 시작해 보세요.</p>
      </article>
    `;
  }

  function renderMeetingStatus(text, tone = "neutral") {
    const value = normalizeText(text);
    if (!value) {
      return "";
    }
    return `<span class="inova-meeting-record__status is-${escapeHtml(normalizeText(tone) || "neutral")}">${escapeHtml(value)}</span>`;
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

  function buildDegradedNotice(degraded, degradedReason, dataFreshness, source) {
    if (!degraded) {
      return "";
    }
    if (dataFreshness === "stale" || source === "cache") {
      return "실시간 목록을 읽지 못해 이전에 보던 목록을 제한적으로 유지하고 있습니다.";
    }
    if (dataFreshness === "empty") {
      return "목록 읽기가 모두 실패해 현재는 빈 상태만 표시하고 있습니다.";
    }
    if (degradedReason === "meeting-hub-firestore-unavailable" || degradedReason === "meeting-hub-realtime-failed" || source === "realtime") {
      return "실시간 Firestore 목록 구독에 실패해 현재 상태를 갱신하지 못하고 있습니다.";
    }
    return "목록을 제한된 상태로 표시하고 있습니다.";
  }

  function deriveMeetingPresentation(item, options = {}) {
    const normalizedStatus = normalizeText(item.status).toLowerCase();
    const hasRecord = Boolean(item.latestArtifactId);
    const timestamp = formatDateTime(item.updatedAt, "");
    const metaPrefix = hasRecord ? "최근 기록" : "최근 업데이트";
    const meta = timestamp ? `${metaPrefix} ${timestamp}` : "";
    if (options.isPending) {
      return {
        description: "",
        meta,
        openLabel: "작업실 여는 중...",
        shareLabel: options.sharePending ? "링크 준비 중..." : item.shareActive ? "링크 복사" : "공유 링크",
        statusLabel: "여는 중",
        statusTone: "progress",
      };
    }
    if (normalizedStatus === "processing") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel: options.sharePending ? "링크 준비 중..." : item.shareActive ? "링크 복사" : "공유 링크",
        statusLabel: "기록 생성 중",
        statusTone: "progress",
      };
    }
    if (normalizedStatus === "queued") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel: options.sharePending ? "링크 준비 중..." : item.shareActive ? "링크 복사" : "공유 링크",
        statusLabel: "기록 대기",
        statusTone: "progress",
      };
    }
    if (normalizedStatus === "failed") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel: options.sharePending ? "링크 준비 중..." : item.shareActive ? "링크 복사" : "공유 링크",
        statusLabel: "확인 필요",
        statusTone: "danger",
      };
    }
    if (hasRecord || normalizedStatus === "succeeded") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel: options.sharePending ? "링크 준비 중..." : item.shareActive ? "링크 복사" : "공유 링크",
        statusLabel: "기록 있음",
        statusTone: "success",
      };
    }
    return {
      description: "",
      meta,
      openLabel: "작업실 열기",
      shareLabel: options.sharePending ? "링크 준비 중..." : item.shareActive ? "링크 복사" : "공유 링크",
      statusLabel: "기록 없음",
      statusTone: "neutral",
    };
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

  function normalizeShare(input) {
    const share = input && typeof input === "object" ? input : {};
    const status = normalizeText(share.status);
    const shareId = normalizeText(share.shareId);
    return {
      active: Boolean(share.active) || (status === "active" && Boolean(shareId)),
      shareId,
      status,
    };
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
