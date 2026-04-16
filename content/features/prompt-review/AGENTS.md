# prompt-review feature

## 기능 목적
- 현재 입력 프롬프트 평가, 보완안 생성, 평가 UI를 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 관련 경계, 최소 검증, durable invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 prompt-review feature-local 규칙과 계약은 이 문서나 prompt-review 전용 docs에 문서화한다.

## 먼저 볼 파일
- `content/features/prompt-review/prompt-review-manager.js`
- `hosting/extension-v2/panel/prompt-review-controller.js`
- `hosting/extension-v2/panel/prompt-review-view.js`
- `content/features/prompt-review/composer-review-float.js`

## 관련 프론트 경로
- `content/panel-v2-prompt-controller.js` - v2 review handoff + composer review float shell
- `content/main.js` - panel shell composition root, prompt shell 직접 구현 금지
- `content/composer.js`
- `backup/legacy-panel/prompt-hub-state.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-panel.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-controller.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-runtime.js` - inactive legacy prompt shell reference
- `hosting/extension-v2/panel/prompt-review-controller.js` - hosted panel review state/action ownership
- `hosting/extension-v2/panel/prompt-review-view.js` - hosted panel review view
- `hosting/extension-v2/panel/prompt-tool-view.js` - hosted panel prompt tool shell view
- `backup/legacy-panel/prompt-review-view.js` - inactive legacy content view reference
- `backup/legacy-panel/prompt-hub-view.js` - inactive legacy prompt tool shell view reference

## 관련 functions 경로
- `functions/features/prompt-review/prompt-review-service.js`

## 관련 데이터 경계
- 원격 저장소 없음
- Functions `reviewInovaPrompt`
- 검토 rate-limit 기록

## 관련 capabilityId
- `prompt.review.run`: prompt review Functions 호출.
- `page.composer.read-state`: 현재 입력창 읽기.
- `page.composer.apply-text`: 다듬은 프롬프트 입력창 반영.
- `page.clipboard.write-text`, `page.trace.log`: 복사와 trace page primitive.

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-library
- prompt-store
- release

## 최소 검증 방법
- 입력창 바깥 우측 상단 평가 버튼, 결과 헤더 우측에 `n/100` 점수 칩과 `?` 도움말이 보이고 본문 첫 줄에 결론 문구가 보이는지, `바로 고칠 점 -> 다듬은 프롬프트 -> 기준 항목 평가` 순서로 결과가 열리는지, 다듬은 프롬프트가 문장 단위 줄바꿈으로 읽히는지, 우측 `복사`와 `입력창에 반영` 버튼이 같은 줄에 있는지 확인한다.
- `prompt-telling-v2` opt-in 버전에서는 기준 항목 평가가 `기본 정보` 3개와 `표현 방식` 3개, 총 6개 항목으로 나뉘어 보이는지 확인한다.
- 아티팩트 상세 패널이 열린 상태에서 편집기를 띄워도 `프롬프트 검토` 버튼 anchor는 채팅 composer를 유지해야 하고, 패널 편집기 우측 상단으로 이탈하면 안 된다.
- 간헐 이슈 조사 시 먼저 top 콘솔에서 `inova:review`, `inova:functions`, `inova:panel` 로그로 `외부 검토 버튼 -> review 요청 -> backend 호출 -> snapshot/open/result 상태`가 실제로 어디까지 진행됐는지 확인한다.

## 언제 사용자에게 다시 물을지
- 평가 UX 문제인지, 입력창 주입 문제인지, 보관함/스토어 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 입력창 주입, prompt tool shell, panel shell 상태와 충돌할 때만 platform/shell로 넓힌다.

## 구현 경계
- `reviewInovaPrompt` 요청에서 `reviewProfile`이 비어 있으면 backend 기본값은 반드시 `legacy-v1`이어야 한다. 0.4.4 사용자는 기존 4축 평가를 그대로 유지하고, 새 확장 버전만 `prompt-telling-v2`를 opt-in 한다.
- `prompt.review.run`은 LLM 호출이라 기본 hosted bridge timeout 15초보다 길 수 있다. manifest의 `requestTimeoutMs`를 통해 75초로 열고, client cap 120초를 넘기지 않는다.
- `0.4.5`부터 panel 안의 review UI는 hosted panel iframe이 렌더링한다. legacy lane에서는 composer anchor와 review action/state를 content controller가 계속 소유한다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/prompt-review-controller.js`가 `검토` 탭의 review/copy/apply 상태와 review action 라우팅, escape dismiss까지 hosted 쪽에서 소유한다. extension은 `composer.read-state`, `composer.apply-text`, `clipboard.write-text`, `trace.log` 같은 stable page adapter capability와 `reviewInovaPrompt` runtime broker, `content/panel-v2-prompt-controller.js` 기반 composer review float + external handoff signal만 제공한다. 이 capability 이름은 active lane의 canonical contract로 보고, caller migration이 끝난 뒤 `apply-prompt-text`나 `copy-text` 같은 alias를 계속 남기지 않는다. top-panel snapshot에는 monotonic `requestId` 기반 external review activation signal만 남기고, review result/error/open/pending 상태는 다시 싣지 않는다.
- v2 composer review float 클릭은 `requestId` 신호만 증가시킨다. `activeTool`, `activePromptTab`, panel open 상태, UI preference 저장은 hosted prompt controllers가 소유하므로 content prompt shell에서 직접 변경하지 않는다.
- v2 composer review float은 hosted review의 `pending/result/error/open` 상태를 미러링하지 않는다. float은 composer anchor에 붙은 요청 트리거만 담당하고, 진행/결과/오류 표시는 hosted review tab inline UI가 담당한다.
- 새 클라이언트는 `prompt-telling-v2` 6개 항목 응답과 `legacy-v1` 4개 항목 응답을 모두 렌더링할 수 있어야 한다.
- 대괄호 토큰 감지는 한 줄 안의 단순 `[...]` 토큰만 대상으로 유지한다. nested bracket이나 줄바꿈이 섞인 텍스트는 경고 후보로 넓히지 않는다. 새 backend 프롬프트는 대괄호 빈칸 생성을 금지하지만, 과거 결과나 모델 일탈을 사용자가 직접 확인할 수 있도록 경고는 남긴다.
- composer 선택은 textarea 같은 구체적인 채팅 입력 selector를 우선하고, broad `contenteditable` 후보는 앞선 tier가 없을 때만 고려한다.
