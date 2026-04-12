(function initMeetingBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const OPEN_RUNTIME_PENDING_MS = 1500;

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

  async function createMeetingShareLink(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:create-share-link", {
      input,
      providerIdentity,
    });
  }

  async function revokeMeetingShareLink(input, providerIdentity) {
    return sendRuntimeMessage("inova-meeting:revoke-share-link", {
      input,
      providerIdentity,
    });
  }

  async function sendRuntimeMessage(type, payload) {
    const metadata = classifyMeetingRuntimeMetadata(type);
    const openTrace = beginOpenRuntimeTrace(type);
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
      finishOpenRuntimeTrace(openTrace, "success", {
        message: namespace.session.normalizeText(response?.data?.url) || "runtime-response",
      });
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
        finishOpenRuntimeTrace(openTrace, "error", {
          error: "Extension context invalidated",
        });
        logDebug("invalidated", { type });
        throw new Error("확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.", { cause: error });
      }
      finishOpenRuntimeTrace(openTrace, "error", {
        error: error instanceof Error ? error.message : String(error || ""),
      });
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
    ) {
      return {
        backend: "firebase-function",
        operation: normalized === "inova-meeting:issue-panel-auth" ? "auth" : "read",
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
      normalized === "inova-meeting:create-share-link"
      || normalized === "inova-meeting:revoke-share-link"
    ) {
      return {
        backend: "firebase-function",
        operation: normalized === "inova-meeting:create-share-link" ? "share-create" : "share-revoke",
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

  function beginOpenRuntimeTrace(type) {
    const action = readOpenRuntimeAction(type);
    if (!action) {
      return null;
    }
    const startedAt = Date.now();
    const timeoutId = global.setTimeout(() => {
      traceMeetingFlow("66.top.meeting.runtime.pending", {
        action,
        reason: `${OPEN_RUNTIME_PENDING_MS}ms`,
      });
    }, OPEN_RUNTIME_PENDING_MS);
    return {
      action,
      startedAt,
      timeoutId,
    };
  }

  function finishOpenRuntimeTrace(trace, outcome, payload = {}) {
    if (!trace) {
      return;
    }
    global.clearTimeout(trace.timeoutId);
    traceMeetingFlow(
      outcome === "success" ? "66.top.meeting.runtime.success" : "66.top.meeting.runtime.error",
      {
        action: trace.action,
        reason: `${Math.max(0, Date.now() - trace.startedAt)}ms`,
        ...(payload && typeof payload === "object" ? payload : {}),
      }
    );
  }

  function readOpenRuntimeAction(type) {
    const normalized = namespace.session.normalizeText(type);
    if (normalized === "inova-meeting:open-workspace") {
      return "open-workspace";
    }
    if (normalized === "inova-meeting:open-result") {
      return "open-result";
    }
    return "";
  }

  function traceMeetingFlow(step, payload = {}) {
    if (!namespace.panelDebug?.isEnabled?.()) {
      return false;
    }
    const detail = payload && typeof payload === "object" ? payload : {};
    if (namespace.panelConsoleTrace?.log) {
      return namespace.panelConsoleTrace.log("meeting", step, detail);
    }
    console.info(`[inova:meeting] ${namespace.session.normalizeText(step) || "trace"}`, detail);
    namespace.panelDebug?.log?.(`trace.meeting.${namespace.session.normalizeText(step) || "trace"}`, detail);
    return true;
  }

  function logDebug(event, payload) {
    namespace.panelDebug?.log?.(`bridge.${event}`, {
      scope: "runtime",
      tool: "meeting",
      ...(payload || {}),
    });
  }

  namespace.meetingBridge = {
    createMeetingShareLink,
    issuePanelAuth,
    listMeetings,
    openMeetingResult,
    openMeetingWorkspace,
    revokeMeetingShareLink,
  };
})(globalThis);
