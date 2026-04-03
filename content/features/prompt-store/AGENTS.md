# prompt-store feature

## 기능 목적
- 스토어 목록, 상세 보기, 좋아요, 가져오기, 등록/삭제와 realtime feed를 다룬다.

## 먼저 볼 파일
- `content/features/prompt-store/store-manager.js`
- `content/features/prompt-store/store-view.js`
- `content/features/prompt-store/prompt-realtime-manager.js`
- `shared/prompt-store.js`

## 관련 프론트 경로
- `content/main.js`
- `content/prompt-hub-state.js` - prompt 탭 상태를 묶는 prompt tool shell
- `content/prompt-hub-panel.js` - prompt/store 상호작용을 묶는 prompt tool shell
- `content/prompt-hub-view.js` - `prompt-store` 단독 view가 아니라 prompt tool shell

## 관련 functions 경로
- `functions/features/prompt-store/store-service.js`

## 관련 데이터 경계
- `prompt_store_entries`
- `prompt_store_entry_details`
- `prompt_store_feed_pages`
- `prompt_store_meta`
- 하위 likes/imports/views

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
