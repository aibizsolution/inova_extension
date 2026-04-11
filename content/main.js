(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const state = namespace.panelStateFactory.createState();
  const compositionFactory = namespace.productLane?.isV2Lane?.()
    ? namespace.panelV2CompositionController
    : namespace.panelCompositionController;
  const panelCompositionController = compositionFactory.create(state);
  panelCompositionController.bootstrap().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));
})(globalThis);
