# Firebase 아키텍처 메모

## 프로젝트 기본값

- Firebase 프로젝트 표시 이름: `browser-extension`
- Firebase 프로젝트 ID: `browser-extension-main`
- Firestore 기본 리전: `asia-northeast3` (Seoul)
- Firebase Web App 이름: `browser-extension-chrome`
- Firebase Web App ID: `1:1027279095019:web:755f1f1a02cbae0d262aae`

## 핵심 원칙

- 이 프로젝트는 단일 기능용이 아니라 브라우저 확장 공통 플랫폼으로 사용한다.
- 기능이 늘어나더라도 하나의 공용 데이터 덩어리로 합치지 않는다.
- 도메인/기능/서비스 경계를 컬렉션과 보안 규칙에서 함께 분리한다.
- 공통으로 공유하는 값은 최소 식별자와 최소 메타데이터로 제한한다.
- i-Nova는 공통 플랫폼 안의 한 integration으로 다루고 다른 서비스와 직접 섞지 않는다.
- 사용자 기본 키는 raw email이 아니라 안정적인 내부 식별자를 우선 사용한다.

## 컬렉션 경계 초안

- `account_profiles`
  - 확장프로그램 기준의 최소 사용자 프로필
- `device_registrations`
  - 브라우저/디바이스 단위 등록 정보와 동기화 메타
- `prompt_libraries`
  - 사용자 프롬프트 라이브러리 단위 메타
- `prompt_libraries/{libraryId}/items`
  - 실제 프롬프트 항목
- `prompt_backups`
  - 가져오기/내보내기/복원용 백업 스냅샷 메타
- `prompt_store_entries`
  - 여러 사용자가 공유하는 공개 프롬프트 메타와 본문
- `prompt_store_entries/{entryId}/likes`
  - 사용자별 좋아요 토글 기록
- `prompt_store_entries/{entryId}/imports`
  - 사용자별 가져오기 기록
- `prompt_store_entries/{entryId}/views`
  - 조회수 집계를 위한 사용자별 최근 열람 기록
- `integration_inova_accounts`
  - i-Nova 사용자 매핑과 연결 상태
- `integration_inova_state`
  - i-Nova 연동 전용 세션/환경 상태
- `integration_external_connections`
  - 향후 다른 서비스 연결 정보
- `ops_migrations`
  - 스키마/마이그레이션 메타
- `ops_audit_logs`
  - 운영 이벤트와 추적 로그

## 현재 백업 MVP 경로

- 확장프로그램 content script는 프롬프트 변경 시 `cloudSync` 상태만 로컬에 큐잉한다.
- 실제 외부 네트워크 호출은 `background/service-worker.js`가 맡는다.
- 서비스워커는 i-Nova `accessToken` 쿠키를 우선 사용하고, 없을 때만 `/api/auth/refresh`를 보조적으로 사용한다.
- Firebase Functions는 받은 access token으로 `GET /api/users/{providerUserKey}/settings`를 다시 호출해 현재 사용자를 검증한다.
- 검증이 끝난 뒤에만 Firestore에 프롬프트 백업을 쓴다.

## 현재 사용 중인 함수

- `loadInovaPromptLibrary`
  - 현재 i-Nova 사용자 기준 원격 백업 문서를 읽는다.
- `listPromptStoreEntries`
  - 프롬프트 스토어 목록을 카테고리/정렬 기준으로 읽는다.
- `publishPromptToStore`
  - 로컬 요청을 스토어에 공개 등록한다.
- `unpublishPromptFromStore`
  - 본인이 등록한 스토어 항목을 비공개 처리한다.
- `importPromptStoreEntry`
  - 스토어 항목 가져오기 수를 기록하고 항목 본문을 반환한다.
- `togglePromptStoreLike`
  - 좋아요를 사용자 기준으로 토글한다.
- `recordPromptStoreView`
  - 상세 열람 시 조회수를 제한적으로 올린다.
- `syncInovaPromptLibrary`
  - 현재 i-Nova 사용자 기준 프롬프트 보관함 백업 문서를 저장한다.

## 현재 문서 키 규칙

- 프롬프트 백업 문서: `prompt_libraries/inova__{providerUserKey}`
- 프롬프트 스토어 문서: `prompt_store_entries/inova__{providerUserKey}__{promptId}`
- i-Nova 계정 매핑 메타: `integration_inova_accounts/{providerUserKey}`

## 설계 금지 사항

- `users/{uid}/misc` 같은 범용 버킷 컬렉션을 만들지 않는다.
- 여러 기능이 같은 문서 스키마를 임시로 공유하게 두지 않는다.
- i-Nova 식별자를 전역 사용자 기본 키로 직접 승격하지 않는다.
- 토큰 값을 Firestore 문서 키나 장기 식별자로 쓰지 않는다.
- 보안 규칙이 정리되기 전까지 Firestore를 공개 읽기/쓰기로 열지 않는다.

## 인증 방향

- 확장프로그램 공통 사용자 식별 체계를 기준으로 Firebase 사용자를 정의한다.
- i-Nova의 `userKey` 같은 값은 integration 계층의 provider 식별자로 저장한다.
- raw email은 보조 프로필 값으로만 두고 기본 식별자로 사용하지 않는다.

## 운영 메모

- Firebase CLI는 저장소 로컬 설치보다 PC 전역 설치를 기본으로 사용한다.
- 이 저장소는 `.firebaserc` 기본 프로젝트를 `browser-extension-main`으로 둔다.
- Firestore 규칙은 현재 `deny all`로 유지하고, 실제 동기화 구현 전에 기능별 규칙을 설계한다.
