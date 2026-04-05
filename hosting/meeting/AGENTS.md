# hosted meeting 작업 규칙

- 이 경로는 독립 feature가 아니라 `meeting` feature의 hosted 실행 표면이다.
- 먼저 [../../docs/feature-routing.md](../../docs/feature-routing.md)와 [../../content/features/meeting/AGENTS.md](../../content/features/meeting/AGENTS.md)를 읽고 시작한다.
- `hosting/meeting/*`만으로 해결되지 않으면 `shared/meeting-*`, 그다음 `background/service-worker.js`, 마지막에 `functions/features/meeting/*` 순서로 확장한다.
- hosted workspace Firebase auth claim은 `meetingId` 단위로 달라질 수 있으므로, `hosting/meeting/firebase-client.js`에서는 `synchronizeTabs: true` 같은 cross-tab Firestore persistence를 다시 켜지 않는다. 여러 회의 탭은 탭별 auth를 유지하고, persistence는 단일 탭 또는 메모리 fallback으로만 다룬다.
- hosted Firestore `readDocument/queryDocuments`는 local auth state가 채워졌다는 이유만으로 바로 실행하지 않는다. 실제 Firebase custom-token sign-in이 끝났는지 `ensureWorkspaceAuth()` 기준으로 맞춘 뒤 읽어야 하며, 그렇지 않으면 존재하는 job/doc에도 permission 오류가 날 수 있다.
- hosted workspace의 `파일 불러오기`는 로컬 origin 전용 기능이 아니다. 상용/로컬 hosted 둘 다 같은 업로드 흐름을 쓰므로 origin 기반으로 버튼을 숨기거나 import를 차단하지 않는다.
- owner-secure hosted 작업실은 `meetingId`만으로 다시 열려도 authorize 응답에서 `meetingSessionToken`을 받아 세션 저장소에 보존해야 한다. 업로드와 작업실 mutation은 Firestore custom token이 아니라 이 meeting session으로 인증된다.
- imported audio duration은 메타데이터가 비어 있어도 바로 임의값으로 넘기지 않는다. 먼저 메타데이터를 읽고, 실패하면 실제 오디오 decode로 duration을 다시 계산한 뒤 둘 다 실패할 때만 명시적 오류를 보여 준다.
- imported audio duration의 메타데이터 실패는 decode fallback으로 복구되면 informational debug log로만 남긴다. 최종 길이 계산까지 실패한 경우에만 error 로그와 사용자 오류를 유지한다.
- hosted 작업실은 녹음 중이거나 실제 업로드가 진행 중일 때 탭/브라우저 이탈을 브라우저 기본 `beforeunload` 경고로 막아야 한다. 업로드가 끝나고 원격 처리만 남은 상태까지 과하게 막지 말고, realtime 정리는 경고 취소와 충돌하지 않게 `pagehide` 같은 실제 이탈 시점으로 둔다.
- stale pending, orphan local queue, self-healing reconciliation은 `hosting/meeting/workspace-recovery.js`에 먼저 모은다. `workspace-pending-uploads.js`에는 실행 연결만 두고 복구 규칙 조건문을 계속 누적하지 않는다.
- stale pending cleanup은 `meeting.recentJobs`만 믿지 않는다. 오래된 성공 job이 recent list에서 밀려날 수 있고, recent list 안의 같은 `requestId` entry도 `processing`으로 stale할 수 있으므로 non-terminal exact match는 `pending.jobId` direct lookup과 `pending.requestId -> deterministic jobId -> doc get`으로 다시 확인한다.
- 위 requestId fallback은 이미 원격 job이 생겼을 가능성이 있는 stale pending에만 쓴다. 새 import 직후의 local-only pending은 fallback read 대상이 아니며, 존재하지 않는 job doc는 rules상 `permission denied`처럼 보일 수 있으니 이런 케이스는 로그를 낮추지 말고 애초에 시도하지 않도록 고친다.
- 이 direct 확인은 pending entry뿐 아니라 `recentJobs`에 남은 non-terminal remote summary에도 적용한다. 실제 job 문서가 terminal이면 hosted list status도 즉시 맞춘다.
- 같은 hosted 증상이 1~2회 패치 후에도 재현되면, 더 이상 heuristic recovery를 추가하지 않고 정확한 증거 수집 모드로 전환한다.
- 정확한 증거 수집은 실제 상용 페이지 `?debug=1` 기준으로 한다. 최소 세트는 `화면 스크린샷`, `디버그 패널 복사 로그`, 아래 콘솔 helper 출력이다.
- hosted 디버그 콘솔은 일반 이벤트 로그와 오류 로그를 분리해서 본다. 일반 이벤트는 최근 `120`건만 보관하지만, 오류는 별도 보존 버퍼를 유지해야 하며 `오류` 버튼 또는 `window.__INOVA_HOSTED_MEETING_DEBUG__.errors()`로 복사 가능해야 한다.
- 디버그 패널 통계 배지는 최근 표시 버퍼 기준이 아니라 누적 기준이어야 한다. 함수 호출, Firestore 읽기, 스냅샷, 오류 카운트는 로그 창에서 오래된 항목이 밀려도 `비우기` 전까지 유지한다.
- 상단 배지는 일반 로그 개수를 빼고 `함수`, `읽기`, `리스너`, `오류`만 보여 준다. `함수`는 HTTP/Functions 요청, `읽기`는 direct read/query, `리스너`는 snapshot 이벤트다.
- panel과 hosted debug console은 같은 렌더 계약과 같은 상태 라벨을 유지한다. 폭과 로그 높이도 같은 기준값을 우선 사용해 표면별 체감이 달라지지 않게 맞춘다.
- 기록 상세 카드 상단은 진행 상태 패널이 아니다. 제목/액션만 두고, pending/processing 배지나 분할 업로드 설명은 상세 카드에서 숨긴다. 진행 정보는 기록 목록과 `상태` 탭에서만 노출한다.

```js
window.__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })
```

- 위 helper는 `pending.requestId`, `pending.jobId`, `createdAt`, `durationMs`, `meetingTitleSnapshot`, 최근 queue 이벤트와 debug entry를 함께 덤프한다. stale pending 수정은 이 증거로 식별자가 확인된 뒤에만 진행한다.
- helper가 보이지 않으면 기능 버그로 추정하지 말고 먼저 최신 hosted JS가 내려왔는지 확인한다. 이 경우는 `hosting` 배포 여부, 페이지 강한 새로고침, 필요 시 확장 Reload 여부를 먼저 점검한다.
- prompt/release/conversation 영역은 기본적으로 읽지 않는다.
