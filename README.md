# i-Nova 더하기

`i-Nova 더하기`는 `inova.incross.com` 대화 화면에 편의 기능을 덧붙이는 크롬 확장프로그램입니다. 현재 MVP는 `실험실 패널` 구조로, 현재 대화의 `질문 모아보기`, 사용자가 직접 저장하는 `자주 쓰는 요청`, 여러 사용자가 공유하는 `프롬프트 스토어`, 그리고 수동 배포용 `릴리스 안내`를 한 패널 안에서 바로 씁니다.

## 핵심 기능

- `팝업 On/Off`
  - 확장프로그램 팝업에서 `i-Nova에서 사용`을 켜고 끌 수 있습니다.
  - 현재 대화만 따로 `일시 중지`할 수도 있습니다.
- `질문 자동 모으기`
  - 현재 대화에 보이는 사용자 질문을 자동으로 모아 보여줍니다.
  - 질문 목록은 현재 대화 화면을 기준으로 실시간으로 갱신됩니다.
- `우측 슬라이드 패널`
  - 채팅 화면 오른쪽에 붙는 `실험실 패널`을 제공합니다.
  - 왼쪽의 세로 도구 레일에서 `질문`, `요청`, `스토어`, `릴리스`를 바로 전환할 수 있습니다.
  - 기본은 닫힌 상태이며, 켜져 있을 때만 핸들과 패널이 보입니다.
  - 사용자가 마지막으로 열어 둔 상태를 같은 탭에서 기억합니다.
  - 닫힌 상태의 `실험실` 핸들은 위아래로 옮길 수 있고, 위치는 사이트 기준으로 기억합니다.
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
  - 최신 릴리스에는 버전 단계(`패치/마이너/메이저`), 핵심 제목, 변경 요약, 주요 변경 항목이 함께 표시됩니다.
  - 새 버전이 있으면 ZIP 다운로드 링크와 수동 업데이트 방법을 함께 안내합니다.
  - 이전 버전도 버전별 변경 요약과 함께 ZIP 링크로 롤백할 수 있습니다.
  - 이 확장은 `i-Nova 상용 기능 적용 전 실험 기능을 빠르게 검증하기 위한 도구`이며, 제작/운영은 `AI비즈솔루션팀`입니다.

- `클라우드 백업 기반`
  - 프롬프트 보관함 변경은 `cloudSync` 메타와 함께 로컬에 큐잉됩니다.
  - 원격 백업 호출은 페이지 스크립트가 아니라 확장프로그램 백그라운드 서비스워커가 맡습니다.
  - i-Nova access token은 현재 사용자 검증에만 쓰고, 저장 키는 `providerUserKey` 기준으로 유지합니다.

## 모듈 구조

- `background/`
  - `service-worker.js`: 외부 네트워크 호출과 클라우드 백업 중계
- `shared/`
  - `constants.js`: 저장 키, 셀렉터, 제한값 계약
  - `cloud-api.js`: Firebase Functions 호출 래퍼
  - `cloud-sync.js`: 동기화 상태/문서 정규화
  - `firebase-config.js`: Firebase 프로젝트와 함수 엔드포인트 설정
  - `inova-auth.js`: i-Nova access token 갱신 보조
  - `prompt-library.js`: 요청 보관함 정규화, 가져오기/내보내기 규칙
  - `prompt-store.js`: 스토어 카테고리, 엔트리 정규화, 정렬 규칙
  - `provider-identity.js`: 현재 i-Nova 사용자 식별 정보 정규화
  - `session.js`: `sid`, 질문 정규화, 메시지 ID 생성
  - `storage.js`: `settings`, `pausedSessions`, `uiPreferences`, `promptLibrary`, `cloudSync` 읽기/쓰기
- `popup/`
  - 팝업 설정 UI와 현재 대화 상태 표시
- `content/`
  - `dom.js`: 질문 DOM 수집
  - `bookmark-view.js`: 질문 탭 렌더링과 포커스 이동
  - `composer-review-float.js`: 입력창 우측 상단 평가 버튼과 팝오버 렌더링
  - `cloud-sync-manager.js`: 프롬프트 보관함 원격 백업 흐름 조정
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

## 동작 방식

- 확장프로그램은 `manifest V3`로 구성되어 있습니다.
- `popup/index.js`는 `settings.enabled`, `settings.autoBookmark`, `pausedSessions`를 저장하고 읽습니다.
- `content/main.js`는 현재 URL의 `sid`를 기준으로 대화를 나누고, `.chat-message--user`를 실시간으로 수집합니다.
- `content/prompt-manager.js`는 `promptLibrary`를 관리하고, 선택한 요청을 현재 대화 입력창에 주입합니다.
- `content/prompt-review-manager.js`는 현재 입력창 프롬프트를 평가하고 보완 프롬프트를 다시 주입합니다.
- `content/store-manager.js`는 `프롬프트 스토어` 목록 조회, 등록, 삭제, 좋아요, 가져오기 흐름을 관리합니다.
- `background/service-worker.js`는 i-Nova access token과 Firebase Functions를 연결해 원격 백업 호출을 처리합니다.
- 질문 목록 자체는 `chrome.storage.local`에 저장하지 않고, 현재 대화 화면을 기준으로 바로 렌더링합니다.
- 요청 보관함은 `chrome.storage.local.promptLibrary`에 저장합니다.
- 원격 백업 대기 상태는 `chrome.storage.local.cloudSync`에 저장합니다.

## 설치 방법

1. Chrome에서 `확장 프로그램` 페이지를 엽니다.
2. `압축해제된 확장 프로그램 로드`를 선택합니다.
3. 이 폴더를 선택합니다.
4. `i-Nova`에 접속한 뒤 팝업에서 기능을 켭니다.

## 사용 방법

1. 툴바 확장 아이콘을 눌러 `i-Nova에서 사용`과 `질문 자동 모으기` 상태를 확인합니다.
2. 필요하면 `이 대화에서 일시 중지`를 켭니다.
3. i-Nova 채팅에서 질문을 보내면 `질문` 도구에 자동으로 반영됩니다.
4. 오른쪽 슬라이드 패널의 세로 레일에서 `질문`, `요청`, `스토어`, `릴리스`를 전환합니다.
5. `질문` 도구에서는 검색하거나 항목을 클릭해 해당 질문으로 이동합니다.
6. `요청` 도구에서는 자주 쓰는 요청을 추가하거나 선택해 현재 입력창에 바로 넣습니다.
7. 대화 입력창 우측 상단의 평가 버튼으로 현재 프롬프트를 참고용으로 평가하고, 필요하면 보완 프롬프트를 다시 반영합니다.
8. `스토어` 도구에서는 공유 프롬프트를 찾아 좋아요를 누르거나 내 요청으로 가져옵니다.
9. `릴리스` 도구에서는 현재 버전, 최신 버전, 업데이트 ZIP, 이전 버전 롤백 링크를 확인합니다.
10. 필요하면 요청 묶음을 JSON으로 내보내거나, 다른 사용자의 요청 묶음을 가져옵니다.

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

같은 시점에 feature 변경인데 버전 상승, `releases/release-notes.json`, 현재 버전용 릴리스 메타가 빠져 있어도 `pre-push`에서 함께 막습니다.

같은 가드를 더 이른 시점에 잡기 위해 `pre-commit`도 같이 적용합니다. 커밋 전에 `main` 직접 commit, staged 기준 `README`, `릴리스 메타` 누락을 먼저 막습니다.

훅을 이 저장소에 연결하려면 한 번만 다음을 실행합니다.

```bash
npm run hooks:install
```

`npm install`을 실행해도 `prepare` 스크립트로 훅 연결을 자동 시도합니다.

이후 `background/`, `content/`, `functions/`, `popup/`, `shared/`, `manifest.json` 같은 기능 관련 파일이 바뀌면 `README.md`도 함께 수정해야 commit/push가 통과합니다.

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
- 원격에서는 [`.github/workflows/repo-guardrails.yml`](/C:/Users/parkyoungtack/Documents/code/inova_extension/.github/workflows/repo-guardrails.yml)이 `verify`, README 가드, 릴리스 메타 가드, `release:build`를 다시 검사합니다.
- PR 화면에는 [`.github/pull_request_template.md`](/C:/Users/parkyoungtack/Documents/code/inova_extension/.github/pull_request_template.md) 체크리스트가 자동으로 들어갑니다.
- GitHub branch protection에서는 `main` direct push 금지와 `Repo Guardrails / verify` 체크 통과를 필수로 두고, 사람 승인 수는 0으로 두는 것을 기본값으로 권장합니다.

## 버전 운영 규칙

- `patch`: 버그 수정, 작은 UX/신뢰성 보강, 운영/배포 보완
- `minor`: 새 사용자 기능, 새 워크플로, 눈에 띄는 기능 확장
- `major`: 기존 사용 흐름을 깨거나 마이그레이션/재설치 판단이 필요한 변화
- `npm run version:bump -- <patch|minor|major>`를 실행하면 `package.json`, `manifest.json`, `releases/release-notes.json` 초안이 같이 갱신됩니다.
- 새 버전 초안이 생기면 `releases/release-notes.json`에서 `headline`, `summary`, `changes`를 실제 내용으로 채워야 push와 배포가 통과합니다.
- `release:build`는 현재 버전의 릴리스 메타를 읽어 `hosting/extension/releases/latest.json`과 `history.json`에 그대로 반영합니다.

실제 브라우저 동기화 점검은 다음 문서를 봅니다.

- [docs/e2e-browser-workflow.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/e2e-browser-workflow.md)
- [docs/release-workflow.md](C:/Users/parkyoungtack/Documents/code/inova_extension/docs/release-workflow.md)
