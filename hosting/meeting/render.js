(function initHostedMeetingRender(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const { TERMINAL_REMOTE_STATUSES, cleanPreviewText, escapeHtml, formatBytes, formatDateTime, formatDuration, formatPhase, formatSegmentRange, formatStatusLabel, normalizeStatus, normalizeText, normalizeTextBlock } = ns.shared;
  const { comparePendingUploads, normalizePendingUpload } = ns.storage;
  const { hasMeetingNotes, normalizeMeetingNotes, normalizeTextArray } = ns.notes;
  const DEFAULT_CHUNK_PROGRESS_ACTIVE_COUNT = 2;
  const STALLED_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;
  const DISPLAY_REVIEW_SEGMENT_TARGET_CHARS = 220;
  const DISPLAY_REVIEW_SEGMENT_MAX_CHARS = 320;
  const DISPLAY_REVIEW_SEGMENT_MIN_CHARS = 80;
  const DISPLAY_REVIEW_SEGMENT_TARGET_DURATION_MS = 90 * 1000;
  const DISPLAY_REVIEW_SEGMENT_MAX_DURATION_MS = 150 * 1000;
  const DISPLAY_REVIEW_SEGMENT_MIN_DURATION_MS = 25 * 1000;

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

  function normalizeRecord(record) {
    const nextRecord = record && typeof record === "object" ? record : {};
    return {
      artifactId: normalizeText(nextRecord.artifactId),
      createdAt: normalizeText(nextRecord.createdAt),
      durationMs: Math.max(0, Number(nextRecord.durationMs) || 0),
      error: normalizeText(nextRecord.error),
      jobId: normalizeText(nextRecord.jobId),
      meetingId: normalizeText(nextRecord.meetingId),
      notesDegradedReason: normalizeText(nextRecord.notesDegradedReason),
      notesGeneratedAt: normalizeText(nextRecord.notesGeneratedAt),
      notesStatus: normalizeText(nextRecord.notesStatus),
      previewText: cleanPreviewText(nextRecord.previewText),
      requestId: normalizeText(nextRecord.requestId),
      status: normalizeText(nextRecord.status) || "idle",
      title: normalizeText(nextRecord.resultTitle || nextRecord.title || nextRecord.meetingTitle),
      updatedAt: normalizeText(nextRecord.updatedAt),
    };
  }

  function normalizeJob(job, fallbackTitle) {
    if (!job || typeof job !== "object") return null;
    return {
      artifactId: normalizeText(job?.transcript?.artifactId || job?.artifacts?.[0]?.artifactId),
      createdAt: normalizeText(job.createdAt || job.queuedAt),
      durationMs: Math.max(0, Number(job?.source?.durationMs) || 0),
      error: normalizeText(job.error),
      jobId: normalizeText(job.jobId),
      meetingNotes: normalizeMeetingNotes(job.meetingNotes),
      notesDegradedReason: normalizeText(job.notesDegradedReason),
      notesGeneratedAt: normalizeText(job.notesGeneratedAt),
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
      sharedMemoSnapshot: ns.shared.normalizeTextBlock(job?.context?.sharedMemoSnapshot || job?.meeting?.sharedMemo),
      sizeBytes: Math.max(0, Number(job?.source?.sizeBytes) || 0),
      status: normalizeText(job.status) || "idle",
      title: normalizeText(job.resultTitle || job.title || job?.meeting?.title) || normalizeText(fallbackTitle),
      updatedAt: normalizeText(job.updatedAt),
    };
  }

  function normalizeArtifact(artifact) {
    if (!artifact || typeof artifact !== "object") return null;
    const segments = Array.isArray(artifact.segments)
      ? artifact.segments.map((segment) => ({ endMs: Math.max(0, Number(segment.endMs) || 0), startMs: Math.max(0, Number(segment.startMs) || 0), text: normalizeText(segment.text) })).filter((segment) => segment.text)
      : [];
    return {
      artifactId: normalizeText(artifact.artifactId),
      notes: normalizeMeetingNotes(artifact.notes),
      notesDegradedReason: normalizeText(artifact.notesDegradedReason),
      notesGeneratedAt: normalizeText(artifact.notesGeneratedAt),
      notesStatus: normalizeText(artifact.notesStatus),
      segments,
      text: ns.shared.normalizeTextBlock(artifact.text),
    };
  }

  function buildLocalPendingJob(pending) {
    if (!pending) return null;
    const totalPrepared = Math.max(0, Number(pending.preparedPartCount) || 0);
    const totalUploaded = Math.max(0, Number(pending.uploadedPartCount) || 0);
    const progressPercent = pending.status === "preparing_chunks"
      ? 18
      : pending.status === "uploading_chunks"
        ? Math.min(58, totalPrepared > 0 ? Math.round((totalUploaded / totalPrepared) * 58) : 36)
        : pending.status === "uploading"
          ? 35
          : pending.status === "remote_processing"
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
      sharedMemoSnapshot: ns.shared.normalizeTextBlock(pending.sharedMemoSnapshot),
      sizeBytes: Math.max(0, Number(pending.sizeBytes) || 0),
      status: normalizeText(pending.status),
      title: normalizeText(pending.meetingTitleSnapshot),
      updatedAt: normalizeText(pending.updatedAt),
    };
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
      (Array.isArray(state.pendingUploads) ? state.pendingUploads : []).flatMap((pending) =>
        Array.isArray(pending?.supersededJobIds) ? pending.supersededJobIds : []
      ).map((jobId) => normalizeText(jobId)).filter(Boolean)
    );
    const entries = [];
    for (const pending of state.pendingUploads) {
      const remote = findRemoteForPending(state, pending);
      if (remote?.jobId) {
        consumedRemoteJobs.add(remote.jobId);
        entries.push({ createdAt: remote.createdAt || pending.createdAt, durationMs: remote.durationMs || pending.durationMs, id: ns.shared.buildRemoteSelectionId(remote.jobId), pending, remote, status: remote.status, updatedAt: remote.updatedAt || pending.updatedAt });
      } else {
        entries.push({ createdAt: pending.createdAt, durationMs: pending.durationMs, id: ns.shared.buildLocalSelectionId(pending.requestId), pending, remote: null, status: pending.status, updatedAt: pending.updatedAt });
      }
    }
    for (const remote of state.records) {
      if (remote.jobId && consumedRemoteJobs.has(remote.jobId)) continue;
      if (remote.jobId && supersededRemoteJobs.has(remote.jobId)) continue;
      entries.push({ createdAt: remote.createdAt, durationMs: remote.durationMs, id: ns.shared.buildRemoteSelectionId(remote.jobId), pending: null, remote, status: remote.status, updatedAt: remote.updatedAt });
    }
    return entries.sort((left, right) => ns.shared.toTimestamp(right.updatedAt || right.createdAt) - ns.shared.toTimestamp(left.updatedAt || left.createdAt));
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
    const processingHealth = getProcessingHealth(null, pending);
    if (pending.status === "local_saved") return "로컬 저장 완료. 곧 업로드를 시작합니다.";
    if (pending.status === "preparing_chunks") return "큰 오디오를 전사용 chunk로 준비하는 중입니다.";
    if (pending.status === "upload_queued") return pending.lastError || "온라인 복구 후 자동 업로드합니다.";
    if (pending.status === "uploading_chunks") return `분할 업로드 중입니다. ${Math.max(0, Number(pending.uploadedPartCount) || 0)}/${Math.max(0, Number(pending.preparedPartCount) || 0)}개 업로드했습니다.`;
    if (pending.status === "uploading") return "오디오 업로드 중입니다.";
    if (pending.status === "remote_queued") return "원격 처리 대기열에 접수했습니다.";
    if (pending.status === "remote_processing" && processingHealth.isStalled) {
      return `정체 의심 상태입니다. 마지막 갱신 ${processingHealth.updatedAtLabel || "-"}`;
    }
    if (pending.status === "remote_processing") return "전사와 회의 정리를 진행 중입니다.";
    if (pending.status === "succeeded") return "업로드와 정리가 끝났고 로컬 사본을 보관 중입니다.";
    if (pending.status === "on_hold") return "사용자가 다시 시작할 때까지 보류합니다.";
    if (pending.status === "failed") return pending.lastError || "처리에 실패했습니다. 다시 처리하면 브라우저에 남은 원본으로 재시작합니다.";
    return pending.lastError || "";
  }

  function buildPendingNotice(pending) {
    if (!pending) return "";
    const processingHealth = getProcessingHealth(null, pending);
    if (pending.status === "local_saved") return "브라우저에 저장했고 바로 업로드를 시도합니다.";
    if (pending.status === "preparing_chunks") return "큰 오디오를 분할해 업로드 가능한 형태로 준비하고 있습니다.";
    if (pending.status === "upload_queued") return pending.lastError || "온라인 상태를 기다리는 중입니다.";
    if (pending.status === "uploading_chunks") return "분할 업로드와 큐 등록을 이어가는 중입니다.";
    if (pending.status === "uploading") return "파일 업로드 중입니다.";
    if (pending.status === "remote_queued") return "처리 대기 중입니다.";
    if (pending.status === "remote_processing" && processingHealth.isStalled) {
      return `마지막 갱신 ${processingHealth.updatedAtLabel || "-"} 이후 10분 넘게 멈췄습니다. 다시 처리로 재시작해 주세요.`;
    }
    if (pending.status === "remote_processing") return "전사와 정리 중입니다.";
    if (pending.status === "succeeded") return "브라우저에 로컬 녹음 사본을 계속 보관 중입니다.";
    if (pending.status === "on_hold") return "수동 재개 전까지 멈춰 둡니다.";
    if (pending.status === "failed") return pending.lastError || "문제가 있어 브라우저에 보관한 원본으로 다시 처리해야 합니다.";
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

  function buildChunkProgressModel(job, pending) {
    const pendingStatus = normalizeText(pending?.status);
    const totalPendingParts = Math.max(
      0,
      Number(pending?.preparedPartCount) || (Array.isArray(pending?.parts) ? pending.parts.length : 0)
    );
    const uploadedPendingParts = Math.max(0, Number(pending?.uploadedPartCount) || 0);
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
        percent: 0,
        stages: buildStages("current", "pending", "pending"),
        summary: "브라우저에서 청크를 준비하는 중",
        title: "청크 분할 준비",
        totalCount: totalPendingParts,
      };
    }

    if (pendingStatus === "uploading_chunks" && totalPendingParts > 1) {
      return {
        activeCount: uploadedPendingParts < totalPendingParts ? 1 : 0,
        activeIndex: uploadedPendingParts < totalPendingParts ? uploadedPendingParts : -1,
        doneCount: Math.min(uploadedPendingParts, totalPendingParts),
        percent: totalPendingParts > 0 ? Math.round((uploadedPendingParts / totalPendingParts) * 100) : 0,
        stages: buildStages("done", "current", "pending"),
        summary: `${Math.min(uploadedPendingParts, totalPendingParts)}/${totalPendingParts}개 업로드 완료`,
        title: "청크 업로드 진행",
        totalCount: totalPendingParts,
      };
    }

    if (["remote_queued", "remote_processing"].includes(pendingStatus) && totalPendingParts > 1 && totalJobParts <= 0) {
      return {
        activeCount: 0,
        activeIndex: -1,
        doneCount: totalPendingParts,
        percent: 100,
        stages: buildStages("done", "done", pendingStatus === "remote_processing" ? "current" : "pending"),
        summary: `${totalPendingParts}/${totalPendingParts}개 업로드 완료 · 처리 대기 중`,
        title: "청크 업로드 완료",
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
      return {
        activeCount,
        activeIndex,
        doneCount,
        isStalled: processingHealth.isStalled,
        percent: totalJobParts > 0 ? Math.round((doneCount / totalJobParts) * 100) : overallPercent,
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

  function renderChunkProgress(model) {
    if (!model) return "";
    const totalCount = Math.max(0, Number(model.totalCount) || 0);
    const doneCount = Math.max(0, Math.min(totalCount, Number(model.doneCount) || 0));
    const activeIndex = Math.max(-1, Math.min(totalCount - 1, Number(model.activeIndex)));
    const activeCount = Math.max(
      0,
      Math.min(totalCount - Math.max(0, activeIndex), Number(model.activeCount) || (activeIndex >= 0 ? 1 : 0))
    );
    const percent = Math.max(0, Math.min(100, Number(model.percent) || 0));
    const segments = Array.from({ length: totalCount }, (_, index) => {
      const tone = index < doneCount
        ? "done"
        : activeIndex >= 0 && index >= activeIndex && index < activeIndex + activeCount
          ? "current"
          : "pending";
      return `<span class="chunk-progress__segment" data-tone="${tone}" title="청크 ${index + 1}/${totalCount}"></span>`;
    }).join("");
    const stages = Array.isArray(model.stages)
      ? model.stages.map((stage) => `
          <span class="chunk-progress__stage" data-tone="${escapeHtml(normalizeText(stage.tone) || "pending")}">
            ${escapeHtml(normalizeText(stage.label) || "")}
          </span>
        `).join("")
      : "";
    return `
      <div class="chunk-progress">
        <div class="chunk-progress__head">
          <strong class="chunk-progress__title">${escapeHtml(normalizeText(model.title) || "청크 진행")}</strong>
          ${normalizeText(model.summary) ? `<span class="chunk-progress__meta">${escapeHtml(model.summary)}</span>` : ""}
        </div>
        ${stages ? `<div class="chunk-progress__stages">${stages}</div>` : ""}
        ${totalCount > 1 ? `<div class="chunk-progress__bar" aria-hidden="true"><span style="width:${percent}%"></span></div>` : ""}
        ${totalCount > 1 ? `<div class="chunk-progress__segments" aria-hidden="true">${segments}</div>` : ""}
      </div>
    `;
  }

  function buildSummaryActionCardHtml(detailView, summaryActionMessage) {
    const chunkProgressHtml = renderChunkProgress(detailView?.chunkProgress);
    const showMessage = !chunkProgressHtml && normalizeText(summaryActionMessage);
    if (!showMessage && !chunkProgressHtml) return "";
    return [
      showMessage
        ? `<div class="summary-action-card__message">${escapeHtml(summaryActionMessage)}</div>`
        : "",
      chunkProgressHtml,
    ].filter(Boolean).join("");
  }

  function buildCompletedRecordSummary(notes) {
    const overview = normalizeTextBlock(notes?.overview);
    if (overview) return overview;
    const purpose = normalizeTextBlock(notes?.meetingMeta?.purpose);
    if (purpose) return purpose;
    const firstFlow = (Array.isArray(notes?.discussionFlow) ? notes.discussionFlow : []).find((item) => {
      const headline = normalizeText(item?.narrative || item?.heading);
      return Boolean(headline || normalizeTextArray(item?.keyPoints).length);
    });
    if (firstFlow) {
      const narrative = normalizeText(firstFlow?.narrative || firstFlow?.heading);
      if (narrative) return narrative;
      const firstKeyPoint = normalizeTextArray(firstFlow?.keyPoints)[0];
      if (firstKeyPoint) return firstKeyPoint;
    }
    const firstDecision = normalizeText(Array.isArray(notes?.decisions) ? notes.decisions[0]?.text : "");
    if (firstDecision) return `주요 결정: ${firstDecision}`;
    const firstAction = normalizeText(Array.isArray(notes?.actionItems) ? notes.actionItems[0]?.task : "");
    if (firstAction) return `후속 실행: ${firstAction}`;
    return "";
  }

  function splitSegmentTextIntoDisplaySentences(text) {
    const normalized = normalizeTextBlock(text).replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }
    const sentences = normalized.match(/[^.!?。！？…]+(?:[.!?。！？…]+|$)/g) || [normalized];
    const normalizedSentences = sentences.map((sentence) => normalizeText(sentence)).filter(Boolean);
    if (normalizedSentences.length > 1) {
      return normalizedSentences;
    }
    const clauses = normalized
      .split(/(?<=[,，;])\s+|(?=\b(?:그리고|하지만|다만|또|또는|그래서)\b)/)
      .map((clause) => normalizeText(clause))
      .filter(Boolean);
    if (clauses.length > 1) {
      return clauses;
    }
    const words = normalized.split(/\s+/).map((word) => normalizeText(word)).filter(Boolean);
    if (words.length <= 1) {
      return [normalized];
    }
    const chunks = [];
    let current = [];
    let currentLength = 0;
    for (const word of words) {
      const nextLength = currentLength + word.length + (current.length ? 1 : 0);
      if (current.length && nextLength > DISPLAY_REVIEW_SEGMENT_TARGET_CHARS) {
        chunks.push(current.join(" "));
        current = [word];
        currentLength = word.length;
        continue;
      }
      current.push(word);
      currentLength = nextLength;
    }
    if (current.length) {
      chunks.push(current.join(" "));
    }
    return chunks.length ? chunks : [normalized];
  }

  function buildDisplaySegmentChunk(sourceSegment, sentences, totalChars, consumedChars, chunkChars) {
    const text = normalizeTextBlock((Array.isArray(sentences) ? sentences : []).join(" "));
    if (!text) {
      return null;
    }
    const startMs = Math.max(0, Number(sourceSegment?.startMs) || 0);
    const endMs = Math.max(startMs, Number(sourceSegment?.endMs) || 0);
    const durationMs = Math.max(0, endMs - startMs);
    if (!durationMs || totalChars <= 0) {
      return {
        endMs,
        startMs,
        text,
      };
    }
    const chunkStartRatio = Math.max(0, Math.min(1, consumedChars / totalChars));
    const chunkEndRatio = Math.max(chunkStartRatio, Math.min(1, (consumedChars + chunkChars) / totalChars));
    const chunkStartMs = Math.round(startMs + (durationMs * chunkStartRatio));
    const chunkEndMs = Math.max(chunkStartMs + 1, Math.round(startMs + (durationMs * chunkEndRatio)));
    return {
      endMs: Math.min(endMs, chunkEndMs),
      startMs: Math.min(endMs, chunkStartMs),
      text,
    };
  }

  function mergeDisplaySegmentChunks(left, right) {
    const leftText = normalizeTextBlock(left?.text);
    const rightText = normalizeTextBlock(right?.text);
    if (!leftText) return right || null;
    if (!rightText) return left || null;
    return {
      endMs: Math.max(Number(left?.endMs) || 0, Number(right?.endMs) || 0),
      startMs: Math.min(Number(left?.startMs) || 0, Number(right?.startMs) || 0),
      text: `${leftText} ${rightText}`.replace(/\s+/g, " ").trim(),
    };
  }

  function resegmentSingleSegmentForDisplay(segment) {
    const normalizedText = normalizeTextBlock(segment?.text);
    if (!normalizedText) {
      return [];
    }
    const startMs = Math.max(0, Number(segment?.startMs) || 0);
    const endMs = Math.max(startMs, Number(segment?.endMs) || 0);
    const durationMs = Math.max(0, endMs - startMs);
    if (
      normalizedText.length <= DISPLAY_REVIEW_SEGMENT_MAX_CHARS
      && (!durationMs || durationMs <= DISPLAY_REVIEW_SEGMENT_MAX_DURATION_MS)
    ) {
      return [{ endMs, startMs, text: normalizedText }];
    }
    const sentences = splitSegmentTextIntoDisplaySentences(normalizedText);
    if (!sentences.length) {
      return [{ endMs, startMs, text: normalizedText }];
    }
    const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
    const chunks = [];
    let currentSentences = [];
    let currentChars = 0;
    let consumedChars = 0;
    const pushChunk = () => {
      const chunk = buildDisplaySegmentChunk(segment, currentSentences, totalChars, consumedChars, currentChars);
      if (chunk) {
        chunks.push(chunk);
        consumedChars += currentChars;
      }
      currentSentences = [];
      currentChars = 0;
    };
    for (const sentence of sentences) {
      const nextChars = currentChars + sentence.length + (currentSentences.length ? 1 : 0);
      const nextDurationEstimate = totalChars > 0 && durationMs > 0
        ? Math.round((nextChars / totalChars) * durationMs)
        : 0;
      const shouldSplitBeforeAdding = currentSentences.length
        && currentChars >= DISPLAY_REVIEW_SEGMENT_MIN_CHARS
        && (
          nextChars > DISPLAY_REVIEW_SEGMENT_TARGET_CHARS
          || nextDurationEstimate > DISPLAY_REVIEW_SEGMENT_TARGET_DURATION_MS
        );
      const mustSplitBeforeAdding = currentSentences.length
        && (
          nextChars > DISPLAY_REVIEW_SEGMENT_MAX_CHARS
          || nextDurationEstimate > DISPLAY_REVIEW_SEGMENT_MAX_DURATION_MS
        );
      if (shouldSplitBeforeAdding || mustSplitBeforeAdding) {
        pushChunk();
      }
      currentSentences.push(sentence);
      currentChars += sentence.length + (currentSentences.length > 1 ? 1 : 0);
    }
    if (currentSentences.length) {
      pushChunk();
    }
    if (chunks.length >= 2) {
      const last = chunks[chunks.length - 1];
      const lastDurationMs = Math.max(0, (Number(last?.endMs) || 0) - (Number(last?.startMs) || 0));
      if (
        normalizeTextBlock(last?.text).length < DISPLAY_REVIEW_SEGMENT_MIN_CHARS
        || (lastDurationMs > 0 && lastDurationMs < DISPLAY_REVIEW_SEGMENT_MIN_DURATION_MS)
      ) {
        const merged = mergeDisplaySegmentChunks(chunks[chunks.length - 2], last);
        if (merged) {
          chunks.splice(chunks.length - 2, 2, merged);
        }
      }
    }
    return chunks.filter((chunk) => normalizeTextBlock(chunk?.text));
  }

  function resegmentSegmentsForDisplay(segments) {
    return (Array.isArray(segments) ? segments : [])
      .flatMap((segment) => resegmentSingleSegmentForDisplay(segment))
      .filter((segment) => normalizeTextBlock(segment?.text));
  }

  function buildTranscriptTextForDisplay(segments, fallbackText) {
    const lines = (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const text = normalizeText(segment?.text);
        if (!text) return "";
        const range = normalizeText(formatSegmentRange(segment?.startMs, segment?.endMs));
        return range ? `[${range}] ${text}` : text;
      })
      .filter(Boolean);
    return normalizeTextBlock(lines.join("\n") || fallbackText);
  }

  function buildSegmentCopyText(segments, fallbackText) {
    const lines = (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const text = normalizeText(segment?.text);
        if (!text) return "";
        const range = normalizeText(formatSegmentRange(segment?.startMs, segment?.endMs));
        return `${range ? `[${range}] ` : ""}${text}`;
      })
      .filter(Boolean);
    return normalizeTextBlock(lines.join("\n") || fallbackText);
  }

  function formatCaptureTimer(durationMs) {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function buildMeetingNotesSections(notes) {
    return [
      buildMeetingOverviewSection(notes),
      buildDiscussionFlowSection(notes?.discussionFlow),
      buildSimpleListSection("주요 결정 사항", normalizeDecisionItemsForDisplay(notes?.decisions)),
      buildSimpleListSection("후속 실행 항목", normalizeActionItemsForDisplay(notes?.actionItems)),
      buildSimpleListSection("추가 결정 필요 사항", normalizeTextArray(notes?.openQuestions)),
      buildSimpleListSection("리스크 및 제약", normalizeRiskItemsForDisplay(notes?.risksOrDependencies)),
    ].filter(Boolean);
  }

  function buildMeetingOverviewSection(notes) {
    const purpose = normalizeTextBlock(notes?.meetingMeta?.purpose);
    const overview = normalizeTextBlock(notes?.overview);
    const participants = normalizeTextArray(notes?.meetingMeta?.participants);
    const datetime = normalizeText(notes?.meetingMeta?.datetime);
    const paragraphs = [purpose, overview].filter(Boolean);
    if (!paragraphs.length && !participants.length && !datetime) {
      return null;
    }
    return {
      metaItems: [
        datetime ? `일시 ${datetime}` : "",
        participants.length ? `참여자 ${participants.join(", ")}` : "",
      ].filter(Boolean),
      paragraphs,
      title: "회의 개요",
      type: "prose",
    };
  }

  function normalizeDecisionItemsForDisplay(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const text = normalizeText(item?.text);
        if (!text) {
          return null;
        }
        const meta = normalizeText(item?.owner) ? `담당: ${normalizeText(item.owner)}` : "";
        return { body: "", headline: text, meta };
      })
      .filter(Boolean);
  }

  function normalizeActionItemsForDisplay(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const task = normalizeText(item?.task);
        if (!task) {
          return null;
        }
        const metaParts = [
          normalizeText(item?.assignee) ? `담당: ${normalizeText(item.assignee)}` : "",
          normalizeText(item?.dueDate) ? `기한: ${normalizeText(item.dueDate)}` : "",
          normalizeText(item?.status) ? `상태: ${normalizeText(item.status)}` : "",
        ].filter(Boolean);
        return { body: "", headline: task, meta: metaParts.join(" · ") };
      })
      .filter(Boolean);
  }

  function normalizeRiskItemsForDisplay(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const text = normalizeText(item?.text);
        if (!text) {
          return null;
        }
        const meta = normalizeText(item?.severity) ? `심각도: ${normalizeText(item.severity)}` : "";
        return { body: "", headline: text, meta };
      })
      .filter(Boolean);
  }

  function buildDiscussionFlowSection(items) {
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((item) => ({
        heading: normalizeText(item?.heading),
        keyPoints: normalizeTextArray(item?.keyPoints),
        narrative: normalizeTextBlock(item?.narrative),
      }))
      .filter((item) => item.heading || item.narrative || item.keyPoints.length);
    if (!normalizedItems.length) {
      return null;
    }
    return {
      items: normalizedItems,
      title: "논의 흐름",
      type: "flow",
    };
  }

  function buildSimpleListSection(title, items) {
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((item) => {
        if (typeof item === "string") {
          const text = normalizeTextBlock(item);
          return text ? { body: "", headline: text, meta: "" } : null;
        }
        const headline = normalizeTextBlock(item?.headline);
        const body = normalizeTextBlock(item?.body);
        const meta = normalizeText(item?.meta);
        if (!headline && !body) {
          return null;
        }
        return {
          body,
          headline: headline || body,
          meta,
        };
      })
      .filter(Boolean);
    if (!normalizedItems.length) {
      return null;
    }
    return {
      items: normalizedItems,
      title,
      type: "list",
    };
  }

  function splitNotesParagraphs(text) {
    return normalizeTextBlock(text)
      .split("\n")
      .map((paragraph) => normalizeTextBlock(paragraph))
      .filter(Boolean);
  }

  function renderNotesProse(paragraphs) {
    const normalized = (Array.isArray(paragraphs) ? paragraphs : [])
      .flatMap((paragraph) => splitNotesParagraphs(paragraph))
      .filter(Boolean);
    if (!normalized.length) {
      return "";
    }
    return `<div class="notes-prose">${normalized.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>`;
  }

  function renderNotesMetaRow(items) {
    const normalized = (Array.isArray(items) ? items : []).map((item) => normalizeText(item)).filter(Boolean);
    if (!normalized.length) {
      return "";
    }
    return `<div class="notes-meta-row">${normalized.map((item) => `<span class="notes-meta-chip">${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function renderNotesListItem(item) {
    const headline = normalizeTextBlock(item?.headline);
    const body = normalizeTextBlock(item?.body);
    const meta = normalizeText(item?.meta);
    if (!headline && !body) {
      return "";
    }
    return `<li class="notes-list__item"><div class="notes-list__headline">${escapeHtml(headline || body)}</div>${meta ? `<div class="notes-list__meta">${escapeHtml(meta)}</div>` : ""}${body && body !== headline ? `<div class="notes-list__body">${renderNotesProse([body])}</div>` : ""}</li>`;
  }

  function renderNotesSection(section) {
    if (!section) {
      return "";
    }
    if (section.type === "prose") {
      return `<section class="notes-section"><h3 class="notes-section__title">${escapeHtml(section.title)}</h3>${renderNotesMetaRow(section.metaItems)}${renderNotesProse(section.paragraphs)}</section>`;
    }
    if (section.type === "flow") {
      return `<section class="notes-section"><h3 class="notes-section__title">${escapeHtml(section.title)}</h3><div class="notes-flow">${section.items.map((item) => `<article class="notes-flow__item"><h4 class="notes-flow__heading">${escapeHtml(item.heading || "주요 논의")}</h4>${renderNotesProse([item.narrative])}${item.keyPoints.length ? `<ul class="notes-flow__points">${item.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div></section>`;
    }
    return `<section class="notes-section"><h3 class="notes-section__title">${escapeHtml(section.title)}</h3><ul class="notes-list">${section.items.map((item) => renderNotesListItem(item)).join("")}</ul></section>`;
  }

  function renderNotesOverview(notes) {
    const summary = buildCompletedRecordSummary(notes);
    if (!summary) {
      return "";
    }
    return `<section class="notes-section"><h3 class="notes-section__title">핵심 요약</h3>${renderNotesProse([summary])}</section>`;
  }

  function buildStatusFlow(detailView, options = {}) {
    const normalizedStatus = normalizeText(detailView.badgeStatus);
    const recordSelected = normalizedStatus !== "idle";
    const isFailed = normalizedStatus === "failed";
    const isBusy = ["queued", "processing", "uploading", "uploading_chunks", "preparing_chunks", "remote_queued", "remote_processing"].includes(normalizedStatus);
    const segmentCount = Math.max(0, Number(options.segmentCount) || 0);
    const steps = [];
    const facts = [];
    const pushStep = (title, state, detail, stateLabelOverride = "") => {
      steps.push({
        detail: normalizeText(detail),
        state,
        stateLabel: normalizeText(stateLabelOverride) || (state === "done" ? "" : state === "current" ? "진행" : state === "warning" ? "확인" : state === "failed" ? "오류" : "대기"),
        title,
      });
    };
    const pushFact = (label, value) => {
      const normalizedValue = normalizeText(value);
      if (!normalizedValue) return;
      facts.push({ label, value: normalizedValue });
    };

    pushStep("기록 선택", recordSelected ? "done" : "current", recordSelected ? "기록 선택됨" : "검토할 기록을 고릅니다.", recordSelected ? "" : "선택");

    if (isFailed) {
      pushStep("원문 검토", "failed", "오류로 중단되었습니다.");
    } else if (options.hasSegmentContent) {
      pushStep("원문 검토", "done", segmentCount > 0 ? `구간 ${segmentCount}개 확인 가능` : "전사 텍스트 준비 완료");
    } else if (isBusy) {
      pushStep("원문 검토", "current", "전사 결과를 준비하는 중입니다.");
    } else if (recordSelected) {
      pushStep("원문 검토", "warning", "인식된 발화가 아직 충분하지 않습니다.");
    } else {
      pushStep("원문 검토", "pending", "기록 선택 후 전사를 확인합니다.");
    }

    if (isFailed) {
      pushStep("회의 정리", "failed", "오류 해결 후 다시 생성합니다.");
    } else if (options.hasNotesValue) {
      pushStep("회의 정리", "done", options.generatedAt ? `마지막 정리 ${options.generatedAt}` : "회의 정리가 준비됐습니다.");
    } else if (options.hasSegmentContent) {
      pushStep("회의 정리", isBusy ? "current" : "warning", isBusy ? "전사를 바탕으로 회의 정리를 만드는 중입니다." : "같은 전사로 다시 정리할 수 있습니다.", isBusy ? "진행" : "재정리");
    } else {
      pushStep("회의 정리", isBusy ? "current" : "pending", "전사 확보 후 생성됩니다.");
    }

    if (isFailed) {
      pushStep("검토 마무리", "failed", "오류를 정리한 뒤 다시 확인합니다.");
    } else if (options.hasNotesValue && options.hasSegmentContent) {
      pushStep("검토 마무리", "done", "복사 · 다운로드 · 제목 수정");
    } else if (options.hasSegmentContent) {
      pushStep("검토 마무리", "current", "원문 검토부터 확인할 수 있습니다.", "검토");
    } else {
      pushStep("검토 마무리", "pending", "결과가 준비되면 검토합니다.");
    }

    if (recordSelected && !["idle", "succeeded"].includes(normalizedStatus)) pushFact("현재 상태", detailView.badgeLabel);
    if (segmentCount > 0) pushFact("원문", `${segmentCount}개`);
    pushFact("품질 주의", options.degradedReason);
    pushFact("마지막 정리", options.generatedAt);

    const focusIndex = steps.findIndex((step) => step.state !== "done");
    return {
      facts,
      steps: steps.map((step, index) => ({ ...step, isFocus: focusIndex >= 0 ? index === focusIndex : index === steps.length - 1 })),
    };
  }

  function renderStatusFlow(model) {
    if (!model || !Array.isArray(model.steps) || !model.steps.length) return "";
    return `
      <div class="summary-flow-board">
        <div class="summary-journey" role="list">
          ${model.steps.map((step, index) => `
            <article class="summary-journey-step" data-tone="${escapeHtml(step.state)}" data-focus="${step.isFocus ? "true" : "false"}" role="listitem">
              <div class="summary-journey-step__rail">
                <span class="summary-journey-step__index">${index + 1}</span>
                ${index < model.steps.length - 1 ? '<span class="summary-journey-step__line" aria-hidden="true"></span>' : ""}
              </div>
              ${step.stateLabel ? `<span class="summary-journey-step__state">${escapeHtml(step.stateLabel)}</span>` : ""}
              <strong class="summary-journey-step__title">${escapeHtml(step.title)}</strong>
              <span class="summary-journey-step__detail">${escapeHtml(step.detail)}</span>
            </article>
          `).join("")}
        </div>
        ${model.facts.length
          ? `<div class="summary-flow-facts">${model.facts.map((fact) => `<span class="summary-flow-fact"><span class="summary-flow-fact__label">${escapeHtml(fact.label)}</span><strong class="summary-flow-fact__value">${escapeHtml(fact.value)}</strong></span>`).join("")}</div>`
          : ""}
      </div>
    `;
  }

  function buildStatusActionMessage(detailView, options = {}) {
    const normalizedStatus = normalizeText(detailView.badgeStatus);
    if (!normalizeText(detailView.recordTitle) && detailView.badgeStatus === "idle") {
      return "";
    }
    if (["queued", "processing"].includes(normalizedStatus)) {
      return "";
    }
    if (normalizedStatus === "failed") {
      return "오류가 있어 다시 시도하거나 삭제 후 새로 만들 수 있습니다.";
    }
    if (!options.hasSegmentContent) {
      return detailView.notice;
    }
    if (!options.hasNotesValue) {
      return "전사를 기준으로 회의 정리를 다시 만들 수 있습니다.";
    }
    return "";
  }

  function renderLocalActionButton(action, requestId, label, tone) {
    const toneClass = tone === "danger" ? " mini-button--danger" : tone === "accent" ? " mini-button--accent" : "";
    return `<button type="button" class="mini-button${toneClass}" data-local-action="${escapeHtml(action)}" data-request-id="${escapeHtml(requestId)}">${escapeHtml(label)}</button>`;
  }

  function buildPendingActions(pending, remote) {
    if (!pending) return "";
    const buttons = [];
    const processingHealth = getProcessingHealth(remote, pending);
    if (pending.status === "remote_processing" && processingHealth.isStalled) {
      buttons.push(renderLocalActionButton("restart", pending.requestId, "다시 처리", "accent"));
    } else if (pending.status === "on_hold") {
      buttons.push(renderLocalActionButton("resume", pending.requestId, "업로드 재개", "accent"));
    } else if (["local_saved", "upload_queued", "failed"].includes(pending.status)) {
      const retryLabel = pending.status === "failed" ? "다시 처리" : "지금 업로드";
      buttons.push(renderLocalActionButton("retry", pending.requestId, retryLabel, "accent"), renderLocalActionButton("hold", pending.requestId, "보류", ""));
    }
    return buttons.length ? `<div class="record-item__actions">${buttons.join("")}</div>` : "";
  }

  function buildWorkspaceView(state, historyEntries) {
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
        meetingStatus: "기록 검토 가능",
        pageSummary: "",
      };
    }
    return {
      badgeLabel: "대기",
      badgeStatus: "idle",
      meetingStatus: "작업실 준비",
      pageSummary: "",
    };
  }

  function buildRecorderView(state) {
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

  function buildDetailView(state, activeEntry) {
    if (!activeEntry) {
      return { badgeLabel: "대기", badgeStatus: "idle", chunkProgress: null, meta: [], meetingNotes: null, notesMeta: null, notice: "왼쪽에서 기록을 선택해 주세요.", noticeTone: "", recordMemo: "", recordTitle: "", segments: [], showRecordActions: false, summary: "", title: "기록을 선택해 주세요", transcriptText: "" };
    }
    const pending = activeEntry.pending;
    const remote = activeEntry.remote;
    const detailTitle = normalizeText(state.currentJob?.title || remote?.title || pending?.meetingTitleSnapshot || state.meeting.title || "새 기록");
    const detailMeta = [];
    const remoteStatus = normalizeText(state.currentJob?.status || remote?.status);
    const processingHealth = getProcessingHealth(state.currentJob || remote, pending);
    const canManageRemoteRecord = Boolean(remote?.jobId) && !["queued", "processing"].includes(remoteStatus);
    const showRecordActions = Boolean((pending?.requestId && !remote?.jobId) || canManageRemoteRecord);
    const detailMemo = normalizeTextBlock(state.currentJob?.sharedMemoSnapshot || pending?.sharedMemoSnapshot);
    const pendingChunkProgress = buildChunkProgressModel(null, pending);

    if (!remote?.jobId && pending) {
      return { badgeLabel: formatStatusLabel(pending.status), badgeStatus: normalizeStatus(pending.status), chunkProgress: pendingChunkProgress, meta: detailMeta, meetingNotes: null, notesMeta: null, notice: buildPendingNotice(pending), noticeTone: pending.status === "failed" ? "error" : "highlight", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions, summary: buildPendingSummary(pending), title: detailTitle, transcriptText: "" };
    }

    const normalizedJob = state.currentJob || normalizeJob(remote, detailTitle);
    const normalizedArtifact = state.currentArtifact;
    const meetingNotes = normalizeMeetingNotes(normalizedArtifact?.notes || normalizedJob?.meetingNotes);
    const rawSegments = Array.isArray(normalizedArtifact?.segments) ? normalizedArtifact.segments : [];
    const segments = resegmentSegmentsForDisplay(rawSegments);
    const transcriptText = buildTranscriptTextForDisplay(segments, normalizedArtifact?.text);
    const hasNotesValue = hasMeetingNotes(meetingNotes);
    const hasTranscriptValue = Boolean(transcriptText);
    const hasSegmentsValue = segments.length > 0;
    const notesMeta = {
      degradedReason: normalizeText(normalizedArtifact?.notesDegradedReason || normalizedJob?.notesDegradedReason),
      generatedAt: normalizeText(normalizedArtifact?.notesGeneratedAt || normalizedJob?.notesGeneratedAt),
      status: normalizeText(normalizedArtifact?.notesStatus || normalizedJob?.notesStatus),
    };
    const remoteChunkProgress = buildChunkProgressModel(normalizedJob, pending);

    if (normalizeText(normalizedJob?.status) === "failed") {
      return { badgeLabel: "오류", badgeStatus: "failed", chunkProgress: remoteChunkProgress, meta: detailMeta, meetingNotes: null, notesMeta, notice: normalizeText(normalizedJob?.error || pending?.lastError) || "회의 처리 중 오류가 발생했습니다.", noticeTone: "error", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions, summary: "", title: detailTitle, transcriptText: "" };
    }
    if (["queued", "processing"].includes(normalizeText(normalizedJob?.status))) {
      return { badgeLabel: processingHealth.isStalled ? "정체 의심" : formatStatusLabel(normalizedJob.status), badgeStatus: normalizeStatus(normalizedJob.status), chunkProgress: remoteChunkProgress, meta: detailMeta, meetingNotes: null, notesMeta, notice: buildProcessingNotice(normalizedJob, pending), noticeTone: processingHealth.isStalled ? "warning" : "highlight", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions: false, summary: "", title: detailTitle, transcriptText: "" };
    }
    let completionNotice = state.notice.text || "회의 정리가 준비됐습니다.";
    let completionTone = state.notice.tone || "highlight";
    if (!hasNotesValue && !hasTranscriptValue && !hasSegmentsValue) {
      completionNotice = "녹음이 너무 짧거나 인식된 발화가 부족해 표시할 내용이 없습니다.";
      completionTone = "warning";
    } else if (!hasNotesValue && (hasTranscriptValue || hasSegmentsValue) && !state.notice.text) {
      completionNotice = "전사는 준비됐지만 회의 정리로 묶을 내용은 충분하지 않았습니다.";
      completionTone = "warning";
    }
    return {
      badgeLabel: "완료",
      badgeStatus: "succeeded",
      chunkProgress: null,
      meta: detailMeta,
      meetingNotes,
      notesMeta,
      notice: completionNotice,
      noticeTone: completionTone,
      recordMemo: detailMemo,
      recordTitle: detailTitle,
      segments,
      showRecordActions,
      summary: "",
      title: detailTitle,
      transcriptText,
    };
  }

  function splitSegmentParagraphs(text) {
    const normalized = ns.shared.normalizeTextBlock(text).replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }
    const sentences = normalized.match(/[^.!?。！？…]+(?:[.!?。！？…]+|$)/g) || [normalized];
    const paragraphs = [];
    let current = [];
    let currentLength = 0;
    for (const sentence of sentences) {
      const normalizedSentence = normalizeText(sentence);
      if (!normalizedSentence) {
        continue;
      }
      const nextLength = current.length ? currentLength + normalizedSentence.length + 1 : normalizedSentence.length;
      if (current.length && nextLength > 180) {
        paragraphs.push(current.join(" "));
        current = [normalizedSentence];
        currentLength = normalizedSentence.length;
        continue;
      }
      current.push(normalizedSentence);
      currentLength = nextLength;
    }
    if (current.length) {
      paragraphs.push(current.join(" "));
    }
    return paragraphs.length ? paragraphs : [normalized];
  }

  function renderSegment(segment, index) {
    const paragraphs = splitSegmentParagraphs(segment.text);
    const label = Number.isFinite(index) ? `원문 ${index + 1}` : "";
    return `<article class="segment-item"><div class="segment-item__head"><span>${escapeHtml(formatSegmentRange(segment.startMs, segment.endMs))}</span>${label ? `<span class="segment-item__index">${escapeHtml(label)}</span>` : ""}</div><div class="segment-item__body">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div></article>`;
  }

  function renderTranscriptFallback(transcriptText) {
    return `<div class="transcript-box">${escapeHtml(transcriptText)}</div>`;
  }

  function renderHistoryEntry(entry, selectedRecordId) {
    const title = normalizeText(entry.remote?.title || entry.pending?.meetingTitleSnapshot || "새 기록");
    const pendingSummary = entry.pending?.status === "succeeded" ? "" : buildPendingSummary(entry.pending);
    const pendingNotice = entry.pending?.status === "succeeded" ? "" : buildPendingNotice(entry.pending);
    const meta = [formatDateTime(entry.updatedAt || entry.createdAt, ""), entry.durationMs > 0 ? formatDuration(entry.durationMs) : "", entry.pending?.sizeBytes > 0 ? formatBytes(entry.pending.sizeBytes) : ""].filter(Boolean).join(" · ");
    const chips = [];
    if (pendingSummary) chips.push({ label: pendingSummary, tone: "muted" });
    return `
      <button type="button" class="record-item${entry.id === selectedRecordId ? " is-active" : ""}" data-record-id="${escapeHtml(entry.id)}">
        <div class="record-item__top">
          <div>
            <strong class="record-item__title">${escapeHtml(title)}</strong>
            ${meta ? `<div class="record-item__meta">${escapeHtml(meta)}</div>` : ""}
          </div>
          <span class="status-pill status-pill--soft" data-status="${escapeHtml(normalizeStatus(entry.status))}">${escapeHtml(formatStatusLabel(entry.status))}</span>
        </div>
        ${chips.length ? `<div class="record-item__chips">${chips.map((chip) => `<span class="chip${chip.tone === "accent" ? " chip--accent" : ""}">${escapeHtml(chip.label)}</span>`).join("")}</div>` : ""}
        ${pendingNotice ? `<div class="record-item__local">${escapeHtml(pendingNotice)}</div>` : ""}
      </button>
      ${buildPendingActions(entry.pending, entry.remote)}
    `;
  }

  function renderMeetingNotes(refs, detailView, state) {
    const normalized = normalizeMeetingNotes(detailView.meetingNotes);
    const hasNotesValue = hasMeetingNotes(normalized);
    refs.regenerateNotesButton.disabled = !state.currentJob?.jobId || state.busy.regenerateNotes || !TERMINAL_REMOTE_STATUSES.has(normalizeText(state.currentJob?.status));
    refs.regenerateNotesButton.textContent = state.busy.regenerateNotes
      ? "정리 중"
      : "다시 정리";
    if (!hasNotesValue) {
      refs.meetingNotesOverview.hidden = true;
      refs.meetingNotesOverview.innerHTML = "";
      refs.meetingNotesSections.innerHTML = `<div class="notice-box" data-tone="warning">전사는 준비됐지만 회의 정리 문서로 묶을 내용은 충분하지 않았습니다. 원문 검토를 확인하거나 다시 정리해 보세요.</div>`;
      return false;
    }
    const overviewMarkup = renderNotesOverview(normalized);
    refs.meetingNotesOverview.hidden = !overviewMarkup;
    refs.meetingNotesOverview.innerHTML = overviewMarkup;
    refs.meetingNotesSections.innerHTML = buildMeetingNotesSections(normalized).map(renderNotesSection).join("");
    return true;
  }

  function resolveReviewTab(state, detailView, hasNotesValue, options = {}) {
    const isCompleted = normalizeText(detailView.badgeStatus) === "succeeded";
    const hasMemoValue = Boolean(normalizeText(detailView.recordMemo));
    const hasTranscriptValue = Boolean(normalizeText(detailView.transcriptText));
    const hasSegmentsValue = Array.isArray(detailView.segments) && detailView.segments.length > 0;
    const hasSegmentContent = hasSegmentsValue || hasTranscriptValue;
    const showSummaryTab = options.showSummaryTab !== false && !isCompleted;
    const showMemoTab = isCompleted || hasMemoValue;
    const showNotesTab = isCompleted || hasNotesValue;
    const fallbackTab = () => {
      if (showNotesTab) return "notes";
      if (showMemoTab) return "memo";
      if (hasSegmentContent) return "segments";
      return showSummaryTab ? "summary" : "notes";
    };
    let nextTab = normalizeText(state.reviewTab) || "notes";
    if (nextTab === "transcript") {
      nextTab = "segments";
    }
    if (!["summary", "memo", "notes", "segments"].includes(nextTab)) {
      nextTab = "notes";
    }
    if (!showSummaryTab && nextTab === "summary") {
      nextTab = fallbackTab();
    }
    if (!detailView.showRecordActions && !showMemoTab && !hasSegmentContent && !showNotesTab) {
      return showSummaryTab ? "summary" : "notes";
    }
    if (nextTab === "memo" && !showMemoTab) {
      return fallbackTab();
    }
    if (nextTab === "notes" && !showNotesTab) {
      return showMemoTab ? "memo" : hasSegmentContent ? "segments" : showSummaryTab ? "summary" : "notes";
    }
    if (nextTab === "segments" && !hasSegmentContent) {
      return showNotesTab ? "notes" : showMemoTab ? "memo" : showSummaryTab ? "summary" : "notes";
    }
    return nextTab;
  }

  function applyReviewTabState(refs, activeTab) {
    const tabMap = {
      memo: refs.reviewTabMemo,
      notes: refs.reviewTabNotes,
      segments: refs.reviewTabSegments,
      summary: refs.reviewTabSummary,
    };
    for (const [tabName, element] of Object.entries(tabMap)) {
      if (!element) continue;
      const selected = tabName === activeTab;
      element.classList.toggle("is-active", selected);
      element.setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function buildReviewHeaderModel(activeTab) {
    const tabKey = normalizeText(activeTab) || "summary";
    if (tabKey === "notes") {
      return { eyebrow: "회의 정리", title: "회의 정리" };
    }
    if (tabKey === "segments") {
      return { eyebrow: "전사 원문", title: "원문 검토" };
    }
    if (tabKey === "memo") {
      return { eyebrow: "기록 메모", title: "메모" };
    }
    return { eyebrow: "검토 흐름", title: "현재 기록 단계" };
  }

  function renderWorkspace(state, refs) {
    const historyEntries = buildHistoryEntries(state);
    const workspaceView = buildWorkspaceView(state, historyEntries);
    const recorderView = buildRecorderView(state);
    const activeEntry = findHistoryEntry(state, state.selectedRecordId);
    const detailView = buildDetailView(state, activeEntry);
    const meetingBusy = state.busy.saveMeetingTitle || state.busy.saveMeetingMemo || state.busy.deleteMeeting;
    const savedMeetingTitle = normalizeText(state.meeting.title || state.session.title);
    const draftMeetingTitle = normalizeText(global.document.activeElement === refs.meetingTitleInput ? refs.meetingTitleInput.value : state.meetingTitleDraft || refs.meetingTitleInput?.value);
    const meetingTitleDirty = Boolean(draftMeetingTitle && draftMeetingTitle !== savedMeetingTitle);
    const savedRecordMemo = ns.shared.normalizeTextBlock(state.recordMemoSaved);
    const draftRecordMemo = ns.shared.normalizeTextBlock(global.document.activeElement === refs.sharedMemoInput ? refs.sharedMemoInput.value : state.recordMemoDraft);
    const recordMemoDirty = draftRecordMemo !== savedRecordMemo;
    const remoteRecordLocked = Boolean(activeEntry?.remote?.jobId) && ["queued", "processing"].includes(normalizeText(activeEntry?.remote?.status));
    const canRenameSelectedRecord = activeEntry?.remote?.jobId ? !remoteRecordLocked : Boolean(activeEntry?.pending?.requestId);
    const canDownloadSelectedRecord = Boolean(activeEntry?.pending?.requestId && Number(activeEntry?.pending?.blob?.size || activeEntry?.pending?.sizeBytes) > 0);
    const canDeleteSelectedRecord = activeEntry?.remote?.jobId ? !remoteRecordLocked : Boolean(activeEntry?.pending?.requestId);
    const savedRecordTitle = normalizeText(detailView.recordTitle);
    const draftRecordTitle = normalizeText(global.document.activeElement === refs.recordTitleInput ? refs.recordTitleInput.value : savedRecordTitle || refs.recordTitleInput?.value);
    const recordTitleDirty = Boolean(draftRecordTitle && draftRecordTitle !== savedRecordTitle);
    const currentTimerText = formatCaptureTimer(state.capture.durationMs);

    refs.pageTitle.hidden = true;
    refs.pageTitle.textContent = savedMeetingTitle || "새 작업실";
    refs.pageSummary.hidden = !normalizeText(workspaceView.pageSummary);
    refs.pageSummary.textContent = workspaceView.pageSummary;
    refs.workspaceBadge.textContent = workspaceView.badgeLabel;
    refs.workspaceBadge.dataset.status = workspaceView.badgeStatus;
    refs.offlineQueueBadge.textContent = `로컬 보관 ${state.pendingUploads.length}건`;
    refs.meetingStatusChip.textContent = workspaceView.meetingStatus;
    refs.refreshButton.disabled = state.loading;
    refs.refreshButton.textContent = state.loadingReason === "manual" ? "동기화 중" : "새로고침";
    if (global.document.activeElement !== refs.meetingTitleInput) refs.meetingTitleInput.value = normalizeText(state.meetingTitleDraft || savedMeetingTitle);
    refs.saveMeetingTitleButton.disabled = meetingBusy || !draftMeetingTitle || !meetingTitleDirty;
    refs.saveMeetingTitleButton.textContent = state.busy.saveMeetingTitle ? "저장 중" : meetingTitleDirty ? "이름 저장" : "저장됨";
    refs.deleteMeetingButton.disabled = meetingBusy || ["recording", "paused", "stopping"].includes(state.capture.status);

    refs.currentBadge.textContent = recorderView.badgeLabel;
    refs.currentBadge.dataset.status = recorderView.badgeStatus;
    refs.currentSummary.hidden = !normalizeText(recorderView.summary);
    refs.currentSummary.textContent = recorderView.summary;
    refs.currentHint.hidden = !normalizeText(recorderView.hint);
    refs.currentHint.textContent = recorderView.hint;
    refs.currentTimer.textContent = currentTimerText;
    refs.currentNotice.hidden = !state.notice.text;
    refs.currentNotice.textContent = state.notice.text;
    refs.currentNotice.dataset.tone = state.notice.tone || "";
    refs.startButton.hidden = !recorderView.showStart;
    refs.importAudioButton.hidden = !state.isLocalWorkspace || !recorderView.showStart;
    refs.pauseButton.hidden = !recorderView.showPause;
    refs.resumeButton.hidden = !recorderView.showResume;
    refs.stopButton.hidden = !recorderView.showStop;
    refs.discardButton.hidden = !recorderView.showDiscard;
    refs.startButton.disabled = !recorderView.canStart;
    refs.importAudioButton.disabled = !state.isLocalWorkspace || !recorderView.canStart;
    refs.pauseButton.disabled = !recorderView.canPause;
    refs.resumeButton.disabled = !recorderView.canResume;
    refs.stopButton.disabled = !recorderView.canStop;
    refs.discardButton.disabled = !recorderView.canDiscard;

    if (global.document.activeElement !== refs.sharedMemoInput) refs.sharedMemoInput.value = draftRecordMemo;
    refs.saveSharedMemoButton.disabled = true;
    refs.saveSharedMemoButton.textContent = draftRecordMemo ? "자동 보관됨" : "자동 보관";
    refs.clearSharedMemoButton.disabled = state.busy.saveMeetingMemo || !draftRecordMemo;
    refs.sharedMemoNotice.hidden = true;
    refs.recordCountBadge.textContent = `${historyEntries.length}건`;
    refs.recordList.innerHTML = historyEntries.length ? historyEntries.map((entry) => renderHistoryEntry(entry, state.selectedRecordId)).join("") : `<div class="notice-box">아직 기록이 없습니다.</div>`;

    refs.detailTitle.hidden = detailView.showRecordActions;
    refs.detailTitle.textContent = detailView.title;
    const showDetailBadge = Boolean(detailView.badgeLabel) && !["idle", "succeeded"].includes(normalizeText(detailView.badgeStatus));
    refs.detailBadge.hidden = !showDetailBadge;
    if (showDetailBadge) {
      refs.detailBadge.textContent = detailView.badgeLabel;
      refs.detailBadge.dataset.status = detailView.badgeStatus;
    }
    refs.detailSummary.hidden = !normalizeText(detailView.summary);
    refs.detailSummary.textContent = detailView.summary;
    refs.recordTitleGroup.hidden = !detailView.showRecordActions;
    if (global.document.activeElement !== refs.recordTitleInput) refs.recordTitleInput.value = detailView.recordTitle;
    refs.saveRecordTitleButton.disabled = !canRenameSelectedRecord || state.busy.saveRecordTitle || !draftRecordTitle || !recordTitleDirty;
    refs.saveRecordTitleButton.textContent = state.busy.saveRecordTitle ? "저장 중" : recordTitleDirty ? "이름 저장" : "저장됨";
    refs.downloadRecordButton.hidden = !canDownloadSelectedRecord;
    refs.downloadRecordButton.disabled = !canDownloadSelectedRecord;
    refs.deleteRecordButton.disabled = !canDeleteSelectedRecord || state.busy.deleteRecord;
    refs.detailMeta.hidden = !detailView.meta.length;
    refs.detailMeta.innerHTML = detailView.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("");

    const hasNotesValue = renderMeetingNotes(refs, detailView, state);
    const isCompletedRecord = normalizeText(detailView.badgeStatus) === "succeeded";
    const hasMemoValue = Boolean(normalizeText(detailView.recordMemo));
    const hasTranscriptValue = Boolean(normalizeText(detailView.transcriptText));
    const hasSegmentsValue = Array.isArray(detailView.segments) && detailView.segments.length > 0;
    const hasSegmentContent = hasSegmentsValue || hasTranscriptValue;
    const showSummaryReviewTab = !isCompletedRecord;
    const showMemoReviewTab = isCompletedRecord || hasMemoValue;
    const showNotesReviewTab = isCompletedRecord || hasNotesValue;
    const activeReviewTab = resolveReviewTab(state, detailView, hasNotesValue, { showSummaryTab: showSummaryReviewTab });
    state.reviewTab = activeReviewTab;
    refs.reviewTabSummary.hidden = !showSummaryReviewTab;
    refs.reviewTabMemo.hidden = !showMemoReviewTab;
    refs.reviewTabNotes.hidden = !showNotesReviewTab;
    refs.reviewTabSegments.hidden = !hasSegmentContent;
    refs.reviewTabSegmentsCount.hidden = !hasSegmentsValue;
    refs.reviewTabSegmentsCount.textContent = hasSegmentsValue ? `${detailView.segments.length}` : "";
    applyReviewTabState(refs, activeReviewTab);
    const reviewHeader = buildReviewHeaderModel(activeReviewTab);
    refs.reviewSectionEyebrow.textContent = reviewHeader.eyebrow;
    refs.reviewSectionTitle.textContent = reviewHeader.title;
    const summaryFlow = buildStatusFlow(detailView, {
      generatedAt: detailView.notesMeta?.generatedAt ? formatDateTime(detailView.notesMeta.generatedAt, "") : "",
      hasNotesValue,
      hasSegmentContent,
      segmentCount: hasSegmentsValue ? detailView.segments.length : 0,
      degradedReason: normalizeText(detailView.notesMeta?.degradedReason),
    });
    const showSummaryStatusPill = activeReviewTab === "summary"
      && Boolean(detailView.badgeLabel)
      && !["idle", "succeeded"].includes(normalizeText(detailView.badgeStatus));
    refs.summaryStatusPill.hidden = !showSummaryStatusPill;
    if (showSummaryStatusPill) {
      refs.summaryStatusPill.textContent = detailView.badgeLabel;
      refs.summaryStatusPill.dataset.status = detailView.badgeStatus;
    }
    refs.copySegmentsButton.hidden = activeReviewTab !== "segments" || !hasSegmentContent;
    refs.copySegmentsButton.disabled = activeReviewTab !== "segments" || !hasSegmentContent;
    refs.summaryStatusGrid.hidden = !summaryFlow.steps.length;
    refs.summaryStatusGrid.innerHTML = renderStatusFlow(summaryFlow);
    const summaryActionMessage = buildStatusActionMessage(detailView, {
      hasNotesValue,
      hasSegmentContent,
      updatedAt: formatDateTime(
        normalizeText(state.currentJob?.updatedAt || activeEntry?.remote?.updatedAt || activeEntry?.pending?.updatedAt),
        ""
      ),
    });
    const summaryActionHtml = buildSummaryActionCardHtml(detailView, summaryActionMessage);
    refs.summaryActionCard.hidden = !summaryActionHtml;
    refs.summaryActionCard.innerHTML = summaryActionHtml;
    const suppressProgressNotice = Boolean(detailView.chunkProgress)
      && !detailView.chunkProgress?.isStalled
      && ["queued", "processing", "uploading", "uploading_chunks", "preparing_chunks", "remote_queued", "remote_processing"].includes(normalizeText(detailView.badgeStatus));
    const showSummaryNotice = !suppressProgressNotice
      && Boolean(detailView.notice)
      && (detailView.badgeStatus !== "succeeded" || ["error", "warning"].includes(detailView.noticeTone));
    refs.detailNotice.hidden = !showSummaryNotice;
    refs.detailNotice.textContent = detailView.notice;
    refs.detailNotice.dataset.tone = showSummaryNotice ? detailView.noticeTone : "";
    refs.reviewPanelSummary.hidden = activeReviewTab !== "summary" || !showSummaryReviewTab;
    refs.reviewPanelMemo.hidden = activeReviewTab !== "memo" || !showMemoReviewTab;
    refs.meetingNotesCard.hidden = activeReviewTab !== "notes" || !showNotesReviewTab;
    refs.reviewPanelSegments.hidden = activeReviewTab !== "segments" || !hasSegmentContent;
    refs.detailMemoText.textContent = hasMemoValue
      ? detailView.recordMemo
      : showMemoReviewTab
        ? "아직 남긴 메모가 없습니다."
        : "";
    refs.segmentList.hidden = !hasSegmentContent;
    refs.segmentList.innerHTML = !hasSegmentContent
      ? ""
      : hasSegmentsValue
        ? detailView.segments.map((segment, index) => renderSegment(segment, index)).join("")
        : renderTranscriptFallback(detailView.transcriptText);
    return { activeEntry, historyEntries };
  }

  ns.render = {
    buildDetailView,
    buildSegmentCopyText,
    TERMINAL_REMOTE_STATUSES,
    buildRecorderView,
    buildHistoryEntries,
    buildWorkspaceView,
    buildLocalPendingJob,
    buildMeetingNotesSections,
    buildPendingActions,
    buildPendingNotice,
    buildPendingSummary,
    buildProcessingNotice,
    chooseSelectedRecordId,
    comparePendingUploads,
    findHistoryEntry,
    findRemoteForPending,
    normalizeArtifact,
    normalizeJob,
    normalizeRecord,
    renderWorkspace,
    renderNotesSection,
  };
})(globalThis);
