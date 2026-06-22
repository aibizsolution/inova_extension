#!/usr/bin/env node

const assert = require("assert");
const { createAiProviderRuntime } = require("../functions/platform/ai-provider-runtime");

async function main() {
  await verifyOpenRouterPreferredWhenBothKeysExist();
  await verifyOpenAIUsedWhenOpenRouterMissing();
  await verifyLocalOpenRouterEnvCompatibility();
  await verifyOpenAISecondaryAfterOpenRouterFailure();
  await verifyResponsesFallbackMapsJsonSchema();
  await verifyOpenRouterTranscriptionRequest();
  await verifyGeminiPreferredForTranscriptionWhenConfigured();
  await verifyOpenRouterTranscriptionFallbackAfterGeminiFailure();
  await verifyGeminiEmptyTranscriptionFailsWithoutFallback();
  console.log("[verify-ai-provider-runtime] AI provider priority contract passed");
}

async function verifyOpenRouterPreferredWhenBothKeysExist() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      openai: { apiKey: "fixture-openai-key" },
      openrouter: { apiKey: "fixture-openrouter-key" },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    const calls = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
    });
    const completion = await runtime.createClient().chat.completions.create({
      messages: [{ role: "user", content: "ping" }],
      model: "gpt-5.5",
    });
    assert.equal(completion.choices[0].message.content, "{\"ok\":true}");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].baseURL, "https://openrouter.ai/api/v1");
    assert.equal(calls[0].request.model, "openai/gpt-5.5");
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyOpenAIUsedWhenOpenRouterMissing() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      openai: { apiKey: "fixture-openai-key" },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    const calls = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
    });
    const completion = await runtime.createClient().chat.completions.create({
      messages: [{ role: "user", content: "ping" }],
      model: "gpt-5.5",
    });
    assert.equal(completion.choices[0].message.content, "{\"primary\":true}");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].baseURL, "");
    assert.equal(calls[0].request.model, "gpt-5.5");
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyLocalOpenRouterEnvCompatibility() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = "";
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "fixture-openrouter-key";
    const calls = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
    });
    await runtime.createClient().chat.completions.create({
      messages: [{ role: "user", content: "ping" }],
      model: "gpt-5.5",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].baseURL, "https://openrouter.ai/api/v1");
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyOpenAISecondaryAfterOpenRouterFailure() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      openai: { apiKey: "fixture-openai-key" },
      openrouter: { apiKey: "fixture-openrouter-key" },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    const events = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({
        openRouterChatError: createAuthError(),
      }),
      createHttpError,
      logEvent(name, payload) {
        events.push({ name, payload });
      },
    });
    const completion = await runtime.createClient().chat.completions.create({
      messages: [{ role: "user", content: "ping" }],
      model: "gpt-5.5",
    });
    assert.equal(completion.choices[0].message.content, "{\"primary\":true}");
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "ai.provider.secondary");
    assert.equal(events[0].payload.kind, "chat");
    assert.equal(events[0].payload.from, "openrouter");
    assert.equal(events[0].payload.to, "openai");
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyGeminiPreferredForTranscriptionWhenConfigured() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      gemini: {
        apiKey: "fixture-gemini-key",
        meetingTranscribeModel: "gemini-3.5-flash",
      },
      openrouter: {
        apiKey: "fixture-openrouter-key",
        meetingTranscribeModel: "openai/gpt-4o-transcribe",
      },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    const calls = [];
    const events = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
      fetchImpl: createGeminiFallbackFetch({
        calls,
      }),
      logEvent(name, payload) {
        events.push({ name, payload });
      },
    });
    const file = new File([Buffer.from("audio")], "meeting.wav", { type: "audio/wav" });
    const response = await runtime.createClient().audio.transcriptions.create({
      file,
      language: "ko",
      model: "gpt-4o-transcribe",
    });
    assert.equal(response.text, "Gemini 전사 결과");
    assert.equal(events.length, 0);
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/upload/v1beta/files");
    assert.equal(calls[0].headers["x-goog-api-key"], "fixture-gemini-key");
    assert.equal(calls[1].url, "https://upload.example.test/session");
    assert.equal(calls[2].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
    assert.equal(calls[2].body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
    assert.equal(calls[2].body.generationConfig.maxOutputTokens, 16384);
    assert.match(calls[2].body.contents[0].parts[0].text, /business meeting audio/);
    assert.equal(calls[2].body.contents[0].parts[1].file_data.file_uri, "gemini://uploaded-file");
    assert.equal(calls[3].url, "https://generativelanguage.googleapis.com/v1beta/files/fixture-upload");
    assert.equal(calls.some((call) => call.url === "https://openrouter.ai/api/v1/audio/transcriptions"), false);
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyOpenRouterTranscriptionFallbackAfterGeminiFailure() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      gemini: {
        apiKey: "fixture-gemini-key",
        meetingTranscribeModel: "gemini-3.5-flash",
      },
      openrouter: {
        apiKey: "fixture-openrouter-key",
      },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    const calls = [];
    const events = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
      fetchImpl: createGeminiFallbackFetch({
        calls,
        geminiGeneratePayload: {
          candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
        },
      }),
      logEvent(name, payload) {
        events.push({ name, payload });
      },
    });
    const file = new File([Buffer.from("audio")], "meeting.wav", { type: "audio/wav" });
    const response = await runtime.createClient().audio.transcriptions.create({ file, language: "ko" });
    assert.equal(response.text, "OpenRouter 전사 결과");
    assert.equal(calls.some((call) => call.url === "https://generativelanguage.googleapis.com/v1beta/files/fixture-upload"), true);
    assert.equal(calls[calls.length - 1].url, "https://openrouter.ai/api/v1/audio/transcriptions");
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.from, "gemini");
    assert.equal(events[0].payload.to, "openrouter");
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyGeminiEmptyTranscriptionFailsWithoutFallback() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      gemini: {
        apiKey: "fixture-gemini-key",
        meetingTranscribeModel: "gemini-3.5-flash",
      },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    const calls = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
      fetchImpl: createGeminiFallbackFetch({
        calls,
        geminiGeneratePayload: {
          candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
        },
      }),
    });
    const file = new File([Buffer.from("audio")], "meeting.wav", { type: "audio/wav" });
    await assert.rejects(
      () => runtime.createClient().audio.transcriptions.create({ file, language: "ko" }),
      /Gemini 전사 결과가 비어/
    );
    assert.equal(calls.some((call) => call.url === "https://generativelanguage.googleapis.com/v1beta/files/fixture-upload"), true);
    assert.equal(calls.some((call) => call.url === "https://openrouter.ai/api/v1/audio/transcriptions"), false);
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyResponsesFallbackMapsJsonSchema() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      openrouter: {
        apiKey: "fixture-openrouter-key",
        promptReviewModel: "openai/gpt-5.4-mini",
      },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    const calls = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
    });
    const response = await runtime.createClient().responses.create({
      input: [
        { role: "developer", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ],
      model: "gpt-5.4-mini",
      text: {
        format: {
          type: "json_schema",
          name: "fixture",
          strict: true,
          schema: { type: "object" },
        },
      },
    });
    assert.equal(response.output_text, "{\"ok\":true}");
    assert.equal(calls[0].baseURL, "https://openrouter.ai/api/v1");
    assert.equal(calls[0].request.model, "openai/gpt-5.4-mini");
    assert.equal(calls[0].request.messages[0].role, "system");
    assert.equal(calls[0].request.response_format.json_schema.name, "fixture");
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
  }
}

async function verifyOpenRouterTranscriptionRequest() {
  const previousConfig = process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG;
  const previousOpenAIKey = process.env.INOVA_EXTENSION_OPENAI_API_KEY;
  const previousOpenRouterKey = process.env.INOVA_EXTENSION_OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_MEETING_TRANSCRIBE_MODEL;
  try {
    process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG = JSON.stringify({
      openrouter: {
        apiKey: "fixture-openrouter-key",
        meetingTranscribeModel: "openai/gpt-4o-transcribe",
      },
    });
    process.env.INOVA_EXTENSION_OPENAI_API_KEY = "";
    process.env.INOVA_EXTENSION_OPENROUTER_API_KEY = "";
    process.env.OPENROUTER_MEETING_TRANSCRIBE_MODEL = "";
    const calls = [];
    const runtime = createAiProviderRuntime({
      OpenAI: createFakeOpenAIClass({ calls }),
      createHttpError,
      fetchImpl: async (url, options) => {
        calls.push({
          body: JSON.parse(options.body),
          headers: options.headers,
          url,
        });
        return {
          ok: true,
          async json() {
            return { text: "전사 결과" };
          },
        };
      },
    });
    const file = new File([Buffer.from("audio")], "meeting.webm", { type: "audio/webm;codecs=opus" });
    const response = await runtime.createClient().audio.transcriptions.create({
      file,
      language: "ko",
      model: "gpt-4o-transcribe-diarize",
    });
    assert.equal(response.text, "전사 결과");
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/audio/transcriptions");
    assert.equal(calls[0].body.model, "openai/gpt-4o-transcribe");
    assert.equal(calls[0].body.input_audio.format, "webm");
    assert.equal(calls[0].body.input_audio.data, Buffer.from("audio").toString("base64"));
    assert.equal(calls[0].headers.Authorization, "Bearer fixture-openrouter-key");
  } finally {
    restoreEnv("INOVA_EXTENSION_AI_PROVIDER_CONFIG", previousConfig);
    restoreEnv("INOVA_EXTENSION_OPENAI_API_KEY", previousOpenAIKey);
    restoreEnv("INOVA_EXTENSION_OPENROUTER_API_KEY", previousOpenRouterKey);
    restoreEnv("OPENROUTER_MEETING_TRANSCRIBE_MODEL", previousModel);
  }
}

function createFakeOpenAIClass(options = {}) {
  return class FakeOpenAI {
    constructor(config) {
      this.config = config;
      this.audio = {
        transcriptions: {
          create: async (request) => {
            if (config.baseURL) {
              if (options.openRouterAudioError) {
                throw options.openRouterAudioError;
              }
              options.calls?.push({ baseURL: config.baseURL, request });
              return { text: "transcript" };
            }
            options.calls?.push({ baseURL: "", request });
            throw options.openaiAudioError || new Error("unexpected openai audio call");
          },
        },
      };
      this.chat = {
        completions: {
          create: async (request) => {
            if (config.baseURL) {
              if (options.openRouterChatError) {
                throw options.openRouterChatError;
              }
              options.calls?.push({ baseURL: config.baseURL, request });
              return { choices: [{ message: { content: "{\"ok\":true}" } }] };
            }
            options.calls?.push({ baseURL: "", request });
            if (options.openaiChatError) {
              throw options.openaiChatError;
            }
            return { choices: [{ message: { content: "{\"primary\":true}" } }] };
          },
        },
      };
      this.responses = {
        create: async (request) => {
          options.calls?.push({ baseURL: "", request });
          throw options.openaiResponsesError || createAuthError();
        },
      };
    }
  };
}

function createGeminiFallbackFetch(options = {}) {
  const {
    calls,
    geminiGeneratePayload = {
      candidates: [{ content: { parts: [{ text: "Gemini 전사 결과" }] }, finishReason: "STOP" }],
    },
    openRouterResponse = createJsonResponse(200, { text: "OpenRouter 전사 결과" }),
  } = options;
  return async (url, request = {}) => {
    const parsedBody = typeof request.body === "string"
      ? JSON.parse(request.body)
      : request.body;
    calls?.push({
      body: parsedBody,
      headers: request.headers || {},
      url,
    });
    if (String(url).includes("openrouter.ai")) {
      return openRouterResponse;
    }
    if (String(url).endsWith("/upload/v1beta/files")) {
      return createJsonResponse(200, {}, {
        "x-goog-upload-url": "https://upload.example.test/session",
      });
    }
    if (String(url) === "https://upload.example.test/session") {
      return createJsonResponse(200, {
        file: {
          mimeType: "audio/wav",
          name: "files/fixture-upload",
          uri: "gemini://uploaded-file",
        },
      });
    }
    if (String(url).includes(":generateContent")) {
      return createJsonResponse(200, geminiGeneratePayload);
    }
    if (String(url).endsWith("/v1beta/files/fixture-upload")) {
      return createJsonResponse(200, {});
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  };
}

function createJsonResponse(status, payload, headers = {}) {
  return {
    headers: {
      get(name) {
        return headers[name] || headers[String(name).toLowerCase()] || "";
      },
    },
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function createAuthError() {
  const error = new Error("Incorrect API key provided");
  error.status = 401;
  error.code = "invalid_api_key";
  return error;
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

main().catch((error) => {
  console.error(`[verify-ai-provider-runtime] ${error.stack || error.message}`);
  process.exitCode = 1;
});
