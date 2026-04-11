# Version And Release Decision Note

이 문서는 리팩토링 작업 이력 로그가 아니라, `버전 결정`과 `meeting legacy 호환 기준`만 빠르게 확인하기 위한 기준 문서다.  
ordinary feature 구현 변경은 이 문서의 대상이 아니고, version lane·meeting legacy baseline·release decision처럼 장기 판단 비용이 큰 변경만 여기서 관리한다.

리팩토링 기준일: 2026-04-09  
마지막 상태 갱신: 2026-04-11  
현재 공개 사용자 기준선: `0.4.4`

## 현재 결정 요약

- 기본 전략은 `조건부 major`다.
- 기본 가설은 `minor 유지`다.
- panel shell 1차 리팩토링과 meeting 내부 분해는 사실상 마감으로 보고, 현재 우선순위는 추가 구조 분해보다 운영/배포 판단이다.
- green 선언 권한은 유지보수자에게 있고, 구현자는 판단 근거와 candidate 상태까지만 갱신한다.

## Version Decision Gate

### Minor 유지 조건

아래 항목을 모두 유지할 수 있으면 `0.5.x` 같은 minor로 간다.

- hosted meeting origin/path를 그대로 유지할 수 있다.
- 현재 Functions export 이름을 그대로 유지할 수 있다.
- mutable Firestore namespace를 그대로 유지할 수 있다.
- auth scope, workspace URL, response envelope 의미를 그대로 유지할 수 있다.
- 사용자가 새 ZIP으로 교체해도 추가 migration 없이 동작한다.
- compat shim 없이도 `현재 minor + 이전 minor` 지원이 가능하다.

### Major 승격 조건

아래 항목 중 하나라도 실제로 필요하고 compat shim으로 흡수할 수 없으면 `1.0.0`을 검토한다.

- 별도 hosted origin/site가 필요하다.
- 별도 Functions endpoint family가 필요하다.
- mutable data namespace 분리 또는 copy migration이 필요하다.
- 기존 auth scope, URL, schema 의미를 유지할 수 없다.
- `현재 minor + 이전 minor`를 같은 backend/hosting에서 안전하게 지원하기 어렵다.

### 최종 결정 규칙

- 기본값은 `minor 유지`다.
- `major 가능성`만으로 먼저 버전을 올리지 않는다.
- 실제 구현과 smoke 결과가 `Major 승격 조건`에 해당한다고 기록된 뒤에만 `major`를 선택한다.
- 유지보수자는 `minor 확정`, `major 확정`, `보류` 중 하나만 남긴다.

## Version Decision Record

- 현재 가설: `minor 가설`
- candidate ready 상태: `in-progress`
- 유지보수자 최종 결정: `미정`
- 현재 근거 요약:
  - legacy hosted origin/path, Functions export 이름, mutable namespace, auth scope baseline은 유지 중이다.
  - 공개 사용자 기준선은 여전히 `0.4.4`지만, local rehearsal 브랜치는 미배포 capability smoke를 위해 manifest/package 버전을 `0.4.5`로 먼저 올려 6축 prompt-review 같은 opt-in 경로를 검증할 수 있다.
  - prompt-review 6축 전환은 backend dual-contract와 client opt-in으로 준비하되, 현재 공개 사용자 기준선 `0.4.4`는 `legacy-v1` 4축 평가를 유지한다.
  - popup `로컬 호스팅` rehearsal target은 meeting만이 아니라 prompt-library sync/read, prompt-review, prompt-store panel auth/write, hidden prompt bridge까지 local Functions/Hosting emulator로 함께 전환해야 한다.
  - local rehearsal 부팅 확인과 기존 사용자의 기존 회의 데이터 read-path 확인은 pass 후보다.
  - `check:meeting-data`, `verify-meeting-service`, `verify-content-smoke`, `check:function-runtime` preflight는 녹색이다.
  - 다만 최종 candidate ready로 올리려면 실제 Chrome 기준의 주요 회의 smoke 기록이 남아 있어야 한다.

## Meeting Legacy Baseline

### Hosted origin/path

- hosted workspace: `https://browser-extension-main.web.app/meeting/index.html`
- hosted panel bridge: `https://browser-extension-main.web.app/meeting/panel-bridge.html`
- legacy path는 `0.4.4` 지원이 끝나기 전까지 rename/delete 하지 않는다.

### Local rehearsal boundary

- popup에서 `settings.meetingWorkspaceTarget=local`을 고르면 rehearsal target은 `http://127.0.0.1:5000/meeting/index.html`과 `http://127.0.0.1:5000/meeting/panel-bridge.html`이다.
- local target은 hosted page만이 아니라 meeting Functions/Auth/Firestore/Storage emulator까지 함께 보는 full-local 경로다.
- 같은 local target은 prompt도 full-local rehearsal로 같이 본다. prompt read/write/review/panel auth는 `http://127.0.0.1:5001/browser-extension-main/asia-northeast3/*`를 향하고, hidden prompt bridge는 `http://127.0.0.1:5000/extension/prompt-panel-bridge.html`에서 local Auth/Firestore emulator를 사용한다.

### Auth scope와 URL 의미

- panel auth 기본 scope: `meeting-panel`
- workspace auth 기본 scope: `meeting-workspace`
- rules 공존 기준상 owner/share workspace scope는 `meeting-workspace-owner`, `meeting-workspace-share`도 함께 고려한다.
- workspace URL은 launch/session 기반 열기 흐름을 유지한다.

### Functions family

#### launch/session auth

- `issueInovaMeetingLaunch`
- `exchangeInovaMeetingLaunch`
- `issueInovaMeetingPanelAuth`
- `issueInovaMeetingWorkspaceAuth`
- `authorizeInovaMeetingWorkspaceAccess`

#### meeting CRUD/share

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

#### processing

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

## 문서 갱신 규칙

- 아래 범위가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
  - version lane 정책
  - meeting legacy baseline
  - release decision 기준
- ordinary feature 구현이나 git으로 복구 가능한 작업 이력은 이 문서에 누적하지 않는다.
- 세션 인계 로그, split chronology, milestone diary는 이 문서 범위 밖이다.
