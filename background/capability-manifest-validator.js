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
    const readActiveLane = typeof options.readActiveLane === "function" ? options.readActiveLane : () => "legacy";
    const readManifestVersion = typeof options.readManifestVersion === "function" ? options.readManifestVersion : () => "1.0.0";
    const workflowScriptSlots = new Set(
      (Array.isArray(options.workflowScriptSlots) ? options.workflowScriptSlots : ["remote-workflow"])
        .map(normalizeText)
        .filter(Boolean)
    );

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
      validateUrlTemplates(normalizedManifest.urlTemplates);
      validateWorkflowArtifacts(normalizedManifest.workflowArtifacts);
      const workflowPilot = validateWorkflowPilot(normalizedManifest.workflowPilot);
      validateCapabilityDefinitions(
        normalizedManifest.capabilities,
        normalizedManifest.endpointKeys,
        normalizedManifest.urlTemplates,
        normalizedManifest.workflowArtifacts,
        workflowPilot
      );
      validateCapabilityAliases(normalizedManifest.aliases, normalizedManifest.capabilities);
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

    function validateCapabilityDefinitions(capabilities, endpointDefinitions, urlTemplates, workflowArtifacts, workflowPilot) {
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
        validateCapabilityDefinition(capabilityId, capability, capabilities, endpointDefinitions, urlTemplates, workflowArtifacts, workflowPilot);
      });
    }

    function validateCapabilityId(capabilityId) {
      if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(normalizeText(capabilityId))) {
        throw new Error(`remote capability manifest capabilityId is not allowed: ${capabilityId}`);
      }
    }

    function validateCapabilityDefinition(capabilityId, capability, capabilities, endpointDefinitions, urlTemplates, workflowArtifacts, workflowPilot) {
      if (!capability || typeof capability !== "object") {
        throw new Error(`remote capability manifest capability is invalid: ${capabilityId}`);
      }
      validateTestOnlyCapabilityMetadata(capabilityId, capability);
      const kind = normalizeText(capability.kind);
      if (!["function", "browser.open-url", "storage.write-ui-preferences", "page.capability", "workflow"].includes(kind)) {
        throw new Error(`remote capability manifest capability kind is not allowed: ${capabilityId}`);
      }
      validateCapabilityTarget(capabilityId, capability, endpointDefinitions, urlTemplates, kind, workflowArtifacts, workflowPilot);
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
      if (kind === "workflow" && authMode !== "none") {
        throw new Error(`remote workflow capability authMode is not allowed: ${capabilityId}`);
      }
      if (kind === "workflow" && auditLevel === "auth") {
        throw new Error(`remote workflow capability auditLevel is not allowed: ${capabilityId}`);
      }
      if (!Number.isFinite(Number(capability.inputSchemaVersion)) || !Number.isFinite(Number(capability.outputSchemaVersion))) {
        throw new Error(`remote capability manifest capability schema is missing: ${capabilityId}`);
      }
      validateCapabilityRequestTimeout(capabilityId, capability);
      validateCapabilityLifecycleMetadata(capabilityId, capability, capabilities);
    }

    function validateCapabilityRequestTimeout(capabilityId, capability) {
      if (capability.requestTimeoutMs == null) {
        return;
      }
      const timeoutMs = Number(capability.requestTimeoutMs);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
        throw new Error(`remote capability manifest requestTimeoutMs is not allowed: ${capabilityId}`);
      }
    }

    function validateTestOnlyCapabilityMetadata(capabilityId, capability) {
      const testOnly = capability.testOnly === true;
      if (normalizeText(capabilityId).startsWith("test.") && !testOnly) {
        throw new Error(`remote capability manifest test capability metadata is missing: ${capabilityId}`);
      }
      if (testOnly && capability.enabled !== false) {
        throw new Error(`remote capability manifest test capability must stay disabled: ${capabilityId}`);
      }
    }

    function validateCapabilityTarget(capabilityId, capability, endpointDefinitions, urlTemplates, kind, workflowArtifacts, workflowPilot) {
      if (kind === "function") {
        const endpointKey = normalizeText(capability.endpointKey);
        const service = normalizeText(capability.service).toLowerCase();
        if (!endpointKey || !endpointDefinitions?.[endpointKey]) throw new Error(`remote capability manifest capability endpointKey is missing: ${capabilityId}`);
        if (!["admin", "meeting", "metrics", "prompt"].includes(service)) throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      }
      if (kind === "browser.open-url") {
        const templateKeys = Array.isArray(capability.templateKeys) ? capability.templateKeys.map(normalizeText) : [];
        if (!templateKeys.length || templateKeys.some((templateKey) => !urlTemplates?.[templateKey])) throw new Error(`remote capability manifest capability templateKey is not allowed: ${capabilityId}`);
      }
      if (kind === "storage.write-ui-preferences" && normalizeText(capability.service).toLowerCase() !== "storage") throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      if (kind === "page.capability") {
        const pageCapabilityId = normalizeText(capability.pageCapabilityId);
        if (!pageCapabilityIds.includes(pageCapabilityId)) throw new Error(`remote capability manifest page capability is not allowed: ${capabilityId}`);
        if (normalizeText(capability.service).toLowerCase() !== "page") throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      }
      if (kind === "workflow") validateWorkflowCapability(capabilityId, capability, workflowArtifacts, workflowPilot);
    }

    function validateUrlTemplates(urlTemplates) {
      if (!urlTemplates || typeof urlTemplates !== "object" || Array.isArray(urlTemplates)) {
        throw new Error("remote capability manifest urlTemplates are missing");
      }
      Object.entries(urlTemplates).forEach(([templateKey, template]) => {
        validateCapabilityId(templateKey);
        if (!template || typeof template !== "object" || Array.isArray(template)) {
          throw new Error(`remote capability manifest urlTemplate is invalid: ${templateKey}`);
        }
        const origin = normalizeText(template.origin);
        const pattern = normalizeText(template.pattern);
        if (!isAllowedUrlTemplateOrigin(origin)) {
          throw new Error(`remote capability manifest urlTemplate origin is not allowed: ${templateKey}`);
        }
        if (!isSafeUrlTemplatePattern(pattern)) {
          throw new Error(`remote capability manifest urlTemplate pattern is not allowed: ${templateKey}`);
        }
        validateUrlTemplateParams(templateKey, template.params);
      });
    }

    function validateUrlTemplateParams(templateKey, params) {
      if (params == null) {
        return;
      }
      if (typeof params !== "object" || Array.isArray(params)) {
        throw new Error(`remote capability manifest urlTemplate params are invalid: ${templateKey}`);
      }
      Object.entries(params).forEach(([paramKey, paramType]) => {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(normalizeText(paramKey))) {
          throw new Error(`remote capability manifest urlTemplate param key is not allowed: ${templateKey}`);
        }
        if (!["safe-segment", "zip-file"].includes(normalizeText(paramType))) {
          throw new Error(`remote capability manifest urlTemplate param type is not allowed: ${templateKey}`);
        }
      });
    }

    function isAllowedUrlTemplateOrigin(origin) {
      if (origin === "runtime.hosting") {
        return true;
      }
      return getKnownHostingOrigins().includes(origin);
    }

    function isSafeUrlTemplatePattern(pattern) {
      return Boolean(pattern)
        && !/^[a-z][a-z0-9+.-]*:/i.test(pattern)
        && !pattern.startsWith("//")
        && !pattern.includes("..")
        && !/[?#]/.test(pattern)
        && /^[A-Za-z0-9/_{}.-]+$/.test(pattern)
        && !/\{[^A-Za-z0-9_]/.test(pattern)
        && !/[^A-Za-z0-9_]\}/.test(pattern);
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

    function validateCapabilityAliases(aliases, capabilities) {
      if (aliases == null) {
        return;
      }
      if (typeof aliases !== "object" || Array.isArray(aliases)) {
        throw new Error("remote capability manifest aliases are invalid");
      }
      Object.entries(aliases).forEach(([aliasId, alias]) => {
        validateCapabilityId(aliasId);
        if (capabilities?.[aliasId]) {
          throw new Error(`remote capability alias collides with capabilityId: ${aliasId}`);
        }
        if (!alias || typeof alias !== "object" || Array.isArray(alias)) {
          throw new Error(`remote capability alias is invalid: ${aliasId}`);
        }
        const replacementId = normalizeText(alias.replacementId);
        const removeAfter = normalizeText(alias.removeAfter);
        if (!replacementId || !capabilities?.[replacementId]) {
          throw new Error(`remote capability alias replacementId is unknown: ${aliasId}`);
        }
        if (replacementId === aliasId) {
          throw new Error(`remote capability alias points to itself: ${aliasId}`);
        }
        if (!removeAfter || !Number.isFinite(Date.parse(removeAfter)) || Date.parse(removeAfter) <= Date.now()) {
          throw new Error(`remote capability alias removeAfter is invalid: ${aliasId}`);
        }
      });
    }

    function validateWorkflowArtifacts(workflowArtifacts) {
      if (workflowArtifacts == null) {
        return;
      }
      if (typeof workflowArtifacts !== "object" || Array.isArray(workflowArtifacts)) {
        throw new Error("remote workflow artifact registry is invalid");
      }
      Object.entries(workflowArtifacts).forEach(([artifactId, artifact]) => {
        validateCapabilityId(artifactId);
        if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
          throw new Error(`remote workflow artifact is invalid: ${artifactId}`);
        }
        const explicitArtifactId = normalizeText(artifact.artifactId);
        if (explicitArtifactId && explicitArtifactId !== artifactId) {
          throw new Error(`remote workflow artifact id mismatch: ${artifactId}`);
        }
        const artifactVersion = normalizeText(artifact.artifactVersion || artifact.version);
        const bundleId = normalizeText(artifact.bundleId);
        const scriptSlot = normalizeText(artifact.scriptSlot);
        const integrity = normalizeText(artifact.integrity);
        if (!artifactVersion || !bundleId || !scriptSlot || !integrity) {
          throw new Error(`remote workflow artifact metadata is missing: ${artifactId}`);
        }
        validateCapabilityId(bundleId);
        if (!workflowScriptSlots.has(scriptSlot)) {
          throw new Error(`remote workflow artifact scriptSlot is not allowed: ${artifactId}`);
        }
        if (!/^sha256-[A-Za-z0-9+/=]{32,}$/.test(integrity)) {
          throw new Error(`remote workflow artifact integrity is invalid: ${artifactId}`);
        }
        ["code", "endpointUrl", "fetchUrl", "script", "scriptText", "source", "url"].forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(artifact, field)) {
            throw new Error(`remote workflow artifact contains a forbidden payload field: ${artifactId}/${field}`);
          }
        });
      });
    }

    function validateWorkflowPilot(workflowPilot) {
      if (workflowPilot == null) {
        return { enabled: false, lanes: [] };
      }
      if (!workflowPilot || typeof workflowPilot !== "object" || Array.isArray(workflowPilot)) {
        throw new Error("remote workflow pilot metadata is invalid");
      }
      const enabled = workflowPilot.enabled === true;
      const lanes = Array.isArray(workflowPilot.lanes)
        ? workflowPilot.lanes.map((lane) => normalizeText(lane).toLowerCase()).filter(Boolean)
        : [];
      const knownLanes = new Set(getKnownLanes().map((lane) => normalizeText(lane).toLowerCase()));
      if (lanes.some((lane) => !knownLanes.has(lane))) {
        throw new Error("remote workflow pilot lane is not allowed");
      }
      if (enabled) {
        if (!workflowPilot.killSwitch || typeof workflowPilot.killSwitch !== "object" || typeof workflowPilot.killSwitch.enabled !== "boolean") {
          throw new Error("remote workflow pilot kill switch metadata is missing");
        }
        if (!lanes.length) {
          throw new Error("remote workflow pilot lanes are missing");
        }
      }
      return {
        enabled,
        killSwitchEnabled: workflowPilot.killSwitch === true || workflowPilot.killSwitch?.enabled === true,
        lanes,
      };
    }

    function validateWorkflowCapability(capabilityId, capability, workflowArtifacts, workflowPilot) {
      if (normalizeText(capability.service).toLowerCase() !== "workflow") {
        throw new Error(`remote capability manifest capability service is not allowed: ${capabilityId}`);
      }
      if (!capability.killSwitch || typeof capability.killSwitch !== "object" || typeof capability.killSwitch.enabled !== "boolean") {
        throw new Error(`remote workflow capability kill switch metadata is missing: ${capabilityId}`);
      }
      if (
        capability.enabled !== false
        && !isCapabilityKillSwitchEnabled(capability)
        && !isWorkflowPilotAllowed(capability, workflowPilot)
      ) {
        throw new Error(`remote workflow capability must stay disabled before sandbox pilot: ${capabilityId}`);
      }
      ["workflowId", "artifactId", "artifactVersion"].forEach((field) => {
        if (!normalizeText(capability[field])) {
          throw new Error(`remote workflow capability metadata is missing: ${capabilityId}`);
        }
      });
      const artifactId = normalizeText(capability.artifactId);
      const artifactVersion = normalizeText(capability.artifactVersion);
      const artifact = workflowArtifacts?.[artifactId];
      if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
        throw new Error(`remote workflow capability artifact is not registered: ${capabilityId}`);
      }
      const registeredVersion = normalizeText(artifact.artifactVersion || artifact.version);
      if (registeredVersion !== artifactVersion) {
        throw new Error(`remote workflow capability artifact version is not pinned: ${capabilityId}`);
      }
    }

    function isWorkflowPilotAllowed(capability, workflowPilot) {
      if (workflowPilot?.enabled !== true || workflowPilot.killSwitchEnabled || capability?.pilot !== true) {
        return false;
      }
      const activeLane = normalizeText(readActiveLane()).toLowerCase();
      const capabilityLane = normalizeText(capability?.lane).toLowerCase();
      if (capabilityLane && capabilityLane !== "all" && capabilityLane !== activeLane) {
        return false;
      }
      return workflowPilot.lanes.includes(activeLane);
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
