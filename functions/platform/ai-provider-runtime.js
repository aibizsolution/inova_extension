const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_REFERER = "https://browser-extension-v2.web.app";
const DEFAULT_OPENROUTER_TITLE = "i-Nova Extension";
const DEFAULT_OPENROUTER_TRANSCRIBE_MODEL = "openai/gpt-4o-transcribe";

function createAiProviderRuntime(deps) {
  const {
    OpenAI,
    createHttpError,
    fetchImpl = globalThis.fetch,
    logEvent = () => {},
    normalizeText = defaultNormalizeText,
    openaiFactory,
  } = deps;

  let openAIClient = null;
  let openRouterClient = null;
  let openRouterPrimaryFailed = false;
  let providerConfig = null;

  function createClient() {
    return {
      audio: {
        transcriptions: {
          create: createAudioTranscription,
        },
      },
      chat: {
        completions: {
          create: createChatCompletion,
        },
      },
      responses: {
        create: createResponse,
      },
    };
  }

  async function createChatCompletion(request) {
    return runWithProviderOrder({
      kind: "chat",
      openaiCall: () => getOpenAIClient().chat.completions.create(request),
      openrouterCall: () => getOpenRouterClient().chat.completions.create({
        ...request,
        model: resolveOpenRouterModel(request?.model, "chat"),
      }),
    });
  }

  async function createResponse(request) {
    return runWithProviderOrder({
      kind: "responses",
      openaiCall: () => getOpenAIClient().responses.create(request),
      openrouterCall: async () => {
        const completion = await getOpenRouterClient().chat.completions.create({
          max_tokens: request?.max_output_tokens,
          messages: normalizeResponsesInputAsMessages(request?.input),
          model: resolveOpenRouterModel(request?.model, "responses"),
          response_format: normalizeResponseFormatForChat(request?.text?.format),
        });
        return {
          output_text: normalizeText(completion?.choices?.[0]?.message?.content),
        };
      },
    });
  }

  async function createAudioTranscription(request) {
    return runWithProviderOrder({
      kind: "audio.transcriptions",
      openaiCall: () => getOpenAIClient().audio.transcriptions.create(request),
      openrouterCall: async () => {
        const fileBuffer = await readAudioFileBuffer(request?.file);
        const response = await fetchImpl(`${getOpenRouterBaseUrl()}/audio/transcriptions`, {
          body: JSON.stringify({
            input_audio: {
              data: fileBuffer.toString("base64"),
              format: resolveAudioFormat(request?.file),
            },
            language: normalizeText(request?.language) || undefined,
            model: resolveOpenRouterTranscribeModel(request?.model),
          }),
          headers: {
            Authorization: `Bearer ${getOpenRouterApiKey()}`,
            ...getOpenRouterHeaders(),
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const payload = await parseJsonResponse(response);
        if (!response.ok) {
          throw buildProviderError(response.status, payload);
        }
        return {
          duration: request?.duration,
          text: normalizeText(payload?.text),
        };
      },
    });
  }

  async function runWithProviderOrder({ kind, openaiCall, openrouterCall }) {
    const hasOpenAI = Boolean(getOpenAIApiKey()) || typeof openaiFactory === "function";
    const hasOpenRouter = Boolean(getOpenRouterApiKey());
    if (!hasOpenAI && !hasOpenRouter) {
      throw createHttpError(412, "INOVA_EXTENSION_AI_PROVIDER_CONFIG에 OpenRouter 또는 OpenAI API 키가 설정되지 않았어요.");
    }
    if (hasOpenRouter && !openRouterPrimaryFailed) {
      try {
        return await openrouterCall();
      } catch (error) {
        if (!hasOpenAI || !isProviderFallbackableError(error)) {
          throw error;
        }
        openRouterPrimaryFailed = true;
        logProviderSecondary(kind, error);
      }
    }
    return openaiCall();
  }

  function getOpenAIClient() {
    if (openAIClient) {
      return openAIClient;
    }
    const factory = typeof openaiFactory === "function"
      ? openaiFactory
      : (options) => new OpenAI(options);
    const apiKey = getOpenAIApiKey()
      || (typeof openaiFactory === "function" ? "fixture-openai-key" : "");
    if (!apiKey) {
      throw createHttpError(412, "INOVA_EXTENSION_AI_PROVIDER_CONFIG.openai.apiKey가 설정되지 않았어요.");
    }
    openAIClient = factory({ apiKey });
    return openAIClient;
  }

  function getOpenRouterClient() {
    if (openRouterClient) {
      return openRouterClient;
    }
    const apiKey = getOpenRouterApiKey();
    if (!apiKey) {
      throw createHttpError(412, "INOVA_EXTENSION_AI_PROVIDER_CONFIG.openrouter.apiKey가 설정되지 않았어요.");
    }
    openRouterClient = new OpenAI({
      apiKey,
      baseURL: getOpenRouterBaseUrl(),
      defaultHeaders: getOpenRouterHeaders(),
    });
    return openRouterClient;
  }

  function getOpenAIApiKey() {
    const config = getProviderConfig();
    return normalizeText(
      config.openai?.apiKey
      || config.openaiApiKey
      || process.env.INOVA_EXTENSION_OPENAI_API_KEY
    );
  }

  function getOpenRouterApiKey() {
    const config = getProviderConfig();
    return normalizeText(
      config.openrouter?.apiKey
      || config.openRouter?.apiKey
      || config.openrouterApiKey
      || config.openRouterApiKey
      || process.env.INOVA_EXTENSION_OPENROUTER_API_KEY
    );
  }

  function getOpenRouterBaseUrl() {
    const config = getProviderConfig();
    return normalizeText(
      config.openrouter?.baseUrl
      || config.openRouter?.baseUrl
      || config.openrouterBaseUrl
      || config.openRouterBaseUrl
      || process.env.OPENROUTER_BASE_URL
    ) || DEFAULT_OPENROUTER_BASE_URL;
  }

  function getOpenRouterHeaders() {
    const config = getProviderConfig();
    return {
      "HTTP-Referer": normalizeText(
        config.openrouter?.httpReferer
        || config.openRouter?.httpReferer
        || config.openrouterHttpReferer
        || config.openRouterHttpReferer
        || process.env.OPENROUTER_HTTP_REFERER
      ) || DEFAULT_OPENROUTER_REFERER,
      "X-OpenRouter-Title": normalizeText(
        config.openrouter?.title
        || config.openRouter?.title
        || config.openrouterTitle
        || config.openRouterTitle
        || process.env.OPENROUTER_TITLE
      ) || DEFAULT_OPENROUTER_TITLE,
    };
  }

  function resolveOpenRouterModel(modelInput, kind) {
    const config = getProviderConfig();
    const envModel = kind === "responses"
      ? normalizeText(
        config.openrouter?.promptReviewModel
        || config.openRouter?.promptReviewModel
        || config.openrouterPromptReviewModel
        || config.openRouterPromptReviewModel
        || process.env.OPENROUTER_PROMPT_REVIEW_MODEL
      )
      : normalizeText(
        config.openrouter?.meetingSummaryModel
        || config.openRouter?.meetingSummaryModel
        || config.openrouterMeetingSummaryModel
        || config.openRouterMeetingSummaryModel
        || process.env.OPENROUTER_MEETING_SUMMARY_MODEL
      )
        || normalizeText(process.env.OPENROUTER_SUMMARY_MODEL);
    const model = envModel || normalizeText(modelInput);
    if (!model) {
      return "openai/gpt-5.4-mini";
    }
    if (model.includes("/")) {
      return model;
    }
    if (/^(gpt|o\d|chatgpt|whisper)/i.test(model)) {
      return `openai/${model}`;
    }
    return model;
  }

  function resolveOpenRouterTranscribeModel(modelInput) {
    const config = getProviderConfig();
    const model = normalizeText(
      config.openrouter?.meetingTranscribeModel
      || config.openRouter?.meetingTranscribeModel
      || config.openrouterMeetingTranscribeModel
      || config.openRouterMeetingTranscribeModel
      || process.env.OPENROUTER_MEETING_TRANSCRIBE_MODEL
    )
      || normalizeText(modelInput);
    if (!model) {
      return DEFAULT_OPENROUTER_TRANSCRIBE_MODEL;
    }
    if (model.includes("/")) {
      return model;
    }
    if (/^(gpt|whisper)/i.test(model)) {
      return `openai/${model}`;
    }
    return model;
  }

  function normalizeResponsesInputAsMessages(input) {
    return (Array.isArray(input) ? input : [])
      .map((item) => ({
        content: normalizeMessageContent(item?.content),
        role: normalizeResponsesRole(item?.role),
      }))
      .filter((item) => item.content);
  }

  function getProviderConfig() {
    if (providerConfig) {
      return providerConfig;
    }
    providerConfig = parseProviderConfig(process.env.INOVA_EXTENSION_AI_PROVIDER_CONFIG);
    return providerConfig;
  }

  function parseProviderConfig(rawValue) {
    const raw = normalizeSecretJson(rawValue);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw createHttpError(412, "INOVA_EXTENSION_AI_PROVIDER_CONFIG JSON 형식이 올바르지 않아요.");
    }
  }

  function normalizeSecretJson(value) {
    return String(value ?? "").trim();
  }

  function normalizeMessageContent(content) {
    if (Array.isArray(content)) {
      return content.map((item) => normalizeText(item?.text || item?.content)).filter(Boolean).join("\n");
    }
    return normalizeText(content);
  }

  function normalizeResponsesRole(role) {
    const normalized = normalizeText(role).toLowerCase();
    if (normalized === "developer" || normalized === "system") {
      return "system";
    }
    if (normalized === "assistant") {
      return "assistant";
    }
    return "user";
  }

  function normalizeResponseFormatForChat(format) {
    if (!format || typeof format !== "object") {
      return undefined;
    }
    if (format.type === "json_schema") {
      return {
        type: "json_schema",
        json_schema: {
          name: format.name,
          schema: format.schema,
          strict: format.strict === true,
        },
      };
    }
    return { type: format.type || "json_object" };
  }

  async function readAudioFileBuffer(file) {
    if (Buffer.isBuffer(file)) {
      return file;
    }
    if (file && typeof file.arrayBuffer === "function") {
      return Buffer.from(await file.arrayBuffer());
    }
    throw createHttpError(400, "OpenRouter 전사용 오디오 파일을 읽지 못했어요.");
  }

  function resolveAudioFormat(file) {
    const mimeType = normalizeText(file?.type).toLowerCase();
    const mimeMatch = mimeType.match(/^audio\/([a-z0-9+.-]+)/);
    if (mimeMatch) {
      return mimeMatch[1].replace(/^x-/, "").split("+")[0];
    }
    const fileName = normalizeText(file?.name || file?.filename).toLowerCase();
    const extensionMatch = fileName.match(/\.([a-z0-9]+)$/);
    return extensionMatch?.[1] || "webm";
  }

  async function parseJsonResponse(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function buildProviderError(status, payload) {
    const message = normalizeText(payload?.error?.message || payload?.message)
      || `OpenRouter 요청이 실패했어요. 상태 코드: ${status}`;
    const error = new Error(message);
    error.status = status;
    error.code = normalizeText(payload?.error?.code);
    error.type = normalizeText(payload?.error?.type);
    return error;
  }

  function isProviderFallbackableError(error) {
    const status = Number(error?.status || error?.statusCode || error?.cause?.status) || 0;
    const code = normalizeText(error?.code || error?.error?.code).toLowerCase();
    const message = normalizeText(error?.message).toLowerCase();
    return status === 401
      || status === 429
      || status === 500
      || status === 502
      || status === 503
      || status === 504
      || code === "invalid_api_key"
      || code === "insufficient_quota"
      || code === "rate_limit_exceeded"
      || message.includes("invalid api key")
      || message.includes("incorrect api key")
      || message.includes("current quota")
      || message.includes("billing quota")
      || message.includes("run out of credits")
      || message.includes("rate limit")
      || message.includes("temporarily unavailable")
      || message.includes("timeout");
  }

  function logProviderSecondary(kind, error) {
    logEvent("ai.provider.secondary", {
      from: "openrouter",
      kind,
      reason: normalizeText(error?.code || error?.type || error?.message).slice(0, 120),
      to: "openai",
    });
  }

  return {
    createClient,
    parseProviderConfig,
    resolveOpenRouterModel,
    resolveOpenRouterTranscribeModel,
  };
}

function defaultNormalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  createAiProviderRuntime,
};
