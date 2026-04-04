# meeting feature

## 기능 목적
- 회의 허브, hosted 작업실, 녹음, 전사, 결과 검토를 다룬다.

## 문서 갱신 규칙
- 이 feature의 사용자 체감 동작, 데이터 경계, 먼저 볼 파일, 검증 기준이 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md` 대신 이 문서나 meeting 전용 docs에 먼저 기록한다.

## 먼저 볼 파일
- `content/meeting-manager.js`
- `content/meeting-view.js`
- `hosting/meeting/index.js`
- `popup/index.js`

## 관련 프론트 경로
- `background/service-worker.js`
- `hosting/meeting/*`
- `popup/index.js`

## hosted workspace auth 메모
- hosted 회의 작업실 Firebase auth claim은 `meetingId` 단위로 달라질 수 있다.
- 그래서 `hosting/meeting/firebase-client.js`에서는 `synchronizeTabs: true` 같은 cross-tab Firestore persistence를 켜지 않고, 여러 회의 탭이 각자 auth를 유지하도록 둔다.
- 실시간 listener permission 오류 재시도는 기존 작업실 access payload를 지운 뒤 막히지 않게, 같은 meeting auth로 강제 재로그인하는 흐름을 유지한다.
- hosted 회의 작업실의 `파일 불러오기`는 로컬/상용 모두 지원 대상이다. origin이 다르다는 이유만으로 버튼 표시나 import 실행을 막지 않는다.
- owner-secure hosted 작업실은 `meetingId`만으로 진입하거나 새로고침해도 업로드/삭제/수정이 계속 동작하도록 `authorizeInovaMeetingWorkspaceAccess`가 `meetingSessionToken`을 함께 돌려주고, 작업실은 그 토큰을 복원 세션에 저장한다.

## 관련 functions 경로
- `functions/features/meeting/meeting-launch-service.js`
- `functions/features/meeting/meeting-service.js`

## 관련 데이터 경계
- `integration_inova_meetings`
- `integration_inova_meeting_jobs`
- `integration_inova_meeting_job_parts`
- `integration_inova_meeting_job_finalizers`
- `integration_inova_meeting_artifacts`
- launch/session 컬렉션

## 보통 건드리지 말아야 할 범위
- prompt-library
- prompt-store
- prompt-review
- release

## 최소 검증 방법
- 팝업 target 설정, 회의 탭 목록, hosted meeting 진입, 결과 조회를 확인한다.

## 언제 사용자에게 다시 물을지
- 패널 회의 허브 문제인지 hosted 작업실 문제인지, auth 문제인지 전사 backend 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- feature-local과 owned-shared만으로 해결되지 않고 launch/session 발급 또는 panel cache가 얽힐 때만 platform/shell로 넓힌다.
