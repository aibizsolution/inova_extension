# release feature

## 기능 목적
- 릴리스 패널, 최신 버전 확인, 정적 JSON/ZIP 링크 표시를 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 릴리스 메타 경계, 최소 검증, durable invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 release feature-local 규칙과 계약은 이 문서나 release 전용 docs에 문서화한다.

## 먼저 볼 파일
- `hosting/extension-v2/panel/release-controller.js`
- `hosting/extension-v2/panel/release-view.js`

## 관련 프론트 경로
- `background/service-worker.js`
- `hosting/extension-v2/panel/release-controller.js`
- `hosting/extension-v2/panel/release-view.js`
- `hosting/extension/panel/release-view.js`
- `releases/release-notes.json`

## 관련 functions 경로
- 없음

## 관련 데이터 경계
- `releases/release-notes.json`
- `hosting/extension/releases/latest.json`
- `hosting/extension/releases/history.json`
- 버전별 ZIP
- `1.0.0+` v2 lane은 `hosting/extension-v2/releases/latest.json`, `hosting/extension-v2/releases/history.json`, `hosting/extension-v2/downloads/*`를 사용한다.

## 관련 capabilityId
- `release.download.open`: `browser.open-url` kind로 다운로드 ZIP을 연다.
- `release.download.latest`: `release.download.open` alias seed. 제거 기한은 manifest `aliases`의 `removeAfter`를 따른다.
- 새 release URL path는 기존 Hosting origin이면 `urlTemplates` 추가와 Hosting 배포만으로 처리한다. 새 origin은 extension 재배포 대상이다.

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

## 릴리스 메타 경계
- lane 기본값은 버전 major로 정한다. `0.x`는 legacy lane, `1.x+`는 v2 lane이다.
- `0.4.4` retirement 이후 legacy release fetch/open-url reference는 별도 backup source로 보존하지 않는다. 과거 동작 확인은 git history를 사용한다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/release-controller.js`가 latest/history fetch, 다운로드 액션, release count/view state를 소유하고, extension은 브라우저 URL 열기 broker만 유지한다. release summary를 `tool-summary-sync`나 content state로 되돌려 저장하지 않는다.
- `release:build`는 공개 최신 버전보다 낮은 버전으로는 진행할 수 없지만, 같은 공개 버전으로 로컬 재빌드/최종 배포하는 흐름은 허용한다.
- `deploy:hosting`과 `deploy:all`은 hosted 검증/운영 배포용이며, 기본적으로 확장 패키지 버전과 사용자 릴리스 메타를 갱신하지 않는다.
- 실제 사용자 패널에 보일 버전만 `releases/release-notes.json`에 남기고, `release:build`는 그 목록만 `latest.json`, `history.json`, `latest.zip`에 반영하며 공개 목록 밖의 로컬/hosting ZIP도 정리한다.
- `release:build` 산출 경로는 lane에 따라 다르다. `0.x`는 `hosting/extension/*`, `1.x+`는 `hosting/extension-v2/*`를 갱신한다.
- 공개 목록에 남길 현재/이전 버전은 `releases/release-notes.json`에 artifact 메타를 유지해, CI나 새 환경에서도 history 메타를 다시 생성할 수 있게 관리한다.
- `release:build`는 현재 버전 ZIP을 만든 뒤 같은 current version 엔트리의 `artifact` 메타도 `releases/release-notes.json`에 backfill해야 한다.
- 기본 `npm.cmd run verify`와 `node scripts/verify-release-package.js`는 현재 lane의 `latest.json`, `history.json`, `downloads/latest.zip`, version ZIP, `releases/release-notes.json` curated 목록이 서로 어긋나지 않는지도 함께 확인해야 한다. history/latest에 올라온 공개 버전은 current version까지 포함해 curated notes에도 artifact 메타가 있어야 한다.
- `release:build`는 기본 runtime 디렉터리뿐 아니라 `manifest.json`이 직접 참조하는 추가 파일도 ZIP에 포함해야 하며, staging 결과에 누락이 있으면 바로 실패해야 한다.
- `content/*`, `background/*`, `popup/*`, `manifest.json`, 확장 번들에 포함되는 `shared/*` 변경은 Firebase 배포만으로 끝나지 않는다. 실제 확장 버전 빌드/배포와 Chrome 확장 새로고침까지 포함해 안내한다.
- `hosting/*`만 바뀐 경우는 hosting 배포와 페이지 새로고침으로 끝날 수 있지만, 사용자에게는 `탭 새로고침 필요 여부`와 `확장 Reload 불필요 여부`를 함께 전달한다.
- `auto-merge`를 걸었으면 그 순간을 완료로 보지 않는다. `gh pr view <번호> --json state,mergedAt,url` 또는 GitHub UI에서 실제 `MERGED`를 확인한 뒤에만 릴리스/배포 작업이 완전히 닫힌 것으로 본다.
- 실제 merged 확인 후에는 `git checkout main`, `git pull --ff-only origin main`으로 로컬 기준을 맞추고, 해당 `codex/*` 브랜치를 삭제한다. squash/rebase로 `git branch --merged`에 안 잡혀도 PR이 merged로 확인된 브랜치는 로컬 정리 대상으로 본다.
