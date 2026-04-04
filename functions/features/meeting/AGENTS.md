# functions meeting feature

## 기능 목적
- 회의 launch/session auth, 회의 job 생성, chunk worker, finalizer, 결과 수정/삭제를 다룬다.

## 먼저 볼 파일
- `functions/features/meeting/meeting-launch-service.js`
- `functions/features/meeting/meeting-service.js`

## 관련 프론트 경로
- `content/meeting-manager.js`
- `hosting/meeting/index.js`
- `background/service-worker.js`
- `shared/meeting-bridge.js`

## 관련 functions 경로
- `functions/index.js`
- `functions/platform/*`

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
- meeting 관련 export 이름, Firestore trigger 문서 경로, hosted meeting auth 흐름이 그대로 유지되는지 확인한다.
- 상용 회의 데이터 잔존 여부를 편하게 볼 때는 `npm run check:meeting-data`를 사용한다.
- 회의 데이터를 전체 또는 특정 `meetingId` 기준으로 수동 정리할 때는 기본 dry-run인 `npm run delete:meeting-data -- --all` 또는 `npm run delete:meeting-data -- --meeting-id <id>`를 먼저 보고, 실제 삭제는 같은 명령에 `--execute`를 붙인다.
- 회의 삭제 task와 1시간 sweep은 job/artifact/part/finalizer뿐 아니라 관련 `integration_inova_meeting_commands`와 회의 단위 `launch/workspace session`까지 함께 정리해야 한다.
- notes regenerate worker는 삭제 중 command/job/artifact를 다시 만들지 않게, 삭제된 문서에는 `set-if-exists` 식으로만 상태를 갱신한다.

## 언제 사용자에게 다시 물을지
- 패널 회의 허브 문제인지 hosted 작업실 문제인지, auth 문제인지 전사 worker 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 공통 helper, admin bootstrap, export wiring이 필요할 때만 `functions/platform/*`과 `functions/index.js`를 읽는다.
