# conversation feature

## 기능 목적
- 현재 대화 화면의 질문 수집, 대화 안에서 찾기, 질문 위치 이동을 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 관련 경계, 최소 검증, durable invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 conversation feature-local 규칙과 계약은 이 문서나 conversation 전용 docs에 문서화한다.

## 먼저 볼 파일
- `content/dom.js`
- `content/bookmark-view.js`
- `content/route-state-controller.js`
- `content/route-watch-controller.js`
- `content/route-sync.js`
- `content/panel-bookmark-controller.js`
- `content/panel-surface-controller.js`
- `content/panel-activity-controller.js`
- `content/panel-shell-controller.js`

## 관련 프론트 경로
- `content/main.js`
- `content/panel-state-factory.js`
- `content/panel-runtime-controller.js`
- `content/panel.js`
- `hosting/extension/panel/bookmark-view.js`

## 관련 functions 경로
- 없음

## 관련 데이터 경계
- DOM 수집 결과
- `sid`
- 패널 UI 상태
- v2 lane에서는 질문 기능 자체는 같지만, panel shell이 읽는 local storage key가 `v2.*` prefix로 분리될 수 있다. route sync는 lane별 storage change만 반영해야 한다.

## 보통 건드리지 말아야 할 범위
- `functions/*`
- `hosting/meeting/*`
- prompts/release 관련 파일

## 최소 검증 방법
- i-Nova 대화 탭에서 질문이 수집되고 항목 클릭으로 원문 위치로 이동하는지 확인한다.

## 언제 사용자에게 다시 물을지
- 질문 수집 문제인지 프롬프트 주입이나 패널 shell 문제인지 구분이 모호할 때만 짧게 확인한다.

## 언제 범위를 확장할지
- feature-local 파일만으로 해결되지 않고 panel shell 또는 storage 연동이 원인일 때만 platform/shell로 넓힌다.

## 구현 경계
- 북마크 검색/복사/점프와 empty/status 문구 계산은 `content/panel-bookmark-controller.js`가 맡고, `content/main.js`는 이를 다시 구현하지 않는다.
- 북마크 panel UI 렌더링은 `hosting/extension/panel/bookmark-view.js`가 맡고, `content/panel.js`는 iframe host와 page adapter만 유지한다.
- panel shell 초기 state 조립은 `content/panel-state-factory.js`가 맡고, `content/main.js`는 기본 state literal을 다시 들고 있지 않는다.
- paused/store/tool-surface 판정과 panel debug 로깅 helper는 `content/panel-runtime-controller.js`가 맡고, `content/main.js`는 이 helper를 다시 구현하지 않는다.
- tool 전환, query 라우팅, handle 위치 저장 같은 공용 panel shell 동작은 `content/panel-shell-controller.js`가 맡는다.
- storage 복원, live bookmark 재수집, route wait fallback은 `content/route-state-controller.js`가 맡고, `content/route-sync.js`는 route 감시와 retry/polling 타이밍만 담당한다.
- history/click/popstate/visibility/poll watcher 설치는 `content/route-watch-controller.js`가 맡고, `content/route-sync.js`는 실제 sync 실행과 observer/retry 타이밍만 담당한다.
- conversation surface poll과 composer/chatlog 반응은 `content/panel-surface-controller.js`가 맡고, `content/panel-lifecycle-controller.js`는 open/focus/visibility/toggle만 담당한다.
- focus/visibility 반응은 `content/panel-activity-controller.js`가 맡고, `content/panel-lifecycle-controller.js`는 open state 초기화와 toggle만 담당한다.
