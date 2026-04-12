# Version And Release Decision Note

이 문서는 리팩토링 작업 이력 로그가 아니라, `버전 결정`과 `meeting legacy 호환 기준`만 빠르게 확인하기 위한 기준 문서다.  
ordinary feature 구현 변경은 이 문서의 대상이 아니고, version lane·meeting legacy baseline·release decision처럼 장기 판단 비용이 큰 변경만 여기서 관리한다.

리팩토링 기준일: 2026-04-09  
마지막 상태 갱신: 2026-04-12  
현재 공개 사용자 기준선: `0.4.4`

## 현재 결정 요약

- 기본 전략은 `major`다.
- 다음 공개 릴리스 목표는 `1.0.0`이다.
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

- 결정 전 기본값은 `minor 유지`였다.
- `major 가능성`만으로 먼저 버전을 올리지 않는다.
- 실제 구현과 smoke 결과가 `Major 승격 조건`에 해당한다고 기록된 뒤에만 `major`를 선택한다.
- 현재는 유지보수자 판단으로 `major 확정 (1.0.0)` 상태다.

## Version Decision Record

- 현재 가설: `major 가설`
- candidate ready 상태: `in-progress`
- 유지보수자 최종 결정: `major 확정 (다음 공개 릴리스 1.0.0)`
- 현재 근거 요약:
  - legacy hosted origin/path, Functions export 이름, mutable namespace, auth scope baseline은 유지 중이다.
  - 공개 사용자 기준선은 여전히 `0.4.4`지만, 다음 공개 릴리스는 `1.0.0`으로 잡고 local rehearsal도 manifest/package `1.0.0` 기준 v2 lane을 기본 활성화한다.
  - `1.0.0` candidate baseline부터 우측 `실험실` 패널 기본 UI는 hosted `panelAppUrl` iframe을 쓰고, 기본 hosted 경로는 `hosting/extension-v2/panel/index.html`이다. 이 변경은 extension 브리지/host와 hosted panel 자산의 mixed-version capability gate를 전제로 한다.
  - prompt-review 6축 전환은 backend dual-contract와 client opt-in으로 준비하되, 현재 공개 사용자 기준선 `0.4.4`는 `legacy-v1` 4축 평가를 유지한다.
  - prompt-library는 인터넷 연결 전제 제품 판단에 맞춰 `DB 정본(remote-first)`으로 전환 중이다. `chrome.storage.local.promptLibrary`는 authoritative source가 아니라 마지막 remote snapshot 캐시와 UI 복구용으로만 남기고, 저장/삭제/순서 변경/가져오기는 server-ack 후 remote reload가 끝난 뒤에만 반영한다.
  - popup `로컬 호스팅` rehearsal target은 meeting만이 아니라 prompt-library sync/read, prompt-review, prompt-store panel auth/write, hidden prompt bridge까지 local Functions/Hosting emulator로 함께 전환해야 한다.
  - local rehearsal 부팅 확인과 기존 사용자의 기존 회의 데이터 read-path 확인은 pass 후보다.
  - `check:meeting-data`, `verify-meeting-service`, `verify-content-smoke`, `check:function-runtime` preflight는 녹색이다.
  - 다만 최종 candidate ready로 올리려면 실제 Chrome 기준의 주요 회의 smoke 기록이 남아 있어야 한다.

## Meeting Legacy Baseline

## Version Lane Policy

- `0.x` legacy lane의 hosted panel 기본 경로는 `https://browser-extension-main.web.app/extension/panel/index.html`이다.
- `1.x+` v2 lane은 같은 규칙으로 `hosting/extension-v2/panel/*`와 `panelAppUrl`을 사용한다.
- 공개 기준선 `0.4.4`는 legacy lane에 남기고, 다음 공개 릴리스 `1.0.0`은 v2 lane을 기본으로 사용한다.
- extension composition root도 lane-aware로 분리한다. `0.x`는 기존 `content/panel-composition-controller.js`, `1.x+`는 `content/panel-v2-composition-controller.js`를 사용한다.
- `1.x+`에서 `release:build`는 `hosting/extension-v2/releases/*`와 `hosting/extension-v2/downloads/*`를 실제 served artifact 기준으로 채워야 한다. hosted v2 release panel은 이 lane-local 경로를 직접 읽으므로, curated history에 남긴 이전 공개 버전 ZIP도 현재 lane download 디렉터리에서 404 없이 열리도록 함께 복사한다.
- 이후 `1.x+` v2 lane hosted panel은 책임을 합치지 않고 feature별 controller를 따로 둔 채 ownership을 점진 이동한다. 현재 hosted ownership 후보군은 `conversation`, `prompt-library`, `prompt-review`, `prompt-store`, `meeting hub`, `release`, `debug`이고, extension은 page DOM adapter + iframe host + runtime broker를 유지한다.
- v2 lane이라고 해서 모든 backend endpoint family를 바로 분리하지 않는다. 현재 backend 분리가 준비된 것은 prompt-library 계열뿐이고, meeting Functions endpoint는 `1.0.0` v2 lane에서도 legacy 이름(`listInovaMeetings`, `issueInovaMeetingPanelAuth` 등)을 계속 사용한다.
- local rehearsal에서 hosted panel 기본 경로는 `http://127.0.0.1:5000/extension/panel/index.html`이다.
- local rehearsal에서 `1.x+` v2 lane hosted panel 기본 경로는 `http://127.0.0.1:5000/extension-v2/panel/index.html`이다.
- local rehearsal에서 page DOM에 삽입되는 hosted panel/meeting bridge/prompt bridge iframe src는 direct loopback URL이 아니라 extension `content/frame-proxy.html?target=...` wrapper를 사용한다. 실제 target URL baseline은 계속 `127.0.0.1:5000/*`로 유지하고, manifest는 이 proxy page와 extension frame-src allowlist를 함께 유지한다.
- hosted panel 자산이 더 최신이어도 extension bridge capability가 부족하면 조용히 깨지지 않고 explicit update-needed 상태를 보여줘야 한다.

### Hosted origin/path

- hosted workspace: `https://browser-extension-main.web.app/meeting/index.html`
- hosted panel bridge: `https://browser-extension-main.web.app/meeting/panel-bridge.html`
- legacy path는 `0.4.4` 지원이 끝나기 전까지 rename/delete 하지 않는다.

### Local rehearsal boundary

- popup에서 `settings.meetingWorkspaceTarget=local`을 고르면 rehearsal target은 `http://127.0.0.1:5000/meeting/index.html`과 `http://127.0.0.1:5000/meeting/panel-bridge.html`이다.
- local target은 hosted page만이 아니라 meeting Functions/Auth/Firestore/Storage emulator까지 함께 보는 full-local 경로다.
- 같은 local target은 prompt와 hosted panel도 full-local rehearsal로 같이 본다. prompt read/write/review/panel auth는 `http://127.0.0.1:5001/browser-extension-main/asia-northeast3/*`를 향하고, hidden prompt bridge target은 `http://127.0.0.1:5000/extension/prompt-panel-bridge.html`, hosted panel target은 legacy lane `http://127.0.0.1:5000/extension/panel/index.html`, v2 lane `http://127.0.0.1:5000/extension-v2/panel/index.html`이다. 다만 페이지에 꽂히는 실제 iframe src는 둘 다 extension frame proxy를 거쳐 local Auth/Firestore emulator와 hosted 자산을 연다.
- `1.0.0` v2 baseline에서도 panel render payload는 `settings.meetingWorkspaceTarget`을 iframe host까지 반드시 전달해야 한다. 이 local/prod handoff는 `npm.cmd run verify` 안의 `verify-panel-render`로 계속 고정한다.

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
