# i-Nova 더하기

`i-Nova 더하기`는 `inova.incross.com` 대화 화면에 편의 기능을 덧붙이는 크롬 확장프로그램입니다. 현재 MVP는 `실험실 패널 + hosted 회의 작업실` 구조로, 현재 대화의 `질문 모아보기`, DB 기반 `회의 허브`, 사용자가 직접 저장하는 `자주 쓰는 요청`, 여러 사용자가 공유하는 `프롬프트 스토어`, 그리고 수동 배포용 `릴리스 안내`를 한 패널 안에서 바로 씁니다.

## Feature-first 작업 시작

- 이 저장소에서는 새 요청이 오면 먼저 [docs/feature-routing.md](docs/feature-routing.md)에서 primary feature를 고르고, 해당 feature `AGENTS.md`와 먼저 볼 파일만 읽고 시작합니다.
- 저장소 전체 리팩터링의 현재 기준선과 진행률 규칙은 [docs/repo-refactor-plan.md](docs/repo-refactor-plan.md)를 기준으로 맞춥니다.
- 실행 표면과 런타임 경계가 필요할 때만 [docs/runtime-architecture.md](docs/runtime-architecture.md)를 봅니다.
- `popup`, `background/service-worker.js`, `content/main.js`, `content/panel.js`, `functions/index.js`, `manifest.json`, `shared/*`는 platform/shell로 취급하고, feature 범위만으로 해결되지 않을 때만 읽습니다.
- `content/prompt-hub-view.js`, `content/prompt-hub-state.js`, `content/prompt-hub-panel.js`, `content/prompt-hub-controller.js`, `content/prompt-hub-runtime.js`는 `내 요청/스토어/검토` shell을 담당하므로, 단일 prompt feature 소유 파일로 보지 않습니다.
- cue가 두 feature 이상에 걸리면 저장소 전체를 넓게 읽는 대신 짧게 `이 기능이 맞나요?`를 먼저 확인합니다.
- feature 작업 중 두 번째 primary feature를 읽어야 하거나 `content + functions + hosting` 3축이 동시에 필요해지면, 먼저 커밋 또는 다음 세션 분리를 제안합니다.

## 핵심 기능

- `팝업 작업실 연결 설정`
  - 확장프로그램 팝업에서는 회의 작업실이 `상용 호스팅`과 `로컬 호스팅` 중 어디를 바라볼지 선택합니다.
  - 팝업은 설정만 담당하고, 실제 `새 회의하기`와 결과 확인은 패널에서 이어집니다.
  - 선택한 값은 `settings.meetingWorkspaceTarget`에 저장되어 패널의 회의 진입에도 그대로 적용됩니다.
- `디버그`는 별도 ON/OFF로 저장되고, ON이면 패널 전역과 작업실에 로그 패널과 로그 수집을 켭니다.
- `질문 자동 모으기`
  - 현재 대화에 보이는 사용자 질문을 자동으로 모아 보여줍니다.
  - 질문 목록은 현재 대화 화면을 기준으로 실시간으로 갱신됩니다.
- `우측 슬라이드 패널`
  - 채팅 화면 오른쪽에 붙는 `실험실 패널`을 제공합니다.
  - 왼쪽의 세로 도구 레일에서 `대화`, `회의`, `프롬프트`, `릴리스`를 바로 전환할 수 있습니다.
  - 기본은 닫힌 상태이며, 켜져 있을 때만 핸들과 패널이 보입니다.
  - 사용자가 마지막으로 열어 둔 상태를 같은 탭에서 기억합니다.
  - 닫힌 상태의 `실험실` 핸들은 위아래로 옮길 수 있고, 위치는 사이트 기준으로 기억합니다.
  - 패널 상태가 다시 그려져도 검색창과 주요 입력 필드의 포커스/커서 위치를 최대한 유지합니다.
- `회의록 패널`
  - `회의` 도구는 Firestore 회의 문서를 실시간으로 구독해 최신 회의록 목록과 `새 회의하기` CTA를 제공합니다.
  - 패널용 hidden bridge는 Firestore persistence와 탭 세션 Firebase auth를 함께 써서, 같은 탭 새로고침에서는 캐시 우선 표시와 auth 재사용을 우선합니다.
  - Firestore 첫 snapshot이 늦게 오면, 빈 목록 상태에서만 요청형 회의 목록 1회를 워밍업으로 먼저 보여주고 이후 실시간 snapshot으로 정본을 맞춥니다. 이 워밍업 응답은 background에서 짧게 재사용해 연속 새로고침 비용을 줄입니다.
  - 회의 허브 목록과 hosted 작업실 진입에 쓰는 panel/session auth도 background의 짧은 TTL 캐시를 함께 써서, 같은 탭 재진입이나 새로고침에서 같은 토큰/목록을 불필요하게 다시 만들지 않게 유지합니다.
  - 패널 목록의 항목을 누르면 해당 회의 결과를 전용 새 탭 작업실에서 다시 확인합니다.
- `회의 페이지`
  - Firebase Hosting에 올린 전용 회의 작업실에서 `회의 식별`, `현재 녹음`, `회의 공용 메모`, `처리 이력/업로드 큐`, `선택 결과 검토`를 한 화면에서 처리합니다.
- 팝업에서 `디버그 ON`을 켜면 패널과 작업실이 `debug=1` 기준으로 로그 패널을 열고, 화면 안에서 세션 복원, Functions 요청, Firestore auth/listener 로그를 바로 확인할 수 있습니다.
- 패널 디버그는 회의 탭 전용이 아니라 현재 브라우저 탭 세션 기준 전역 버퍼로 유지되고, `대화/회의/프롬프트/릴리스` 흐름 로그를 함께 모읍니다.
  - 작업실과 패널의 디버그 콘솔은 팝업의 `디버그`가 ON일 때만 표시되고, OFF일 때는 로그도 수집하지 않습니다.
  - hosted 작업실은 blocked 상태로 멈추더라도, `debug=1`이면 bootstrap/session 실패 같은 초기 로그를 디버그 콘솔에서 바로 확인할 수 있게 유지합니다.
  - 디버그 로그는 화면 안 패널/작업실 콘솔에만 모아 보여주고, panel/workspace/service worker가 같은 내용을 DevTools 브라우저 콘솔에 다시 미러링하지 않습니다.
  - hosted 작업실과 prompt/meeting hosted bridge는 Firestore SDK DevTools 경고 로그도 `silent`로 낮추고, Firebase SDK보다 먼저 `enableMultiTabIndexedDbPersistence()` deprecation 경고 같은 반복 persistence 안내를 숨겨 브라우저 콘솔에는 꼭 필요한 런타임 오류만 남깁니다.
  - 상태 바의 `함수` 카운트는 실제 Firebase Functions 요청만 세고, `읽기` 카운트는 스토어 `보기` 같은 backend read 요청만 따로 셉니다.
  - 디버그 로그 `복사`, `오류`, `비우기` 피드백은 회의 허브 본문 카드가 아니라 디버그 콘솔 안에서만 표시됩니다.
  - 디버그 버퍼는 같은 `bridge.detach`, `surface.changed`, `route.refresh`, 클릭 probe/visibility 기반 `route.sync skipped` 같은 반복 노이즈를 그대로 누적하지 않고 줄여서 보여줍니다.
  - 프롬프트 bridge가 이미 끊긴 상태에서는 같은 `prompt.panel.bridge.detach`를 반복해서 다시 찍지 않습니다.
  - 디버그 상태 바에서 `오류 n건`은 별도 경고 톤으로 강조해, 이상 징후가 있을 때 바로 눈에 띄게 표시합니다.
  - hosted 작업실 디버그 상태 바도 패널과 같은 `로그/함수/읽기/스냅샷/오류` 개별 배지 구조와 공통 요약 카운트를 사용합니다.
  - hosted `meeting/shared.js`도 패널과 같은 디버그 복사/오류 필터/요약 helper 계약을 함께 내보내서, blocked/bootstrap 실패 화면에서도 디버그 패널이 먼저 살아 있도록 유지합니다.
- hosted 작업실 세션/큐 degraded 경고는 `저장값 없음`, `session/local storage 접근 실패`, `파싱 실패`, `저장 실패`, `삭제 실패`, `stale refresh`를 같은 결과로 뭉개지 않고, 명시적 code/priority registry와 공통 diagnostics consumer를 기준으로 우선순위가 있는 scoped warning UI와 디버그 로그에서 구분해 보여줍니다. 로컬 업로드 큐 read 실패는 작업실 shell 전체를 바로 막지 않고 degraded 상태로 계속 진행하고, failed/stalled 기록 재시작은 새 retry 항목 `put` 안에서 이전 requestId를 함께 supersede해 old/new 중복 항목이 남지 않도록 정리합니다. 같은 retry/restart 전이는 `index.js`의 공통 transition helper를 기준으로 추적하고, queue degraded/error 로그도 같은 `requestId/reason/phase` 문맥을 함께 남깁니다. `attemptPendingUpload()`도 single/chunk source 모드를 한 흐름에 뒤섞지 않고 mode별 전이로 나누고, chunk 경로는 `uploadedPartCount`와 `publishedPartCount`를 분리해 로컬 청크 업로드 진행과 원격 job publish 진행을 같은 상태로 취급하지 않습니다. 또한 chunk 모드는 `첫 chunk로 remote parent job bootstrap -> 남은 local chunk backlog upload -> remote start follow-up 판단 -> remote publish follow-up 판단 -> 이번 시도에 local chunk 진척이 없을 때만 remote resync 판단` 순서로 단계가 갈려 있고, `chunk-start`, `chunk-publish`, `chunk-resync`가 같은 계획 객체를 공유하지 않습니다. `uploaded/published gap`, `jobId 존재`, `이번 시도에서 local chunk가 실제로 더 올라갔는지`를 기준으로 `chunk-start`, `chunk-publish`, `chunk-resync`, `sync`를 명시적으로 구분해 해석하며, `chunk-resync`처럼 상태 확인 성격의 호출은 실패해도 local pending을 곧바로 `failed`로 덮지 않고 warning/degraded로 남깁니다. snapshot 기반 remote sync와 chunk follow-up resync의 terminal-state 해석도 이제 같은 builder를 공유하지 않고, snapshot 쪽은 `completed/remote-failed`, chunk-resync 쪽은 `reconcile-completed/reconcile-remote-failed`를 써서 같은 terminal state라도 서로 다른 운영 의미로 남깁니다. 또한 chunk workflow sync도 이제 같은 불린 하나로 묶지 않고, 결과 생성성 mutation이 만든 `workflow-chunk-mutation` 동기화와 resync가 terminal remote state를 발견했을 때만 만드는 `workflow-chunk-reconcile` 동기화로 나뉩니다. 원격 상태 해석도 이제 `buildPendingUploadRemoteStartTransition()`, `buildPendingUploadRemotePublishTransition()`, `buildPendingUploadRemoteSnapshotTransition()`, `buildChunkedPendingUploadRemoteResyncTransition()`으로 갈려, remote job 시작 응답과 추가 chunk 반영 응답, snapshot 기반 상태 반영, chunk-resync 기반 상태 반영이 같은 error 문맥이나 완료 판정 규칙을 공유하지 않습니다. transition commit 경계도 이제 `commitPendingUploadRemoteMutationTransition()`과 `commitPendingUploadRemoteSnapshotTransition()`, `commitChunkedPendingUploadRemoteResyncTransition()`으로 갈려, snapshot 쪽만 `updatedAt` 보존과 local->remote selection 전환, `remote-sync-*` write phase를 소유하고 chunk-resync commit은 `chunk-resync-*` write phase와 `resyncCacheAction`만 받도록 좁혀져 snapshot용 selection 승격이나 generic reset contract를 공유하지 않습니다. persist degraded state도 더 이상 하나의 `pendingUploadPersist` 슬롯으로 뭉치지 않고, 일반 queue 저장 실패, snapshot remote sync 저장 실패, chunk-resync 저장 실패를 각각 다른 notice code와 diagnostics bucket으로 남겨 서로의 경고를 덮어쓰지 않게 유지합니다. start 완료 경계도 `commitSinglePendingUploadRemoteStart()`와 `commitChunkedPendingUploadRemoteStart()`로 갈라져, single-start와 bootstrap chunk 기반 chunk-start가 같은 invalid-status log와 rename-after-create 문맥을 공유하지 않습니다. 원격 요청 경계도 `requestPendingUploadRemoteMutationState()`와 `requestChunkedPendingUploadRemoteReconcileState()`로 갈라져, single/chunk 결과 생성 요청만 inline source fallback과 create 문맥을 가지며 chunk follow-up resync는 기존 job이 있는 chunked source만 다시 확인하도록 입력 보장과 오류 의미를 따로 유지합니다. publish/resync 완료 증거도 `workspace.pending-upload.chunk-publish.*`와 `workspace.pending-upload.chunk-resync.*`로 갈라져, 기존 job에 추가 chunk를 반영한 결과와 원격 상태를 다시 읽어 브라우저 보관 상태를 맞춘 결과가 같은 `remote-create` 또는 공통 applied 로그 의미를 공유하지 않습니다. 원격 상태 반영도 `applyPendingUploadRemoteSnapshotState()`, `startSinglePendingUploadRemoteJob()`, `startChunkedPendingUploadRemoteJob()`, `publishPendingUploadRemoteChunks()`, `reconcileChunkedPendingUploadRemoteState()`로 source가 갈려, realtime snapshot sync, single remote start, bootstrap chunk 기반 remote start, existing job chunk publish, chunk follow-up resync가 같은 degraded/selection/success 정책을 공유하지 않습니다. 특히 single start만 inline source fallback을 허용하고, chunk start는 실제로 업로드된 bootstrap chunk가 있어야만 원격 job 시작 경로를 타며, start 성공 뒤 notice/sync 정책도 shared helper가 아니라 각 start 경로에서 직접 결정합니다. manual hold/resume/delete와 workspace delete는 물론 load/remote sync/import/capture/record rename, chunk part upload, remote job create/refresh까지 queue context를 같은 축으로 남기고, degraded notice도 load/persist/cleanup phase에 맞는 문구로 갈라 어느 단계에서 브라우저 보관 정리가 흔들렸는지 더 바로 구분합니다.
  - hosted 작업실 디버그가 켜져 있으면 브라우저 콘솔에서 `__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.arm("queue-load-indexeddb-read")`처럼 queue storage fault scenario를 바로 걸 수 있고, 가능한 시나리오는 `__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.scenarios()`와 [docs/meeting-storage-fault-validation.md](docs/meeting-storage-fault-validation.md)에서 확인할 수 있습니다. fault를 건 뒤에는 `__INOVA_HOSTED_MEETING_DEBUG__.queueState()`로 현재 notice, degraded diagnostics, pending upload 요약, 최근 queue 이벤트를 한 번에 읽을 수 있고, `__INOVA_HOSTED_MEETING_DEBUG__.queueValidation.check("queue-load-indexeddb-read")`로 기대 결과를 pass/fail로 바로 요약할 수 있습니다. 낮은 레벨 fault key가 필요하면 `__INOVA_HOSTED_MEETING_DEBUG__.setFault(name, count)`와 `__INOVA_HOSTED_MEETING__.storage.DEBUG_FAULTS`를 그대로 쓸 수 있고, `queueFaults.clear(name)` 또는 `clearFault()`로 개별/전체 fault를 비울 수 있습니다.
  - hosted 작업실 디버그 콘솔은 카드 폭, 패딩, 로그 타이포도 패널 디버그 콘솔과 같은 치수 기준으로 맞춥니다.
  - 로컬 작업실에서는 `파일 불러오기`로 실제 오디오 샘플을 바로 전사 테스트할 수 있고, `25MB 초과` 또는 `약 20분 초과` 원본도 브라우저에서 `16kHz mono wav chunk`로 나눈 뒤 한 기록 결과로 이어 처리합니다.
- hosted 회의 작업실은 기본적으로 `최대 200MB 또는 2시간` 원본까지 지원하고, 큰 오디오나 긴 녹음은 `약 9분 / 1.5초 overlap` 기준 chunk 업로드 후 서버에서 단일 회의 결과로 병합합니다.
- chunk 전사는 parent job이 직접 끝까지 돌지 않고, `청크 part 문서 -> chunk worker 함수 1개당 청크 1개 처리 -> chunk transcript JSON 임시 저장 -> finalizer 함수가 최종 병합/화자 정합/회의 정리` 순서로 나눠 처리합니다.
- chunk 모드에서는 모든 part 업로드가 끝날 때까지 기다리지 않고, 첫 chunk가 올라오는 즉시 parent job을 만들고 이후 올라오는 chunk를 같은 job에 계속 반영해 전사를 앞당깁니다.
- 각 chunk 업로드 HTTP 성공은 응답만 돌려주고 끝나지 않고, 이미 존재하는 parent job이 있으면 해당 part의 `storageObject/uploadStatus`를 Firestore job source에도 즉시 반영합니다. 그래서 뒤따르는 deduped `createInovaMeetingJob` 호출이 stale source snapshot을 보내더라도, 이미 올라간 chunk가 다시 `pending_upload`로 밀리는 race를 줄입니다.
- chunk worker는 job 1건 기준으로 업로드가 끝난 chunk를 즉시 `queued`로 승격해 곧바로 전사를 시작합니다. 그래서 1개가 올라오면 1개가 바로 돌고, 20개가 모두 올라온 상태면 20개도 같은 job 안에서 동시에 worker 대상으로 열릴 수 있습니다.
- `processQueuedInovaMeetingJobPart`는 배포 시 `maxInstanceCount: 20`과 별도로 `concurrency: 1`로 운영해, 한 chunk worker 인스턴스가 여러 청크 요청을 동시에 떠안지 않게 유지합니다. 즉 11개 청크면 인스턴스당 1개 요청 기준으로 최대 11개 worker가 퍼져서 처리되고, 한 프로세스가 11개를 함께 전사하지 않습니다.
- `OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY`를 주면 이 기본 동작 대신 job별 고정 병렬 수로 명시적으로 핀할 수 있습니다. 값을 주지 않으면 hosted 회의실의 chunk worker queue는 업로드된 chunk 수만큼 즉시 열리고, 단일 invocation 안에서 직접 chunk를 묶어 전사하는 fallback 경로만 별도 adaptive concurrency를 유지합니다.
- 긴 회의 처리 중 상태 안내는 단계 카드와 청크 진행판 위주로 보여주고, 같은 내용을 반복하는 별도 파란 배너는 processing 상태에서 겹치지 않게 숨깁니다.
- 작업실 상세 카드 아래에는 chunk 업로드/전사 진행을 별도 진행바와 chunk 칸 목록으로 보여주고, 전사 중에는 실제 병렬 worker 수만큼 파란 칸을 함께 표시해 로그 없이도 진행 상태를 바로 확인할 수 있게 유지합니다.
- 실패한 기록을 `다시 처리`로 재시작한 직후에는, 새 업로드/분할 준비가 끝나기 전까지 예전 stalled remote job 상태를 상세 카드에 다시 섞어 보여주지 않고 현재 로컬 재시작 상태를 우선 표시합니다.
- 전사/정리 중 OpenAI `429/5xx` 같은 일시 오류가 나면 회의 job을 바로 `failed`로 끝내지 않고, 제한 횟수 안에서 자동으로 다시 `queued`에 태워 재시도합니다.
- 작업실 진행 안내에는 자동 재시도가 발생한 경우 `자동 재시도 n회`를 함께 표시해, 멈춘 것인지 다시 도는 중인지 바로 구분할 수 있게 유지합니다.
- 전사 진행 중 `updatedAt`이 `10분` 넘게 멈추면 파란 진행 상태를 계속 유지하지 않고 `정체 의심`으로 표시하며, 기록 큐에서 바로 `다시 처리`를 눌러 브라우저 원본으로 재시작할 수 있게 유지합니다.
- 원격 처리까지 갔다가 `failed`로 끝난 기록은 임시 원본이 이미 정리됐을 수 있으므로, 작업실에서는 `지금 업로드` 대신 `다시 처리`로 안내하고 브라우저에 남아 있던 원본을 다시 업로드해 같은 기록 처리 흐름을 재시작합니다.
- `다시 처리`나 stalled job `재시작`은 예전 `requestId`를 재사용하지 않고 새 `requestId`로 큐를 다시 만들어, 기존 stalled/failed job과 dedupe되지 않게 유지합니다.
  - 이때 기록 큐에서는 예전 stalled/failed 원격 job을 새 시도가 대체한 것으로 보고, 같은 제목이 두 줄로 겹쳐 보이지 않게 이전 시도 항목을 숨깁니다.
  - 녹음은 `녹음 시작 -> 일시중지/재개 -> 종료하고 전사` 흐름으로 동작하고, 종료된 녹음본은 원격 처리 완료 전까지 브라우저 로컬 큐에 보관합니다.
  - 한 기록은 기본 `90분`까지 이어지고, 제한 시간에 도달하면 현재 기록을 자동 전사로 넘긴 뒤 다음 개별 기록 녹음을 바로 이어갑니다.
- 전사가 끝나면 회의록 형식의 자동 정리본과 `발화 구간`, `화자별` AI 정리 화면을 같은 상세 화면에서 함께 보여주고, 회의의 내용 구조는 AI가 자동 판단합니다.
- 회의 정리 탭은 이제 상용 회의록 SaaS처럼 `핵심 요약`, `회의 개요`, `주요 논의 내용`, `주요 결정 사항`, `추가 결정 필요 사항`, `리스크 및 제약`, `후속 실행 항목` 순으로 읽히도록 정리합니다.
- 사용자는 회의 정리 탭에서 `기본 회의록`, `간결 브리프`, `실행 중심` 같은 `표현 방식`만 골라 다시 정리할 수 있습니다.
- 회의 정리의 `열린 쟁점`, `후속 질문`, `의존성`처럼 배열로 내려오는 항목은 객체형 응답이 섞여도 읽을 수 있는 문장으로 정규화해 표시합니다.
- `상태` 탭에서는 현재 기록을 `기록 선택 -> 발화 구간 -> 회의 정리 -> 화자 이름 -> 화자별 정리 -> 검토 마무리` 순서의 단계 흐름으로 보여주고, 완료 단계는 조용하게 처리한 채 현재 확인이 필요한 단계만 더 또렷하게 보여줍니다.
  - 회의 정리가 완료되면 AI가 만든 `meetingMeta.title`을 해당 기록 제목으로 바로 반영하고, 이후 다시 정리해도 최신 AI 제목으로 덮어씁니다.
- 발화 구간 탭에서는 자동 화자 라벨을 실제 이름/역할로 바꿔 저장할 수 있고, 시간대가 포함된 전체 전사를 바로 복사하거나 저장한 화자명으로 회의 정리를 다시 생성할 수 있습니다. `화자별` 탭에서는 각 화자가 주로 말한 내용을 AI가 화자 기준으로 따로 정리해 보여줍니다.
  - 회의는 현재 대화 세션과 분리된 `meetingId` 기준으로 관리하고, 같은 회의의 처리 이력만 페이지 안에 남깁니다.
- 좌측 `기록 큐` 카드는 긴 본문 미리보기보다 `AI 판단`, `표현 방식`, `화자 수` 같은 칩 중심으로 보여줘서 어떤 기록을 다시 열어야 하는지 빠르게 구분할 수 있게 유지합니다.
- 작업실에서는 작업실 이름과 공용 메모를 저장할 수 있고, 우측 `기록 검토` 패널에서 개별 기록 이름 수정과 삭제를 함께 처리합니다. 삭제를 실행하면 연결된 job/artifact와 남아 있는 임시 source object까지 함께 정리합니다.
  - 패널에서 회의를 열면 확장이 짧은 수명의 launch grant를 즉시 hosted workspace session으로 교환한 뒤, `#ws`가 붙은 최종 hosted 작업실 URL을 새 탭으로 엽니다.
  - 작업실에서는 사용자가 직접 `녹음 시작`을 눌러 웹앱에서 바로 마이크 녹음을 시작하고, 표준 `getUserMedia + MediaRecorder` 경로로 녹음합니다.
  - 녹음을 마치면 `종료하고 전사`가 즉시 로컬 저장과 업로드 큐 등록을 끝내고, 원격 처리 중이어도 바로 다음 녹음을 시작할 수 있습니다.
  - 오프라인이거나 업로드가 실패하면 같은 녹음본은 로컬 큐에 남아 있다가 온라인 복귀 시 자동 재시도하고, 필요하면 `지금 업로드`, `보류`, `삭제`를 직접 고를 수 있습니다.
- 원격 처리 중 상태 갱신은 작업실이 `MeetingSession -> issueInovaMeetingWorkspaceAuth -> Firebase Auth`를 거친 뒤 Firestore `meeting/job/artifact` 문서를 직접 구독해 반영합니다. Functions는 업로드/삭제/재정리 같은 명령만 맡고, 탭 복귀 시에는 끊긴 listener만 다시 연결합니다.
- `새 회의하기`처럼 아직 회의 문서가 비어 있는 첫 진입도, 작업실 세션 토큰이 가리키는 해당 meeting 문서 ID에 한해 Firestore listener를 먼저 붙일 수 있게 유지합니다.
- hosted 작업실은 boot 시 로컬 세션/보관 큐만 준비되면 빈 작업실 shell을 먼저 렌더하고, 첫 Firestore snapshot은 짧게만 기다린 뒤 늦으면 뒤에서 이어 받아 체감 로딩을 줄입니다.
- 패널에서 한 번 연 작업실은 clean URL 뒤의 workspace hash 토큰으로 같은 탭/브라우저에서 다시 이어지고, hash 없이 `?meetingId=`만 직접 열면 접근을 막고 패널에서 다시 열도록 안내합니다.
- `대화 안에서 찾기`
  - 지금 보고 있는 대화 안에서만 질문을 검색합니다.
  - 결과를 클릭하면 해당 질문 위치로 이동하고, 좁은 화면에서는 패널을 잠시 접어 원문을 보기 쉽게 합니다.
- `자주 쓰는 요청 보관함`
  - 사용자가 직접 요청을 추가, 수정, 삭제할 수 있습니다.
  - 좌측 도구 레일에서 `프롬프트`를 누르면 기본으로 `내 요청` 탭부터 엽니다.
  - 요청을 선택하면 현재 대화 입력창에 바로 주입할 수 있습니다.
  - 입력창에 내용이 이미 있으면 `덮어쓰기` 또는 `이어붙이기`를 고를 수 있습니다.
  - 대화 입력창 우측 상단의 평가 버튼으로 현재 프롬프트를 바로 점검할 수 있습니다.
  - 평가 결과에서는 점수보다 먼저 `감점 이유/보완이 필요한 항목`을 우선 보여줍니다.
  - 평가는 외부 AI 모델을 사용한 참고 의견으로 안내합니다.
  - 평가 결과에서 보완 프롬프트를 확인하고 다시 반영할 수 있습니다.
  - 보완 프롬프트에 `[대상 독자]` 같은 자리표시자가 남아 있으면 한 번 더 확인한 뒤 반영해야 합니다.
  - 평가 뒤 입력창 내용이 바뀌면 이전 보완안은 바로 반영되지 않고, 다시 평가를 요구합니다.
- `요청 가져오기/내보내기`
  - 자주 쓰는 요청 보관함을 JSON으로 내보낼 수 있습니다.
  - 요청 묶음을 가져오면 `id`가 같아도 `제목 + 내용`이 다르면 새 항목으로 추가하고, `제목 + 내용`이 같은 항목만 자동으로 건너뜁니다.
- `프롬프트 스토어`
  - 사용자는 본인 요청을 카테고리를 골라 스토어에 등록하거나 삭제할 수 있습니다.
  - 다른 사용자가 등록한 요청을 찾아 `내 요청으로 가져오기` 할 수 있습니다.
  - `전체`와 `내 등록` 범위를 전환해 내가 올린 항목만 따로 볼 수 있습니다.
  - 각 항목에는 등록자, 조회수, 가져오기 수, 좋아요 수가 함께 표시됩니다.
  - `좋아요`와 `가져오기` 같은 사용자 반응을 통해 어떤 요청이 인기 있는지 볼 수 있습니다.
- 공개 `전체` 스토어는 Firestore `latest` feed 앞쪽 문서를 필요할 때만 최대 `1000`건까지 실시간 구독해 두고, 검색/카테고리/정렬은 그 로컬 집합 안에서 엑셀 필터처럼 다시 계산합니다.
- 그래서 `전체` 범위에서는 검색어 입력, 카테고리 변경, `최신순/좋아요순/가져오기순/조회수순` 전환이 새 목록 요청을 다시 만들지 않습니다.
- `전체` 범위의 자동 `scheduled` 갱신은 함수 read로 다시 불러오지 않고, realtime bridge 재연결만 시도합니다.
- 스토어 탭은 별도 `새로고침` 버튼 없이 자동 realtime/scheduled 갱신과 fallback read만 유지합니다.
- 검색 입력은 한글 IME 조합 중에는 패널 재렌더를 미뤄 조합이 깨지지 않게 유지하고, 실제 필터 적용은 `Enter` 또는 검색창 clear 동작 때만 반영합니다.
  - `내 등록` 범위와 좋아요/가져오기/삭제 같은 쓰기 액션은 계속 요청형으로 유지하고, 상세 `보기` 본문은 prompt panel bridge가 Firestore `prompt_store_entry_details`를 직접 읽어옵니다.
  - `좋아요/가져오기/조회수` 반응은 항목 메트릭만 갱신하고 latest feed 재생성은 하지 않아, 실시간 범위를 줄이는 대신 쓰기 비용을 아낍니다.
  - prompt/store용 hosted bridge auth는 background cache를 통해 같은 패널 탭 안에서 짧게 재사용하고, bridge가 잠깐 끊겨도 기존 목록과 상세를 최대한 유지한 채 재연결을 우선 시도합니다.
- `릴리스 안내`
  - 패널 안에서 현재 설치 버전과 최신 배포본 여부를 확인할 수 있습니다.
  - 최신 릴리스와 이전 버전은 핵심 제목과 짧은 요약만 먼저 보여주고, 자세한 변경 내역은 `변경 내용 보기`에서 펼쳐 확인합니다.
  - 릴리스 패널에는 사용자가 체감하는 변경만 보여주고, 내부 운영 변경은 별도 릴리스 메타 기록으로만 관리합니다.
  - 새 버전이 있으면 ZIP 다운로드 링크와 수동 업데이트 방법을 함께 안내합니다.
  - 설치와 업데이트 절차도 접힌 안내로 제공해 필요할 때만 펼쳐 볼 수 있습니다.
  - 최신 버전은 고정 링크 `https://browser-extension-main.web.app/extension/downloads/latest.zip` 로도 항상 받을 수 있습니다.
  - 이전 버전도 버전별 변경 요약과 함께 ZIP 링크로 롤백할 수 있습니다.
  - 이 확장은 `i-Nova 상용 기능 적용 전 실험 기능을 빠르게 검증하기 위한 도구`이며, 제작/운영은 `AI비즈솔루션팀`입니다.

- `클라우드 백업 기반`
  - 프롬프트 보관함 변경은 `cloudSync` 메타와 함께 로컬에 큐잉됩니다.
  - 프롬프트 보관함 정본은 계속 `chrome.storage.local.promptLibrary`에 두고, 원격 실시간은 `integration_inova_accounts/{providerUserKey}.promptLibraryMeta` 1개 문서만 구독합니다.
  - 원격 `lastRevision` 또는 `lastSyncedAt`가 더 최신이고 로컬 pending sync가 없을 때만 전체 보관함 hydrate를 다시 요청합니다.
  - prompt/store hosted bridge와 hosted meeting workspace listener는 Firestore offline persistence를 켜 두어, 같은 브라우저에서 새로고침해도 캐시된 최신 snapshot을 먼저 보여주고 이어서 서버와 동기화합니다.
  - 원격 백업 호출은 페이지 스크립트가 아니라 확장프로그램 백그라운드 서비스워커가 맡습니다.
  - i-Nova access token은 현재 사용자 검증에만 쓰고, 저장 키는 `providerUserKey` 기준으로 유지합니다.

## 모듈 구조

- `background/`
  - `service-worker.js`: 외부 네트워크 호출과 클라우드 백업, prompt/store panel auth, 회의 허브/launch grant gateway 중계
  - `meeting-list-cache.js`, `panel-auth-cache.js`: 회의 허브 fallback 응답과 prompt/meeting panel auth를 짧게 재사용하는 메모리 캐시
- `hosting/extension/`
  - `prompt-panel-bridge.html`, `prompt-panel-bridge.js`: 패널 content script 대신 프롬프트 메타 문서와 스토어 최신 feed page 문서를 구독하는 숨겨진 hosted bridge
  - `releases/`, `downloads/`: 릴리스 패널이 읽는 최신/히스토리 메타와 버전별 ZIP 다운로드 자산
- `hosting/meeting/`
  - `index.html`, `index.css`: 회의 작업실 레이아웃과 실용형 UI 스타일
  - `debug-console.js`: 패널/작업실이 함께 쓰는 debug console render contract와 viewport helper
  - `index.js`: hosted 회의 작업실 부팅, launch token 교환, 세션 복원, 녹음/업로드 큐/상세 액션 orchestration과 queue diagnostics consume/error wrapper, queue-backed action error notice 처리, retry reset/upload cleanup 경계와 superseded local request 정리, retry/restart transition helper, remote create/sync가 같은 pending 전이 계약을 쓰도록 맞춘 reconciliation, 이해하지 못한 remote status나 불완전한 create 응답을 silent fallback 대신 warning/error로 surface하는 전이 규칙, single upload 실패 뒤 inline 전사 경로도 암묵적 기본값이 아니라 명시적으로 허용할 때만 사용
  - `firebase-client.js`: `MeetingSession`을 Firebase custom token으로 교환하고 Firestore 문서 구독을 연결하는 hosted helper
  - `panel-bridge.html`, `panel-bridge.js`: 패널 content script 대신 Firestore query를 수행하는 숨겨진 hosted bridge
  - `shared.js`: 공통 상태/포맷터/네트워크 헬퍼와 hosted session restore storage 진단 helper
  - `storage.js`: IndexedDB 기반 로컬 업로드 큐, fallback storage, operation-scoped queue read/write/delete diagnostics helper, IndexedDB transaction failure 진단, superseded retry request collapse helper
  - `notes.js`: 회의록 schema 정규화와 mode별 표시 포맷터
  - `render.js`: 이력/상세/회의록 섹션 렌더링
- `offscreen/`
  - `meeting-recorder.js`: 확장 내부 legacy 캡처 경로 호환용 오디오 recorder
- `shared/`
  - `constants.js`: 저장 키, 셀렉터, 제한값 계약
  - `cloud-api.js`: Firebase Functions 호출 래퍼와 회의 기능 gateway 요청 래퍼
  - `cloud-sync.js`: 동기화 상태/문서 정규화
  - `firebase-config.js`: Firebase 프로젝트와 함수 엔드포인트 설정
  - `inova-auth.js`: i-Nova access token 갱신 보조
  - `meeting-bridge.js`: 브라우저 쪽 회의 runtime message 래퍼
  - `meeting-debug.js`: 확장 패널 디버그 로그 버퍼와 복사 helper
  - `meeting-state.js`: 회의 `meeting/job/transcript` 로컬 상태 정규화와 legacy session fallback
  - `prompt-library.js`: 요청 보관함 정규화, 가져오기/내보내기 규칙
  - `prompt-store.js`: 스토어 카테고리, 엔트리 정규화, 정렬 규칙
  - `provider-identity.js`: 현재 i-Nova 사용자 식별 정보 정규화
  - `session.js`: `sid`, 질문 정규화, 메시지 ID 생성
  - `storage.js`: `settings`, `pausedSessions`, `uiPreferences`, `promptLibrary`, `cloudSync`, `meetingState`, `meetingStateByMeetingId` 읽기/쓰기와 legacy `meetingHub` 호환 헬퍼
- `popup/`
  - 팝업 설정 UI와 hosted 회의 작업실 연결 대상 선택
- `meeting/`
  - `index.js`: 확장 내부 legacy 회의 페이지 자산
- `content/`
  - `dom.js`: 질문 DOM 수집
  - `bookmark-view.js`: 질문 탭 렌더링과 포커스 이동
  - `features/prompt-review/composer-review-float.js`: 입력창 우측 상단 평가 버튼과 팝오버 렌더링
  - `features/prompt-library/cloud-sync-manager.js`: 프롬프트 보관함 원격 백업 흐름 조정
  - `features/prompt-library/files.js`: 가져오기/내보내기용 파일 읽기와 JSON 다운로드 helper
  - `features/prompt-store/prompt-realtime-manager.js`: prompt/store용 hosted bridge 연결, Firebase custom token auth, 최신 snapshot fallback 조정
  - `meeting-manager.js`: 패널 회의 허브 Firestore realtime 구독, fallback refresh, local cache 조정
- `meeting-view.js`: 회의 허브 리스트와 `새 회의하기` CTA, 패널 공용 디버그 콘솔 렌더링
  - `release-manager.js`, `release-view.js`: 릴리스 확인 실패 시 cached data 여부를 구분해 degraded 상태를 명시적으로 표시
  - `features/prompt-review/prompt-review-manager.js`: 현재 입력 프롬프트 평가 호출과 상태 관리
  - `features/prompt-library/prompt-view.js`: 요청 탭 렌더링
  - `features/prompt-library/prompt-manager.js`: 요청 CRUD, 가져오기/내보내기, 입력창 주입
  - `features/prompt-store/store-view.js`: 프롬프트 스토어 탭 렌더링
  - `prompt-hub-state.js`: prompt 탭 선택, count, render snapshot, cloud sync 조건을 묶는 prompt tool shell state helper
  - `prompt-hub-panel.js`: prompt/store 탭 클릭, 입력, drag, scroll 위임을 묶는 prompt tool shell panel helper
  - `prompt-hub-controller.js`: prompt 탭 전이, 액션 라우팅, store 후속 sync를 묶는 prompt tool shell controller
  - `prompt-hub-runtime.js`: prompt manager/review/store/realtime/controller 조립을 묶는 prompt tool shell runtime helper
  - `prompt-hub-view.js`: `내 요청/스토어/검토` body를 묶는 prompt tool shell
  - `features/prompt-store/store-manager.js`: 스토어 목록, 좋아요, 가져오기, 등록/삭제 흐름
  - `route-sync.js`: 대화 전환 감시와 실시간 질문 동기화
  - `panel.js`: 우측 슬라이드 패널 셸과 도구 레일
  - `main.js`: 패널 상태와 각 모듈 조립
- `contracts/`
  - 파일 크기와 필수 경로 계약
- `scripts/`
  - 문서/구조 자동 검증, 버전 상승, 릴리스 메타 가드 스크립트
- `releases/`
  - 버전별 배포 ZIP과 `release-notes.json` 릴리스 카탈로그

## 런타임 구조 문서

- 실제 실행 경계와 데이터 흐름은 [docs/runtime-architecture.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/runtime-architecture.md)를 기준으로 봅니다.
- 에이전트나 사람이 저장소를 처음 읽을 때는 `README.md` 다음으로 위 문서를 먼저 보면 `popup -> hosted meeting -> content -> background -> functions -> Firestore/Hosting` 경계를 빠르게 잡을 수 있습니다.
- `releases/_staging`, `hosting/extension/downloads`, `hosting/extension/releases/latest.json`, `hosting/extension/releases/history.json`은 배포 산출물이며 수정 기준이 아닙니다.

## 동작 방식

- 확장프로그램은 `manifest V3`로 구성되어 있습니다.
- `popup/index.js`는 `settings.meetingWorkspaceTarget`을 읽고, hosted 회의 작업실 연결 대상을 `상용 호스팅 / 로컬 호스팅` 중 하나로 저장합니다.
- `hosting/meeting/index.js`는 `launch` 또는 clean URL의 `meetingId`, `jobId`, workspace hash 토큰을 기준으로 hosted 세션을 부팅하고, `getUserMedia + MediaRecorder`로 마이크 녹음을 처리합니다.
- hosted 회의 작업실은 `공용 메모 저장 -> 녹음 종료와 동시에 로컬 큐 적재 -> 온라인이면 즉시 job 생성 -> 원격 처리와 별개로 다음 녹음 허용` 흐름으로 동작합니다.
- `content/main.js`는 현재 URL의 `sid`를 기준으로 대화를 나누고, `.chat-message--user`를 실시간으로 수집합니다.
- `content/features/prompt-library/prompt-manager.js`는 `promptLibrary`를 관리하고, 선택한 요청을 현재 대화 입력창에 주입합니다.
- `content/features/prompt-store/prompt-realtime-manager.js`는 `issueInovaPromptPanelAuth -> hosted prompt panel bridge -> Firestore account/feed doc` 경로로 프롬프트 원격 메타와 스토어 공개 최신 feed 앞쪽 페이지를 실시간 구독하고, 스토어 상세 본문도 같은 bridge로 직접 읽어옵니다. bridge HTML/JS는 캐시 버스트 URL과 no-cache 헤더를 함께 써서 hosting-only 배포 직후에도 예전 스크립트가 오래 남지 않게 합니다. 실패 시 기존 요청형 경로로 되돌립니다.
- `content/features/prompt-review/prompt-review-manager.js`는 현재 입력창 프롬프트를 평가하고 보완 프롬프트를 다시 주입합니다.
- `content/features/prompt-store/store-manager.js`는 `프롬프트 스토어` 목록 조회, 등록, 삭제, 좋아요, 가져오기 흐름을 관리하고, 공개 최신 feed snapshot이 오면 목록에 바로 반영합니다. 상세 `보기`는 Firestore detail doc를 직접 읽습니다.
- `content/features/prompt-store/store-manager.js`는 `전체 스토어 + realtime 활성`일 때 publish/unpublish 뒤에 강제 `inova-store:list` 재요청을 하지 않고 snapshot 반영을 기다립니다. `내 등록`이나 realtime fallback 상태만 request-response 재조회를 유지합니다.
- `content/features/prompt-store/store-manager.js`는 `전체 스토어 + realtime 예상 상태`에서는 탭 진입, route refresh, `전체/내 등록` 전환 중 `전체` 복귀 때도 먼저 `inova-store:list`를 치지 않고 Firestore snapshot을 기다립니다. `내 등록`만 요청형 로드를 유지합니다.
- `content/main.js`와 `content/features/prompt-store/prompt-realtime-manager.js`는 스토어 최신 목록 bridge가 잠깐 끊겨도 이미 화면에 목록이 있으면 그대로 유지하고, 첫 목록이 아직 없을 때만 `fallback` read를 허용합니다. 디버그의 `panel.ui.surface.changed`도 실제 표면 유무가 바뀌는 경우만 남겨 노이즈를 줄입니다.
- `content/meeting-manager.js`는 패널에서 `issueInovaMeetingPanelAuth -> hosted panel bridge -> Firestore meeting query` 경로로 owner 기준 최신 회의 목록을 실시간 구독하고, 브리지나 인증이 실패할 때만 `listInovaMeetings` fallback으로 현재 메모리 허브 상태를 갱신합니다.
- `background/service-worker.js`는 i-Nova access token과 Firebase Functions를 연결해 원격 백업 호출과 prompt/store panel auth 발급을 처리하고, 회의 기능에서는 launch grant 발급과 session 교환까지 끝낸 최종 hosted 작업실 URL 생성, 허브 조회 라우팅을 맡습니다.
- `functions/features/meeting/meeting-launch-service.js`는 launch grant, hosted workspace session, Firestore 읽기용 Firebase custom token 발급을 맡깁니다.
- `processQueuedInovaMeetingJob`, `processQueuedInovaMeetingJobPart`, `finalizeChunkedInovaMeetingJob` Firestore background worker는 모두 `1GiB` 메모리와 `540초` timeout으로 운영하되, 긴 회의는 `parent job queue -> chunk worker들 -> finalizer`로 역할을 나눠 단일 함수가 모든 chunk를 붙잡지 않게 유지합니다.
- 특히 이 세 background worker는 모두 인스턴스당 동시 요청 수를 `1`로 고정해, parent job 처리·chunk 전사·finalizer 병합이 한 인스턴스에 여러 건씩 겹쳐 올라가지 않게 유지합니다. 병렬성은 인스턴스 수 확장으로 확보하고, 무거운 작업 자체는 한 프로세스가 1건씩만 처리합니다.
- `uploadInovaMeetingSource` HTTP 함수도 chunk/single 원본 업로드에서 raw audio body를 바로 메모리에 받아 bucket에 쓰는 heavy upload 경계라 `concurrency: 1`, `1GiB`, `120초`로 따로 고정합니다. 그래서 여러 chunk 업로드가 동시에 들어와도 한 인스턴스가 여러 raw audio 요청을 함께 받아 OOM 나는 기본 `80` 동시성을 타지 않습니다.
- 회의 결과 삭제와 작업실 삭제는 `queued`/`processing` 상태도 409로 막지 않고 바로 soft-delete/tombstone을 남깁니다. 삭제 요청이 오면 job/meeting/session을 즉시 `deletedAt` 상태로 내려 UI와 summary에서 숨기고, artifact·chunk part·finalizer·임시 source/chunk transcript 정리는 같은 요청 안에서 best-effort cleanup으로 비웁니다. 그래서 실패한 chunk upload나 in-flight worker가 남아 있어도 삭제 요청 자체는 성공하고, live worker도 tombstone 문서를 다시 visible summary로 복구하지 않게 유지합니다.
- hosted 회의 작업실은 `종료하고 전사` 또는 `파일 불러오기` 시점에 원본을 먼저 업로드 가능한 source로 준비한 뒤 `createInovaMeetingJob`으로 parent job을 일찍 만들고, chunk 업로드가 이어지는 동안 같은 job source를 계속 보강합니다. Functions background 처리기는 `source download -> chunk worker 전사 -> chunk transcript 임시 저장 -> finalizer 병합/화자 정합 -> 회의록 모드 분류 -> mode별 회의록 정리 생성 -> source/chunk cleanup -> Firestore meeting/job/artifact 저장`까지 처리합니다. 자동 회의록 정리는 이제 `notesStatus`, `notesDegradedReason`, 실제 `notesGeneratedAt`을 함께 기록해 `비활성`, `건너뜀`, `degraded`, `성공`을 구분하고, notes 생성 실패를 완료 시각만 채운 성공처럼 보이지 않게 유지합니다.
- 회의 정리와 모드 분류 기본 모델은 `gpt-5.4-mini`를 사용하고, 필요하면 `OPENAI_MEETING_SUMMARY_MODEL` 또는 `OPENAI_SUMMARY_MODEL`로 override할 수 있습니다.
- Functions는 같은 `requestId` 재전송을 idempotent하게 재사용하고, `sharedMemoSnapshot`과 notes mode 메타데이터를 함께 저장합니다.
- Functions가 source audio를 임시 bucket object로 저장할 때는 Firebase 설정의 기본 storage bucket을 우선 쓰고, 기본 bucket이 없는 프로젝트에서는 `STORAGE_BUCKET_URL`로 실제 존재하는 bucket을 명시해야 합니다. 현재 프로젝트는 chunk 업로드용으로 `gcf-v2-uploads-1027279095019.asia-northeast3.cloudfunctions.appspot.com`을 사용합니다.
- 회의 작업실 Firestore 구독용 Firebase custom token은 기본적으로 `1027279095019-compute@developer.gserviceaccount.com`으로 서명하고, 다른 계정을 써야 하면 `FIREBASE_AUTH_SIGNING_SERVICE_ACCOUNT`로 override할 수 있습니다.
- 함수 최적화나 병목 확인이 필요할 때는 `npm run check:function-runtime -- --since 1440 --filter meeting`처럼 실행하면, 현재 배포된 모든 함수의 `memory / timeout / concurrency / maxInstances`와 최근 request latency 요약을 한 번에 볼 수 있습니다. 특정 함수만 보고 싶으면 `--functions processQueuedInovaMeetingJob,processQueuedInovaMeetingJobPart`처럼 export 이름을 직접 넘기면 됩니다.
- 실제 이벤트/오류 로그를 빨리 훑고 싶을 때는 `npm run check:function-logs -- --since 180 --filter meeting`처럼 실행하면, 함수별 최근 log entry 수, request/error 수, 대표 event, 최근 로그 몇 줄을 한 번에 볼 수 있습니다. 문제 상황만 보려면 `--errors-only`, 특정 함수만 보려면 `--functions processQueuedInovaMeetingJobPart,finalizeChunkedInovaMeetingJob`를 함께 씁니다.
- 회의 업로드/전사 결과는 패널의 `회의` 도구에서 Firestore 구독 기반 허브 리스트로 보이고, 상세는 hosted `meeting/index.html` 새 탭 작업실에서 다시 확인합니다. 패널은 `issueInovaMeetingPanelAuth`로 발급한 Firebase custom token을 hidden hosted bridge에 넘겨 meeting 목록 query를 맡기고, 상세 상태는 작업실이 `meetingSessionToken`으로 `issueInovaMeetingWorkspaceAuth`를 한 번 호출한 뒤 Firebase Auth에 로그인하고 Firestore `meeting/job/artifact` 문서를 직접 구독해 반영합니다.
- 브라우저 쪽에서는 `shared/meeting-bridge.js` 와 `shared/meeting-state.js` 로 회의 녹음 start/stop, 회의 job 생성, artifact 반영, local `meetingState` 저장 기준을 먼저 맞춰 두었습니다.
- 질문 목록 자체는 `chrome.storage.local`에 저장하지 않고, 현재 대화 화면을 기준으로 바로 렌더링합니다.
- 요청 보관함은 `chrome.storage.local.promptLibrary`에 저장합니다.
- 원격 백업 대기 상태는 `chrome.storage.local.cloudSync`에 저장합니다.
- 프롬프트 원격 실시간은 `integration_inova_accounts`의 `promptLibraryMeta`만 구독하고, 실제 보관함 본문은 필요할 때만 `loadInovaPromptLibrary`로 다시 가져옵니다.
- 스토어 원격 실시간은 `prompt_store_meta/summary`와 `prompt_store_feed_pages/latest__{category}__0000`만 구독하고, 검색/인기 정렬은 로컬 집합에서 다시 계산합니다. 상세 본문은 `prompt_store_entry_details/{entryId}`를 direct read하고, `내 등록`과 쓰기 액션만 request-response 흐름을 사용합니다.
- 회의 허브 목록은 더 이상 `chrome.storage.local.meetingHub`를 정본 캐시로 쓰지 않고, hosted panel bridge의 Firestore persistence와 메모리 상태를 우선합니다.
- 회의 기능 브라우저 상태는 `chrome.storage.local.meetingStateByMeetingId`를 정본으로 두고, `meetingStateBySession`은 legacy fallback으로만 함께 유지합니다.

## 설치 방법

1. Chrome에서 `확장 프로그램` 페이지를 엽니다.
2. `압축해제된 확장 프로그램 로드`를 선택합니다.
3. 이 폴더를 선택합니다.
4. `i-Nova`에 접속한 뒤 필요하면 팝업에서 `상용 호스팅 / 로컬 호스팅`을 고릅니다.

## 사용 방법

1. 툴바 확장 아이콘을 눌러 `상용 호스팅` 또는 `로컬 호스팅`을 고릅니다.
2. i-Nova 채팅에서 질문을 보내면 `대화` 도구에 자동으로 반영됩니다.
3. 오른쪽 슬라이드 패널의 세로 레일에서 `대화`, `회의`, `프롬프트`, `릴리스`를 전환합니다.
4. `대화` 도구에서는 검색하거나 항목을 클릭해 해당 질문으로 이동합니다.
5. `회의` 도구에서는 DB 기반 회의 허브 목록과 `새 회의하기` 버튼을 확인하고, 항목을 눌러 hosted 새 탭 작업실 상세 페이지를 엽니다.
6. hosted 회의 작업실에서는 작업실 이름과 공용 메모를 먼저 정리한 뒤 녹음을 시작하고, 필요하면 일시중지/재개하거나 녹음을 버리고 다시 시작할 수 있습니다.
7. 로컬 작업실에서는 `파일 불러오기`로 실제 녹음 파일을 직접 넣어 전사 테스트할 수 있고, 큰 파일이나 긴 녹음은 자동으로 chunk 준비/업로드를 거칩니다.
8. `종료하고 전사`를 누르면 녹음본이 먼저 로컬 큐에 저장되고, 원격 처리 중이어도 바로 다음 녹음을 시작할 수 있습니다.
9. 녹음이 `90분`에 도달하면 현재 기록은 자동으로 전사 큐에 들어가고, 작업실은 다음 개별 기록 녹음을 이어갑니다.
10. 저장된 결과를 선택하면 우측 `기록 검토` 패널에서 이름을 수정하거나 삭제하고, 자동 정리와 발화 구간 기준 전사, 화자별 AI 정리를 함께 확인할 수 있습니다.
11. 필요하면 발화 구간 탭에서 화자명을 저장하고, 시간대 포함 전사를 전체 복사하거나 같은 전사를 기준으로 회의 정리를 다시 생성할 수 있습니다.
12. 회의 정리의 표현만 바꾸고 싶을 때는 회의 정리 탭에서 `표현 방식`을 고른 뒤 `...로 다시 정리` 버튼을 눌러 같은 전사로 회의록을 다시 생성할 수 있습니다. 회의 종류 판단은 계속 AI가 맡습니다.
12. `프롬프트` 도구에서는 자주 쓰는 요청을 추가하거나 선택해 현재 입력창에 바로 넣고, `스토어` 서브탭에서 공유 프롬프트를 찾아 좋아요를 누르거나 내 요청으로 가져옵니다.
13. 대화 입력창 우측 상단의 평가 버튼으로 현재 프롬프트를 참고용으로 평가하고, 필요하면 보완 프롬프트를 다시 반영합니다.
14. `릴리스` 도구에서는 현재 버전, 최신 버전, 업데이트 ZIP, 이전 버전 롤백 링크를 확인합니다.
15. 필요하면 요청 묶음을 JSON으로 내보내거나, 다른 사용자의 요청 묶음을 가져옵니다.

## 비목표

- 전체 대화 통합 검색
- 계정 간 공유
- 태그 편집
- AI 요약
- 자동 전송

## 검증

문서와 코드가 맞는지 확인하려면 다음을 실행합니다.

```bash
npm run verify
```

이 저장소의 기본 개발 루프는 실제 브라우저 확인을 우선합니다.

- 기본 자동 검증: `npm run verify`
- 세부 확인이 필요하면 `npm run verify:contracts`, `npm run verify:docs`
- UI/세션/opener 문제는 실제 Chrome에서 직접 확인
- prompt 계열 최소 smoke: unpacked extension `Reload` -> `https://inova.incross.com/` 새로고침 -> `실험실` 패널 열기 -> `프롬프트` 도구 진입
- `prompt-library`: `내 요청` 렌더링, 항목 1건 저장/수정, 입력창 주입 1회
- `prompt-store`: `전체` 목록, 상세 보기 1건, `좋아요` 또는 `내 요청으로 가져오기` 1회, 탭 이동 후 복귀 시 목록 유지
- `prompt-review`: 평가 버튼 노출, 평가 결과 1회, 보완 프롬프트 반영 1회
- 이번 최소 smoke 제외 범위: `import/export`, `cloud sync`, 공개 스토어 `등록/삭제`
- feature 문서의 `최소 검증`도 위 prompt smoke 범위를 기준으로 맞춘다.

회의 작업실 UI를 배포 없이 실제 브라우저에서 먼저 보고 싶으면 `로컬 Hosting + 상용 Functions` 조합을 씁니다.

```bash
npm run emulator:hosting
```

기본 로컬 주소는 `http://127.0.0.1:5000/meeting/index.html` 입니다. 확장프로그램은 그대로 Chrome에서 실행하고, 팝업에서 `상용 / 로컬`과 `디버그 OFF / ON`을 전환해 확인합니다. 디버그를 켜면 패널/작업실에서 세션 복원, 함수 호출, Firestore listener 흐름을 화면 안에서 바로 볼 수 있습니다.

queue degraded 수동 검증만 빠르게 하려면 localhost 작업실을 `http://127.0.0.1:5000/meeting/index.html?debug=1&debugQueueSandbox=1`로 열어 로컬 queue sandbox를 먼저 띄울 수 있습니다. 이 모드에서는 panel/session 없이도 `__INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.seedPending()`로 로컬 pending 항목을 만들고, `queueSandbox.runAction("hold" | "rename" | "delete")`와 reload 중심의 queue load/persist/cleanup 검증을 로컬에서 반복할 수 있으며 원격 refresh/retry는 건너뜁니다. `queueState()`에는 `runtimeChunkCacheKeys`도 함께 들어 있어 queue storage와 메모리 chunk cache가 어긋난 경우를 바로 확인할 수 있습니다. hosted debug console 공통 contract를 확인할 때는 `__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleState()`와 `debugConsoleValidation.checkWorkspace()`로 현재 DOM/toolbar/fab 상태를 한 번에 볼 수 있습니다.

panel/hosted debug console 실제 Chrome 검증 메모는 `docs/meeting-debug-console-validation.md`를 기준으로 봅니다.

로컬에서 자동 분할 녹음을 빨리 시험하고 싶으면 URL에 `recordLimitSeconds`를 붙이면 됩니다.

```text
http://127.0.0.1:5000/meeting/index.html?...&recordLimitSeconds=30#ws=...
```

또는 DevTools 콘솔에서 아래처럼 로컬 기본값을 저장할 수 있습니다.

```js
localStorage.setItem("__INOVA_MEETING_RECORD_LIMIT_SECONDS__", "30");
```

README 가드만 미리 확인하려면 다음을 실행합니다.

```bash
npm run verify:readme-guard
```

릴리스 메타 가드만 미리 확인하려면 다음을 실행합니다.

```bash
npm run verify:release-guard
```

## Git 훅

이 저장소는 기능 관련 파일이 바뀌었는데 `README.md`가 같이 수정되지 않으면 `pre-push`에서 push를 막습니다.

릴리스 준비 파일인 `package.json`, `manifest.json`, `releases/release-notes.json` 중 일부만 바뀌면 `pre-push`에서 함께 막습니다.

같은 가드를 더 이른 시점에 잡기 위해 `pre-commit`도 같이 적용합니다. 커밋 전에 `main` 직접 commit, staged 기준 `README`, `릴리스 준비 파일 불일치`를 먼저 막습니다.

훅을 이 저장소에 연결하려면 한 번만 다음을 실행합니다.

```bash
npm run hooks:install
```

`npm install`을 실행해도 `prepare` 스크립트로 훅 연결을 자동 시도합니다.

이후 `background/`, `content/`, `functions/`, `popup/`, `shared/`, `manifest.json` 같은 기능 관련 파일이 바뀌면 `README.md`도 함께 수정해야 commit/push가 통과합니다.

버전 상승과 `releases/release-notes.json` 갱신은 모든 feature commit마다 필요한 것이 아니라, 실제 배포나 릴리스 준비를 시작할 때만 맞추면 됩니다.

## 브랜치 작업 규칙

- 기본 작업 브랜치는 `codex/<task-name>` 형식을 권장합니다.
- `main`에서는 직접 commit 하지 않고, 작업 브랜치에서 commit 한 뒤 PR로 머지합니다.
- 로컬 훅은 `main` 직접 commit 과 `main` 직접 push 를 모두 막습니다.
- 정말 긴급한 예외만 `INOVA_ALLOW_MAIN_BRANCH=1`로 한 번 우회할 수 있게 두었습니다.
- PR은 필수지만 사람 승인 자체를 요구하지 않는 운영을 기본값으로 둡니다. 권한 있는 사용자는 자동 체크만 통과하면 머지할 수 있습니다.
- GitHub 원격 브랜치는 PR 머지 후 자동 삭제되도록 켜 두었습니다.
- 로컬에서는 `post-checkout`, `post-merge` 훅이 `main` 기준으로 이미 머지된 `codex/*` 브랜치만 자동 정리합니다.
- 로컬 자동 정리를 잠깐 끄고 싶으면 `INOVA_SKIP_BRANCH_CLEANUP=1`을 사용할 수 있습니다.

## 협업 가드레일

- 로컬에서는 `pre-commit`, `pre-push`가 같은 규칙을 단계별로 검사합니다.
- 원격에서는 [`.github/workflows/repo-guardrails.yml`](/C:/Users/parkyoungtack/Documents/code/inova_extension/.github/workflows/repo-guardrails.yml)이 `verify`, README 가드, 릴리스 메타 가드를 다시 검사하고, 릴리스 준비 파일이 바뀐 경우에만 `release:build`를 추가로 확인합니다.
- PR 화면에는 [`.github/pull_request_template.md`](/C:/Users/parkyoungtack/Documents/code/inova_extension/.github/pull_request_template.md) 체크리스트가 자동으로 들어갑니다.
- GitHub branch protection에서는 `main` direct push 금지와 `Repo Guardrails / verify` 체크 통과를 필수로 두고, 사람 승인 수는 0으로 두는 것을 기본값으로 권장합니다.

## 버전 운영 규칙

- `patch`: 버그 수정, 작은 UX/신뢰성 보강, 운영/배포 보완
- `minor`: 새 사용자 기능, 새 워크플로, 눈에 띄는 기능 확장
- `major`: 기존 사용 흐름을 깨거나 마이그레이션/재설치 판단이 필요한 변화
- `npm run version:bump -- <patch|minor|major>`를 실행하면 `package.json`, `manifest.json`, `releases/release-notes.json` 초안이 같이 갱신됩니다. 이 단계는 일반 개발 커밋이 아니라 배포/릴리스 준비 시점에만 실행하는 것을 기본값으로 둡니다.
- 새 버전 초안이 생기면 `releases/release-notes.json`의 `public.headline`, `public.summary`, `public.changes`를 실제 사용자 관점 내용으로 채워야 push와 배포가 통과합니다.
- 내부 운영 메모가 필요하면 `internal.changes`에 따로 적고, 릴리스 패널에는 노출하지 않습니다.
- `release:build`는 현재 버전의 릴리스 메타를 읽어 `hosting/extension/releases/latest.json`과 `history.json`에 그대로 반영합니다.
- `release:build`와 `deploy:hosting`은 마지막 배포 버전보다 더 높은 새 버전이 준비되지 않았으면 실패합니다.
- `release:build`는 고정 최신 링크용 `hosting/extension/downloads/latest.zip`도 함께 갱신합니다.

## 배포 기본값

- 일반적으로 `배포해줘`는 `hosting` 배포를 뜻합니다. 즉 확장 ZIP, `latest.json`, `history.json` 같은 릴리스 파일만 배포합니다.
- `함수 배포해줘` 또는 `backend/functions 배포해줘`라고 명시했을 때만 Firebase Functions를 배포합니다.
- `전체 배포해줘`, `hosting + functions 배포해줘`처럼 분명히 말한 경우에만 둘 다 배포합니다.
- 안전 기본값은 `hosting-only`입니다. 함수는 실수로 함께 배포하지 않는 쪽을 우선합니다.

배포 명령은 다음처럼 나뉩니다.

```bash
npm run deploy:hosting
npm run deploy:functions
npm run deploy:all
```

실제 브라우저 동기화 점검은 다음 문서를 봅니다.

- [docs/runtime-architecture.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/runtime-architecture.md)
- [docs/e2e-browser-workflow.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/e2e-browser-workflow.md)
- [docs/release-workflow.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/release-workflow.md)
