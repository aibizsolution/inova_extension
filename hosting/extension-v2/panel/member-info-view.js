(function initMemberInfoView(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function render(state) {
    return `
      <section class="inova-tool-section inova-tool-section--member">
        <div class="inova-tool-toolbar is-stacked">
          <div class="inova-tool-toolbar__row">
            <div class="inova-tool-meta">${escapeHtml(renderMeta(state))}</div>
            <button type="button" class="inova-tool-button inova-tool-button--compact is-primary" data-member-action="refresh" ${state.canRefresh ? "" : 'disabled aria-disabled="true"'}>${state.loading ? "확인 중..." : "새로고침"}</button>
          </div>
        </div>
        <div class="inova-member-stack">
          ${renderBody(state)}
        </div>
      </section>
    `;
  }

  function renderBody(state) {
    if (state.capabilityError) {
      return renderMessageCard("회원 정보를 열 수 없어요.", state.capabilityError, "muted");
    }
    if (state.loading && !state.initialized) {
      return renderMessageCard("회원 정보를 확인하고 있어요.", "잠시만 기다려 주세요.", "muted");
    }
    if (!state.initialized) {
      return `
        <article class="inova-release-card inova-member-card">
          <strong>아직 확인 전입니다.</strong>
          <button type="button" class="inova-tool-button is-primary" data-member-action="show">회원 정보 보기</button>
        </article>
      `;
    }
    const identity = state.member?.providerIdentity || {};
    if (!identity.available) {
      return renderMessageCard("회원 정보를 아직 찾지 못했어요.", state.error || "i-Nova 로그인을 확인해 주세요.", "muted", state.canRefresh);
    }
    return `
      ${state.error ? renderMessageCard("일부 정보가 제한적으로 표시돼요.", state.error, "muted") : ""}
      <article class="inova-release-card inova-member-card">
        <div class="inova-member-card__head">
          <div>
            <strong>${escapeHtml(identity.displayName || "이름 없음")}</strong>
            <p>${escapeHtml(identity.email || "이메일 없음")}</p>
          </div>
          <span class="inova-member-status">확인됨</span>
        </div>
        <dl class="inova-member-grid">
          ${renderField("사용자 키", identity.providerUserKey || "없음")}
          ${renderField("계정 공급자", identity.provider || "inova")}
          ${renderField("사용자 번호", identity.numericUserId == null ? "없음" : identity.numericUserId)}
          ${renderField("패널 상태", state.member?.uiPreferences?.panelOpen ? "열림" : "닫힘")}
          ${renderField("활성 도구", state.member?.uiPreferences?.activeTool || "없음")}
          ${renderField("회의 타깃", state.member?.settings?.meetingWorkspaceTarget || "production")}
        </dl>
      </article>
    `;
  }

  function renderMessageCard(title, body, tone = "muted", retry = false) {
    return `
      <article class="inova-release-card is-${escapeHtml(tone)} inova-member-card">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
        ${retry ? '<button type="button" class="inova-tool-button inova-tool-button--compact" data-member-action="refresh">다시 확인</button>' : ""}
      </article>
    `;
  }

  function renderField(label, value) {
    return `
      <div class="inova-member-field">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `;
  }

  function renderMeta(state) {
    if (state.loading) {
      return "회원 정보 확인 중";
    }
    if (state.checkedAt) {
      return `마지막 확인 ${formatDateTime(state.checkedAt)}`;
    }
    return "아직 확인 전";
  }

  function formatDateTime(value) {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) {
      return "";
    }
    return new Date(time).toLocaleString("ko-KR", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
    });
  }

  function escapeHtml(text) {
    return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  namespace.memberInfoView = { render };
})(globalThis);
