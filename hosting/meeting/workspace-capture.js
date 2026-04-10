(function initHostedMeetingWorkspaceCapture(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  ns.workspaceCapture = {
    createController(deps) {
      const globalObject = deps?.global || global;
      const refs = deps?.refs || {};
      const state = deps?.state || {};
      const constants = deps?.constants || {};
      const helpers = deps?.helpers || {};
      const { findHistoryEntry } = ns.render;
      const { normalizePendingUpload } = ns.storage;
      const {
        buildLocalSelectionId,
        generateCaptureRequestId,
        logDebug,
        normalizeText,
        normalizeTextBlock,
        pickRecorderMimeType,
        stopTracks,
      } = ns.shared;

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      function resetCaptureState() {
        state.capture = helpers.createIdleCapture?.(state.recordingProfile) || state.capture;
      }

      function resolveRecorderStop() {
        if (typeof state.media.stopResolver === "function") {
          state.media.stopResolver();
          state.media.stopResolver = null;
        }
      }

      function cleanupMedia() {
        globalObject.clearInterval(state.media.chunkTimer);
        state.media.chunkTimer = 0;
        if (state.media.audioStream) {
          stopTracks(state.media.audioStream);
        }
        state.media.audioStream = null;
        state.media.recorder = null;
        state.media.chunks = [];
        state.media.accumulatedDurationMs = 0;
        state.media.resumeStartedAtMs = 0;
        state.media.stopContext = null;
      }

      function stopRecorder() {
        return new Promise((resolve) => {
          if (!state.media.recorder || state.media.recorder.state === "inactive") return resolve();
          state.media.stopResolver = resolve;
          state.media.recorder.stop();
        });
      }

      function updateRecordingDuration() {
        if (state.capture.status !== "recording") return;
        state.capture.durationMs = state.media.accumulatedDurationMs + Math.max(0, Date.now() - state.media.resumeStartedAtMs);
        if (!state.media.autoStopPending && state.capture.maxDurationMs > 0 && state.capture.durationMs >= state.capture.maxDurationMs) {
          state.media.autoStopPending = true;
          void stopCapture({
            autoLimit: true,
            continueRecording: true,
          });
          return;
        }
        helpers.applyRender?.();
      }

      function inferAudioExtension(mimeType) {
        if (mimeType.includes("wav")) return "wav";
        if (mimeType.includes("ogg")) return "ogg";
        if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
        if (mimeType.includes("aac")) return "aac";
        if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
        return "webm";
      }

      function buildDownloadFileName(title, requestId, extension) {
        const normalizedTitle = normalizeText(title) || "recording";
        const safeTitle = normalizedTitle.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
        const safeRequestId = normalizeText(requestId).replace(/[^a-zA-Z0-9_-]+/g, "").slice(-12);
        const name = safeRequestId ? `${safeTitle || "recording"}-${safeRequestId}` : (safeTitle || "recording");
        return `${name}.${normalizeText(extension) || "webm"}`;
      }

      function openImportAudioPicker() {
        if (!refs.importAudioInput || ["recording", "paused", "stopping"].includes(state.capture.status)) return;
        refs.importAudioInput.value = "";
        refs.importAudioInput.click();
      }

      async function handleImportAudioSelection(event) {
        const input = event?.target;
        const file = input?.files?.[0];
        if (!file) return;
        try {
          await importAudioFile(file);
        } catch (error) {
          controller("pendingUploads")?.showPendingUploadQueueOperationError?.(error, "파일 불러오기를 이어가지 못했어요.");
        } finally {
          if (input) input.value = "";
        }
      }

      async function importAudioFile(file) {
        if (["recording", "paused", "stopping"].includes(state.capture.status)) {
          helpers.setNotice?.("현재 녹음을 먼저 마친 뒤 파일을 불러와 주세요.", "warning");
          helpers.applyRender?.();
          return;
        }
        const sizeBytes = Math.max(0, Number(file?.size) || 0);
        if (!(sizeBytes > 0)) {
          helpers.setNotice?.("오디오 파일을 읽지 못했습니다.", "error");
          helpers.applyRender?.();
          return;
        }
        if (sizeBytes > constants.DEFAULT_SOURCE_MAX_BYTES) {
          helpers.setNotice?.(`현재 회의 원본은 ${Math.floor(constants.DEFAULT_SOURCE_MAX_BYTES / (1024 * 1024))}MB 이하까지만 지원합니다.`, "warning");
          helpers.applyRender?.();
          return;
        }
        let durationMs = 0;
        try {
          durationMs = await measureAudioDuration(file);
        } catch (error) {
          logDebug("workspace.import.duration.error", {
            error,
            fileName: normalizeText(file.name),
            sizeBytes,
          });
        }
        if (!(durationMs > 0)) {
          helpers.setNotice?.("이 파일의 길이를 확인하지 못해 바로 전사할 수 없습니다.", "error");
          helpers.applyRender?.();
          return;
        }
        if (durationMs > constants.DEFAULT_SOURCE_MAX_DURATION_MS) {
          helpers.setNotice?.("현재 회의 원본은 최대 2시간까지만 지원합니다.", "warning");
          helpers.applyRender?.();
          return;
        }
        const endedAt = new Date().toISOString();
        const startedAt = new Date(Date.now() - durationMs).toISOString();
        const pending = normalizePendingUpload({
          blob: file,
          captureMode: "microphone",
          channelCount: 1,
          createdAt: endedAt,
          durationMs,
          endedAt,
          hold: false,
          jobId: "",
          lastError: "",
          meetingId: state.session.meetingId,
          meetingTitleSnapshot: helpers.buildImportedRecordTitle?.(file, endedAt) || normalizeText(file.name),
          mimeType: normalizeText(file.type) || "audio/mp4",
          originalSizeBytes: sizeBytes,
          parts: [],
          publishedPartCount: 0,
          preparedPartCount: 0,
          requestId: generateCaptureRequestId(globalObject),
          sharedMemoSnapshot: normalizeTextBlock(refs.sharedMemoInput.value || state.recordMemoDraft || state.recordMemoSaved),
          sizeBytes,
          sourceMode: controller("pendingUploads")?.inferSourceMode?.(sizeBytes, durationMs) || "single",
          startedAt,
          status: "local_saved",
          uploadedPartCount: 0,
          updatedAt: endedAt,
        });
        logDebug("workspace.import.selected", {
          durationMs,
          fileName: normalizeText(file.name),
          mimeType: pending.mimeType,
          sizeBytes,
        });
        await controller("pendingUploads")?.createOrUpdatePendingUpload?.(pending, {
          context: {
            phase: "import-save",
            reason: "import-upload",
          },
        });
        state.recordMemoDraft = "";
        state.recordMemoSaved = "";
        state.session.sharedMemo = "";
        refs.sharedMemoInput.value = "";
        refs.sharedMemoNotice.hidden = true;
        refs.sharedMemoNotice.textContent = "";
        state.reviewTab = "summary";
        state.selectedRecordId = buildLocalSelectionId(pending.requestId);
        helpers.setNotice?.(
          state.debugLocalQueueSandbox
            ? "파일을 불러왔습니다. 로컬 queue sandbox에서는 원격 전사를 건너뛰고 브라우저 queue 상태만 확인합니다."
            : "파일을 불러왔고 자동 전사를 시작했습니다.",
          "highlight"
        );
        helpers.applyRender?.();
        if (!state.debugLocalQueueSandbox) {
          void controller("pendingUploads")?.attemptPendingUpload?.(pending.requestId, { reason: "import-upload" });
        }
      }

      async function measureAudioDuration(file) {
        try {
          return await measureAudioDurationFromMetadata(file);
        } catch (metadataError) {
          logDebug("workspace.import.duration.metadata-unavailable", {
            fileName: normalizeText(file?.name),
            message: normalizeText(metadataError?.message) || "duration-unavailable",
            mimeType: normalizeText(file?.type),
            sizeBytes: Math.max(0, Number(file?.size) || 0),
          });
          const fallbackMeasureDuration = ns.audioChunker?.measureAudioDuration;
          if (typeof fallbackMeasureDuration !== "function") {
            throw metadataError;
          }
          const durationMs = await fallbackMeasureDuration(file);
          logDebug("workspace.import.duration.decode-recovered", {
            durationMs,
            fileName: normalizeText(file?.name),
            mimeType: normalizeText(file?.type),
            sizeBytes: Math.max(0, Number(file?.size) || 0),
          });
          return durationMs;
        }
      }

      async function measureAudioDurationFromMetadata(file) {
        return new Promise((resolve, reject) => {
          const objectUrl = globalObject.URL.createObjectURL(file);
          const audio = globalObject.document.createElement("audio");
          const cleanup = () => {
            audio.removeAttribute("src");
            audio.load?.();
            globalObject.URL.revokeObjectURL(objectUrl);
          };
          audio.preload = "metadata";
          audio.onloadedmetadata = () => {
            const durationSeconds = Number(audio.duration);
            cleanup();
            if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
              reject(new Error("duration-unavailable"));
              return;
            }
            resolve(Math.round(durationSeconds * 1000));
          };
          audio.onerror = () => {
            cleanup();
            reject(new Error("duration-read-failed"));
          };
          audio.src = objectUrl;
        });
      }

      async function startCapture(options = {}) {
        if (["recording", "paused", "stopping"].includes(state.capture.status)) return;
        try {
          const stream = await globalObject.navigator.mediaDevices.getUserMedia({
            audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          const recorderMimeType = pickRecorderMimeType(globalObject);
          const recorderOptions = {};
          if (recorderMimeType) recorderOptions.mimeType = recorderMimeType;
          if (state.recordingProfile.audioBitsPerSecond > 0) recorderOptions.audioBitsPerSecond = state.recordingProfile.audioBitsPerSecond;
          const recorder = Object.keys(recorderOptions).length
            ? new globalObject.MediaRecorder(stream, recorderOptions)
            : new globalObject.MediaRecorder(stream);
          state.media.audioStream = stream;
          state.media.autoStopPending = false;
          state.media.recorder = recorder;
          state.media.chunks = [];
          state.media.accumulatedDurationMs = 0;
          state.media.resumeStartedAtMs = Date.now();
          state.media.stopContext = null;
          state.capture = {
            ...(helpers.createIdleCapture?.(state.recordingProfile) || state.capture),
            channelCount: Math.max(1, Number(stream.getAudioTracks?.().length) || 1),
            mimeType: normalizeText(recorder.mimeType),
            requestId: generateCaptureRequestId(globalObject),
            startedAt: new Date().toISOString(),
            status: "recording",
          };
          recorder.addEventListener("dataavailable", (event) => event?.data && Number(event.data.size) > 0 && state.media.chunks.push(event.data));
          recorder.addEventListener("stop", () => finalizeRecording().catch((error) => {
            helpers.setNotice?.(error instanceof Error ? error.message : "녹음을 정리하지 못했어요.", "error");
            resolveRecorderStop();
          }));
          recorder.start(1000);
          state.media.chunkTimer = globalObject.setInterval(updateRecordingDuration, 500);
          logDebug("workspace.capture.start", {
            audioBitsPerSecond: state.capture.audioBitsPerSecond,
            continuedFromLimit: Boolean(options?.continuedFromLimit),
            maxDurationMs: state.capture.maxDurationMs,
            mimeType: state.capture.mimeType,
            requestId: state.capture.requestId,
          });
          helpers.setNotice?.(
            options?.continuedFromLimit ? "이전 기록을 전사로 넘기고 다음 기록 녹음을 이어갑니다." : "녹음을 시작했습니다.",
            "highlight"
          );
          helpers.applyRender?.();
        } catch (error) {
          helpers.setNotice?.(error instanceof Error ? error.message : "녹음을 시작하지 못했어요.", "error");
          helpers.applyRender?.();
        }
      }

      async function pauseCapture() {
        if (state.capture.status !== "recording" || !state.media.recorder) return;
        state.media.recorder.pause?.();
        globalObject.clearInterval(state.media.chunkTimer);
        state.media.accumulatedDurationMs += Math.max(0, Date.now() - state.media.resumeStartedAtMs);
        state.capture.durationMs = state.media.accumulatedDurationMs;
        state.capture.status = "paused";
        helpers.setNotice?.("녹음을 일시중지했습니다.", "highlight");
        helpers.applyRender?.();
      }

      async function resumeCapture() {
        if (state.capture.status !== "paused" || !state.media.recorder) return;
        state.media.recorder.resume?.();
        state.media.resumeStartedAtMs = Date.now();
        state.capture.status = "recording";
        state.media.chunkTimer = globalObject.setInterval(updateRecordingDuration, 500);
        helpers.setNotice?.("녹음을 다시 이어갑니다.", "highlight");
        helpers.applyRender?.();
      }

      async function stopCapture(stopContext = {}) {
        if (!["recording", "paused"].includes(state.capture.status) || !state.media.recorder) return;
        if (state.capture.status === "recording") {
          state.media.accumulatedDurationMs += Math.max(0, Date.now() - state.media.resumeStartedAtMs);
          state.capture.durationMs = state.media.accumulatedDurationMs;
        }
        state.media.stopContext = {
          autoLimit: Boolean(stopContext?.autoLimit),
          continueRecording: Boolean(stopContext?.continueRecording),
        };
        state.capture.status = "stopping";
        helpers.setNotice?.(
          state.media.stopContext.autoLimit
            ? "설정한 시간에 도달해 현재 기록을 전사로 넘기고 다음 기록 녹음을 준비합니다."
            : "녹음을 로컬에 저장하고 바로 전사를 시작합니다.",
          "highlight"
        );
        helpers.applyRender?.();
        await stopRecorder();
      }

      function discardCapture() {
        if (state.capture.status !== "captured" || !state.media.recordedBlob) return;
        state.media.recordedBlob = null;
        resetCaptureState();
        helpers.setNotice?.("임시 녹음을 버렸습니다.", "highlight");
        helpers.applyRender?.();
      }

      async function finalizeRecording() {
        globalObject.clearInterval(state.media.chunkTimer);
        const stopContext = state.media.stopContext || { autoLimit: false, continueRecording: false };
        const blob = new globalObject.Blob(
          state.media.chunks,
          { type: normalizeText(state.media.recorder?.mimeType || state.capture.mimeType) || "audio/webm" }
        );
        if (Number(blob.size) > constants.DEFAULT_SOURCE_MAX_BYTES) {
          cleanupMedia();
          resetCaptureState();
          resolveRecorderStop();
          helpers.setNotice?.(`현재 회의 원본은 ${Math.floor(constants.DEFAULT_SOURCE_MAX_BYTES / (1024 * 1024))}MB 이하까지만 지원합니다.`, "error");
          helpers.applyRender?.();
          return;
        }
        const endedAt = new Date().toISOString();
        const pending = normalizePendingUpload({
          blob,
          captureMode: "microphone",
          channelCount: state.capture.channelCount,
          createdAt: endedAt,
          durationMs: state.capture.durationMs,
          endedAt,
          hold: false,
          jobId: "",
          lastError: "",
          meetingId: state.session.meetingId,
          meetingTitleSnapshot: helpers.buildRecordTitle?.(endedAt) || "새 기록",
          mimeType: blob.type,
          originalSizeBytes: blob.size,
          parts: [],
          publishedPartCount: 0,
          preparedPartCount: 0,
          requestId: state.capture.requestId || generateCaptureRequestId(globalObject),
          sharedMemoSnapshot: normalizeTextBlock(refs.sharedMemoInput.value || state.recordMemoDraft || state.recordMemoSaved),
          sizeBytes: blob.size,
          sourceMode: controller("pendingUploads")?.inferSourceMode?.(blob.size, state.capture.durationMs) || "single",
          startedAt: state.capture.startedAt,
          status: "local_saved",
          uploadedPartCount: 0,
          updatedAt: endedAt,
        });
        await controller("pendingUploads")?.createOrUpdatePendingUpload?.(pending, {
          context: {
            phase: stopContext.continueRecording ? "capture-save-continue" : "capture-save",
            reason: stopContext.continueRecording ? "capture-continue" : "capture-upload",
          },
        });
        state.recordMemoDraft = "";
        state.recordMemoSaved = "";
        state.session.sharedMemo = "";
        refs.sharedMemoInput.value = "";
        refs.sharedMemoNotice.hidden = true;
        refs.sharedMemoNotice.textContent = "";
        cleanupMedia();
        resetCaptureState();
        state.reviewTab = "summary";
        state.selectedRecordId = buildLocalSelectionId(pending.requestId);
        resolveRecorderStop();
        if (stopContext.continueRecording) {
          helpers.setNotice?.("현재 기록을 전사로 넘기고 다음 기록 녹음을 이어갑니다.", "highlight");
          helpers.applyRender?.();
          void startCapture({ continuedFromLimit: true });
        } else {
          helpers.setNotice?.(
            state.debugLocalQueueSandbox
              ? "녹음을 브라우저 queue에 저장했습니다. 로컬 queue sandbox에서는 원격 전사를 건너뜁니다."
              : "녹음을 브라우저에 저장했고 자동 전사를 시작했습니다. 지금 바로 다음 녹음을 시작할 수 있습니다.",
            "highlight"
          );
          helpers.applyRender?.();
        }
        if (!state.debugLocalQueueSandbox) {
          void controller("pendingUploads")?.attemptPendingUpload?.(pending.requestId, { reason: "capture-upload" });
        }
      }

      function downloadCurrentRecord() {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        const pending = entry?.pending;
        const blob = pending?.blob instanceof globalObject.Blob ? pending.blob : null;
        if (!blob || Number(blob.size) <= 0) {
          helpers.setNotice?.("브라우저에 남아 있는 녹음 사본이 없어 다운로드할 수 없습니다.", "warning");
          helpers.applyRender?.();
          return;
        }
        const extension = inferAudioExtension(normalizeText(pending.mimeType || blob.type));
        const filename = buildDownloadFileName(
          normalizeText(pending.meetingTitleSnapshot || state.currentJob?.title || state.meeting.title || "recording"),
          normalizeText(pending.requestId),
          extension
        );
        const objectUrl = globalObject.URL.createObjectURL(blob);
        const link = globalObject.document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        globalObject.document.body.appendChild(link);
        link.click();
        link.remove();
        globalObject.setTimeout(() => globalObject.URL.revokeObjectURL(objectUrl), 1000);
        helpers.setNotice?.("브라우저에 보관 중인 녹음을 다운로드했습니다.", "highlight");
        helpers.applyRender?.();
      }

      return {
        discardCapture,
        downloadCurrentRecord,
        handleImportAudioSelection,
        inferAudioExtension,
        importAudioFile,
        openImportAudioPicker,
        pauseCapture,
        resumeCapture,
        startCapture,
        stopCapture,
      };
    },
  };
})(globalThis);
