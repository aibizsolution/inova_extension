const { FieldValue } = require("firebase-admin/firestore");
const OpenAI = require("openai");

const DEFAULT_MODEL = "gpt-5.5";
const MAX_PROMPT_LENGTH = 12000;
const PROMPT_REVIEW_RATE_LIMIT_WINDOW_MS = 60000;
const PROMPT_REVIEW_RATE_LIMIT_MAX_REQUESTS = 6;
const REVIEW_PROFILES = {
  LEGACY_V1: "legacy-v1",
  PROMPT_TELLING_V2: "prompt-telling-v2",
};
const CHECK_STATUSES = ["good", "partial", "missing"];
const STATUS_SCORE_VALUES = {
  good: 1,
  missing: 0,
  partial: 0.5,
};
const REVIEW_PROFILE_CONFIGS = {
  [REVIEW_PROFILES.LEGACY_V1]: {
    dimensions: [
      { id: "context", label: "상황" },
      { id: "goal", label: "목표" },
      { id: "constraints", label: "조건" },
      { id: "output", label: "형식" },
    ],
    includeModelTotalScore: true,
  },
  [REVIEW_PROFILES.PROMPT_TELLING_V2]: {
    dimensions: [
      { group: "core", id: "persona", label: "역할" },
      { group: "core", id: "reference", label: "참고할 내용" },
      { group: "core", id: "objective", label: "목표" },
      { group: "refinement", id: "mode", label: "형식" },
      { group: "refinement", id: "pointOfView", label: "읽는 사람" },
      { group: "refinement", id: "tone", label: "말투" },
    ],
    includeModelTotalScore: false,
  },
};

function registerPromptReviewHandlers(deps) {
  const {
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
      const reviewProfile = normalizeReviewProfile(request.body?.reviewProfile);
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
        reviewProfile,
      });

      const result = await reviewPrompt(prompt, reviewProfile);
      logEvent("prompt.review.success", {
        providerUserKey: owner.providerUserKey,
        reviewProfile,
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

  async function reviewPrompt(prompt, reviewProfile) {
    const profileConfig = getReviewProfileConfig(reviewProfile);
    const sanitizedPrompt = sanitizePromptForModel(prompt);
    const response = await getClient().responses.create({
      input: [
        { role: "developer", content: buildSystemPrompt(profileConfig.profile) },
        { role: "user", content: `<original_prompt>\n${sanitizedPrompt || prompt}\n</original_prompt>` },
      ],
      max_output_tokens: 1800,
      model: getModel(),
      text: {
        format: {
          type: "json_schema",
          name: "prompt_review",
          strict: true,
          schema: buildReviewSchema(profileConfig),
        },
      },
    });
    return normalizeReviewResult(parseReviewPayload(response.output_text), prompt, profileConfig.profile);
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
          updatedAt: FieldValue.serverTimestamp(),
          windowStartedAt: withinWindow ? windowStartedAt : now,
        },
        { merge: true }
      );
    });
  }

  function buildSystemPrompt(reviewProfile) {
    if (normalizeReviewProfile(reviewProfile) === REVIEW_PROFILES.PROMPT_TELLING_V2) {
      return [
        "당신은 일반 사용자가 입력한 프롬프트를 쉽게 평가하고 바로 쓸 수 있게 다듬는 리뷰어입니다.",
        "반드시 한국어로 평가 요약과 피드백을 작성하세요. 설명은 비전문가가 바로 이해할 수 있는 쉬운 말로 씁니다.",
        "다만 refinedPrompt는 원문 언어와 의도를 최대한 유지하면서 바로 재사용 가능한 형태로 다시 써야 합니다.",
        "아래 여섯 기준만 평가하되 기준 id는 JSON의 id 필드에만 사용하세요: persona, reference, objective, mode, pointOfView, tone.",
        "persona는 AI가 맡을 역할이나 시점입니다.",
        "reference는 참고할 내용, 예시, 기준, 배경 정보, 입력 데이터입니다.",
        "objective는 사용자가 원하는 결과와 성공 기준입니다.",
        "mode는 결과물 형식, 구조, 분량, 포맷 요구입니다.",
        "pointOfView는 누구에게 맞춰 쓸지, 어떤 눈높이로 쓸지입니다.",
        "tone은 친절함, 전문성, 차분함 같은 말투와 분위기입니다.",
        "summary는 가장 중요한 판단을 한 문장으로 씁니다. 60자 안팎으로 쓰고 점수 설명부터 시작하지 마세요.",
        "checks.feedback는 한 문장으로 씁니다. 무엇이 부족한지보다 무엇을 어떻게 고치면 되는지를 먼저 말하세요.",
        "quickImprovements에는 실제로 고쳐야 할 점이 있을 때만 사용자가 그대로 붙여 넣을 수 있는 수정 문장 1~4개를 작성하세요.",
        "verdict가 ready이면 quickImprovements는 빈 배열로 반환하세요.",
        "refinedPrompt는 실제 입력창에 바로 넣을 수 있는 프롬프트 본문만 반환하세요.",
        "summary, checks.feedback, quickImprovements, refinedPrompt에는 영문 기준명이나 내부 약어를 쓰지 마세요.",
        "대괄호로 된 빈칸 표시를 만들지 마세요. 정보가 부족하면 refinedPrompt 안에 자연스러운 문장으로 '필요하면 ...을 추가해 주세요'처럼 적으세요.",
        "없는 사실을 지어내지 마세요.",
      ].join("\n");
    }
    return [
      "당신은 일반 사용자가 입력한 프롬프트를 쉽게 평가하고 바로 쓸 수 있게 다듬는 리뷰어입니다.",
      "반드시 한국어로 평가 요약과 피드백을 작성하세요. 설명은 비전문가가 바로 이해할 수 있는 쉬운 말로 씁니다.",
      "다만 refinedPrompt는 원문 언어와 의도를 최대한 유지하면서 바로 재사용 가능한 형태로 다시 써야 합니다.",
      "아래 네 기준만 평가하되 기준 id는 JSON의 id 필드에만 사용하세요: context, goal, constraints, output.",
      "context는 배경, 대상 독자, 현재 상황 같은 맥락입니다.",
      "goal은 사용자가 원하는 결과와 성공 기준입니다.",
      "constraints는 길이, 금지사항, 톤, 포함/제외 요소입니다.",
      "output은 표, 보고서, 메일, 리스트 같은 결과물 형식입니다.",
      "summary는 가장 중요한 판단을 한 문장으로 씁니다. 60자 안팎으로 쓰고 점수 설명부터 시작하지 마세요.",
      "checks.feedback는 한 문장으로 씁니다. 무엇이 부족한지보다 무엇을 어떻게 고치면 되는지를 먼저 말하세요.",
      "quickImprovements에는 실제로 고쳐야 할 점이 있을 때만 사용자가 그대로 붙여 넣을 수 있는 수정 문장 1~4개를 작성하세요.",
      "verdict가 ready이면 quickImprovements는 빈 배열로 반환하세요.",
      "refinedPrompt는 실제 입력창에 바로 넣을 수 있는 프롬프트 본문만 반환하세요.",
      "summary, checks.feedback, quickImprovements, refinedPrompt에는 영문 기준명이나 내부 id를 쓰지 마세요.",
      "대괄호로 된 빈칸 표시를 만들지 마세요. 정보가 부족하면 refinedPrompt 안에 자연스러운 문장으로 '필요하면 ...을 추가해 주세요'처럼 적으세요.",
      "없는 사실을 지어내지 마세요.",
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

function buildReviewSchema(profileConfig) {
  const properties = {
    verdict: {
      type: "string",
      enum: ["ready", "revise", "insufficient"],
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
          id: { type: "string", enum: profileConfig.dimensions.map((item) => item.id) },
          label: { type: "string" },
          status: { type: "string", enum: CHECK_STATUSES },
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
  };
  const required = ["verdict", "summary", "checks", "quickImprovements", "refinedPrompt"];
  if (profileConfig.includeModelTotalScore) {
    properties.totalScore = {
      type: "integer",
      minimum: 0,
      maximum: 100,
    };
    required.splice(1, 0, "totalScore");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function normalizeReviewResult(payload, originalPrompt, reviewProfile) {
  const profileConfig = getReviewProfileConfig(reviewProfile);
  const verdict = normalizeEnum(payload?.verdict, ["ready", "revise", "insufficient"], "revise");
  const checks = profileConfig.dimensions.map((dimension) => {
    const match = (Array.isArray(payload?.checks) ? payload.checks : []).find((item) => normalizeReviewId(item?.id) === normalizeReviewId(dimension.id));
    const normalizedCheck = {
      feedback: normalizeText(match?.feedback) || `${dimension.label} 정보를 한 번 더 보완해 주세요.`,
      id: dimension.id,
      label: dimension.label,
      status: normalizeEnum(match?.status, ["good", "partial", "missing"], "partial"),
    };
    if (dimension.group) {
      normalizedCheck.group = dimension.group;
    }
    return normalizedCheck;
  });
  const totalScore = profileConfig.includeModelTotalScore
    ? Math.max(0, Math.min(100, Number(payload?.totalScore) || 0))
    : computePromptTellingV2TotalScore(checks, profileConfig.dimensions);
  const quickImprovements = (Array.isArray(payload?.quickImprovements) ? payload.quickImprovements : [])
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 4);
  return {
    checks,
    quickImprovements: verdict === "ready" && totalScore >= 90 ? [] : quickImprovements,
    refinedPrompt: normalizePromptText(payload?.refinedPrompt) || normalizePromptText(originalPrompt),
    summary: normalizeText(payload?.summary) || "프롬프트를 더 구체적으로 다듬으면 답변 품질을 높일 수 있어요.",
    totalScore,
    verdict,
  };
}

function getReviewProfileConfig(reviewProfile) {
  const normalizedProfile = normalizeReviewProfile(reviewProfile);
  return {
    ...REVIEW_PROFILE_CONFIGS[normalizedProfile],
    profile: normalizedProfile,
  };
}

function normalizeReviewProfile(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === REVIEW_PROFILES.PROMPT_TELLING_V2
    ? REVIEW_PROFILES.PROMPT_TELLING_V2
    : REVIEW_PROFILES.LEGACY_V1;
}

function normalizeReviewId(value) {
  return normalizeText(value)
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
}

function computePromptTellingV2TotalScore(checks, dimensions) {
  const dimensionById = new Map(
    (Array.isArray(dimensions) ? dimensions : []).map((item) => [normalizeReviewId(item.id), item])
  );
  const groupScores = {
    core: { count: 0, sum: 0, weight: 70 },
    refinement: { count: 0, sum: 0, weight: 30 },
  };
  for (const check of Array.isArray(checks) ? checks : []) {
    const dimension = dimensionById.get(normalizeReviewId(check?.id));
    const group = normalizeText(check?.group || dimension?.group).toLowerCase();
    if (!groupScores[group]) continue;
    const status = normalizeEnum(check?.status, CHECK_STATUSES, "partial");
    groupScores[group].count += 1;
    groupScores[group].sum += STATUS_SCORE_VALUES[status] ?? STATUS_SCORE_VALUES.partial;
  }
  const totalScore = Object.values(groupScores).reduce((sum, group) => {
    if (!group.count) return sum;
    return sum + ((group.sum / group.count) * group.weight);
  }, 0);
  return Math.max(0, Math.min(100, Math.round(totalScore)));
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
  __test__: {
    buildReviewSchema,
    computePromptTellingV2TotalScore,
    getReviewProfileConfig,
    normalizeReviewProfile,
    normalizeReviewResult,
    REVIEW_PROFILES,
  },
};
