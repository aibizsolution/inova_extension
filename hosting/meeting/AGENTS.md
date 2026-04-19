# hosted meeting 작업 규칙

- 이 경로는 독립 feature가 아니라 `meeting` feature의 hosted 실행 표면이다.
- 먼저 [../../docs/feature-routing.md](../../docs/feature-routing.md)와 [../../content/features/meeting/AGENTS.md](../../content/features/meeting/AGENTS.md)를 읽고 시작한다.
- `hosting/meeting/*`만으로 해결되지 않으면 `shared/meeting-*`, 그다음 `background/service-worker.js`, 마지막에 `functions/features/meeting/*` 순서로 확장한다.

## auth / session 경계
- panel의 회의 공유와 작업실 진입은 remote capability catalog와 background runtime이 gate한다. `meeting.share.create-function`, `meeting.share.revoke-function`, `meeting.workspace.authorize-access`가 manifest에서 disabled/killed이면 hosted panel action도 먼저 막혀야 한다.
- 공유 링크로 타인 회의룸에 최초 정상 접속하면 서버가 `integration_inova_meeting_participations` shortcut을 만들 수 있다. 반복 접속은 기본적으로 write하지 않고, hosted localStorage participation cache는 24시간 refresh throttle 힌트로만 사용한다.
- participation 기반 재접속은 raw share token을 저장하지 않는다. hosted URL/session의 `participationId`를 `authorizeInovaMeetingWorkspaceAccess`에 전달하고, 서버가 participation 문서와 현재 meeting share 상태를 함께 검증한 뒤 readonly token을 발급한다.
- 회의 공유/작업실 기능이 UI에서 사라지면 먼저 `hosting/extension-v2/capability-manifest.json`의 `enabled`, `killSwitch`, `lane`, alias 상태와 capability handshake 결과를 확인한다.
- hosted workspace Firebase auth claim은 `meetingId` 단위로 달라질 수 있으므로 `hosting/meeting/firebase-client.js`에서는 cross-tab Firestore persistence를 다시 켜지 않는다. 여러 회의 탭은 탭별 auth를 유지하고, persistence는 단일 탭 또는 메모리 fallback으로만 다룬다.
- loopback origin(`127.0.0.1:5000`, `localhost:5000`)에서 열린 hosted 작업실과 panel bridge는 local hosted만이 아니라 local Functions/Auth/Firestore emulator를 함께 기본값으로 본다. local smoke는 이 경로를 기준으로 확인한다.
- hosted Firestore read/query는 local auth state만 보고 바로 실행하지 않는다. `ensureWorkspaceAuth()`가 custom-token sign-in 완료를 보장한 뒤에만 진행한다.
- owner-secure hosted 작업실은 authorize 응답에서 받은 `meetingSessionToken`을 세션에 보존해야 하며, 업로드와 작업실 mutation은 이 meeting session 기준으로 인증한다.
- hosted workspace의 `파일 불러오기`는 로컬 origin 전용 기능이 아니다. 상용/로컬 hosted가 같은 업로드 흐름을 쓴다.
- meeting source audio와 chunk transcript의 원격 Storage 접근은 Functions Admin SDK가 맡는다. 브라우저/hosted client가 Firebase Storage SDK로 bucket을 직접 read/write하는 흐름을 추가하지 않는다.
- imported audio duration은 메타데이터 -> decode fallback 순서로 계산하고, 최종 길이 계산까지 실패했을 때만 사용자 오류를 유지한다.
- 녹음/불러오기 원본 blob은 원격 처리 성공 후에도 completed record의 pending entry에 로컬 보관한다. 원격 source storage는 처리 후 삭제될 수 있으므로, 사용자가 명시적으로 기록/회의를 삭제하기 전까지 `원본 다운로드`가 가능해야 한다.
- OpenAI 전사용 source mode는 OpenAI 파일 업로드 제한보다 낮은 24MB target을 초과하거나 `gpt-4o-transcribe` 단일 오디오 제한 1400초보다 낮은 23분 안전선을 넘으면 chunked로 전환한다.
- chunked source는 12kHz mono WAV, 14분 target, 1.5초 overlap을 기본으로 쓴다. 실제 경계는 14분 지점 주변 45초 안에서 500ms 단위 low-energy 구간을 찾아 조정하되, part WAV는 24MB target 아래에 머물러야 한다.
- hosted 작업실은 녹음 중이거나 실제 업로드가 진행 중일 때만 브라우저 기본 `beforeunload` 경고를 유지한다.

## recovery / sync 경계
- stale pending, orphan local queue, self-healing reconciliation은 `hosting/meeting/workspace-recovery.js`에 먼저 모은다. `workspace-pending-uploads.js`에는 실행 연결만 두고 복구 규칙 조건문을 누적하지 않는다.
- stale pending cleanup은 `meeting.recentJobs` exact match만으로 끝내지 않는다. non-terminal exact match와 오래된 non-terminal summary는 `jobId` direct lookup 또는 `requestId -> deterministic jobId -> doc get`으로 다시 확인한다.
- requestId fallback은 이미 원격 job이 생겼을 가능성이 있는 stale pending에만 쓴다. 새 import 직후의 local-only pending이나 존재하지 않는 job doc를 향한 read 시도는 recovery 대상이 아니다.
- normal processing에는 direct read를 남발하지 않는다. meeting 문서만 realtime listener를 유지하고, 선택된 job/artifact 상세는 `10초 polling`을 source of truth로 쓴다.
- 새 전사 job이 `processing`인 동안에는 artifact 문서를 읽지 않는다. artifact polling은 terminal job이나 기존 completed record mutation처럼 artifact가 실제로 의미 있는 시점에만 허용한다.
- completed record selection도 terminal summary를 우선 신뢰한다. 활성 mutation이 없으면 selection 시 artifact만 읽고, job 재읽기는 mutation 완료 직후 같은 예외 상황에서만 허용한다.
- hosted 상단에는 별도 `새로고침` 버튼을 두지 않는다. meeting listener와 detail polling이 기본 동기화 경로이며, 선택 복원은 URL `jobId`보다 현재 사용자가 고른 record를 우선한다.

## UI 불변식
- 기록 상세 카드 상단은 진행 상태 패널이 아니다. 제목/액션만 두고, pending/processing 배지나 분할 업로드 설명은 상세 카드에서 숨긴다.
- 완료된 remote record만 기록 상세 카드 상단 action row에 `기록 이동`을 노출한다. 이동 dialog는 별도 overlay를 쓰고, 현재 회의 룸을 제외한 다른 owned 회의 룸 제목만 보여 준다.
- 기록 이동 성공 후에는 target 회의 룸으로 자동 이동하지 않는다. 현재 룸에서 기록이 사라진 뒤 기존 selection fallback으로 다음 record를 고른다.
- 기록 이동 시 브라우저에 보관한 원본 local copy도 target 회의 룸으로 함께 재배정한다. source 회의 룸에 원본 보관 entry가 남아 이동한 기록처럼 다시 보이면 안 된다.
- hosted boot에서는 회의 룸과 기록 목록을 먼저 그리고, 선택된 기록 상세 artifact는 비차단으로 뒤늦게 채운다.
- 회의 룸 header 상단 우측은 destructive action 영역이 아니라 짧은 toast notice 슬롯으로 쓴다. `회의 룸 삭제`는 제목 저장 row에 둔다.
- completed record의 review tab action row가 `회의 정리 복사`, `원문 복사`, `용어 치환`을 함께 소유한다. `원문` 탭 전용 별도 toolbar는 다시 만들지 않는다.
- `용어 치환` 설명은 버튼 안쪽 `?` tooltip으로만 노출한다. 별도 heading/body 도움말 블록을 notes 상단에 다시 두지 않는다.
- 섹션 수정 dialog는 preview card와 버튼 상태로만 안내하고, 별도 inline status strip은 두지 않는다.
- 회의 정리 섹션 헤더의 작업은 `직접 수정`, `AI 수정`, `삭제`를 분리한다. AI 수정은 preview/apply dialog를 쓰고, 직접 수정과 삭제는 manual mutation으로 해당 섹션만 저장하거나 비운다.

## 디버그 / 증거 수집
- hosted 작업실은 화면 안에 debug panel/FAB를 렌더하지 않는다. `?debug=1`이면 확장 패널 로그처럼 DevTools 콘솔에 `[inova:meeting #n]`, `[inova:functions #n]`, `[inova:firestore #n]` trace를 출력한다.
- console trace 절차, 로그 확보 helper, boot timing 해석은 `docs/meeting-debug-console-validation.md`에서 관리한다.
- 같은 hosted 증상이 1~2회 패치 후에도 남으면 heuristic recovery를 더 추가하지 말고, debug 문서 기준으로 증거를 먼저 확보한다.

## 범위 제한
- prompt/release/conversation 영역은 기본적으로 읽지 않는다.
