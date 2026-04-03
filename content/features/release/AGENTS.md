# release feature

## 기능 목적
- 릴리스 패널, 최신 버전 확인, 정적 JSON/ZIP 링크 표시를 다룬다.

## 먼저 볼 파일
- `content/release-manager.js`
- `content/release-view.js`
- `shared/release-info.js`

## 관련 프론트 경로
- `background/service-worker.js`
- `releases/release-notes.json`

## 관련 functions 경로
- 없음

## 관련 데이터 경계
- `releases/release-notes.json`
- `hosting/extension/releases/latest.json`
- `hosting/extension/releases/history.json`
- 버전별 ZIP

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-library
- prompt-store
- prompt-review

## 최소 검증 방법
- 릴리스 탭에서 현재 버전, 최신 버전, 다운로드 링크가 보이는지 확인한다.

## 언제 사용자에게 다시 물을지
- 릴리스 UI 문제인지 실제 배포 메타 생성 문제인지 분류가 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 정적 메타만으로 해결되지 않고 background fetch 또는 배포 스크립트가 얽힐 때만 platform/shell로 넓힌다.
