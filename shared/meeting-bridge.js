(function initMeetingBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  async function createMeetingJob(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:create-job", {
      input,
      providerIdentity,
    });
  }

  async function startMeetingCapture(input) {
    return sendRuntimeMessage("inova-meeting:start-capture", {
      input,
    });
  }

  async function stopMeetingCapture(input) {
    return sendRuntimeMessage("inova-meeting:stop-capture", {
      input,
    });
  }

  async function getMeetingJob(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:get-job", {
      input,
      providerIdentity,
    });
  }

  async function getMeetingArtifact(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:get-artifact", {
      input,
      providerIdentity,
    });
  }

  async function listMeetingResults(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:list-results", {
      input,
      providerIdentity,
    });
  }

  async function openMeetingWorkspace(input) {
    return sendRuntimeMessage("inova-meeting:open-workspace", {
      input,
    });
  }

  async function openMeetingResult(input) {
    return sendRuntimeMessage("inova-meeting:open-result", {
      input,
    });
  }

  async function sendRuntimeMessage(type, payload) {
    const response = await global.chrome.runtime.sendMessage({
      type,
      ...(payload || {}),
    });
    if (!response?.ok) {
      throw new Error(namespace.session.normalizeText(response?.error || "") || "회의 기능 요청을 처리하지 못했어요.");
    }
    return response.data;
  }

  namespace.meetingBridge = {
    createMeetingJob,
    getMeetingArtifact,
    getMeetingJob,
    listMeetingResults,
    openMeetingResult,
    openMeetingWorkspace,
    startMeetingCapture,
    stopMeetingCapture,
  };
})(globalThis);
