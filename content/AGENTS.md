# content 작업 규칙

- 상위 철학과 모듈화 판단 기준은 `docs/development-philosophy.md`를 따른다.
- `content/` 전체를 먼저 읽지 않는다.
- 먼저 [../docs/feature-routing.md](../docs/feature-routing.md)에서 primary feature를 고른 뒤 `content/features/<feature>/AGENTS.md`부터 읽는다.
- `content/main.js`와 `content/panel.js`는 feature-local 파일과 owned-shared만으로 해결되지 않을 때만 읽는다.
- panel shell 변경은 먼저 `content/main.js`, `content/panel-state-factory.js`, `content/panel-runtime-controller.js`, `content/panel-action-controller.js`, `content/panel-prompt-bridge-controller.js`, `content/panel-composition-controller.js`, `content/route-state-controller.js`, `content/route-watch-controller.js`, `content/route-sync.js`, `content/panel-bookmark-controller.js`, `content/panel-shell-controller.js`, `content/panel-meeting-controller.js`, `content/panel-debug-controller.js`, `content/panel-prompt-controller.js`, `content/panel-surface-controller.js`, `content/panel-activity-controller.js`, `content/panel-lifecycle-controller.js`, `content/panel-render-controller.js`, `content/panel-bootstrap-controller.js`의 책임 경계를 확인하고 시작한다.
- `content/main.js`는 panel shell의 composition root로만 두고, 초기 state 조립은 `content/panel-state-factory.js`, paused/store/tool-surface/error/debug helper는 `content/panel-runtime-controller.js`, meeting/debug action routing은 `content/panel-action-controller.js`, prompt shell 외부 어댑터는 `content/panel-prompt-bridge-controller.js`, controller graph 조립은 `content/panel-composition-controller.js`, 북마크 흐름/공용 shell/route 상태/route watcher/회의 액션/디버그/prompt shell/surface/activity/lifecycle/render/bootstrap 책임은 전용 controller에 누적한다.
- panel shell 1차 리팩토링은 현재 구조 기준으로 사실상 마감으로 본다. 기본 경계는 `content/main.js`(state 생성 + composition bootstrap), `content/panel-composition-controller.js`(controller graph 조립), `content/panel.js`(단일 DOM surface + 이벤트 위임 + render cache)로 고정한다.
- `content/route-sync.js`와 `content/panel.js`는 실제 버그나 새 요구가 생기기 전까지 다음 기본 리팩토링 대상으로 잡지 않는다.
- 앞으로 panel shell 안에서 새 controller를 더 만드는 기준은 `독립 lifecycle`, `독립 테스트/교체 가치`, `다른 표면 재사용`, `현재 경계로 반복 버그 수정이 어려운 경우`로 제한한다.
- 다른 feature로 읽기 범위를 넓히기 전에는 짧게 왜 확장이 필요한지 설명한다.
- content에서는 파일 길이보다 `독립 DOM`, `스타일`, `이벤트 흐름`, `상태`, `lifecycle` 경계를 먼저 본다.
- 항상 같이 로드되고 함께 수정되는 render/helper/controller 조각은 line count만으로 새 파일로 나누지 않는다.
- 별도 파일이나 별도 진입점은 재사용, lazy loading, 독립 controller 상태, 교체 가능한 UI surface가 있을 때 우선 검토한다.

