# 릴리스 배포 흐름

## 버전 규칙

- `patch`: 버그 수정, 작은 UX 보정, 안정성/운영 보완
- `minor`: 새 기능 추가, 기존 기능의 눈에 띄는 확장
- `major`: 사용 흐름을 깨는 변화, 마이그레이션이나 재설치 판단이 필요한 변화

## 릴리스 메타 규칙

- 모든 feature 변경은 `package.json`, `manifest.json`, `releases/release-notes.json`을 함께 업데이트해야 합니다.
- `releases/release-notes.json`은 배포 이력 전체가 아니라, 릴리스 패널과 상용 `latest.zip/latest.json/history.json`에 노출할 사용자용 버전 목록만 유지합니다.
- `releases/release-notes.json`의 현재 버전 엔트리에는 다음이 반드시 있어야 합니다.
  - `level`
  - `public.headline`
  - `public.summary`
  - `public.changes[]`
- 공개 목록에 계속 남길 이전 버전은 `artifact.fileName`, `artifact.publishedAt`, `artifact.sha256`, `artifact.sizeBytes`를 함께 유지해 CI와 재빌드가 로컬 ZIP 없이도 history 메타를 다시 만들 수 있어야 합니다.
- `public.headline`, `public.summary`, `public.changes[].text`에 `TODO`가 남아 있으면 `pre-push`와 `release:build`가 실패합니다.
- `internal.changes[]`는 선택 사항이며, 내부 운영/배포/구조 변경 기록용입니다.
- 릴리스 패널과 Hosting `latest.json`, `history.json`에는 `public` 정보만 반영합니다.
- `release:build`는 공개 최신 버전보다 낮은 버전으로는 진행할 수 없지만, 같은 공개 버전으로 로컬 재빌드하거나 최종 배포하는 흐름은 허용합니다.
- 로컬 훅이 빠졌더라도 GitHub Actions `Repo Guardrails`가 같은 규칙을 다시 검사합니다.
- PR 머지 후 GitHub 원격 브랜치는 자동 삭제되고, 로컬 `codex/*` 브랜치는 `main` 기준으로 이미 머지된 경우 훅이 자동 정리합니다.
- `auto-merge`를 걸었다고 바로 끝난 것으로 보지 않습니다. 실제 완료 판단은 PR의 `state=MERGED` 확인까지 포함합니다.

## 배포 범위 규칙

- `deploy:hosting`은 Hosting만 배포하며, 기본적으로 확장 패키지 버전과 릴리스 패널 메타를 갱신하지 않습니다.
- `release:deploy`는 `release:build` 후 Hosting만 배포하며, 사용자용 확장 릴리스 메타까지 함께 갱신합니다.
- `deploy:functions`는 Firebase Functions만 배포합니다.
- `deploy:all`은 Hosting과 Functions를 함께 배포하지만, 기본적으로 사용자용 릴리스 메타를 건드리지 않습니다.
- `release:deploy:all`은 `release:build` 후 Hosting과 Functions를 함께 배포합니다.
- 기본 해석은 `배포 = hosting-only` 입니다. 함수 배포는 반드시 명시 요청이 있을 때만 진행하는 것을 원칙으로 합니다.
- 고정 최신 링크는 lane별로 따로 관리합니다.
  - legacy: `https://browser-extension-main.web.app/extension/downloads/latest.zip`
  - v2: `https://browser-extension-v2.web.app/extension/downloads/latest.zip`
- lane 기본값은 버전 major로 정합니다. `0.x`는 legacy lane, `1.x+`는 v2 lane입니다.

## 배포 경계 체크

- `hosting/meeting/*`, `hosting/extension/*`, 정적 JSON/HTML/CSS 같은 Hosting 자산만 바뀌면 `deploy:hosting`으로 충분합니다.
- `release:build` 산출 위치는 lane에 따라 달라집니다. `0.x`는 `hosting/extension/*`, `1.x+`는 `hosting/extension-v2/*`를 사용합니다.
- `functions/*`만 바뀌면 `deploy:functions`로 충분합니다.
- `content/*`, `background/*`, `popup/*`, `manifest.json`, 확장 번들에 포함되는 `shared/*`가 바뀌면 Firebase 배포만으로는 끝나지 않습니다. 실제 확장 버전 빌드/배포가 필요합니다.
- Hosted와 확장 코드가 함께 바뀌면 `Firebase 배포 + 실제 확장 릴리스`를 둘 다 해야 합니다.
- Hosted만 바뀐 경우 사용자는 해당 페이지를 새로고침해야 최신 JS를 받습니다.
- 확장 코드가 바뀐 경우 개발 환경에서는 Chrome의 압축해제된 확장을 다시 로드해야 하고, 사용자 릴리스라면 새 ZIP/새 버전 배포까지 끝나야 합니다.
- 따라서 배포 안내에는 항상 `무엇을 배포했는지`, `페이지 새로고침만 필요한지`, `확장 새로고침/재설치가 필요한지`를 함께 적습니다.

## 권장 순서

1. hosted 검증이나 운영 배포만 필요하면 `npm run deploy:hosting` 또는 `npm run deploy:all`을 사용합니다.
2. 실제 사용자용 확장 릴리스를 낼 때만 `npm run version:bump -- <patch|minor|major>`로 버전을 올립니다.
3. `releases/release-notes.json`에서 사용자 패널에 남길 버전만 유지하고, 새 공개 버전의 제목, 요약, 변경 항목을 채웁니다.
   - 사용자 패널에 보여줄 내용은 `public`에 적습니다.
   - 내부 운영 메모가 필요하면 `internal`에 적습니다.
4. 실제 기능 변경이 있으면 해당 feature `AGENTS.md` 또는 feature 전용 docs에 변경 내용을 반영합니다.
5. 저장소/제품 개요나 설치·배포 흐름 자체가 바뀐 경우에만 `README.md`를 함께 갱신합니다.
6. `npm run verify`, `npm run verify:feature-doc-guard`, `npm run verify:release-guard`를 확인합니다.
7. `npm run release:build`로 공개 ZIP과 Hosting용 릴리스 메타를 생성합니다.
   - `0.x`는 legacy release lane을 갱신합니다.
   - `1.x+`는 v2 release lane을 갱신합니다.
8. 공개 릴리스는 `npm run release:deploy` 또는 `npm run release:deploy:all`로 반영합니다.
9. Chrome 신규 설치/기존 설치를 각각 확인합니다.
10. 팀에 `새 ZIP`, `변경 요약`, `Reload 필요 여부`를 공지합니다.
11. PR에 `auto-merge`를 걸었으면 `gh pr view <번호> --json state,mergedAt,url` 또는 GitHub UI에서 실제 `MERGED` 상태와 완료 시각을 확인합니다.
12. 머지가 확인되면 `git checkout main` 후 `git pull --ff-only origin main`으로 로컬 기준 브랜치를 최신으로 맞춥니다.
13. 그다음 작업 브랜치를 정리합니다.
    - 일반 merge로 `git branch --merged main`에 잡히면 `git branch -d <branch>`
    - squash/rebase처럼 local tip이 `main` 조상으로 안 잡혀도 PR이 `MERGED`로 확인된 `codex/*` 브랜치는 `git branch -D <branch>`로 정리 가능

## 배포 보고 형식

- `hosting 배포 완료`만으로 끝내지 말고, `functions 반영 여부`, `hosting 반영 여부`, `확장 버전 배포 필요 여부`, `사용자/개발자 새로고침 필요 여부`를 함께 적습니다.
- PR 마감 보고에는 `auto-merge 설정 여부`, `실제 merged 확인 여부`, `로컬 branch 정리 여부`도 함께 적습니다.
- 예시:
  - `hosting만 반영됨. 회의 작업실 탭 새로고침 필요, 확장 새로고침은 불필요`
  - `functions만 반영됨. 새 요청부터 backend 반영, 확장 새로고침은 불필요`
  - `extension bundle 변경 포함. release:build/release:deploy 필요, 개발 환경은 chrome://extensions에서 Reload 필요`
  - `PR #18 auto-merge 후 merged 확인 완료, local codex/firebase-function-runtime-tuning 삭제 완료`

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

- `release:build`와 `npm run verify`는 ZIP staging에 `manifest.json`이 참조한 런타임 파일이 모두 들어있는지 확인해야 합니다.
- 기본 runtime 디렉터리 밖의 단일 파일이 manifest에 추가되면, 빌드가 그 파일을 자동 포함하거나 누락 시 즉시 실패해야 합니다.

## 운영 원칙

- ZIP은 덮어쓰지 않고 버전별로 누적합니다.
- 고정 최신 링크 `downloads/latest.zip`은 `releases/release-notes.json`에 남아 있는 사용자용 최신 릴리스 ZIP으로만 교체합니다.
- `latest.json`과 `history.json`도 `releases/release-notes.json`에 남긴 공개 버전 목록 기준으로 다시 생성합니다.
- `release:build`는 공개 목록에 없는 이전 ZIP을 `releases/`와 `hosting/extension/downloads/`에서 함께 정리합니다.
- `latest.json`, `history.json`에는 버전 번호뿐 아니라 `level`, `headline`, `summary`, `changes`를 함께 넣습니다.
- 릴리스 패널은 위 메타 중 사용자용 `public` 정보만 읽어 버전별 업데이트 내용을 보여줍니다.
- 문제 발생 시 이전 ZIP을 다시 받아 같은 방식으로 롤백할 수 있습니다.
