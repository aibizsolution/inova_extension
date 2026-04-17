# conversation feature

## 기능 목적
- 현재 대화 화면의 질문/응답 수집, 현재 화면 기준 예상 컨텍스트와 선택 모델 기준 길이 신호, 대화 안에서 찾기, 질문 위치 이동을 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 관련 경계, 최소 검증, durable invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 conversation feature-local 규칙과 계약은 이 문서나 conversation 전용 docs에 문서화한다.

## 먼저 볼 파일
- `content/dom.js`
- `content/route-state-controller.js`
- `content/route-watch-controller.js`
- `content/route-sync.js`
- `content/panel-v2-composition-controller.js`
- `content/panel-v2-shell-bridge.js`
- `backup/legacy-panel/bookmark-view.js`
- `backup/legacy-panel/panel-bookmark-controller.js`

## 관련 프론트 경로
- `content/main.js`
- `content/panel.js`
- `hosting/extension/panel/bookmark-view.js`
- `hosting/extension-v2/panel/conversation-controller.js`
- `hosting/extension-v2/panel/bookmark-view.js`
- `backup/legacy-panel/bookmark-view.js` - inactive content bookmark view reference
- `backup/legacy-panel/panel-runtime-controller.js` - inactive runtime helper reference
- `backup/legacy-panel/tools.css` - inactive content tool-shell style reference

## 관련 functions 경로
- 없음

## 관련 데이터 경계
- DOM 수집 결과
- Q/A 예상 컨텍스트 길이, 선택 모델 라벨, hosted 모델 컨텍스트 프로필 설정
- `sid`
- 패널 UI 상태
- v2 lane에서는 질문 기능 자체는 같지만, panel shell이 읽는 local storage key가 `v2.*` prefix로 분리될 수 있다. route sync는 lane별 storage change만 반영해야 한다.

## 관련 capabilityId
- `page.conversation.read-state`: 현재 대화 snapshot 읽기.
- `page.conversation.jump-item`: 질문 원문 위치 이동.
- `page.clipboard.write-text`: 질문 복사.
- `page.scroll-to`, `page.highlight-range`, `page.read-selection`, `page.show-banner`, `page.dispatch-named-event`: remote workflow가 조합할 수 있는 named page primitive. raw selector/HTML/JS는 금지한다.

## 보통 건드리지 말아야 할 범위
- `functions/*`
- `hosting/meeting/*`
- prompts/release 관련 파일

## 최소 검증 방법
- i-Nova 대화 탭에서 질문이 수집되고 예상 컨텍스트/길이 신호가 표시되며 항목 클릭으로 원문 위치로 이동하는지 확인한다.

## 언제 사용자에게 다시 물을지
- 질문 수집 문제인지 프롬프트 주입이나 패널 shell 문제인지 구분이 모호할 때만 짧게 확인한다.

## 언제 범위를 확장할지
- feature-local 파일만으로 해결되지 않고 panel shell 또는 storage 연동이 원인일 때만 platform/shell로 넓힌다.

## 구현 경계
- 현재 i-Nova DOM의 active 수집 기준은 `[aria-label="채팅 메시지 목록"]` 아래 `article` 순회다. 사용자 질문은 legacy `.chat-message--user` selector를 fallback으로 보되, assistant 응답은 첫 번째 직계 자식의 `aria-label`이 `Provider: 모델명` 형태인지로 우선 판별한다. 현재 선택 모델은 채팅 로그 바깥의 모델 선택 `button` 텍스트에서 provider label을 우선 읽고, 실패하면 마지막 assistant provider label을 fallback으로 쓴다. 응답 전문은 hosted panel로 전달하지 않고 content page adapter에서 예상 컨텍스트 길이로 요약하며, hosted UI는 이 추정치를 모델 한도 사용률이 아닌 hosted `conversation-context-profiles.json` 기준 길이 신호로만 표시한다. 옵션/beta/header/게이트웨이 설정이 필요한 확장 컨텍스트는 보수적으로 `extendedLimit` 메타로만 표시하고 기본 `limit`를 게이지 기준으로 쓴다.
- active `1.0.0` bundle에서는 북마크 검색/복사/점프와 compact snapshot shaping을 `content/panel-v2-composition-controller.js` 안의 conversation bridge가 맡고, `backup/legacy-panel/panel-bookmark-controller.js`는 legacy reference로만 남긴다.
- 북마크 panel UI 렌더링은 `hosting/extension/panel/bookmark-view.js`와 `hosting/extension-v2/panel/bookmark-view.js`가 맡고, `content/panel.js`는 iframe host와 page adapter만 유지한다. 기존 `content/bookmark-view.js`와 `content/tools.css`는 inactive reference로 `backup/legacy-panel/*`에 격리한다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/conversation-controller.js`가 대화 탭의 검색/복사/점프/view state를 소유하고, extension은 `content/panel.js`의 page adapter로 현재 대화 snapshot 읽기와 jump/copy만 제공한다. v2 top-panel snapshot은 전체 bookmark item list를 싣지 않고 `count`, `activeId`, refresh용 `snapshotFingerprint` 같은 얇은 신호만 전달한다. 대화 읽기/이동/복사는 handshake의 `page.conversation.read-state`, `page.conversation.jump-item`, `page.clipboard.write-text` capability가 enabled일 때만 UI와 실행 경로를 연다.
- panel shell 초기 state 조립은 active `1.0.0` bundle에서 `content/panel-v2-composition-controller.js`가 맡고, `content/main.js`는 그 createState 진입점만 호출한다.
- paused/store/tool-surface 판정과 panel debug 로깅 helper는 active `1.0.0` bundle에서 `content/panel-v2-composition-controller.js` 안의 inline runtime/debug bridge가 맡고, `backup/legacy-panel/panel-runtime-controller.js`와 `backup/legacy-panel/panel-debug-controller.js`는 reference로만 남긴다.
- tool 전환, query 라우팅, handle 위치 저장 같은 공용 panel shell 동작은 active `1.0.0` bundle에서 `content/panel-v2-shell-bridge.js`가 맡는다.
- storage 복원, live bookmark 재수집, route wait fallback은 `content/route-state-controller.js`가 맡고, `content/route-sync.js`는 route 감시와 retry/polling 타이밍만 담당한다.
- history/click/popstate/visibility/poll watcher 설치는 `content/route-watch-controller.js`가 맡고, `content/route-sync.js`는 실제 sync 실행과 observer/retry 타이밍만 담당한다.
- conversation surface poll, open/visibility/toggle, focus 반응은 active `1.0.0` bundle에서 `content/panel-v2-shell-bridge.js`가 맡고, `content/panel-v2-composition-controller.js`는 그 shell bridge wiring만 담당한다.
