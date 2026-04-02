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
- 특징: 팝업은 설정만 맡고, 실제 `새 회의하기`와 결과 열기는 content 패널의 회의 허브에서 처리한다.

### Hosted Meeting App

- 위치: `hosting/meeting/index.html`, `hosting/meeting/index.js`
- 역할: launch token 교환, hosted session 복원, Firebase Auth bootstrap, Firestore 문서 구독, 회의 녹음 시작/종료, 전사 접수, 결과 리스트, 선택한 결과의 발화 구간 상세 렌더링, 화자별 AI 정리, 전체 복사
- 특징: 회의 제어와 상세 보기를 확장 UI에서 분리한 메인 작업실이다. `meetingSessionToken`으로 회의 명령 API를 호출하고, 작업실 상태는 Firebase custom token으로 로그인한 뒤 Firestore `meeting/job/artifact` 문서를 직접 구독한다. 마이크 녹음은 브라우저 표준 `getUserMedia + MediaRecorder` 경로를 사용한다.

### Meeting Extension Page (Legacy)

- 위치: `meeting/index.html`, `meeting/index.js`
- 역할: 이전 확장 내부 회의 페이지 자산을 호환용으로 보관한다.
- 특징: 메인 플로우에서는 더 이상 직접 열지 않는다.

### Content Script

- 위치: `content/`, `shared/`, `manifest.json`
- 역할: `inova.incross.com` 안에 실험실 패널을 삽입하고, 질문 탐색/회의록/프롬프트/스토어/릴리스 UI와 회의 허브 진입 흐름을 조립한다.
- 특징: 현재 대화 DOM을 읽고, 로컬 상태를 붙이고, 필요한 클라우드 호출은 background에 메시지로 위임한다. 회의 기능은 브라우저 쪽에서 `meetingHub` 캐시와 `meetingStateByMeetingId` 상태를 붙이고, `content/meeting-manager.js` 허브 refresh, `content/meeting-view.js` 리스트/CTA 렌더링까지 분리해 둔다.

### Background Service Worker

- 위치: `background/service-worker.js`
- 역할: i-Nova access token 확보, Firebase Functions 호출, 릴리스 메타 fetch, 동기화 중복 완화, hosted 회의 launch grant 발급, 작업실 URL 타깃 분기
- 특징: 클라우드 경계의 브로커다. content script가 직접 장기 원격 상태를 다루지 않게 막아 준다. 회의 기능은 `inova-meeting:*` 메시지로 이 경계를 먼저 통과하고, 패널에서 열린 작업실은 popup 설정의 호스팅 타깃을 따라간다.

### Offscreen Document (Legacy)

- 위치: `offscreen/meeting-recorder.html`, `offscreen/meeting-recorder.js`
- 역할: 이전 확장 내부 캡처 경로 호환 자산이다.
- 특징: 현재 메인 hosted 회의 플로우에서는 사용하지 않는다.

### Firebase Functions

- 위치: `functions/index.js`, `functions/prompt-review-service.js`, `functions/store-service.js`, `functions/meeting-service.js`, `functions/meeting-launch-service.js`
- 역할: i-Nova 사용자 검증 뒤 prompt review, prompt store, prompt library sync API와 회의 기능 gateway endpoint를 제공한다.
- 특징: 현재 원격 백업과 공개 스토어의 진입점이며, 회의 기능은 launch grant 발급, hosted session 교환, 임시 source audio 업로드, OpenAI diarization 호출, `integration_inova_meeting_*` Firestore 기록, source cleanup까지 Functions 안에서 처리한다.

### Firestore / Hosting

- 위치: `firebase.json`, `firestore.rules`, `hosting/`
- 역할: Firestore는 백업/스토어 메타 저장소, Hosting은 릴리스 JSON/ZIP 배포면
- 특징: Firestore 규칙은 기본 `deny all`을 유지하되, hosted 회의 작업실이 세션 범위의 Firebase custom token으로 `integration_inova_meetings`, `integration_inova_meeting_jobs`, `integration_inova_meeting_artifacts` 문서를 읽기 전용으로 구독할 수 있는 예외만 연다.

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

### E. 회의 작업실 진입

1. popup은 `settings.meetingWorkspaceTarget`을 저장하고, content 패널은 `새 회의하기` 또는 결과 리스트 항목에서 `inova-meeting:open-workspace` / `inova-meeting:open-result`를 background로 보낸다.
2. background가 i-Nova access token으로 `issueInovaMeetingLaunch`를 호출해 launch grant를 만든다.
3. background가 이어서 `exchangeInovaMeetingLaunch`를 호출해 `meetingSessionToken`을 받은 뒤, popup 설정의 호스팅 타깃에 맞는 최종 작업실 URL을 만든다.
4. background가 `chrome.tabs.create()`로 최종 hosted `meeting/index.html?meetingId=...#ws=...` URL 또는 로컬 `http://127.0.0.1:5000/meeting/index.html?...#ws=...` URL을 연다.
5. hosted 회의 작업실은 URL hash 또는 storage에 있는 `meetingSessionToken`으로 부팅하고, `issueInovaMeetingWorkspaceAuth`로 Firebase custom token을 받아 Firebase Auth에 로그인한다.
6. hosted 회의 작업실은 `meeting` 문서 구독을 붙이고, 선택된 기록에 따라 `job`, `artifact` 문서를 추가 구독한다. hash 없는 clean URL만 직접 열면 hosted 세션이 없으므로 접근을 막고 패널에서 다시 열도록 안내한다.

### F. hosted 회의 녹음 시작/종료

1. hosted 회의 작업실에서 사용자가 직접 `녹음 시작`을 누른다.
2. 브라우저가 처음 한 번 마이크 권한을 확인하면, 사용자는 권한을 허용한다.
3. hosted 회의 작업실이 `getUserMedia`와 `MediaRecorder`로 마이크 오디오를 녹음한다.
4. 녹음이 끝나면 원본 blob과 캡처 메타를 같은 탭 메모리에 유지하고, 같은 회의의 새 런 생성 준비 상태로 둔다.

### G. hosted 회의 전사 접수

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
- `npm run verify:docs`

### 운영/런타임 점검

- `npm run check:cloud-sync -- --userKey <providerUserKey>`
- `npm run check:function-logs -- --since 10`
- 실제 브라우저 확인: `docs/e2e-browser-workflow.md`
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
