const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function createPromptLibraryFirestoreNamespace(snapshotFactory) {
  return {
    create(options = {}) {
      let activeSubscription = false;
      const issuePanelSession = typeof options.browserCapabilities?.issuePanelSession === "function"
        ? (providerIdentity) => options.browserCapabilities.issuePanelSession("prompt", providerIdentity)
        : typeof options.invokeRuntime === "function"
          ? (providerIdentity) => options.invokeRuntime({
              action: "auth.issue-panel-session",
              panel: "prompt",
              providerIdentity,
            })
          : async () => ({});
      return {
        disconnect() {
          activeSubscription = false;
        },
        hasActiveSubscription() {
          return activeSubscription;
        },
        async ensureSubscribed(request = {}) {
          activeSubscription = true;
          await issuePanelSession(request?.providerIdentity);
          return typeof snapshotFactory === "function"
            ? snapshotFactory(request)
            : {
                promptLibrary: {
                  items: [{ id: "prompt-1", title: "Prompt", content: "Body" }],
                  version: 1,
                },
              };
        },
      };
    },
  };
}

function installHostedCapabilityClient(context) {
  const source = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "extension-capability-client.js"),
    "utf8"
  );
  new vm.Script(source, {
    filename: "hosting/extension-v2/panel/extension-capability-client.js",
  }).runInContext(context);
}

function installPanelUtils(context) {
  const source = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "panel-utils.js"),
    "utf8"
  );
  new vm.Script(source, {
    filename: "hosting/extension-v2/panel/panel-utils.js",
  }).runInContext(context);
}

module.exports = {
  createPromptLibraryFirestoreNamespace,
  installHostedCapabilityClient,
  installPanelUtils,
};
