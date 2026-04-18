(function initMeetingUsageFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { cloneValue, normalizeText } = namespace.panelUtils;
  const READER = "meeting-usage";
  const USER_MONTH_COLLECTION = "integration_inova_meeting_usage_user_months";
  const USER_TOTAL_COLLECTION = "integration_inova_meeting_usage_user_totals";

  const client = namespace.baseFirestoreClient?.createBaseFirestoreClient?.({
    asyncErrorMessage: "회의 사용량 Firestore 처리를 마치지 못했어요.",
    authErrorMessage: "회의 사용량 Firestore 인증 정보를 준비하지 못했어요.",
    buildListenTrace(_panelAuth, context) {
      return {
        monthKey: context.monthKey,
      };
    },
    buildRequestContext({ providerIdentity, providerUserKey, request, target }) {
      const monthKey = normalizeMonthKey(request?.monthKey || formatMonthKey(new Date()));
      return {
        monthKey,
        providerIdentity,
        providerUserKey,
        target,
      };
    },
    buildSnapshotSignature,
    buildSubscriptionKey,
    createTarget({ context, panelAuth, session }) {
      const monthRef = session.db
        .collection(USER_MONTH_COLLECTION)
        .doc(buildUserMonthDocId(panelAuth.providerUserKey, context.monthKey));
      const totalRef = session.db
        .collection(USER_TOTAL_COLLECTION)
        .doc(panelAuth.providerUserKey);
      return createUsageDocsTarget(monthRef, totalRef);
    },
    missingIdentityMessage: "회의 사용자 정보를 찾지 못했어요.",
    normalizePanelAuth,
    normalizeSnapshot: normalizeUsageSnapshot,
    panel: "meeting",
    reader: READER,
    readSnapshotCount() {
      return 2;
    },
    resetSubscriptionOnError: true,
    shouldUseCachedSnapshot(snapshot) {
      return Array.isArray(snapshot?.docs) && snapshot.docs.length === 2;
    },
    subscriptionErrorMessage: "회의 사용량 Firestore 구독이 끊겼어요.",
  });

  function createUsageDocsTarget(monthRef, totalRef) {
    return {
      async get(options = {}) {
        const docs = await Promise.all([
          monthRef.get(options),
          totalRef.get(options),
        ]);
        return buildCombinedSnapshot(docs);
      },
      onSnapshot(options, next, error) {
        const snapshots = [null, null];
        const emitIfReady = () => {
          if (!snapshots[0] || !snapshots[1]) {
            return;
          }
          next(buildCombinedSnapshot(snapshots));
        };
        const unsubscribeMonth = monthRef.onSnapshot(
          options,
          (snapshot) => {
            snapshots[0] = snapshot;
            emitIfReady();
          },
          error
        );
        const unsubscribeTotal = totalRef.onSnapshot(
          options,
          (snapshot) => {
            snapshots[1] = snapshot;
            emitIfReady();
          },
          error
        );
        return () => {
          if (typeof unsubscribeMonth === "function") {
            unsubscribeMonth();
          }
          if (typeof unsubscribeTotal === "function") {
            unsubscribeTotal();
          }
        };
      },
    };
  }

  function buildCombinedSnapshot(docs) {
    const safeDocs = Array.isArray(docs) ? docs : [];
    return {
      docs: safeDocs,
      metadata: {
        fromCache: safeDocs.some((doc) => Boolean(doc?.metadata?.fromCache)),
        hasPendingWrites: safeDocs.some((doc) => Boolean(doc?.metadata?.hasPendingWrites)),
      },
    };
  }

  function normalizeUsageSnapshot(snapshot, { context } = {}) {
    const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
    return {
      checkedAt: new Date().toISOString(),
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
      month: normalizeUsageDocument(docs[0], {
        monthKey: context?.monthKey,
        providerUserKey: context?.providerUserKey,
      }),
      total: normalizeUsageDocument(docs[1], {
        providerUserKey: context?.providerUserKey,
      }),
    };
  }

  function normalizeUsageDocument(doc, fallback = {}) {
    const data = doc?.exists !== false && typeof doc?.data === "function" ? doc.data() : {};
    const source = data && typeof data === "object" ? data : {};
    return {
      ...cloneValue(source),
      docId: normalizeText(doc?.id),
      firstProcessedAt: normalizeText(source.firstProcessedAt),
      lastProcessedAt: normalizeText(source.lastProcessedAt),
      monthKey: normalizeText(source.monthKey || fallback.monthKey),
      processedCount: Math.max(0, Number(source.processedCount) || 0),
      processedMs: Math.max(0, Number(source.processedMs) || 0),
      providerUserKey: normalizeText(source.providerUserKey || fallback.providerUserKey),
      updatedAt: normalizeText(source.updatedAt),
    };
  }

  function normalizePanelAuth(input) {
    const panelAuth = input && typeof input === "object" ? input : {};
    const firebaseConfig = panelAuth.firebaseConfig && typeof panelAuth.firebaseConfig === "object"
      ? { ...panelAuth.firebaseConfig }
      : {};
    const emulators = panelAuth.emulators && typeof panelAuth.emulators === "object"
      ? { ...panelAuth.emulators }
      : {};
    const normalized = {
      emulators: {
        authUrl: normalizeText(emulators.authUrl),
        enabled: Boolean(emulators.enabled),
        firestoreHost: normalizeText(emulators.firestoreHost),
        firestorePort: Number(emulators.firestorePort) || 0,
      },
      expiresAt: normalizeText(panelAuth.expiresAt),
      firebaseConfig,
      firebaseCustomToken: normalizeText(panelAuth.firebaseCustomToken),
      panelScope: normalizeText(panelAuth.panelScope) || "meeting-panel",
      providerUserKey: normalizeText(panelAuth.providerUserKey),
      target: normalizeText(panelAuth.target).toLowerCase() === "local" ? "local" : "production",
    };
    if (!normalized.providerUserKey || !normalized.firebaseCustomToken || !normalized.firebaseConfig.projectId) {
      throw new Error("회의 사용량 Firestore 인증 정보를 준비하지 못했어요.");
    }
    return normalized;
  }

  function buildSnapshotSignature(snapshot) {
    const month = snapshot?.month || {};
    const total = snapshot?.total || {};
    return JSON.stringify({
      fromCache: Boolean(snapshot?.fromCache),
      hasPendingWrites: Boolean(snapshot?.hasPendingWrites),
      month: [
        normalizeText(month.monthKey),
        Number(month.processedMs) || 0,
        Number(month.processedCount) || 0,
        normalizeText(month.updatedAt),
      ].join("~"),
      total: [
        Number(total.processedMs) || 0,
        Number(total.processedCount) || 0,
        normalizeText(total.updatedAt),
      ].join("~"),
    });
  }

  function buildSubscriptionKey(panelAuth, context) {
    return [
      buildRuntimeKey(panelAuth),
      panelAuth.providerUserKey,
      panelAuth.expiresAt,
      normalizeText(context?.monthKey),
    ].join("::");
  }

  function buildRuntimeKey(panelAuth) {
    return JSON.stringify({
      authUrl: normalizeText(panelAuth?.emulators?.authUrl),
      enabled: Boolean(panelAuth?.emulators?.enabled),
      firestoreHost: normalizeText(panelAuth?.emulators?.firestoreHost),
      firestorePort: Number(panelAuth?.emulators?.firestorePort) || 0,
      projectId: normalizeText(panelAuth?.firebaseConfig?.projectId),
      target: normalizeText(panelAuth?.target),
    });
  }

  function buildUserMonthDocId(providerUserKey, monthKey) {
    return `${normalizeText(providerUserKey)}__${normalizeText(monthKey)}`;
  }

  function normalizeMonthKey(value) {
    const normalized = normalizeText(value);
    return /^\d{4}-\d{2}$/.test(normalized) ? normalized : formatMonthKey(new Date());
  }

  function formatMonthKey(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) {
      return new Date().toISOString().slice(0, 7);
    }
    return value.toISOString().slice(0, 7);
  }

  namespace.meetingUsageFirestoreClient = { create: client.create };
})(globalThis);
