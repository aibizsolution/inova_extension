(function initPanelHostedRuntimeRequest(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  async function handle(payload, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();

    if (!global.chrome?.runtime?.sendMessage) {
      throw new Error("확장 런타임에 연결할 수 없어요.");
    }
    const response = await global.chrome.runtime.sendMessage({
      request: payload && typeof payload === "object" ? payload : {},
      type: "inova-panel:invoke",
    });
    if (!response?.ok) {
      throw new Error(normalizeText(response?.error) || "호스팅 패널 요청을 처리하지 못했어요.");
    }
    return {
      handled: true,
      result: response.data,
    };
  }

  namespace.panelHostedRuntimeRequest = { handle };
})(globalThis);
