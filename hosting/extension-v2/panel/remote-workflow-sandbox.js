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
    const pendingBridgeRequests = new Map();
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
      if (type === "remote-workflow.bridge.response") {
        resolveBridgeResponse(envelope);
        return;
      }
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
          void executeWorkflow(envelope.payload || {})
            .then((result) => postResponse(requestId, result))
            .catch((error) => postError(requestId, readErrorMessage(error)));
          return;
        }
        throw new Error(`unsupported remote workflow message: ${type}`);
      } catch (error) {
        postError(requestId, readErrorMessage(error));
      }
    }

    async function executeWorkflow(payload) {
      if (payload?.pilotEnabled !== true) {
        throw new Error("remote workflow execution is disabled until sandbox pilot");
      }
      const workflow = payload.workflow && typeof payload.workflow === "object" ? payload.workflow : {};
      const workflowId = normalizeText(workflow.workflowId || payload.workflowId);
      const artifactId = normalizeText(workflow.artifactId || payload.artifactId);
      const artifactVersion = normalizeText(workflow.artifactVersion || payload.artifactVersion);
      const steps = Array.isArray(workflow.steps) ? workflow.steps.slice(0, 20) : [];
      if (!workflowId || !artifactId || !artifactVersion || !steps.length) {
        throw new Error("remote workflow definition is incomplete");
      }
      if (workflowArtifacts[artifactId]?.artifactVersion !== artifactVersion) {
        throw new Error("remote workflow artifact version is not pinned");
      }
      const runContext = {
        input: cloneJsonObject(payload.input),
        steps: {},
      };
      const stepResults = [];
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index] && typeof steps[index] === "object" ? steps[index] : {};
        const stepId = normalizeText(step.id) || `step-${index + 1}`;
        const type = normalizeText(step.type || "bridge");
        const bridgeApi = normalizeText(step.bridgeApi);
        if (type !== "bridge" || !bridgeApi) {
          throw new Error(`remote workflow step is not allowed: ${stepId}`);
        }
        if (!activeBridgeApis.includes(bridgeApi) || !BRIDGE_API_ALLOWLIST.includes(bridgeApi)) {
          throw new Error(`remote workflow bridge API is not allowed: ${bridgeApi}`);
        }
        const output = await invokeBridgeApi(bridgeApi, resolveTemplate(step.input || {}, runContext));
        runContext.steps[stepId] = output || {};
        stepResults.push({
          bridgeApi,
          output: output || {},
          stepId,
        });
      }
      const lastStepId = stepResults.at(-1)?.stepId || "";
      return {
        output: resolveTemplate(workflow.output || `$steps.${lastStepId}`, runContext),
        stepCount: stepResults.length,
        steps: stepResults,
        workflowId,
      };
    }

    function invokeBridgeApi(api, input) {
      const requestId = `remote-workflow-bridge-${Date.now()}-${pendingBridgeRequests.size + 1}`;
      return new Promise((resolve, reject) => {
        const timerId = typeof runtimeGlobal.setTimeout === "function"
          ? runtimeGlobal.setTimeout(() => {
            pendingBridgeRequests.delete(requestId);
            reject(new Error(`remote workflow bridge timed out: ${api}`));
          }, 5000)
          : 0;
        pendingBridgeRequests.set(requestId, { reject, resolve, timerId });
        postToParent({
          api,
          input,
          requestId,
          source: SANDBOX_SOURCE,
          type: "remote-workflow.bridge.request",
        });
      });
    }

    function resolveBridgeResponse(envelope) {
      const requestId = normalizeText(envelope.requestId);
      const pending = pendingBridgeRequests.get(requestId);
      if (!pending) {
        return;
      }
      pendingBridgeRequests.delete(requestId);
      if (pending.timerId && typeof runtimeGlobal.clearTimeout === "function") {
        runtimeGlobal.clearTimeout(pending.timerId);
      }
      if (envelope.ok === true) {
        pending.resolve(envelope.payload || {});
      } else {
        pending.reject(new Error(normalizeText(envelope.error) || "remote workflow bridge failed"));
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

  function resolveTemplate(value, context) {
    if (typeof value === "string" && value.startsWith("$")) {
      return readTemplatePath(value, context);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => resolveTemplate(entry, context));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, resolveTemplate(entry, context)])
      );
    }
    return value;
  }

  function readTemplatePath(expression, context) {
    const parts = normalizeText(expression).slice(1).split(".");
    if (!parts.length || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
      throw new Error(`remote workflow template path is not allowed: ${expression}`);
    }
    let cursor = context;
    parts.forEach((part) => {
      cursor = cursor && typeof cursor === "object" ? cursor[part] : undefined;
    });
    return cloneJsonObject(cursor);
  }

  function cloneJsonObject(value) {
    return value == null ? {} : JSON.parse(JSON.stringify(value));
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
