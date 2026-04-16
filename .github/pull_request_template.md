## 요약

- 이번 PR에서 바뀐 점을 짧게 적어 주세요.

## 체크리스트

- [ ] 작업 브랜치는 `codex/*` 또는 팀 작업 브랜치 규칙을 따랐습니다.
- [ ] feature 관련 파일을 바꿨다면 해당 feature `AGENTS.md` 또는 feature docs를 검토했습니다. `README.md`는 상위 구조가 바뀔 때만 업데이트합니다.
- [ ] manifest/capability를 바꿨다면 `docs/capability-catalog.md`를 재생성했고 `docs/capability-authoring.md` 기준을 확인했습니다.
- [ ] feature 관련 파일을 바꿨다면 버전과 `releases/release-notes.json`을 함께 업데이트했습니다.
- [ ] `releases/release-notes.json`의 `headline`, `summary`, `changes`에 `TODO`가 남아 있지 않습니다.
- [ ] `npm run verify`를 확인했습니다.
- [ ] 필요하면 `npm run release:build`까지 확인했습니다.

## 릴리스 구분

- [ ] `patch`
- [ ] `minor`
- [ ] `major`

## 리스크 / 롤백

- 배포 시 주의할 점이나 되돌릴 때 참고할 점이 있으면 적어 주세요.
