# Extension Runtime Platform Plan

이 문서는 `새 backend action / 새 Cloud Function / 새 기능 흐름 때문에 확장 프로그램을 다시 배포하지 않는다`는 목표를 구현하기 위한 기준이다.

핵심 전제는 바뀌었다.

- 이 확장은 Chrome Web Store 배포물이 아니라 내부 전사 프로그램이다. 스토어 정책은 remote/hosted logic 설계의 차단 사유가 아니다.
- extension은 권한을 가진 런타임 셸이다.
- 서버는 기능 정의를 manifest, workflow, 제한된 remote logic 형태로 배포할 수 있다.
- 원격 로직은 샌드박스에서 실행된다.
- 권한 경계는 extension이 강제한다.
- 신규 기능의 상당 부분은 확장 재배포 없이 서버 배포만으로 적용된다.

## A. 최종 방향 요약

- 기존 `서버는 데이터만 준다` 원칙은 목표에 비해 너무 보수적이다.
- 목표는 endpoint 변경만이 아니다. 신규 기능, 기능 조합, 기능 흐름, 일부 UI 동작까지 서버 배포만으로 바꾸는 것이다.
- 기본 경로는 `capabilityId -> manifest lookup -> adapter dispatch`다.
- manifest routing으로 부족한 기능은 `sandboxed remote logic layer`에서 처리한다.
- remote logic은 raw `chrome.*`, privileged storage, page DOM adapter, unrestricted fetch에 직접 접근하지 않는다.
- remote logic은 extension이 제공한 allowlisted bridge만 호출한다.
- hosted는 function/page/storage/browser 구분을 몰라야 한다.
- 새 Chrome permission, 새 host permission, 새 privileged primitive, 새 native integration이 필요할 때만 extension 재배포한다.
- 새 Cloud Function endpoint, hosted action, 기능 조합, lightweight workflow는 서버 배포만으로 처리하는 방향을 기본값으로 둔다.
- 원격 로직 허용은 무제한 원격 JS 실행 허용이 아니다.

## B. 최종 권장 아키텍처

### 1. Static Privileged Core

소유 위치:

- `background/*`
- `content/*`
- `manifest.json`
- 권한 경계를 다루는 일부 `shared/*`

책임:

- Chrome permissions
- host permissions
- privileged `chrome.*` API access
- token/storage boundary
- content/page privileged primitive
- background bridge implementation
- sandbox host/runtime loader
- security policy, allowlist, verify enforcement

결정:

- extension은 raw 제품 기능 구현체가 아니다.
- extension은 권한 런타임이다.
- 새 권한, 새 content DOM primitive, 새 privileged bridge kind, 새 sandbox host primitive는 extension 재배포 대상이다.
- remote logic은 이 core가 공개한 bridge API만 호출한다.
- privileged context에서 arbitrary remote JS를 직접 실행하지 않는다. 이 제한은 스토어 정책 때문이 아니라 내부 배포에서도 유지할 신뢰 경계다. 내부 승인 artifact, 버전/kill switch, 제한된 입력/출력 계약을 갖춘 hosted logic은 가능한 한 hosted/sandbox 쪽에 두고 extension은 최소 primitive만 공개한다.

### 2. Remote Capability Layer

소유 위치:

- `hosting/extension/capability-manifest.json`
- `hosting/extension-v2/capability-manifest.json`
- `background/capability-manifest-validator.js`
- `background/functions-runtime-config.js`
- `background/panel-runtime-capability-router.js`
- `hosting/extension-v2/panel/extension-capability-client.js`

책임:

- capabilityId catalog
- endpoint/target/lane resolution
- capability routing
- feature flag
- kill switch
- minExtensionVersion gating
- owner/domain tagging
- deprecation/replacement metadata
- request/response schema version
- hosted controller behavior mapping

결정:

- capabilityId를 hosted 기능의 유일한 public identifier로 만든다.
- hosted는 raw endpoint URL을 보유하지 않는다.
- hosted controller는 raw runtime action string을 직접 조립하지 않는다.
- endpointKey는 compatibility path로만 남긴다.
- compatibility path는 영구 유지하지 않는다.
- 새 function capability는 remote manifest에 `kind=function`, `endpointKey`, `service`, `authMode`, `owner`, `domain`, `inputSchemaVersion`, `outputSchemaVersion`을 등록해야 한다.

현재 구현 상태:

- `hosting/extension*/capability-manifest.json`에 semantic `capabilities` map을 추가했다.
- `hosting/extension*/capability-manifest.json`에 `urlTemplates` map을 추가했다. `browser.open-url` capability는 capability별 `templateKeys`와 top-level `urlTemplates`를 둘 다 통과해야 실행된다.
- `background/functions-runtime-config.js`는 `resolveCapabilityFunctionEndpoint()`로 active manifest의 target/lane/endpoint override를 실제 fetch URL로 해석한다.
- `background/capability-manifest-validator.js`는 remote manifest의 endpoint/capability/schema/workflow/lifecycle validation을 소유한다.
- `background/panel-runtime-capability-router.js`는 `capabilities.invoke`를 받아 manifest capability lookup 후 function adapter로 dispatch한다.
- v2 hosted prompt controllers는 prompt review/store/publish/sync mutation을 `invokeCapability(capabilityId, input)`로 호출한다.
- `functions.invoke-endpoint`는 legacy hosted bundle compatibility path로만 유지한다.
- `hosting/extension-v2/panel/extension-capability-client.js`의 compatibility metadata 기준 제거 목표는 `2026-05-31`이며 replacement는 `capabilities.invoke`다.

### 3. Sandboxed Remote Logic Layer

소유 위치:

- `hosting/extension-v2/panel/remote-workflow-sandbox.html`
- `hosting/extension-v2/panel/remote-workflow-sandbox.js`
- `hosting/extension-v2/panel/remote-workflow-host.js`
- `hosting/extension-v2/panel/extension-capability-client.js`
- `hosting/extension*/capability-manifest.json`의 `workflowArtifacts` / `workflowPilot` / `workflow` capability metadata

책임:

- manifest routing만으로 부족한 신규 기능 흐름 실행
- registry 기반 workflow/script 실행
- lightweight conditional flow
- feature composition
- 일부 UI behavior orchestration

실행 단위:

- raw arbitrary JS string이 아니다.
- registry된 `workflowId`, `scriptSlot`, `bundleId`, `versionedArtifact`만 허용한다.
- artifact는 version pinned 상태로 manifest에 기록한다.
- artifact는 audit/debug metadata를 가져야 한다.

허용 bridge 예시:

- `invokeCapability(capabilityId, input)`
- `readPanelState()`
- `writeUiPreferences(partial)`
- `openUrl(templateKey, input)`
- `invokePageCapability(pageCapabilityId, input)`
- `emitTrace(channel, step, payload)`
- `metrics(eventName, payload)`

금지:

- raw `chrome.*`
- privileged storage 직접 접근
- arbitrary selector 기반 page 조작
- arbitrary DOM script
- unrestricted fetch
- `eval` 성격의 임의 문자열 실행
- unsigned/unversioned/anonymous script payload 실행

운영 조건:

- lane gating 필수
- kill switch 필수
- manifest/script version pinning 필수
- audit/debug metadata 필수
- degraded fallback reason 필수
- production pilot 전까지 disabled default

### 4. Capability Handshake

panel boot 시 hosted와 background는 capability catalog를 negotiation한다.

응답 catalog 필드:

- `capabilityId`
- `kind`
- `schemaVersion`
- `owner`
- `domain`
- `lane`
- `enabled`
- `deprecatedAt`
- `replacementId`
- `killSwitch`
- `minExtensionVersion`
- `inputSchemaVersion`
- `outputSchemaVersion`

결정:

- hosted는 handshake 결과에 없는 기능을 렌더링하지 않는다.
- remote workflow도 handshake catalog에 없는 bridge API를 호출할 수 없다.
- killed capability는 UI 노출과 실행이 모두 막혀야 한다.
- degraded reason은 panel trace/debug에 남긴다.

현재 구현 상태:

- `background/panel-runtime-capability-router.js`가 `capabilities.handshake`를 제공한다.
- handshake 응답은 active manifest catalog, enabled capability ids, runtime actions, bridge API allowlist, source/degraded metadata를 포함한다.
- sandbox bridge API allowlist는 `contracts/extension-contract.json`의 `sandboxBridgeApis`와 `scripts/verify-contracts.js`로 고정한다.
- `hosting/extension-v2/panel/index.js`는 snapshot boot 직후 handshake를 호출하고, static extension capabilities와 enabled remote capability ids를 합쳐 hosted controllers에 전달한다.
- killed/disabled capability는 handshake의 `enabledCapabilityIds`에서 제외된다.
- prompt review, prompt library, prompt store는 negotiated capabilityId 기준으로 write/action UI 노출과 실행을 1차 차단한다.
- meeting hub는 `meeting.share.create-function`, `meeting.share.revoke-function` handshake capability가 enabled일 때만 공유 생성/해제 UI와 실행을 열고, 실행도 `invokeCapability()`를 통해 manifest function endpoint resolution을 따른다.
- conversation controller는 `page.conversation.read-dom-snapshot` 또는 fallback `page.conversation.read-state`, `page.conversation.jump-item`, `page.clipboard.write-text` handshake capability가 enabled일 때만 읽기/이동/복사 UI와 실행을 연다.
- controller-level action gating 1차는 완료됐다.
- hosted panel shell의 `panel.ui-preferences.write`도 handshake 이후에는 enabled capability일 때만 실행한다. disabled 상태에서는 runtime dispatch 전에 explicit error/trace/toast로 멈춘다.

## C. 단계별 실행안

### Phase 3. Remote Endpoint/Target Resolution

목적:

- `functions.invoke-endpoint`와 `capabilities.invoke`가 remote manifest의 endpoint/target/lane을 실제 URL 해석에 사용한다.

왜 필요한지:

- 새 Cloud Function endpoint/path 변경을 extension 재배포 없이 처리하기 위해서다.

실제 변경 파일:

- `background/functions-runtime-config.js`
- `background/capability-manifest-validator.js`
- `background/panel-runtime-capability-router.js`
- `hosting/extension/capability-manifest.json`
- `hosting/extension-v2/capability-manifest.json`
- `scripts/verify-runtime-capability-router.js`

완료 기준:

- remote manifest의 endpoint override가 실제 fetch URL에 반영된다.
- production/local target은 allowed Functions origin만 통과한다.
- manifest fetch/validation 실패는 degraded fallback으로 드러난다.

verify 기준:

- remote endpoint URL override 테스트
- expired manifest fallback 테스트
- unknown origin fallback 테스트
- unsupported method fallback 테스트
- missing schema fallback 테스트
- fetch failure fallback 테스트

배포/롤아웃 주의점:

- remote manifest target은 허용된 Functions origin만 쓴다.
- fallback은 성공처럼 숨기지 않는다.
- 이 Phase의 변경은 extension background 코드 변경이므로 현재 bundle에는 extension 새로고침/재배포가 필요하다.

현재 상태:

- 구현됨.

### Phase 3.5. CapabilityId를 Public Identifier로 고정

목적:

- hosted가 endpointKey/runtime action을 직접 알지 못하게 한다.

왜 필요한지:

- transport 구분을 숨겨야 서버 manifest만으로 기능 ownership을 바꿀 수 있다.

실제 변경 파일:

- `hosting/extension-v2/panel/extension-capability-client.js`
- `hosting/extension-v2/panel/prompt-review-controller.js`
- `hosting/extension-v2/panel/prompt-store-controller.js`
- `hosting/extension-v2/panel/prompt-library-controller.js`
- `contracts/extension-contract.json`
- `scripts/verify-hosted-panel-bridge.js`

완료 기준:

- 신규 hosted feature 호출은 `invokeCapability(capabilityId, input)`만 사용한다.
- prompt review/store/publish/sync mutation은 capabilityId 기반으로 호출한다.
- `functions.invoke-endpoint`는 compatibility path로만 남는다.

verify 기준:

- hosted controller raw runtime action literal 차단
- prompt store controller endpointKey literal 차단
- runtime action catalog에 `capabilities.invoke` 포함

배포/롤아웃 주의점:

- endpointKey 호출 path 제거 목표는 `2026-05-31`로 둔다.
- 오래된 hosted bundle과의 호환을 위해 `invokeFunctionEndpoint`는 당장 삭제하지 않는다.

현재 상태:

- 1차 구현됨.
- hosted controller endpointKey/raw function runtime action 제거 guard는 전체 v2 hosted controller 파일로 확대됨.
- `functions.invoke-endpoint` compatibility path는 client metadata와 verify에서 `2026-05-31` 제거 목표를 확인한다.

### Phase 4. Semantic Capability Catalog

목적:

- manifest에 `capabilities` map을 둔다.

왜 필요한지:

- endpoint 호출뿐 아니라 browser/page/storage/workflow 기능 조합까지 서버 배포로 바꾸기 위해서다.

실제 변경 파일:

- `hosting/extension*/capability-manifest.json`
- `background/functions-runtime-config.js`
- `background/panel-runtime-capability-router.js`
- `scripts/verify-runtime-capability-router.js`

완료 기준:

- `kind=function` capability가 capabilityId로 실행된다.
- capability마다 `owner`, `domain`, `authMode`, `inputSchemaVersion`, `outputSchemaVersion`, `minExtensionVersion`을 가진다.
- disabled/killed capability는 실행되지 않는다.

verify 기준:

- unknown capabilityId 실패
- disabled capability 실패
- raw URL 형태 capabilityId 실패
- missing schema 실패
- unknown/unsupported kind 실패

배포/롤아웃 주의점:

- destructive/write capability는 `authMode`와 audit metadata를 필수로 둔다.
- 새 capability kind는 verify/docs/guard 없이 추가하지 않는다.

현재 상태:

- `kind=function` catalog와 dispatch가 구현됨.
- `kind=browser.open-url`은 `urlTemplates` 데이터 기반으로 동작한다. hosted는 `templateKey + params`만 넘기고 background가 manifest `origin/pattern/params`로 실제 URL을 조립한다. 기존 Hosting origin 안의 새 URL template은 Hosting 배포만으로 추가할 수 있고, 새 origin은 extension 재배포 대상이다.
- `kind=storage.write-ui-preferences`는 `panel.ui-preferences.write` capability로 1차 구현됨. hosted는 `writeUiPreferences(partial)` helper를 유지하되 내부 dispatch는 capabilityId 기반이다.
- `kind=page.capability`는 `page.*` semantic capability로 1차 구현됨. hosted `invokeCapability(capabilityId, input)`은 handshake catalog에서 `page.capability` kind를 보면 allowlisted `invokePageCapability(pageCapabilityId, input)`로 dispatch한다.
- `workflow` kind는 아직 pilot 전이다.

현재 허용 adapter kind:

| kind | extension adapter | manifest만 변경 가능 | extension 재배포 필요 |
| --- | --- | --- | --- |
| `function` | Functions fetch | endpoint path, lane override, enable/kill/alias | 새 Functions origin 또는 새 auth primitive |
| `browser.open-url` | tab open URL template | 기존 Hosting origin의 새 path template | 새 URL origin 또는 새 browser primitive |
| `storage.write-ui-preferences` | UI preference write | gate/lane/kill/alias | 새 privileged storage operation |
| `page.capability` | named page primitive | semantic id/gate/lane/kill/alias | 새 page primitive |
| `workflow` | sandbox workflow host | pilot artifact metadata | 새 bridge/sandbox primitive |

### Phase 5. Page Primitive 선탑재

목적:

- remote capability와 remote workflow가 조합할 수 있는 page primitive를 넉넉히 준비한다.

왜 필요한지:

- page DOM adapter가 부족하면 신규 기능마다 extension 재배포가 필요해진다.

실제 변경 파일:

- `content/page-capability-router.js`
- `contracts/extension-contract.json`
- page verify scripts

완료 기준:

- composer read/apply
- selection read
- current conversation facts
- safe focus/scroll
- clipboard
- trace primitive
- named primitive catalog

verify 기준:

- arbitrary selector 금지
- arbitrary DOM script 금지
- named primitive만 허용

배포/롤아웃 주의점:

- primitive는 넓게 준비한다.
- 데이터 추출 범위는 좁게 고정한다.
- 새 primitive는 extension 재배포 대상이다.

현재 상태:

- `content/page-capability-router.js`는 canonical page primitive를 `PAGE_CAPABILITY_MANIFEST`와 adapter table로 dispatch한다.
- `hosting/extension-v2/panel/extension-capability-client.js`는 `invokePageCapability(pageCapabilityId, input)` bridge를 제공하고 기존 page helper도 이 경로를 사용한다.
- `invokePageCapability`는 `PAGE_CAPABILITY_IDS` allowlist에 없는 page capability를 content로 전달하지 않는다.
- hosted capability handshake 결과는 `pageCapabilityIds`를 포함해 remote workflow 준비 단계에서 page primitive catalog를 함께 볼 수 있게 한다.
- hosted conversation controller는 `page.conversation.read-dom-snapshot`을 우선 사용해 content가 읽은 최소 DOM fact를 hosted `conversation-dom-parser.js`에서 해석한다. `page.conversation.read-state`는 기존 bundle과 parser 실패 시 fallback으로 남긴다.
- hosted conversation controller는 `page.conversation.read-dom-snapshot` 또는 `page.conversation.read-state`, `page.conversation.jump-item`, `page.clipboard.write-text`가 handshake에서 enabled일 때만 읽기/이동/복사 UI와 실행 경로를 연다.
- 기존 primitive 실행 결과는 유지한다.
- arbitrary selector/DOM script primitive는 추가하지 않았다.
- reviewer cleanup에서 `page.scroll-to(targetKey)`, `page.highlight-range(selectionKey)`, `page.show-banner(templateKey, params)`, `page.read-selection()`, `page.dispatch-named-event(eventKey)`를 추가했다.
- 새 primitive는 모두 allowlisted key만 받는다. raw selector, raw HTML, raw JS, raw event name은 받지 않는다.

### Phase 5.5. Schema Registry 강화

목적:

- request/response schema를 capability별로 고정한다.

왜 필요한지:

- remote logic이 늘어나면 payload drift가 장애 원인이 된다.

실제 변경 파일:

- `contracts/extension-contract.json`
- future capability schema JSON
- verify scripts

완료 기준:

- capability마다 `inputSchemaVersion`, `outputSchemaVersion`, `authMode`, `auditLevel`을 가진다.
- write/destructive capability는 schema 없으면 실패한다.

verify 기준:

- schema 없는 write/destructive capability 실패
- auditLevel 없는 capability 실패
- function write/auth capability가 `authMode=none`이면 실패
- response schema drift 감지

배포/롤아웃 주의점:

- schema 변경은 additive default를 우선한다.

현재 상태:

- active manifest validation은 `inputSchemaVersion`, `outputSchemaVersion`, `authMode`, `auditLevel`을 필수로 본다.
- function write/auth capability는 `authMode=none`을 허용하지 않는다.

### Phase 6. Hosted Abstraction 완료

목적:

- hosted panel이 transport/runtime/page/storage/browser를 모르게 만든다.

왜 필요한지:

- hosted JS는 제품 UI와 흐름만 소유해야 한다.
- 권한 실행은 extension runtime shell이 소유해야 한다.

실제 변경 파일:

- `hosting/extension-v2/panel/extension-capability-client.js`
- hosted controllers
- hosted verify scripts

완료 기준:

- hosted feature controller는 capabilityId와 input만 전달한다.
- endpointKey와 raw runtime action string은 extension capability client 내부 compatibility path로만 남는다.

verify 기준:

- hosted controller에서 `functions.invoke-endpoint` 직접 조립 차단
- hosted controller에서 endpointKey 신규 사용 차단
- raw URL 전달 차단

배포/롤아웃 주의점:

- compatibility path 제거 날짜는 `2026-05-31`이며 문서와 guard가 함께 확인한다.
- `2026-04-30`까지 v2 hosted에서 `invokeFunctionEndpoint` 사용 grep 0을 유지한다.
- `2026-05-31` 이후 첫 릴리스에서 `invokeFunctionEndpoint` helper, router의 `functions.invoke-endpoint` branch, 해당 compatibility verify를 삭제한다.
- 삭제 PR에는 hosted 코드에 `endpointKey:` 또는 `functions.invoke-endpoint` literal이 남으면 실패하는 grep/lint guard를 추가한다.

### Phase 6.5. Sandboxed Remote Logic 기반

목적:

- registry 기반 remote workflow/script 실행 환경을 준비한다.

왜 필요한지:

- manifest routing만으로는 신규 기능 흐름, 조건 분기, 작은 UI 행동까지 무배포로 확장하기 어렵다.

실제 변경 파일:

- `hosting/extension-v2/panel/remote-workflow-host.js`
- `hosting/extension-v2/panel/remote-workflow-sandbox.html`
- `hosting/extension-v2/panel/remote-workflow-sandbox.js`
- `hosting/extension-v2/panel/extension-capability-client.js`
- `hosting/extension-v2/panel/index.js`
- `background/capability-manifest-validator.js`
- `background/panel-runtime-capability-router.js`
- `scripts/verify-remote-workflow-sandbox.js`
- `scripts/verify-runtime-capability-router.js`

완료 기준:

- hosted panel이 sandbox iframe host를 boot한다.
- sandbox가 privileged API 없이 boot된다.
- sandbox는 allowlisted bridge만 호출한다.
- registry된 workflow/script artifact만 실행한다.

verify 기준:

- sandbox에서 `chrome` 접근 실패
- privileged storage 접근 실패
- raw page DOM 접근 실패
- unrestricted fetch 접근 실패
- eval 문자열 실행 실패

배포/롤아웃 주의점:

- production capability는 disabled default로 둔다.
- pilot 전까지 read/light-write만 허용한다.

현재 상태:

- `workflow` capability는 기본적으로 disabled 또는 killed 상태만 manifest validation을 통과한다.
- enabled workflow는 top-level `workflowPilot.enabled=true`, `workflowPilot.killSwitch.enabled=false`, active lane allowlist, capability `pilot=true`, capability kill switch metadata, artifact pin을 모두 만족해야만 통과한다.
- workflow capability는 top-level `workflowArtifacts` registry에 등록된 `artifactId + artifactVersion`만 참조할 수 있다.
- workflow artifact는 allowlisted `scriptSlot`, `bundleId`, `integrity` pin을 필수로 가진다.
- workflow artifact에 raw `code`, `script`, `source`, `url`, `fetchUrl`, `endpointUrl` payload field가 있으면 remote manifest validation에서 fallback으로 떨어진다.
- hosted v2 panel은 `remote-workflow-host.js`로 hidden sandbox iframe을 만들고, iframe은 `sandbox="allow-scripts"`만 받는다. `allow-same-origin`은 주지 않는다.
- sandbox HTML은 `connect-src 'none'` CSP를 가진다. sandbox runtime은 `chrome`, `fetch`, storage, arbitrary network globals를 blocked global로 취급한다.
- sandbox bridge host는 handshake의 `bridgeApis` allowlist 안에 있는 API만 처리한다. allowlist 밖 API 요청은 explicit error로 반환한다.
- sandbox runtime은 raw JS가 아니라 declarative workflow step만 해석한다. 현재 허용 step은 allowlisted bridge call뿐이다.
- hosted sandbox host는 artifact registry의 `bundleId + artifactVersion`으로 same-origin `./workflows/<bundleId>/<artifactVersion>.json`만 fetch한다.
- workflow artifact는 `sha256-*` integrity를 통과해야 sandbox에 전달된다. integrity verifier가 없거나 mismatch이면 explicit error다.
- hosted capability client는 `kind=workflow` capability를 보면 background로 보내지 않고 sandbox host로 dispatch한다.
- `workflow.run`은 `pilotEnabled=true`가 없으면 disabled 상태다. production manifest의 workflow는 별도 pilot gate 없이는 enabled 상태로 통과하지 않는다.

### Phase 7. Negotiation / Kill Switch / Rollout Guard

목적:

- capability와 workflow를 안전하게 켜고 끄는 운영 체계를 만든다.

왜 필요한지:

- 서버 배포만으로 기능이 바뀌면 빠른 차단 장치가 필요하다.

실제 변경 파일:

- manifest schema
- router handshake
- hosted boot logic
- verify scripts

완료 기준:

- lane gating 동작
- minExtensionVersion 동작
- kill switch 동작
- deprecated alias 동작
- replacementId 동작
- hosted boot handshake 동작

verify 기준:

- killed capability는 UI 노출과 실행이 모두 막힌다.
- degraded reason은 trace/debug에 남는다.
- disabled capability는 `enabledCapabilityIds`에서 빠진다.

배포/롤아웃 주의점:

- kill switch 없는 remote workflow는 production에 켜지 않는다.

현재 상태:

- 1차 handshake 구현됨.
- `capabilities.handshake`가 catalog와 bridge API allowlist를 반환한다.
- bridge API allowlist는 `emitTrace`, `invokeCapability`, `invokePageCapability`, `metrics`, `openUrl`, `readPanelState`, `writeUiPreferences`만 허용하도록 contract/verify로 고정됨.
- remote manifest의 `capabilityId`는 lower-case semantic id 형식만 허용한다. URL, runtime action string처럼 transport를 드러내는 identifier는 manifest validation에서 실패한다.
- capability별 `minExtensionVersion`은 remote manifest 전체 fallback 사유가 아니다. handshake에서 `enabled=false`와 `minExtensionVersionSupported=false`로 내려가고, invoke 시 명시적으로 실패한다.
- `deprecatedAt`가 있는 capability는 같은 manifest 안의 유효한 `replacementId`를 가져야 한다. `replacementId`만 있는 vague compatibility path도 manifest validation에서 실패한다.
- top-level `aliases` map은 `aliasId -> replacementId`와 `removeAfter`를 필수로 가진다. alias는 기존 capabilityId와 충돌할 수 없고, router는 alias invoke를 replacement capability로 해석한다.
- killed, lane mismatch, minExtensionVersion mismatch capability는 handshake의 `enabledCapabilityIds`에서 빠지고 invoke도 명시적으로 실패하도록 verify가 고정한다.
- `test.*` capability는 `testOnly=true`가 필수이며, test-only capability는 production manifest에서 enabled 상태로 둘 수 없다. handshake에는 노출되더라도 `enabledCapabilityIds`에 들어가지 않고 invoke는 실패한다.
- hosted boot가 handshake catalog를 읽어 enabled capability ids를 controller capability list에 합친다.
- prompt review, prompt library, prompt store는 missing/killed capability의 UI action 노출과 실행을 1차 차단한다.
- meeting hub는 missing/killed share function capability의 UI action 노출과 실행을 차단하고 explicit capability-disabled reason을 남긴다.
- conversation controller는 missing/killed page read/jump/clipboard capability의 UI action 노출과 실행을 차단하고 explicit capability-disabled reason을 남긴다.
- `workflow` kind는 manifest 검증에서 kill switch metadata를 필수로 요구한다. enabled workflow는 `workflowPilot` gate와 capability `pilot=true`를 모두 만족해야 한다.
- controller-level required extension capability와 remote action capability 분리는 1차 완료됐다.
- hosted panel shell의 cross-controller preference write 경로도 `panel.ui-preferences.write` capability gate를 탄다.

### Phase 7.5. 자동 문서화와 금지 패턴 강화

목적:

- capability catalog를 사람이 읽는 문서와 guard로 자동 유지한다.

왜 필요한지:

- remote platform은 catalog drift가 가장 큰 위험이다.

실제 변경 파일:

- docs generator
- verify scripts
- `docs/remote-capability-manifest-plan.md`
- `docs/capability-authoring.md`
- `docs/capability-catalog.md`

완료 기준:

- manifest에서 capability catalog 문서가 생성된다.
- generated catalog가 manifest와 drift 없이 유지된다.
- docs drift를 verify가 잡는다.

verify 기준:

- docs drift 실패
- raw URL 실패
- raw runtime action 실패
- unknown adapter 실패
- permanent compatibility path 실패

배포/롤아웃 주의점:

- test-only capability와 production capability를 분리한다.

현재 상태:

- `scripts/generate-capability-catalog.js`가 `hosting/extension-v2/capability-manifest.json`에서 `docs/capability-catalog.md`를 생성한다.
- `scripts/verify-docs.js`가 generated catalog drift를 실패 처리한다.
- `docs/capability-authoring.md`가 새 capability 추가 절차와 extension 재배포 기준을 고정한다.
- test-only capability는 validator와 runtime router verify에서 production enabled 노출을 차단한다.

### Phase 8. Sandboxed Remote Workflow Pilot

목적:

- 실제 신규 기능 하나를 extension 재배포 없이 remote workflow로 배포한다.

왜 필요한지:

- 설계가 실제 무배포 기능 확장에 충분한지 확인해야 한다.

pilot 후보:

- release help/open flow
- prompt store import confirmation flow
- prompt review post-action flow

완료 기준:

- workflow artifact 교체만으로 기능 흐름이 바뀐다.
- workflow는 allowlisted bridge만 호출한다.

verify 기준:

- workflow version pinning
- kill switch
- degraded fallback
- bridge audit log

배포/롤아웃 주의점:

- 처음에는 read/light-write workflow만 허용한다.

## D. 더 밀어붙일 수 있는 추가 보강안

1. Capability alias/deprecation registry
   - 기대 효과: capability 이름 변경을 서버 manifest만으로 흡수한다.
   - 상태: top-level alias map, `removeAfter`, replacement validation, runtime alias invoke, hosted page alias cache, generated catalog alias section까지 1차 구현됨.
   - 다음 확장: 실제 manifest alias를 추가할 때 `removeAfter`와 catalog drift guard를 같이 유지한다.
   - 리스크: alias가 오래 남으면 복잡해진다. 제거 기한을 계속 필수화한다.

2. Test-only capability 표준
   - 기대 효과: 새 endpoint/action을 production 노출 없이 검증한다.
   - 비용: manifest lane/test flag 추가.
   - 리스크: test capability가 production에 노출되지 않도록 guard가 필요하다.

3. Page primitive inventory 확대
   - 기대 효과: remote workflow가 extension 재배포 없이 더 많은 기능을 조합한다.
   - 비용: content adapter와 contract 증가.
   - 리스크: arbitrary DOM 접근으로 번지지 않게 named primitive만 허용한다.

4. Workflow artifact registry
   - 기대 효과: remote logic을 versioned artifact 단위로 감사할 수 있다.
   - 상태: manifest `workflowArtifacts` registry, artifact version pinning, allowlisted scriptSlot, integrity metadata, raw payload field rejection, same-origin artifact loader/cache를 1차 구현함. debug UI는 아직 열지 않았다.
   - 비용: pilot workflow artifact, rollout/debug UI 필요.
   - 리스크: unsigned/unpinned artifact 실행을 금지해야 한다.

5. Capability catalog 자동 문서 생성
   - 기대 효과: 팀이 현재 서버 배포 가능 범위를 즉시 파악한다.
   - 비용: generator script 추가.
   - 리스크: generated doc drift guard 필요.

## E. 명시적 금지선

- privileged context에서 arbitrary remote JS를 직접 실행하지 않는다.
- hosted가 raw endpoint URL을 보유하지 않는다.
- hosted/controller가 raw runtime action string을 직접 조립하지 않는다.
- remote logic이 `chrome.*`, content/page privileged API, privileged storage에 직접 접근하지 않는다.
- arbitrary selector 기반 page 조작을 허용하지 않는다.
- arbitrary DOM script를 허용하지 않는다.
- unrestricted fetch를 허용하지 않는다.
- unsigned, unversioned, anonymous script payload를 실행하지 않는다.
- 새 privileged bridge는 verify/docs/guard 없이 추가하지 않는다.
- compatibility path는 영구 유지하지 않는다.
- kill switch 없는 remote workflow는 production에 켜지 않는다.

## F. 에이전트 실행용 TODO

현재 상태:

- Phase 3~7.5의 platform foundation은 1차 구현됨.
- reviewer cleanup에서 Phase 5 page primitive 확장, meeting share `invokeCapability` 이관, data-driven `urlTemplates`, manifest kill/lane/alias seed, authoring docs가 반영됨.
- member-info workflow pilot은 검증 후 원복됨.
- 다음 새 engineering slice는 Phase 8 pilot을 명시적으로 고른 뒤 시작한다.

다음에 먼저 볼 파일:

- `docs/current-handoff.md`
- `docs/remote-capability-manifest-plan.md`
- `docs/capability-catalog.md`
- `docs/capability-authoring.md`
- `background/functions-runtime-config.js`
- `background/capability-manifest-validator.js`
- `background/panel-runtime-capability-router.js`
- `hosting/extension-v2/panel/extension-capability-client.js`
- `hosting/extension-v2/panel/remote-workflow-host.js`
- `hosting/extension-v2/panel/remote-workflow-sandbox.js`
- `scripts/verify-runtime-capability-router.js`
- `scripts/verify-remote-workflow-sandbox.js`

새 pilot을 고른 뒤 수정할 후보:

- `hosting/extension*/capability-manifest.json`
- `hosting/extension-v2/panel/workflows/<bundleId>/<artifactVersion>.json`
- `hosting/extension-v2/panel/<pilot-controller-or-view>.js`
- `scripts/verify-remote-workflow-sandbox.js`
- `scripts/verify-runtime-capability-router.js`
- `docs/capability-catalog.md` via generator
- pilot feature 문서

pilot 시작 전 확인할 것:

- 현재 primitive catalog 조합만으로 가능한가?
- 새 Chrome permission, host permission, content DOM primitive, privileged bridge가 필요한가?
- 필요한 경우 extension redeploy 대상임을 먼저 문서화했는가?
- workflow가 read/light-write 범위를 넘지 않는가?
- kill switch, lane gate, `pilot=true`, version pin, integrity pin, audit/debug metadata, degraded reason이 모두 있는가?

verify에 유지할 것:

- remote endpoint URL 우선 해석
- capabilityId 실행
- killed/disabled/minVersion/lane mismatch UI 노출 및 실행 차단
- unknown kind와 missing schema 실패
- raw URL/raw runtime action string 금지
- workflow artifact version/integrity/slot validation
- sandbox bridge allowlist
- generated catalog docs drift

pilot으로만 열어야 할 것:

- enabled `workflow` capability
- script-slot/bundle artifact loader의 실제 production use
- bridge 기반 UI 행동 변경
- page primitive 조합 workflow

절대 하지 말아야 할 것:

- privileged background/content에서 remote JS 실행
- arbitrary selector/DOM script 허용
- raw endpoint URL을 hosted request에 넣기
- unrestricted fetch bridge 열기
- unsigned/unversioned artifact 실행
- kill switch 없는 workflow를 production에 켜기
- verify 없이 새 adapter kind 추가
