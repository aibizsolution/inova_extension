# Capability Authoring

이 문서는 새 기능을 extension 수정이 아니라 capability manifest 수정으로 시작하게 만드는 작업 가이드다.

## 기본 결정

- hosted/controller의 public entrypoint는 `capabilityId`다.
- hosted는 raw endpoint URL, raw runtime action string, endpointKey를 새로 들지 않는다.
- 새 Cloud Function endpoint, endpoint path, capability enable/disable, kill switch, lane gate, alias는 manifest와 Hosting 배포로 처리한다.
- 권한 경계는 extension이 가진다. manifest는 권한을 만들지 못하고, 이미 extension이 가진 primitive만 조합한다.

## 추가 절차

1. `kind`를 고른다.
   - `function`: Functions endpoint 호출.
   - `browser.open-url`: manifest `urlTemplates`에 등록된 Hosting URL 열기.
   - `storage.write-ui-preferences`: panel UI preference write.
   - `page.capability`: `content/page-capability-router.js`에 있는 named page primitive 호출.
   - `workflow`: Phase 8 pilot 전용. production은 disabled default다.
2. `hosting/extension-v2/capability-manifest.json`과 `hosting/extension/capability-manifest.json`을 같은 내용으로 편집한다.
3. capability에는 `owner`, `domain`, `authMode`, `auditLevel`, `inputSchemaVersion`, `outputSchemaVersion`, `minExtensionVersion`을 채운다.
4. 새 endpoint면 `endpointKeys`에 safe relative endpoint path를 추가한다. 새 URL이면 `urlTemplates`에 `origin`과 `pattern`을 추가한다.
5. 필요하면 `killSwitch`, `lane`, `deprecatedAt`, `replacementId`, top-level `aliases`를 같이 추가한다.
6. `node scripts/generate-capability-catalog.js > docs/capability-catalog.md`로 catalog를 재생성한다.
7. `npm.cmd run verify`를 통과시킨다.
8. extension 권한/primitive가 바뀌지 않았다면 Hosting 배포만 한다.

## Extension 재배포가 필요한 경우

- 새 Chrome permission.
- 새 host permission 또는 새 URL template origin.
- 새 content DOM primitive.
- 새 privileged background adapter kind.
- 새 web accessible resource.
- 새 sandbox host primitive 또는 privileged bridge API.

## Manifest만으로 가능한 경우

- 기존 Functions origin 안의 새 endpoint path.
- 기존 Hosting origin 안의 새 `urlTemplates` path.
- 기존 page primitive를 가리키는 새 semantic capabilityId.
- capability enable/disable, kill switch, lane gate, min extension version.
- capability alias, deprecation, owner/domain tagging.

## 금지선

- hosted/controller가 raw endpoint URL을 갖지 않는다.
- hosted/controller가 `functions.invoke-endpoint`나 raw runtime action string을 새로 조립하지 않는다.
- `browser.open-url`은 `urlTemplates`에 없는 `templateKey`를 열지 않는다.
- page capability는 raw selector, raw HTML, raw DOM script를 받지 않는다.
- workflow artifact는 unsigned/unversioned/raw JS string으로 실행하지 않는다.

## Naming

- function capability: `<domain>.<action>-function` 또는 이미 정착된 semantic id를 쓴다.
- page capability: `page.<domain>.<verb>`를 쓴다.
- browser URL capability: `<domain>.<thing>.open`을 쓴다.
- alias는 top-level `aliases`에 두고 `removeAfter`를 필수로 둔다.
