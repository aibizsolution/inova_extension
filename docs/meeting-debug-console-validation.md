# meeting debug console 검증 메모

이 문서는 `meeting` 디버그 로그를 실제 Chrome에서 빠르게 확인하고, hosted mismatch/stale pending/performance 이슈의 최소 증거를 같은 방식으로 수집할 때 쓰는 기준 문서다.

## 언제 이 문서를 쓰는지

- hosted 상태 mismatch, stale pending, orphan record, 잘못된 진행 상태를 조사할 때
- hosted boot/record 로딩이 느릴 때 단계별 timing 근거를 모을 때
- top 콘솔 로그 기준으로 반복 루프와 성능 이슈를 빠르게 확인할 때

## hosted workspace

- localhost 작업실은 `http://127.0.0.1:5000/meeting/index.html?debug=1&debugQueueSandbox=1`로 연다.
- 상용 hosted 조사도 `?debug=1`을 기준으로 한다.
- hosted helper:

```js
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleState()
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleValidation.checkWorkspace()
__INOVA_HOSTED_MEETING_DEBUG__.errors()
__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })
```

- 최소 증거 세트:
  - 화면 스크린샷
  - 디버그 패널 일반 로그 복사
  - `copy-errors` 또는 `errors()` 기준 오류 로그 복사
  - `printPendingSyncEvidence(...)` 출력
- expanded 기대 결과:
  - toolbar가 보인다.
  - `copy`, `copy-errors`, `clear`, `toggle` 4개 action이 모두 렌더된다.
  - `segment-cluster` 구조가 유지된다.
  - status/log text가 비어 있지 않다.
  - 오류 버퍼는 일반 로그와 분리되어 유지된다.
  - 상단 통계는 최근 표시 버퍼가 아니라 누적 기준으로 유지된다.
  - 상단 라벨은 `함수`, `읽기`, `리스너`, `오류` 4개만 쓴다.
- collapsed 기대 결과:
  - fab toggle만 보인다.
  - 오류가 있으면 fab badge가 보인다.

## panel top console

- `https://inova.incross.com/*` 페이지에서 확장프로그램을 켠다.
- 팝업에서 `meeting debug console`을 켠다.
- `top` 콘솔에서 `inova:` 필터를 걸고 새로고침 직후부터 본다.
- 화면 overlay 패널은 더 이상 렌더하지 않는다. 반복 원인은 콘솔 요약 로그로 본다.
- panel helper는 content script 콘솔 문맥에서 아래처럼 읽는다.

```js
InovaBookmarks.panelDebugValidation.state()
InovaBookmarks.panelDebugValidation.check()
```

- 기대 결과:
  - transport 레벨 반복 로그는 숨겨지고, 핵심 단계만 순서대로 보인다.
  - 같은 이벤트가 반복되면 `same event repeated N more times` 한 줄로 합쳐진다.
  - 대화 탐색은 `get-conversation-snapshot` 기준 최대 10초 간격으로만 다시 읽는다.
  - 클릭/오류/timeout 같은 사용자 액션 경로는 여전히 개별 로그로 남는다.

## pending sync 증거

```js
window.__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })
```

- 위 helper는 `pending.requestId`, `pending.jobId`, `createdAt`, `durationMs`, `meetingTitleSnapshot`, 최근 queue 이벤트와 debug entry를 함께 덤프해야 한다.
- stale pending 수정은 이 출력으로 식별자가 확인된 뒤에만 진행한다.
- helper가 없으면 기능 버그로 단정하지 말고, 먼저 `hosting` 배포 여부, 페이지 강한 새로고침, 필요 시 확장 Reload 여부를 확인한다.

## boot timing 해석

- 느린 boot/record 로딩은 `firestore.auth.step`, `firestore.auth.success`, `workspace.realtime.connect.success`, `workspace.sync.state`, `workspace.detail.job-sync`의 단계별 timing부터 본다.
- auth, 첫 snapshot 대기, 상세 artifact read를 한 덩어리로 보지 말고 어느 단계가 병목인지부터 분리한다.
- hosted boot는 회의 룸과 기록 목록을 먼저 그리고, 선택된 기록 상세 artifact는 비차단으로 뒤늦게 채운다.
- deferred 상세 로딩 로그는 `selection`으로 뭉개지지 않게 `boot`/`boot-deferred` reason을 유지해야 한다.

## 메모

- hosted helper는 localhost/hosted script에서 바로 접근 가능하다.
- panel helper는 content script 문맥용이므로 top 콘솔 로그와 함께 쓰는 편이 가장 빠르다.
- 이 문서의 목표는 `meeting` 디버그 로그 검증과 증거 수집 절차를 AGENTS 밖의 durable procedure로 유지하는 것이다.
