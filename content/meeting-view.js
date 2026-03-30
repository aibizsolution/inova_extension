(function initMeetingView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const normalized = normalizeState(state);
    return `
      <section class="inova-tool-section inova-tool-section--meeting">
        <div class="inova-tool-toolbar is-stacked">
          <div class="inova-tool-toolbar__row">
            <div class="inova-tool-meta">${escapeHtml(normalized.metaText)}</div>
            ${normalized.lastUpdatedText ? `<div class="inova-tool-meta">${escapeHtml(normalized.lastUpdatedText)}</div>` : ""}
          </div>
          <div class="inova-inline-feedback">패널은 회의 페이지 진입과 결과 리스트만 제공합니다. 녹음과 상세 결과는 새 탭에서 봅니다.</div>
        </div>
        <div class="inova-meeting-stack">
          ${renderGatewayCard(normalized)}
          ${renderResultListCard(normalized)}
        </div>
      </section>
    `;
  }

  function normalizeState(state) {
    const session = state?.session && typeof state.session === "object" ? state.session : {};
    const capture = state?.capture && typeof state.capture === "object" ? state.capture : {};
    const job = state?.job && typeof state.job === "object" ? state.job : {};
    const transcript = state?.transcript && typeof state.transcript === "object" ? state.transcript : {};
    const records = namespace.meetingState.normalizeRecords(state?.records);
    return {
      capture: {
        durationMs: Math.max(0, Number(capture.durationMs) || 0),
        error: normalizeText(capture.error),
        sizeBytes: Math.max(0, Number(capture.sizeBytes) || 0),
        status: normalizeText(capture.status) || "idle",
      },
      job: {
        artifactId: normalizeText(job.artifactId),
        error: normalizeText(job.error),
        jobId: normalizeText(job.jobId),
        progress: {
          percent: clampPercent(job.progress?.percent),
          phase: normalizeText(job.progress?.phase),
        },
        status: normalizeText(job.status) || "idle",
        updatedAt: normalizeText(job.updatedAt),
      },
      lastUpdatedText: buildLastUpdatedText(job.updatedAt || transcript.loadedAt || session.endedAt || session.startedAt),
      metaText: buildMetaText(session),
      records,
      session: {
        sessionId: normalizeText(session.sessionId),
        title: normalizeText(session.title),
      },
    };
  }

  function renderGatewayCard(state) {
    const status = resolveStatus(state);
    const openAction = `
      <button
        type="button"
        class="inova-bookmark-action"
        data-meeting-action="open-workspace"
      >
        ${escapeHtml(status.buttonLabel)}
      </button>
    `;
    return `
      <article class="inova-release-card${status.tone === "highlight" ? " is-highlight" : " is-muted"}">
        <div class="inova-release-card__head">
          <strong>${escapeHtml(status.title)}</strong>
          <div class="inova-release-card__badges">${renderChip(status.badge, status.tone !== "highlight")}</div>
        </div>
        <p>${escapeHtml(status.description)}</p>
        <div class="inova-meeting-gateway">
          ${openAction}
          <div class="inova-tool-meta">${escapeHtml(status.hint)}</div>
        </div>
      </article>
    `;
  }

  function renderResultListCard(state) {
    if (!state.records.length) {
      return `
        <article class="inova-release-card">
          <div class="inova-release-card__head">
            <strong>결과 리스트</strong>
            <div class="inova-release-card__badges">${renderChip("0건", true)}</div>
          </div>
          <p>아직 저장된 회의 결과가 없습니다. 새 회의를 열어 녹음과 전사를 시작해 주세요.</p>
        </article>
      `;
    }

    return `
      <article class="inova-release-card">
        <div class="inova-release-card__head">
          <strong>결과 리스트</strong>
          <div class="inova-release-card__badges">${renderChip(`${state.records.length}건`, true)}</div>
        </div>
        <div class="inova-meeting-record-list">
          ${state.records.map((record) => renderRecordItem(record)).join("")}
        </div>
      </article>
    `;
  }

  function renderRecordItem(record) {
    const metaItems = [
      formatDateTime(record.updatedAt || record.createdAt, ""),
      record.speakerCount > 0 ? `화자 ${record.speakerCount}명` : "",
      record.jobId ? `job ${record.jobId}` : "",
    ].filter(Boolean);
    return `
      <article class="inova-meeting-record">
        <div class="inova-meeting-record__head">
          <div>
            <strong>${escapeHtml(record.title || record.sessionId || "회의 결과")}</strong>
            ${metaItems.length ? `<div class="inova-tool-meta">${escapeHtml(metaItems.join(" · "))}</div>` : ""}
          </div>
          ${renderChip(formatStatusLabel(record.status), false)}
        </div>
        <p>${escapeHtml(record.previewText || record.error || "상세 결과는 새 탭에서 확인합니다.")}</p>
        <button
          type="button"
          class="inova-bookmark-action inova-bookmark-action--secondary"
          data-meeting-action="open-record"
          data-meeting-job-id="${escapeHtml(record.jobId)}"
          data-meeting-artifact-id="${escapeHtml(record.artifactId)}"
        >
          새 탭에서 보기
        </button>
      </article>
    `;
  }

  function resolveStatus(state) {
    if (state.job.status === "failed") {
      return {
        badge: "오류",
        buttonLabel: "회의 페이지 열기",
        description: state.job.error || "회의 처리 중 오류가 발생했습니다.",
        hint: "회의 페이지에서 다시 시작하거나 오류 내용을 확인할 수 있습니다.",
        title: "회의 작업에 문제가 있습니다.",
        tone: "muted",
      };
    }
    if (state.capture.status === "recording") {
      return {
        badge: "녹음 중",
        buttonLabel: "회의 페이지 열기",
        description: "현재 탭 오디오를 녹음 중입니다.",
        hint: "녹음 종료와 전사 접수는 전용 회의 페이지에서 진행합니다.",
        title: "회의가 진행 중입니다.",
        tone: "highlight",
      };
    }
    if (state.capture.status === "captured" && state.job.status === "idle") {
      return {
        badge: "녹음 완료",
        buttonLabel: "회의 페이지 열기",
        description: "녹음은 저장되었고 아직 전사를 시작하지 않았습니다.",
        hint: buildCapturedHint(state.capture),
        title: "다음 단계가 준비되었습니다.",
        tone: "highlight",
      };
    }
    if (state.job.status === "queued" || state.job.status === "processing") {
      return {
        badge: state.job.status === "queued" ? "대기" : buildProgressBadge(state.job.progress),
        buttonLabel: "결과 확인하기",
        description: state.job.status === "queued" ? "전사 작업이 접수되었습니다." : "회의 전사를 처리 중입니다.",
        hint: state.job.status === "processing" ? formatPhase(state.job.progress.phase) : "결과 리스트와 상세는 새 탭에서 확인합니다.",
        title: "회의 결과를 준비 중입니다.",
        tone: "highlight",
      };
    }
    if (state.job.status === "succeeded") {
      return {
        badge: "완료",
        buttonLabel: "결과 확인하기",
        description: "회의 전사 결과가 준비되었습니다.",
        hint: "결과 리스트에서 항목을 눌러 새 탭으로 다시 볼 수 있습니다.",
        title: "회의록이 준비되었습니다.",
        tone: "highlight",
      };
    }
    return {
      badge: "대기",
      buttonLabel: "새 회의 열기",
      description: "새 회의는 전용 회의 페이지에서 시작합니다.",
      hint: "패널에서는 결과 리스트만 빠르게 확인합니다.",
      title: "아직 회의 작업이 없습니다.",
      tone: "muted",
    };
  }

  function buildMetaText(session) {
    const sessionId = normalizeText(session?.sessionId);
    const title = normalizeText(session?.title);
    if (title && sessionId) {
      return `${title} · ${sessionId}`;
    }
    if (title) {
      return title;
    }
    if (sessionId) {
      return `세션 ${sessionId}`;
    }
    return "현재 대화 기준";
  }

  function buildLastUpdatedText(value) {
    const formatted = formatDateTime(value, "");
    return formatted ? `최근 갱신 ${formatted}` : "";
  }

  function buildCapturedHint(capture) {
    const parts = [];
    if (capture.durationMs) {
      parts.push(formatDuration(capture.durationMs));
    }
    if (capture.sizeBytes) {
      parts.push(formatBytes(capture.sizeBytes));
    }
    return parts.length ? `${parts.join(" · ")} 녹음을 회의 페이지에서 전사로 넘길 수 있습니다.` : "회의 페이지에서 전사를 시작할 수 있습니다.";
  }

  function renderChip(text, muted) {
    const value = normalizeText(text);
    if (!value) {
      return "";
    }
    return `<span class="inova-store-item__chip${muted ? " is-muted" : ""}">${escapeHtml(value)}</span>`;
  }

  function buildProgressBadge(progress, fallback = "진행 중") {
    const percent = clampPercent(progress?.percent);
    return percent ? `${percent}%` : fallback;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function formatPhase(value) {
    const phase = normalizeText(value);
    if (phase === "queued") return "대기";
    if (phase === "upload") return "업로드";
    if (phase === "transcribe") return "전사";
    if (phase === "diarize") return "화자 분리";
    if (phase === "finalize") return "정리";
    return phase || "처리";
  }

  function formatStatusLabel(status) {
    const normalized = normalizeText(status);
    if (normalized === "queued") return "대기";
    if (normalized === "processing") return "진행 중";
    if (normalized === "succeeded") return "완료";
    if (normalized === "failed") return "오류";
    return normalized || "대기";
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

  function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}분 ${seconds.toString().padStart(2, "0")}초` : `${seconds}초`;
  }

  function formatBytes(sizeBytes) {
    const size = Math.max(0, Number(sizeBytes) || 0);
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)}MB`;
    }
    if (size >= 1024) {
      return `${Math.round(size / 1024)}KB`;
    }
    return `${size}B`;
  }

  function normalizeText(value) {
    return String(value || "").trim();
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
  };
})(globalThis);
