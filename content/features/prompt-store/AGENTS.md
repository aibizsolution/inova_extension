# prompt-store feature

## 기능 목적
- 스토어 목록, 상세 보기, 좋아요, 가져오기, 등록/삭제와 realtime feed를 다룬다.

## 먼저 볼 파일
- `content/features/prompt-store/store-manager.js`
- `content/features/prompt-store/store-view.js`
- `content/features/prompt-store/prompt-realtime-manager.js`
- `shared/prompt-store.js`

## 관련 프론트 경로
- `content/prompt-hub-view.js`
- `content/main.js`

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
- 스토어 탭 목록, 상세 보기, 좋아요, 가져오기, 등록/삭제를 확인한다.

## 언제 사용자에게 다시 물을지
- 내 요청 보관함 문제인지 공개 스토어 문제인지 섞여 있을 때만 확인한다.

## 언제 범위를 확장할지
- realtime bridge, panel auth cache, background read 경로가 원인일 때만 platform/shell로 넓힌다.
