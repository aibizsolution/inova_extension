function createMeetingMutationDomain(deps) {
  const {
    editableMeetingSectionKeys,
    hasOwn,
    limits,
    normalizeMeetingTermReplacements,
    normalizeText,
    normalizeTextBlock,
    supportedMeetingCommandStatuses,
    supportedMeetingCommandTypes,
    supportedDeletionScopes,
    supportedDeletionStatuses,
    supportedWorkspaceMutationStatuses,
    supportedWorkspaceMutationTypes,
  } = deps;
  const {
    MAX_MEETING_LIST_LIMIT,
    MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS,
    MAX_SHARED_MEMO_CHARS,
  } = limits;

  function normalizeMeetingHubListRequest(input) {
    return {
      cursor: normalizeText(input?.cursor),
      limit: Math.max(1, Math.min(MAX_MEETING_LIST_LIMIT, Number(input?.limit) || 12)),
    };
  }

  function normalizeMeetingMutationRequest(input) {
    return {
      clientRequestId: normalizeText(input?.clientRequestId),
      hasSharedMemo: hasOwn(input, "sharedMemo"),
      hasTermReplacements: hasOwn(input, "termReplacements"),
      hasTitle: hasOwn(input, "title"),
      meetingId: normalizeText(input?.meetingId),
      sharedMemo: normalizeTextBlock(input?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
      termReplacements: normalizeMeetingTermReplacements(input?.termReplacements),
      title: normalizeText(input?.title),
    };
  }

  function normalizeMeetingResultMutationRequest(input) {
    return {
      clientRequestId: normalizeText(input?.clientRequestId),
      jobId: normalizeText(input?.jobId),
      meetingId: normalizeText(input?.meetingId),
      sharedMemo: normalizeTextBlock(input?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
      sharedMemoProvided: hasOwn(input, "sharedMemo"),
      title: normalizeText(input?.title),
      titleProvided: hasOwn(input, "title"),
    };
  }

  function normalizeMeetingResultMoveRequest(input) {
    const request = input && typeof input === "object" ? input : {};
    return {
      clientRequestId: normalizeText(request.clientRequestId),
      jobId: normalizeText(request.jobId),
      meetingId: normalizeText(request.meetingId),
      targetMeetingId: normalizeText(request.targetMeetingId),
    };
  }

  function normalizeMeetingSectionEditPreviewRequest(input) {
    const request = input && typeof input === "object" ? input : {};
    return {
      clientRequestId: normalizeText(request.clientRequestId),
      instruction: normalizeTextBlock(request.instruction).slice(0, MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS),
      jobId: normalizeText(request.jobId),
      meetingId: normalizeText(request.meetingId),
      sectionKey: normalizeMeetingSectionKey(request.sectionKey),
    };
  }

  function normalizeMeetingSectionEditApplyRequest(input) {
    const request = input && typeof input === "object" ? input : {};
    return {
      baseRevisionToken: normalizeText(request.baseRevisionToken),
      clientRequestId: normalizeText(request.clientRequestId),
      editMode: normalizeText(request.editMode) === "manual" ? "manual" : "ai",
      jobId: normalizeText(request.jobId),
      meetingId: normalizeText(request.meetingId),
      sectionData: request.sectionData && typeof request.sectionData === "object"
        ? JSON.parse(JSON.stringify(request.sectionData))
        : {},
      sectionKey: normalizeMeetingSectionKey(request.sectionKey),
    };
  }

  function normalizeMeetingSectionKey(value) {
    const normalized = normalizeText(value);
    return editableMeetingSectionKeys.has(normalized) ? normalized : "";
  }

  function normalizeWorkspaceMutation(input) {
    const mutation = input && typeof input === "object" ? input : {};
    const status = normalizeText(mutation.status);
    const type = normalizeText(mutation.type);
    return {
      completedAt: normalizeText(mutation.completedAt),
      error: normalizeText(mutation.error),
      requestedAt: normalizeText(mutation.requestedAt),
      requestId: normalizeText(mutation.requestId),
      status: supportedWorkspaceMutationStatuses.has(status) ? status : "",
      type: supportedWorkspaceMutationTypes.has(type) ? type : "",
    };
  }

  function buildWorkspaceMutation(input) {
    const requestId = normalizeText(input?.requestId);
    if (!requestId) {
      return {};
    }
    return normalizeWorkspaceMutation({
      completedAt: input?.completedAt,
      error: input?.error,
      requestedAt: input?.requestedAt || new Date().toISOString(),
      requestId,
      status: input?.status,
      type: input?.type,
    });
  }

  function normalizeMeetingCommand(input) {
    const command = input && typeof input === "object" ? input : {};
    const status = normalizeText(command.status);
    const type = normalizeText(command.type).toLowerCase();
    return {
      clientRequestId: normalizeText(command.clientRequestId),
      completedAt: normalizeText(command.completedAt),
      error: normalizeText(command.error),
      jobId: normalizeText(command.jobId),
      meetingId: normalizeText(command.meetingId),
      owner: command.owner && typeof command.owner === "object" ? { ...command.owner } : {},
      requestedAt: normalizeText(command.requestedAt),
      startedAt: normalizeText(command.startedAt),
      status: supportedMeetingCommandStatuses.has(status) ? status : "",
      type: supportedMeetingCommandTypes.has(type) ? type : "",
      updatedAt: normalizeText(command.updatedAt),
    };
  }

  function buildMeetingDeletionTaskId(input) {
    const scope = normalizeText(input?.scope).toLowerCase();
    if (scope === "result") {
      return `meeting-result-delete__${normalizeText(input?.jobId)}`;
    }
    return `meeting-delete__${normalizeText(input?.owner?.providerUserKey)}__${normalizeText(input?.meetingId)}`;
  }

  function normalizeMeetingDeletionTask(input) {
    const task = input && typeof input === "object" ? input : {};
    const scope = normalizeText(task.scope).toLowerCase();
    const status = normalizeText(task.status).toLowerCase();
    return {
      attemptCount: Math.max(0, Number(task.attemptCount) || 0),
      abandonedAt: normalizeText(task.abandonedAt),
      deletedAt: normalizeText(task.deletedAt),
      jobId: normalizeText(task.jobId),
      jobIds: Array.from(new Set(
        (Array.isArray(task.jobIds) ? task.jobIds : [])
          .map((jobId) => normalizeText(jobId))
          .filter(Boolean)
      )),
      lastError: normalizeText(task.lastError),
      meetingId: normalizeText(task.meetingId),
      nextRetryAt: normalizeText(task.nextRetryAt),
      owner: normalizeMeetingTaskOwner(task.owner),
      requestedAt: normalizeText(task.requestedAt),
      scope: supportedDeletionScopes.has(scope) ? scope : "",
      sessionId: normalizeText(task.sessionId),
      startedAt: normalizeText(task.startedAt),
      status: supportedDeletionStatuses.has(status) ? status : "",
      taskId: normalizeText(task.taskId),
      updatedAt: normalizeText(task.updatedAt),
    };
  }

  function normalizeMeetingTaskOwner(input) {
    return {
      displayName: normalizeText(input?.displayName),
      email: normalizeText(input?.email).toLowerCase(),
      numericUserId: Number.isFinite(Number(input?.numericUserId)) ? Number(input.numericUserId) : null,
      provider: normalizeText(input?.provider) || "inova",
      providerUserKey: normalizeText(input?.providerUserKey),
    };
  }

  return {
    buildMeetingDeletionTaskId,
    buildWorkspaceMutation,
    normalizeMeetingCommand,
    normalizeMeetingDeletionTask,
    normalizeMeetingHubListRequest,
    normalizeMeetingMutationRequest,
    normalizeMeetingResultMutationRequest,
    normalizeMeetingResultMoveRequest,
    normalizeMeetingSectionEditApplyRequest,
    normalizeMeetingSectionEditPreviewRequest,
    normalizeMeetingTaskOwner,
    normalizeWorkspaceMutation,
  };
}

module.exports = {
  createMeetingMutationDomain,
};
