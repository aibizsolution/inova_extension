(function initMeetingFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { cloneValue, normalizeText } = namespace.panelUtils;
  const READER = "meeting";

  const client = namespace.baseFirestoreClient?.createBaseFirestoreClient?.({
    asyncErrorMessage: "회의 목록 Firestore 처리를 마치지 못했어요.",
    authErrorMessage: "회의 목록 Firestore 인증 정보를 준비하지 못했어요.",
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
        .collection("integration_inova_meetings")
        .where("owner.providerUserKey", "==", panelAuth.providerUserKey)
        .orderBy("updatedAt", "desc")
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
    subscriptionErrorMessage: "회의 목록 Firestore 구독이 끊겼어요.",
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
      throw new Error("회의 목록 Firestore 인증 정보를 준비하지 못했어요.");
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
    const share = normalizeShareMetadata(data?.share);
    return {
      ...cloneValue(data),
      docId: normalizeText(doc?.id),
      share,
    };
  }

  function normalizeShareMetadata(input) {
    const share = input && typeof input === "object" ? input : {};
    const status = normalizeText(share.status);
    const shareId = normalizeText(share.shareId);
    return {
      ...cloneValue(share),
      active: status === "active" && Boolean(shareId),
      createdAt: normalizeText(share.createdAt),
      createdBy: share.createdBy && typeof share.createdBy === "object" ? cloneValue(share.createdBy) : {},
      revokedAt: normalizeText(share.revokedAt),
      shareId,
      status,
    };
  }

  function buildSnapshotSignature(snapshot) {
    return JSON.stringify({
      docs: (Array.isArray(snapshot?.items) ? snapshot.items : []).map((item) => [
        normalizeText(item?.meetingId),
        normalizeText(item?.updatedAt || item?.createdAt),
        normalizeText(item?.status),
        normalizeText(item?.share?.status),
        normalizeText(item?.share?.shareId),
        normalizeText(item?.share?.revokedAt),
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

  namespace.meetingFirestoreClient = { create: client.create };
})(globalThis);
