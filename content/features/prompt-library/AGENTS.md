# prompt-library feature

## 기능 목적
- 내 요청 보관함 CRUD, 가져오기/내보내기, 로컬 우선 클라우드 백업 동기화를 다룬다.

## 문서 갱신 규칙
- 이 feature의 사용자 체감 동작, 데이터 경계, 먼저 볼 파일, 검증 기준이 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md` 대신 이 문서나 prompt-library 전용 docs에 먼저 기록한다.

## 먼저 볼 파일
- `content/features/prompt-library/prompt-manager.js`
- `content/features/prompt-library/prompt-view.js`
- `content/features/prompt-library/files.js`
- `shared/prompt-library.js`
- `content/features/prompt-library/cloud-sync-manager.js`

## 관련 프론트 경로
- `content/main.js`
- `content/prompt-hub-state.js` - prompt 탭 상태를 묶는 prompt tool shell
- `content/prompt-hub-panel.js` - prompt/store 상호작용을 묶는 prompt tool shell
- `content/prompt-hub-controller.js` - prompt 탭 전이와 액션 라우팅을 묶는 prompt tool shell
- `content/prompt-hub-runtime.js` - prompt manager/runtime wiring을 묶는 prompt tool shell
- `content/prompt-hub-view.js` - `prompt-library` 단독 view가 아니라 prompt tool shell

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

## lane 메모
- `0.4.4` legacy lane은 기존 namespace를 유지한다.
- `1.0.0+` v2 lane은 local storage를 분리하고, prompt-library cloud lane도 별도 endpoint와 별도 namespace로 분리한다.
- v2 첫 read/write는 legacy prompt-library를 copy-only lazy migration 할 수 있어야 하며, migration 실패 시 legacy 원본을 수정하지 않는다.
