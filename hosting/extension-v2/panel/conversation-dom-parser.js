(function initConversationDomParser(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const TOKEN_ESTIMATE_VERSION = "dom-estimate-v1";
  const PROVIDER_LABEL_PATTERN = /\b(Anthropic|Google|OpenAI|Microsoft|Meta|Mistral|Perplexity|xAI|Amazon|Cohere|AI21|Naver|Kakao)\s*:\s*[^\n]{2,100}/i;

  function parse(snapshot) {
    const normalizedSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
    const sessionId = normalizeText(normalizedSnapshot.sessionId);
    const sessionTitle = normalizeText(normalizedSnapshot.sessionTitle)
      || namespace.session?.formatSessionLabel?.(sessionId)
      || "현재 세션";
    const articles = Array.isArray(normalizedSnapshot.articles)
      ? normalizedSnapshot.articles.map((article, index) => normalizeArticle(article, index, sessionId)).filter(Boolean)
      : [];
    const messages = articles.map((article, index) => normalizeMessage(article, index)).filter(Boolean);
    const items = buildBookmarkItems(messages, sessionTitle);
    return {
      conversation: buildConversationState(normalizedSnapshot.conversation, messages, articles),
      items,
      sessionId,
      sessionTitle,
      source: "hosted-dom-parser",
      tokenEstimate: summarizeTokenEstimate(messages, normalizedSnapshot.modelCandidates),
      userMessages: buildUserMessages(messages),
      visibleMessageId: normalizeText(normalizedSnapshot.visibleMessageId),
    };
  }

  function normalizeArticle(rawArticle, index, sessionId) {
    const article = rawArticle && typeof rawArticle === "object" ? rawArticle : {};
    const text = normalizeText(article.text);
    if (!text) {
      return null;
    }
    const order = Math.max(1, Number(article.order) || index + 1);
    return {
      firstChildAriaLabel: normalizeText(article.firstChildAriaLabel),
      id: normalizeText(article.id) || buildFallbackMessageId(sessionId, order, text),
      order,
      providerLabel: readProviderLabel(article.providerLabel, article.firstChildAriaLabel),
      roleHint: normalizeText(article.roleHint).toLowerCase(),
      text,
    };
  }

  function normalizeMessage(article, index) {
    const providerLabel = article.providerLabel || readProviderLabel(article.firstChildAriaLabel);
    const role = detectRole(article, providerLabel, index);
    if (role !== "user" && role !== "assistant") {
      return null;
    }
    const text = stripLeadingProviderLabel(article.text, providerLabel);
    if (!text) {
      return null;
    }
    return {
      id: article.id,
      order: article.order,
      providerLabel,
      role,
      text,
      tokenEstimate: estimateTokenCount(text),
    };
  }

  function detectRole(article, providerLabel, index) {
    if (isProviderLabel(providerLabel) || isProviderLabel(article.firstChildAriaLabel)) {
      return "assistant";
    }
    if (article.roleHint === "user" || article.roleHint === "assistant") {
      return article.roleHint;
    }
    return index % 2 === 0 ? "user" : "assistant";
  }

  function buildBookmarkItems(messages, sessionTitle) {
    const items = [];
    let pendingItem = null;
    messages.forEach((message) => {
      if (message.role === "user") {
        const item = {
          createdAt: new Date().toISOString(),
          id: message.id,
          messageOrder: message.order,
          normalizedText: normalizeText(message.text).toLowerCase(),
          order: items.length + 1,
          text: normalizeText(message.text),
          title: sessionTitle,
          tokenEstimate: {
            answer: 0,
            hasAnswer: false,
            question: message.tokenEstimate,
            total: message.tokenEstimate,
          },
        };
        items.push(item);
        pendingItem = item;
        return;
      }
      if (message.role === "assistant" && pendingItem) {
        pendingItem.tokenEstimate = {
          answer: message.tokenEstimate,
          hasAnswer: true,
          question: pendingItem.tokenEstimate.question,
          total: pendingItem.tokenEstimate.question + message.tokenEstimate,
        };
        pendingItem = null;
      }
    });
    return items;
  }

  function buildUserMessages(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter((message) => message?.role === "user")
      .map((message, index) => {
        const text = normalizeText(message.text);
        return {
          charLen: text.length,
          id: normalizeText(message.id),
          messageOrder: Math.max(1, Number(message.order) || index + 1),
          text,
          tokenEstimate: Math.max(0, Number(message.tokenEstimate) || 0),
          turnIndex: index + 1,
        };
      })
      .filter((message) => message.text);
  }

  function buildConversationState(rawConversation, messages, articles) {
    const conversation = rawConversation && typeof rawConversation === "object" ? rawConversation : {};
    const counts = countMessages(messages);
    return {
      articleCount: readNonNegativeNumber(conversation.articleCount, articles.length),
      assistantCount: readNonNegativeNumber(conversation.assistantCount, counts.assistant),
      hasChatLog: Boolean(conversation.hasChatLog || articles.length),
      hasComposer: Boolean(conversation.hasComposer),
      messageCount: readNonNegativeNumber(conversation.messageCount, messages.length),
      userCount: readNonNegativeNumber(conversation.userCount, counts.user),
    };
  }

  function summarizeTokenEstimate(messages, modelCandidates) {
    const summary = {
      answer: 0,
      basis: TOKEN_ESTIMATE_VERSION,
      messageCount: 0,
      modelLabel: readSelectedModelLabel(modelCandidates),
      modelLabelSource: "",
      question: 0,
      total: 0,
      visibleMessageCount: 0,
    };
    if (summary.modelLabel) {
      summary.modelLabelSource = "selected-model";
    }
    messages.forEach((message) => {
      const tokenCount = Math.max(0, Number(message.tokenEstimate) || 0);
      if (message.role === "user") {
        summary.question += tokenCount;
      } else if (message.role === "assistant") {
        summary.answer += tokenCount;
        if (!summary.modelLabel && message.providerLabel) {
          summary.modelLabel = message.providerLabel;
          summary.modelLabelSource = "latest-assistant";
        }
      }
      summary.messageCount += 1;
      summary.visibleMessageCount += 1;
    });
    summary.total = summary.question + summary.answer;
    return summary;
  }

  function readSelectedModelLabel(modelCandidates) {
    for (const candidate of Array.isArray(modelCandidates) ? modelCandidates : []) {
      const label = readProviderLabel(candidate?.label, candidate?.text, candidate?.ariaLabel, candidate?.title);
      if (label) {
        return label;
      }
    }
    return "";
  }

  function readProviderLabel(...values) {
    for (const value of values) {
      const normalized = normalizeText(value);
      const match = normalized.match(PROVIDER_LABEL_PATTERN);
      const label = normalizeText(match?.[0] || "");
      if (label && isProviderLabel(label)) {
        return label;
      }
    }
    return "";
  }

  function isProviderLabel(label) {
    const normalized = normalizeText(label);
    return Boolean(normalized && normalized.includes(":") && (
      /^(Anthropic|Google|OpenAI|Microsoft|Meta|Mistral|Perplexity|xAI|Amazon|Cohere|AI21|Naver|Kakao)\s*:/i.test(normalized)
      || /^[A-Za-z][A-Za-z0-9 ._-]{1,40}\s*:\s*[A-Za-z0-9가-힣]/.test(normalized)
    ));
  }

  function stripLeadingProviderLabel(text, providerLabel) {
    const normalizedText = normalizeText(text);
    const normalizedLabel = normalizeText(providerLabel);
    if (!normalizedLabel || !normalizedText.startsWith(normalizedLabel)) {
      return normalizedText;
    }
    return normalizeText(normalizedText.slice(normalizedLabel.length));
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
    const normalized = normalizeText(text);
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

  function readNonNegativeNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      return Math.max(0, Number(fallback) || 0);
    }
    return Math.floor(number);
  }

  function buildFallbackMessageId(sessionId, order, text) {
    if (typeof namespace.session?.buildMessageId === "function") {
      return namespace.session.buildMessageId(sessionId || "current", order, text);
    }
    return [sessionId || "current", order, hashText(text)].join(":");
  }

  function hashText(text) {
    let hash = 0;
    for (const char of normalizeText(text)) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash.toString(36);
  }

  function normalizeText(value) {
    return typeof namespace.session?.normalizeText === "function"
      ? namespace.session.normalizeText(value)
      : String(value ?? "").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
  }

  namespace.conversationDomParser = {
    parse,
  };
})(globalThis);
