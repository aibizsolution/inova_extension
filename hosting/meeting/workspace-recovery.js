(function initHostedMeetingWorkspaceRecovery(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const {
    normalizeText,
    toTimestamp,
  } = ns.shared;

  const RECOVERABLE_PENDING_STATUSES = new Set(["remote_processing", "remote_queued"]);
  const RECOVERABLE_REMOTE_STATUSES = new Set(["succeeded"]);
  const MAX_RECOVERY_CREATED_AT_DELTA_MS = 5 * 60 * 1000;
  const MAX_RECOVERY_DURATION_DELTA_MS = 5 * 1000;

  function isRecoverablePendingStatus(status) {
    return RECOVERABLE_PENDING_STATUSES.has(normalizeText(status));
  }

  function isRecoverableRemoteStatus(status) {
    return RECOVERABLE_REMOTE_STATUSES.has(normalizeText(status));
  }

  function getPendingReferenceTimestamp(pending) {
    return toTimestamp(
      pending?.createdAt
      || pending?.endedAt
      || pending?.startedAt
      || pending?.updatedAt
    );
  }

  function getRemoteReferenceTimestamp(remote) {
    return toTimestamp(remote?.createdAt || remote?.updatedAt);
  }

  function getRemoteTerminalTimestamp(remote) {
    return toTimestamp(remote?.updatedAt || remote?.createdAt);
  }

  function buildRecoveredRemoteCandidate(state, pending, remote) {
    const pendingStatus = normalizeText(pending?.status);
    const remoteStatus = normalizeText(remote?.status);
    if (!isRecoverablePendingStatus(pendingStatus) || !isRecoverableRemoteStatus(remoteStatus)) {
      return null;
    }

    const pendingMeetingId = normalizeText(pending?.meetingId || state?.meeting?.meetingId);
    const remoteMeetingId = normalizeText(remote?.meetingId || state?.meeting?.meetingId);
    if (pendingMeetingId && remoteMeetingId && pendingMeetingId !== remoteMeetingId) {
      return null;
    }

    const pendingDurationMs = Math.max(0, Number(pending?.durationMs) || 0);
    const remoteDurationMs = Math.max(0, Number(remote?.durationMs) || 0);
    if (!(pendingDurationMs > 0) || !(remoteDurationMs > 0)) {
      return null;
    }
    const durationDeltaMs = Math.abs(pendingDurationMs - remoteDurationMs);
    if (durationDeltaMs > MAX_RECOVERY_DURATION_DELTA_MS) {
      return null;
    }

    const pendingReferenceTimestamp = getPendingReferenceTimestamp(pending);
    const remoteReferenceTimestamp = getRemoteReferenceTimestamp(remote);
    if (!pendingReferenceTimestamp || !remoteReferenceTimestamp) {
      return null;
    }
    const createdAtDeltaMs = Math.abs(pendingReferenceTimestamp - remoteReferenceTimestamp);
    if (createdAtDeltaMs > MAX_RECOVERY_CREATED_AT_DELTA_MS) {
      return null;
    }

    const pendingUpdatedTimestamp = toTimestamp(pending?.updatedAt || pending?.createdAt);
    const remoteTerminalTimestamp = getRemoteTerminalTimestamp(remote);
    if (pendingUpdatedTimestamp && remoteTerminalTimestamp && remoteTerminalTimestamp + 1000 < pendingUpdatedTimestamp) {
      return null;
    }

    return {
      createdAtDeltaMs,
      durationDeltaMs,
      remote,
      strategy: "createdAt-duration-terminal-status",
    };
  }

  function compareRecoveredRemoteCandidates(left, right) {
    return left.createdAtDeltaMs - right.createdAtDeltaMs
      || left.durationDeltaMs - right.durationDeltaMs
      || toTimestamp(right?.remote?.updatedAt || right?.remote?.createdAt) - toTimestamp(left?.remote?.updatedAt || left?.remote?.createdAt);
  }

  function findRecoveredRemoteForPending(state, pending) {
    const pendingJobId = normalizeText(pending?.jobId);
    const pendingRequestId = normalizeText(pending?.requestId);
    const candidates = (Array.isArray(state?.records) ? state.records : [])
      .filter((remote) => {
        const remoteJobId = normalizeText(remote?.jobId);
        const remoteRequestId = normalizeText(remote?.requestId);
        if (pendingJobId && remoteJobId && pendingJobId === remoteJobId) {
          return false;
        }
        if (pendingRequestId && remoteRequestId && pendingRequestId === remoteRequestId) {
          return false;
        }
        return true;
      })
      .map((remote) => buildRecoveredRemoteCandidate(state, pending, remote))
      .filter(Boolean)
      .sort(compareRecoveredRemoteCandidates);

    if (candidates.length !== 1) {
      return null;
    }
    return candidates[0];
  }

  ns.workspaceRecovery = {
    findRecoveredRemoteForPending,
  };
})(globalThis);
