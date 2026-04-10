function createMeetingRuntimeArtifactDomain(deps) {
  const {
    artifactCollection,
    bucket,
    commandCollection,
    createHttpError,
    db,
    jobCollection,
    jobFinalizerCollection,
    jobPartCollection,
    launchCollection,
    logEvent,
    normalizeMeetingCommand,
    normalizeMeetingJob,
    normalizeMeetingJobPart,
    normalizeMeetingSource,
    normalizeText,
    normalizeTranscriptSegment,
    workspaceSessionCollection,
    collectMeetingArtifactIds,
  } = deps;

  async function loadSourceAudioBuffer(source) {
    if (source.inlineAudioBase64) {
      try {
        return Buffer.from(source.inlineAudioBase64, "base64");
      } catch {
        throw createHttpError(400, "회의 원본 오디오를 읽지 못했어요.");
      }
    }
    if (source.storageObject) {
      const [buffer] = await bucket.file(source.storageObject).download();
      return buffer;
    }
    throw createHttpError(400, "회의 원본 오디오가 없어요.");
  }

  async function uploadTemporarySource(targetBucket, storageObject, audioBuffer, source, owner, meeting, jobId) {
    if (!targetBucket) {
      throw createHttpError(500, "회의 임시 오디오를 저장할 bucket이 설정되지 않았어요.");
    }
    if (!storageObject) {
      throw createHttpError(500, "회의 임시 오디오 저장 경로를 준비하지 못했어요.");
    }
    try {
      await targetBucket.file(storageObject).save(audioBuffer, {
        contentType: source.mimeType || "application/octet-stream",
        metadata: {
          metadata: {
            captureMode: source.captureMode,
            jobId,
            meetingId: meeting.meetingId,
            providerUserKey: owner.providerUserKey,
          },
        },
        resumable: false,
      });
      return {
        storageObject,
        uploadStatus: "uploaded",
      };
    } catch (error) {
      logEvent("meeting.source-upload.skipped", {
        error: normalizeText(error?.message),
        jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      throw createHttpError(500, "회의 임시 오디오 업로드를 저장하지 못했어요.");
    }
  }

  async function deleteTemporarySourceGroup(targetBucket, storageObjects) {
    const deletedStorageObjects = [];
    const failedStorageObjects = [];
    for (const storageObject of Array.from(new Set((storageObjects || []).map((value) => normalizeText(value)).filter(Boolean)))) {
      const deletion = await deleteTemporarySource(targetBucket, storageObject);
      if (deletion.deletedAt) {
        deletedStorageObjects.push(storageObject);
        continue;
      }
      if (deletion.error) {
        failedStorageObjects.push(storageObject);
      }
    }
    return {
      deletedAt: deletedStorageObjects.length ? new Date().toISOString() : "",
      deletedStorageObjects,
      failedStorageObjects,
      warningMessage: failedStorageObjects.length ? `임시 오디오 정리 ${failedStorageObjects.length}건이 남았어요.` : "",
    };
  }

  function logMeetingCleanupWarning(eventName, deletion, context = {}) {
    const failedStorageObjects = Array.isArray(deletion?.failedStorageObjects) ? deletion.failedStorageObjects : [];
    if (!failedStorageObjects.length) {
      return;
    }
    logEvent(eventName, {
      ...context,
      failedStorageObjectCount: failedStorageObjects.length,
      failedStorageObjects: failedStorageObjects.slice(0, 5),
      warning: normalizeText(deletion?.warningMessage),
    });
  }

  function collectMeetingSourceStorageObjects(source) {
    return Array.from(new Set([
      normalizeText(source?.storageObject),
      ...(Array.isArray(source?.parts) ? source.parts.map((part) => normalizeText(part?.storageObject)) : []),
    ].filter(Boolean)));
  }

  function markMeetingSourceDeleted(source, deletedStorageObjects) {
    const deletedSet = new Set((deletedStorageObjects || []).map((value) => normalizeText(value)).filter(Boolean));
    const nextSource = normalizeMeetingSource(source);
    const hasDeletedSingle = nextSource.storageObject && deletedSet.has(nextSource.storageObject);
    return {
      ...nextSource,
      parts: nextSource.parts.map((part) => ({
        ...part,
        uploadStatus: deletedSet.has(part.storageObject) ? "deleted" : "uploaded",
      })),
      storageObject: nextSource.storageObject,
      uploadStatus: hasDeletedSingle || nextSource.parts.some((part) => deletedSet.has(part.storageObject)) ? "deleted" : nextSource.uploadStatus,
    };
  }

  async function deleteDocumentIfExists(ref) {
    if (!ref) {
      return false;
    }
    const snapshot = typeof ref.get === "function" ? await ref.get() : null;
    if (snapshot && !snapshot.exists) {
      return false;
    }
    if (typeof ref.delete === "function") {
      await ref.delete();
      return true;
    }
    return false;
  }

  async function loadMeetingCommandDocsByJobId(jobId) {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) {
      return [];
    }
    const snapshot = await db.collection(commandCollection).where("jobId", "==", normalizedJobId).get();
    return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
      .map((doc) => ({ command: normalizeMeetingCommand(doc.data()), docId: doc.id, ref: doc.ref }))
      .filter((entry) => normalizeText(entry.command.jobId) === normalizedJobId);
  }

  async function loadMeetingCommandDocsByMeetingId(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    const snapshot = await db.collection(commandCollection).where("meetingId", "==", normalizedMeetingId).get();
    return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
      .map((doc) => ({ command: normalizeMeetingCommand(doc.data()), docId: doc.id, ref: doc.ref }))
      .filter((entry) => normalizeText(entry.command.meetingId) === normalizedMeetingId);
  }

  async function loadMeetingWorkspaceSessionDocs(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    const snapshot = await db.collection(workspaceSessionCollection).where("meeting.meetingId", "==", normalizedMeetingId).get();
    return Array.isArray(snapshot?.docs) ? snapshot.docs.map((doc) => ({ docId: doc.id, ref: doc.ref })) : [];
  }

  async function loadMeetingLaunchDocs(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    const snapshot = await db.collection(launchCollection).where("meeting.meetingId", "==", normalizedMeetingId).get();
    return Array.isArray(snapshot?.docs) ? snapshot.docs.map((doc) => ({ docId: doc.id, ref: doc.ref })) : [];
  }

  async function loadStoredMeetingJob(jobRef) {
    if (!jobRef || typeof jobRef.get !== "function") {
      return null;
    }
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
      return null;
    }
    return normalizeMeetingJob(snapshot.data());
  }

  async function loadMeetingJobPartDocs(jobId) {
    const snapshot = await db.collection(jobPartCollection).where("jobId", "==", normalizeText(jobId)).get();
    return snapshot.docs
      .map((doc) => ({ ...normalizeMeetingJobPart(doc.data()), docId: doc.id }))
      .sort((left, right) => left.index - right.index || left.part.startMs - right.part.startMs);
  }

  function collectMeetingChunkTranscriptStorageObjects(partDocs) {
    return Array.from(new Set(
      (Array.isArray(partDocs) ? partDocs : [])
        .map((part) => normalizeText(part?.transcript?.storageObject))
        .filter(Boolean)
    ));
  }

  async function saveMeetingChunkTranscript(targetBucket, storageObject, transcript, owner, meeting, jobId, partIndex) {
    if (!targetBucket || !storageObject) {
      throw createHttpError(500, "청크 전사 결과를 저장할 bucket이 설정되지 않았어요.");
    }
    const payload = Buffer.from(JSON.stringify({
      segments: Array.isArray(transcript?.segments) ? transcript.segments : [],
      text: normalizeText(transcript?.text),
    }), "utf8");
    await targetBucket.file(storageObject).save(payload, {
      contentType: "application/json; charset=utf-8",
      metadata: {
        metadata: {
          jobId,
          meetingId: meeting.meetingId,
          partIndex: String(Math.max(0, Number(partIndex) || 0)),
          providerUserKey: owner.providerUserKey,
        },
      },
      resumable: false,
    });
    return {
      segmentCount: Array.isArray(transcript?.segments) ? transcript.segments.length : 0,
      storageObject,
      textLength: normalizeText(transcript?.text).length,
    };
  }

  async function loadMeetingChunkTranscript(targetBucket, storageObject) {
    if (!targetBucket || !storageObject) {
      throw createHttpError(400, "청크 전사 결과 storageObject가 없어요.");
    }
    const [buffer] = await targetBucket.file(storageObject).download();
    const parsed = JSON.parse(Buffer.from(buffer).toString("utf8"));
    const segments = Array.isArray(parsed?.segments) ? parsed.segments.map(normalizeTranscriptSegment) : [];
    const text = normalizeText(parsed?.text);
    return {
      segments,
      text,
    };
  }

  async function deleteMeetingJobRuntimeArtifacts(jobInput, deletedAt) {
    const job = normalizeMeetingJob(jobInput);
    const jobRef = db.collection(jobCollection).doc(job.jobId);
    const artifactIds = Array.from(new Set(collectMeetingArtifactIds(job)));
    const commandDocs = await loadMeetingCommandDocsByJobId(job.jobId);
    const partDocs = await loadMeetingJobPartDocs(job.jobId);
    const storageObjects = Array.from(new Set([
      ...collectMeetingSourceStorageObjects(job.source),
      ...collectMeetingChunkTranscriptStorageObjects(partDocs),
    ]));
    const deletion = await deleteTemporarySourceGroup(bucket, storageObjects);
    logMeetingCleanupWarning("meeting.delete.cleanup.warning", deletion, {
      jobId: job.jobId,
      meetingId: job.meetingId,
      providerUserKey: job.owner?.providerUserKey,
    });
    await Promise.all([
      ...artifactIds.map((artifactId) => deleteDocumentIfExists(db.collection(artifactCollection).doc(artifactId))),
      ...commandDocs.map((commandDoc) => deleteDocumentIfExists(commandDoc.ref)),
      deleteDocumentIfExists(db.collection(jobFinalizerCollection).doc(job.jobId)),
      ...partDocs.map((partDoc) => deleteDocumentIfExists(db.collection(jobPartCollection).doc(partDoc.docId))),
    ]);
    await jobRef.set({
      cleanup: {
        deletedAt: deletion.deletedAt,
        sourceAudioDeleted: Boolean(deletion.deletedStorageObjects.length),
      },
      deletedAt,
      error: "",
      progress: {
        currentPart: Math.max(0, Number(job.progress?.currentPart) || 0),
        parallelParts: 0,
        percent: 100,
        phase: "deleted",
        totalParts: Math.max(0, Number(job.progress?.totalParts) || (Array.isArray(job.source?.parts) ? job.source.parts.length : 0)),
      },
      source: markMeetingSourceDeleted(job.source, deletion.deletedStorageObjects),
      status: "deleted",
      updatedAt: deletedAt,
    }, { merge: true });
    return {
      artifactIds,
      commandIds: commandDocs.map((commandDoc) => commandDoc.docId),
      deletedStorageObjects: deletion.deletedStorageObjects,
      partCount: partDocs.length,
    };
  }

  async function deleteMeetingScopedRuntimeArtifacts(task) {
    if (task.scope !== "meeting" || !normalizeText(task.meetingId)) {
      return {
        commandIds: [],
        launchIds: [],
        workspaceSessionIds: [],
      };
    }
    const [commandDocs, launchDocs, workspaceSessionDocs] = await Promise.all([
      loadMeetingCommandDocsByMeetingId(task.meetingId),
      loadMeetingLaunchDocs(task.meetingId),
      loadMeetingWorkspaceSessionDocs(task.meetingId),
    ]);
    await Promise.all([
      ...commandDocs.map((commandDoc) => deleteDocumentIfExists(commandDoc.ref)),
      ...launchDocs.map((launchDoc) => deleteDocumentIfExists(launchDoc.ref)),
      ...workspaceSessionDocs.map((sessionDoc) => deleteDocumentIfExists(sessionDoc.ref)),
    ]);
    return {
      commandIds: commandDocs.map((commandDoc) => commandDoc.docId),
      launchIds: launchDocs.map((launchDoc) => launchDoc.docId),
      workspaceSessionIds: workspaceSessionDocs.map((sessionDoc) => sessionDoc.docId),
    };
  }

  return {
    collectMeetingChunkTranscriptStorageObjects,
    collectMeetingSourceStorageObjects,
    deleteDocumentIfExists,
    deleteMeetingJobRuntimeArtifacts,
    deleteMeetingScopedRuntimeArtifacts,
    deleteTemporarySourceGroup,
    loadMeetingChunkTranscript,
    loadMeetingCommandDocsByJobId,
    loadMeetingCommandDocsByMeetingId,
    loadMeetingJobPartDocs,
    loadMeetingLaunchDocs,
    loadMeetingWorkspaceSessionDocs,
    loadSourceAudioBuffer,
    loadStoredMeetingJob,
    logMeetingCleanupWarning,
    markMeetingSourceDeleted,
    saveMeetingChunkTranscript,
    uploadTemporarySource,
  };

  async function deleteTemporarySource(targetBucket, storageObject) {
    const normalizedStorageObject = normalizeText(storageObject);
    if (!normalizedStorageObject) {
      return {
        deletedAt: "",
        error: "",
        storageObject: "",
      };
    }
    if (!targetBucket) {
      return {
        deletedAt: "",
        error: "storage-bucket-missing",
        storageObject: normalizedStorageObject,
      };
    }
    try {
      await targetBucket.file(normalizedStorageObject).delete({ ignoreNotFound: true });
      return {
        deletedAt: new Date().toISOString(),
        error: "",
        storageObject: normalizedStorageObject,
      };
    } catch (error) {
      return {
        deletedAt: "",
        error: normalizeText(error?.message) || "storage-delete-failed",
        storageObject: normalizedStorageObject,
      };
    }
  }
}

module.exports = {
  createMeetingRuntimeArtifactDomain,
};
