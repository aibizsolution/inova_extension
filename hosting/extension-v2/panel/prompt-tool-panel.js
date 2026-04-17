(function initPromptToolPanel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function handleClick(event, host, callbacks) {
    const target = getEventElementTarget(event);
    if (!target) {
      return false;
    }
    const promptTabButton = target.closest?.("[data-prompt-tab-id]");
    if (promptTabButton) {
      callbacks.onSelectPromptTab?.(promptTabButton.dataset.promptTabId);
      return true;
    }

    const promptAction = target.closest?.("[data-prompt-action]");
    if (promptAction) {
      if (promptAction.dataset.promptAction === "import") {
        host.querySelector("#inova-prompt-import-file")?.click();
        return true;
      }
      callbacks.onPromptAction?.(promptAction.dataset.promptAction, {
        categoryId: promptAction.dataset.categoryId || "",
        insertMode: promptAction.dataset.insertMode || "",
        promptId: promptAction.dataset.promptId || "",
      });
      return true;
    }

    const storeAction = target.closest?.("[data-store-action]");
    if (storeAction) {
      callbacks.onStoreAction?.(storeAction.dataset.storeAction, {
        categoryId: storeAction.dataset.storeCategory || "",
        entryId: storeAction.dataset.storeEntryId || "",
        scope: storeAction.dataset.storeScope || "",
        sortBy: storeAction.dataset.storeSort || "",
      });
      return true;
    }

    const importMode = target.closest?.("[data-import-mode]");
    if (importMode) {
      callbacks.onPromptAction?.("set-import-mode", {
        importMode: importMode.dataset.importMode || "merge",
      });
      return true;
    }

    const storeCard = target.closest?.('[data-store-card="true"]');
    if (storeCard instanceof HTMLElement) {
      const blockedRegion = target.closest?.(".inova-inline-feedback");
      if (blockedRegion instanceof HTMLElement && storeCard.contains(blockedRegion)) {
        return false;
      }
      const interactive = target.closest?.('button, input, textarea, select, label, summary, details, [data-store-menu], [data-store-action], [data-store-field], [data-store-owner-info]');
      if (!(interactive instanceof HTMLElement) || !storeCard.contains(interactive) || interactive === storeCard) {
        callbacks.onStoreAction?.("toggle-expand", {
          entryId: storeCard.dataset.storeEntryId || "",
        });
        return true;
      }
    }

    const promptCard = target.closest?.('[data-prompt-card="true"]');
    if (promptCard instanceof HTMLElement) {
      const blockedRegion = target.closest?.(".inova-inline-feedback, .inova-prompt-editor, .inova-import-review");
      if (blockedRegion instanceof HTMLElement && promptCard.contains(blockedRegion)) {
        return false;
      }
      const interactive = target.closest?.('button, input, textarea, select, label, summary, details, [data-prompt-menu], [data-prompt-action], [data-prompt-field], [data-prompt-publish-field], [data-prompt-select], [data-import-mode]');
      if (!(interactive instanceof HTMLElement) || !promptCard.contains(interactive) || interactive === promptCard) {
        callbacks.onPromptAction?.("use", {
          promptId: promptCard.dataset.promptId || "",
        });
        return true;
      }
    }

    return false;
  }

  function handleInput(event, callbacks) {
    const target = getEventElementTarget(event);
    const field = target?.closest?.("[data-prompt-field]");
    if (field) {
      callbacks.onPromptDraftChange?.(field.dataset.promptField, field.value);
      return true;
    }

    const publishField = target?.closest?.("[data-prompt-publish-field]");
    if (publishField) {
      if (publishField.dataset.promptPublishField === "title") {
        callbacks.onPromptAction?.("set-publish-title", {
          promptId: publishField.dataset.promptId || "",
          title: publishField.value || "",
        });
        return true;
      }
      if (publishField.dataset.promptPublishField === "category-label") {
        callbacks.onPromptAction?.("set-publish-category-label", {
          categoryLabel: publishField.value || "",
          promptId: publishField.dataset.promptId || "",
        });
        return true;
      }
    }

    return false;
  }

  function handleChange(event, callbacks) {
    const target = getEventElementTarget(event);
    const storeField = target?.closest?.("[data-store-field]");
    if (storeField) {
      callbacks.onStoreAction?.("set-category", { categoryId: storeField.value || "all" });
      return true;
    }

    const promptSelect = target?.closest?.("[data-prompt-select]");
    if (promptSelect?.dataset.promptSelect === "publish-category") {
      callbacks.onPromptAction?.("set-publish-category", { categoryId: promptSelect.value || "" });
      return true;
    }

    return false;
  }

  function handlePointerDown(event, host) {
    const target = getEventElementTarget(event);
    const handle = target?.closest?.("[data-prompt-drag-handle]");
    if (!(handle instanceof HTMLElement) || event.button !== 0) return false;
    const item = handle.closest("[data-prompt-id]");
    const promptId = handle.dataset.promptDragHandle || "";
    if (!promptId || !(item instanceof HTMLElement)) return false;
    host.__promptDrag = { handle, placement: "before", promptId, targetPromptId: "" };
    item.classList.add("is-drag-source");
    handle.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);
    host.dataset.dragPointerId = String(event.pointerId);
    event.preventDefault();
    return true;
  }

  function handlePointerMove(event, host) {
    if (host.dataset.dragPointerId !== String(event.pointerId)) return false;
    const dragState = host.__promptDrag;
    if (!dragState?.promptId) return false;
    const item = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-prompt-id]");
    if (!(item instanceof HTMLElement)) {
      dragState.targetPromptId = "";
      clearPromptDropIndicators(host);
      return true;
    }
    const targetPromptId = item.dataset.promptId || "";
    if (!targetPromptId || targetPromptId === dragState.promptId) {
      dragState.targetPromptId = "";
      clearPromptDropIndicators(host);
      return true;
    }
    dragState.targetPromptId = targetPromptId;
    dragState.placement = getDropPlacement(item, event.clientY);
    setPromptDropIndicator(host, item, dragState.placement);
    return true;
  }

  function handlePointerEnd(event, host, callbacks) {
    if (host.dataset.dragPointerId !== String(event.pointerId)) return false;
    const dragState = host.__promptDrag;
    dragState?.handle?.releasePointerCapture?.(event.pointerId);
    const dragPromptId = dragState?.promptId || "";
    const targetPromptId = dragState?.targetPromptId || "";
    const placement = dragState?.placement || "before";
    clearPromptDragState(host);
    if (event.type === "pointerup" && dragPromptId && targetPromptId && dragPromptId !== targetPromptId) {
      callbacks.onMovePrompt?.(dragPromptId, targetPromptId, placement);
    }
    return true;
  }

  function handleScroll(event, host, callbacks) {
    const target = getEventElementTarget(event);
    const list = target?.closest?.(".inova-store-list") || null;
    if (!(list instanceof HTMLElement)) return false;
    host.__storeScrollTop = list.scrollTop;
    if (list.dataset.storeHasMore !== "true" || list.dataset.storeLoading === "true" || list.scrollHeight - list.clientHeight - list.scrollTop > 72) {
      return true;
    }
    callbacks.onStoreAction?.("load-more");
    return true;
  }

  function syncStoreList(host, callbacks, options = {}) {
    const list = host.querySelector(".inova-store-list");
    if (!(list instanceof HTMLElement)) return;
    const renderKey = Number(options.renderKey) || 0;
    const scrollTop = Math.max(0, Number(options.scrollTop) || 0);
    if (host.__storeRenderKey !== renderKey) {
      list.scrollTop = 0;
      host.__storeScrollTop = 0;
      host.__storeRenderKey = renderKey;
    } else if (scrollTop > 0) {
      list.scrollTop = scrollTop;
    }
    host.__storeScrollTop = list.scrollTop;
    if (callbacks?.onStoreAction && list.dataset.storeHasMore === "true" && list.dataset.storeLoading !== "true" && list.scrollHeight <= list.clientHeight + 24) {
      global.setTimeout(() => callbacks.onStoreAction("load-more"), 0);
    }
  }

  function getDropPlacement(item, clientY) {
    const rect = item.getBoundingClientRect();
    return clientY > rect.top + rect.height / 2 ? "after" : "before";
  }

  function setPromptDropIndicator(host, targetItem, placement) {
    clearPromptDropIndicators(host);
    targetItem.classList.add(placement === "after" ? "is-drop-after" : "is-drop-before");
  }

  function clearPromptDropIndicators(host) {
    host.querySelectorAll(".inova-prompt-item.is-drop-before, .inova-prompt-item.is-drop-after").forEach((item) => item.classList.remove("is-drop-before", "is-drop-after"));
  }

  function clearPromptDragState(host) {
    clearPromptDropIndicators(host);
    host.__promptDrag?.handle?.classList.remove("is-dragging");
    host.querySelectorAll(".inova-prompt-item.is-drag-source").forEach((item) => item.classList.remove("is-drag-source"));
    delete host.__promptDrag;
    delete host.dataset.dragPointerId;
  }

  namespace.promptToolPanel = {
    handleChange,
    handleClick,
    handleInput,
    handlePointerDown,
    handlePointerEnd,
    handlePointerMove,
    handleScroll,
    syncStoreList,
  };

  function getEventElementTarget(event) {
    const target = event?.target;
    if (target instanceof global.HTMLElement) {
      return target;
    }
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const pathElement = path.find((entry) => entry instanceof global.HTMLElement);
    if (pathElement) {
      return pathElement;
    }
    if (target?.parentElement instanceof global.HTMLElement) {
      return target.parentElement;
    }
    return null;
  }
})(globalThis);
