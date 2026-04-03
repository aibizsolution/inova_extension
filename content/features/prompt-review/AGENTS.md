# prompt-review feature

## 기능 목적
- 현재 입력 프롬프트 평가, 보완안 생성, 평가 UI를 다룬다.

## 먼저 볼 파일
- `content/features/prompt-review/prompt-review-manager.js`
- `content/features/prompt-review/prompt-review-view.js`
- `content/features/prompt-review/composer-review-float.js`

## 관련 프론트 경로
- `content/main.js`
- `content/composer.js`

## 관련 functions 경로
- `functions/features/prompt-review/prompt-review-service.js`

## 관련 데이터 경계
- 원격 저장소 없음
- Functions `reviewInovaPrompt`
- 검토 rate-limit 기록

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-library
- prompt-store
- release

## 최소 검증 방법
- 입력창 우측 상단 평가 버튼, 평가 결과, 보완 프롬프트 반영을 확인한다.

## 언제 사용자에게 다시 물을지
- 평가 UX 문제인지, 입력창 주입 문제인지, 보관함/스토어 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 입력창 주입이나 panel shell 상태와 충돌할 때만 platform/shell로 넓힌다.
