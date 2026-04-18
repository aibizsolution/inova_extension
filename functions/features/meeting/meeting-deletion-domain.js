function createMeetingDeletionDomain(deps) {
  const {
    artifactCollection,
    buildMeetingDeletionTaskId,
    buildMeetingDocId,
    buildWorkspaceMutation,
    db,
    deleteDocumentIfExists,
    deleteMeetingJobRuntimeArtifacts,
    deleteMeetingScopedRuntimeArtifacts,
    deletionCollection,
    deletionMaxAttempts,
    deletionProcessingStaleMs,
    deletionRetryDelayMs,
    jobCollection,
    jobFinalizerCollection,
    loadMeetingCommandDocsByJobId,
    loadMeetingCommandDocsByMeetingId,
    loadMeetingJobPartDocs,
    loadMeetingLaunchDocs,
    loadMeetingWorkspaceSessionDocs,
    loadOwnedMeetingJobs,
    loadStoredMeetingJob,
    logEvent,
    meetingCollection,
    normalizeIdentity,
    normalizeMeetingDeletionTask,
    normalizeMeetingJob,
    normalizeMeetingSource,
    normalizeMeetingSummary,
    normalizeText,
    collectMeetingArtifactIds,
  } = deps;
  const maxDeletionAttempts = Math.max(1, Number(deletionMaxAttempts) || 5);

  function shouldProcessMeetingDeletionTask(task, previousTask) {
    const normalizedTask = normalizeMeetingDeletionTask(task);
    const normalizedPreviousTask = normalizeMeetingDeletionTask(previousTask);
    if (!normalizedTask.taskId) {
      return false;
    }
    if (normalizedTask.status === "queued") {
      return normalizedPreviousTask.status !== "queued";
    }
    if (normalizedTask.status === "retry") {
      return isMeetingDeletionRetryDue(normalizedTask)
        && (
          normalizedPreviousTask.status !== "retry"
          || normalizeText(normalizedPreviousTask.nextRetryAt) !== normalizeText(normalizedTask.nextRetryAt)
        );
    }
    return false;
  }

  function isMeetingDeletionRetryDue(taskInput) {
    const task = normalizeMeetingDeletionTask(taskInput);
    if (!task.taskId) {
      return false;
    }
    if (task.status === "queued") {
      return true;
    }
    if (task.status === "retry") {
      const nextRetryAtMs = Date.parse(task.nextRetryAt);
      return !Number.isFinite(nextRetryAtMs) || nextRetryAtMs <= Date.now();
    }
    if (task.status === "processing") {
      const startedAtMs = Date.parse(task.startedAt || task.updatedAt);
      return Number.isFinite(startedAtMs) && (Date.now() - startedAtMs) >= deletionProcessingStaleMs;
    }
    return false;
  }

  function buildQueuedMeetingDeletionTask(taskInput, existingTaskInput) {
    const task = normalizeMeetingDeletionTask(taskInput);
    const existingTask = normalizeMeetingDeletionTask(existingTaskInput);
    const keepProcessing = existingTask.status === "processing" && !isMeetingDeletionRetryDue(existingTask);
    const updatedAt = normalizeText(task.requestedAt) || new Date().toISOString();
    const mergedJobIds = Array.from(new Set([
      ...existingTask.jobIds,
      ...task.jobIds,
      normalizeText(task.jobId),
    ].filter(Boolean)));
    return normalizeMeetingDeletionTask({
      ...existingTask,
      deletedAt: task.deletedAt || existingTask.deletedAt || updatedAt,
      jobId: task.jobId || existingTask.jobId,
      jobIds: mergedJobIds,
      lastError: keepProcessing ? existingTask.lastError : "",
      meetingId: task.meetingId || existingTask.meetingId,
      nextRetryAt: keepProcessing ? existingTask.nextRetryAt : "",
      owner: task.owner?.providerUserKey ? task.owner : existingTask.owner,
      requestedAt: existingTask.requestedAt || updatedAt,
      scope: task.scope || existingTask.scope,
      sessionId: task.sessionId || existingTask.sessionId,
      startedAt: keepProcessing ? existingTask.startedAt : "",
      status: keepProcessing ? "processing" : "queued",
      taskId: task.taskId || existingTask.taskId,
      updatedAt,
    });
  }

  async function enqueueMeetingDeletionTask(input) {
    const baseTask = normalizeMeetingDeletionTask({
      ...input,
      owner: normalizeIdentity(input?.owner),
      requestedAt: new Date().toISOString(),
      status: "queued",
      taskId: buildMeetingDeletionTaskId(input),
    });
    const taskRef = db.collection(deletionCollection).doc(baseTask.taskId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(taskRef);
      const existingTask = snapshot.exists ? normalizeMeetingDeletionTask(snapshot.data()) : null;
      transaction.set(taskRef, buildQueuedMeetingDeletionTask(baseTask, existingTask), { merge: true });
    });
    const snapshot = await taskRef.get();
    return snapshot.exists ? normalizeMeetingDeletionTask(snapshot.data()) : baseTask;
  }

  async function softDeleteMeetingJob(jobInput, deletedAt, options = {}) {
    const job = normalizeMeetingJob(jobInput);
    if (!job.jobId) {
      return null;
    }
    const nextDeletedAt = normalizeText(deletedAt) || new Date().toISOString();
    const totalParts = Math.max(
      0,
      Number(job.progress?.totalParts) || (Array.isArray(job.source?.parts) ? job.source.parts.length : 0)
    );
    const patch = {
      deletedAt: nextDeletedAt,
      error: "",
      progress: {
        currentPart: Math.max(0, Number(job.progress?.currentPart) || 0),
        parallelParts: 0,
        percent: 100,
        phase: "deleted",
        totalParts,
      },
      status: "deleted",
      updatedAt: nextDeletedAt,
    };
    const workspaceMutation = buildWorkspaceMutation(options.workspaceMutation);
    if (workspaceMutation.requestId) {
      patch.workspaceMutation = workspaceMutation;
    }
    await db.collection(jobCollection).doc(job.jobId).set(patch, { merge: true });
    return normalizeMeetingJob({
      ...job,
      ...patch,
    });
  }

  async function processMeetingDeletionTask(taskRef, triggerSource) {
    const claimedTask = await claimMeetingDeletionTask(taskRef);
    if (!claimedTask?.taskId) {
      return false;
    }
    try {
      const deletion = claimedTask.scope === "meeting"
        ? await processQueuedMeetingDeletion(claimedTask)
        : await processQueuedMeetingResultDeletion(claimedTask);
      const completed = await isMeetingDeletionTaskComplete(claimedTask);
      if (completed) {
        await hardDeleteMeetingDeletionTombstones(claimedTask);
        await deleteDocumentIfExists(taskRef);
      } else if (shouldAbandonMeetingDeletionTask(claimedTask)) {
        await markMeetingDeletionTaskAbandoned(taskRef, claimedTask, "cleanup-incomplete");
      } else {
        const nextRetryAt = new Date(Date.now() + deletionRetryDelayMs).toISOString();
        await taskRef.set({
          lastError: "",
          nextRetryAt,
          status: "retry",
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      logEvent("meeting.deletion.process.success", {
        artifactCount: deletion.artifactCount,
        completed,
        jobCount: deletion.jobCount,
        scope: claimedTask.scope,
        storageObjectCount: deletion.storageObjectCount,
        taskId: claimedTask.taskId,
        triggerSource,
      });
      return true;
    } catch (error) {
      const retryAt = new Date(Date.now() + deletionRetryDelayMs).toISOString();
      const updatedAt = new Date().toISOString();
      if (shouldAbandonMeetingDeletionTask(claimedTask)) {
        await markMeetingDeletionTaskAbandoned(taskRef, claimedTask, normalizeText(error?.message) || "cleanup-failed");
        return false;
      }
      await taskRef.set({
        lastError: normalizeText(error?.message),
        nextRetryAt: retryAt,
        status: "retry",
        updatedAt,
      }, { merge: true });
      logEvent("meeting.deletion.process.error", {
        error: normalizeText(error?.message),
        nextRetryAt: retryAt,
        scope: claimedTask.scope,
        taskId: claimedTask.taskId,
        triggerSource,
      });
      return false;
    }
  }

  async function claimMeetingDeletionTask(taskRef) {
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists) {
        return null;
      }
      const currentTask = normalizeMeetingDeletionTask(snapshot.data());
      if (!currentTask.taskId || !isMeetingDeletionRetryDue(currentTask)) {
        return null;
      }
      const updatedAt = new Date().toISOString();
      const nextTask = normalizeMeetingDeletionTask({
        ...currentTask,
        attemptCount: Math.max(0, Number(currentTask.attemptCount) || 0) + 1,
        lastError: "",
        nextRetryAt: "",
        startedAt: updatedAt,
        status: "processing",
        updatedAt,
      });
      transaction.set(taskRef, {
        attemptCount: nextTask.attemptCount,
        lastError: "",
        nextRetryAt: "",
        startedAt: updatedAt,
        status: "processing",
        updatedAt,
      }, { merge: true });
      return nextTask;
    });
  }

  function shouldAbandonMeetingDeletionTask(task) {
    return Math.max(0, Number(task?.attemptCount) || 0) >= maxDeletionAttempts;
  }

  async function markMeetingDeletionTaskAbandoned(taskRef, task, reason) {
    const updatedAt = new Date().toISOString();
    await taskRef.set({
      abandonedAt: updatedAt,
      lastError: normalizeText(reason) || "cleanup-incomplete",
      nextRetryAt: "",
      status: "abandoned",
      updatedAt,
    }, { merge: true });
    logEvent("meeting.deletion.process.abandoned", {
      attemptCount: Math.max(0, Number(task?.attemptCount) || 0),
      maxAttempts: maxDeletionAttempts,
      reason: normalizeText(reason),
      scope: normalizeText(task?.scope),
      taskId: normalizeText(task?.taskId),
    });
  }

  async function processQueuedMeetingDeletion(task) {
    const owner = normalizeIdentity(task.owner);
    const jobs = await loadMeetingDeletionJobs(task);
    const deletions = [];
    for (const job of jobs) {
      deletions.push(await deleteMeetingJobRuntimeArtifacts(job, task.deletedAt));
    }
    const scopedDeletion = await deleteMeetingScopedRuntimeArtifacts(task);
    return {
      artifactCount: Array.from(new Set(deletions.flatMap((item) => item.artifactIds))).length,
      commandCount: Array.from(new Set([
        ...deletions.flatMap((item) => item.commandIds),
        ...scopedDeletion.commandIds,
      ])).length,
      jobCount: jobs.length,
      launchCount: scopedDeletion.launchIds.length,
      storageObjectCount: Array.from(new Set(deletions.flatMap((item) => item.deletedStorageObjects))).length,
      taskId: task.taskId,
      meetingId: task.meetingId,
      owner,
      workspaceSessionCount: scopedDeletion.workspaceSessionIds.length,
    };
  }

  async function processQueuedMeetingResultDeletion(task) {
    const jobRef = db.collection(jobCollection).doc(task.jobId);
    const storedJob = await loadStoredMeetingJob(jobRef);
    const fallbackJob = normalizeMeetingJob({
      deletedAt: task.deletedAt,
      jobId: task.jobId,
      meetingId: task.meetingId,
      owner: task.owner,
      sessionId: task.sessionId,
      status: "deleted",
    });
    const deletion = await deleteMeetingJobRuntimeArtifacts(storedJob || fallbackJob, task.deletedAt);
    return {
      artifactCount: deletion.artifactIds.length,
      commandCount: deletion.commandIds.length,
      jobCount: task.jobId ? 1 : 0,
      storageObjectCount: deletion.deletedStorageObjects.length,
      taskId: task.taskId,
      meetingId: task.meetingId,
    };
  }

  async function loadMeetingDeletionJobs(task) {
    const owner = normalizeIdentity(task.owner);
    const explicitJobIds = Array.from(new Set(
      (Array.isArray(task.jobIds) ? task.jobIds : [])
        .map((jobId) => normalizeText(jobId))
        .filter(Boolean)
    ));
    if (explicitJobIds.length) {
      const jobs = [];
      for (const jobId of explicitJobIds) {
        const snapshot = await db.collection(jobCollection).doc(jobId).get();
        if (snapshot.exists) {
          jobs.push(normalizeMeetingJob(snapshot.data()));
          continue;
        }
        jobs.push(normalizeMeetingJob({
          deletedAt: task.deletedAt,
          jobId,
          meetingId: task.meetingId,
          owner,
          sessionId: task.sessionId,
          status: "deleted",
        }));
      }
      return jobs;
    }
    return loadOwnedMeetingJobs(owner, task.meetingId);
  }

  async function isMeetingDeletionTaskComplete(task) {
    const owner = normalizeIdentity(task.owner);
    if (task.scope === "result") {
      return isMeetingJobDeletionComplete(
        normalizeMeetingJob({
          deletedAt: task.deletedAt,
          jobId: task.jobId,
          meetingId: task.meetingId,
          owner,
          sessionId: task.sessionId,
          status: "deleted",
        })
      );
    }
    const jobs = await loadMeetingDeletionJobs(task);
    for (const job of jobs) {
      const completed = await isMeetingJobDeletionComplete(job);
      if (!completed) {
        return false;
      }
    }
    if (task.meetingId) {
      const commandDocs = await loadMeetingCommandDocsByMeetingId(task.meetingId);
      if (commandDocs.length) {
        return false;
      }
      const launchDocs = await loadMeetingLaunchDocs(task.meetingId);
      if (launchDocs.length) {
        return false;
      }
      const workspaceSessionDocs = await loadMeetingWorkspaceSessionDocs(task.meetingId);
      if (workspaceSessionDocs.length) {
        return false;
      }
      const meetingSnapshot = await db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, task.meetingId)).get();
      if (meetingSnapshot.exists && !normalizeMeetingSummary(meetingSnapshot.data()).deletedAt) {
        return false;
      }
    }
    return true;
  }

  async function hardDeleteMeetingDeletionTombstones(task) {
    const owner = normalizeIdentity(task.owner);
    const jobs = await loadMeetingDeletionJobs(task);
    await Promise.all(
      jobs
        .map((job) => normalizeText(job.jobId))
        .filter(Boolean)
        .map((jobId) => deleteDocumentIfExists(db.collection(jobCollection).doc(jobId)))
    );
    if (task.scope === "meeting" && task.meetingId) {
      await deleteDocumentIfExists(db.collection(meetingCollection).doc(buildMeetingDocId(owner.providerUserKey, task.meetingId)));
    }
  }

  async function isMeetingJobDeletionComplete(jobInput) {
    const job = normalizeMeetingJob(jobInput);
    if (!job.jobId) {
      return true;
    }
    const jobRef = db.collection(jobCollection).doc(job.jobId);
    const storedJob = await loadStoredMeetingJob(jobRef);
    if (storedJob?.jobId && !storedJob.deletedAt) {
      return false;
    }
    if (storedJob?.jobId && !isMeetingSourceFullyDeleted(storedJob.source)) {
      return false;
    }
    const finalizerSnapshot = await db.collection(jobFinalizerCollection).doc(job.jobId).get();
    if (finalizerSnapshot.exists) {
      return false;
    }
    const partDocs = await loadMeetingJobPartDocs(job.jobId);
    if (partDocs.length) {
      return false;
    }
    const commandDocs = await loadMeetingCommandDocsByJobId(job.jobId);
    if (commandDocs.length) {
      return false;
    }
    const artifactIds = Array.from(new Set(collectMeetingArtifactIds(storedJob || job)));
    for (const artifactId of artifactIds) {
      const artifactSnapshot = await db.collection(artifactCollection).doc(artifactId).get();
      if (artifactSnapshot.exists) {
        return false;
      }
    }
    return true;
  }

  function isMeetingSourceFullyDeleted(sourceInput) {
    const source = normalizeMeetingSource(sourceInput);
    if (!source.mode || source.mode === "single") {
      return !normalizeText(source.storageObject) || normalizeText(source.uploadStatus) === "deleted";
    }
    return source.parts.every((part) => (
      !normalizeText(part.storageObject) || normalizeText(part.uploadStatus) === "deleted"
    ));
  }

  return {
    enqueueMeetingDeletionTask,
    isMeetingDeletionRetryDue,
    processMeetingDeletionTask,
    softDeleteMeetingJob,
    shouldProcessMeetingDeletionTask,
  };
}

module.exports = {
  createMeetingDeletionDomain,
};
