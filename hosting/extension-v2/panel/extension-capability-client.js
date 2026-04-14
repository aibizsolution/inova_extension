(function initExtensionCapabilityClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(options = {}) {
    const invokePage = typeof options.invokePage === "function"
      ? options.invokePage
      : async () => ({});
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});

    return {
      applyComposerText,
      clearDebugLog,
      copyDebugLog,
      createMeetingShare,
      invokeFunctionEndpoint,
      issuePanelSession,
      jumpConversationItem,
      logTrace,
      openBrowserUrl,
      openMeetingResult,
      openMeetingWorkspace,
      readComposerState,
      readConversationState,
      readDebugState,
      readPanelStorageState,
      revokeMeetingShare,
      setDebugEnabled,
      writeClipboardText,
      writeUiPreferences,
    };

    function applyComposerText(text, mode = "replace") {
      return invokePage({
        action: "composer.apply-text",
        mode,
        text,
      });
    }

    function clearDebugLog() {
      return invokePage({
        action: "debug.clear-log",
      });
    }

    function copyDebugLog(errorsOnly = false) {
      return invokePage({
        action: "debug.copy-log",
        errorsOnly,
      });
    }

    function createMeetingShare(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.share.create",
        input,
        providerIdentity,
      });
    }

    function invokeFunctionEndpoint(request = {}) {
      return invokeRuntime({
        ...request,
        action: "functions.invoke-endpoint",
      });
    }

    function issuePanelSession(panel, providerIdentity) {
      return invokeRuntime({
        action: "auth.issue-panel-session",
        panel,
        providerIdentity,
      });
    }

    function jumpConversationItem(bookmarkId) {
      return invokePage({
        action: "conversation.jump-item",
        bookmarkId,
      });
    }

    function logTrace(channel, step, payload = {}) {
      return invokePage({
        action: "trace.log",
        channel,
        payload,
        step,
      });
    }

    function openBrowserUrl(url) {
      return invokeRuntime({
        action: "browser.open-url",
        url,
      });
    }

    function openMeetingResult(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.result.open",
        input,
        providerIdentity,
      });
    }

    function openMeetingWorkspace(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.workspace.open",
        input,
        providerIdentity,
      });
    }

    function readComposerState() {
      return invokePage({
        action: "composer.read-state",
      });
    }

    function readConversationState() {
      return invokePage({
        action: "conversation.read-state",
      });
    }

    function readDebugState() {
      return invokePage({
        action: "debug.read-state",
      });
    }

    function readPanelStorageState() {
      return invokeRuntime({
        action: "storage.read-panel-state",
      });
    }

    function revokeMeetingShare(input, providerIdentity) {
      return invokeRuntime({
        action: "meeting.share.revoke",
        input,
        providerIdentity,
      });
    }

    function setDebugEnabled(enabled) {
      return invokePage({
        action: "debug.set-enabled",
        enabled,
      });
    }

    function writeClipboardText(text) {
      return invokePage({
        action: "clipboard.write-text",
        text,
      });
    }

    function writeUiPreferences(partial = {}) {
      return invokeRuntime({
        action: "storage.write-ui-preferences",
        partial,
      });
    }
  }

  namespace.extensionCapabilityClient = {
    create,
  };
})(globalThis);
