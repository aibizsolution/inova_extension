(function initCloudApi(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { functions } = namespace.firebaseConfig;
  const REQUEST_TIMEOUT_MS = 25000;

  function toProviderIdentityPayload(providerIdentity) {
    return {
      displayName: providerIdentity?.displayName || "",
      email: providerIdentity?.email || "",
      numericUserId: providerIdentity?.numericUserId ?? null,
      provider: providerIdentity?.provider || "inova",
      providerUserKey: providerIdentity?.providerUserKey || "",
    };
  }

  async function peekInovaPromptLibrary(providerIdentity, accessToken) {
    const payload = await postJson(
      functions.peekInovaPromptLibraryUrl,
      {
        providerIdentity: toProviderIdentityPayload(providerIdentity),
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
        limit: filter?.limit || 24,
        ownerOnly: Boolean(filter?.ownerOnly),
        owner: providerIdentity,
        query: filter?.query || "",
        sortBy: filter?.sortBy || "latest",
      },
      accessToken
    );
    return payload?.data || { availableCategories: [], hasMore: false, items: [], totalCount: 0 };
  }

  async function reviewInovaPrompt(prompt, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.reviewInovaPromptUrl,
      {
        owner: providerIdentity,
        prompt,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function loadInovaPromptLibrary(providerIdentity, accessToken) {
    const payload = await postJson(functions.loadInovaPromptLibraryUrl, {
      providerIdentity: toProviderIdentityPayload(providerIdentity),
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

  function buildCreateInovaMeetingJobRequest(input, providerIdentity) {
    return {
      meeting: {
        endedAt: input?.meeting?.endedAt || "",
        language: input?.meeting?.language || "",
        sessionId: input?.meeting?.sessionId || "",
        startedAt: input?.meeting?.startedAt || "",
        title: input?.meeting?.title || "",
      },
      options: {
        redaction: input?.options?.redaction || "",
        speakerLabels: Boolean(input?.options?.speakerLabels),
        summary: Boolean(input?.options?.summary),
      },
      owner: toProviderIdentityPayload(providerIdentity),
      source: {
        captureMode: input?.source?.captureMode || "",
        channelCount: Number(input?.source?.channelCount) || 0,
        durationMs: Number(input?.source?.durationMs) || 0,
        fileName: input?.source?.fileName || "",
        inlineAudioBase64: input?.source?.inlineAudioBase64 || "",
        mimeType: input?.source?.mimeType || "",
        sizeBytes: Number(input?.source?.sizeBytes) || 0,
        storageObject: input?.source?.storageObject || "",
      },
    };
  }

  async function createInovaMeetingJob(input, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.createInovaMeetingJobUrl,
      buildCreateInovaMeetingJobRequest(input, providerIdentity),
      accessToken
    );
    return payload?.data || {};
  }

  async function getInovaMeetingJob(input, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.getInovaMeetingJobUrl,
      {
        jobId: input?.jobId || "",
        owner: toProviderIdentityPayload(providerIdentity),
        sessionId: input?.sessionId || "",
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function getInovaMeetingArtifact(input, providerIdentity, accessToken) {
    const payload = await postJson(
      functions.getInovaMeetingArtifactUrl,
      {
        artifactId: input?.artifactId || "",
        jobId: input?.jobId || "",
        owner: toProviderIdentityPayload(providerIdentity),
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
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller ? global.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;
    let response;

    try {
      response = await global.fetch(url, {
        body: JSON.stringify(body || {}),
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller?.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("클라우드 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.");
      }
      throw error;
    } finally {
      if (timeoutId) {
        global.clearTimeout(timeoutId);
      }
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(namespace.session.normalizeText(payload?.error || payload?.message || "") || "클라우드 요청에 실패했어요.");
    }

    return payload;
  }

  namespace.cloudApi = {
    buildCreateInovaMeetingJobRequest,
    createInovaMeetingJob,
    getInovaMeetingArtifact,
    getInovaMeetingJob,
    importPromptStoreEntry,
    listPromptStoreEntries,
    loadInovaPromptLibrary,
    peekInovaPromptLibrary,
    publishPromptToStore,
    recordPromptStoreView,
    reviewInovaPrompt,
    syncInovaPromptLibrary,
    togglePromptStoreLike,
    unpublishPromptFromStore,
  };
})(globalThis);
