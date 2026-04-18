# inova_extension 작업 규칙

이 문서는 저장소별 운영 규칙만 다룬다. 저장소를 넘어 반복해서 쓸 설계/모듈화 철학은 `docs/development-philosophy.md`에 둔다. feature 상세 규칙은 각 feature 하위 `AGENTS.md`와 `docs/feature-routing.md`로 분산한다.

## 시작 순서
- 작업 시작 시 `cwd`, Git 상태, 셸 환경을 먼저 확인한다.
- 작업 시작 직후 첫 셸 명령을 실행하기 전에 아래 `셸/도구 환경 메모`를 다시 보고, 현재 세션에 해당하는 known workaround를 먼저 적용한다.
- 기본 최소 읽기 세트는 `docs/development-philosophy.md`, 루트 `AGENTS.md`, `README.md`, `package.json`, `manifest.json`, `docs/feature-routing.md`, 그리고 요청과 일치하는 environment `AGENTS.md` 1개와 feature `AGENTS.md` 1개다.
- `content/`, `functions/`, `hosting/meeting/`, `shared/`를 처음부터 넓게 읽지 않는다.
- 단순 실행/운영 요청(`로컬 에뮬레이터 켜기`, `dev server 실행`, `lint/test/build/verify 실행`, `로그/상태 확인`)은 feature 구현 요청처럼 취급하지 않는다. 이 경우 `cwd`/Git/셸 확인 뒤 바로 `package.json` 스크립트, 관련 워크플로 문서, 필요한 환경 메모만 읽고 명령부터 실행한다.
- 위 fast path에서는 feature `AGENTS.md`와 세부 docs를 선행 필수로 읽지 않는다. 실행이 실패했거나 어떤 스크립트를 써야 할지 모호할 때만 해당 feature 또는 environment 문서로 좁혀 들어간다.
- 사용자가 `로컬 에뮬레이터`만 말하고 범위를 좁히지 않았으면 기본값은 `npm.cmd run emulator:meeting-local`로 본다. `hosting only`, `빠른 hosted smoke`, `meeting 제외` 같은 명시가 있을 때만 `npm.cmd run emulator:hosting`으로 낮춘다.

## 문서 계층
- 상위 철학과 모듈화 판단 기준은 `docs/development-philosophy.md`에 둔다.
- 실행 환경별 기준은 `content/AGENTS.md`, `functions/AGENTS.md`, 필요 시 `hosting/*/AGENTS.md`에 둔다.
- 이 문서와 `docs/feature-routing.md`는 저장소 운영 규칙과 feature 라우팅을 담당한다.
- 가장 구체적인 기능 예외와 데이터 경계는 각 feature `AGENTS.md`와 feature 전용 docs에 둔다.

## 셸/도구 환경 메모
- 현재 기본 셸이 PowerShell이면 `npm` 실행 시 `npm.ps1` 실행 정책 오류가 날 수 있다. 이 환경에서는 처음부터 `npm.cmd run <script>` 형태를 우선한다.
- 같은 원인으로 `npm` 계열 명령이 한 번 막혔으면 같은 문법을 반복 재시도하지 말고 즉시 `npm.cmd`, 필요 시 `npx.cmd` 같은 대안으로 전환한다.
- long-running 명령(`emulator`, `dev`, `watch`)은 가능하면 시작을 먼저 걸고, 그 다음 포트/프로세스/로그로 살아 있는지만 확인한다. 실행 전에 불필요하게 feature 문서를 넓게 읽느라 명령 시작이 지연되지 않게 한다.
- 세션 중 반복해서 걸린 환경/도구 실패 패턴은 `실패한 명령`, `원인`, `바로 쓸 대안`을 이 문서나 해당 feature 문서에 같은 작업 안에서 남겨 다음 세션에 재사용한다.
- 새 세션에서도 이 메모는 선택 사항이 아니라 시작 절차 일부로 취급한다. 같은 환경에서 이미 기록된 실패 패턴은 첫 시도부터 우회 경로를 기본값으로 쓴다.

## Feature-First 규칙
- 새 요청이 오면 먼저 primary feature를 고른다. 기본 feature는 `conversation`, `prompt-library`, `prompt-store`, `prompt-review`, `meeting`, `release`다.
- cue가 2개 이상 섞이면 전체 탐색 대신 짧게 `이 기능이 맞나요?`라고 확인한 뒤 해당 feature부터 읽는다.
- 읽기 범위는 `feature-local -> feature-owned shared -> platform/shell -> 인접 feature` 순서로만 확장한다.
- `popup`, `background/service-worker.js`, `content/main.js`, `content/panel.js`, `functions/index.js`, `manifest.json`, `shared/*`는 platform/shell로 취급하고 필요할 때만 본다.

## Hosted-First 원칙
- 이 확장은 Chrome Web Store에 배포하지 않는 내부 전사 프로그램이다. Chrome Web Store 정책은 설계 차단 사유로 쓰지 않는다.
- 원격/hosted 로직을 검토할 때도 스토어 정책 때문에 불가하다고 결론내리지 않는다. 대신 내부 배포 신뢰 경계, 버전/호환성, kill switch, degraded 상태, 최소 권한 DOM read contract를 기준으로 판단한다.
- `1.0.0+` v2 lane의 기본 목표는 `탭 기능의 기본 소유권을 hosting으로 옮기는 것`이다.
- 새 기능이나 기존 기능 수정은 먼저 `hosting/*`에서 해결할 수 있는지 본다. 특별한 이유가 없으면 UI, view state, action flow, feature controller는 hosted가 기본 위치다.
- extension에는 `page DOM adapter`, `iframe host`, `postMessage bridge`, `chrome/background runtime broker`, `popup/settings`처럼 브라우저 확장이라서만 가능한 책임만 남긴다.
- 어떤 책임이 `Chrome API`, `background`, `현재 페이지 DOM` 없이도 성립하면 extension에 새로 싣지 않는다. hosted 쪽으로 옮기거나 hosted에서 시작하는 설계를 우선한다.
- 리팩터링 중에는 `이 수정이 extension 책임을 실제로 줄였는가`를 기본 판단 질문으로 삼는다.
- hosted-first 이전 중 이슈를 만나면 먼저 `이미 hosted로 옮겨진 lane의 문제인가`, `곧 제거할 legacy extension residue만의 문제인가`를 구분한다.
- 이미 hosted ownership에서 재현되거나 hosted 이전 자체를 막는 문제는 바로 고친다.
- legacy residue에만 머무르고 현재 hosted 이전을 막지 않는 문제는 임시 보강보다 ownership 이전을 먼저 진행한다.
- ownership 이전 작업에서는 기존 extension 구현을 `보존 대상`보다 `참조용 baseline`으로 본다.
- 기존 구현을 그대로 끌고 오기 위해 adapter, bridge glue, mixed ownership이 늘어나면 재사용을 멈추고 대상 ownership 위치에 직접 다시 구현한다.
- 재사용은 `실제로 더 빨라질 때만` 선택한다. 같은 계약을 새 ownership 위치에 짧고 명확하게 다시 쓰는 편이 더 빠르면 그쪽을 기본값으로 삼는다.
- `DB/Functions 계약을 바꾸지 않는 순수 panel v2 migration`에서는 현재 `1.0.0` v2 bundle이 정상 동작하는지만 우선 확인한다. 이런 작업에서 legacy extension 코드는 호환 이유로 활성 bundle 안에 계속 남겨 둘 대상으로 보지 않는다.
- 현재 `1.0.0` 활성 bundle과 공유 계약이 더 이상 쓰지 않는 legacy extension panel 코드는 `content/*` 안에 섞어 두지 않는다. 기본 방향은 `backup/legacy-panel/*`로 격리하거나 바로 삭제 후보로 분류하는 것이다.
- 격리된 legacy panel 코드는 평소 panel v2 migration 판단 기준이 아니다. `DB/Functions`나 shared server contract를 수정할 때만 `0.4.4` 영향 판단용 참고본으로 보고, 그 외 순수 panel migration에서는 현재 v2 bundle 정상 동작만 우선 확인한다.

## 설계와 모듈화 적용 규칙
- 구현 전에 먼저 책임 경계를 정하고, 파일 길이만을 이유로 분리하지 않는다.
- 책임 분리와 파일 분리를 같은 의미로 보지 않는다. 항상 함께 로드되고, 함께 수정되고, 함께 이해되는 코드는 같은 파일이나 같은 모듈에 남길 수 있다.
- 여러 곳 재사용, 독립 상태/생명주기, 독립 테스트/교체 가치가 큰 코드만 새 파일 또는 새 진입점으로 분리한다.
- 같은 구조 문제나 tradeoff가 반복되면 개별 helper 분리만 누적하지 말고 시스템 차원의 해법을 검토한다.
- 구조/길이 가드는 `이 파일에 책임을 더 싣지 말고 경계를 다시 보라`는 신호로 해석한다.
- 가드를 피하려고 관련 없는 파일에 임시 state, 분기, 우회 render, 진단 helper를 옮겨 싣지 않는다. 새 책임이 생겼다면 해당 책임을 가진 모듈로 분리하거나 새 모듈을 만든다.

## 문서와 구조
- feature 진입점과 데이터 경계는 항상 `docs/feature-routing.md`를 먼저 기준으로 삼는다.
- 기능 상세 규칙은 루트 문서에 다시 길게 적지 말고 feature 하위 `AGENTS.md`에 추가한다.
- `AGENTS.md`는 entrypoint, 데이터 경계, 최소 검증, durable invariant 같은 `지속 규칙`을 맡고, feature 전용 docs는 운영/검증/판단 기준을 맡는다.
- 최근 변경 이력, split 순서, 이번 세션에서 무엇을 했는지처럼 `git log`, `diff`, 커밋 메시지로 복구 가능한 정보는 `AGENTS.md`의 의무 기록 대상이 아니다.
- `README.md`는 저장소/제품 개요, 설치/배포, 상위 feature 축이 바뀔 때만 갱신한다.
- feature-local 규칙, 계약, 최소 검증 기준은 해당 feature `AGENTS.md` 또는 feature 전용 docs에 문서화한다.
- feature-local 변경 때문에 `README.md`를 기능 변경 일지처럼 누적하지 않는다.
- 문서는 완벽하지 않다고 가정하고, 작업 중 문서와 실제 코드/함수/파일 경계가 다르면 코드를 기준으로 같은 작업 안에서 문서를 갱신한다.
- hosted-first 기준으로 이미 옮겨진 책임을 문서가 아직 extension-owned처럼 설명하면, 발견한 같은 작업 안에서 바로 고친다.
- 문서 정리는 `언젠가 한 번에` 하지 않는다. 관련 문서를 읽다가 낡은 ownership 설명이나 경계 서술을 찾으면 그 자리에서 계속 바로잡는다.
- feature 문서가 실제 파일 경로나 진입점과 어긋나기 시작하면 검증 스크립트와 문서를 함께 보강해 다음 작업자가 좁은 범위만 읽고도 시작할 수 있게 유지한다.
- 문서는 결과 설명서보다 다음 구조 판단을 더 잘하게 만드는 기준 문서가 되어야 한다.

## Lint 운영 원칙
- lint 세부 규칙, 범위, 예외, 확장 계획은 루트 `AGENTS.md`가 아니라 `docs/lint-workflow.md`에서 관리한다.
- lint는 처음부터 크게 키우지 않는다. 오류 탐지 중심의 가벼운 기준으로 시작하고, 새 규칙이나 범위 확장은 필요한 작업과 함께 점진적으로 올린다.
- `eslint.config.js`, lint 대상 범위, ignore/override, suppression, 관련 package script가 바뀌면 같은 작업 안에서 `docs/lint-workflow.md`도 함께 갱신한다.
- lint 오류를 잠재우기 위해 전역 ignore나 넓은 disable을 먼저 넣지 않는다. 우선순위는 `코드 수정 -> 좁은 범위 예외 -> 문서화`다.
- 구조/계약 가드 메시지가 뜻하는 바가 불명확하면 스크립트 메시지부터 바로 고친다. 사람이 `회피`가 아니라 `책임 분리`를 읽게 만드는 쪽을 우선한다.

## 공통화 원칙
- 같은 feature 안에서 panel, hosted, popup 같은 여러 표면이 비슷한 markup/helper/state contract를 반복하면 먼저 shared module 또는 render contract로 묶을 수 있는지 검토한다.
- 공통화는 꼭 다른 프로젝트 재사용을 목표로 하지 않아도 된다. 현재 저장소 안에서 반복 구현을 줄이고 표면별 adapter만 얇게 남기는 방향을 우선한다.
- 공통화 후보가 보이면 각 표면에서 조금씩 비슷하게 맞추는 방식보다 공용 JS로 올리고 표면별 진입부만 연결하는 리팩터링을 우선 검토한다.

## Fallback 원칙
- fallback은 서비스를 완전히 멈추지 않게 하는 장치로만 쓰고, 핵심 기능 실패를 성공처럼 보이게 만드는 용도로 쓰지 않는다.
- fallback이나 cached/stale data를 보여줄 때는 반드시 degraded 상태를 드러낸다. 무엇이 실패했고 어떤 데이터가 최신이 아닐 수 있는지 사용자와 로그에 함께 남긴다.
- try/catch 뒤에 빈 값, 기본값, 이전 값으로 조용히 대체하지 않는다. 대체가 필요하면 실패 원인과 제한 범위를 명시한다.
- 저장, 전송, 생성, 분석, 동기화처럼 성공 여부가 중요한 작업은 fallback을 성공 완료처럼 처리하지 않는다.
- 재시도 가능한 오류는 retry 후에도 실패하면 degraded 또는 explicit error로 남기고, retry 불가 오류는 바로 명시적 실패로 보여준다.
- 배포 누락, 함수 계약 불일치, 스키마 mismatch, 권한 문제처럼 근본 원인이 따로 있는 실패를 프런트 fallback으로 숨기지 않는다. 먼저 원인 자체를 수정하거나, 즉시 수정이 불가능하면 배포/계약 문제임을 명시적으로 드러낸다.
- 작업 중 이런 숨김성 fallback이나 `성공처럼 보이는 임시 우회`를 발견하면 요청 범위를 벗어나지 않는 선에서 자동으로 개선한다. 우선순위는 `원인 수정 -> 명시적 degraded/error surface로 전환 -> 불가 사유 보고` 순서다.

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
- 저장소 전반 read-only 탐색, 후보 파일 수집, 테스트 실행은 서브에이전트를 우선 검토한다.
- primary feature 분류, 범위 확장 판단, 위험한 diff 리뷰, 최종 판단과 결과 통합은 메인 에이전트가 맡는다.
- 서브에이전트 결과가 약하거나 서로 어긋나면 메인 에이전트가 해당 범위만 다시 읽고 결론을 정한다.
- 서브에이전트에는 먼저 `질문 1개 또는 작업 1개`, `읽을 파일 범위`, `건드리면 안 되는 범위`, `코드 수정 가능 여부`, `출력 형식`을 함께 고정한다.
- 탐색형 서브에이전트는 기본적으로 저장소 전체를 읽게 두지 말고, 시작 파일/함수 1~3개와 필요한 검색 패턴만 지정한다.
- 브라우저 검증이나 테스트도 서브에이전트에 맡길 때는 URL, 기대 로그, 확인할 상태를 함께 적어 불필요한 재탐색을 줄인다.
- 결과 형식은 가능하면 `핵심 원인`, `근거 파일/라인`, `다음 액션`처럼 짧고 강한 포맷으로 제한해 장문 탐색 보고를 막는다.
- 작업이 끝난 서브에이전트는 바로 닫아 agent slot을 회수하고, 같은 문맥 후속이 아니면 오래 열어 두지 않는다.
- 서브에이전트 운용에서 반복되는 비효율이나 좋은 패턴을 발견하면 다음 세션부터 바로 쓰도록 이 문서 규칙에 누적한다.

## 검증과 세션 분리
- 기본 검증은 `npm run verify`부터 수행한다.
- `verify`에는 lint가 포함되므로, lint 범위나 규칙을 바꿨다면 `npm.cmd run lint` 또는 `npm.cmd run verify`로 실제 통과를 확인한다.
- UI 체감과 opener, 세션 복원, 배포 경계는 실제 Chrome 확인을 우선한다.
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
- 두 번째 primary feature를 읽어야 하거나 `content + functions + hosting` 3축에 동시에 손대려는 순간, 먼저 커밋 경계 또는 다음 세션 분리를 제안한다.
- 검증을 못 했으면 성공처럼 말하지 말고 미실행 항목과 이유를 남긴다.
