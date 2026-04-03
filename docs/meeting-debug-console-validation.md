# meeting debug console 검증 메모

이 문서는 `meeting` debug console 공통 render contract를 실제 Chrome에서 빠르게 확인할 때 쓰는 최소 체크리스트다.

## hosted workspace

- localhost 작업실은 `http://127.0.0.1:5000/meeting/index.html?debug=1&debugQueueSandbox=1`로 연다.
- hosted helper:

```js
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleState()
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleValidation.checkWorkspace()
```

- expanded 기대 결과:
  - toolbar가 보인다.
  - `copy`, `copy-errors`, `clear`, `toggle` 4개 action이 모두 렌더된다.
  - `segment-cluster` 구조가 유지된다.
  - status/log text가 비어 있지 않다.
- collapsed 기대 결과:
  - fab toggle만 보인다.
  - 오류가 있으면 fab badge가 보인다.

## panel overlay

- `https://inova.incross.com/*` 페이지에서 확장프로그램을 켠다.
- 팝업에서 `meeting debug console`을 켜고, content panel이 열린 상태를 만든다.
- panel helper는 content script 콘솔 문맥에서 아래처럼 읽는다.

```js
InovaBookmarks.panelDebugValidation.state()
InovaBookmarks.panelDebugValidation.check()
```

- page DOM에서 빠르게 볼 때는 `#inova-meeting-debug-layer` dataset도 같이 본다.

```js
document.getElementById("inova-meeting-debug-layer")?.dataset
```

- expanded 기대 결과:
  - `debug-copy`, `debug-copy-errors`, `debug-clear`, `debug-toggle` 4개 action이 모두 렌더된다.
  - status/log text가 비어 있지 않다.
- collapsed 기대 결과:
  - `debug-toggle` fab만 남는다.
  - 오류가 있으면 badge가 보인다.

## 메모

- hosted helper는 localhost/hosted script에서 바로 접근 가능하다.
- panel helper는 content script 문맥용이므로 page DOM dataset 확인과 함께 쓰는 편이 가장 빠르다.
- 이 문서의 목표는 `M2 meeting render-contract / surface alignment`의 실제 Chrome 검증 진입 비용을 줄이는 것이다.
