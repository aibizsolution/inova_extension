#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createCloudHarnessServer } = require("./cloud-harness-server");
const { PROVIDER_IDENTITY } = require("../fixtures/cloud-harness/fixtures");

const root = path.resolve(__dirname, "..");

async function main() {
  const harness = createCloudHarnessServer({ port: 0 });
  const { baseUrl } = await harness.listen();
  let messageListener = null;
  let trackStopCount = 0;
  let getUserMediaConstraints = null;
  const sentMessages = [];

  class FakeAudioContext {
    constructor() {
      this.closed = false;
      this.destination = { kind: "destination" };
    }

    createMediaStreamSource(stream) {
      return {
        connect() {
          return stream;
        },
      };
    }

    close() {
      this.closed = true;
      return Promise.resolve();
    }
  }

  class FakeMediaRecorder {
    static isTypeSupported(mimeType) {
      return mimeType === "audio/webm;codecs=opus" || mimeType === "audio/webm";
    }

    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = String(options.mimeType || "audio/webm");
      this.state = "inactive";
      this.listeners = new Map();
    }

    addEventListener(type, listener, options = {}) {
      const entries = this.listeners.get(type) || [];
      entries.push({
        listener,
        once: Boolean(options.once),
      });
      this.listeners.set(type, entries);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      if (this.state !== "recording") {
        return;
      }
      this.state = "inactive";
      setTimeout(() => {
        this.dispatch("dataavailable", {
          data: new Blob(["fixture audio payload"], { type: this.mimeType }),
        });
        this.dispatch("stop", {});
      }, 0);
    }

    dispatch(type, event) {
      const entries = this.listeners.get(type) || [];
      const retained = [];
      for (const entry of entries) {
        entry.listener(event);
        if (!entry.once) {
          retained.push(entry);
        }
      }
      this.listeners.set(type, retained);
    }
  }

  class FakeFileReader {
    constructor() {
      this.error = null;
      this.listeners = new Map();
      this.result = "";
    }

    addEventListener(type, listener, options = {}) {
      const entries = this.listeners.get(type) || [];
      entries.push({
        listener,
        once: Boolean(options.once),
      });
      this.listeners.set(type, entries);
    }

    async readAsDataURL(blob) {
      try {
        const buffer = Buffer.from(await blob.arrayBuffer());
        this.result = `data:${blob.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;
        this.dispatch("load", {});
      } catch (error) {
        this.error = error;
        this.dispatch("error", {});
      }
    }

    dispatch(type, event) {
      const entries = this.listeners.get(type) || [];
      const retained = [];
      for (const entry of entries) {
        entry.listener(event);
        if (!entry.once) {
          retained.push(entry);
        }
      }
      this.listeners.set(type, retained);
    }
  }

  const context = vm.createContext({
    AudioContext: FakeAudioContext,
    Blob,
    FileReader: FakeFileReader,
    MediaRecorder: FakeMediaRecorder,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        async sendMessage(message) {
          sentMessages.push(cloneValue(message));
          return { handled: true };
        },
      },
    },
    console,
    fetch,
    navigator: {
      mediaDevices: {
        async getUserMedia(constraints) {
          getUserMediaConstraints = cloneValue(constraints);
          return {
            getTracks() {
              return [
                {
                  stop() {
                    trackStopCount += 1;
                  },
                },
              ];
            },
          };
        },
      },
    },
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;

  try {
    loadScript("shared/constants.js", context);
    loadScript("shared/session.js", context);
    loadScript("offscreen/meeting-recorder.js", context);

    assert.equal(typeof messageListener, "function", "Offscreen recorder should register a runtime listener");

    const startResponse = await sendMessage(messageListener, {
      data: {
        captureMode: "tab-audio",
        sessionId: "fixture-session",
        streamId: "stream-81",
        title: "주간 스탠드업",
      },
      target: "offscreen",
      type: "inova-meeting:start-capture",
    });
    assert.equal(startResponse.capture.status, "recording");
    assert.equal(startResponse.capture.mimeType, "audio/webm;codecs=opus");
    assert.equal(getUserMediaConstraints.audio.mandatory.chromeMediaSource, "tab");
    assert.equal(getUserMediaConstraints.audio.mandatory.chromeMediaSourceId, "stream-81");

    const stopResponse = await sendMessage(messageListener, {
      data: {
        sessionId: "fixture-session",
      },
      target: "offscreen",
      type: "inova-meeting:stop-capture",
    });
    assert.equal(stopResponse.capture.status, "captured");
    assert.equal(stopResponse.capture.sizeBytes > 0, true);
    assert.equal(stopResponse.capture.durationMs >= 0, true);
    assert.equal(trackStopCount, 1);
    assert.equal(sentMessages.length, 0, "Successful capture should not emit recorder-failed messages");

    const createJobResponse = await sendMessage(messageListener, {
      data: {
        accessToken: "fixture-access-token",
        requestBody: {
          meeting: {
            endedAt: "2026-03-30T08:31:00.000Z",
            language: "ko",
            sessionId: "fixture-session",
            startedAt: "2026-03-30T08:20:00.000Z",
            title: "주간 스탠드업",
          },
          options: {
            redaction: "none",
            speakerLabels: true,
            summary: false,
          },
          owner: cloneValue(PROVIDER_IDENTITY),
          source: {
            captureMode: "tab-audio",
            channelCount: 1,
            durationMs: stopResponse.capture.durationMs,
            mimeType: stopResponse.capture.mimeType,
            sizeBytes: stopResponse.capture.sizeBytes,
          },
        },
        url: `${baseUrl}/createInovaMeetingJob`,
      },
      target: "offscreen",
      type: "inova-meeting:create-job",
    });
    assert.equal(createJobResponse.job.status, "queued");
    assert.equal(createJobResponse.job.sessionId, "fixture-session");

    const failedStartResponse = await sendMessage(messageListener, {
      data: {
        captureMode: "tab-audio",
        sessionId: "fixture-session",
        title: "주간 스탠드업",
      },
      target: "offscreen",
      type: "inova-meeting:start-capture",
    });
    assert.equal(failedStartResponse.capture.status, "error");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "inova-meeting:recorder-failed");
    assert.equal(sentMessages[0].payload.meeting.sessionId, "fixture-session");

    console.log("[verify-offscreen-recorder] Offscreen recorder passed");
  } finally {
    await harness.close();
  }
}

function sendMessage(listener, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        reject(new Error(`Timed out waiting for offscreen response: ${message.type}`));
      }
    }, 2000);

    const keepAlive = listener(message, { url: "chrome-extension://fixture/background/service-worker.js" }, (response) => {
      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
    });

    if (keepAlive === false) {
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(`Offscreen listener ignored the message: ${message.type}`));
    }
  });
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-offscreen-recorder] ${error.message}`);
  process.exit(1);
});
