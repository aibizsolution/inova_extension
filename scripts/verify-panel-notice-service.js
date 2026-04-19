#!/usr/bin/env node

const assert = require("assert");
const { createAdminDomain } = require("../functions/features/admin/admin-service");

async function main() {
  await verifyPanelNoticeReadStates();
  await verifyMultipleVisibleNoticePublishing();
  await verifyAdminSessionAndValidationGuards();
  console.log("[verify-panel-notice-service] Panel notice service contract passed");
}

async function verifyPanelNoticeReadStates() {
  let nowMs = Date.parse("2026-04-19T01:00:00.000Z");
  const db = createFakeDb();
  const domain = createDomain(db, () => nowMs);
  const adminSessionToken = await issueAdminSession(domain);

  const empty = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(empty.notice, null, "panel read should return null when no active notice exists");

  const savedNotice = await domain.saveAdminPanelNotice(adminSessionToken, {
    bodyMarkdown: "저장 즉시 기간 조건으로 노출",
    endsAt: "2026-04-19T02:00:00.000Z",
    startsAt: "2026-04-19T00:30:00.000Z",
    title: "저장 공지",
  });
  assert.equal(savedNotice.notice.status, "published", "saved notices should be eligible for time-window visibility");
  const savedRead = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(savedRead.notice.noticeId, savedNotice.notice.noticeId, "panel read should expose a saved notice inside its display window");

  await domain.archiveAdminPanelNotice(adminSessionToken, { noticeId: savedNotice.notice.noticeId });
  assert.equal(
    (await domain.readPanelNotice({ providerUserKey: "viewer-1" })).notice,
    null,
    "panel read should hide an archived notice even when the display window matches"
  );

  const futureNotice = await domain.publishAdminPanelNotice(adminSessionToken, {
    bodyMarkdown: "아직 시작 전",
    endsAt: "2026-04-20T00:00:00.000Z",
    startsAt: "2026-04-19T03:00:00.000Z",
    title: "예정 공지",
  });
  assert.equal(futureNotice.notice.status, "published");
  assert.equal(
    (await domain.readPanelNotice({ providerUserKey: "viewer-1" })).notice,
    null,
    "panel read should hide a notice before startsAt"
  );

  nowMs = Date.parse("2026-04-19T03:00:00.000Z");
  const active = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(active.notice.title, "예정 공지", "panel read should return an active notice inside the display window");

  nowMs = Date.parse("2026-04-20T00:00:01.000Z");
  assert.equal(
    (await domain.readPanelNotice({ providerUserKey: "viewer-1" })).notice,
    null,
    "panel read should hide a notice after endsAt"
  );
}

async function verifyMultipleVisibleNoticePublishing() {
  const db = createFakeDb();
  let nowMs = Date.parse("2026-04-19T04:00:00.000Z");
  const domain = createDomain(db, () => nowMs);
  const adminSessionToken = await issueAdminSession(domain);

  const first = await domain.publishAdminPanelNotice(adminSessionToken, {
    bodyMarkdown: "<b>원문 HTML</b>\n- **중요** 항목\n[문서](https://example.com/docs?a=1&b=2)",
    cta: {
      label: "자세히",
      url: "https://example.com/docs",
    },
    endsAt: "2026-04-22T00:00:00.000Z",
    title: "첫 공지",
  });
  const publicNotice = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(publicNotice.notice.noticeId, first.notice.noticeId);
  assert.equal(publicNotice.notices.length, 1, "panel read should expose visible notices as an ordered list");
  assert(publicNotice.notice.bodyHtml.includes("&lt;b&gt;원문 HTML&lt;/b&gt;"), "raw HTML should be escaped in public notice HTML");
  assert(publicNotice.notice.bodyHtml.includes("<strong>중요</strong>"), "limited Markdown bold should render");
  assert(publicNotice.notice.bodyHtml.includes('<a href="https://example.com/docs?a=1&amp;b=2"'), "https Markdown links should render escaped href attributes once");
  assert(!hasOwn(publicNotice.notice, "updatedBy"), "panel read should not expose admin actor metadata");
  assert(!hasOwn(publicNotice.notice, "status"), "panel read should not expose internal notice status");
  assert(!hasOwn(publicNotice.notice, "bodyMarkdown"), "panel read should not expose authoring Markdown");

  nowMs = Date.parse("2026-04-19T04:01:00.000Z");
  const second = await domain.publishAdminPanelNotice(adminSessionToken, {
    bodyMarkdown: "두 번째 공지",
    endsAt: "2026-04-23T00:00:00.000Z",
    title: "두 번째",
  });
  const firstStored = db.readDocument("ops_panel_notices", first.notice.noticeId);
  const currentState = db.readDocument("ops_panel_notice_state", "current");
  const currentSignal = db.readDocument("ops_panel_notice_signals", "current");
  const publicNotices = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(firstStored.status, "published", "publishing a new notice should keep previous visible notices published");
  assert.equal(publicNotices.notices.length, 2, "panel read should return multiple visible notices");
  assert.equal(publicNotices.notice.noticeId, second.notice.noticeId, "panel read should keep the newest visible notice as the compatibility notice");
  assert.equal(currentState.activeNoticeId, second.notice.noticeId, "current state should point to the latest published notice");
  assert.equal(currentSignal.reason, "publish", "notice mutations should write a public realtime invalidation signal");
  assert(currentSignal.revision, "notice invalidation signals should carry a revision key for Firestore subscribers");
  assert(!hasOwn(currentSignal, "updatedBy"), "public notice invalidation signals should not expose admin actor metadata");

  await domain.moveAdminPanelNotice(adminSessionToken, { direction: "up", noticeId: first.notice.noticeId });
  assert.equal(db.readDocument("ops_panel_notice_signals", "current").reason, "move");
  const afterMove = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(afterMove.notice.noticeId, first.notice.noticeId, "moving a notice up should make it the first panel notice");

  await domain.archiveAdminPanelNotice(adminSessionToken, { noticeId: second.notice.noticeId });
  assert.equal(db.readDocument("ops_panel_notice_signals", "current").reason, "archive");
  const afterArchive = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(afterArchive.notices.length, 1, "archiving one notice should keep the remaining visible notice");
  assert.equal(afterArchive.notice.noticeId, first.notice.noticeId);

  await domain.deleteAdminPanelNotice(adminSessionToken, { noticeId: first.notice.noticeId });
  assert.equal(db.readDocument("ops_panel_notice_signals", "current").reason, "delete");
  const afterDelete = await domain.readPanelNotice({ providerUserKey: "viewer-1" });
  assert.equal(afterDelete.notice, null, "deleting the remaining visible notice should remove it from panel reads");
  assert.equal(db.readDocument("ops_panel_notices", first.notice.noticeId), undefined, "deleted notices should be removed from storage");
}

async function verifyAdminSessionAndValidationGuards() {
  const db = createFakeDb();
  const domain = createDomain(db, () => Date.parse("2026-04-19T05:00:00.000Z"));
  const adminSessionToken = await issueAdminSession(domain);
  const validNotice = {
    bodyMarkdown: "본문",
    endsAt: "2026-04-21T00:00:00.000Z",
    title: "검증 공지",
  };

  await assert.rejects(
    () => domain.saveAdminPanelNotice("", validNotice),
    (error) => Number(error.status) === 400,
    "admin write should reject missing AdminSession tokens"
  );
  await assert.rejects(
    () => domain.publishAdminPanelNotice(adminSessionToken, {
      ...validNotice,
      bodyMarkdown: "[잘못된 링크](http://example.com)",
    }),
    /https:\/\/ URL만/,
    "Markdown links should only allow https URLs"
  );
  await assert.rejects(
    () => domain.publishAdminPanelNotice(adminSessionToken, {
      ...validNotice,
      cta: {
        label: "이동",
        url: "http://example.com",
      },
    }),
    /https:\/\/ URL만/,
    "CTA URLs should only allow https URLs"
  );
  await assert.rejects(
    () => domain.publishAdminPanelNotice(adminSessionToken, {
      ...validNotice,
      endsAt: "2026-04-18T00:00:00.000Z",
    }),
    /현재보다 이후/,
    "publish should reject notices whose endsAt is already in the past"
  );
}

function createDomain(db, now) {
  return createAdminDomain({
    adminConfig: {
      providerUserKeys: ["admin-1"],
    },
    db,
    now,
  });
}

async function issueAdminSession(domain) {
  const launch = await domain.issueAdminLaunch({
    displayName: "Admin",
    email: "admin@example.com",
    providerUserKey: "admin-1",
  });
  return (await domain.exchangeAdminLaunch(launch.launchToken)).adminSessionToken;
}

function createFakeDb() {
  const collections = new Map();
  let sequence = 0;

  function readCollection(collectionName) {
    const name = String(collectionName || "");
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  function buildSnapshot(collectionName, entries) {
    return {
      docs: entries.map(([id, data]) => ({
        id,
        data() {
          return cloneValue(data);
        },
      })),
    };
  }

  function readOrderedEntries(collectionName, field, direction) {
    const entries = Array.from(readCollection(collectionName).entries());
    return entries.sort((left, right) => {
      const leftValue = String(left[1]?.[field] || "");
      const rightValue = String(right[1]?.[field] || "");
      return direction === "desc"
        ? rightValue.localeCompare(leftValue)
        : leftValue.localeCompare(rightValue);
    });
  }

  return {
    collection(collectionName) {
      return {
        doc(id) {
          const docId = String(id || `${collectionName}-${++sequence}`);
          return {
            id: docId,
            async get() {
              const collection = readCollection(collectionName);
              const data = collection.get(docId);
              return {
                exists: data !== undefined,
                data() {
                  return cloneValue(data);
                },
              };
            },
            async set(value, options = {}) {
              const collection = readCollection(collectionName);
              const previous = options.merge ? collection.get(docId) || {} : {};
              collection.set(docId, cloneValue({
                ...previous,
                ...(value || {}),
              }));
            },
            async delete() {
              readCollection(collectionName).delete(docId);
            },
          };
        },
        async get() {
          return buildSnapshot(collectionName, Array.from(readCollection(collectionName).entries()));
        },
        orderBy(field, direction = "asc") {
          return {
            limit(count) {
              return {
                async get() {
                  return buildSnapshot(
                    collectionName,
                    readOrderedEntries(collectionName, field, direction).slice(0, Number(count) || 0)
                  );
                },
              };
            },
          };
        },
      };
    },
    readDocument(collectionName, id) {
      return cloneValue(readCollection(collectionName).get(id));
    },
  };
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

main().catch((error) => {
  console.error(`[verify-panel-notice-service] ${error.stack || error.message}`);
  process.exitCode = 1;
});
