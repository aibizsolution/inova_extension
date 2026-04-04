# Feature-First 리팩터링 인계 메모

이 문서는 `feature-first` 리팩터링 작업을 다음 세션에서 바로 이어가기 위한 단일 인계 문서다. 다음 세션에서는 이 문서와 `docs/feature-routing.md`만 먼저 읽고 시작한다.

## 현재 목표

- 에이전트가 새 기능 요청을 받을 때 저장소 전체를 먼저 읽지 않도록 만든다.
- 먼저 primary feature를 고르고, 해당 feature 경로와 `AGENTS.md`부터 읽게 만든다.
- `content/`, `functions/`, `hosting/meeting/`을 가능한 한 같은 feature 축으로 정렬한다.
- 세션이 커지기 전에 커밋 경계와 다음 세션 분리를 먼저 제안할 수 있게 한다.

## 이번 세션에서 끝낸 일

- 루트 `AGENTS.md`를 전역 운영 규칙 중심으로 축소했다.
- `docs/feature-routing.md`를 추가해 `conversation`, `prompt-library`, `prompt-store`, `prompt-review`, `meeting`, `release`를 primary feature로 고정했다.
- `content/AGENTS.md`, `functions/AGENTS.md`, `hosting/meeting/AGENTS.md`를 추가해 넓은 탐색 대신 feature 진입을 먼저 하도록 만들었다.
- `content/features/*/AGENTS.md`와 `functions/features/*/AGENTS.md`를 추가해 feature별 먼저 볼 파일, 데이터 경계, 확장 규칙을 적었다.
- Functions를 실제로 feature 축으로 정렬했다.
  - `functions/features/meeting/meeting-launch-service.js`
  - `functions/features/meeting/meeting-service.js`
  - `functions/features/prompt-library/register.js`
  - `functions/features/prompt-store/store-service.js`
  - `functions/features/prompt-review/prompt-review-service.js`
  - `functions/platform/runtime.js`
  - `functions/index.js`는 composition-only에 가깝게 줄였다.
- 문서 경로도 일부 맞췄다.
  - `README.md`
  - `docs/runtime-architecture.md`

## 현재 기준 브랜치와 커밋

- 작업 브랜치: `codex/feature-first-routing`
- 커밋 1: `9322f3b` `refactor: add feature-first routing boundaries`
- 커밋 2: `c531f43` `chore: remove legacy functions entry files`

## 검증 상태

- `npm run verify` 통과
- `functions`에서 `node -e "require('./index.js')"` 통과
- 실제 Chrome 수동 smoke check는 아직 안 했다

## 아직 안 한 일

- `content/` 실제 file move
- `manifest.json` content script 경로 정리
- `hosting/meeting/*.js` 실제 move
- `meeting/` legacy 페이지 정리
- `shared/*` 물리 이동

## 다음 세션 우선순위

1. `content/`의 prompt 계열만 실제로 정리한다.
2. 범위는 `prompt-library`, `prompt-store`, `prompt-review`까지만 제한한다.
3. `meeting`, `release`, `hosting`, `functions`는 기본적으로 건드리지 않는다.
4. `manifest.json`은 꼭 필요한 범위에서만 갱신하고 로드 순서는 유지한다.
5. 범위가 `meeting`이나 `hosting`으로 번지면 바로 세션 분리를 먼저 제안한다.

## 다음 세션 시작 규칙

- 먼저 이 문서와 `docs/feature-routing.md`만 읽는다.
- 그 다음 `content/AGENTS.md`를 읽고, 이번 세션 대상 feature의 `content/features/<feature>/AGENTS.md`만 읽는다.
- `content/main.js`, `content/panel.js`, `background/service-worker.js`, `functions/index.js`, `shared/*`는 feature-local과 owned-shared만으로 해결되지 않을 때만 읽는다.
- 두 번째 primary feature를 읽어야 하거나 `content + functions + hosting` 3축이 동시에 필요해지면 먼저 커밋 또는 다음 세션 분리를 제안한다.

## 다음 세션 프롬프트

```text
이번 세션에서는 inova_extension의 feature-first 리팩터링 2단계로 content 쪽만 실제 정리해라.
반드시 docs/feature-first-refactor-handoff.md와 docs/feature-routing.md를 먼저 읽고 시작해라.
그 다음 content/AGENTS.md와 content/features/prompt-library/AGENTS.md, content/features/prompt-store/AGENTS.md, content/features/prompt-review/AGENTS.md만 읽어라.
meeting, release, hosting, functions는 기본적으로 건드리지 말고, prompt 계열 content 파일만 feature 하위로 옮길 수 있는 최소 안전 단위만 반영해라.
manifest.json의 content script 경로는 꼭 필요한 범위에서만 갱신하고, 로드 순서는 유지해라.
범위가 meeting이나 hosting으로 번지면 바로 멈추고 세션 분리를 먼저 제안해라.
마지막에는 변경 파일, 핵심 이유, 남은 리스크, 다음 단계만 짧게 정리해라.
```

## 작업 중 제외한 항목

- `.codex/`
- `.slack-bridge/`
- `tmp/`

## 참고 파일

- `docs/feature-routing.md`
- `AGENTS.md`
- `content/AGENTS.md`
- `functions/AGENTS.md`
- `hosting/meeting/AGENTS.md`
