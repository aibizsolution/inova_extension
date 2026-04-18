#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifyRouteWatcherInstallationAndTriggers();
  console.log("[verify-route-watch-controller] Route watch controller contract passed");
}

function verifyRouteWatcherInstallationAndTriggers() {
  const documentListeners = new Map();
  const documentListenerRegistrations = [];
  const globalListeners = new Map();
  const globalListenerRegistrations = [];
  const scheduledReasons = [];
  const scheduledTimeouts = [];
  const scheduledIntervals = [];

  class TestElement {
    closest(selector) {
      return selector === "a, button, [role='button']" ? this : null;
    }
  }

  const context = vm.createContext({
    console,
    Element: TestElement,
    globalThis: null,
    location: {
      pathname: "/chat",
      search: "?sid=alpha",
    },
    document: {
      addEventListener(type, handler) {
        documentListenerRegistrations.push(type);
        documentListeners.set(type, handler);
      },
      visibilityState: "hidden",
    },
    history: {
      pushState(...args) {
        return args.length;
      },
      replaceState(...args) {
        return args.length;
      },
    },
    addEventListener(type, handler) {
      globalListenerRegistrations.push(type);
      globalListeners.set(type, handler);
    },
    clearInterval() {},
    setInterval(callback, delay) {
      scheduledIntervals.push({ callback, delay });
      return scheduledIntervals.length;
    },
    setTimeout(callback, delay) {
      scheduledTimeouts.push({ callback, delay });
      return scheduledTimeouts.length;
    },
  });
  context.globalThis = context;
  context.InovaBookmarks = {};

  loadScript("content/route-watch-controller.js", context);

  const state = {
    lastRouteKey: "",
    routePollTimer: 0,
    routeWatchInstalled: false,
  };
  const controller = context.InovaBookmarks.routeWatchController.create(state, {
    scheduleRouteSync(reason) {
      scheduledReasons.push(reason);
    },
  });

  controller.installRouteWatchers();

  assert.equal(state.routeWatchInstalled, true);
  assert.equal(state.lastRouteKey, "/chat?sid=alpha");
  assert.equal(scheduledIntervals.length, 1);
  assert.equal(scheduledIntervals[0].delay, 400);
  assert.deepEqual(globalListenerRegistrations, ["popstate", "visibilitychange"]);
  assert.deepEqual(documentListenerRegistrations, ["click"]);
  assert.equal(typeof globalListeners.get("popstate"), "function");
  assert.equal(typeof globalListeners.get("visibilitychange"), "function");
  assert.equal(typeof documentListeners.get("click"), "function");

  context.history.pushState({}, "", "/chat?sid=beta");
  context.history.replaceState({}, "", "/chat?sid=gamma");
  assert.deepEqual(scheduledReasons.slice(0, 2), ["history.pushState", "history.replaceState"]);

  globalListeners.get("popstate")();
  assert.equal(scheduledReasons.at(-1), "popstate");

  context.document.visibilityState = "hidden";
  globalListeners.get("visibilitychange")();
  assert.notEqual(scheduledReasons.at(-1), "visibility");

  context.document.visibilityState = "visible";
  globalListeners.get("visibilitychange")();
  assert.equal(scheduledReasons.at(-1), "visibility");

  documentListeners.get("click")({ target: new TestElement() });
  assert.deepEqual(scheduledTimeouts.map((entry) => entry.delay), [80, 350]);
  scheduledTimeouts.shift().callback();
  scheduledTimeouts.shift().callback();
  assert.equal(scheduledReasons.includes("click.80"), true);
  assert.equal(scheduledReasons.includes("click.350"), true);

  context.location.search = "?sid=delta";
  scheduledIntervals[0].callback();
  assert.equal(state.lastRouteKey, "/chat?sid=delta");
  assert.equal(scheduledReasons.at(-1), "poll");

  controller.installRouteWatchers();
  assert.equal(scheduledIntervals.length, 1, "Watcher install should be idempotent");

  const secondState = {
    lastRouteKey: "",
    routePollTimer: 0,
    routeWatchInstalled: false,
  };
  const secondScheduledReasons = [];
  const secondController = context.InovaBookmarks.routeWatchController.create(secondState, {
    scheduleRouteSync(reason) {
      secondScheduledReasons.push(reason);
    },
  });

  secondController.installRouteWatchers();
  assert.equal(secondState.routeWatchInstalled, true);
  assert.equal(secondState.lastRouteKey, "/chat?sid=delta");
  assert.equal(scheduledIntervals.length, 1, "Global route polling should not be duplicated across controller instances");
  assert.deepEqual(globalListenerRegistrations, ["popstate", "visibilitychange"]);
  assert.deepEqual(documentListenerRegistrations, ["click"]);

  const previousReasonCount = scheduledReasons.length;
  context.history.pushState({}, "", "/chat?sid=epsilon");
  assert.equal(scheduledReasons.length, previousReasonCount, "Reinstalled history wrapper should dispatch only to the latest route watcher");
  assert.deepEqual(secondScheduledReasons, ["history.pushState"]);

  context.location.search = "?sid=epsilon";
  scheduledIntervals[0].callback();
  assert.equal(secondState.lastRouteKey, "/chat?sid=epsilon");
  assert.equal(secondScheduledReasons.at(-1), "poll");
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main();
