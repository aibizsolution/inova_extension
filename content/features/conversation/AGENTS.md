# conversation feature

## 기능 목적
- 현재 대화 화면의 질문 수집, 대화 안에서 찾기, 질문 위치 이동을 다룬다.

## 문서 갱신 규칙
- 이 feature의 사용자 체감 동작, 먼저 볼 파일, 검증 기준이 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md` 대신 이 문서나 conversation 전용 docs에 먼저 기록한다.

## 먼저 볼 파일
- `content/dom.js`
- `content/bookmark-view.js`
- `content/route-sync.js`

## 관련 프론트 경로
- `content/main.js`
- `content/panel.js`

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
