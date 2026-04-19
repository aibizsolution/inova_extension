(function initPanelNoticeSignalFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText } = namespace.panelUtils;
  const SIGNAL_COLLECTION = "ops_panel_notice_signals";
  const SIGNAL_DOC_ID = "current";
  const READER = "panel-notice-signal";

  const client = namespace.baseFirestoreClient?.createBaseFirestoreClient?.({
    asyncErrorMessage: "소식 변경 신호 처리를 마치지 못했어요.",
    authErrorMessage: "소식 변경 신호 인증 정보를 준비하지 못했어요.",
    buildListenTrace(panelAuth) {
      return {
        collection: SIGNAL_COLLECTION,
        docId: SIGNAL_DOC_ID,
        scope: panelAuth.panelScope,
      };
    },
    buildSnapshotSignature(snapshot) {
      return JSON.stringify({
        exists: Boolean(snapshot?.exists),
        revision: normalizeText(snapshot?.revision),
        updatedAt: normalizeText(snapshot?.updatedAt),
      });
    },
    buildSubscriptionKey(panelAuth) {
      return [
        buildRuntimeKey(panelAuth),
        panelAuth.providerUserKey,
        panelAuth.panelScope,
        panelAuth.expiresAt,
        SIGNAL_COLLECTION,
        SIGNAL_DOC_ID,
      ].join("::");
    },
    createTarget({ session }) {
      return session.db.collection(SIGNAL_COLLECTION).doc(SIGNAL_DOC_ID);
    },
    missingIdentityMessage: "소식 변경 신호 사용자 정보를 찾지 못했어요.",
    normalizePanelAuth,
    normalizeSnapshot,
    panel: "prompt",
    reader: READER,
    readSnapshotCount(snapshot) {
      return snapshot?.exists ? 1 : 0;
    },
    resetSubscriptionOnError: true,
    subscriptionErrorMessage: "소식 변경 신호 Firestore 구독이 끊겼어요.",
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
      panelScope: normalizeText(panelAuth.panelScope || panelAuth.promptPanelScope) || "prompt-panel-v2",
      providerUserKey: normalizeText(panelAuth.providerUserKey),
      target: normalizeText(panelAuth.target).toLowerCase() === "local" ? "local" : "production",
    };
    if (!normalized.providerUserKey || !normalized.firebaseCustomToken || !normalized.firebaseConfig.projectId) {
      throw new Error("소식 변경 신호 인증 정보를 준비하지 못했어요.");
    }
    return normalized;
  }

  function normalizeSnapshot(snapshot) {
    const exists = Boolean(snapshot?.exists);
    const data = exists && typeof snapshot?.data === "function" ? snapshot.data() || {} : {};
    return {
      exists,
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
      reason: normalizeText(data.reason),
      revision: normalizeText(data.revision || data.updatedAt),
      updatedAt: normalizeText(data.updatedAt),
    };
  }

  function buildRuntimeKey(panelAuth) {
    return JSON.stringify({
      authUrl: normalizeText(panelAuth?.emulators?.authUrl),
      enabled: Boolean(panelAuth?.emulators?.enabled),
      firestoreHost: normalizeText(panelAuth?.emulators?.firestoreHost),
      firestorePort: Number(panelAuth?.emulators?.firestorePort) || 0,
      projectId: normalizeText(panelAuth?.firebaseConfig?.projectId),
      scope: normalizeText(panelAuth?.panelScope),
      target: normalizeText(panelAuth?.target),
    });
  }

  namespace.panelNoticeSignalFirestoreClient = { create: client.create };
})(globalThis);
