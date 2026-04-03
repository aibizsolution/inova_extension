#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(root, "contracts", "extension-contract.json"), "utf8")
);
const requiredFiles = [
  "manifest.json",
  "README.md",
  path.join(".githooks", "pre-push"),
  path.join("docs", "feature-spec.md"),
  "popup/index.html",
  "popup/index.js",
  path.join("meeting", "index.html"),
  path.join("meeting", "index.js"),
  path.join("scripts", "install-git-hooks.js"),
  "shared/prompt-library.js",
  path.join("scripts", "verify-readme-update.js"),
  "content/main.js",
  "content/prompt-hub-state.js",
  "content/prompt-hub-panel.js",
  "content/prompt-hub-controller.js",
  "content/prompt-hub-runtime.js",
  "content/features/prompt-library/files.js",
  "content/features/prompt-library/prompt-manager.js",
  "content/panel.css",
  "content/tools.css",
];

const keywordGroups = [
  {
    name: "팝업 작업실 연결 설정",
    patterns: [/팝업\s*작업실\s*연결\s*설정/i, /상용\s*호스팅/i, /로컬\s*호스팅/i],
  },
  {
    name: "질문 자동 모으기",
    patterns: [/질문\s*자동\s*모으기/, /질문\s*모아보기/, /현재\s*대화/],
  },
  {
    name: "우측 슬라이드 패널",
    patterns: [/우측\s*슬라이드\s*패널/, /슬라이드\s*패널/, /오른쪽\s*슬라이드/],
  },
  {
    name: "대화 안에서 찾기",
    patterns: [/대화\s*안에서\s*찾기/, /이\s*대화에서\s*질문\s*찾기/, /검색\s*패널/],
  },
  {
    name: "자주 쓰는 요청",
    patterns: [/자주\s*쓰는\s*요청/, /요청\s*보관함/, /입력창에\s*바로\s*넣/],
  },
  {
    name: "요청 가져오기/내보내기",
    patterns: [/가져오기/, /내보내기/, /완전\s*교체|병합|추가/],
  },
  {
    name: "모듈 구조",
    patterns: [/shared/i, /meetingWorkspaceTarget/, /settings/],
  },
];

const readmeOnlyKeywordGroups = [
  {
    name: "Git 훅 가드",
    patterns: [/pre-push/i, /README\.md/, /hooks:install|verify:readme-guard/],
  },
];

const codeChecks = [
  {
    file: "manifest.json",
    patterns: [
      /"default_popup"\s*:\s*"popup\/index\.html"/,
      /"shared\/constants\.js"/,
      /"content\/main\.js"/,
      /"content\/panel\.css"/,
      /"content\/tools\.css"/,
      /"matches"\s*:\s*\[\s*"https:\/\/inova\.incross\.com\/\*"\s*\]/s,
    ],
  },
  {
    file: "popup/index.js",
    patterns: [/meetingWorkspaceTarget/, /meetingWorkspaceUrlOverride/, /updateSettings/, /workspaceTargetHint/],
  },
  {
    file: "content/main.js",
    patterns: [
      /promptManager/,
      /renderPanel/,
    ],
  },
  {
    file: "meeting/index.js",
    patterns: [
      /meetingBridge\.startMeetingCapture/,
      /meetingBridge\.createMeetingJob/,
      /recordList/,
    ],
  },
  {
    file: "content/route-sync.js",
    patterns: [
      /collectUserMessages/,
      /syncRouteState/,
    ],
  },
  {
    file: "content/dom.js",
    patterns: [
      /MutationObserver/,
      /data-inova-bookmark-id/,
    ],
  },
  {
    file: "shared/constants.js",
    patterns: [
      /\.chat-message--user/,
      /pausedSessions/,
    ],
  },
  {
    file: "shared/session.js",
    patterns: [
      /searchParams\.get\("sid"\)/,
      /buildMessageId/,
    ],
  },
  {
    file: "shared/storage.js",
    patterns: [
      /chrome\.storage\.local/,
      /pausedSessions/,
      /promptLibrary/,
      /updateSettings/,
    ],
  },
  {
    file: "shared/prompt-library.js",
    patterns: [
      /parseImportText/,
      /buildExportPayload/,
      /applyImport/,
    ],
  },
  {
    file: "content/features/prompt-library/prompt-manager.js",
    patterns: [
      /handleImportFile/,
      /applyPromptText/,
      /downloadJson/,
    ],
  },
];

function main() {
  const errors = [];

  for (const file of requiredFiles) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`필수 파일이 없습니다: ${file}`);
    }
  }

  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath, errors);
  if (manifest) {
    const popupOk = manifest.action && manifest.action.default_popup === contract.manifestPopup;
    const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    const hasContentScript = contentScripts.some((entry) => {
      const js = Array.isArray(entry.js) ? entry.js : [];
      const css = Array.isArray(entry.css) ? entry.css : [];
      const matches = Array.isArray(entry.matches) ? entry.matches : [];
      return (
        contract.manifestContentScripts.every((file) => js.includes(file)) &&
        contract.manifestContentCss.every((file) => css.includes(file)) &&
        matches.includes("https://inova.incross.com/*")
      );
    });

    if (!popupOk) {
      errors.push(`manifest.json에 default_popup = ${contract.manifestPopup} 이 없습니다.`);
    }
    if (!hasContentScript) {
      errors.push("manifest.json에 inova.incross.com용 content script 선언이 없습니다.");
    }
  }

  for (const file of ["README.md", path.join("docs", "feature-spec.md")]) {
    const text = readText(path.join(root, file), errors);
    if (!text) continue;
    for (const group of keywordGroups) {
      if (!group.patterns.some((pattern) => pattern.test(text))) {
        errors.push(`${file}에 핵심 기능 키워드가 부족합니다: ${group.name}`);
      }
    }
  }

  const readmeText = readText(path.join(root, "README.md"), errors);
  if (readmeText) {
    for (const group of readmeOnlyKeywordGroups) {
      if (!group.patterns.some((pattern) => pattern.test(readmeText))) {
        errors.push(`README.md에 핵심 운영 키워드가 부족합니다: ${group.name}`);
      }
    }
  }

  for (const check of codeChecks) {
    const text = readText(path.join(root, check.file), errors);
    if (!text) continue;
    for (const pattern of check.patterns) {
      if (!pattern.test(text)) {
        errors.push(`${check.file}에 필요한 구현 단서가 없습니다: ${pattern}`);
      }
    }
  }

  for (const keyword of contract.requiredDocKeywords) {
    const spec = readText(path.join(root, "docs", "feature-spec.md"), errors);
    if (!readmeText.includes(keyword) && !spec.includes(keyword)) {
      errors.push(`문서에 계약 키워드가 없습니다: ${keyword}`);
    }
  }

  if (errors.length > 0) {
    console.error("문서/코드 검증 실패");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("문서/코드 검증 통과");
}

function readText(filePath, errors) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    errors.push(`파일을 읽을 수 없습니다: ${path.relative(root, filePath)} (${error.message})`);
    return "";
  }
}

function readJson(filePath, errors) {
  const text = readText(filePath, errors);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`JSON 파싱 실패: ${path.relative(root, filePath)} (${error.message})`);
    return null;
  }
}

main();
