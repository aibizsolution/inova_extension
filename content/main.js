(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const state = namespace.panelV2CompositionController.createState();
  const panelCompositionController = namespace.panelV2CompositionController.create(state);
  panelCompositionController.bootstrap().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));
})(globalThis);
