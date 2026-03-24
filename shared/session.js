(function initSession(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const constants = namespace.constants;

  function getCurrentUrl(rawUrl) {
    try {
      return new URL(rawUrl || global.location.href);
    } catch {
      return null;
    }
  }

  function getSessionId(rawUrl) {
    const current = getCurrentUrl(rawUrl);
    return current?.searchParams.get("sid") || "";
  }

  function isChatSession(rawUrl) {
    return Boolean(getSessionId(rawUrl));
  }

  function normalizeText(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function hashText(text) {
    let hash = 0;
    for (const char of text) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash.toString(36);
  }

  function buildMessageId(sessionId, order, text) {
    const normalized = normalizeText(text);
    return [sessionId, order, hashText(normalized)].join(":");
  }

  function buildBookmarkRecord({ sessionId, order, text, title }) {
    const normalizedText = normalizeText(text);
    return {
      id: buildMessageId(sessionId, order, normalizedText),
      order,
      text: normalizedText,
      normalizedText: normalizedText.toLowerCase(),
      createdAt: new Date().toISOString(),
      title: title || "",
    };
  }

  function formatSessionLabel(sessionId) {
    return sessionId ? `대화 ${sessionId.slice(0, 8)}` : "현재 대화";
  }

  function clipPreview(text) {
    const normalized = normalizeText(text);
    if (normalized.length <= constants.limits.queryPreviewLength) {
      return normalized;
    }
    return `${normalized.slice(0, constants.limits.queryPreviewLength - 1)}…`;
  }

  namespace.session = {
    buildBookmarkRecord,
    buildMessageId,
    clipPreview,
    formatSessionLabel,
    getCurrentUrl,
    getSessionId,
    isChatSession,
    normalizeText,
  };
})(globalThis);
