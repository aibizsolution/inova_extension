# functions prompt-review feature

## 기능 목적
- 프롬프트 평가와 보완안 생성 backend를 다룬다.

## 먼저 볼 파일
- `functions/features/prompt-review/prompt-review-service.js`

## 관련 프론트 경로
- `content/prompt-review-manager.js`
- `content/prompt-review-view.js`

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
- `reviewInovaPrompt` export 이름과 응답 스키마가 유지되는지 확인한다.

## 언제 사용자에게 다시 물을지
- 평가 UX 문제인지 backend 응답 문제인지 분류가 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 공통 helper나 OpenAI 설정 주입이 필요할 때만 `functions/platform/*`과 `functions/index.js`를 읽는다.
