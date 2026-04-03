(function initHostedMeetingRender(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const { DEFAULT_NOTES_MODE, DEFAULT_NOTES_STYLE, TERMINAL_REMOTE_STATUSES, cleanPreviewText, countSpeakers, escapeHtml, formatBytes, formatDateTime, formatDuration, formatNotesModeLabel, formatNotesStyleLabel, formatPhase, formatSegmentRange, formatSpeakerLabel, formatStatusLabel, normalizeMeetingNotesMode, normalizeMeetingNotesStyle, normalizeSpeakerAliases, normalizeStatus, normalizeText, normalizeTextBlock, resolveSpeakerDisplayName } = ns.shared;
  const { comparePendingUploads, normalizePendingUpload } = ns.storage;
  const { formatActionItem, formatDecisionItem, formatMemoItem, formatRiskItem, formatTopicItem, hasMeetingNotes, normalizeMeetingNotes, normalizeTextArray } = ns.notes;
  const DEFAULT_CHUNK_PROGRESS_ACTIVE_COUNT = 2;
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

  function normalizeRecord(record) {
    const nextRecord = record && typeof record === "object" ? record : {};
    return {
      artifactId: normalizeText(nextRecord.artifactId),
      createdAt: normalizeText(nextRecord.createdAt),
      durationMs: Math.max(0, Number(nextRecord.durationMs) || 0),
      error: normalizeText(nextRecord.error),
      jobId: normalizeText(nextRecord.jobId),
      meetingId: normalizeText(nextRecord.meetingId),
      notesGeneratedAt: normalizeText(nextRecord.notesGeneratedAt),
      notesModeConfidence: Math.max(0, Math.min(1, Number(nextRecord.notesModeConfidence) || 0)),
      notesModeDetected: normalizeMeetingNotesMode(nextRecord.notesModeDetected),
      notesModeSelected: normalizeMeetingNotesMode(nextRecord.notesModeSelected),
      notesStyleSelected: normalizeMeetingNotesStyle(nextRecord.notesStyleSelected),
      previewText: cleanPreviewText(nextRecord.previewText),
      requestId: normalizeText(nextRecord.requestId),
      speakerCount: Math.max(0, Number(nextRecord.speakerCount) || 0),
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
      meetingNotes: normalizeMeetingNotes(job.meetingNotes, job.notesModeSelected),
      notesGeneratedAt: normalizeText(job.notesGeneratedAt),
      notesModeConfidence: Math.max(0, Math.min(1, Number(job.notesModeConfidence) || 0)),
      notesModeDetected: normalizeMeetingNotesMode(job.notesModeDetected),
      notesModeSelected: normalizeMeetingNotesMode(job.notesModeSelected),
      notesStyleSelected: normalizeMeetingNotesStyle(job.notesStyleSelected),
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
      speakerAliases: normalizeSpeakerAliases(job?.speakerAliases),
      speakerCount: Math.max(0, Number(job?.transcription?.speakerCount) || 0),
      status: normalizeText(job.status) || "idle",
      title: normalizeText(job.resultTitle || job.title || job?.meeting?.title) || normalizeText(fallbackTitle),
      updatedAt: normalizeText(job.updatedAt),
    };
  }

  function normalizeArtifact(artifact) {
    if (!artifact || typeof artifact !== "object") return null;
    const segments = Array.isArray(artifact.segments)
      ? artifact.segments.map((segment) => ({ endMs: Math.max(0, Number(segment.endMs) || 0), speakerLabel: normalizeText(segment.speakerLabel), startMs: Math.max(0, Number(segment.startMs) || 0), text: normalizeText(segment.text) })).filter((segment) => segment.text)
      : [];
    return {
      artifactId: normalizeText(artifact.artifactId),
      notes: normalizeMeetingNotes(artifact.notes, artifact.notesModeSelected),
      notesGeneratedAt: normalizeText(artifact.notesGeneratedAt),
      notesModeConfidence: Math.max(0, Math.min(1, Number(artifact.notesModeConfidence) || 0)),
      notesModeDetected: normalizeMeetingNotesMode(artifact.notesModeDetected),
      notesModeSelected: normalizeMeetingNotesMode(artifact.notesModeSelected),
      notesStyleSelected: normalizeMeetingNotesStyle(artifact.notesStyleSelected),
      speakerAliases: normalizeSpeakerAliases(artifact.speakerAliases),
      segments,
      speakerCount: countSpeakers(segments),
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
      notesModeConfidence: 0,
      notesModeDetected: "",
      notesModeSelected: "",
      notesStyleSelected: "",
      progress: { percent: progressPercent, phase: normalizeText(pending.status) },
      requestId: normalizeText(pending.requestId),
      resultTitle: normalizeText(pending.meetingTitleSnapshot),
      sharedMemoSnapshot: ns.shared.normalizeTextBlock(pending.sharedMemoSnapshot),
      sizeBytes: Math.max(0, Number(pending.sizeBytes) || 0),
      speakerCount: 0,
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

  function buildNotesSummaryMeta(meta, selectedStyle) {
    const appliedMode = normalizeMeetingNotesMode(meta?.selected || meta?.detected) || DEFAULT_NOTES_MODE;
    const appliedStyle = normalizeMeetingNotesStyle(selectedStyle || meta?.styleSelected) || DEFAULT_NOTES_STYLE;
    return `AI 판단 ${formatNotesModeLabel(appliedMode)} · 표현 ${formatNotesStyleLabel(appliedStyle)}`;
  }

  function compareSpeakerLabelOrder(left, right) {
    const leftLabel = normalizeText(left);
    const rightLabel = normalizeText(right);
    const leftMatch = leftLabel.match(/^SPEAKER_(\d+)$/i);
    const rightMatch = rightLabel.match(/^SPEAKER_(\d+)$/i);
    if (leftMatch && rightMatch) {
      return Number.parseInt(leftMatch[1], 10) - Number.parseInt(rightMatch[1], 10);
    }
    if (leftMatch) return -1;
    if (rightMatch) return 1;
    return leftLabel.localeCompare(rightLabel, "ko");
  }

  function listSpeakerLabels(segments) {
    return Array.from(
      new Set(
        (Array.isArray(segments) ? segments : [])
          .map((segment) => normalizeText(segment?.speakerLabel))
          .filter(Boolean)
      )
    ).sort(compareSpeakerLabelOrder);
  }

  function buildSpeakerEditorItems(segments, savedSpeakerAliases, draftSpeakerAliases) {
    return listSpeakerLabels(segments).map((speakerLabel) => ({
      alias: normalizeText(draftSpeakerAliases?.[speakerLabel] || ""),
      defaultLabel: formatSpeakerLabel(speakerLabel),
      displayLabel: resolveSpeakerDisplayName(speakerLabel, savedSpeakerAliases),
      speakerLabel,
    }));
  }

  function buildSpeakerSummaryEntries(speakerSummaries, segments, speakerAliases) {
    const segmentMetaMap = new Map();
    for (const segment of Array.isArray(segments) ? segments : []) {
      const speakerLabel = normalizeText(segment?.speakerLabel);
      const text = normalizeText(segment?.text);
      if (!speakerLabel || !text) continue;
      const startMs = Math.max(0, Number(segment?.startMs) || 0);
      const endMs = Math.max(startMs, Number(segment?.endMs) || startMs);
      if (!segmentMetaMap.has(speakerLabel)) {
        segmentMetaMap.set(speakerLabel, { firstStartMs: startMs, segmentCount: 0, totalDurationMs: 0 });
      }
      const entry = segmentMetaMap.get(speakerLabel);
      entry.firstStartMs = Math.min(entry.firstStartMs, startMs);
      entry.segmentCount += 1;
      entry.totalDurationMs += Math.max(0, endMs - startMs);
    }
    return (Array.isArray(speakerSummaries) ? speakerSummaries : [])
      .map((item) => {
        const speakerLabel = normalizeText(item?.speakerLabel);
        if (!speakerLabel) return null;
        const meta = segmentMetaMap.get(speakerLabel);
        return {
          displayLabel: resolveSpeakerDisplayName(speakerLabel, speakerAliases) || formatSpeakerLabel(speakerLabel) || "화자",
          keyPoints: normalizeTextArray(item?.keyPoints),
          metaText: [
            meta?.segmentCount > 0 ? `발화 ${meta.segmentCount}개` : "",
            meta?.totalDurationMs > 0 ? formatDuration(meta.totalDurationMs) : "",
          ].filter(Boolean).join(" · "),
          sortStartMs: Number(meta?.firstStartMs) || Number.MAX_SAFE_INTEGER,
          speakerLabel,
          summary: normalizeText(item?.summary),
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.sortStartMs !== right.sortStartMs) {
          return left.sortStartMs - right.sortStartMs;
        }
        return compareSpeakerLabelOrder(left.speakerLabel, right.speakerLabel);
      });
  }

  function buildTranscriptTextForDisplay(segments, fallbackText, speakerAliases) {
    const lines = (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const text = normalizeText(segment?.text);
        if (!text) return "";
        return `${resolveSpeakerDisplayName(segment?.speakerLabel, speakerAliases)}: ${text}`;
      })
      .filter(Boolean);
    return normalizeTextBlock(lines.join("\n") || fallbackText);
  }

  function buildSegmentCopyText(segments, fallbackText, speakerAliases) {
    const lines = (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const text = normalizeText(segment?.text);
        if (!text) return "";
        const range = normalizeText(formatSegmentRange(segment?.startMs, segment?.endMs));
        const speaker = resolveSpeakerDisplayName(segment?.speakerLabel, speakerAliases);
        return `${range ? `[${range}] ` : ""}${speaker}: ${text}`;
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
    const sections = [];
    pushSection(sections, "회의 개요", buildMeetingOverviewItems(notes));
    pushSection(sections, "주요 논의 내용", notes.topics.map(formatTopicItem));
    if (notes.mode === "interview") {
      pushSection(sections, "인터뷰 핵심 포인트", [
        ...normalizeTextArray(notes.modeSpecific?.strengths),
        ...normalizeTextArray(notes.modeSpecific?.concerns),
      ]);
    } else if (notes.mode === "review") {
      pushSection(sections, "리뷰 및 회고 포인트", [
        ...normalizeTextArray(notes.modeSpecific?.wins),
        ...normalizeTextArray(notes.modeSpecific?.problems),
        ...normalizeTextArray(notes.modeSpecific?.rootCauses),
        ...normalizeTextArray(notes.modeSpecific?.improvements),
      ]);
    } else if (notes.mode === "planning") {
      pushSection(sections, "범위 및 일정 포인트", [
        ...normalizeTextArray(notes.modeSpecific?.scopeItems),
        ...normalizeTextArray(notes.modeSpecific?.milestones),
      ]);
    }
    pushSection(sections, "주요 결정 사항", notes.decisions.map(formatDecisionItem));
    pushSection(sections, "추가 결정 필요 사항", [
      ...normalizeTextArray(notes.openQuestions),
      ...normalizeTextArray(notes.modeSpecific?.followUpQuestions),
    ]);
    pushSection(sections, "리스크 및 제약", [
      ...normalizeTextArray(notes.modeSpecific?.dependencies),
      ...notes.risksOrDependencies.map(formatRiskItem),
    ]);
    pushSection(sections, "후속 실행 항목", notes.actionItems.map(formatActionItem));
    pushSection(sections, "메모 반영 포인트", notes.memoHighlights.map(formatMemoItem));
    return sections;
  }

  function buildMeetingOverviewItems(notes) {
    const items = [];
    const purpose = ns.shared.normalizeTextBlock(notes?.meetingMeta?.purpose);
    const participants = normalizeTextArray(notes?.meetingMeta?.participants);
    const datetime = normalizeText(notes?.meetingMeta?.datetime);
    if (purpose) {
      items.push(purpose);
    }
    if (participants.length) {
      items.push(`참여자: ${participants.join(", ")}`);
    }
    if (datetime) {
      items.push(`일시: ${datetime}`);
    }
    return items;
  }

  function pushSection(target, title, items) {
    const normalizedItems = (Array.isArray(items) ? items : []).map((item) => ns.shared.normalizeTextBlock(item)).filter(Boolean);
    if (normalizedItems.length) target.push({ items: normalizedItems, title });
  }

  function renderNotesSection(section) {
    return `<section class="notes-section"><h3 class="notes-section__title">${escapeHtml(section.title)}</h3><ul class="notes-list">${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
  }

  function renderNotesOverview(summaryItems) {
    const items = (Array.isArray(summaryItems) ? summaryItems : []).map((item) => ns.shared.normalizeTextBlock(item)).filter(Boolean);
    if (!items.length) {
      return "";
    }
    return `<section class="notes-section"><h3 class="notes-section__title">핵심 요약</h3><ul class="notes-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
  }

  function buildStatusFlow(detailView, options = {}) {
    const normalizedStatus = normalizeText(detailView.badgeStatus);
    const recordSelected = normalizedStatus !== "idle";
    const isFailed = normalizedStatus === "failed";
    const isBusy = ["queued", "processing", "uploading", "uploading_chunks", "preparing_chunks", "remote_queued", "remote_processing"].includes(normalizedStatus);
    const speakerCount = Math.max(0, Number(options.speakerCount) || 0);
    const segmentCount = Math.max(0, Number(options.segmentCount) || 0);
    const speakerAliasCount = Math.max(0, Number(options.speakerAliasCount) || 0);
    const speakerSummaryCount = Math.max(0, Number(options.speakerSummaryCount) || 0);
    const recordTitle = normalizeText(detailView.recordTitle || detailView.title);
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
      pushStep("발화 구간", "failed", "오류로 중단되었습니다.");
    } else if (options.hasSegmentContent) {
      pushStep("발화 구간", "done", [speakerCount > 0 ? `화자 ${speakerCount}명` : "", segmentCount > 0 ? `구간 ${segmentCount}개` : "전사 준비 완료"].filter(Boolean).join(" · "));
    } else if (isBusy) {
      pushStep("발화 구간", "current", "전사 결과를 준비하는 중입니다.");
    } else if (recordSelected) {
      pushStep("발화 구간", "warning", "인식된 발화가 아직 충분하지 않습니다.");
    } else {
      pushStep("발화 구간", "pending", "기록 선택 후 전사를 확인합니다.");
    }

    if (isFailed) {
      pushStep("회의 정리", "failed", "오류 해결 후 다시 생성합니다.");
    } else if (options.hasNotesValue) {
      pushStep("회의 정리", "done", [options.notesModeLabel, options.generatedAt].filter(Boolean).join(" · ") || "회의 정리가 준비됐습니다.");
    } else if (options.hasSegmentContent) {
      pushStep("회의 정리", "warning", "다시 정리하면 생성됩니다.", "재정리");
    } else {
      pushStep("회의 정리", isBusy ? "current" : "pending", "전사 확보 후 생성됩니다.");
    }

    if (speakerCount <= 0) {
      pushStep("화자 이름", options.hasSegmentContent ? "pending" : "pending", "화자 인식 후 이름을 반영합니다.");
    } else if (speakerAliasCount >= speakerCount) {
      pushStep("화자 이름", "done", `${speakerAliasCount}/${speakerCount}명 반영`);
    } else if (speakerAliasCount > 0) {
      pushStep("화자 이름", "current", `${speakerAliasCount}/${speakerCount}명 반영`, "입력");
    } else {
      pushStep("화자 이름", "current", `${speakerCount}명 이름 지정 가능`, "입력");
    }

    if (isFailed) {
      pushStep("화자별 정리", "failed", "오류 해결 후 다시 생성합니다.");
    } else if (options.hasSpeakerSummaryValue) {
      pushStep("화자별 정리", "done", `${speakerSummaryCount || speakerCount || 0}명 요약 준비`);
    } else if (options.hasNotesValue) {
      pushStep("화자별 정리", "warning", "다시 정리하면 생성됩니다.", "재정리");
    } else {
      pushStep("화자별 정리", "pending", "회의 정리 후 채워집니다.");
    }

    if (isFailed) {
      pushStep("검토 마무리", "failed", "오류를 정리한 뒤 다시 확인합니다.");
    } else if (options.hasNotesValue && options.hasSegmentContent) {
      pushStep("검토 마무리", "done", "복사 · 다운로드 · 제목 수정");
    } else if (options.hasSegmentContent) {
      pushStep("검토 마무리", "current", "발화 구간부터 확인할 수 있습니다.", "검토");
    } else {
      pushStep("검토 마무리", "pending", "결과가 준비되면 검토합니다.");
    }

    if (recordSelected && !["idle", "succeeded"].includes(normalizedStatus)) pushFact("현재 상태", detailView.badgeLabel);
    if (speakerCount > 0) pushFact("화자", `${speakerCount}명`);
    if (segmentCount > 0) pushFact("발화", `${segmentCount}개`);
    pushFact("AI 판단", options.notesModeLabel);
    pushFact("표현 방식", options.notesStyleLabel);
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
      return "회의 정리를 한 번 다시 돌리면 됩니다.";
    }
    if (!options.hasSpeakerSummaryValue) {
      return "화자별 정리는 다시 정리 후 채워집니다.";
    }
    if (detailView.showSpeakerEditor && options.speakerCount > Object.keys(detailView.speakerAliases || {}).length) {
      return "화자명을 저장한 뒤 다시 정리하면 결과가 더 자연스럽습니다.";
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
      return { badgeLabel: "대기", badgeStatus: "idle", chunkProgress: null, meta: [], meetingNotes: null, notesMeta: null, notice: "왼쪽에서 기록을 선택해 주세요.", noticeTone: "", recordMemo: "", recordTitle: "", segments: [], showRecordActions: false, showSpeakerEditor: false, speakerAliases: {}, speakerCount: 0, speakerSummaryEntries: [], speakerEditorItems: [], summary: "", title: "기록을 선택해 주세요", transcriptText: "" };
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
      return { badgeLabel: formatStatusLabel(pending.status), badgeStatus: normalizeStatus(pending.status), chunkProgress: pendingChunkProgress, meta: detailMeta, meetingNotes: null, notesMeta: null, notice: buildPendingNotice(pending), noticeTone: pending.status === "failed" ? "error" : "highlight", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions, showSpeakerEditor: false, speakerAliases: {}, speakerCount: 0, speakerSummaryEntries: [], speakerEditorItems: [], summary: buildPendingSummary(pending), title: detailTitle, transcriptText: "" };
    }

    const normalizedJob = state.currentJob || normalizeJob(remote, detailTitle);
    const normalizedArtifact = state.currentArtifact;
    const speakerCount = Math.max(0, Number(
      normalizedArtifact?.speakerCount
      || normalizedJob?.speakerCount
      || remote?.speakerCount
    ) || 0);
    const speakerAliases = normalizeSpeakerAliases({
      ...(normalizedArtifact?.speakerAliases || {}),
      ...(normalizedJob?.speakerAliases || {}),
    });
    const meetingNotes = normalizeMeetingNotes(normalizedArtifact?.notes || normalizedJob?.meetingNotes, normalizedArtifact?.notesModeSelected || normalizedJob?.notesModeSelected);
    const segments = Array.isArray(normalizedArtifact?.segments) ? normalizedArtifact.segments : [];
    const transcriptText = buildTranscriptTextForDisplay(segments, normalizedArtifact?.text, speakerAliases);
    const speakerSummaryEntries = buildSpeakerSummaryEntries(meetingNotes?.speakerSummaries, segments, speakerAliases);
    const speakerEditorItems = buildSpeakerEditorItems(segments, speakerAliases, state.speakerAliasDrafts);
    const hasNotesValue = hasMeetingNotes(meetingNotes);
    const hasTranscriptValue = Boolean(transcriptText);
    const hasSegmentsValue = segments.length > 0;
    const showSpeakerEditor = Boolean(remote?.jobId) && hasSegmentsValue;
    const notesMeta = {
      confidence: Number(normalizedArtifact?.notesModeConfidence || normalizedJob?.notesModeConfidence) || 0,
      detected: normalizeMeetingNotesMode(normalizedArtifact?.notesModeDetected || normalizedJob?.notesModeDetected) || meetingNotes.mode,
      generatedAt: normalizeText(normalizedArtifact?.notesGeneratedAt || normalizedJob?.notesGeneratedAt),
      selected: normalizeMeetingNotesMode(normalizedArtifact?.notesModeSelected || normalizedJob?.notesModeSelected) || meetingNotes.mode,
      styleSelected: normalizeMeetingNotesStyle(normalizedArtifact?.notesStyleSelected || normalizedJob?.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    };
    const remoteChunkProgress = buildChunkProgressModel(normalizedJob, pending);

    if (normalizeText(normalizedJob?.status) === "failed") {
      return { badgeLabel: "오류", badgeStatus: "failed", chunkProgress: remoteChunkProgress, meta: detailMeta, meetingNotes: null, notesMeta, notice: normalizeText(normalizedJob?.error || pending?.lastError) || "회의 처리 중 오류가 발생했습니다.", noticeTone: "error", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions, showSpeakerEditor: false, speakerAliases, speakerCount, speakerSummaryEntries: [], speakerEditorItems: [], summary: "", title: detailTitle, transcriptText: "" };
    }
    if (["queued", "processing"].includes(normalizeText(normalizedJob?.status))) {
      return { badgeLabel: processingHealth.isStalled ? "정체 의심" : formatStatusLabel(normalizedJob.status), badgeStatus: normalizeStatus(normalizedJob.status), chunkProgress: remoteChunkProgress, meta: detailMeta, meetingNotes: null, notesMeta, notice: buildProcessingNotice(normalizedJob, pending), noticeTone: processingHealth.isStalled ? "warning" : "highlight", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions: false, showSpeakerEditor: false, speakerAliases, speakerCount, speakerSummaryEntries: [], speakerEditorItems: [], summary: "", title: detailTitle, transcriptText: "" };
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
    return { badgeLabel: "완료", badgeStatus: "succeeded", chunkProgress: null, meta: detailMeta, meetingNotes, notesMeta, notice: completionNotice, noticeTone: completionTone, recordMemo: detailMemo, recordTitle: detailTitle, segments, showRecordActions, showSpeakerEditor, speakerAliases, speakerCount, speakerSummaryEntries, speakerEditorItems, summary: "", title: detailTitle, transcriptText };
  }

  function renderSegment(segment, speakerAliases) {
    return `<article class="segment-item"><div class="segment-item__head"><span class="segment-item__speaker">${escapeHtml(resolveSpeakerDisplayName(segment.speakerLabel, speakerAliases))}</span><span>${escapeHtml(formatSegmentRange(segment.startMs, segment.endMs))}</span></div><p>${escapeHtml(segment.text)}</p></article>`;
  }

  function renderTranscriptFallback(transcriptText) {
    return `<div class="transcript-box">${escapeHtml(transcriptText)}</div>`;
  }

  function renderSpeakerSummaryEntry(entry) {
    return `
      <article class="speaker-digest-card">
        <div class="speaker-digest-card__head">
          <div>
            <strong class="speaker-digest-card__name">${escapeHtml(entry.displayLabel)}</strong>
            ${entry.metaText ? `<div class="speaker-digest-card__meta">${escapeHtml(entry.metaText)}</div>` : ""}
          </div>
        </div>
        ${entry.summary ? `<div class="speaker-digest-summary">${escapeHtml(entry.summary)}</div>` : ""}
        ${entry.keyPoints.length ? `<ul class="speaker-digest-items">${entry.keyPoints.map((item) => `<li class="speaker-digest-item"><p class="speaker-digest-item__text">${escapeHtml(item)}</p></li>`).join("")}</ul>` : ""}
      </article>
    `;
  }

  function renderSpeakerEditorItem(item) {
    return `
      <label class="speaker-alias-card" for="speaker-alias-${escapeHtml(item.speakerLabel)}">
        <span class="speaker-alias-card__meta">
          <span class="speaker-alias-card__chip">${escapeHtml(item.defaultLabel)}</span>
          <span class="speaker-alias-card__current">${escapeHtml(item.displayLabel)}</span>
        </span>
        <input
          id="speaker-alias-${escapeHtml(item.speakerLabel)}"
          class="meeting-input speaker-alias-card__input"
          type="text"
          maxlength="80"
          data-speaker-label="${escapeHtml(item.speakerLabel)}"
          placeholder="${escapeHtml(item.defaultLabel)}"
          value="${escapeHtml(item.alias)}"
        />
      </label>
    `;
  }

  function buildSpeakerEditorRenderKey(detailView, state) {
    return [
      normalizeText(state.selectedRecordId),
      detailView.showSpeakerEditor ? "show" : "hidden",
      ...(Array.isArray(detailView.speakerEditorItems)
        ? detailView.speakerEditorItems.map((item) => [item.speakerLabel, item.defaultLabel, item.displayLabel].join("::"))
        : []),
    ].join("||");
  }

  function buildDraftSpeakerAliases(detailView, state) {
    const allowedLabels = new Set((Array.isArray(detailView.speakerEditorItems) ? detailView.speakerEditorItems : []).map((item) => item.speakerLabel));
    return normalizeSpeakerAliases(state.speakerAliasDrafts, allowedLabels);
  }

  function areSpeakerAliasesEqual(left, right) {
    const leftKeys = Object.keys(left || {}).sort(compareSpeakerLabelOrder);
    const rightKeys = Object.keys(right || {}).sort(compareSpeakerLabelOrder);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => key === rightKeys[index] && normalizeText(left[key]) === normalizeText(right[key]));
  }

  function renderHistoryEntry(entry, selectedRecordId) {
    const title = normalizeText(entry.remote?.title || entry.pending?.meetingTitleSnapshot || "새 기록");
    const pendingSummary = entry.pending?.status === "succeeded" ? "" : buildPendingSummary(entry.pending);
    const pendingNotice = entry.pending?.status === "succeeded" ? "" : buildPendingNotice(entry.pending);
    const meta = [formatDateTime(entry.updatedAt || entry.createdAt, ""), entry.durationMs > 0 ? formatDuration(entry.durationMs) : "", entry.pending?.sizeBytes > 0 ? formatBytes(entry.pending.sizeBytes) : ""].filter(Boolean).join(" · ");
    const chips = [];
    const notesMode = normalizeMeetingNotesMode(entry.remote?.notesModeSelected || entry.remote?.notesModeDetected);
    const notesStyle = normalizeMeetingNotesStyle(entry.remote?.notesStyleSelected);
    const speakerCount = Math.max(0, Number(entry.remote?.speakerCount) || 0);
    if (notesMode) chips.push({ label: `AI 판단 ${formatNotesModeLabel(notesMode)}`, tone: "accent" });
    if (notesStyle) chips.push({ label: `표현 ${formatNotesStyleLabel(notesStyle)}`, tone: "muted" });
    if (speakerCount > 0) chips.push({ label: `화자 ${speakerCount}명`, tone: "muted" });
    if (!chips.length && pendingSummary) chips.push({ label: pendingSummary, tone: "muted" });
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
    const normalized = normalizeMeetingNotes(detailView.meetingNotes, detailView.notesMeta?.selected);
    const hasNotesValue = hasMeetingNotes(normalized);
    if (!hasNotesValue) {
      refs.meetingNotesOverview.hidden = true;
      refs.meetingNotesOverview.innerHTML = "";
      refs.meetingNotesSections.innerHTML = "";
      refs.notesSummaryMeta.textContent = "AI 판단 대기";
      refs.notesStyleSelect.value = DEFAULT_NOTES_STYLE;
      refs.notesStyleSelect.disabled = true;
      refs.regenerateNotesButton.disabled = true;
      refs.regenerateNotesButton.textContent = "현재 표현 방식으로 다시 정리";
      return false;
    }
    const appliedMode = normalizeMeetingNotesMode(detailView.notesMeta?.selected || normalized.mode) || DEFAULT_NOTES_MODE;
    const appliedStyle = normalizeMeetingNotesStyle(detailView.notesMeta?.styleSelected) || DEFAULT_NOTES_STYLE;
    const selectedStyle = normalizeMeetingNotesStyle(state.notesStyleSelection || appliedStyle) || DEFAULT_NOTES_STYLE;
    const pendingStyleChange = selectedStyle !== appliedStyle;
    refs.notesStyleSelect.value = selectedStyle;
    refs.notesStyleSelect.disabled = !state.currentJob?.jobId || state.busy.regenerateNotes || !TERMINAL_REMOTE_STATUSES.has(normalizeText(state.currentJob?.status));
    refs.regenerateNotesButton.disabled = refs.notesStyleSelect.disabled;
    refs.notesSummaryMeta.textContent = buildNotesSummaryMeta(detailView.notesMeta, selectedStyle);
    refs.regenerateNotesButton.textContent = state.busy.regenerateNotes
      ? "정리 중"
      : pendingStyleChange
        ? `${formatNotesStyleLabel(selectedStyle)}로 다시 정리`
        : "현재 표현 방식으로 다시 정리";
    const overviewMarkup = renderNotesOverview(normalized.executiveSummary);
    refs.meetingNotesOverview.hidden = !overviewMarkup;
    refs.meetingNotesOverview.innerHTML = overviewMarkup;
    refs.meetingNotesSections.innerHTML = buildMeetingNotesSections(normalized).map(renderNotesSection).join("");
    return true;
  }

  function resolveReviewTab(state, detailView, hasNotesValue) {
    const hasMemoValue = Boolean(normalizeText(detailView.recordMemo));
    const hasTranscriptValue = Boolean(normalizeText(detailView.transcriptText));
    const hasSegmentsValue = Array.isArray(detailView.segments) && detailView.segments.length > 0;
    const hasSegmentContent = hasSegmentsValue || hasTranscriptValue;
    const hasSpeakerSummaryTab = hasNotesValue;
    let nextTab = normalizeText(state.reviewTab) || "notes";
    if (nextTab === "transcript") {
      nextTab = "segments";
    }
    if (!["summary", "memo", "notes", "segments", "speakers"].includes(nextTab)) {
      nextTab = "notes";
    }
    if (!detailView.showRecordActions && !hasMemoValue && !hasSegmentContent && !hasNotesValue) {
      return "summary";
    }
    if (nextTab === "memo" && !hasMemoValue) {
      return hasNotesValue ? "notes" : hasSegmentContent ? "segments" : "summary";
    }
    if (nextTab === "notes" && !hasNotesValue) {
      return hasMemoValue ? "memo" : hasSegmentContent ? "segments" : "summary";
    }
    if (nextTab === "segments" && !hasSegmentContent) {
      return hasNotesValue ? "notes" : hasMemoValue ? "memo" : "summary";
    }
    if (nextTab === "speakers" && !hasSpeakerSummaryTab) {
      return hasNotesValue ? "notes" : hasSegmentContent ? "segments" : hasMemoValue ? "memo" : "summary";
    }
    return nextTab;
  }

  function applyReviewTabState(refs, activeTab) {
    const tabMap = {
      memo: refs.reviewTabMemo,
      notes: refs.reviewTabNotes,
      segments: refs.reviewTabSegments,
      speakers: refs.reviewTabSpeakers,
      summary: refs.reviewTabSummary,
    };
    for (const [tabName, element] of Object.entries(tabMap)) {
      if (!element) continue;
      const selected = tabName === activeTab;
      element.classList.toggle("is-active", selected);
      element.setAttribute("aria-selected", selected ? "true" : "false");
    }
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
    const draftSpeakerAliases = buildDraftSpeakerAliases(detailView, state);
    const speakerAliasDirty = !areSpeakerAliasesEqual(detailView.speakerAliases, draftSpeakerAliases);
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
    refs.speakerEditor.hidden = !detailView.showSpeakerEditor;
    const speakerEditorRenderKey = buildSpeakerEditorRenderKey(detailView, state);
    if (!detailView.showSpeakerEditor) {
      refs.speakerAliasList.innerHTML = "";
      refs.speakerAliasList.dataset.renderKey = "";
    } else if (refs.speakerAliasList.dataset.renderKey !== speakerEditorRenderKey) {
      refs.speakerAliasList.innerHTML = detailView.speakerEditorItems.map(renderSpeakerEditorItem).join("");
      refs.speakerAliasList.dataset.renderKey = speakerEditorRenderKey;
    }
    refs.saveSpeakerAliasesButton.disabled = !detailView.showSpeakerEditor || state.busy.saveSpeakerAliases || !speakerAliasDirty;
    refs.saveSpeakerAliasesButton.textContent = state.busy.saveSpeakerAliases ? "저장 중" : speakerAliasDirty ? "화자명 저장" : "저장됨";
    refs.saveSpeakerAliasesAndRegenerateButton.disabled = !detailView.showSpeakerEditor || state.busy.saveSpeakerAliases || state.busy.regenerateNotes || !speakerAliasDirty;
    refs.saveSpeakerAliasesAndRegenerateButton.textContent = state.busy.regenerateNotes ? "정리 중" : "저장 후 다시 정리";

    const hasNotesValue = renderMeetingNotes(refs, detailView, state);
    const hasMemoValue = Boolean(normalizeText(detailView.recordMemo));
    const hasTranscriptValue = Boolean(normalizeText(detailView.transcriptText));
    const hasSegmentsValue = Array.isArray(detailView.segments) && detailView.segments.length > 0;
    const hasSegmentContent = hasSegmentsValue || hasTranscriptValue;
    const hasSpeakerSummaryTab = hasNotesValue;
    const hasSpeakerDigestValue = Array.isArray(detailView.speakerSummaryEntries) && detailView.speakerSummaryEntries.length > 0;
    const activeReviewTab = resolveReviewTab(state, detailView, hasNotesValue);
    state.reviewTab = activeReviewTab;
    refs.reviewTabSummary.hidden = false;
    refs.reviewTabMemo.hidden = !hasMemoValue;
    refs.reviewTabNotes.hidden = !hasNotesValue;
    refs.reviewTabSegments.hidden = !hasSegmentContent;
    refs.reviewTabSpeakers.hidden = !hasSpeakerSummaryTab;
    const visibleSpeakerCount = Math.max(0, Number(detailView.speakerCount) || 0);
    refs.reviewTabSegmentsCount.hidden = visibleSpeakerCount <= 0;
    refs.reviewTabSegmentsCount.textContent = visibleSpeakerCount > 0 ? `${visibleSpeakerCount}` : "";
    refs.copySegmentsButton.hidden = !hasSegmentContent;
    refs.copySegmentsButton.disabled = !hasSegmentContent;
    applyReviewTabState(refs, activeReviewTab);
    const speakerAliasCount = Object.values(detailView.speakerAliases || {}).filter((value) => normalizeText(value)).length;
    const summaryFlow = buildStatusFlow(detailView, {
      generatedAt: detailView.notesMeta?.generatedAt ? formatDateTime(detailView.notesMeta.generatedAt, "") : "",
      hasNotesValue,
      hasSegmentContent,
      hasSpeakerSummaryValue: hasSpeakerDigestValue,
      notesModeLabel: hasNotesValue ? formatNotesModeLabel(detailView.notesMeta?.selected || detailView.meetingNotes?.mode) : "",
      notesStyleLabel: hasNotesValue ? formatNotesStyleLabel(detailView.notesMeta?.styleSelected) : "",
      segmentCount: hasSegmentsValue ? detailView.segments.length : 0,
      speakerAliasCount,
      speakerCount: visibleSpeakerCount,
      speakerSummaryCount: hasSpeakerDigestValue ? detailView.speakerSummaryEntries.length : 0,
    });
    const showSummaryStatusPill = Boolean(detailView.badgeLabel) && !["idle", "succeeded"].includes(normalizeText(detailView.badgeStatus));
    refs.summaryStatusPill.hidden = !showSummaryStatusPill;
    if (showSummaryStatusPill) {
      refs.summaryStatusPill.textContent = detailView.badgeLabel;
      refs.summaryStatusPill.dataset.status = detailView.badgeStatus;
    }
    refs.summaryStatusGrid.hidden = !summaryFlow.steps.length;
    refs.summaryStatusGrid.innerHTML = renderStatusFlow(summaryFlow);
    const summaryActionMessage = buildStatusActionMessage(detailView, {
      hasNotesValue,
      hasSegmentContent,
      hasSpeakerSummaryValue: hasSpeakerDigestValue,
      speakerCount: visibleSpeakerCount,
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
    refs.reviewPanelSummary.hidden = activeReviewTab !== "summary";
    refs.reviewPanelMemo.hidden = activeReviewTab !== "memo" || !hasMemoValue;
    refs.meetingNotesCard.hidden = activeReviewTab !== "notes" || !hasNotesValue;
    refs.reviewPanelSegments.hidden = activeReviewTab !== "segments" || !hasSegmentContent;
    refs.reviewPanelSpeakers.hidden = activeReviewTab !== "speakers" || !hasSpeakerSummaryTab;
    refs.detailMemoText.textContent = detailView.recordMemo;
    refs.segmentList.hidden = !hasSegmentContent;
    refs.segmentList.innerHTML = !hasSegmentContent
      ? ""
      : hasSegmentsValue
        ? detailView.segments.map((segment) => renderSegment(segment, detailView.speakerAliases)).join("")
        : renderTranscriptFallback(detailView.transcriptText);
    refs.speakerDigestList.hidden = activeReviewTab !== "speakers" || !hasSpeakerSummaryTab;
    refs.speakerDigestList.innerHTML = hasSpeakerDigestValue
      ? detailView.speakerSummaryEntries.map(renderSpeakerSummaryEntry).join("")
      : `<div class="notice-box">이 기록에는 아직 화자별 정리가 없습니다. 회의 정리에서 다시 정리하면 생성됩니다.</div>`;
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
    buildNotesSummaryMeta,
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
