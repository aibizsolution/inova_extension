#!/usr/bin/env node

const assert = require("assert");
const { createAdminDomain } = require("../functions/features/admin/admin-service");

async function main() {
  await verifyConfigAllowlistAccess();
  await verifyFirestoreAdminAccessAndSessionFlow();
  await verifyAdminAccessUserManagement();
  await verifyDeniedUserCannotIssueLaunch();
  console.log("[verify-admin-service] Admin service contract passed");
}

async function verifyConfigAllowlistAccess() {
  const domain = createAdminDomain({
    adminConfig: {
      emails: ["ops@example.com"],
      providerUserKeys: ["admin-1"],
      roles: {
        "admin-1": "owner",
        "ops@example.com": "viewer",
      },
    },
    db: createFakeDb(),
    now: () => Date.parse("2026-04-19T01:00:00.000Z"),
  });

  const byUserKey = await domain.checkAdminAccess({
    email: "ignored@example.com",
    providerUserKey: "admin-1",
  });
  assert.equal(byUserKey.allowed, true);
  assert.equal(byUserKey.role, "owner");
  assert.equal(byUserKey.source, "env");

  const byEmail = await domain.checkAdminAccess({
    email: "Ops@Example.com",
    providerUserKey: "not-listed",
  });
  assert.equal(byEmail.allowed, true);
  assert.equal(byEmail.role, "viewer");
  assert.equal(byEmail.source, "env");
}

async function verifyFirestoreAdminAccessAndSessionFlow() {
  let nowMs = Date.parse("2026-04-19T02:00:00.000Z");
  const db = createFakeDb();
  await db.collection("ops_admin_users").doc("user-2").set({
    role: "admin",
    status: "active",
  });
  const domain = createAdminDomain({
    db,
    now: () => nowMs,
  });

  const firestoreAccess = await domain.checkAdminAccess({
    displayName: "Tester",
    email: "tester@example.com",
    providerUserKey: "user-2",
  });
  assert.equal(firestoreAccess.allowed, true);
  assert.equal(firestoreAccess.reason, "firestore-admin");
  assert.equal(firestoreAccess.role, "admin");

  const launch = await domain.issueAdminLaunch({
    displayName: "Tester",
    email: "tester@example.com",
    providerUserKey: "user-2",
  });
  const [launchId, launchSecret] = launch.launchToken.split(".");
  const launchDoc = db.readDocument("ops_admin_launches", launchId);
  assert(launchSecret, "launch token should include a one-time secret");
  assert.equal(launchDoc.status, "issued");
  assert.equal(launchDoc.owner.providerUserKey, "user-2");
  assert.equal(typeof launchDoc.secretHash, "string");
  assert(!JSON.stringify(launchDoc).includes(launchSecret), "launch secret should not be stored in Firestore");

  const exchanged = await domain.exchangeAdminLaunch(launch.launchToken);
  assert.equal(exchanged.viewer.providerUserKey, "user-2");
  assert.equal(exchanged.role, "admin");
  assert(exchanged.adminSessionToken.includes("."));
  assert.equal(db.readDocument("ops_admin_launches", launchId).status, "consumed");

  const [sessionId, sessionSecret] = exchanged.adminSessionToken.split(".");
  const sessionDoc = db.readDocument("ops_admin_sessions", sessionId);
  assert.equal(sessionDoc.status, "active");
  assert.equal(sessionDoc.owner.providerUserKey, "user-2");
  assert(!JSON.stringify(sessionDoc).includes(sessionSecret), "admin session secret should not be stored in Firestore");

  const bootstrap = await domain.readAdminBootstrap(exchanged.adminSessionToken);
  assert.equal(bootstrap.viewer.providerUserKey, "user-2");
  assert.equal(bootstrap.role, "admin");

  await assert.rejects(
    () => domain.exchangeAdminLaunch(launch.launchToken),
    (error) => Number(error.status) === 410 && /이미 사용된/.test(error.message)
  );

  nowMs = Date.parse("2026-04-19T10:01:00.000Z");
  await assert.rejects(
    () => domain.readAdminBootstrap(exchanged.adminSessionToken),
    (error) => Number(error.status) === 410 && /만료/.test(error.message)
  );

  nowMs = Date.parse("2026-04-19T02:10:00.000Z");
  const secondLaunch = await domain.issueAdminLaunch({
    displayName: "Tester",
    email: "tester@example.com",
    providerUserKey: "user-2",
  });
  const secondExchange = await domain.exchangeAdminLaunch(secondLaunch.launchToken);
  await db.collection("ops_admin_users").doc("user-2").set({
    role: "admin",
    status: "inactive",
  });
  await assert.rejects(
    () => domain.readAdminBootstrap(secondExchange.adminSessionToken),
    (error) => Number(error.status) === 403 && /더 이상 유효/.test(error.message)
  );
}

async function verifyDeniedUserCannotIssueLaunch() {
  const db = createFakeDb();
  const domain = createAdminDomain({
    db,
    now: () => Date.parse("2026-04-19T03:00:00.000Z"),
  });
  const access = await domain.checkAdminAccess({
    email: "viewer@example.com",
    providerUserKey: "viewer-1",
  });
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "not-admin");
  await assert.rejects(
    () => domain.issueAdminLaunch({
      email: "viewer@example.com",
      providerUserKey: "viewer-1",
    }),
    (error) => Number(error.status) === 403 && /관리자 권한/.test(error.message)
  );
}

async function verifyAdminAccessUserManagement() {
  const db = createFakeDb();
  await db.collection("ops_admin_users").doc("admin-1").set({
    displayName: "Admin",
    email: "admin@example.com",
    providerUserKey: "admin-1",
    role: "admin",
    status: "active",
    updatedAt: "2026-04-19T01:00:00.000Z",
  });
  await db.collection("integration_inova_accounts_v2").doc("member-1").set({
    departmentName: "AI비즈솔루션팀",
    displayName: "Member One",
    email: "member1@example.com",
    providerUserKey: "member-1",
    updatedAt: "2026-04-19T01:10:00.000Z",
  });
  await db.collection("integration_inova_feature_usage_user_months").doc("member-2__2026-04").set({
    lastUsedAt: "2026-04-19T01:20:00.000Z",
    owner: {
      displayName: "Member Two",
      email: "member2@example.com",
      providerUserKey: "member-2",
      teamName: "성장본부",
    },
  });
  await db.collection("ops_admin_users").doc("member-2").set({
    displayName: "Member Two",
    email: "member2@example.com",
    organization: "플랫폼팀",
    providerUserKey: "member-2",
    role: "admin",
    status: "active",
    updatedAt: "2026-04-19T01:30:00.000Z",
  });

  const domain = createAdminDomain({
    db,
    now: () => Date.parse("2026-04-19T02:00:00.000Z"),
  });
  const launch = await domain.issueAdminLaunch({
    displayName: "Admin",
    email: "admin@example.com",
    providerUserKey: "admin-1",
  });
  const session = await domain.exchangeAdminLaunch(launch.launchToken);

  const list = await domain.listAdminAccessUsers(session.adminSessionToken);
  assert(list.users.some((user) => user.providerUserKey === "member-1" && user.status === "inactive"));
  assert(list.users.some((user) => user.providerUserKey === "member-1" && user.organization === "AI비즈솔루션팀"));
  assert(list.users.some((user) => user.providerUserKey === "member-2" && user.status === "active"));
  assert(list.users.some((user) => user.providerUserKey === "member-2" && user.displayName === "Member Two"));
  assert(list.users.some((user) => user.providerUserKey === "member-2" && user.organization === "플랫폼팀"));

  const promoted = await domain.saveAdminAccessUser(session.adminSessionToken, {
    isAdmin: true,
    organization: "신규사업본부",
    providerUserKey: "member-1",
  });
  assert.equal(promoted.user.status, "active");
  assert.equal(promoted.user.organization, "신규사업본부");
  assert.equal(db.readDocument("ops_admin_users", "member-1").status, "active");
  assert.equal(db.readDocument("ops_admin_users", "member-1").organization, "신규사업본부");

  const demoted = await domain.saveAdminAccessUser(session.adminSessionToken, {
    isAdmin: false,
    organization: "AI Lab",
    providerUserKey: "member-2",
  });
  assert.equal(demoted.user.status, "inactive");
  assert.equal(demoted.user.organization, "AI Lab");
  assert.equal(db.readDocument("ops_admin_users", "member-2").status, "inactive");
  assert.equal(db.readDocument("ops_admin_users", "member-2").organization, "AI Lab");

  await assert.rejects(
    () => domain.saveAdminAccessUser(session.adminSessionToken, {
      isAdmin: true,
      organization: "x".repeat(81),
      providerUserKey: "member-1",
    }),
    (error) => Number(error.status) === 400 && /조직은 80자 이하/.test(error.message)
  );

  await assert.rejects(
    () => domain.saveAdminAccessUser(session.adminSessionToken, {
      isAdmin: true,
      providerUserKey: "missing-user",
    }),
    (error) => Number(error.status) === 404 && /회원 목록/.test(error.message)
  );
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

main().catch((error) => {
  console.error(`[verify-admin-service] ${error.stack || error.message}`);
  process.exitCode = 1;
});
