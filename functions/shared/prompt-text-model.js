(function initPromptTextModel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function normalizePromptContent(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function createPromptId() {
    if (global.crypto?.randomUUID) {
      return global.crypto.randomUUID();
    }
    return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  namespace.promptTextModel = {
    createPromptId,
    normalizePromptContent,
  };
})(globalThis);
