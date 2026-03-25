(function initPromptLibrary(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants.defaults.promptLibrary;

  function mergePromptLibrary(...libraries) {
    const items = [];
    for (const library of libraries) {
      for (const item of library?.items || []) {
        const normalized = normalizePromptItem(item);
        if (normalized) items.push(normalized);
      }
    }
    return { version: defaults.version, items: dedupePromptItemsById(items) };
  }

  function createPromptId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizePromptItem(item) {
    const title = normalizeText(item?.title);
    const content = normalizePromptContent(item?.content);
    if (!title || !content) return null;
    const createdAt = item?.createdAt || new Date().toISOString();
    return {
      id: item?.id || createPromptId(),
      title,
      content,
      createdAt,
      updatedAt: item?.updatedAt || createdAt,
      importedFrom: normalizeImportedFrom(item?.importedFrom),
      storePublication: normalizeStorePublication(item?.storePublication),
    };
  }

  function normalizePromptContent(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
  }

  function buildPromptItem(input, previousItem) {
    return normalizePromptItem({
      ...(previousItem || {}),
      ...input,
      id: input?.id || previousItem?.id,
      createdAt: previousItem?.createdAt || input?.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }

  function upsertPromptItem(library, input) {
    const current = mergePromptLibrary(library);
    const previousIndex = current.items.findIndex((item) => item.id === input?.id);
    const previousItem = previousIndex >= 0 ? current.items[previousIndex] : null;
    const nextItem = buildPromptItem(input, previousItem);
    if (!nextItem) return current;
    const nextItems = current.items.filter((item) => item.id !== nextItem.id);
    if (previousIndex >= 0) nextItems.splice(previousIndex, 0, nextItem);
    else nextItems.unshift(nextItem);
    return mergePromptLibrary({ items: nextItems });
  }

  function movePromptItem(library, dragPromptId, targetPromptId, placement = "before") {
    const current = mergePromptLibrary(library);
    const dragIndex = current.items.findIndex((item) => item.id === dragPromptId);
    const targetIndex = current.items.findIndex((item) => item.id === targetPromptId);
    if (dragIndex === -1 || targetIndex === -1 || dragPromptId === targetPromptId) return current;
    const nextItems = current.items.map(clonePromptItem);
    const [dragItem] = nextItems.splice(dragIndex, 1);
    const adjustedTargetIndex = nextItems.findIndex((item) => item.id === targetPromptId);
    const insertIndex = placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    nextItems.splice(Math.max(0, insertIndex), 0, dragItem);
    return mergePromptLibrary({ items: nextItems });
  }

  function removePromptItem(library, promptId) {
    return mergePromptLibrary({ items: mergePromptLibrary(library).items.filter((item) => item.id !== promptId) });
  }

  function markPromptPublished(library, promptId, publication) {
    return updatePromptItem(library, promptId, (item) => ({ ...item, storePublication: normalizeStorePublication(publication) }));
  }

  function clearPromptPublication(library, promptId) {
    return updatePromptItem(library, promptId, (item) => ({ ...item, storePublication: null }));
  }

  function importStoreEntry(library, storeEntry) {
    const current = mergePromptLibrary(library);
    const nextItem = buildPromptItem({
      title: storeEntry?.title,
      content: storeEntry?.content,
      importedFrom: {
        source: "store",
        entryId: storeEntry?.entryId,
        categoryId: storeEntry?.categoryId,
        authorName: storeEntry?.owner?.displayName,
        importedAt: new Date().toISOString(),
      },
    });
    return nextItem ? mergePromptLibrary({ items: [nextItem, ...current.items] }) : current;
  }

  function buildExportPayload(library) {
    return {
      version: defaults.version,
      libraryName: "i-Nova 자주 쓰는 요청",
      exportedAt: new Date().toISOString(),
      items: mergePromptLibrary(library).items,
    };
  }

  function parseImportText(text) {
    const parsed = JSON.parse(String(text || ""));
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(items)) throw new Error("가져오기 파일에 items 배열이 없어요.");
    return {
      version: defaults.version,
      libraryName: normalizeText(parsed?.libraryName || "가져온 요청"),
      items: dedupePromptItemsById(items),
    };
  }

  function previewImport(currentLibrary, payload, mode) {
    return inspectImport(currentLibrary, payload, mode).summary;
  }

  function applyImport(currentLibrary, payload, mode) {
    const result = inspectImport(currentLibrary, payload, mode);
    return { library: mergePromptLibrary({ items: result.items }), summary: result.summary };
  }

  function inspectImport(currentLibrary, payload, mode) {
    const current = mergePromptLibrary(currentLibrary);
    const incomingItems = dedupePromptItemsById(payload?.items || []);
    const nextItems = mode === "replace" ? [] : current.items.map(clonePromptItem);
    const indexes = buildPromptIndexes(nextItems);
    const summary = {
      mode,
      incoming: incomingItems.length,
      added: 0,
      updated: 0,
      skipped: 0,
      removed: mode === "replace" ? current.items.length : 0,
      libraryName: payload?.libraryName || "",
    };
    let insertOffset = 0;

    for (const item of incomingItems) {
      const matchIndex = indexes.byId.get(item.id) ?? indexes.byFingerprint.get(getPromptFingerprint(item));
      if (mode === "add") {
        if (matchIndex != null) summary.skipped += 1;
        else insertIncoming(nextItems, indexes, item, insertOffset++, summary);
        continue;
      }
      if (mode === "merge") {
        if (matchIndex == null) {
          insertIncoming(nextItems, indexes, item, insertOffset++, summary);
          continue;
        }
        const existing = nextItems[matchIndex];
        if (isSamePrompt(existing, item)) {
          summary.skipped += 1;
          continue;
        }
        nextItems[matchIndex] = {
          ...clonePromptItem(item),
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        };
        rebuildPromptIndexes(indexes, nextItems);
        summary.updated += 1;
        continue;
      }
      nextItems.push(clonePromptItem(item));
      summary.added += 1;
    }

    return { items: mode === "replace" ? incomingItems.map(clonePromptItem) : nextItems, summary };
  }

  function insertIncoming(nextItems, indexes, item, insertIndex, summary) {
    nextItems.splice(insertIndex, 0, clonePromptItem(item));
    rebuildPromptIndexes(indexes, nextItems);
    summary.added += 1;
  }

  function buildPromptIndexes(items) {
    const indexes = { byId: new Map(), byFingerprint: new Map() };
    rebuildPromptIndexes(indexes, items);
    return indexes;
  }

  function rebuildPromptIndexes(indexes, items) {
    indexes.byId.clear();
    indexes.byFingerprint.clear();
    items.forEach((item, index) => {
      indexes.byId.set(item.id, index);
      indexes.byFingerprint.set(getPromptFingerprint(item), index);
    });
  }

  function dedupePromptItemsById(items) {
    const unique = [];
    const seenIds = new Set();
    for (const rawItem of items) {
      const item = normalizePromptItem(rawItem);
      if (!item) continue;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      unique.push(item);
    }
    return unique;
  }

  function updatePromptItem(library, promptId, mapper) {
    const current = mergePromptLibrary(library);
    return mergePromptLibrary({ items: current.items.map((item) => (item.id === promptId ? mapper(item) : item)) });
  }

  function clonePromptItem(item) {
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      importedFrom: normalizeImportedFrom(item.importedFrom),
      storePublication: normalizeStorePublication(item.storePublication),
    };
  }

  function getPromptFingerprint(item) {
    return [normalizeText(item?.title).toLowerCase(), normalizePromptContent(item?.content).toLowerCase()].join("::");
  }

  function isSamePrompt(a, b) {
    return a?.title === b?.title && a?.content === b?.content;
  }

  function normalizeImportedFrom(importedFrom) {
    const entryId = normalizeText(importedFrom?.entryId);
    if (!entryId) return null;
    return {
      authorName: normalizeText(importedFrom?.authorName),
      categoryId: normalizeText(importedFrom?.categoryId),
      entryId,
      importedAt: importedFrom?.importedAt || new Date().toISOString(),
      source: normalizeText(importedFrom?.source || "store") || "store",
    };
  }

  function normalizeStorePublication(storePublication) {
    const entryId = normalizeText(storePublication?.entryId);
    if (!entryId) return null;
    return {
      categoryId: normalizeText(storePublication?.categoryId),
      categoryLabel: normalizeText(storePublication?.categoryLabel),
      entryId,
      publishedAt: storePublication?.publishedAt || new Date().toISOString(),
    };
  }

  function normalizeText(text) {
    return namespace.session.normalizeText(text || "");
  }

  namespace.promptLibrary = {
    applyImport,
    buildExportPayload,
    buildPromptItem,
    clearPromptPublication,
    importStoreEntry,
    markPromptPublished,
    mergePromptLibrary,
    movePromptItem,
    parseImportText,
    previewImport,
    removePromptItem,
    upsertPromptItem,
  };
})(globalThis);
