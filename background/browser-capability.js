(function initBrowserCapability(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

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

  namespace.browserCapability = {
    openUrl,
  };
})(globalThis);
