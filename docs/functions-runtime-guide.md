# Functions Runtime Guide

이 문서는 Firebase Functions runtime 설정을 앞으로 어떻게 유지·점검·조정할지 정하는 운영 가이드다. 목표는 `모든 함수를 매번 손으로 튜닝`하는 것이 아니라, `기본 프로파일을 표준으로 두고 예외 함수만 로그 근거로 조정`하는 것이다.

## 1. 운영 원칙

- 새 HTTP 함수는 특별한 근거가 없으면 기본 HTTP 프로파일을 그대로 쓴다.
- 새 scheduler 함수는 특별한 근거가 없으면 기본 scheduler 프로파일을 그대로 쓴다.
- raw binary 업로드, OpenAI 전사/정리, 대량 cleanup처럼 실제로 무거운 함수만 예외 프로파일로 분리한다.
- runtime 값은 감으로 자주 바꾸지 않는다. 기능 구조가 바뀌었거나, 최근 로그에 OOM/429/timeout이 보일 때만 조정한다.
- 배포된 Cloud Run 설정이 코드와 어긋나지 않도록, 배포 후에는 `check:function-runtime`으로 실제 반영값을 확인한다.
- 반복되는 운영 오류는 `한 번 수동 정리하고 끝`으로 관리하지 않는다. 같은 유형이 다시 나올 수 있으면 재발 방지와 기존 오류 복구 경로를 함께 만든다.

## 1-1. 반복 오류 대응 원칙

- 로그에서 반복 오류를 확인하면 먼저 `현재 원인`을 고친다.
- 그 오류로 이미 남아 있는 stale 상태, 잘못된 queue 상태, orphan 문서가 사용자 화면에 계속 보일 수 있으면 `자동 복구 패치` 또는 `안전한 정리 로직`을 같이 개발한다.
- 자동 복구가 위험하거나 비용이 크면, 최소한 `일회성 admin 정리 스크립트`와 실행 기준을 함께 남긴다.
- 운영자가 같은 유형의 수동 정리를 계속 반복해야 한다면, 그건 운영 절차가 아니라 제품 결함으로 본다.
- 새 runtime 조정이나 queue 구조 변경은 `새 요청을 더 잘 처리하는가`만 보지 말고, `기존 실패 흔적을 어떻게 흡수할지`까지 같이 본다.

## 1-2. 패치 책임 분리

- 반복될 수 있는 복구 로직은 기존 main flow 파일 안에 ad-hoc `if legacy...` 분기만 누적하지 않는다.
- `항상 실행되는 self-healing 패치`는 feature-local recovery 모듈이나 patch 모듈로 분리해 책임을 모은다.
- `한 번만 돌리는 backfill/cleanup 패치`는 앱 코드와 섞지 말고 `scripts/` 아래 별도 실행 스크립트로 둔다.
- 기준은 `패치 1건당 파일 1개`가 아니라 `성격별 분리`다. 실시간 복구, 일회성 마이그레이션, 운영용 정리 스크립트는 층위를 나눈다.
- 같은 파일에 복구 조건이 2~3개 이상 쌓이기 시작하면 patch/recovery 전용 JS 파일로 추출하는 쪽을 기본으로 본다.

## 2. 기본 프로파일

### 기본 HTTP

- 용도: auth 발급, 목록 조회, 메타 조회, 얇은 queue 접수, 일반 CRUD
- 기준값: `256MiB`, `60s`, `concurrency 80`, `maxInstances 20`

### 기본 Scheduler

- 용도: 가벼운 sweep, 재시도 점검, 주기 메타 정리
- 기준값: `256MiB`, `60s`, `concurrency 1`, `maxInstances 1`

## 3. 예외 프로파일

### Upload

- 대상: request body로 raw audio buffer를 직접 받아 storage upload까지 처리하는 함수
- 기준값: `512MiB`, `60s`, `concurrency 1`
- 메모: upload는 전사 자체보다 순간 메모리 사용량이 중요하므로 기본 HTTP보다 한 단계 높게 둔다.

### Queue Worker

- 대상: Firestore trigger 기반 job orchestration, notes command 처리
- 기준값: `512MiB~1GiB`, `120s`, `concurrency 1`
- 메모: 단일 실행이 길어질 수 있어도 무조건 timeout만 늘리지 말고, 실제 작업을 더 작은 worker로 쪼갤 수 있는지 먼저 본다.

### Chunk Worker

- 대상: part 단위 오디오 전사와 chunk transcript 저장
- 기준값: `1GiB`, `180s`, `concurrency 1`, 높은 `maxInstances`
- 메모: 사용자 수가 늘 때 가장 먼저 병목이 생길 가능성이 큰 축이다. 기본값은 part 수만큼 fan-out하고, 필요할 때만 `OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY`로 긴급 throttle을 건다.

### Finalize

- 대상: chunk 전사 병합과 notes finalize
- 기준값: `1GiB`, `180s`, `concurrency 1`
- 메모: 단일 실행 tail이 길 수 있어 메모리와 timeout을 기본값보다 크게 둔다.

### Deletion Worker

- 대상: Firestore tombstone, artifacts, launches, workspace session, storage object cleanup
- 기준값: `512MiB`, `120s`, `concurrency 1`
- 메모: 전사 함수가 아니므로 로그가 안정적이면 과도한 메모리/timeout을 유지하지 않는다.

## 4. 현재 운영 기준

이 문서 업데이트 시점 기준 현재 프로파일은 다음과 같다.

### 기본 HTTP 프로파일 유지

- meeting의 일반 HTTP 함수는 특별한 로그 근거가 없으면 `maxInstances 20`을 유지한다.
- `createInovaMeetingJob`
- `regenerateInovaMeetingNotes`
- `reviewInovaPrompt`
- `issueInovaPromptPanelAuth`
- `loadInovaPromptLibrary`
- `peekInovaPromptLibrary`
- `syncInovaPromptLibrary`
- `listPromptStoreEntries`
- `publishPromptToStore`
- `unpublishPromptFromStore`
- `importPromptStoreEntry`
- `togglePromptStoreLike`
- `recordPromptStoreView`
- `issueInovaMeetingLaunch`
- `exchangeInovaMeetingLaunch`
- `issueInovaMeetingWorkspaceAuth`
- `issueInovaMeetingPanelAuth`
- `authorizeInovaMeetingWorkspaceAccess`
- `createInovaMeetingShareLink`
- `revokeInovaMeetingShareLink`
- `listInovaMeetings`
- `updateInovaMeeting`
- `updateInovaMeetingResult`
- `deleteInovaMeeting`
- `deleteInovaMeetingResult`

### 예외 프로파일 적용

- `uploadInovaMeetingSource`: `512MiB`, `60s`, `concurrency 1`, `maxInstances 150`
- `processQueuedInovaMeetingJob`: `1GiB`, `120s`, `concurrency 1`, `maxInstances 80`
- `processQueuedInovaMeetingJobPart`: `1GiB`, `180s`, `concurrency 1`, `maxInstances 200`
- `finalizeChunkedInovaMeetingJob`: `1GiB`, `180s`, `concurrency 1`, `maxInstances 80`
- `processQueuedInovaMeetingCommand`: `512MiB`, `120s`, `concurrency 1`, `maxInstances 20`
- `processQueuedInovaMeetingDeletion`: `512MiB`, `120s`, `concurrency 1`, `maxInstances 5`
- `sweepQueuedInovaMeetingDeletions`: `256MiB`, `60s`, `concurrency 1`, `maxInstances 1`

## 5. 로그 해석 기준

### OOM

- 신호: `memory limit exceeded`, `container instance was found to be using too much memory`
- 우선 조치: memory 상향 검토
- 예외: upload처럼 payload 자체가 커서 생긴 문제인지, 불필요한 buffer 복사가 있는지 먼저 본다

### 429 / no available instance

- 신호: `The request was aborted because there was no available instance`
- 우선 조치: `maxInstances`를 먼저 보고, 필요할 때만 `OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY`로 임시 throttle을 건다
- 단순 429만 보고 memory를 올리지는 않는다

### Timeout

- 신호: request `504`, worker deadline 초과
- 우선 조치: timeout 상향 전에 함수 성격이 맞는지 확인한다
- 얇은 HTTP 접수 함수라면 queueing으로 넘기고 HTTP timeout은 짧게 유지한다
- worker라면 실제 tail을 보고 timeout을 늘릴지, work를 더 작은 단계로 나눌지 결정한다

### Autoscaling 로그

- `Starting new instance. Reason: AUTOSCALING`만으로는 문제라고 보지 않는다
- cold start, 새 트래픽, 배포 직후 startup 로그는 자연스러운 범위다
- request error, 429, timeout, OOM과 함께 보일 때만 조정 근거로 쓴다

## 6. 점검 루프

### 배포 직후

- `npm run check:function-runtime -- --since 60 --limit 60 --recent 3`
- 변경한 함수만 골라 실제 Cloud Run 설정이 코드와 맞는지 확인한다

### 운영 점검

- `npm run check:function-logs -- --since 10 --errors-only`
- `npm run check:function-runtime -- --functions <comma-separated>`

### 언제 다시 조정할지

- 전사/notes/upload 구조가 바뀌었을 때
- OpenAI 모델이나 chunk 전략이 바뀌었을 때
- 사용자 수나 동시 처리량 목표가 올라갔을 때
- OOM/429/timeout이 실제로 보였을 때
- 그 외에는 주 1회 짧게 확인하는 정도로 충분하다

## 7. 동시 사용자 가정

- 등록 사용자 수보다 중요한 건 `동시 전사/업로드/정리 요청`이다
- `500명 이하 사용자`라도 모든 함수가 `동시 100명`을 그대로 감당할 필요는 없다
- 기본 HTTP 함수는 기본 프로파일로도 충분한 경우가 많다
- 실제 확장 리스크는 `upload`, `chunk worker`, `finalize`처럼 heavy path에 집중된다
- 동시 사용자 가정이 커질수록 먼저 볼 축은 `processQueuedInovaMeetingJobPart`의 `maxInstances`와 fresh OOM 여부다
- 현재 `processQueuedInovaMeetingJobPart`는 `1 CPU` 기준 regional CPU quota 때문에 `maxInstances 200`까지 반영 가능하다. 그 이상은 quota 상향이나 CPU 재설계가 필요하다.

## 8. 변경 절차

1. 최근 로그에서 실제 문제를 확인한다.
2. 기본 프로파일로 돌아갈 수 있는 함수인지 먼저 판단한다.
3. 예외 함수라면 memory, timeout, `maxInstances`, `concurrency` 중 무엇이 진짜 원인인지 분리한다.
4. 문제가 사용자 데이터나 로컬 queue 상태에 흔적을 남기는 유형이면, 원인 수정과 함께 자동 복구 패치 또는 admin 정리 스크립트 필요 여부를 판단한다.
5. 코드 수정 후 `npm run verify`를 실행한다.
6. `npm run deploy:functions` 후 `check:function-runtime`으로 실제 반영값을 확인한다.
7. feature 문서 또는 이 문서를 함께 갱신한다.
