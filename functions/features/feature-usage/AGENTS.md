# feature-usage 작업 규칙

- 목적은 익명 분석이 아니라 정식 기능 후보 판단과 인터뷰 대상 식별이다. 서버 저장의 정본 사용자 키는 `providerUserKey`다.
- raw click/event 로그, 프롬프트 원문, 대화 원문, URL, access token, IP, browser fingerprint는 이 feature에 저장하지 않는다.
- 클라이언트는 `providerUserKey + dayKey + clientInstanceId` 단위 cumulative counter snapshot만 보낸다.
- 서버는 `verifyInovaIdentity`로 검증된 owner만 신뢰한다. request payload의 identity는 검증 입력과 관리자 표시 snapshot 용도이며, 클라이언트가 보낸 user key를 doc id 근거로 직접 쓰지 않는다.
- 집계는 client/day snapshot 대비 `max(0, incoming - stored)` delta만 반영한다. duplicate, lower replay, cross-device snapshot은 이 규칙으로 처리한다.
- 새 action은 hosted tracker와 서버 allowlist에 함께 추가한다. 확장 ZIP 배포가 반복되지 않게 새 browser/runtime capability를 만들지 말고 기존 `metrics.feature-usage.commit` capability를 재사용한다.
- 새 action을 추가할 때도 Firestore client read/write는 열지 않는다. 관리자 조회는 Admin SDK script 또는 admin-only Function 뒤에 둔다.
- 실제 Chrome 풀 테스트에서는 의미 있는 action 1회를 실행한 뒤 flush를 기다리고 `npm.cmd run check:feature-usage -- --days 1 --limit 20`로 user/day aggregate 반영을 확인한다. 상용에서 이 검증은 실제 운영 count 1건을 남기는 절차다.
