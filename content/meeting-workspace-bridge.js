(function initMeetingWorkspaceBridge(global) {
  const PAGE_SOURCE = "inova-meeting-workspace-page";
  const EXTENSION_SOURCE = "inova-meeting-workspace-extension";
  const PROBE_REQUEST_TYPE = "probe-extension-bridge";
  const PROBE_RESPONSE_TYPE = "probe-extension-bridge-result";
  const DEBUG_ENABLED = new URLSearchParams(global.location.search).get("debug") === "1";

  if (DEBUG_ENABLED) {
    global.console?.info?.("[Inova Meeting Workspace Bridge] workspace.extension-bridge.loaded", {
      href: global.location.href,
      requestType: PROBE_REQUEST_TYPE,
    });
  }

  global.addEventListener("message", handlePageMessage);

  async function handlePageMessage(event) {
    if (event.origin !== global.location.origin) {
      return;
    }
    const data = event?.data && typeof event.data === "object" ? event.data : {};
    if (String(data.source || "") !== PAGE_SOURCE || String(data.type || "") !== PROBE_REQUEST_TYPE) {
      return;
    }

    const requestId = String(data.requestId || "");
    if (DEBUG_ENABLED) {
      global.console?.info?.("[Inova Meeting Workspace Bridge] workspace.extension-bridge.request", {
        href: global.location.href,
        requestId,
      });
    }
    const baseResponse = {
      extensionId: global.chrome?.runtime?.id || "",
      requestId,
    };

    try {
      const runtimeResponse = await global.chrome.runtime.sendMessage({
        type: "inova-meeting:probe-workspace-bridge",
      });
      if (!runtimeResponse?.ok) {
        throw new Error(String(runtimeResponse?.error || "확장 bridge probe 응답이 올바르지 않아요."));
      }
      if (DEBUG_ENABLED) {
        global.console?.info?.("[Inova Meeting Workspace Bridge] workspace.extension-bridge.runtime-success", {
          extensionId: global.chrome?.runtime?.id || "",
          probe: runtimeResponse.data || {},
          requestId,
        });
      }
      postResponse({
        ...baseResponse,
        ...runtimeResponse,
        ok: true,
        probe: runtimeResponse.data || {},
      });
    } catch (error) {
      if (DEBUG_ENABLED) {
        global.console?.warn?.("[Inova Meeting Workspace Bridge] workspace.extension-bridge.runtime-error", {
          error: error instanceof Error ? error.message : String(error || "확장 브리지를 확인하지 못했어요."),
          requestId,
        });
      }
      postResponse({
        ...baseResponse,
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
    if (DEBUG_ENABLED) {
      global.console?.info?.("[Inova Meeting Workspace Bridge] workspace.extension-bridge.response-posted", {
        ok: Boolean(payload?.ok),
        requestId: String(payload?.requestId || ""),
      });
    }
  }
})(globalThis);
