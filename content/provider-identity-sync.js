(function initProviderIdentitySync(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  namespace.providerIdentitySync = {
    create(state, deps = {}) {
      const render = typeof deps.render === "function" ? deps.render : () => {};
      const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
      const isExtensionContextInvalidatedError = typeof deps.isExtensionContextInvalidatedError === "function"
        ? deps.isExtensionContextInvalidatedError
        : () => false;

      async function syncToStorage(reason = "runtime", providedIdentity = null) {
        const providerIdentity = namespace.cloudSync.normalizeProviderIdentity(
          providedIdentity || namespace.providerIdentity.getCurrent()
        );
        if (!providerIdentity.available || !providerIdentity.providerUserKey) {
          return false;
        }
        try {
          const currentCloudSync = await namespace.storage.getCloudSyncState();
          const currentIdentity = namespace.cloudSync.normalizeProviderIdentity(currentCloudSync?.providerIdentity);
          if (
            currentIdentity.providerUserKey === providerIdentity.providerUserKey
            && currentIdentity.email === providerIdentity.email
            && currentIdentity.displayName === providerIdentity.displayName
            && currentIdentity.numericUserId === providerIdentity.numericUserId
          ) {
            return false;
          }
          const nextCloudSync = namespace.cloudSync.mergeCloudSyncState(currentCloudSync, {
            providerIdentity: {
              ...currentIdentity,
              ...providerIdentity,
              available: true,
            },
          });
          state.cloudSync = nextCloudSync;
          await namespace.storage.setCloudSyncState(nextCloudSync);
          logPanelDebug("panel.identity.cached", {
            providerUserKey: namespace.session.normalizeText(providerIdentity.providerUserKey),
            reason: namespace.session.normalizeText(reason) || "runtime",
            scope: "panel-ui",
            tool: "panel",
          });
          render();
          return true;
        } catch (error) {
          if (isExtensionContextInvalidatedError(error)) {
            return false;
          }
          console.error("[i-Nova Bookmarks] provider identity cache failed", error);
          return false;
        }
      }

      function handleRuntimeMessage(message, sender, sendResponse) {
        const type = namespace.session.normalizeText(message?.type);
        if (type !== "inova-meeting:get-provider-identity") {
          return false;
        }
        Promise.resolve().then(async () => {
          const providerIdentity = namespace.cloudSync.normalizeProviderIdentity(
            namespace.providerIdentity.getCurrent()
          );
          await syncToStorage("runtime-message", providerIdentity);
          sendResponse({
            ok: true,
            providerIdentity,
            senderUrl: namespace.session.normalizeText(sender?.url),
          });
        }).catch((error) => {
          sendResponse({
            error: error instanceof Error ? error.message : String(error || "현재 i-Nova 사용자 정보를 읽지 못했어요."),
            ok: false,
          });
        });
        return true;
      }

      return {
        handleRuntimeMessage,
        syncToStorage,
      };
    },
  };
})(globalThis);
