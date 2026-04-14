(function initReleaseView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    return `
      <section class="inova-tool-section inova-tool-section--release">
        <div class="inova-tool-toolbar is-stacked">
          <div class="inova-tool-toolbar__row inova-tool-toolbar__row--release">
            <div class="inova-tool-meta">현재 ${escapeHtml(state.currentVersion)}</div>
            <div class="inova-tool-actions inova-tool-actions--toolbar">
              <button type="button" class="inova-tool-button" data-release-action="refresh" ${renderDisabled(state.checking || state.historyLoading)}>${state.checking ? "확인 중..." : "다시 확인"}</button>
            </div>
          </div>
        </div>
        <div class="inova-release-stack">
          ${renderUpdateSection(state)}
          ${renderGuideSection()}
          ${renderHistorySection(state)}
        </div>
      </section>
    `;
  }

  function renderUpdateSection(state) {
    const summaryMeta = formatCheckedAt(state.lastCheckedAt) || `현재 ${state.currentVersion}`;
    return `
      <section class="inova-release-section">
        ${renderSectionSummary("업데이트 안내", summaryMeta)}
        <div class="inova-release-section__body">
          ${renderStatusCard(state)}
          ${state.latest && !state.versionRefreshPending ? renderLatestCard(state) : ""}
        </div>
      </section>
    `;
  }

  function renderStatusCard(state) {
    if (state.error) {
      const hasCachedData = state.dataFreshness === "stale"
        || state.source === "cache"
        || Boolean(
          state.latest
          || (Array.isArray(state.history) && state.history.length)
          || state.lastCheckedAt
        );
      return `
        <article class="inova-release-card is-muted">
          <strong>${hasCachedData ? "릴리스 정보를 제한적으로 표시 중이에요." : "릴리스 정보를 확인하지 못했어요."}</strong>
          <p>${hasCachedData
            ? "최근 확인이 실패해 이전에 확인한 배포 정보만 보여주고 있습니다. 최신 버전 여부는 아직 확정되지 않았어요."
            : state.degraded
              ? "릴리스 화면 상태 계산에 실패해 최신 버전 여부를 아직 판단할 수 없습니다."
              : "잠시 후 다시 확인해 주세요."}</p>
          <span class="inova-release-card__meta">현재 설치 버전 ${escapeHtml(state.currentVersion)}</span>
          <p class="inova-release-card__empty">오류: ${escapeHtml(state.error)}</p>
          ${renderCheckedMeta(state.lastCheckedAt)}
        </article>
      `;
    }
    if (state.versionRefreshPending || (state.checking && !state.latest)) {
      return `
        <article class="inova-release-card is-muted">
          <strong>업데이트 정보를 새로 확인하고 있어요.</strong>
          <p>${state.versionRefreshPending ? `설치한 ${escapeHtml(state.currentVersion)} 버전에 맞춰 다시 불러오는 중입니다.` : "잠시만 기다려 주세요."}</p>
          ${renderCheckedMeta(state.lastCheckedAt)}
        </article>
      `;
    }
    if (state.updateAvailable) {
      return `
        <article class="inova-release-card is-highlight">
          <strong>${escapeHtml(state.latestVersion)} 버전이 준비되어 있어요.</strong>
          <p>지금은 ${escapeHtml(state.currentVersion)} 버전을 사용 중입니다.</p>
          ${renderCheckedMeta(state.lastCheckedAt)}
        </article>
      `;
    }
    if (state.currentAheadOfLatest) {
      return `
        <article class="inova-release-card is-muted">
          <strong>테스트 중인 새 버전으로 보입니다.</strong>
          <p>지금 설치된 버전은 ${escapeHtml(state.currentVersion)} 입니다.</p>
          <span class="inova-release-card__meta">배포 안내 기준은 ${escapeHtml(state.latestVersion)} 입니다. 로컬 테스트 중이면 정상이에요.</span>
        </article>
      `;
    }
    return `
      <article class="inova-release-card is-muted">
        <strong>최신 버전을 사용 중이에요.</strong>
        <p>현재 설치 버전 ${escapeHtml(state.currentVersion)}</p>
        ${renderCheckedMeta(state.lastCheckedAt)}
      </article>
    `;
  }

  function renderLatestCard(state) {
    const latest = state.latest;
    const summary = latest.summary || latest.notes || "새 버전이 배포되었습니다.";
    const changeList = renderChangeList(latest.changes);
    const details = renderReleaseDetails(
      "변경 내용 보기",
      [
        latest.downloadUrl && latest.versionDownloadUrl && latest.downloadUrl !== latest.versionDownloadUrl
          ? `<p class="inova-release-details__hint">\`ZIP 받기\` 버튼은 항상 최신 파일을 내려받습니다.</p>`
          : "",
        changeList,
      ].filter(Boolean).join("")
    );
    return `
      <article class="inova-release-card inova-release-card--compact">
        <div class="inova-release-card__head">
          <strong>${escapeHtml(state.updateAvailable ? "새 버전 안내" : "현재 배포 안내")}</strong>
          <div class="inova-release-card__badges">
            <span class="inova-store-item__chip">${escapeHtml(formatReleaseLevel(latest.level))}</span>
            ${state.updateAvailable ? '<span class="inova-store-item__chip">신규</span>' : '<span class="inova-store-item__chip is-muted">현재 기준</span>'}
          </div>
        </div>
        <strong class="inova-release-card__headline">${escapeHtml(latest.version)} · ${escapeHtml(latest.headline || latest.notes || "최신 릴리스")}</strong>
        <p>${escapeHtml(summary)}</p>
        <div class="inova-release-card__meta-row">
          <span>${escapeHtml(formatDateTime(latest.publishedAt))}</span>
          <span>${escapeHtml(formatBytes(latest.sizeBytes))}</span>
        </div>
        ${details}
        <div class="inova-tool-actions">
          <button type="button" class="inova-tool-button ${state.updateAvailable ? "is-primary" : ""}" data-release-action="download-latest">ZIP 받기</button>
        </div>
      </article>
    `;
  }

  function renderGuideSection() {
    return `
      <section class="inova-release-section">
        ${renderSectionSummary("설치·업데이트 방법", "개발자 모드 필요")}
        <div class="inova-release-section__body">
          <article class="inova-release-card">
            <p class="inova-release-card__notice">설치나 업데이트를 진행하기 전에 Chrome 확장 프로그램 페이지에서 개발자 모드를 먼저 켜 주세요. 개발자 모드가 꺼져 있으면 설치와 새로고침 버튼이 보이지 않을 수 있어요.</p>
            ${renderReleaseDetails(
              "처음 설치 보기",
              `
                <ol class="inova-release-steps">
                  <li>ZIP 받기를 눌러 파일을 내려받고, 원하는 폴더에 압축을 풉니다.</li>
                  <li>Chrome 주소창에 chrome://extensions 를 입력해 확장 프로그램 페이지를 엽니다.</li>
                  <li>오른쪽 위 개발자 모드를 켭니다.</li>
                  <li>압축해제된 확장 프로그램을 로드합니다를 눌러 방금 압축을 푼 폴더를 선택합니다.</li>
                  <li>설치가 끝나면 i-Nova 탭으로 돌아가 페이지를 새로고침합니다.</li>
                </ol>
              `
            )}
            ${renderReleaseDetails(
              "업데이트 방법 보기",
              `
                <ol class="inova-release-steps">
                  <li>새 ZIP을 내려받고 압축을 풉니다.</li>
                  <li>기존 확장 폴더를 새 파일로 바꾸거나, 새 폴더로 교체합니다.</li>
                  <li>chrome://extensions 에서 이 확장의 새로고침 버튼을 누릅니다.</li>
                  <li>i-Nova 탭도 새로고침하면 최신 화면이 반영됩니다.</li>
                </ol>
              `
            )}
            <p class="inova-release-card__empty">자동 업데이트는 지원하지 않습니다. 문제가 생기면 이전 버전 ZIP을 다시 받아 같은 방법으로 되돌릴 수 있어요.</p>
          </article>
        </div>
      </section>
    `;
  }

  function renderHistorySection(state) {
    const items = state.historyRefreshPending
      ? []
      : state.history.filter((item) => item.version !== state.latest?.version).slice(0, 5);
    return `
      <section class="inova-release-section">
        ${renderSectionSummary("이전 버전", state.historyLoading || state.historyRefreshPending ? "불러오는 중" : `${items.length}개`)}
        <div class="inova-release-section__body">
          ${items.length
            ? `<div class="inova-release-history">${items.map((item) => renderHistoryItem(item)).join("")}</div>`
            : `<article class="inova-release-card"><p class="inova-release-card__empty">${state.historyLoading || state.historyRefreshPending ? "현재 버전에 맞는 이전 버전 목록을 불러오는 중이에요." : "이전 버전 목록은 확인 후 표시됩니다."}</p></article>`}
        </div>
      </section>
    `;
  }

  function renderHistoryItem(item) {
    const summary = item.summary || item.notes || "이 버전의 변경 요약이 아직 없습니다.";
    const details = renderReleaseDetails("변경 내용 보기", renderChangeList(item.changes));
    return `
      <div class="inova-release-history__item">
        <div class="inova-release-history__main">
          <div class="inova-release-history__head">
            <strong>${escapeHtml(item.version)}</strong>
            <div class="inova-release-card__badges">
              <span class="inova-store-item__chip is-muted">${escapeHtml(formatReleaseLevel(item.level))}</span>
              <span>${escapeHtml(formatDateTime(item.publishedAt))}</span>
            </div>
          </div>
          <strong class="inova-release-card__headline">${escapeHtml(item.headline || item.notes || `${item.version} 릴리스`)}</strong>
          <p>${escapeHtml(summary)}</p>
          ${details}
        </div>
        <button type="button" class="inova-tool-button inova-tool-button--compact" data-release-action="download-version" data-release-version="${escapeHtml(item.version)}">받기</button>
      </div>
    `;
  }

  function renderSectionSummary(title, meta = "") {
    return `
      <div class="inova-tool-inline-summary">
        <strong>${escapeHtml(title)}</strong>
        ${meta ? `<span class="inova-tool-inline-summary__meta">${escapeHtml(meta)}</span>` : ""}
      </div>
    `;
  }

  function renderChangeList(changes) {
    const items = Array.isArray(changes) ? changes.filter((item) => item?.text) : [];
    if (!items.length) return "";
    return `
      <ul class="inova-release-card__changes">
        ${items.slice(0, 3).map((item) => `
          <li>
            <span class="inova-release-card__change-type">${escapeHtml(formatChangeType(item.type))}</span>
            <span>${escapeHtml(item.text)}</span>
          </li>
        `).join("")}
      </ul>
    `;
  }

  function renderReleaseDetails(label, content) {
    const body = String(content || "").trim();
    if (!body) return "";
    return `
      <details class="inova-release-details">
        <summary>${escapeHtml(label)}</summary>
        <div class="inova-release-details__body">${body}</div>
      </details>
    `;
  }

  function renderCheckedMeta(value) {
    const label = formatCheckedAt(value);
    return label ? `<span class="inova-release-card__meta">${escapeHtml(label)}</span>` : "";
  }

  function formatCheckedAt(value) {
    const formatted = formatDateTime(value, "");
    return formatted ? `최근 확인 ${formatted}` : "";
  }

  function formatDateTime(value, fallback = "아직 확인 전") {
    const time = Date.parse(value || "");
    if (!time) return fallback;
    return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(time);
  }

  function formatReleaseLevel(level) {
    if (level === "major") return "메이저";
    if (level === "minor") return "마이너";
    return "패치";
  }

  function formatChangeType(type) {
    if (type === "added") return "추가";
    if (type === "fixed") return "수정";
    if (type === "removed") return "제거";
    if (type === "ops") return "운영";
    return "변경";
  }

  function formatBytes(sizeBytes) {
    const size = Math.max(0, Number(sizeBytes) || 0);
    if (!size) return "크기 정보 없음";
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`;
    return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  }

  function renderDisabled(disabled) {
    return disabled ? 'disabled aria-disabled="true"' : "";
  }

  function escapeHtml(text) {
    return String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  namespace.releaseView = { render };
})(globalThis);
