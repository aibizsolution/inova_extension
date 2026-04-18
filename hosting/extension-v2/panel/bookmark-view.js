(function initBookmarkView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function renderTool(state) {
    const canCopyBookmark = state?.canCopyBookmark !== false;
    const canJumpBookmark = state?.canJumpBookmark !== false;
    const listHtml = state.items.length
      ? state.items.map((bookmark) => renderBookmark(bookmark, state.query, {
        canCopyBookmark,
        canJumpBookmark,
      })).join("")
      : renderConversationEmptyState(state);
    const capabilityNotice = state?.capabilityError
      ? `<div class="inova-bookmark-empty">${escapeHtml(state.capabilityError)}</div>`
      : "";

    return `
      <section class="inova-tool-section">
        <div class="inova-tool-toolbar is-stacked">
          <input
            class="inova-tool-search"
            type="search"
            name="inova-bookmark-search"
            value="${escapeHtml(state.query)}"
            data-search-tool="bookmarks"
            placeholder="이 대화에서 질문 찾기"
          />
          ${renderTokenSummary(state.tokenEstimate, state.contextProfileConfig)}
          ${state.metaText ? `<div class="inova-tool-meta">${escapeHtml(state.metaText)}</div>` : ""}
        </div>
        ${capabilityNotice}
        <div id="inova-bookmark-results">${listHtml}</div>
      </section>
    `;
  }

  function renderConversationEmptyState(state) {
    if (state.query) {
      return `<div class="inova-bookmark-empty">${escapeHtml(state.emptyText)}</div>`;
    }
    return `
      <div class="inova-bookmark-empty inova-bookmark-empty--actionable">
        <strong>${escapeHtml(state.emptyText || "아직 대화가 없어요.")}</strong>
        <div class="inova-empty-actions" aria-label="다음 작업">
          <button type="button" class="inova-tool-button" data-tool-id="meeting">회의 룸 보기</button>
          <button type="button" class="inova-tool-button" data-tool-id="prompts">프롬프트 찾기</button>
        </div>
      </div>
    `;
  }

  function renderBookmark(bookmark, query, options = {}) {
    const canJumpBookmark = options.canJumpBookmark !== false;
    const canCopyBookmark = options.canCopyBookmark !== false;
    return `
      <article
        class="inova-bookmark-item"
        ${canJumpBookmark ? `data-bookmark-id="${escapeHtml(bookmark.id)}"` : 'aria-disabled="true"'}
        tabindex="${canJumpBookmark ? "0" : "-1"}"
        title="${escapeHtml(bookmark.text)}"
        aria-label="${escapeHtml(canJumpBookmark ? `${bookmark.order}번 질문으로 이동` : `${bookmark.order}번 질문`)}"
      >
        <div class="bookmark-jump"${canJumpBookmark ? ` data-bookmark-id="${escapeHtml(bookmark.id)}"` : ""}>
          <span class="bookmark-index">${bookmark.order}</span>
          <span class="bookmark-text">${renderQuestionText(bookmark.text, query)}</span>
        </div>
        <div class="bookmark-side">
          ${renderBookmarkTokenMeta(bookmark.tokenEstimate)}
          ${canCopyBookmark ? `
          <button
            class="bookmark-copy"
            type="button"
            data-copy-bookmark-id="${escapeHtml(bookmark.id)}"
            aria-label="${bookmark.order}번 질문 복사"
            title="질문 복사"
          >${renderCopyIcon()}</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderTokenSummary(tokenEstimate = {}, contextProfileConfig = {}) {
    const total = readTokenCount(tokenEstimate.total);
    if (!total) {
      return "";
    }
    const question = readTokenCount(tokenEstimate.question);
    const answer = readTokenCount(tokenEstimate.answer);
    const normalizedConfig = normalizeContextProfileConfig(contextProfileConfig);
    const profile = getContextProfile(tokenEstimate.modelLabel, normalizedConfig);
    const risk = getContextRisk(total, profile, normalizedConfig.signals);
    const modelLabel = namespace.session.normalizeText(tokenEstimate.modelLabel);
    const modelSource = namespace.session.normalizeText(tokenEstimate.modelLabelSource);
    const reference = buildContextReference(profile);
    const modelText = modelLabel
      ? `감지 모델: ${modelLabel}${modelSource ? ` (${modelSource})` : ""}.`
      : "선택 모델을 읽지 못하면 fallback 기준을 적용합니다.";
    const helpText = `현재 화면에 렌더된 질문과 응답만 기준으로 한 보수적 최소 추정치입니다. 실제 모델에 전달되는 시스템 지시문, 서버 내부 문맥, 첨부/검색 결과가 더해지면 실제 컨텍스트는 이보다 클 수 있어요. 게이지는 모델 한도 사용률이 아니라 대화가 길어지는 정도를 알려주는 참고 신호입니다. ${modelText} 기준값: ${reference}.`;
    return `
      <div class="inova-token-meter is-${risk.tone}">
        <div class="inova-token-meter__main">
          <span class="inova-token-meter__title">
            <span class="inova-token-meter__label">예상 컨텍스트</span>
            <span class="inova-context-help" tabindex="0" aria-label="${escapeHtml(helpText)}" title="${escapeHtml(helpText)}">?</span>
          </span>
          <span class="inova-token-meter__value">
            <strong>${escapeHtml(formatTokenCount(total))}</strong>
          </span>
        </div>
        <div class="inova-token-meter__gauge" aria-label="대화 길이 신호: ${escapeHtml(risk.label)}">
          ${renderContextGauge(risk, normalizedConfig.signals)}
        </div>
        <div class="inova-token-meter__detail">
          <span class="inova-token-meter__status" title="${escapeHtml(risk.description)}">${escapeHtml(risk.label)}</span>
          <span>질문 ${escapeHtml(formatTokenCount(question))}</span>
          <span>응답 ${escapeHtml(formatTokenCount(answer))}</span>
        </div>
      </div>
    `;
  }

  function normalizeContextProfileConfig(config = {}) {
    const defaultProfile = config.defaultProfile && typeof config.defaultProfile === "object"
      ? config.defaultProfile
      : {};
    return {
      defaultProfile: {
        availability: normalizeContextAvailability(defaultProfile.availability, "fallback"),
        extendedLimit: readTokenCount(defaultProfile.extendedLimit),
        label: namespace.session.normalizeText(defaultProfile.label) || "",
        limit: readTokenCount(defaultProfile.limit),
      },
      loaded: config.loaded === true,
      profiles: Array.isArray(config.profiles) ? config.profiles : [],
      signals: {
        growingRatio: readRatio(config.signals?.growingRatio, 0.25),
        heavyRatio: readRatio(config.signals?.heavyRatio, 0.75),
        longRatio: readRatio(config.signals?.longRatio, 0.5),
      },
    };
  }

  function getContextProfile(modelLabel, config) {
    const normalized = namespace.session.normalizeText(modelLabel || "");
    const matched = config.profiles.find((profile) => doesProfileMatch(profile, normalized));
    if (matched) {
      return {
        availability: normalizeContextAvailability(matched.availability, "standard"),
        extendedLimit: readTokenCount(matched.extendedLimit),
        known: true,
        label: namespace.session.normalizeText(matched.label),
        limit: readTokenCount(matched.limit),
      };
    }
    return {
      availability: config.defaultProfile.availability,
      extendedLimit: config.defaultProfile.extendedLimit,
      known: false,
      label: config.defaultProfile.label,
      limit: config.defaultProfile.limit,
    };
  }

  function buildContextReference(profile) {
    const limit = readTokenCount(profile?.limit);
    if (!limit) {
      return "모델 기준 미확인";
    }
    if (!profile.known) {
      return `${profile.label} fallback 기준 ${formatContextLimit(limit)}`;
    }
    if (profile.availability === "optional") {
      const extended = readTokenCount(profile.extendedLimit);
      return extended
        ? `${profile.label} 기본 기준 ${formatContextLimit(limit)} · 옵션 확장 ${formatContextLimit(extended)}은 게이지 제외`
        : `${profile.label} 기본 기준 ${formatContextLimit(limit)} · 옵션 확장은 게이지 제외`;
    }
    return `${profile.label} 공식 컨텍스트 ${formatContextLimit(limit)}`;
  }

  function doesProfileMatch(profile, normalizedModelLabel) {
    if (!normalizedModelLabel || !Array.isArray(profile?.patterns)) {
      return false;
    }
    return profile.patterns.some((pattern) => {
      try {
        return new RegExp(String(pattern || ""), "i").test(normalizedModelLabel);
      } catch {
        return false;
      }
    });
  }

  function getContextRisk(total, profile, signals) {
    const limit = readTokenCount(profile?.limit);
    if (!limit) {
      return {
        description: "모델별 컨텍스트 기준 파일을 아직 읽지 못해 길이 신호를 확정하지 않았습니다.",
        label: "기준 확인 중",
        ratio: 0,
        tone: "normal",
      };
    }
    const ratio = total / limit;
    if (ratio >= signals.heavyRatio) {
      return {
        description: "현재 화면 기준 추정치만으로도 선택 기준의 후반부에 가까운 긴 대화입니다. 숨은 문맥과 답변 여유까지 고려해 대화를 나누는 편이 안전합니다.",
        label: "분리 권장",
        ratio,
        tone: "heavy",
      };
    }
    if (ratio >= signals.longRatio) {
      return {
        description: "선택 모델 기준으로도 실제 컨텍스트가 꽤 길어질 수 있는 구간입니다. 이어가기 전에 핵심 요구사항만 정리하면 답변 품질을 유지하기 쉽습니다.",
        label: "정리 고려",
        ratio,
        tone: "long",
      };
    }
    if (ratio >= signals.growingRatio) {
      return {
        description: "아직 위험 구간은 아니지만, 선택 모델 기준으로 관측된 대화가 길어지는 흐름입니다.",
        label: "늘어남",
        ratio,
        tone: "growing",
      };
    }
    return {
      description: "현재 화면 기준으로는 짧거나 보통 길이의 대화입니다.",
      label: "보통",
      ratio,
      tone: "normal",
    };
  }

  function renderContextGauge(risk, signals) {
    const fill = formatGaugeValue(risk.ratio);
    return `
      <span class="inova-token-meter__gauge-track" style="--context-fill: ${fill};">
        <span class="inova-token-meter__gauge-fill" aria-hidden="true"></span>
        ${renderContextMarker("growing", signals.growingRatio)}
        ${renderContextMarker("long", signals.longRatio)}
        ${renderContextMarker("heavy", signals.heavyRatio)}
      </span>
    `;
  }

  function renderContextMarker(name, ratio) {
    return `<span class="inova-token-meter__gauge-marker is-${escapeHtml(name)}" style="--context-marker: ${formatGaugeValue(ratio)};" aria-hidden="true"></span>`;
  }

  function renderBookmarkTokenMeta(tokenEstimate = {}) {
    const question = readTokenCount(tokenEstimate.question);
    const answer = readTokenCount(tokenEstimate.answer);
    if (!question && !answer) {
      return "";
    }
    const total = readTokenCount(tokenEstimate.total) || question + answer;
    const parts = [`질문 ${formatTokenCount(question)}`];
    if (answer) {
      parts.push(`응답 ${formatTokenCount(answer)}`);
    }
    parts.push(`합계 ${formatTokenCount(total)}`);
    return `<span class="bookmark-context-meta" title="${escapeHtml(parts.join(" · "))}">${escapeHtml(formatTokenCount(total))}</span>`;
  }

  function readTokenCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      return 0;
    }
    return Math.floor(number);
  }

  function readRatio(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number >= 1) {
      return fallback;
    }
    return number;
  }

  function normalizeContextAvailability(value, fallback) {
    const normalized = namespace.session.normalizeText(value).toLowerCase();
    return ["fallback", "optional", "standard"].includes(normalized)
      ? normalized
      : fallback;
  }

  function formatGaugeValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return "0";
    }
    if (number >= 1) {
      return "1";
    }
    return String(Math.round(number * 1000) / 1000);
  }

  function formatTokenCount(value) {
    const count = readTokenCount(value);
    if (count >= 1000) {
      const compact = Math.round(count / 100) / 10;
      return `${compact.toFixed(compact >= 10 ? 0 : 1)}K`;
    }
    return String(count);
  }

  function formatContextLimit(value) {
    const count = readTokenCount(value);
    if (count >= 1000000) {
      return "1M급";
    }
    return formatTokenCount(count);
  }

  function renderCopyIcon(state = "default") {
    if (state === "copied") return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2 6.4 11 12.5 4.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    if (state === "failed") return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M5 5 11 11M11 5 5 11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>';
    return '<span class="bookmark-copy-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><rect x="6" y="3" width="7" height="9" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="6" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg></span>';
  }

  function renderQuestionText(text, query) {
    const preview = namespace.session.clipPreview(text);
    const normalizedQuery = namespace.session.normalizeText(query || "").toLowerCase();
    if (!normalizedQuery) {
      return escapeHtml(preview);
    }

    const lowerPreview = preview.toLowerCase();
    const start = lowerPreview.indexOf(normalizedQuery);
    if (start === -1) {
      return escapeHtml(preview);
    }

    const end = start + normalizedQuery.length;
    return `${escapeHtml(preview.slice(0, start))}<mark class="bookmark-highlight">${escapeHtml(preview.slice(start, end))}</mark>${escapeHtml(preview.slice(end))}`;
  }

  function flashCopyState(button, copied) {
    button.innerHTML = renderCopyIcon(copied ? "copied" : "failed");
    button.classList.toggle("is-copied", Boolean(copied));
    button.classList.toggle("is-failed", !copied);
    button.setAttribute("title", copied ? "복사됨" : "복사 실패");
    global.clearTimeout(Number(button.dataset.resetTimer || 0));
    button.dataset.resetTimer = String(global.setTimeout(() => resetCopyButton(button), copied ? 1200 : 1500));
  }

  function resetCopyButton(button) {
    button.innerHTML = renderCopyIcon();
    button.classList.remove("is-copied", "is-failed");
    button.setAttribute("title", "질문 복사");
  }

  function setActive(bookmarkId) {
    const results = document.getElementById("inova-bookmark-results");
    if (!results) {
      return;
    }

    results.querySelectorAll(".inova-bookmark-item.is-active").forEach((item) => item.classList.remove("is-active"));
    if (!bookmarkId) {
      return;
    }

    const activeItem = results.querySelector(`.inova-bookmark-item[data-bookmark-id="${CSS.escape(bookmarkId)}"]`);
    activeItem?.classList.add("is-active");
    activeItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function focus(bookmarkId) {
    document
      .querySelector(`.inova-bookmark-item[data-bookmark-id="${CSS.escape(bookmarkId)}"]`)
      ?.focus({ preventScroll: true });
  }

  function moveFocus(target, step) {
    const results = document.getElementById("inova-bookmark-results");
    if (!results) {
      return false;
    }

    const items = Array.from(results.querySelectorAll(".inova-bookmark-item"));
    const current = target.closest(".inova-bookmark-item");
    const index = current ? items.indexOf(current) : -1;
    if (index === -1) {
      return false;
    }

    const nextItem = items[Math.min(items.length - 1, Math.max(0, index + step))];
    if (!nextItem) {
      return false;
    }

    nextItem.focus({ preventScroll: true });
    nextItem.scrollIntoView({ block: "nearest" });
    return true;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  namespace.bookmarkView = {
    flashCopyState,
    focus,
    moveFocus,
    renderTool,
    setActive,
  };
})(globalThis);
