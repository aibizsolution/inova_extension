(() => {
const namespace = globalThis.InovaBookmarks || {};

globalThis.invokeHostedPanelRequest = async function invokeHostedPanelRequest(request) {
  if (typeof namespace.panelRuntimeCapabilityRouter?.handle === "function") {
    return namespace.panelRuntimeCapabilityRouter.handle(request);
  }
  throw new Error("hosted panel runtime capability router를 찾지 못했어요.");
};
})();
