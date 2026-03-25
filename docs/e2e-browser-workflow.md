# 실제 브라우저 E2E 빠른 확인 절차

이 문서는 `i-Nova 더하기`를 실제 브라우저에서 빠르게 확인할 때 매번 같은 탐색을 반복하지 않도록 정리한 작업 절차다.

## 기본 원칙

- UI 동작은 가능하면 사용자가 실제로 보는 Chrome 확장프로그램 기준으로 확인한다.
- DOM이 보인다고 끝내지 않고, 필요한 경우 Firestore 문서 시간까지 같이 본다.
- 백업/동기화는 `브라우저 조작 1회 -> Firestore 갱신 1회 -> idle 상태에서 추가 갱신 없음`을 기본 성공 조건으로 본다.
- 평소 사용은 `local-first`가 기본이며, 자동 원격 load는 로컬 프롬프트가 비어 있는 초기 복구 상황에서만 기대한다.

## 빠른 확인 순서

1. Chrome `확장 프로그램` 화면에서 이 저장소의 unpacked extension을 `Reload`한다.
2. `https://inova.incross.com/`를 새로고침한다.
3. 우측 `실험실` 핸들이 보이는지 확인한다.
4. `요청` 탭에서 프롬프트를 하나 추가하거나 수정한다.
5. 입력창 주입, 드래그, 삭제 같은 로컬 UX를 먼저 확인한다.
6. 저장 직후 아래 스크립트로 Firestore 문서가 실제로 갱신됐는지 확인한다.
7. 같은 스크립트를 20초 정도 간격으로 다시 돌려 idle 상태에서 반복 갱신이 없는지 본다.
8. 필요하면 함수 로그 스크립트로 최근 `load`와 `sync` 호출 횟수를 본다.

## Firestore 빠른 점검

다음 명령은 현재 사용자 문서와 프롬프트 보관함 문서를 두 번 읽고, 사이에 변경이 있었는지 요약해 준다.

```bash
npm run check:cloud-sync -- --userKey <providerUserKey> --samples 2 --wait 20
```

예시:

```bash
npm run check:cloud-sync -- --userKey a4335d24-1110-48f3-a2a9-f9747d71e1f9 --samples 2 --wait 20
```

## 함수 호출 빠른 점검

다음 명령은 최근 N분 동안 `peekInovaPromptLibrary`, `loadInovaPromptLibrary`, `syncInovaPromptLibrary` 함수 로그를 읽고 이벤트 개수를 요약한다.

```bash
npm run check:function-logs -- --since 10 --limit 100
```

해석 예시:

- `sync.success: 1`
  - 저장 1회 후 기대하는 정상 패턴에 가깝다.
- `sync.success: 3` 이상
  - 최근 구간에 저장을 여러 번 하지 않았는데도 많다면 과호출 가능성을 본다.
- `peek.success`는 다른 브라우저 변경 감지를 위한 가벼운 원격 확인이다.
- `peek.success`가 있고 `load.success`가 0이면, 원격 최신 여부만 확인하고 실제 전체 보관함은 가져오지 않은 상태다.
- `load.success`는 패널 초기화나 새로고침 직후 1회 정도는 자연스럽다.
- 로컬 프롬프트가 이미 있는 상태라면 `load.success`는 0회에 가까운 것이 목표다.
- `sync.error`가 보이면 브라우저 콘솔보다 먼저 이 로그와 Firestore 갱신 여부를 함께 본다.

## 해석 기준

- 저장 직후 한 번 실행했을 때 `lastPromptSyncAt`, `lastSyncedAt`, `updateTime`이 최근 시간으로 바뀌면 정상이다.
- 아무 조작 없이 다시 실행했을 때 `integration doc changed: NO`, `prompt library doc changed: NO`면 idle 루프가 없는 상태다.
- 아무 조작 없이도 시간이 계속 바뀌면 동기화 루프를 의심한다.

## 자주 만나는 예외

- 패널에서 저장/삭제 시 `확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.`가 보이면, 열려 있던 페이지가 이전 content script 컨텍스트를 계속 쓰고 있는 상태다.
- 이 경우는 확장 `Reload` 후 `inova.incross.com` 페이지도 같이 새로고침한 뒤 다시 확인한다.

## 자주 보는 문서

- 사용자 메타: `integration_inova_accounts/{providerUserKey}`
- 프롬프트 보관함: `prompt_libraries/inova__{providerUserKey}`

## 점검할 때 같이 보는 항목

- 프롬프트 수가 화면과 Firestore `itemCount`가 같은지
- `lastReason`이 방금 조작과 맞는지
- `lastRevision`이 저장 후 1회만 새로 생기는지
- idle 상태에서 `updateTime`이 계속 바뀌지 않는지
