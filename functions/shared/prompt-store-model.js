(function initPromptStoreModel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEFAULT_STORE_CATEGORIES = Object.freeze([
    Object.freeze({ id: "document", label: "문서 작성" }),
    Object.freeze({ id: "summary", label: "요약/정리" }),
    Object.freeze({ id: "analysis", label: "분석/리서치" }),
    Object.freeze({ id: "meeting", label: "회의/업무" }),
    Object.freeze({ id: "translation", label: "번역" }),
    Object.freeze({ id: "advertising", label: "광고/퍼포먼스" }),
    Object.freeze({ id: "marketing", label: "마케팅" }),
    Object.freeze({ id: "commerce", label: "커머스" }),
    Object.freeze({ id: "sales", label: "세일즈" }),
    Object.freeze({ id: "customer-success", label: "고객 성공/CS" }),
    Object.freeze({ id: "hr", label: "HR/피플" }),
    Object.freeze({ id: "finance", label: "재무/경영관리" }),
    Object.freeze({ id: "code", label: "코딩" }),
    Object.freeze({ id: "core-dev", label: "코어 개발" }),
    Object.freeze({ id: "language-specialists", label: "언어/프레임워크" }),
    Object.freeze({ id: "infrastructure", label: "인프라" }),
    Object.freeze({ id: "quality-security", label: "품질/보안" }),
    Object.freeze({ id: "data-ai", label: "데이터/AI" }),
    Object.freeze({ id: "developer-experience", label: "개발 경험" }),
    Object.freeze({ id: "specialized-domains", label: "전문 도메인" }),
    Object.freeze({ id: "business-product", label: "비즈니스/프로덕트" }),
    Object.freeze({ id: "meta-orchestration", label: "오케스트레이션" }),
    Object.freeze({ id: "research-analysis", label: "리서치/분석" }),
    Object.freeze({ id: "other", label: "기타" }),
  ]);

  function createPromptStoreModel(options = {}) {
    const normalizeTextValue = typeof options.normalizeText === "function"
      ? options.normalizeText
      : defaultNormalizeText;
    const normalizePromptContentValue = typeof options.normalizePromptContent === "function"
      ? options.normalizePromptContent
      : defaultNormalizePromptContent;
    const categories = normalizeCategories(options.storeCategories || readNamespaceCategories(), normalizeTextValue);
    const categoryIds = categories.map((category) => category.id);

    return {
      buildScore,
      compareCategoryIds,
      compareEntries,
      filterEntries,
      getCategories,
      getCategoryLabel,
      normalizeCategoryKey,
      normalizeCategoryLabel,
      normalizeFilterCategoryId,
      normalizeMetrics,
      normalizePromptContent: normalizePromptContentValue,
      normalizePublishCategory,
      normalizePublishCategoryId,
      normalizeSort,
      normalizeStoreEntries,
      normalizeStoreEntry,
      sortEntries,
    };

    function getCategories() {
      return cloneValue(categories);
    }

    function getCategoryLabel(categoryId, fallbackLabel = "") {
      return normalizeTextValue(fallbackLabel)
        || categories.find((category) => category.id === categoryId)?.label
        || formatCategoryLabel(categoryId)
        || "기타";
    }

    function normalizeStoreEntry(entry) {
      const metrics = normalizeMetrics(entry?.metrics);
      const categoryId = normalizePublishCategoryId(entry?.categoryId);
      const viewer = {
        imported: Boolean(entry?.viewer?.imported),
        liked: Boolean(entry?.viewer?.liked),
        viewed: Boolean(entry?.viewer?.viewed),
      };
      return {
        categoryId,
        categoryLabel: normalizeTextValue(entry?.categoryLabel || getCategoryLabel(categoryId)),
        content: normalizePromptContentValue(entry?.content || ""),
        entryId: normalizeTextValue(entry?.entryId || ""),
        hasDetail: Boolean(entry?.hasDetail || entry?.content),
        metrics,
        owner: {
          displayName: normalizeTextValue(entry?.owner?.displayName || "익명"),
          kind: normalizeTextValue(entry?.owner?.kind || "user") || "user",
          maskedEmail: normalizeTextValue(entry?.owner?.maskedEmail || ""),
          providerUserKey: normalizeTextValue(entry?.owner?.providerUserKey || ""),
        },
        promptId: normalizeTextValue(entry?.promptId || ""),
        publishedAt: normalizeTextValue(entry?.publishedAt || entry?.createdAt || ""),
        score: Number(entry?.score) || buildScore(metrics),
        summary: normalizeTextValue(entry?.summary || ""),
        title: normalizeTextValue(entry?.title || ""),
        updatedAt: normalizeTextValue(entry?.updatedAt || entry?.publishedAt || ""),
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
      const normalizedQuery = normalizeTextValue(query || "").toLowerCase();
      const normalizedCategoryId = normalizeFilterCategoryId(categoryId);
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
      const normalizedSort = normalizeSort(sortBy);
      if (normalizedSort === "likes") {
        return compareNumber(right.metrics.likeCount, left.metrics.likeCount)
          || compareNumber(right.metrics.importCount, left.metrics.importCount)
          || compareDate(right.publishedAt, left.publishedAt);
      }
      if (normalizedSort === "imports") {
        return compareNumber(right.metrics.importCount, left.metrics.importCount)
          || compareNumber(right.metrics.likeCount, left.metrics.likeCount)
          || compareDate(right.publishedAt, left.publishedAt);
      }
      if (normalizedSort === "views") {
        return compareNumber(right.metrics.viewCount, left.metrics.viewCount)
          || compareDate(right.publishedAt, left.publishedAt);
      }
      return compareDate(right.publishedAt, left.publishedAt) || compareNumber(right.score, left.score);
    }

    function normalizeMetrics(metrics) {
      return {
        importCount: Math.max(0, Number(metrics?.importCount) || 0),
        likeCount: Math.max(0, Number(metrics?.likeCount) || 0),
        viewCount: Math.max(0, Number(metrics?.viewCount) || 0),
      };
    }

    function normalizeSort(sortBy) {
      const normalized = normalizeTextValue(sortBy).toLowerCase();
      return ["latest", "likes", "imports", "views"].includes(normalized) ? normalized : "latest";
    }

    function normalizeFilterCategoryId(categoryId) {
      const normalized = normalizeCategoryKey(categoryId);
      return normalized === "all" ? "all" : normalized || "all";
    }

    function normalizePublishCategoryId(categoryId) {
      return normalizePublishCategory({ categoryId }).id;
    }

    function normalizePublishCategory(input) {
      const explicitCategoryId = normalizeCategoryKey(input?.categoryId);
      const explicitCategoryLabel = normalizeCategoryLabel(input?.categoryLabel);
      if (explicitCategoryId && explicitCategoryId !== "all") {
        return {
          id: explicitCategoryId,
          label: getCategoryLabel(explicitCategoryId, explicitCategoryLabel),
        };
      }
      if (explicitCategoryLabel) {
        const generatedCategoryId = normalizeCategoryKey(explicitCategoryLabel) || "other";
        return {
          id: generatedCategoryId === "all" ? "other" : generatedCategoryId,
          label: explicitCategoryLabel,
        };
      }
      return {
        id: "other",
        label: getCategoryLabel("other"),
      };
    }

    function normalizeCategoryKey(categoryId) {
      return normalizeTextValue(categoryId)
        .toLowerCase()
        .replace(/[/\\]+/g, "-")
        .replace(/[^\p{L}\p{N}-]+/gu, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }

    function normalizeCategoryLabel(categoryLabel) {
      return normalizeTextValue(categoryLabel).slice(0, 40);
    }

    function compareCategoryIds(left, right, categoryLabels = {}) {
      const leftOrder = categoryIds.indexOf(left);
      const rightOrder = categoryIds.indexOf(right);
      const normalizedLeftOrder = leftOrder >= 0 ? leftOrder : Number.MAX_SAFE_INTEGER;
      const normalizedRightOrder = rightOrder >= 0 ? rightOrder : Number.MAX_SAFE_INTEGER;
      if (normalizedLeftOrder !== normalizedRightOrder) {
        return normalizedLeftOrder - normalizedRightOrder;
      }
      return getCategoryLabel(left, categoryLabels?.[left]).localeCompare(
        getCategoryLabel(right, categoryLabels?.[right]),
        "ko"
      );
    }
  }

  function getDefaultStoreCategories(options = {}) {
    const categories = DEFAULT_STORE_CATEGORIES.map((category) => ({ ...category }));
    return options.includeAll === true
      ? [{ id: "all", label: "전체" }, ...categories]
      : categories;
  }

  function buildScore(metrics = {}) {
    return (Number(metrics.likeCount) || 0) * 3
      + (Number(metrics.importCount) || 0) * 5
      + (Number(metrics.viewCount) || 0);
  }

  function compareNumber(left, right) {
    return Number(left || 0) - Number(right || 0);
  }

  function compareDate(left, right) {
    return Date.parse(left || "") - Date.parse(right || "");
  }

  function formatCategoryLabel(categoryId) {
    const normalized = defaultNormalizeText(categoryId);
    if (!normalized) {
      return "";
    }
    return normalized.replace(/[-_]+/g, " ").trim();
  }

  function readNamespaceCategories() {
    return Array.isArray(namespace.constants?.storeCategories)
      ? namespace.constants.storeCategories.filter((category) => category?.id !== "all")
      : getDefaultStoreCategories();
  }

  function normalizeCategories(categories, normalizeTextValue) {
    const source = Array.isArray(categories) && categories.length ? categories : getDefaultStoreCategories();
    const seen = new Set();
    const normalized = [];
    for (const category of source) {
      const id = normalizeTextValue(category?.id).toLowerCase();
      if (!id || id === "all" || seen.has(id)) {
        continue;
      }
      seen.add(id);
      normalized.push({
        id,
        label: normalizeTextValue(category?.label) || formatCategoryLabel(id) || "기타",
      });
    }
    if (!seen.has("other")) {
      normalized.push({ id: "other", label: "기타" });
    }
    return normalized;
  }

  function defaultNormalizePromptContent(text) {
    return namespace.promptTextModel.normalizePromptContent(text);
  }

  function defaultNormalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  const api = {
    createPromptStoreModel,
    getDefaultStoreCategories,
    ...createPromptStoreModel(),
  };

  namespace.promptStoreModel = api;
})(globalThis);
