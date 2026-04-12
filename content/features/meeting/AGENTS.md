# meeting feature

## 기능 목적
- 회의 허브, hosted 작업실, 녹음, 전사, 결과 검토를 다룬다.

## 문서 갱신 규칙
- 이 feature의 entrypoint, hosted/panel 공통 불변식, auth/recovery 경계, 최소 검증 기준이 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
- `README.md`가 아니라 meeting feature-local 규칙과 계약은 이 문서나 meeting 전용 docs에 문서화한다.
- meeting endpoint/auth/collection baseline과 version/release 판단 기준은 `docs/refactoring-plan.md`에서 관리한다.
- hosted debug console 검증과 증거 수집 절차는 `docs/meeting-debug-console-validation.md`에서 관리한다.
- Functions runtime sizing과 운영 튜닝 기준은 `docs/functions-runtime-guide.md`에서 관리한다.

## 먼저 볼 파일
- `content/meeting-manager.js`
- `content/meeting-view.js`
- `hosting/meeting/index.js`
- `popup/index.js`
- `content/meeting-manager.js`는 현재 `ensurePanelAuth`, `ensureBridgePort`/`handleBridgeMessage`/`disconnectRealtime`, `fallbackRefresh`/`warmRefresh`/`mergeMeetingHub` 세 workflow로 읽는다. 파일 길이만으로 바로 분리하지 말고, bridge lifecycle에 실제 bug pressure가 반복될 때만 다음 split 후보로 올린다.

## 관련 프론트 경로
- `background/service-worker.js`
- `hosting/meeting/*`
- `hosting/extension/panel/meeting-view.js`
- `popup/index.js`
- hosted recovery/self-healing 경로는 `hosting/meeting/workspace-recovery.js`를 먼저 본다.

## hosted/panel 공통 경계
- legacy lane은 현재 `browser-extension-main` hosted meeting 경로를 유지한다. separate hosted origin/site 판단은 `docs/refactoring-plan.md`의 version decision gate에서 관리한다.
- `0.4.5`부터 panel 안의 회의 허브 UI는 `hosting/extension/panel/meeting-view.js`가 렌더링하고, 회의 목록 state와 action routing은 기존 `content/meeting-manager.js`/`content/panel-meeting-controller.js`가 계속 소유한다.
- `1.0.0+` v2 lane에서는 `hosting/extension-v2/panel/meeting-hub-controller.js`가 회의 허브 목록 렌더 상태(`items`, `error/degraded`, freshness`)와 action UI 상태(`pending`, `feedback`, share patch`)를 runtime/functions read로 직접 소유한다. extension snapshot은 `count`와 refresh fingerprint만 남기고, extension은 runtime broker와 브라우저 탭 열기만 맡는다.
- 같은 이유로 v2 panel shell은 `route`, `storage`, `prompt tab`, `surface` 같은 sidecar 이벤트로는 더 이상 `content/meeting-manager.js` sync를 직접 깨우지 않는다. 남아 있는 extension-side meeting sync는 bootstrap, tool select, open/visible 같은 최소 lifecycle에만 제한하고, hosted meeting hub가 snapshot fingerprint와 explicit action을 기준으로 자체 load/refresh를 이어받는다.
- route change는 회의 목록의 정본이 아니다. meeting hub가 이미 로드되었거나 realtime이 붙어 있는 동안에는 route-driven refresh를 다시 예약하지 않고, 회의 동기화는 realtime 연결과 explicit meeting action 중심으로 유지한다.
- 팝업의 `로컬 호스팅` target은 hosted meeting URL만 바꾸는 모드가 아니다. local target에서는 meeting panel bridge와 meeting HTTP auth/list/share 경로도 함께 local Functions/Auth/Firestore emulator를 보도록 유지한다.
- local target의 hosted panel iframe과 hidden meeting panel bridge iframe은 page DOM에서 loopback URL을 직접 열지 않는다. 실제 target URL은 `http://127.0.0.1:5000/*`를 유지하되, 페이지에는 extension `content/frame-proxy.html?target=...` wrapper를 꽂아 site CSP로 인한 direct frame block을 피한다.
- `open-workspace` / `open-result` 진단 로그는 한 콘솔에서 끝까지 닫으려 하지 않는다. top panel 콘솔은 `launch requested/dispatched/accepted`까지만 책임지고, hosted 작업실 boot/ready는 새 탭의 hosted debug console에서 확인한다.
- hosted Firestore 읽기와 listener 연결은 local state만으로 시작하지 않고 `ensureWorkspaceAuth()`가 custom-token sign-in 완료를 보장한 뒤에만 진행한다.
- owner-secure hosted 작업실은 `authorizeInovaMeetingWorkspaceAccess`가 돌려주는 `meetingSessionToken`을 세션에 보존해야 하며, 업로드와 작업실 mutation은 이 토큰을 기준으로 인증한다.
- hosted 작업실의 `파일 불러오기`는 로컬/상용 hosted 모두 같은 업로드 흐름을 쓴다. origin 차이만으로 버튼을 숨기거나 import 실행을 막지 않는다.
- 오디오 import 길이는 메타데이터를 먼저 읽고, 실패하면 실제 decode로 다시 계산한다. 두 경로가 모두 실패할 때만 사용자 오류를 유지한다.
- hosted 작업실은 녹음 중이거나 실제 업로드가 진행 중일 때만 브라우저 기본 이탈 경고를 유지하고, 원격 처리만 남은 상태는 과하게 막지 않는다.
- 회의 제목은 UI에서 회의를 구분하는 편집용 라벨이다. 최초 회의 정리 생성 prompt에는 제목이 아니라 전사와 공용 메모만 사용한다.
- hosted 작업실의 회의록 보정은 전체 재생성이 아니라 `회의별 용어 치환`과 `섹션 단위 preview/apply`로 제한한다.
- hosted 작업실의 섹션 수정은 transcript-grounded fact checker가 아니라 사용자 요청 우선 rewrite 도구다. 전사는 참고 자료로만 쓰고, 설명 보강이나 형식 변환도 전사 부족을 이유로 먼저 거절하지 않는다.
- hosted notes는 `핵심 요약(summary)`과 `회의 개요(overview)`를 분리해서 다룬다. 두 필드는 각각 수정할 수 있고, 한쪽 섹션 수정이 다른 쪽 카드를 함께 덮어쓰지 않아야 한다.
- completed record의 notes action은 탭 우측 공용 action row에서만 노출한다. `회의 정리 복사`, `원문 복사`, `용어 치환`은 이 row를 공유하고, 미완료 기록에는 이 action row를 기본 노출하지 않는다.
- completed remote record는 기록 상세 카드 상단 action row에서만 `기록 이동`을 노출한다. 이동 성공 후에는 현재 회의 룸에 그대로 남고, 옮긴 기록은 현재 룸 목록에서 사라진 뒤 기존 선택 fallback 규칙으로 다음 기록을 고른다.
- `용어 치환` 토글은 별도 라벨/설명 블록 대신 버튼 안의 `?` tooltip으로 meeting-wide 적용 범위를 설명한다.
- 작업실의 짧은 notice는 녹음 카드 inline 박스가 아니라 header toast 슬롯으로 보여 준다.
- 발화가 거의 없거나 잡음에 가까운 약한 전사는 backend gate로 한 번 더 걸러 자동 회의 정리를 건너뛸 수 있어야 하며, 이 경우 이유를 사용자 문구로 드러낸다.
- hosted 상단에는 수동 `새로고침` 액션을 기본 노출하지 않는다. meeting listener와 선택 상세 polling을 기본 동기화 경로로 유지하고, 복원 기준은 예전 URL `jobId`보다 현재 사용자가 고른 record를 우선한다.
- 기록 상세 카드 상단은 제목과 액션 중심으로 유지하고, 진행 정보는 목록 또는 `상태` 탭에서만 본다.

## 관련 functions 경로
- `functions/features/meeting/meeting-service.js`
- `functions/features/meeting/meeting-launch-service.js`
- `functions/features/meeting/meeting-notes-generation-domain.js`
- `functions/features/meeting/meeting-owned-query-domain.js`
- `functions/features/meeting/meeting-processing-runtime-domain.js`
- `functions/features/meeting/meeting-runtime-artifact-domain.js`
- `functions/features/meeting/meeting-result-domain.js`
- `functions/features/meeting/meeting-summary-sync-domain.js`
- `functions/features/meeting/meeting-deletion-domain.js`
- `functions/features/meeting/meeting-notes-source-domain.js`

## 관련 데이터 경계
- `integration_inova_meetings`
- `integration_inova_meeting_jobs`
- `integration_inova_meeting_job_parts`
- `integration_inova_meeting_job_finalizers`
- `integration_inova_meeting_artifacts`
- launch/session 컬렉션
- v2 lane을 열 때는 위 mutable meeting namespace를 legacy와 공용 write하지 않는다. 새 lane은 별도 namespace 또는 copy-only migration을 전제로 설계한다.

## 보통 건드리지 말아야 할 범위
- prompt-library
- prompt-store
- prompt-review
- release

## 최소 검증 방법
- 팝업 target 설정, 회의 탭 목록, hosted meeting 진입, 기존 결과 1건 조회를 확인한다.
- v2 meeting hub ownership을 건드렸다면 `node scripts/verify-meeting-hub-controller.js`로 hosted controller가 runtime read/open/share/revoke를 직접 처리하는지도 함께 확인한다.
- 새 녹음 또는 파일 import 1회와 제목/메모/결과 수정 또는 삭제 1회를 확인한다.
- 회의록 보정 변경이 있으면 `용어 치환 적용하기 1회`, `섹션 수정 preview/apply 1회`, stale preview 재적용 거절을 함께 확인한다.
- 기록 이동 변경이 있으면 완료 기록 1건을 다른 owned 회의 룸으로 옮기고, 현재 룸에서 사라지는지와 대상 회의 룸에서 같은 전사/회의 정리/메모가 유지되는지 확인한다.
- hosted notes action UI를 건드렸다면 `npm.cmd run verify`와 `node scripts/verify-meeting-hosted-ui.js`를 함께 돌리고, 완료 기록에서만 action row가 보이는지와 `용어 치환` 버튼 내부 tooltip 문구를 함께 확인한다.
- local full-stack smoke가 필요하면 `npm.cmd run emulator:meeting-local`을 먼저 켜고, 팝업에서 `로컬 호스팅`을 고른 뒤 같은 흐름을 확인한다.
- hosted 상태 mismatch를 조사할 때는 실제 상용 페이지를 `?debug=1`로 열고, `docs/meeting-debug-console-validation.md` 기준으로 디버그 패널 로그와 helper 출력까지 함께 확보한다.
- 상용 회의 데이터 정리 여부를 편하게 볼 때는 `npm run check:meeting-data`를 사용하고, 실제 삭제 전에는 `npm run delete:meeting-data -- --all` 또는 `--meeting-id <id>` dry-run을 먼저 본다.

## 언제 사용자에게 다시 물을지
- 패널 회의 허브 문제인지 hosted 작업실 문제인지, auth 문제인지 전사 backend 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- feature-local과 owned-shared만으로 해결되지 않고 launch/session 발급, panel cache, export wiring이 얽힐 때만 platform/shell로 넓힌다.
