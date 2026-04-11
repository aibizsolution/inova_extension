(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const state = namespace.panelStateFactory.createState();
  const panelCompositionController = namespace.panelCompositionController.create(state);
  panelCompositionController.bootstrap().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));
})(globalThis);
