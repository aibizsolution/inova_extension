# content 작업 규칙

- 상위 철학과 모듈화 판단 기준은 `docs/development-philosophy.md`를 따른다.
- `content/` 전체를 먼저 읽지 않는다.
- 먼저 [../docs/feature-routing.md](../docs/feature-routing.md)에서 primary feature를 고른 뒤 `content/features/<feature>/AGENTS.md`부터 읽는다.
- `content/main.js`, `content/panel.js`, `content/hosted-panel-bridge.js`는 feature-local 파일과 owned-shared만으로 해결되지 않을 때만 읽는다.
- 현재 `1.0.0` 확장 번들은 panel을 `content/panel-v2-composition-controller.js`로만 부팅한다. `backup/legacy-panel/panel-composition-controller.js`, `backup/legacy-panel/panel-action-controller.js`, `backup/legacy-panel/panel-meeting-controller.js`, `backup/legacy-panel/meeting-manager.js`는 활성 bundle이 아니라 legacy reference/source로만 본다.
- 현재 `1.0.0` 활성 bundle과 공유 계약이 더 이상 쓰지 않는 legacy panel 코드는 `content/*` 안에 계속 섞어 두지 않는다. 다음 정리 기본값은 `backup/legacy-panel/*`로 격리해 참고본으로만 남기는 것이다.
- panel shell 변경은 먼저 `content/main.js`, `content/panel-v2-composition-controller.js`, `content/panel-v2-shell-bridge.js`, `content/panel.js`, `content/hosted-panel-bridge.js`, `content/route-state-controller.js`, `content/route-watch-controller.js`, `content/route-sync.js`, `content/panel-v2-prompt-controller.js`의 책임 경계를 확인하고 시작한다.
- `content/main.js`는 panel shell의 composition root로만 두고, 현재 활성 controller graph 조립과 초기 state 조립은 `content/panel-v2-composition-controller.js`가 맡는다. paused/tool-surface/error/debug helper, active conversation bridge, panel-local provider identity sync는 같은 v2 composition에 두고, tool 전환/query/handle 저장을 포함한 open/visibility/surface/bootstrap/render bridge는 `content/panel-v2-shell-bridge.js`로 모은다. v2 prompt tool shell/controller wiring은 `content/panel-v2-prompt-controller.js`가 맡되 책임은 review float와 review-triggered handoff/prompt-tab persistence까지만 유지하고, generic `prompts/store` tool 선택이나 hosted-owned prompt tab/search/library/store/editor state mirror, store load/storage/sync sidecar는 더 이상 extension prompt controller나 route hydration에 두지 않는다. legacy prompt shell reference는 `backup/legacy-panel/panel-prompt-controller.js`, legacy bookmark/runtime/debug reference는 `backup/legacy-panel/panel-bookmark-controller.js`, `backup/legacy-panel/panel-runtime-controller.js`, `backup/legacy-panel/panel-debug-controller.js`, 공용 route 상태/route watcher 책임은 전용 controller에 누적한다.
- panel shell 현재 baseline은 `content/main.js`(state 생성 + v2 composition bootstrap), `content/panel-v2-composition-controller.js`(v2 controller graph 조립), `content/panel-v2-shell-bridge.js`(tool/open/visibility/surface/bootstrap/render bridge), `content/panel.js`(iframe host + page adapter), `content/hosted-panel-bridge.js`(hosted postMessage contract + top-panel request helper)로 본다.
- 현재 `content/hosted-panel-bridge.js`의 active request helper는 v2 hosted panel이 실제로 쓰는 `summary sync`, `release`, `conversation bookmark`, shell/runtime/page contract만 유지한다. legacy `meeting-action` / prompt action request path는 active `1.0.0` bundle의 보존 대상이 아니다.
- `content/panel.js`는 runtime target 선택에서도 feature helper를 직접 고르지 않는다. panel iframe target은 `shared/firebase-config.js`의 `firebaseConfig.panel.resolveRuntime()`를 통해 받아 generic host + broker 역할만 유지한다.
- 현재 `1.0.0` hosted panel UI 변경은 먼저 `hosting/extension-v2/panel/*`에서 해결할 수 있는지 확인하고, `content/panel.js`와 `content/hosted-panel-bridge.js`는 iframe host/bridge 계약 자체가 바뀔 때만 수정한다.
- `content/route-sync.js`와 `content/panel.js`는 실제 버그나 새 요구가 생기기 전까지 다음 기본 리팩토링 대상으로 잡지 않는다.
- 앞으로 panel shell 안에서 새 controller를 더 만드는 기준은 `독립 lifecycle`, `독립 테스트/교체 가치`, `다른 표면 재사용`, `현재 경계로 반복 버그 수정이 어려운 경우`로 제한한다.
- 다른 feature로 읽기 범위를 넓히기 전에는 짧게 왜 확장이 필요한지 설명한다.
- content에서는 파일 길이보다 `독립 DOM`, `스타일`, `이벤트 흐름`, `상태`, `lifecycle` 경계를 먼저 본다.
- 항상 같이 로드되고 함께 수정되는 render/helper/controller 조각은 line count만으로 새 파일로 나누지 않는다.
- 별도 파일이나 별도 진입점은 재사용, lazy loading, 독립 controller 상태, 교체 가능한 UI surface가 있을 때 우선 검토한다.
