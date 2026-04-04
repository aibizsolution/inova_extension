(function initMeetingWorkspaceBridge(global) {
  const PAGE_SOURCE = "inova-meeting-workspace-page";
  const EXTENSION_SOURCE = "inova-meeting-workspace-extension";
  const PROBE_REQUEST_TYPE = "probe-extension-bridge";
  const PROBE_RESPONSE_TYPE = "probe-extension-bridge-result";

  global.addEventListener("message", handlePageMessage);

  async function handlePageMessage(event) {
    if (event.source !== global) {
      return;
    }
    const data = event?.data && typeof event.data === "object" ? event.data : {};
    if (String(data.source || "") !== PAGE_SOURCE || String(data.type || "") !== PROBE_REQUEST_TYPE) {
      return;
    }

    const requestId = String(data.requestId || "");
    const response = {
      extensionId: global.chrome?.runtime?.id || "",
      requestId,
    };

    try {
      const response = await global.chrome.runtime.sendMessage({
        type: "inova-meeting:probe-workspace-bridge",
      });
      if (!response?.ok) {
        throw new Error(String(response?.error || "확장 bridge probe 응답이 올바르지 않아요."));
      }
      postResponse({
        ...response,
        ok: true,
        probe: response.data || {},
      });
    } catch (error) {
      postResponse({
        ...response,
        error: error instanceof Error ? error.message : String(error || "확장 브리지를 확인하지 못했어요."),
        ok: false,
      });
    }
  }

  function postResponse(payload) {
    global.postMessage(
      {
        payload,
        source: EXTENSION_SOURCE,
        type: PROBE_RESPONSE_TYPE,
      },
      global.location.origin
    );
  }
})(globalThis);
