function createMeetingNotesEditDomain(deps) {
  const {
    applyMeetingTermReplacements,
    assertJobOwnership,
    assertMeetingIsActive,
    buildMeetingNotesTranscriptPrompt,
    buildWorkspaceMutation,
    createHttpError,
    crypto,
    db,
    getClient,
    getMeetingSummaryModel,
    hasMeetingNotes,
    jobCollection,
    loadMeetingArtifactSource,
    loadMeetingSummaryRecord,
    loadMeetingTranscriptForNotes,
    loadOwnedMeetingJobs,
    logEvent,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeMeetingNotes,
    normalizeMeetingTermReplacements,
    normalizeCompletionContent,
    normalizeText,
    normalizeTextBlock,
    parseMeetingNotesJson,
    resolveMeetingResultTitle,
    updateMeetingSummaryRecordResult,
  } = deps;

  function assertValidMeetingTermReplacementRequest(rawInput, normalizedInput, provided) {
    if (!provided) {
      return;
    }
    if (!Array.isArray(rawInput)) {
      throw createHttpError(400, "용어 치환 목록 형식이 올바르지 않아요.");
    }
    if (rawInput.length !== normalizedInput.length) {
      throw createHttpError(400, "용어 치환에는 비어 있는 항목이나 중복된 원문을 넣을 수 없어요.");
    }
  }

  async function applyMeetingTermReplacementsAcrossMeeting(owner, meetingId, termReplacementsInput, updatedAtInput) {
    const updatedAt = normalizeText(updatedAtInput) || new Date().toISOString();
    const termReplacements = normalizeMeetingTermReplacements(termReplacementsInput);
    const jobs = await loadOwnedMeetingJobs(owner, meetingId);
    for (const job of jobs) {
      await applyMeetingTermReplacementsToResult(owner, job, termReplacements, updatedAt);
    }
  }

  async function previewMeetingNotesSectionEdit(input, owner) {
    const source = await loadMeetingNotesSectionEditSource(input, owner);
    const previewPayload = await generateMeetingNotesSectionEditPayload({
      currentNotes: source.currentNotes,
      currentSectionData: readMeetingNotesSectionData(source.currentNotes, input.sectionKey),
      instruction: input.instruction,
      sectionKey: input.sectionKey,
      termReplacements: source.termReplacements,
      transcript: source.transcript,
    });
    const mergedNotes = applyMeetingNotesSectionPayload(source.currentNotes, input.sectionKey, previewPayload.payload);
    const nextNotes = applyMeetingTermReplacements(mergedNotes, source.termReplacements);
    if (previewPayload.warning) {
      logEvent("meeting.notes.section-edit.preview.warning", {
        jobId: source.job.jobId,
        meetingId: source.job.meetingId,
        providerUserKey: owner.providerUserKey,
        sectionKey: input.sectionKey,
        warning: previewPayload.warning,
      });
    }
    return {
      baseRevisionToken: source.baseRevisionToken,
      sectionData: readMeetingNotesSectionData(nextNotes, input.sectionKey),
      sectionKey: input.sectionKey,
      warning: previewPayload.warning,
    };
  }

  async function applyMeetingNotesSectionEdit(input, owner) {
    const source = await loadMeetingNotesSectionEditSource(input, owner);
    if (input.baseRevisionToken !== source.baseRevisionToken) {
      throw createHttpError(409, "회의 정리가 바뀌어 미리보기가 오래됐어요. 새 미리보기를 다시 만들어 주세요.");
    }
    const normalizedPayload = normalizeMeetingNotesSectionPayload(input.sectionKey, input.sectionData);
    const mergedNotes = applyMeetingNotesSectionPayload(source.currentNotes, input.sectionKey, normalizedPayload);
    const nextNotes = applyMeetingTermReplacements(mergedNotes, source.termReplacements);
    const requestId = normalizeText(input.clientRequestId) || db.collection(jobCollection).doc().id;
    const updatedAt = new Date().toISOString();
    const shouldSyncTitle = shouldAutoSyncResultTitleFromNotes(source.job, source.currentNotes);
    const nextTitle = shouldSyncTitle
      ? resolveMeetingResultTitle({ notes: nextNotes }, source.job.title)
      : source.job.title;
    const workspaceMutation = buildWorkspaceMutation({
      completedAt: updatedAt,
      requestId,
      requestedAt: updatedAt,
      status: "succeeded",
      type: "applySectionEdit",
    });
    const jobPatch = {
      meetingNotes: nextNotes,
      updatedAt,
      workspaceMutation,
    };
    if (normalizeText(nextTitle) !== normalizeText(source.job.title)) {
      jobPatch.title = nextTitle;
    }
    const artifactPatch = {
      notes: nextNotes,
    };

    const nextJob = normalizeMeetingJob({
      ...source.job,
      ...jobPatch,
    });
    const nextArtifact = source.artifact
      ? normalizeMeetingArtifact({
          ...source.artifact,
          ...artifactPatch,
        })
      : null;
    await Promise.all([
      source.jobRef.set(jobPatch, { merge: true }),
      source.artifactRef ? source.artifactRef.set(artifactPatch, { merge: true }) : Promise.resolve(),
    ]);
    await updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, updatedAt);

    logEvent("meeting.notes.section-edit.apply.success", {
      jobId: source.job.jobId,
      meetingId: source.job.meetingId,
      providerUserKey: owner.providerUserKey,
      sectionKey: input.sectionKey,
    });

    return {
      notes: nextNotes,
      requestId,
      sectionKey: input.sectionKey,
      title: nextTitle,
    };
  }

  async function applyMeetingTermReplacementsToResult(owner, jobInput, termReplacementsInput, updatedAtInput) {
    const job = normalizeMeetingJob(jobInput);
    if (!job.jobId || job.deletedAt) {
      return;
    }
    const updatedAt = normalizeText(updatedAtInput) || new Date().toISOString();
    const termReplacements = normalizeMeetingTermReplacements(termReplacementsInput);
    const { artifact, artifactRef } = await loadMeetingArtifactSource(job);
    const currentNotes = normalizeMeetingNotes(artifact?.notes || job.meetingNotes);
    const nextNotes = applyMeetingTermReplacements(currentNotes, termReplacements);
    const notesChanged = JSON.stringify(currentNotes) !== JSON.stringify(nextNotes);
    const shouldSyncTitle = shouldAutoSyncResultTitleFromNotes(job, currentNotes);
    const nextTitle = shouldSyncTitle
      ? resolveMeetingResultTitle({ notes: nextNotes }, job.title)
      : job.title;
    if (!notesChanged && normalizeText(nextTitle) === normalizeText(job.title)) {
      return;
    }

    const jobPatch = {
      updatedAt,
    };
    const artifactPatch = {};
    if (notesChanged) {
      jobPatch.meetingNotes = nextNotes;
      artifactPatch.notes = nextNotes;
    }
    if (normalizeText(nextTitle) !== normalizeText(job.title)) {
      jobPatch.title = nextTitle;
    }

    const nextJob = normalizeMeetingJob({
      ...job,
      ...jobPatch,
    });
    const nextArtifact = artifact
      ? normalizeMeetingArtifact({
          ...artifact,
          ...artifactPatch,
        })
      : null;

    await Promise.all([
      db.collection(jobCollection).doc(job.jobId).set(jobPatch, { merge: true }),
      artifactRef && Object.keys(artifactPatch).length ? artifactRef.set(artifactPatch, { merge: true }) : Promise.resolve(),
    ]);
    await updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, updatedAt);
  }

  async function loadMeetingNotesSectionEditSource(input, owner) {
    const jobRef = db.collection(jobCollection).doc(input.jobId);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      throw createHttpError(404, "수정할 회의 결과를 찾지 못했어요.");
    }
    const job = normalizeMeetingJob(jobSnapshot.data());
    if (job.deletedAt) {
      throw createHttpError(404, "이미 삭제된 회의 결과예요.");
    }
    assertJobOwnership(job, owner, createHttpError);
    await assertMeetingIsActive(owner, job.meetingId, createHttpError);
    if (job.meetingId !== input.meetingId) {
      throw createHttpError(404, "현재 회의와 맞지 않는 결과예요.");
    }

    const transcriptSource = await loadMeetingTranscriptForNotes(job, createHttpError);
    const currentNotes = normalizeMeetingNotes(transcriptSource.artifact?.notes || job.meetingNotes);
    if (!hasMeetingNotes(currentNotes)) {
      throw createHttpError(409, "수정할 회의 정리가 아직 준비되지 않았어요.");
    }
    const meetingRecord = await loadMeetingSummaryRecord(owner, { meetingId: job.meetingId }, createHttpError);
    const termReplacements = normalizeMeetingTermReplacements(meetingRecord?.meeting?.termReplacements);
    return {
      artifact: transcriptSource.artifact,
      artifactRef: transcriptSource.artifactRef,
      baseRevisionToken: buildMeetingNotesRevisionToken(job, transcriptSource.artifact, currentNotes),
      currentNotes,
      job,
      jobRef,
      termReplacements,
      transcript: transcriptSource.transcript,
    };
  }

  function buildMeetingNotesRevisionToken(jobInput, artifactInput, notesInput) {
    const job = normalizeMeetingJob(jobInput);
    const artifact = artifactInput ? normalizeMeetingArtifact(artifactInput) : null;
    return crypto
      .createHash("sha256")
      .update(JSON.stringify({
        artifactId: normalizeText(artifact?.artifactId),
        jobId: normalizeText(job.jobId),
        notes: normalizeMeetingNotes(notesInput),
        updatedAt: normalizeText(artifact?.notesGeneratedAt || artifact?.createdAt || job.notesGeneratedAt || job.updatedAt),
      }))
      .digest("hex")
      .slice(0, 24);
  }

  function readMeetingNotesSectionData(notesInput, sectionKey) {
    const notes = normalizeMeetingNotes(notesInput);
    switch (sectionKey) {
      case "summary":
        return {
          summary: notes.summary,
        };
      case "overview":
        return {
          meetingMeta: notes.meetingMeta,
          overview: notes.overview,
        };
      case "discussionFlow":
        return {
          discussionFlow: notes.discussionFlow,
        };
      case "decisions":
        return {
          decisions: notes.decisions,
        };
      case "openQuestions":
        return {
          openQuestions: notes.openQuestions,
        };
      case "risksOrDependencies":
        return {
          risksOrDependencies: notes.risksOrDependencies,
        };
      case "actionItems":
        return {
          actionItems: notes.actionItems,
        };
      default:
        return {};
    }
  }

  function normalizeMeetingNotesSectionPayload(sectionKey, input) {
    const payload = input && typeof input === "object" ? input : {};
    switch (sectionKey) {
      case "summary":
        return {
          summary: normalizeMeetingNotes({ summary: payload.summary }).summary,
        };
      case "overview": {
        const normalized = normalizeMeetingNotes({
          meetingMeta: payload.meetingMeta,
          overview: payload.overview,
        });
        return {
          meetingMeta: normalized.meetingMeta,
          overview: normalized.overview,
        };
      }
      case "discussionFlow":
        return {
          discussionFlow: normalizeMeetingNotes({ discussionFlow: payload.discussionFlow }).discussionFlow,
        };
      case "decisions":
        return {
          decisions: normalizeMeetingNotes({ decisions: payload.decisions }).decisions,
        };
      case "openQuestions":
        return {
          openQuestions: normalizeMeetingNotes({ openQuestions: payload.openQuestions }).openQuestions,
        };
      case "risksOrDependencies":
        return {
          risksOrDependencies: normalizeMeetingNotes({ risksOrDependencies: payload.risksOrDependencies }).risksOrDependencies,
        };
      case "actionItems":
        return {
          actionItems: normalizeMeetingNotes({ actionItems: payload.actionItems }).actionItems,
        };
      default:
        return {};
    }
  }

  function applyMeetingNotesSectionPayload(currentNotesInput, sectionKey, sectionPayload) {
    const currentNotes = normalizeMeetingNotes(currentNotesInput);
    const payload = normalizeMeetingNotesSectionPayload(sectionKey, sectionPayload);
    switch (sectionKey) {
      case "summary":
        return normalizeMeetingNotes({
          ...currentNotes,
          summary: payload.summary,
        });
      case "overview":
        return normalizeMeetingNotes({
          ...currentNotes,
          meetingMeta: {
            ...currentNotes.meetingMeta,
            title: normalizeText(payload.meetingMeta?.title) || currentNotes.meetingMeta.title,
            datetime: normalizeText(payload.meetingMeta?.datetime) || currentNotes.meetingMeta.datetime,
            participants: Array.isArray(payload.meetingMeta?.participants) && payload.meetingMeta.participants.length
              ? payload.meetingMeta.participants
              : currentNotes.meetingMeta.participants,
            purpose: normalizeTextBlock(payload.meetingMeta?.purpose),
          },
          overview: payload.overview,
        });
      case "discussionFlow":
        return normalizeMeetingNotes({
          ...currentNotes,
          discussionFlow: payload.discussionFlow,
        });
      case "decisions":
        return normalizeMeetingNotes({
          ...currentNotes,
          decisions: payload.decisions,
        });
      case "openQuestions":
        return normalizeMeetingNotes({
          ...currentNotes,
          openQuestions: payload.openQuestions,
        });
      case "risksOrDependencies":
        return normalizeMeetingNotes({
          ...currentNotes,
          risksOrDependencies: payload.risksOrDependencies,
        });
      case "actionItems":
        return normalizeMeetingNotes({
          ...currentNotes,
          actionItems: payload.actionItems,
        });
      default:
        return currentNotes;
    }
  }

  function buildMeetingNotesSectionEditSystemPrompt(sectionKey, options = {}) {
    const retryReason = normalizeTextBlock(options.retryReason);
    return [
      "너는 한국어 회의록 편집기다.",
      "사용자 요청은 가장 높은 우선순위다.",
      "정상적인 편집 요청은 최대한 그대로 따른다. 길이, 형식, 문체, 강조 범위, 삭제, 축약, 재구성 요청은 완곡하게 해석하지 말고 직접 반영한다.",
      "전사와 현재 섹션은 참고 자료일 뿐이며, 현재 회의록 문구를 유지하려 하지 말고 사용자 요청에 맞게 대상 섹션을 새로 다시 써도 된다.",
      "요청된 섹션 하나만 수정한다. 다른 섹션 문맥을 끌어와 덧붙이거나 설명을 늘리지 않는다.",
      "절대 전체 회의록을 다시 쓰지 않는다.",
      "요청된 섹션 외 다른 섹션 내용, sourceTrace, 원문 근거를 바꾸지 않는다.",
      "전사에 없는 사실, 결정, 액션, 담당자, 일정은 만들지 않는다.",
      "용어 치환 사전이 있으면 그 표현을 우선 사용한다.",
      retryReason ? `직전 시도는 형식이 맞지 않았다. 이번에는 특히 ${retryReason}` : "",
      "반드시 JSON 하나만 반환한다.",
      buildMeetingNotesSectionEditSchemaPrompt(sectionKey),
    ].filter(Boolean).join(" ");
  }

  function buildMeetingNotesSectionEditUserPrompt(input, options = {}) {
    const retryReason = normalizeTextBlock(options.retryReason);
    return [
      `섹션 키: ${input.sectionKey}`,
      "편집 우선순위: 사용자 요청 > 전사 근거 > 현재 대상 섹션",
      input.termReplacements.length
        ? `용어 치환 사전:\n${input.termReplacements.map((item) => `- ${item.from} -> ${item.to}`).join("\n")}`
        : "용어 치환 사전: 없음",
      `사용자 요청:\n${input.instruction}`,
      `전사 발췌:\n${buildMeetingNotesTranscriptPrompt(input.transcript, { strategy: "balanced" })}`,
      `현재 대상 섹션 JSON(교체 대상):\n${JSON.stringify(input.currentSectionData)}`,
      retryReason ? `재시도 사유:\n${retryReason}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function buildMeetingNotesSectionEditSchemaPrompt(sectionKey) {
    switch (sectionKey) {
      case "summary":
        return "summary 섹션은 {summary:\"...\"} 형식으로만 반환한다. 핵심 요약은 짧은 본문만 바꾸고 다른 섹션은 건드리지 않는다.";
      case "overview":
        return "overview 섹션은 {meetingMeta:{title, datetime, participants, purpose}, overview:\"...\"} 형식으로만 반환한다. meetingMeta.title/datetime/participants는 사용자가 바꾸라고 하지 않았다면 현재 값을 유지하고, purpose는 회의 개요 본문이 아니라 보조 메타다. 사용자가 회의 개요를 짧게 요약하거나 길이를 줄여 달라고 하면 purpose는 빈 문자열로 두고 overview에만 최종 문구를 담는다.";
      case "discussionFlow":
        return "discussionFlow 섹션은 {discussionFlow:[{heading, narrative, keyPoints}]} 형식으로만 반환한다.";
      case "decisions":
        return "decisions 섹션은 {decisions:[{text, owner, confidence}]} 형식으로만 반환한다.";
      case "openQuestions":
        return "openQuestions 섹션은 {openQuestions:[\"...\"]} 형식으로만 반환한다.";
      case "risksOrDependencies":
        return "risksOrDependencies 섹션은 {risksOrDependencies:[{text, severity}]} 형식으로만 반환한다.";
      case "actionItems":
        return "actionItems 섹션은 {actionItems:[{task, assignee, dueDate, status, source}]} 형식으로만 반환한다.";
      default:
        return "요청된 섹션 하나만 JSON으로 반환한다.";
    }
  }

  async function generateMeetingNotesSectionEditPayload(input) {
    let retryReason = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let content;
      try {
        const completion = await getClient().chat.completions.create({
          messages: [
            {
              role: "system",
              content: buildMeetingNotesSectionEditSystemPrompt(input.sectionKey, { retryReason }),
            },
            {
              role: "user",
              content: buildMeetingNotesSectionEditUserPrompt(input, { retryReason }),
            },
          ],
          model: getMeetingSummaryModel(),
          response_format: { type: "json_object" },
          temperature: 0.2,
        });
        content = normalizeCompletionContent(completion?.choices?.[0]?.message?.content);
      } catch (error) {
        retryReason = normalizeText(error?.message) || "JSON 응답을 만들지 못했다.";
        continue;
      }
      if (!content) {
        retryReason = "빈 응답이 아니라 요청을 반영한 JSON 하나를 반환해야 한다.";
        continue;
      }
      try {
        const normalizedPayload = normalizeMeetingNotesSectionPayload(input.sectionKey, parseMeetingNotesJson(content));
        return {
          payload: normalizedPayload,
          warning: "",
        };
      } catch (error) {
        retryReason = normalizeText(error?.message) || "스키마에 맞는 JSON을 반환해야 한다.";
      }
    }
    throw createHttpError(502, retryReason || "섹션 미리보기를 만들지 못했어요.");
  }

  function shouldAutoSyncResultTitleFromNotes(jobInput, currentNotesInput) {
    const job = normalizeMeetingJob(jobInput);
    const currentNotes = normalizeMeetingNotes(currentNotesInput);
    const currentSuggestedTitle = normalizeText(currentNotes.meetingMeta?.title);
    const currentTitle = normalizeText(job.title);
    return !currentTitle || !currentSuggestedTitle || currentTitle === currentSuggestedTitle;
  }

  return {
    applyMeetingNotesSectionEdit,
    applyMeetingTermReplacementsAcrossMeeting,
    assertValidMeetingTermReplacementRequest,
    previewMeetingNotesSectionEdit,
  };
}

module.exports = {
  createMeetingNotesEditDomain,
};
