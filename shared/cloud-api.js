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

  async function reviewInovaPrompt(prompt, providerIdentity, accessToken, options = {}) {
    const reviewProfile = String(options?.reviewProfile || "").trim();
    const payload = await postJson(
      functions.reviewInovaPromptUrl,
      {
        owner: providerIdentity,
        prompt,
        ...(reviewProfile ? { reviewProfile } : {}),
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

  async function listInovaMeetings(input, providerIdentity, accessToken, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.listInovaMeetingsUrl,
      {
        cursor: input?.cursor || "",
        limit: Number(input?.limit) || 24,
        owner: toProviderIdentityPayload(providerIdentity),
      },
      accessToken
    );
    return payload?.data || { items: [], nextCursor: "" };
  }

  async function moveInovaMeetingResult(input, providerIdentity, accessToken, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.moveInovaMeetingResultUrl,
      {
        clientRequestId: input?.clientRequestId || "",
        jobId: input?.jobId || "",
        meetingId: input?.meetingId || "",
        targetMeetingId: input?.targetMeetingId || "",
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function authorizeInovaMeetingWorkspaceAccess(input, providerIdentity, accessToken, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.authorizeInovaMeetingWorkspaceAccessUrl,
      {
        debugAuthBypass: input?.debugAuthBypass || "",
        jobId: input?.jobId || "",
        meetingId: input?.meetingId || "",
        providerIdentity: toProviderIdentityPayload(providerIdentity),
        shareToken: input?.shareToken || input?.share || "",
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function issueInovaMeetingLaunch(input, providerIdentity, accessToken, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.issueInovaMeetingLaunchUrl,
      {
        jobId: input?.jobId || "",
        meetingId: input?.meetingId || "",
        mode: input?.mode || "create",
        owner: toProviderIdentityPayload(providerIdentity),
        suggestedTitle: input?.suggestedTitle || input?.title || "",
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function createInovaMeetingShareLink(input, providerIdentity, accessToken, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.createInovaMeetingShareLinkUrl,
      {
        jobId: input?.jobId || "",
        meetingId: input?.meetingId || "",
        owner: toProviderIdentityPayload(providerIdentity),
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function revokeInovaMeetingShareLink(input, providerIdentity, accessToken, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.revokeInovaMeetingShareLinkUrl,
      {
        jobId: input?.jobId || "",
        meetingId: input?.meetingId || "",
        owner: toProviderIdentityPayload(providerIdentity),
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function issueInovaMeetingPanelAuth(providerIdentity, accessToken, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.issueInovaMeetingPanelAuthUrl,
      {
        owner: toProviderIdentityPayload(providerIdentity),
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function issueInovaPromptPanelAuth(providerIdentity, accessToken) {
    const payload = await postJson(
      functions.issueInovaPromptPanelAuthUrl,
      {
        owner: toProviderIdentityPayload(providerIdentity),
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function exchangeInovaMeetingLaunch(input, requestOptions = {}) {
    const meetingFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      meetingFunctions.exchangeInovaMeetingLaunchUrl,
      {
        launchToken: input?.launchToken || "",
      }
    );
    return payload?.data || {};
  }

  async function syncInovaPromptLibrary(syncDocument, accessToken) {
    const payload = await postJson(functions.syncInovaPromptLibraryUrl, syncDocument, accessToken);
    return payload?.data || {};
  }

  async function postJson(url, body, auth) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller ? global.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;
    let response;
    const headers = buildAuthHeaders(auth);

    try {
      response = await global.fetch(url, {
        body: JSON.stringify(body || {}),
        headers,
        method: "POST",
        signal: controller?.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("클라우드 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.", { cause: error });
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

  function buildAuthHeaders(auth) {
    const normalized = normalizeAuth(auth);
    const headers = {
      "Content-Type": "application/json",
    };
    if (normalized.firebaseSessionToken) {
      headers.Authorization = `FirebaseSession ${normalized.firebaseSessionToken}`;
      return headers;
    }
    if (normalized.accessToken) {
      headers.Authorization = `Bearer ${normalized.accessToken}`;
      return headers;
    }
    if (normalized.meetingSessionToken) {
      headers.Authorization = `MeetingSession ${normalized.meetingSessionToken}`;
    }
    return headers;
  }

  function normalizeAuth(auth) {
    if (typeof auth === "string") {
      return {
        accessToken: auth,
        firebaseSessionToken: "",
        meetingSessionToken: "",
      };
    }
    return {
      accessToken: auth?.accessToken || "",
      firebaseSessionToken: auth?.firebaseSessionToken || "",
      meetingSessionToken: auth?.meetingSessionToken || "",
    };
  }

  function resolveFunctionsConfig(overrideConfig) {
    return overrideConfig && typeof overrideConfig === "object" ? overrideConfig : functions;
  }

  namespace.cloudApi = {
    authorizeInovaMeetingWorkspaceAccess,
    createInovaMeetingShareLink,
    exchangeInovaMeetingLaunch,
    issueInovaMeetingLaunch,
    issueInovaMeetingPanelAuth,
    issueInovaPromptPanelAuth,
    listInovaMeetings,
    importPromptStoreEntry,
    listPromptStoreEntries,
    loadInovaPromptLibrary,
    moveInovaMeetingResult,
    peekInovaPromptLibrary,
    publishPromptToStore,
    recordPromptStoreView,
    revokeInovaMeetingShareLink,
    reviewInovaPrompt,
    syncInovaPromptLibrary,
    togglePromptStoreLike,
    unpublishPromptFromStore,
  };
})(globalThis);
