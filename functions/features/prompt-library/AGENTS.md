# functions prompt-library feature

## 기능 목적
- prompt library load/peek/sync와 prompt panel auth 발급을 다룬다.

## 먼저 볼 파일
- `functions/features/prompt-library/register.js`

## 관련 프론트 경로
- `content/prompt-manager.js`
- `content/cloud-sync-manager.js`
- `shared/prompt-library.js`

## 관련 functions 경로
- `functions/index.js`
- `functions/platform/*`

## 관련 데이터 경계
- `prompt_libraries`
- `prompt_library_orders`
- `prompt_library_chunks`
- `integration_inova_accounts.promptLibraryMeta`

## 보통 건드리지 말아야 할 범위
- meeting
- prompt-store
- prompt-review
- release

## 최소 검증 방법
- `loadInovaPromptLibrary`, `peekInovaPromptLibrary`, `syncInovaPromptLibrary`, `issueInovaPromptPanelAuth`가 기존 export 이름으로 유지되는지 확인한다.

## 언제 사용자에게 다시 물을지
- 로컬 보관함 sync 문제인지 공개 스토어 문제인지 섞여 있을 때만 확인한다.

## 언제 범위를 확장할지
- 공통 helper나 admin bootstrap이 필요할 때만 `functions/platform/*`과 `functions/index.js`를 읽는다.
