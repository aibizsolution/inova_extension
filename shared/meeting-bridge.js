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

  async function listMeetings(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:list-meetings", {
      input,
      providerIdentity,
    });
  }

  async function issuePanelAuth(providerIdentity) {
    return sendRuntimeMessage("inova-meeting:issue-panel-auth", {
      providerIdentity,
    });
  }

  async function openMeetingWorkspace(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:open-workspace", {
      input,
      providerIdentity,
    });
  }

  async function openMeetingResult(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:open-result", {
      input,
      providerIdentity,
    });
  }

  async function sendRuntimeMessage(type, payload) {
    const metadata = classifyMeetingRuntimeMetadata(type);
    try {
      logDebug("request", {
        backend: metadata.backend,
        operation: metadata.operation,
        payload: payload || {},
        type,
      });
      const response = await global.chrome.runtime.sendMessage({
        type,
        ...(payload || {}),
      });
      if (!response?.ok) {
        throw new Error(namespace.session.normalizeText(response?.error || "") || "회의 기능 요청을 처리하지 못했어요.");
      }
      logDebug("success", {
        backend: metadata.backend,
        operation: metadata.operation,
        opened: Boolean(response?.data?.opened),
        type,
        url: namespace.session.normalizeText(response?.data?.url),
      });
      return response.data;
    } catch (error) {
      if (isInvalidatedContextError(error)) {
        logDebug("invalidated", { type });
        throw new Error("확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.");
      }
      logDebug("error", {
        backend: metadata.backend,
        error: error instanceof Error ? error.message : String(error || ""),
        operation: metadata.operation,
        type,
      });
      throw error;
    }
  }

  function classifyMeetingRuntimeMetadata(type) {
    const normalized = namespace.session.normalizeText(type);
    if (
      normalized === "inova-meeting:issue-panel-auth"
      || normalized === "inova-meeting:list-meetings"
      || normalized === "inova-meeting:list-results"
      || normalized === "inova-meeting:get-job"
      || normalized === "inova-meeting:get-artifact"
    ) {
      return {
        backend: "firebase-function",
        operation: normalized === "inova-meeting:issue-panel-auth" ? "auth" : "read",
      };
    }
    if (normalized === "inova-meeting:create-job") {
      return {
        backend: "firebase-function",
        operation: "write",
      };
    }
    if (
      normalized === "inova-meeting:open-workspace"
      || normalized === "inova-meeting:open-result"
    ) {
      return {
        backend: "hosting",
        operation: "open",
      };
    }
    if (
      normalized === "inova-meeting:start-capture"
      || normalized === "inova-meeting:stop-capture"
      || normalized === "inova-meeting:recorder-failed"
    ) {
      return {
        backend: "extension",
        operation: "",
      };
    }
    return {
      backend: "",
      operation: "",
    };
  }

  function isInvalidatedContextError(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
    return message.includes("Extension context invalidated");
  }

  function logDebug(event, payload) {
    namespace.panelDebug?.log?.(`bridge.${event}`, {
      scope: "runtime",
      tool: "meeting",
      ...(payload || {}),
    });
  }

  namespace.meetingBridge = {
    createMeetingJob,
    getMeetingArtifact,
    getMeetingJob,
    issuePanelAuth,
    listMeetings,
    listMeetingResults,
    openMeetingResult,
    openMeetingWorkspace,
    startMeetingCapture,
    stopMeetingCapture,
  };
})(globalThis);
