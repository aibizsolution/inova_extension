(function initBrowserCapability(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LOCAL_PANEL_CSP_RULE_ID = 1001;
  const INOVA_MAIN_FRAME_FILTER = "||inova.incross.com/";
  const SETTINGS_STORAGE_KEY = namespace.productLane?.buildStorageKey?.(namespace.constants.storageKeys.settings)
    || namespace.constants.storageKeys.settings;
  const LOCAL_PANEL_CSP = [
    "default-src 'self'",
    "script-src 'self' https://sso.dawin.tv",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://inova.incross.com https://sso.dawin.tv",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self' http://127.0.0.1:5000 http://localhost:5000",
  ].join("; ");
  let localPanelCspRuleSyncInstalled = false;

  async function openUrl(url) {
    const nextUrl = namespace.session.normalizeText(url);
    if (!nextUrl) throw new Error("열 링크가 없어요.");
    const openedTab = await createBrowserTab(nextUrl);
    return {
      opened: true,
      tabId: Number(openedTab?.id) || 0,
      url: nextUrl,
    };
  }

  async function createBrowserTab(url) {
    const nextUrl = namespace.session.normalizeText(url);
    if (!nextUrl) {
      throw new Error("열 링크가 없어요.");
    }
    return await new Promise((resolve, reject) => {
      chrome.tabs.create({ url: nextUrl }, (tab) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          const message = namespace.session.normalizeText(runtimeError.message) || "탭을 열지 못했어요.";
          console.warn("[i-Nova Service Worker] tab open failed", message);
          reject(new Error(message));
          return;
        }
        if (!tab) {
          reject(new Error("탭을 열지 못했어요."));
          return;
        }
        resolve(tab);
      });
    });
  }

  async function syncLocalPanelCspRule(settings) {
    if (!chrome.declarativeNetRequest?.updateDynamicRules) {
      console.warn("[i-Nova Service Worker] declarativeNetRequest is unavailable; local panel CSP rule was not synced.");
      return {
        enabled: false,
        reason: "declarativeNetRequest-unavailable",
      };
    }
    const normalizedSettings = namespace.firebaseConfig?.meeting?.normalizeSettings?.(settings)
      || namespace.constants?.defaults?.settings
      || {};
    const shouldEnable = normalizedSettings.meetingWorkspaceTarget === "local";
    const update = {
      removeRuleIds: [LOCAL_PANEL_CSP_RULE_ID],
    };
    if (shouldEnable) {
      update.addRules = [buildLocalPanelCspRule()];
    }
    await chrome.declarativeNetRequest.updateDynamicRules(update);
    return {
      enabled: shouldEnable,
      ruleId: LOCAL_PANEL_CSP_RULE_ID,
    };
  }

  function installLocalPanelCspRuleSync() {
    if (localPanelCspRuleSyncInstalled) {
      return;
    }
    localPanelCspRuleSyncInstalled = true;
    syncLocalPanelCspRuleFromStorage("startup");
    chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
      if (areaName !== "local" || !changes?.[SETTINGS_STORAGE_KEY]) {
        return;
      }
      syncLocalPanelCspRuleFromStorage("settings-change");
    });
  }

  function syncLocalPanelCspRuleFromStorage(reason) {
    namespace.storage.getState()
      .then((state) => syncLocalPanelCspRule(state.settings))
      .catch((error) => {
        console.warn("[i-Nova Service Worker] local panel CSP rule sync failed", {
          message: error instanceof Error ? error.message : String(error || ""),
          reason,
        });
      });
  }

  function buildLocalPanelCspRule() {
    return {
      id: LOCAL_PANEL_CSP_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          {
            header: "Content-Security-Policy",
            operation: "set",
            value: LOCAL_PANEL_CSP,
          },
        ],
      },
      condition: {
        resourceTypes: ["main_frame"],
        urlFilter: INOVA_MAIN_FRAME_FILTER,
      },
    };
  }

  namespace.browserCapability = {
    installLocalPanelCspRuleSync,
    openUrl,
    syncLocalPanelCspRule,
  };
})(globalThis);
