# hosted meeting 작업 규칙

- 이 경로는 독립 feature가 아니라 `meeting` feature의 hosted 실행 표면이다.
- 먼저 [../../docs/feature-routing.md](../../docs/feature-routing.md)와 [../../content/features/meeting/AGENTS.md](../../content/features/meeting/AGENTS.md)를 읽고 시작한다.
- `hosting/meeting/*`만으로 해결되지 않으면 `shared/meeting-*`, 그다음 `background/service-worker.js`, 마지막에 `functions/features/meeting/*` 순서로 확장한다.
- hosted workspace Firebase auth claim은 `meetingId` 단위로 달라질 수 있으므로, `hosting/meeting/firebase-client.js`에서는 `synchronizeTabs: true` 같은 cross-tab Firestore persistence를 다시 켜지 않는다. 여러 회의 탭은 탭별 auth를 유지하고, persistence는 단일 탭 또는 메모리 fallback으로만 다룬다.
- prompt/release/conversation 영역은 기본적으로 읽지 않는다.
