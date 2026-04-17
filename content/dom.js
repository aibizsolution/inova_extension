(function initContentDom(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { selectors } = namespace.constants;
  const TOKEN_ESTIMATE_VERSION = "dom-estimate-v1";
  let pendingScrollId = "";
  let pendingRetryTimer = 0;

  function getSessionTitle() {
    const heading = document.querySelector(selectors.mainHeading);
    return namespace.session.normalizeText(heading?.textContent || document.title || "현재 세션");
  }

  function collectUserMessages(sessionId) {
    return buildBookmarkRecords(sessionId, collectConversationMessages());
  }

  function collectConversationSnapshot(sessionId) {
    const messages = collectConversationMessages();
    const items = buildBookmarkRecords(sessionId, messages);
    return {
      conversation: buildConversationState(messages),
      items,
      tokenEstimate: summarizeTokenEstimate(messages),
      visibleMessageId: namespace.session.normalizeText(getVisibleMessageId(items)),
    };
  }

  function collectConversationMessages() {
    return getMessageArticles()
      .map((element, index) => buildConversationMessage(element, index))
      .filter(Boolean);
  }

  function getMessageText(element, options = {}) {
    const role = namespace.session.normalizeText(options.role);
    const providerLabel = namespace.session.normalizeText(options.providerLabel);
    const textSelector = role === "assistant" ? selectors.assistantText : selectors.userText;
    const textNodes = Array.from(element.querySelectorAll(textSelector))
      .map((node) => namespace.session.normalizeText(node.textContent || ""))
      .filter(Boolean);

    const text = textNodes.length
      ? textNodes.join(" ")
      : namespace.session.normalizeText(element.innerText || element.textContent || "");

    return stripLeadingProviderLabel(text, providerLabel);
  }

  function getUserMessageSignature() {
    return collectConversationMessages()
      .filter((message) => message.role === "user")
      .map((message) => message.text)
      .filter(Boolean)
      .slice(0, 6)
      .join("||");
  }

  function getConversationState() {
    const messages = collectConversationMessages();
    const counts = countMessages(messages);
    return {
      hasChatLog: Boolean(getChatLogElement(false)),
      hasComposer: Boolean(document.querySelector(selectors.composer)),
      articleCount: messages.length,
      assistantCount: counts.assistant,
      messageCount: messages.length,
      userCount: counts.user,
    };
  }

  function buildConversationMessage(element, index) {
    const providerLabel = readAssistantProviderLabel(element);
    const role = detectMessageRole(element, providerLabel, index);
    if (role !== "user" && role !== "assistant") {
      return null;
    }
    const text = getMessageText(element, {
      providerLabel,
      role,
    });
    if (!text) {
      return null;
    }

    return {
      element,
      order: index + 1,
      providerLabel,
      role,
      text,
      tokenEstimate: estimateTokenCount(text),
    };
  }

  function buildBookmarkRecords(sessionId, messages) {
    const bookmarks = [];
    let pendingBookmark = null;

    messages.forEach((message) => {
      if (message.role === "user") {
        const bookmark = namespace.session.buildBookmarkRecord({
          sessionId,
          order: bookmarks.length + 1,
          text: message.text,
          title: getSessionTitle(),
        });
        bookmark.tokenEstimate = {
          answer: 0,
          hasAnswer: false,
          question: message.tokenEstimate,
          total: message.tokenEstimate,
        };
        bookmark.messageOrder = message.order;
        message.element.dataset.inovaBookmarkId = bookmark.id;
        bookmarks.push(bookmark);
        pendingBookmark = bookmark;
        return;
      }

      if (message.role === "assistant" && pendingBookmark) {
        pendingBookmark.tokenEstimate = {
          answer: message.tokenEstimate,
          hasAnswer: true,
          question: pendingBookmark.tokenEstimate.question,
          total: pendingBookmark.tokenEstimate.question + message.tokenEstimate,
        };
        pendingBookmark = null;
      }
    });

    return bookmarks;
  }

  function buildConversationState(messages = collectConversationMessages()) {
    const counts = countMessages(messages);
    return {
      hasChatLog: Boolean(getChatLogElement(false)),
      hasComposer: Boolean(document.querySelector(selectors.composer)),
      articleCount: messages.length,
      assistantCount: counts.assistant,
      messageCount: messages.length,
      userCount: counts.user,
    };
  }

  function summarizeTokenEstimate(messages = collectConversationMessages()) {
    const summary = {
      answer: 0,
      basis: TOKEN_ESTIMATE_VERSION,
      messageCount: 0,
      question: 0,
      total: 0,
      visibleMessageCount: 0,
    };

    messages.forEach((message) => {
      const tokenCount = Math.max(0, Number(message?.tokenEstimate) || 0);
      if (message.role === "user") {
        summary.question += tokenCount;
      } else if (message.role === "assistant") {
        summary.answer += tokenCount;
      }
      summary.messageCount += 1;
      summary.visibleMessageCount += 1;
    });

    summary.total = summary.question + summary.answer;
    return summary;
  }

  function observeMessages(onChange) {
    const target = getChatLogElement() || document.body;
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(hasMessageChange)) {
        onChange();
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return observer;
  }

  function hasMessageChange(mutation) {
    const addedNodeMatch = Array.from(mutation.addedNodes || []).some((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }

      return Boolean(
        node.matches?.(selectors.messageArticle) ||
        node.querySelector?.(selectors.messageArticle) ||
        node.matches?.(selectors.userMessage) ||
        node.querySelector?.(selectors.userMessage) ||
        node.closest?.(selectors.userMessage)
      );
    });

    if (addedNodeMatch) {
      return true;
    }

    if (!(mutation.target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(
      mutation.target.matches?.(selectors.messageArticle) ||
      mutation.target.closest?.(selectors.messageArticle) ||
      mutation.target.querySelector?.(selectors.messageArticle) ||
      mutation.target.matches?.(selectors.userMessage) ||
      mutation.target.closest?.(selectors.userMessage) ||
      mutation.target.querySelector?.(selectors.userMessage)
    );
  }

  function getMessageElement(messageId) {
    return document.querySelector(`[data-inova-bookmark-id="${CSS.escape(messageId)}"]`);
  }

  function scrollToMessage(messageId, options = {}) {
    const element = getMessageElement(messageId);
    if (!element) {
      return false;
    }

    const block = options.block || "start";
    const behavior = options.behavior || "auto";
    pendingScrollId = messageId;
    global.clearTimeout(pendingRetryTimer);
    jumpToElementNow(element, block, behavior);
    pendingRetryTimer = global.setTimeout(() => {
      if (pendingScrollId !== messageId) return;
      const nextElement = getMessageElement(messageId) || element;
      if (!needsScrollCorrection(nextElement, block)) return;
      jumpToElementNow(nextElement, block, behavior);
    }, behavior === "smooth" ? 180 : 80);
    return true;
  }

  function jumpToElementNow(element, block, behavior) {
    const container = getScrollContainer(element);
    const offset = 18;

    if (!container) {
      const nextTop = Math.max(0, global.scrollY + element.getBoundingClientRect().top - offset);
      setScrollPosition(document.scrollingElement, nextTop, behavior);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const baseTop = container.scrollTop + (elementRect.top - containerRect.top);
    const targetTop =
      block === "center"
        ? baseTop - Math.max(0, (container.clientHeight - elementRect.height) / 2)
        : baseTop - offset;

    setScrollPosition(container, Math.max(0, targetTop), behavior);
  }

  function getScrollContainer(element) {
    let current = element.parentElement;
    while (current) {
      if (isScrollableContainer(current)) return current;
      current = current.parentElement;
    }

    const preferred = document.querySelector(selectors.chatScroller) || document.querySelector(selectors.chatLog);
    if (preferred instanceof HTMLElement && isScrollableContainer(preferred)) return preferred;

    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  }

  function isScrollableContainer(element) {
    const style = global.getComputedStyle(element);
    const overflowY = style.overflowY;
    return (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && element.scrollHeight > element.clientHeight + 4;
  }

  function setScrollPosition(container, nextTop, behavior) {
    const scrollBehavior = behavior === "smooth" ? "smooth" : "auto";
    if (container === document.scrollingElement) {
      global.scrollTo({ top: nextTop, behavior: scrollBehavior });
      return;
    }

    if (container?.scrollTo) {
      container.scrollTo({ top: nextTop, behavior: scrollBehavior });
      return;
    }

    if (container) container.scrollTop = nextTop;
  }

  function needsScrollCorrection(element, block) {
    const container = getScrollContainer(element);
    const offset = 18;
    if (!container) {
      const top = element.getBoundingClientRect().top;
      const target = block === "center" ? global.innerHeight / 2 : offset;
      return Math.abs(top - target) > 28;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const currentTop = elementRect.top - containerRect.top;
    const targetTop = block === "center" ? Math.max(0, (container.clientHeight - elementRect.height) / 2) : offset;
    return Math.abs(currentTop - targetTop) > 28;
  }

  function setCurrentMessage(messageId) {
    return messageId;
  }

  function getVisibleMessageId(bookmarks) {
    const candidates = bookmarks
      .map((bookmark) => ({
        id: bookmark.id,
        rect: getMessageElement(bookmark.id)?.getBoundingClientRect(),
      }))
      .filter((entry) => entry.rect);

    if (!candidates.length) {
      return "";
    }

    const preferred = candidates.find((entry) => entry.rect.top >= 80 && entry.rect.top <= window.innerHeight * 0.45);
    if (preferred) {
      return preferred.id;
    }

    const nearest = candidates.reduce((best, current) => {
      const bestDistance = Math.abs(best.rect.top - 160);
      const currentDistance = Math.abs(current.rect.top - 160);
      return currentDistance < bestDistance ? current : best;
    });

    return nearest.id;
  }

  function getChatLogElement(fallbackToBody = true) {
    return document.querySelector(selectors.chatMessageLog)
      || document.querySelector(selectors.chatLog)
      || document.querySelector(selectors.chatScroller)
      || (fallbackToBody ? document.body : null);
  }

  function getMessageArticles() {
    const root = getChatLogElement();
    const articles = root
      ? Array.from(root.querySelectorAll(selectors.messageArticle))
      : Array.from(document.querySelectorAll(selectors.messageArticle));
    return articles.filter((element) => namespace.session.normalizeText(element.innerText || element.textContent || ""));
  }

  function detectMessageRole(element, providerLabel, index) {
    if (matchesSelector(element, selectors.userMessage) || Boolean(element.querySelector(selectors.userMessage))) {
      return "user";
    }
    if (matchesSelector(element, selectors.assistantMessage) || Boolean(element.querySelector(selectors.assistantMessage))) {
      return "assistant";
    }
    if (isAssistantProviderLabel(providerLabel)) {
      return "assistant";
    }

    return index % 2 === 0 ? "user" : "assistant";
  }

  function readAssistantProviderLabel(element) {
    const label = namespace.session.normalizeText(element.firstElementChild?.getAttribute("aria-label"));
    return isAssistantProviderLabel(label) ? label : "";
  }

  function isAssistantProviderLabel(label) {
    const normalized = namespace.session.normalizeText(label);
    if (!normalized || !normalized.includes(":")) {
      return false;
    }
    return /^(Anthropic|Google|OpenAI|Microsoft|Meta|Mistral|Perplexity|xAI|Amazon|Cohere|AI21|Naver|Kakao)\s*:/i.test(normalized)
      || /^[A-Za-z][A-Za-z0-9 ._-]{1,40}\s*:\s*[A-Za-z0-9가-힣]/.test(normalized);
  }

  function stripLeadingProviderLabel(text, providerLabel) {
    const normalizedText = namespace.session.normalizeText(text);
    const normalizedLabel = namespace.session.normalizeText(providerLabel);
    if (!normalizedLabel || !normalizedText.startsWith(normalizedLabel)) {
      return normalizedText;
    }
    return namespace.session.normalizeText(normalizedText.slice(normalizedLabel.length));
  }

  function countMessages(messages) {
    return messages.reduce((counts, message) => {
      if (message.role === "user") {
        counts.user += 1;
      } else if (message.role === "assistant") {
        counts.assistant += 1;
      }
      return counts;
    }, { assistant: 0, user: 0 });
  }

  function estimateTokenCount(text) {
    const normalized = namespace.session.normalizeText(text);
    if (!normalized) {
      return 0;
    }
    const koreanChars = (normalized.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g) || []).length;
    const latinTokenEstimate = (normalized.match(/[A-Za-z0-9_]+/g) || [])
      .reduce((total, token) => total + Math.max(1, Math.ceil(token.length / 4)), 0);
    const remainingChars = normalized
      .replace(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g, "")
      .replace(/[A-Za-z0-9_]+/g, "")
      .replace(/\s+/g, "")
      .length;
    return Math.max(1, Math.ceil((koreanChars * 0.8) + latinTokenEstimate + (remainingChars * 0.55)));
  }

  function matchesSelector(element, selector) {
    return Boolean(namespace.session.normalizeText(selector) && element.matches?.(selector));
  }

  namespace.contentDom = {
    collectConversationMessages,
    collectConversationSnapshot,
    collectUserMessages,
    estimateTokenCount,
    getConversationState,
    getSessionTitle,
    getUserMessageSignature,
    summarizeTokenEstimate,
    getVisibleMessageId,
    observeMessages,
    scrollToMessage,
    setCurrentMessage,
  };
})(globalThis);
