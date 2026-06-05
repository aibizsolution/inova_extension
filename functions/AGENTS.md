# functions 작업 규칙

- 상위 철학과 모듈화 판단 기준은 `docs/development-philosophy.md`를 따른다.
- `functions/index.js`를 진입점으로 먼저 읽지 않는다.
- 먼저 `functions/features/<feature>/AGENTS.md`에서 primary feature를 고른 뒤 해당 feature 파일만 읽는다.
- `functions/index.js`와 `functions/platform/*`은 export wiring, admin bootstrap, 공통 helper가 필요할 때만 읽는다.
- `meeting`과 prompts 계열은 같은 Firebase를 쓰더라도 별도 feature로 취급한다.
- `functions/platform/runtime.js`의 i-Nova identity verify는 같은 `access token + providerUserKey` 조합을 warm runtime 안에서 짧게 재사용한다. feature handler에서 같은 목적의 재검증 캐시를 따로 만들지 않는다.
- 상용 OpenAI 키는 i-Nova 전용 Firebase Functions Secret Manager secret `INOVA_EXTENSION_OPENAI_API_KEY`만 쓴다. 공용 `OPENAI_API_KEY` secret에 새 i-Nova 키를 넣지 않는다. `.env`에 평문 키를 다시 넣지 않고, 로컬 에뮬레이터용 값은 ignored `functions/.secret.local`에 둔다.
- 회의 임시 오디오 Storage bucket은 기본적으로 `FIREBASE_CONFIG.storageBucket`을 쓴다. `STORAGE_BUCKET_URL`은 앱용 bucket override에만 쓰고, `gcf-v2-*` 또는 `*.cloudfunctions.appspot.com` 같은 Cloud Functions 내부 bucket을 지정하지 않는다.
- functions에서는 파일 길이보다 `외부 계약`, `persisted 문서 shape`, `queue/worker lifecycle`, `독립 테스트 가치`를 먼저 경계로 본다.
- 단일 handler 흐름에서만 쓰이고 항상 함께 로드/수정되는 얇은 helper는 같은 파일이나 기존 domain module에 둔다.
- 새 파일은 재사용, 독립 workflow/data boundary, 분리된 검증 가치가 있을 때만 추가한다.
- 새 HTTP Function을 hosted panel에서 호출해야 하면 먼저 `hosting/extension-v2/capability-manifest.json`과 `hosting/extension/capability-manifest.json`에 `kind=function` capability와 `endpointKeys` entry를 추가한다.
- function capabilityId는 기본적으로 `<domain>.<action>-function` 또는 이미 정착된 semantic id를 쓴다. `endpointKey`는 hosted controller가 아니라 manifest와 background runtime만 알아야 한다.
- 새 Functions origin이 필요하면 extension host permission/contract 변경이므로 extension 재배포 대상으로 보고, 같은 작업에서 `docs/capability-authoring.md` 기준을 갱신한다.

