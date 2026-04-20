# i-Nova Design System

`hosting/shared/design-system.css`와 `hosting/shared/design-system.js`는 hosted 화면에서 먼저 확인해야 하는 공용 UI primitive다.

## 적용 순서

1. 화면을 수정하기 전에 이 문서와 `hosting/shared/design-system.*`에 이미 있는 primitive가 있는지 확인한다.
2. 같은 피드백, 버튼, 배지, 빈 상태, overlay, form helper가 두 화면 이상에서 필요하면 feature-local CSS/JS를 만들기 전에 design system primitive로 올린다.
3. 각 화면은 공용 primitive를 import하고, 화면별 파일에는 배치와 도메인 상태만 둔다.
4. 짧은 저장/삭제/복사/이동 결과는 화면 안쪽 inline box로 만들지 않고 design system toast를 쓴다.
5. inline 메시지는 field validation, 장시간 유지해야 하는 degraded 상태, 사용자가 조치해야 하는 오류처럼 위치 맥락이 필요한 경우에만 둔다.

## Toast

- CSS: `/shared/design-system.css`
- JS: `/shared/design-system.js`
- slot: `<div class="inova-toast-slot" data-inova-toast-slot hidden></div>`
- controller: `InovaDesignSystem.createToastController({ slot })`
- tone: `success`, `error`, `warning`, `highlight`

회의 룸의 기존 `toast-notice`도 같은 CSS primitive가 스타일링한다. 새 hosted 화면은 `inova-toast-slot`과 JS controller를 기본으로 쓴다.

## Icons

- JS: `/shared/design-system.js`
- renderer: `InovaDesignSystem.renderIcon(name)`
- source: hosted panel 메뉴와 같은 Lucide path 계열을 design system에 모아 쓴다.

새 화면에서 이전/다음/닫기 같은 기본 아이콘이 필요하면 SVG path를 화면 파일에 직접 만들지 말고 `renderIcon("chevron-left")`, `renderIcon("chevron-right")`, `renderIcon("close")`를 호출한다.

## Confirm Dialog

- CSS: `/shared/design-system.css`
- JS: `/shared/design-system.js`
- controller: `InovaDesignSystem.createConfirmController({ root: document.body })`

삭제처럼 되돌리기 어려운 작업은 브라우저 기본 `window.confirm`을 쓰지 않는다. design system confirm dialog를 띄우고, 화면별 파일에는 제목/본문/버튼 문구만 넘긴다.

## Deferred Search

- JS: `/shared/design-system.js`
- controller: `InovaDesignSystem.createDeferredSearchController({ onSearch })`
- default delay: 260ms

검색 입력은 `input` 이벤트마다 화면 전체를 즉시 다시 그리지 않는다. 화면별 파일은 입력 중 draft value와 실제 적용 query를 분리하고, 이 controller의 `handleInput`, `handleCompositionStart`, `handleCompositionEnd`, `flush`로 debounce와 IME 조합 입력을 처리한다. 검색 적용 때문에 화면을 다시 그릴 때는 기존 검색 input의 focus와 caret을 복원한다.

## Section Header

- CSS: `/shared/design-system.css`
- wrapper: `.inova-section-head`
- title: `.inova-section-head__title`

관리 화면 컬럼이나 카드 상단 제목처럼 반복되는 섹션 타이틀은 화면 전용 heading 클래스를 새로 만들지 말고 이 primitive를 쓴다.

## Badge

- CSS: `/shared/design-system.css`
- base: `.inova-badge`
- tones: `.inova-badge--success`, `.inova-badge--warning`, `.inova-badge--info`, `.inova-badge--danger`, `.inova-badge--muted`

상태, 권한, 소스처럼 짧은 metadata label은 화면별 badge 클래스를 새로 만들지 말고 이 primitive를 쓴다.

## Status State

- CSS: `/shared/design-system.css`
- wrapper: `.inova-status-state`
- children: `.inova-status-state__icon`, `.inova-status-state__eyebrow`, `.inova-status-state__title`, `.inova-status-state__body`, `.inova-status-state__hint`
- tones: `data-tone="danger"`, `data-tone="warning"`, `data-tone="complete"` 또는 `data-tone="success"`

확장 연결 필요, 관리자 권한 차단, 회의 작업실 종료처럼 전체 화면을 막는 상태는 화면별 blocked/error card를 새로 만들지 말고 이 primitive를 쓴다. icon은 `/shared/design-system.js`의 `InovaDesignSystem.renderIcon(...)`을 사용한다.

## Segmented Control

- CSS: `/shared/design-system.css`
- wrapper: `.inova-segmented`
- selected state: child `button[aria-pressed="true"]`

필터나 역할 선택처럼 2~4개의 상호 배타 옵션을 같은 줄에서 고르는 컨트롤은 화면별 segmented 스타일을 새로 만들지 말고 이 primitive를 쓴다.
