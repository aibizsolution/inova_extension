(function initCloudApi(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { functions } = namespace.firebaseConfig;

  async function peekInovaPromptLibrary(providerIdentity, accessToken) {
    const payload = await postJson(
      functions.peekInovaPromptLibraryUrl,
      {
        providerIdentity: {
          displayName: providerIdentity?.displayName || "",
          email: providerIdentity?.email || "",
          numericUserId: providerIdentity?.numericUserId ?? null,
          provider: providerIdentity?.provider || "inova",
          providerUserKey: providerIdentity?.providerUserKey || "",
        },
      },
      accessToken
    );
    return payload?.data || { checkedAt: "", found: false };
  }

  async function listPromptStoreEntries(filter, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.listPromptStoreEntriesUrl,
      {
        categoryId: filter?.categoryId || "all",
        limit: filter?.limit || 60,
        ownerOnly: Boolean(filter?.ownerOnly),
        owner: providerIdentity,
        query: filter?.query || "",
        sortBy: filter?.sortBy || "latest",
      },
      accessToken
    );
    return payload?.data || { items: [] };
  }

  async function loadInovaPromptLibrary(providerIdentity, accessToken) {
    const payload = await postJson(functions.loadInovaPromptLibraryUrl, {
      providerIdentity: {
        displayName: providerIdentity?.displayName || "",
        email: providerIdentity?.email || "",
        numericUserId: providerIdentity?.numericUserId ?? null,
        provider: providerIdentity?.provider || "inova",
        providerUserKey: providerIdentity?.providerUserKey || "",
      },
    }, accessToken);
    return payload?.data || { found: false };
  }

  async function publishPromptToStore(prompt, categoryId, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.publishPromptToStoreUrl,
      {
        categoryId,
        owner: providerIdentity,
        prompt,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function unpublishPromptFromStore(entryId, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.unpublishPromptFromStoreUrl,
      {
        entryId,
        owner: providerIdentity,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function importPromptStoreEntry(entryId, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.importPromptStoreEntryUrl,
      {
        entryId,
        owner: providerIdentity,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function togglePromptStoreLike(entryId, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.togglePromptStoreLikeUrl,
      {
        entryId,
        owner: providerIdentity,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function recordPromptStoreView(entryId, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.recordPromptStoreViewUrl,
      {
        entryId,
        owner: providerIdentity,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function syncInovaPromptLibrary(syncDocument, accessToken) {
    const payload = await postJson(functions.syncInovaPromptLibraryUrl, syncDocument, accessToken);
    return payload?.data || {};
  }

  async function postJson(url, body, accessToken) {
    const response = await global.fetch(url, {
      body: JSON.stringify(body || {}),
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(namespace.session.normalizeText(payload?.error || payload?.message || "") || "클라우드 요청에 실패했어요.");
    }

    return payload;
  }

  namespace.cloudApi = {
    importPromptStoreEntry,
    listPromptStoreEntries,
    loadInovaPromptLibrary,
    peekInovaPromptLibrary,
    publishPromptToStore,
    recordPromptStoreView,
    syncInovaPromptLibrary,
    togglePromptStoreLike,
    unpublishPromptFromStore,
  };
})(globalThis);
