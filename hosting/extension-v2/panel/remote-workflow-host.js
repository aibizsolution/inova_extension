(function initRemoteWorkflowHost(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText } = namespace.panelUtils || { normalizeText: (value) => String(value ?? "").trim() };
  const HOST_SOURCE = "inova-remote-workflow-host";
  const SANDBOX_SOURCE = "inova-remote-workflow-sandbox";
  const DEFAULT_TIMEOUT_MS = 5000;
  const SANDBOX_PATH = "./remote-workflow-sandbox.html";
  const BRIDGE_API_ALLOWLIST = Object.freeze([
    "emitTrace",
    "invokeCapability",
    "invokePageCapability",
    "metrics",
    "openUrl",
    "readPanelState",
    "writeUiPreferences",
  ]);

  function create(options = {}) {
    const doc = options.document || global.document;
    const browserCapabilities = options.browserCapabilities || {};
    const trace = typeof options.trace === "function" ? options.trace : () => {};
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const pendingRequests = new Map();
    let frame = null;
    let frameWindow = null;
    let messageSeq = 0;
    let booted = false;
    let activeBridgeApis = [];
    let attached = false;
    let workflowArtifactsById = {};
    const workflowArtifactCache = new Map();

    return {
      boot,
      dispose,
      getState,
      runWorkflow,
    };

    function boot(request = {}) {
      ensureFrame();
      const bridgeApis = normalizeBridgeApis(request.bridgeApis);
      workflowArtifactsById = normalizeWorkflowArtifacts(request.workflowArtifacts);
      return postSandboxRequest("remote-workflow.boot", {
        bridgeApis,
        workflowArtifacts: workflowArtifactsById,
      }).then((result) => {
        activeBridgeApis = normalizeBridgeApis(result?.bridgeApis);
        booted = true;
        trace("remote.workflow.sandbox.ready", {
          bridgeApiCount: activeBridgeApis.length,
          workflowArtifactCount: Array.isArray(result?.workflowArtifactIds) ? result.workflowArtifactIds.length : 0,
        });
        return result;
      });
    }

    function runWorkflow(request = {}) {
      if (!booted) {
        throw new Error("remote workflow sandbox is not ready");
      }
      return resolveWorkflowRunRequest(request)
        .then((payload) => postSandboxRequest("remote-workflow.run", payload));
    }

    function getState() {
      return {
        booted,
        bridgeApis: activeBridgeApis.slice(),
        mounted: Boolean(frame),
      };
    }

    function dispose() {
      pendingRequests.forEach((entry) => {
        clearTimeout(entry.timerId);
        entry.reject(new Error("remote workflow sandbox disposed"));
      });
      pendingRequests.clear();
      if (frame?.parentNode && typeof frame.parentNode.removeChild === "function") {
        frame.parentNode.removeChild(frame);
      }
      frame = null;
      frameWindow = null;
      booted = false;
      activeBridgeApis = [];
      workflowArtifactsById = {};
      workflowArtifactCache.clear();
    }

    function ensureFrame() {
      if (frame) {
        return;
      }
      if (!doc?.createElement || !doc?.body?.appendChild) {
        throw new Error("remote workflow sandbox document host is unavailable");
      }
      frame = doc.createElement("iframe");
      frame.setAttribute("title", "i-Nova remote workflow sandbox");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.hidden = true;
      frame.tabIndex = -1;
      frame.src = buildSandboxUrl();
      doc.body.appendChild(frame);
      frameWindow = frame.contentWindow;
      attachMessageListener();
    }

    function attachMessageListener() {
      if (attached || typeof global.addEventListener !== "function") {
        return;
      }
      global.addEventListener("message", handleSandboxMessage);
      attached = true;
    }

    function handleSandboxMessage(event) {
      if (!frameWindow || event?.source !== frameWindow) {
        return;
      }
      const message = event.data || {};
      if (message.source !== SANDBOX_SOURCE) {
        return;
      }
      if (message.type === "remote-workflow.response") {
        resolveSandboxResponse(message);
        return;
      }
      if (message.type === "remote-workflow.bridge.request") {
        void handleBridgeRequest(message);
      }
    }

    async function handleBridgeRequest(message) {
      const requestId = normalizeText(message.requestId);
      const api = normalizeText(message.api);
      try {
        if (!activeBridgeApis.includes(api) || !BRIDGE_API_ALLOWLIST.includes(api)) {
          throw new Error(`remote workflow bridge API is not allowed: ${api}`);
        }
        const result = await dispatchBridgeApi(api, message.input || {});
        postSandboxMessage({
          ok: true,
          payload: result || {},
          requestId,
          source: HOST_SOURCE,
          type: "remote-workflow.bridge.response",
        });
      } catch (error) {
        postSandboxMessage({
          error: readErrorMessage(error),
          ok: false,
          requestId,
          source: HOST_SOURCE,
          type: "remote-workflow.bridge.response",
        });
      }
    }

    function dispatchBridgeApi(api, input) {
      if (api === "invokeCapability") {
        return requireBrowserCapability("invokeCapability")(
          input?.capabilityId,
          input?.input && typeof input.input === "object" ? input.input : {},
          { trace: input?.trace || null }
        );
      }
      if (api === "invokePageCapability") {
        return requireBrowserCapability("invokePageCapability")(
          input?.pageCapabilityId,
          input?.input && typeof input.input === "object" ? input.input : {}
        );
      }
      if (api === "readPanelState") {
        return requireBrowserCapability("readPanelStorageState")();
      }
      if (api === "writeUiPreferences") {
        return requireBrowserCapability("writeUiPreferences")(
          input?.partial && typeof input.partial === "object" ? input.partial : {}
        );
      }
      if (api === "openUrl") {
        return requireBrowserCapability("invokeCapability")("release.download.open", {
          fileName: normalizeText(input?.fileName),
          templateKey: normalizeText(input?.templateKey),
        });
      }
      if (api === "emitTrace" || api === "metrics") {
        trace(api === "metrics" ? "remote.workflow.metrics" : "remote.workflow.trace", input || {});
        return { ok: true };
      }
      throw new Error(`remote workflow bridge API is not implemented: ${api}`);
    }

    function requireBrowserCapability(methodName) {
      const method = browserCapabilities?.[methodName];
      if (typeof method !== "function") {
        throw new Error(`remote workflow bridge method is unavailable: ${methodName}`);
      }
      return method;
    }

    function postSandboxRequest(type, payload) {
      ensureFrame();
      const requestId = `remote-workflow-${Date.now()}-${messageSeq += 1}`;
      const message = {
        payload,
        requestId,
        source: HOST_SOURCE,
        type,
      };
      return new Promise((resolve, reject) => {
        const timerId = global.setTimeout?.(() => {
          pendingRequests.delete(requestId);
          reject(new Error(`remote workflow sandbox timed out: ${type}`));
        }, timeoutMs);
        pendingRequests.set(requestId, { reject, resolve, timerId });
        postSandboxMessage(message);
      });
    }

    function postSandboxMessage(message) {
      if (!frameWindow || typeof frameWindow.postMessage !== "function") {
        throw new Error("remote workflow sandbox window is unavailable");
      }
      frameWindow.postMessage(message, "*");
    }

    function resolveSandboxResponse(message) {
      const requestId = normalizeText(message.requestId);
      const pending = pendingRequests.get(requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(requestId);
      clearTimeout(pending.timerId);
      if (message.ok === true) {
        pending.resolve(message.payload || {});
      } else {
        pending.reject(new Error(normalizeText(message.error) || "remote workflow sandbox failed"));
      }
    }

    function buildSandboxUrl() {
      const suffix = normalizeText(global.__INOVA_HOSTED_PANEL_ASSET_SUFFIX__);
      return `${SANDBOX_PATH}${suffix}`;
    }

    async function resolveWorkflowRunRequest(request) {
      const payload = sanitizeWorkflowRunRequest(request);
      if (!payload.workflow) {
        payload.workflow = await loadWorkflowArtifact(payload.artifactId);
      }
      return payload;
    }

    async function loadWorkflowArtifact(artifactId) {
      const normalizedArtifactId = normalizeText(artifactId);
      const artifact = workflowArtifactsById[normalizedArtifactId];
      if (!artifact) {
        throw new Error(`remote workflow artifact is not registered: ${normalizedArtifactId}`);
      }
      const cacheKey = `${normalizedArtifactId}@${artifact.artifactVersion}`;
      if (workflowArtifactCache.has(cacheKey)) {
        return workflowArtifactCache.get(cacheKey);
      }
      const artifactUrl = buildWorkflowArtifactUrl(artifact);
      if (typeof global.fetch !== "function") {
        throw new Error("remote workflow artifact fetch is unavailable");
      }
      const response = await global.fetch(artifactUrl, {
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      });
      if (!response?.ok || typeof response.text !== "function") {
        throw new Error(`remote workflow artifact fetch failed: ${normalizedArtifactId}`);
      }
      const source = await response.text();
      await assertArtifactIntegrity(source, artifact.integrity);
      const workflow = parseWorkflowArtifact(source, artifact);
      workflowArtifactCache.set(cacheKey, workflow);
      return workflow;
    }

    function buildWorkflowArtifactUrl(artifact) {
      const bundleId = normalizeArtifactPathPart(artifact.bundleId, "bundleId");
      const artifactVersion = normalizeArtifactPathPart(artifact.artifactVersion, "artifactVersion");
      return `./workflows/${encodeURIComponent(bundleId)}/${encodeURIComponent(artifactVersion)}.json`;
    }

    function normalizeArtifactPathPart(value, label) {
      const normalized = normalizeText(value);
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(normalized)) {
        throw new Error(`remote workflow artifact ${label} is not allowed`);
      }
      return normalized;
    }

    async function assertArtifactIntegrity(source, integrity) {
      const expected = normalizeText(integrity);
      if (!expected.startsWith("sha256-")) {
        throw new Error("remote workflow artifact integrity is invalid");
      }
      const actual = `sha256-${await sha256Base64(source)}`;
      if (actual !== expected) {
        throw new Error("remote workflow artifact integrity mismatch");
      }
    }

    async function sha256Base64(source) {
      if (!global.crypto?.subtle || typeof global.TextEncoder !== "function") {
        throw new Error("remote workflow artifact integrity verifier is unavailable");
      }
      const bytes = new global.TextEncoder().encode(source);
      const digest = await global.crypto.subtle.digest("SHA-256", bytes);
      return base64Encode(new Uint8Array(digest));
    }

    function base64Encode(bytes) {
      let binary = "";
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      if (typeof global.btoa !== "function") {
        throw new Error("remote workflow artifact base64 encoder is unavailable");
      }
      return global.btoa(binary);
    }

    function parseWorkflowArtifact(source, artifact) {
      let workflow;
      try {
        workflow = JSON.parse(source);
      } catch (error) {
        throw new Error("remote workflow artifact JSON is invalid", { cause: error });
      }
      const normalizedWorkflow = sanitizeWorkflowDefinition(workflow);
      if (!normalizedWorkflow?.workflowId) {
        throw new Error("remote workflow artifact definition is invalid");
      }
      if (
        normalizedWorkflow.artifactId !== artifact.artifactId
        || normalizedWorkflow.artifactVersion !== artifact.artifactVersion
      ) {
        throw new Error("remote workflow artifact metadata mismatch");
      }
      return normalizedWorkflow;
    }

    function sanitizeWorkflowRunRequest(request) {
      return {
        artifactId: normalizeText(request?.artifactId),
        artifactVersion: normalizeText(request?.artifactVersion),
        input: request?.input && typeof request.input === "object" ? request.input : {},
        pilotEnabled: request?.pilotEnabled === true,
        workflow: sanitizeWorkflowDefinition(request?.workflow),
        workflowId: normalizeText(request?.workflowId),
        workflowVersion: normalizeText(request?.workflowVersion),
      };
    }

    function sanitizeWorkflowDefinition(workflow) {
      if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
        return null;
      }
      return {
        artifactId: normalizeText(workflow.artifactId),
        artifactVersion: normalizeText(workflow.artifactVersion),
        output: cloneJsonValue(workflow.output),
        steps: Array.isArray(workflow.steps)
          ? workflow.steps.slice(0, 20).map((step) => ({
            bridgeApi: normalizeText(step?.bridgeApi),
            id: normalizeText(step?.id),
            input: cloneJsonValue(step?.input),
            type: normalizeText(step?.type || "bridge"),
          }))
          : [],
        workflowId: normalizeText(workflow.workflowId),
      };
    }

    function cloneJsonValue(value) {
      return value == null ? null : JSON.parse(JSON.stringify(value));
    }

    function normalizeBridgeApis(value) {
      const allowed = new Set(BRIDGE_API_ALLOWLIST);
      return Array.isArray(value)
        ? Array.from(new Set(value.map(normalizeText).filter((api) => allowed.has(api)))).sort()
        : [];
    }

    function normalizeWorkflowArtifacts(value) {
      if (!value || typeof value !== "object") {
        return {};
      }
      const entries = Array.isArray(value)
        ? value.map((artifact) => [artifact?.artifactId, artifact])
        : Object.entries(value);
      return Object.fromEntries(
        entries
          .map(([artifactId, artifact]) => [
          normalizeText(artifactId),
          {
            artifactId: normalizeText(artifactId),
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

    function readErrorMessage(error) {
      return normalizeText(error instanceof Error ? error.message : error) || "remote workflow host failed";
    }
  }

  namespace.remoteWorkflowHost = Object.freeze({
    BRIDGE_API_ALLOWLIST,
    create,
  });
})(globalThis);
