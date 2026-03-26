(function initFirebaseConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  namespace.firebaseConfig = {
    project: {
      displayName: "browser-extension",
      projectId: "browser-extension-main",
      region: "asia-northeast3",
    },
    functions: {
      region: "asia-northeast3",
      baseUrl: "https://asia-northeast3-browser-extension-main.cloudfunctions.net",
      loadInovaPromptLibraryUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/loadInovaPromptLibrary",
      listPromptStoreEntriesUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/listPromptStoreEntries",
      peekInovaPromptLibraryUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/peekInovaPromptLibrary",
      reviewInovaPromptUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/reviewInovaPrompt",
      publishPromptToStoreUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/publishPromptToStore",
      unpublishPromptFromStoreUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/unpublishPromptFromStore",
      importPromptStoreEntryUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/importPromptStoreEntry",
      togglePromptStoreLikeUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/togglePromptStoreLike",
      recordPromptStoreViewUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/recordPromptStoreView",
      syncInovaPromptLibraryUrl:
        "https://asia-northeast3-browser-extension-main.cloudfunctions.net/syncInovaPromptLibrary",
    },
    hosting: {
      baseUrl: "https://browser-extension-main.web.app/extension",
      latestReleaseUrl: "https://browser-extension-main.web.app/extension/releases/latest.json",
      releaseHistoryUrl: "https://browser-extension-main.web.app/extension/releases/history.json",
    },
  };
})(globalThis);
