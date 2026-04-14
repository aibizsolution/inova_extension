(function initPromptLibraryModel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

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

  function normalizeImportedFrom(importedFrom) {
    const entryId = normalizeText(importedFrom?.entryId);
    if (!entryId) {
      return null;
    }
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
    if (!entryId) {
      return null;
    }
    return {
      categoryId: normalizeText(storePublication?.categoryId),
      categoryLabel: normalizeText(storePublication?.categoryLabel),
      entryId,
      publishedAt: storePublication?.publishedAt || new Date().toISOString(),
    };
  }

  function normalizePromptItem(item) {
    const title = normalizeText(item?.title);
    const content = normalizePromptContent(item?.content);
    if (!title || !content) {
      return null;
    }
    const createdAt = item?.createdAt || new Date().toISOString();
    return {
      content,
      createdAt,
      id: normalizeText(item?.id) || createPromptId(),
      importedFrom: normalizeImportedFrom(item?.importedFrom),
      storePublication: normalizeStorePublication(item?.storePublication),
      title,
      updatedAt: item?.updatedAt || createdAt,
    };
  }

  function clonePromptItem(item) {
    const normalized = normalizePromptItem(item);
    if (!normalized) {
      return null;
    }
    return {
      content: normalized.content,
      createdAt: normalized.createdAt,
      id: normalized.id,
      importedFrom: normalizeImportedFrom(normalized.importedFrom),
      storePublication: normalizeStorePublication(normalized.storePublication),
      title: normalized.title,
      updatedAt: normalized.updatedAt,
    };
  }

  function dedupePromptItemsById(items) {
    const unique = [];
    const seenIds = new Set();
    for (const rawItem of items || []) {
      const item = normalizePromptItem(rawItem);
      if (!item || seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);
      unique.push(item);
    }
    return unique;
  }

  function mergePromptLibrary(...libraries) {
    const items = [];
    for (const library of libraries) {
      for (const item of library?.items || []) {
        const normalized = normalizePromptItem(item);
        if (normalized) {
          items.push(normalized);
        }
      }
    }
    return {
      items: dedupePromptItemsById(items),
      version: Math.max(1, Number(libraries.at(-1)?.version) || 1),
    };
  }

  function buildPromptItem(input, previousItem) {
    return normalizePromptItem({
      ...(previousItem || {}),
      ...(input || {}),
      createdAt: previousItem?.createdAt || input?.createdAt,
      id: input?.id || previousItem?.id,
      updatedAt: new Date().toISOString(),
    });
  }

  function upsertPromptItem(library, input) {
    const current = mergePromptLibrary(library);
    const previousIndex = current.items.findIndex((item) => item.id === input?.id);
    const previousItem = previousIndex >= 0 ? current.items[previousIndex] : null;
    const nextItem = buildPromptItem(input, previousItem);
    if (!nextItem) {
      return current;
    }
    const nextItems = current.items.filter((item) => item.id !== nextItem.id);
    if (previousIndex >= 0) {
      nextItems.splice(previousIndex, 0, nextItem);
    } else {
      nextItems.unshift(nextItem);
    }
    return mergePromptLibrary({ items: nextItems, version: current.version });
  }

  function removePromptItem(library, promptId) {
    return mergePromptLibrary({
      items: mergePromptLibrary(library).items.filter((item) => item.id !== normalizeText(promptId)),
      version: Math.max(1, Number(library?.version) || 1),
    });
  }

  function movePromptItem(library, dragPromptId, targetPromptId, placement = "before") {
    const current = mergePromptLibrary(library);
    const dragIndex = current.items.findIndex((item) => item.id === dragPromptId);
    const targetIndex = current.items.findIndex((item) => item.id === targetPromptId);
    if (dragIndex === -1 || targetIndex === -1 || dragPromptId === targetPromptId) {
      return current;
    }
    const nextItems = current.items.map((item) => clonePromptItem(item)).filter(Boolean);
    const [dragItem] = nextItems.splice(dragIndex, 1);
    const adjustedTargetIndex = nextItems.findIndex((item) => item.id === targetPromptId);
    const insertIndex = placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    nextItems.splice(Math.max(0, insertIndex), 0, dragItem);
    return mergePromptLibrary({ items: nextItems, version: current.version });
  }

  function importStoreEntry(library, storeEntry) {
    const current = mergePromptLibrary(library);
    const nextItem = buildPromptItem({
      content: storeEntry?.content,
      importedFrom: {
        authorName: storeEntry?.owner?.displayName,
        categoryId: storeEntry?.categoryId,
        entryId: storeEntry?.entryId,
        importedAt: new Date().toISOString(),
        source: "store",
      },
      title: storeEntry?.title,
    });
    return nextItem ? mergePromptLibrary({ items: [nextItem, ...current.items] }) : current;
  }

  function buildExportPayload(library) {
    const merged = mergePromptLibrary(library);
    return {
      exportedAt: new Date().toISOString(),
      items: merged.items.map((item) => clonePromptItem(item)),
      libraryName: "i-Nova 자주 쓰는 요청",
      version: merged.version,
    };
  }

  function parseImportText(text) {
    const parsed = JSON.parse(String(text || ""));
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(items)) {
      throw new Error("가져오기 파일에 items 배열이 없어요.");
    }
    return {
      items: dedupePromptItemsById(items),
      libraryName: normalizeText(parsed?.libraryName || "가져온 요청"),
      version: Math.max(1, Number(parsed?.version) || 1),
    };
  }

  function previewImport(currentLibrary, payload, mode) {
    return inspectImport(currentLibrary, payload, mode).summary;
  }

  function applyImport(currentLibrary, payload, mode) {
    const result = inspectImport(currentLibrary, payload, mode);
    return {
      library: mergePromptLibrary({ items: result.items, version: Math.max(1, Number(payload?.version) || 1) }),
      summary: result.summary,
    };
  }

  function inspectImport(currentLibrary, payload, mode) {
    const current = mergePromptLibrary(currentLibrary);
    const incomingItems = dedupePromptItemsById(payload?.items || []);
    const nextItems = mode === "replace"
      ? []
      : current.items.map((item) => clonePromptItem(item)).filter(Boolean);
    const summary = {
      added: 0,
      incoming: incomingItems.length,
      libraryName: payload?.libraryName || "",
      mode,
      removed: mode === "replace" ? current.items.length : 0,
      skipped: 0,
      updated: 0,
    };
    let insertOffset = 0;

    for (const item of incomingItems) {
      const itemFingerprint = getPromptFingerprint(item);
      const matchIndexById = nextItems.findIndex((entry) => entry.id === item.id);
      const matchIndexByFingerprint = nextItems.findIndex((entry) => getPromptFingerprint(entry) === itemFingerprint);
      const matchIndex = matchIndexById >= 0 ? matchIndexById : matchIndexByFingerprint;
      if (mode === "add") {
        if (matchIndexByFingerprint >= 0) {
          summary.skipped += 1;
        } else {
          nextItems.splice(insertOffset, 0, matchIndexById >= 0 ? clonePromptItemWithNewId(item) : clonePromptItem(item));
          insertOffset += 1;
          summary.added += 1;
        }
        continue;
      }
      if (mode === "merge") {
        if (matchIndex < 0) {
          nextItems.splice(insertOffset, 0, clonePromptItem(item));
          insertOffset += 1;
          summary.added += 1;
          continue;
        }
        const existing = nextItems[matchIndex];
        if (isSamePrompt(existing, item)) {
          summary.skipped += 1;
          continue;
        }
        nextItems[matchIndex] = {
          ...clonePromptItem(item),
          createdAt: existing.createdAt,
          id: existing.id,
          updatedAt: new Date().toISOString(),
        };
        summary.updated += 1;
        continue;
      }
      nextItems.push(clonePromptItem(item));
      summary.added += 1;
    }

    return {
      items: mode === "replace"
        ? incomingItems.map((item) => clonePromptItem(item)).filter(Boolean)
        : nextItems.filter(Boolean),
      summary,
    };
  }

  function getPromptFingerprint(item) {
    return [
      normalizeText(item?.title).toLowerCase(),
      normalizePromptContent(item?.content).toLowerCase(),
    ].join("::");
  }

  function isSamePrompt(a, b) {
    return normalizeText(a?.title) === normalizeText(b?.title)
      && normalizePromptContent(a?.content) === normalizePromptContent(b?.content);
  }

  function clonePromptItemWithNewId(item) {
    const cloned = clonePromptItem(item);
    return cloned
      ? {
          ...cloned,
          id: createPromptId(),
        }
      : null;
  }

  function buildReplaceSyncDocument(promptLibrary, providerIdentity) {
    const library = mergePromptLibrary(promptLibrary);
    const exportedAt = new Date().toISOString();
    const revision = `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      operation: {
        orderedIds: library.items.map((item) => item.id),
        promptLibrary: {
          itemCount: library.items.length,
          items: library.items.map((item) => clonePromptItem(item)),
          updatedAt: getLatestUpdatedAt(library.items),
          version: library.version,
        },
        type: "replace-library",
      },
      owner: {
        available: Boolean(providerIdentity?.available),
        displayName: normalizeText(providerIdentity?.displayName),
        email: normalizeText(providerIdentity?.email),
        numericUserId: Number.isFinite(Number(providerIdentity?.numericUserId))
          ? Number(providerIdentity.numericUserId)
          : null,
        provider: normalizeText(providerIdentity?.provider || "inova") || "inova",
        providerUserKey: normalizeText(providerIdentity?.providerUserKey),
      },
      promptLibrary: {
        itemCount: library.items.length,
        items: library.items.map((item) => clonePromptItem(item)),
        updatedAt: getLatestUpdatedAt(library.items),
        version: library.version,
      },
      schemaVersion: 2,
      sync: {
        exportedAt,
        lastError: "",
        lastSyncedAt: "",
        queuedAt: exportedAt,
        reason: "manual",
        revision,
        status: "queued",
      },
    };
  }

  function getLatestUpdatedAt(items) {
    let latest = "";
    for (const item of items || []) {
      const updatedAt = normalizeText(item?.updatedAt);
      if (updatedAt && (!latest || updatedAt > latest)) {
        latest = updatedAt;
      }
    }
    return latest;
  }

  namespace.promptLibraryModel = {
    applyImport,
    buildExportPayload,
    buildReplaceSyncDocument,
    importStoreEntry,
    mergePromptLibrary,
    movePromptItem,
    parseImportText,
    previewImport,
    removePromptItem,
    upsertPromptItem,
  };
})(globalThis);
