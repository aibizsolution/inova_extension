# 릴리스 배포 흐름

## 버전 규칙

- `patch`: 버그 수정, 작은 UX 보정, 안정성/운영 보완
- `minor`: 새 기능 추가, 기존 기능의 눈에 띄는 확장
- `major`: 사용 흐름을 깨는 변화, 마이그레이션이나 재설치 판단이 필요한 변화

## 릴리스 메타 규칙

- 모든 feature 변경은 `package.json`, `manifest.json`, `releases/release-notes.json`을 함께 업데이트해야 합니다.
- `releases/release-notes.json`의 현재 버전 엔트리에는 다음이 반드시 있어야 합니다.
  - `level`
  - `headline`
  - `summary`
  - `changes[]`
- `headline`, `summary`, `changes[].text`에 `TODO`가 남아 있으면 `pre-push`와 `release:build`가 실패합니다.

## 권장 순서

1. 기능 변경을 마칩니다.
2. `npm run version:bump -- <patch|minor|major>`로 버전을 올립니다.
3. `releases/release-notes.json`에서 새 버전의 제목, 요약, 변경 항목을 채웁니다.
4. `README.md`에 사용자 관점 변경을 반영합니다.
5. `npm run verify`, `npm run verify:readme-guard`, `npm run verify:release-guard`를 확인합니다.
6. `npm run release:build`로 배포 ZIP과 Hosting용 릴리스 메타를 생성합니다.
7. `npm run release:deploy`로 Hosting에 반영합니다.
8. Chrome 신규 설치/기존 설치를 각각 확인합니다.
9. 팀에 `새 ZIP`, `변경 요약`, `Reload 필요 여부`를 공지합니다.

## 명령

```bash
npm run version:bump -- minor
npm run verify:readme-guard
npm run verify:release-guard
npm run release:build
npm run release:deploy
```

## 생성 결과

- `releases/inova-extension-<version>-<date>.zip`
- `releases/release-notes.json`
- `hosting/extension/releases/latest.json`
- `hosting/extension/releases/history.json`
- `hosting/extension/downloads/<zip>`

## 운영 원칙

- ZIP은 덮어쓰지 않고 버전별로 누적합니다.
- `latest.json`만 최신 버전을 가리키게 바꿉니다.
- `latest.json`, `history.json`에는 버전 번호뿐 아니라 `level`, `headline`, `summary`, `changes`를 함께 넣습니다.
- 릴리스 패널은 위 메타를 그대로 읽어 버전별 업데이트 내용을 보여줍니다.
- 문제 발생 시 이전 ZIP을 다시 받아 같은 방식으로 롤백할 수 있습니다.
