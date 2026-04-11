const js = require("@eslint/js");
const globals = require("globals");

const recommendedRules = {
  ...js.configs.recommended.rules,
  "no-control-regex": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "preserve-caught-error": "error",
  "no-unused-vars": "error",
};

module.exports = [
  {
    ignores: [
      ".claude/**",
      ".codex/**",
      ".codex-local/**",
      ".firebase/**",
      ".playwright-cli/**",
      ".playwright-mcp/**",
      "functions/node_modules/**",
      "node_modules/**",
      "output/**",
      "test-results/**",
      "tmp/**",
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: [
      "background/**/*.js",
      "content/**/*.js",
      "hosting/**/*.js",
      "popup/**/*.js",
      "shared/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
        ...globals.worker,
      },
    },
    rules: recommendedRules,
  },
  {
    files: [
      "eslint.config.js",
      "scripts/**/*.js",
      "test-support/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: recommendedRules,
  },
  {
    files: ["functions/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: recommendedRules,
  },
];
