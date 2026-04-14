# 런타임 아키텍처 맵

이 문서는 `i-Nova 더하기`를 사람이든 에이전트든 빠르게 이해할 수 있게, 현재 저장소의 실제 실행 경계와 검증 표면을 한곳에 모아 둔 런타임 지도다.

## 1. 권위 있는 소스

다음 경로만 현재 동작의 정본으로 본다.

- `manifest.json`
- `popup/`
- `content/`
- `background/`
- `shared/`
- `functions/`
- `hosting/`
- `docs/`
- `firebase.json`
- `firestore.rules`

다음 경로는 배포 산출물 또는 파생 결과이므로 수정 기준으로 쓰지 않는다.

- `releases/_staging/`
- `hosting/extension/downloads/`
- `hosting/extension/releases/latest.json`
- `hosting/extension/releases/history.json`

## 2. 실행 표면

### Popup

- 위치: `popup/index.html`, `popup/index.js`
- 역할: hosted 회의 작업실 연결 대상을 `상용 호스팅 / 로컬 호스팅` 중 하나로 저장한다.
- 특징: 팝업은 설정만 맡고, 실제 `새 회의하기`와 결과 열기는 content 패널의 회의 허브에서 처리한다. 같은 `settings.meetingWorkspaceTarget`은 회의 rehearsal뿐 아니라 prompt-library sync, prompt-review, prompt-store read/write, hidden prompt bridge도 함께 local Functions/Hosting emulator 대상으로 전환한다.

### Hosted Panel App

- 위치: `hosting/extension/panel/index.html`, `hosting/extension/panel/index.js`, `hosting/extension/panel/*.js`
- 역할: 우측 `실험실` 패널의 tool rail/header/content UI를 hosting에서 서빙한다.
- 특징: `0.x` legacy lane부터 panel 기본 UI는 content DOM이 아니라 hosted iframe 안에서 렌더링된다. `1.0.0+` v2 lane에서는 conversation/prompt/store/review/meeting/release의 상태와 UI ownership이 hosted `extension-v2/panel/*` controller로 이동하고, tool rail/header chrome도 hosted가 active tool과 feature state로 직접 계산한다. 확장은 iframe host/bridge와 page adapter만 유지한다. panel debug는 별도 UI를 렌더링하지 않고 top 콘솔 trace와 세션 전역 버퍼만 유지한다.

### Hosted Meeting App

- 위치: `hosting/meeting/index.html`, `hosting/meeting/index.js`, `hosting/meeting/workspace-*.js`
- 역할: `index.js`는 composition root로서 초기 state/DOM/cache/common render/controller wiring을 맡고, `workspace-session`, `workspace-realtime`, `workspace-capture`, `workspace-pending-uploads`, `workspace-mutations`, `workspace-debug`가 세션, 실시간 구독, 녹음/가져오기, 로컬 queue, 사용자 mutation, debug 부수효과를 각각 소유한다.
- 특징: 회의 제어와 상세 보기를 확장 UI에서 분리한 메인 작업실이다. `meetingSessionToken`으로 회의 명령 API를 호출하고, 작업실 상태는 Firebase custom token으로 로그인한 뒤 Firestore `meeting/job/artifact` 문서를 직접 구독한다. 마이크 녹음은 `workspace-capture.js`가 브라우저 표준 `getUserMedia + MediaRecorder` 경로로 처리한다.

### Content Script

- 위치: `content/`, `shared/`, `manifest.json`
- 역할: `inova.incross.com` 안에 실험실 패널을 삽입하고, 질문 탐색/회의록/프롬프트/스토어/릴리스 UI와 회의 허브 진입 흐름을 조립한다.
- 특징: 현재 대화 DOM을 읽고, 로컬 상태를 붙이고, 필요한 클라우드 호출은 background에 메시지로 위임한다. `content/main.js`는 composition root, `content/panel-v2-composition-controller.js`는 active state/composition/runtime/provider-identity bridge와 hosted-owned controller graph 조립을 맡고, `content/panel-v2-shell-bridge.js`는 active tool/activity/surface/lifecycle/bootstrap/render bridge를 맡고, hosted panel에 넘길 `panelSnapshot`과 `panelTrace`도 여기서 먼저 조립한다. `content/panel.js`는 host element, handle interaction, bridge endpoint를 맡고, iframe target/status/handshake/render batching은 `content/panel-host-runtime.js`가 맡는다. panel iframe target 선택도 `shared/firebase-config.js`의 generic `firebaseConfig.panel.resolveRuntime()` helper를 통해 받아 feature-aware runtime 분기를 직접 들지 않는다. render bridge는 hosted tool state를 `panelSnapshot`으로 먼저 조립해 넘기고, top snapshot trace detail도 prebuilt `panelTrace`로 함께 넘기므로 `content/panel.js`는 더 이상 prompt review detail을 직접 읽지 않는다. top console trace allowlist와 summary formatting은 `content/panel-console-trace.js`가 맡고, `content/panel.js`는 `panel-console-trace`와 `panel-host-runtime` helper를 주입받아 host/bridge 쪽 부수효과만 남긴다. `content/hosted-panel-bridge.js`는 hosted iframe postMessage contract와 active hosted request helper를 함께 맡는다. 현재 `1.0.0+` extension bundle은 panel을 `content/panel-v2-composition-controller.js`로 직접 부팅하고, `backup/legacy-panel/panel-composition-controller.js`, `backup/legacy-panel/panel-action-controller.js`, `backup/legacy-panel/panel-meeting-controller.js`, `backup/legacy-panel/meeting-manager.js`는 활성 manifest에 싣지 않는다. `1.0.0+` v2 lane은 shell/runtime/route/page adapter만 extension에 남기고, tool rail/header chrome 같은 hosted shell 결정은 더 이상 extension에서 계산하지 않는다. v2 bootstrap은 실제로 hosted panel이 아직 보내는 shell callback(`select-tool`, `search`, `bookmark`, `escape`, `tool-summary-sync`)만 host에 넘기고, release/meeting/prompt legacy action callback은 기본 surface에서 제외한다. active `content/hosted-panel-bridge.js`도 이에 맞춰 compact `tool summary sync`, `conversation bookmark`, shell/runtime/page contract만 유지하고, legacy `release-action`, `meeting-action`, prompt action request path는 더 이상 active `1.0.0` bundle에 남겨 두지 않는다. `DB/Functions` 계약을 바꾸지 않는 순수 panel migration이라면 판단 기준은 현재 v2 bundle이 정상 동작하는지다. v2 composition은 prompt bridge proxy를 다시 한 번 만들지 않고 active v2 prompt controller를 render/bootstrap wiring에만 직접 넘긴다. legacy lane도 별도 prompt bridge proxy 없이 `backup/legacy-panel/panel-prompt-controller.js`를 shell/render/bootstrap에 직접 넘긴다. conversation도 v2에서는 bookmark item list와 empty/meta 문구를 extension snapshot에 싣지 않고, hosted `extension-v2/panel/conversation-controller.js`가 page snapshot으로 직접 계산하며 extension은 count, activeId, refresh용 fingerprint만 남긴다. prompt도 v2에서는 prompt/store item list와 prompt activeTab/search state를 extension snapshot에 싣지 않고, hosted `extension-v2/panel/prompt-library-controller.js`, `prompt-library-firestore-client.js`, `prompt-store-controller.js`, `prompt-review-controller.js`가 각 탭 상태와 prompt tab 전환/persistence, prompt/store/review action routing, import/reorder draft mutation을 직접 계산한다. active prompt shell view는 `prompt-tool-view.js`가 맡고, interaction helper도 `prompt-tool-panel.js`가 맡는다. v2 hosted panel은 더 이상 `prompt-hub-view.js` fallback을 로드하거나 렌더 fallback으로 쓰지 않고, active helper naming도 legacy `prompt-hub-*`를 끌고 가지 않는다. active hosted v2 panel은 이제 단일 `index.css`만 로드하고, dead `legacy-panel.css`와 `legacy-tools.css`에 있던 살아 있는 bookmark/tool-shell 스타일도 현재 hosted shell stylesheet 안으로 흡수했다. extension은 `content/panel-v2-prompt-controller.js`로 review handoff signal과 composer review float만 유지하고, generic `prompts/store` tool 선택은 `content/panel-v2-shell-bridge.js`가 `activeTool: "prompts"` + `activePromptTab` persistence로만 정규화한다. persisted legacy `activeTool: "store"` 값은 `shared/storage.js`에서 즉시 `activeTool: "prompts"` + `activePromptTab: "store"`로 흡수하고, active route/shell은 더 이상 store를 별도 tool id로 들고 있지 않는다. active v2 shell은 더 이상 hosted-owned prompt store load, storage listener, realtime/cloud sync sidecar를 extension에서 깨우지 않고, hosted-owned release refresh/download lifecycle도 extension에서 다시 깨우지 않는다. active `createState()`와 `route-state-controller`도 hosted-owned prompt library/store/editor mirror를 다시 들지 않는다. active compact hosted residue는 feature별 top-level bucket 대신 `toolSummaries` 아래에 모으고, 현재는 `toolSummaries.release(count + snapshotFingerprint)`와 count-only `toolSummaries.meeting`만 유지한다. v2 composition은 이 compact `meeting` / `release` residue도 feature별 snapshot helper 대신 shared `toolSummaries` normalizer/helper로 정규화하고, v2 shell render도 meeting/release 전용 deps 대신 shared tool-summary callback으로만 그 residue를 읽는다. active `1.0.0+` manifest는 더 이상 `backup/legacy-panel/features/prompt-library/files.js`, `backup/legacy-panel/features/prompt-library/cloud-sync-manager.js`, `backup/legacy-panel/features/prompt-library/prompt-manager.js`, `backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js`, `backup/legacy-panel/features/prompt-store/store-manager.js`, `backup/legacy-panel/prompt-hub-state.js`, `backup/legacy-panel/prompt-hub-panel.js`, `backup/legacy-panel/prompt-hub-controller.js`, `backup/legacy-panel/prompt-hub-runtime.js`, `backup/legacy-panel/panel-prompt-controller.js`를 활성 bundle에 싣지 않는다. 프롬프트 `내 요청` read path는 hosted panel 안에서 `auth.issue-prompt-panel`로 Firebase custom token을 발급받고, `integration_inova_accounts_v2.promptLibraryMeta` `onSnapshot` 뒤 `prompt_library_orders_v2`/`prompt_library_chunks_v2` direct read로 조립한다. 단순 목록 read를 위한 `loadInovaPromptLibraryV2` Functions fetch는 v2 hosted path에서 다시 쓰지 않는다. release도 v2에서는 latest/history/error 같은 상세 view-state를 extension snapshot에 싣지 않고, hosted `extension-v2/panel/release-controller.js`가 직접 계산하며 extension은 rail count용 compact summary만 남긴다. refresh/download 액션도 이제 hosted release controller가 직접 끝내고, extension은 runtime invoke의 `browser.open-url` broker만 맡는다. meeting도 v2에서는 회의 허브 item list와 action UI 상태를 extension snapshot이나 active extension state bucket에 싣지 않고, hosted `extension-v2/panel/meeting-hub-controller.js`가 `storage.get-state`, `auth.issue-meeting-panel`, hosted `meeting-firestore-client.js`, `meeting.open-*`, `meeting.*share*` runtime invoke로 목록/오류/degraded/pending/feedback/share 상태를 직접 계산한다. 목록 읽기는 hosted panel 안에서 Firebase custom token sign-in 뒤 Firestore `integration_inova_meetings` `onSnapshot`으로 이어지고, hosted meeting hub는 compact `meeting summary`를 generic top-panel `tool-summary-sync`로 다시 올려 extension의 count-only `toolSummaries.meeting`만 유지한다. 이 summary sync는 이제 rail count를 위한 outbound 신호로만 남고, hosted meeting hub는 echo된 `panelState.meetingTool` count를 lifecycle/state 정본으로 다시 쓰지 않는다. hosted meeting count는 bootstrap 중에도 `0`으로 시작하고, Firestore snapshot과 현재 hub memory로만 올라간다. active v2 createState는 legacy `meetingHub`/`meetingUi` bucket을 더 이상 들지 않고, 이 compact summary는 count-only state로 바로 normalize하며 `backup/legacy-panel/meeting-manager.js` merge helper를 다시 거치지 않는다. v2 hosted panel은 `meeting-action` top-panel fallback 없이 open/share/revoke를 자체적으로 끝내며, extension은 runtime broker와 브라우저 탭 열기만 맡는다. v2 shell도 route/storage/prompt-tab/surface/bootstrap 같은 sidecar/lifecycle 이벤트로는 더 이상 `backup/legacy-panel/meeting-manager.js` sync를 깨우지 않고, hosted `meeting-hub-controller`가 top-panel fingerprint echo 없이 meeting tool 재진입, hosted 문서 `visibility-visible`, explicit action 결과를 기준으로 load/refresh를 직접 판단한다. meeting storage listener는 v2 bootstrap에서 등록하지 않고, tool state/controller ownership은 hosted `extension-v2/panel/*`로 점진 이동한다. 회의 기능은 브라우저 쪽에서 `meetingStateByMeetingId` 상태만 유지하고, `backup/legacy-panel/meeting-manager.js`는 legacy reference/source로만 남는다. 회의 허브 목록은 별도 `chrome.storage.local` 캐시 대신 hosted Firestore subscription과 현재 메모리 상태를 우선한다. 프롬프트/스토어 쪽은 legacy lane에서 `backup/legacy-panel/panel-prompt-controller.js`가 `backup/legacy-panel/prompt-hub-*` shell과 `backup/legacy-panel/features/prompt-library/cloud-sync-manager.js`, `backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js` wiring을 감싸고 panel shell도 직접 상대한다. `1.0.0+` v2 lane에서는 hosted prompt panel이 `prompt-tab-select`, `prompt-action`, `prompt-draft-change`, `store-action`, `import-file`, `move-prompt` 같은 top-panel fallback 없이 자체 tab selection과 action flow를 끝낸다. `1.0.0+` v2 lane은 `v2.*` local storage key와 `integration_inova_accounts_v2` prompt-library meta 문서를 우선한다. panel/read-state 계약은 공통으로 `source`, `degraded`, `degradedReason`, `dataFreshness(fresh|stale|empty)`를 함께 들고, stale cache를 success-like fallback으로 숨기지 않는다. 패널 디버그는 회의 전용이 아니라 현재 브라우저 탭 세션 기준 전역 버퍼를 쓰고, 사용자 관측은 top 콘솔 trace를 기준으로 한다.

### Background Service Worker

- 위치: `background/service-worker.js`
- 역할: i-Nova access token 확보, Firebase Functions 호출, 릴리스 메타 fetch, 동기화 중복 완화, prompt/store panel auth 발급, hosted 회의 launch grant 발급, 작업실 URL 타깃 분기
- 특징: 클라우드 경계의 브로커다. content script가 직접 장기 원격 상태를 다루지 않게 막아 준다. 회의 기능은 `inova-meeting:*` 메시지로, 프롬프트 실시간은 `inova-prompt:*` 메시지로 이 경계를 먼저 통과한다. 패널에서 열린 작업실은 popup 설정의 호스팅 타깃을 따르되, runtime lane이 `v2`면 lane-aware config가 가리키는 v2 hosting/release origin을 사용한다. popup 설정이 `local`이면 prompt 관련 Functions 호출과 panel auth도 production 대신 local Functions base URL을 써서 배포 전 full-stack rehearsal을 가능하게 해야 한다.

### Firebase Functions

- 위치: `functions/index.js`, `functions/features/prompt-library/register.js`, `functions/features/prompt-review/prompt-review-service.js`, `functions/features/prompt-store/store-service.js`, `functions/features/meeting/meeting-service.js`, `functions/features/meeting/meeting-launch-service.js`
- 역할: i-Nova 사용자 검증 뒤 prompt review, prompt store, prompt library sync API와 회의 기능 gateway endpoint를 제공한다.
- 특징: 현재 원격 백업과 공개 스토어의 진입점이며, 프롬프트 패널용 `issueInovaPromptPanelAuth`가 Firebase custom token을 발급한다. lane 분리 기반으로 prompt-library는 `issueInovaPromptPanelAuthV2`, `loadInovaPromptLibraryV2`, `peekInovaPromptLibraryV2`, `syncInovaPromptLibraryV2`를 통해 별도 namespace와 lazy migration을 준비했다. prompt store는 `latest` 공개 feed page만 미리 써 두고, 검색/인기 정렬/상세는 요청 시 직접 query한다. 회의 기능은 launch grant 발급, hosted session 교환, 임시 source audio 업로드, OpenAI diarization 호출, `integration_inova_meeting_*` Firestore 기록, source cleanup까지 Functions 안에서 처리한다.
- runtime 운영 기본값과 예외 프로파일은 `docs/functions-runtime-guide.md`를 기준으로 본다.

### Firestore / Hosting

- 위치: `firebase.json`, `firestore.rules`, `hosting/`
- 역할: Firestore는 백업/스토어 메타 저장소, Hosting은 릴리스 JSON/ZIP 배포면
- 특징: Firestore 규칙은 기본 `deny all`을 유지하되, hosted 회의 작업실이 세션 범위의 Firebase custom token으로 `integration_inova_meetings`, `integration_inova_meeting_jobs`, `integration_inova_meeting_artifacts` 문서를 읽기 전용으로 구독할 수 있는 예외와, prompt panel 세션이 active lane에 맞는 account 문서(`integration_inova_accounts` 또는 `integration_inova_accounts_v2`), prompt library order/chunk 문서, shared store doc을 읽을 수 있는 예외만 연다. bridge는 page 0을 먼저 붙이고, 공개 수가 많을 때만 page 1을 추가로 붙인다. prompt bridge 자산은 cache-busting query와 no-cache 헤더를 함께 써서 hosting-only 배포 직후에도 새 스크립트가 바로 반영되게 한다. hosted panel 자산은 `firebaseConfig.hosting.panelAppUrl`로 lane-aware URL을 계산하고, `0.x -> hosting/extension/panel/*`, `1.x+ -> hosting/extension-v2/panel/*` 규칙을 따른다. release ZIP/history는 `0.x -> hosting/extension/*`, `1.x+ -> hosting/extension-v2/*`로 lane을 분리한다.

## 3. 주요 데이터 흐름

### A. 질문 탐색

1. content script가 대화 DOM에서 사용자 질문을 수집한다.
2. 세션 키는 URL의 `sid`로 정규화한다.
3. 패널에서 검색/이동은 현재 페이지 DOM을 기준으로 처리한다.

### B. 로컬 프롬프트 보관함

1. 사용자가 패널에서 프롬프트를 추가/수정/삭제한다.
2. `shared/storage.js`가 `chrome.storage.local`에 저장한다.
3. 같은 시점에 `cloudSync` 메타를 큐잉한다.

### C. 프롬프트 원격 메타 실시간

1. 패널의 `프롬프트` 도구가 열리면 hosted `prompt-library-controller`가 `inova-prompt:issue-panel-auth`를 background에 보낸다.
2. background는 `issueInovaPromptPanelAuthV2` 또는 lane-aware prompt panel auth endpoint를 호출해 Firebase custom token을 받는다.
3. hosted panel 안의 Firestore client가 Firebase Auth에 로그인하고 `integration_inova_accounts_v2/{providerUserKey}` 문서를 구독한다.
4. hosted panel은 `promptLibraryMeta` 변경을 기준으로 `prompt_library_orders_v2`/`prompt_library_chunks_v2`를 직접 읽어 `내 요청` 상태를 다시 조립한다.
5. extension은 `content/panel-v2-prompt-controller.js`를 통해 review handoff signal과 composer review float만 유지하고, generic `prompts/store` tool 선택 persistence는 `content/panel-v2-shell-bridge.js`가 맡는다.
6. popup 설정이 `local`이면 2번은 local Functions endpoint를 호출하고, 3~4번 hosted panel도 local Auth/Firestore emulator를 사용한다.

### D. 원격 백업

1. content script가 sync 상태를 만들고 background에 메시지를 보낸다.
2. background가 access token을 준비한다.
3. Functions가 i-Nova 사용자 검증 뒤 Firestore에 반영한다.
4. 확인용 운영 점검은 `scripts/check-cloud-sync.js`, `scripts/check-function-logs.js`로 한다.
5. popup 설정이 `local`이면 prompt-library `load/peek/sync`와 prompt-review/store write도 local Functions emulator로 향한다.

### E. 프롬프트 스토어 / 평가 / 릴리스

1. content script가 사용자의 액션을 수집한다.
2. background가 Functions 또는 Hosting으로 요청을 보낸다.
3. 응답은 다시 content script 상태에 머지된다.
4. 예외적으로 공개 `전체` 스토어는 hidden hosted prompt bridge가 Firestore local cache를 유지한 채 `prompt_store_meta/summary`와 `prompt_store_feed_pages/latest__all__0000`, `latest__all__0001`를 실시간 구독해 최대 `1000`건 로컬 집합을 유지한다.
5. 검색, 카테고리, `최신/좋아요/가져오기/조회수` 정렬은 이 로컬 집합 안에서 다시 계산하고, 상세 `보기` 본문은 같은 bridge가 `prompt_store_entry_details/{entryId}`를 direct read한다. `내 등록`과 쓰기 액션만 request-response 흐름을 사용한다.

### F. 회의 작업실 진입

1. popup은 `settings.meetingWorkspaceTarget`을 저장하고, content 패널은 `새 회의하기` 또는 결과 리스트 항목에서 `inova-meeting:open-workspace` / `inova-meeting:open-result`를 background로 보낸다.
2. background는 popup 설정의 호스팅 타깃에 맞는 clean hosted 작업실 URL(`meetingId`, optional `jobId`, optional `share`)을 만든다.
3. background가 `chrome.tabs.create()`로 hosted `meeting/index.html?meetingId=...&jobId=...` 또는 로컬 `http://127.0.0.1:5000/meeting/index.html?...` URL을 연다.
4. hosted 회의 작업실은 부팅 직후 확장 bridge와 handshake하고, background가 현재 i-Nova 로그인 상태와 접근 권한을 확인한다.
5. background는 `authorizeInovaMeetingWorkspaceAccess`를 호출해 `owner-secure` 또는 `share-readonly` 접근을 판정하고, 허용 시에만 Firebase custom token을 돌려준다.
6. hosted 회의 작업실은 그 custom token으로 Firebase Auth에 로그인한 뒤 `meeting` 문서 구독을 붙이고, 선택된 기록에 따라 `job`, `artifact` 문서를 추가 구독한다. 확장 미설치, 로그인 안 됨, owner-only 위반, 무효한 share 링크는 모두 blocked 상태로 남긴다.

### G. hosted 회의 녹음 시작/종료

1. hosted 회의 작업실에서 사용자가 직접 `녹음 시작`을 누른다.
2. 브라우저가 처음 한 번 마이크 권한을 확인하면, 사용자는 권한을 허용한다.
3. hosted 회의 작업실이 `getUserMedia`와 `MediaRecorder`로 마이크 오디오를 녹음한다.
4. 녹음이 끝나면 원본 blob과 캡처 메타를 같은 탭 메모리에 유지하고, 같은 회의의 새 런 생성 준비 상태로 둔다.

### H. hosted 회의 전사 접수

1. hosted 회의 작업실이 방금 녹음한 blob을 inline payload로 바꾸거나 chunk 업로드 가능한 source로 준비한다.
2. hosted 회의 작업실이 `meetingSessionToken`으로 `createInovaMeetingJob` 또는 `uploadInovaMeetingSource`를 직접 호출한다.
3. Functions background 처리기가 source download, OpenAI diarization, chunk 병합/화자 정합, notes 생성, Firestore `meeting/job/artifact` 저장, source cleanup을 수행한다.
4. hosted 회의 작업실은 이미 붙어 있는 Firestore `meeting/job/artifact` 구독으로 결과 리스트와 상세 transcript를 실시간 반영한다.
5. content 패널의 `회의` 도구는 전체 회의 허브만 보여 주고, 상세 transcript는 hosted 작업실이 렌더링한다.

## 4. 책임 경계 요약

### Content Script가 해도 되는 일

- DOM 읽기
- 패널 렌더링
- 로컬 상태와 UI 선호도 저장
- background에 요청 위임

### Background가 맡아야 하는 일

- access token 읽기
- 외부 네트워크 호출
- 중복 요청 완화
- 릴리스 메타 fetch
- hosted 회의 launch grant 발급

### Functions가 맡아야 하는 일

- provider identity 검증
- 공개 스토어 읽기/쓰기
- 원격 백업 읽기/쓰기
- hosted 회의 launch/session 검증
- 서버 기준 감사 로그와 오류 응답 형식

## 5. 현재 검증 표면

### 정적/구조 검증

- `npm run verify:contracts`
- `node scripts/verify-hosted-panel-bridge.js`
- `npm run verify:docs`
- `node scripts/verify-meeting-hub-controller.js`
- `node scripts/verify-panel-shell-controller.js`
- `node scripts/verify-panel-render-controller.js`
- `node scripts/verify-panel-bootstrap-controller.js`
- `node scripts/verify-route-state-controller.js`
- `node scripts/verify-route-watch-controller.js`
- backup legacy reference가 필요할 때만 `npm run verify:legacy-backup`
- backup legacy 개별 계약은 `scripts/legacy-panel/*` 아래에 격리해 둔다.

### 운영/런타임 점검

- `npm run check:cloud-sync -- --userKey <providerUserKey>`
- `npm run check:function-logs -- --since 10`
- `docs/functions-runtime-guide.md`
- 실제 브라우저 확인: `docs/e2e-browser-workflow.md`
- prompt 계열 Chrome smoke 공통 준비: unpacked extension `Reload` -> `https://inova.incross.com/` 새로고침 -> 우측 `실험실` 패널 열기 -> `프롬프트` 도구 진입
- `prompt-library` smoke: `내 요청` 탭 렌더링, 기존 항목 또는 새 항목 1건 저장/수정, 입력창 주입 1회
- `prompt-store` smoke: `전체` 목록 로드, 상세 보기 1건, `좋아요` 또는 `내 요청으로 가져오기` 1회, 탭 이동 후 복귀 시 목록 유지
- `prompt-review` smoke: 입력창 우측 상단 평가 버튼 노출, 평가 결과 1회, 보완 프롬프트 반영 1회
- prompt local rehearsal: popup에서 `로컬 호스팅` 선택 후 hidden prompt bridge가 `http://127.0.0.1:5000/extension/prompt-panel-bridge.html`을 쓰고, prompt read/write/review/panel auth가 local Functions base URL로 전환되는지 본다.
- backup legacy conversation/runtime reference가 필요할 때만 `npm run verify:legacy-backup` 안의 `node scripts/legacy-panel/verify-panel-bookmark-controller.js`, `node scripts/legacy-panel/verify-panel-runtime-controller.js`로 `backup/legacy-panel/panel-bookmark-controller.js`, `backup/legacy-panel/panel-runtime-controller.js` 계약을 다시 본다.
- panel local rehearsal: popup에서 `로컬 호스팅` 선택 후 hosted panel iframe이 `http://127.0.0.1:5000/extension/panel/index.html`을 바라보는지, hosted UI 자체가 hosting 배포만으로 갱신되는지 본다.
- 이번 prompt smoke 제외 범위: import/export 전체 조합, 원격 sync 확인, 공개 스토어 등록/삭제. 원격 sync는 필요 시 `npm run check:cloud-sync -- --userKey <providerUserKey> --samples 2 --wait 20`로 별도 점검
- 로컬 회의 작업실: `npm run emulator:hosting` -> `http://127.0.0.1:5000/meeting/index.html`
- 회의 전용 로컬 확인은 팝업의 `상용 호스팅 / 로컬 호스팅` 전환과 화면 안 디버그 로그 패널 기준으로 본다.
- 회의 전사 기반 계약: `docs/meeting-diarization-foundation.md`, `fixtures/meeting-diarization/`

## 6. 현재 한계

- 핵심 UI 흐름은 여전히 실사이트 의존성이 남아 있고, 실제 Chrome에서만 드러나는 opener/session 문제를 정적 검증만으로는 잡을 수 없다.
- 로컬 Hosting + 상용 Functions 조합은 빠르지만, 브라우저 확장과 hosted page 사이의 실제 세션 흐름을 항상 함께 봐야 한다.
- Functions, Firestore, hosted page, service worker 경계가 모두 이어진 기능은 결국 실제 브라우저 점검이 가장 신뢰도가 높다.

## 7. 다음 확장 원칙

- 새 기능은 먼저 어떤 실행 경계에 들어가는지 이 문서 기준으로 결정한다.
- 기본 검증은 문서/계약 검증으로 유지하고, UI와 세션 문제는 실제 Chrome 확인을 우선한다.
- 회의 전사/화자분리처럼 경계가 많은 기능은 구현 전용 문서보다 `session -> workspace auth -> meeting/job/artifact snapshot` fixture와 읽기 권한 계약을 먼저 고정한다.
- 배포 산출물 디렉터리는 읽기 참고만 하고, 수정 기준은 항상 정본 소스 디렉터리로 제한한다.
