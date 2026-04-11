# content 작업 규칙

- 상위 철학과 모듈화 판단 기준은 `docs/development-philosophy.md`를 따른다.
- `content/` 전체를 먼저 읽지 않는다.
- 먼저 [../docs/feature-routing.md](../docs/feature-routing.md)에서 primary feature를 고른 뒤 `content/features/<feature>/AGENTS.md`부터 읽는다.
- `content/main.js`와 `content/panel.js`는 feature-local 파일과 owned-shared만으로 해결되지 않을 때만 읽는다.
- panel shell 변경은 먼저 `content/main.js`, `content/route-state-controller.js`, `content/route-watch-controller.js`, `content/route-sync.js`, `content/panel-bookmark-controller.js`, `content/panel-shell-controller.js`, `content/panel-meeting-controller.js`, `content/panel-debug-controller.js`, `content/panel-prompt-controller.js`, `content/panel-surface-controller.js`, `content/panel-activity-controller.js`, `content/panel-lifecycle-controller.js`의 책임 경계를 확인하고 시작한다.
- `content/main.js`는 panel shell의 composition root로만 두고, 북마크 흐름/공용 shell/route 상태/route watcher/회의 액션/디버그/prompt shell/surface/activity/lifecycle 책임은 전용 controller에 누적한다.
- 다른 feature로 읽기 범위를 넓히기 전에는 짧게 왜 확장이 필요한지 설명한다.
- content에서는 파일 길이보다 `독립 DOM`, `스타일`, `이벤트 흐름`, `상태`, `lifecycle` 경계를 먼저 본다.
- 항상 같이 로드되고 함께 수정되는 render/helper/controller 조각은 line count만으로 새 파일로 나누지 않는다.
- 별도 파일이나 별도 진입점은 재사용, lazy loading, 독립 controller 상태, 교체 가능한 UI surface가 있을 때 우선 검토한다.

