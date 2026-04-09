function createMeetingNotesContextDomain(deps) {
  const {
    crypto,
    dedupeMeetingItems,
    hasOwn,
    limits,
    normalizeMeetingComparisonText,
    normalizeText,
    normalizeTextBlock,
  } = deps;
  const {
    MAX_NOTES_CONTEXT_ITEMS,
    MAX_NOTES_CONTEXT_ITEM_CHARS,
    MAX_SHARED_MEMO_CHARS,
  } = limits;

  function normalizeMeetingContext(input) {
    return {
      notesContextItems: normalizeMeetingNotesContextItems(input?.notesContextItems),
      sharedMemoSnapshot: normalizeTextBlock(input?.sharedMemoSnapshot).slice(0, MAX_SHARED_MEMO_CHARS),
    };
  }

  function normalizeMeetingNotesInputSnapshot(input, fallbackInput) {
    const snapshot = input && typeof input === "object" ? input : {};
    const fallback = fallbackInput && typeof fallbackInput === "object" ? fallbackInput : {};
    const hasExplicitContextItems = hasOwn(snapshot, "contextItems");
    const sharedMemo = normalizeTextBlock(
      hasOwn(snapshot, "sharedMemo")
        ? snapshot.sharedMemo
        : fallback.sharedMemo
    ).slice(0, MAX_SHARED_MEMO_CHARS);
    const contextItems = normalizeMeetingNotesContextItems(
      hasExplicitContextItems
        ? snapshot.contextItems
        : fallback.contextItems
    );
    const updatedAt = normalizeText(snapshot.updatedAt || fallback.updatedAt);
    if (!sharedMemo && !contextItems.length && !updatedAt) {
      return {
        contextItems: [],
        sharedMemo: "",
        updatedAt: "",
      };
    }
    return {
      contextItems,
      sharedMemo,
      updatedAt,
    };
  }

  function normalizeMeetingNotesContextItem(input) {
    const item = input && typeof input === "object" ? input : {};
    return {
      contextId: normalizeText(item.contextId || item.id).slice(0, 160),
      createdAt: normalizeText(item.createdAt),
      text: normalizeTextBlock(item.text || item.context || item.value).slice(0, MAX_NOTES_CONTEXT_ITEM_CHARS),
      updatedAt: normalizeText(item.updatedAt || item.createdAt),
    };
  }

  function normalizeMeetingNotesContextItems(input, maxItems = MAX_NOTES_CONTEXT_ITEMS) {
    const normalized = (Array.isArray(input) ? input : [])
      .map(normalizeMeetingNotesContextItem)
      .filter((item) => item.text);
    return dedupeMeetingItems(
      normalized,
      (item) => normalizeMeetingComparisonText(item.text),
      maxItems
    );
  }

  function mergePersistedMeetingNotesContextItems(previousItems, nextItems, updatedAtInput) {
    const updatedAt = normalizeText(updatedAtInput) || new Date().toISOString();
    const previousMap = new Map(
      normalizeMeetingNotesContextItems(previousItems).map((item) => [normalizeText(item.contextId), item])
    );
    return normalizeMeetingNotesContextItems(nextItems).map((item) => {
      const contextId = normalizeText(item.contextId) || crypto.randomUUID();
      const previous = previousMap.get(contextId);
      const createdAt = normalizeText(previous?.createdAt || item.createdAt || updatedAt);
      return {
        contextId,
        createdAt,
        text: item.text,
        updatedAt: normalizeText(item.updatedAt || updatedAt),
      };
    });
  }

  return {
    mergePersistedMeetingNotesContextItems,
    normalizeMeetingContext,
    normalizeMeetingNotesContextItems,
    normalizeMeetingNotesInputSnapshot,
  };
}

module.exports = {
  createMeetingNotesContextDomain,
};
