# prompt-library feature

## 기능 목적
- 내 요청 보관함 CRUD, 가져오기/내보내기, DB 정본(remote-first) 동기화를 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 데이터 경계, 최소 검증, lane invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 prompt-library feature-local 규칙과 계약은 이 문서나 prompt-library 전용 docs에 문서화한다.

## 먼저 볼 파일
- `content/features/prompt-library/prompt-manager.js`
- `hosting/extension-v2/panel/prompt-library-controller.js`
- `hosting/extension-v2/panel/prompt-view.js`
- `content/features/prompt-library/files.js`
- `shared/prompt-library.js`
- `content/features/prompt-library/cloud-sync-manager.js`

## 관련 프론트 경로
- `content/panel-prompt-controller.js` - prompt tool shell composition root
- `content/main.js` - panel shell composition root, prompt shell 직접 구현 금지
- `content/prompt-hub-state.js` - prompt 탭 상태를 묶는 prompt tool shell
- `content/prompt-hub-panel.js` - prompt/store 상호작용을 묶는 prompt tool shell
- `content/prompt-hub-controller.js` - prompt 탭 전이와 액션 라우팅을 묶는 prompt tool shell
- `content/prompt-hub-runtime.js` - prompt manager/runtime wiring을 묶는 prompt tool shell
- `hosting/extension-v2/panel/prompt-library-controller.js` - hosted panel library state/action ownership
- `hosting/extension-v2/panel/prompt-view.js` - hosted panel library view
- `hosting/extension-v2/panel/prompt-tool-view.js` - hosted panel prompt tool shell view
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
- 내 요청 보관함은 인터넷 연결 없이는 쓸 수 없는 제품 전제를 따른다. prompt library의 정본은 Firestore/Functions가 들고, `chrome.storage.local`의 `promptLibrary`는 마지막으로 불러온 캐시와 UI 복구용으로만 취급한다.
- `0.4.5`부터 panel 안의 `내 요청` UI는 hosted panel iframe이 렌더링하고, `content/panel-prompt-controller.js`는 legacy lane의 상태/액션/동기화 controller를 계속 소유한다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/prompt-library-controller.js`, `prompt-store-controller.js`, `prompt-review-controller.js`가 각 탭의 remote 상태와 prompt tab 전환/persistence, prompt action/draft/import/reorder 라우팅을 hosted 쪽에서 소유한다. extension은 page adapter와 runtime broker만 제공하고, legacy prompt realtime/cloud/store sync 예약은 v2 lane에서 다시 돌리지 않는다. v2 top-panel snapshot은 prompt/store item list를 싣지 않고 `activeTab`과 review handoff signal 같은 최소 정보만 전달한다.
- `1.0.0+` v2 lane의 `내 요청` read path는 `auth.issue-prompt-panel -> hosted prompt-library-firestore-client -> integration_inova_accounts_v2.promptLibraryMeta onSnapshot -> prompt_library_orders_v2/prompt_library_chunks_v2 direct read`가 기본이다. 단순 목록 read를 `loadInovaPromptLibraryV2` Functions 호출로 되돌리지 않는다.
- prompt 저장/수정/삭제/순서 변경/가져오기는 local-first queue로 성공처럼 보이면 안 된다. 서버 ack 후 Firestore refresh가 확인된 뒤에만 state와 local cache를 최신으로 본다.
- 다른 PC에서 삭제/수정한 항목은 prompt-library realtime meta 또는 다음 Firestore refresh에서 현재 PC 캐시보다 우선 반영돼야 한다.
- prompt item의 `importedFrom`, `storePublication` 메타도 DB 정본 경로를 따라 round-trip 되어야 한다. 멀티 PC에서 store import/publish 표식이 로컬에만 남아 사라지지 않게 유지한다.

## lane 경계
- `0.4.4` legacy lane은 기존 namespace를 유지한다.
- `1.0.0+` v2 lane은 local storage를 분리하고, prompt-library cloud lane도 별도 endpoint와 별도 namespace로 분리한다.
- v2 첫 read/write는 legacy prompt-library를 copy-only lazy migration 할 수 있어야 하며, migration 실패 시 legacy 원본을 수정하지 않는다.
- popup의 `settings.meetingWorkspaceTarget=local`은 회의 전용 설정처럼 보여도 prompt-library cloud read/sync rehearsal target도 함께 바꿔야 한다. 로컬 rehearsal에서는 `load/peek/sync`와 prompt panel auth가 local Functions base URL을 향해야 한다.
