const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_REFERER = "https://browser-extension-v2.web.app";
const DEFAULT_OPENROUTER_TITLE = "i-Nova Extension";
const DEFAULT_OPENROUTER_TRANSCRIBE_MODEL = "openai/gpt-4o-transcribe";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-flash";
const DEFAULT_GEMINI_TRANSCRIBE_THINKING_LEVEL = "minimal";

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
  const openRouterPrimaryFailedKinds = new Set();
  const geminiSecondaryFailedKinds = new Set();
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
      geminiCall: () => createGeminiAudioTranscription(request),
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

  async function runWithProviderOrder({ kind, geminiCall, openaiCall, openrouterCall }) {
    const hasOpenAI = Boolean(getOpenAIApiKey()) || typeof openaiFactory === "function";
    const hasGemini = Boolean(getGeminiApiKey()) && typeof geminiCall === "function";
    const hasOpenRouter = Boolean(getOpenRouterApiKey());
    if (!hasOpenAI && !hasGemini && !hasOpenRouter) {
      throw createHttpError(412, "INOVA_EXTENSION_AI_PROVIDER_CONFIG에 OpenRouter, Gemini 또는 OpenAI API 키가 설정되지 않았어요.");
    }
    if (hasOpenRouter && !openRouterPrimaryFailedKinds.has(kind)) {
      try {
        return await openrouterCall();
      } catch (error) {
        if ((!hasGemini && !hasOpenAI) || !isProviderFallbackableError(error)) {
          throw error;
        }
        openRouterPrimaryFailedKinds.add(kind);
        logProviderSecondary(kind, error, hasGemini ? "gemini" : "openai");
      }
    }
    if (hasGemini && !geminiSecondaryFailedKinds.has(kind)) {
      try {
        return await geminiCall();
      } catch (error) {
        if (!hasOpenAI || !isProviderFallbackableError(error)) {
          throw error;
        }
        geminiSecondaryFailedKinds.add(kind);
        logProviderSecondary(kind, error, "openai", "gemini");
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

  function getGeminiApiKey() {
    const config = getProviderConfig();
    return normalizeText(
      config.gemini?.apiKey
      || config.google?.apiKey
      || config.googleAi?.apiKey
      || config.geminiApiKey
      || config.googleApiKey
      || process.env.INOVA_EXTENSION_GEMINI_API_KEY
    );
  }

  function getGeminiBaseUrl() {
    const config = getProviderConfig();
    return normalizeText(
      config.gemini?.baseUrl
      || config.google?.baseUrl
      || config.googleAi?.baseUrl
      || config.geminiBaseUrl
      || process.env.GEMINI_BASE_URL
    ) || DEFAULT_GEMINI_BASE_URL;
  }

  function resolveGeminiTranscribeModel(modelInput) {
    const config = getProviderConfig();
    return normalizeText(
      config.gemini?.meetingTranscribeModel
      || config.google?.meetingTranscribeModel
      || config.googleAi?.meetingTranscribeModel
      || config.geminiMeetingTranscribeModel
      || process.env.GEMINI_MEETING_TRANSCRIBE_MODEL
    )
      || normalizeText(modelInput)
      || DEFAULT_GEMINI_TRANSCRIBE_MODEL;
  }

  function resolveGeminiTranscribeThinkingLevel(model) {
    const config = getProviderConfig();
    const configured = normalizeText(
      config.gemini?.meetingTranscribeThinkingLevel
      || config.google?.meetingTranscribeThinkingLevel
      || config.googleAi?.meetingTranscribeThinkingLevel
      || config.geminiMeetingTranscribeThinkingLevel
      || process.env.GEMINI_MEETING_TRANSCRIBE_THINKING_LEVEL
    );
    if (configured) {
      return configured;
    }
    return /^gemini-3(?:\.|$|-)/i.test(normalizeText(model))
      ? DEFAULT_GEMINI_TRANSCRIBE_THINKING_LEVEL
      : "";
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

  async function createGeminiAudioTranscription(request) {
    const fileBuffer = await readAudioFileBuffer(request?.file, "Gemini 전사용 오디오 파일을 읽지 못했어요.");
    const model = resolveGeminiTranscribeModel(request?.model);
    const mimeType = resolveAudioMimeType(request?.file);
    let uploadedFile = null;
    try {
      uploadedFile = await uploadGeminiFile({
        fileBuffer,
        fileName: normalizeText(request?.file?.name || request?.file?.filename) || "meeting-audio",
        mimeType,
      });
      const payload = await generateGeminiTranscription({
        file: uploadedFile,
        language: request?.language,
        mimeType,
        model,
      });
      const text = extractGeminiText(payload);
      if (!text) {
        throw buildProviderError(502, {
          error: { message: "Gemini 전사 결과가 비어 있어요.", code: "empty_transcription" },
        });
      }
      return {
        duration: request?.duration,
        text,
      };
    } finally {
      if (uploadedFile?.name) {
        await deleteGeminiFile(uploadedFile.name).catch(() => {});
      }
    }
  }

  async function uploadGeminiFile({ fileBuffer, fileName, mimeType }) {
    const displayName = normalizeGeminiDisplayName(fileName);
    const startResponse = await fetchImpl(`${getGeminiBaseUrl()}/upload/v1beta/files`, {
      body: JSON.stringify({ file: { display_name: displayName } }),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileBuffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "X-Goog-Upload-Protocol": "resumable",
        "x-goog-api-key": getGeminiApiKey(),
      },
      method: "POST",
    });
    const startPayload = await parseJsonResponse(startResponse);
    if (!startResponse.ok) {
      throw buildProviderError(startResponse.status, startPayload);
    }
    const uploadUrl = getHeaderValue(startResponse.headers, "x-goog-upload-url");
    if (!uploadUrl) {
      throw buildProviderError(502, {
        error: { message: "Gemini Files API 업로드 URL을 받지 못했어요.", code: "missing_upload_url" },
      });
    }
    const finalizeResponse = await fetchImpl(uploadUrl, {
      body: fileBuffer,
      headers: {
        "Content-Length": String(fileBuffer.length),
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      method: "POST",
    });
    const finalizePayload = await parseJsonResponse(finalizeResponse);
    if (!finalizeResponse.ok) {
      throw buildProviderError(finalizeResponse.status, finalizePayload);
    }
    return finalizePayload?.file || finalizePayload;
  }

  async function generateGeminiTranscription({ file, language, mimeType, model }) {
    const generationConfig = { temperature: 0 };
    const thinkingLevel = resolveGeminiTranscribeThinkingLevel(model);
    if (thinkingLevel) {
      generationConfig.thinkingConfig = { thinkingLevel };
    }
    const response = await fetchImpl(`${getGeminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: buildGeminiTranscriptionPrompt(language) },
            {
              file_data: {
                file_uri: file?.uri,
                mime_type: normalizeText(file?.mimeType || file?.mime_type) || mimeType,
              },
            },
          ],
        }],
        generationConfig,
      }),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getGeminiApiKey(),
      },
      method: "POST",
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw buildProviderError(response.status, payload);
    }
    return payload;
  }

  async function deleteGeminiFile(name) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      return false;
    }
    const response = await fetchImpl(`${getGeminiBaseUrl()}/v1beta/${normalizedName}`, {
      headers: { "x-goog-api-key": getGeminiApiKey() },
      method: "DELETE",
    });
    return response.ok;
  }

  async function readAudioFileBuffer(file, errorMessage = "OpenRouter 전사용 오디오 파일을 읽지 못했어요.") {
    if (Buffer.isBuffer(file)) {
      return file;
    }
    if (file && typeof file.arrayBuffer === "function") {
      return Buffer.from(await file.arrayBuffer());
    }
    throw createHttpError(400, errorMessage);
  }

  function resolveAudioMimeType(file) {
    const mimeType = normalizeText(file?.type).toLowerCase().split(";")[0];
    if (mimeType) {
      return mimeType;
    }
    return `audio/${resolveAudioFormat(file)}`;
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

  function getHeaderValue(headers, name) {
    if (!headers) {
      return "";
    }
    if (typeof headers.get === "function") {
      return normalizeText(headers.get(name));
    }
    return normalizeText(headers[name] || headers[name.toLowerCase()]);
  }

  function extractGeminiText(payload) {
    return normalizeText(
      (Array.isArray(payload?.candidates) ? payload.candidates : [])
        .flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
        .map((part) => part?.text)
        .filter(Boolean)
        .join("\n")
    );
  }

  function buildGeminiTranscriptionPrompt(language) {
    const languageHint = normalizeText(language) || "ko";
    return [
      `Transcribe this ${languageHint} meeting audio as accurately as possible.`,
      "Return only the spoken transcript text in chronological order.",
      "Do not add summaries, speaker labels, markdown, translations, or explanations.",
      "If speech is unclear, omit uncertain words instead of inventing content.",
    ].join(" ");
  }

  function normalizeGeminiDisplayName(fileName) {
    return `inova-meeting-${normalizeText(fileName) || "audio"}`
      .replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "inova-meeting-audio";
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

  function logProviderSecondary(kind, error, to, from = "openrouter") {
    logEvent("ai.provider.secondary", {
      from,
      kind,
      reason: normalizeText(error?.code || error?.type || error?.message).slice(0, 120),
      to,
    });
  }

  return {
    createClient,
    parseProviderConfig,
    resolveGeminiTranscribeModel,
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
