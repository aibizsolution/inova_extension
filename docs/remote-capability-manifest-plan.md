# Remote Capability Manifest Plan

이 문서는 `새 backend action / 새 Cloud Function / endpoint URL 변경 때문에 확장 프로그램을 다시 배포하지 않는다`는 운영 철학을 구현하기 위한 후속 설계 기준이다.

## 결정

- 장기 목표는 `remote capability manifest` 방식이다.
- extension은 browser-only 권한 실행기와 검증된 capability dispatcher만 맡는다.
- hosted/functions가 제품 기능, endpoint 목록, URL/runtime config의 변경 속도를 소유한다.
- 새 서버 기능이나 hosted UI 기능 추가는 기본적으로 `hosting/functions 배포 + remote manifest 갱신`으로 끝내고, extension ZIP 재배포를 요구하지 않는다.

## 왜 필요한가

현재 active v2 구조는 대부분 hosted-first로 정리되었지만, 아래 두 파일은 아직 extension bundle 안에서 runtime capability와 endpoint/runtime config를 고정한다.

- `background/panel-runtime-capability-router.js`
- `background/functions-runtime-config.js`

이 상태에서는 hosted panel이 새 Cloud Function endpoint를 호출해야 할 때 extension router/config도 함께 바뀔 수 있다. 사용자는 최신 hosted UI를 보더라도, 오래된 extension bundle이 새 endpoint를 모르면 기능 호출이 막힌다.

## 확장 재배포가 필요한 경우

아래처럼 브라우저 확장 권한 자체가 바뀌는 경우만 extension 재배포가 필요하다.

- 새 `chrome.*` 권한이 필요하다.
- 새 `host_permissions` origin이 필요하다.
- 새 content script DOM adapter가 필요하다.
- 새 `web_accessible_resources` asset이 필요하다.
- postMessage/runtime bridge protocol 자체가 호환 불가능하게 바뀐다.
- 보안 정책상 extension 안의 trust root를 바꿔야 한다.

반대로 아래 변경은 remote manifest 목표 구조에서는 extension 재배포 없이 처리해야 한다.

- 새 Cloud Function endpoint 추가
- 기존 endpoint URL/path 변경
- hosted panel action 추가
- local/prod runtime endpoint config 변경
- 특정 capability의 minimum hosted/functions version 변경

## 목표 구조

```text
hosted panel
  -> semantic capability id 요청

extension background
  -> remote capability manifest 조회/검증/캐시
  -> 허용된 capability id만 실행
  -> Functions/cloud/browser adapter 호출

functions/hosting
  -> manifest 서빙
  -> 실제 endpoint 구현
```

extension은 hosted가 넘긴 raw URL을 그대로 실행하지 않는다. extension이 신뢰된 origin에서 manifest를 직접 가져오고, 검증된 capability id만 실행한다.

## Manifest 초안

초기 manifest는 JSON으로 시작한다. 필드명은 구현 시 조정할 수 있지만, 최소 의미는 유지한다.

```json
{
  "schemaVersion": 1,
  "manifestVersion": "2026-04-remote-capability-1",
  "minExtensionVersion": "1.0.0",
  "expiresAt": "2026-05-01T00:00:00.000Z",
  "targets": {
    "production": {
      "functionsBaseUrl": "https://asia-northeast3-browser-extension-main.cloudfunctions.net"
    },
    "local": {
      "functionsBaseUrl": "http://127.0.0.1:5001/browser-extension-main/asia-northeast3"
    }
  },
  "capabilities": {
    "prompt.store.import": {
      "kind": "function",
      "endpoint": "importInovaPromptStoreEntry",
      "method": "POST",
      "auth": "inova-access-token",
      "inputSchemaVersion": 1
    }
  }
}
```

## 보안 원칙

- remote manifest가 있어도 extension의 browser 권한은 늘어나지 않는다.
- manifest는 허용된 origin에서만 가져온다.
- hosted 요청 payload에 포함된 URL, method, endpoint를 직접 신뢰하지 않는다.
- capability id가 manifest에 없으면 명시적 error/degraded로 실패한다.
- manifest 검증 실패를 성공처럼 fallback하지 않는다.
- fallback은 마지막으로 검증된 캐시 또는 bundled baseline으로만 가능하며, 사용자/로그에 stale/degraded 상태를 남긴다.
- endpoint origin은 manifest 안에서도 허용된 Functions/Hosting 계열로 제한한다.
- destructive/write action은 capability별 auth mode, input schema version, audit logging 요구사항을 manifest나 router contract에 남긴다.

## 단계별 진행

### Phase 0. 현재 capability inventory 고정

- `background/panel-runtime-capability-router.js`의 현재 capability 목록을 문서/테스트에서 다시 열거한다.
- `background/functions-runtime-config.js`의 endpoint family와 local/prod target을 정리한다.
- 기존 동작을 바꾸지 않고, 무엇을 remote manifest로 옮길지 범위를 확정한다.

### Phase 1. Bundled manifest 모델 도입

- 현재 하드코딩된 router/config를 extension 내부의 bundled manifest 객체로 먼저 모델링한다.
- `panel-runtime-capability-router.js`는 if/else 목록이 아니라 manifest lookup + adapter dispatch 형태로 바꾼다.
- 이 단계는 동작 변경 없이 구조만 바꾸며, extension 재배포 감소 효과는 아직 없다.

### Phase 2. Remote manifest fetch/cache 추가

- extension background가 trusted hosting/functions origin에서 manifest를 가져온다.
- 검증 성공 시 `chrome.storage.local` 또는 background memory cache에 저장한다.
- fetch 실패 시 bundled manifest 또는 마지막 검증 manifest로 degraded 동작한다.
- stale cache를 쓸 때는 콘솔 trace와 hosted inline/degraded notice에 stale 상태를 드러낸다.

### Phase 3. Functions endpoint를 remote manifest로 이동

- `functions.invoke-endpoint`가 endpoint key를 `functions-runtime-config.js` 하드코딩 대신 remote manifest에서 해석한다.
- local/prod target도 manifest target 설정을 우선한다.
- 기존 `functions-runtime-config.js`는 bootstrap fallback과 compatibility shim으로만 축소한다.

### Phase 4. 새 endpoint 추가 경로 잠금

- 새 Cloud Function action 추가 시 extension code 수정 없이 manifest/functions/hosting 변경만으로 통과하는 verify를 만든다.
- `scripts/verify-contracts.js` 또는 별도 `scripts/verify-remote-capability-manifest.js`가 아래를 검사한다.
- 검사 항목: manifest schema, minExtensionVersion, expiresAt, allowed origin, capability id 중복, unknown adapter kind, missing auth mode, local/prod target 일관성.

### Phase 5. 운영 정책 반영

- release note와 배포 보고에서 `extension ZIP 필요 여부`를 capability manifest 기준으로 판단한다.
- backend action만 바뀐 배포는 `functions/hosting/manifest 갱신, extension redeploy 없음`으로 보고한다.
- extension 재배포가 필요한 변경은 `새 browser permission 또는 page adapter 필요`처럼 명시적 사유를 남긴다.

## 구현 전 확인 질문

- manifest를 Hosting 정적 JSON으로 둘지, Functions endpoint로 서빙할지 결정한다.
- manifest의 서명/해시 검증을 처음부터 넣을지, HTTPS trusted origin + schema/version 검증으로 시작할지 결정한다.
- local emulator에서는 manifest를 어디서 서빙할지 정한다.
- cached stale manifest 허용 시간을 정한다.
- capability별 input schema를 JSON schema로 둘지, router-local validator 함수 이름으로 둘지 정한다.

## 하지 말아야 할 것

- hosted panel이 임의 URL을 background에 넘기고 extension이 그대로 fetch하게 만들지 않는다.
- 보안 검증 없이 remote manifest만 믿고 새 origin이나 새 browser permission을 우회하지 않는다.
- manifest fetch 실패를 성공처럼 숨기지 않는다.
- extension router를 줄인다는 이유로 hosted feature controller가 raw runtime action string을 직접 들고 다니게 하지 않는다.

## 다음 세션 시작점

1. `background/panel-runtime-capability-router.js`와 `background/functions-runtime-config.js`를 읽는다.
2. 현재 capability id, endpoint key, auth mode, target config를 표로 추출한다.
3. bundled manifest 객체 초안을 만든다.
4. router를 manifest lookup 기반으로 바꾸되 remote fetch는 아직 붙이지 않는다.
5. 기존 `npm.cmd run verify`가 녹색인 상태로 Phase 1만 커밋한다.
