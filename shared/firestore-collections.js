(function initFirestoreCollections(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LEGACY_LANE = "legacy";
  const V2_LANE = "v2";
  const PROMPT_COLLECTIONS_BY_LANE = Object.freeze({
    [LEGACY_LANE]: Object.freeze({
      accountsCollection: "integration_inova_accounts",
      promptLibraryChunksCollection: "prompt_library_chunks",
      promptLibraryOrdersCollection: "prompt_library_orders",
      storeDetailCollection: "prompt_store_entry_details",
      storeEntriesCollection: "prompt_store_entries",
      storeFeedCollection: "prompt_store_feed_pages",
      storeSummaryCollection: "prompt_store_meta",
    }),
    [V2_LANE]: Object.freeze({
      accountsCollection: "integration_inova_accounts_v2",
      promptLibraryChunksCollection: "prompt_library_chunks_v2",
      promptLibraryOrdersCollection: "prompt_library_orders_v2",
      storeDetailCollection: "prompt_store_entry_details",
      storeEntriesCollection: "prompt_store_entries",
      storeFeedCollection: "prompt_store_feed_pages",
      storeSummaryCollection: "prompt_store_meta",
    }),
  });

  function getPromptFirestoreCollections(lane = LEGACY_LANE) {
    return cloneValue(PROMPT_COLLECTIONS_BY_LANE[normalizeLane(lane)] || PROMPT_COLLECTIONS_BY_LANE[LEGACY_LANE]);
  }

  function normalizePromptFirestoreCollections(input = {}, fallbackLane = LEGACY_LANE) {
    const source = input && typeof input === "object" ? input : {};
    const fallback = getPromptFirestoreCollections(fallbackLane);
    return {
      accountsCollection: trimString(source.accountsCollection) || fallback.accountsCollection,
      promptLibraryChunksCollection: trimString(source.promptLibraryChunksCollection) || fallback.promptLibraryChunksCollection,
      promptLibraryOrdersCollection: trimString(source.promptLibraryOrdersCollection) || fallback.promptLibraryOrdersCollection,
      storeDetailCollection: trimString(source.storeDetailCollection) || fallback.storeDetailCollection,
      storeEntriesCollection: trimString(source.storeEntriesCollection) || fallback.storeEntriesCollection,
      storeFeedCollection: trimString(source.storeFeedCollection) || fallback.storeFeedCollection,
      storeSummaryCollection: trimString(source.storeSummaryCollection) || fallback.storeSummaryCollection,
    };
  }

  function normalizeLane(value) {
    return trimString(value).toLowerCase() === V2_LANE ? V2_LANE : LEGACY_LANE;
  }

  function trimString(value) {
    return String(value || "").trim();
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.firestoreCollections = Object.freeze({
    getPromptFirestoreCollections,
    normalizePromptFirestoreCollections,
  });
})(globalThis);
