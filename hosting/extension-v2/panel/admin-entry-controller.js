(function initAdminEntryController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText } = namespace.panelUtils;
  const ADMIN_ACCESS_CHECK_CAPABILITY_ID = "admin.access.check";
  const ADMIN_LAUNCH_ISSUE_CAPABILITY_ID = "admin.launch.issue-function";

  function create(options = {}) {
    const browserCapabilities = options.browserCapabilities || {};
    const publishToast = typeof options.publishToast === "function" ? options.publishToast : () => {};
    const scheduleRender = typeof options.scheduleRender === "function" ? options.scheduleRender : () => {};
    const traceAdmin = typeof options.traceAdmin === "function" ? options.traceAdmin : () => {};
    const state = {
      accessCheckedKey: "",
      accessPendingKey: "",
      accessPromise: null,
      error: "",
      lastCapabilityKey: "",
      opening: false,
      providerIdentity: null,
      role: "",
      status: "unknown",
    };

    function syncPanelState(panelState = {}, capabilityIds = []) {
      const providerIdentity = normalizeProviderIdentity(panelState.providerIdentity);
      state.providerIdentity = providerIdentity;
      const capabilitySet = new Set((Array.isArray(capabilityIds) ? capabilityIds : []).map(normalizeText));
      const nextCapabilityKey = serializeCapabilityState(capabilitySet);
      if (state.lastCapabilityKey !== nextCapabilityKey) {
        state.lastCapabilityKey = nextCapabilityKey;
        state.accessCheckedKey = "";
        if (state.status !== "checking") {
          state.status = "unknown";
          state.error = "";
          state.role = "";
        }
      }
      if (!providerIdentity.providerUserKey || !hasRequiredCapabilities(capabilitySet)) {
        if (state.status !== "checking") {
          state.status = "unknown";
          state.error = "";
          state.role = "";
        }
        state.accessPendingKey = "";
        return;
      }
      void ensureAccessChecked(providerIdentity, capabilitySet);
    }

    function shouldShowEntry() {
      return state.status === "allowed" && canOpenConsole();
    }

    function buildToolItem() {
      return {
        id: "admin",
        label: "관리",
      };
    }

    async function handleOpen() {
      if (!shouldShowEntry() || state.opening) {
        return false;
      }
      state.opening = true;
      scheduleRender();
      try {
        const providerIdentity = normalizeProviderIdentity(state.providerIdentity);
        const launch = await browserCapabilities.invokeCapability(ADMIN_LAUNCH_ISSUE_CAPABILITY_ID, {
          providerIdentity,
        });
        const launchToken = normalizeText(launch?.launchToken);
        if (!launchToken) {
          throw new Error("관리 콘솔 열기 토큰이 비어 있어요.");
        }
        await browserCapabilities.openAdminConsole({ launchToken }, providerIdentity);
        traceAdmin("admin.open.success", {
          providerUserKey: providerIdentity.providerUserKey,
          role: state.role,
        });
        return true;
      } catch (error) {
        const message = readErrorMessage(error, "관리 콘솔을 열지 못했어요.");
        state.error = message;
        publishToast({
          contextId: "admin.console.open",
          message,
          source: "admin",
          tone: "error",
          ttlMs: 3600,
        });
        traceAdmin("admin.open.error", { error: message });
        return false;
      } finally {
        state.opening = false;
        scheduleRender();
      }
    }

    function canOpenConsole() {
      return typeof browserCapabilities.openAdminConsole === "function"
        && typeof browserCapabilities.invokeCapability === "function";
    }

    function hasRequiredCapabilities(capabilitySet) {
      return capabilitySet.has(ADMIN_ACCESS_CHECK_CAPABILITY_ID)
        && capabilitySet.has(ADMIN_LAUNCH_ISSUE_CAPABILITY_ID);
    }

    async function ensureAccessChecked(providerIdentity, capabilitySet) {
      if (!hasRequiredCapabilities(capabilitySet) || typeof browserCapabilities.invokeCapability !== "function") {
        return;
      }
      const accessKey = serializeAccessKey(providerIdentity, capabilitySet);
      if (state.accessCheckedKey === accessKey) {
        return state.accessPromise;
      }
      if (state.accessPromise && state.accessPendingKey === accessKey) {
        return state.accessPromise;
      }
      state.accessPendingKey = accessKey;
      state.status = "checking";
      state.error = "";
      state.accessPromise = browserCapabilities.invokeCapability(ADMIN_ACCESS_CHECK_CAPABILITY_ID, {
        providerIdentity,
      })
        .then((access) => {
          if (state.accessPendingKey !== accessKey) {
            return;
          }
          state.accessCheckedKey = accessKey;
          state.role = normalizeText(access?.role);
          state.status = access?.allowed === true ? "allowed" : "denied";
          traceAdmin("admin.access.checked", {
            allowed: state.status === "allowed",
            providerUserKey: providerIdentity.providerUserKey,
            reason: normalizeText(access?.reason),
          });
        })
        .catch((error) => {
          if (state.accessPendingKey !== accessKey) {
            return;
          }
          state.accessCheckedKey = accessKey;
          state.error = readErrorMessage(error, "관리자 권한 확인에 실패했어요.");
          state.status = "error";
          traceAdmin("admin.access.error", {
            error: state.error,
            providerUserKey: providerIdentity.providerUserKey,
          });
        })
        .finally(() => {
          if (state.accessPendingKey === accessKey) {
            state.accessPendingKey = "";
            state.accessPromise = null;
            scheduleRender();
          }
        });
      scheduleRender();
      return state.accessPromise;
    }

    function buildViewState() {
      return {
        error: state.error,
        opening: state.opening,
        role: state.role,
        status: state.status,
      };
    }

    return {
      buildToolItem,
      buildViewState,
      handleOpen,
      shouldShowEntry,
      syncPanelState,
    };
  }

  function serializeAccessKey(providerIdentity, capabilitySet) {
    return `${providerIdentity.providerUserKey}:${providerIdentity.email}:${serializeCapabilityState(capabilitySet)}`;
  }

  function serializeCapabilityState(capabilitySet) {
    return [
      capabilitySet.has(ADMIN_ACCESS_CHECK_CAPABILITY_ID) ? "check" : "",
      capabilitySet.has(ADMIN_LAUNCH_ISSUE_CAPABILITY_ID) ? "launch" : "",
    ].filter(Boolean).join("+");
  }

  function normalizeProviderIdentity(providerIdentity) {
    const input = providerIdentity && typeof providerIdentity === "object" ? providerIdentity : {};
    const numericUserId = input.numericUserId;
    return {
      displayName: normalizeText(input.displayName),
      email: normalizeText(input.email).toLowerCase(),
      numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
        ? null
        : Number.isFinite(Number(numericUserId))
          ? Number(numericUserId)
          : null,
      provider: normalizeText(input.provider) || "inova",
      providerUserKey: normalizeText(input.providerUserKey),
    };
  }

  function readErrorMessage(error, fallbackMessage) {
    return normalizeText(error instanceof Error ? error.message : error) || normalizeText(fallbackMessage);
  }

  namespace.adminEntryController = {
    create,
  };
})(globalThis);
