const VIEW_WINDOW_MS = 1000 * 60 * 60 * 12;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;
const SUMMARY_LENGTH = 140;

function registerStoreHandlers(deps) {
  const {
    admin,
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

  const listPromptStoreEntries = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const filter = normalizeListFilter(request.body);
      logEvent("store.list.start", { categoryId: filter.categoryId, providerUserKey: owner.providerUserKey, sortBy: filter.sortBy });

      const entries = await fetchPromptStoreEntries(filter, owner.providerUserKey);
      const withViewer = await attachViewerState(entries, owner.providerUserKey);
      const items = withViewer.slice(0, filter.limit);

      logEvent("store.list.success", { count: items.length, providerUserKey: owner.providerUserKey, sortBy: filter.sortBy });
      response.json({ ok: true, data: { items } });
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
      const categoryId = normalizePublishCategoryId(request.body?.categoryId);
      if (!prompt.title || !prompt.content) {
        throw createHttpError(400, "스토어에 등록할 요청 정보가 비어 있어요.");
      }

      const now = new Date().toISOString();
      const ref = db.collection("prompt_store_entries").doc();
      const entryId = ref.id;
      const entry = buildEntry({
        entryId,
        owner,
        prompt,
        categoryId,
        metrics: normalizeMetrics(),
        publishedAt: now,
        updatedAt: now,
      });

      await ref.set(entry, { merge: false });
      logEvent("store.publish.success", { entryId, providerUserKey: owner.providerUserKey });
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
      const ref = db.collection("prompt_store_entries").doc(entryId);
      const snapshot = await ref.get();
      if (!snapshot.exists) {
        response.json({ ok: true, data: { entryId, removed: true } });
        return;
      }

      const data = snapshot.data() || {};
      if (normalizeText(data.owner?.providerUserKey) !== owner.providerUserKey) {
        throw createHttpError(403, "본인이 등록한 요청만 내릴 수 있어요.");
      }

      await ref.set(
        {
          status: "removed",
          removedAt: new Date().toISOString(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
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
        const importRef = entryRef.collection("imports").doc(owner.providerUserKey);
        const entrySnapshot = await transaction.get(entryRef);
        if (!entrySnapshot.exists || normalizeText(entrySnapshot.data()?.status) !== "published") {
          throw createHttpError(404, "스토어 요청을 찾지 못했어요.");
        }

        const entry = entrySnapshot.data();
        const importSnapshot = await transaction.get(importRef);
        const metrics = normalizeMetrics(entry.metrics);
        metrics.importCount += 1;
        transaction.set(importRef, {
          count: (Number(importSnapshot.data()?.count) || 0) + 1,
          importedAt: new Date().toISOString(),
          providerUserKey: owner.providerUserKey,
        });
        transaction.set(entryRef, buildMetricsPatch(metrics), { merge: true });
        return attachViewerFlags({ ...entry, metrics, updatedAt: entry.updatedAt }, { imported: true, liked: false, viewed: false });
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
        const viewRef = entryRef.collection("views").doc(owner.providerUserKey);
        const entrySnapshot = await transaction.get(entryRef);
        if (!entrySnapshot.exists || normalizeText(entrySnapshot.data()?.status) !== "published") {
          throw createHttpError(404, "스토어 요청을 찾지 못했어요.");
        }

        const viewSnapshot = await transaction.get(viewRef);
        const entry = entrySnapshot.data();
        const metrics = normalizeMetrics(entry.metrics);
        const viewedAt = Date.parse(normalizeText(viewSnapshot.data()?.viewedAt));
        const shouldCount = !Number.isFinite(viewedAt) || Date.now() - viewedAt > VIEW_WINDOW_MS;
        if (shouldCount) {
          metrics.viewCount += 1;
          transaction.set(viewRef, {
            providerUserKey: owner.providerUserKey,
            viewedAt: new Date().toISOString(),
          });
          transaction.set(entryRef, buildMetricsPatch(metrics), { merge: true });
        }

        return attachViewerFlags({ ...entry, metrics, updatedAt: entry.updatedAt }, { imported: false, liked: false, viewed: true });
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
    const snapshot = await buildListQuery(filter, providerUserKey).limit(filter.limit).get();
    const entries = snapshot.docs.map((doc) => ({ entryId: doc.id, ...(doc.data() || {}) }));
    if (!filter.query) {
      return entries;
    }

    const queryText = filter.query.toLowerCase();
    return entries.filter((entry) =>
      `${entry.title || ""} ${entry.content || ""} ${entry.summary || ""} ${entry.owner?.displayName || ""}`.toLowerCase().includes(queryText)
    );
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

  async function attachViewerState(entries, providerUserKey) {
    const normalized = entries.map(normalizeEntry);
    const refs = [];
    for (const entry of normalized) {
      const entryRef = db.collection("prompt_store_entries").doc(entry.entryId);
      refs.push(entryRef.collection("likes").doc(providerUserKey));
      refs.push(entryRef.collection("imports").doc(providerUserKey));
    }

    const snapshots = refs.length ? await db.getAll(...refs) : [];
    const viewerMap = new Map();
    for (let index = 0; index < normalized.length; index += 1) {
      const likeSnapshot = snapshots[index * 2];
      const importSnapshot = snapshots[index * 2 + 1];
      viewerMap.set(normalized[index].entryId, {
        imported: Boolean(importSnapshot?.exists),
        liked: Boolean(likeSnapshot?.exists),
        viewed: false,
      });
    }

    return normalized.map((entry) => attachViewerFlags(entry, viewerMap.get(entry.entryId)));
  }

  function buildEntry({ entryId, owner, prompt, categoryId, metrics, publishedAt, updatedAt }) {
    return {
      categoryId,
      categoryLabel: getCategoryLabel(categoryId),
      content: prompt.content,
      entryId,
      metrics,
      owner: {
        displayName: owner.displayName || "익명",
        maskedEmail: maskEmail(owner.email),
        providerUserKey: owner.providerUserKey,
      },
      publishedAt,
      score: buildScore(metrics),
      status: "published",
      summary: buildSummary(prompt.content),
      title: prompt.title,
      updatedAt,
    };
  }

  function buildMetricsPatch(metrics) {
    return {
      metrics,
      score: buildScore(metrics),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    const metrics = normalizeMetrics(entry.metrics);
    const categoryId = normalizePublishCategoryId(entry.categoryId);
    return {
      categoryId,
      categoryLabel: normalizeText(entry.categoryLabel) || getCategoryLabel(categoryId),
      content: normalizePromptContent(entry.content),
      entryId: normalizeText(entry.entryId),
      metrics,
      owner: {
        displayName: normalizeText(entry.owner?.displayName) || "익명",
        maskedEmail: normalizeText(entry.owner?.maskedEmail),
        providerUserKey: normalizeText(entry.owner?.providerUserKey),
      },
      promptId: normalizeText(entry.promptId),
      publishedAt: normalizeText(entry.publishedAt),
      score: Number(entry.score) || buildScore(metrics),
      summary: normalizeText(entry.summary),
      title: normalizeText(entry.title),
      updatedAt: normalizeText(entry.updatedAt || entry.publishedAt),
    };
  }

  function normalizePrompt(prompt) {
    return {
      content: normalizePromptContent(prompt?.content || "").slice(0, deps.MAX_CONTENT_LENGTH),
      id: normalizeText(prompt?.id),
      title: normalizeText(prompt?.title).slice(0, deps.MAX_TITLE_LENGTH),
    };
  }

  function normalizeMetrics(metrics) {
    return {
      importCount: Math.max(0, Number(metrics?.importCount) || 0),
      likeCount: Math.max(0, Number(metrics?.likeCount) || 0),
      viewCount: Math.max(0, Number(metrics?.viewCount) || 0),
    };
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

  function normalizeSort(sortBy) {
    const normalized = normalizeText(sortBy).toLowerCase();
    return ["latest", "likes", "imports", "views"].includes(normalized) ? normalized : "latest";
  }

  function normalizeFilterCategoryId(categoryId) {
    const normalized = normalizeText(categoryId).toLowerCase();
    return normalized === "all" ? "all" : normalizePublishCategoryId(normalized);
  }

  function normalizePublishCategoryId(categoryId) {
    const normalized = normalizeText(categoryId).toLowerCase();
    return deps.STORE_CATEGORY_IDS.includes(normalized) ? normalized : "other";
  }

  function getCategoryLabel(categoryId) {
    return deps.STORE_CATEGORIES.find((category) => category.id === categoryId)?.label || "기타";
  }

  function buildSummary(content) {
    return normalizePromptContent(content).replace(/\s+/g, " ").slice(0, SUMMARY_LENGTH);
  }

  function buildScore(metrics) {
    return metrics.likeCount * 3 + metrics.importCount * 5 + metrics.viewCount;
  }

  function sortEntries(entries, sortBy) {
    return entries.slice().sort((left, right) => {
      if (sortBy === "likes") {
        return compareNumber(right.metrics.likeCount, left.metrics.likeCount) || compareDate(right.publishedAt, left.publishedAt);
      }
      if (sortBy === "imports") {
        return compareNumber(right.metrics.importCount, left.metrics.importCount) || compareDate(right.publishedAt, left.publishedAt);
      }
      if (sortBy === "views") {
        return compareNumber(right.metrics.viewCount, left.metrics.viewCount) || compareDate(right.publishedAt, left.publishedAt);
      }
      return compareDate(right.publishedAt, left.publishedAt);
    });
  }

  function compareNumber(left, right) {
    return Number(left || 0) - Number(right || 0);
  }

  function compareDate(left, right) {
    return Date.parse(left || "") - Date.parse(right || "");
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
