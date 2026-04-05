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
- hosted recovery/self-healing 경로는 `hosting/meeting/workspace-recovery.js`를 먼저 본다.

## hosted workspace auth 메모
- hosted 회의 작업실 Firebase auth claim은 `meetingId` 단위로 달라질 수 있다.
- 그래서 `hosting/meeting/firebase-client.js`에서는 `synchronizeTabs: true` 같은 cross-tab Firestore persistence를 켜지 않고, 여러 회의 탭이 각자 auth를 유지하도록 둔다.
- hosted Firestore `doc get/query`는 `meetingDocumentId` 같은 로컬 상태만 보고 바로 실행하지 않는다. 실제 Firebase custom-token sign-in이 완료됐는지 `ensureWorkspaceAuth()`로 먼저 보장한 뒤 읽어야 하며, 그렇지 않으면 실제 문서가 있어도 `Missing or insufficient permissions`가 날 수 있다.
- 실시간 listener permission 오류 재시도는 기존 작업실 access payload를 지운 뒤 막히지 않게, 같은 meeting auth로 강제 재로그인하는 흐름을 유지한다.
- hosted 회의 작업실의 `파일 불러오기`는 로컬/상용 모두 지원 대상이다. origin이 다르다는 이유만으로 버튼 표시나 import 실행을 막지 않는다.
- owner-secure hosted 작업실은 `meetingId`만으로 진입하거나 새로고침해도 업로드/삭제/수정이 계속 동작하도록 `authorizeInovaMeetingWorkspaceAccess`가 `meetingSessionToken`을 함께 돌려주고, 작업실은 그 토큰을 복원 세션에 저장한다.
- hosted 작업실의 오디오 import는 duration 메타데이터가 비어 있는 파일도 실제 decode로 길이를 다시 계산해 본다. 둘 다 실패할 때만 `길이를 확인하지 못해 바로 전사할 수 없습니다`를 유지한다.
- 위 duration decode fallback이 성공한 경우는 최종 실패처럼 취급하지 않는다. debug 로그는 informational하게 남기고, 실제 사용자 에러는 decode까지 실패했을 때만 보여 준다.
- hosted 작업실은 녹음 중 또는 실제 업로드 진행 중에 탭/브라우저를 닫으려 하면 브라우저 기본 이탈 경고를 띄운다. 업로드가 끝난 뒤 원격 처리만 남은 상태는 불필요하게 막지 않는다.
- hosted 작업실의 회의 제목은 UI에서 회의를 구분하는 편집용 라벨로만 취급한다. 회의 정리/회의록 생성 prompt에는 이 제목을 근거로 넣지 않고, 전사·공용 메모·추가 맥락만 사용한다.
- hosted 작업실의 로컬 pending queue는 원격 작업이 `succeeded`로 확정되면 자동 정리한다. 완료 후에도 같은 기록이 `진행 중`과 `완료`로 중복 표시되면 remote success cleanup 경로부터 본다.
- remote success cleanup은 먼저 `recentJobs` exact match를 본다. 다만 exact match가 있어도 meeting summary가 `processing`으로 stale할 수 있으므로, non-terminal match는 `jobId` direct lookup 또는 `requestId -> deterministic jobId -> doc get`으로 다시 확인한 뒤 정리한다. workspace Firestore rules는 `jobs` collection `list/query`를 허용하지 않으므로 request 기반 복구도 query가 아니라 doc read만 사용한다.
- 다만 requestId 기반 doc read는 `복구 fallback`일 뿐이다. 아직 원격 job이 생성되지 않은 local-only pending까지 여기에 넣지 말고, 새 import/prepare/upload 초반 상태는 skip한다. 존재하지 않는 job doc는 workspace rules상 `permission denied`처럼 보일 수 있으므로, 이런 케이스는 `miss`로 다운그레이드하지 말고 애초에 시도하지 않는 쪽으로 고친다.
- stale summary는 pending이 있을 때만 고치지 않는다. `recentJobs`에 남은 non-terminal remote record도 실제 job 문서와 다시 대조해 `succeeded/failed`가 확인되면 list status를 즉시 교정한다.
- 위 direct read 복구는 정상 진행 중 every-snapshot 경로가 아니다. 활성 processing record는 `recentJobs` 요약을 우선 쓰고, 선택된 job/artifact 상세는 `10초 polling`으로만 동기화한다. direct doc read는 stale pending 또는 오래된 non-terminal summary처럼 복구 근거가 있을 때만 제한적으로 실행한다.
- 새 전사 processing 구간은 artifact가 아직 없다고 보고 설계한다. 선택 상세 polling도 processing job에서는 artifact를 읽지 않고, terminal 상태나 기존 completed record mutation처럼 artifact가 실제로 의미 있는 시점에만 읽는다.
- hosted stale pending, orphan queue, 잘못된 진행 상태가 1~2회 패치 후에도 남으면 더 이상 추측 패치를 누적하지 않는다. 실제 상용 페이지에서 `debug=1` 로그, 화면 스크린샷, `window.__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })` 결과를 먼저 모은 뒤 그 식별자 기준으로 수정한다.
- 위 console helper가 없으면 코드 문제가 아니라 배포/캐시 mismatch 가능성을 먼저 본다. 이 경우는 `hosting` 재배포 여부와 페이지 강한 새로고침 여부를 확인하고, helper가 보이는 최신 JS인지부터 맞춘다.
- meeting feature에서 반복 오류가 stale pending, orphan record, 잘못된 진행 상태처럼 화면에 남는 유형이면 수동 정리를 운영 절차로 두지 않는다. 원인 수정과 함께 자동 복구 패치 또는 안전한 정리 스크립트를 같은 작업 안에서 판단한다.
- meeting feature에서 복구 규칙이 늘어나면 `workspace-*.js` 본문에 조건문만 계속 쌓지 말고 recovery/patch 전용 JS로 분리한다. 대신 일회성 cleanup은 `scripts/` 쪽 별도 실행 경로로 둔다.

## 관련 functions 경로
- `functions/features/meeting/meeting-launch-service.js`
- `functions/features/meeting/meeting-service.js`

## 운영 튜닝 메모
- Functions runtime 점검은 `npm run check:function-runtime -- --functions createInovaMeetingJob,uploadInovaMeetingSource,processQueuedInovaMeetingJob,processQueuedInovaMeetingJobPart,finalizeChunkedInovaMeetingJob,processQueuedInovaMeetingCommand,regenerateInovaMeetingNotes --since 2100 --limit 200`부터 본다.
- 기본 HTTP 함수는 특별한 이유가 없으면 Firebase 기본 runtime(`256MiB`, `60s`, `concurrency 80`, `maxInstances 20`)을 그대로 쓴다.
- `processQueuedInovaMeetingJobPart`에서 `429 no available instance`가 보이면 메모리를 먼저 늘리기보다 `OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY`와 queue burst를 먼저 확인한다.
- chunk worker 기본 queue concurrency는 env override가 없으면 adaptive `1~5`로 본다. 한 번에 모든 part를 동시에 queued 상태로 밀어 넣지 않는다.
- `uploadInovaMeetingSource`는 raw audio buffer를 직접 받아서 storage upload까지 처리하므로 기본 `256MiB` 대신 중간값 `512MiB`를 유지한다.
- chunk/finalize worker는 전사와 notes finalize를 맡으므로 메모리는 `1GiB`를 유지하고, 사용자 수를 늘려 볼 때는 timeout보다 `maxInstances`를 먼저 조정한다.
- deletion worker는 전사 처리 함수가 아니므로 최근 운영 로그에서 안정적이면 `512MiB/120s`, scheduler sweep은 `256MiB/60s`처럼 가볍게 유지한다.

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
- 상용 회의 데이터 정리 여부를 편하게 볼 때는 `npm run check:meeting-data`를 사용한다.
- hosted 상태 mismatch를 조사할 때는 실제 상용 페이지를 `?debug=1`로 열고, 디버그 패널 복사 로그와 아래 콘솔 명령 결과를 함께 확보한다.
- hosted 디버그 콘솔의 일반 로그는 최근 `120`건만 유지한다. 대신 오류 로그는 별도 버퍼로 유지하므로, 일반 이벤트가 많아 오래된 항목이 밀려도 `오류` 복사 버튼이나 `window.__INOVA_HOSTED_MEETING_DEBUG__.errors()`로 오류만 따로 확보할 수 있어야 한다.
- 디버그 패널 상단 통계(`로그/함수/읽기/스냅샷/오류`)는 현재 보이는 `120`건 버퍼가 아니라, 마지막 `비우기` 이후의 누적값을 기준으로 유지한다. 최근 로그 창에서 오래된 항목이 밀려도 통계는 줄어들면 안 된다.
- 상단 카운터는 일반 로그 개수를 섞지 않고 `함수`, `읽기`, `리스너`, `오류`만 보여 준다. `함수`는 HTTP/Functions 요청, `읽기`는 direct read/query, `리스너`는 snapshot 이벤트를 뜻한다.
- panel과 hosted debug console은 같은 렌더 계약과 같은 상태 라벨(`함수/읽기/리스너/오류`)을 유지한다. 폭과 로그 영역 높이도 가능한 한 같은 기준값을 써서 표면별 UI drift를 줄인다.
- hosted 기록 상세 카드 상단은 제목과 기록 액션 중심으로 유지한다. 진행 중 상태 설명이나 분할 업로드/처리 배지는 상세 카드에 다시 노출하지 않고, 이런 진행 정보는 기록 목록 또는 아래 `상태` 검토 탭에서만 본다.
- 위 helper는 degraded notice가 있거나 pending queue 진단 정보가 일부 비어 있어도 예외를 던지지 않고 현재 가능한 snapshot을 우선 덤프해야 한다.
- 위 helper 출력에는 pending queue snapshot뿐 아니라 최근 hosted debug entry도 함께 포함되어야 한다. stale pending 조사에서 queue 상태와 Firestore/read/query 로그를 같은 캡처로 맞춰 본다.

```js
window.__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })
```

- 회의 데이터를 전체 또는 특정 `meetingId` 기준으로 수동 정리할 때는 기본 dry-run인 `npm run delete:meeting-data -- --all` 또는 `npm run delete:meeting-data -- --meeting-id <id>`를 먼저 보고, 실제 삭제는 같은 명령에 `--execute`를 붙인다.
- 회의 삭제와 기록 개별 삭제는 화면 항목 제거로 끝나지 않고, 관련 command 문서와 회의 단위 launch/workspace session까지 cleanup task가 정리해야 한다.

## 언제 사용자에게 다시 물을지
- 패널 회의 허브 문제인지 hosted 작업실 문제인지, auth 문제인지 전사 backend 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- feature-local과 owned-shared만으로 해결되지 않고 launch/session 발급 또는 panel cache가 얽힐 때만 platform/shell로 넓힌다.
