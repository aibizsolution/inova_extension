(function initComposer(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const COMPOSER_FRAME_SELECTOR = [
    ".chat-input",
    ".chat-input__wrapper",
    ".chat-input__container",
    ".chat-input__inner",
    ".chat-input__box",
    "form",
  ].join(", ");
  const COMPOSER_SELECTOR_TIERS = [
    "textarea.chat-input__textarea",
    'textarea[placeholder*="무엇이든 입력하고 대화하세요"]',
    "textarea",
    '[role="textbox"]',
    '[contenteditable="true"]',
  ];
  const COMPOSER_FALLBACK_SELECTOR_TIERS = ["input[type=\"text\"]", '[contenteditable="true"]'];
  const AUTO_SEND_OBSERVE_MS = 1200;

  function getComposerElement() {
    for (const selector of COMPOSER_SELECTOR_TIERS) {
      const direct = findComposerCandidate(selector);
      if (direct) {
        return direct;
      }
    }

    for (const selector of COMPOSER_FALLBACK_SELECTOR_TIERS) {
      const fallback = findComposerCandidate(selector);
      if (fallback) {
        return fallback;
      }
    }

    return null;
  }

  function findComposerCandidate(selector) {
    const candidates = Array.from(document.querySelectorAll(selector));
    return (
      candidates
        .filter(isSupportedComposer)
        .filter((element) => !element.closest?.("#inova-bookmark-host, #inova-composer-review-host"))
        .filter(isVisible)
        .sort((left, right) => getComposerScore(right) - getComposerScore(left))[0] || null
    );
  }

  function isSupportedComposer(element) {
    if (!element) {
      return false;
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return !element.readOnly && !element.disabled;
    }

    return Boolean(element.isContentEditable);
  }

  function isVisible(element) {
    return Boolean(element?.isConnected && (element.offsetParent || element.getClientRects().length));
  }

  function getComposerScore(element) {
    const rect = element.getBoundingClientRect();
    const distanceFromBottom = Math.max(0, global.innerHeight - rect.bottom);
    const bottomHalfBonus = rect.bottom >= global.innerHeight * 0.52 ? 360 : 0;
    const formBonus = element.closest?.("form") ? 140 : 0;
    const textboxBonus = element.getAttribute?.("role") === "textbox" ? 80 : 0;
    const editableBonus = element.isContentEditable ? 110 : element instanceof HTMLTextAreaElement ? 140 : 40;
    const sizeBonus = Math.min(420, Math.max(0, rect.width - 220)) + Math.min(220, Math.max(0, rect.height - 24));
    return bottomHalfBonus + formBonus + textboxBonus + editableBonus + sizeBonus - distanceFromBottom;
  }

  function getComposerState() {
    const element = getComposerElement();
    return {
      available: Boolean(element),
      text: element ? readComposerText(element) : "",
    };
  }

  function getComposerAnchorElement() {
    const element = getComposerElement();
    return element ? findComposerAnchor(element) : null;
  }

  function applyPromptText(promptText, mode = "replace") {
    const element = getComposerElement();
    if (!element) {
      logComposerDebug("prompt.composer.apply.missing", {
        mode,
        promptLength: String(promptText || "").length,
      });
      return false;
    }

    const currentText = readComposerText(element);
    const nextText =
      mode === "append" && currentText
        ? `${currentText.replace(/\s+$/, "")}\n\n${promptText}`
        : promptText;
    const monitor = startAutoSendMonitor(element, {
      beforeSignature: namespace.contentDom?.getUserMessageSignature?.() || "",
      beforeUserCount: Number(namespace.contentDom?.getConversationState?.()?.userCount) || 0,
      composer: describeComposerElement(element),
      mode,
      promptLength: String(nextText || "").length,
      promptLineCount: countLineBreaks(nextText),
    });
    logComposerDebug("prompt.composer.apply.start", monitor.context);

    const applied =
      element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? setInputValue(element, nextText)
        : setEditableValue(element, nextText);

    if (applied.applied) {
      element.focus();
      logComposerDebug("prompt.composer.apply.success", {
        ...monitor.context,
        method: applied.method,
      });
      return true;
    }

    monitor.stop();
    logComposerDebug("prompt.composer.apply.failed", monitor.context);
    return false;
  }

  function readComposerText(element) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return String(element.value || "");
    }

    return String(element.innerText || element.textContent || "").replace(/\r\n/g, "\n").trim();
  }

  function setInputValue(element, text) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, text);
    } else {
      element.value = text;
    }

    dispatchComposerEvents(element, text, { includeChange: false });
    return {
      applied: true,
      method: descriptor?.set ? "input-value-setter" : "input-value-direct",
    };
  }

  function setEditableValue(element, text) {
    element.focus();
    if (selectAllEditableText(element) && document.execCommand?.("insertText", false, text)) {
      dispatchComposerEvents(element, text, { includeChange: true });
      return {
        applied: true,
        method: "editable-exec-command",
      };
    }

    const fragment = document.createDocumentFragment();
    const lines = String(text || "").split("\n");
    lines.forEach((line, index) => {
      fragment.append(document.createTextNode(line));
      if (index < lines.length - 1) {
        fragment.append(document.createElement("br"));
      }
    });
    element.replaceChildren(fragment);
    dispatchComposerEvents(element, text, { includeChange: true });
    return {
      applied: true,
      method: "editable-replace-children",
    };
  }

  function selectAllEditableText(element) {
    const selection = global.getSelection?.();
    if (!selection) {
      return false;
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function dispatchComposerEvents(element, text, options = {}) {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertText",
      })
    );
    if (options.includeChange) {
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function startAutoSendMonitor(element, context) {
    const form = element.closest?.("form") || null;
    const anchor = findComposerAnchor(element) || element;
    const beforeSignature = String(context?.beforeSignature || "");
    let stopped = false;
    let timer = 0;
    let submitListener = null;
    let keydownListener = null;
    let clickListener = null;
    let submitSignal = "";
    let submitter = "";
    const baseContext = {
      beforeSignatureLength: beforeSignature.length,
      beforeUserCount: Number(context?.beforeUserCount) || 0,
      composer: context?.composer || {},
      hasForm: Boolean(form),
      mode: normalizeDebugText(context?.mode),
      promptLength: Number(context?.promptLength) || 0,
      promptLineCount: Number(context?.promptLineCount) || 0,
    };

    if (form) {
      submitListener = (event) => {
        const nextSubmitter = normalizeDebugText(
          event?.submitter?.getAttribute?.("aria-label")
            || event?.submitter?.textContent
            || event?.submitter?.getAttribute?.("title")
            || event?.submitter?.tagName
            || ""
        );
        rememberSubmitSignal("form-submit", nextSubmitter);
        logComposerDebug("prompt.composer.submit.detected", {
          ...baseContext,
          submitSignal,
          submitter,
        });
      };
      form.addEventListener("submit", submitListener, true);
    }

    keydownListener = (event) => {
      if (
        stopped
        || event.defaultPrevented
        || event.isComposing
        || event.key !== "Enter"
        || event.shiftKey
        || event.altKey
        || event.ctrlKey
        || event.metaKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element) || !anchor.contains(target)) {
        return;
      }
      rememberSubmitSignal(
        "enter-key",
        normalizeDebugText(target.getAttribute?.("aria-label") || target.tagName)
      );
    };
    document.addEventListener("keydown", keydownListener, true);

    clickListener = (event) => {
      if (stopped) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest?.('button, [role="button"], [type="submit"]');
      if (!(button instanceof Element) || !anchor.contains(button)) {
        return;
      }
      if (button.closest?.("#inova-bookmark-host, #inova-composer-review-host")) {
        return;
      }
      rememberSubmitSignal(
        "button-click",
        normalizeDebugText(
          button.getAttribute?.("aria-label")
            || button.textContent
            || button.getAttribute?.("title")
            || button.tagName
        )
      );
    };
    document.addEventListener("click", clickListener, true);

    timer = global.setTimeout(() => {
      if (stopped) return;
      const afterUserCount = Number(namespace.contentDom?.getConversationState?.()?.userCount) || 0;
      const afterSignature = namespace.contentDom?.getUserMessageSignature?.() || "";
      if (afterUserCount > baseContext.beforeUserCount || afterSignature !== beforeSignature) {
        const payload = {
          ...baseContext,
          afterUserCount,
          afterSignatureLength: afterSignature.length,
          messageAdded: afterUserCount > baseContext.beforeUserCount,
          signatureChanged: afterSignature !== beforeSignature,
          submitSignal,
          submitter,
          userCountDelta: Math.max(0, afterUserCount - baseContext.beforeUserCount),
        };
        logComposerDebug(
          submitSignal ? "prompt.composer.message.after-apply" : "prompt.composer.auto-send.suspected",
          {
            ...payload,
            level: submitSignal ? "info" : "warning",
          }
        );
      }
      stop();
    }, AUTO_SEND_OBSERVE_MS);

    return {
      context: baseContext,
      stop,
    };

    function stop() {
      if (stopped) return;
      stopped = true;
      global.clearTimeout(timer);
      if (form && submitListener) {
        form.removeEventListener("submit", submitListener, true);
      }
      if (keydownListener) {
        document.removeEventListener("keydown", keydownListener, true);
      }
      if (clickListener) {
        document.removeEventListener("click", clickListener, true);
      }
    }

    function rememberSubmitSignal(signal, detail) {
      if (submitSignal) {
        return;
      }
      submitSignal = normalizeDebugText(signal);
      submitter = normalizeDebugText(detail);
    }
  }

  function describeComposerElement(element) {
    if (!element) {
      return {
        className: "",
        role: "",
        tagName: "",
        type: "",
      };
    }

    return {
      className: normalizeDebugText(element.className),
      role: normalizeDebugText(element.getAttribute?.("role")),
      tagName: normalizeDebugText(element.tagName).toLowerCase(),
      type: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? normalizeDebugText(element.type)
        : element.isContentEditable
          ? "contenteditable"
          : "",
    };
  }

  function countLineBreaks(text) {
    const normalized = String(text || "");
    return normalized ? normalized.split("\n").length : 0;
  }

  function normalizeDebugText(value) {
    return namespace.session?.normalizeText?.(value) || String(value || "").trim();
  }

  function logComposerDebug(event, payload) {
    namespace.panelDebug?.log?.(event, {
      scope: "prompt",
      tool: "prompts",
      ...(payload || {}),
    });
  }

  function findComposerAnchor(element) {
    const candidates = [];
    let current = element.parentElement;
    while (current && current !== document.body) {
      if ((current.matches?.(COMPOSER_FRAME_SELECTOR) || isValidAnchorCandidate(current, element)) && !candidates.includes(current)) {
        candidates.push(current);
      }
      current = current.parentElement;
    }
    if (!candidates.length) {
      return element;
    }

    return candidates.sort((left, right) => getAnchorScore(right, element) - getAnchorScore(left, element))[0] || element;
  }

  function isValidAnchorCandidate(candidate, composer) {
    if (!candidate || candidate === composer || !isVisible(candidate)) {
      return false;
    }

    const composerRect = composer.getBoundingClientRect();
    const rect = candidate.getBoundingClientRect();
    if (
      rect.width < composerRect.width + 12 ||
      rect.height < composerRect.height + 12 ||
      rect.width > composerRect.width + 520 ||
      rect.height > composerRect.height + 260
    ) {
      return false;
    }

    const interactiveCount = candidate.querySelectorAll(
      'button, [role="button"], input, textarea, select, [contenteditable="true"]'
    ).length;
    return interactiveCount >= 2 || rect.height >= composerRect.height + 44;
  }

  function getAnchorScore(candidate, composer) {
    const rect = candidate.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const interactiveCount = candidate.querySelectorAll(
      'button, [role="button"], input, textarea, select, [contenteditable="true"]'
    ).length;
    const paddingScore = Math.min(260, Math.max(0, rect.width - composerRect.width)) + Math.min(160, Math.max(0, rect.height - composerRect.height));
    const frameBonus = candidate.matches?.(COMPOSER_FRAME_SELECTOR) ? 180 : 0;
    return frameBonus + paddingScore + interactiveCount * 24 - Math.abs(rect.bottom - composerRect.bottom);
  }

  namespace.composer = {
    applyPromptText,
    getComposerAnchorElement,
    getComposerElement,
    getComposerState,
  };
})(globalThis);
