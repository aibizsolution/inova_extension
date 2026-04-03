# inova_extension 작업 규칙

이 문서는 이 저장소에서 계속 반복해서 적용할 전역 운영 규칙만 다룬다. feature 상세 규칙은 각 feature 하위 `AGENTS.md`와 `docs/feature-routing.md`로 분산한다.

## 시작 순서
- 작업 시작 시 `cwd`, Git 상태, 셸 환경을 먼저 확인한다.
- 기본 최소 읽기 세트는 루트 `AGENTS.md`, `README.md`, `package.json`, `manifest.json`, `docs/feature-routing.md`, 그리고 요청과 일치하는 feature `AGENTS.md` 1개다.
- `content/`, `functions/`, `hosting/meeting/`, `shared/`를 처음부터 넓게 읽지 않는다.

## Feature-First 규칙
- 새 요청이 오면 먼저 primary feature를 고른다. 기본 feature는 `conversation`, `prompt-library`, `prompt-store`, `prompt-review`, `meeting`, `release`다.
- cue가 2개 이상 섞이면 전체 탐색 대신 짧게 `이 기능이 맞나요?`라고 확인한 뒤 해당 feature부터 읽는다.
- 읽기 범위는 `feature-local -> feature-owned shared -> platform/shell -> 인접 feature` 순서로만 확장한다.
- `popup`, `background/service-worker.js`, `content/main.js`, `content/panel.js`, `functions/index.js`, `manifest.json`, `shared/*`는 platform/shell로 취급하고 필요할 때만 본다.

## 문서와 구조
- feature 진입점과 데이터 경계는 항상 `docs/feature-routing.md`를 먼저 기준으로 삼는다.
- 기능 상세 규칙은 루트 문서에 다시 길게 적지 말고 feature 하위 `AGENTS.md`에 추가한다.
- 기능 관련 소스나 설정을 바꾸면 `README.md`도 같은 작업 안에서 함께 맞춘다.

## Subagent 규칙
- 저장소 전반 read-only 탐색, 후보 파일 수집, 테스트 실행은 서브에이전트를 우선 검토한다.
- primary feature 분류, 범위 확장 판단, 위험한 diff 리뷰, 최종 판단과 결과 통합은 메인 에이전트가 맡는다.
- 서브에이전트 결과가 약하거나 서로 어긋나면 메인 에이전트가 해당 범위만 다시 읽고 결론을 정한다.

## 검증과 세션 분리
- 기본 검증은 `npm run verify`부터 수행한다.
- UI 체감과 opener, 세션 복원, 배포 경계는 실제 Chrome 확인을 우선한다.
- 두 번째 primary feature를 읽어야 하거나 `content + functions + hosting` 3축에 동시에 손대려는 순간, 먼저 커밋 경계 또는 다음 세션 분리를 제안한다.
- 검증을 못 했으면 성공처럼 말하지 말고 미실행 항목과 이유를 남긴다.
