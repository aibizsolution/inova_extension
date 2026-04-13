# functions prompt-review feature

## 기능 목적
- 프롬프트 평가와 보완안 생성 backend를 다룬다.

## 먼저 볼 파일
- `functions/features/prompt-review/prompt-review-service.js`

## 관련 프론트 경로
- `content/features/prompt-review/prompt-review-manager.js`
- `hosting/extension-v2/panel/prompt-review-view.js`
- `backup/legacy-panel/prompt-review-view.js`

## 관련 functions 경로
- `functions/index.js`
- `functions/platform/*`

## 관련 데이터 경계
- `reviewInovaPrompt` 호출
- 검토 rate-limit 문맥

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-library
- prompt-store
- release

## 최소 검증 방법
- `reviewInovaPrompt` export 이름은 유지하고, `reviewProfile`이 비어 있을 때 `legacy-v1` 4축 응답 shape이 그대로 유지되는지 확인한다.
- `prompt-telling-v2` opt-in 요청에서는 6축 id 순서와 `core/refinement` group 메타, 서버 계산 총점이 고정적으로 내려오는지 확인한다.

## 언제 사용자에게 다시 물을지
- 평가 UX 문제인지 backend 응답 문제인지 분류가 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 공통 helper나 OpenAI 설정 주입이 필요할 때만 `functions/platform/*`과 `functions/index.js`를 읽는다.

## 구현 경계
- backend 기본 profile은 반드시 `legacy-v1`이다. `prompt-telling-v2`는 새 확장 버전이 명시적으로 opt-in 할 때만 활성화한다.
- `legacy-v1`는 현재 4축 `context/goal/constraints/output` 계약과 모델 총점을 유지하고, `prompt-telling-v2`만 `Persona/Reference/Objective/Mode/Point of View/Tone` 6축과 서버 계산 총점을 사용한다.
