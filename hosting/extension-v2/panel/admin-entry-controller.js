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
      launchExpiresAt: "",
      launchPendingKey: "",
      launchPromise: null,
      launchProviderKey: "",
      launchToken: "",
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
        clearPreparedLaunch();
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
        clearPreparedLaunch();
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
      const providerIdentity = normalizeProviderIdentity(state.providerIdentity);
      const preparedLaunchToken = hasFreshLaunchToken(providerIdentity) ? state.launchToken : "";
      const preparedWindow = preparedLaunchToken ? null : openBlankAdminWindow();
      if (preparedLaunchToken && openAdminUrl(preparedLaunchToken)) {
        clearPreparedLaunch();
        traceAdmin("admin.open.success", {
          mode: "web-window",
          providerUserKey: providerIdentity.providerUserKey,
          role: state.role,
        });
        return true;
      }
      state.opening = true;
      scheduleRender();
      try {
        const launchToken = await readLaunchTokenForOpen(providerIdentity);
        if (!launchToken) {
          throw new Error("관리 콘솔 열기 토큰이 비어 있어요.");
        }
        if (navigatePreparedAdminWindow(preparedWindow, launchToken) || openAdminUrl(launchToken)) {
          clearPreparedLaunch();
          traceAdmin("admin.open.success", {
            mode: "web-window",
            providerUserKey: providerIdentity.providerUserKey,
            role: state.role,
          });
          return true;
        }
        await browserCapabilities.openAdminConsole({ launchToken }, providerIdentity);
        clearPreparedLaunch();
        traceAdmin("admin.open.success", {
          mode: "runtime-broker",
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

    function buildAdminUrl(launchToken) {
      const token = normalizeText(launchToken);
      if (!token) {
        return "";
      }
      const url = new URL("/admin/index.html", global.location.origin);
      url.searchParams.set("launch", token);
      return url.toString();
    }

    function openAdminUrl(launchToken) {
      if (typeof global.open !== "function") {
        return false;
      }
      const adminUrl = buildAdminUrl(launchToken);
      if (!adminUrl) {
        return false;
      }
      const openedWindow = global.open(adminUrl, "_blank");
      return detachOpenedWindow(openedWindow);
    }

    function openBlankAdminWindow() {
      if (typeof global.open !== "function") {
        return null;
      }
      return global.open("about:blank", "_blank");
    }

    function navigatePreparedAdminWindow(openedWindow, launchToken) {
      if (!openedWindow || openedWindow.closed) {
        return false;
      }
      const adminUrl = buildAdminUrl(launchToken);
      if (!adminUrl) {
        return false;
      }
      openedWindow.location.href = adminUrl;
      return detachOpenedWindow(openedWindow);
    }

    function detachOpenedWindow(openedWindow) {
      if (!openedWindow) {
        return false;
      }
      try {
        openedWindow.opener = null;
      } catch (error) {
        traceAdmin("admin.open.detach.skip", {
          error: readErrorMessage(error, "opener detach skipped"),
        });
      }
      return true;
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
          if (state.status === "allowed") {
            void ensureLaunchPrepared(providerIdentity);
          } else {
            clearPreparedLaunch();
          }
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
          clearPreparedLaunch();
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

    function ensureLaunchPrepared(providerIdentity) {
      if (hasFreshLaunchToken(providerIdentity) || state.launchPromise) {
        return state.launchPromise || Promise.resolve(state.launchToken);
      }
      return requestLaunchToken(providerIdentity, "prefetch").catch((error) => {
        traceAdmin("admin.launch.prefetch.error", {
          error: readErrorMessage(error, "관리 콘솔 열기 토큰을 미리 준비하지 못했어요."),
          providerUserKey: providerIdentity.providerUserKey,
        });
        return "";
      });
    }

    async function readLaunchTokenForOpen(providerIdentity) {
      if (hasFreshLaunchToken(providerIdentity)) {
        traceAdmin("admin.launch.prefetch.hit", {
          providerUserKey: providerIdentity.providerUserKey,
        });
        return state.launchToken;
      }
      return requestLaunchToken(providerIdentity, "open");
    }

    function requestLaunchToken(providerIdentity, reason) {
      if (typeof browserCapabilities.invokeCapability !== "function") {
        return Promise.reject(new Error("관리 콘솔 열기 기능이 준비되지 않았어요."));
      }
      const launchKey = serializeProviderKey(providerIdentity);
      if (!launchKey) {
        return Promise.reject(new Error("관리 콘솔 열기에 필요한 사용자 정보가 없어요."));
      }
      if (state.launchPromise && state.launchPendingKey === launchKey) {
        return state.launchPromise;
      }
      state.launchPendingKey = launchKey;
      state.launchPromise = browserCapabilities.invokeCapability(ADMIN_LAUNCH_ISSUE_CAPABILITY_ID, {
        providerIdentity,
      }).then((launch) => {
        if (state.launchPendingKey !== launchKey) {
          return "";
        }
        const launchToken = normalizeText(launch?.launchToken);
        if (!launchToken) {
          throw new Error("관리 콘솔 열기 토큰이 비어 있어요.");
        }
        state.launchProviderKey = launchKey;
        state.launchToken = launchToken;
        state.launchExpiresAt = normalizeText(launch?.expiresAt);
        traceAdmin("admin.launch.prepared", {
          providerUserKey: providerIdentity.providerUserKey,
          reason: normalizeText(reason) || "manual",
        });
        return launchToken;
      }).finally(() => {
        if (state.launchPendingKey === launchKey) {
          state.launchPendingKey = "";
          state.launchPromise = null;
        }
      });
      return state.launchPromise;
    }

    function hasFreshLaunchToken(providerIdentity) {
      const expiresAtMs = Date.parse(normalizeText(state.launchExpiresAt));
      return Boolean(
        state.launchToken
        && state.launchProviderKey === serializeProviderKey(providerIdentity)
        && expiresAtMs > Date.now() + 30000
      );
    }

    function clearPreparedLaunch() {
      state.launchExpiresAt = "";
      state.launchPendingKey = "";
      state.launchPromise = null;
      state.launchProviderKey = "";
      state.launchToken = "";
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

  function serializeProviderKey(providerIdentity) {
    return `${providerIdentity.providerUserKey}:${providerIdentity.email}`;
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
