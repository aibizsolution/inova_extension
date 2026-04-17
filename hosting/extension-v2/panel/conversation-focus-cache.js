(function initConversationFocusCache(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const FOCUS_CACHE_MAX_ENTRIES = 80;
  const FOCUS_CACHE_STORAGE_KEY = "inova.conversationFocus.v1";

  function create(options = {}) {
    const storage = options.storage || global.localStorage || null;
    return {
      readSignal,
      writeSignal,
    };

    function readSignal(key) {
      const normalizedKey = normalizeText(key);
      if (!normalizedKey) {
        return null;
      }
      const cache = readCache();
      const entry = cache[normalizedKey];
      if (!entry?.signal || typeof entry.signal !== "object") {
        return null;
      }
      return {
        ...entry.signal,
        cached: true,
        key: normalizedKey,
      };
    }

    function writeSignal(signal) {
      const normalizedSignal = normalizeSignal(signal);
      if (!normalizedSignal.key || !["split", "steady"].includes(normalizedSignal.status)) {
        return false;
      }
      const cache = readCache();
      cache[normalizedSignal.key] = {
        cachedAt: Date.now(),
        signal: {
          confidence: normalizedSignal.confidence,
          reasonCodes: normalizedSignal.reasonCodes,
          status: normalizedSignal.status,
          tooltip: normalizedSignal.tooltip,
          userMessageCount: normalizedSignal.userMessageCount,
        },
      };
      return writeCache(pruneCache(cache));
    }

    function readCache() {
      try {
        const raw = storage?.getItem?.(FOCUS_CACHE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }

    function writeCache(cache) {
      try {
        storage?.setItem?.(FOCUS_CACHE_STORAGE_KEY, JSON.stringify(cache && typeof cache === "object" ? cache : {}));
        return true;
      } catch {
        return false;
      }
    }
  }

  function normalizeSignal(signal) {
    const raw = signal && typeof signal === "object" ? signal : {};
    return {
      confidence: readRatio(raw.confidence),
      key: normalizeText(raw.key),
      reasonCodes: Array.isArray(raw.reasonCodes)
        ? raw.reasonCodes.map((code) => normalizeText(code)).filter(Boolean).slice(0, 4)
        : [],
      status: normalizeStatus(raw.status),
      tooltip: normalizeText(raw.tooltip),
      userMessageCount: Math.max(0, Number(raw.userMessageCount) || 0),
    };
  }

  function pruneCache(cache) {
    const entries = Object.entries(cache && typeof cache === "object" ? cache : {})
      .filter(([, entry]) => entry?.signal && typeof entry.signal === "object")
      .sort((left, right) => (Number(right[1]?.cachedAt) || 0) - (Number(left[1]?.cachedAt) || 0))
      .slice(0, FOCUS_CACHE_MAX_ENTRIES);
    return Object.fromEntries(entries);
  }

  function normalizeStatus(status) {
    const normalized = normalizeText(status).toLowerCase();
    return ["split", "steady"].includes(normalized) ? normalized : "";
  }

  function readRatio(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.min(1, Math.round(number * 1000) / 1000));
  }

  function normalizeText(value) {
    if (typeof namespace.session?.normalizeText === "function") {
      return namespace.session.normalizeText(value);
    }
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  namespace.conversationFocusCache = { create };
})(globalThis);
