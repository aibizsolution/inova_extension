(function initCloudApiClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
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

  async function peekInovaPromptLibrary(providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.peekInovaPromptLibraryUrl,
      {
        providerIdentity: toProviderIdentityPayload(providerIdentity),
      },
      accessToken
    );
    return payload?.data || { checkedAt: "", found: false };
  }

  async function listPromptStoreEntries(filter, providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.listPromptStoreEntriesUrl,
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
    const promptFunctions = resolveFunctionsConfig(options.functionsConfig);
    const reviewProfile = String(options?.reviewProfile || "").trim();
    const payload = await postJson(
      promptFunctions.reviewInovaPromptUrl,
      {
        owner: providerIdentity,
        prompt,
        ...(reviewProfile ? { reviewProfile } : {}),
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function loadInovaPromptLibrary(providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(promptFunctions.loadInovaPromptLibraryUrl, {
      providerIdentity: toProviderIdentityPayload(providerIdentity),
    }, accessToken);
    return payload?.data || { found: false };
  }

  async function publishPromptToStore(prompt, categoryId, providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.publishPromptToStoreUrl,
      {
        categoryId,
        owner: providerIdentity,
        prompt,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function unpublishPromptFromStore(entryId, providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.unpublishPromptFromStoreUrl,
      {
        entryId,
        owner: providerIdentity,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function importPromptStoreEntry(entryId, providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.importPromptStoreEntryUrl,
      {
        entryId,
        owner: providerIdentity,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function togglePromptStoreLike(entryId, providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.togglePromptStoreLikeUrl,
      {
        entryId,
        owner: providerIdentity,
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function recordPromptStoreView(entryId, providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.recordPromptStoreViewUrl,
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
        clientRequestId: input?.clientRequestId || "",
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
        clientRequestId: input?.clientRequestId || "",
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

  async function issueInovaPromptPanelAuth(providerIdentity, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(
      promptFunctions.issueInovaPromptPanelAuthUrl,
      {
        owner: toProviderIdentityPayload(providerIdentity),
      },
      accessToken
    );
    return payload?.data || {};
  }

  async function fetchCapabilityManifest(manifestUrl) {
    const response = await fetchWithTimeout(manifestUrl, {
      cache: "no-store",
    });
    if (!response?.ok) {
      throw new Error(`remote capability manifest fetch failed: ${response?.status || "unknown"}`);
    }
    return response.json();
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

  async function syncInovaPromptLibrary(syncDocument, accessToken, requestOptions = {}) {
    const promptFunctions = resolveFunctionsConfig(requestOptions.functionsConfig);
    const payload = await postJson(promptFunctions.syncInovaPromptLibraryUrl, syncDocument, accessToken);
    return payload?.data || {};
  }

  async function postJson(url, body, auth) {
    const headers = buildAuthHeaders(auth);
    const response = await fetchWithTimeout(url, {
      body: JSON.stringify(body || {}),
      headers,
      method: "POST",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(namespace.session.normalizeText(payload?.error || payload?.message || "") || "클라우드 요청에 실패했어요.");
    }

    return payload;
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = createRequestTimeout(controller);
    try {
      return await Promise.race([
        global.fetch(url, {
          ...options,
          signal: controller?.signal,
        }),
        timeout.promise,
      ]);
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "cloud-request-timeout") {
        throw new Error("클라우드 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.", { cause: error });
      }
      throw error;
    } finally {
      timeout.clear();
    }
  }

  function createRequestTimeout(controller) {
    let timeoutId = 0;
    const promise = new Promise((_, reject) => {
      timeoutId = global.setTimeout(() => {
        if (controller) {
          controller.abort();
          return;
        }
        const error = new Error("cloud request timed out");
        error.code = "cloud-request-timeout";
        reject(error);
      }, REQUEST_TIMEOUT_MS);
    });
    return {
      clear() {
        if (timeoutId) {
          global.clearTimeout(timeoutId);
          timeoutId = 0;
        }
      },
      promise,
    };
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
    return overrideConfig && typeof overrideConfig === "object"
      ? overrideConfig
      : namespace.functionsRuntimeConfig?.getDefaultFunctionsConfig?.() || {};
  }

  namespace.cloudApi = {
    authorizeInovaMeetingWorkspaceAccess,
    createInovaMeetingShareLink,
    exchangeInovaMeetingLaunch,
    fetchCapabilityManifest,
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
