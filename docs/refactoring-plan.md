# Conditional Major Refactor Plan

이 문서는 단순 아이디어 메모가 아니라, 새 세션에서도 바로 이어서 작업할 수 있게 만드는 `living handoff` 문서다.  
현재 유효한 설계, 버전 결정 기준, 진행 상태, 다음 시작점을 한 문서에 모은다.
다만 `git log`, `diff`, 커밋 메시지로 충분히 복구 가능한 세부 변경 이력은 중복 기록하지 않고, 다음 판단에 필요한 milestone과 비가역 결정을 우선 남긴다.

리팩토링 기준일: 2026-04-09  
마지막 상태 갱신: 2026-04-10  
현재 공개 사용자 기준선: `0.4.4`  
현재 버전 결정 상태: `미정, 기본값은 minor 유지`  
현재 구현 앵커: `ce38835`의 lane foundation + 후속 문서 정리 커밋들

---

## 이 문서에서 가장 먼저 이해해야 할 것

- 버전은 리팩토링의 목표가 아니라 결과다.
- 이번 작업은 `무조건 1.0.0`이 아니라, 구현 결과에 따라 `0.5.x` 같은 minor로 끝날지 `1.0.0`으로 승격할지 판단하는 구조다.
- 새 세션은 과거 대화나 초안이 아니라, 이 문서의 `Version Decision Gate`, `Current Implementation Reality`, `Meeting Legacy Baseline`, `세션 인계 로그`를 기준으로 시작한다.
- version lane, legacy/v2 baseline, release gate처럼 장기 판단 비용이 큰 파일이 바뀌면 `docs/refactoring-plan.md`를 같이 갱신하지 않는 한 pre-commit/pre-push 가드가 커밋과 푸시를 막는다.

---

## 현재 결정 요약

- 기본 전략은 `조건부 major`다.
- 기존 사용자 계약을 유지한 채 내부 구조만 정리되면 `0.4.x -> 0.5.x` 같은 minor로 간다.
- 별도 hosted origin, 별도 endpoint family, 별도 mutable namespace, 필수 migration이 실제로 필요할 때만 `1.0.0`을 채택한다.
- 배포는 Chrome Web Store가 아니라 `내부 ZIP + 수동 재설치/리로드` 기준으로 본다.
- mixed-version 기간이 길 수 있으므로, 버전 선택보다 `계약 유지`, `호환 범위`, `rollback 가능성`이 먼저다.

---

## Refactor Philosophy Update

- module 경계와 file 경계를 같은 의미로 취급하지 않는다.
- meeting 내부 분리는 `파일이 길다`는 이유만으로 진행하지 않고, `workflow`, `persisted contract`, `독립 lifecycle`, `재사용 가치`를 먼저 근거로 삼는다.
- 항상 같이 로드되고, 같이 수정되고, 같이 이해되는 helper는 같은 file이나 같은 domain module에 남길 수 있다.
- `meeting-common-domain.js`, `meeting-guard-domain.js` 같은 helper-only 분리는 현재 상태를 설명하는 기록이지, 이후 helper-only 추출을 계속 늘리라는 뜻은 아니다.
- 다음 추가 분리 전에는 `meeting-service.js`가 최종적으로 어떤 orchestration 책임만 남길지 먼저 적고 그 기준으로 판단한다.

---

## meeting-service Target End State

`functions/features/meeting/meeting-service.js`의 목표 end-state는 `legacy handler/export surface + cross-domain orchestration`이다.

- 이 파일에는 legacy Functions 이름, handler 등록, auth 확인, Firestore/Storage/OpenAI 호출 순서, transaction/batch orchestration처럼 여러 domain을 함께 조정하는 흐름이 남을 수 있다.
- 순수 normalize, schema shaping, prompt/transcript shaping, standalone guard처럼 경계가 분명한 규칙은 domain module로 옮기는 쪽을 우선한다.
- 반대로 helper가 `여러 domain 결과를 엮어 하나의 workflow를 끝내는 역할`이라면, line count가 길더라도 이 파일에 남길 수 있다.
- 추가 분리는 `job creation`, `chunk/finalize`, `section edit preview/apply`, `deletion/sweep`, `summary synchronization`처럼 workflow 단위가 독립적으로 설명될 때만 검토한다.
- env getter나 작은 helper는 별도 lifecycle이나 독립 변경 이유가 없다면 굳이 새 파일로 빼지 않는다.

---

## Existing Split Review Rule

이미 나눈 파일도 자동으로 유지 확정으로 보지 않는다. 새 철학에 맞지 않으면 다시 합치는 것도 정상적인 리팩토링으로 본다.

- `meeting-transcript-domain.js`, `meeting-creation-domain.js`, `meeting-deletion-domain.js`, `meeting-notes-context-domain.js`, `meeting-notes-document-domain.js`, `meeting-notes-runtime-domain.js`, `meeting-notes-source-domain.js`, `meeting-source-domain.js`, `meeting-mutation-domain.js`, `meeting-processing-domain.js`, `meeting-record-domain.js`, `meeting-state-domain.js`는 현재 기준으로 `workflow/data contract` 경계에 가까워 우선 유지 후보로 본다.
- `meeting-summary-sync-domain.js`는 meeting summary 문서 lifecycle을 다루는 `workflow/data contract boundary`로 유지 후보로 본다.
- `meeting-common-domain.js`는 `meeting-service.js`, `meeting-launch-service.js`, `meeting-workspace-auth-service.js`가 함께 쓰는 `shared normalization boundary`로 승격했다.
- `meeting-guard-domain.js`는 helper-only 경계가 약해서 `meeting-service.js`로 재통합했다.
- 이후 진행 로그에는 `새로 분리한 것`만이 아니라 `유지 확정`, `재통합`, `보류` 판단도 같이 남긴다.
- 다음 구조 판단의 기본 질문은 `새 파일을 더 만들까?`가 아니라 `기존에 나눈 경계가 정말 독립 책임인가?`다.

---

## Version Decision Gate

### Minor 유지 조건

아래 항목을 모두 만족하면 이번 리팩토링은 `0.5.x` 같은 minor로 끝낸다.

- hosted meeting origin/path를 그대로 유지할 수 있다.
- 현재 Functions export 이름을 그대로 유지할 수 있다.
- mutable Firestore namespace를 그대로 유지할 수 있다.
- auth scope, workspace URL, HTTP response envelope 의미를 그대로 유지할 수 있다.
- 사용자가 새 ZIP으로 교체해도 추가 migration 없이 동작한다.
- compat shim 없이도 `현재 minor + 이전 minor` 지원이 가능하다.

### Major 승격 조건

아래 항목 중 하나라도 실제로 필요하고, compat shim으로도 흡수할 수 없으면 `1.0.0`을 채택한다.

- 별도 hosted origin/site가 필요하다.
- 별도 Functions endpoint family가 필요하다.
- mutable data namespace 분리 또는 copy migration이 필요하다.
- 기존 auth scope, URL, schema 의미를 유지할 수 없다.
- `현재 minor + 이전 minor`를 같은 backend/hosting에서 안전하게 지원하기 어렵다.

### 최종 결정 규칙

- 기본값은 `minor 유지`다.
- `major 가능성`이 보인다는 이유만으로 버전을 먼저 올리지 않는다.
- 실제 구현과 smoke 검증 결과가 위 `Major 승격 조건`을 만족한다고 문서에 기록된 뒤에만 `1.0.0`으로 올린다.
- green 선언 권한은 저장소 유지보수자에게 있다. 구현자는 `candidate ready`까지만 기록하고, 유지보수자는 체크리스트와 검증 결과를 보고 최종 결정을 남긴다.

---

## Version Decision Record

- 현재 가설: `미정`
- candidate ready 상태: `not-started`
- 마지막 candidate 갱신 커밋: `없음`
- candidate 증거 요약: `없음`
- 유지보수자 최종 결정: `미정`

### 기록 규칙

- `현재 가설`은 `minor 가설`, `major 가설`, `미정` 중 하나만 사용한다.
- 구현자가 `minor candidate ready` 또는 `major candidate ready`를 주장하려면, 이 블록과 `세션 인계 로그`를 같은 커밋 안에서 함께 갱신한다.
- candidate 증거 요약에는 어떤 smoke를 돌렸고 어떤 조건을 통과했는지 3-5줄로 남긴다.
- 유지보수자는 이 블록의 `유지보수자 최종 결정` 항목에만 `minor 확정`, `major 확정`, `보류` 중 하나를 남긴다.
- ordinary meeting 구현 변경이나 git으로 복구 가능한 commit chronology는 이 문서 갱신 조건이 아니다.

---

## Current Implementation Reality

### 이미 코드에 들어간 것

- `major >= 1 -> v2`, 그 외는 `legacy`라는 lane 판단 hook
- lane-aware local storage key와 lazy local migration marker
- prompt-library v2 endpoint/collection foundation
- release build lane 분리 foundation
- meeting legacy Functions surface를 유지한 채, 전사 분절/회의록 transcript shaping helper를 `functions/features/meeting/meeting-transcript-domain.js`로 분리하는 내부 분해 1차
- meeting notes context/snapshot normalize helper를 `functions/features/meeting/meeting-notes-context-domain.js`로 분리하는 내부 분해 2차
- meeting notes document normalize/preview helper를 `functions/features/meeting/meeting-notes-document-domain.js`로 분리하는 내부 분해 3차
- meeting request/source upload/job-part/finalizer helper를 `functions/features/meeting/meeting-source-domain.js`로 분리하는 내부 분해 4차
- meeting list/mutation request, workspace mutation, command/deletion normalize helper를 `functions/features/meeting/meeting-mutation-domain.js`로 분리하는 내부 분해 5차
- meeting queued job/result artifact/meeting summary builder를 `functions/features/meeting/meeting-record-domain.js`로 분리하는 내부 분해 6차
- meeting transcription response와 job/artifact/summary normalize helper를 `functions/features/meeting/meeting-state-domain.js`로 분리하는 내부 분해 7차
- meeting notes bundle 생성과 completion content normalize helper를 `functions/features/meeting/meeting-notes-runtime-domain.js`로 분리하는 내부 분해 8차
- meeting text/block normalize, transcript segment, JSON parse, source filename 같은 순수 공용 helper를 `functions/features/meeting/meeting-common-domain.js`로 분리하는 내부 분해 9차
  - 철학 정렬 후 `meeting-launch-service.js`, `meeting-workspace-auth-service.js`까지 같은 normalize 규칙을 공유하면서 `shared normalization boundary`로 승격
- meeting ownership assert와 title sync guard helper를 `functions/features/meeting/meeting-guard-domain.js`로 분리하는 내부 분해 10차
  - 현재는 `helper-only provisional boundary`로 기록하며, 유지 확정은 아님
- 철학 정렬 후 split 10 재통합:
  - ownership assert와 title sync guard helper는 `meeting-service.js` service-local orchestration 근처로 다시 합침
  - helper-only file 경계보다 service-local workflow 응집도가 더 높다고 판단
- meeting summary read/write, active check, recentJobs synchronization helper를 `functions/features/meeting/meeting-summary-sync-domain.js`로 분리하는 내부 분해 11차
  - meeting summary 문서 lifecycle을 하나의 workflow boundary로 설명할 수 있다고 판단
- notes workflow 공통 transcript/artifact access와 baseline helper를 `functions/features/meeting/meeting-notes-source-domain.js`로 분리하는 내부 분해 12차
  - notes section preview/apply와 결과 update가 공통으로 의존하는 source lifecycle을 하나의 workflow boundary로 설명할 수 있다고 판단
- deletion queue claim/retry, result/meeting cleanup, tombstone completion check를 `functions/features/meeting/meeting-deletion-domain.js`로 분리하는 내부 분해 13차
  - deletion trigger와 sweep이 공유하는 cleanup lifecycle을 하나의 workflow boundary로 설명할 수 있다고 판단
- 1차 scope reset:
  - hosted `추가 맥락`/`회의록 업데이트` 경로를 제거하고, 회의록 보정을 `termReplacements + section preview/apply`로 재정의
  - summary model과 section edit model을 `gpt-5.4`로 맞추고, 기존 전사 파이프라인은 유지
- meeting internal split 17차:
  - `termReplacements` 요청 검증/재적용, section preview/apply, revision token, notes 기반 title sync와 편집 prompt builder를 `functions/features/meeting/meeting-notes-edit-domain.js`로 분리
  - `updateInovaMeeting`, `previewInovaMeetingResultSectionEdit`, `applyInovaMeetingResultSectionEdit` export 이름과 response envelope 의미 변화 없음
- meeting internal split 18차:
  - 결과 title/sharedMemo 수정, `notesInputSnapshot` baseline 초기화, record move transaction과 meeting summary `recentJobs` sync를 `functions/features/meeting/meeting-result-domain.js`로 분리
  - `updateInovaMeetingResult`, `moveInovaMeetingResult` export 이름과 response envelope 의미 변화 없음
- meeting internal split 19차:
  - signal gate, full/compact notes 생성, section/reducer prompt builder와 compact notes 후처리를 `functions/features/meeting/meeting-notes-generation-domain.js`로 분리
  - `processQueuedInovaMeetingJob`, `processQueuedInovaMeetingJobPart`, `finalizeChunkedInovaMeetingJob`가 의존하는 notes generation 의미와 output contract 변화 없음

### 아직 이것만으로 결정되지 않는 것

- 위 foundation은 `major가 필요할 때 사용할 준비된 메커니즘`이지, `1.0.0 출시 확정`이 아니다.
- 현재 버전이 여전히 `0.4.4`이므로, 위 foundation만으로는 기존 사용자 lane이 바뀌지 않는다.
- meeting은 아직 legacy 계약 위에 있고, 이번 리팩토링이 minor로 끝날지 major가 필요한지는 meeting 경계를 확인해야 결정된다.

### Minor 경로에서 foundation 코드 처리 규칙

- 최종 결정이 `minor 확정`이면, major 전용 dormant path를 그대로 장기 보존하지 않는다.
- 현재 기능에 실제로 쓰이는 일반 helper만 남기고, `major >= 1 => v2` 분기, v2 endpoint override, v2 release lane처럼 minor 릴리스에 필요 없는 코드는 `minor 확정 커밋` 또는 그 직후 `cleanup 커밋`에서 제거한다.
- 예외는 현재 runtime을 단순화하는 공용 helper뿐이다. `미사용 lane switch`를 미래 가능성만으로 남겨 두지 않는다.

### 현재 세션의 핵심 질문

- meeting 리팩토링이 `legacy 계약 유지`로 끝날 수 있는가
- 아니면 meeting만큼은 실제로 `별도 hosted/backend/data split`가 필요한가

이 질문이 풀리기 전까지는 버전 상승을 확정하지 않는다.

---

## 진행 현황 요약

- 설계 상태: `조건부 major 전략 채택`
- 구현 상태: `lane foundation 있음, meeting internal split 진행 중, 버전 결정 미완료`
- 현재 blocker: `meeting이 minor 경로로 가능한지 여부`
- release 가능 상태: `아직 아님`

---

## Meeting Legacy Baseline

이 섹션은 “meeting이 지금 무엇을 legacy 계약으로 쓰고 있는가”를 새 세션이 바로 파악하기 위한 기준선이다.

### Hosted origin/path

- hosted workspace: `https://browser-extension-main.web.app/meeting/index.html`
- hosted panel bridge: `https://browser-extension-main.web.app/meeting/panel-bridge.html`
- legacy path는 `0.4.4` 지원이 끝나기 전까지 rename/delete 하지 않는다.

### Local rehearsal boundary

- popup에서 `settings.meetingWorkspaceTarget=local`을 고르면 rehearsal target은 `http://127.0.0.1:5000/meeting/index.html`과 `http://127.0.0.1:5000/meeting/panel-bridge.html`이다.
- local target은 hosted workspace만 바꾸는 반쪽 경로가 아니라, meeting Functions/Auth/Firestore/Storage도 loopback emulator로 함께 맞춘다.
- 이 경로는 release lane을 늘리거나 legacy hosted origin/path 의미를 바꾸지 않는다. 목적은 `Meeting Ready Gate` 전의 full-local 회귀 확인이다.

### Auth scope와 URL 의미

- panel auth 기본 scope: `meeting-panel`
- workspace auth 기본 scope: `meeting-workspace`
- rules 공존 기준상 owner/share workspace scope는 `meeting-workspace-owner`, `meeting-workspace-share`도 함께 고려한다.
- workspace URL은 launch/session 기반 열기 흐름을 유지한다.

### Functions family

- launch/session auth 계열:
  - `issueInovaMeetingLaunch`
  - `exchangeInovaMeetingLaunch`
  - `issueInovaMeetingPanelAuth`
  - `issueInovaMeetingWorkspaceAuth`
  - `authorizeInovaMeetingWorkspaceAccess`
- meeting CRUD/share 계열:
  - `listInovaMeetings`
  - `updateInovaMeeting`
  - `updateInovaMeetingResult`
  - `moveInovaMeetingResult`
  - `previewInovaMeetingResultSectionEdit`
  - `applyInovaMeetingResultSectionEdit`
  - `deleteInovaMeeting`
  - `deleteInovaMeetingResult`
  - `createInovaMeetingShareLink`
  - `revokeInovaMeetingShareLink`
- processing 계열:
  - `createInovaMeetingJob`
  - `uploadInovaMeetingSource`
  - `processQueuedInovaMeetingJob`
  - `processQueuedInovaMeetingJobPart`
  - `finalizeChunkedInovaMeetingJob`
  - `processQueuedInovaMeetingCommand`
  - `processQueuedInovaMeetingDeletion`
  - `sweepQueuedInovaMeetingDeletions`

### Mutable data namespace

- `integration_inova_meetings`
- `integration_inova_meeting_jobs`
- `integration_inova_meeting_job_parts`
- `integration_inova_meeting_job_finalizers`
- `integration_inova_meeting_artifacts`
- `integration_inova_meeting_commands`
- `integration_inova_meeting_deletions`
- `integration_inova_meeting_launches`
- `integration_inova_meeting_workspace_sessions`

### 추가 기준 문서

- [docs/feature-routing.md](docs/feature-routing.md)
- [content/features/meeting/AGENTS.md](../content/features/meeting/AGENTS.md)

위 baseline이 바뀌면 이 문서와 meeting feature 문서를 같은 작업 안에서 함께 갱신한다.

---

## Meeting Ready Gate

### Minor 경로 green 조건

아래 항목이 모두 충족되면 meeting은 `minor 유지 가능` 판정을 받는다.

- hosted origin/path가 legacy 그대로다.
- Functions export 이름이 그대로다.
- mutable meeting namespace가 그대로다.
- auth scope, workspace URL, response envelope가 그대로다.
- meeting 관련 migration이 필요 없다.
- 기존 회의 데이터가 새 ZIP에서도 별도 복구 없이 열린다.
- `npm.cmd run emulator:meeting-local` + 팝업 `로컬 호스팅`으로 full-local rehearsal을 먼저 통과한다.
- 다음 smoke가 통과한다:
  - 기존 데이터가 있는 사용자로 회의 목록 조회
  - hosted workspace 진입
  - 최소 1개 기존 결과 조회
  - 새 녹음 또는 import 1회
  - 기록 수정 또는 삭제 1회
- 구현자가 위 smoke를 실행하고 결과를 `Version Decision Record`와 `세션 인계 로그`에 남긴다.
- 단, local rehearsal 통과만으로는 minor green을 선언하지 않는다. 최종 판정은 기존 상용 데이터가 있는 실제 Chrome smoke로 남긴다.

### Major 경로 green 조건

아래 항목이 모두 충족되면 meeting은 `major 필요` 판정을 받는다.

- 별도 hosted origin/site가 실제로 배포되어 있다.
- v2 meeting endpoint family가 legacy와 나란히 존재한다.
- v2 mutable namespace가 legacy와 공용 write 없이 분리되어 있다.
- lazy migration marker, retry, resume 규칙이 문서와 코드에서 일치한다.
- Firestore rules가 단일 rules 파일 안에서 legacy/v2를 additive branch로 공존시킨다.
- 다음 smoke가 모두 통과한다:
  - `0.4.4 + legacy hosting/functions`
  - `1.x candidate + v2 hosting/functions`
  - legacy 데이터가 migration 전후 원본 보존 상태를 유지
- rollback 절차가 문서에 있고 dry-run 수준으로라도 검토가 끝났다.
- 구현자가 위 smoke를 실행하고 결과를 `Version Decision Record`와 `세션 인계 로그`에 남긴다.

### 현재 판정 상태

- `미정`
- 다음 구현/탐색의 목적은 “meeting이 정말 major를 요구하는지”를 증명하거나 반증하는 것이다.
- 유지보수자는 구현자가 남긴 candidate 기록을 보고 최종 판정을 남긴다.

---

## Major 경로를 실제 채택할 때의 1.x 정책

이 섹션은 `1.0.0`이 실제로 필요하다고 판정된 경우에만 활성화된다.

- active lane은 `legacy`와 `v2` 두 개만 둔다.
- `1.1`, `1.2`, `1.3`은 새 lane 없이 같은 `v2 lane` 안에서 처리한다.
- `1.x`의 기본 호환 범위는 `현재 minor + 이전 minor`다.
- 공개 prompt store feed/detail은 `1.x 전체에서 shared read-only`로 유지한다.
- `major >= 1 => v2` code path는 이 정책을 위해 이미 준비된 hook으로 본다.

---

## Rollback Model

### Minor 경로 rollback

- 기본 rollback 단위는 `hosting/functions` 또는 `이전 ZIP 재배포`다.
- 데이터 구조를 바꾸지 않는 전제가 깨지지 않는 한, rollback을 위해 별도 migration reversal을 하지 않는다.
- mixed-version 기간에는 `latest.zip` 교체만으로 즉시 전환된다고 가정하지 않는다. 이미 내려받은 ZIP과 수동 reload 지연을 고려한다.

### Major 경로 rollback

- 기본 rollback 순서는 `server compatibility hotfix -> hosting rollback -> 이전 ZIP 재배포`다.
- legacy lane은 여전히 살아 있어야 하며, cutover 중단 시 legacy write surface를 유지한다.
- migration은 `copy only`여야 한다. rollback 시 v2로 복사된 데이터를 지우는 방식으로 되돌리지 않는다.
- rollback 보고에는 `functions 반영 여부`, `hosting 반영 여부`, `이전 ZIP 재배포 필요 여부`, `사용자 reload 필요 여부`를 함께 적는다.

---

## Firestore Rules Coexistence

- rules는 단일 `firestore.rules` 파일 안에서 legacy/v2를 additive branch로 공존시킨다.
- v2 추가 때문에 legacy rule 의미가 바뀌면 안 된다.
- legacy panel/workspace auth 경로는 기존 read 조건을 그대로 유지해야 한다.
- v2 rule이 필요하더라도 legacy match block을 rename/re-scope 하지 않는다.

---

## Legacy Sunset

이 단계는 `major 경로가 실제로 채택된 경우`에만 활성화된다.

### 아직 시작하지 않는 이유

- sunset 측정 기준이 아직 운영 지표로 고정되지 않았다.
- 내부 ZIP 배포라서 “몇 명이 최신 ZIP을 실제로 reload했는지”를 자동으로 알기 어렵다.

### sunset 전 최소 측정 항목

- legacy/v2 function invocation 수
- legacy/v2 hosted workspace boot 수
- 배포한 ZIP 버전과 실제 사용 중 버전의 확인 절차
- migration 오류율 또는 수동 대응 건수

위 측정 기준이 없으면 `legacy sunset`은 `미정`이 아니라 `시작 불가` 상태다.

### 세팅 시점 규칙

- `major candidate ready`를 기록하는 같은 작업 안에서 sunset 측정 방식과 수집 책임자를 최소 초안이라도 함께 적는다.
- 측정 방식이 비어 있으면 `major candidate ready`는 불완전 상태로 보고, 유지보수자는 최종 `major 확정`을 남기지 않는다.

---

## 3축 동시 작업 제한 이유

- `content + functions + hosting` 3축을 한 번에 바꾸면 내부 ZIP 배포 환경에서 mixed-version 조합이 급격히 늘어난다.
- 이 경우 검증 매트릭스와 rollback 범위가 동시에 커져서, 실제 문제 원인을 새 ZIP인지, hosting인지, functions인지 분리하기 어려워진다.
- 그래서 3축 변경은 가능한 한 세션/커밋 경계를 나누고, 정말 동시에 가야 할 때만 그 이유와 검증 계획을 먼저 적는다.

---

## 추천 다음 작업

### 1. meeting이 minor로 가능한지 먼저 확인

- hosted workspace 진입 경로를 유지한 채 내부 구조 분리만 가능한지 확인
- legacy endpoint family를 facade로 남긴 채 내부 모듈화가 가능한지 확인
- 현재 collection namespace를 유지한 채 read/write contract 정리가 가능한지 확인

### 2. minor 불가 근거가 생기면 그때 major로 승격

- 별도 origin/site가 필요한 이유
- endpoint family 분리가 필요한 이유
- namespace 분리 또는 migration이 필요한 이유
- compat shim으로도 흡수되지 않는 이유

위 근거가 문서화되기 전에는 버전부터 올리지 않는다.

---

## 테스트 기준

### 공통

- `npm.cmd run verify`
- 문서만 읽고 버전 결정 기준을 설명할 수 있어야 한다.
- 문서만 읽고 meeting이 현재 blocker인 이유를 설명할 수 있어야 한다.

### 문서 자립성 체크

- 이 문서만 읽고 `왜 아직 1.0.0이 확정이 아닌지`를 설명할 수 있어야 한다.
- 이 문서만 읽고 `무슨 조건이면 minor로 끝나는지`를 설명할 수 있어야 한다.
- 이 문서만 읽고 `무슨 조건이면 major로 승격하는지`를 설명할 수 있어야 한다.
- [docs/release-workflow.md](docs/release-workflow.md), [docs/feature-routing.md](docs/feature-routing.md), [content/features/meeting/AGENTS.md](../content/features/meeting/AGENTS.md) 와 판단 기준이 충돌하지 않아야 한다.

---

## 세션 인계 로그

### 2026-04-10

- `codex/add-lightweight-lint` 작업선이 한 번 `main`에 안 들어간 채 정리된 사실을 확인했고, 복구 PR로 현재 `main`에 다시 통합했다.
- full-local wiring과 meeting notes v1 reset이 반영된 현재 `main` 기준으로 작업을 재시작했다. `codex/move-meeting-record`는 참고용으로만 두고, 현재 기준선에서 회의 기록 이동 기능을 다시 붙였다.
- legacy baseline surface는 유지했다.
  - hosted origin/path 변화 없음
  - mutable namespace 변화 없음
  - meeting Functions family에 `moveInovaMeetingResult`를 추가
  - popup `로컬 호스팅`과 shared meeting functions config는 기존 full-local rehearsal 경계를 유지한 채 move endpoint만 확장
- hosted 작업실에는 완료된 remote record 전용 `기록 이동` action과 별도 `recordMoveOverlay`를 추가했다.
  - 이동 대상 목록은 현재 회의 룸을 제외한 다른 owned 회의 룸 제목만 노출
  - 성공 후 target 회의 룸으로 자동 이동하지 않고 현재 룸에 남아 selection fallback으로 정리
- meeting internal split 17차:
  - `termReplacements` 저장 후 결과 notes 재적용, section preview/apply, revision token, notes title sync workflow를 `functions/features/meeting/meeting-notes-edit-domain.js`로 이동했다.
  - `meeting-service.js`에는 legacy HTTP handler/export surface와 cross-domain wiring을 남기고, notes edit 세부 helper는 service 바깥 workflow 경계로 정리했다.
  - 기존 Functions 이름, response envelope, workspace mutation type 의미는 유지했다.
- meeting internal split 18차:
  - 결과 title/sharedMemo 수정과 `notesInputSnapshot` baseline 초기화, record move transaction과 `recentJobs` sync를 `functions/features/meeting/meeting-result-domain.js`로 이동했다.
  - `meeting-service.js`에는 `updateInovaMeetingResult`, `moveInovaMeetingResult` handler와 auth/response wiring만 남기고, 결과 수정/이동 세부 patch 계산과 transaction은 service 바깥 workflow 경계로 정리했다.
  - 기존 Functions 이름, response envelope, workspace mutation type 의미는 유지했다.
- meeting internal split 19차:
  - signal gate, full/compact notes 생성, section/reducer prompt builder와 compact notes 후처리를 `functions/features/meeting/meeting-notes-generation-domain.js`로 이동했다.
  - `meeting-service.js`에는 notes generation workflow 연결만 남기고, 자동 회의록 생성 정책과 프롬프트 조합은 service 바깥 workflow 경계로 정리했다.
  - 기존 notes bundle shape, gate 의미, compact/full 출력 프로필 의미는 유지했다.
- 검증:
  - `node scripts/verify-meeting-service.js`
  - `node scripts/verify-meeting-hosted-ui.js`
  - `npm.cmd run verify`
- 다음 시작점:
  - 남은 `meeting-service.js` helper 중 service-local orchestration으로 둘 것과 재통합/분리 후보를 다시 재평가
  - 이후 실제 release 판단이 필요하면 record move 포함 핵심 사용자 흐름을 기준으로 오너 확인을 받아 `functions + hosting + extension reload/배포` 범위를 함께 판단
### 2026-04-08

- 기준 구현 앵커: `ce38835`
- 완료:
  - lane-aware runtime config
  - lane-aware local storage migration
  - prompt-library v2 cloud lane foundation
  - lane-aware release build foundation
- 남은 핵심 질문:
  - meeting이 정말 separate lane을 요구하는가

### 2026-04-09

- 문서 정책 전환:
  - `1.0.0 확정` 대신 `조건부 major`
  - `Chrome Web Store` 대신 `내부 ZIP + 수동 리로드`
  - `meeting ready gate`, `rollback model`, `rules coexistence`, `legacy sunset blocker`를 문서 기준선에 추가
- meeting internal split 1차:
  - `functions/features/meeting/meeting-service.js`는 legacy handler/export surface를 그대로 유지
  - 전사 분절과 회의록 transcript shaping helper를 `functions/features/meeting/meeting-transcript-domain.js`로 분리
  - hosted origin, Functions export 이름, mutable namespace, auth scope 변화 없음
- meeting internal split 2차:
  - notes context/snapshot normalize helper를 `functions/features/meeting/meeting-notes-context-domain.js`로 분리
  - mutation request, notes input snapshot, context dedupe 로직은 기존 계약과 같은 의미를 유지
- meeting internal split 3차:
  - notes document normalize, status normalize, preview helper를 `functions/features/meeting/meeting-notes-document-domain.js`로 분리
  - 회의록 JSON 스키마, notes status 의미, persisted payload shape 변화 없음
- meeting internal split 4차:
  - request/source upload/job-part/finalizer helper를 `functions/features/meeting/meeting-source-domain.js`로 분리
  - meeting create/upload payload 의미, queued part/finalizer 상태 계약 변화 없음
- meeting internal split 5차:
  - list/mutation request, workspace mutation, command/deletion normalize helper를 `functions/features/meeting/meeting-mutation-domain.js`로 분리
  - workspace mutation, command, deletion task 문서 shape와 상태 의미 변화 없음
- meeting internal split 6차:
  - queued job, succeeded patch, transcript artifact, meeting summary, stable ID/path builder를 `functions/features/meeting/meeting-record-domain.js`로 분리
  - artifact payload, summary 문서 shape, stable storage/ID 규칙 변화 없음
- meeting internal split 7차:
  - transcription response, job/artifact/summary normalize, recentJobs 정렬 helper를 `functions/features/meeting/meeting-state-domain.js`로 분리
  - persisted state 의미, recentJobs 정렬 기준, preview fallback 규칙 변화 없음
- meeting internal split 8차:
  - notes bundle 생성과 completion content normalize helper를 `functions/features/meeting/meeting-notes-runtime-domain.js`로 분리
  - notes status, schema version, completion parsing 의미 변화 없음
- meeting internal split 9차:
  - text/block normalize, transcript segment, JSON parse, source filename 같은 순수 공용 helper를 `functions/features/meeting/meeting-common-domain.js`로 분리
  - handler/export surface, persisted 계약, source filename 규칙 변화 없음
  - 철학 정렬 후 `meeting-launch-service.js`, `meeting-workspace-auth-service.js`도 같은 normalize 규칙을 재사용하면서 `shared normalization boundary`로 승격
- meeting internal split 10차:
  - ownership assert와 title sync guard helper를 `functions/features/meeting/meeting-guard-domain.js`로 분리
  - auth scope, mutation 권한 의미, title sync 조건 변화 없음
  - 다만 helper-only 경계라서 현재는 `provisional`, 이후 재통합 가능
- meeting split 10 재평가:
  - `meeting-guard-domain.js`를 제거하고 ownership/title sync helper를 `meeting-service.js`로 재통합
  - helper-only file 경계보다 service-local workflow 응집도가 더 높다고 판단
- meeting internal split 11차:
  - meeting summary read/write, active check, recentJobs synchronization helper를 `functions/features/meeting/meeting-summary-sync-domain.js`로 분리
  - meeting summary 문서 shape, recentJobs 의미, active/deleted 판정 규칙 변화 없음
- meeting internal split 12차:
  - transcript/artifact access, shared memo snapshot, section edit source helper를 `functions/features/meeting/meeting-notes-source-domain.js`로 분리
  - notes preview/apply와 result update contract, artifact/job persisted shape 변화 없음
- meeting internal split 13차:
  - deletion queue claim/retry, cleanup completion check, tombstone hard delete helper를 `functions/features/meeting/meeting-deletion-domain.js`로 분리
  - deletion task, cleanup sweep, job/artifact/meeting cleanup 의미 변화 없음
- meeting notes v1 scope reset:
  - hosted `추가 맥락`/`회의록 업데이트` UI와 backend regenerate 경로를 제거
  - 회의별 `termReplacements` 저장과 `preview/apply section edit` 계약을 추가
  - 회의록 생성과 섹션 수정 모델을 `gpt-5.4`로 맞추고, shared memo는 최초 생성 입력에만 유지
- meeting internal split 15차:
  - queued job claim/retry, chunk part worker, finalizer assembly, queue progress synchronization을 `functions/features/meeting/meeting-processing-domain.js`로 분리
  - chunk/finalize processing trigger, job/job_part/finalizer 상태 계약, artifact 생성 의미 변화 없음
- meeting internal split 16차:
  - job create request validation, source ready/dedupe, upload sync를 `functions/features/meeting/meeting-creation-domain.js`로 분리
  - create/upload request 의미, queued job source 상태 계약, dedupe/upload sync 동작 의미 변화 없음
- Meeting Ready Gate 사전 점검:
  - `node scripts/verify-meeting-service.js`, `node scripts/verify-meeting-manager.js`, `node scripts/verify-content-smoke.js`를 현재 계약에 맞게 다시 녹색화
  - `updateInovaMeeting` 응답에 수정된 `meeting` payload를 복원해 hosted-only service harness 회귀를 제거
  - `npm.cmd run check:meeting-data -- --sample-size 1`로 상용 meeting 문서/결과 데이터가 아직 존재함을 확인
  - `npm.cmd run check:function-runtime -- --functions createInovaMeetingJob,listInovaMeetings,updateInovaMeeting,previewInovaMeetingResultSectionEdit,applyInovaMeetingResultSectionEdit,deleteInovaMeetingResult --since 60 --limit 10 --recent 2`로 주요 meeting HTTP 함수 config 조회 가능함을 확인
  - popup `로컬 호스팅`이 local hosted workspace + panel bridge + meeting Functions/Auth/Firestore/Storage emulator를 함께 보도록 wiring하고 `npm.cmd run emulator:meeting-local` 부팅을 확인
  - 다만 실제 minor candidate 증거로 쓰려면 여전히 Chrome 수동 smoke와 기존 상용 데이터 확인이 필요
- 철학 정렬 후속:
  - `docs/development-philosophy.md`와 `meeting-service Target End State` 기준을 먼저 확정
  - split 9-10은 `새 기본 패턴`이 아니라 `재평가 대상`으로 명시
- 다음 시작점:
  - 그 다음 실제 Chrome에서 `Meeting Ready Gate` minor smoke를 실행해 candidate 증거를 남길지 판단
  - smoke 결과를 바탕으로 split 재통합 후보나 실제 release blocker를 다시 판단
