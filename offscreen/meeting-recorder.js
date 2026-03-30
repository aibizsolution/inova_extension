(function initMeetingRecorder(global) {
  const recorderState = {
    audioContext: null,
    chunks: [],
    mediaRecorder: null,
    mediaStream: null,
    sessionId: "",
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
            sessionId: normalizeText(message?.data?.sessionId),
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
    throw new Error("지원하지 않는 offscreen recorder 요청입니다.");
  }

  async function startCapture(input) {
    if (recorderState.mediaRecorder && recorderState.mediaRecorder.state === "recording") {
      throw new Error("이미 다른 회의 녹음이 진행 중이에요.");
    }

    const sessionId = normalizeText(input?.sessionId);
    const title = normalizeText(input?.title);
    const captureMode = normalizeText(input?.captureMode) || "tab-audio";
    const streamId = normalizeText(input?.streamId);
    if (!sessionId || !streamId) {
      throw new Error("녹음 시작에 필요한 정보가 부족해요.");
    }

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioContext.destination);

    const mimeType = pickRecorderMimeType();
    const mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);

    recorderState.audioContext = audioContext;
    recorderState.chunks = [];
    recorderState.mediaRecorder = mediaRecorder;
    recorderState.mediaStream = mediaStream;
    recorderState.sessionId = sessionId;
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
        startedAt: new Date(recorderState.startedAt).toISOString(),
        sessionId,
        title,
      },
    };
  }

  async function stopCapture(input) {
    if (!recorderState.mediaRecorder || recorderState.mediaRecorder.state !== "recording") {
      throw new Error("진행 중인 회의 녹음이 없어요.");
    }

    const captureMode = normalizeText(input?.captureMode) || "tab-audio";
    const sessionId = recorderState.sessionId;
    const title = recorderState.title;
    const durationMs = Math.max(0, Date.now() - recorderState.startedAt);
    const mimeType = recorderState.mediaRecorder.mimeType || "audio/webm";
    const startedAt = recorderState.startedAt > 0 ? new Date(recorderState.startedAt).toISOString() : "";

    return new Promise((resolve, reject) => {
      const mediaRecorder = recorderState.mediaRecorder;
      mediaRecorder.addEventListener("stop", async () => {
        try {
          const blob = new Blob(recorderState.chunks, { type: mimeType });
          cleanupRecorderState();
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
              endedAt: new Date().toISOString(),
              startedAt,
              sessionId,
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

  async function notifyRecorderFailure(error, input) {
    const sessionId = normalizeText(input?.sessionId) || recorderState.sessionId;
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
            sessionId,
            title,
          },
        },
        type: "inova-meeting:recorder-failed",
      });
    } finally {
      cleanupRecorderState();
    }
  }

  function cleanupRecorderState() {
    try {
      recorderState.audioContext?.close?.();
    } catch {}
    recorderState.audioContext = null;
    recorderState.chunks = [];
    recorderState.mediaRecorder = null;
    recorderState.mediaStream = null;
    recorderState.sessionId = "";
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

  function normalizeText(value) {
    return String(value || "").trim();
  }
})(globalThis);
