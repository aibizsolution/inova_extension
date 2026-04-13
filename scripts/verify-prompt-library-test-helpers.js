function createPromptLibraryFirestoreNamespace(snapshotFactory) {
  return {
    create(options = {}) {
      let activeSubscription = false;
      return {
        disconnect() {
          activeSubscription = false;
        },
        hasActiveSubscription() {
          return activeSubscription;
        },
        async ensureSubscribed(request = {}) {
          activeSubscription = true;
          await options.invokeRuntime?.({
            action: "auth.issue-prompt-panel",
            providerIdentity: request?.providerIdentity,
          });
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

module.exports = {
  createPromptLibraryFirestoreNamespace,
};
