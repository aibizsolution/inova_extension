(function initComposer(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

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
        .filter((element) => !element.closest?.("#inova-bookmark-host"))
        .filter(isVisible)
        .sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom)[0] || null
    );
  }

  function isSupportedComposer(element) {
    return Boolean(
      element &&
        (element instanceof HTMLTextAreaElement ||
          element instanceof HTMLInputElement ||
          element.isContentEditable)
    );
  }

  function isVisible(element) {
    return Boolean(element?.isConnected && (element.offsetParent || element.getClientRects().length));
  }

  function getComposerState() {
    const element = getComposerElement();
    return {
      available: Boolean(element),
      text: element ? readComposerText(element) : "",
    };
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

  namespace.composer = {
    applyPromptText,
    getComposerState,
  };
})(globalThis);
