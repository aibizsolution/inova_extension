# functions 작업 규칙

- 상위 철학과 모듈화 판단 기준은 `docs/development-philosophy.md`를 따른다.
- `functions/index.js`를 진입점으로 먼저 읽지 않는다.
- 먼저 `functions/features/<feature>/AGENTS.md`에서 primary feature를 고른 뒤 해당 feature 파일만 읽는다.
- `functions/index.js`와 `functions/platform/*`은 export wiring, admin bootstrap, 공통 helper가 필요할 때만 읽는다.
- `meeting`과 prompts 계열은 같은 Firebase를 쓰더라도 별도 feature로 취급한다.
- `functions/platform/runtime.js`의 i-Nova identity verify는 같은 `access token + providerUserKey` 조합을 warm runtime 안에서 짧게 재사용한다. feature handler에서 같은 목적의 재검증 캐시를 따로 만들지 않는다.
- functions에서는 파일 길이보다 `외부 계약`, `persisted 문서 shape`, `queue/worker lifecycle`, `독립 테스트 가치`를 먼저 경계로 본다.
- 단일 handler 흐름에서만 쓰이고 항상 함께 로드/수정되는 얇은 helper는 같은 파일이나 기존 domain module에 둔다.
- 새 파일은 재사용, 독립 workflow/data boundary, 분리된 검증 가치가 있을 때만 추가한다.

