(function initMeetingView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    const normalized = normalizeState(state);
    const actionCapabilities = {
      canCreateShare: normalized.canCreateShare,
      canHideParticipation: normalized.canHideParticipation,
      canRevokeShare: normalized.canRevokeShare,
    };
    const listMarkup = normalized.items.length
      ? normalized.items.map((item) => renderMeetingItem(item, normalized.pending, actionCapabilities, normalized.revokeConfirmation)).join("")
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
          ${normalized.capabilityNotice ? `<div class="inova-release-card inova-release-card__notice is-info">${escapeHtml(normalized.capabilityNotice)}</div>` : ""}
          ${normalized.degradedNotice ? `<div class="inova-release-card inova-release-card__notice is-info">${escapeHtml(normalized.degradedNotice)}</div>` : ""}
          ${normalized.error ? `<div class="inova-release-card inova-release-card__notice">${escapeHtml(normalized.error)}</div>` : ""}
          ${renderUsageStrip(normalized.usage)}
          ${renderScopeTabs(normalized)}
          ${renderSearchBox(normalized)}
          <div class="inova-meeting-list-section">
            <div class="inova-tool-inline-summary">
              <strong>목록</strong>
              <span class="inova-tool-inline-summary__meta">총 ${escapeHtml(String(normalized.items.length))}건</span>
            </div>
            <div class="inova-meeting-record-list">
              ${listMarkup}
            </div>
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
      canCreateShare: state?.canCreateShare !== false,
      canHideParticipation: state?.canHideParticipation !== false,
      canRevokeShare: state?.canRevokeShare !== false,
      capabilityNotice: normalizeText(state?.capabilityNotice),
      activeScope: normalizeScope(state?.activeScope),
      counts: normalizeCounts(state?.counts, items.length),
      degraded,
      degradedNotice: buildDegradedNotice(degraded, degradedReason, dataFreshness, source),
      error: normalizeText(state?.error),
      feedback: normalizeFeedback(state?.feedback),
      hasCheckedAt: Boolean(checkedAtText),
      items,
      pending: normalizePending(state?.pending),
      query: normalizeText(state?.query),
      revokeConfirmation: normalizeRevokeConfirmation(state?.revokeConfirmation),
      usage: normalizeUsage(state?.usage),
    };
  }

  function normalizeItem(item) {
    const nextItem = item && typeof item === "object" ? item : {};
    const share = normalizeShare(nextItem.share);
    const sourceKind = normalizeSourceKind(nextItem.sourceKind);
    const accessState = normalizeAccessState(nextItem.accessState);
    const latestJobId = normalizeText(nextItem.latestJobId || nextItem.jobId);
    return {
      accessState,
      latestArtifactId: normalizeText(nextItem.latestArtifactId || nextItem.artifactId),
      latestJobId,
      meetingId: normalizeText(nextItem.meetingId),
      owner: normalizeIdentity(nextItem.owner),
      participationId: normalizeText(nextItem.participationId),
      shareActive: share.active,
      shareParticipantCount: share.participantCount,
      shareStatus: share.status,
      sourceKind,
      status: normalizeText(nextItem.status) || "idle",
      title: normalizeText(nextItem.title) || "이름 없는 회의",
      updatedAt: normalizeText(nextItem.updatedAt || nextItem.createdAt),
      openAction: sourceKind === "participating" || !latestJobId ? "open-workspace" : "open-result",
    };
  }

  function renderMeetingItem(item, pending, actionCapabilities = {}, revokeConfirmation = {}) {
    const revokeConfirming = isRevokeConfirming(item, revokeConfirmation);
    const disabled = pending.active || item.accessState !== "active";
    const openDisabled = disabled || revokeConfirming;
    const isPending = pending.active
      && (pending.action === "open-result" || pending.action === "open-workspace")
      && pending.meetingId === item.meetingId
      && (!pending.jobId || pending.jobId === item.latestJobId);
    const sharePending = pending.active && pending.action === "share" && pending.meetingId === item.meetingId;
    const revokePending = pending.active && pending.action === "revoke-share" && pending.meetingId === item.meetingId;
    const removePending = pending.active && pending.action === "remove-participation" && pending.meetingId === item.meetingId;
    const presentation = deriveMeetingPresentation(item, {
      isPending,
      removePending,
      revokePending,
      sharePending,
    });
    return `
      <article
        class="inova-meeting-record${isPending ? " is-pending" : ""}${openDisabled ? " is-disabled" : ""}"
        data-meeting-action="${escapeHtml(revokeConfirming ? "" : item.openAction)}"
        data-meeting-card="true"
        data-meeting-id="${escapeHtml(item.meetingId)}"
        data-meeting-job-id="${escapeHtml(item.latestJobId)}"
        data-meeting-artifact-id="${escapeHtml(item.latestArtifactId)}"
        data-meeting-participation-id="${escapeHtml(item.participationId)}"
        data-meeting-source-kind="${escapeHtml(item.sourceKind)}"
        data-meeting-title="${escapeHtml(item.title)}"
        tabindex="${openDisabled ? "-1" : "0"}"
        aria-busy="${isPending}"
        aria-disabled="${disabled}"
        aria-label="${escapeHtml(`${item.title} ${presentation.openLabel}`)}"
      >
        <div class="inova-meeting-record__head">
          <div class="inova-meeting-record__content">
            <div class="inova-meeting-record__title-row">
              ${renderSourceBadge(item)}
              <strong class="inova-meeting-record__title">${escapeHtml(item.title)}</strong>
            </div>
            ${presentation.statusLabel || presentation.meta ? `<div class="inova-meeting-record__meta-row">
              ${presentation.meta ? `<span class="inova-tool-meta inova-tool-meta--muted">${renderMetaText(presentation.meta)}</span>` : ""}
              ${renderMeetingStatus(presentation.statusLabel, presentation.statusTone)}
            </div>` : ""}
            ${presentation.description ? `<p class="inova-meeting-record__summary">${escapeHtml(presentation.description)}</p>` : ""}
          </div>
        </div>
        ${revokeConfirming ? renderRevokeConfirmation(revokeConfirmation) : ""}
        <div class="inova-meeting-record__actions">
          ${renderParticipationOwner(item)}
          ${renderShareParticipantCount(item)}
          <div class="inova-meeting-record__secondary">
          ${item.sourceKind === "owned" && actionCapabilities.canCreateShare ? `
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
          </button>` : ""}
          ${item.sourceKind === "owned" && actionCapabilities.canRevokeShare && (item.shareActive || revokePending) ? `
          <button
            type="button"
            class="inova-tool-button inova-tool-button--compact inova-meeting-record__secondary-button is-danger"
            data-meeting-action="${revokeConfirming ? "confirm-revoke-share" : "revoke-share"}"
            data-meeting-id="${escapeHtml(item.meetingId)}"
            data-meeting-job-id="${escapeHtml(item.latestJobId)}"
            data-meeting-title="${escapeHtml(item.title)}"
            ${pending.active ? "disabled" : ""}
            aria-busy="${revokePending}"
          >
            ${escapeHtml(revokePending ? "해제 중..." : revokeConfirming ? "해제 실행" : "공유 해제")}
          </button>`
            : ""}
          ${revokeConfirming ? `
          <button
            type="button"
            class="inova-tool-button inova-tool-button--compact inova-meeting-record__secondary-button"
            data-meeting-action="cancel-revoke-share"
            data-meeting-id="${escapeHtml(item.meetingId)}"
            data-meeting-job-id="${escapeHtml(item.latestJobId)}"
            data-meeting-title="${escapeHtml(item.title)}"
            ${pending.active ? "disabled" : ""}
          >
            취소
          </button>` : ""}
          ${item.sourceKind === "participating" && actionCapabilities.canHideParticipation ? `
          <button
            type="button"
            class="inova-tool-button inova-tool-button--compact inova-meeting-record__secondary-button"
            data-meeting-action="remove-participation"
            data-meeting-id="${escapeHtml(item.meetingId)}"
            data-meeting-participation-id="${escapeHtml(item.participationId)}"
            data-meeting-source-kind="${escapeHtml(item.sourceKind)}"
            data-meeting-title="${escapeHtml(item.title)}"
            ${pending.active || revokeConfirming ? "disabled" : ""}
            aria-busy="${removePending}"
          >
            ${escapeHtml(removePending ? "제거 중..." : "목록에서 제거")}
          </button>` : ""}
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
        <div class="inova-bookmark-empty inova-meeting-empty">
          <p>목록을 불러오는 중입니다. 잠시만 기다려 주세요.</p>
        </div>
      `;
    }
    const emptyState = getEmptyStateContent(state);
    return `
      <div class="inova-bookmark-empty inova-meeting-empty">
        <p>${escapeHtml(emptyState.title)}</p>
        ${emptyState.description ? `<p>${escapeHtml(emptyState.description)}</p>` : ""}
      </div>
    `;
  }

  function getEmptyStateContent(state) {
    if (state.query) {
      return {
        title: "검색 결과가 없습니다.",
        description: "",
      };
    }
    if (state.activeScope === "participating") {
      return {
        title: "참여한 회의룸이 없습니다.",
        description: "",
      };
    }
    if (state.activeScope === "owned") {
      return {
        title: "아직 내 회의룸이 없습니다.",
        description: "새 회의 룸 생성으로 시작하세요.",
      };
    }
    return {
      title: "아직 회의 룸이 없습니다.",
      description: "새 회의 룸 생성으로 시작하세요.",
    };
  }

  function renderScopeTabs(state) {
    const tabs = [
      { id: "all", label: "전체", count: state.counts.all },
      { id: "owned", label: "내 회의룸", count: state.counts.owned },
      { id: "participating", label: "참여한 회의룸", count: state.counts.participating },
    ];
    return `
      <div class="inova-tool-subtabs" role="tablist" aria-label="회의 룸 목록 전환">
        ${tabs.map((tab) => `
          <button
            type="button"
            class="inova-tool-subtab ${tab.id === state.activeScope ? "is-active" : ""}"
            data-meeting-action="set-scope"
            data-meeting-scope="${escapeHtml(tab.id)}"
            aria-pressed="${tab.id === state.activeScope}"
          >
            <span>${escapeHtml(tab.label)}</span>
            ${Number(tab.count) > 0 ? `<span class="inova-tool-subtab__count">${escapeHtml(String(tab.count))}</span>` : ""}
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderSearchBox(state) {
    return `
      <div class="inova-meeting-search">
        <input
          type="search"
          class="inova-tool-search"
          data-search-tool="meeting"
          placeholder="회의룸 찾기"
          value="${escapeHtml(state.query)}"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    `;
  }

  function renderSourceBadge(item) {
    if (item.sourceKind === "participating" && item.accessState !== "active") {
      return '<span class="inova-meeting-record__badge is-danger">접근 불가</span>';
    }
    if (item.sourceKind === "participating") {
      return '<span class="inova-meeting-record__badge is-participating">참여</span>';
    }
    return "";
  }

  function renderParticipationOwner(item) {
    if (item.sourceKind !== "participating") {
      return "";
    }
    const ownerName = normalizeText(item.owner.displayName);
    if (!ownerName) {
      return "";
    }
    const ownerEmail = normalizeText(item.owner.email);
    const tooltip = ownerEmail ? `이메일 ${ownerEmail}` : `공유자 ${ownerName}`;
    return `<span class="inova-meeting-record__owner" title="${escapeHtml(tooltip)}">${escapeHtml(ownerName)}</span>`;
  }

  function renderShareParticipantCount(item) {
    if (item.sourceKind !== "owned" || !item.shareActive) {
      return "";
    }
    const count = Math.max(0, Math.floor(Number(item.shareParticipantCount) || 0));
    return `<span class="inova-meeting-record__share-count">열람 ${escapeHtml(String(count))}명</span>`;
  }

  function renderRevokeConfirmation(revokeConfirmation) {
    const count = Math.max(0, Math.floor(Number(revokeConfirmation.shareParticipantCount) || 0));
    const countText = count > 0
      ? `현재 이 링크를 열람한 사용자는 ${count}명입니다.`
      : "현재 이 링크를 열람한 사용자는 아직 없습니다.";
    return `
      <div class="inova-meeting-record__confirm" role="status">
        <strong>공유 해제 전 확인</strong>
        <span>${escapeHtml(countText)} 해제하면 기존 링크 참여자는 즉시 더 이상 접근할 수 없고, 참여자 목록에는 접근 불가 상태로 남습니다.</span>
      </div>
    `;
  }

  function isRevokeConfirming(item, revokeConfirmation) {
    return item.sourceKind === "owned"
      && item.meetingId
      && item.meetingId === normalizeText(revokeConfirmation?.meetingId);
  }

  function renderMetaText(text) {
    const value = normalizeText(text);
    const label = ["최근 업데이트", "최근 기록", "마지막 확인"].find((prefix) => value.startsWith(`${prefix} `));
    if (!label) {
      return `<span class="inova-meeting-record__meta-value">${escapeHtml(value)}</span>`;
    }
    const detail = value.slice(label.length).trim();
    return `<span class="inova-meeting-record__meta-value">${escapeHtml(detail)}</span>`;
  }

  function renderMeetingStatus(text, tone = "neutral") {
    const value = normalizeText(text);
    if (!value) {
      return "";
    }
    return `<span class="inova-meeting-record__status is-${escapeHtml(normalizeText(tone) || "neutral")}">${escapeHtml(value)}</span>`;
  }

  function renderUsageStrip(usage) {
    const month = normalizeUsageMetric(usage?.month);
    const total = normalizeUsageMetric(usage?.total);
    return `
      <div class="inova-meeting-usage" aria-label="회의 녹음 사용량">
        <div class="inova-meeting-usage__item">
          <span class="inova-meeting-usage__label">이번 달</span>
          <strong class="inova-meeting-usage__value">${escapeHtml(formatUsageDuration(month.processedMs))} · ${escapeHtml(formatUsageCount(month.processedCount))}</strong>
        </div>
        <div class="inova-meeting-usage__item">
          <span class="inova-meeting-usage__label">전체</span>
          <strong class="inova-meeting-usage__value">${escapeHtml(formatUsageDuration(total.processedMs))} · ${escapeHtml(formatUsageCount(total.processedCount))}</strong>
        </div>
      </div>
    `;
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

  function normalizeRevokeConfirmation(input) {
    const confirmation = input && typeof input === "object" ? input : {};
    return {
      meetingId: normalizeText(confirmation.meetingId),
      shareParticipantCount: Math.max(0, Math.floor(Number(confirmation.shareParticipantCount) || 0)),
      title: normalizeText(confirmation.title),
    };
  }

  function normalizeFeedback(feedback) {
    const text = normalizeText(feedback?.text);
    return {
      text,
      tone: normalizeText(feedback?.tone) || "info",
    };
  }

  function normalizeCounts(input, fallbackCount = 0) {
    const counts = input && typeof input === "object" ? input : {};
    const owned = Math.max(0, Math.round(Number(counts.owned) || 0));
    const participating = Math.max(0, Math.round(Number(counts.participating) || 0));
    const all = Math.max(0, Math.round(Number(counts.all) || 0)) || Math.max(0, Number(fallbackCount) || 0);
    return {
      all,
      owned,
      participating,
    };
  }

  function normalizeScope(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized === "owned" || normalized === "participating" ? normalized : "all";
  }

  function normalizeSourceKind(value) {
    return normalizeText(value).toLowerCase() === "participating" ? "participating" : "owned";
  }

  function normalizeAccessState(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ["active", "revoked", "deleted", "domain-mismatch"].includes(normalized) ? normalized : "active";
  }

  function normalizeIdentity(value) {
    const identity = value && typeof value === "object" ? value : {};
    return {
      displayName: normalizeText(identity.displayName),
      email: normalizeText(identity.email),
      providerUserKey: normalizeText(identity.providerUserKey),
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
    if (item.sourceKind === "participating") {
      const timestamp = formatDateTime(item.updatedAt, "");
      const meta = timestamp ? `최근 업데이트 ${timestamp}` : "";
      if (item.accessState !== "active") {
        return {
          description: "",
          meta,
          openLabel: "접근 불가",
          shareLabel: "",
          statusLabel: "접근 불가",
          statusTone: "danger",
        };
      }
      if (options.isPending) {
        return {
          description: "",
          meta,
          openLabel: "작업실 여는 중...",
          shareLabel: "",
          statusLabel: "여는 중",
          statusTone: "progress",
        };
      }
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel: "",
        statusLabel: "확인 필요",
        statusTone: "neutral",
      };
    }
    const normalizedStatus = normalizeText(item.status).toLowerCase();
    const hasRecord = Boolean(item.latestArtifactId);
    const timestamp = formatDateTime(item.updatedAt, "");
    const metaPrefix = hasRecord ? "최근 기록" : "최근 업데이트";
    const meta = timestamp ? `${metaPrefix} ${timestamp}` : "";
    const shareLabel = buildShareLabel(item, options);
    if (options.isPending) {
      return {
        description: "",
        meta,
        openLabel: "작업실 여는 중...",
        shareLabel,
        statusLabel: "여는 중",
        statusTone: "progress",
      };
    }
    if (normalizedStatus === "processing") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel,
        statusLabel: "기록 생성 중",
        statusTone: "progress",
      };
    }
    if (normalizedStatus === "queued") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel,
        statusLabel: "기록 대기",
        statusTone: "progress",
      };
    }
    if (normalizedStatus === "failed") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel,
        statusLabel: "확인 필요",
        statusTone: "danger",
      };
    }
    if (hasRecord || normalizedStatus === "succeeded") {
      return {
        description: "",
        meta,
        openLabel: "작업실 열기",
        shareLabel,
        statusLabel: hasRecord ? "기록 있음" : "기록 없음",
        statusTone: hasRecord ? "success" : "neutral",
      };
    }
    return {
      description: "",
      meta,
      openLabel: "작업실 열기",
      shareLabel,
      statusLabel: "기록 없음",
      statusTone: "neutral",
    };
  }

  function normalizeUsage(input) {
    const usage = input && typeof input === "object" ? input : {};
    return {
      degraded: Boolean(usage.degraded),
      error: normalizeText(usage.error),
      month: normalizeUsageMetric(usage.month),
      total: normalizeUsageMetric(usage.total),
    };
  }

  function normalizeUsageMetric(input) {
    const metric = input && typeof input === "object" ? input : {};
    return {
      processedCount: Math.max(0, Math.round(Number(metric.processedCount) || 0)),
      processedMs: Math.max(0, Math.round(Number(metric.processedMs) || 0)),
    };
  }

  function buildShareLabel(item, options = {}) {
    if (options.sharePending) {
      return "준비 중";
    }
    return item.shareActive ? "링크 복사" : "공유";
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

  function formatUsageDuration(processedMs) {
    const totalMinutes = Math.max(0, Math.round(Number(processedMs) / 60000) || 0);
    if (totalMinutes === 0 && Number(processedMs) > 0) {
      return "1분";
    }
    const formatter = new Intl.NumberFormat("ko-KR");
    if (totalMinutes < 60) {
      return `${formatter.format(totalMinutes)}분`;
    }
    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) {
      return minutes > 0
        ? `${formatter.format(totalHours)}시간 ${formatter.format(minutes)}분`
        : `${formatter.format(totalHours)}시간`;
    }
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (hours > 0) {
      return `${formatter.format(days)}일 ${formatter.format(hours)}시간`;
    }
    if (minutes > 0) {
      return `${formatter.format(days)}일 ${formatter.format(minutes)}분`;
    }
    return `${formatter.format(days)}일`;
  }

  function formatUsageCount(processedCount) {
    return `${new Intl.NumberFormat("ko-KR").format(Math.max(0, Math.round(Number(processedCount) || 0)))}건`;
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
      participantCount: Math.max(0, Math.floor(Number(share.participantCount) || 0)),
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
