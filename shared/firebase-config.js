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
    webApp: {
      appId: "1:1027279095019:web:755f1f1a02cbae0d262aae",
      authDomain: "browser-extension-main.firebaseapp.com",
      apiKey: "AIzaSyBIB5UZy3iyivrnhKfcPKQtJiUS9V2jzeg",
      displayName: "browser-extension-chrome",
      messagingSenderId: "1027279095019",
      projectId: "browser-extension-main",
      projectNumber: "1027279095019",
      storageBucket: "browser-extension-main.firebasestorage.app",
    },
    getWebConfig() {
      return {
        apiKey: this.webApp.apiKey,
        appId: this.webApp.appId,
        authDomain: this.webApp.authDomain,
        messagingSenderId: this.webApp.messagingSenderId,
        projectId: this.webApp.projectId,
        storageBucket: this.webApp.storageBucket,
      };
    },
  };
})(globalThis);
