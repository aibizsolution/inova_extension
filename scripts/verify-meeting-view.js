#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  const context = vm.createContext({ console, globalThis: null, Intl });
  context.globalThis = context;
  context.InovaBookmarks = {};
  loadScript("hosting/extension-v2/panel/meeting-view.js", context);

  verifyOwnedCard(context);
  verifyRevokeConfirmationCard(context);
  verifyParticipationCard(context);
  verifyRevokedParticipationCard(context);
  verifyTabs(context);
  verifyEmptyStates(context);
  console.log("[verify-meeting-view] Hosted meeting view contract passed");
}

function verifyOwnedCard(context) {
  const markup = context.InovaBookmarks.meetingView.render({
    checkedAt: "2026-04-13T01:02:03.000Z",
    counts: { all: 1, owned: 1, participating: 0 },
    items: [
      {
        latestArtifactId: "artifact-alpha",
        latestJobId: "job-alpha",
        meetingId: "meeting-alpha",
        share: { active: true, participantCount: 3, shareId: "share-alpha", status: "active" },
        status: "succeeded",
        title: "최은정 실장(광고 3실) 요구 사항",
        updatedAt: "2026-04-13T01:01:00.000Z",
      },
    ],
  });
  assert(!markup.includes("inova-meeting-record__badge-stack"), "meeting view should not stack the owner badge below the title");
  assert(!markup.includes("inova-meeting-record__chips"), "meeting view should not reserve a right-side chip column");
  assert(markup.includes("inova-meeting-record__title"), "meeting title should have its own row target");
  assert(!markup.includes("inova-meeting-record__badge is-owned"), "owned meetings should not render a source badge");
  assert(markup.includes("기록 있음"), "record status should render below the title");
  assert(!markup.includes("최근 기록"), "meeting metadata should omit repeated recency labels");
  assert(!markup.includes("최근 업데이트"), "meeting metadata should omit repeated update labels");
  assert(markup.includes("inova-meeting-record__meta-value"), "meeting metadata should render the date value");
  assert(!markup.includes("공유 중"), "share state should not be rendered as the card status");
  assert(markup.includes("열람 3명"), "active shared meeting cards should render the aggregate participant count");
  assert(markup.includes("inova-meeting-record__status is-success"), "record status should use the original status style");
  assert(!markup.includes("inova-meeting-record__status-badge"), "record status should not render as a badge");
}

function verifyRevokeConfirmationCard(context) {
  const markup = context.InovaBookmarks.meetingView.render({
    checkedAt: "2026-04-13T01:02:03.000Z",
    items: [
      {
        latestJobId: "job-alpha",
        meetingId: "meeting-alpha",
        share: { active: true, participantCount: 3, shareId: "share-alpha", status: "active" },
        title: "Alpha",
        updatedAt: "2026-04-13T01:01:00.000Z",
      },
    ],
    revokeConfirmation: { meetingId: "meeting-alpha", shareParticipantCount: 3, title: "Alpha" },
  });
  assert(markup.includes("공유 해제 전 확인"), "revoke share warning should render inside the meeting card");
  assert(markup.includes("현재 이 링크를 열람한 사용자는 3명입니다."), "revoke warning should include the participant count");
  assert(markup.includes('data-meeting-action="confirm-revoke-share"'), "revoke confirmation should use an in-panel confirm action");
  assert(markup.includes('data-meeting-action="cancel-revoke-share"'), "revoke confirmation should provide an in-panel cancel action");
}

function verifyParticipationCard(context) {
  const markup = context.InovaBookmarks.meetingView.render({
    activeScope: "participating",
    checkedAt: "2026-04-13T01:02:03.000Z",
    counts: { all: 1, owned: 0, participating: 1 },
    items: [
      {
        accessState: "active",
        meetingId: "meeting-shared",
        owner: {
          displayName: "공유자 QA",
          email: "shared-owner.local@example.com",
          providerUserKey: "shared-owner",
        },
        participationId: "participation-shared",
        sourceKind: "participating",
        title: "공유 받은 회의룸 UI 샘플",
        updatedAt: "2026-04-13T01:01:00.000Z",
      },
    ],
  });
  assert(
    /inova-meeting-record__title-row[\s\S]*>참여<[\s\S]*inova-meeting-record__title/.test(markup),
    "participation badge should render before the title"
  );
  assert(markup.includes(">공유자 QA</span>"), "participation card should render the collected display name");
  assert(markup.includes('title="이메일 shared-owner.local@example.com"'), "participation owner email should be tooltip-only");
  assert(markup.includes("확인 필요"), "participation cards should not claim source meeting record status");
}

function verifyRevokedParticipationCard(context) {
  const markup = context.InovaBookmarks.meetingView.render({
    activeScope: "participating",
    checkedAt: "2026-04-13T01:02:03.000Z",
    counts: { all: 1, owned: 0, participating: 1 },
    items: [
      {
        accessState: "revoked",
        meetingId: "meeting-revoked",
        owner: {
          displayName: "공유자 QA",
          email: "shared-owner.local@example.com",
          providerUserKey: "shared-owner",
        },
        participationId: "participation-revoked",
        sourceKind: "participating",
        title: "공유 해제된 회의룸",
        updatedAt: "2026-04-13T01:01:00.000Z",
      },
    ],
  });
  assert(markup.includes("접근 불가"), "revoked participation cards should render as unavailable");
  assert(markup.includes("목록에서 제거"), "revoked participation cards should keep only the remove action");
  assert(!markup.includes("작업실 열기"), "revoked participation cards should not advertise reopening");
}

function verifyTabs(context) {
  const markup = context.InovaBookmarks.meetingView.render({
    activeScope: "participating",
    checkedAt: "2026-04-13T01:02:03.000Z",
    counts: { all: 2, owned: 2, participating: 0 },
    items: [],
  });
  assert(markup.includes("inova-tool-subtabs"), "meeting tabs should use the shared subtab style");
  assert(!markup.includes("inova-meeting-subtabs"), "meeting tabs should not use a private subtab style");
  assert(markup.includes(">전체</span>\n            <span class=\"inova-tool-subtab__count\">2</span>"), "non-zero tab counts should render");
  assert(!markup.includes(">참여한 회의룸</span>\n            <span class=\"inova-tool-subtab__count\">0</span>"), "zero tab counts should be hidden");
}

function verifyEmptyStates(context) {
  const searchMarkup = context.InovaBookmarks.meetingView.render({
    activeScope: "participating",
    checkedAt: "2026-04-13T01:02:03.000Z",
    counts: { all: 1, owned: 0, participating: 1 },
    items: [],
    query: "missing",
  });
  assert(searchMarkup.includes("검색 결과가 없습니다."), "meeting search empty state should be search-specific");
  assert(!searchMarkup.includes("상단의 새 회의 룸 생성"), "search empty state should not reuse create-room guidance");

  const participatingMarkup = context.InovaBookmarks.meetingView.render({
    activeScope: "participating",
    checkedAt: "2026-04-13T01:02:03.000Z",
    counts: { all: 9, owned: 9, participating: 0 },
    items: [],
  });
  assert(participatingMarkup.includes("참여한 회의룸이 없습니다."), "participating empty state should explain the selected scope");
  assert(!participatingMarkup.includes("상단의 새 회의 룸 생성"), "participating empty state should not suggest creating a room");
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

main();
