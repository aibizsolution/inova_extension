(function initContentDom(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { selectors } = namespace.constants;
  let pendingScrollId = "";
  let pendingRetryTimer = 0;

  function getSessionTitle() {
    const heading = document.querySelector(selectors.mainHeading);
    return namespace.session.normalizeText(heading?.textContent || document.title || "현재 세션");
  }

  function collectUserMessages(sessionId) {
    const nodes = Array.from(document.querySelectorAll(selectors.userMessage));
    return nodes
      .map((element, index) => buildMessage(sessionId, index, element))
      .filter(Boolean);
  }

  function getUserMessageText(element) {
    const textNodes = Array.from(element.querySelectorAll(selectors.userText))
      .map((node) => namespace.session.normalizeText(node.textContent || ""))
      .filter(Boolean);

    if (textNodes.length) {
      return textNodes.join(" ");
    }

    return namespace.session.normalizeText(element.innerText || "");
  }

  function getUserMessageSignature() {
    return Array.from(document.querySelectorAll(selectors.userMessage))
      .map((element) => getUserMessageText(element))
      .filter(Boolean)
      .slice(0, 6)
      .join("||");
  }

  function getConversationState() {
    return {
      hasChatLog: Boolean(document.querySelector(selectors.chatLog)),
      hasComposer: Boolean(document.querySelector(selectors.composer)),
      articleCount: document.querySelectorAll(selectors.messageItem).length,
      userCount: document.querySelectorAll(selectors.userMessage).length,
    };
  }

  function buildMessage(sessionId, index, element) {
    const text = getUserMessageText(element);
    if (!text) {
      return null;
    }

    const bookmark = namespace.session.buildBookmarkRecord({
      sessionId,
      order: index + 1,
      text,
      title: getSessionTitle(),
    });

    element.dataset.inovaBookmarkId = bookmark.id;

    return bookmark;
  }

  function observeMessages(onChange) {
    const target = document.querySelector(selectors.chatLog) || document.body;
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

  namespace.contentDom = {
    collectUserMessages,
    getConversationState,
    getSessionTitle,
    getUserMessageSignature,
    getVisibleMessageId,
    observeMessages,
    scrollToMessage,
    setCurrentMessage,
  };
})(globalThis);
