# Firebase Project And Data Boundary Note

이 문서는 Firebase 구현 이력보다 `현재 어떤 프로젝트/컬렉션 경계를 기준으로 운영하는가`를 빠르게 확인하는 용도다.

## 프로젝트 기본값

- Firebase 프로젝트 표시 이름: `browser-extension`
- Firebase 프로젝트 ID: `browser-extension-main`
- Firestore 기본 리전: `asia-northeast3`
- Firebase Web App 이름: `browser-extension-chrome`
- Firebase Web App ID: `1:1027279095019:web:755f1f1a02cbae0d262aae`

## 운영 원칙

- 이 프로젝트는 단일 기능용이 아니라 브라우저 확장 공용 플랫폼으로 사용한다.
- 기능이 늘어나더라도 컬렉션과 보안 규칙 경계를 기능별로 분리한다.
- 공통 문서는 최소 식별자와 최소 메타데이터만 공유한다.
- i-Nova는 플랫폼 안의 한 integration으로 취급하고 다른 서비스와 직접 섞지 않는다.
- 사용자 기본 키는 raw email이 아니라 안정적인 내부 식별자를 우선 사용한다.

## 현재 컬렉션 경계

### 공통/계정

- `account_profiles`
- `device_registrations`
- `integration_inova_accounts`
- `integration_inova_state`
- `integration_external_connections`
- `ops_migrations`
- `ops_audit_logs`
- `ops_admin_users`
- `ops_admin_launches`
- `ops_admin_sessions`

### prompt-library

- `prompt_libraries`
- `prompt_library_orders`
- `prompt_library_chunks`
- `prompt_backups`

### prompt-store

- `prompt_store_entries`
- `prompt_store_entry_details`
- `prompt_store_feed_pages`
- `prompt_store_entries/{entryId}/likes`
- `prompt_store_entries/{entryId}/imports`
- `prompt_store_entries/{entryId}/views`

### meeting

- `integration_inova_meetings`
- `integration_inova_meeting_participations`
- `integration_inova_meeting_jobs`
- `integration_inova_meeting_job_parts`
- `integration_inova_meeting_job_finalizers`
- `integration_inova_meeting_artifacts`
- `integration_inova_meeting_commands`
- `integration_inova_meeting_deletions`
- launch/session 컬렉션

### admin

- `ops_admin_users`: 관리자 허용 사용자. 문서 키는 `providerUserKey`, `status: active`일 때만 허용한다.
- `ops_admin_launches`: 패널에서 관리자 페이지를 새 탭으로 여는 short-lived one-time launch token grant. 원문 secret은 저장하지 않고 hash만 저장한다.
- `ops_admin_sessions`: 관리자 페이지가 launch token을 교환한 뒤 쓰는 AdminSession token grant. 원문 secret은 저장하지 않고 hash만 저장한다.

## 현재 문서 키 규칙

- 프롬프트 백업 문서: `prompt_libraries/inova__{providerUserKey}`
- 프롬프트 백업 순서 문서: `prompt_library_orders/inova__{providerUserKey}`
- 프롬프트 백업 chunk 문서: `prompt_library_chunks/inova__{providerUserKey}__{bucketId}`
- 프롬프트 스토어 문서: `prompt_store_entries/inova__{providerUserKey}__{promptId}`
- 프롬프트 스토어 리스트 page 문서: `prompt_store_feed_pages/{sortBy}__{categoryId}__{pageNumber}`
- i-Nova 계정 매핑 메타: `integration_inova_accounts/{providerUserKey}`
- 회의 참여 shortcut 문서: `integration_inova_meeting_participations/{viewerProviderUserKey}__{ownerProviderUserKey}__{meetingId}`
- 회의 공유 열람 집계: `integration_inova_meetings/{ownerProviderUserKey}__{meetingId}.share.participantCount`
  - 현재 `shareId` 기준 최초 정상 열람 때만 증가한다.
  - 공유 해제 후 새 링크를 만들면 새 `shareId`와 함께 0부터 다시 시작한다.
  - 목록 렌더링에서 참여 문서를 집계해서 읽지 않는다.
  - 공유 해제 함수는 현재 `shareId`의 참여 shortcut을 `accessState: revoked`, `hidden: false`로 비활성화하고, 사용자의 `목록에서 제거`만 `hidden: true`를 만든다.
- 관리자 허용 사용자 문서: `ops_admin_users/{providerUserKey}`
- 관리자 launch/session token 문서: id와 secret을 분리하고, 문서에는 id와 `secretHash`만 저장한다.

## 설계 금지 사항

- `users/{uid}/misc` 같은 범용 버킷 컬렉션을 만들지 않는다.
- 여러 기능이 같은 문서 스키마를 임시로 공유하게 두지 않는다.
- i-Nova 식별자를 전역 사용자 기본 키로 직접 승격하지 않는다.
- 토큰 값을 Firestore 문서 키나 장기 식별자로 쓰지 않는다.
- 보안 규칙이 정리되기 전까지 Firestore를 공개 읽기/쓰기로 열지 않는다.

## 참고 문서

- 제품/기능 라우팅: `README.md`, `docs/feature-routing.md`
- 런타임 경계: `docs/runtime-architecture.md`
- 릴리스/version 판단: `docs/release-workflow.md`
