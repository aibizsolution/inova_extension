(function initMeetingWorkspaceBridge(global) {
  const PAGE_SOURCE = "inova-meeting-workspace-page";
  const EXTENSION_SOURCE = "inova-meeting-workspace-extension";
  const PROBE_REQUEST_TYPE = "probe-extension-bridge";
  const PROBE_RESPONSE_TYPE = "probe-extension-bridge-result";
  const AUTHORIZE_REQUEST_TYPE = "authorize-workspace-access";
  const AUTHORIZE_RESPONSE_TYPE = "authorize-workspace-access-result";

  global.addEventListener("message", handlePageMessage);

  async function handlePageMessage(event) {
    if (event.origin !== global.location.origin) {
      return;
    }
    const data = event?.data && typeof event.data === "object" ? event.data : {};
    if (String(data.source || "") !== PAGE_SOURCE) {
      return;
    }
    const requestType = String(data.type || "");
    if (![PROBE_REQUEST_TYPE, AUTHORIZE_REQUEST_TYPE].includes(requestType)) {
      return;
    }

    const requestId = String(data.requestId || "");
    const baseResponse = {
      extensionId: global.chrome?.runtime?.id || "",
      requestId,
    };

    try {
      const runtimeResponse = await global.chrome.runtime.sendMessage(buildRuntimeRequest(requestType, data.payload));
      if (!runtimeResponse?.ok) {
        throw new Error(String(runtimeResponse?.error || "확장 bridge probe 응답이 올바르지 않아요."));
      }
      postResponse({
        ...baseResponse,
        ...runtimeResponse,
        ok: true,
        data: runtimeResponse.data || {},
      }, requestType);
    } catch (error) {
      postResponse({
        ...baseResponse,
        error: error instanceof Error ? error.message : String(error || "확장 브리지를 확인하지 못했어요."),
        ok: false,
      }, requestType);
    }
  }

  function buildRuntimeRequest(requestType, payload) {
    const nextPayload = payload && typeof payload === "object" ? payload : {};
    if (requestType === AUTHORIZE_REQUEST_TYPE) {
      return {
        input: nextPayload,
        type: "inova-meeting:authorize-workspace-access",
      };
    }
    return {
      type: "inova-meeting:probe-workspace-bridge",
    };
  }

  function resolveResponseType(requestType) {
    if (requestType === AUTHORIZE_REQUEST_TYPE) {
      return AUTHORIZE_RESPONSE_TYPE;
    }
    return PROBE_RESPONSE_TYPE;
  }

  function postResponse(payload, requestType) {
    global.postMessage(
      {
        payload,
        source: EXTENSION_SOURCE,
        type: resolveResponseType(requestType),
      },
      global.location.origin
    );
  }
})(globalThis);
