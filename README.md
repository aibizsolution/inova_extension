# i-Nova 더하기

`i-Nova 더하기`는 `inova.incross.com` 대화 화면에 편의 기능을 덧붙이는 크롬 확장프로그램입니다. 현재 MVP는 `실험실 패널 + hosted 회의 작업실` 구조로, 현재 대화의 `질문 모아보기`, DB 기반 `회의 허브`, 사용자가 직접 저장하는 `자주 쓰는 요청`, 여러 사용자가 공유하는 `프롬프트 스토어`, 그리고 수동 배포용 `릴리스 안내`를 한 패널 안에서 바로 씁니다.

## 핵심 기능

- `팝업 작업실 연결 설정`
  - 확장프로그램 팝업에서는 회의 작업실이 `상용 호스팅`과 `로컬 호스팅` 중 어디를 바라볼지 선택합니다.
  - 팝업은 설정만 담당하고, 실제 `새 회의하기`와 결과 확인은 패널에서 이어집니다.
  - 선택한 값은 `settings.meetingWorkspaceTarget`에 저장되어 패널의 회의 진입에도 그대로 적용됩니다.
- `질문 자동 모으기`
  - 현재 대화에 보이는 사용자 질문을 자동으로 모아 보여줍니다.
  - 질문 목록은 현재 대화 화면을 기준으로 실시간으로 갱신됩니다.
- `우측 슬라이드 패널`
  - 채팅 화면 오른쪽에 붙는 `실험실 패널`을 제공합니다.
  - 왼쪽의 세로 도구 레일에서 `대화`, `회의`, `프롬프트`, `릴리스`를 바로 전환할 수 있습니다.
  - 기본은 닫힌 상태이며, 켜져 있을 때만 핸들과 패널이 보입니다.
  - 사용자가 마지막으로 열어 둔 상태를 같은 탭에서 기억합니다.
  - 닫힌 상태의 `실험실` 핸들은 위아래로 옮길 수 있고, 위치는 사이트 기준으로 기억합니다.
- `회의록 패널`
  - `회의` 도구는 DB에서 읽어 온 최신 회의록 목록과 `새 회의하기` CTA만 제공합니다.
  - 패널 목록의 항목을 누르면 해당 회의 결과를 전용 새 탭 작업실에서 다시 확인합니다.
- `회의 페이지`
  - Firebase Hosting에 올린 전용 회의 작업실에서 `회의 식별`, `현재 녹음`, `회의 공용 메모`, `처리 이력/업로드 큐`, `선택 결과 검토`를 한 화면에서 처리합니다.
  - 팝업에서 `로컬 호스팅`을 고르면 패널의 `새 회의하기`가 `http://127.0.0.1:5000/meeting/index.html` 기준으로 열리고, 화면 안의 디버그 로그 패널에서 세션 복원, Functions 요청, Firestore auth/listener 로그를 바로 확인할 수 있습니다. 필요하면 로그 패널 본문을 접어 두고 작업을 이어갈 수 있습니다.
  - 로컬 작업실에서는 `파일 불러오기`로 실제 오디오 샘플을 바로 전사 테스트할 수 있고, `25MB 초과` 또는 `약 20분 초과` 원본도 브라우저에서 `16kHz mono wav chunk`로 나눈 뒤 한 기록 결과로 이어 처리합니다.
  - hosted 회의 작업실은 기본적으로 `최대 200MB 또는 2시간` 원본까지 지원하고, 큰 오디오나 긴 녹음은 `약 9분 / 1.5초 overlap` 기준 chunk 업로드 후 서버에서 단일 회의 결과로 병합합니다.
  - 녹음은 `녹음 시작 -> 일시중지/재개 -> 종료하고 전사` 흐름으로 동작하고, 종료된 녹음본은 원격 처리 완료 전까지 브라우저 로컬 큐에 보관합니다.
  - 한 기록은 기본 `90분`까지 이어지고, 제한 시간에 도달하면 현재 기록을 자동 전사로 넘긴 뒤 다음 개별 기록 녹음을 바로 이어갑니다.
- 전사가 끝나면 회의록 형식의 자동 정리본과 `발화 구간`, `화자별` AI 정리 화면을 같은 상세 화면에서 함께 보여주고, 회의의 내용 구조는 AI가 자동 판단합니다.
- 사용자는 회의 정리 탭에서 `기본 회의록`, `간결 브리프`, `실행 중심` 같은 `표현 방식`만 골라 다시 정리할 수 있습니다.
- 회의 정리의 `열린 쟁점`, `후속 질문`, `의존성`처럼 배열로 내려오는 항목은 객체형 응답이 섞여도 읽을 수 있는 문장으로 정규화해 표시합니다.
- `상태` 탭에서는 현재 기록을 `기록 선택 -> 발화 구간 -> 회의 정리 -> 화자 이름 -> 화자별 정리 -> 검토 마무리` 순서의 단계 흐름으로 보여주고, 완료 단계는 조용하게 처리한 채 현재 확인이 필요한 단계만 더 또렷하게 보여줍니다.
  - 회의 정리가 완료되면 AI가 만든 `meetingMeta.title`을 해당 기록 제목으로 바로 반영하고, 이후 다시 정리해도 최신 AI 제목으로 덮어씁니다.
- 발화 구간 탭에서는 자동 화자 라벨을 실제 이름/역할로 바꿔 저장할 수 있고, 시간대가 포함된 전체 전사를 바로 복사하거나 저장한 화자명으로 회의 정리를 다시 생성할 수 있습니다. `화자별` 탭에서는 각 화자가 주로 말한 내용을 AI가 화자 기준으로 따로 정리해 보여줍니다.
  - 회의는 현재 대화 세션과 분리된 `meetingId` 기준으로 관리하고, 같은 회의의 처리 이력만 페이지 안에 남깁니다.
- 좌측 `기록 큐` 카드는 긴 본문 미리보기보다 `AI 판단`, `표현 방식`, `화자 수` 같은 칩 중심으로 보여줘서 어떤 기록을 다시 열어야 하는지 빠르게 구분할 수 있게 유지합니다.
- 작업실에서는 작업실 이름과 공용 메모를 저장할 수 있고, 우측 `기록 검토` 패널에서 개별 기록 이름 수정과 삭제를 함께 처리합니다. 삭제를 실행하면 연결된 job/artifact와 남아 있는 임시 source object까지 함께 정리합니다.
  - 패널에서 회의를 열면 확장이 짧은 수명의 launch grant를 즉시 hosted workspace session으로 교환한 뒤, `#ws`가 붙은 최종 hosted 작업실 URL을 새 탭으로 엽니다.
  - 작업실에서는 사용자가 직접 `녹음 시작`을 눌러 웹앱에서 바로 마이크 녹음을 시작하고, 표준 `getUserMedia + MediaRecorder` 경로로 녹음합니다.
  - 녹음을 마치면 `종료하고 전사`가 즉시 로컬 저장과 업로드 큐 등록을 끝내고, 원격 처리 중이어도 바로 다음 녹음을 시작할 수 있습니다.
  - 오프라인이거나 업로드가 실패하면 같은 녹음본은 로컬 큐에 남아 있다가 온라인 복귀 시 자동 재시도하고, 필요하면 `지금 업로드`, `보류`, `삭제`를 직접 고를 수 있습니다.
  - 원격 처리 중 상태 갱신은 작업실이 `MeetingSession -> issueInovaMeetingWorkspaceAuth -> Firebase Auth`를 거친 뒤 Firestore `meeting/job/artifact` 문서를 직접 구독해 반영합니다. Functions는 업로드/삭제/재정리 같은 명령만 맡고, 탭 복귀 시에는 끊긴 listener만 다시 연결합니다.
  - 패널에서 한 번 연 작업실은 clean URL 뒤의 workspace hash 토큰으로 같은 탭/브라우저에서 다시 이어지고, hash 없이 `?meetingId=`만 직접 열면 접근을 막고 패널에서 다시 열도록 안내합니다.
- `대화 안에서 찾기`
  - 지금 보고 있는 대화 안에서만 질문을 검색합니다.
  - 결과를 클릭하면 해당 질문 위치로 이동하고, 좁은 화면에서는 패널을 잠시 접어 원문을 보기 쉽게 합니다.
- `자주 쓰는 요청 보관함`
  - 사용자가 직접 요청을 추가, 수정, 삭제할 수 있습니다.
  - 요청을 선택하면 현재 대화 입력창에 바로 주입할 수 있습니다.
  - 입력창에 내용이 이미 있으면 `덮어쓰기` 또는 `이어붙이기`를 고를 수 있습니다.
  - 대화 입력창 우측 상단의 평가 버튼으로 현재 프롬프트를 바로 점검할 수 있습니다.
  - 평가 결과에서는 점수보다 먼저 `감점 이유/보완이 필요한 항목`을 우선 보여줍니다.
  - 평가는 외부 AI 모델을 사용한 참고 의견으로 안내합니다.
  - 평가 결과에서 보완 프롬프트를 확인하고 다시 반영할 수 있습니다.
  - 보완 프롬프트에 `[대상 독자]` 같은 자리표시자가 남아 있으면 한 번 더 확인한 뒤 반영해야 합니다.
  - 평가 뒤 입력창 내용이 바뀌면 이전 보완안은 바로 반영되지 않고, 다시 평가를 요구합니다.
- `요청 가져오기/내보내기`
  - 자주 쓰는 요청 보관함을 JSON으로 내보낼 수 있습니다.
  - 다른 사용자의 요청 묶음을 가져올 때 `추가`, `병합`, `완전 교체` 중 하나를 선택할 수 있습니다.
- `프롬프트 스토어`
  - 사용자는 본인 요청을 카테고리를 골라 스토어에 등록하거나 삭제할 수 있습니다.
  - 다른 사용자가 등록한 요청을 찾아 `내 요청으로 가져오기` 할 수 있습니다.
  - `전체`와 `내 등록` 범위를 전환해 내가 올린 항목만 따로 볼 수 있습니다.
  - 각 항목에는 등록자, 조회수, 가져오기 수, 좋아요 수가 함께 표시됩니다.
  - `좋아요`와 `가져오기` 같은 사용자 반응을 통해 어떤 요청이 인기 있는지 볼 수 있습니다.
- `릴리스 안내`
  - 패널 안에서 현재 설치 버전과 최신 배포본 여부를 확인할 수 있습니다.
  - 최신 릴리스와 이전 버전은 핵심 제목과 짧은 요약만 먼저 보여주고, 자세한 변경 내역은 `변경 내용 보기`에서 펼쳐 확인합니다.
  - 릴리스 패널에는 사용자가 체감하는 변경만 보여주고, 내부 운영 변경은 별도 릴리스 메타 기록으로만 관리합니다.
  - 새 버전이 있으면 ZIP 다운로드 링크와 수동 업데이트 방법을 함께 안내합니다.
  - 설치와 업데이트 절차도 접힌 안내로 제공해 필요할 때만 펼쳐 볼 수 있습니다.
  - 최신 버전은 고정 링크 `https://browser-extension-main.web.app/extension/downloads/latest.zip` 로도 항상 받을 수 있습니다.
  - 이전 버전도 버전별 변경 요약과 함께 ZIP 링크로 롤백할 수 있습니다.
  - 이 확장은 `i-Nova 상용 기능 적용 전 실험 기능을 빠르게 검증하기 위한 도구`이며, 제작/운영은 `AI비즈솔루션팀`입니다.

- `클라우드 백업 기반`
  - 프롬프트 보관함 변경은 `cloudSync` 메타와 함께 로컬에 큐잉됩니다.
  - 원격 백업 호출은 페이지 스크립트가 아니라 확장프로그램 백그라운드 서비스워커가 맡습니다.
  - i-Nova access token은 현재 사용자 검증에만 쓰고, 저장 키는 `providerUserKey` 기준으로 유지합니다.

## 모듈 구조

- `background/`
  - `service-worker.js`: 외부 네트워크 호출과 클라우드 백업, 회의 허브/launch grant gateway 중계
- `hosting/meeting/`
  - `index.html`, `index.css`: 회의 작업실 레이아웃과 실용형 UI 스타일
  - `index.js`: hosted 회의 작업실 부팅, launch token 교환, 세션 복원, 녹음/업로드 큐/상세 액션 orchestration
  - `firebase-client.js`: `MeetingSession`을 Firebase custom token으로 교환하고 Firestore 문서 구독을 연결하는 hosted helper
  - `shared.js`: 공통 상태/포맷터/네트워크 헬퍼
  - `storage.js`: IndexedDB 기반 로컬 업로드 큐와 fallback storage
  - `notes.js`: 회의록 schema 정규화와 mode별 표시 포맷터
  - `render.js`: 이력/상세/회의록 섹션 렌더링
- `offscreen/`
  - `meeting-recorder.js`: 확장 내부 legacy 캡처 경로 호환용 오디오 recorder
- `shared/`
  - `constants.js`: 저장 키, 셀렉터, 제한값 계약
  - `cloud-api.js`: Firebase Functions 호출 래퍼와 회의 기능 gateway 요청 래퍼
  - `cloud-sync.js`: 동기화 상태/문서 정규화
  - `firebase-config.js`: Firebase 프로젝트와 함수 엔드포인트 설정
  - `inova-auth.js`: i-Nova access token 갱신 보조
  - `meeting-bridge.js`: 브라우저 쪽 회의 runtime message 래퍼
  - `meeting-state.js`: 회의 `meeting/job/transcript` 로컬 상태 정규화와 legacy session fallback
  - `prompt-library.js`: 요청 보관함 정규화, 가져오기/내보내기 규칙
  - `prompt-store.js`: 스토어 카테고리, 엔트리 정규화, 정렬 규칙
  - `provider-identity.js`: 현재 i-Nova 사용자 식별 정보 정규화
  - `session.js`: `sid`, 질문 정규화, 메시지 ID 생성
  - `storage.js`: `settings`, `pausedSessions`, `uiPreferences`, `promptLibrary`, `cloudSync`, `meetingHub`, `meetingState`, `meetingStateByMeetingId` 읽기/쓰기
- `popup/`
  - 팝업 설정 UI와 hosted 회의 작업실 연결 대상 선택
- `meeting/`
  - `index.js`: 확장 내부 legacy 회의 페이지 자산
- `content/`
  - `dom.js`: 질문 DOM 수집
  - `bookmark-view.js`: 질문 탭 렌더링과 포커스 이동
  - `composer-review-float.js`: 입력창 우측 상단 평가 버튼과 팝오버 렌더링
  - `cloud-sync-manager.js`: 프롬프트 보관함 원격 백업 흐름 조정
  - `meeting-manager.js`: 회의 허브 목록 fetch/cache/refresh 조정
  - `meeting-view.js`: 회의 허브 리스트와 `새 회의하기` CTA 렌더링
  - `prompt-review-manager.js`: 현재 입력 프롬프트 평가 호출과 상태 관리
  - `prompt-view.js`: 요청 탭 렌더링
  - `prompt-manager.js`: 요청 CRUD, 가져오기/내보내기, 입력창 주입
  - `store-view.js`: 프롬프트 스토어 탭 렌더링
  - `store-manager.js`: 스토어 목록, 좋아요, 가져오기, 등록/삭제 흐름
  - `route-sync.js`: 대화 전환 감시와 실시간 질문 동기화
  - `panel.js`: 우측 슬라이드 패널 셸과 도구 레일
  - `main.js`: 패널 상태와 각 모듈 조립
- `contracts/`
  - 파일 크기와 필수 경로 계약
- `scripts/`
  - 문서/구조 자동 검증, 버전 상승, 릴리스 메타 가드 스크립트
- `releases/`
  - 버전별 배포 ZIP과 `release-notes.json` 릴리스 카탈로그

## 런타임 구조 문서

- 실제 실행 경계와 데이터 흐름은 [docs/runtime-architecture.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/runtime-architecture.md)를 기준으로 봅니다.
- 에이전트나 사람이 저장소를 처음 읽을 때는 `README.md` 다음으로 위 문서를 먼저 보면 `popup -> hosted meeting -> content -> background -> functions -> Firestore/Hosting` 경계를 빠르게 잡을 수 있습니다.
- `releases/_staging`, `hosting/extension/downloads`, `hosting/extension/releases/latest.json`, `hosting/extension/releases/history.json`은 배포 산출물이며 수정 기준이 아닙니다.

## 동작 방식

- 확장프로그램은 `manifest V3`로 구성되어 있습니다.
- `popup/index.js`는 `settings.meetingWorkspaceTarget`을 읽고, hosted 회의 작업실 연결 대상을 `상용 호스팅 / 로컬 호스팅` 중 하나로 저장합니다.
- `hosting/meeting/index.js`는 `launch` 또는 clean URL의 `meetingId`, `jobId`, workspace hash 토큰을 기준으로 hosted 세션을 부팅하고, `getUserMedia + MediaRecorder`로 마이크 녹음을 처리합니다.
- hosted 회의 작업실은 `공용 메모 저장 -> 녹음 종료와 동시에 로컬 큐 적재 -> 온라인이면 즉시 job 생성 -> 원격 처리와 별개로 다음 녹음 허용` 흐름으로 동작합니다.
- `content/main.js`는 현재 URL의 `sid`를 기준으로 대화를 나누고, `.chat-message--user`를 실시간으로 수집합니다.
- `content/prompt-manager.js`는 `promptLibrary`를 관리하고, 선택한 요청을 현재 대화 입력창에 주입합니다.
- `content/prompt-review-manager.js`는 현재 입력창 프롬프트를 평가하고 보완 프롬프트를 다시 주입합니다.
- `content/store-manager.js`는 `프롬프트 스토어` 목록 조회, 등록, 삭제, 좋아요, 가져오기 흐름을 관리합니다.
- `content/meeting-manager.js`는 owner 기준 최신 회의 목록을 읽어 `meetingHub` 캐시를 갱신하고, 패널/포커스 복귀 시 허브를 새로고칩니다.
- `background/service-worker.js`는 i-Nova access token과 Firebase Functions를 연결해 원격 백업 호출을 처리하고, 회의 기능에서는 launch grant 발급과 session 교환까지 끝낸 최종 hosted 작업실 URL 생성, 허브 조회 라우팅을 맡습니다.
- `functions/meeting-launch-service.js`는 launch grant, hosted workspace session, Firestore 읽기용 Firebase custom token 발급을 맡깁니다.
- `processQueuedInovaMeetingJob` Firestore background worker는 긴 회의 chunk 병합과 회의 정리 단계 때문에 `1GiB` 메모리와 `540초` timeout으로 운영합니다.
- hosted 회의 작업실은 `종료하고 전사` 또는 `파일 불러오기` 시점에 원본을 먼저 업로드 가능한 source로 준비한 뒤 `createInovaMeetingJob`에는 queue 생성만 맡기고, Functions background 처리기는 source download -> OpenAI diarization -> chunk 병합/화자 정합 -> 회의록 모드 분류 -> mode별 회의록 정리 생성 -> source cleanup -> Firestore `meeting/job/artifact` 저장까지 처리합니다.
- 회의 정리와 모드 분류 기본 모델은 `gpt-5.4-mini`를 사용하고, 필요하면 `OPENAI_MEETING_SUMMARY_MODEL` 또는 `OPENAI_SUMMARY_MODEL`로 override할 수 있습니다.
- Functions는 같은 `requestId` 재전송을 idempotent하게 재사용하고, `sharedMemoSnapshot`과 notes mode 메타데이터를 함께 저장합니다.
- Functions가 source audio를 임시 bucket object로 저장할 때는 Firebase 설정의 기본 storage bucket을 우선 쓰고, 기본 bucket이 없는 프로젝트에서는 `STORAGE_BUCKET_URL`로 실제 존재하는 bucket을 명시해야 합니다. 현재 프로젝트는 chunk 업로드용으로 `gcf-v2-uploads-1027279095019.asia-northeast3.cloudfunctions.appspot.com`을 사용합니다.
- 회의 작업실 Firestore 구독용 Firebase custom token은 기본적으로 `1027279095019-compute@developer.gserviceaccount.com`으로 서명하고, 다른 계정을 써야 하면 `FIREBASE_AUTH_SIGNING_SERVICE_ACCOUNT`로 override할 수 있습니다.
- 회의 업로드/전사 결과는 패널의 `회의` 도구에서 허브 리스트로 보이고, 상세는 hosted `meeting/index.html` 새 탭 작업실에서 다시 확인합니다. 상세 상태는 작업실이 `meetingSessionToken`으로 `issueInovaMeetingWorkspaceAuth`를 한 번 호출한 뒤 Firebase Auth에 로그인하고 Firestore `meeting/job/artifact` 문서를 직접 구독해 반영합니다.
- 브라우저 쪽에서는 `shared/meeting-bridge.js` 와 `shared/meeting-state.js` 로 회의 녹음 start/stop, 회의 job 생성, artifact 반영, local `meetingState` 저장 기준을 먼저 맞춰 두었습니다.
- 질문 목록 자체는 `chrome.storage.local`에 저장하지 않고, 현재 대화 화면을 기준으로 바로 렌더링합니다.
- 요청 보관함은 `chrome.storage.local.promptLibrary`에 저장합니다.
- 원격 백업 대기 상태는 `chrome.storage.local.cloudSync`에 저장합니다.
- 회의 기능 브라우저 상태는 `chrome.storage.local.meetingStateByMeetingId`를 정본으로 두고, `meetingStateBySession`은 legacy fallback으로만 함께 유지합니다.

## 설치 방법

1. Chrome에서 `확장 프로그램` 페이지를 엽니다.
2. `압축해제된 확장 프로그램 로드`를 선택합니다.
3. 이 폴더를 선택합니다.
4. `i-Nova`에 접속한 뒤 필요하면 팝업에서 `상용 호스팅 / 로컬 호스팅`을 고릅니다.

## 사용 방법

1. 툴바 확장 아이콘을 눌러 `상용 호스팅` 또는 `로컬 호스팅`을 고릅니다.
2. i-Nova 채팅에서 질문을 보내면 `대화` 도구에 자동으로 반영됩니다.
3. 오른쪽 슬라이드 패널의 세로 레일에서 `대화`, `회의`, `프롬프트`, `릴리스`를 전환합니다.
4. `대화` 도구에서는 검색하거나 항목을 클릭해 해당 질문으로 이동합니다.
5. `회의` 도구에서는 DB 기반 회의 허브 목록과 `새 회의하기` 버튼을 확인하고, 항목을 눌러 hosted 새 탭 작업실 상세 페이지를 엽니다.
6. hosted 회의 작업실에서는 작업실 이름과 공용 메모를 먼저 정리한 뒤 녹음을 시작하고, 필요하면 일시중지/재개하거나 녹음을 버리고 다시 시작할 수 있습니다.
7. 로컬 작업실에서는 `파일 불러오기`로 실제 녹음 파일을 직접 넣어 전사 테스트할 수 있고, 큰 파일이나 긴 녹음은 자동으로 chunk 준비/업로드를 거칩니다.
8. `종료하고 전사`를 누르면 녹음본이 먼저 로컬 큐에 저장되고, 원격 처리 중이어도 바로 다음 녹음을 시작할 수 있습니다.
9. 녹음이 `90분`에 도달하면 현재 기록은 자동으로 전사 큐에 들어가고, 작업실은 다음 개별 기록 녹음을 이어갑니다.
10. 저장된 결과를 선택하면 우측 `기록 검토` 패널에서 이름을 수정하거나 삭제하고, 자동 정리와 발화 구간 기준 전사, 화자별 AI 정리를 함께 확인할 수 있습니다.
11. 필요하면 발화 구간 탭에서 화자명을 저장하고, 시간대 포함 전사를 전체 복사하거나 같은 전사를 기준으로 회의 정리를 다시 생성할 수 있습니다.
12. 회의 정리의 표현만 바꾸고 싶을 때는 회의 정리 탭에서 `표현 방식`을 고른 뒤 `...로 다시 정리` 버튼을 눌러 같은 전사로 회의록을 다시 생성할 수 있습니다. 회의 종류 판단은 계속 AI가 맡습니다.
12. `프롬프트` 도구에서는 자주 쓰는 요청을 추가하거나 선택해 현재 입력창에 바로 넣고, `스토어` 서브탭에서 공유 프롬프트를 찾아 좋아요를 누르거나 내 요청으로 가져옵니다.
13. 대화 입력창 우측 상단의 평가 버튼으로 현재 프롬프트를 참고용으로 평가하고, 필요하면 보완 프롬프트를 다시 반영합니다.
14. `릴리스` 도구에서는 현재 버전, 최신 버전, 업데이트 ZIP, 이전 버전 롤백 링크를 확인합니다.
15. 필요하면 요청 묶음을 JSON으로 내보내거나, 다른 사용자의 요청 묶음을 가져옵니다.

## 비목표

- 전체 대화 통합 검색
- 계정 간 공유
- 태그 편집
- AI 요약
- 자동 전송

## 검증

문서와 코드가 맞는지 확인하려면 다음을 실행합니다.

```bash
npm run verify
```

이 저장소의 기본 개발 루프는 실제 브라우저 확인을 우선합니다.

- 기본 자동 검증: `npm run verify`
- 세부 확인이 필요하면 `npm run verify:contracts`, `npm run verify:docs`
- UI/세션/opener 문제는 실제 Chrome에서 직접 확인

회의 작업실 UI를 배포 없이 실제 브라우저에서 먼저 보고 싶으면 `로컬 Hosting + 상용 Functions` 조합을 씁니다.

```bash
npm run emulator:hosting
```

기본 로컬 주소는 `http://127.0.0.1:5000/meeting/index.html` 입니다. 확장프로그램은 그대로 Chrome에서 실행하고, 팝업에서 `상용 호스팅 / 로컬 호스팅`을 전환해 확인합니다. 로컬 호스팅을 고르면 회의 명령 호출은 그대로 상용 Functions를 사용하고, 화면 안의 디버그 로그 패널에서 세션 복원, Firebase Auth bootstrap, Firestore listener 흐름을 바로 볼 수 있습니다.

로컬에서 자동 분할 녹음을 빨리 시험하고 싶으면 URL에 `recordLimitSeconds`를 붙이면 됩니다.

```text
http://127.0.0.1:5000/meeting/index.html?...&recordLimitSeconds=30#ws=...
```

또는 DevTools 콘솔에서 아래처럼 로컬 기본값을 저장할 수 있습니다.

```js
localStorage.setItem("__INOVA_MEETING_RECORD_LIMIT_SECONDS__", "30");
```

README 가드만 미리 확인하려면 다음을 실행합니다.

```bash
npm run verify:readme-guard
```

릴리스 메타 가드만 미리 확인하려면 다음을 실행합니다.

```bash
npm run verify:release-guard
```

## Git 훅

이 저장소는 기능 관련 파일이 바뀌었는데 `README.md`가 같이 수정되지 않으면 `pre-push`에서 push를 막습니다.

릴리스 준비 파일인 `package.json`, `manifest.json`, `releases/release-notes.json` 중 일부만 바뀌면 `pre-push`에서 함께 막습니다.

같은 가드를 더 이른 시점에 잡기 위해 `pre-commit`도 같이 적용합니다. 커밋 전에 `main` 직접 commit, staged 기준 `README`, `릴리스 준비 파일 불일치`를 먼저 막습니다.

훅을 이 저장소에 연결하려면 한 번만 다음을 실행합니다.

```bash
npm run hooks:install
```

`npm install`을 실행해도 `prepare` 스크립트로 훅 연결을 자동 시도합니다.

이후 `background/`, `content/`, `functions/`, `popup/`, `shared/`, `manifest.json` 같은 기능 관련 파일이 바뀌면 `README.md`도 함께 수정해야 commit/push가 통과합니다.

버전 상승과 `releases/release-notes.json` 갱신은 모든 feature commit마다 필요한 것이 아니라, 실제 배포나 릴리스 준비를 시작할 때만 맞추면 됩니다.

## 브랜치 작업 규칙

- 기본 작업 브랜치는 `codex/<task-name>` 형식을 권장합니다.
- `main`에서는 직접 commit 하지 않고, 작업 브랜치에서 commit 한 뒤 PR로 머지합니다.
- 로컬 훅은 `main` 직접 commit 과 `main` 직접 push 를 모두 막습니다.
- 정말 긴급한 예외만 `INOVA_ALLOW_MAIN_BRANCH=1`로 한 번 우회할 수 있게 두었습니다.
- PR은 필수지만 사람 승인 자체를 요구하지 않는 운영을 기본값으로 둡니다. 권한 있는 사용자는 자동 체크만 통과하면 머지할 수 있습니다.
- GitHub 원격 브랜치는 PR 머지 후 자동 삭제되도록 켜 두었습니다.
- 로컬에서는 `post-checkout`, `post-merge` 훅이 `main` 기준으로 이미 머지된 `codex/*` 브랜치만 자동 정리합니다.
- 로컬 자동 정리를 잠깐 끄고 싶으면 `INOVA_SKIP_BRANCH_CLEANUP=1`을 사용할 수 있습니다.

## 협업 가드레일

- 로컬에서는 `pre-commit`, `pre-push`가 같은 규칙을 단계별로 검사합니다.
- 원격에서는 [`.github/workflows/repo-guardrails.yml`](/C:/Users/parkyoungtack/Documents/code/inova_extension/.github/workflows/repo-guardrails.yml)이 `verify`, README 가드, 릴리스 메타 가드를 다시 검사하고, 릴리스 준비 파일이 바뀐 경우에만 `release:build`를 추가로 확인합니다.
- PR 화면에는 [`.github/pull_request_template.md`](/C:/Users/parkyoungtack/Documents/code/inova_extension/.github/pull_request_template.md) 체크리스트가 자동으로 들어갑니다.
- GitHub branch protection에서는 `main` direct push 금지와 `Repo Guardrails / verify` 체크 통과를 필수로 두고, 사람 승인 수는 0으로 두는 것을 기본값으로 권장합니다.

## 버전 운영 규칙

- `patch`: 버그 수정, 작은 UX/신뢰성 보강, 운영/배포 보완
- `minor`: 새 사용자 기능, 새 워크플로, 눈에 띄는 기능 확장
- `major`: 기존 사용 흐름을 깨거나 마이그레이션/재설치 판단이 필요한 변화
- `npm run version:bump -- <patch|minor|major>`를 실행하면 `package.json`, `manifest.json`, `releases/release-notes.json` 초안이 같이 갱신됩니다. 이 단계는 일반 개발 커밋이 아니라 배포/릴리스 준비 시점에만 실행하는 것을 기본값으로 둡니다.
- 새 버전 초안이 생기면 `releases/release-notes.json`의 `public.headline`, `public.summary`, `public.changes`를 실제 사용자 관점 내용으로 채워야 push와 배포가 통과합니다.
- 내부 운영 메모가 필요하면 `internal.changes`에 따로 적고, 릴리스 패널에는 노출하지 않습니다.
- `release:build`는 현재 버전의 릴리스 메타를 읽어 `hosting/extension/releases/latest.json`과 `history.json`에 그대로 반영합니다.
- `release:build`와 `deploy:hosting`은 마지막 배포 버전보다 더 높은 새 버전이 준비되지 않았으면 실패합니다.
- `release:build`는 고정 최신 링크용 `hosting/extension/downloads/latest.zip`도 함께 갱신합니다.

## 배포 기본값

- 일반적으로 `배포해줘`는 `hosting` 배포를 뜻합니다. 즉 확장 ZIP, `latest.json`, `history.json` 같은 릴리스 파일만 배포합니다.
- `함수 배포해줘` 또는 `backend/functions 배포해줘`라고 명시했을 때만 Firebase Functions를 배포합니다.
- `전체 배포해줘`, `hosting + functions 배포해줘`처럼 분명히 말한 경우에만 둘 다 배포합니다.
- 안전 기본값은 `hosting-only`입니다. 함수는 실수로 함께 배포하지 않는 쪽을 우선합니다.

배포 명령은 다음처럼 나뉩니다.

```bash
npm run deploy:hosting
npm run deploy:functions
npm run deploy:all
```

실제 브라우저 동기화 점검은 다음 문서를 봅니다.

- [docs/runtime-architecture.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/runtime-architecture.md)
- [docs/e2e-browser-workflow.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/e2e-browser-workflow.md)
- [docs/release-workflow.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/release-workflow.md)
