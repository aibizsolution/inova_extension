(function initMeetingParticipationFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { cloneValue, normalizeText } = namespace.panelUtils;
  const PARTICIPATION_COLLECTION = "integration_inova_meeting_participations";
  const READER = "meeting-participation";

  const client = namespace.baseFirestoreClient?.createBaseFirestoreClient?.({
    asyncErrorMessage: "참여 회의룸 Firestore 처리를 마치지 못했어요.",
    authErrorMessage: "참여 회의룸 Firestore 인증 정보를 준비하지 못했어요.",
    buildListenTrace(_panelAuth, context) {
      return {
        limit: context.queryLimit,
      };
    },
    buildRequestContext({ providerIdentity, providerUserKey, request, target }) {
      return {
        providerIdentity,
        providerUserKey,
        queryLimit: Math.max(1, Math.min(24, Number(request?.queryLimit) || 24)),
        target,
      };
    },
    buildSnapshotSignature,
    buildSubscriptionKey,
    createTarget({ context, panelAuth, session }) {
      return session.db
        .collection(PARTICIPATION_COLLECTION)
        .where("viewer.providerUserKey", "==", panelAuth.providerUserKey)
        .where("hidden", "==", false)
        .orderBy("lastRefreshAt", "desc")
        .limit(context.queryLimit);
    },
    missingIdentityMessage: "회의 사용자 정보를 찾지 못했어요.",
    normalizePanelAuth,
    normalizeSnapshot: normalizeQuerySnapshot,
    panel: "meeting",
    reader: READER,
    readSnapshotCount(snapshot) {
      return Array.isArray(snapshot?.items) ? snapshot.items.length : 0;
    },
    resetSubscriptionOnError: true,
    shouldUseCachedSnapshot(snapshot) {
      const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
      return docs.length > 0;
    },
    subscriptionErrorMessage: "참여 회의룸 Firestore 구독이 끊겼어요.",
  });

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
      throw new Error("참여 회의룸 Firestore 인증 정보를 준비하지 못했어요.");
    }
    return normalized;
  }

  function normalizeQuerySnapshot(snapshot) {
    return {
      checkedAt: new Date().toISOString(),
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
      items: (Array.isArray(snapshot?.docs) ? snapshot.docs : []).map(serializeDocument),
    };
  }

  function serializeDocument(doc) {
    const data = doc?.data && typeof doc.data === "function" ? doc.data() : {};
    return {
      ...cloneValue(data),
      docId: normalizeText(doc?.id),
      participationId: normalizeText(data?.participationId || doc?.id),
    };
  }

  function buildSnapshotSignature(snapshot) {
    return JSON.stringify({
      docs: (Array.isArray(snapshot?.items) ? snapshot.items : []).map((item) => [
        normalizeText(item?.participationId || item?.docId),
        normalizeText(item?.meetingId),
        normalizeText(item?.lastRefreshAt || item?.updatedAt),
        normalizeText(item?.accessState),
        normalizeText(item?.titleSnapshotHash),
        Boolean(item?.hidden),
      ].join("~")),
      fromCache: Boolean(snapshot?.fromCache),
      hasPendingWrites: Boolean(snapshot?.hasPendingWrites),
    });
  }

  function buildSubscriptionKey(panelAuth, context) {
    return [
      buildRuntimeKey(panelAuth),
      panelAuth.providerUserKey,
      panelAuth.expiresAt,
      String(context.queryLimit),
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

  namespace.meetingParticipationFirestoreClient = { create: client.create };
})(globalThis);
