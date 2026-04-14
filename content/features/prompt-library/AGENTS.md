# prompt-library feature

## 기능 목적
- 내 요청 보관함 CRUD, 가져오기/내보내기, DB 정본(remote-first) 동기화를 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 데이터 경계, 최소 검증, lane invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 prompt-library feature-local 규칙과 계약은 이 문서나 prompt-library 전용 docs에 문서화한다.

## 먼저 볼 파일
- `hosting/extension-v2/panel/prompt-library-controller.js`
- `hosting/extension-v2/panel/prompt-library-firestore-client.js`
- `hosting/extension-v2/panel/prompt-view.js`
- `content/panel-v2-prompt-controller.js`
- `shared/prompt-library.js` - inactive helper/reference, active manifest preload 아님
- `backup/legacy-panel/shared/prompt-cloud-sync.js` - inactive legacy prompt sync/helper reference
- `backup/legacy-panel/shared/prompt-storage.js` - inactive legacy prompt storage/helper reference
- `backup/legacy-panel/features/prompt-library/prompt-manager.js` - inactive legacy reference
- `backup/legacy-panel/features/prompt-library/files.js` - inactive legacy reference
- `backup/legacy-panel/features/prompt-library/cloud-sync-manager.js` - inactive legacy reference

## 관련 프론트 경로
- `content/panel-v2-prompt-controller.js` - v2 prompt review handoff + review-only prompt snapshot shell
- `content/main.js` - panel shell composition root, prompt shell 직접 구현 금지
- `hosting/extension-v2/panel/prompt-library-controller.js` - hosted panel library state/action ownership
- `hosting/extension-v2/panel/prompt-view.js` - hosted panel library view
- `hosting/extension-v2/panel/prompt-tool-view.js` - hosted panel prompt tool shell view
- `backup/legacy-panel/prompt-hub-state.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-panel.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-controller.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-runtime.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-view.js` - inactive legacy content view reference
- `backup/legacy-panel/prompt-hub-view.js` - inactive legacy prompt tool shell view reference

## 관련 functions 경로
- `functions/features/prompt-library/register.js`

## 관련 데이터 경계
- `prompt_libraries`
- `prompt_library_orders`
- `prompt_library_chunks`
- `integration_inova_accounts.promptLibraryMeta`
- v2 lane은 `prompt_libraries_v2`, `prompt_library_orders_v2`, `prompt_library_chunks_v2`, `integration_inova_accounts_v2.promptLibraryMeta`, `product_lane_migrations_v2`를 사용한다.

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-store
- prompt-review
- release

## 최소 검증 방법
- 프롬프트 탭의 `내 요청`이 렌더링되는지 확인한다.
- `가져오기`와 `내보내기` 버튼 안쪽 `?` 안내가 보이는지 확인한다.
- 항목 1건을 저장하거나 수정할 수 있는지 확인한다.
- 저장한 항목을 입력창에 1회 주입할 수 있고, 간헐 자동 전송이 재현되지 않는지 확인한다.
- v2 lane에서는 첫 진입 후 local storage가 `v2.*` key로 분리되고, prompt-library cloud read가 `integration_inova_accounts_v2` meta를 읽는지 확인한다.

## 언제 사용자에게 다시 물을지
- 스토어 공개 흐름 문제인지, 검토 버튼 문제인지, 로컬 보관함 문제인지 구분이 모호할 때만 확인한다.

## 언제 범위를 확장할지
- feature-local과 owned-shared만으로 해결되지 않고 prompt tool shell, panel auth, background cache가 얽힐 때만 platform/shell로 넓힌다.

## 구현 경계
- 내 요청 보관함은 인터넷 연결 없이는 쓸 수 없는 제품 전제를 따른다. prompt library의 정본은 Firestore/Functions가 들고, active `1.0.0+` lane은 `chrome.storage.local.promptLibrary`를 source-of-truth로 취급하지 않는다. 이 local key는 backup legacy reference/cache 경로에서만 유지한다.
- `0.4.5`부터 panel 안의 `내 요청` UI는 hosted panel iframe이 렌더링하고, `backup/legacy-panel/panel-prompt-controller.js`는 legacy lane reference의 상태/액션/동기화 controller를 계속 담는다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/prompt-library-controller.js`, `prompt-store-controller.js`, `prompt-review-controller.js`가 각 탭의 remote 상태와 prompt tab 전환/persistence, prompt action/draft/import/reorder 라우팅을 hosted 쪽에서 소유한다. extension은 page adapter와 runtime broker, `content/panel-v2-prompt-controller.js` 기반 review handoff/composer review float만 제공하고, generic `prompts/store` tool 선택은 `content/panel-v2-shell-bridge.js`의 shell persistence로만 정규화한다. active hosted prompt tool shell도 더 이상 `review/store` 탭을 `다음 단계` placeholder fallback으로 렌더링하지 않고, store/review controller state를 직접 주입받는다. legacy prompt realtime/cloud/store sync 예약은 v2 lane에서 다시 돌리지 않는다. v2 top-panel snapshot은 prompt/store item list나 prompt activeTab을 싣지 않고 review handoff signal 같은 최소 정보만 전달한다.
- active `1.0.0+` manifest는 더 이상 `shared/prompt-library.js`를 content preload로 싣지 않는다. 이 파일은 import/export 정규화와 dormant helper reference용으로만 남기고, active prompt shell/runtime 판단 기준은 hosted controller와 `shared/provider-identity-cache.js`, `shared/storage.js`, `shared/provider-identity.js` 쪽에 둔다.
- active `shared/provider-identity-cache.js`와 `shared/storage.js`는 v2 lane에서 generic provider-identity/local-state merge만 맡는다. dormant prompt CRUD/sync operation helper와 local cache schema는 `backup/legacy-panel/shared/prompt-cloud-sync.js`, `backup/legacy-panel/shared/prompt-storage.js`, `shared/prompt-library.js` reference로만 두고 active manifest preload에 다시 싣지 않는다.
- persisted legacy `activeTool: "store"` 값은 active v2 lane 진입 시 바로 `activeTool: "prompts"` + `activePromptTab: "store"`로 흡수한다. extension route/shell은 더 이상 store를 별도 tool identity로 유지하지 않고, store는 hosted prompt tab의 한 상태로만 본다.
- active `1.0.0+` extension state factory와 route hydration은 hosted-owned prompt library/store/editor mirror를 다시 들지 않는다. `chrome.storage.local.promptLibrary` 캐시는 backup legacy reference용일 수 있어도, active extension `createState()`나 `route-state-controller`가 그 목록/편집/store bucket을 다시 state에 올리거나 active shared storage contract에 계속 싣고 있으면 안 된다.
- `1.0.0+` v2 lane의 `내 요청` read path는 `auth.issue-panel-session(panel=prompt) -> hosted prompt-library-firestore-client -> integration_inova_accounts_v2.promptLibraryMeta onSnapshot -> prompt_library_orders_v2/prompt_library_chunks_v2 direct read`가 기본이다. 단순 목록 read를 `loadInovaPromptLibraryV2` Functions 호출로 되돌리지 않는다.
- release 등 다른 탭에서 panel-local storage hydration이 아직 끝나기 전에 `prompts`로 전이해도, hosted prompt controller는 첫 library load 요청을 잃지 말고 hydration 완료 뒤 `auth.issue-panel-session(panel=prompt)`과 Firestore 구독을 이어서 시작해야 한다.
- prompt 저장/수정/삭제/순서 변경/가져오기는 local-first queue로 성공처럼 보이면 안 된다. 서버 ack 후 Firestore refresh가 확인된 뒤에만 state와 local cache를 최신으로 본다.
- 다른 PC에서 삭제/수정한 항목은 prompt-library realtime meta 또는 다음 Firestore refresh에서 현재 PC 캐시보다 우선 반영돼야 한다.
- prompt item의 `importedFrom`, `storePublication` 메타도 DB 정본 경로를 따라 round-trip 되어야 한다. 멀티 PC에서 store import/publish 표식이 로컬에만 남아 사라지지 않게 유지한다.

## lane 경계
- `0.4.4` legacy lane은 기존 namespace를 유지한다.
- `1.0.0+` v2 lane은 local storage를 분리하고, prompt-library cloud lane도 별도 endpoint와 별도 namespace로 분리한다.
- v2 첫 read/write는 legacy prompt-library를 copy-only lazy migration 할 수 있어야 하며, migration 실패 시 legacy 원본을 수정하지 않는다.
- popup의 `settings.meetingWorkspaceTarget=local`은 회의 전용 설정처럼 보여도 prompt-library cloud read/sync rehearsal target도 함께 바꿔야 한다. 로컬 rehearsal에서는 `load/peek/sync`와 prompt panel auth가 local Functions base URL을 향해야 한다.
- local rehearsal의 hosted prompt Firestore/auth 경로는 emulator 재시작 뒤 남은 stale Firebase auth session을 재사용하지 않는다. local target에서는 stale auth storage를 먼저 정리하고 새 custom token으로 다시 붙어 `securetoken` 400 노이즈가 기능 실패처럼 보이지 않게 유지한다.
