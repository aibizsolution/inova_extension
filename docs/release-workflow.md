# 릴리스 배포 흐름

이 문서는 Chrome Web Store가 아니라 `내부 ZIP 배포 + 수동 재설치/리로드` 환경을 기준으로 한다.  
그래서 이 문서는 `무엇을 배포하고 어떤 재로딩이 필요한지`와 version lane 판단 기준을 함께 정한다.

## 버전 선택 규칙

- `patch`: 버그 수정, 작은 UX 보정, 안정성/운영 보완
- `minor`: 새 기능 추가, 내부 구조 정리, 기존 계약을 유지한 확장
- `major`: 별도 hosted/backend/data 경계가 필요하거나 기존 계약을 compat shim 없이 유지할 수 없는 변화
- 실제 `minor`/`major` 선택은 변경의 사용자 영향, 데이터/호스팅/함수 호환성, 기존 ZIP 사용자의 upgrade 경로를 기준으로 결정한다.

## 내부 ZIP 배포 모델

- 사용자 배포는 Hosting의 `latest.zip` 또는 버전별 ZIP을 내려받아 수동으로 교체/리로드하는 방식이다.
- 같은 시점에 여러 ZIP 버전이 공존할 수 있으므로 mixed-version 기간을 전제로 backend/hosting 호환성을 잡는다.
- 기본 지원 범위는 `현재 minor + 이전 minor`다.
- 배포 보고에는 항상 `새 ZIP 배포 여부`, `hosting 반영 여부`, `functions 반영 여부`, `reload 필요 여부`를 함께 적는다.
- 보고할 때는 사용자가 확인해야 할 대상이 `로컬 호스팅/에뮬레이터`인지 `상용 Hosting`인지 `새 ZIP을 설치한 확장`인지 먼저 밝힌다. 로컬 확인만 끝난 상태를 상용 반영처럼 말하지 않고, 상용 배포 후에도 사용자가 로컬 target을 보고 있을 수 있으면 확인해야 할 URL 또는 패널 target을 함께 적는다.

## 릴리스 메타 규칙

- 기능 변경 릴리스는 `package.json`, `manifest.json`, `releases/release-notes.json`을 함께 업데이트한다.
- `releases/release-notes.json`은 패널과 hosting 메타에 노출할 사용자용 버전만 유지한다.
- 현재 버전 엔트리에는 아래가 반드시 있어야 한다.
  - `level`
  - `public.headline`
  - `public.summary`
  - `public.changes[]`
- 공개 목록에 남길 현재/이전 버전은 모두 `artifact.fileName`, `artifact.publishedAt`, `artifact.sha256`, `artifact.sizeBytes`, `artifact.minSupportedVersion`을 유지한다.
- `release:build`는 현재 버전 ZIP을 만든 뒤 `releases/release-notes.json` 현재 버전 엔트리에도 그 artifact 메타를 backfill한다.
- 기본 `npm.cmd run verify`와 `node scripts/verify-release-package.js`는 현재 lane의 `latest.json`, `history.json`, `downloads/latest.zip`, version ZIP, `releases/release-notes.json` curated 목록이 서로 일치하는지, 그리고 history에 올라온 모든 공개 버전이 curated notes에도 artifact를 갖고 있는지도 함께 본다.
- `TODO`가 남은 공개 메타는 `pre-push`와 `release:build`가 막는다.

## 배포 범위 규칙

- 이 Firebase 프로젝트에서 Auth만 공유 리소스로 보고, Functions/Firestore/Hosting/Storage는 기능별 경계만 배포한다.
- `hosting/*`만 바뀌면 `deploy:hosting`으로 충분하다. 이 명령은 `hosting:main,hosting:v2` target만 배포한다.
- `functions/*`만 바뀌면 `deploy:functions`로 충분하다. 이 명령은 `functions:inova-extension-api` codebase만 배포한다.
- Firestore Rules/Indexes는 운영 데이터 경계가 바뀐 경우에만 `deploy:firestore:inova-db`로 `(default)` database에 명시적으로 반영한다. `(default)`는 i-Nova extension 전용 DB로 예약한다.
- Storage Rules는 기본 배포 표면에서 제외한다. Storage를 운영 배포하려면 먼저 전용 bucket target을 만든 뒤 `storage:<target>` 배포 스크립트를 별도 추가한다.
- 같은 Firebase project에 공존하는 Stellaize Team 리소스(`stellaize-team` Hosting, `stellaize-team-api` Functions codebase, `stellaize-team` Firestore database, `browser-extension-main-stellaize-team` Storage bucket, `APIFY_TOKEN` secret)는 이 저장소의 배포 target으로 잡지 않는다.
- `firebase deploy`, `firebase deploy --only functions`, `firebase deploy --only hosting`, `firebase deploy --only firestore`, `firebase deploy --only storage` 같은 broad deploy는 금지한다.
- `content/*`, `background/*`, `popup/*`, `manifest.json`, 확장 번들에 포함되는 `shared/*`가 바뀌면 Firebase 배포만으로 끝나지 않는다.
- hosted와 확장 코드가 함께 바뀌면 `Firebase 배포 + 실제 ZIP 배포`를 둘 다 해야 한다.
- hosted만 바뀐 경우 사용자는 페이지 새로고침이 필요하고, 확장 코드가 바뀐 경우는 새 ZIP 안내와 확장 reload가 필요하다.

## 권장 순서

1. 위 버전 선택 규칙으로 `patch`, `minor`, `major` 중 필요한 수준을 먼저 결정한다.
2. 필요할 때만 `npm run version:bump -- <patch|minor|major>`로 버전을 올린다.
3. `releases/release-notes.json`에서 공개 버전 목록과 현재 버전의 사용자용 메타를 채운다.
4. 실제 기능 변경이 있으면 해당 feature `AGENTS.md` 또는 feature 전용 docs와 `docs/e2e-browser-workflow.md`/`docs/e2e/features/*`의 브라우저 테스트 항목을 먼저 갱신한다.
5. 상용 배포나 `release:build` 전에 `npm run verify`, `npm run verify:feature-doc-guard`, `npm run verify:e2e-doc-guard`, `npm run verify:release-guard`를 확인한다.
6. 공개 릴리스가 필요하면 `npm run release:build` 후 `npm run release:deploy` 또는 `npm run release:deploy:all`을 수행한다.
7. hosted-only, functions-only 운영 배포면 `deploy:hosting`, `deploy:functions`, `deploy:all` 중 필요한 범위만 수행한다. Firestore는 DB 경계 변경이 있을 때만 `deploy:firestore:inova-db`로 별도 반영하고, Storage Rules는 전용 target이 생기기 전까지 운영 배포 대상에서 제외한다.
8. 상용 `OPENAI_API_KEY`는 Firebase Functions Secret Manager secret으로 관리한다. `.env`에 평문 키를 넣어 배포하지 않는다.
9. 회의 임시 오디오 Storage 설정은 `FIREBASE_CONFIG.storageBucket`을 기본으로 둔다. `STORAGE_BUCKET_URL`을 쓸 때도 앱용 bucket만 지정하고 Cloud Functions 내부 `gcf-v2-*` bucket은 지정하지 않는다.
10. 배포 후에는 기존 ZIP 사용자가 업그레이드하는 경로와 reload 필요 여부를 먼저 공지한다.

## 1.0.0+ 운영 기준

- 현재 공개 기준선은 hosted-first `1.0.0+` v2 lane이다.
- 0.4.4 retirement 이후에는 legacy panel backup/reference source를 유지하지 않는다.
- 구조 cleanup은 active v2 bundle이 실제로 싣는 runtime surface를 줄이는 경우에만 진행한다. 과거 구현 확인은 git history나 archive 문서를 참고한다.
- 공개 전 Chrome smoke와 release-go 판단은 수동 운영 게이트로 봐도 된다. 새 코드 작업은 그 검증에서 실제 이슈가 나올 때만 다시 연다.
- `1.0.0+` 공개 ready 최소 기준은 아래다.
  - `npm.cmd run verify` green
  - 실제 Chrome에서 hosted v2 panel boot, prompt library/store/review, meeting hub/workspace launch, release latest/history/download smoke 기록 확보
  - feature usage 변경이 포함됐거나 상용 풀 테스트를 수행하면 meaningful action 1회 후 `check:feature-usage`로 사용자별 aggregate 반영 확인
  - `release:build` 또는 동등한 release rehearsal에서 lane-local `latest.json`, `history.json`, `downloads/latest.zip`, version ZIP, `releases/release-notes.json` curated metadata가 함께 맞는지 확인
  - 사용자 공지에 `hosting 반영`, `새 ZIP 배포`, `확장 reload 필요 여부`, `rollback ZIP`이 함께 정리됨
- 0.4.4 retirement 자체는 extension patch나 새 ZIP을 요구하지 않는 repo cleanup으로 닫혔다. 이후 배포 보고에서는 변경 파일이 실제 runtime bundle에 포함되는지 기준으로 ZIP 필요 여부를 판단한다.

## 배포 보고 형식

- `functions 반영 여부`
- `hosting 반영 여부`
- `새 ZIP 배포 여부`
- `사용자가 확인해야 할 대상: 로컬 호스팅/에뮬레이터, 상용 Hosting, 새 ZIP/확장 새로고침 중 무엇인지`
- `사용자/개발자 reload 필요 여부`
- `0.4.4 retirement 상태`
- `rollback 시 사용할 이전 ZIP`
- `혼재 버전 허용 기간 또는 주의사항`

예시:

- `hosting만 반영됨. 회의 작업실 새로고침 필요, ZIP 재배포는 없음`
- `functions만 반영됨. 새 요청부터 backend 반영, ZIP 재배포는 없음`
- `확장 번들 변경 포함. release:build/release:deploy 필요, 사용자 reload와 새 ZIP 안내 필요`
- `0.4.4 retirement 정리는 repo 기준 완료. 이번 변경이 hosting metadata뿐이면 ZIP 재배포는 없음`

## 명령

```bash
npm run version:bump -- minor
npm run verify:feature-doc-guard
npm run verify:e2e-doc-guard
npm run verify:release-guard
npm run deploy:hosting
npm run deploy:functions
npm run deploy:firestore:inova-db
npm run release:build
npm run release:deploy
npm run release:deploy:all
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
- `hosting/extension-v2/*` 결과물은 `1.x+` lane에서만 생성한다.

## 운영 원칙

- ZIP은 덮어쓰지 않고 버전별로 누적한다.
- 고정 최신 링크 `downloads/latest.zip`은 공개 목록에 남아 있는 최신 사용자 릴리스 ZIP으로만 교체한다.
- `latest.json`과 `history.json`도 공개 버전 목록 기준으로 다시 생성한다.
- 문제 발생 시 이전 ZIP을 다시 배포하는 방식으로 rollback할 수 있어야 한다.
