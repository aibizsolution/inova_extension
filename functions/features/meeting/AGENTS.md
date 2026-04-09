# functions meeting feature

## 기능 목적
- 회의 launch/session auth, 회의 job 생성, chunk worker, finalizer, 결과 수정/삭제를 다룬다.

## 먼저 볼 파일
- `functions/features/meeting/meeting-launch-service.js`
- `functions/features/meeting/meeting-common-domain.js`
- `functions/features/meeting/meeting-notes-context-domain.js`
- `functions/features/meeting/meeting-notes-document-domain.js`
- `functions/features/meeting/meeting-notes-runtime-domain.js`
- `functions/features/meeting/meeting-notes-source-domain.js`
- `functions/features/meeting/meeting-mutation-domain.js`
- `functions/features/meeting/meeting-record-domain.js`
- `functions/features/meeting/meeting-source-domain.js`
- `functions/features/meeting/meeting-summary-sync-domain.js`
- `functions/features/meeting/meeting-state-domain.js`
- `functions/features/meeting/meeting-service.js`
- `functions/features/meeting/meeting-transcript-domain.js`

## 관련 프론트 경로
- `content/meeting-manager.js`
- `hosting/meeting/index.js`
- `background/service-worker.js`
- `shared/meeting-bridge.js`

## 관련 functions 경로
- `functions/index.js`
- `functions/platform/*`
- `functions/features/meeting/meeting-common-domain.js`는 `meeting-service.js`, `meeting-launch-service.js`, `meeting-workspace-auth-service.js`가 함께 쓰는 text normalize와 source/transcript 공용 helper root다. backend meeting 서비스 간 같은 normalize 규칙을 맞출 때 먼저 확인한다.
- `functions/features/meeting/meeting-notes-context-domain.js`는 notes context/snapshot normalize helper를 분리한 내부 모듈이다. mutation payload, notes input snapshot, context dedupe 경계를 볼 때 먼저 확인한다.
- `functions/features/meeting/meeting-notes-document-domain.js`는 notes 문서 normalize, empty bundle source note, preview helper를 분리한 내부 모듈이다. 회의록 스키마/후처리 의미를 건드리지 않고 handler 본문을 줄일 때 먼저 확인한다.
- `functions/features/meeting/meeting-notes-runtime-domain.js`는 notes bundle 생성과 completion content normalize helper를 분리한 내부 모듈이다. notes generation 흐름을 줄일 때 service 상단 wiring과 함께 먼저 확인한다.
- `functions/features/meeting/meeting-notes-source-domain.js`는 notes workflow에서 공통으로 쓰는 transcript/artifact access, notes context baseline, shared memo snapshot helper를 분리한 내부 모듈이다. notes regeneration/update 흐름의 source contract를 바꿀 때 먼저 확인한다.
- `functions/features/meeting/meeting-mutation-domain.js`는 list/mutation request, workspace mutation, command, deletion task normalize helper를 분리한 내부 모듈이다. command/deletion 문서 shape를 유지한 채 handler 본문을 줄일 때 먼저 확인한다.
- `functions/features/meeting/meeting-record-domain.js`는 queued job, succeeded patch, transcript artifact, summary document, stable ID/path builder를 분리한 내부 모듈이다. persisted record shape를 유지한 채 handler 본문을 줄일 때 먼저 확인한다.
- `functions/features/meeting/meeting-source-domain.js`는 meeting request/source upload/job-part/finalizer normalize helper를 분리한 내부 모듈이다. 업로드 payload와 queued state contract를 바꾸지 않고 handler 본문을 줄일 때 먼저 확인한다.
- `functions/features/meeting/meeting-summary-sync-domain.js`는 meeting summary read/write, active check, recentJobs synchronization helper를 분리한 내부 모듈이다. meeting summary 문서 lifecycle을 건드릴 때 먼저 확인한다.
- `functions/features/meeting/meeting-state-domain.js`는 transcription response, job/artifact/summary normalize, recentJobs 정렬 helper를 분리한 내부 모듈이다. persisted state 의미를 유지한 채 handler 본문을 줄일 때 먼저 확인한다.
- `functions/features/meeting/meeting-transcript-domain.js`는 `meeting-service.js`의 전사 분절과 회의록 transcript shaping helper를 분리한 내부 모듈이다. export 이름, trigger 경로, 데이터 계약 변경 없이 handler 파일을 가볍게 유지할 때 먼저 확인한다.

## meeting 리팩토링 경계 규칙
- `meeting-service.js` 분리는 line count 자체가 아니라 `workflow`, `persisted data contract`, `queue lifecycle`, `notes/source/record/state` 같은 도메인 경계를 기준으로 판단한다.
- `meeting-service.js`의 목표 end-state는 `legacy handler/export surface + cross-domain orchestration`이다. 여러 domain 결과를 묶어 auth, Firestore, Storage, OpenAI 흐름을 끝내는 helper는 service 안에 남길 수 있다.
- `common`, `guard`처럼 얇은 helper-only 파일은 새로 늘리기 전에 재사용, 독립 테스트 가치, 분리된 변경 이유가 충분한지 먼저 확인한다.
- `meeting-guard-domain.js`는 helper-only 경계가 약해 다시 `meeting-service.js`로 합쳤다. 반대로 `meeting-common-domain.js`는 launch/workspace auth service까지 같은 normalize 규칙을 공유하게 하면서 `shared normalization boundary`로 유지한다.
- `meeting-summary-sync-domain.js`처럼 summary read/write와 active check가 한 문서 lifecycle로 설명되면 helper 수와 무관하게 독립 workflow boundary로 분리할 수 있다.
- 앞으로의 우선 분리 후보는 helper 묶음보다 `job creation`, `chunk/finalize`, `notes regeneration`, `deletion`처럼 handler workflow 단위다.

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
- chunk worker 기본값은 per-job staged queue가 아니라 full fan-out이다. `OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY`를 넣었을 때만 waiting/queued 제한이 다시 걸리는지 확인한다.
- 상용 회의 데이터 잔존 여부를 편하게 볼 때는 `npm run check:meeting-data`를 사용한다.
- 회의 데이터를 전체 또는 특정 `meetingId` 기준으로 수동 정리할 때는 기본 dry-run인 `npm run delete:meeting-data -- --all` 또는 `npm run delete:meeting-data -- --meeting-id <id>`를 먼저 보고, 실제 삭제는 같은 명령에 `--execute`를 붙인다.
- 회의 삭제 task와 1시간 sweep은 job/artifact/part/finalizer뿐 아니라 관련 `integration_inova_meeting_commands`와 회의 단위 `launch/workspace session`까지 함께 정리해야 한다.
- notes regenerate worker는 삭제 중 command/job/artifact를 다시 만들지 않게, 삭제된 문서에는 `set-if-exists` 식으로만 상태를 갱신한다.

## 언제 사용자에게 다시 물을지
- 패널 회의 허브 문제인지 hosted 작업실 문제인지, auth 문제인지 전사 worker 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 공통 helper, admin bootstrap, export wiring이 필요할 때만 `functions/platform/*`과 `functions/index.js`를 읽는다.
