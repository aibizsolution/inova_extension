(function initReleaseView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    return `
      <section class="inova-tool-section inova-tool-section--release">
        <div class="inova-tool-toolbar is-stacked">
          <div class="inova-tool-toolbar__row inova-tool-toolbar__row--release">
            <div class="inova-tool-meta">설치 버전 ${escapeHtml(state.currentVersion)}</div>
          </div>
        </div>
        <div class="inova-release-stack">
          ${renderUpdateSection(state)}
          ${renderGuideSection()}
          ${renderLatestSection(state)}
        </div>
      </section>
    `;
  }

  function renderUpdateSection(state) {
    return `
      <section class="inova-release-section">
        ${renderSectionSummary("릴리스 상태")}
        <div class="inova-release-section__body">
          ${renderStatusCard(state)}
        </div>
      </section>
    `;
  }

  function renderLatestSection(state) {
    if (!state.latest || state.versionRefreshPending) {
      return "";
    }
    return `
      <section class="inova-release-section">
        ${renderSectionSummary("배포 버전")}
        <div class="inova-release-section__body">
          ${renderLatestCard(state)}
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
          <p class="inova-release-card__empty">오류: ${escapeHtml(state.error)}</p>
        </article>
      `;
    }
    if (!state.canOpenDownloads && state.capabilityError) {
      return `
        <article class="inova-release-card is-muted">
          <strong>릴리스 다운로드를 열 수 없어요.</strong>
          <p>${escapeHtml(state.capabilityError)}</p>
        </article>
      `;
    }
    if (state.versionRefreshPending || (state.checking && !state.latest)) {
      return `
        <article class="inova-release-card is-muted">
          <strong>릴리스 정보를 확인하고 있어요.</strong>
          <p>${state.versionRefreshPending ? `설치한 ${escapeHtml(state.currentVersion)} 버전에 맞춰 다시 불러오는 중입니다.` : "잠시만 기다려 주세요."}</p>
        </article>
      `;
    }
    if (state.updateAvailable) {
      return `
        <article class="inova-release-card is-highlight">
          <strong>${escapeHtml(state.latestVersion)} 버전이 준비되어 있어요.</strong>
          <p>지금은 ${escapeHtml(state.currentVersion)} 버전을 사용 중입니다.</p>
        </article>
      `;
    }
    if (state.currentAheadOfLatest) {
      return `
        <article class="inova-release-card is-muted">
          <strong>설치 버전이 최신 배포 안내보다 앞서 있어요.</strong>
          <p>배포 안내 기준은 ${escapeHtml(state.latestVersion)} 입니다. 로컬 테스트 중이면 정상이에요.</p>
        </article>
      `;
    }
    return `
      <article class="inova-release-card is-muted">
        <strong>최신 버전을 사용 중이에요.</strong>
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
        summary ? `<p>${escapeHtml(summary)}</p>` : "",
        changeList,
      ].filter(Boolean).join("")
    );
    return `
      <article class="inova-release-card inova-release-card--compact">
        <div class="inova-release-card__head">
          <strong class="inova-release-card__headline">${escapeHtml(latest.version)} · ${escapeHtml(latest.headline || latest.notes || "최신 릴리스")}</strong>
          <button type="button" class="inova-tool-button inova-tool-button--compact ${state.updateAvailable ? "is-primary" : ""}" data-release-action="download-latest" ${state.canOpenDownloads ? "" : 'disabled aria-disabled="true"'}>받기</button>
        </div>
        ${details}
      </article>
    `;
  }

  function renderGuideSection() {
    return `
      <section class="inova-release-section">
        ${renderSectionSummary("설치/업데이트")}
        <div class="inova-release-section__body">
          <article class="inova-release-card">
            ${renderReleaseDetails(
              "처음 설치",
              `
                <p>다른 PC나 새 Chrome 프로필에 처음 설치할 때만 보면 됩니다.</p>
                <ol class="inova-release-steps">
                  <li><code>받기</code> 버튼으로 설치 파일을 내려받고 압축을 풉니다.</li>
                  <li>설치할 Chrome에서 <code>chrome://extensions</code> 를 엽니다.</li>
                  <li>오른쪽 위에서 개발자 모드를 켭니다.</li>
                  <li><code>압축해제된 확장 프로그램을 로드합니다</code>를 눌러 압축을 푼 폴더를 선택합니다.</li>
                  <li>설치 후 i-Nova 탭을 새로고침합니다.</li>
                </ol>
              `
            )}
            ${renderReleaseDetails(
              "업데이트",
              `
                <ol class="inova-release-steps">
                  <li><code>받기</code> 버튼으로 새 파일을 내려받고 압축을 풉니다.</li>
                  <li>기존 확장 폴더를 새 파일로 바꾸거나 새 폴더로 교체합니다.</li>
                  <li><code>chrome://extensions</code> 에서 이 확장의 <code>새로고침</code> 버튼을 누릅니다.</li>
                  <li>i-Nova 탭도 새로고침하면 최신 화면이 반영됩니다.</li>
                </ol>
              `
            )}
          </article>
        </div>
      </section>
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

  function formatChangeType(type) {
    if (type === "added") return "추가";
    if (type === "fixed") return "수정";
    if (type === "removed") return "제거";
    if (type === "ops") return "운영";
    return "변경";
  }

  function escapeHtml(text) {
    return String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  namespace.releaseView = { render };
})(globalThis);
