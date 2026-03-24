(function initConstants(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  namespace.constants = {
    storageKeys: {
      settings: "settings",
      pausedSessions: "pausedSessions",
      uiPreferences: "uiPreferences",
    },
    defaults: {
      settings: {
        enabled: true,
        autoBookmark: true,
      },
      pausedSessions: {},
      uiPreferences: {
        handleRatios: {
          wide: 0.38,
          compact: 0.46,
        },
      },
    },
    selectors: {
      userMessage: ".chat-message--user",
      userText: ".chat-message__text",
      chatLog: '[aria-label="채팅 기록"]',
      chatScroller: "main.chat-history__content, .chat-history__content, .chat-history",
      mainHeading: "h1",
      messageItem: "article",
      composer: '[role="textbox"]',
    },
    limits: {
      queryPreviewLength: 120,
    },
  };
})(globalThis);
