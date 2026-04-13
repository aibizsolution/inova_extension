(function initPanelHostedBridgeRequest(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  async function handle(request, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    const callbacks = helpers.callbacks && typeof helpers.callbacks === "object"
      ? helpers.callbacks
      : {};
    const logConsoleTrace = typeof helpers.logConsoleTrace === "function"
      ? helpers.logConsoleTrace
      : () => {};
    const domain = normalizeText(request?.domain);

    if (domain === "runtime") {
      const handledRuntimeRequest = await namespace.panelHostedRuntimeRequest?.handle?.(request?.payload, {
        normalizeText,
      });
      if (handledRuntimeRequest?.handled) {
        return {
          handled: true,
          result: handledRuntimeRequest.result,
        };
      }
      throw new Error("지원하지 않는 runtime broker 요청이에요.");
    }

    if (domain === "page") {
      const handledPageRequest = await namespace.panelHostedPageRequest?.handle?.(request?.payload, {
        logConsoleTrace,
      });
      if (handledPageRequest?.handled) {
        return {
          handled: true,
          result: handledPageRequest.result,
        };
      }
      throw new Error("지원하지 않는 page adapter 요청이에요.");
    }

    if (domain === "panel") {
      const payload = request?.payload;
      const action = normalizeText(payload?.action);
      const handledMeetingRequest = await namespace.panelHostedMeetingRequest?.handle?.(action, payload, callbacks, {
        logConsoleTrace,
        normalizeText,
      });
      if (handledMeetingRequest?.handled) {
        return {
          handled: true,
          result: handledMeetingRequest.result,
        };
      }

      const handledPromptRequest = await namespace.panelHostedPromptRequest?.handle?.(action, payload, callbacks, {
        normalizeText,
      });
      if (handledPromptRequest?.handled) {
        return {
          handled: true,
          result: handledPromptRequest.result,
        };
      }

      const handledShellRequest = await namespace.panelHostedShellRequest?.handle?.(action, payload, callbacks, {
        normalizeText,
      });
      if (handledShellRequest?.handled) {
        return {
          handled: true,
          result: handledShellRequest.result,
        };
      }

      throw new Error("지원하지 않는 hosted panel action이에요.");
    }

    return {
      handled: false,
      result: null,
    };
  }

  namespace.panelHostedBridgeRequest = { handle };
})(globalThis);
