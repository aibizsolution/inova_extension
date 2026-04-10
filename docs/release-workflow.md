# 릴리스 배포 흐름

이 문서는 Chrome Web Store 배포가 아니라 `내부 ZIP 배포 + 수동 재설치/리로드` 환경을 기준으로 작성한다.  
그래서 `latest.zip`을 올렸다고 사용자가 즉시 최신 버전이 된다고 가정하지 않는다.

## 버전 선택 규칙

- `patch`: 버그 수정, 작은 UX 보정, 안정성/운영 보완
- `minor`: 새 기능 추가, 내부 구조 분해, 기존 계약을 유지한 확장
- `major`: 별도 hosted/backend/data 경계가 필요하거나, 기존 계약을 compat shim 없이 유지할 수 없는 변화

### 조건부 major 판단 기준

- 다음 조건을 유지할 수 있으면 `minor`로 간다.
  - 기존 hosted meeting origin/path 유지
  - 기존 Functions export 이름 유지
  - 기존 mutable namespace 유지
  - 기존 auth scope / workspace URL / response envelope 의미 유지
  - 추가 migration 없이 새 ZIP 교체만으로 동작
- 다음 조건이 실제로 필요하면 `major`를 검토한다.
  - 별도 hosted origin/site
  - 별도 endpoint family
  - 별도 mutable namespace 또는 copy migration
  - 기존 auth/url/schema 의미 유지 불가

버전은 작업 시작 전에 고정하지 않는다. 구현 결과가 위 기준을 만족하는지 보고 선택한다.

## 내부 ZIP 배포 모델

- 사용자 배포는 Hosting의 `latest.zip` 또는 버전별 ZIP을 내려받아 수동으로 교체/리로드하는 방식이다.
- 따라서 같은 시점에 여러 ZIP 버전이 공존할 수 있다.
- mixed-version 기간을 전제로 backend/hosting 호환성을 잡아야 한다.
- 배포 보고에는 항상 `새 ZIP 배포 여부`, `hosting 반영 여부`, `functions 반영 여부`, `사용자 reload 필요 여부`를 함께 적는다.
- 다만 내부 배포는 대상 인원과 전환 시점을 어느 정도 제어할 수 있으므로, mixed-version 지원을 무기한으로 두지 않는다.
- 기본값은 `현재 minor + 이전 minor` 지원이며, 각 릴리스 공지에는 `이전 minor 지원 종료 조건` 또는 `예상 전환 완료 시점`을 함께 적는다.

## 호환 범위 정책

- 기본 지원 범위는 `현재 minor + 이전 minor`다.
- 이 범위를 벗어난 클라이언트를 조용히 깨뜨리지 않는다.
- 구조적으로 호환이 어려워지면 compat shim, additive field, dual-read/write, lazy migration을 먼저 검토한다.
- 그래도 흡수할 수 없을 때만 다음 major를 검토한다.
- 내부 ZIP 배포에서는 같은 minor 안의 patch 혼재는 허용하되, `이전 minor`를 넘는 지원은 명시 이유 없이 자동 연장하지 않는다.

### `minSupportedVersion` 메모

- release metadata의 `minSupportedVersion`은 운영 기준선을 설명하는 자리로 취급한다.
- mixed-version 지원 범위가 달라졌다면 이 값이 암묵적으로 남지 않게 의도적으로 검토한다.
- 자동 강제 차단보다 먼저, 문서와 배포 보고에서 어떤 버전까지 지원하는지 명시하는 것을 기본으로 둔다.

## Major가 실제 필요할 때의 lane 정책

- `0.x`는 legacy lane
- `1.x+`는 v2 lane
- `1.1`, `1.2`, `1.3`은 새 lane 없이 같은 v2 lane 안에서 처리
- 공개 prompt store feed/detail은 `1.x 전체에서 shared read-only`

현재 코드의 `major >= 1 => v2` 로직은 이 정책을 위한 hook이지만, `1.0.0` 출시가 확정되었다는 뜻은 아니다.

## 릴리스 메타 규칙

- 모든 feature 변경은 `package.json`, `manifest.json`, `releases/release-notes.json`을 함께 업데이트해야 한다.
- `releases/release-notes.json`은 배포 이력 전체가 아니라, 릴리스 패널과 `latest.zip/latest.json/history.json`에 노출할 사용자용 버전 목록만 유지한다.
- 현재 버전 엔트리에는 다음이 반드시 있어야 한다.
  - `level`
  - `public.headline`
  - `public.summary`
  - `public.changes[]`
- 공개 목록에 계속 남길 이전 버전은 `artifact.fileName`, `artifact.publishedAt`, `artifact.sha256`, `artifact.sizeBytes`를 유지해야 한다.
- `public.headline`, `public.summary`, `public.changes[].text`에 `TODO`가 남아 있으면 `pre-push`와 `release:build`가 실패한다.
- `internal.changes[]`는 선택 사항이며, 내부 운영/배포/구조 변경 기록용이다.
- 릴리스 패널과 Hosting `latest.json`, `history.json`에는 `public` 정보만 반영한다.

## 배포 범위 규칙

- `deploy:hosting`은 Hosting만 배포하며, 기본적으로 확장 ZIP과 릴리스 메타를 갱신하지 않는다.
- `release:deploy`는 `release:build` 후 Hosting만 배포하며, 사용자용 확장 릴리스 메타까지 함께 갱신한다.
- `deploy:functions`는 Firebase Functions만 배포한다.
- `deploy:all`은 Hosting과 Functions를 함께 배포하지만, 기본적으로 사용자용 릴리스 메타를 건드리지 않는다.
- `release:deploy:all`은 `release:build` 후 Hosting과 Functions를 함께 배포한다.
- 기본 해석은 `배포 = hosting-only`다. 함수 배포는 반드시 명시 요청이 있을 때만 진행하는 것을 원칙으로 한다.
- `release:build` 산출 위치는 버전 major에 따라 달라진다.
  - `0.x`는 `hosting/extension/*`
  - `1.x+`는 `hosting/extension-v2/*`

## 배포 경계 체크

- `hosting/meeting/*`, `hosting/extension/*`, 정적 JSON/HTML/CSS 같은 Hosting 자산만 바뀌면 `deploy:hosting`으로 충분하다.
- `functions/*`만 바뀌면 `deploy:functions`로 충분하다.
- `content/*`, `background/*`, `popup/*`, `manifest.json`, 확장 번들에 포함되는 `shared/*`가 바뀌면 Firebase 배포만으로 끝나지 않는다. 실제 ZIP 재배포와 사용자 reload가 필요하다.
- Hosted와 확장 코드가 함께 바뀌면 `Firebase 배포 + 실제 ZIP 배포`를 둘 다 해야 한다.
- Hosted만 바뀐 경우 사용자는 해당 페이지를 새로고침해야 최신 JS를 받는다.
- 확장 코드가 바뀐 경우 개발 환경에서는 압축해제된 확장을 다시 로드해야 하고, 사용자 배포라면 새 ZIP 안내와 reload 안내까지 끝나야 한다.

## Rollback By Surface

### 1. server compatibility hotfix

- mixed-version 운영에서 가장 먼저 검토하는 대응이다.
- 기존 ZIP 사용자를 살리기 위해 endpoint, response, additive fallback을 server-side에서 맞춘다.

### 2. hosting rollback

- hosted asset 문제면 이전 Hosting 자산으로 되돌린다.
- 사용자가 새로고침하기 전까지는 구 JS가 남아 있을 수 있으므로, rollback 보고에 reload 필요 여부를 함께 적는다.

### 3. 이전 ZIP 재배포

- 확장 번들 자체가 원인일 때 이전 ZIP을 다시 배포한다.
- `latest.zip`을 되돌려도 이미 새 ZIP을 받은 사용자는 수동 reload 전까지 계속 새 버전에 머무를 수 있다.
- 따라서 ZIP rollback은 항상 `어떤 ZIP으로 돌아가는지`, `누가 다시 받아야 하는지`, `reload가 필요한지`를 함께 적는다.

## 권장 순서

1. hosted 검증이나 운영 배포만 필요하면 `npm run deploy:hosting` 또는 `npm run deploy:all`을 사용한다.
2. 실제 사용자용 확장 릴리스를 낼 때만 `npm run version:bump -- <patch|minor|major>`로 버전을 올린다.
3. 버전을 올리기 전에 [docs/refactoring-plan.md](docs/refactoring-plan.md)의 `Version Decision Gate` 기준으로 `minor`인지 `major`인지 먼저 판단한다.
4. `releases/release-notes.json`에서 사용자 패널에 남길 버전만 유지하고, 새 공개 버전의 제목, 요약, 변경 항목을 채운다.
5. 실제 기능 변경이 있으면 해당 feature `AGENTS.md` 또는 feature 전용 docs에 변경 내용을 반영한다.
6. `npm run verify`, `npm run verify:feature-doc-guard`, `npm run verify:release-guard`를 확인한다.
7. `npm run release:build`로 공개 ZIP과 Hosting용 릴리스 메타를 생성한다.
8. 공개 릴리스는 `npm run release:deploy` 또는 `npm run release:deploy:all`로 반영한다.
9. 신규 설치가 아니라 `기존 ZIP 사용자가 업그레이드하는 경로`를 우선 확인한다.
10. 팀에 `새 ZIP`, `변경 요약`, `reload 필요 여부`, `지원 중인 버전 범위`, `rollback 시 사용할 이전 ZIP`을 공지한다.

## 배포 보고 형식

- `hosting 배포 완료`만으로 끝내지 말고 아래를 함께 적는다.
  - `functions 반영 여부`
  - `hosting 반영 여부`
  - `새 ZIP 배포 여부`
  - `사용자/개발자 reload 필요 여부`
  - `이전 ZIP으로 되돌릴 필요 여부`
  - `혼재 버전 허용 기간 또는 주의사항`
- 예시:
  - `hosting만 반영됨. 회의 작업실 탭 새로고침 필요, ZIP 재배포는 없음`
  - `functions만 반영됨. 새 요청부터 backend 반영, ZIP 재배포는 없음`
  - `extension bundle 변경 포함. release:build/release:deploy 필요, 사용자 reload와 새 ZIP 안내 필요`
  - `rollback으로 0.4.4 ZIP 재배포. 최신 ZIP을 이미 적용한 사용자는 다시 교체 후 reload 필요`

## 명령

```bash
npm run version:bump -- minor
npm run verify:feature-doc-guard
npm run verify:release-guard
npm run deploy:hosting
npm run release:build
npm run release:deploy
npm run release:deploy:all
npm run deploy:functions
gh pr view 18 --json state,mergedAt,url
git branch -d codex/example-task
```

## 생성 결과

- `releases/inova-extension-<version>-<date>.zip`
- `releases/release-notes.json`
- `hosting/extension/downloads/latest.zip`
- `hosting/extension/releases/latest.json`
- `hosting/extension/releases/history.json`
- `hosting/extension/downloads/<zip>`
- `hosting/extension-v2/releases/latest.json` - `1.x+` lane에서만 생성
- `hosting/extension-v2/releases/history.json` - `1.x+` lane에서만 생성
- `hosting/extension-v2/downloads/<zip>` - `1.x+` lane에서만 생성

## 패키지 가드레일

- `release:build`와 `npm run verify`는 ZIP staging에 `manifest.json`이 참조한 런타임 파일이 모두 들어있는지 확인해야 한다.
- 기본 runtime 디렉터리 밖의 단일 파일이 manifest에 추가되면, 빌드가 그 파일을 자동 포함하거나 누락 시 즉시 실패해야 한다.

## 운영 원칙

- ZIP은 덮어쓰지 않고 버전별로 누적한다.
- 고정 최신 링크 `downloads/latest.zip`은 `releases/release-notes.json`에 남아 있는 사용자용 최신 릴리스 ZIP으로만 교체한다.
- `latest.json`과 `history.json`도 `releases/release-notes.json`에 남긴 공개 버전 목록 기준으로 다시 생성한다.
- `release:build`는 공개 목록에 없는 이전 ZIP을 `releases/`와 Hosting downloads에서 함께 정리한다.
- 문제 발생 시 이전 ZIP을 다시 배포하는 방식으로 롤백할 수 있어야 한다.
