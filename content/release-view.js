(function initReleaseView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    return `
      <section class="inova-tool-section inova-tool-section--release">
        <div class="inova-tool-toolbar">
          <div class="inova-tool-meta">현재 ${escapeHtml(state.currentVersion)}</div>
          <div class="inova-tool-actions inova-tool-actions--toolbar">
            <button type="button" class="inova-tool-button" data-release-action="refresh" ${renderDisabled(state.checking || state.historyLoading)}>${state.checking ? "확인 중..." : "다시 확인"}</button>
          </div>
        </div>
        <div class="inova-release-stack">
          ${renderStatusCard(state)}
          ${state.updateAvailable ? renderUpdateCard(state.latest) : ""}
          ${renderGuideCard()}
          ${renderHistoryCard(state)}
        </div>
      </section>
    `;
  }

  function renderStatusCard(state) {
    if (state.error) {
      return `
        <article class="inova-release-card is-muted">
          <strong>업데이트 서버에 지금 연결되지 않아요.</strong>
          <p>나중에 다시 확인해 주세요.</p>
          <span class="inova-release-card__meta">현재 설치 버전 ${escapeHtml(state.currentVersion)}</span>
        </article>
      `;
    }
    if (state.checking && !state.latest) {
      return `
        <article class="inova-release-card is-muted">
          <strong>버전 정보를 확인하는 중이에요.</strong>
          <p>현재 설치 버전 ${escapeHtml(state.currentVersion)}</p>
        </article>
      `;
    }
    if (state.updateAvailable) {
      return `
        <article class="inova-release-card is-highlight">
          <strong>새 버전이 있어요.</strong>
          <p>현재 ${escapeHtml(state.currentVersion)} / 최신 ${escapeHtml(state.latestVersion)}</p>
          <span class="inova-release-card__meta">${escapeHtml(formatDateTime(state.lastCheckedAt))}</span>
        </article>
      `;
    }
    return `
      <article class="inova-release-card is-muted">
        <strong>최신 버전을 사용 중입니다.</strong>
        <p>현재 ${escapeHtml(state.currentVersion)} / 최신 ${escapeHtml(state.latestVersion || state.currentVersion)}</p>
        <span class="inova-release-card__meta">${escapeHtml(formatDateTime(state.lastCheckedAt))}</span>
      </article>
    `;
  }

  function renderUpdateCard(latest) {
    return `
      <article class="inova-release-card">
        <div class="inova-release-card__head">
          <strong>${escapeHtml(latest.version)} 배포본</strong>
          <span class="inova-store-item__chip">신규</span>
        </div>
        <p>${escapeHtml(latest.notes || "새 버전이 배포되었습니다.")}</p>
        <div class="inova-release-card__meta-row">
          <span>${escapeHtml(formatDateTime(latest.publishedAt))}</span>
          <span>${escapeHtml(formatBytes(latest.sizeBytes))}</span>
        </div>
        <div class="inova-tool-actions">
          <button type="button" class="inova-tool-button is-primary" data-release-action="download-latest">ZIP 받기</button>
        </div>
      </article>
    `;
  }

  function renderGuideCard() {
    return `
      <article class="inova-release-card">
        <strong>설치·업데이트 방법</strong>
        <p class="inova-release-card__notice">설치나 업데이트를 진행하기 전에 Chrome 확장 프로그램 페이지에서 개발자 모드를 먼저 켜 주세요. 개발자 모드가 꺼져 있으면 설치와 새로고침 버튼이 보이지 않을 수 있어요.</p>
        <div class="inova-release-guide">
          <strong>처음 설치하는 경우</strong>
          <ol class="inova-release-steps">
            <li>ZIP 받기를 눌러 파일을 내려받고, 원하는 폴더에 압축을 풉니다.</li>
            <li>Chrome 주소창에 chrome://extensions 를 입력해 확장 프로그램 페이지를 엽니다.</li>
            <li>오른쪽 위 개발자 모드를 켭니다.</li>
            <li>압축해제된 확장 프로그램을 로드합니다를 눌러 방금 압축을 푼 폴더를 선택합니다.</li>
            <li>설치가 끝나면 i-Nova 탭으로 돌아가 페이지를 새로고침합니다.</li>
          </ol>
        </div>
        <div class="inova-release-guide">
          <strong>이미 설치되어 있는 경우</strong>
          <ol class="inova-release-steps">
            <li>새 ZIP을 내려받고 압축을 풉니다.</li>
            <li>기존 확장 폴더를 새 파일로 바꾸거나, 새 폴더로 교체합니다.</li>
            <li>chrome://extensions 에서 이 확장의 새로고침 버튼을 누릅니다.</li>
            <li>i-Nova 탭도 새로고침하면 최신 화면이 반영됩니다.</li>
          </ol>
        </div>
        <p class="inova-release-card__empty">자동 업데이트는 지원하지 않습니다. 문제가 생기면 이전 버전 ZIP을 다시 받아 같은 방법으로 되돌릴 수 있어요.</p>
      </article>
    `;
  }

  function renderHistoryCard(state) {
    const items = state.history.slice(0, 5);
    return `
      <article class="inova-release-card">
        <div class="inova-release-card__head">
          <strong>이전 버전</strong>
          <span class="inova-release-card__meta">${state.historyLoading ? "불러오는 중" : `${items.length}개`}</span>
        </div>
        ${items.length
          ? `<div class="inova-release-history">${items.map((item) => `
              <div class="inova-release-history__item">
                <div>
                  <strong>${escapeHtml(item.version)}</strong>
                  <span>${escapeHtml(formatDateTime(item.publishedAt))}</span>
                </div>
                <button type="button" class="inova-tool-button inova-tool-button--compact" data-release-action="download-version" data-release-version="${escapeHtml(item.version)}">받기</button>
              </div>
            `).join("")}</div>`
          : `<p class="inova-release-card__empty">${state.historyLoading ? "이전 버전을 불러오는 중이에요." : "이전 버전 목록은 확인 후 표시됩니다."}</p>`}
      </article>
    `;
  }

  function formatDateTime(value) {
    const time = Date.parse(value || "");
    if (!time) return "아직 확인 전";
    return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(time);
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
