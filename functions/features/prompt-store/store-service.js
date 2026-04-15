const { FieldValue } = require("firebase-admin/firestore");
require("../../shared/prompt-store-model");
const promptStoreModel = globalThis.InovaBookmarks.promptStoreModel;

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 200;
const SUMMARY_LENGTH = 140;
const DETAIL_COLLECTION = "prompt_store_entry_details";
const FEED_COLLECTION = "prompt_store_feed_pages";
const FEED_PAGE_SIZE = 500;
const SUMMARY_COLLECTION = "prompt_store_meta";
const SUMMARY_DOC_ID = "summary";
const PUBLIC_FEED_SORTS = ["latest"];

function registerStoreHandlers(deps) {
  const {
    db,
    onRequest,
    CORS_ORIGINS,
    REGION,
    createHttpError,
    logEvent,
    normalizeIdentity,
    normalizePromptContent,
    normalizeText,
    sendError,
    verifyInovaIdentity,
  } = deps;
  const storeModel = promptStoreModel.createPromptStoreModel({
    normalizePromptContent,
    normalizeText,
    storeCategories: deps.STORE_CATEGORIES,
  });

  const listPromptStoreEntries = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const filter = normalizeListFilter(request.body);
      logEvent("store.list.start", { categoryId: filter.categoryId, providerUserKey: owner.providerUserKey, sortBy: filter.sortBy });

      const entries = shouldUsePrebuiltFeed(filter)
        ? await fetchPromptStoreFeedItems(filter)
        : filter.ownerOnly || filter.query
        ? await fetchPromptStoreEntries(filter, owner.providerUserKey)
        : await fetchPromptStoreEntries(filter, owner.providerUserKey);
      const items = await attachViewerState(entries.items, owner.providerUserKey);
      const categoryMeta = filter.ownerOnly
        ? await buildOwnerCategoryMeta(owner.providerUserKey)
        : await loadStoreSummary();
      const availableCategories = buildAvailableCategories(categoryMeta.categoryCounts, categoryMeta.categoryLabels, filter.categoryId);
      const totalCount = filter.categoryId === "all"
        ? Number(categoryMeta.totalCount) || items.length
        : Math.max(0, Number(categoryMeta.categoryCounts?.[filter.categoryId]) || 0);
      const hasMore = filter.query ? Boolean(entries.hasMore) : totalCount > items.length;

      logEvent("store.list.success", { count: items.length, providerUserKey: owner.providerUserKey, sortBy: filter.sortBy });
      response.json({
        ok: true,
        data: {
          availableCategories,
          hasMore,
          items,
          totalCount,
        },
      });
    } catch (error) {
      logEvent("store.list.error", { error: normalizeText(error?.message), status: Number(error?.status) || 500 });
      sendError(response, error);
    }
  });

  const publishPromptToStore = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const prompt = normalizePrompt(request.body?.prompt);
      const category = normalizePublishCategory({
        categoryId: request.body?.categoryId,
        categoryLabel: request.body?.categoryLabel,
      });
      if (!prompt.title || !prompt.content) {
        throw createHttpError(400, "스토어에 등록할 요청 정보가 비어 있어요.");
      }

      const now = new Date().toISOString();
      const entry = await db.runTransaction(async (transaction) => {
        const ref = db.collection("prompt_store_entries").doc();
        const detailRef = getStoreDetailRef(ref.id);
        const entryId = ref.id;
        const summaryRef = getStoreSummaryRef();
        const summarySnapshot = await transaction.get(summaryRef);
        const summary = normalizeStoreSummary(summarySnapshot.data());
        const nextEntry = buildEntry({
          entryId,
          owner,
          prompt,
          categoryId: category.id,
          categoryLabel: category.label,
          metrics: normalizeMetrics(),
          publishedAt: now,
          updatedAt: now,
        });
        const detailEntry = buildDetailEntry({
          content: prompt.content,
          entryId,
          owner,
          updatedAt: now,
        });

        transaction.set(ref, nextEntry, { merge: false });
        transaction.set(detailRef, detailEntry, { merge: false });
        transaction.set(summaryRef, buildStoreSummaryPatch(incrementCategoryCount(summary, category.id, 1, category.label), now), { merge: true });
        return nextEntry;
      });
      await rebuildStoreSummaryAndFeeds();
      logEvent("store.publish.success", { entryId: entry.entryId, providerUserKey: owner.providerUserKey });
      response.json({ ok: true, data: { entry: attachViewerFlags(entry, { imported: false, liked: false, viewed: false }) } });
    } catch (error) {
      logEvent("store.publish.error", { error: normalizeText(error?.message), status: Number(error?.status) || 500 });
      sendError(response, error);
    }
  });

  const unpublishPromptFromStore = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const entryId = normalizeText(request.body?.entryId);
      if (!entryId) {
        throw createHttpError(400, "스토어에서 내릴 항목을 찾지 못했어요.");
      }
      await db.runTransaction(async (transaction) => {
        const ref = db.collection("prompt_store_entries").doc(entryId);
        const detailRef = getStoreDetailRef(entryId);
        const summaryRef = getStoreSummaryRef();
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) {
          return;
        }

        const data = snapshot.data() || {};
        if (normalizeText(data.owner?.kind) === "system") {
          throw createHttpError(403, "시스템 프롬프트는 삭제할 수 없어요.");
        }
        if (normalizeText(data.owner?.providerUserKey) !== owner.providerUserKey) {
          throw createHttpError(403, "본인이 등록한 요청만 내릴 수 있어요.");
        }
        if (normalizeText(data.status) !== "published") {
          return;
        }

        const summarySnapshot = await transaction.get(summaryRef);
        const summary = normalizeStoreSummary(summarySnapshot.data());
        const nextSummary = incrementCategoryCount(summary, normalizePublishCategoryId(data.categoryId), -1, data.categoryLabel);
        transaction.set(
          ref,
          {
            hasDetail: false,
            status: "removed",
            removedAt: new Date().toISOString(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        transaction.delete(detailRef);
        transaction.set(summaryRef, buildStoreSummaryPatch(nextSummary, new Date().toISOString()), { merge: true });
      });
      await rebuildStoreSummaryAndFeeds();
      logEvent("store.unpublish.success", { entryId, providerUserKey: owner.providerUserKey });
      response.json({ ok: true, data: { entryId, removed: true } });
    } catch (error) {
      logEvent("store.unpublish.error", { error: normalizeText(error?.message), status: Number(error?.status) || 500 });
      sendError(response, error);
    }
  });

  const importPromptStoreEntry = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const entryId = normalizeText(request.body?.entryId);
      if (!entryId) {
        throw createHttpError(400, "가져올 스토어 요청이 없어요.");
      }

      const result = await db.runTransaction(async (transaction) => {
        const entryRef = db.collection("prompt_store_entries").doc(entryId);
        const detailRef = getStoreDetailRef(entryId);
        const importRef = entryRef.collection("imports").doc(owner.providerUserKey);
        const entrySnapshot = await transaction.get(entryRef);
        if (!entrySnapshot.exists || normalizeText(entrySnapshot.data()?.status) !== "published") {
          throw createHttpError(404, "스토어 요청을 찾지 못했어요.");
        }

        const entry = entrySnapshot.data();
        const detailSnapshot = await transaction.get(detailRef);
        const content = normalizePromptContent(detailSnapshot.data()?.content || entry.content);
        const importSnapshot = await transaction.get(importRef);
        const metrics = normalizeMetrics(entry.metrics);
        metrics.importCount += 1;
        transaction.set(importRef, {
          count: (Number(importSnapshot.data()?.count) || 0) + 1,
          importedAt: new Date().toISOString(),
          providerUserKey: owner.providerUserKey,
        });
        transaction.set(entryRef, buildMetricsPatch(metrics), { merge: true });
        return attachViewerFlags({ ...entry, content, metrics, updatedAt: entry.updatedAt }, { imported: true, liked: false, viewed: false });
      });

      logEvent("store.import.success", { entryId, providerUserKey: owner.providerUserKey });
      response.json({ ok: true, data: { entry: result } });
    } catch (error) {
      logEvent("store.import.error", { error: normalizeText(error?.message), status: Number(error?.status) || 500 });
      sendError(response, error);
    }
  });

  const togglePromptStoreLike = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const entryId = normalizeText(request.body?.entryId);
      if (!entryId) {
        throw createHttpError(400, "좋아요를 바꿀 스토어 요청이 없어요.");
      }

      const result = await db.runTransaction(async (transaction) => {
        const entryRef = db.collection("prompt_store_entries").doc(entryId);
        const likeRef = entryRef.collection("likes").doc(owner.providerUserKey);
        const entrySnapshot = await transaction.get(entryRef);
        if (!entrySnapshot.exists || normalizeText(entrySnapshot.data()?.status) !== "published") {
          throw createHttpError(404, "스토어 요청을 찾지 못했어요.");
        }

        const likeSnapshot = await transaction.get(likeRef);
        const liked = likeSnapshot.exists;
        const entry = entrySnapshot.data();
        const metrics = normalizeMetrics(entry.metrics);
        metrics.likeCount = Math.max(0, metrics.likeCount + (liked ? -1 : 1));

        if (liked) {
          transaction.delete(likeRef);
        } else {
          transaction.set(likeRef, {
            likedAt: new Date().toISOString(),
            providerUserKey: owner.providerUserKey,
          });
        }
        transaction.set(entryRef, buildMetricsPatch(metrics), { merge: true });
        return {
          entry: attachViewerFlags({ ...entry, metrics, updatedAt: entry.updatedAt }, { imported: false, liked: !liked, viewed: false }),
          liked: !liked,
        };
      });

      logEvent("store.like.success", { entryId, liked: result.liked, providerUserKey: owner.providerUserKey });
      response.json({ ok: true, data: result });
    } catch (error) {
      logEvent("store.like.error", { error: normalizeText(error?.message), status: Number(error?.status) || 500 });
      sendError(response, error);
    }
  });

  const recordPromptStoreView = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const entryId = normalizeText(request.body?.entryId);
      if (!entryId) {
        throw createHttpError(400, "조회할 스토어 요청이 없어요.");
      }

      const result = await db.runTransaction(async (transaction) => {
        const entryRef = db.collection("prompt_store_entries").doc(entryId);
        const detailRef = getStoreDetailRef(entryId);
        const likeRef = entryRef.collection("likes").doc(owner.providerUserKey);
        const importRef = entryRef.collection("imports").doc(owner.providerUserKey);
        const viewRef = entryRef.collection("views").doc(owner.providerUserKey);
        const entrySnapshot = await transaction.get(entryRef);
        if (!entrySnapshot.exists || normalizeText(entrySnapshot.data()?.status) !== "published") {
          throw createHttpError(404, "스토어 요청을 찾지 못했어요.");
        }

        const entry = entrySnapshot.data();
        const detailSnapshot = await transaction.get(detailRef);
        const likeSnapshot = await transaction.get(likeRef);
        const importSnapshot = await transaction.get(importRef);
        const content = normalizePromptContent(detailSnapshot.data()?.content || entry.content);
        const metrics = normalizeMetrics(entry.metrics);
        metrics.viewCount += 1;
        transaction.set(viewRef, {
          providerUserKey: owner.providerUserKey,
          viewedAt: new Date().toISOString(),
        });
        transaction.set(entryRef, buildMetricsPatch(metrics), { merge: true });

        return attachViewerFlags({ ...entry, content, metrics, updatedAt: entry.updatedAt }, { imported: Boolean(importSnapshot.exists), liked: Boolean(likeSnapshot.exists), viewed: true });
      });

      logEvent("store.view.success", { entryId, providerUserKey: owner.providerUserKey });
      response.json({ ok: true, data: { entry: result } });
    } catch (error) {
      logEvent("store.view.error", { error: normalizeText(error?.message), status: Number(error?.status) || 500 });
      sendError(response, error);
    }
  });

  return {
    importPromptStoreEntry,
    listPromptStoreEntries,
    publishPromptToStore,
    recordPromptStoreView,
    togglePromptStoreLike,
    unpublishPromptFromStore,
  };

  function assertMethod(request) {
    if (request.method !== "POST") {
      throw createHttpError(405, "POST 요청만 지원해요.");
    }
  }

  async function verifyRequestIdentity(request) {
    const providerIdentity = normalizeIdentity(request.body?.providerIdentity || request.body?.owner);
    return verifyInovaIdentity(providerIdentity, request);
  }

  async function fetchPromptStoreEntries(filter, providerUserKey) {
    const snapshot = await buildListQuery(filter, providerUserKey)
      .select("categoryId", "categoryLabel", "entryId", "hasDetail", "metrics", "owner", "publishedAt", "score", "summary", "title", "updatedAt")
      .limit(filter.limit + 1)
      .get();
    const entries = snapshot.docs.map((doc) => ({ entryId: doc.id, ...(doc.data() || {}) }));
    const hasMore = entries.length > filter.limit;
    const visibleEntries = hasMore ? entries.slice(0, filter.limit) : entries;
    if (!filter.query) {
      return { hasMore, items: visibleEntries };
    }

    const queryText = filter.query.toLowerCase();
    return {
      hasMore,
      items: visibleEntries.filter((entry) =>
        `${entry.title || ""} ${entry.summary || ""} ${entry.owner?.displayName || ""}`.toLowerCase().includes(queryText)
      ),
    };
  }

  async function fetchPromptStoreFeedItems(filter) {
    const items = [];
    let repaired = false;
    for (let pageNumber = 0; items.length < filter.limit; pageNumber += 1) {
      let snapshot = await getFeedPageRef(filter.sortBy, filter.categoryId, pageNumber).get();
      if (!snapshot.exists && pageNumber === 0 && !repaired) {
        repaired = true;
        await rebuildStoreSummaryAndFeeds();
        snapshot = await getFeedPageRef(filter.sortBy, filter.categoryId, pageNumber).get();
      }
      if (!snapshot.exists) {
        break;
      }

      const pageItems = Array.isArray(snapshot.data()?.items) ? snapshot.data().items : [];
      if (!pageItems.length) {
        break;
      }
      items.push(...pageItems);
      if (pageItems.length < FEED_PAGE_SIZE) {
        break;
      }
    }
    return { hasMore: false, items: items.slice(0, filter.limit).map(normalizeEntry) };
  }

  function buildListQuery(filter, providerUserKey) {
    let query = db.collection("prompt_store_entries").where("status", "==", "published");
    if (filter.ownerOnly && providerUserKey) query = query.where("owner.providerUserKey", "==", providerUserKey);
    if (filter.categoryId !== "all") query = query.where("categoryId", "==", filter.categoryId);
    if (filter.ownerOnly) return query.orderBy("publishedAt", "desc");
    if (filter.sortBy === "likes") return query.orderBy("metrics.likeCount", "desc").orderBy("publishedAt", "desc");
    if (filter.sortBy === "imports") return query.orderBy("metrics.importCount", "desc").orderBy("publishedAt", "desc");
    if (filter.sortBy === "views") return query.orderBy("metrics.viewCount", "desc").orderBy("publishedAt", "desc");
    return query.orderBy("publishedAt", "desc");
  }

  async function loadStoreSummary() {
    const snapshot = await getStoreSummaryRef().get();
    const summary = normalizeStoreSummary(snapshot.data());
    if (!shouldRepairSummary(summary)) {
      return summary;
    }

    const probe = await db.collection("prompt_store_entries").where("status", "==", "published").limit(1).select("categoryId").get();
    if (probe.empty) {
      return summary;
    }

    return rebuildStoreSummaryAndFeeds();
  }

  async function rebuildStoreSummaryAndFeeds() {
    const snapshot = await db.collection("prompt_store_entries")
      .where("status", "==", "published")
      .select("categoryId", "categoryLabel", "entryId", "hasDetail", "metrics", "owner", "publishedAt", "title", "updatedAt")
      .get();
    const entries = snapshot.docs.map((doc) => normalizeEntry({ entryId: doc.id, ...(doc.data() || {}) }));
    const summary = buildSummaryFromEntries(entries);
    const updatedAt = new Date().toISOString();
    const writes = [];
    const seenFeedIds = new Set();

    writes.push({ ref: getStoreSummaryRef(), type: "set", data: buildStoreSummaryPatch(summary, updatedAt) });
    for (const sortBy of PUBLIC_FEED_SORTS) {
      for (const categoryId of ["all", ...Object.keys(summary.categoryCounts)]) {
        const feedEntries = buildFeedEntries(entries, sortBy, categoryId);
        if (!feedEntries.length) continue;
        for (let pageNumber = 0; pageNumber * FEED_PAGE_SIZE < feedEntries.length; pageNumber += 1) {
          const ref = getFeedPageRef(sortBy, categoryId, pageNumber);
          seenFeedIds.add(ref.id);
          writes.push({
            ref,
            type: "set",
            data: {
              categoryId,
              itemCount: feedEntries.length,
              items: feedEntries.slice(pageNumber * FEED_PAGE_SIZE, (pageNumber + 1) * FEED_PAGE_SIZE),
              pageNumber,
              sortBy,
              updatedAt,
            },
          });
        }
      }
    }

    const existing = await db.collection(FEED_COLLECTION).get();
    for (const doc of existing.docs) {
      if (!seenFeedIds.has(doc.id)) writes.push({ ref: doc.ref, type: "delete" });
    }
    await commitBatchedWrites(writes);
    return summary;
  }

  async function buildOwnerCategoryMeta(providerUserKey) {
    if (!providerUserKey) {
      return normalizeStoreSummary();
    }

    const snapshot = await db
      .collection("prompt_store_entries")
      .where("status", "==", "published")
      .where("owner.providerUserKey", "==", providerUserKey)
      .select("categoryId", "categoryLabel")
      .get();

    const categoryCounts = {};
    const categoryLabels = {};
    for (const doc of snapshot.docs) {
      const categoryId = normalizePublishCategoryId(doc.data()?.categoryId);
      const categoryLabel = getCategoryLabel(categoryId, doc.data()?.categoryLabel);
      categoryCounts[categoryId] = Math.max(0, Number(categoryCounts[categoryId]) || 0) + 1;
      categoryLabels[categoryId] = categoryLabel;
    }

    return {
      categoryCounts,
      categoryLabels,
      totalCount: snapshot.size,
      updatedAt: "",
    };
  }

  function buildAvailableCategories(categoryCounts, categoryLabels, activeCategoryId) {
    const activeId = normalizeFilterCategoryId(activeCategoryId);
    const available = [{ id: "all", label: "전체" }];
    const categoryIds = Object.keys(categoryCounts || {})
      .map((categoryId) => normalizePublishCategoryId(categoryId))
      .filter((categoryId, index, list) => categoryId && categoryId !== "all" && list.indexOf(categoryId) === index);
    if (activeId !== "all" && !categoryIds.includes(activeId)) {
      categoryIds.push(activeId);
    }
    categoryIds.sort((left, right) => storeModel.compareCategoryIds(left, right, categoryLabels));
    for (const categoryId of categoryIds) {
      const count = Number(categoryCounts?.[categoryId]) || 0;
      if (count <= 0 && categoryId !== activeId) {
        continue;
      }
      available.push({
        id: categoryId,
        label: getCategoryLabel(categoryId, categoryLabels?.[categoryId]),
      });
    }
    return available;
  }

  async function attachViewerState(entries, providerUserKey) {
    const normalized = entries.map(normalizeEntry);
    return normalized.map((entry) => attachViewerFlags(entry, providerUserKey ? { imported: false, liked: false, viewed: false } : null));
  }

  function buildEntry({ entryId, owner, prompt, categoryId, categoryLabel, metrics, publishedAt, updatedAt }) {
    return {
      categoryId,
      categoryLabel: getCategoryLabel(categoryId, categoryLabel),
      entryId,
      hasDetail: true,
      metrics,
      owner: {
        displayName: owner.displayName || "익명",
        kind: normalizeText(owner.kind) || "user",
        maskedEmail: maskEmail(owner.email),
        providerUserKey: owner.providerUserKey,
      },
      publishedAt,
      score: storeModel.buildScore(metrics),
      status: "published",
      summary: buildSummary(prompt.content),
      title: prompt.title,
      updatedAt,
    };
  }

  function buildDetailEntry({ content, entryId, owner, updatedAt }) {
    return {
      content: normalizePromptContent(content),
      entryId,
      owner: {
        kind: normalizeText(owner.kind) || "user",
        providerUserKey: owner.providerUserKey,
      },
      updatedAt,
    };
  }

  function buildMetricsPatch(metrics) {
    return {
      metrics,
      score: storeModel.buildScore(metrics),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  function attachViewerFlags(entry, viewer) {
    return {
      ...normalizeEntry(entry),
      viewer: {
        imported: Boolean(viewer?.imported),
        liked: Boolean(viewer?.liked),
        viewed: Boolean(viewer?.viewed),
      },
    };
  }

  function normalizeEntry(entry) {
    return storeModel.normalizeStoreEntry(entry);
  }

  function normalizePrompt(prompt) {
    return {
      content: normalizePromptContent(prompt?.content || "").slice(0, deps.MAX_CONTENT_LENGTH),
      id: normalizeText(prompt?.id),
      title: normalizeText(prompt?.title).slice(0, deps.MAX_TITLE_LENGTH),
    };
  }

  function normalizeMetrics(metrics) {
    return storeModel.normalizeMetrics(metrics);
  }

  function normalizeStoreSummary(summary) {
    const categoryCounts = {};
    const categoryLabels = {};
    const rawCategoryCounts = summary?.categories && typeof summary.categories === "object"
      ? summary.categories
      : {};
    const rawCategoryLabels = summary?.categoryLabels && typeof summary.categoryLabels === "object"
      ? summary.categoryLabels
      : {};
    for (const [categoryId, rawCount] of Object.entries(rawCategoryCounts)) {
      const normalizedCategoryId = normalizePublishCategoryId(categoryId);
      const count = Math.max(0, Number(rawCount) || 0);
      if (normalizedCategoryId === "all" || count <= 0) {
        continue;
      }
      categoryCounts[normalizedCategoryId] = count;
      categoryLabels[normalizedCategoryId] = getCategoryLabel(
        normalizedCategoryId,
        rawCategoryLabels[normalizedCategoryId] || rawCategoryLabels[categoryId]
      );
    }

    return {
      categoryCounts,
      categoryLabels,
      totalCount: Math.max(0, Number(summary?.totalPublished) || 0),
      updatedAt: normalizeText(summary?.updatedAt),
    };
  }

  function buildSummaryFromEntries(entries) {
    const categoryCounts = {};
    const categoryLabels = {};
    for (const entry of entries) {
      const categoryId = normalizePublishCategoryId(entry?.categoryId);
      const categoryLabel = getCategoryLabel(categoryId, entry?.categoryLabel);
      categoryCounts[categoryId] = Math.max(0, Number(categoryCounts[categoryId]) || 0) + 1;
      categoryLabels[categoryId] = categoryLabel;
    }
    return { categoryCounts, categoryLabels, totalCount: entries.length, updatedAt: "" };
  }

  function shouldRepairSummary(summary) {
    const categoryTotal = Object.values(summary.categoryCounts || {}).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
    return summary.totalCount !== categoryTotal || (summary.totalCount === 0 && categoryTotal === 0);
  }

  function incrementCategoryCount(summary, categoryId, delta, categoryLabel = "") {
    const next = normalizeStoreSummary(summary);
    const normalizedCategoryId = normalizePublishCategoryId(categoryId);
    const nextCount = Math.max(0, (Number(next.categoryCounts[normalizedCategoryId]) || 0) + Number(delta || 0));
    if (nextCount > 0) {
      next.categoryCounts[normalizedCategoryId] = nextCount;
      next.categoryLabels[normalizedCategoryId] = getCategoryLabel(
        normalizedCategoryId,
        categoryLabel || next.categoryLabels[normalizedCategoryId]
      );
    } else {
      delete next.categoryCounts[normalizedCategoryId];
      delete next.categoryLabels[normalizedCategoryId];
    }
    next.totalCount = Math.max(0, Number(next.totalCount) + Number(delta || 0));
    return next;
  }

  function buildStoreSummaryPatch(summary, updatedAt) {
    return {
      categories: summary.categoryCounts,
      categoryLabels: summary.categoryLabels,
      totalPublished: Math.max(0, Number(summary.totalCount) || 0),
      updatedAt: normalizeText(updatedAt) || new Date().toISOString(),
    };
  }

  function getStoreSummaryRef() {
    return db.collection(SUMMARY_COLLECTION).doc(SUMMARY_DOC_ID);
  }

  function getStoreDetailRef(entryId) {
    return db.collection(DETAIL_COLLECTION).doc(entryId);
  }

  function getFeedPageRef(sortBy, categoryId, pageNumber) {
    return db.collection(FEED_COLLECTION).doc(buildFeedPageId(sortBy, categoryId, pageNumber));
  }

  function buildFeedPageId(sortBy, categoryId, pageNumber) {
    return `${sortBy}__${categoryId}__${String(pageNumber).padStart(4, "0")}`;
  }

  function buildFeedEntries(entries, sortBy, categoryId) {
    return storeModel.sortEntries(
      (categoryId === "all" ? entries : entries.filter((entry) => normalizePublishCategoryId(entry.categoryId) === categoryId)).map(buildFeedItem),
      sortBy
    ).map(buildFeedItem);
  }

  function buildFeedItem(entry) {
    const normalized = normalizeEntry(entry);
    return {
      categoryId: normalized.categoryId,
      categoryLabel: normalized.categoryLabel,
      entryId: normalized.entryId,
      hasDetail: true,
      metrics: normalized.metrics,
      owner: normalized.owner,
      publishedAt: normalized.publishedAt,
      title: normalized.title,
      updatedAt: normalized.updatedAt,
    };
  }

  async function commitBatchedWrites(writes) {
    if (!writes.length) return;
    for (let index = 0; index < writes.length; index += 400) {
      const batch = db.batch();
      for (const write of writes.slice(index, index + 400)) {
        if (write.type === "delete") batch.delete(write.ref);
        else batch.set(write.ref, write.data, { merge: true });
      }
      await batch.commit();
    }
  }

  function normalizeListFilter(input) {
    return {
      categoryId: normalizeFilterCategoryId(input?.categoryId),
      limit: Math.min(MAX_LIMIT, Math.max(1, Number(input?.limit) || DEFAULT_LIMIT)),
      ownerOnly: Boolean(input?.ownerOnly),
      query: normalizeText(input?.query).toLowerCase(),
      sortBy: normalizeSort(input?.sortBy),
    };
  }

  function shouldUsePrebuiltFeed(filter) {
    return !filter?.ownerOnly && !filter?.query && normalizeSort(filter?.sortBy) === "latest";
  }

  function normalizeSort(sortBy) {
    return storeModel.normalizeSort(sortBy);
  }

  function normalizeFilterCategoryId(categoryId) {
    return storeModel.normalizeFilterCategoryId(categoryId);
  }

  function normalizePublishCategoryId(categoryId) {
    return storeModel.normalizePublishCategoryId(categoryId);
  }

  function normalizePublishCategory(input) {
    return storeModel.normalizePublishCategory(input);
  }

  function getCategoryLabel(categoryId, fallbackLabel = "") {
    return storeModel.getCategoryLabel(categoryId, fallbackLabel);
  }

  function buildSummary(content) {
    return normalizePromptContent(content).replace(/\s+/g, " ").slice(0, SUMMARY_LENGTH);
  }

  function maskEmail(email) {
    const normalized = normalizeText(email);
    if (!normalized.includes("@")) {
      return "";
    }
    const [local, domain] = normalized.split("@");
    if (!local) {
      return normalized;
    }
    return `${local.slice(0, 2)}***@${domain}`;
  }
}

module.exports = {
  registerStoreHandlers,
};
