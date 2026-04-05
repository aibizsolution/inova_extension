# release feature

## 기능 목적
- 릴리스 패널, 최신 버전 확인, 정적 JSON/ZIP 링크 표시를 다룬다.

## 문서 갱신 규칙
- 이 feature의 사용자 체감 동작, 릴리스 메타 경계, 먼저 볼 파일, 검증 기준이 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md` 대신 이 문서나 release 전용 docs에 먼저 기록한다.

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

## 릴리스 메타 메모
- 이미 `hosting/extension/releases/latest.json`에 올라간 버전은 재사용하지 않는다.
- `deploy:hosting`과 `deploy:all`은 hosted 검증/운영 배포용이며, 기본적으로 확장 패키지 버전과 사용자 릴리스 메타를 갱신하지 않는다.
- 실제 사용자 패널에 보일 버전만 `releases/release-notes.json`에 남기고, `release:build`는 그 목록만 `latest.json`, `history.json`, `latest.zip`에 반영하며 공개 목록 밖의 로컬/hosting ZIP도 정리한다.
- `release:build`는 기본 runtime 디렉터리뿐 아니라 `manifest.json`이 직접 참조하는 추가 파일도 ZIP에 포함해야 하며, staging 결과에 누락이 있으면 바로 실패해야 한다.
