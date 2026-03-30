(function initMeetingPageHarnessMock(global) {
  const changeListeners = [];
  const runtimeMessages = [];
  const state = {
    artifactLoads: 0,
    getJobLoads: 0,
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
          mimeType: "audio/webm;codecs=opus",
          channelCount: 1,
          durationMs: 0,
          sizeBytes: 0,
          status: "idle",
        },
        job: {
          artifactId: "meeting-artifact-transcript-1",
          createdAt: "2026-03-30T08:31:08.000Z",
          error: "",
          jobId: "meeting-job-fixture-1",
          progress: {
            percent: 100,
            phase: "completed",
          },
          sourceAudioDeleted: true,
          status: "succeeded",
          updatedAt: "2026-03-30T08:32:00.000Z",
        },
        transcript: {
          artifactId: "meeting-artifact-transcript-1",
          text: "",
          segments: [],
          speakerCount: 0,
          loadedAt: "",
        },
        records: [
          {
            artifactId: "meeting-artifact-transcript-1",
            createdAt: "2026-03-30T08:31:08.000Z",
            error: "",
            jobId: "meeting-job-fixture-1",
            previewText: "신규 프로모션 일정을 이번 주 안에 확정합시다.",
            sessionId: "fixture-session",
            speakerCount: 2,
            status: "succeeded",
            title: "신규 프로모션 회의",
            updatedAt: "2026-03-30T08:32:00.000Z",
          },
        ],
      },
      meetingStateBySession: {},
    },
  };

  state.storage.meetingStateBySession["fixture-session"] = cloneValue(state.storage.meetingState);

  installChromeMocks(global);

  global.__INOVA_MEETING_PAGE_HARNESS__ = {
    state,
    runtimeMessages,
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
        commitStorageState(partial);
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
    chromeObject.runtime = chromeObject.runtime || {
      async sendMessage(message) {
        runtimeMessages.push(cloneValue(message));
        if (message?.type === "inova-meeting:start-capture") {
          return buildCaptureStartResponse(message.input);
        }
        if (message?.type === "inova-meeting:stop-capture") {
          return buildCaptureStopResponse(message.input);
        }
        if (message?.type === "inova-meeting:create-job") {
          return buildCreateJobResponse(message.input);
        }
        if (message?.type === "inova-meeting:get-job") {
          return buildGetJobResponse(message.input);
        }
        if (message?.type === "inova-meeting:get-artifact") {
          return buildGetArtifactResponse(message.input);
        }
        if (message?.type === "inova-meeting:list-results") {
          return buildListResultsResponse(message.input);
        }
        return { ok: false, error: `Unhandled meeting page harness message: ${message?.type}` };
      },
    };
  }

  function buildCaptureStartResponse(input) {
    const response = {
      capture: {
        captureMode: normalizeText(input?.captureMode) || "tab-audio",
        mimeType: "audio/webm;codecs=opus",
        status: "recording",
      },
      meeting: {
        startedAt: "2026-03-30T09:00:00.000Z",
        sessionId: normalizeText(input?.sessionId),
        title: normalizeText(input?.title) || "신규 프로모션 회의",
      },
    };
    const nextMeetingState = applyMeetingStateTransform("fixture-session", response, "applyMeetingCaptureStarted", {
      capture: response.capture,
      session: response.meeting,
    });
    setMeetingStateForSession("fixture-session", nextMeetingState);
    return { ok: true, data: response };
  }

  function buildCaptureStopResponse(input) {
    const current = getMeetingStateForSession(normalizeText(input?.sessionId));
    const response = {
      capture: {
        captureMode: normalizeText(current?.capture?.captureMode) || "tab-audio",
        channelCount: 1,
        durationMs: 61000,
        mimeType: "audio/webm;codecs=opus",
        sizeBytes: 1048576,
        status: "captured",
      },
      meeting: {
        endedAt: "2026-03-30T09:01:01.000Z",
        sessionId: normalizeText(input?.sessionId),
        startedAt: "2026-03-30T09:00:00.000Z",
        title: normalizeText(current?.session?.title) || "신규 프로모션 회의",
      },
    };
    const nextMeetingState = applyMeetingStateTransform("fixture-session", response, "applyMeetingCaptureFinished", {
      capture: response.capture,
      session: response.meeting,
    });
    setMeetingStateForSession("fixture-session", nextMeetingState);
    return { ok: true, data: response };
  }

  function buildCreateJobResponse(input) {
    return {
      ok: true,
      data: {
        job: {
          artifacts: [],
          createdAt: "2026-03-30T09:01:08.000Z",
          error: "",
          jobId: "meeting-job-fixture-2",
          progress: {
            percent: 0,
            phase: "queued",
          },
          sessionId: normalizeText(input?.meeting?.sessionId),
          source: {
            captureMode: normalizeText(input?.source?.captureMode) || "tab-audio",
            durationMs: Number(input?.source?.durationMs) || 61000,
            mimeType: normalizeText(input?.source?.mimeType) || "audio/webm;codecs=opus",
            sizeBytes: Number(input?.source?.sizeBytes) || 1048576,
          },
          status: "queued",
          updatedAt: "2026-03-30T09:01:08.000Z",
        },
      },
    };
  }

  function buildGetJobResponse(input) {
    state.getJobLoads += 1;
    const jobId = normalizeText(input?.jobId);
    if (jobId === "meeting-job-fixture-2") {
      return {
        ok: true,
        data: {
          job: {
            artifacts: [
              {
                artifactId: "meeting-artifact-transcript-2",
                createdAt: "2026-03-30T09:01:18.000Z",
                format: "diarized_json",
                jobId: "meeting-job-fixture-2",
                kind: "transcript",
              },
            ],
            createdAt: "2026-03-30T09:01:08.000Z",
            error: "",
            jobId: "meeting-job-fixture-2",
            progress: {
              percent: 100,
              phase: "completed",
            },
            sessionId: "fixture-session",
            status: "succeeded",
            transcript: {
              artifactId: "meeting-artifact-transcript-2",
              segments: [],
              text: "",
            },
            transcription: {
              speakerCount: 2,
            },
            updatedAt: "2026-03-30T09:01:18.000Z",
          },
        },
      };
    }
    return {
      ok: true,
      data: {
        job: {
          artifacts: [
            {
              artifactId: "meeting-artifact-transcript-1",
              createdAt: "2026-03-30T08:31:08.000Z",
              format: "diarized_json",
              jobId: "meeting-job-fixture-1",
              kind: "transcript",
            },
          ],
          createdAt: "2026-03-30T08:31:08.000Z",
          error: "",
          jobId: "meeting-job-fixture-1",
          progress: {
            percent: 100,
            phase: "completed",
          },
          sessionId: "fixture-session",
          status: "succeeded",
          transcript: {
            artifactId: "meeting-artifact-transcript-1",
            segments: [],
            text: "",
          },
          transcription: {
            speakerCount: 2,
          },
          updatedAt: "2026-03-30T08:32:00.000Z",
        },
      },
    };
  }

  function buildGetArtifactResponse(input) {
    state.artifactLoads += 1;
    const artifactId = normalizeText(input?.artifactId);
    const artifactMap = {
      "meeting-artifact-transcript-1": {
        artifactId: "meeting-artifact-transcript-1",
        jobId: "meeting-job-fixture-1",
        segments: [
          {
            endMs: 5300,
            speakerLabel: "SPEAKER_00",
            startMs: 0,
            text: "신규 프로모션 일정을 이번 주 안에 확정합시다.",
          },
          {
            endMs: 10400,
            speakerLabel: "SPEAKER_01",
            startMs: 5400,
            text: "예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
          },
        ],
        text: "SPEAKER_00: 신규 프로모션 일정을 이번 주 안에 확정합시다.\nSPEAKER_01: 예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
      },
      "meeting-artifact-transcript-2": {
        artifactId: "meeting-artifact-transcript-2",
        jobId: "meeting-job-fixture-2",
        segments: [
          {
            endMs: 4200,
            speakerLabel: "SPEAKER_00",
            startMs: 0,
            text: "오늘 안건은 신규 런칭 일정과 예산 정리입니다.",
          },
          {
            endMs: 9100,
            speakerLabel: "SPEAKER_01",
            startMs: 4400,
            text: "광고 문구 초안은 오후까지 공유하겠습니다.",
          },
        ],
        text: "SPEAKER_00: 오늘 안건은 신규 런칭 일정과 예산 정리입니다.\nSPEAKER_01: 광고 문구 초안은 오후까지 공유하겠습니다.",
      },
    };
    return {
      ok: true,
      data: {
        artifact: cloneValue(artifactMap[artifactId] || artifactMap["meeting-artifact-transcript-1"]),
      },
    };
  }

  function buildListResultsResponse(input) {
    const sessionId = normalizeText(input?.sessionId) || "fixture-session";
    const meetingState = getMeetingStateForSession(sessionId);
    return {
      ok: true,
      data: {
        items: cloneValue(Array.isArray(meetingState.records) ? meetingState.records : []),
        session: {
          endedAt: normalizeText(meetingState?.session?.endedAt),
          language: normalizeText(meetingState?.session?.language) || "ko",
          sessionId,
          startedAt: normalizeText(meetingState?.session?.startedAt),
          title: normalizeText(meetingState?.session?.title) || "신규 프로모션 회의",
        },
      },
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
    return cloneValue(state.storage.meetingStateBySession[normalizeText(sessionId)] || state.storage.meetingState || {});
  }

  function setMeetingStateForSession(sessionId, nextMeetingState) {
    const nextMeetingStateBySession = {
      ...(state.storage.meetingStateBySession || {}),
      [normalizeText(sessionId)]: cloneValue(nextMeetingState || {}),
    };
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
    changeListeners.forEach((listener) => listener(changes, "local"));
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

  function normalizeText(value) {
    return String(value || "").trim();
  }
})(globalThis);
