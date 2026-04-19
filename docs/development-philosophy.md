# Development Philosophy

이 문서는 저장소별 명령어나 폴더 구조보다 위에 있는, 비교적 오래 유지할 개발 철학과 판단 기준을 다룬다.
저장소별 운영 규칙은 루트 `AGENTS.md`, 실행 환경 기준은 `content/AGENTS.md`와 `functions/AGENTS.md`, feature-local 예외는 각 feature `AGENTS.md`에서 다룬다.

## 개발 철학

- 구현 전에 먼저 책임 경계를 정한다.
- 책임 분리와 파일 분리를 같은 의미로 보지 않는다.
- 무조건 작은 파일보다 응집도 높은 모듈을 우선한다.
- 파일 길이만을 이유로 분리하지 않는다.
- 항상 함께 로드되고, 함께 수정되고, 함께 이해되는 코드는 함께 둔다.
- 여러 곳에서 재사용되거나, 독립적인 상태와 생명주기를 가지는 코드는 분리한다.
- 구조/길이 가드는 회피 규칙이 아니라 책임 분리 신호로 읽는다.
- 가드를 잠재우기 위해 관련 없는 파일에 책임을 우회 적재하지 않는다. 새 책임이 확인되면 그 책임이 속한 모듈로 옮기거나 새 경계를 만든다.
- `일단 구현 후 즉시 리팩토링`을 기본 작업 방식으로 삼지 않는다.
- 같은 구조 문제가 반복되면, 개별 코드 정리 대신 시스템 차원의 해결책을 먼저 검토한다.
- 실패를 조용히 숨기지 않고 명시적으로 드러낸다.
- 문서는 결과 기록보다 다음 판단을 돕는 기준 문서가 되어야 한다.

## Hosted-First 기본값

- `1.0.0+` v2 lane에서는 사용자에게 보이는 탭 기능의 기본 위치를 `hosting`으로 본다.
- UI, view state, action flow, feature-local controller는 특별한 제약이 없으면 hosted에 둔다.
- extension에는 `Chrome API`, `background broker`, `page DOM adapter`, `iframe host`, `postMessage bridge`, `popup/settings`처럼 브라우저 확장이라서만 가능한 책임만 남긴다.
- 기능을 바꾸거나 추가할 때는 먼저 `이 책임이 Chrome/background/page DOM 없이도 성립하는가?`를 묻고, 그렇다면 hosted를 기본 선택으로 삼는다.
- hosted에서 해결 가능한 책임을 extension에 더 싣는 일은 예외로 취급하고, 필요 사유가 명확할 때만 허용한다.
- hosted-first 이전 중 발견한 문제는 `이미 옮겨진 hosted lane의 문제`와 `곧 제거할 legacy residue의 문제`를 구분해 다룬다.
- 이미 옮겨진 hosted ownership에서 재현되거나 다음 ownership 이전을 막는 문제는 즉시 수정한다.
- legacy residue에만 남아 있고 hosted 이전을 막지 않는 문제라면, 임시 수선보다 ownership 이전을 먼저 진행한다.
- `DB/Functions 계약을 바꾸지 않는 순수 panel v2 migration`이라면 판단 기준은 현재 `1.0.0` v2 bundle이 정상 동작하는지다. 이 경우 legacy extension 코드를 활성 번들 안에 계속 보존하는 것보다, v2 경로를 더 짧고 단순하게 만드는 쪽을 기본 선택으로 삼는다.
- ownership migration에서는 legacy 구현을 `정답 코드`가 아니라 `행동/spec 참고본`으로 취급한다.
- legacy 코드를 살리기 위해 adapter, fallback, mixed ownership glue가 늘어나면 재사용을 고집하지 않는다.
- 새 ownership 위치에 더 짧고 명확하게 다시 구현할 수 있다면, 기존 코드를 참고만 하고 직접 구현하는 편을 기본 선택으로 삼는다.
- 현재 활성 `1.0.0` bundle과 공유 계약에서 빠진 legacy extension panel 코드는 활성 경로에 계속 섞어 두지 않는다. 이런 코드는 `backup/legacy-panel/*` 같은 격리 위치로 보내 `참고본`으로만 남기거나, 참고 가치가 끝나면 삭제하는 쪽을 기본 선택으로 삼는다.
- 격리된 legacy panel 코드는 `0.4.4` 사용자 영향 판단이 필요할 때만 본다. 즉 `DB/Functions`나 shared server contract를 바꾸는 작업에서는 backup legacy를 비교 기준으로 삼되, 그 외 순수 panel v2 migration에서는 활성 v2 bundle 정상 동작 여부를 우선 기준으로 삼는다.

## 상태 동기화 기본값

- 상태 변경 감지는 polling이 아니라 subscription, push event, explicit user action, invalidation signal을 기본값으로 삼는다.
- 서버/DB/API를 주기적으로 읽어 변경 여부를 확인하는 코드는 비용과 부하를 계속 만든다. 따라서 기본 구현으로 선택하지 않는다.
- polling이 필요한 예외는 먼저 `왜 event/subscription 방식이 불가능한지`, `비용과 호출 주기`, `백오프와 중단 조건`을 설명하고 사용자 허락을 받은 뒤에만 구현한다.
- 로컬 UI 타이머는 허용되지만 네트워크나 저장소 read를 반복시키는 순간 polling으로 취급한다.

## 검증 가능한 새 탭 기본값

- hosted 화면에서 새 탭을 여는 기능은 먼저 web platform으로 열 수 있는지 본다.
- launch token, session, workspace URL처럼 async 준비가 필요한 경우에도 사용자 activation 안에서 빈 탭을 먼저 만들고 준비된 URL로 이동시키는 구조를 우선한다.
- background의 `chrome.tabs.create`는 hosted에서 직접 열 수 없는 경우의 fallback 또는 extension-only 책임으로 제한한다.
- 새 탭 대상의 내부 화면 검증이 필요한 기능은 최종 URL을 controller 결과와 trace에서 확인할 수 있게 두어야 한다. 단, secret token은 보고나 로그에 원문으로 노출하지 않는다.
- 같은 기능이 사용자에게 새 탭을 열어야 한다면, 검증 경로 때문에 같은 탭 전환으로 UX를 바꾸지 않는다. 사용자 UX는 새 탭으로 유지하고, 구현 경로만 Bridge가 추적 가능한 web-open 우선으로 둔다.

## 모듈화 판단 질문

새 기능을 넣거나 기존 구조를 바꿀 때는 먼저 아래 질문으로 책임 경계를 판단한다.

1. 이 코드는 다른 곳에서도 다시 쓸 가능성이 있는가?
2. 이 코드는 자기만의 상태를 가지는가?
3. 이 코드는 자기만의 DOM, 스타일, 이벤트 흐름, 생명주기를 가지는가?
4. 이 코드는 따로 테스트하거나 교체할 가치가 있는가?
5. 이 코드는 항상 같은 시점에 같이 로드되는가?
6. 이 코드는 항상 같은 작업 맥락에서 같이 수정되는가?
7. 분리했을 때의 이점이 호출 비용, 로딩 비용, 이해 비용보다 큰가?

`재사용`, `독립 상태`, `독립 생명주기`, `독립 테스트 가치`가 강하면 분리를 우선하고,
`항상 같이 로드`, `항상 같이 수정`, `항상 같이 이해`가 강하면 같은 모듈이나 같은 파일에 두는 쪽을 우선한다.

## 결정 순서

- 먼저 `이 책임은 어디까지가 하나인가?`를 묻는다.
- 다음으로 `함께 있어야 더 자연스러운가?`를 본다.
- 그 뒤에야 파일 경계, lazy 경계, 별도 진입점 여부를 고른다.

가능한 선택지는 보통 아래 네 가지다.

- 기존 파일에 둔다.
- 기존 파일 안의 서브모듈 또는 내부 helper 묶음으로 둔다.
- 같은 lazy 묶음 안의 새 모듈로 뺀다.
- 완전히 별도 진입점으로 뺀다.

## 실패와 구조 문제

- fallback은 핵심 실패를 성공처럼 보이게 만드는 장치가 아니라, 제한된 상태를 드러내는 장치여야 한다.
- 같은 구조 문제나 tradeoff가 여러 곳에서 반복되면, 개별 함수 분리나 조건문 추가만 반복하지 않는다.
- 이 경우는 빌드 구조, 공용 contract, recovery layer, adapter 경계 같은 시스템 차원의 해법을 먼저 검토한다.

## Design System 우선 원칙

- hosted 화면 UI를 만들거나 수정할 때는 먼저 `docs/design-system.md`와 `hosting/shared/design-system.*`를 확인한다.
- 이미 있는 primitive는 화면별 CSS/JS로 다시 만들지 않고 공용 계약을 사용한다.
- 아직 primitive가 없고 두 화면 이상에서 반복될 가능성이 있으면, feature-local 구현보다 design system primitive 추가를 우선한다.
- 짧은 action feedback은 공용 toast를 기본으로 쓰고, inline feedback은 field validation이나 지속적으로 보여야 하는 degraded/error 상태에만 둔다.

## 문서 계층

- 상위 문서: 변하지 않는 철학과 판단 원칙
- 중간 문서: 실행 환경별 기준
- 하위 문서: 저장소별 규칙
- 가장 하위 문서: 기능별, 도메인별 예외와 절차

이 저장소에서는 현재 아래처럼 대응한다.

- 상위 철학: `docs/development-philosophy.md`
- 실행 환경 기준: `content/AGENTS.md`, `functions/AGENTS.md`
- 저장소 운영 규칙: 루트 `AGENTS.md`, `docs/feature-routing.md`
- feature-local 예외: 각 feature `AGENTS.md`, feature 전용 docs

## 문서 보정 원칙

- 문서는 항상 코드보다 느리게 낡을 수 있다고 가정한다.
- hosted-first 리팩터링 중 문서가 이미 이동한 책임을 예전 extension 소유처럼 설명하면, 발견한 같은 작업 안에서 바로 고친다.
- 문서 보정을 `전면 정리 작업`까지 미루지 않는다. 읽다가 발견한 ownership mismatch는 관련 변경과 함께 계속 누적 수정한다.
