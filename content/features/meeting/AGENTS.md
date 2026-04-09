# meeting feature

## 기능 목적
- 회의 허브, hosted 작업실, 녹음, 전사, 결과 검토를 다룬다.

## 문서 갱신 규칙
- 이 feature의 사용자 체감 동작, 데이터 경계, 먼저 볼 파일, 검증 기준이 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md` 대신 이 문서나 meeting 전용 docs에 먼저 기록한다.
- meeting endpoint/auth/collection baseline이 바뀌면 `docs/refactoring-plan.md`의 `Meeting Legacy Baseline`과 `Version Decision Gate`도 같은 작업 안에서 함께 갱신한다.
- meeting refactor가 minor로 끝나는지 major가 필요한지의 최종 판단 기준은 `docs/refactoring-plan.md`에 둔다. 이 문서는 meeting local 사실과 검증 기준을 맞춰 주는 역할을 한다.

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
- legacy lane은 현재 `browser-extension-main` hosted meeting 경로를 유지한다. v2 lane은 별도 hosting origin/site로 분리하는 것을 기본 전제로 둔다.
- 다만 v2 lane은 `major가 실제로 필요할 때만` 활성화 후보로 본다. 현재 핵심 질문은 meeting 리팩터링이 legacy 계약 유지로 끝날 수 있는지 여부다.

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
- hosted 작업실의 녹음 종료 액션은 사용자 기준 결과가 바로 읽히는 문구를 우선한다. 현재 `종료하고 전사` 대신 `녹음 완료`를 쓰고, 완료 시 자동으로 기록 생성이 이어진다는 설명을 함께 보여 준다.
- panel 회의 허브는 그룹 단위 화면임을 패널 제목과 생성 CTA에서 먼저 드러낸다. 패널 제목은 `회의 룸`, 생성 액션은 `새 회의 룸 생성`처럼 두되, 본문 리스트 표면은 `목록`처럼 짧게 유지해 같은 단어를 과하게 반복하지 않는다.
- panel 회의 허브 리스트 카드에서는 상태를 두 번 반복하지 않는다. 시간/메타 줄과 우측 칩 중 하나만 상태 source of truth로 쓰고, 현재는 우측 칩만 상태를 보여 준다.
- hosted 회의 룸 헤더의 관리 액션이 하나뿐이면 `더보기`로 숨기지 않고 바로 노출한다. 현재는 `회의 룸 삭제`를 우측 툴바에 직접 보여 주고, 확인 모달도 같은 용어로 맞춘다.
- hosted 회의 룸의 기본 헤더 용어와 launch 기본 제목도 같은 위계를 따라간다. 상단 eyebrow는 `회의 룸`, 새 작업실 기본 제목은 `새 회의 룸`을 우선한다.
- hosted 작업실의 `기록 메모` placeholder는 짧은 감상문보다 실제 회의 정리에 필요한 배경 정보를 예시로 직접 보여 준다. 회의 목적, 참석자/역할, 전사에 잘 안 남는 제약이나 꼭 반영할 포인트를 바로 적을 수 있게 안내한다.
- hosted 회의 룸 헤더의 단일 관리 액션은 분할 버튼 래퍼에 넣지 않는다. 액션이 하나뿐이면 독립 버튼으로 렌더해 잔여 구획 배경이나 분할선이 보이지 않게 유지한다.
- 회의 정리는 전사 텍스트가 있다고 바로 생성하지 않는다. 발화가 거의 없거나 잡음/오인식처럼 보이는 약한 전사는 backend gate로 한 번 더 판별하고, 건너뛸 때는 왜 자동 회의 정리를 만들지 않았는지 사용자 문구로 드러낸다.
- hosted 작업실의 로컬 pending queue는 원격 작업이 `succeeded`로 확정되면 자동 정리한다. 완료 후에도 같은 기록이 `진행 중`과 `완료`로 중복 표시되면 remote success cleanup 경로부터 본다.
- remote success cleanup은 먼저 `recentJobs` exact match를 본다. 다만 exact match가 있어도 meeting summary가 `processing`으로 stale할 수 있으므로, non-terminal match는 `jobId` direct lookup 또는 `requestId -> deterministic jobId -> doc get`으로 다시 확인한 뒤 정리한다. workspace Firestore rules는 `jobs` collection `list/query`를 허용하지 않으므로 request 기반 복구도 query가 아니라 doc read만 사용한다.
- 다만 requestId 기반 doc read는 `복구 fallback`일 뿐이다. 아직 원격 job이 생성되지 않은 local-only pending까지 여기에 넣지 말고, 새 import/prepare/upload 초반 상태는 skip한다. 존재하지 않는 job doc는 workspace rules상 `permission denied`처럼 보일 수 있으므로, 이런 케이스는 `miss`로 다운그레이드하지 말고 애초에 시도하지 않는 쪽으로 고친다.
- stale summary는 pending이 있을 때만 고치지 않는다. `recentJobs`에 남은 non-terminal remote record도 실제 job 문서와 다시 대조해 `succeeded/failed`가 확인되면 list status를 즉시 교정한다.
- 위 direct read 복구는 정상 진행 중 every-snapshot 경로가 아니다. 활성 processing record는 `recentJobs` 요약을 우선 쓰고, 선택된 job/artifact 상세는 `10초 polling`으로만 동기화한다. direct doc read는 stale pending 또는 오래된 non-terminal summary처럼 복구 근거가 있을 때만 제한적으로 실행한다.
- 새 전사 processing 구간은 artifact가 아직 없다고 보고 설계한다. 선택 상세 polling도 processing job에서는 artifact를 읽지 않고, terminal 상태나 기존 completed record mutation처럼 artifact가 실제로 의미 있는 시점에만 읽는다.
- completed record selection도 terminal summary를 우선 신뢰한다. 활성 workspaceMutation이 없는 완료 기록은 selection 때 `job` 재읽기를 생략하고, 실제 본문이 필요한 artifact만 읽는 쪽을 기본으로 둔다. 단, 클라이언트가 추적 중인 pending mutation의 requestId가 snapshot workspaceMutation.requestId와 일치할 때는 (`pendingMutationJustCompleted`) mutation 완료 직후로 판단해 job을 강제로 재읽기한다 — 제목 저장, 추가 맥락 저장, 회의록 업데이트 후 UI 즉시 반영을 위한 예외다.
- hosted 상단에는 수동 `새로고침` 액션을 기본 노출하지 않는다. 회의 문서 listener와 선택 상세 polling을 기본 동기화로 두고, 세션/URL 복원도 예전 `jobId`보다 현재 선택 record를 우선 저장한다.
- hosted stale pending, orphan queue, 잘못된 진행 상태가 1~2회 패치 후에도 남으면 더 이상 추측 패치를 누적하지 않는다. 실제 상용 페이지에서 `debug=1` 로그, 화면 스크린샷, `window.__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })` 결과를 먼저 모은 뒤 그 식별자 기준으로 수정한다.
- 위 console helper가 없으면 코드 문제가 아니라 배포/캐시 mismatch 가능성을 먼저 본다. 이 경우는 `hosting` 재배포 여부와 페이지 강한 새로고침 여부를 확인하고, helper가 보이는 최신 JS인지부터 맞춘다.
- meeting feature에서 반복 오류가 stale pending, orphan record, 잘못된 진행 상태처럼 화면에 남는 유형이면 수동 정리를 운영 절차로 두지 않는다. 원인 수정과 함께 자동 복구 패치 또는 안전한 정리 스크립트를 같은 작업 안에서 판단한다.
- meeting feature에서 복구 규칙이 늘어나면 `workspace-*.js` 본문에 조건문만 계속 쌓지 말고 recovery/patch 전용 JS로 분리한다. 대신 일회성 cleanup은 `scripts/` 쪽 별도 실행 경로로 둔다.

## 관련 functions 경로
- `functions/features/meeting/meeting-launch-service.js`
- `functions/features/meeting/meeting-common-domain.js`
- `functions/features/meeting/meeting-guard-domain.js`
- `functions/features/meeting/meeting-notes-context-domain.js`
- `functions/features/meeting/meeting-notes-document-domain.js`
- `functions/features/meeting/meeting-notes-runtime-domain.js`
- `functions/features/meeting/meeting-mutation-domain.js`
- `functions/features/meeting/meeting-record-domain.js`
- `functions/features/meeting/meeting-source-domain.js`
- `functions/features/meeting/meeting-state-domain.js`
- `functions/features/meeting/meeting-service.js`
- `functions/features/meeting/meeting-transcript-domain.js`

## 운영 튜닝 메모
- Functions runtime 점검은 `npm run check:function-runtime -- --functions createInovaMeetingJob,uploadInovaMeetingSource,processQueuedInovaMeetingJob,processQueuedInovaMeetingJobPart,finalizeChunkedInovaMeetingJob,processQueuedInovaMeetingCommand,regenerateInovaMeetingNotes --since 2100 --limit 200`부터 본다.
- 기본 HTTP 함수는 특별한 이유가 없으면 Firebase 기본 runtime(`256MiB`, `60s`, `concurrency 80`, `maxInstances 20`)을 그대로 쓴다.
- `processQueuedInovaMeetingJobPart`는 기본값에서 chunk 수만큼 바로 fan-out한다. 외부 압력으로 임시 throttle이 필요할 때만 `OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY`를 쓴다.
- `uploadInovaMeetingSource`는 raw audio buffer를 직접 받아서 storage upload까지 처리하므로 기본 `256MiB` 대신 중간값 `512MiB`를 유지한다.
- chunk worker는 1차 운영 기준을 `2GiB / cpu 1 / concurrency 2 / maxInstances 200`으로 두고, finalize는 `1GiB / concurrency 1 / maxInstances 80`을 유지한다. `concurrency 3` 이상은 fresh OOM/429 없이 48-72시간 관찰한 뒤에만 올린다.
- deletion worker는 전사 처리 함수가 아니므로 최근 운영 로그에서 안정적이면 `512MiB/120s`, scheduler sweep은 `256MiB/60s`처럼 가볍게 유지한다.

## 관련 데이터 경계
- `integration_inova_meetings`
- `integration_inova_meeting_jobs`
- `integration_inova_meeting_job_parts`
- `integration_inova_meeting_job_finalizers`
- `integration_inova_meeting_artifacts`
- launch/session 컬렉션
- v2 lane을 열 때는 위 mutable meeting namespace를 legacy와 공용 write하지 않는다. 새 lane은 별도 namespace 또는 안전한 copy migration을 전제로 설계한다.
- 반대로, 위 namespace를 유지한 채 refactor가 가능하다고 검증되면 버전은 major가 아니라 minor 경로를 우선한다.

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
- hosted boot나 기록 선택 로딩이 느릴 때는 `firestore.auth.step/success`, `workspace.realtime.connect.success`, `workspace.sync.state`, `workspace.detail.job-sync`의 단계별 timing 로그를 먼저 보고 auth, 첫 snapshot, 상세 artifact read 중 어디가 병목인지부터 가른다.
- hosted boot는 회의 룸과 기록 목록을 먼저 그리고, 선택된 기록 상세 artifact는 비차단으로 뒤늦게 채우는 흐름을 우선한다. 그래서 boot 체감은 `workspace.refresh.success`와 `workspace.detail.job-sync` 완료 시점을 분리해서 본다.
- 위 deferred 상세 로딩 로그는 boot 분석 때 `selection`으로 뭉개지지 않게 reason을 유지한다. boot 후속 상세 읽기는 `boot`/`boot-deferred` reason으로 남겨 같은 기록 선택 로그와 구분한다.

```js
window.__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })
```

- 회의 데이터를 전체 또는 특정 `meetingId` 기준으로 수동 정리할 때는 기본 dry-run인 `npm run delete:meeting-data -- --all` 또는 `npm run delete:meeting-data -- --meeting-id <id>`를 먼저 보고, 실제 삭제는 같은 명령에 `--execute`를 붙인다.
- 회의 삭제와 기록 개별 삭제는 화면 항목 제거로 끝나지 않고, 관련 command 문서와 회의 단위 launch/workspace session까지 cleanup task가 정리해야 한다.

## 언제 사용자에게 다시 물을지
- 패널 회의 허브 문제인지 hosted 작업실 문제인지, auth 문제인지 전사 backend 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- feature-local과 owned-shared만으로 해결되지 않고 launch/session 발급 또는 panel cache가 얽힐 때만 platform/shell로 넓힌다.

## 구현 안전 메모
- hosted workspace controller 간 helper 계약은 암묵 전역에 기대지 말고 `controller("pendingUploads")`나 `ns.shared`에서 명시적으로 연결한다. queue action, network error helper처럼 여러 파일이 같이 쓰는 경로일수록 wiring 누락을 lint로 바로 드러나게 유지한다.
- `0.4.4` legacy lane은 새 구조를 직접 덮어쓰지 않는다. v2를 도입할 때도 legacy hosted path, 기존 Functions export, 기존 meeting namespace는 sunset 전까지 그대로 둔다.
- `functions/features/meeting/meeting-service.js`는 legacy export와 handler surface를 유지하고, 전사 분절과 회의록 transcript shaping 같은 순수 helper부터 `functions/features/meeting/meeting-transcript-domain.js`로 옮겨 내부 분리를 진행한다.
- meeting backend 리팩토링은 파일 수보다 workflow/data 경계를 우선한다. 항상 같이 로드되고 같이 수정되는 얇은 helper는 같은 domain이나 service에 남길 수 있다.
- `functions/features/meeting/meeting-service.js`의 목표 end-state는 `legacy handler/export surface + cross-domain orchestration`이다. 여러 backend domain을 함께 엮어 auth, Firestore, Storage, OpenAI 흐름을 끝내는 helper는 service에 남길 수 있다.
- `functions/features/meeting/meeting-common-domain.js`, `functions/features/meeting/meeting-guard-domain.js`는 현재 `helper-only provisional boundary`다. 이후 유지 가치가 약하면 다시 service나 기존 domain에 합칠 수 있다.
- text/block normalize, transcript segment, JSON parse, source filename 같은 순수 공용 helper는 `functions/features/meeting/meeting-common-domain.js`로 분리해도 handler/export surface와 persisted 계약은 그대로 유지한다.
- ownership assert와 제목 동기화 guard helper는 `functions/features/meeting/meeting-guard-domain.js`로 분리해도 auth scope, mutation 권한 의미, title sync 조건은 그대로 유지한다.
- notes context/snapshot helper는 `functions/features/meeting/meeting-notes-context-domain.js`로 분리해도 HTTP/trigger surface와 Firestore 계약은 바꾸지 않는다.
- notes 문서 normalize/preview helper는 `functions/features/meeting/meeting-notes-document-domain.js`로 분리해도 회의록 스키마 의미나 persisted payload shape는 그대로 유지한다.
- notes bundle/completion runtime helper는 `functions/features/meeting/meeting-notes-runtime-domain.js`로 분리해도 notes status, schema version, completion parsing 의미는 그대로 유지한다.
- request/source/job-part normalize helper는 `functions/features/meeting/meeting-source-domain.js`로 분리해도 upload request 의미, queued part/finalizer 상태 계약은 그대로 유지한다.
- mutation/deletion normalize helper는 `functions/features/meeting/meeting-mutation-domain.js`로 분리해도 workspace mutation, command, deletion task 문서 shape와 상태 의미는 그대로 유지한다.
- queued job/result artifact/meeting summary builder는 `functions/features/meeting/meeting-record-domain.js`로 분리해도 summary 문서 shape, artifact payload, stable ID/path 규칙은 그대로 유지한다.
- job/artifact/summary normalize와 transcription response helper는 `functions/features/meeting/meeting-state-domain.js`로 분리해도 persisted state 의미, recentJobs 정렬, preview fallback 규칙은 그대로 유지한다.
