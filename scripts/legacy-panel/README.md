# Legacy Panel Verify Namespace

이 폴더는 `backup/legacy-panel/*` reference 전용 검증 스크립트를 모아 두는 자리다.

기준은 아래와 같다.

- 현재 활성 `1.0.0` v2 bundle 검증은 계속 `scripts/verify-*.js` 루트 네임스페이스를 쓴다.
- legacy panel reference를 다시 봐야 할 때만 이 폴더의 스크립트를 직접 실행하거나 `npm.cmd run verify:legacy-backup`을 사용한다.
- 이 폴더의 스크립트는 active v2 migration 판단 기준이 아니라 `0.4.4` 영향 확인과 backup reference 유지용이다.
