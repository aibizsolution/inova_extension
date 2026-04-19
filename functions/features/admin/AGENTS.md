# admin 작업 규칙

- 목적은 확장 패널 안에 관리 기능을 싣는 것이 아니라, 권한이 확인된 사용자에게만 별도 hosted 관리자 콘솔 진입점을 제공하는 것이다.
- 패널은 관리자 메뉴를 기본 렌더링하지 않는다. 서버 권한 확인이 `allowed`일 때만 메뉴 모델에 항목을 추가한다.
- 관리자 콘솔 자체는 `hosting/admin/*`에서 독립 페이지로 다룬다. 새 content-script bridge를 먼저 열지 않고, short-lived launch token과 admin session token으로 권한을 확인한다.
- 클라이언트가 보낸 role/admin 플래그는 신뢰하지 않는다. i-Nova access token 검증 뒤 서버 allowlist 또는 `ops_admin_users/{providerUserKey}` 문서로 관리자 여부를 판단한다.
- 관리자 launch/session token은 Firestore 문서 키에 원문 secret을 저장하지 않는다. 저장 값은 hash만 둔다.
- launch 교환과 AdminSession bootstrap에서도 현재 관리자 권한을 다시 확인한다. 권한 회수 뒤 기존 session만으로 관리자 기능을 계속 열 수 있게 두지 않는다.
- 새 관리자 API는 raw 데이터/토큰/원문 prompt/대화 원문을 반환하지 않는다. 기능별 운영 데이터가 필요해질 때는 read-only summary부터 별도 endpoint로 추가한다.
- 관리자 페이지 기능을 붙일 때도 먼저 `AdminSession` 검증을 통과한 read-only API로 시작하고, 삭제/재처리/차단 같은 mutation은 별도 capability와 감사 로그 기준을 둔다.
- `hosting/admin/*`의 기본 shell은 PC/태블릿 폭을 기준으로 한 좌측 관리자 메뉴, 상단 권한 상태, 세션 요약, 본문 outlet, 보조 context, blocked view를 고정 영역으로 본다. 새 기능은 메뉴 항목과 본문 outlet section으로 하나씩 연결하고, 한 화면에 카드만 누적하지 않는다.
