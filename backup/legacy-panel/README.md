# Legacy Panel Backup

이 폴더는 현재 `1.0.0` v2 활성 bundle에서 더 이상 로드하지 않는 legacy extension panel 코드를 임시로 격리해 두는 자리다.

현재 옮겨 둔 대표 파일:

- `backup/legacy-panel/panel-composition-controller.js`
- `backup/legacy-panel/panel-action-controller.js`
- `backup/legacy-panel/panel-meeting-controller.js`
- `backup/legacy-panel/meeting-manager.js`
- `backup/legacy-panel/meeting-view.js`

기준은 아래와 같다.

- 활성 `manifest.json` / `content/main.js` / 현재 v2 bootstrap이 더 이상 참조하지 않는 코드만 옮긴다.
- `DB/Functions` 계약이나 shared runtime contract를 아직 직접 건드리는 파일은 섣불리 옮기지 않는다.
- legacy 코드를 활성 `content/*` 경로에 섞어 두고 adapter나 fallback으로 계속 살리는 것보다, 이 폴더로 격리해 `참고본`으로만 두는 쪽을 기본값으로 삼는다.
- 이 폴더는 평소 panel v2 migration 때 따라다니는 작업 경로가 아니다. `DB/Functions`나 shared server contract를 바꿀 때만 `0.4.4` 사용자 영향이 없는지 판단하려고 참조한다.
- 이 폴더에 들어온 코드는 기본적으로 `served asset`이나 `active bundle`로 취급하지 않는다.
- 이후 실제로 더 이상 참고 가치도 없으면 여기서도 삭제할 수 있다.
