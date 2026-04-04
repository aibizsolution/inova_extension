# hosted meeting 작업 규칙

- 이 경로는 독립 feature가 아니라 `meeting` feature의 hosted 실행 표면이다.
- 먼저 [../../docs/feature-routing.md](../../docs/feature-routing.md)와 [../../content/features/meeting/AGENTS.md](../../content/features/meeting/AGENTS.md)를 읽고 시작한다.
- `hosting/meeting/*`만으로 해결되지 않으면 `shared/meeting-*`, 그다음 `background/service-worker.js`, 마지막에 `functions/features/meeting/*` 순서로 확장한다.
- prompt/release/conversation 영역은 기본적으로 읽지 않는다.
