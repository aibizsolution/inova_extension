(function initMeetingPanelBridge(global) {
  const ALLOWED_PARENT_ORIGINS = new Set(["https://inova.incross.com"]);
  const PORT_CONNECT_SOURCE = "inova-meeting-panel-client";
  let app = null;
  let auth = null;
  let db = null;
  let port = null;
  let unsubscribeMeetings = null;
  let currentRequestId = 0;

  global.addEventListener("message", handleWindowMessage);

  function handleWindowMessage(event) {
    if (!ALLOWED_PARENT_ORIGINS.has(String(event.origin || ""))) {
      return;
    }
    const data = event.data && typeof event.data === "object" ? event.data : null;
    if (!data || data.source !== PORT_CONNECT_SOURCE || data.type !== "connect-port") {
      return;
    }
    const [nextPort] = Array.isArray(event.ports) ? event.ports : [];
    if (!nextPort) {
      return;
    }
    if (port) {
      try {
        port.close();
      } catch {}
    }
    port = nextPort;
    port.onmessage = handlePortMessage;
    port.start?.();
    sendMessage("ready", {});
  }

  async function handlePortMessage(event) {
    const data = event?.data && typeof event.data === "object" ? event.data : null;
    if (!data || !data.type) {
      return;
    }
    if (data.type === "disconnect") {
      disconnect();
      sendMessage("disconnected", {});
      return;
    }
    if (data.type !== "init") {
      return;
    }

    const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    currentRequestId = Math.max(0, Number(data.requestId) || Date.now());
    try {
      await connect(payload);
      sendMessage("connected", {
        expiresAt: normalizeText(payload.expiresAt),
        providerUserKey: normalizeText(payload.providerUserKey),
        requestId: currentRequestId,
      });
    } catch (error) {
      sendMessage("error", {
        error: normalizeText(error?.message) || "패널 Firestore 연결에 실패했어요.",
        requestId: currentRequestId,
      });
    }
  }

  async function connect(payload) {
    const firebaseConfig = payload.firebaseConfig && typeof payload.firebaseConfig === "object"
      ? payload.firebaseConfig
      : {};
    const providerUserKey = normalizeText(payload.providerUserKey);
    const firebaseCustomToken = normalizeText(payload.firebaseCustomToken);
    const queryLimit = Math.max(1, Math.min(24, Number(payload.queryLimit) || 24));
    if (!providerUserKey || !firebaseCustomToken || !firebaseConfig.projectId) {
      throw new Error("패널 Firestore 연결 정보가 비어 있어요.");
    }

    if (!app) {
      app = global.firebase.initializeApp(firebaseConfig, "meeting-panel-bridge");
      auth = app.auth();
      db = app.firestore();
      await auth.setPersistence(global.firebase.auth.Auth.Persistence.NONE);
    }

    const currentToken = normalizeText(await auth.currentUser?.getIdToken?.().catch(() => ""));
    if (!currentToken || !auth.currentUser) {
      await auth.signInWithCustomToken(firebaseCustomToken);
    } else {
      try {
        await auth.currentUser.getIdToken(true);
      } catch {
        await auth.signInWithCustomToken(firebaseCustomToken);
      }
    }

    disconnect();
    unsubscribeMeetings = db
      .collection("integration_inova_meetings")
      .where("owner.providerUserKey", "==", providerUserKey)
      .orderBy("updatedAt", "desc")
      .limit(queryLimit)
      .onSnapshot(
        (snapshot) => {
          sendMessage("snapshot", {
            checkedAt: new Date().toISOString(),
            fromCache: Boolean(snapshot?.metadata?.fromCache),
            hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
            items: (Array.isArray(snapshot?.docs) ? snapshot.docs : []).map(serializeDocument),
            requestId: currentRequestId,
          });
        },
        (error) => {
          sendMessage("error", {
            error: normalizeText(error?.message) || "패널 Firestore 구독이 끊겼어요.",
            requestId: currentRequestId,
          });
        }
      );
  }

  function disconnect() {
    if (typeof unsubscribeMeetings === "function") {
      unsubscribeMeetings();
    }
    unsubscribeMeetings = null;
  }

  function serializeDocument(doc) {
    const data = doc?.data && typeof doc.data === "function" ? doc.data() : {};
    return {
      ...cloneJson(data),
      docId: normalizeText(doc?.id),
    };
  }

  function sendMessage(type, payload) {
    if (!port) {
      return;
    }
    port.postMessage({
      payload: payload && typeof payload === "object" ? payload : {},
      type: normalizeText(type),
    });
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value || {}));
    } catch {
      return {};
    }
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }
})(globalThis);
