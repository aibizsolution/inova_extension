# hosted meeting storage fault 수동 검증

이 문서는 hosted `meeting` 작업실의 `pending upload queue degraded` 흐름을 실제 Chrome에서 빠르게 재현할 때 쓰는 최소 체크리스트다.

## 준비

- 로컬만 빠르게 돌릴 때는 `npm run emulator:hosting` 후 `http://127.0.0.1:5000/meeting/index.html?debug=1&debugQueueSandbox=1`를 Chrome에서 연다.
- 팝업에서 `콘솔 로그 ON`을 켜고 hosted 회의 작업실을 연다.
- 작업실 URL에 `debug=1`이 포함돼 있고 DevTools 콘솔에 `[inova:...]` trace가 찍히는지 확인한다.
- 브라우저 DevTools 콘솔에서 아래 helper가 보이는지 확인한다.

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.scenarios()
```

현재 작업실 notice와 degraded 상태를 한 번에 보려면 아래 helper를 함께 쓴다.

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueState()
```

기대 결과를 pass/fail로 빠르게 요약하려면 아래 helper를 함께 쓴다.

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueValidation.check("queue-load-indexeddb-read")
```

sandbox에서 로컬 pending 항목을 빠르게 만들고 비우려면 아래 helper를 함께 쓴다.

```js
await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.clear();
await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.seedPending();
await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.runAction("hold");
```

## 최근 검증 기록

- 2026-04-03 Chrome localhost sandbox (`http://127.0.0.1:5000/meeting/index.html?debug=1&debugQueueSandbox=1`)에서 아래 시나리오를 재현 확인했다.
- 통과:
  - `queue-load-indexeddb-read`
  - `queue-persist-indexeddb-write`
  - `queue-cleanup-indexeddb-delete`
- 각 시나리오는 `__INOVA_HOSTED_MEETING_DEBUG__.queueValidation.check(...)`가 `passed: true`를 반환하는지까지 함께 확인했다.

## 자주 쓰는 시나리오

### 1. queue load degraded

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.arm("queue-load-indexeddb-read");
location.reload();
```

기대 결과:

- 작업실 shell은 blocked로 끝나지 않고 계속 열린다.
- warning notice에 로컬 업로드 대기 기록을 완전하게 읽지 못했다는 의미가 드러난다.
- DevTools 콘솔 trace에 `workspace.pending-uploads.load.degraded`가 남는다.
- `queueState()`의 `diagnostics.load.degradedReason`, `degradedNotices`, `recentQueueEvents`에 같은 흐름이 잡힌다.
- `queueValidation.check("queue-load-indexeddb-read")`의 `passed`가 `true`다.

### 2. queue persist degraded

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.arm("queue-persist-indexeddb-write");
await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.clear();
await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.seedPending();
```

그 다음 아래 중 하나를 1회 실행한다.

- `await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.runAction("rename", { title: "sandbox renamed" })`
- `await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.runAction("hold")`
- `await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.runAction("resume")`

기대 결과:

- 사용자 action은 일반 error notice를 한 번 본다.
- degraded warning과 DevTools 콘솔 trace에 `requestId/reason/phase` 문맥이 같이 남는다.
- 다음 새로고침 뒤 최신 로컬 queue 상태가 복원되지 않을 수 있다는 의미가 notice 문구에 드러난다.
- `queueState()`의 `diagnostics.persist.issueCodes`, `notice`, `recentQueueEvents`에서 같은 request 흐름을 다시 확인할 수 있다.
- `queueValidation.check("queue-persist-indexeddb-write")`의 `passed`가 `true`다.

### 3. queue cleanup degraded

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.arm("queue-cleanup-indexeddb-delete");
```

그 다음 아래 중 하나를 1회 실행한다.

- `await __INOVA_HOSTED_MEETING_DEBUG__.queueSandbox.runAction("delete")`
- 작업실 전체 삭제

기대 결과:

- 사용자 action은 일반 error notice를 한 번 본다.
- degraded warning과 DevTools 콘솔 trace에 cleanup 문맥이 남는다.
- 다음 새로고침 뒤 지운 로컬 기록이 다시 보일 수 있다는 의미가 notice 문구에 드러난다.
- `queueState()`의 `diagnostics.cleanup.issueCodes`, `pendingUploads`, `recentQueueEvents`로 stale 항목 잔존 여부를 함께 본다.
- `queueValidation.check("queue-cleanup-indexeddb-delete")`의 `passed`가 `true`다.

## 정리

개별 시나리오 해제:

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.clear("queue-persist-indexeddb-write");
```

전체 queue fault 해제:

```js
__INOVA_HOSTED_MEETING_DEBUG__.queueFaults.clear();
__INOVA_HOSTED_MEETING_DEBUG__.clearFault();
```

## 메모

- `queueFaults.arm(...)`은 기본적으로 다음 1회만 실패를 주입한다.
- `debugQueueSandbox=1` localhost 모드에서는 panel/session 없이도 queue load/persist/cleanup 검증을 반복할 수 있고, 원격 refresh/retry는 일부러 건너뛴다.
- sandbox에서 브라우저 queue를 바로 만들려면 `queueSandbox.seedPending()`, 초기화하려면 `queueSandbox.clear()`, 상태 변경은 `queueSandbox.runAction(...)`을 쓴다.
- 낮은 레벨 fault key가 필요하면 `__INOVA_HOSTED_MEETING__.storage.DEBUG_FAULTS`와 `__INOVA_HOSTED_MEETING_DEBUG__.setFault(name, count)`를 직접 사용할 수 있다.
- 이 문서의 목표는 `M3 hosted fallback / storage / queue degraded hardening`의 실제 Chrome 수동 검증 속도를 올리는 것이다.
