(function initPanelBookmarkController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const render = typeof deps.render === "function" ? deps.render : () => {};

    function buildToolState() {
      const items = getFilteredBookmarks();
      return {
        activeId: state.activeId,
        count: Array.isArray(state.bookmarks) ? state.bookmarks.length : 0,
        emptyText: buildEmptyText(),
        items,
        metaText: state.queries.bookmarks ? `검색 결과 ${items.length}개` : buildStatusText(),
        query: state.queries.bookmarks,
      };
    }

    async function copyBookmarkText(bookmarkId) {
      const bookmark = state.bookmarks.find((entry) => entry.id === bookmarkId);
      if (!bookmark?.text) {
        return false;
      }
      try {
        await global.navigator.clipboard.writeText(bookmark.text);
        return true;
      } catch (error) {
        console.error("[i-Nova Bookmarks] copy failed", error);
        return false;
      }
    }

    function jumpToBookmark(bookmarkId) {
      state.activeId = bookmarkId;
      namespace.contentPanel.setActiveBookmark(bookmarkId);
      namespace.contentPanel.focusBookmark(bookmarkId);
      namespace.contentDom.scrollToMessage(bookmarkId, { behavior: "smooth", block: "start" });
    }

    function submitQuery(value) {
      state.queries.bookmarks = value || "";
      render();
      return true;
    }

    function updateQuery(value) {
      state.queries.bookmarks = value || "";
      render();
      return true;
    }

    return {
      buildToolState,
      copyBookmarkText,
      jumpToBookmark,
      submitQuery,
      updateQuery,
    };

    function buildEmptyText() {
      return state.queries.bookmarks
        ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요."
        : !state.settings.autoBookmark
            ? "팝업에서 대화 자동 모으기를 켜면 대화 탭을 사용할 수 있어요."
            : state.awaitingRouteMessages
                ? "이 대화의 흐름을 불러오는 중이에요."
                : "아직 대화가 없어요.";
    }

    function buildStatusText() {
      return state.lastError
        ? "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요."
        : !state.settings.autoBookmark
            ? "대화 자동 모으기가 꺼져 있어요."
            : state.awaitingRouteMessages
                ? "대화를 불러오는 중"
                : !state.bookmarks.length
                    ? "아직 대화가 없어요"
                    : "";
    }

    function getFilteredBookmarks() {
      const query = namespace.session.normalizeText(state.queries.bookmarks).toLowerCase();
      return query ? state.bookmarks.filter((bookmark) => bookmark.normalizedText.includes(query)) : state.bookmarks;
    }
  }

  namespace.panelBookmarkController = { create };
})(globalThis);
