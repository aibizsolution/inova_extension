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

  function getComposerElement() {
    const direct = findComposerCandidate(namespace.constants.selectors.composer);
    if (direct) {
      return direct;
    }

    const fallback = findComposerCandidate('textarea, input[type="text"], [contenteditable="true"]');
    return fallback || null;
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
      return false;
    }

    const currentText = readComposerText(element);
    const nextText =
      mode === "append" && currentText
        ? `${currentText.replace(/\s+$/, "")}\n\n${promptText}`
        : promptText;

    const applied =
      element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? setInputValue(element, nextText)
        : setEditableValue(element, nextText);

    if (applied) {
      element.focus();
    }

    return applied;
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

    dispatchComposerEvents(element, text);
    return true;
  }

  function setEditableValue(element, text) {
    element.focus();
    if (selectAllEditableText(element) && document.execCommand?.("insertText", false, text)) {
      dispatchComposerEvents(element, text);
      return true;
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
    dispatchComposerEvents(element, text);
    return true;
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

  function dispatchComposerEvents(element, text) {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertText",
      })
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
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
