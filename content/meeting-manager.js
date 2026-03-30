(function initMeetingManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const ACTIVE_POLL_DELAY_MS = 1800;

  function create(state, hooks) {
    let inflight = false;
    let timerId = 0;

    return {
      handleRouteStateChange,
      handleStorageChange,
      refreshState,
      scheduleSync,
    };

    function handleRouteStateChange() {
      syncCurrentSessionMeetingState().catch(logRefreshError);
    }

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local" || (!changes.meetingStateBySession && !changes.meetingState)) {
        return;
      }

      state.meetingState = readMeetingStateFromChanges(changes);
      if (isCurrentSessionMeeting() && namespace.meetingState.shouldPollMeetingJob(state.meetingState)) {
        scheduleSync(420);
      }
      hooks.render?.();
    }

    function scheduleSync(delay = ACTIVE_POLL_DELAY_MS) {
      global.clearTimeout(timerId);
      timerId = global.setTimeout(() => {
        refreshState().catch(logRefreshError);
      }, delay);
    }

    async function refreshState() {
      state.meetingState = await namespace.storage.getMeetingState(state.sessionId);
      if (!isCurrentSessionMeeting()) {
        hooks.render?.();
        return state.meetingState;
      }

      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity.available || inflight) {
        return state.meetingState;
      }

      inflight = true;
      try {
        let nextMeetingState = namespace.meetingState.mergeMeetingState(state.meetingState);

        if (namespace.meetingState.shouldPollMeetingJob(nextMeetingState)) {
          const jobPayload = await namespace.meetingBridge.getMeetingJob(
            namespace.meetingState.buildMeetingJobLookup(nextMeetingState),
            providerIdentity
          );
          nextMeetingState = namespace.meetingState.applyMeetingJobSnapshot(nextMeetingState, jobPayload);
          nextMeetingState = await namespace.storage.setMeetingState(state.sessionId, nextMeetingState);
        }

        if (shouldLoadArtifact(nextMeetingState)) {
          const artifactPayload = await namespace.meetingBridge.getMeetingArtifact(
            namespace.meetingState.buildMeetingArtifactLookup(nextMeetingState),
            providerIdentity
          );
          nextMeetingState = namespace.meetingState.applyMeetingArtifact(nextMeetingState, artifactPayload);
          nextMeetingState = await namespace.storage.setMeetingState(state.sessionId, nextMeetingState);
        }

        state.meetingState = nextMeetingState;
        if (isCurrentSessionMeeting() && namespace.meetingState.shouldPollMeetingJob(nextMeetingState)) {
          scheduleSync();
        }
        hooks.render?.();
        return nextMeetingState;
      } finally {
        inflight = false;
      }
    }

    function isCurrentSessionMeeting() {
      const currentSessionId = namespace.session.normalizeText(state.sessionId);
      const meetingSessionId = namespace.session.normalizeText(state.meetingState?.session?.sessionId);
      return Boolean(currentSessionId && meetingSessionId && currentSessionId === meetingSessionId);
    }

    async function syncCurrentSessionMeetingState() {
      state.meetingState = await namespace.storage.getMeetingState(state.sessionId);
      if (!isCurrentSessionMeeting()) {
        global.clearTimeout(timerId);
        hooks.render?.();
        return;
      }
      scheduleSync(220);
    }

    function readMeetingStateFromChanges(changes) {
      const currentSessionId = namespace.session.normalizeText(state.sessionId);
      if (currentSessionId && changes.meetingStateBySession?.newValue) {
        return namespace.meetingState.mergeMeetingState(changes.meetingStateBySession.newValue[currentSessionId]);
      }
      if (changes.meetingState?.newValue) {
        return namespace.meetingState.mergeMeetingState(changes.meetingState.newValue);
      }
      return namespace.meetingState.mergeMeetingState();
    }

    function shouldLoadArtifact(meetingState) {
      const normalized = namespace.meetingState.mergeMeetingState(meetingState);
      if (normalized.job.status !== "succeeded") {
        return false;
      }

      const artifactId = namespace.session.normalizeText(
        normalized.transcript.artifactId || normalized.job.artifactId
      );
      if (!artifactId) {
        return false;
      }

      const hasTranscriptText = Boolean(namespace.session.normalizeText(normalized.transcript.text));
      const hasSegments = Array.isArray(normalized.transcript.segments) && normalized.transcript.segments.length > 0;
      return !(hasTranscriptText || hasSegments);
    }

    function logRefreshError(error) {
      console.error("[i-Nova Bookmarks] meeting refresh failed", error);
      hooks.render?.();
    }
  }

  namespace.meetingManager = {
    create,
  };
})(globalThis);
