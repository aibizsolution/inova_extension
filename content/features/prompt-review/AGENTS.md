# prompt-review feature

## 기능 목적
- 현재 입력 프롬프트 평가, 보완안 생성, 평가 UI를 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 관련 경계, 최소 검증, durable invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 prompt-review feature-local 규칙과 계약은 이 문서나 prompt-review 전용 docs에 문서화한다.

## 먼저 볼 파일
- `content/features/prompt-review/prompt-review-manager.js`
- `content/features/prompt-review/prompt-review-view.js`
- `content/features/prompt-review/composer-review-float.js`

## 관련 프론트 경로
- `content/panel-prompt-controller.js` - prompt tool shell composition root
- `content/panel-prompt-bridge-controller.js` - panel shell이 prompt tool shell을 좁은 계약으로 참조하는 외부 adapter
- `content/main.js` - panel shell composition root, prompt shell 직접 구현 금지
- `content/composer.js`
- `content/prompt-hub-state.js` - review 탭 포함 여부를 조정하는 prompt tool shell
- `content/prompt-hub-panel.js` - review 탭 선택과 prompt shell 상호작용을 묶는 prompt tool shell
- `content/prompt-hub-controller.js` - review 관련 action routing과 prompt 탭 전이를 묶는 prompt tool shell
- `content/prompt-hub-runtime.js` - prompt manager/runtime wiring을 묶는 prompt tool shell
- `content/prompt-hub-view.js` - review body를 감싸는 prompt tool shell
- `hosting/extension/panel/prompt-review-view.js` - hosted panel review view
- `hosting/extension/panel/prompt-hub-view.js` - hosted panel prompt tool shell view

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
- 입력창 바깥 우측 상단 평가 버튼, `총점 n점`과 `?` 도움말이 보이는지, `빠른 보완 포인트 -> 보완 프롬프트 -> 기준 항목 평가` 순서로 결과가 열리는지, 보완 프롬프트가 문장 단위 줄바꿈으로 읽히는지, 우측 `복사` 버튼이 동작하는지, 대괄호 placeholder가 남았을 때 `입력창에 반영한 뒤 직접 수정`이 드러나는 경고/버튼 문구를 확인한다.
- `prompt-telling-v2` opt-in 버전에서는 기준 항목 평가가 `핵심 구조 (PRO)` 3개와 `정교화 요소 (MPT)` 3개, 총 6개 항목으로 나뉘어 보이는지 확인한다.
- 아티팩트 상세 패널이 열린 상태에서 편집기를 띄워도 `프롬프트 검토` 버튼 anchor는 채팅 composer를 유지해야 하고, 패널 편집기 우측 상단으로 이탈하면 안 된다.
- 간헐 이슈 조사 시 먼저 top 콘솔에서 `inova:review`, `inova:functions`, `inova:panel` 로그로 `외부 검토 버튼 -> review 요청 -> backend 호출 -> snapshot/open/result 상태`가 실제로 어디까지 진행됐는지 확인한다.

## 언제 사용자에게 다시 물을지
- 평가 UX 문제인지, 입력창 주입 문제인지, 보관함/스토어 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 입력창 주입, prompt tool shell, panel shell 상태와 충돌할 때만 platform/shell로 넓힌다.

## 구현 경계
- `reviewInovaPrompt` 요청에서 `reviewProfile`이 비어 있으면 backend 기본값은 반드시 `legacy-v1`이어야 한다. 0.4.4 사용자는 기존 4축 평가를 그대로 유지하고, 새 확장 버전만 `prompt-telling-v2`를 opt-in 한다.
- `0.4.5`부터 panel 안의 review UI는 hosted panel iframe이 렌더링하고, composer anchor와 review action/state는 기존 content controller가 계속 소유한다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/prompt-review-controller.js`가 `검토` 탭의 review/copy/apply/placeholder-confirm` 상태를 hosted 쪽에서 먼저 소유한다. extension은 `get-composer-state`, `apply-prompt-text` 같은 page adapter와 `reviewInovaPrompt` runtime broker만 제공하고, review 탭 전이 자체는 prompt tool shell이 계속 맡는다. top-panel snapshot에는 hosted review tab이 외부 검토 요청을 이어받을 수 있도록 최소 review handoff signal만 남긴다.
- 새 클라이언트는 `prompt-telling-v2` 6축 응답과 `legacy-v1` 4축 응답을 모두 렌더링할 수 있어야 한다.
- placeholder token 감지는 한 줄 안의 단순 `[...]` 토큰만 대상으로 유지한다. nested bracket이나 줄바꿈이 섞인 텍스트는 placeholder 경고 후보로 넓히지 않는다.
- composer 선택은 textarea 같은 구체적인 채팅 입력 selector를 우선하고, broad `contenteditable` 후보는 앞선 tier가 없을 때만 고려한다.
