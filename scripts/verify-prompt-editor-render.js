#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifyHostedPromptEditorValidationContract();
  console.log("[verify-prompt-editor-render] Hosted prompt editor render contract passed");
}

function verifyHostedPromptEditorValidationContract() {
  const context = vm.createContext({
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {};
  const source = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "prompt-view.js"),
    "utf8"
  );
  new vm.Script(source, {
    filename: "hosting/extension-v2/panel/prompt-view.js",
  }).runInContext(context);

  const baseState = {
    actionPending: null,
    canSync: true,
    deletePromptId: "",
    editor: {
      actionPending: null,
      canSync: true,
      content: "",
      description: "테스트 요청을 저장합니다.",
      error: "",
      id: "",
      mode: "create",
      open: true,
      submitLabel: "추가",
      title: "",
      titleText: "새 요청 추가",
    },
    emptyText: "아직 저장한 요청이 없어요.",
    feedback: null,
    importReview: null,
    items: [],
    loading: false,
    query: "",
    totalCount: 0,
  };

  const emptyEditorHtml = context.InovaBookmarks.promptView.render(baseState);
  assert(
    /data-prompt-action="save-editor"[^>]*disabled/.test(emptyEditorHtml),
    "prompt editor save button should stay disabled until title and content are present"
  );

  const readyEditorHtml = context.InovaBookmarks.promptView.render({
    ...baseState,
    editor: {
      ...baseState.editor,
      content: "본문",
      title: "제목",
    },
  });
  assert(
    /data-prompt-action="save-editor"(?:(?!disabled).)*>추가<\/button>/s.test(readyEditorHtml),
    "prompt editor save button should be enabled after title and content are present"
  );
}

main();
