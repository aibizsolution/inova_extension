(function initConstants(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  namespace.constants = {
    storageKeys: {
      settings: "settings",
      pausedSessions: "pausedSessions",
      uiPreferences: "uiPreferences",
      promptLibrary: "promptLibrary",
      cloudSync: "cloudSync",
      releaseInfo: "releaseInfo",
    },
    defaults: {
      settings: {
        enabled: true,
        autoBookmark: true,
      },
      pausedSessions: {},
      promptLibrary: {
        version: 1,
        items: [],
      },
      cloudSync: {
        version: 1,
        status: "idle",
        providerIdentity: {
          provider: "inova",
          available: false,
          providerUserKey: "",
          email: "",
          displayName: "",
          numericUserId: null,
        },
        pending: null,
        lastSyncedAt: "",
        lastError: "",
        remote: {
          checkedAt: "",
          found: false,
          itemCount: 0,
          lastRevision: "",
          lastSyncedAt: "",
          providerUserKey: "",
          updatedAt: "",
          version: 1,
        },
      },
      releaseInfo: {
        version: 1,
        checkedAt: "",
        historyCheckedAt: "",
        error: "",
        latest: null,
        history: [],
      },
      uiPreferences: {
        activeTool: "bookmarks",
        activePromptTab: "library",
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
      composer:
        'textarea.chat-input__textarea, textarea[placeholder*="무엇이든 입력하고 대화하세요"], textarea, [role="textbox"], [contenteditable="true"]',
    },
    storeCategories: [
      { id: "all", label: "전체" },
      { id: "document", label: "문서 작성" },
      { id: "summary", label: "요약/정리" },
      { id: "analysis", label: "분석/리서치" },
      { id: "meeting", label: "회의/업무" },
      { id: "translation", label: "번역" },
      { id: "advertising", label: "광고/퍼포먼스" },
      { id: "marketing", label: "마케팅" },
      { id: "commerce", label: "커머스" },
      { id: "sales", label: "세일즈" },
      { id: "customer-success", label: "고객 성공/CS" },
      { id: "hr", label: "HR/피플" },
      { id: "finance", label: "재무/경영관리" },
      { id: "code", label: "코딩" },
      { id: "core-dev", label: "코어 개발" },
      { id: "language-specialists", label: "언어/프레임워크" },
      { id: "infrastructure", label: "인프라" },
      { id: "quality-security", label: "품질/보안" },
      { id: "data-ai", label: "데이터/AI" },
      { id: "developer-experience", label: "개발 경험" },
      { id: "specialized-domains", label: "전문 도메인" },
      { id: "business-product", label: "비즈니스/프로덕트" },
      { id: "meta-orchestration", label: "오케스트레이션" },
      { id: "research-analysis", label: "리서치/분석" },
      { id: "other", label: "기타" }
    ],
    limits: {
      queryPreviewLength: 120,
      releaseCheckIntervalMs: 21600000,
    },
  };
})(globalThis);
