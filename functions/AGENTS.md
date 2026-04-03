# functions 작업 규칙

- `functions/index.js`를 진입점으로 먼저 읽지 않는다.
- 먼저 `functions/features/<feature>/AGENTS.md`에서 primary feature를 고른 뒤 해당 feature 파일만 읽는다.
- `functions/index.js`와 `functions/platform/*`은 export wiring, admin bootstrap, 공통 helper가 필요할 때만 읽는다.
- `meeting`과 prompts 계열은 같은 Firebase를 쓰더라도 별도 feature로 취급한다.

