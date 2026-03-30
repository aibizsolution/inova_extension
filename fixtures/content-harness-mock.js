(function initContentHarnessMock(global) {
  const now = "2026-03-30T09:00:00.000Z";
  const manifestVersion = "0.3.7";
  const changeListeners = [];
  const runtimeLog = [];
  const copiedTexts = [];
  const openedUrls = [];
  const storeEntries = [
    {
      entryId: "store-entry-1",
      categoryId: "meeting",
      title: "회의 액션 아이템 정리",
      summary: "논의 내용을 액션 아이템 중심으로 정리하는 템플릿",
      content: "다음 회의 내용을 읽고 액션 아이템, 담당자, 일정 리스크를 표 형식으로 정리해 주세요.",
      owner: {
        displayName: "AI Biz Team",
        kind: "system",
        maskedEmail: "",
        providerUserKey: "system",
      },
      publishedAt: "2026-03-28T03:00:00.000Z",
      updatedAt: "2026-03-28T03:00:00.000Z",
      metrics: {
        importCount: 18,
        likeCount: 11,
        viewCount: 33,
      },
      viewer: {
        imported: false,
        liked: false,
        viewed: false,
      },
    },
    {
      entryId: "store-entry-2",
      categoryId: "summary",
      title: "긴 대화 핵심 요약",
      summary: "긴 채팅 로그를 짧은 핵심 요약으로 바꾸는 템플릿",
      content: "아래 대화를 5문장 이내 핵심 요약, 결정사항, 후속 질문으로 나눠 정리해 주세요.",
      owner: {
        displayName: "Park",
        kind: "user",
        maskedEmail: "yt****@gmail.com",
        providerUserKey: "fixture-user",
      },
      publishedAt: "2026-03-27T02:00:00.000Z",
      updatedAt: "2026-03-27T02:00:00.000Z",
      metrics: {
        importCount: 7,
        likeCount: 5,
        viewCount: 12,
      },
      viewer: {
        imported: true,
        liked: true,
        viewed: true,
      },
    },
  ];
  const storageState = {
    settings: {
      enabled: true,
      autoBookmark: true,
    },
    pausedSessions: {},
    uiPreferences: {
      activeTool: "bookmarks",
      activePromptTab: "library",
      handleRatios: {
        wide: 0.38,
        compact: 0.46,
      },
    },
    promptLibrary: {
      version: 1,
      items: [
        {
          id: "prompt-fixture-1",
          title: "회의 요약 초안",
          content: "아래 회의 내용을 핵심 결정, 남은 쟁점, 다음 액션으로 나눠 정리해 주세요.",
          createdAt: "2026-03-26T01:00:00.000Z",
          updatedAt: "2026-03-26T01:00:00.000Z",
        },
        {
          id: "prompt-fixture-2",
          title: "브리핑용 질문 재작성",
          content: "아래 질문을 임원 브리핑용으로 더 짧고 명확하게 다듬어 주세요.",
          createdAt: "2026-03-25T01:00:00.000Z",
          updatedAt: "2026-03-25T01:00:00.000Z",
        },
      ],
    },
    cloudSync: {
      version: 1,
      status: "synced",
      providerIdentity: {
        provider: "inova",
        available: true,
        providerUserKey: "fixture-user",
        email: "fixture@example.com",
        displayName: "Harness User",
        numericUserId: 1001,
      },
      pending: null,
      lastSyncedAt: now,
      lastError: "",
      remote: {
        checkedAt: now,
        found: false,
        itemCount: 0,
        lastRevision: "",
        lastSyncedAt: "",
        providerUserKey: "fixture-user",
        updatedAt: "",
        version: 1,
      },
    },
    releaseInfo: {
      version: 1,
      checkedAt: now,
      checkedForVersion: manifestVersion,
      historyCheckedAt: now,
      historyCheckedForVersion: manifestVersion,
      error: "",
      latest: {
        version: "0.3.8",
        level: "minor",
        headline: "Harness local preview",
        summary: "Local harness and smoke checks are available.",
        changes: [
          { type: "added", text: "Added a local browser harness page." },
          { type: "fixed", text: "Added DOM smoke verification." },
        ],
        publishedAt: now,
        fileName: "inova-extension-0.3.8.zip",
        downloadUrl: "https://browser-extension-main.web.app/extension/downloads/latest.zip",
        versionDownloadUrl: "https://browser-extension-main.web.app/extension/downloads/inova-extension-0.3.8.zip",
        notes: "Fixture release",
        sha256: "fixture",
        sizeBytes: 204800,
        minSupportedVersion: "0.3.8",
      },
      history: [
        {
          version: "0.3.7",
          level: "patch",
          headline: "Prompt store polish",
          summary: "Small prompt store and release panel refinements.",
          changes: [{ type: "fixed", text: "Improved store loading feedback." }],
          publishedAt: "2026-03-27T01:00:00.000Z",
          fileName: "inova-extension-0.3.7.zip",
          downloadUrl: "https://browser-extension-main.web.app/extension/downloads/inova-extension-0.3.7.zip",
          versionDownloadUrl: "https://browser-extension-main.web.app/extension/downloads/inova-extension-0.3.7.zip",
          notes: "Fixture release history",
          sha256: "fixture-37",
          sizeBytes: 198000,
          minSupportedVersion: "0.3.7",
        },
      ],
    },
    meetingState: {
      version: 1,
      session: {
        sessionId: "fixture-session",
        title: "신규 프로모션 회의",
        startedAt: "2026-03-30T08:20:00.000Z",
        endedAt: "2026-03-30T08:31:00.000Z",
        language: "ko",
      },
      capture: {
        captureMode: "tab-audio",
        error: "",
        mimeType: "audio/webm",
        channelCount: 1,
        durationMs: 660000,
        sizeBytes: 7340032,
        status: "uploaded",
      },
      job: {
        jobId: "meeting-job-fixture-1",
        status: "succeeded",
        updatedAt: now,
        progress: {
          phase: "completed",
          percent: 100,
        },
        artifactId: "meeting-artifact-transcript-1",
        error: "",
        sourceAudioDeleted: true,
      },
      transcript: {
        artifactId: "meeting-artifact-transcript-1",
        text: "SPEAKER_00: 신규 프로모션 일정을 이번 주 안에 확정합시다.\nSPEAKER_01: 예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
        segments: [
          {
            startMs: 0,
            endMs: 5300,
            speakerLabel: "SPEAKER_00",
            text: "신규 프로모션 일정을 이번 주 안에 확정합시다.",
          },
          {
            startMs: 5400,
            endMs: 10400,
            speakerLabel: "SPEAKER_01",
            text: "예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
          },
        ],
        speakerCount: 2,
        loadedAt: now,
      },
    },
    meetingStateBySession: {
      "fixture-session": {
        version: 1,
        session: {
          sessionId: "fixture-session",
          title: "신규 프로모션 회의",
          startedAt: "2026-03-30T08:20:00.000Z",
          endedAt: "2026-03-30T08:31:00.000Z",
          language: "ko",
        },
        capture: {
          captureMode: "tab-audio",
          error: "",
          mimeType: "audio/webm",
          channelCount: 1,
          durationMs: 660000,
          sizeBytes: 7340032,
          status: "uploaded",
        },
        job: {
          jobId: "meeting-job-fixture-1",
          status: "succeeded",
          updatedAt: now,
          progress: {
            phase: "completed",
            percent: 100,
          },
          artifactId: "meeting-artifact-transcript-1",
          error: "",
          sourceAudioDeleted: true,
        },
        transcript: {
          artifactId: "meeting-artifact-transcript-1",
          text: "SPEAKER_00: 신규 프로모션 일정을 이번 주 안에 확정합시다.\nSPEAKER_01: 예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
          segments: [
            {
              startMs: 0,
              endMs: 5300,
              speakerLabel: "SPEAKER_00",
              text: "신규 프로모션 일정을 이번 주 안에 확정합시다.",
            },
            {
              startMs: 5400,
              endMs: 10400,
              speakerLabel: "SPEAKER_01",
              text: "예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
            },
          ],
          speakerCount: 2,
          loadedAt: now,
        },
      },
    },
  };

  ensureHarnessLocation(global);
  ensureHarnessAuth(global);
  ensureAnimationStubs(global);
  ensureResizeObserver(global);
  ensureClipboard(global);
  installChromeMocks(global);

  global.__INOVA_HARNESS__ = {
    copiedTexts,
    openedUrls,
    runtimeLog,
    storageState,
  };

  function ensureHarnessLocation(target) {
    try {
      const url = new URL(target.location.href);
      if (!url.searchParams.get("sid")) {
        url.searchParams.set("sid", "fixture-session");
        target.history.replaceState({}, "", url.toString());
      }
      target.sessionStorage?.setItem("inova-plus.panel-open", "true");
    } catch {}
  }

  function ensureHarnessAuth(target) {
    const authPayload = JSON.stringify({
      userInfo: {
        id: 1001,
        userKey: "fixture-user",
        email: "fixture@example.com",
        name: "Harness User",
      },
    });
    target.localStorage?.setItem("auth", authPayload);
    target.localStorage?.setItem("userInfo", authPayload);
  }

  function ensureAnimationStubs(target) {
    if (typeof target.requestAnimationFrame !== "function") {
      target.requestAnimationFrame = function requestAnimationFrame(callback) {
        return target.setTimeout(() => callback(Date.now()), 16);
      };
    }
    if (typeof target.cancelAnimationFrame !== "function") {
      target.cancelAnimationFrame = function cancelAnimationFrame(handle) {
        target.clearTimeout(handle);
      };
    }
    if (typeof target.scrollTo !== "function") {
      target.scrollTo = function scrollTo() {};
    }
  }

  function ensureResizeObserver(target) {
    if (typeof target.ResizeObserver === "function") {
      return;
    }
    target.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  function ensureClipboard(target) {
    if (!target.navigator) {
      target.navigator = {};
    }
    if (!target.navigator.clipboard) {
      Object.defineProperty(target.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            copiedTexts.push(String(text || ""));
          },
        },
      });
      return;
    }

    const original = target.navigator.clipboard.writeText?.bind(target.navigator.clipboard);
    target.navigator.clipboard.writeText = async (text) => {
      copiedTexts.push(String(text || ""));
      if (original) {
        return original(text);
      }
    };
  }

  function installChromeMocks(target) {
    const chromeObject = target.chrome || (target.chrome = {});
    chromeObject.runtime = {
      ...(chromeObject.runtime || {}),
      getManifest: () => ({ version: manifestVersion }),
      onMessage: chromeObject.runtime?.onMessage || { addListener() {}, removeListener() {} },
      sendMessage: async (message) => handleRuntimeMessage(message),
    };

    chromeObject.storage = chromeObject.storage || {};
    chromeObject.storage.local = {
      async get(keys) {
        if (keys && typeof keys === "object" && !Array.isArray(keys)) {
          return mergeObjects(keys, storageState);
        }
        if (Array.isArray(keys)) {
          return keys.reduce((result, key) => {
            result[key] = cloneValue(storageState[key]);
            return result;
          }, {});
        }
        if (typeof keys === "string") {
          return { [keys]: cloneValue(storageState[keys]) };
        }
        return cloneValue(storageState);
      },
      async set(partial) {
        const changes = {};
        for (const [key, value] of Object.entries(partial || {})) {
          const previousValue = cloneValue(storageState[key]);
          storageState[key] = cloneValue(value);
          changes[key] = {
            oldValue: previousValue,
            newValue: cloneValue(storageState[key]),
          };
        }
        changeListeners.forEach((listener) => listener(changes, "local"));
      },
    };

    chromeObject.storage.onChanged = chromeObject.storage.onChanged || {
      addListener(listener) {
        changeListeners.push(listener);
      },
      removeListener(listener) {
        const index = changeListeners.indexOf(listener);
        if (index >= 0) {
          changeListeners.splice(index, 1);
        }
      },
    };
  }

  async function handleRuntimeMessage(message) {
    const type = String(message?.type || "");
    runtimeLog.push({
      payload: cloneValue(message),
      type,
    });

    if (type === "inova-sync:peek-prompt-library") {
      return {
        ok: true,
        data: {
          checkedAt: new Date().toISOString(),
          found: false,
          itemCount: 0,
          lastRevision: "",
          lastSyncedAt: "",
          providerUserKey: "fixture-user",
          updatedAt: "",
          version: 1,
        },
      };
    }

    if (type === "inova-sync:load-prompt-library") {
      return {
        ok: true,
        data: {
          found: false,
          libraryId: "fixture-library",
          owner: cloneValue(storageState.cloudSync.providerIdentity),
          promptLibrary: {
            itemCount: 0,
            items: [],
            updatedAt: "",
            version: 1,
          },
          syncedAt: "",
        },
      };
    }

    if (type === "inova-sync:sync-prompt-library") {
      return {
        ok: true,
        data: {
          owner: cloneValue(storageState.cloudSync.providerIdentity),
          syncedAt: new Date().toISOString(),
        },
      };
    }

    if (type === "inova-store:list") {
      return {
        ok: true,
        data: {
          availableCategories: buildAvailableCategories(storeEntries),
          hasMore: false,
          items: filterStoreEntries(storeEntries, message?.filter, storageState.cloudSync.providerIdentity.providerUserKey),
          totalCount: filterStoreEntries(storeEntries, { ...(message?.filter || {}), limit: 1000 }, storageState.cloudSync.providerIdentity.providerUserKey).length,
        },
      };
    }

    if (type === "inova-store:publish") {
      const entry = {
        entryId: `store-entry-${Date.now().toString(36)}`,
        categoryId: String(message?.categoryId || "other"),
        title: String(message?.prompt?.title || "새 프롬프트"),
        summary: "Harness local publish preview",
        content: String(message?.prompt?.content || ""),
        owner: {
          displayName: "Harness User",
          kind: "user",
          maskedEmail: "fi****@example.com",
          providerUserKey: "fixture-user",
        },
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metrics: {
          importCount: 0,
          likeCount: 0,
          viewCount: 0,
        },
        viewer: {
          imported: false,
          liked: false,
          viewed: false,
        },
      };
      storeEntries.unshift(entry);
      return { ok: true, data: { entry: cloneValue(entry) } };
    }

    if (type === "inova-store:unpublish") {
      removeStoreEntry(String(message?.entryId || ""));
      return { ok: true, data: { removed: true } };
    }

    if (type === "inova-store:view") {
      const entry = updateStoreEntry(String(message?.entryId || ""), (current) => ({
        ...current,
        metrics: {
          ...current.metrics,
          viewCount: Number(current.metrics.viewCount || 0) + 1,
        },
        viewer: {
          ...current.viewer,
          viewed: true,
        },
      }));
      return { ok: true, data: { entry: cloneValue(entry) } };
    }

    if (type === "inova-store:import") {
      const entry = updateStoreEntry(String(message?.entryId || ""), (current) => ({
        ...current,
        metrics: {
          ...current.metrics,
          importCount: Number(current.metrics.importCount || 0) + 1,
        },
        viewer: {
          ...current.viewer,
          imported: true,
        },
      }));
      return { ok: true, data: { entry: cloneValue(entry) } };
    }

    if (type === "inova-store:toggle-like") {
      const entry = updateStoreEntry(String(message?.entryId || ""), (current) => {
        const nextLiked = !current.viewer.liked;
        return {
          ...current,
          metrics: {
            ...current.metrics,
            likeCount: Math.max(0, Number(current.metrics.likeCount || 0) + (nextLiked ? 1 : -1)),
          },
          viewer: {
            ...current.viewer,
            liked: nextLiked,
          },
        };
      });
      return { ok: true, data: { entry: cloneValue(entry) } };
    }

    if (type === "inova-review:prompt") {
      return {
        ok: true,
        data: {
          verdict: "revise",
          totalScore: 74,
          summary: "Prompt intent is understandable, but constraints and output shape can be clearer.",
          checks: [
            { label: "Context", status: "partial", feedback: "Background is present, but audience and situation are not specific." },
            { label: "Goal", status: "good", feedback: "The desired outcome is clear." },
            { label: "Constraints", status: "missing", feedback: "Important constraints or boundaries are not stated." },
            { label: "Output", status: "partial", feedback: "A preferred output structure would make the answer more reusable." },
          ],
          quickImprovements: [
            "Add the target audience and urgency.",
            "State what should not be included.",
            "Ask for a fixed response structure.",
          ],
          refinedPrompt: "Below is the original request. Rewrite it for an executive audience, keep it under 5 bullet points, and end with one recommended next action. Original request: [original request]",
        },
      };
    }

    if (type === "inova-release:latest") {
      return {
        ok: true,
        data: {
          release: cloneValue(storageState.releaseInfo.latest),
        },
      };
    }

    if (type === "inova-release:history") {
      return {
        ok: true,
        data: {
          releases: cloneValue(storageState.releaseInfo.history),
        },
      };
    }

    if (type === "inova-release:open-url") {
      const url = String(message?.url || "");
      if (url) {
        openedUrls.push(url);
        if (typeof targetOpen === "function") {
          targetOpen(url, "_blank", "noopener");
        }
      }
      return { ok: true, data: { opened: Boolean(url) } };
    }

    return {
      ok: false,
      error: `Unhandled harness runtime message: ${type}`,
    };
  }

  function buildAvailableCategories(entries) {
    const ids = new Set(entries.map((entry) => String(entry.categoryId || "").trim()).filter(Boolean));
    return Array.from(ids).sort().map((id) => ({ id }));
  }

  function filterStoreEntries(entries, filter, providerUserKey) {
    const categoryId = String(filter?.categoryId || "all");
    const ownerOnly = Boolean(filter?.ownerOnly);
    const query = String(filter?.query || "").trim().toLowerCase();
    return entries
      .filter((entry) => !ownerOnly || entry.owner.providerUserKey === providerUserKey)
      .filter((entry) => categoryId === "all" || entry.categoryId === categoryId)
      .filter((entry) => {
        if (!query) {
          return true;
        }
        return `${entry.title} ${entry.summary} ${entry.content}`.toLowerCase().includes(query);
      })
      .map((entry) => cloneValue(entry));
  }

  function updateStoreEntry(entryId, mapper) {
    const index = storeEntries.findIndex((entry) => entry.entryId === entryId);
    if (index === -1) {
      return null;
    }
    storeEntries[index] = mapper(cloneValue(storeEntries[index]));
    return storeEntries[index];
  }

  function removeStoreEntry(entryId) {
    const index = storeEntries.findIndex((entry) => entry.entryId === entryId);
    if (index >= 0) {
      storeEntries.splice(index, 1);
    }
  }

  function mergeObjects(base, patch) {
    if (Array.isArray(base)) {
      return cloneValue(patch ?? base);
    }
    const result = {};
    for (const key of Object.keys(base || {})) {
      const baseValue = base[key];
      const patchValue = patch == null ? undefined : patch[key];
      if (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)) {
        result[key] = mergeObjects(baseValue, patchValue || {});
      } else if (patchValue !== undefined) {
        result[key] = cloneValue(patchValue);
      } else {
        result[key] = cloneValue(baseValue);
      }
    }
    for (const key of Object.keys(patch || {})) {
      if (!(key in result)) {
        result[key] = cloneValue(patch[key]);
      }
    }
    return result;
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  const targetOpen = typeof global.open === "function" ? global.open.bind(global) : null;
})(globalThis);
