#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(root, "contracts", "extension-contract.json"), "utf8")
);
const errors = [];

function main() {
  const activeJavaScriptFiles = collectActiveJavaScriptFiles();
  verifyOwnerPattern(
    activeJavaScriptFiles,
    "fetch",
    /\b(?:globalThis\.|global\.|window\.)?fetch\s*\(/g,
    new Set(contract.browserOnlyCapabilityOwners?.fetch || [])
  );
  verifyOwnerPattern(
    activeJavaScriptFiles,
    "chrome.tabs",
    /chrome\.tabs\b/g,
    new Set(contract.browserOnlyCapabilityOwners?.chromeTabs || [])
  );
  verifyOwnerPattern(
    activeJavaScriptFiles,
    "chrome.cookies",
    /chrome\.cookies\b/g,
    new Set(contract.browserOnlyCapabilityOwners?.chromeCookies || [])
  );
  verifyOwnerPattern(
    activeJavaScriptFiles,
    "chrome.storage",
    /chrome\.storage\b/g,
    new Set(contract.browserOnlyCapabilityOwners?.chromeStorage || [])
  );
  verifyOwnerPattern(
    activeJavaScriptFiles,
    "localStorage",
    /\b(?:globalThis\.|global\.|window\.)?localStorage\b/g,
    new Set(contract.browserOnlyCapabilityOwners?.localStorage || [])
  );
  verifyOwnerPattern(
    activeJavaScriptFiles,
    "sessionStorage",
    /\b(?:globalThis\.|global\.|window\.)?sessionStorage\b/g,
    new Set(contract.browserOnlyCapabilityOwners?.sessionStorage || [])
  );
  verifyForbiddenFirebaseSdkBootstrap(activeJavaScriptFiles);
  verifyThinShellStaysOutOfEndpointFamilies(activeJavaScriptFiles);

  if (errors.length) {
    console.error("browser-only boundary 검증 실패");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("[verify-browser-only-boundary] Active extension browser-only boundary passed");
}

function collectActiveJavaScriptFiles() {
  return Array.from(
    new Set([
      ...(contract.activeSharedRootFiles || []),
      ...(contract.activeBackgroundRootFiles || []),
      ...(contract.activeContentRootFiles || []),
      ...(contract.activeContentFeatureFiles || []),
      ...(contract.activePopupRootFiles || []),
    ])
  )
    .filter((relativePath) => relativePath.endsWith(".js"))
    .sort();
}

function verifyOwnerPattern(activeJavaScriptFiles, label, pattern, allowedFiles) {
  if (!allowedFiles.size) {
    errors.push(`${label} owner catalog가 비어 있습니다.`);
    return;
  }

  for (const relativePath of allowedFiles) {
    if (!activeJavaScriptFiles.includes(relativePath)) {
      errors.push(`${label} owner catalog가 active JS에 없는 파일을 가리킵니다: ${relativePath}`);
    }
  }

  for (const relativePath of activeJavaScriptFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    pattern.lastIndex = 0;
    if (!pattern.test(source)) {
      continue;
    }
    if (!allowedFiles.has(relativePath)) {
      errors.push(
        `${relativePath} should not directly use ${label}; move it behind the declared browser capability owner files`
      );
    }
  }
}

function verifyForbiddenFirebaseSdkBootstrap(activeJavaScriptFiles) {
  const forbiddenPatterns = [
    {
      label: "initializeApp",
      pattern: /\binitializeApp\s*\(/,
    },
    {
      label: "signInWithCustomToken",
      pattern: /\bsignInWithCustomToken\s*\(/,
    },
    {
      label: "getAuth",
      pattern: /\bgetAuth\s*\(/,
    },
    {
      label: "getFirestore",
      pattern: /\bgetFirestore\s*\(/,
    },
    {
      label: "connectAuthEmulator",
      pattern: /\bconnectAuthEmulator\s*\(/,
    },
    {
      label: "connectFirestoreEmulator",
      pattern: /\bconnectFirestoreEmulator\s*\(/,
    },
  ];

  for (const relativePath of activeJavaScriptFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(source)) {
        errors.push(
          `${relativePath} should not bootstrap Firebase SDK directly (${forbidden.label}); keep hosted/auth session ownership out of the active extension lane`
        );
      }
    }
  }
}

function verifyThinShellStaysOutOfEndpointFamilies(activeJavaScriptFiles) {
  const allowedEndpointConfigFiles = new Set(contract.browserOnlyEndpointConfigFiles || []);
  const endpointFamilyPatterns = [
    /\bissueInova[A-Za-z0-9_]*\b/,
    /\blistInova[A-Za-z0-9_]*\b/,
    /\breviewInova[A-Za-z0-9_]*\b/,
    /\bpublishPromptToStore\b/,
    /\bunpublishPromptFromStore\b/,
    /\bimportPromptStoreEntry\b/,
    /\btogglePromptStoreLike\b/,
    /\brecordPromptStoreView\b/,
    /\bsyncInovaPromptLibrary\b/,
    /\bcreateInovaMeetingShareLink\b/,
    /\brevokeInovaMeetingShareLink\b/,
    /\blistPromptStoreEntries\b/,
  ];

  for (const relativePath of activeJavaScriptFiles) {
    const isThinShellFile = relativePath.startsWith("content/")
      || relativePath.startsWith("popup/")
      || (relativePath.startsWith("shared/") && !allowedEndpointConfigFiles.has(relativePath));
    if (!isThinShellFile) {
      continue;
    }

    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const leakedPattern = endpointFamilyPatterns.find((pattern) => pattern.test(source));
    if (leakedPattern) {
      errors.push(
        `${relativePath} should stay on browser-only shell responsibility; raw Functions endpoint family names must stay in shared config or background capability modules`
      );
    }
  }
}

main();
