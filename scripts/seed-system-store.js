#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const admin = require("../functions/node_modules/firebase-admin");
const { rebuildStoreFeeds } = require("./rebuild-store-feeds");
const titleOverrides = require("./system-store-title-overrides.json");

const PROJECT_ID = "browser-extension-main";
const COLLECTION = "prompt_store_entries";
const DETAIL_COLLECTION = "prompt_store_entry_details";
const CATALOG_PATH = path.join(os.homedir(), ".codex", "skills", "subagent-orchestrator", "references", "full-catalog.md");
const SOURCE_URL = "https://github.com/VoltAgent/awesome-codex-subagents";
const SYSTEM_OWNER_KEY = "system:subagent-orchestrator-catalog";
const SYSTEM_OWNER = {
  displayName: "시스템",
  kind: "system",
  maskedEmail: "",
  providerUserKey: SYSTEM_OWNER_KEY,
};
const CATEGORY_MAP = {
  "Core Development": { id: "core-dev", label: "코어 개발", style: "engineering" },
  "Language Specialists": { id: "language-specialists", label: "언어/프레임워크", style: "engineering" },
  "Infrastructure": { id: "infrastructure", label: "인프라", style: "operations" },
  "Quality and Security": { id: "quality-security", label: "품질/보안", style: "quality" },
  "Data and AI": { id: "data-ai", label: "데이터/AI", style: "analysis" },
  "Developer Experience": { id: "developer-experience", label: "개발 경험", style: "engineering" },
  "Specialized Domains": { id: "specialized-domains", label: "전문 도메인", style: "domain" },
  "Business and Product": { id: "business-product", label: "비즈니스/프로덕트", style: "product" },
  "Meta and Orchestration": { id: "meta-orchestration", label: "오케스트레이션", style: "orchestration" },
  "Research and Analysis": { id: "research-analysis", label: "리서치/분석", style: "analysis" },
};

main().catch((error) => {
  console.error("[seed-system-store] failed", error);
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`카탈로그 파일을 찾지 못했어요: ${CATALOG_PATH}`);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  const markdown = fs.readFileSync(CATALOG_PATH, "utf8");
  const catalog = parseCatalog(markdown);
  if (catalog.roles.length !== 136) {
    throw new Error(`역할 수가 136개가 아니에요: ${catalog.roles.length}`);
  }

  const now = new Date().toISOString();
  const db = admin.firestore();
  const dryRun = process.argv.includes("--dry-run");
  const refs = catalog.roles.map((role) => db.collection(COLLECTION).doc(`system__subagent_catalog__${role.roleName}`));
  const existingSnapshots = dryRun ? [] : await db.getAll(...refs);
  const existingMap = new Map(existingSnapshots.map((snapshot) => [snapshot.id, snapshot.data() || {}]));
  const batch = db.batch();

  for (const role of catalog.roles) {
    const category = CATEGORY_MAP[role.catalogCategory] || { id: "other", label: "기타", style: "analysis" };
    const entryId = `system__subagent_catalog__${role.roleName}`;
    const previous = existingMap.get(entryId) || null;
    const detail = buildDetailEntry(role, category, now);
    const entry = buildEntry(role, category, now, previous);
    const ref = db.collection(COLLECTION).doc(entry.entryId);
    const detailRef = db.collection(DETAIL_COLLECTION).doc(entry.entryId);
    if (dryRun) {
      console.log(JSON.stringify({ entryId: entry.entryId, title: entry.title, categoryId: entry.categoryId }, null, 2));
      continue;
    }
    batch.set(ref, entry);
    batch.set(detailRef, detail);
  }

  if (!dryRun) {
    await batch.commit();
    await rebuildStoreFeeds();
  }

  console.log(`[seed-system-store] ${dryRun ? "dry-run" : "seeded"} ${catalog.roles.length} entries`);
  console.log(`[seed-system-store] source: ${SOURCE_URL}`);
}

function parseCatalog(markdown) {
  const roles = [];
  let currentCategory = "";

  for (const line of String(markdown || "").split(/\r?\n/)) {
    const categoryMatch = line.match(/^## \d+\.\s+(.+)$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    const roleMatch = line.match(/^- `([^`]+)`: (.+)$/);
    if (!roleMatch || !currentCategory) {
      continue;
    }

    roles.push({
      catalogCategory: currentCategory,
      description: roleMatch[2].trim(),
      roleName: roleMatch[1].trim(),
    });
  }

  return { roles };
}

function buildEntry(role, category, timestamp, previous) {
  const displayTitle = humanizeRoleName(role.roleName);
  const content = buildPromptContent(role, category, displayTitle);
  return {
    categoryId: category.id,
    categoryLabel: category.label,
    entryId: `system__subagent_catalog__${role.roleName}`,
    hasDetail: true,
    metrics: previous?.metrics || { importCount: 0, likeCount: 0, viewCount: 0 },
    owner: SYSTEM_OWNER,
    publishedAt: previous?.publishedAt || timestamp,
    score: Number(previous?.score) || 0,
    source: {
      catalogCategory: role.catalogCategory,
      roleName: role.roleName,
      roleTitle: displayTitle,
      seedKind: "system-subagent-catalog",
      upstream: SOURCE_URL,
    },
    status: "published",
    summary: buildSummary(content),
    title: `${displayTitle} 전문가`,
    updatedAt: timestamp,
  };
}

function buildDetailEntry(role, category, timestamp) {
  const displayTitle = humanizeRoleName(role.roleName);
  return {
    content: buildPromptContent(role, category, displayTitle),
    entryId: `system__subagent_catalog__${role.roleName}`,
    owner: {
      kind: SYSTEM_OWNER.kind,
      providerUserKey: SYSTEM_OWNER.providerUserKey,
    },
    updatedAt: timestamp,
  };
}

function buildPromptContent(role, category, displayTitle) {
  const responseShape = getResponseShape(category.style);
  return [
    `이번 요청은 \`${displayTitle}\` 관점에서 검토해줘.`,
    `완전한 역할놀이보다 \`${category.label}\` 관점의 실무적인 판단과 실행 조언을 우선해줘.`,
    "정보가 부족하면 임의로 가정하지 말고, 먼저 필요한 정보 3가지를 짧게 물어봐.",
    "가능하면 아래 원칙을 따라줘:",
    ...responseShape.rules.map((rule) => `- ${rule}`),
    "가능하면 아래 형식으로 답해줘:",
    ...responseShape.sections.map((section, index) => `${index + 1}. ${section}`),
    "만약 이 관점을 그대로 따르기 어렵다면, 해당 분야의 체크리스트와 조언 형태로 최대한 가깝게 답해줘.",
  ].join("\n");
}

function getResponseShape(style) {
  if (style === "engineering") {
    return {
      rules: [
        "먼저 요청을 한두 문장으로 재정의해.",
        "구현 방향과 기술적 trade-off를 먼저 말해.",
        "가능하면 리스크와 테스트 포인트를 함께 제시해.",
      ],
      sections: ["상황 요약", "핵심 판단", "실행 제안", "리스크/테스트 포인트"],
    };
  }
  if (style === "operations") {
    return {
      rules: [
        "운영 안정성, 장애 영향, 롤백 가능성을 우선해.",
        "즉시 조치와 후속 조치를 분리해.",
        "확인이 필요한 로그나 메트릭을 함께 제안해.",
      ],
      sections: ["현재 상황", "운영 리스크", "즉시 조치", "후속 확인 항목"],
    };
  }
  if (style === "quality") {
    return {
      rules: [
        "회귀, 보안, 테스트 누락을 우선해서 봐.",
        "치명도 높은 이슈부터 짚어.",
        "막연한 지적보다 재현 또는 확인 방법을 함께 줘.",
      ],
      sections: ["핵심 문제", "사용자 영향", "권장 대응", "검증 방법"],
    };
  }
  if (style === "product") {
    return {
      rules: [
        "사용자 가치와 우선순위를 먼저 판단해.",
        "지금 해야 할 것과 나중에 미뤄도 될 것을 구분해.",
        "모호한 부분은 가정과 확인 질문으로 분리해.",
      ],
      sections: ["문제 정의", "핵심 판단", "추천안", "확인할 점"],
    };
  }
  if (style === "orchestration") {
    return {
      rules: [
        "작업을 겹치지 않는 단계나 역할로 나눠.",
        "병렬 처리 가능한 것과 순차 처리할 것을 구분해.",
        "최종 통합 포인트를 분명히 해.",
      ],
      sections: ["전체 흐름", "역할/단계 분리", "우선순위", "통합 시 주의점"],
    };
  }
  if (style === "domain") {
    return {
      rules: [
        "도메인 특유의 제약과 리스크를 먼저 드러내.",
        "일반론보다 해당 분야 맥락에 맞는 판단을 해.",
        "실행 가능한 조언 위주로 답해.",
      ],
      sections: ["도메인 맥락", "핵심 판단", "실행 제안", "주의할 점"],
    };
  }
  return {
    rules: [
      "먼저 요청을 짧게 재정의해.",
      "핵심 판단 3개를 우선순위대로 말해.",
      "바로 쓸 수 있는 다음 행동을 제안해.",
    ],
    sections: ["상황 요약", "핵심 판단", "실행 제안", "확인할 점"],
  };
}

function buildSummary(content) {
  return String(content || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function humanizeRoleName(roleName) {
  const acronyms = {
    ai: "AI",
    api: "API",
    cli: "CLI",
    cpp: "C++",
    devops: "DevOps",
    dx: "DX",
    llm: "LLM",
    m365: "M365",
    ml: "ML",
    mcp: "MCP",
    nlp: "NLP",
    qa: "QA",
    sql: "SQL",
    sre: "SRE",
    ui: "UI",
    ux: "UX",
    websocket: "WebSocket",
  };

  if (titleOverrides[roleName]) {
    return titleOverrides[roleName];
  }

  return roleName
    .split("-")
    .map((token) => acronyms[token] || token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}
