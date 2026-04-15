# prompt-store feature

## 기능 목적
- 스토어 목록, 상세 보기, 좋아요, 가져오기, 등록/삭제와 realtime feed를 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, 데이터 경계, 최소 검증, durable invariant가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 prompt-store feature-local 규칙과 계약은 이 문서나 prompt-store 전용 docs에 문서화한다.

## 먼저 볼 파일
- `hosting/extension-v2/panel/prompt-store-controller.js`
- `hosting/extension-v2/panel/store-view.js`
- `content/panel-v2-prompt-controller.js`
- `backup/legacy-panel/shared/prompt-store.js`
- `backup/legacy-panel/features/prompt-store/store-manager.js` - inactive legacy reference
- `backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js` - inactive legacy reference

## 관련 프론트 경로
- `content/panel-v2-prompt-controller.js` - v2 prompt review handoff + minimal prompt snapshot shell
- `content/main.js` - panel shell composition root, prompt shell 직접 구현 금지
- `hosting/extension-v2/panel/prompt-store-controller.js` - hosted panel store state/action ownership
- `hosting/extension-v2/panel/prompt-store-model.js` - hosted deploy copy of the shared store model
- `functions/shared/prompt-store-model.js` - functions deploy copy of the same store model; must stay byte-for-byte aligned with hosted copy
- `hosting/extension-v2/panel/store-view.js` - hosted panel store view
- `hosting/extension-v2/panel/prompt-tool-view.js` - hosted panel prompt tool shell view
- `backup/legacy-panel/prompt-hub-state.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-panel.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-controller.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/prompt-hub-runtime.js` - inactive legacy prompt shell reference
- `backup/legacy-panel/store-view.js` - inactive legacy content view reference
- `backup/legacy-panel/prompt-hub-view.js` - inactive legacy prompt tool shell view reference

## 관련 functions 경로
- `functions/features/prompt-store/store-service.js`

## 관련 데이터 경계
- `prompt_store_entries`
- `prompt_store_entry_details`
- `prompt_store_feed_pages`
- `prompt_store_meta`
- 하위 likes/imports/views
- v2 lane에서도 공개 store catalog는 shared read-only data로 유지할 수 있다. 다만 prompt realtime bridge가 같이 읽는 prompt-library meta는 active lane 기준 account collection(`integration_inova_accounts` 또는 `integration_inova_accounts_v2`)을 따라야 한다.

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-library
- release

## 최소 검증 방법
- 스토어 탭 `전체` 목록이 로드되는지 확인한다.
- 상세 보기 1건이 열리는지 확인한다.
- `좋아요` 또는 `내 요청으로 가져오기` 중 1개 액션이 동작하는지 확인한다.
- 탭 이동 후 돌아와도 목록이 유지되는지 확인한다.

## 언제 사용자에게 다시 물을지
- 내 요청 보관함 문제인지 공개 스토어 문제인지 섞여 있을 때만 확인한다.

## 언제 범위를 확장할지
- realtime bridge, prompt tool shell, panel auth cache, background read 경로가 원인일 때만 platform/shell로 넓힌다.

## 구현 경계
- store 로드 정리 구간은 `finally`에서 `return`으로 흐름을 끊지 않는다. `loadSequence`가 현재 요청과 같을 때만 `loading` 해제, render, `reload-all` 재호출 예약을 수행한다.
- `0.4.5`부터 panel 안의 store UI는 hosted panel iframe이 렌더링하고, `backup/legacy-panel/panel-prompt-controller.js`와 `backup/legacy-panel/features/prompt-store/*`는 legacy lane reference의 상태/읽기/쓰기 controller를 계속 담는다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/prompt-store-controller.js`가 `스토어` 탭의 목록/정렬/범주/상세/좋아요/가져오기/삭제확인 상태와 store action 라우팅을 소유하고, extension은 runtime broker와 `content/panel-v2-prompt-controller.js` 기반 minimal prompt shell만 제공한다. v2 top-panel snapshot은 store item list를 다시 싣지 않고 hosted store controller가 직접 읽은 상태를 우선한다.
- 스토어 카테고리는 고정 taxonomy만 강제하지 않는다. 현재 스토어에 있는 기존 카테고리를 우선 노출하고, publish 시 새 카테고리 이름을 만들면 backend summary/feed/filter가 그 label/id를 그대로 round-trip 해야 한다.
- prompt realtime bridge connect payload에는 active lane의 `promptPanelScope`와 Firestore collection config를 함께 싣는다. store summary/feed/detail은 shared doc를 계속 읽더라도, prompt-library meta collection은 lane과 auth scope가 맞아야 한다.
- popup의 `settings.meetingWorkspaceTarget=local`을 고르면 prompt-store도 local full-stack rehearsal로 같이 전환돼야 한다. local target은 계속 `http://127.0.0.1:5000/extension/prompt-panel-bridge.html`을 향하지만, 실제 페이지 DOM의 hidden prompt bridge iframe은 `content/frame-proxy.html?target=...` wrapper를 거쳐 page CSP를 우회한다. prompt panel auth/read/write는 local Functions/Auth/Firestore emulator 경로를 써야 한다.
- local Firestore에 공개 스토어 문서가 아직 없어도 `store-latest` 최초 스냅샷은 빈 목록으로 한 번 전달돼야 한다. 빈 로컬 스토어를 perpetual loading으로 숨기지 않는다.
- `내 요청으로 가져오기`는 local-first helper로 성공처럼 처리하면 안 된다. prompt-library가 DB 정본일 때는 remote prompt-library mutation이 server-ack 되고 remote reload가 끝난 뒤에만 prompt 탭 state를 갱신한다.
- hosted v2 스토어 목록 read path는 Functions list가 아니라 Firestore direct read/subscription이 기본이다. 조회수, 좋아요, 가져오기 수 같은 metrics mutation은 `prompt_store_entries`를 갱신하므로 목록 UI도 published entry 문서를 직접 읽어 최신 metrics를 표시해야 한다.
- prompt-store entry/category/metrics/score/sort 정규화는 `prompt-store-model.js` deploy copy가 소유한다. Firebase 배포 루트가 `hosting`과 `functions`로 분리되어 있으므로 hosted copy와 functions copy를 둘 다 두되, `scripts/verify-prompt-store-model.js`가 byte-for-byte 동일성과 Functions 위임을 검증한다.
