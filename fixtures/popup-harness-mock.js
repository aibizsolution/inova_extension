(function initPopupHarnessMock(global) {
  const changeListeners = [];
  const state = {
    activeTab: {
      title: "i-Nova Fixture Session",
      url: "https://inova.incross.com/chat?sid=fixture-session",
    },
    storage: {
      pausedSessions: {},
      settings: {
        autoBookmark: true,
        enabled: true,
      },
    },
  };

  installChromeMocks(global);

  global.__INOVA_POPUP_HARNESS__ = {
    state,
    setActiveTab(nextTab) {
      state.activeTab = {
        title: String(nextTab?.title || ""),
        url: String(nextTab?.url || ""),
      };
    },
  };

  function installChromeMocks(target) {
    const chromeObject = target.chrome || (target.chrome = {});
    chromeObject.storage = chromeObject.storage || {};
    chromeObject.storage.local = {
      async get(keys) {
        if (Array.isArray(keys)) {
          return keys.reduce((result, key) => {
            result[key] = cloneValue(state.storage[key]);
            return result;
          }, {});
        }
        if (typeof keys === "string") {
          return { [keys]: cloneValue(state.storage[keys]) };
        }
        if (keys && typeof keys === "object") {
          return mergeObjects(keys, state.storage);
        }
        return cloneValue(state.storage);
      },
      async set(partial) {
        const changes = {};
        for (const [key, value] of Object.entries(partial || {})) {
          const previousValue = cloneValue(state.storage[key]);
          state.storage[key] = cloneValue(value);
          changes[key] = {
            oldValue: previousValue,
            newValue: cloneValue(state.storage[key]),
          };
        }
        changeListeners.forEach((listener) => listener(changes, "local"));
      },
    };
    chromeObject.storage.onChanged = chromeObject.storage.onChanged || {
      addListener(listener) {
        changeListeners.push(listener);
      },
      removeListener(listener) {
        const index = changeListeners.indexOf(listener);
        if (index >= 0) {
          changeListeners.splice(index, 1);
        }
      },
    };
    chromeObject.tabs = chromeObject.tabs || {
      async query() {
        return [cloneValue(state.activeTab)];
      },
    };
  }

  function mergeObjects(defaults, values) {
    const result = {};
    for (const key of Object.keys(defaults || {})) {
      const defaultValue = defaults[key];
      const nextValue = values == null ? undefined : values[key];
      if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
        result[key] = mergeObjects(defaultValue, nextValue || {});
      } else if (nextValue !== undefined) {
        result[key] = cloneValue(nextValue);
      } else {
        result[key] = cloneValue(defaultValue);
      }
    }
    for (const key of Object.keys(values || {})) {
      if (!(key in result)) {
        result[key] = cloneValue(values[key]);
      }
    }
    return result;
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
})(globalThis);
