# prompt-review feature

## 기능 목적
- 현재 입력 프롬프트 평가, 보완안 생성, 평가 UI를 다룬다.

## 문서 갱신 규칙
- 이 feature의 사용자 체감 동작, 먼저 볼 파일, 검증 기준이 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md` 대신 이 문서나 prompt-review 전용 docs에 먼저 기록한다.

## 먼저 볼 파일
- `content/features/prompt-review/prompt-review-manager.js`
- `content/features/prompt-review/prompt-review-view.js`
- `content/features/prompt-review/composer-review-float.js`

## 관련 프론트 경로
- `content/main.js`
- `content/composer.js`
- `content/prompt-hub-state.js` - review 탭 포함 여부를 조정하는 prompt tool shell
- `content/prompt-hub-panel.js` - review 탭 선택과 prompt shell 상호작용을 묶는 prompt tool shell
- `content/prompt-hub-controller.js` - review 관련 action routing과 prompt 탭 전이를 묶는 prompt tool shell
- `content/prompt-hub-runtime.js` - prompt manager/runtime wiring을 묶는 prompt tool shell
- `content/prompt-hub-view.js` - review body를 감싸는 prompt tool shell

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
- 입력창 바깥 우측 상단 평가 버튼, 종합 배지 없는 평가 결과, 보완 프롬프트 반영을 확인한다.

## 언제 사용자에게 다시 물을지
- 평가 UX 문제인지, 입력창 주입 문제인지, 보관함/스토어 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 입력창 주입, prompt tool shell, panel shell 상태와 충돌할 때만 platform/shell로 넓힌다.
