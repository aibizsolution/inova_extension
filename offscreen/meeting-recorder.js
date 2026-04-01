(function initMeetingRecorder(global) {
  const INLINE_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
  const TARGET_AUDIO_BITS_PER_SECOND = 30000;
  const recorderState = {
    audioContext: null,
    chunks: [],
    capturedBlob: null,
    capturedCapture: null,
    capturedEndedAt: "",
    capturedStartedAt: "",
    mediaRecorder: null,
    mediaStream: null,
    meetingId: "",
    sourceTabId: 0,
    startedAt: 0,
    title: "",
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "offscreen") {
      return false;
    }

    handleRecorderMessage(message)
      .then((data) => sendResponse(data))
      .catch(async (error) => {
        await notifyRecorderFailure(error, message?.data);
        sendResponse({
          capture: {
            captureMode: normalizeText(message?.data?.captureMode) || "tab-audio",
            error: error instanceof Error ? error.message : String(error),
            status: "error",
          },
          meeting: {
            meetingId: normalizeText(message?.data?.meetingId || message?.data?.sessionId),
            title: normalizeText(message?.data?.title),
          },
        });
      });
    return true;
  });

  async function handleRecorderMessage(message) {
    if (message.type === "inova-meeting:start-capture") {
      return startCapture(message.data);
    }
    if (message.type === "inova-meeting:stop-capture") {
      return stopCapture(message.data);
    }
    if (message.type === "inova-meeting:create-job") {
      return createJobFromCapturedAudio(message.data);
    }
    throw new Error("지원하지 않는 offscreen recorder 요청입니다.");
  }

  async function startCapture(input) {
    if (recorderState.mediaRecorder && recorderState.mediaRecorder.state === "recording") {
      throw new Error("이미 다른 회의 녹음이 진행 중이에요.");
    }

    const meetingId = normalizeText(input?.meetingId || input?.sessionId);
    const title = normalizeText(input?.title);
    const captureMode = normalizeText(input?.captureMode) || "tab-audio";
    const streamId = normalizeText(input?.streamId);
    if (!meetingId || !streamId) {
      throw new Error("녹음 시작에 필요한 정보가 부족해요.");
    }

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: captureMode === "desktop-audio" ? "desktop" : "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

    const mimeType = pickRecorderMimeType();
    const recorderOptions = mimeType
      ? { audioBitsPerSecond: TARGET_AUDIO_BITS_PER_SECOND, mimeType }
      : { audioBitsPerSecond: TARGET_AUDIO_BITS_PER_SECOND };
    const mediaRecorder = new MediaRecorder(mediaStream, recorderOptions);

    clearCapturedSource();
    recorderState.audioContext = audioContext;
    recorderState.chunks = [];
    recorderState.mediaRecorder = mediaRecorder;
    recorderState.mediaStream = mediaStream;
    recorderState.meetingId = meetingId;
    recorderState.sourceTabId = Number(input?.sourceTabId) || 0;
    recorderState.startedAt = Date.now();
    recorderState.title = title;

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        recorderState.chunks.push(event.data);
      }
    });

    mediaRecorder.start(1000);

    return {
      capture: {
        captureMode,
        channelCount: 1,
        mimeType: mimeType || mediaRecorder.mimeType || "audio/webm",
        status: "recording",
      },
      meeting: {
        meetingId,
        sourceTabId: recorderState.sourceTabId,
        startedAt: new Date(recorderState.startedAt).toISOString(),
        title,
      },
    };
  }

  async function stopCapture(input) {
    if (!recorderState.mediaRecorder || recorderState.mediaRecorder.state !== "recording") {
      throw new Error("진행 중인 회의 녹음이 없어요.");
    }

    const captureMode = normalizeText(input?.captureMode) || "tab-audio";
    const meetingId = recorderState.meetingId;
    const title = recorderState.title;
    const durationMs = Math.max(0, Date.now() - recorderState.startedAt);
    const mimeType = recorderState.mediaRecorder.mimeType || "audio/webm";
    const startedAt = recorderState.startedAt > 0 ? new Date(recorderState.startedAt).toISOString() : "";

    return new Promise((resolve, reject) => {
      const mediaRecorder = recorderState.mediaRecorder;
      mediaRecorder.addEventListener("stop", async () => {
        try {
          const blob = new Blob(recorderState.chunks, { type: mimeType });
          recorderState.capturedBlob = blob;
          recorderState.capturedCapture = {
            captureMode,
            channelCount: 1,
            durationMs,
            mimeType,
            sizeBytes: blob.size,
            status: "captured",
          };
          recorderState.capturedEndedAt = new Date().toISOString();
          recorderState.capturedStartedAt = startedAt;
          cleanupActiveRecorder();
          resolve({
            capture: {
              captureMode,
              channelCount: 1,
              durationMs,
              mimeType,
              sizeBytes: blob.size,
              status: "captured",
            },
            meeting: {
              endedAt: recorderState.capturedEndedAt,
              meetingId,
              sourceTabId: recorderState.sourceTabId,
              startedAt,
              title,
            },
          });
        } catch (error) {
          reject(error);
        }
      }, { once: true });

      mediaRecorder.addEventListener("error", (event) => {
        reject(event?.error || new Error("녹음을 마무리하지 못했어요."));
      }, { once: true });

      mediaRecorder.stop();
      recorderState.mediaStream?.getTracks?.().forEach((track) => track.stop());
    });
  }

  async function createJobFromCapturedAudio(input) {
    if (!recorderState.capturedBlob || !recorderState.capturedCapture) {
      throw new Error("업로드할 녹음 source가 아직 준비되지 않았어요.");
    }

    const requestUrl = normalizeText(input?.url);
    const accessToken = normalizeText(input?.accessToken);
    const requestBody = cloneValue(input?.requestBody) || {};
    const meetingId = normalizeText(requestBody?.meeting?.meetingId || recorderState.meetingId);

    if (!requestUrl || !accessToken) {
      throw new Error("회의 업로드 요청 정보가 부족해요.");
    }
    if (!meetingId || meetingId !== recorderState.meetingId) {
      throw new Error("현재 저장된 녹음과 다른 회의로 업로드할 수 없어요.");
    }
    if (recorderState.capturedBlob.size > INLINE_AUDIO_LIMIT_BYTES) {
      throw new Error("현재 임시 업로드 경로는 25MB 이하 녹음만 지원해요.");
    }

    const source = requestBody.source && typeof requestBody.source === "object" ? requestBody.source : {};
    requestBody.source = {
      ...source,
      captureMode: normalizeText(source.captureMode) || recorderState.capturedCapture.captureMode,
      channelCount: Number(source.channelCount) || recorderState.capturedCapture.channelCount,
      durationMs: Number(source.durationMs) || recorderState.capturedCapture.durationMs,
      fileName: normalizeText(source.fileName) || buildMeetingSourceFileName(meetingId, recorderState.capturedCapture.mimeType),
      inlineAudioBase64: await blobToBase64(recorderState.capturedBlob),
      mimeType: normalizeText(source.mimeType) || recorderState.capturedCapture.mimeType,
      sizeBytes: Number(source.sizeBytes) || recorderState.capturedBlob.size,
    };
    requestBody.meeting = {
      ...(requestBody.meeting || {}),
      endedAt: normalizeText(requestBody?.meeting?.endedAt) || recorderState.capturedEndedAt,
      meetingId,
      startedAt: normalizeText(requestBody?.meeting?.startedAt) || recorderState.capturedStartedAt,
      title: normalizeText(requestBody?.meeting?.title) || recorderState.title,
    };

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(normalizeText(payload?.error) || "회의 전사 job을 접수하지 못했어요.");
    }

    clearCapturedSource();
    return payload?.data || {};
  }

  async function notifyRecorderFailure(error, input) {
    const meetingId = normalizeText(input?.meetingId || input?.sessionId) || recorderState.meetingId;
    const title = normalizeText(input?.title) || recorderState.title;
    try {
      await chrome.runtime.sendMessage({
        payload: {
          capture: {
            captureMode: normalizeText(input?.captureMode) || "tab-audio",
            error: error instanceof Error ? error.message : String(error),
          },
          error: error instanceof Error ? error.message : String(error),
          meeting: {
            meetingId,
            title,
          },
        },
        type: "inova-meeting:recorder-failed",
      });
    } finally {
      cleanupRecorderState();
    }
  }

  function cleanupActiveRecorder() {
    try {
      recorderState.audioContext?.close?.();
    } catch {}
    recorderState.audioContext = null;
    recorderState.chunks = [];
    recorderState.mediaRecorder = null;
    recorderState.mediaStream = null;
  }

  function clearCapturedSource() {
    recorderState.capturedBlob = null;
    recorderState.capturedCapture = null;
    recorderState.capturedEndedAt = "";
    recorderState.capturedStartedAt = "";
  }

  function cleanupRecorderState() {
    cleanupActiveRecorder();
    clearCapturedSource();
    recorderState.meetingId = "";
    recorderState.sourceTabId = 0;
    recorderState.startedAt = 0;
    recorderState.title = "";
  }

  function pickRecorderMimeType() {
    for (const mimeType of ["audio/webm;codecs=opus", "audio/webm"]) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(mimeType)) {
        return mimeType;
      }
    }
    return "";
  }

  function buildMeetingSourceFileName(meetingId, mimeType) {
    const extension = String(mimeType || "").includes("webm") ? "webm" : "bin";
    return `${normalizeText(meetingId) || "meeting-source"}.${extension}`;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const result = String(reader.result || "");
        const [, payload] = result.split(",", 2);
        resolve(payload || "");
      }, { once: true });
      reader.addEventListener("error", () => {
        reject(reader.error || new Error("오디오를 인라인 업로드 형식으로 바꾸지 못했어요."));
      }, { once: true });
      reader.readAsDataURL(blob);
    });
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }
})(globalThis);
