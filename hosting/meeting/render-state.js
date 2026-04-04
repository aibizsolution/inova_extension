(function initHostedMeetingRenderState(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const {
    TERMINAL_REMOTE_STATUSES,
    cleanPreviewText,
    formatDateTime,
    formatPhase,
    normalizeText,
    normalizeTextBlock,
  } = ns.shared;
  const { comparePendingUploads } = ns.storage;
  const { normalizeMeetingNotes } = ns.notes;
  const DEFAULT_CHUNK_PROGRESS_ACTIVE_COUNT = 2;
  const CHUNK_PROGRESS_PROCESS_START_PERCENT = 68;
  const CHUNK_PROGRESS_UPLOAD_START_PERCENT = 12;
  const CHUNK_PROGRESS_UPLOAD_END_PERCENT = 66;
  const STALLED_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

  function getProgressUpdatedAt(job, pending) {
    return normalizeText(job?.updatedAt || pending?.updatedAt);
  }

  function getProcessingHealth(job, pending) {
    const updatedAt = getProgressUpdatedAt(job, pending);
    const updatedAtMs = updatedAt ? ns.shared.toTimestamp(updatedAt) : 0;
    const ageMs = updatedAtMs > 0 ? Math.max(0, Date.now() - updatedAtMs) : 0;
    return {
      ageMs,
      isStalled: ageMs >= STALLED_PROCESSING_THRESHOLD_MS,
      updatedAt,
      updatedAtLabel: updatedAt ? formatDateTime(updatedAt, "") : "",
    };
  }

  function normalizeNotesContextItem(item) {
    const nextItem = item && typeof item === "object" ? item : {};
    return {
      contextId: normalizeText(nextItem.contextId || nextItem.id),
      createdAt: normalizeText(nextItem.createdAt),
      text: normalizeTextBlock(nextItem.text || nextItem.context || nextItem.value),
      updatedAt: normalizeText(nextItem.updatedAt || nextItem.createdAt),
    };
  }

  function normalizeNotesContextItems(input) {
    const seen = new Set();
    const items = [];
    for (const item of Array.isArray(input) ? input : []) {
      const normalized = normalizeNotesContextItem(item);
      const key = normalizeText(normalized.contextId || normalized.text).toLowerCase();
      if (!normalized.text || (key && seen.has(key))) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      items.push(normalized);
    }
    return items;
  }

  function normalizeNotesInputSnapshot(input, fallbackInput) {
    const snapshot = input && typeof input === "object" ? input : {};
    const fallback = fallbackInput && typeof fallbackInput === "object" ? fallbackInput : {};
    const hasContextItems = Array.isArray(snapshot.contextItems);
    const sharedMemo = normalizeTextBlock(
      Object.prototype.hasOwnProperty.call(snapshot, "sharedMemo")
        ? snapshot.sharedMemo
        : fallback.sharedMemo
    );
    const contextItems = normalizeNotesContextItems(hasContextItems ? snapshot.contextItems : fallback.contextItems);
    const updatedAt = normalizeText(snapshot.updatedAt || fallback.updatedAt);
    if (!sharedMemo && !contextItems.length && !updatedAt) {
      return {
        contextItems: [],
        sharedMemo: "",
        updatedAt: "",
      };
    }
    return {
      contextItems,
      sharedMemo,
      updatedAt,
    };
  }

  function normalizeWorkspaceMutation(mutation) {
    const nextMutation = mutation && typeof mutation === "object" ? mutation : {};
    return {
      completedAt: normalizeText(nextMutation.completedAt),
      error: normalizeText(nextMutation.error),
      requestedAt: normalizeText(nextMutation.requestedAt),
      requestId: normalizeText(nextMutation.requestId),
      status: normalizeText(nextMutation.status),
      type: normalizeText(nextMutation.type),
    };
  }

  function normalizeRecord(record) {
    const nextRecord = record && typeof record === "object" ? record : {};
    const notesContextItems = normalizeNotesContextItems(nextRecord.notesContextItems);
    const sharedMemoSnapshot = normalizeTextBlock(nextRecord.sharedMemoSnapshot);
    return {
      artifactId: normalizeText(nextRecord.artifactId),
      createdAt: normalizeText(nextRecord.createdAt),
      durationMs: Math.max(0, Number(nextRecord.durationMs) || 0),
      error: normalizeText(nextRecord.error),
      jobId: normalizeText(nextRecord.jobId),
      meetingId: normalizeText(nextRecord.meetingId),
      notesContextItems,
      notesDegradedReason: normalizeText(nextRecord.notesDegradedReason),
      notesGeneratedAt: normalizeText(nextRecord.notesGeneratedAt),
      notesInputSnapshot: normalizeNotesInputSnapshot(nextRecord.notesInputSnapshot, {
        contextItems: notesContextItems,
        sharedMemo: sharedMemoSnapshot,
        updatedAt: normalizeText(nextRecord.notesGeneratedAt || nextRecord.updatedAt),
      }),
      notesStatus: normalizeText(nextRecord.notesStatus),
      previewText: cleanPreviewText(nextRecord.previewText),
      requestId: normalizeText(nextRecord.requestId),
      sharedMemoSnapshot,
      status: normalizeText(nextRecord.status) || "idle",
      title: normalizeText(nextRecord.resultTitle || nextRecord.title || nextRecord.meetingTitle),
      updatedAt: normalizeText(nextRecord.updatedAt),
      workspaceMutation: normalizeWorkspaceMutation(nextRecord.workspaceMutation),
    };
  }

  function normalizeJob(job, fallbackTitle) {
    if (!job || typeof job !== "object") return null;
    const notesContextItems = normalizeNotesContextItems(job.notesContextItems || job?.context?.notesContextItems);
    const sharedMemoSnapshot = normalizeTextBlock(job?.context?.sharedMemoSnapshot || job?.meeting?.sharedMemo);
    return {
      artifactId: normalizeText(job?.transcript?.artifactId || job?.artifacts?.[0]?.artifactId),
      createdAt: normalizeText(job.createdAt || job.queuedAt),
      durationMs: Math.max(0, Number(job?.source?.durationMs) || 0),
      error: normalizeText(job.error),
      jobId: normalizeText(job.jobId),
      meetingNotes: normalizeMeetingNotes(job.meetingNotes),
      notesContextItems,
      notesDegradedReason: normalizeText(job.notesDegradedReason),
      notesGeneratedAt: normalizeText(job.notesGeneratedAt),
      notesInputSnapshot: normalizeNotesInputSnapshot(job.notesInputSnapshot, {
        contextItems: notesContextItems,
        sharedMemo: sharedMemoSnapshot,
        updatedAt: normalizeText(job.notesGeneratedAt || job.updatedAt),
      }),
      notesStatus: normalizeText(job.notesStatus),
      progress: {
        currentPart: Math.max(0, Number(job?.progress?.currentPart) || 0),
        parallelParts: Math.max(0, Number(job?.progress?.parallelParts) || 0),
        percent: Math.max(0, Math.min(100, Number(job?.progress?.percent) || 0)),
        phase: normalizeText(job?.progress?.phase),
        totalParts: Math.max(0, Number(job?.progress?.totalParts) || 0),
      },
      retry: {
        count: Math.max(0, Number(job?.retry?.count) || 0),
        lastError: normalizeText(job?.retry?.lastError),
        lastRetriedAt: normalizeText(job?.retry?.lastRetriedAt),
      },
      requestId: normalizeText(job?.source?.requestId),
      resultTitle: normalizeText(job.resultTitle || job.title),
      sharedMemoSnapshot,
      sizeBytes: Math.max(0, Number(job?.source?.sizeBytes) || 0),
      status: normalizeText(job.status) || "idle",
      title: normalizeText(job.resultTitle || job.title || job?.meeting?.title) || normalizeText(fallbackTitle),
      updatedAt: normalizeText(job.updatedAt),
      workspaceMutation: normalizeWorkspaceMutation(job.workspaceMutation),
    };
  }

  function normalizeArtifact(artifact) {
    if (!artifact || typeof artifact !== "object") return null;
    const segments = Array.isArray(artifact.segments)
      ? artifact.segments
        .map((segment) => ({
          endMs: Math.max(0, Number(segment.endMs) || 0),
          startMs: Math.max(0, Number(segment.startMs) || 0),
          text: normalizeText(segment.text),
        }))
        .filter((segment) => segment.text)
      : [];
    const notesContextItems = normalizeNotesContextItems(artifact.notesContextItems);
    return {
      artifactId: normalizeText(artifact.artifactId),
      notes: normalizeMeetingNotes(artifact.notes),
      notesContextItems,
      notesDegradedReason: normalizeText(artifact.notesDegradedReason),
      notesGeneratedAt: normalizeText(artifact.notesGeneratedAt),
      notesInputSnapshot: normalizeNotesInputSnapshot(artifact.notesInputSnapshot, {
        contextItems: notesContextItems,
        updatedAt: normalizeText(artifact.notesGeneratedAt || artifact.createdAt),
      }),
      notesStatus: normalizeText(artifact.notesStatus),
      segments,
      text: normalizeTextBlock(artifact.text),
    };
  }

  function getPendingChunkCounts(pending) {
    const totalPrepared = Math.max(
      0,
      Number(pending?.preparedPartCount) || (Array.isArray(pending?.parts) ? pending.parts.length : 0)
    );
    return {
      totalPrepared,
      totalUploaded: totalPrepared > 0
        ? Math.min(totalPrepared, Math.max(0, Number(pending?.uploadedPartCount) || 0))
        : Math.max(0, Number(pending?.uploadedPartCount) || 0),
    };
  }

  function getPendingDisplayStatus(pending) {
    const pendingStatus = normalizeText(pending?.status);
    if (!pendingStatus) return "";
    if (["failed", "local_saved", "on_hold", "preparing_chunks", "succeeded", "upload_queued", "uploading"].includes(pendingStatus)) {
      return pendingStatus;
    }
    const { totalPrepared, totalUploaded } = getPendingChunkCounts(pending);
    if (totalPrepared > 1 && totalUploaded < totalPrepared) {
      return "uploading_chunks";
    }
    return pendingStatus;
  }

  function shouldPrioritizePendingUpload(pending) {
    return ["local_saved", "preparing_chunks", "upload_queued", "uploading", "uploading_chunks"].includes(
      getPendingDisplayStatus(pending)
    );
  }

  function resolveEntryDisplayStatus(entry) {
    if (shouldPrioritizePendingUpload(entry?.pending)) {
      return getPendingDisplayStatus(entry.pending);
    }
    return normalizeText(entry?.remote?.status || getPendingDisplayStatus(entry?.pending));
  }

  function findRemoteForPending(state, pending) {
    if (!pending) return null;
    const pendingStatus = normalizeText(pending.status);
    const requestId = normalizeText(pending.requestId);
    const jobId = normalizeText(pending.jobId);
    if (!jobId && ["local_saved", "preparing_chunks", "uploading", "uploading_chunks", "upload_queued"].includes(pendingStatus)) {
      return null;
    }
    if (requestId) {
      const byRequestId = state.records.find((record) => normalizeText(record.requestId) === requestId);
      if (byRequestId) return byRequestId;
    }
    if (jobId) {
      const byJobId = state.records.find((record) => normalizeText(record.jobId) === jobId);
      if (byJobId) return byJobId;
    }
    return null;
  }

  function buildHistoryEntries(state) {
    const consumedRemoteJobs = new Set();
    const supersededRemoteJobs = new Set(
      (Array.isArray(state.pendingUploads) ? state.pendingUploads : [])
        .flatMap((pending) => Array.isArray(pending?.supersededJobIds) ? pending.supersededJobIds : [])
        .map((jobId) => normalizeText(jobId))
        .filter(Boolean)
    );
    const entries = [];
    for (const pending of state.pendingUploads) {
      const remote = findRemoteForPending(state, pending);
      if (remote?.jobId) {
        consumedRemoteJobs.add(remote.jobId);
        entries.push({
          createdAt: remote.createdAt || pending.createdAt,
          durationMs: remote.durationMs || pending.durationMs,
          id: ns.shared.buildRemoteSelectionId(remote.jobId),
          pending,
          remote,
          status: resolveEntryDisplayStatus({ pending, remote }),
          updatedAt: remote.updatedAt || pending.updatedAt,
        });
      } else {
        entries.push({
          createdAt: pending.createdAt,
          durationMs: pending.durationMs,
          id: ns.shared.buildLocalSelectionId(pending.requestId),
          pending,
          remote: null,
          status: resolveEntryDisplayStatus({ pending, remote: null }),
          updatedAt: pending.updatedAt,
        });
      }
    }
    for (const remote of state.records) {
      if (remote.jobId && consumedRemoteJobs.has(remote.jobId)) continue;
      if (remote.jobId && supersededRemoteJobs.has(remote.jobId)) continue;
      entries.push({
        createdAt: remote.createdAt,
        durationMs: remote.durationMs,
        id: ns.shared.buildRemoteSelectionId(remote.jobId),
        pending: null,
        remote,
        status: remote.status,
        updatedAt: remote.updatedAt,
      });
    }
    return entries.sort(
      (left, right) => ns.shared.toTimestamp(right.updatedAt || right.createdAt) - ns.shared.toTimestamp(left.updatedAt || left.createdAt)
    );
  }

  function findHistoryEntry(state, recordId) {
    return buildHistoryEntries(state).find((entry) => entry.id === normalizeText(recordId)) || null;
  }

  function chooseSelectedRecordId(state) {
    const historyEntries = buildHistoryEntries(state);
    if (normalizeText(state.params.jobId)) {
      const requestedId = ns.shared.buildRemoteSelectionId(state.params.jobId);
      if (historyEntries.some((entry) => entry.id === requestedId)) return requestedId;
    }
    if (normalizeText(state.selectedRecordId) && findHistoryEntry(state, state.selectedRecordId)) {
      return state.selectedRecordId;
    }
    return normalizeText(historyEntries[0]?.id);
  }

  function buildPendingSummary(pending) {
    if (!pending) return "";
    const pendingStatus = getPendingDisplayStatus(pending);
    const { totalPrepared, totalUploaded } = getPendingChunkCounts(pending);
    const processingHealth = getProcessingHealth(null, pending);
    if (pendingStatus === "local_saved") return "로컬 저장 완료. 곧 업로드를 시작합니다.";
    if (pendingStatus === "preparing_chunks") return "큰 오디오를 전사용 chunk로 준비하는 중입니다.";
    if (pendingStatus === "upload_queued") return pending.lastError || "온라인 복구 후 자동 업로드합니다.";
    if (pendingStatus === "uploading_chunks") return `분할 업로드 중입니다. ${totalUploaded}/${totalPrepared}개 업로드했습니다.`;
    if (pendingStatus === "uploading") return "오디오 업로드 중입니다.";
    if (pendingStatus === "remote_queued") return "원격 처리 대기열에 접수했습니다.";
    if (pendingStatus === "remote_processing" && processingHealth.isStalled) {
      return `정체 의심 상태입니다. 마지막 갱신 ${processingHealth.updatedAtLabel || "-"}`;
    }
    if (pendingStatus === "remote_processing") return "전사와 회의 정리를 진행 중입니다.";
    if (pendingStatus === "succeeded") return "업로드와 정리가 끝났고 로컬 사본을 보관 중입니다.";
    if (pendingStatus === "on_hold") return "사용자가 다시 시작할 때까지 보류합니다.";
    if (pendingStatus === "failed") return pending.lastError || "처리에 실패했습니다. 다시 처리하면 브라우저에 남은 원본으로 재시작합니다.";
    return pending.lastError || "";
  }

  function buildPendingNotice(pending) {
    if (!pending) return "";
    const pendingStatus = getPendingDisplayStatus(pending);
    const processingHealth = getProcessingHealth(null, pending);
    if (pendingStatus === "local_saved") return "브라우저에 저장했고 바로 업로드를 시도합니다.";
    if (pendingStatus === "preparing_chunks") return "큰 오디오를 분할해 업로드 가능한 형태로 준비하고 있습니다.";
    if (pendingStatus === "upload_queued") return pending.lastError || "온라인 상태를 기다리는 중입니다.";
    if (pendingStatus === "uploading_chunks") return "분할 업로드와 큐 등록을 이어가는 중입니다.";
    if (pendingStatus === "uploading") return "파일 업로드 중입니다.";
    if (pendingStatus === "remote_queued") return "처리 대기 중입니다.";
    if (pendingStatus === "remote_processing" && processingHealth.isStalled) {
      return `마지막 갱신 ${processingHealth.updatedAtLabel || "-"} 이후 10분 넘게 멈췄습니다. 다시 처리로 재시작해 주세요.`;
    }
    if (pendingStatus === "remote_processing") return "전사와 정리 중입니다.";
    if (pendingStatus === "succeeded") return "브라우저에 로컬 녹음 사본을 계속 보관 중입니다.";
    if (pendingStatus === "on_hold") return "수동 재개 전까지 멈춰 둡니다.";
    if (pendingStatus === "failed") return pending.lastError || "문제가 있어 브라우저에 보관한 원본으로 다시 처리해야 합니다.";
    return "";
  }

  function buildProcessingNotice(job, pending) {
    const currentPart = Math.max(0, Number(job?.progress?.currentPart) || 0);
    const percent = Math.round(Number(job?.progress?.percent) || 0);
    const phase = formatPhase(job?.progress?.phase || pending?.status);
    const totalParts = Math.max(0, Number(job?.progress?.totalParts) || 0);
    const retryCount = Math.max(0, Number(job?.retry?.count) || 0);
    const processingHealth = getProcessingHealth(job, pending);
    if (processingHealth.isStalled) {
      return [
        "정체 의심",
        currentPart > 0 && totalParts > 0 ? `${currentPart}/${totalParts}` : "",
        percent > 0 ? `${percent}%` : "",
        retryCount > 0 ? `자동 재시도 ${retryCount}회` : "",
        processingHealth.updatedAtLabel ? `마지막 갱신 ${processingHealth.updatedAtLabel}` : "",
        "10분 넘게 새 갱신이 없습니다. 다시 처리로 재시작해 주세요.",
      ].filter(Boolean).join(" · ");
    }
    return [
      phase || "결과를 준비하는 중입니다.",
      currentPart > 0 && totalParts > 0 ? `${currentPart}/${totalParts}` : "",
      percent > 0 ? `${percent}%` : "",
      retryCount > 0 ? `자동 재시도 ${retryCount}회` : "",
      processingHealth.updatedAtLabel ? `마지막 갱신 ${processingHealth.updatedAtLabel}` : "",
      pending ? "이 녹음과 별개로 다음 녹음을 바로 시작할 수 있습니다." : "",
    ].filter(Boolean).join(" · ");
  }

  function buildLocalPendingJob(pending) {
    if (!pending) return null;
    const { totalPrepared, totalUploaded } = getPendingChunkCounts(pending);
    const pendingStatus = getPendingDisplayStatus(pending);
    const progressPercent = pendingStatus === "preparing_chunks"
      ? 18
      : pendingStatus === "uploading_chunks"
        ? Math.min(58, totalPrepared > 0 ? Math.round((totalUploaded / totalPrepared) * 58) : 36)
        : pendingStatus === "uploading"
          ? 35
          : pendingStatus === "remote_processing"
            ? 70
            : 0;
    return {
      artifactId: "",
      createdAt: normalizeText(pending.createdAt),
      durationMs: Math.max(0, Number(pending.durationMs) || 0),
      error: normalizeText(pending.lastError),
      jobId: normalizeText(pending.jobId),
      meetingNotes: null,
      notesGeneratedAt: "",
      progress: { percent: progressPercent, phase: normalizeText(pending.status) },
      requestId: normalizeText(pending.requestId),
      resultTitle: normalizeText(pending.meetingTitleSnapshot),
      sharedMemoSnapshot: normalizeTextBlock(pending.sharedMemoSnapshot),
      sizeBytes: Math.max(0, Number(pending.sizeBytes) || 0),
      status: pendingStatus,
      title: normalizeText(pending.meetingTitleSnapshot),
      updatedAt: normalizeText(pending.updatedAt),
    };
  }

  function buildChunkProgressModel(job, pending) {
    const pendingStatus = getPendingDisplayStatus(pending);
    const { totalPrepared: totalPendingParts, totalUploaded: uploadedPendingParts } = getPendingChunkCounts(pending);
    const jobStatus = normalizeText(job?.status);
    const progressPhase = normalizeText(job?.progress?.phase);
    const totalJobParts = Math.max(0, Number(job?.progress?.totalParts) || 0);
    const currentJobPart = Math.max(0, Number(job?.progress?.currentPart) || 0);
    const maxParallelParts = Math.max(1, totalJobParts || totalPendingParts || 1);
    const rawParallelParts = Number(job?.progress?.parallelParts);
    const configuredParallelParts = Number.isFinite(rawParallelParts) && rawParallelParts >= 0
      ? Math.max(0, Math.min(maxParallelParts, rawParallelParts))
      : Math.max(1, Math.min(maxParallelParts, DEFAULT_CHUNK_PROGRESS_ACTIVE_COUNT));
    const overallPercent = Math.max(0, Math.min(100, Number(job?.progress?.percent) || 0));
    const hasChunkedPending = totalPendingParts > 1;
    const hasIncompleteChunkUpload = hasChunkedPending && uploadedPendingParts < totalPendingParts;
    const buildStages = (prepareTone, uploadTone, processTone) => ([
      { label: "분할", tone: prepareTone },
      { label: "업로드", tone: uploadTone },
      { label: "처리", tone: processTone },
    ]);

    if (pendingStatus === "preparing_chunks") {
      return {
        activeCount: 0,
        activeIndex: -1,
        doneCount: 0,
        percent: 8,
        stages: buildStages("current", "pending", "pending"),
        summary: "브라우저에서 청크를 준비하는 중",
        title: "청크 분할 준비",
        totalCount: totalPendingParts,
      };
    }

    if (hasIncompleteChunkUpload) {
      return {
        activeCount: 1,
        activeIndex: uploadedPendingParts,
        doneCount: Math.min(uploadedPendingParts, totalPendingParts),
        percent: totalPendingParts > 0
          ? CHUNK_PROGRESS_UPLOAD_START_PERCENT
            + Math.round(
              (uploadedPendingParts / totalPendingParts)
              * (CHUNK_PROGRESS_UPLOAD_END_PERCENT - CHUNK_PROGRESS_UPLOAD_START_PERCENT)
            )
          : CHUNK_PROGRESS_UPLOAD_START_PERCENT,
        stages: buildStages("done", "current", "pending"),
        summary: `${Math.min(uploadedPendingParts, totalPendingParts)}/${totalPendingParts}개 업로드 완료`,
        title: "청크 업로드 진행",
        totalCount: totalPendingParts,
      };
    }

    if (["remote_queued", "remote_processing"].includes(pendingStatus) && hasChunkedPending && totalJobParts <= 0) {
      return {
        activeCount: 0,
        activeIndex: -1,
        doneCount: totalPendingParts,
        percent: CHUNK_PROGRESS_PROCESS_START_PERCENT,
        stages: buildStages("done", "done", pendingStatus === "remote_processing" ? "current" : "pending"),
        summary: `${totalPendingParts}/${totalPendingParts}개 업로드 완료 · ${pendingStatus === "remote_processing" ? "전사 시작 중" : "처리 대기 중"}`,
        title: pendingStatus === "remote_processing" ? "청크 전사 시작" : "청크 업로드 완료",
        totalCount: totalPendingParts,
      };
    }

    if (["queued", "processing", "failed"].includes(jobStatus) && totalJobParts > 1) {
      const allPendingPartsUploaded = totalPendingParts > 0 && uploadedPendingParts >= totalPendingParts;
      const doneCount = Math.min(currentJobPart, totalJobParts);
      const remainingCount = Math.max(0, totalJobParts - doneCount);
      const isChunkTranscribing = progressPhase === "transcribing_chunks";
      const processingHealth = getProcessingHealth(job, pending);
      const activeCount = isChunkTranscribing && !processingHealth.isStalled
        ? Math.min(configuredParallelParts, remainingCount)
        : 0;
      const activeIndex = activeCount > 0 ? doneCount : -1;
      const summaryParts = [];
      if (allPendingPartsUploaded) {
        summaryParts.push(`${totalPendingParts}/${totalPendingParts}개 업로드 완료`);
      }
      summaryParts.push(`${doneCount}/${totalJobParts}개 전사 완료`);
      if (jobStatus === "failed") {
        summaryParts.push("중단됨");
      } else if (processingHealth.isStalled) {
        summaryParts.push("10분 이상 갱신 없음");
      } else if (isChunkTranscribing) {
        summaryParts.push(activeCount > 1 ? `병렬 ${activeCount}개 처리 중` : "처리 중");
      } else if (jobStatus === "queued" || progressPhase === "queued") {
        summaryParts.push("처리 대기 중");
      } else if (doneCount >= totalJobParts) {
        summaryParts.push("전사 완료");
      }
      if (processingHealth.updatedAtLabel) {
        summaryParts.push(`마지막 갱신 ${processingHealth.updatedAtLabel}`);
      }
      const percent = hasChunkedPending
        ? Math.max(
            CHUNK_PROGRESS_PROCESS_START_PERCENT,
            Math.min(
              100,
              CHUNK_PROGRESS_PROCESS_START_PERCENT
                + Math.round((doneCount / totalJobParts) * (100 - CHUNK_PROGRESS_PROCESS_START_PERCENT))
            )
          )
        : totalJobParts > 0
          ? Math.round((doneCount / totalJobParts) * 100)
          : overallPercent;
      return {
        activeCount,
        activeIndex,
        doneCount,
        isStalled: processingHealth.isStalled,
        percent,
        stages: buildStages(
          "done",
          "done",
          jobStatus === "failed"
            ? "failed"
            : processingHealth.isStalled
              ? "warning"
              : doneCount >= totalJobParts && !isChunkTranscribing
                ? "done"
                : isChunkTranscribing || jobStatus === "queued" || progressPhase === "queued"
                  ? "current"
                  : "done"
        ),
        summary: summaryParts.join(" · "),
        title: jobStatus === "failed"
          ? "청크 전사 중단"
          : processingHealth.isStalled
            ? "청크 전사 정체 의심"
            : isChunkTranscribing
              ? "청크 전사 진행"
              : jobStatus === "queued" || progressPhase === "queued"
                ? "청크 전사 대기"
                : "청크 전사 완료",
        totalCount: totalJobParts,
      };
    }

    return null;
  }

  function buildWorkspaceView(state, historyEntries) {
    if (state.auth?.readOnly) {
      return {
        badgeLabel: state.auth?.bypassMode ? "DEV BYPASS" : "읽기 전용",
        badgeStatus: "queued",
        meetingStatus: "공유 링크 열람",
        pageSummary: state.auth?.bypassMode
          ? "개발 우회 모드로 열려 있습니다."
          : "공유 링크 열람 중입니다. 수정 없이 보기와 복사만 가능합니다.",
      };
    }
    const hasActionableLocalCopies = state.pendingUploads.some((item) => item.status !== "succeeded");
    if (!ns.shared.isOnline(global)) {
      return {
        badgeLabel: "오프라인",
        badgeStatus: "queued",
        meetingStatus: state.pendingUploads.length ? "로컬 보관 중" : "오프라인",
        pageSummary: "오프라인 상태입니다.",
      };
    }
    if (state.capture.status === "recording") {
      return {
        badgeLabel: "녹음 중",
        badgeStatus: "recording",
        meetingStatus: "녹음 진행",
        pageSummary: "녹음 중입니다.",
      };
    }
    if (state.capture.status === "paused") {
      return {
        badgeLabel: "일시중지",
        badgeStatus: "paused",
        meetingStatus: "녹음 일시중지",
        pageSummary: "일시중지 상태입니다.",
      };
    }
    if (state.capture.status === "stopping") {
      return {
        badgeLabel: "저장 중",
        badgeStatus: "queued",
        meetingStatus: "로컬 저장 중",
        pageSummary: "저장 중입니다.",
      };
    }
    if (historyEntries.some((entry) => ["queued", "processing", "remote_queued", "remote_processing", "uploading"].includes(entry.status))) {
      return {
        badgeLabel: "처리 중",
        badgeStatus: "processing",
        meetingStatus: "전사 진행 중",
        pageSummary: "처리 중입니다.",
      };
    }
    if (hasActionableLocalCopies) {
      return {
        badgeLabel: "보관 중",
        badgeStatus: "queued",
        meetingStatus: "업로드 대기",
        pageSummary: "보관된 녹음이 있습니다.",
      };
    }
    if (historyEntries.length) {
      return {
        badgeLabel: "기록 있음",
        badgeStatus: "succeeded",
        meetingStatus: "기록 상세 확인",
        pageSummary: "",
      };
    }
    return {
      badgeLabel: "대기",
      badgeStatus: "idle",
      meetingStatus: "회의 준비",
      pageSummary: "",
    };
  }

  function buildRecorderView(state) {
    if (state.auth?.readOnly) {
      return {
        badgeLabel: state.auth?.bypassMode ? "DEV BYPASS" : "읽기 전용",
        badgeStatus: "queued",
        canDiscard: false,
        canPause: false,
        canResume: false,
        canStart: false,
        canStop: false,
        hint: state.auth?.bypassMode ? "개발용 우회 읽기 모드입니다." : "공유 링크에서는 녹음이나 업로드를 시작할 수 없습니다.",
        showDiscard: false,
        showPause: false,
        showResume: false,
        showStart: false,
        showStop: false,
        summary: state.auth?.bypassMode ? "개발용 읽기 모드입니다." : "읽기 전용 모드입니다.",
      };
    }
    if (state.capture.status === "recording") {
      return { badgeLabel: "녹음 중", badgeStatus: "recording", canDiscard: false, canPause: true, canResume: false, canStart: false, canStop: true, hint: "", showDiscard: false, showPause: true, showResume: false, showStart: false, showStop: true, summary: "녹음 중입니다." };
    }
    if (state.capture.status === "paused") {
      return { badgeLabel: "일시중지", badgeStatus: "paused", canDiscard: false, canPause: false, canResume: true, canStart: false, canStop: true, hint: "", showDiscard: false, showPause: false, showResume: true, showStart: false, showStop: true, summary: "일시중지 상태입니다." };
    }
    if (state.capture.status === "stopping") {
      return { badgeLabel: "저장 중", badgeStatus: "queued", canDiscard: false, canPause: false, canResume: false, canStart: false, canStop: false, hint: "", showDiscard: false, showPause: false, showResume: false, showStart: false, showStop: true, summary: "저장 중입니다." };
    }
    if (state.capture.status === "captured") {
      return { badgeLabel: "임시 보관", badgeStatus: "failed", canDiscard: true, canPause: false, canResume: false, canStart: false, canStop: false, hint: "", showDiscard: true, showPause: false, showResume: false, showStart: false, showStop: false, summary: "임시 저장 상태입니다." };
    }
    return {
      badgeLabel: "대기",
      badgeStatus: "idle",
      canDiscard: false,
      canPause: false,
      canResume: false,
      canStart: true,
      canStop: false,
      hint: "",
      showDiscard: false,
      showPause: false,
      showResume: false,
      showStart: true,
      showStop: false,
      summary: "",
    };
  }

  ns.renderState = {
    TERMINAL_REMOTE_STATUSES,
    buildChunkProgressModel,
    buildHistoryEntries,
    buildLocalPendingJob,
    buildPendingNotice,
    buildPendingSummary,
    buildProcessingNotice,
    buildRecorderView,
    buildWorkspaceView,
    chooseSelectedRecordId,
    comparePendingUploads,
    findHistoryEntry,
    findRemoteForPending,
    getPendingDisplayStatus,
    getProcessingHealth,
    normalizeArtifact,
    normalizeJob,
    normalizeRecord,
    normalizeWorkspaceMutation,
    resolveEntryDisplayStatus,
    shouldPrioritizePendingUpload,
  };
})(globalThis);
