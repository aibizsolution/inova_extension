(function initPromptStore(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function getCategories() {
    return namespace.constants.storeCategories.slice();
  }

  function getCategoryLabel(categoryId) {
    const normalized = namespace.session.normalizeText(categoryId || "").toLowerCase();
    return getCategories().find((category) => category.id === normalized)?.label || "기타";
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
      entryId: namespace.session.normalizeText(entry?.entryId || ""),
      categoryId,
      categoryLabel: namespace.session.normalizeText(entry?.categoryLabel || getCategoryLabel(categoryId)),
      content: normalizePromptContent(entry?.content || ""),
      owner: {
        displayName: namespace.session.normalizeText(entry?.owner?.displayName || "익명"),
        maskedEmail: namespace.session.normalizeText(entry?.owner?.maskedEmail || ""),
        providerUserKey: namespace.session.normalizeText(entry?.owner?.providerUserKey || ""),
      },
      promptId: namespace.session.normalizeText(entry?.promptId || ""),
      publishedAt: namespace.session.normalizeText(entry?.publishedAt || entry?.createdAt || ""),
      score: Number(entry?.score) || buildScore(metrics),
      summary: namespace.session.normalizeText(entry?.summary || ""),
      title: namespace.session.normalizeText(entry?.title || ""),
      updatedAt: namespace.session.normalizeText(entry?.updatedAt || entry?.publishedAt || ""),
      viewer,
      metrics,
    };
  }

  function normalizeStoreEntries(entries) {
    return Array.isArray(entries) ? entries.map(normalizeStoreEntry).filter((entry) => entry.entryId && entry.title && entry.content) : [];
  }

  function filterEntries(entries, query, categoryId) {
    const normalizedQuery = namespace.session.normalizeText(query || "").toLowerCase();
    const normalizedCategoryId = normalizeCategoryId(categoryId);
    return normalizeStoreEntries(entries).filter((entry) => {
      if (normalizedCategoryId !== "all" && entry.categoryId !== normalizedCategoryId) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return `${entry.title} ${entry.content} ${entry.summary} ${entry.owner.displayName}`.toLowerCase().includes(normalizedQuery);
    });
  }

  function sortEntries(entries, sortBy = "latest") {
    const items = normalizeStoreEntries(entries).slice();
    items.sort((left, right) => compareEntries(left, right, sortBy));
    return items;
  }

  function buildPublicationMeta(storeEntry) {
    const entry = normalizeStoreEntry(storeEntry);
    return {
      categoryId: entry.categoryId,
      categoryLabel: entry.categoryLabel,
      entryId: entry.entryId,
      publishedAt: entry.publishedAt,
    };
  }

  function compareEntries(left, right, sortBy) {
    if (sortBy === "likes") {
      return compareNumber(right.metrics.likeCount, left.metrics.likeCount) || compareNumber(right.metrics.importCount, left.metrics.importCount) || compareDate(right.publishedAt, left.publishedAt);
    }
    if (sortBy === "imports") {
      return compareNumber(right.metrics.importCount, left.metrics.importCount) || compareNumber(right.metrics.likeCount, left.metrics.likeCount) || compareDate(right.publishedAt, left.publishedAt);
    }
    if (sortBy === "views") {
      return compareNumber(right.metrics.viewCount, left.metrics.viewCount) || compareDate(right.publishedAt, left.publishedAt);
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
    const normalized = namespace.session.normalizeText(categoryId || "").toLowerCase();
    return getCategories().some((category) => category.id === normalized) ? normalized : "other";
  }

  function buildScore(metrics) {
    return metrics.likeCount * 3 + metrics.importCount * 5 + metrics.viewCount;
  }

  namespace.promptStore = {
    buildPublicationMeta,
    filterEntries,
    getCategories,
    getCategoryLabel,
    normalizeStoreEntries,
    normalizeStoreEntry,
    sortEntries,
  };
})(globalThis);
