const CATEGORY_META = {
  advertising: { id: "advertising", label: "광고/퍼포먼스" },
  marketing: { id: "marketing", label: "마케팅" },
  commerce: { id: "commerce", label: "커머스" },
  sales: { id: "sales", label: "세일즈" },
  "customer-success": { id: "customer-success", label: "고객 성공/CS" },
  hr: { id: "hr", label: "HR/피플" },
  finance: { id: "finance", label: "재무/경영관리" },
  "business-product": { id: "business-product", label: "비즈니스/프로덕트" },
};

const SOURCES = {
  incrossIntro: {
    label: "INCROSS 회사 소개",
    upstream: "https://www.incross.com/ko/company/introduction.asp",
  },
  incrossCompanyDeck: {
    label: "INCROSS Company Introduction PDF",
    upstream: "https://www.incross.com/upload/%ED%9A%8C%EC%82%AC%EC%86%8C%EA%B0%9C%EC%84%9C_KOR_202603_f.pdf",
  },
  openaiMarketing: {
    label: "OpenAI Academy - ChatGPT for marketing",
    upstream: "https://academy.openai.com/en/public/clubs/work-users-ynjqu/resources/use-cases-marketing",
  },
  openaiSales: {
    label: "OpenAI Academy - ChatGPT for sales",
    upstream: "https://academy.openai.com/en/public/clubs/work-users-ynjqu/resources/use-cases-sales",
  },
  openaiCustomerSuccess: {
    label: "OpenAI Academy - ChatGPT for customer success",
    upstream: "https://academy.openai.com/public/clubs/work-users-ynjqu/resources/use-cases-customer-success",
  },
  openaiHr: {
    label: "OpenAI Academy - ChatGPT for HR",
    upstream: "https://academy.openai.com/public/clubs/work-users-ynjqu/resources/use-cases-hr",
  },
  openaiFinance: {
    label: "OpenAI Academy - ChatGPT for finance",
    upstream: "https://academy.openai.com/public/clubs/work-users-ynjqu/resources/use-cases-finance",
  },
  openaiProduct: {
    label: "OpenAI Academy - ChatGPT for product",
    upstream: "https://academy.openai.com/public/clubs/work-users-ynjqu/resources/use-cases-product",
  },
  openaiManagers: {
    label: "OpenAI Academy - ChatGPT for managers",
    upstream: "https://academy.openai.com/en/public/clubs/work-users-ynjqu/resources/use-cases-for-managers",
  },
  shopifyEcommerce: {
    label: "Shopify - Best AI Prompts for Ecommerce",
    upstream: "https://www.shopify.com/ng/blog/ai-prompts",
  },
};

function createPrompt({ audience, objective, inputs, tasks, output, guardrails }) {
  return [
    `당신은 ${audience}를 돕는 업무 보조 AI다.`,
    `목표: ${objective}`,
    "",
    "입력 정보",
    ...inputs.map((item) => `- ${item}`),
    "",
    "해야 할 일",
    ...tasks.map((item) => `- ${item}`),
    "",
    "출력 형식",
    ...output.map((item, index) => `${index + 1}. ${item}`),
    "",
    "주의사항",
    ...guardrails.map((item) => `- ${item}`),
  ].join("\n");
}

function createSeed({ id, title, categoryId, summary, sourceKeys, audience, objective, inputs, tasks, output, guardrails }) {
  const category = CATEGORY_META[categoryId];
  if (!category) {
    throw new Error(`알 수 없는 카테고리예요: ${categoryId}`);
  }

  return {
    categoryId: category.id,
    categoryLabel: category.label,
    entryId: `system__public_business__${id}`,
    slug: id,
    sources: sourceKeys.map((key) => {
      if (!SOURCES[key]) {
        throw new Error(`알 수 없는 소스 키예요: ${key}`);
      }
      return {
        key,
        label: SOURCES[key].label,
        upstream: SOURCES[key].upstream,
      };
    }),
    summary,
    title,
    content: createPrompt({ audience, objective, inputs, tasks, output, guardrails }),
  };
}


module.exports = {
  CATEGORY_META,
  SOURCES,
  createSeed,
};
