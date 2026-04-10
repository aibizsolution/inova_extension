# 회의 전사 기반 계약

이 문서는 현재 회의 기능의 hosted-only 경계를 짧게 고정합니다. 정식 경로는 `panel -> background open/authorize -> hosted workspace -> Firestore/Functions` 하나입니다.

## 1. 실행 경계

### Panel / Popup

- popup은 `settings.meetingWorkspaceTarget`만 저장합니다.
- content 패널은 회의 허브 목록과 `새 회의하기`/결과 열기만 담당합니다.
- 패널 목록은 `issueInovaMeetingPanelAuth -> hosted panel bridge -> Firestore query` 경로를 우선 사용하고, 필요할 때만 `listInovaMeetings` fallback을 씁니다.

### Hosted Workspace

- hosted 작업실은 clean URL(`meetingId`, optional `jobId`, optional `share`)로 부팅합니다.
- 작업실은 먼저 확장 bridge와 handshake하고, background가 `authorizeInovaMeetingWorkspaceAccess`로 `owner-secure` 또는 `share-readonly` 권한을 판정한 뒤 Firebase custom token을 받아 Firestore `meeting/job/artifact` 문서를 직접 구독합니다.
- 녹음은 브라우저 표준 `getUserMedia + MediaRecorder` 경로만 사용합니다.
- 로컬 큐와 브라우저 상태는 `chrome.storage.local.meetingStateByMeetingId`만 사용합니다.

### Functions

- 유지되는 HTTP 진입점은 `createInovaMeetingJob`, `uploadInovaMeetingSource`, `updateInovaMeeting`, `updateInovaMeetingResult`, `previewInovaMeetingResultSectionEdit`, `applyInovaMeetingResultSectionEdit`, `deleteInovaMeetingResult`, `deleteInovaMeeting`, `listInovaMeetings`입니다.
- 회의 summary/read 정본은 `integration_inova_meetings` 문서 하나입니다.
- `sessionId`는 보조 메타로 남을 수 있지만 조회 키나 summary 정본으로 쓰지 않습니다.
- 회의록 생성과 섹션 수정 preview는 모두 `gpt-5.4`를 사용하고, 전사 모델과 파이프라인은 그대로 유지합니다.

## 2. 최소 데이터 모델

### Meeting

- `meetingId`
- `owner`
- `title`
- `sharedMemo`
- `termReplacements[]`
- `recentJobs[]`
- `latestJobId`
- `latestArtifactId`

### Job

- `jobId`
- `meetingId`
- `status`
- `progress`
- `source`
- `context.sharedMemoSnapshot`
- `meetingNotes`
- `transcript.artifactId`

### Artifact

- `artifactId`
- `jobId`
- `meetingId`
- `text`
- `segments[]`
- `notes`

## 3. notes 스키마

- notes는 현재 문서 스키마만 읽습니다.
- 스키마 필드는 `meetingMeta`, `overview`, `discussionFlow`, `decisions`, `actionItems`, `openQuestions`, `risksOrDependencies`, `sourceTrace`입니다.
- 회의록 보정은 회의 단위 `termReplacements[]`와 `preview/apply` 섹션 수정 계약으로만 확장합니다.
- `overview`, `discussionFlow`, `decisions`, `openQuestions`, `risksOrDependencies`, `actionItems`만 섹션 수정 대상입니다.

## 4. 검증 기준

- 구형 runtime message `create-job/get-job/get-artifact/list-results/start-capture/stop-capture`는 없어야 합니다.
- 구형 브라우저 storage key 2종은 더 이상 없어야 합니다.
- 구형 session summary 컬렉션은 더 이상 읽거나 쓰지 않아야 합니다.
