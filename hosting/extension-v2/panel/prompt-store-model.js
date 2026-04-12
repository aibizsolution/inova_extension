(function initPromptStoreModel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function getCategories() {
    return Array.isArray(namespace.constants?.storeCategories)
      ? namespace.constants.storeCategories.slice()
      : [];
  }

  function getCategoryLabel(categoryId) {
    const normalized = normalizeText(categoryId).toLowerCase();
    return getCategories().find((category) => category.id === normalized)?.label
      || formatCategoryLabel(normalized)
      || "기타";
  }

  function normalizeStoreEntry(entry) {
    const metrics = {
      importCount: Math.max(0, Number(entry?.metrics?.importCount) || 0),
      likeCount: Math.max(0, Number(entry?.metrics?.likeCount) || 0),
      viewCount: Math.max(0, Number(entry?.metrics?.viewCount) || 0),
    };
    const viewer = {
      imported: Boolean(entry?.viewer?.imported),
      liked: Boolean(entry?.viewer?.liked),
      viewed: Boolean(entry?.viewer?.viewed),
    };
    const categoryId = normalizeCategoryId(entry?.categoryId);

    return {
      categoryId,
      categoryLabel: normalizeText(entry?.categoryLabel || getCategoryLabel(categoryId)),
      content: normalizePromptContent(entry?.content || ""),
      entryId: normalizeText(entry?.entryId || ""),
      hasDetail: Boolean(entry?.hasDetail || entry?.content),
      metrics,
      owner: {
        displayName: normalizeText(entry?.owner?.displayName || "익명"),
        kind: normalizeText(entry?.owner?.kind || "user") || "user",
        maskedEmail: normalizeText(entry?.owner?.maskedEmail || ""),
        providerUserKey: normalizeText(entry?.owner?.providerUserKey || ""),
      },
      promptId: normalizeText(entry?.promptId || ""),
      publishedAt: normalizeText(entry?.publishedAt || entry?.createdAt || ""),
      score: Number(entry?.score) || buildScore(metrics),
      summary: normalizeText(entry?.summary || ""),
      title: normalizeText(entry?.title || ""),
      updatedAt: normalizeText(entry?.updatedAt || entry?.publishedAt || ""),
      viewer,
    };
  }

  function normalizeStoreEntries(entries) {
    return Array.isArray(entries)
      ? entries
        .map(normalizeStoreEntry)
        .filter((entry) => entry.entryId && entry.title && (entry.summary || entry.content || entry.hasDetail))
      : [];
  }

  function filterEntries(entries, query, categoryId) {
    const normalizedQuery = normalizeText(query || "").toLowerCase();
    const normalizedCategoryId = normalizeCategoryId(categoryId);
    return normalizeStoreEntries(entries).filter((entry) => {
      if (normalizedCategoryId !== "all" && entry.categoryId !== normalizedCategoryId) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return `${entry.title} ${entry.summary} ${entry.content} ${entry.owner.displayName}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }

  function sortEntries(entries, sortBy = "latest") {
    const items = normalizeStoreEntries(entries).slice();
    items.sort((left, right) => compareEntries(left, right, sortBy));
    return items;
  }

  function compareEntries(left, right, sortBy) {
    if (sortBy === "likes") {
      return compareNumber(right.metrics.likeCount, left.metrics.likeCount)
        || compareNumber(right.metrics.importCount, left.metrics.importCount)
        || compareDate(right.publishedAt, left.publishedAt);
    }
    if (sortBy === "imports") {
      return compareNumber(right.metrics.importCount, left.metrics.importCount)
        || compareNumber(right.metrics.likeCount, left.metrics.likeCount)
        || compareDate(right.publishedAt, left.publishedAt);
    }
    if (sortBy === "views") {
      return compareNumber(right.metrics.viewCount, left.metrics.viewCount)
        || compareDate(right.publishedAt, left.publishedAt);
    }
    return compareDate(right.publishedAt, left.publishedAt) || compareNumber(right.score, left.score);
  }

  function compareNumber(left, right) {
    return Number(left || 0) - Number(right || 0);
  }

  function compareDate(left, right) {
    return Date.parse(left || "") - Date.parse(right || "");
  }

  function normalizePromptContent(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function normalizeCategoryId(categoryId) {
    const normalized = normalizeText(categoryId || "").toLowerCase();
    if (normalized === "all") {
      return "all";
    }
    return normalized || "other";
  }

  function buildScore(metrics) {
    return metrics.likeCount * 3 + metrics.importCount * 5 + metrics.viewCount;
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  function formatCategoryLabel(categoryId) {
    const normalized = normalizeText(categoryId);
    if (!normalized) {
      return "";
    }
    return normalized.replace(/[-_]+/g, " ").trim();
  }

  namespace.promptStoreModel = {
    filterEntries,
    getCategories,
    getCategoryLabel,
    normalizeStoreEntries,
    normalizeStoreEntry,
    sortEntries,
  };
})(globalThis);
