# Lint Workflow

이 문서는 이 저장소의 lint 범위, 운영 기준, 예외 관리 방식을 따로 모아 두는 기준 문서다.

## 현재 기준

- 기본 엔진은 루트 `eslint.config.js`의 ESLint flat config다.
- 첫 도입 단계는 오류 탐지 중심으로만 운영한다. `eslint:recommended`를 기반으로 두고, 대량 style 정리 규칙은 아직 강제하지 않는다.
- 현재 baseline에서는 `no-unused-vars`를 활성화했고, `empty catch`는 허용한다. `preserve-caught-error`와 `no-control-regex`는 기존 코드 정리 전까지 보류한다.
- 현재 lint 대상은 `background/`, `content/`, `functions/`, `hosting/`, `popup/`, `scripts/`, `shared/`, `test-support/`, 루트 `eslint.config.js`다.
- `node_modules`, `functions/node_modules`, 임시 산출물 폴더(`output/`, `test-results/`, `tmp/`)는 제외한다.

## 실행 명령

- PowerShell 세션 기본값: `npm.cmd run lint`
- 자동 수정이 안전한 범위만 반영할 때: `npm.cmd run lint:fix`
- 기본 검증 루프: `npm.cmd run verify`
- `verify`는 lint 뒤에 구조 계약, 릴리스 패키지, 문서 검증을 이어서 실행한다.

## 운영 원칙

- 새 규칙은 한 번에 넓게 올리지 않는다. 필요한 오류 탐지부터 추가하고, 첫 도입 시 대량 style 정리를 요구하는 규칙은 뒤로 미룬다.
- lint 오류는 가능하면 코드 수정으로 해결한다. 예외가 필요하면 전역 ignore보다 파일 또는 라인 단위의 좁은 예외를 우선한다.
- `eslint.config.js`, lint 대상 범위, ignore/override, suppression, 관련 package script가 바뀌면 이 문서를 같은 작업 안에서 함께 갱신한다.
- 루트 `AGENTS.md`에는 lint 운영 원칙만 유지하고, 세부 규칙과 예외 이력은 이 문서에서 관리한다.

## 다음 확장 후보

- `preserve-caught-error` 같은 오류 경계 규칙을 다음 hygiene 후보로 검토
- staged 파일 대상 빠른 lint를 pre-commit에 붙일지 검토
- functions 전용 override가 필요해지면 루트 config 안에서 scope를 분리하고 이유를 이 문서에 기록
