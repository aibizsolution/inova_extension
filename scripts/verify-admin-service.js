#!/usr/bin/env node

const assert = require("assert");
const { createAdminDomain } = require("../functions/features/admin/admin-service");

async function main() {
  await verifyConfigAllowlistAccess();
  await verifyFirestoreAdminAccessAndSessionFlow();
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
