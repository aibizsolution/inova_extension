(function initCapabilityManifestValidator(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(options = {}) {
    const bundledManifest = options.bundledManifest || {};
    const pageCapabilityIds = Array.isArray(options.pageCapabilityIds) ? options.pageCapabilityIds.slice() : [];
    const cloneValue = typeof options.cloneValue === "function"
      ? options.cloneValue
      : (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
    const getKnownHostingOrigins = typeof options.getKnownHostingOrigins === "function" ? options.getKnownHostingOrigins : () => [];
    const getKnownLanes = typeof options.getKnownLanes === "function" ? options.getKnownLanes : () => [];
    const isAllowedFunctionsBaseUrl = typeof options.isAllowedFunctionsBaseUrl === "function" ? options.isAllowedFunctionsBaseUrl : () => false;
    const isSafeEndpointPath = typeof options.isSafeEndpointPath === "function" ? options.isSafeEndpointPath : () => false;
    const normalizeText = typeof options.normalizeText === "function" ? options.normalizeText : (value) => String(value || "").trim();
    const readManifestVersion = typeof options.readManifestVersion === "function" ? options.readManifestVersion : () => "1.0.0";

    return {
      validateEndpointDefinition,
      validateRemoteCapabilityManifest,
    };

    function validateRemoteCapabilityManifest(manifest, manifestUrl) {
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error("remote capability manifest is not an object");
      }
      assertTrustedManifestUrl(manifestUrl);
      const normalizedManifest = cloneValue(manifest);
      if (Number(normalizedManifest.schemaVersion) !== Number(bundledManifest.schemaVersion)) {
        throw new Error("remote capability manifest schemaVersion mismatch");
      }
      if (!normalizeText(normalizedManifest.manifestVersion)) {
        throw new Error("remote capability manifestVersion is missing");
      }
      if (!isMinimumExtensionVersionSupported(normalizedManifest.minExtensionVersion)) {
        throw new Error("remote capability manifest requires a newer extension");
      }
      if (!isFutureIsoTimestamp(normalizedManifest.expiresAt)) {
        throw new Error("remote capability manifest is expired or missing expiresAt");
      }
      validateEndpointDefinitions(normalizedManifest.endpointKeys);
      validateCapabilityDefinitions(normalizedManifest.capabilities, normalizedManifest.endpointKeys);
      validateLaneDefinitions(normalizedManifest.lanes);
      validateManifestTargets(normalizedManifest.targets);
      return normalizedManifest;
    }

    function assertTrustedManifestUrl(manifestUrl) {
      let parsedUrl;
      try {
        parsedUrl = new URL(normalizeText(manifestUrl));
      } catch (error) {
        throw new Error("remote capability manifest URL is invalid", { cause: error });
      }
      const allowedOrigins = new Set(getKnownHostingOrigins());
      if (!allowedOrigins.has(parsedUrl.origin)) {
        throw new Error("remote capability manifest origin is not allowed");
      }
    }

    function isMinimumExtensionVersionSupported(minVersion) {
      const required = parseVersionParts(minVersion);
      const current = parseVersionParts(readManifestVersion() || bundledManifest.minExtensionVersion || "1.0.0");
      for (let index = 0; index < 3; index += 1) {
        if (current[index] > required[index]) return true;
        if (current[index] < required[index]) return false;
      }
      return true;
    }

    function parseVersionParts(version) {
      return normalizeText(version).split(".").slice(0, 3).map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      }).concat([0, 0, 0]).slice(0, 3);
    }

    function isFutureIsoTimestamp(value) {
      const timestamp = Date.parse(normalizeText(value));
      return Number.isFinite(timestamp) && timestamp > Date.now();
    }

    function validateEndpointDefinitions(endpointDefinitions) {
      if (!endpointDefinitions || typeof endpointDefinitions !== "object") {
        throw new Error("remote capability manifest endpointKeys are missing");
      }
      Object.keys(bundledManifest.endpointKeys || {}).forEach((endpointKey) => {
        const definition = endpointDefinitions[endpointKey];
        if (!definition || typeof definition !== "object") {
          throw new Error(`remote capability manifest endpoint is missing: ${endpointKey}`);
        }
      });
      Object.entries(endpointDefinitions).forEach(([endpointKey, definition]) => {
        validateEndpointDefinition(endpointKey, definition);
      });
    }

    function validateEndpointDefinition(endpointKey, definition) {
      if (!normalizeText(definition?.endpoint)) {
        throw new Error(`remote capability manifest endpoint path is missing: ${endpointKey}`);
      }
      if (!isSafeEndpointPath(definition.endpoint)) {
        throw new Error(`remote capability manifest endpoint path is not allowed: ${endpointKey}`);
      }
      const method = normalizeText(definition.method || "POST").toUpperCase();
      if (method !== "POST") {
        throw new Error(`remote capability manifest endpoint method is not allowed: ${endpointKey}`);
      }
    }

    function validateCapabilityDefinitions(capabilities, endpointDefinitions) {
      if (!capabilities || typeof capabilities !== "object") {
        throw new Error("remote capability manifest capabilities are missing");
      }
      Object.keys(bundledManifest.capabilities || {}).forEach((capabilityId) => {
        if (!capabilities[capabilityId]) {
          throw new Error(`remote capability manifest capability is missing: ${capabilityId}`);
        }
      });
      Object.entries(capabilities).forEach(([capabilityId, capability]) => {
        validateCapabilityId(capabilityId);
        validateCapabilityDefinition(capabilityId, capability, capabilities, endpointDefinitions);
      });
    }

    function validateCapabilityId(capabilityId) {
      if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(normalizeText(capabilityId))) {
        throw new Error(`remote capability manifest capabilityId is not allowed: ${capabilityId}`);
      }
    }

    function validateCapabilityDefinition(capabilityId, capability, capabilities, endpointDefinitions) {
      if (!capability || typeof capability !== "object") {
        throw new Error(`remote capability manifest capability is invalid: ${capabilityId}`);
      }
      const kind = normalizeText(capability.kind);
      if (!["function", "browser.open-url", "storage.write-ui-preferences", "page.capability", "workflow"].includes(kind)) {
        throw new Error(`remote capability manifest capability kind is not allowed: ${capabilityId}`);
      }
      validateCapabilityTarget(capabilityId, capability, endpointDefinitions, kind);
      const authMode = normalizeText(capability.authMode || capability.auth || "access-token").toLowerCase();
      if (!["access-token", "none"].includes(authMode)) {
        throw new Error(`remote capability manifest capability authMode is not allowed: ${capabilityId}`);
      }
      if (!normalizeText(capability.owner) || !normalizeText(capability.domain)) {
        throw new Error(`remote capability manifest capability metadata is missing: ${capabilityId}`);
      }
      const auditLevel = normalizeText(capability.auditLevel).toLowerCase();
      if (!["read", "write", "auth"].includes(auditLevel)) {
        throw new Error(`remote capability manifest capability auditLevel is not allowed: ${capabilityId}`);
      }
      if (kind === "function" && (auditLevel === "write" || auditLevel === "auth") && authMode === "none") {
        throw new Error(`remote capability manifest capability authMode is too weak: ${capabilityId}`);
      }
      if (!Number.isFinite(Number(capability.inputSchemaVersion)) || !Number.isFinite(Number(capability.outputSchemaVersion))) {
        throw new Error(`remote capability manifest capability schema is missing: ${capabilityId}`);
      }
      if (!isMinimumExtensionVersionSupported(capability.minExtensionVersion || bundledManifest.minExtensionVersion)) {
        throw new Error(`remote capability manifest capability requires a newer extension: ${capabilityId}`);
      }
      validateCapabilityLifecycleMetadata(capabilityId, capability, capabilities);
    }

    function validateCapabilityTarget(capabilityId, capability, endpointDefinitions, kind) {
      if (kind === "function") {
        const endpointKey = normalizeText(capability.endpointKey);
        const service = normalizeText(capability.service).toLowerCase();
        if (!endpointKey || !endpointDefinitions?.[endpointKey]) throw new Error(`remote capability manifest capability endpointKey is missing: ${capabilityId}`);
        if (!["meeting", "prompt"].includes(service)) throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      }
      if (kind === "browser.open-url") {
        const templateKeys = Array.isArray(capability.templateKeys) ? capability.templateKeys.map(normalizeText) : [];
        if (!templateKeys.length || templateKeys.some((templateKey) => templateKey !== "release.download")) throw new Error(`remote capability manifest capability templateKey is not allowed: ${capabilityId}`);
      }
      if (kind === "storage.write-ui-preferences" && normalizeText(capability.service).toLowerCase() !== "storage") throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      if (kind === "page.capability") {
        const pageCapabilityId = normalizeText(capability.pageCapabilityId);
        if (!pageCapabilityIds.includes(pageCapabilityId)) throw new Error(`remote capability manifest page capability is not allowed: ${capabilityId}`);
        if (normalizeText(capability.service).toLowerCase() !== "page") throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      }
      if (kind === "workflow") validateDisabledWorkflowCapability(capabilityId, capability);
    }

    function validateCapabilityLifecycleMetadata(capabilityId, capability, capabilities) {
      const deprecatedAt = normalizeText(capability.deprecatedAt);
      const replacementId = normalizeText(capability.replacementId);
      if (deprecatedAt && !Number.isFinite(Date.parse(deprecatedAt))) {
        throw new Error(`remote capability manifest deprecatedAt is invalid: ${capabilityId}`);
      }
      if (deprecatedAt && !replacementId) {
        throw new Error(`remote capability manifest replacementId is missing: ${capabilityId}`);
      }
      if (replacementId && !deprecatedAt) {
        throw new Error(`remote capability manifest deprecatedAt is missing: ${capabilityId}`);
      }
      if (replacementId && replacementId === capabilityId) {
        throw new Error(`remote capability manifest replacementId points to itself: ${capabilityId}`);
      }
      if (replacementId && !capabilities?.[replacementId]) {
        throw new Error(`remote capability manifest replacementId is unknown: ${capabilityId}`);
      }
    }

    function validateDisabledWorkflowCapability(capabilityId, capability) {
      if (normalizeText(capability.service).toLowerCase() !== "workflow") {
        throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      }
      if (!capability.killSwitch || typeof capability.killSwitch !== "object" || typeof capability.killSwitch.enabled !== "boolean") {
        throw new Error(`remote workflow capability kill switch metadata is missing: ${capabilityId}`);
      }
      if (capability.enabled !== false && !isCapabilityKillSwitchEnabled(capability)) {
        throw new Error(`remote workflow capability must stay disabled before sandbox pilot: ${capabilityId}`);
      }
      ["workflowId", "artifactId", "artifactVersion"].forEach((field) => {
        if (!normalizeText(capability[field])) {
          throw new Error(`remote workflow capability metadata is missing: ${capabilityId}`);
        }
      });
    }

    function isCapabilityKillSwitchEnabled(capability) {
      const killSwitch = capability?.killSwitch;
      return capability?.killed === true || killSwitch === true || killSwitch?.enabled === true;
    }

    function validateLaneDefinitions(lanes) {
      if (!lanes || typeof lanes !== "object") {
        throw new Error("remote capability manifest lanes are missing");
      }
      getKnownLanes().forEach((lane) => {
        const laneConfig = lanes[lane];
        if (!laneConfig || typeof laneConfig !== "object") {
          throw new Error(`remote capability manifest lane is missing: ${lane}`);
        }
        if (!isAllowedFunctionsBaseUrl(laneConfig.baseUrl)) {
          throw new Error(`remote capability manifest lane baseUrl is not allowed: ${lane}`);
        }
        Object.entries(laneConfig.endpointOverrides || {}).forEach(([endpointKey, endpointPath]) => {
          if (!isSafeEndpointPath(endpointPath)) {
            throw new Error(`remote capability manifest lane endpoint override is not allowed: ${lane}/${endpointKey}`);
          }
        });
      });
    }

    function validateManifestTargets(targets) {
      if (!targets || typeof targets !== "object") {
        throw new Error("remote capability manifest targets are missing");
      }
      if (!isAllowedFunctionsBaseUrl(targets.production?.functionsBaseUrl)) {
        throw new Error("remote capability manifest production target is not allowed");
      }
      if (!isAllowedFunctionsBaseUrl(targets.local?.functionsBaseUrl)) {
        throw new Error("remote capability manifest local target is not allowed");
      }
    }
  }

  namespace.capabilityManifestValidator = {
    create,
  };
})(globalThis);
