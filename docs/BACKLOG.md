# Backlog

이 문서는 아직 구현하지 않을 아이디어와 후보 기능을 모아 두는 저장소 로컬 백로그 인덱스다.

백로그는 현재 제품 계약이나 배포 계획이 아니다. 구현이 시작되기 전까지는 `docs/backlog/*` 안에서만 정리하고, 실제 구현 slice가 결정되면 그때 관련 feature 문서와 코드로 승격한다.

## 운영 규칙

- 아이디어 1개는 `docs/backlog/<slug>.md` 문서 1개로 관리한다.
- 이 인덱스에는 현재 상태와 다음 판단만 짧게 둔다.
- 백로그 정리 요청은 기본적으로 `docs/BACKLOG.md`와 `docs/backlog/*`만 수정한다.
- 구현이 필요해지면 먼저 가장 작은 검증 가능한 slice를 고른 뒤 관련 feature 문서, E2E 문서, 코드 변경을 같은 작업 단위로 진행한다.
- 구현 완료 후에는 항목을 `shipped`로 표시하고 최종 정본 위치만 링크한다.

## 상태 값

| 상태 | 의미 |
| --- | --- |
| `idea` | 문제와 방향만 포착된 상태 |
| `needs-research` | 레퍼런스, 라이브러리, 권한, 비용, 보안 검토가 먼저 필요한 상태 |
| `ready-for-slice` | 첫 구현 slice와 검증 기준을 정할 수 있는 상태 |
| `in-progress` | 현재 작업 브랜치나 WIP 문서로 승격된 상태 |
| `shipped` | 구현과 검증이 끝나 정본 문서/코드로 이동한 상태 |
| `parked` | 보류하거나 당장 다루지 않기로 한 상태 |

## 항목

| 항목 | 상태 | 다음 판단 |
| --- | --- | --- |
| [Hosted tools portal](backlog/hosted-tools-portal.md) | `needs-research` | 레퍼런스 비교를 바탕으로 `Text-first`, `Image-first`, `PDF-first` 중 첫 MVP slice를 고른다. |
