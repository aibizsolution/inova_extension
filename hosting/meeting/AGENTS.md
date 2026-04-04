# hosted meeting 작업 규칙

- 이 경로는 독립 feature가 아니라 `meeting` feature의 hosted 실행 표면이다.
- 먼저 [../../docs/feature-routing.md](../../docs/feature-routing.md)와 [../../content/features/meeting/AGENTS.md](../../content/features/meeting/AGENTS.md)를 읽고 시작한다.
- `hosting/meeting/*`만으로 해결되지 않으면 `shared/meeting-*`, 그다음 `background/service-worker.js`, 마지막에 `functions/features/meeting/*` 순서로 확장한다.
- hosted workspace Firebase auth claim은 `meetingId` 단위로 달라질 수 있으므로, `hosting/meeting/firebase-client.js`에서는 `synchronizeTabs: true` 같은 cross-tab Firestore persistence를 다시 켜지 않는다. 여러 회의 탭은 탭별 auth를 유지하고, persistence는 단일 탭 또는 메모리 fallback으로만 다룬다.
- hosted workspace의 `파일 불러오기`는 로컬 origin 전용 기능이 아니다. 상용/로컬 hosted 둘 다 같은 업로드 흐름을 쓰므로 origin 기반으로 버튼을 숨기거나 import를 차단하지 않는다.
- owner-secure hosted 작업실은 `meetingId`만으로 다시 열려도 authorize 응답에서 `meetingSessionToken`을 받아 세션 저장소에 보존해야 한다. 업로드와 작업실 mutation은 Firestore custom token이 아니라 이 meeting session으로 인증된다.
- imported audio duration은 메타데이터가 비어 있어도 바로 임의값으로 넘기지 않는다. 먼저 메타데이터를 읽고, 실패하면 실제 오디오 decode로 duration을 다시 계산한 뒤 둘 다 실패할 때만 명시적 오류를 보여 준다.
- imported audio duration의 메타데이터 실패는 decode fallback으로 복구되면 informational debug log로만 남긴다. 최종 길이 계산까지 실패한 경우에만 error 로그와 사용자 오류를 유지한다.
- hosted 작업실은 녹음 중이거나 실제 업로드가 진행 중일 때 탭/브라우저 이탈을 브라우저 기본 `beforeunload` 경고로 막아야 한다. 업로드가 끝나고 원격 처리만 남은 상태까지 과하게 막지 말고, realtime 정리는 경고 취소와 충돌하지 않게 `pagehide` 같은 실제 이탈 시점으로 둔다.
- prompt/release/conversation 영역은 기본적으로 읽지 않는다.
