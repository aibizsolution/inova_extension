# 릴리스 배포 흐름

## 버전 규칙

- `patch`: 버그 수정, 작은 UX 보정, 안정성/운영 보완
- `minor`: 새 기능 추가, 기존 기능의 눈에 띄는 확장
- `major`: 사용 흐름을 깨는 변화, 마이그레이션이나 재설치 판단이 필요한 변화

## 릴리스 메타 규칙

- 모든 feature 변경은 `package.json`, `manifest.json`, `releases/release-notes.json`을 함께 업데이트해야 합니다.
- `releases/release-notes.json`의 현재 버전 엔트리에는 다음이 반드시 있어야 합니다.
  - `level`
  - `public.headline`
  - `public.summary`
  - `public.changes[]`
- `public.headline`, `public.summary`, `public.changes[].text`에 `TODO`가 남아 있으면 `pre-push`와 `release:build`가 실패합니다.
- `internal.changes[]`는 선택 사항이며, 내부 운영/배포/구조 변경 기록용입니다.
- 릴리스 패널과 Hosting `latest.json`, `history.json`에는 `public` 정보만 반영합니다.
- 로컬 훅이 빠졌더라도 GitHub Actions `Repo Guardrails`가 같은 규칙을 다시 검사합니다.
- PR 머지 후 GitHub 원격 브랜치는 자동 삭제되고, 로컬 `codex/*` 브랜치는 `main` 기준으로 이미 머지된 경우 훅이 자동 정리합니다.

## 배포 범위 규칙

- `release:deploy`와 `deploy:hosting`은 Hosting만 배포합니다.
- `deploy:functions`는 Firebase Functions만 배포합니다.
- `deploy:all`은 Hosting과 Functions를 함께 배포합니다.
- 기본 해석은 `배포 = hosting-only` 입니다. 함수 배포는 반드시 명시 요청이 있을 때만 진행하는 것을 원칙으로 합니다.
- Hosting 배포에는 항상 고정 최신 링크 `https://browser-extension-main.web.app/extension/downloads/latest.zip` 갱신이 포함됩니다.

## 권장 순서

1. 기능 변경을 마칩니다.
2. `npm run version:bump -- <patch|minor|major>`로 버전을 올립니다.
3. `releases/release-notes.json`에서 새 버전의 제목, 요약, 변경 항목을 채웁니다.
   - 사용자 패널에 보여줄 내용은 `public`에 적습니다.
   - 내부 운영 메모가 필요하면 `internal`에 적습니다.
4. 실제 기능 변경이 있으면 해당 feature `AGENTS.md` 또는 feature 전용 docs에 변경 내용을 반영합니다.
5. 저장소/제품 개요나 설치·배포 흐름 자체가 바뀐 경우에만 `README.md`를 함께 갱신합니다.
6. `npm run verify`, `npm run verify:feature-doc-guard`, `npm run verify:release-guard`를 확인합니다.
7. `npm run release:build`로 배포 ZIP과 Hosting용 릴리스 메타를 생성합니다.
8. 기본 릴리스는 `npm run release:deploy` 또는 `npm run deploy:hosting`으로 Hosting에 반영합니다.
9. Functions 변경이 있을 때만 `npm run deploy:functions`를 따로 실행하거나, 필요 시 `npm run deploy:all`을 사용합니다.
10. Chrome 신규 설치/기존 설치를 각각 확인합니다.
11. 팀에 `새 ZIP`, `변경 요약`, `Reload 필요 여부`를 공지합니다.

## 명령

```bash
npm run version:bump -- minor
npm run verify:feature-doc-guard
npm run verify:release-guard
npm run release:build
npm run release:deploy
npm run deploy:functions
```

## 생성 결과

- `releases/inova-extension-<version>-<date>.zip`
- `releases/release-notes.json`
- `hosting/extension/downloads/latest.zip`
- `hosting/extension/releases/latest.json`
- `hosting/extension/releases/history.json`
- `hosting/extension/downloads/<zip>`

## 운영 원칙

- ZIP은 덮어쓰지 않고 버전별로 누적합니다.
- 고정 최신 링크 `downloads/latest.zip`은 매 배포 때 최신 ZIP으로 교체합니다.
- `latest.json`만 최신 버전을 가리키게 바꿉니다.
- `latest.json`, `history.json`에는 버전 번호뿐 아니라 `level`, `headline`, `summary`, `changes`를 함께 넣습니다.
- 릴리스 패널은 위 메타 중 사용자용 `public` 정보만 읽어 버전별 업데이트 내용을 보여줍니다.
- 문제 발생 시 이전 ZIP을 다시 받아 같은 방식으로 롤백할 수 있습니다.
