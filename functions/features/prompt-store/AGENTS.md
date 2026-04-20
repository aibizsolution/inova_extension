# functions prompt-store feature

## 기능 목적
- 프롬프트 스토어 목록, 등록, 삭제, 좋아요, 가져오기, 조회수 반영을 다룬다.

## 먼저 볼 파일
- `functions/features/prompt-store/store-service.js`

## 관련 프론트 경로
- `hosting/extension-v2/panel/prompt-store-controller.js`
- `hosting/extension-v2/panel/store-view.js`

## 관련 functions 경로
- `functions/index.js`
- `functions/platform/*`

## 관련 데이터 경계
- `prompt_store_entries`
- `prompt_store_entry_details`
- `prompt_store_feed_pages`
- `prompt_store_meta`

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-library
- prompt-review
- release

## 최소 검증 방법
- store 관련 Cloud Function export 이름과 응답 형식이 바뀌지 않았는지 확인한다.

## 언제 사용자에게 다시 물을지
- 공개 스토어 문제인지 prompt library 보관함 문제인지 분류가 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 공통 helper나 export wiring이 필요할 때만 `functions/platform/*`과 `functions/index.js`를 읽는다.
