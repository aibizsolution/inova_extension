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

## Section Header

- CSS: `/shared/design-system.css`
- wrapper: `.inova-section-head`
- title: `.inova-section-head__title`

관리 화면 컬럼이나 카드 상단 제목처럼 반복되는 섹션 타이틀은 화면 전용 heading 클래스를 새로 만들지 말고 이 primitive를 쓴다.
