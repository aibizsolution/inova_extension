# inova_extension 작업 규칙

이 문서는 저장소별 운영 규칙만 다룬다. 저장소를 넘어 반복해서 쓸 설계/모듈화 철학은 `docs/development-philosophy.md`에 둔다. feature 상세 규칙은 각 feature 하위 `AGENTS.md`와 `docs/feature-routing.md`로 분산한다. 같은 규칙은 가장 가까운 정본에 한 번만 두고, 모델 일반 행동이나 응답 스타일은 상위 지침과 중복하지 않는다.

## 시작 순서
- 작업 시작 시 `cwd`, Git 상태, 셸 환경을 먼저 확인한다.
- 작업 시작 직후 첫 셸 명령을 실행하기 전에 아래 `셸/도구 환경 메모`를 다시 보고, 현재 세션에 해당하는 known workaround를 먼저 적용한다.
- 루트 `AGENTS.md`와 `docs/feature-routing.md`에서 primary feature와 시작 파일을 고른 뒤, 요청에 직접 필요한 environment/feature `AGENTS.md`와 코드만 읽는다. `README.md`, `package.json`, `manifest.json`은 해당 계약이나 명령이 필요할 때만 보고, ownership·모듈 경계·상태 동기화·새 탭·UI primitive·fallback 판단에는 `docs/development-philosophy.md`를 추가한다.
- `docs/archive/*`는 기본 읽기 세트에서 제외한다. 과거 판단 배경이 꼭 필요할 때만 참조하고, archive 문서와 현재 코드/운영 문서가 충돌하면 현재 코드와 운영 문서를 우선한다.
- `content/`, `functions/`, `hosting/meeting/`, `shared/`를 처음부터 넓게 읽지 않는다.
- 단순 실행/운영 요청은 `docs/feature-routing.md`의 fast path를 따라 관련 명령부터 실행하고, 실패나 스크립트 선택 ambiguity가 있을 때만 feature 문서로 좁혀 들어간다.
- 사용자가 `로컬 에뮬레이터`만 말하고 범위를 좁히지 않았으면 기본값은 `npm.cmd run emulator:meeting-local`로 본다. `hosting only`, `빠른 hosted smoke`, `meeting 제외` 같은 명시가 있을 때만 `npm.cmd run emulator:hosting`으로 낮춘다.

## 문서 계층
- 상위 철학과 모듈화 판단 기준은 `docs/development-philosophy.md`에 둔다.
- 실행 환경별 기준은 `content/AGENTS.md`, `functions/AGENTS.md`, 필요 시 `hosting/*/AGENTS.md`에 둔다.
- 이 문서와 `docs/feature-routing.md`는 저장소 운영 규칙과 feature 라우팅을 담당한다.
- 가장 구체적인 기능 예외와 데이터 경계는 각 feature `AGENTS.md`와 feature 전용 docs에 둔다.

## 셸/도구 환경 메모
- 현재 기본 셸이 PowerShell이면 `npm` 실행 시 `npm.ps1` 실행 정책 오류가 날 수 있다. 이 환경에서는 처음부터 `npm.cmd run <script>` 형태를 우선한다.
- 같은 원인으로 `npm` 계열 명령이 한 번 막혔으면 같은 문법을 반복 재시도하지 말고 즉시 `npm.cmd`, 필요 시 `npx.cmd` 같은 대안으로 전환한다.
- 새 클론에서 `npm.cmd run verify`가 `openai`, `firebase-admin`, `firebase-functions` 모듈 누락으로 막히면 루트 의존성만 설치된 상태다. `npm.cmd install --prefix functions`로 Functions 의존성도 설치한 뒤 재시도한다.
- long-running 명령(`emulator`, `dev`, `watch`)은 가능하면 시작을 먼저 걸고, 그 다음 포트/프로세스/로그로 살아 있는지만 확인한다. 실행 전에 불필요하게 feature 문서를 넓게 읽느라 명령 시작이 지연되지 않게 한다.
- 세션 중 반복해서 걸린 환경/도구 실패 패턴은 `실패한 명령`, `원인`, `바로 쓸 대안`을 이 문서나 해당 feature 문서에 같은 작업 안에서 남겨 다음 세션에 재사용한다.
- 새 세션에서도 이 메모는 선택 사항이 아니라 시작 절차 일부로 취급한다. 같은 환경에서 이미 기록된 실패 패턴은 첫 시도부터 우회 경로를 기본값으로 쓴다.

## 브라우저 검증 규칙
- 로컬과 상용 화면 검증은 `browser:control-in-app-browser` 스킬과 기존 인앱 브라우저 탭을 우선한다.
- 설치된 확장프로그램, 실제 Chrome 프로필이나 로그인 세션이 꼭 필요할 때만 `chrome:control-chrome` 스킬과 `docs/e2e-browser-workflow.md`의 actual Chrome 절차를 사용한다. 살아 있는 Chrome/확장/로그인 세션은 사용자가 허락하기 전까지 닫지 않는다.
- 브라우저 transport나 tab claim이 끊기면 해당 스킬의 복구 절차까지만 수행하고, 실패 상태를 구분해 보고한다. 실제 클릭이나 화면 검증을 확인하지 못했다면 완료로 보고하지 않는다.

## Feature-First 규칙
- 새 요청은 `docs/feature-routing.md`에서 primary feature를 고르고, 그 문서의 ambiguity 기준과 feature map을 따른다.
- 읽기 범위는 `feature-local -> feature-owned shared -> platform/shell -> 인접 feature` 순서로만 확장한다.
- `popup`, `background/service-worker.js`, `content/main.js`, `content/panel.js`, `functions/index.js`, `manifest.json`, `shared/*`는 platform/shell로 취급하고 필요할 때만 본다.

## Hosted-First 원칙
- 이 확장은 Chrome Web Store에 배포하지 않는 내부 전사 프로그램이다. Chrome Web Store 정책은 설계 차단 사유로 쓰지 않는다.
- 원격/hosted 로직을 검토할 때도 스토어 정책 때문에 불가하다고 결론내리지 않는다. 대신 내부 배포 신뢰 경계, 버전/호환성, kill switch, degraded 상태, 최소 권한 DOM read contract를 기준으로 판단한다.
- `1.0.0+` v2 lane의 UI, view state, action flow, feature controller는 hosted가 기본 위치다. extension에는 page DOM adapter, iframe host, postMessage bridge, Chrome/background runtime broker, popup/settings처럼 브라우저 확장이라서만 가능한 책임만 남긴다. 상세 판단은 `docs/development-philosophy.md`를 따른다.
- 실제 확장 프로그램 재배포나 `manifest.json`/`content/*`/`background/*`/`popup/*`/확장 번들 포함 `shared/*` 변경이 요청 범위를 실질적으로 넓히고 사용자가 아직 확장 변경을 승인하지 않았다면, hosting/functions만으로 해결할 수 없는 이유와 배포 영향을 설명한 뒤 확인한다. 사용자가 확장 변경을 이미 명시했다면 같은 승인을 반복해서 받지 않는다.
- 사용자가 확장 업데이트 없이 고치라고 명시한 문제는 먼저 `hosting/*`와 `functions/*` 배포만으로 해결 가능한 경로를 찾고, 확장 배포가 필요한 방향으로 임의 전환하지 않는다.
- hosted-first 이전에서는 현재 v2 ownership을 막는 문제만 바로 고치고, retired legacy 코드는 활성 bundle이나 별도 backup source로 되살리지 않는다. 과거 동작은 git history나 필요한 archive 문서에서만 확인한다.

## Firebase 공유 프로젝트 경계
- Firebase project `browser-extension-main`은 다른 저장소/기능과 공유될 수 있는 공용 프로젝트로 본다.
- 공유 리소스는 Auth만 허용한다. Functions, Firestore, Hosting, Storage는 저장소/기능별 전용 경계로 분리한다.
- 이 저장소의 Functions 배포 경계는 `functions:inova-extension-api` codebase다. broad `functions` 배포나 default codebase 추가는 금지한다.
- 이 저장소의 Hosting 배포 경계는 `hosting:main,hosting:v2` target이다. raw site id나 전체 `hosting` 배포를 기본 스크립트로 추가하지 않는다.
- Firestore `(default)` database는 현재 i-Nova extension 전용 DB로 예약한다. 다른 저장소/기능은 named database를 써야 하며, 이 저장소의 Firestore 배포는 `deploy:firestore:inova-db`로만 수행한다.
- Storage는 기본 배포 표면에서 제외한다. Storage Rules를 운영 반영해야 하면 먼저 전용 bucket target을 만들고 `storage:<target>` 스크립트와 `scripts/verify-firebase-deploy-boundary.js`를 함께 갱신한다.
- 같은 project에 공존하는 Stellaize Team 리소스(`stellaize-team`, `stellaize-team-api`, `stellaize-team` Firestore database, `browser-extension-main-stellaize-team`, `APIFY_TOKEN`)는 이 저장소의 `.firebaserc`, `firebase.json`, 배포 스크립트, 런타임 설정에 추가하지 않는다.
- `firebase deploy`, `firebase deploy --only functions`, `firebase deploy --only hosting`, `firebase deploy --only firestore`, `firebase deploy --only storage` 같은 broad deploy는 금지한다.
- Firebase 배포 경계를 바꾸면 `docs/firebase-architecture.md`, `docs/release-workflow.md`, `README.md`, `package.json`, `firebase.json`, `scripts/verify-firebase-deploy-boundary.js`를 같은 변경 안에서 함께 갱신한다.
- Firebase 관련 변경 후에는 최소 `npm.cmd run verify:firebase-deploy-boundary`와 `npm.cmd run verify:docs`를 실행한다. 운영 배포 전에는 필요한 실제 배포 target을 보고서에 명시한다.

## 문서와 구조
- feature 진입점과 데이터 경계는 `docs/feature-routing.md`, entrypoint·최소 검증·durable invariant는 feature `AGENTS.md`, 세부 운영/검증 절차는 feature 전용 docs에 둔다. 같은 내용을 루트나 `README.md`에 다시 풀어 쓰지 않는다.
- 최근 변경 이력, split 순서, 이번 세션에서 무엇을 했는지처럼 `git log`, `diff`, 커밋 메시지로 복구 가능한 정보는 `AGENTS.md`의 의무 기록 대상이 아니다.
- `README.md`는 저장소/제품 개요, 설치/배포, 상위 feature 축이 바뀔 때만 갱신한다.
- `docs/archive/*`처럼 과거 계획, migration 판단, 완료된 phase 기준을 담은 문서는 기본 갱신 대상이 아니다. 사용자가 그 문서 자체의 정리를 명시하거나, 같은 변경 안에서 문서를 보존/폐기 대상으로 전환하는 경우에만 건드린다.
- 현재 운영 기준이 바뀌면 과거 계획 문서가 아니라 `docs/release-workflow.md`, `docs/runtime-architecture.md`, feature `AGENTS.md`, feature 전용 docs처럼 살아있는 계약 문서에 반영한다.
- 작업 중 문서와 실제 코드/함수/ownership 경계가 다르면 현재 코드를 기준으로 관련 살아 있는 문서만 같은 작업에서 바로잡는다.
- feature 문서가 실제 파일 경로나 진입점과 어긋나기 시작하면 검증 스크립트와 문서를 함께 보강해 다음 작업자가 좁은 범위만 읽고도 시작할 수 있게 유지한다.
- 문서는 결과 설명서보다 다음 구조 판단을 더 잘하게 만드는 기준 문서가 되어야 한다.

## 백로그 운영
- 아직 구현하지 않을 아이디어, 외부 레퍼런스 분석, 후보 기능 묶음은 `docs/BACKLOG.md`와 `docs/backlog/*`에 문서 단위로 보관한다.
- 백로그는 구현 약속이나 현재 제품 계약이 아니다. 상용 동작의 정본은 구현 코드, feature `AGENTS.md`, feature 전용 docs, release/runtime 문서다.
- 사용자가 백로그/아이디어 정리를 요청했으면 기본 범위는 `docs/BACKLOG.md`와 `docs/backlog/*`다. 명시적 구현, 프로토타입, 승격 요청이 없으면 feature 문서, runtime 문서, 코드, 배포 설정을 건드리지 않는다.
- 백로그 항목은 `상태`, `목적`, `사용자 문제`, `후보 범위`, `제외 범위`, `오픈 질문`, `검증/조사 필요`, `참고 링크`를 최소 단위로 기록한다.
- 상태 값은 `idea`, `needs-research`, `ready-for-slice`, `in-progress`, `shipped`, `parked` 중 하나를 쓴다. 구현 후보가 되면 먼저 가장 작은 slice를 정하고, 그때 관련 feature 문서와 코드를 같은 변경 안에서 갱신한다.
- 외부 웹 도구나 공개 사이트를 참고한 아이디어는 기능/UX/라이브러리 후보를 기록하되, 라이선스가 확인되지 않은 소스 코드를 그대로 복사하지 않는다.
- 구현이 끝난 항목은 백로그를 계속 정본처럼 유지하지 않는다. `shipped`로 표시하고 최종 정본 문서나 PR/커밋만 링크한다.

## Lint 운영 원칙
- lint 세부 규칙, 범위, 예외, 확장 계획은 루트 `AGENTS.md`가 아니라 `docs/lint-workflow.md`에서 관리한다.
- lint는 처음부터 크게 키우지 않는다. 오류 탐지 중심의 가벼운 기준으로 시작하고, 새 규칙이나 범위 확장은 필요한 작업과 함께 점진적으로 올린다.
- `eslint.config.js`, lint 대상 범위, ignore/override, suppression, 관련 package script가 바뀌면 같은 작업 안에서 `docs/lint-workflow.md`도 함께 갱신한다.
- lint 오류를 잠재우기 위해 전역 ignore나 넓은 disable을 먼저 넣지 않는다. 우선순위는 `코드 수정 -> 좁은 범위 예외 -> 문서화`다.
- 구조/계약 가드 메시지가 뜻하는 바가 불명확하면 스크립트 메시지부터 바로 고친다. 사람이 `회피`가 아니라 `책임 분리`를 읽게 만드는 쪽을 우선한다.

## 간헐 이슈 원칙
- 재현률이 낮거나 원인이 불명확한 간헐 이슈는 추측만으로 수정하지 않는다.
- 먼저 재현 절차, 영향 범위, 이벤트 흐름, 콘솔/네트워크/패널 debug 로그 같은 근거를 확보한다.
- 로컬에서 안정 재현이 안 되면 계측 로그를 추가하거나 사용자/QA에 재현 영상, 발생 시각, 로그를 요청한다.
- 로그를 요청할 때는 전체 복사를 요구하지 말고, 필요한 이벤트만 추출하는 콘솔 명령이나 수집 방법을 먼저 제공한다.
- 원인 근거 없이 입력, 전송, 삭제, 동기화 같은 민감 경로를 바로 수정하지 않는다.
- 입력, 탭 전이, 동기화, 함수 호출, 리뷰/생성/전송 같은 UI-런타임 경계 이슈는 코드 수정 전에 해당 경로의 콘솔 로그를 먼저 확보한다.
- 콘솔 로그가 부족하면 추측 수정 대신 먼저 계측을 추가한다. 최소 기준은 `사용자 액션 -> top panel request/snapshot -> hosted/controller 상태 -> runtime/functions 호출` 흐름이 콘솔에서 보이는 것이다.
- 콘솔 로그로 실제 중단 지점이 확인되기 전에는 fallback 추가나 로직 변경으로 증상을 가리려 하지 않는다.

## Subagent 규칙
- 저장소 전반의 read-only 탐색, 후보 파일 수집, 독립 테스트는 병렬화 가치가 있을 때만 서브에이전트에 맡긴다. 같은 파일을 동시에 수정시키지 않는다.
- 각 위임에는 `작업 1개`, 시작 파일/검색 패턴 1~3개, 제외 범위, 수정 가능 여부, 짧은 결과 형식을 고정한다.
- primary feature와 범위 판단, 충돌/누락 확인, 위험한 diff 리뷰, 최종 검증과 통합은 메인 에이전트가 맡는다.

## 검증과 세션 분리
- 기본 검증은 `npm.cmd run verify`부터 수행한다.
- `verify`에는 lint가 포함되므로, lint 범위나 규칙을 바꿨다면 `npm.cmd run lint` 또는 `npm.cmd run verify`로 실제 통과를 확인한다.
- UI 체감과 opener, 세션 복원, 배포 경계는 실제 Chrome 확인을 우선한다.
- 기능 구현 후 실제 Chrome 검증의 기본 범위는 이번 변경 파일과 직접 연결된 feature 흐름이다. 사용자가 `풀 테스트`, `전체 버튼`, `회의 작업실까지`, `녹음까지`처럼 명시하지 않으면 인접 feature나 긴/파괴적 workflow로 확장하지 않는다.
- 회의 허브만 바꾼 경우 기본 브라우저 검증은 회의 룸 패널의 탭/검색/카드/action/DB 확인까지다. hosted 회의 작업실의 녹음, 파일 import, 기록 삭제/이동, 회의록 편집은 별도 명시가 있을 때만 실행한다.
- 작업 결과를 보고할 때는 이 변경이 실제 상용 반영에 무엇을 배포해야 하는지도 함께 적는다. `hosting/*`나 hosted 정적 자산 변경은 hosting 배포, `functions/*` 변경은 functions 배포, 둘 다 바뀌면 둘 다라고 명시하고, 확장 `content/background/popup/shared`만 바뀐 경우는 Firebase 배포 대상이 아니라 확장 새로고침 또는 별도 확장 배포가 필요하다고 구분해서 설명한다.
- 배포/검증 보고에서는 사용자가 지금 확인해야 할 실행 대상을 `로컬 호스팅/에뮬레이터`, `상용 Hosting`, `새 ZIP/확장 새로고침` 중 하나로 명확히 구분한다. `배포됨`, `확인됨`, `새로고침하면 보임`처럼 대상이 빠진 표현만 쓰지 않고, 로컬과 상용이 동시에 가능하면 이번 작업에서 실제로 갱신된 대상과 사용자가 봐야 할 URL 또는 패널 target을 함께 적는다.
- 작업 보고는 `다음 액션 판단에 필요한 핵심` 위주로 짧게 적는다. 이미 커밋된 내용은 장황하게 다시 풀지 말고 `이번 판단`, `검증 결과`, `커밋`, `다음 액션` 중심으로 빠르게 이해되게 정리한다.
- 코드 리뷰 요청은 기본적으로 read-only 분석으로 시작한다. 리뷰 findings 작성/검토만 요청받은 상태에서는 새 `codex/*` 브랜치를 만들지 않는다.
- 코드 리뷰 후 사용자가 `반영`, `수정`, `커밋`, `PR`처럼 구현 단계를 명시했을 때만 기존 작업 브랜치를 쓰거나, 필요 시 그때 새 브랜치를 만든다.
- 기능 수정이 끝났고 현재 턴 경계 안의 검증이 녹색이면, 다음 요청을 기다리며 커밋을 미루지 말고 바로 커밋한다.
- PR은 기본적으로 생성 후 auto-merge를 사용하고, required check가 모두 녹색일 때 자동 머지되게 유지한다.
- auto-merge를 켰다고 즉시 머지된 것으로 간주하지 않는다. `mergedAt` 또는 동등한 GitHub 상태로 실제 머지를 확인한 뒤에만 `main 반영 완료`라고 보고한다.
- PR 머지가 확인되면 사용자가 별도 보존을 요청하지 않는 한, 같은 턴 안에서 `main` 동기화, 로컬 작업 브랜치 정리, 남아 있는 원격 작업 브랜치 정리까지 기본 마무리한다.
- 로컬 작업 브랜치 정리는 `git branch --merged` 같은 local-only 기준으로 판정하지 않는다. cleanup 스크립트와 수동 정리 모두 `origin/main` 동기화 확인 후, 삭제 대상 브랜치 tip이 `origin/main`의 ancestor이거나 `origin/main`과 tree가 동일한 경우(예: squash/rebase merge 반영) 에만 진행한다.
- 커밋 보류는 미검증, 남은 known issue, 같은 턴 안의 추가 구조 의도처럼 분명한 이유가 있을 때만 허용한다.
- 두 번째 primary feature까지 실제 구현 범위가 넓어지거나 `content + functions + hosting` 3축을 함께 수정해야 하면 변경을 검증 가능한 커밋 경계로 나눈다. 사용자 선택에 따라 범위가 실질적으로 달라질 때만 다음 세션 분리를 확인한다.
- 검증을 못 했으면 성공처럼 말하지 말고 미실행 항목과 이유를 남긴다.
