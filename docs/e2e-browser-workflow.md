# 실제 브라우저 E2E 테스트 절차

이 문서는 `i-Nova 더하기`를 실제 사용자의 Chrome 확장프로그램 환경에서 확인할 때 쓰는 PR 기준선, 공통 준비, 전체 회귀 순서 문서다. 기능별 실제 버튼/탭/권한/DB 확인 항목은 `docs/e2e/features/*.md`로 분리한다. Playwright MCP로 실제 Chrome을 검증하는 모든 작업은 `playwright-mcp-bridge` 스킬을 먼저 읽고 그 절차를 따르는 것을 필수 선행 조건으로 둔다.

## 검증 기준선

- 마지막 반영 PR: `#59 [codex] Admin access UI and controllable meeting tabs` (`#57`, `#58` 포함, 이전 기준선 `#53` 유지)
- 이 문서를 고칠 때는 최근 merged PR 기준으로 이 항목을 함께 갱신한다.
- 최근 merged PR이 있는데 이 기준선보다 번호가 높으면, 풀 테스트 전에 PR diff를 먼저 보고 필요한 feature 섹션과 운영 점검 항목을 추가한다.
- 마지막 반영 PR 번호는 이 문서에만 관리한다. 기능별 테스트 문서에는 PR 번호 이력을 누적하지 않고, 최신 기능 동작과 확인 항목만 유지한다.
- 현재 기준선의 추가 검증 범위는 아래와 같다.
  - `#51`: 회의 debug auth bypass는 상용에서 local Origin/Referer spoof로 열리면 안 된다. 회의 workspace launch trace는 debug mode 없이도 top panel 콘솔에서 보여야 한다. 브라우저/hosted client가 Firebase Storage SDK로 직접 bucket을 읽거나 쓰면 안 된다.
  - `#52`: `deploy:all`/`release:deploy:all`은 `hosting:main,hosting:v2`와 `functions:inova-extension-api`만 포함한다. DB는 `deploy:firestore:inova-db`, Storage는 전용 target이 생긴 뒤 별도 운영 표면으로 본다.
  - `#53`: feature usage aggregate, 회의 사용량 미니 통계/accounting, hosted auth/Firestore retry recovery, 릴리스 메타와 ZIP 정합성을 본다.
  - `#57`: 관리자 콘솔 entry가 관리자 계정에서만 보이고, launch token 교환 뒤 `/admin/index.html`이 URL에서 token을 제거하며 verified session 정보를 보여야 한다.
  - `#58`: 관리자 `소식 팝업` 작성/미리보기/검증과 일반 패널의 active notice 읽기/표시/하루 숨김 상태를 확인한다.
  - `#59`: 관리자 권한 UI는 기존 회원 목록 기반이어야 하고, 관리자/회의 새 탭 열기는 Bridge가 검증할 수 있도록 web-open/prepare URL 경로와 console trace를 남겨야 한다.

## PR 문서 게이트

- 사용자-visible UI, 버튼 action, 권한, Functions 계약, Firestore rules/index, remote capability, 배포 산출물 검증 범위를 바꾸는 PR은 해당 기능별 E2E 문서를 같은 PR에서 갱신한다.
- 기능별 문서가 아직 분리되지 않은 기능은 이 문서의 해당 feature 섹션을 갱신한다. 새로 큰 기능 범위가 생기면 `docs/e2e/features/<feature>.md`를 먼저 만든다.
- 문서 갱신은 상용 배포나 `release:build` 전에 끝낸다. 배포 후 실제 Chrome 풀 테스트는 최신 문서를 기준으로 해야 한다.
- PR 번호가 아직 없으면 기능명 또는 브랜치 scope로 테스트 항목을 갱신하고, PR 생성 뒤 PR 설명에서 갱신 문서를 언급한다.
- `npm.cmd run verify:e2e-doc-guard`는 staged 변경 기준으로 관련 기능 E2E 문서가 빠졌는지 막는다. 이 가드를 통과시키기 위해 빈 문구를 넣지 말고 실제로 새/변경된 버튼과 DB 확인 항목을 반영한다.

## 기능별 문서

- 회의: `docs/e2e/features/meeting.md`
- 대화, 프롬프트, 릴리스, 관리는 아직 이 문서의 feature 섹션을 기준으로 한다. 해당 기능의 큰 UI/계약 변경 PR에서 feature 문서로 분리한다.

## 문서 사용 원칙

- 실제 사용자가 보는 Chrome, 설치된 unpacked extension, 로그인 세션, hosted panel iframe을 기준으로 확인한다.
- Playwright MCP로 확인할 때는 반드시 먼저 `playwright-mcp-bridge` 스킬을 읽고, 살아 있는 Chrome 세션과 로컬 패널 상태를 유지한다.
- 별도 자동화 브라우저나 새 MCP 서버를 실제 Chrome 검증의 대체물로 보지 않는다.
- Bridge 호출이 `Target page, context or browser has been closed`, `Transport closed`, page/context/browser closed 계열 오류로 끊기면 추가 브라우저 조작을 멈춘다. 이 경우 사용자에게 Codex Windows 앱 재시작을 요청하고, 재시작 전에는 실제 버튼 클릭 E2E를 완료했다고 보고하지 않는다.
- 기능 성공처럼 보이는 fallback을 통과로 처리하지 않는다. 실패, stale, degraded 상태는 화면과 콘솔에서 드러나야 한다.
- 테스트 중 발견한 QA 이슈가 문구/empty state 같은 작은 UI 문제면 같은 턴에서 고치되, 커밋 여부는 사용자 지시에 따른다.

## 공통 준비

1. Playwright MCP를 사용할 예정이면 `playwright-mcp-bridge` 스킬을 먼저 읽고, 내장 MCP Bridge 방식과 세션 유지 원칙을 확인한다.
2. `git status --short --branch`로 현재 브랜치와 미커밋 변경을 확인한다.
3. Chrome `확장 프로그램` 화면에서 이 저장소의 unpacked extension을 `Reload`한다.
4. `https://inova.incross.com/` 탭을 새로고침한다.
5. 팝업에서 검증 target을 확인한다.
   - 로컬 패널/로컬 full-stack 검증: `로컬 호스팅 ON`
   - 상용 검증: `상용 호스팅`
6. 로컬 검증이면 필요한 서버가 떠 있는지 본다.
   - 일반 hosted panel: `127.0.0.1:5000`
   - 회의 local full-stack: `npm.cmd run emulator:meeting-local`
7. 실험실 패널 iframe을 확인한다.
   - 로컬 기대값: `#inova-hosted-panel-frame`의 `src`가 `http://127.0.0.1:5000/extension-v2/panel/index.html?...`
   - `chrome-extension://.../frame-proxy.html?...`이면 Bridge 검증이 꼬일 수 있으므로 extension Reload와 페이지 새로고침을 먼저 한다.
8. 콘솔 baseline을 잡는다. 테스트 전후 warning/error가 새로 생기면 해당 feature 결과에 함께 기록한다.
9. hosted panel에서 새 탭을 여는 flow는 web-open 우선 경로를 기대한다. secret 없는 hosted URL을 즉시 만들 수 있으면 사용자 action 안에서 그 URL을 바로 열고, launch token이나 원격 prepared URL처럼 async 준비가 필요하면 `window.open("about:blank", "_blank")`로 탭을 확보한 뒤 준비된 URL로 이동시킨다.
10. `chrome.tabs.create` background open은 fallback이다. Bridge가 열린 새 탭을 자동 상속하지 않을 수 있으므로, 새 탭 lifecycle 자체가 목적이면 Bridge selector를 다시 열어 해당 새 탭을 선택한다.
   - 2026-04-19 상용 Chrome 검증에서는 i-Nova 제품 코드를 거치지 않고 top-level 페이지에 임시 버튼을 만들어 `window.open(..., "_blank")`을 호출해도 새 탭은 Chrome에 열리지만 현재 MCP `browser_tabs list`와 `page.context().pages()`에는 추가되지 않았다. 이 상태는 `openedWindow.opener = null` 여부와 무관한 Bridge grant 경계로 보고, 제품 실패로 판정하지 않는다.
11. 새 탭의 실제 URL을 알고 있고 내부 화면 테스트가 목적이면, Bridge가 이미 잡고 있는 탭을 그 URL로 직접 이동해 테스트할 수 있다. 이 경우 결과에는 `URL 기반 직접 이동으로 내부 테스트`라고 적고, 실제 새 탭 자동 승계 검증과 섞어 말하지 않는다.
12. 현재 Bridge 기준선에서는 `browser_tabs new`, `page.context().newPage()`, `_blank` 자동 승계를 테스트 계획의 전제로 두지 않는다. 새 버전에서 다시 쓰려면 먼저 `playwright-mcp-bridge` 스킬의 버전/source check와 작은 probe로 동작을 재확인한다.

## 화면 캡처 증거

UI/UX 판단은 DOM 텍스트나 접근성 snapshot만으로 끝내지 않는다. 실제 사용자가 보는 Chrome 화면을 각 제품 view별로 캡처한 뒤 판단한다.

1. 탭/segmented control이 있는 화면은 각 탭을 전환한 뒤 별도 캡처를 남긴다.
   - 예: 관리자 `사용자 및 권한`은 회원 목록과 선택 회원 상세가 함께 보이는 화면 1장을 캡처한다.
2. 캡처 전에는 해당 view의 핵심 문구를 DOM으로 먼저 확인한다. 캡처 파일명에는 feature와 view를 넣는다.
   - 예: `tmp/admin-access-users.png`
3. `browser_take_screenshot` 또는 `page.screenshot()`이 성공하면 그 결과를 우선 증거로 쓴다.
4. Bridge 권한/폰트 대기 문제로 Playwright screenshot이 timeout 나거나 CDP가 `Not allowed`로 막히면 Windows 실제 화면 캡처 fallback을 사용한다. 이때 결과에는 `Windows screen capture fallback`이라고 적고, 캡처에 Codex UI나 주변 Chrome UI가 같이 들어갔으면 대상 Chrome 영역만 판단했다고 남긴다.

Windows 실제 화면 캡처 fallback:

```powershell
New-Item -ItemType Directory -Force -Path .\tmp | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$path = Join-Path (Resolve-Path .\tmp) "e2e-screen.png"
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
Get-Item $path
```

## Bridge 새 탭 판정

Playwright MCP Bridge로 새 탭 flow를 검증할 때는 증거를 둘로 나눈다.

1. Source tab launch evidence
   - 실제 UI 버튼을 클릭한다.
   - panel/top console에서 launch requested/prepared/dispatched/accepted 또는 동등 trace를 확인한다.
   - Chrome 화면에 실제 새 탭이 열리는지 확인한다.
   - `browser_tabs list`에 새 탭이 안 보여도 이것만으로 제품 실패로 판정하지 않는다.
2. Destination page evidence
   - 정확히 열린 물리적 Chrome 새 탭이 검증 목적이면 Bridge selector를 다시 열어 사용자가 그 새 탭을 선택한다.
   - 내부 화면/콘솔/권한/session 검증이 목적이고 prepared URL 또는 launch URL이 있으면 현재 Bridge-controlled tab을 그 URL로 이동해 확인한다.
   - 이 결과는 반드시 `URL 기반 직접 이동으로 내부 테스트`라고 기록한다.
3. 금지 판정
   - `page.waitForEvent("popup")` 미발생만으로 `chrome.tabs.create` 또는 extension runtime broker flow를 실패 처리하지 않는다.
   - `browser_tabs list` 미노출만으로 새 탭이 안 열렸다고 보고하지 않는다.
   - launch token, session token, 원문 URL query는 보고서와 로그에 원문으로 남기지 않는다.

## 테스트 강도

- `P0 smoke`: feature별 핵심 사용자 흐름이 열리고, 읽고, 이동하거나 실행되는지만 본다. 매번 우선 실행한다.
- `P1 regression`: 저장/삭제/권한/검색/route sync/stale 상태까지 본다. 기능 수정 후 실행한다.
- `P2 destructive/deep`: 실제 데이터 삭제, 긴 녹음/전사, 공유 해제, 배포 릴리스처럼 되돌림 비용이 있는 흐름이다. 사용자 승인이나 명확한 목적이 있을 때만 실행한다.

장시간 작업은 기본 E2E에서 제외한다. 실제 Chrome P0/P1에서 새 녹음은 15-30초 정도로 끝내고, 파일 import는 짧은 샘플 파일만 쓴다. 2시간 녹음, 대용량 업로드, 긴 전사 완료 대기는 `풀 테스트`에도 포함하지 않는다. 해당 한계 검증은 전용 fixture, metadata stub, sandbox queue fault처럼 시간을 거의 쓰지 않는 방법이 있을 때만 별도 승인 후 실행한다.

## 테스트 자료

- 회의 작업실 파일 import 기본 샘플: `fixtures/audio/meeting-smoke-ko.wav`
  - 약 9초 Korean TTS WAV 파일이다.
  - import picker, duration metadata, pending upload, 원본 다운로드 확인용이다.
  - 전사 품질 판단용으로 쓰지 않는다.
- 샘플 파일이 없거나 바뀌었으면 actual Chrome 테스트 전에 `npm.cmd run verify:meeting-audio-fixture`를 먼저 실행한다.

## 요청 범위

사용자가 범위를 좁혀 말하면 이 문서에서 해당 feature 섹션만 실행한다. 범위를 말하지 않고 `테스트해줘`라고 하면 최근 변경 파일과 Git diff를 기준으로 필요한 feature만 고르고, 애매하면 전체 smoke가 아니라 먼저 범위를 확인한다.

- 기능 구현 직후의 기본 브라우저 검증은 이번 변경의 직접 feature 범위만 본다. 이전 대화에서 `풀 테스트`를 말했더라도 새 기능 구현/수정 요청으로 범위가 좁아졌으면 그 새 변경 범위를 우선한다.
- 인접 feature, 파괴적 action, 장시간 workflow는 사용자가 다시 명시했을 때만 실행한다. `버튼도 눌러봐`는 해당 변경 feature 안의 버튼을 뜻하는 것으로 보고, 전체 제품의 모든 버튼으로 확장하지 않는다.
- `대화 탭만 테스트해줘`: `대화 탭`의 P0, 필요 시 P1만 실행한다.
- `회의룸만 테스트해줘`: 패널의 `회의룸` P0/P1과, 작업실 변경이 있으면 `회의 작업실` P0/P1까지 실행한다.
- `회의 작업실만 테스트해줘`: 확장 패널 목록은 진입 확인까지만 보고, hosted workspace 내부 녹음/import/회의 정리 흐름을 중심으로 실행한다. 새 녹음은 짧은 smoke만 하고 긴 전사 대기는 기존 완료 record로 대체한다.
- `프롬프트만 테스트해줘`: `내 요청`, `스토어`, `검토` subtab을 모두 실행한다.
- `릴리스만 테스트해줘`: `릴리스` P0/P1과 release metadata 정합성만 실행한다.
- `풀 테스트해줘`: `전체 회귀 순서`를 실행하되, P2 destructive/deep 항목과 장시간 녹음/대용량 업로드/긴 전사 대기는 사용자 승인 없이는 실행하지 않는다.

## 공통 합격 기준

- 탭 count, 카드 수, 버튼 disabled 상태, empty/loading/degraded 문구가 현재 상태와 맞아야 한다.
- 기능 실패가 빈 화면이나 성공 토스트로 숨겨지면 실패다.
- route 변경, 탭 전환, 페이지 새로고침 뒤 이전 feature의 검색어, active 상태, pending 상태가 새 feature를 오염시키면 실패다.
- 실제 Chrome 콘솔 warning/error가 새로 생기면 실패 또는 추가 조사 대상으로 기록한다.
- `hosting/*` 변경은 Hosting 배포와 페이지 새로고침 대상이고, `content/*`, `background/*`, `popup/*`, `manifest.json`, 확장 번들에 포함되는 `shared/*` 변경은 확장 Reload 또는 확장 배포 대상이다.
- `풀 테스트`나 feature usage 변경 검증에서는 의미 있는 사용자 action 1회가 Firestore aggregate에 남았는지까지 확인한다. 화면 동작만 보고 사용량 계측을 통과시키지 않는다.

## 상용 보안/배포 경계

이 섹션은 최근 PR이 auth, Storage, Functions 배포, release metadata를 건드렸거나 `풀 테스트`를 상용 기준으로 수행할 때 함께 본다.

1. 상용 workspace auth endpoint에 `debugAuthBypass`를 넣은 local Origin/Referer spoof 요청은 실패해야 한다.
   - 기대값: HTTP 400/401/403 계열, Firebase custom token 없음, `meetingSessionToken` 없음
2. 회의 workspace launch는 debug mode가 아니어도 top panel 콘솔에서 launch requested/dispatched/accepted 수준의 trace가 남아야 한다.
3. 브라우저/hosted client는 Firebase Storage SDK로 직접 bucket을 읽거나 쓰지 않아야 한다. 이 경계는 `npm.cmd run verify:storage-rules`와 실제 import/upload flow의 Functions 경유 여부를 함께 본다.
4. 상용 배포 보고에서는 Auth 외 공유 리소스를 건드렸는지 분리해서 적는다. 기본 배포는 `hosting:main,hosting:v2`와 `functions:inova-extension-api`만 대상이며, Firestore는 `(default)` database 전용 배포(`deploy:firestore:inova-db`)가 필요한 경우에만, Storage는 전용 target이 생긴 경우에만 별도 반영한다.
5. 릴리스 메타는 `hosting/extension-v2/releases/latest.json`, `history.json`, `downloads/latest.zip`, `releases/release-notes.json`이 같은 공개 버전을 가리켜야 한다.
6. 관리자 콘솔 배포를 포함한 릴리스면 상용 Hosting에서 `/extension-v2/panel/admin-entry-controller.js`와 `/admin/index.html`이 200으로 응답하고, 상용 패널 HTML이 관리자 entry script를 포함하는지 먼저 확인한다.

## 사용량 계측

이 섹션은 `feature-usage` pipeline 자체를 바꿨거나, 새 feature action을 `featureUsageTracker.record(...)`에 추가했거나, 상용 풀 테스트에서 "누가 얼마나 썼는지" 운영 증거가 필요한 경우에 실행한다.

### P0 Smoke

1. 패널 iframe이 현재 target으로 로드됐는지 확인한다.
   - 로컬: `http://127.0.0.1:5000/extension-v2/panel/index.html?...`
   - 상용: `https://browser-extension-v2.web.app/extension-v2/panel/index.html?...`
2. iframe 안에서 `InovaBookmarks.featureUsageTracker.create`와 `extensionCapabilityClient.commitFeatureUsageBatch`가 존재하는지 확인한다.
3. capability handshake에서 `metrics.feature-usage.commit`이 enabled이고, auth가 `access-token`, service가 `metrics`인지 확인한다.
4. 상용 검증이면 새 배포 직후 stale hosted bundle이 남을 수 있으므로, top page를 정상 새로고침한 뒤 다시 1-3을 확인한다. iframe src를 임의 cache-bust URL로 바꾸는 방식은 CSP에 막힐 수 있다.

### P1 Aggregate

1. 테스트에 쓸 `providerUserKey`를 확인한다.
2. 저비용 action 하나를 실제 UI에서 실행한다.
   - pipeline 자체 검증이면 `대화` 탭의 질문 카드 클릭으로 `conversation.jumped.success` 1회를 우선 쓴다.
   - 특정 feature action을 추가한 변경이면 해당 action을 실제 UI에서 1회 실행한다.
3. flush가 일어나게 한다.
   - 기본은 첫 action 후 60초 이상 대기한다.
   - 빠르게 끝내야 하면 탭 전환, page hide, 페이지 새로고침처럼 iframe `visibilitychange` 또는 `pagehide`가 발생하는 흐름을 쓴다.
4. iframe localStorage의 `inova.featureUsage.outbox.v1::` record를 확인한다.
   - `counters`에는 allowlist action과 count만 있어야 한다.
   - 프롬프트 원문, 대화 원문, URL, token, IP, browser fingerprint 같은 raw content가 없어야 한다.
   - 성공 flush 뒤에는 `dirtyCount=0`, `lastCommittedAt`, `lastDeltaTotal`이 남아야 한다.
5. Firestore aggregate를 Admin SDK script로 확인한다.

```bash
npm.cmd run check:feature-usage -- --days 1 --limit 20
```

합격 기준:

- 현재 `providerUserKey`가 사용자 랭킹에 보이고, 가능한 경우 `email`, `displayName`, `numericUserId` snapshot이 함께 보인다.
- 실행한 feature의 `success/error/degraded` count가 기대 action 수만큼 증가한다.
- 같은 화면을 다시 새로고침하거나 같은 snapshot을 재전송해도 중복 delta가 생기지 않는다.
- `integration_inova_feature_usage_*` 컬렉션은 client에서 직접 읽거나 쓰지 않는다.

상용에서 이 검증은 실제 운영 count 1건을 남긴다. 테스트용 raw event 삭제 대상은 없고, aggregate를 수동 보정할 필요가 있으면 별도 운영 작업으로 다룬다.

## 관리자 콘솔

이 섹션은 관리자 진입점, 관리자 권한 확인, hosted admin page, admin capability 또는 admin Functions 계약을 바꿨을 때 실행한다.

### P0 Smoke

1. 검증 대상 계정을 정한다.
   - 비관리자 계정: `ops_admin_users/{providerUserKey}` 문서가 없고 `INOVA_ADMIN_PROVIDER_USER_KEYS` / `INOVA_ADMIN_EMAILS`에도 없어야 한다.
   - 관리자 계정: 환경 allowlist 또는 `ops_admin_users/{providerUserKey}` active 문서가 있어야 한다.
   - 로컬 기본값: `npm.cmd run emulator:meeting-local`은 `youngtack.park@incross.com`을 `INOVA_ADMIN_EMAILS`에 자동 포함한다. 로컬 임시 관리자를 더 넣을 때는 실행 전 `INOVA_LOCAL_ADMIN_EMAILS`에 쉼표로 추가한다.
2. 패널 iframe이 현재 target으로 로드됐는지 확인한다.
   - 로컬: `http://127.0.0.1:5000/extension-v2/panel/index.html?...`
   - 상용: `https://browser-extension-v2.web.app/extension-v2/panel/index.html?...`
3. capability handshake에서 `admin.access.check`와 `admin.launch.issue-function`이 enabled이고, auth가 `access-token`, service가 `admin`인지 확인한다.
4. 비관리자 계정에서는 tool rail에 `관리` 항목이 없어야 한다.
5. 관리자 계정에서는 서버 권한 확인이 끝난 뒤 tool rail에 `관리` 항목이 추가되어야 한다.
6. `관리` 항목을 클릭한다.
   - 기본 경로는 hosted panel의 `window.open` web-open이어야 한다.
   - fresh launch token이 있으면 바로 `/admin/index.html?launch=...`를 열고, 없으면 `about:blank`를 먼저 만든 뒤 token 발급 후 이동시킨다.
   - `admin.console.open` background runtime action은 web-open이 실패했을 때의 fallback이다.
   - 새 탭 URL은 현재 hosting target의 `/admin/index.html?launch=...`로 열려야 한다.
   - Bridge가 열린 관리자 탭을 자동 상속하지 못하면 `Bridge 새 탭 판정`에 따라 source tab launch evidence와 destination page evidence를 분리한다.
   - 관리자 내부 화면 검증은 launch URL을 준비한 뒤 Bridge-controlled tab을 `/admin/index.html?launch=...`로 직접 이동해 수행할 수 있지만, 이 경우 실제 새 탭 자동 승계 검증으로 보고하지 않는다.
7. 관리자 페이지가 launch token을 교환한 뒤 URL에서 `launch` query를 제거하는지 확인한다.
8. 관리자 페이지에서 verified 상태, 사용자, 계정, 권한, 세션 만료 정보가 표시되어야 한다.
9. 선택한 기능 화면 안에는 별도 `세션 컨텍스트` 카드처럼 상단 인증 정보를 반복하는 UI가 없어야 한다.
10. `사용자 및 권한`은 기존 회원 목록을 읽고, 선택한 회원의 `일반 사용자 / 관리자` 권한 선택과 `저장`만 제공해야 한다. 선택 회원 상세 안에는 read-only `이용 기록`이 함께 보여야 한다. 이메일 직접 입력이나 별도 권한 설명 필드가 보이면 실패다. `마지막 활동` 옆 `?` 도움말은 feature usage에 기록되는 기능 사용 이벤트가 기준임을 설명해야 한다.
11. 관리자 HTML은 `index.css`, `index.js`, shared design-system CSS/JS를 `admin=<timestamp>` query로 로드해야 한다. 같은 탭에서 새로고침했는데 이전 JS 문구가 남으면 실패다.
12. 집계 테이블/쿼리 구조가 붙기 전에는 별도 `사용자별 이용 현황` 메뉴, 기간 필터, `기능별` 집계 탭, 별도 `회의 사용량` 탭, `이용 공백` 운영 액션 섹션, raw event count, token, providerUserKey, 내부 로그, `활발`/`정착 중` 같은 해석성 상태 라벨, `화면 샘플`/`화면 검토용`처럼 구현 검토용 표식이 노출되면 실패다.
13. 같은 launch URL을 다시 열거나 launch 없이 직접 진입하면 blocked 상태가 보여야 한다.
14. 상용 배포 직후에는 `browser-extension-v2.web.app`의 panel/admin 정적 자산 200 응답과 릴리스 ZIP metadata 정합성을 함께 확인한 뒤 패널을 새로고침한다.

### 소식 팝업

이 항목은 관리자 `소식 팝업` 메뉴, `readInovaPanelNotice` capability, `ops_panel_notices`/`ops_panel_notice_state` 계약을 바꿨을 때 실행한다.

1. 관리자 페이지에서 `소식 팝업` 메뉴를 연다.
2. 화면은 `등록된 소식`, `소식 작성`, `미리보기` 3단 구성이어야 한다. 등록된 소식은 왼쪽 고정 폭, 작성 영역은 가운데 가변 폭, 미리보기는 오른쪽 패널 폭 기준으로 둔다.
3. editor가 제목, 본문 Markdown, CTA label/URL, 노출 시작/종료 시간을 표시하고, 버튼은 `저장`, `삭제`, `새 소식`만 있어야 한다.
4. 노출 여부는 토글이 아니라 현재 시각이 노출 시작/종료 범위 안인지로 계산한다. 여러 소식이 동시에 노출되면 패널은 목록 위 순서대로 자동 전환해야 한다.
5. Markdown preview에서 raw HTML은 escape되고, 문단/줄바꿈, `**굵게**`, `*기울임*`, `-` bullet, `https://` 링크만 렌더링되는지 본다.
6. CTA URL을 `inova.incross.com`처럼 입력하면 저장 전 `https://inova.incross.com/`으로 보정되거나 필드 바로 아래에서 `https://` 요구사항을 알려야 한다. generic `관리자 요청 실패`만 보여주면 실패다.
7. 종료 시간이 현재보다 과거인 공지는 저장되어도 패널 노출 대상으로 계산되면 안 되고, `http://` CTA나 Markdown 링크는 저장되지 않아야 한다.
8. 소식을 저장하면 Firestore `ops_panel_notices/{noticeId}`와 panel invalidation signal이 갱신되어야 한다.
9. 일반 패널 사용자 iframe의 capability handshake에서 `panel.notice.read-active`가 enabled이고, auth가 `access-token`, service가 `admin`인지 확인한다.
10. 패널 하단에 slim popup이 뜨고 본문 스크롤 영역과 겹치지 않아야 한다.
11. `닫기`는 현재 패널 세션에서만 숨긴다. 페이지 새로고침 후 같은 공지가 다시 보여야 한다.
12. `하루동안 안보기`는 클릭 즉시 popup을 숨기고, iframe localStorage의 `inova-panel-notice-hide:<noticeId>:<version>` 키가 24시간 만료값으로 저장되어야 한다. 새로고침 후에도 숨김이 유지되어야 한다.
13. 같은 공지를 새 version 또는 새 noticeId로 다시 저장하면 이전 숨김 키가 새 공지 노출을 막으면 안 된다.
14. 검증용 공지를 만들었다면 마지막에 삭제하거나 emulator 데이터를 정리하고, localStorage의 검증용 hide key를 지운다.

### P1 Regression

1. `ops_admin_users/{providerUserKey}`를 inactive로 바꾼 뒤 기존 AdminSession으로 새로고침한다.
   - 기대값: verified 상태가 유지되지 않고 blocked 상태로 전환된다.
2. `사용자 및 권한`에서 비관리자 회원을 `관리자`로 저장하면 `ops_admin_users/{providerUserKey}.status`가 `active`가 되고, 다시 `일반 사용자`로 저장하면 `inactive`가 되어야 한다.
3. 관리자 항목이 보이는 상태에서 capability manifest의 admin capability를 비활성화한 rehearsal bundle이면 항목이 사라져야 한다.
4. 관리자 페이지 console에 launch token 원문이나 AdminSession token 원문을 직접 출력하면 실패다.
5. 배포 보고에는 Functions 배포, Hosting 배포, 확장 Reload 또는 확장 패키지 갱신 필요 여부를 분리해서 적는다.

## 대화 탭

### P0 Smoke

1. 새 대화 화면 또는 질문이 없는 대화에서 `대화` 탭을 연다.
2. `대화 탐색` count가 `0`인지 확인한다.
3. 빈 상태 문구는 결과 영역에 한 번만 보여야 한다.
   - 기대값: `아직 대화가 없어요.` 1회
   - 같은 의미의 제목/보조 문구와 박스 문구가 동시에 보이면 중복 렌더링 QA 이슈다.
4. 사이드바에서 대화가 있는 세션 하나를 연다.
5. 페이지 DOM 기준 `[aria-label="채팅 메시지 목록"] > article` 개수를 확인한다.
6. 대화 탭에서 질문 카드 수와 `대화 탐색` count가 사용자 질문 수에 맞게 갱신되는지 본다.
7. `예상 컨텍스트` 게이지가 표시되는지 확인한다.

### P1 Regression

1. 검색 입력에서 일치 검색어를 넣는다.
   - 결과 카드가 남고 `검색 결과 N개`가 표시되어야 한다.
2. 불일치 검색어를 넣는다.
   - 결과 카드 0개와 `검색 결과가 없어요. 다른 표현으로 다시 찾아보세요.`가 표시되어야 한다.
3. 검색을 초기화한다.
   - 기존 질문 카드와 게이지가 복구되고 불필요한 meta 문구가 사라져야 한다.
4. 질문 카드 클릭 이동을 확인한다.
   - 대상 원문 질문이 현재 viewport 밖에 있는 상태를 먼저 만든다.
   - 클릭 전 대상 원문 질문의 rect가 viewport 밖이어야 한다.
   - 클릭 후 rect가 viewport 안으로 들어와야 한다.
   - 패널의 해당 질문 카드에 active 상태가 잡혀야 한다.
5. 질문 복사 버튼을 1회 실행한다.
   - 버튼 상태가 성공으로 바뀌고 복사 fallback 오류가 없어야 한다.
6. 다른 대화로 이동한다.
   - 이전 대화의 검색어가 남지 않아야 한다.
   - 질문 카드 수, `대화 탐색` count, 예상 컨텍스트가 새 대화 기준으로 바뀌어야 한다.

### 주의 리스크

- provider/model label 포맷이 바뀌면 user/assistant 판별이 틀어질 수 있다.
- `read-dom-snapshot` 실패 뒤 `read-state` fallback이 문제를 가릴 수 있다.
- route 변경 뒤 검색어, active 상태, visible message가 남는지 놓치기 쉽다.

## 회의룸

상세 정본은 `docs/e2e/features/meeting.md`다. 아래 항목은 전체 회귀 순서에서 빠르게 범위를 잡기 위한 요약이며, 회의 기능을 바꾸는 PR은 feature 문서를 먼저 갱신한다.

이 섹션의 앞부분은 확장 패널 안의 회의 허브를 본다. 실제 녹음하고 전사/회의록을 작업하는 새 탭은 아래 `회의 작업실` 섹션을 별도로 본다.

### P0 Smoke

1. 팝업 target을 확인한다. 로컬 full-stack이면 `npm.cmd run emulator:meeting-local`이 떠 있어야 한다.
2. `회의 룸` 탭을 연다.
3. 회의 목록이 로드되는지 본다.
   - 목록은 `integration_inova_meetings` 기반 최신순, 최대 24건 기준이다.
   - 로딩 실패 시 cached/stale/degraded/empty 문구가 숨겨지지 않아야 한다.
4. 회의 사용량 미니 통계가 로드되는지 본다.
   - 본인 현재 월 집계와 전체 집계가 있으면 숫자가 표시되어야 한다.
   - 권한, 네트워크, 집계 없음 상태는 빈 화면이 아니라 empty/degraded/제한 문구로 드러나야 한다.
5. 기존 회의 카드 1건에서 `작업실 열기` 또는 `결과 열기`를 실행한다.
6. 새 탭 또는 결과 탭이 열리고, panel 쪽 콘솔은 launch requested/dispatched/accepted 수준까지 확인한다.
7. 새 탭은 hosted panel의 web-open 우선 경로로 열려야 한다. current Bridge가 새 탭을 자동 상속하지 못하면 제품 launch 실패로 보지 않고, `window.open` 호출 또는 prepared URL을 확인한다.
8. 새 탭 lifecycle이 목적이면 해당 Chrome 새 탭을 Bridge selector로 다시 선택하고, 작업실 내부 테스트가 목적이면 opened/prepared URL을 Bridge-controlled tab에 직접 이동해 이어서 확인한다. 이 경우 결과에는 `URL 기반 직접 이동으로 내부 테스트`라고 적는다.
9. hosted 작업실에서 session 허용 상태면 workspace가 렌더링되고, 미허용 상태면 blocked 화면이 보여야 한다.

### P1 Regression

1. `open-result`와 `open-workspace`가 구분되어 동작하는지 확인한다.
   - 결과가 있는 기록은 결과로 열리고, 작업실 진입은 workspace URL로 열려야 한다.
2. 공유 생성/공유 해제 버튼은 capability와 권한이 있을 때만 보여야 한다.
   - `meeting.share.create-function`
   - `meeting.share.revoke-function`
   - 공유 중인 내 회의룸은 현재 shareId 기준 `열람 N명`을 owned meeting 문서 snapshot에서만 표시해야 한다.
   - `공유 해제` 클릭 시 시스템 팝업이 아니라 카드 안에서 현재 열람자 수와 즉시 접근 차단을 설명하는 확인 문구가 먼저 보여야 한다.
   - 공유 해제 후 참여자 목록에는 `접근 불가` 비활성 카드가 남고, 액션은 `목록에서 제거`만 남아야 한다.
3. 회의 사용량 통계는 현재 사용자 월별 doc 1개와 전체 doc 1개 기준이어야 하고, 회의 탭을 벗어나거나 패널을 닫으면 listener가 남지 않아야 한다.
4. popup에서 `로컬 호스팅`과 `상용 호스팅`을 전환한다.
   - 선택 상태와 local override가 즉시 반영되어야 한다.
   - 열린 workspace URL이 이전 origin에 묶여 있으면 실패다.
5. hosted 작업실에서 기존 완료 기록 1건을 열고 결과 상세를 확인한다.
6. 녹음 또는 파일 import 흐름을 1회 확인한다.
   - 마이크 권한, 업로드 진행 상태, 완료/오류 문구가 맞아야 한다.
7. `visibilitychange`, focus 복귀, 탭 전환 중 녹음이 끊기지 않는지 확인한다.
8. `beforeunload` 경고는 녹음 중, 일시정지, 중지 처리 중, 실제 업로드 진행 중일 때만 떠야 한다.

### P2 Deep

1. 새 녹음 또는 파일 import 1건을 끝까지 처리한다.
2. 회의 제목/메모/결과 수정 또는 삭제 1회를 확인한다.
3. 회의록 보정 변경이 있으면 용어 치환, 섹션 수정 preview/apply, stale preview 재적용 거절을 확인한다.
4. 완료 기록 이동 변경이 있으면 다른 owned 회의 룸으로 옮기고, source 목록에서 사라지고 target에서 전사/회의 정리/메모가 유지되는지 확인한다.

### 주의 리스크

- cached 목록을 fresh로 오판하기 쉽다.
- local/prod target을 바꿨는데 workspace만 이전 origin으로 열릴 수 있다.
- 읽기 전용 상태에서 저장/공유 버튼이 살아 있으면 실패다.
- 일반 이동에서도 `beforeunload`가 뜨면 사용자 흐름을 과하게 막는 오탐다.

## 회의 작업실

상세 정본은 `docs/e2e/features/meeting.md`다.

이 섹션은 `hosting/meeting/*`의 hosted workspace 내부를 본다. 패널 회의 허브의 목록/공유 버튼만 확인하는 테스트와 분리한다.

### P0 Smoke

1. 회의 허브에서 작업실을 열거나, 승인된 meeting session URL로 작업실을 연다. 회의 허브는 web-open 우선 경로로 새 탭을 열어야 한다. 열린 실제 Chrome 새 탭을 확인하려면 기존 패널 탭이 아니라 새 탭을 Bridge selector로 다시 선택한다. URL을 알고 있고 내부 shell만 확인하면 Bridge-controlled tab을 같은 URL로 직접 이동해 테스트할 수 있다.
2. 작업실이 blocked 화면이 아니라 실제 shell로 뜨는지 확인한다.
   - 직접 clean URL만 붙여 넣어 세션이 없으면 blocked 화면이 정상이다.
   - 패널에서 연 owner workspace는 `meetingSessionToken`을 받아 실제 shell로 들어가야 한다.
3. hosted 작업실 URL에 필요하면 `?debug=1`을 붙이고 새 탭 DevTools 콘솔 필터를 `inova:`로 둔다.
4. hosted 콘솔에서 아래 순서를 확인한다.
   - `workspace.bootstrap`
   - `workspace.realtime.connect.success`
   - `workspace.ready`
5. 회의 룸 header, 기록 추가 카드, 기록 선택 목록, 기록 상세 영역이 렌더링되는지 본다.
6. 기록 목록이 먼저 보이고, 선택된 record detail은 뒤늦게 비차단으로 채워지는지 본다.
7. 완료된 기존 record 1건을 선택한다.
8. `상태`, `회의 정리`, `메모`, `원문` 탭 전환이 정상인지 본다.
9. 완료 record에서만 `회의 정리 복사`, `원문 복사`, `용어 치환` action row가 보여야 한다.

### Recording/Import P1

1. 마이크 권한을 허용한다.
2. `녹음 시작 -> 일시중지 -> 이어서 녹음 -> 녹음 완료`를 한 번 실행한다.
   - 기본 녹음 길이는 15-30초 안에서 끝낸다.
   - 2시간 한계, 긴 침묵 구간, 장시간 background 지속성은 기본 P1에서 실제로 기다리지 않는다.
3. 녹음 시간과 상태 배지가 실제 상태와 맞게 바뀌는지 본다.
4. 탭 전환, minimize, focus 복귀, `visibilitychange` 동안 녹음이 끊기지 않는지 확인한다.
5. `beforeunload` 경고는 `recording`, `paused`, `stopping`, 실제 업로드 진행 중에만 떠야 한다.
6. 녹음이 끝나면 local pending record가 생기고 자동 전사 업로드가 시작되어야 한다.
7. `파일 불러오기`를 1회 실행한다.
   - 기본 샘플은 `fixtures/audio/meeting-smoke-ko.wav`를 쓴다.
   - 오디오 파일 길이는 metadata로 먼저 계산하고, 실패하면 decode fallback으로 회복할 수 있어야 한다.
   - 길이를 끝내 확인하지 못하면 사용자 오류가 남아야 한다.
   - 2시간 초과 또는 원본 크기 제한 초과 차단은 실제 긴 파일을 기다리지 않고, fixture나 metadata stub이 있을 때만 확인한다.
8. chunk 준비/업로드 진행 표시는 작은 샘플로 자연스럽게 보일 때만 확인한다. 큰 원본이나 긴 원본을 새로 만들어 시간을 쓰지 않는다.
9. 원격 처리 성공 후 completed record 검증은 기존 완료 record를 우선 사용하고, 새 녹음의 전사 완료까지 오래 기다리지 않는다.
10. completed record에서 `원본 다운로드`가 가능해야 한다. Bridge에서 blob anchor 다운로드가 `download` 이벤트로 잡히지 않을 수 있으므로, 이 경우 버튼 click handler, 성공 토스트, 로컬 pending blob 존재를 함께 보고 실패 여부를 판단한다.

### Notes/Edit/Recovery P1

1. 완료 record에서 `회의 정리` 탭을 연다.
2. `회의 정리 복사`와 `원문 복사`가 실제 clipboard 동작까지 되는지 확인한다.
3. `용어 치환`을 연다.
   - 치환 추가, 변경 취소, 전체 비우기, `용어 치환 적용하기` 버튼 상태가 맞아야 한다.
   - 저장 후 같은 회의 룸의 회의 정리에 적용되어야 한다.
4. 회의 정리 섹션에서 `직접 수정`, `AI 수정`, `삭제`가 분리되어 보여야 한다.
5. `AI 수정`은 `AI 미리보기 -> 적용` 순서여야 하고, preview 없는 apply는 막혀야 한다.
6. `직접 수정`은 미리보기 없이 해당 섹션만 저장해야 한다.
7. `메모` 탭에서 기록 메모 저장이 completed record에만 가능해야 한다.
8. read-only 또는 공유 링크 모드라면 저장/삭제/이동/용어 치환 같은 mutation 버튼이 숨겨지거나 비활성화되어야 한다.
9. pending upload queue가 degraded면 warning notice와 hosted console trace가 함께 남아야 한다.

### P2 Destructive/Deep

1. `기록 이동`은 완료 remote record에서만 실행한다.
   - 이동 성공 후 source 회의 룸에서 사라지고 target 회의 룸에 동일 전사/회의 정리/메모가 남아야 한다.
   - 브라우저 로컬 pending copy도 target 회의 룸으로 함께 이동해야 한다.
2. `기록 삭제`와 `회의 룸 삭제`는 사용자 승인 후에만 실행한다.
   - 삭제 뒤 local pending copy가 다시 살아나지 않아야 한다.
   - cleanup degraded가 있으면 숨기지 않고 warning/trace로 남아야 한다.
3. queue fault 주입은 `debugQueueSandbox=1` 같은 sandbox에서만 한다.
   - `queueFaults.scenarios()`
   - `queueState()`
   - `queueValidation.check(...)`
4. 긴 녹음, 2시간 한계, 대용량 업로드, 장시간 전사 queue 검증은 실제 시간을 채워 실행하지 않는다.
   - 짧은 fixture, metadata stub, sandbox fault로 같은 분기와 문구를 검증할 수 있을 때만 실행한다.
   - 그런 준비가 없으면 P2 항목으로 기록하고 이번 actual Chrome run에서는 skip한다.

### Debug Evidence

hosted workspace 이슈는 top panel 콘솔에서 끝까지 닫지 않는다. panel 콘솔은 launch dispatch까지만 보고, 새 탭 DevTools 콘솔에서 hosted trace를 본다.

필요 시 아래 helper를 순서대로 실행한다.

```js
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleState()
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleValidation.checkWorkspace()
__INOVA_HOSTED_MEETING_DEBUG__.errors()
__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })
```

최소 증거는 화면 스크린샷, `inova:` trace, `errors()` 출력, pending sync evidence다.

## 프롬프트

프롬프트는 한 탭 안의 `내 요청`, `스토어`, `검토`를 묶어서 본다. 단순 UI smoke만 할 때도 세 subtab 전환은 반드시 확인한다.

### 내 요청 P0/P1

1. `프롬프트` 탭을 열고 `내 요청`이 렌더링되는지 확인한다.
2. loading, empty, sync-off, degraded 문구가 서로 섞이지 않는지 본다.
3. 검색을 1회 실행하고 초기화한다.
4. 새 요청 1건을 추가하거나 기존 요청 1건을 수정한다.
5. 서버 ack 후 Firestore refresh가 확인된 뒤에만 저장 성공으로 본다.
6. 저장한 항목을 입력창에 1회 주입한다.
   - 덮어쓰기/이어붙이기 모드가 있다면 둘 다 확인한다.
   - 간헐 자동 전송이 재현되면 실패다.
7. JSON 내보내기/가져오기 버튼과 `?` 안내를 확인한다.
8. 삭제 또는 드래그 정렬은 P1 이상에서만 실행한다.
   - 삭제는 `qa-delete-...`처럼 테스트용으로 만든 항목만 쓴다.
   - 삭제 후 패널 새로고침에서도 다시 살아나지 않아야 하고, DB 점검은 `prompt_library_orders_v2`와 `prompt_library_chunks_v2`에서 해당 `promptId`가 모두 빠졌는지 본다.

### 스토어 P0/P1

1. `스토어` subtab을 연다.
2. `전체` 목록이 로드되는지 확인한다.
3. 전체/내 등록 전환, 카테고리, 정렬, 검색을 확인한다.
4. 검색은 queryDirty 상태에서만 `엔터를 눌러 검색` 안내가 보여야 한다.
5. 카드 1건 상세를 연다.
6. 좋아요 또는 `내 요청으로 가져오기` 중 1개 액션을 실행한다.
7. 탭 이동 후 돌아와도 목록과 상세 상태가 유지되는지 본다.
8. 본인이 등록한 항목이 있으면 `내린다` confirm과 disabled 상태를 확인한다.
   - 스토어 삭제는 hard delete가 아니라 unpublish다. `prompt_store_entries/{entryId}`는 `status=removed`, `hasDetail=false`, `removedAt` 상태로 남고, `prompt_store_entry_details/{entryId}`와 feed page 노출은 없어야 한다.
   - 시스템 프롬프트는 삭제할 수 없어야 한다.

### 검토 P0/P1

1. 실제 composer에 텍스트를 입력한다.
2. 입력창 바깥 우측 상단 `프롬프트 검토` 버튼이 composer에 anchor되는지 확인한다.
3. 검토를 실행한다.
4. 결과 헤더 우측에 `n/100` 점수 칩과 `?` 도움말이 보여야 한다.
5. 결과는 `바로 고칠 점 -> 다듬은 프롬프트 -> 기준 항목 평가` 순서로 열려야 한다.
6. 다듬은 프롬프트가 문장 단위 줄바꿈으로 읽히는지 확인한다.
7. `복사`와 `입력창에 반영` 버튼이 같은 줄에 있고 실제로 동작해야 한다.
8. 입력창 내용이 바뀐 뒤 이전 결과를 반영하려 하면 stale로 막혀야 한다.
9. `prompt-telling-v2` opt-in 경로는 `기본 정보` 3개와 `표현 방식` 3개, 총 6개 항목이 보여야 한다. 기본 경로는 `legacy-v1` 유지가 기준이다.

### 프롬프트 공통 리스크

- provider identity가 없으면 라이브러리/스토어 read와 mutation이 정상 흐름이 아니다.
- store의 identityPending, cache/stale, empty가 모두 빈 화면처럼 보여 성공으로 오판하기 쉽다.
- review 요청과 store publish가 같은 패널에서 섞이면 tab focus와 자동 활성화가 꼬일 수 있다.
- import/export 파일 왕복, clipboard, composer apply는 실제 Chrome 실동작으로 확인해야 한다.
- retired reference 문서나 보조 스크립트만 정리했고 활성 hosted prompt bundle, content runtime, Functions 계약이 바뀌지 않았으면 새 prompt 브라우저 항목을 추가하지 않는다. 이때는 변경 보고에 prompt UI 동작 변경 없음과 실행한 정적 검증을 분리해서 적고, 활성 prompt 파일이 함께 바뀐 경우에만 위 P0/P1 범위를 다시 실행한다.

## 릴리스

### P0 Smoke

1. `릴리스` 탭을 연다.
2. 현재 버전과 최신 버전이 표시되는지 확인한다.
3. 최신 릴리스 카드와 다운로드 버튼이 보이는지 확인한다.
4. `hosting/extension-v2/releases/latest.json`, `history.json`, `releases/release-notes.json`의 버전 정보가 화면과 맞는지 본다.
5. 상용 배포 직후에는 `downloads/latest.zip`과 버전별 ZIP 경로가 같은 release metadata를 가리키는지 확인한다.
6. retired 버전 정리 후에는 `history.json`과 화면의 이전 릴리스 목록에 retired 버전 카드나 버전별 다운로드 링크가 다시 노출되지 않아야 한다. 이 정리만으로 `manifest.json`, `content/*`, `background/*`, `popup/*`, 확장 번들 `shared/*`가 바뀌지 않았다면 확장 재배포가 아니라 Hosting metadata 반영 범위로 보고한다.

### P1 Regression

1. `runtime.invoke.v1`과 `release.download.open` capability가 있을 때 다운로드 버튼이 동작하는지 확인한다.
2. capability가 없을 때 버튼이 성공처럼 보이지 않고 비활성/제한 문구가 보여야 한다.
3. fetch 실패 시 cached/stale/degraded 상태가 숨겨지지 않아야 한다.
4. `updateAvailable`은 현재 버전 기준 재검사 완료 후에만 true여야 한다.
5. `download-latest`와 버전별 다운로드 경로를 혼동하지 않는지 확인한다.

### 주의 리스크

- `versionRefreshPending` 중 최신 섹션이 숨겨져 릴리스 누락을 놓칠 수 있다.
- 로컬 캐시가 stale 상태를 가리면 실제 최신성 검증을 놓친다.
- `hosting/*`만 바뀐 경우와 확장 번들 변경이 있는 경우의 배포 안내가 달라야 한다.

## 전체 회귀 순서

빠른 전체 smoke는 아래 순서로 돈다.

1. 공통 준비와 iframe/console baseline 확인
2. 대화 탭 빈 상태
3. 대화가 있는 세션의 질문 수집, 검색, 실제 이동
4. 회의 룸 목록, 회의 사용량 미니 통계, 기존 결과/작업실 열기
5. 회의 작업실 shell, 기존 완료 record, 상태/회의 정리/메모/원문 탭 확인
6. 회의 작업실 녹음 또는 파일 import 중 하나를 짧은 P1 범위로 확인
7. 프롬프트 `내 요청` 렌더링과 입력창 주입
8. 프롬프트 `스토어` 목록과 상세 1건
9. 프롬프트 `검토` 실행과 입력창 반영
10. 릴리스 버전/다운로드 표시
11. 사용량 계측 P1 Aggregate 확인
12. 다른 대화 또는 다른 탭으로 이동 후 route/tab 상태가 오염되지 않는지 확인
13. console warning/error 최종 확인

## 로컬 데이터와 로그 점검

프롬프트 저장/동기화나 회의 데이터처럼 브라우저만으로 성공 판단이 부족한 흐름은 아래 명령을 보조 증거로 쓴다.

### Feature Usage 점검

상용 풀 테스트에서 meaningful action을 실행했으면 aggregate 반영까지 본다.

```bash
npm.cmd run check:feature-usage -- --days 1 --limit 20
```

해석 기준:

- `users=0`이면 아직 실제 delta가 commit되지 않은 상태다. 60초 flush, tab hide/pagehide, provider identity, `metrics.feature-usage.commit` capability를 다시 본다.
- 기대 user가 보이지만 count가 늘지 않으면 duplicate snapshot no-op인지, allowlist 밖 action인지, lower counter replay인지 확인한다.
- 사용량 집계는 raw click 로그가 아니라 client/day cumulative snapshot delta이므로, 상용 테스트 후 삭제할 raw log 파일은 없다.

### Firestore 빠른 점검

```bash
npm.cmd run check:cloud-sync -- --userKey <providerUserKey> --samples 2 --wait 20
```

정상 해석:

- 저장 직후 `lastPromptSyncAt`, `lastSyncedAt`, `updateTime`이 최근 시간으로 바뀐다.
- 아무 조작 없이 다시 실행했을 때 `integration doc changed: NO`, `prompt library doc changed: NO`면 idle 루프가 없다.
- 아무 조작 없이도 시간이 계속 바뀌면 동기화 루프를 의심한다.

### 함수 호출 빠른 점검

```bash
npm.cmd run check:function-logs -- --since 10 --limit 100
```

해석 기준:

- `sync.success: 1`은 저장 1회 후 기대하는 정상 패턴에 가깝다.
- 저장을 여러 번 하지 않았는데 `sync.success: 3` 이상이면 과호출 가능성을 본다.
- `peek.success`가 있고 `load.success`가 0이면 원격 최신 여부만 확인하고 전체 보관함은 가져오지 않은 상태다.
- `sync.error`가 보이면 브라우저 콘솔보다 먼저 이 로그와 Firestore 갱신 여부를 함께 본다.

### 회의 데이터 점검

```bash
npm.cmd run check:meeting-data
npm.cmd run check:meeting-data -- --meeting-id <meetingId>
```

회의 사용량 accounting 또는 backfill 경계를 바꿨다면 dry-run으로 보정 대상도 확인한다. 상용 aggregate를 쓰는 `--execute`는 별도 운영 승인 없이 실행하지 않는다.

```bash
npm.cmd run backfill:meeting-usage -- --limit 20
```

실제 삭제 전에는 dry-run을 먼저 본다.

```bash
npm.cmd run delete:meeting-data -- --all
npm.cmd run delete:meeting-data -- --meeting-id <id>
```

### 삭제 후 DB/Storage 점검

삭제 검증은 UI에서 카드가 사라진 것만으로 통과시키지 않는다. 되돌림 비용이 있으므로 반드시 테스트용 데이터만 만들고, 제목이나 메모에 `qa-delete-<date>-<scope>` 같은 고유 marker를 넣은 뒤 사용자 승인 또는 명확한 P2 요청이 있을 때만 실행한다.

```bash
npm.cmd run check:prompt-data -- --user-key <providerUserKey> --prompt-id <promptId>
npm.cmd run check:prompt-data -- --store-entry-id <entryId>
npm.cmd run check:meeting-data -- --meeting-id <meetingId>
```

해석 기준:

- `내 요청` 삭제: `deleteCheck=PASS_ABSENT`여야 한다. 항목별 top-level 문서는 없고, `prompt_library_orders_v2/{promptLibraryId}`의 `orderedIds`와 `prompt_library_chunks_v2/{promptLibraryId}__{bucketId}`의 `items`에서 해당 `promptId`가 빠지는 것이 기준이다. `countCheck=WARN_MISMATCH`가 나오면 UI count와 원격 meta를 다시 본다.
- `prompt_libraries_v2/{promptLibraryId}`와 `integration_inova_accounts_v2/{providerUserKey}`는 삭제 후에도 남는다. 여기에는 본문 항목이 아니라 `itemCount`, `lastRevision`, `lastSyncedAt` 같은 sync meta가 남는 것이 정상이다.
- `프롬프트 스토어` 삭제: `unpublishCheck=PASS_REMOVED`여야 한다. 현재 구현은 entry 문서를 지우지 않고 `status=removed`, `hasDetail=false`, `removedAt`으로 soft-remove한 뒤 detail 문서와 feed 노출을 제거한다. 목록/검색/상세에서도 다시 열리면 실패다.
- `회의 기록 삭제`: API 응답 직후에는 job이 `status=deleted`, `deletedAt`으로 먼저 표시되고 cleanup task가 남을 수 있다. cleanup trigger 완료 뒤에는 해당 `meetingId` 기준 jobs, parts, finalizers, artifacts, commands, storage object residual이 없어야 한다.
- `회의 룸 삭제`: API 응답 직후에는 meeting이 `deletedAt`으로 목록에서 숨겨지고 연결된 jobs가 soft-delete될 수 있다. cleanup 완료 뒤에는 `integration_inova_meetings`, `integration_inova_meeting_jobs`, runtime artifacts, launch/session 문서와 storage object residual이 없어야 한다. `integration_inova_meeting_deletions`가 retry/abandoned로 남으면 cleanup 미완료다.

## 검증 명령 기준

- 문서만 바꿨으면 `npm.cmd run verify:docs`
- PR/feature E2E 문서 가드를 확인하려면 `npm.cmd run verify:e2e-doc-guard`
- 대화 탭 렌더/컨텍스트/검색 변경이면 `npm.cmd run verify:panel-render`
- 회의 허브 변경이면 `node scripts/verify-meeting-hub-controller.js`
- 회의 작업실 UI 변경이면 `npm.cmd run verify:meeting-hosted-ui`
- 회의 notes/service/audio 정책 변경이면 `npm.cmd run verify:meeting-notes-generation`, `npm.cmd run verify:meeting-service`, `npm.cmd run verify:meeting-audio-source-policy`, `npm.cmd run verify:meeting-transcription-quality`
- prompt store model 변경이면 `npm.cmd run verify:prompt-store-model`
- prompt library/review/store 전체 영향이면 `npm.cmd run verify:prompt-runtime-local`, `npm.cmd run verify:prompt-library-remote-first`, `npm.cmd run verify:prompt-hosted-tabs`, `npm.cmd run verify:prompt-review`
- 릴리스 산출물 변경이면 `npm.cmd run release:build` 후 `node scripts/verify-release-package.js`
- 범위가 넓거나 배포 전이면 `npm.cmd run verify`
