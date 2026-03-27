# inova_extension 작업 메모

이 문서는 이 저장소에서 반복 적용할 운영 원칙만 기록한다.

## 문서 유지 원칙
- 반복해서 다시 설명하게 되는 저장소 운영 결정은 이 문서에 계속 누적해 관리한다.
- 일회성 작업 로그보다 다음 작업에서도 바로 도움이 되는 기준과 원칙만 남긴다.
- 작업 중 새 운영 기준이 굳어지면 필요 시 이 문서를 스스로 갱신한다.
- 저장소 상태에 따라 필요하다고 판단되면 관련 변경을 커밋 단위까지 정리할 수 있다.

## 저장소 시작 규칙
- 새 클론이나 새 작업 환경에서는 가능하면 초기에 `npm install` 또는 `npm run hooks:install`로 로컬 Git 훅 연결 상태를 맞춘다.
- commit 전에는 `pre-commit`, push 전에는 `pre-push`, 원격에서는 GitHub Actions 가드레일이 다시 돈다는 전제를 두고 작업한다.
- 이 저장소는 사람 승인보다 자동 체크를 우선한다. PR은 기본이지만 권한 있는 사용자가 체크 통과 후 바로 머지할 수 있는 운영을 기준으로 본다.
- 로컬 훅에는 `post-checkout`, `post-merge`도 포함되며, `main` 기준으로 이미 머지된 `codex/*` 브랜치를 자동 정리한다.

## 릴리스 운영 원칙
- feature 변경을 push할 때는 `README.md`, `package.json`, `manifest.json`, `releases/release-notes.json`을 함께 맞춘다.
- 버전 상승은 `npm run version:bump -- <patch|minor|major>`를 기본으로 하고, 수동 수정으로 버전 파일만 따로 어긋나게 두지 않는다.
- 새 버전 엔트리의 `headline`, `summary`, `changes`에 `TODO`가 남아 있으면 push나 배포를 진행하지 않는다.
- Hosting 릴리스 메타(`latest.json`, `history.json`)는 `releases/release-notes.json` 기준으로 생성한다.
- 이 저장소에서 일반적인 `배포`는 `hosting-only`를 뜻한다. 함수 배포는 사용자가 `functions`, `backend`, `전체 배포`를 명시했을 때만 진행한다.
- GitHub Actions `Repo Guardrails` 워크플로가 실패하면 로컬에서 통과했더라도 바로 병합 가능 상태라고 가정하지 않는다.
- 기능 관련 소스나 설정을 바꾸면 `README.md`도 같은 작업 안에서 함께 갱신한다.
- `pre-push` README 가드가 막히면 우회보다 `README.md` 누락 여부부터 먼저 확인한다.

## Firebase 운영 원칙
- 이 저장소의 Firebase는 단일 기능 전용이 아니라 브라우저 확장 공통 플랫폼으로 사용한다.
- 현재 기준 Firebase 프로젝트 표시 이름은 `browser-extension`이고 프로젝트 ID는 `browser-extension-main`이다.
- Firestore 기본 리전은 `asia-northeast3`(Seoul)로 유지한다.
- Firebase 호출 전략은 `local-first`를 기본으로 한다.
- 평소 사용 흐름은 로컬 저장소만으로 끝나게 하고, 원격 호출은 백업/복구/명시적 동기화처럼 꼭 필요한 경우로 제한한다.
- 자동 클라우드 load는 로컬 프롬프트가 비어 있는 초기 복구 상황에서만 시도하고, 로컬 데이터가 있으면 원격 조회를 생략하는 방향을 우선한다.
- 새 기능을 붙일 때는 하나의 공용 데이터 덩어리로 섞지 말고 도메인/기능 경계별로 컬렉션과 책임을 분리한다.
- 공통 식별자나 최소 메타데이터만 공유하고, 기능별 데이터 스키마와 보안 규칙은 분리 설계한다.
- i-Nova 관련 데이터도 공통 플랫폼 안의 한 integration으로 다루고, 다른 서비스용 데이터와 직접 섞지 않는다.
- 공통 플랫폼을 쓰더라도 `account`, `prompt-library`, `backup-sync`, `integrations/*`, `ops-internal`처럼 도메인별 경계를 나눠 설계한다.
- `prompt-store`는 `prompt-library` 백업과 섞지 않고 별도 컬렉션/서브컬렉션으로 유지한다.
- `prompt-store` 공개 탐색은 항목 문서를 직접 페이지네이션하지 않고, 리스트 전용 page 문서와 detail 문서를 분리하는 방향을 우선한다.
- `prompt-store` 항목은 로컬 `prompt-library` 항목의 링크가 아니라 독립 복사본으로 다룬다.
- 스토어 등록 후 로컬 프롬프트를 수정해도 스토어 항목은 바뀌지 않게 유지하고, 스토어에서 가져오기는 동일 내용이어도 새 프롬프트 생성 흐름을 허용한다.
- 시스템 기본 프롬프트는 서브에이전트 역할 카탈로그 기준으로 별도 시드하고, 일반 사용자 소유 항목과 같은 컬렉션을 쓰더라도 `owner.kind=system`으로 구분한다.
- 시스템 시드 프롬프트는 사용자가 삭제할 수 없게 유지한다.
- 수동 배포용 릴리스 파일은 Firebase Hosting의 정적 JSON(`latest.json`, `history.json`)과 버전별 ZIP으로 관리하고, `latest.json`만 최신 버전을 가리키게 유지한다.
- 릴리스 안내 UI는 강한 모달 알림보다 조용한 상태 카드와 수동 다운로드/롤백 안내를 우선한다.
- Firebase Web API key를 실제로 쓰지 않으면 저장소에 남기지 않는다.
- Firebase Web API key가 노출되면 panic보다 `미사용 여부 확인 -> 코드 제거 -> 키 폐기` 순서로 대응한다.
- 사용자 기본 키는 raw email보다 안정적인 내부 식별자를 우선하고, 이메일은 보조 프로필 값으로만 다룬다.
- i-Nova access token은 현재 사용자 검증에만 쓰고, 저장 키나 영구 식별자로 직접 사용하지 않는다.
- i-Nova 연동이 필요한 외부 네트워크 호출은 페이지 스크립트보다 확장프로그램 백그라운드 서비스워커 경로를 우선한다. 페이지 CSP 영향이 크기 때문이다.

## Firebase CLI 원칙
- Firebase CLI는 저장소 로컬 설치보다 PC 전역 설치를 기본으로 사용한다.
- 이 PC의 전역 Firebase CLI 기본 계정은 `ytgoon@gmail.com`을 기준으로 사용한다.
- 다른 Firebase 계정이 필요한 예외 저장소만 별도 로컬 설치 또는 별도 인증 흐름으로 분리한다.
- Firebase 관리 작업은 가능하면 브라우저 수동 조작보다 CLI를 우선한다.

## 실제 브라우저 E2E 원칙
- 실제 UI/동기화 검증은 가능하면 사용자가 보는 Chrome 확장프로그램 기준으로 확인한다.
- 확장 리로드 후 `inova.incross.com`에서 `실험실` 패널 노출, 프롬프트 조작, 입력창 주입까지 한 흐름으로 확인한다.
- 원격 백업은 Firestore 콘솔을 매번 수동으로 보지 말고 `npm run check:cloud-sync -- --userKey <providerUserKey>`로 먼저 확인한다.
- 함수 호출 수는 `npm run check:function-logs -- --since <minutes>`로 먼저 요약해서 본다.
- 원격 백업 정상 기준은 `조작 직후 1회 갱신`과 `idle 상태 추가 갱신 없음`이다.
