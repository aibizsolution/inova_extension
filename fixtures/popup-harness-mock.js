(function initPopupHarnessMock(global) {
  const changeListeners = [];
  const state = {
    activeTab: {
      id: 91,
      title: "i-Nova Fixture Session",
      url: "https://inova.incross.com/chat?sid=fixture-session",
    },
    runtimeMessages: [],
    storage: {
      cloudSync: {
        providerIdentity: {
          available: true,
          displayName: "Harness User",
          email: "fixture@example.com",
          numericUserId: 1001,
          provider: "inova",
          providerUserKey: "fixture-user",
        },
      },
      meetingStateBySession: {
        "fixture-session": {
          session: {
            sessionId: "fixture-session",
            title: "주간 스탠드업",
          },
          job: {
            jobId: "job_fixture_01",
            progress: {
              percent: 42,
              phase: "transcribing",
            },
            status: "processing",
          },
        },
      },
      meetingState: {
        session: {
          sessionId: "fixture-session",
          title: "주간 스탠드업",
        },
        job: {
          jobId: "job_fixture_01",
          progress: {
            percent: 42,
            phase: "transcribing",
          },
          status: "processing",
        },
      },
      pausedSessions: {},
      settings: {
        autoBookmark: true,
        enabled: true,
      },
    },
  };

  installChromeMocks(global);

  global.__INOVA_POPUP_HARNESS__ = {
    state,
    setActiveTab(nextTab) {
      state.activeTab = {
        id: Number(nextTab?.id) || 0,
        title: String(nextTab?.title || ""),
        url: String(nextTab?.url || ""),
      };
    },
    setMeetingState(nextMeetingState) {
      const nextSessionId = String(nextMeetingState?.session?.sessionId || "").trim();
      const nextMeetingStateBySession = nextSessionId
        ? {
            ...(state.storage.meetingStateBySession || {}),
            [nextSessionId]: cloneValue(nextMeetingState || {}),
          }
        : { ...(state.storage.meetingStateBySession || {}) };
      commitStorageState({
        meetingState: cloneValue(nextMeetingState || {}),
        meetingStateBySession: nextMeetingStateBySession,
      });
    },
  };

  function installChromeMocks(target) {
    const chromeObject = target.chrome || (target.chrome = {});
    chromeObject.storage = chromeObject.storage || {};
    chromeObject.storage.local = {
      async get(keys) {
        if (Array.isArray(keys)) {
          return keys.reduce((result, key) => {
            result[key] = cloneValue(state.storage[key]);
            return result;
          }, {});
        }
        if (typeof keys === "string") {
          return { [keys]: cloneValue(state.storage[keys]) };
        }
        if (keys && typeof keys === "object") {
          return mergeObjects(keys, state.storage);
        }
        return cloneValue(state.storage);
      },
      async set(partial) {
        const changes = {};
        for (const [key, value] of Object.entries(partial || {})) {
          const previousValue = cloneValue(state.storage[key]);
          state.storage[key] = cloneValue(value);
          changes[key] = {
            oldValue: previousValue,
            newValue: cloneValue(state.storage[key]),
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
    chromeObject.tabs = chromeObject.tabs || {
      async query() {
        return [cloneValue(state.activeTab)];
      },
    };
    chromeObject.runtime = chromeObject.runtime || {
      async sendMessage(message) {
        state.runtimeMessages.push(cloneValue(message));
        if (message?.type === "inova-meeting:start-capture") {
          return buildMeetingCaptureStartResponse(message?.input);
        }
        if (message?.type === "inova-meeting:stop-capture") {
          return buildMeetingCaptureStopResponse(message?.input);
        }
        if (message?.type === "inova-meeting:create-job") {
          return buildMeetingCreateResponse(message?.input, message?.providerIdentity);
        }
        return { ok: false, error: "Unexpected popup harness message" };
      },
    };
  }

  function buildMeetingCaptureStartResponse(input) {
    const sessionId = normalizeText(input?.sessionId);
    const response = {
      capture: {
        captureMode: normalizeText(input?.captureMode) || "tab-audio",
        mimeType: "audio/webm;codecs=opus",
        status: "recording",
      },
      meeting: {
        startedAt: "2026-03-30T08:00:00.000Z",
        sessionId: sessionId,
        title: normalizeText(input?.title) || state.activeTab.title,
      },
    };
    const nextMeetingState = applyMeetingStateTransform(
      sessionId,
      response,
      "applyMeetingCaptureStarted",
      {
        capture: response.capture,
        session: response.meeting,
      }
    );
    setMeetingStateForSession(sessionId, nextMeetingState);
    return {
      data: response,
      ok: true,
    };
  }

  function buildMeetingCaptureStopResponse(input) {
    const sessionId = normalizeText(input?.sessionId);
    const currentMeetingState = getMeetingStateForSession(sessionId);
    const response = {
      capture: {
        captureMode: normalizeText(currentMeetingState?.capture?.captureMode) || "tab-audio",
        channelCount: 1,
        durationMs: 65000,
        mimeType: normalizeText(currentMeetingState?.capture?.mimeType) || "audio/webm;codecs=opus",
        sizeBytes: 1048576,
        status: "captured",
      },
      meeting: {
        endedAt: "2026-03-30T08:01:05.000Z",
        sessionId: sessionId,
        startedAt: normalizeText(currentMeetingState?.session?.startedAt) || "2026-03-30T08:00:00.000Z",
        title: normalizeText(currentMeetingState?.session?.title) || state.activeTab.title,
      },
    };
    const nextMeetingState = applyMeetingStateTransform(
      sessionId,
      response,
      "applyMeetingCaptureFinished",
      {
        capture: response.capture,
        session: response.meeting,
      }
    );
    setMeetingStateForSession(sessionId, nextMeetingState);
    return {
      data: response,
      ok: true,
    };
  }

  function buildMeetingCreateResponse(input, providerIdentity) {
    if (!normalizeText(providerIdentity?.providerUserKey)) {
      return {
        error: "현재 i-Nova 사용자 정보를 아직 확인하지 못했어요.",
        ok: false,
      };
    }
    const sessionId = normalizeText(input?.meeting?.sessionId);
    return {
      data: {
        job: {
          artifacts: [],
          createdAt: "2026-03-30T08:01:08.000Z",
          jobId: "job_fixture_capture_01",
          queuedAt: "2026-03-30T08:01:08.000Z",
          sessionId,
          source: {
            captureMode: normalizeText(input?.source?.captureMode) || "tab-audio",
            durationMs: Number(input?.source?.durationMs) || 65000,
            expiresAt: "2026-03-30T09:01:08.000Z",
            mimeType: normalizeText(input?.source?.mimeType) || "audio/webm;codecs=opus",
            sizeBytes: Number(input?.source?.sizeBytes) || 1048576,
            storageObject: "tmp/meetings/job_fixture_capture_01.webm",
            uploadStatus: "uploaded",
          },
          status: "queued",
          updatedAt: "2026-03-30T08:01:08.000Z",
        },
      },
      ok: true,
    };
  }

  function applyMeetingStateTransform(sessionId, payload, methodName, fallbackState) {
    const namespace = global.InovaBookmarks || {};
    const currentMeetingState = getMeetingStateForSession(sessionId);
    const transform = namespace.meetingState && namespace.meetingState[methodName];
    if (typeof transform === "function") {
      return transform(currentMeetingState, payload);
    }
    const mergeMeetingState = namespace.meetingState?.mergeMeetingState;
    if (typeof mergeMeetingState === "function") {
      return mergeMeetingState(currentMeetingState, fallbackState);
    }
    return cloneValue(fallbackState);
  }

  function getMeetingStateForSession(sessionId) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return cloneValue(state.storage.meetingState);
    }
    return cloneValue(state.storage.meetingStateBySession?.[normalizedSessionId] || {});
  }

  function setMeetingStateForSession(sessionId, nextMeetingState) {
    const normalizedSessionId = normalizeText(sessionId);
    const nextMeetingStateBySession = {
      ...(state.storage.meetingStateBySession || {}),
    };
    if (normalizedSessionId) {
      nextMeetingStateBySession[normalizedSessionId] = cloneValue(nextMeetingState || {});
    }
    commitStorageState({
      meetingState: cloneValue(nextMeetingState || {}),
      meetingStateBySession: nextMeetingStateBySession,
    });
  }

  function commitStorageState(partial) {
    const changes = {};
    for (const [key, value] of Object.entries(partial || {})) {
      const previousValue = cloneValue(state.storage[key]);
      state.storage[key] = cloneValue(value);
      changes[key] = {
        oldValue: previousValue,
        newValue: cloneValue(state.storage[key]),
      };
    }
    emitStorageChanges(changes);
  }

  function emitStorageChanges(changes) {
    changeListeners.forEach((listener) => listener(changes, "local"));
  }

  function mergeObjects(defaults, values) {
    const result = {};
    for (const key of Object.keys(defaults || {})) {
      const defaultValue = defaults[key];
      const nextValue = values == null ? undefined : values[key];
      if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
        result[key] = mergeObjects(defaultValue, nextValue || {});
      } else if (nextValue !== undefined) {
        result[key] = cloneValue(nextValue);
      } else {
        result[key] = cloneValue(defaultValue);
      }
    }
    for (const key of Object.keys(values || {})) {
      if (!(key in result)) {
        result[key] = cloneValue(values[key]);
      }
    }
    return result;
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }
})(globalThis);
