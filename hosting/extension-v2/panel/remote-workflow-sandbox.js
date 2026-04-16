(function initRemoteWorkflowSandbox(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const HOST_SOURCE = "inova-remote-workflow-host";
  const SANDBOX_SOURCE = "inova-remote-workflow-sandbox";
  const BRIDGE_API_ALLOWLIST = Object.freeze([
    "emitTrace",
    "invokeCapability",
    "invokePageCapability",
    "metrics",
    "openUrl",
    "readPanelState",
    "writeUiPreferences",
  ]);
  const FORBIDDEN_GLOBALS = Object.freeze([
    "browser",
    "caches",
    "chrome",
    "EventSource",
    "fetch",
    "indexedDB",
    "localStorage",
    "sessionStorage",
    "WebSocket",
    "XMLHttpRequest",
  ]);

  function createRuntime(options = {}) {
    const runtimeGlobal = options.global || global;
    const parentWindow = options.parentWindow || runtimeGlobal.parent;
    let activeBridgeApis = [];
    let workflowArtifacts = {};
    let attached = false;

    blockForbiddenGlobals(runtimeGlobal);

    return {
      attach,
      handleEnvelope,
      probeSecurityBoundary: () => probeSecurityBoundary(runtimeGlobal),
    };

    function attach() {
      if (attached || typeof runtimeGlobal.addEventListener !== "function") {
        return;
      }
      runtimeGlobal.addEventListener("message", (event) => {
        if (event?.data?.source !== HOST_SOURCE) {
          return;
        }
        handleEnvelope(event.data);
      });
      attached = true;
    }

    function handleEnvelope(envelope = {}) {
      const requestId = normalizeText(envelope.requestId);
      const type = normalizeText(envelope.type);
      try {
        if (type === "remote-workflow.boot") {
          const payload = envelope.payload && typeof envelope.payload === "object" ? envelope.payload : {};
          activeBridgeApis = normalizeBridgeApis(payload.bridgeApis);
          workflowArtifacts = normalizeWorkflowArtifacts(payload.workflowArtifacts);
          postResponse(requestId, {
            bridgeApis: activeBridgeApis.slice(),
            security: probeSecurityBoundary(runtimeGlobal),
            workflowArtifactIds: Object.keys(workflowArtifacts).sort(),
          });
          return;
        }
        if (type === "remote-workflow.run") {
          throw new Error("remote workflow execution is disabled until sandbox pilot");
        }
        throw new Error(`unsupported remote workflow message: ${type}`);
      } catch (error) {
        postError(requestId, readErrorMessage(error));
      }
    }

    function postResponse(requestId, payload) {
      postToParent({
        ok: true,
        payload,
        requestId,
        source: SANDBOX_SOURCE,
        type: "remote-workflow.response",
      });
    }

    function postError(requestId, error) {
      postToParent({
        error,
        ok: false,
        requestId,
        source: SANDBOX_SOURCE,
        type: "remote-workflow.response",
      });
    }

    function postToParent(message) {
      if (parentWindow && typeof parentWindow.postMessage === "function") {
        parentWindow.postMessage(message, "*");
      }
    }
  }

  function normalizeBridgeApis(value) {
    const allowed = new Set(BRIDGE_API_ALLOWLIST);
    return Array.isArray(value)
      ? Array.from(new Set(value.map(normalizeText).filter((api) => allowed.has(api)))).sort()
      : [];
  }

  function normalizeWorkflowArtifacts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value)
        .map(([artifactId, artifact]) => [
          normalizeText(artifactId),
          {
            artifactVersion: normalizeText(artifact?.artifactVersion || artifact?.version),
            bundleId: normalizeText(artifact?.bundleId),
            integrity: normalizeText(artifact?.integrity),
            scriptSlot: normalizeText(artifact?.scriptSlot),
          },
        ])
        .filter(([artifactId, artifact]) => Boolean(
          artifactId
            && artifact.artifactVersion
            && artifact.bundleId
            && artifact.integrity
            && artifact.scriptSlot
        ))
    );
  }

  function blockForbiddenGlobals(targetGlobal) {
    FORBIDDEN_GLOBALS.forEach((name) => {
      try {
        Object.defineProperty(targetGlobal, name, {
          configurable: false,
          get() {
            throw new Error(`sandbox global is blocked: ${name}`);
          },
          set() {
            throw new Error(`sandbox global is blocked: ${name}`);
          },
        });
      } catch {
        try {
          targetGlobal[name] = undefined;
        } catch {
          // Some browser globals are non-configurable. The CSP and iframe sandbox still carry the hard boundary.
        }
      }
    });
  }

  function probeSecurityBoundary(targetGlobal) {
    return Object.fromEntries(
      FORBIDDEN_GLOBALS.map((name) => [name, isBlockedGlobal(targetGlobal, name)])
    );
  }

  function isBlockedGlobal(targetGlobal, name) {
    try {
      return typeof targetGlobal[name] === "undefined";
    } catch {
      return true;
    }
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function readErrorMessage(error) {
    return normalizeText(error instanceof Error ? error.message : error) || "remote workflow sandbox failed";
  }

  namespace.remoteWorkflowSandbox = Object.freeze({
    BRIDGE_API_ALLOWLIST,
    FORBIDDEN_GLOBALS,
    createRuntime,
  });

  createRuntime({ global }).attach();
})(globalThis);
