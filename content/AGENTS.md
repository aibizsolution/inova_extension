# content 작업 규칙

- `content/` 전체를 먼저 읽지 않는다.
- 먼저 [../docs/feature-routing.md](../docs/feature-routing.md)에서 primary feature를 고른 뒤 `content/features/<feature>/AGENTS.md`부터 읽는다.
- `content/main.js`와 `content/panel.js`는 feature-local 파일과 owned-shared만으로 해결되지 않을 때만 읽는다.
- 다른 feature로 읽기 범위를 넓히기 전에는 짧게 왜 확장이 필요한지 설명한다.

