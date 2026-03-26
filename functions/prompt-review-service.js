const OpenAI = require("openai");

const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_PROMPT_LENGTH = 12000;
const PROMPT_REVIEW_RATE_LIMIT_WINDOW_MS = 60000;
const PROMPT_REVIEW_RATE_LIMIT_MAX_REQUESTS = 6;
const REVIEW_DIMENSIONS = [
  { id: "context", label: "맥락" },
  { id: "goal", label: "목표" },
  { id: "constraints", label: "제약" },
  { id: "output", label: "산출물 형식" },
];
const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["ready", "revise", "insufficient"],
    },
    totalScore: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    summary: {
      type: "string",
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", enum: REVIEW_DIMENSIONS.map((item) => item.id) },
          label: { type: "string" },
          status: { type: "string", enum: ["good", "partial", "missing"] },
          feedback: { type: "string" },
        },
        required: ["id", "label", "status", "feedback"],
      },
    },
    quickImprovements: {
      type: "array",
      items: { type: "string" },
    },
    refinedPrompt: {
      type: "string",
    },
  },
  required: ["verdict", "totalScore", "summary", "checks", "quickImprovements", "refinedPrompt"],
};

function registerPromptReviewHandlers(deps) {
  const {
    admin,
    CORS_ORIGINS,
    REGION,
    createHttpError,
    db,
    logEvent,
    normalizeIdentity,
    normalizeText,
    onRequest,
    sendError,
    verifyInovaIdentity,
  } = deps;
  let client = null;

  const reviewInovaPrompt = onRequest({ cors: CORS_ORIGINS, region: REGION, timeoutSeconds: 60 }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const prompt = normalizePrompt(request.body?.prompt);
      if (!prompt) {
        throw createHttpError(400, "평가할 프롬프트를 먼저 입력해 주세요.");
      }
      if (prompt.length > MAX_PROMPT_LENGTH) {
        throw createHttpError(400, `프롬프트는 ${MAX_PROMPT_LENGTH.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`);
      }
      await enforceReviewRateLimit(owner.providerUserKey);

      logEvent("prompt.review.start", {
        model: getModel(),
        promptLength: prompt.length,
        providerUserKey: owner.providerUserKey,
      });

      const result = await reviewPrompt(prompt);
      logEvent("prompt.review.success", {
        providerUserKey: owner.providerUserKey,
        totalScore: result.totalScore,
        verdict: result.verdict,
      });
      response.json({ ok: true, data: result });
    } catch (error) {
      logEvent("prompt.review.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    reviewInovaPrompt,
  };

  function assertMethod(request) {
    if (request.method !== "POST") {
      throw createHttpError(405, "POST 요청만 지원해요.");
    }
  }

  async function verifyRequestIdentity(request) {
    const providerIdentity = normalizeIdentity(request.body?.providerIdentity || request.body?.owner);
    return verifyInovaIdentity(providerIdentity, request);
  }

  function getClient() {
    if (client) return client;
    const apiKey = normalizeText(process.env.OPENAI_API_KEY);
    if (!apiKey) {
      throw createHttpError(412, "OPENAI_API_KEY가 설정되지 않았어요.");
    }
    client = new OpenAI({ apiKey });
    return client;
  }

  function getModel() {
    return normalizeText(process.env.OPENAI_PROMPT_REVIEW_MODEL) || DEFAULT_MODEL;
  }

  async function reviewPrompt(prompt) {
    const sanitizedPrompt = sanitizePromptForModel(prompt);
    const response = await getClient().responses.create({
      input: [
        { role: "developer", content: buildSystemPrompt() },
        { role: "user", content: `<original_prompt>\n${sanitizedPrompt || prompt}\n</original_prompt>` },
      ],
      max_output_tokens: 1800,
      model: getModel(),
      text: {
        format: {
          type: "json_schema",
          name: "prompt_review",
          strict: true,
          schema: REVIEW_SCHEMA,
        },
      },
    });
    return normalizeReviewResult(parseReviewPayload(response.output_text), prompt);
  }

  async function enforceReviewRateLimit(providerUserKey) {
    const limitRef = db.collection("ops_prompt_review_usage").doc(providerUserKey);
    const now = Date.now();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(limitRef);
      const data = snapshot.data() || {};
      const requestCount = Math.max(0, Number(data.requestCount) || 0);
      const windowStartedAt = Math.max(0, Number(data.windowStartedAt) || 0);
      const withinWindow = windowStartedAt && now - windowStartedAt < PROMPT_REVIEW_RATE_LIMIT_WINDOW_MS;

      if (withinWindow && requestCount >= PROMPT_REVIEW_RATE_LIMIT_MAX_REQUESTS) {
        throw createHttpError(429, `프롬프트 검토는 ${Math.floor(PROMPT_REVIEW_RATE_LIMIT_WINDOW_MS / 1000)}초에 ${PROMPT_REVIEW_RATE_LIMIT_MAX_REQUESTS}회까지만 요청할 수 있어요. 잠시 후 다시 시도해 주세요.`);
      }

      transaction.set(
        limitRef,
        {
          providerUserKey,
          requestCount: withinWindow ? requestCount + 1 : 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          windowStartedAt: withinWindow ? windowStartedAt : now,
        },
        { merge: true }
      );
    });
  }

  function buildSystemPrompt() {
    return [
      "당신은 사용자가 입력한 프롬프트를 평가하고 보완하는 리뷰어입니다.",
      "반드시 한국어로 평가 요약과 피드백을 작성하세요.",
      "다만 refinedPrompt는 원문 언어와 의도를 최대한 유지하면서 바로 재사용 가능한 형태로 다시 써야 합니다.",
      "아래 네 기준만 평가하세요: context, goal, constraints, output.",
      "context는 배경, 대상 독자, 현재 상황 같은 맥락입니다.",
      "goal은 사용자가 원하는 결과와 성공 기준입니다.",
      "constraints는 길이, 금지사항, 톤, 포함/제외 요소입니다.",
      "output은 표, 보고서, 메일, 리스트 같은 결과물 형식입니다.",
      "세부 정보가 비어 있으면 없는 사실을 지어내지 말고 [대상 독자], [분량], [금지 사항] 같은 짧은 placeholder를 사용하세요.",
      "quickImprovements에는 바로 적용 가능한 문장만 1~4개 작성하세요.",
      "refinedPrompt는 장황한 설명 없이 실제 입력창에 바로 넣을 수 있는 프롬프트 본문만 반환하세요.",
    ].join("\n");
  }

  function normalizePrompt(value) {
    return String(value || "").trim();
  }
}

function parseReviewPayload(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    throw createHttpError(502, "OpenAI 응답이 비어 있어요.");
  }
  try {
    return JSON.parse(normalized);
  } catch {
    const match = normalized.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw createHttpError(502, "OpenAI 평가 결과를 읽지 못했어요.");
  }
}

function normalizeReviewResult(payload, originalPrompt) {
  const verdict = normalizeEnum(payload?.verdict, ["ready", "revise", "insufficient"], "revise");
  const checks = REVIEW_DIMENSIONS.map((dimension) => {
    const match = (Array.isArray(payload?.checks) ? payload.checks : []).find((item) => normalizeText(item?.id) === dimension.id);
    return {
      feedback: normalizeText(match?.feedback) || `${dimension.label} 정보를 한 번 더 보완해 주세요.`,
      id: dimension.id,
      label: normalizeText(match?.label) || dimension.label,
      status: normalizeEnum(match?.status, ["good", "partial", "missing"], "partial"),
    };
  });
  return {
    checks,
    quickImprovements: (Array.isArray(payload?.quickImprovements) ? payload.quickImprovements : [])
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .slice(0, 4),
    refinedPrompt: normalizePromptText(payload?.refinedPrompt) || normalizePromptText(originalPrompt),
    summary: normalizeText(payload?.summary) || "프롬프트를 더 구체적으로 다듬으면 답변 품질을 높일 수 있어요.",
    totalScore: Math.max(0, Math.min(100, Number(payload?.totalScore) || 0)),
    verdict,
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeText(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizePromptText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizePromptForModel(prompt) {
  return normalizePromptText(prompt)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[이메일]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, "Bearer [비밀값]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[인증 토큰]")
    .replace(/\b(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\\-_]{20,})\b/g, "[API 키]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)\b\s*[:=]\s*([^\s"'`]+)/gi, "$1=[비밀값]");
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  registerPromptReviewHandlers,
};
