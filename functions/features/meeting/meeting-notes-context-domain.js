function createMeetingNotesInputDomain(deps) {
  const {
    hasOwn,
    limits,
    normalizeText,
    normalizeTextBlock,
  } = deps;
  const {
    MAX_MEETING_TERM_REPLACEMENTS,
    MAX_MEETING_TERM_REPLACEMENT_FROM_CHARS,
    MAX_MEETING_TERM_REPLACEMENT_TO_CHARS,
    MAX_SHARED_MEMO_CHARS,
  } = limits;

  function normalizeMeetingContext(input) {
    return {
      sharedMemoSnapshot: normalizeTextBlock(input?.sharedMemoSnapshot).slice(0, MAX_SHARED_MEMO_CHARS),
    };
  }

  function normalizeMeetingNotesInputSnapshot(input, fallbackInput) {
    const snapshot = input && typeof input === "object" ? input : {};
    const fallback = fallbackInput && typeof fallbackInput === "object" ? fallbackInput : {};
    const sharedMemo = normalizeTextBlock(
      hasOwn(snapshot, "sharedMemo")
        ? snapshot.sharedMemo
        : fallback.sharedMemo
    ).slice(0, MAX_SHARED_MEMO_CHARS);
    const updatedAt = normalizeText(snapshot.updatedAt || fallback.updatedAt);
    if (!sharedMemo && !updatedAt) {
      return {
        sharedMemo: "",
        updatedAt: "",
      };
    }
    return {
      sharedMemo,
      updatedAt,
    };
  }

  function normalizeMeetingTermReplacement(input) {
    const item = input && typeof input === "object" ? input : {};
    return {
      from: normalizeText(item.from).slice(0, MAX_MEETING_TERM_REPLACEMENT_FROM_CHARS),
      to: normalizeText(item.to).slice(0, MAX_MEETING_TERM_REPLACEMENT_TO_CHARS),
    };
  }

  function normalizeMeetingTermReplacements(input, maxItems = MAX_MEETING_TERM_REPLACEMENTS) {
    const seen = new Set();
    const replacements = [];
    for (const item of Array.isArray(input) ? input : []) {
      const normalized = normalizeMeetingTermReplacement(item);
      const comparisonKey = normalizeText(normalized.from).toLowerCase();
      if (!normalized.from || !normalized.to || seen.has(comparisonKey)) {
        continue;
      }
      seen.add(comparisonKey);
      replacements.push(normalized);
      if (maxItems > 0 && replacements.length >= maxItems) {
        break;
      }
    }
    return replacements;
  }

  return {
    normalizeMeetingContext,
    normalizeMeetingNotesInputSnapshot,
    normalizeMeetingTermReplacements,
  };
}

module.exports = {
  createMeetingNotesInputDomain,
};
