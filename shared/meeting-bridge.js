(function initMeetingBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  async function createMeetingJob(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:create-job", {
      input,
      providerIdentity,
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
  };
})(globalThis);
