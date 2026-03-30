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
          <div class="inova-inline-feedback">녹음 시작과 종료, 전사 접수는 팝업에서 진행합니다.</div>
        </div>
        <div class="inova-meeting-stack">
          ${renderStatusCard(normalized)}
          ${renderCaptureCard(normalized)}
          ${renderTranscriptCard(normalized)}
        </div>
      </section>
    `;
  }

  function normalizeState(state) {
    const session = state?.session && typeof state.session === "object" ? state.session : {};
    const capture = state?.capture && typeof state.capture === "object" ? state.capture : {};
    const job = state?.job && typeof state.job === "object" ? state.job : {};
    const transcript = state?.transcript && typeof state.transcript === "object" ? state.transcript : {};
    const segments = Array.isArray(transcript.segments) ? transcript.segments.filter((segment) => normalizeText(segment?.text)) : [];
    const transcriptText = normalizeTextBlock(transcript.text);
    const speakerCount = Math.max(0, Number(transcript.speakerCount) || countSpeakers(segments));
    return {
      capture: {
        captureMode: normalizeText(capture.captureMode),
        channelCount: Math.max(0, Number(capture.channelCount) || 0),
        durationMs: Math.max(0, Number(capture.durationMs) || 0),
        error: normalizeText(capture.error),
        mimeType: normalizeText(capture.mimeType),
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
        sourceAudioDeleted: Boolean(job.sourceAudioDeleted),
        status: normalizeText(job.status) || "idle",
        updatedAt: normalizeText(job.updatedAt),
      },
      lastUpdatedText: buildLastUpdatedText(job.updatedAt || transcript.loadedAt || session.endedAt || session.startedAt),
      metaText: buildMetaText(session),
      session: {
        endedAt: normalizeText(session.endedAt),
        language: normalizeText(session.language) || "ko",
        sessionId: normalizeText(session.sessionId),
        startedAt: normalizeText(session.startedAt),
        title: normalizeText(session.title),
      },
      transcript: {
        artifactId: normalizeText(transcript.artifactId),
        hasContent: Boolean(transcriptText || segments.length),
        loadedAt: normalizeText(transcript.loadedAt),
        segments,
        speakerCount,
        text: transcriptText,
      },
    };
  }

  function renderStatusCard(state) {
    const status = resolveStatus(state);
    const chipHtml = [
      renderChip(formatCaptureMode(state.capture.captureMode), false),
      renderChip(status.badge, status.tone !== "highlight"),
    ].filter(Boolean).join("");
    const metaItems = [
      state.session.title || state.session.sessionId ? `대화 ${state.session.title || state.session.sessionId}` : "",
      state.job.jobId ? `job ${state.job.jobId}` : "",
    ].filter(Boolean);
    return `
      <article class="inova-release-card${status.tone === "highlight" ? " is-highlight" : " is-muted"}">
        <div class="inova-release-card__head">
          <strong>${escapeHtml(status.title)}</strong>
          <div class="inova-release-card__badges">${chipHtml}</div>
        </div>
        <p>${escapeHtml(status.description)}</p>
        ${metaItems.length ? `<div class="inova-release-card__meta-row">${metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      </article>
    `;
  }

  function renderCaptureCard(state) {
    const facts = [
      state.capture.status !== "idle" ? `상태 ${formatCaptureStatus(state.capture.status)}` : "",
      state.capture.durationMs ? `길이 ${formatDuration(state.capture.durationMs)}` : "",
      state.capture.sizeBytes ? `크기 ${formatBytes(state.capture.sizeBytes)}` : "",
      state.capture.channelCount ? `채널 ${state.capture.channelCount}` : "",
      state.session.startedAt ? `시작 ${formatDateTime(state.session.startedAt)}` : "",
      state.session.endedAt ? `종료 ${formatDateTime(state.session.endedAt)}` : "",
      state.job.sourceAudioDeleted ? "원본 오디오 정리 완료" : "",
    ].filter(Boolean);
    if (!facts.length && !state.capture.error) {
      return "";
    }
      return `
        <article class="inova-release-card">
          <div class="inova-release-card__head">
            <strong>캡처 메타</strong>
            <div class="inova-release-card__badges">${renderChip(state.capture.mimeType || "audio", true)}</div>
          </div>
          ${state.capture.error ? `<p>${escapeHtml(state.capture.error)}</p>` : ""}
          <div class="inova-meeting-meta-list">
            ${facts.map((fact) => `<div class="inova-meeting-meta-row"><strong>${escapeHtml(fact)}</strong></div>`).join("")}
          </div>
        </article>
      `;
  }

  function renderTranscriptCard(state) {
    if (!state.transcript.hasContent) {
      return `
        <article class="inova-release-card">
          <div class="inova-release-card__head">
            <strong>전사 결과</strong>
            <div class="inova-release-card__badges">${renderChip(state.transcript.speakerCount ? `${state.transcript.speakerCount}명` : "", true)}</div>
          </div>
          <p>${escapeHtml(buildTranscriptEmptyText(state))}</p>
        </article>
      `;
    }
    const detailSections = [
      state.transcript.segments.length
        ? renderDetails(
            `화자 구간 ${state.transcript.segments.length}개`,
            `
              <div class="inova-meeting-segments">
                ${state.transcript.segments.map((segment) => `
                  <article class="inova-meeting-segment">
                    <div class="inova-meeting-segment__head">
                      <strong>${escapeHtml(formatSpeakerLabel(segment.speakerLabel))}</strong>
                      <span>${escapeHtml(formatSegmentRange(segment.startMs, segment.endMs))}</span>
                    </div>
                    <p>${escapeHtml(segment.text)}</p>
                  </article>
                `).join("")}
              </div>
            `
          )
        : "",
    ].filter(Boolean).join("");
    return `
      <article class="inova-release-card">
        <div class="inova-release-card__head">
          <strong>전사 결과</strong>
          <div class="inova-release-card__badges">
            ${renderChip(state.transcript.speakerCount ? `${state.transcript.speakerCount}명` : "", false)}
            ${renderChip(state.transcript.segments.length ? `${state.transcript.segments.length}구간` : "", true)}
          </div>
        </div>
        <p>${escapeHtml(state.job.status === "succeeded" ? "현재 대화의 회의 전사 결과입니다." : "마지막으로 저장된 전사 결과입니다.")}</p>
        ${state.transcript.text ? `<div class="inova-meeting-transcript">${renderMultilineText(state.transcript.text)}</div>` : ""}
        ${detailSections}
      </article>
    `;
  }

  function resolveStatus(state) {
    if (state.job.status === "failed") {
      return {
        badge: "실패",
        description: state.job.error || "전사 작업이 실패했습니다. 팝업에서 다시 시도해 주세요.",
        title: "회의 전사에 실패했습니다.",
        tone: "muted",
      };
    }
    if (state.capture.status === "error") {
      return {
        badge: "오류",
        description: state.capture.error || "오디오 캡처 중 오류가 발생했습니다.",
        title: "녹음 중 문제가 발생했습니다.",
        tone: "muted",
      };
    }
    if (state.job.status === "succeeded") {
      return {
        badge: "완료",
        description: state.transcript.hasContent ? "전사 결과를 이 패널에서 바로 확인할 수 있습니다." : "전사는 끝났지만 본문은 아직 불러오는 중입니다.",
        title: "회의록이 준비되었습니다.",
        tone: "highlight",
      };
    }
    if (state.job.status === "processing") {
      return {
        badge: buildProgressBadge(state.job.progress),
        description: state.job.progress.phase
          ? `${formatPhase(state.job.progress.phase)} 단계에서 전사를 진행 중입니다.`
          : "회의 전사를 처리 중입니다.",
        title: "회의 전사를 처리 중입니다.",
        tone: "highlight",
      };
    }
    if (state.job.status === "queued") {
      return {
        badge: buildProgressBadge(state.job.progress, "대기"),
        description: "원본 업로드가 끝났고 전사 대기열에 접수되었습니다.",
        title: "전사 작업이 접수되었습니다.",
        tone: "highlight",
      };
    }
    if (state.capture.status === "uploaded") {
      return {
        badge: "업로드",
        description: "원본 오디오를 전사 작업에 넘겼습니다. 잠시 후 진행 상태가 갱신됩니다.",
        title: "원본 오디오 업로드가 끝났습니다.",
        tone: "highlight",
      };
    }
    if (state.capture.status === "captured") {
      return {
        badge: "녹음 완료",
        description: "녹음은 끝났고 아직 전사 접수 전입니다. 팝업에서 전사를 시작해 주세요.",
        title: "원본 오디오가 저장되었습니다.",
        tone: "muted",
      };
    }
    if (state.capture.status === "recording") {
      return {
        badge: "녹음 중",
        description: "현재 탭 오디오를 캡처하고 있습니다. 녹음 종료 후 전사 접수가 가능합니다.",
        title: "회의 녹음을 진행 중입니다.",
        tone: "highlight",
      };
    }
    return {
      badge: "대기",
      description: "이 대화에는 아직 회의 녹음이나 전사 작업이 없습니다.",
      title: "아직 회의록이 없습니다.",
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

  function buildTranscriptEmptyText(state) {
    if (state.job.status === "processing" || state.job.status === "queued") {
      return "전사 결과를 준비 중입니다.";
    }
    if (state.capture.status === "captured" || state.capture.status === "uploaded") {
      return "팝업에서 전사 시작을 누르면 결과가 이 패널에 표시됩니다.";
    }
    return "현재 대화에는 아직 불러올 회의 전사 결과가 없습니다.";
  }

  function renderDetails(label, body) {
    const content = String(body || "").trim();
    if (!content) {
      return "";
    }
    return `
      <details class="inova-release-details">
        <summary>${escapeHtml(label)}</summary>
        <div class="inova-release-details__body">${content}</div>
      </details>
    `;
  }

  function renderChip(text, muted) {
    const value = normalizeText(text);
    if (!value) {
      return "";
    }
    return `<span class="inova-store-item__chip${muted ? " is-muted" : ""}">${escapeHtml(value)}</span>`;
  }

  function renderMultilineText(text) {
    return escapeHtml(text).replace(/\n/g, "<br />");
  }

  function countSpeakers(segments) {
    return Array.from(new Set((Array.isArray(segments) ? segments : []).map((segment) => normalizeText(segment?.speakerLabel)).filter(Boolean))).length;
  }

  function buildProgressBadge(progress, fallback = "") {
    const percent = clampPercent(progress?.percent);
    return percent ? `${percent}%` : fallback || "진행 중";
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function formatCaptureMode(value) {
    const mode = normalizeText(value);
    if (mode === "tab" || mode === "tab-audio") return "탭 오디오";
    return mode;
  }

  function formatCaptureStatus(value) {
    const status = normalizeText(value);
    if (status === "recording") return "녹음 중";
    if (status === "captured") return "녹음 완료";
    if (status === "uploaded") return "업로드 완료";
    if (status === "error") return "오류";
    return status || "대기";
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
    if (minutes) {
      return `${minutes}분 ${seconds}초`;
    }
    return `${seconds}초`;
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

  function formatSegmentRange(startMs, endMs) {
    return `${formatClock(startMs)}-${formatClock(endMs)}`;
  }

  function formatClock(value) {
    const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatSpeakerLabel(value) {
    const label = normalizeText(value);
    const match = label.match(/^SPEAKER[_\s-]?0*(\d+)$/i);
    if (match) {
      return `화자 ${Number(match[1]) + 1}`;
    }
    return label || "화자";
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeTextBlock(value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  namespace.meetingView = {
    render,
  };
})(globalThis);
