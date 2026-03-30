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
- 역할: 확장 On/Off, 현재 탭 상태 표시, 세션 단위 일시 중지, `meetingState` 상태 카드 표시, 전용 회의 페이지 진입
- 특징: 짧은 상태 확인과 토글만 맡고, 실제 회의 제어는 맡지 않는다. 회의 기능에서는 현재 상태를 요약해 보여주고 `meeting/index.html`로 보내는 게이트웨이만 담당한다.

### Meeting Extension Page

- 위치: `meeting/index.html`, `meeting/index.js`
- 역할: 현재 대화 기준 탭 오디오 녹음 시작/종료, 전사 접수, 결과 리스트, 선택한 결과의 transcript/segment 상세 렌더링
- 특징: 회의 제어와 상세 보기를 팝업/패널에서 분리해 새 탭 페이지에 모아 둔다. `meetingStateBySession`을 정본으로 읽고, 필요한 원격 조회는 background에 다시 위임한다.

### Content Script

- 위치: `content/`, `shared/`, `manifest.json`
- 역할: `inova.incross.com` 안에 실험실 패널을 삽입하고, 질문 탐색/회의록/프롬프트/스토어/릴리스 UI와 회의 job polling 흐름을 조립한다.
- 특징: 현재 대화 DOM을 읽고, 로컬 상태를 붙이고, 필요한 클라우드 호출은 background에 메시지로 위임한다. 회의 기능은 브라우저 쪽에서 `meetingStateBySession` 저장, `meetingBridge` 호출, `content/meeting-manager.js` polling 루프, `content/meeting-view.js` 게이트웨이/결과 리스트 렌더링까지 분리해 둔다.

### Background Service Worker

- 위치: `background/service-worker.js`
- 역할: i-Nova access token 확보, Firebase Functions 호출, 릴리스 메타 fetch, 동기화 중복 완화, 탭 오디오 캡처 stream id 발급
- 특징: 클라우드 경계의 브로커다. content script가 직접 장기 원격 상태를 다루지 않게 막아 준다. 회의 기능은 `inova-meeting:*` 메시지로 이 경계를 먼저 통과하고, 녹음 시작/종료는 offscreen document를 생성해 넘긴다.

### Offscreen Document

- 위치: `offscreen/meeting-recorder.html`, `offscreen/meeting-recorder.js`
- 역할: service worker가 넘긴 `streamId`로 탭 오디오 `MediaRecorder`를 부팅하고, 종료 시 캡처 메타를 브라우저 상태로 되돌린다. 전사 직전에는 메모리에 붙잡아 둔 source audio를 inline payload로 바꿔 gateway 요청에 실어 준다.
- 특징: 실제 오디오 캡처는 popup이나 content script가 아니라 이 격리된 문서에서만 맡는다. 실패 시에는 `inova-meeting:recorder-failed` 메시지로 service worker에 되돌린다.

### Firebase Functions

- 위치: `functions/index.js`, `functions/prompt-review-service.js`, `functions/store-service.js`, `functions/meeting-service.js`
- 역할: i-Nova 사용자 검증 뒤 prompt review, prompt store, prompt library sync API와 회의 기능 gateway endpoint를 제공한다.
- 특징: 현재 원격 백업과 공개 스토어의 진입점이며, 회의 기능은 임시 source audio 업로드, OpenAI diarization 호출, `integration_inova_meeting_*` Firestore 기록, source cleanup까지 Functions 안에서 한 번에 처리하는 MVP 경로를 포함한다.

### Firestore / Hosting

- 위치: `firebase.json`, `firestore.rules`, `hosting/`
- 역할: Firestore는 백업/스토어 메타 저장소, Hosting은 릴리스 JSON/ZIP 배포면
- 특징: 현재 Firestore 규칙은 기본 `deny all`이며, 실제 접근은 Functions를 경유하는 흐름이 중심이다.

## 3. 주요 데이터 흐름

### A. 질문 탐색

1. content script가 대화 DOM에서 사용자 질문을 수집한다.
2. 세션 키는 URL의 `sid`로 정규화한다.
3. 패널에서 검색/이동은 현재 페이지 DOM을 기준으로 처리한다.

### B. 로컬 프롬프트 보관함

1. 사용자가 패널에서 프롬프트를 추가/수정/삭제한다.
2. `shared/storage.js`가 `chrome.storage.local`에 저장한다.
3. 같은 시점에 `cloudSync` 메타를 큐잉한다.

### C. 원격 백업

1. content script가 sync 상태를 만들고 background에 메시지를 보낸다.
2. background가 access token을 준비한다.
3. Functions가 i-Nova 사용자 검증 뒤 Firestore에 반영한다.
4. 확인용 운영 점검은 `scripts/check-cloud-sync.js`, `scripts/check-function-logs.js`로 한다.

### D. 프롬프트 스토어 / 평가 / 릴리스

1. content script가 사용자의 액션을 수집한다.
2. background가 Functions 또는 Hosting으로 요청을 보낸다.
3. 응답은 다시 content script 상태에 머지된다.

### E. 회의 페이지 진입

1. popup은 현재 탭과 세션 정보를 기준으로 `inova-meeting:open-workspace`만 background로 보내고, content 패널은 같은 세션의 결과 리스트 항목에서 `inova-meeting:open-result`까지 함께 보낸다.
2. background가 `chrome.tabs.create()`로 `meeting/index.html` 새 탭 URL을 만든다.
3. 회의 페이지는 query로 받은 `sessionId`, `tabId`, `jobId`, `artifactId`를 기준으로 상태를 부팅한다.

### F. 회의 캡처 시작/종료

1. meeting page가 현재 탭과 세션 정보를 기준으로 `inova-meeting:start-capture`, `inova-meeting:stop-capture`를 보낸다.
2. background가 `chrome.tabCapture.getMediaStreamId()`와 offscreen document 생명주기를 관리한다.
3. offscreen document가 `getUserMedia`와 `MediaRecorder`로 탭 오디오를 캡처한다.
4. 결과 메타는 `meetingStateBySession`에 저장되고, 임시 source audio는 offscreen 문서에 유지된다.
5. 전사 접수에 성공하면 offscreen 문서는 inline payload를 service worker 경계로 보내고 닫힌다.

### G. 회의 페이지 전사 접수

1. meeting page가 `meetingStateBySession`의 captured source 메타와 `cloudSync.providerIdentity`를 읽는다.
2. meeting page가 `inova-meeting:create-job`을 background로 보낸다.
3. background는 offscreen 문서가 살아 있으면 inline source payload를 합쳐 Functions gateway로 전달하고, 없으면 일반 gateway 요청으로 폴백한다.
4. Functions는 임시 source object 업로드, OpenAI diarization, transcript artifact 저장, source cleanup을 수행한다.
5. 응답 job snapshot은 다시 `meetingStateBySession`에 저장되고, 이후 polling은 content의 `meeting-manager`와 meeting page가 함께 이어받는다.
6. content 패널의 `회의` 도구는 같은 세션의 게이트웨이와 결과 리스트만 보여 주고, 상세 transcript는 meeting page가 렌더링한다.

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
- offscreen recorder 생성/정리
- tab capture stream id 발급

### Functions가 맡아야 하는 일

- provider identity 검증
- 공개 스토어 읽기/쓰기
- 원격 백업 읽기/쓰기
- 서버 기준 감사 로그와 오류 응답 형식

## 5. 현재 검증 표면

### 정적/구조 검증

- `npm run verify:contracts`
- `npm run verify:docs`

### 하네스 검증

- `npm run verify:harness`
- `npm run verify:smoke`
- `npm run verify:popup`
- `npm run verify:meeting-contract`
- `npm run verify:meeting-manager`
- `npm run verify:meeting-page`
- `npm run verify:meeting-service`
- `npm run verify:meeting-state`
- `npm run verify:cloud`
- `npm run verify:service-worker`
- `npm run verify:offscreen`
- `npm run verify:harness-page`
- `npm run harness:serve`
- `npm run harness:serve:cloud`

### 운영/런타임 점검

- `npm run check:cloud-sync -- --userKey <providerUserKey>`
- `npm run check:function-logs -- --since 10`
- 실제 브라우저 확인: `docs/e2e-browser-workflow.md`
- 로컬 브라우저 하네스: `http://127.0.0.1:4173/fixtures/content-harness.html?sid=fixture-session`
- 로컬 팝업 하네스: `http://127.0.0.1:4173/fixtures/popup-harness.html`
- 로컬 클라우드 하네스: `http://127.0.0.1:4174`
- 오프스크린 레코더 하네스: `npm run verify:offscreen`
- 회의 전사 기반 계약: `docs/meeting-diarization-foundation.md`, `fixtures/meeting-diarization/`

## 6. 하네스 관점의 현재 한계

- 핵심 UI 흐름은 여전히 실사이트 의존성이 남아 있지만, 로컬 팝업 하네스와 로컬 브라우저 하네스로 popup/content-script 부팅과 주요 토글 상태 전이까지는 먼저 확인할 수 있다.
- 현재 smoke path는 DOM 수집 계층, popup 상태 전이, 회의 기능용 session/job/artifact 계약, 브라우저 meetingState 상태 전이, 전용 meeting page 상태 전이, Functions diarization/snapshot 정규화, content 패널 회의 리스트 렌더링, 로컬 클라우드 계약 검증, background service worker 라우팅 검증, 오프스크린 레코더 하네스, 로컬 브라우저 하네스까지 포함한다.
- Firebase emulator는 아직 없지만, fake backend 서버로 Cloud Functions payload 계약과 Hosting release JSON을 로컬에서 재현할 수 있다.
- 장기적으로는 content/background/functions 경계를 각각 재현할 수 있는 fixture와 smoke path를 늘려야 한다.

## 7. 다음 확장 원칙

- 새 기능은 먼저 어떤 실행 경계에 들어가는지 이 문서 기준으로 결정한다.
- 실사이트나 실클라우드가 없어도 검증 가능한 최소 fixture를 가능하면 먼저 만든다.
- 기능별 smoke path는 작은 단위로 추가하고 `npm run verify`에 연결한다.
- 회의 전사/화자분리처럼 경계가 많은 기능은 구현 전용 문서보다 `session -> job -> artifact` fixture와 polling contract를 먼저 고정한다.
- 배포 산출물 디렉터리는 읽기 참고만 하고, 수정 기준은 항상 정본 소스 디렉터리로 제한한다.
