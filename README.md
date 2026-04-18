# i-Nova 더하기

`i-Nova 더하기`는 `inova.incross.com` 대화 화면에 실험실 패널과 hosted 회의 작업실을 더하는 크롬 확장프로그램입니다. 현재 제품 축은 `대화`, `회의`, `프롬프트`, `릴리스`이며, 팝업에서는 회의 작업실 연결 대상과 디버그를 조정합니다.

새 Cloud Function 추가나 endpoint path 변경은 먼저 capability manifest 편집과 Hosting 배포로 처리합니다. 새 Chrome permission, host permission, page primitive, privileged adapter, URL template origin이 필요할 때만 확장 재배포 대상입니다.

## 이 문서의 역할

- `README.md`는 저장소/제품의 상위 개요, 설치/배포, 공통 개발 루프만 다룹니다.
- feature-local 규칙, 계약, 최소 검증 기준은 각 feature `AGENTS.md` 또는 feature 전용 docs에 문서화합니다.
- 새 요청을 받으면 저장소 전체를 읽기 전에 [docs/feature-routing.md](docs/feature-routing.md)부터 확인합니다.

## 문서 맵

- [docs/feature-routing.md](docs/feature-routing.md): primary feature 선택, 시작 파일, 범위 확장 규칙
- [AGENTS.md](AGENTS.md): 전역 작업 규칙, 검증 기본값, 세션 분리 기준
- [docs/feature-spec.md](docs/feature-spec.md): 제품 요구사항과 공통 계약
- [docs/refactoring-plan.md](docs/refactoring-plan.md): version/release decision note, meeting 호환 기준
- [docs/runtime-architecture.md](docs/runtime-architecture.md): popup, panel, background, hosted runtime 경계
- [docs/remote-capability-manifest-plan.md](docs/remote-capability-manifest-plan.md): 무배포 기능 확장을 위한 extension runtime platform 설계
- [docs/capability-authoring.md](docs/capability-authoring.md): 새 capability 추가 절차와 extension 재배포 기준
- [docs/capability-catalog.md](docs/capability-catalog.md): 현재 served capability catalog generated 문서
- [docs/current-handoff.md](docs/current-handoff.md): 다음 세션 시작용 현재 작업 handoff
- [docs/firebase-architecture.md](docs/firebase-architecture.md): Firebase project/data boundary 메모
- [docs/functions-runtime-guide.md](docs/functions-runtime-guide.md): Firebase Functions runtime 기본값, 예외 프로파일, 운영 점검 기준
- [docs/lint-workflow.md](docs/lint-workflow.md): lint 범위, 예외, 점진적 확장 원칙
- [docs/e2e-browser-workflow.md](docs/e2e-browser-workflow.md): 실제 Chrome 기준 수동 검증 흐름
- [docs/release-workflow.md](docs/release-workflow.md): 버전 상승, 릴리스 메타, hosting 배포 순서

## Feature 문서

- [content/features/conversation/AGENTS.md](content/features/conversation/AGENTS.md): 현재 대화 질문 수집, 예상 컨텍스트, 이동, route sync
- [content/features/meeting/AGENTS.md](content/features/meeting/AGENTS.md): 회의 허브, hosted 작업실, 녹음/전사, session auth
- [content/features/prompt-library/AGENTS.md](content/features/prompt-library/AGENTS.md): 자주 쓰는 요청, 가져오기/내보내기, DB 정본 동기화
- [content/features/prompt-store/AGENTS.md](content/features/prompt-store/AGENTS.md): 프롬프트 스토어 목록, 상세, 좋아요, 가져오기
- [content/features/prompt-review/AGENTS.md](content/features/prompt-review/AGENTS.md): 입력 프롬프트 평가와 보완안
- [content/features/release/AGENTS.md](content/features/release/AGENTS.md): 릴리스 패널, 최신 버전 확인, 정적 메타/ZIP

## 제품 개요

- `팝업 작업실 연결 설정`: 팝업에서 `상용 호스팅`과 `로컬 호스팅`을 고르고 `settings.meetingWorkspaceTarget`을 관리합니다.
- `우측 슬라이드 패널`: i-Nova 대화 화면 오른쪽에서 `대화`, `회의`, `프롬프트`, `릴리스`를 전환합니다.
- `대화`: 현재 대화 기준 `질문 자동 모으기`, `대화 안에서 찾기`, 현재 화면 기준 예상 컨텍스트와 선택 모델 기준의 길이 신호를 제공합니다.
- `프롬프트`: `자주 쓰는 요청`, `요청 가져오기/내보내기`, `프롬프트 스토어`, 평가/보완 흐름을 제공합니다.
- `회의`: 패널의 회의 허브와 Firebase Hosting 기반 hosted 회의 작업실을 함께 사용합니다.
- `릴리스`: 현재 버전, 최신 배포 안내, 다운로드 링크와 업데이트 절차를 제공합니다.

## 저장소 구조

- `popup/`: 회의 작업실 대상 선택과 디버그 ON/OFF
- `content/`: i-Nova 페이지 안의 iframe host, DOM/page adapter, feature controller
- `background/`: 탭/세션 브리지, hosted URL 조립, release fetch
- `hosting/extension/panel/`: hosting 배포만으로 갱신되는 hosted 실험실 패널 UI
- `hosting/extension-v2/panel/`: `1.0.0+` hosted panel controller/view와 remote workflow sandbox host
- `hosting/extension-v2/capability-manifest.json`: v2 remote capability catalog, endpoint, URL template, lane/kill switch 설정
- `hosting/meeting/`: hosted 회의 작업실
- `functions/`: 회의, 프롬프트 backend 함수
- `shared/`: panel, popup, hosted, background가 함께 쓰는 계약과 helper

## 빠른 시작

1. `npm install`을 실행합니다.
2. 필요하면 `npm run hooks:install`로 Git 훅을 연결합니다.
3. Chrome의 `압축해제된 확장 프로그램 로드`로 이 폴더를 등록합니다.
4. `https://inova.incross.com/`을 열고 팝업에서 `상용 호스팅` 또는 `로컬 호스팅`을 고릅니다.
5. 대화 화면 오른쪽의 `실험실` 패널에서 필요한 도구로 진입합니다.

## 공통 명령

```bash
npm run lint
npm run verify
npm run verify:docs
npm run verify:feature-doc-guard
npm run verify:release-guard
npm run emulator:hosting
npm run emulator:meeting-local
npm run deploy:hosting
npm run release:deploy
npm run deploy:functions
npm run deploy:storage
npm run deploy:all
```

- 기본 자동 검증은 `npm run verify`이며 lint를 포함합니다.
- `npm run verify:feature-doc-guard`는 blocking guard가 아니라 문서 검토 후보를 보여 주는 audit 용도입니다.
- UI 체감, opener, 세션 복원, hosted 경계는 실제 Chrome 확인을 우선합니다.
- hosted 회의 작업실을 배포 전 먼저 보려면 `npm run emulator:hosting` 후 팝업에서 `로컬 호스팅`을 고릅니다.
- meeting을 진짜 local full-stack으로 보려면 `npm run emulator:meeting-local`을 켠 뒤 팝업에서 `로컬 호스팅`을 고릅니다. 이 경로는 local hosted workspace뿐 아니라 meeting panel bridge, meeting Functions, Auth, Firestore, Storage emulator까지 함께 봅니다.

## 배포 기본값

- 일반적으로 `배포해줘`는 `hosting` 배포를 뜻합니다.
- `함수 배포`를 명시했을 때만 `deploy:functions`를 사용합니다.
- `deploy:hosting`과 `deploy:all`은 hosted 검증/운영 배포용이며, 기본적으로 확장 패키지 버전이나 릴리스 패널 메타를 건드리지 않습니다. `deploy:all`은 Storage를 포함하지 않으므로, Firebase Storage를 실제로 켠 프로젝트에서만 `deploy:storage`로 Rules를 별도 반영합니다.
- 실제 사용자용 확장 릴리스를 함께 갱신할 때만 `release:deploy` 또는 `release:deploy:all`을 사용합니다.
- `releases/release-notes.json`에는 패널에 보여줄 사용자용 릴리스만 남기고, build는 그 목록만 `latest.json`, `history.json`, `latest.zip`에 반영합니다.
- 확장 코드와 hosted 계약이 함께 바뀐 배포라면 Firebase 배포 뒤 Chrome의 압축해제된 확장도 새로고침해야 합니다.
- `hosting/*`만 바뀐 경우는 보통 페이지 새로고침이면 충분하고, `content/*`, `background/*`, `popup/*`, `manifest.json`, 확장 번들에 포함되는 `shared/*`가 바뀐 경우는 실제 확장 버전 배포와 Chrome 확장 Reload가 필요합니다.
- 배포 보고에는 항상 `functions 반영 여부`, `hosting 반영 여부`, `확장 버전 배포 필요 여부`, `페이지 새로고침/확장 새로고침 필요 여부`를 함께 적습니다.

## 브랜치와 가드레일

- 기본 작업 브랜치는 `codex/<task-name>` 형식입니다.
- `main`에는 직접 commit 하지 않고 작업 브랜치에서 commit 후 PR로 머지합니다.
- PR은 기본적으로 auto-merge를 사용하고, required status check가 모두 통과되면 자동 머지되게 운영합니다.
- auto-merge를 걸었어도 PR이 실제 `MERGED` 상태가 되었는지 확인해야 하며, 확인 후에는 `main`을 최신으로 맞추고 해당 로컬 `codex/*` 브랜치를 정리합니다.
- `pre-commit`과 `pre-push`는 branch workflow와 release metadata 같은 실제 안전장치를 유지합니다.
- `verify:feature-doc-guard`는 feature-owned 파일 변경 시 `AGENTS.md` 갱신을 강제하지 않고, 문서 검토 후보만 audit로 보여 줍니다.
- `verify-refactor-plan-update`는 ordinary feature 구현 변경을 막지 않고, version lane, meeting legacy baseline, release decision 기준처럼 장기 판단 비용이 큰 변경에만 `docs/refactoring-plan.md` 갱신을 요구합니다.
- `README.md`는 상위 개요용이므로, feature-local 변경 때문에 기능 변경 일지처럼 누적하지 않습니다.
- entrypoint, 데이터 경계, 최소 검증, durable invariant가 실제 코드와 달라지면 같은 작업 안에서 feature 문서나 관련 docs를 갱신합니다.
- 최근 작업 순서나 세션별 변경 요약처럼 git으로 복구 가능한 정보는 문서에 중복 기록하지 않습니다.

## 검증 기준

- 기본 루프는 `코드 수정 -> npm run verify -> 실제 Chrome 확인`입니다.
- feature 세부 smoke와 기능 계약은 각 feature `AGENTS.md`를 기준으로 확인합니다.
- meeting debug/fault 검증은 feature 문서와 hosted 전용 docs에서 확인합니다.
