# conversation feature

## 기능 목적
- 현재 대화 화면의 질문 수집, 대화 안에서 찾기, 질문 위치 이동을 다룬다.

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
