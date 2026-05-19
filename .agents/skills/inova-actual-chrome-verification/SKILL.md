---
name: inova-actual-chrome-verification
description: Verify the i-Nova Chrome extension in the user's connected real Chrome profile. Use when the user asks to test or inspect the installed extension, says to use @Chrome, asks whether a UI flow really works in Chrome, or needs actual Chrome evidence for inova.incross.com, hosted panel, popup, opener/session, tab launch, console, network, or extension reload behavior.
---

# i-Nova Actual Chrome Verification

## Overview

Use this skill to verify the installed `아이노바 실험실` extension in the user's real Chrome profile. The goal is evidence from the same class of browser surface the user sees: page DOM, visible UI state, console warnings/errors, network or runtime symptoms when available, and whether the extension/hosted panel flow actually works.

Detailed E2E criteria live in `docs/e2e-browser-workflow.md`; use that document when the task expands into feature smoke or full regression.

## Workflow

1. Confirm `cwd` and `git status --short --branch`, then preserve the user's live Chrome session. Do not close existing Chrome tabs or disconnect the browser session unless the user explicitly asks for cleanup.
2. If the Browser plugin is available, follow its setup first. Choose the connected `Chrome` surface for actual Chrome verification. Do not use the Codex in-app browser as a substitute when the request is about the installed extension or the user's logged-in Chrome state.
3. Inspect available browser surfaces and tabs. If `Chrome` is not available, say so clearly and stop before claiming actual Chrome evidence.
4. Prefer reusing a relevant controllable Chrome tab. If the user's existing `https://inova.incross.com/` tab appears in `openTabs` but cannot be attached as an automation tab, do not treat that as product failure.
5. When attach fails, open a new tab in the same `Chrome` surface and navigate to `https://inova.incross.com/`. This is still valid actual Chrome evidence because it uses the same Chrome profile, login session, and installed extension. Report it as `새 Chrome 탭 기반 actual Chrome 검증`.
6. Collect the smallest evidence set that answers the request: redacted URL and title, key visible DOM text, console warning/error count and messages, relevant iframe `src` or target state, and screenshots only when visual judgment matters.
7. For hosted panel, popup target, opener/session, and new-tab flows, separate source-tab launch evidence from destination-page evidence. If you directly navigate a controlled tab to a known launch/prepared URL, report it as `URL 기반 직접 이동으로 내부 테스트`.
8. Never expose raw launch tokens, session tokens, access tokens, cookies, or sensitive query strings in logs or final reports. Redact to origin/path unless the exact non-secret value is necessary.
9. If browser control disconnects or returns page/context/browser closed errors, stop browser actions and ask the user to restart the Codex Windows app. Do not say a click or Chrome verification completed after the connection failed.

## Report Format

Keep reports short and evidence-first:

- Verification surface: `실제 Chrome`, `새 Chrome 탭 기반 actual Chrome 검증`, or `URL 기반 직접 이동으로 내부 테스트`.
- Target: local hosting, production Hosting, or extension reload/new ZIP.
- Evidence: visible state, console warnings/errors, and any network/runtime issue.
- Limits: what was not verified, especially if the user's already-open physical tab was not directly controlled.
