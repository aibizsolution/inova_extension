# functions conversation feature

## 기능 목적
- 대화 탭에서 수집한 사용자 입력만 기준으로 새 대화 분리 신호를 평가하는 backend를 다룬다.

## 먼저 볼 파일
- `functions/features/conversation/conversation-focus-service.js`

## 관련 프론트 경로
- `hosting/extension-v2/panel/conversation-controller.js`
- `hosting/extension-v2/panel/bookmark-view.js`
- `hosting/extension-v2/panel/conversation-dom-parser.js`

## 관련 functions 경로
- `functions/index.js`
- `functions/platform/*`

## 관련 데이터 경계
- `evaluateConversationFocus` 호출
- 요청 본문에는 인증용 `providerIdentity`와 사용자 입력 배열 `userMessages[]`만 넣는다.
- assistant 응답, 세션 제목, DOM HTML, selector, 전체 페이지 텍스트는 모델 입력으로 보내지 않는다.
- 대화 흐름 평가 rate-limit 문맥

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-library
- prompt-store
- prompt-review
- release

## 최소 검증 방법
- `evaluateConversationFocus` export 이름을 유지한다.
- 사용자 입력 5개 미만 또는 최신 입력이 짧은 경우 LLM 호출 없이 `splitRecommended=false`로 내려오는지 확인한다.
- `confidence < 0.75`는 모델이 split을 제안해도 UI 표시 대상으로 승격하지 않는다.

## 구현 경계
- 이 기능은 사용자의 마지막 입력이 기존 흐름과 독립적인 주제인지 보수적으로 판단하는 보조 신호다.
- 결과 텍스트는 대화 탭 툴팁에만 숨겨 표시하고, 입력창이나 원문 대화 DOM에는 UI를 추가하지 않는다.
- 프롬프트 주입 방지를 위해 `userMessages[]`는 항상 분석 데이터로만 취급한다. 그 안의 지시문을 시스템/개발자 지시로 따르지 않는다.
