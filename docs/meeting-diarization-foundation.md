# 회의 전사/화자분리 기반 계약

이 문서는 아직 구현되지 않은 `회의 전사/화자분리` 기능을 저장소 안에서 먼저 고정하는 최소 계약을 다룬다. 목표는 실제 녹음 UI나 업로드 파이프라인을 바로 만들기 전에, `session -> job -> artifact` 경계와 로컬 검증 표면을 먼저 정리하는 것이다.

## 1. 기본 결정

- 수집 전략은 `single-file-first`를 기준으로 잡는다.
- 원본 오디오는 `temporary upload`만 허용하고, 처리 후 즉시 삭제를 기본값으로 둔다.
- 장시간 처리 자체는 `Cloud Run Job` 같은 장기 실행 worker가 맡고, Functions는 사용자 검증과 job 등록, 상태 조회 게이트웨이 역할에 집중한다.
- 회의 데이터는 기존 `prompt-library`, `prompt-store`와 섞지 않고 별도 도메인으로 둔다.

## 2. 최소 실행 경계

### Content / Popup

- 오디오 파일 준비/업로드 상태와 job 상태 표시만 맡는다.
- 실제 원격 업로드와 polling은 background 메시지로 위임한다.
- 브라우저 로컬 상태는 `shared/meeting-state.js` 와 `chrome.storage.local.meetingStateBySession`을 정본으로 두고, `meetingState`는 마지막 반영본 호환 키로만 유지한다.
- popup은 같은 `meetingState`를 읽어 현재 대화 기준 회의 상태 카드를 먼저 보여 주고, 이후 capture/upload action을 이 카드에 이어 붙이는 방향을 기준으로 둔다.
- content는 `content/meeting-manager.js`로 현재 세션 기준 meeting job만 polling하고, 완료 후 artifact를 읽어 같은 `meetingState`에 반영한다.

### Background Service Worker

- `inova-meeting:create-job`
- `inova-meeting:get-job`
- `inova-meeting:get-artifact`

위 세 메시지를 받아 access token을 붙여 Functions 또는 worker 게이트웨이로 전달한다.
브라우저 내부에서는 `shared/meeting-bridge.js` 가 이 runtime message 래퍼 역할을 맡는다.

### Functions / Worker

- `createInovaMeetingJob`
- `getInovaMeetingJob`
- `getInovaMeetingArtifact`

Functions는 i-Nova 사용자 검증, meeting `session` 등록, `job` 등록, worker enqueue만 맡는다. 실제 전사/화자분리와 source audio 정리는 worker가 맡는다.
현재 저장소에는 위 세 endpoint의 `gateway scaffold`만 먼저 들어가 있고, 실제 worker 연결은 아직 구현하지 않았다.

## 3. 최소 데이터 모델

### Session

- `sessionId`
- `provider`
- `providerUserKey`
- `title`
- `startedAt`
- `endedAt`
- `language`

### Job

- `jobId`
- `sessionId`
- `status`
- `progress.phase`
- `progress.percent`
- `source.captureMode`
- `source.mimeType`
- `source.sizeBytes`
- `source.durationMs`
- `cleanup.sourceAudioDeleted`

### Artifact

- `artifactId`
- `jobId`
- `kind`
- `format`
- `createdAt`
- `text`
- `segments[]`

## 4. 권장 상태 전이

`job 상태`는 아래 순서를 기본으로 본다.

1. `queued`
2. `processing`
3. `succeeded` 또는 `failed`

초기 MVP에서는 `uploading` 같은 세분 상태를 런타임 내부에서만 쓰더라도, 외부 계약은 위 세 단계만 먼저 고정해도 충분하다.

## 5. source audio 정리 규칙

- `source audio`는 사용자 재생 라이브러리처럼 장기 보관하지 않는다.
- worker가 성공 또는 최종 실패를 기록한 뒤 `cleanup.sourceAudioDeleted=true`를 남긴다.
- transcript artifact가 남더라도 원본 source audio는 남기지 않는다.

## 6. 로컬 fixture 범위

이 저장소에서는 구현 전에 아래 fixture를 먼저 고정한다.

- `create-job-request.json`
- `create-job-response.json`
- `job-status-processing.json`
- `job-status-succeeded.json`

이 fixture는 이후 실제 Functions, background message, UI polling이 들어올 때 공통 계약의 기준점으로 쓴다.

## 7. 현재 비목표

- 실제 녹음 permission 흐름
- summary / Q&A / retrieval
- playback jump
- speaker rename UI
- 다중 파일 병합

현재 단계에서는 `session`, `job`, `artifact`, source audio cleanup 계약만 먼저 닫는다.
