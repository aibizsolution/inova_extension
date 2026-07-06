# 회의 E2E 체크리스트

이 문서는 회의 룸 패널과 hosted 회의 작업실의 실제 Chrome 검증 항목을 관리한다. 전체 PR 기준선, 공통 준비, 테스트 강도 정의는 `docs/e2e-browser-workflow.md`를 따른다.

## PR 반영 규칙

- 회의 패널, hosted 작업실, meeting Functions, Firestore rules/index, meeting capability를 바꾸는 PR은 이 문서를 같은 PR에서 갱신한다.
- PR 번호가 아직 없으면 기능명 또는 브랜치 scope로 항목을 갱신하고, PR 생성 뒤 필요한 경우 PR 설명에서 이 문서 변경을 언급한다.
- 상용 배포나 `release:build` 전에 이 문서가 먼저 최신이어야 한다. 배포 후 actual Chrome 풀 테스트는 이 문서를 기준으로 수행한다.
- 회의 기능의 최신 PR 번호 히스토리는 이 문서에 누적하지 않는다. 마지막 merged PR 기준선은 `docs/e2e-browser-workflow.md`에만 둔다.

## 회의룸 패널 P0

1. 팝업 target을 확인한다. 로컬 full-stack이면 `npm.cmd run emulator:meeting-local`이 떠 있어야 한다.
2. `회의 룸` 탭을 연다.
3. 화면 순서가 맞는지 확인한다.
   - `회의 룸 N / 닫기`
   - `새 회의 룸 생성`
   - 사용량 미니 통계
   - `전체 / 내 회의룸 / 참여한 회의룸` 탭
   - `회의룸 찾기`
   - 목록과 총 건수
4. 내 회의룸 목록이 로드되는지 본다.
   - 목록은 `integration_inova_meetings` owner query, 최신순, 최대 24건 기준이다.
   - 로딩 실패 시 cached/stale/degraded/empty 문구가 숨겨지지 않아야 한다.
5. 참여 회의룸 목록이 로드되는지 본다.
   - 목록은 `integration_inova_meeting_participations`의 viewer query만 읽는다.
   - 참여 카드 표시를 위해 `integration_inova_meetings` 원본 문서를 카드마다 추가 get하면 실패다.
6. 회의 사용량 미니 통계가 로드되는지 본다.
   - 본인 현재 월 집계 doc 1개와 전체 집계 doc 1개만 읽는다.
   - 탭 전환이나 검색으로 사용량 listener가 다시 붙으면 실패다.
7. 기존 회의 카드 1건에서 `작업실 열기` 또는 `결과 열기`를 실행한다.
8. hosted panel은 사용자 action 안에서 새 탭을 web-open으로 먼저 확보해야 한다.
   - 새 회의룸은 client meetingId를 생성한 뒤 현재 hosting origin의 `/meeting/index.html?meetingId=...` URL을 바로 연다.
   - 기존 회의룸이나 결과는 전달받은 `meetingId`, optional `jobId`, optional `participationId`를 붙인 clean hosted URL을 바로 연다.
   - 그 다음 `meeting.workspace.prepare-open` 또는 `meeting.result.prepare-open`으로 준비한 최종 URL이 다르면 같은 탭을 그 URL로 이동시킨다.
   - web-open이 성공하면 `meeting.workspace.open` / `meeting.result.open` background fallback이 실행되지 않아야 한다.
   - panel 쪽 콘솔은 launch requested/prepared/dispatched/accepted 수준까지 확인한다.
9. Playwright Bridge가 열린 새 탭을 자동으로 목록에 보여주지 않을 수 있다. 이 경우 제품 실패로 보지 말고, `window.open` 호출 또는 prepared URL을 확인한 뒤 내부 작업실 검증은 Bridge-controlled tab을 해당 URL로 직접 이동해 수행한다. 결과에는 `URL 기반 직접 이동으로 내부 테스트`라고 적고, 실제 Chrome 새 탭 자동 승계 검증과 섞지 않는다.
10. 실제 새 탭 lifecycle 자체가 검증 목적이면 Bridge selector를 다시 열어 사용자가 열린 작업실 탭을 선택한다.
11. hosted 작업실에서 session 허용 상태면 workspace가 렌더링되고, 미허용 상태면 blocked 화면이 보여야 한다.

## 회의룸 패널 P1

1. `전체`, `내 회의룸`, `참여한 회의룸` 탭을 모두 전환한다.
   - `전체`는 owned snapshot과 participation snapshot을 controller memory에서 병합해야 한다.
   - 전체 탭 때문에 추가 Firestore query를 만들면 실패다.
   - 탭은 프롬프트 탭과 같은 공통 subtab 스타일을 쓰고, 0건 count badge는 표시하지 않는다.
2. 검색을 실행하고 초기화한다.
   - 검색은 현재 로드된 목록 안에서 client-side filter로 동작해야 한다.
   - 검색 대상은 제목 snapshot, owner 표시명/email 수준으로 제한한다.
   - 검색 결과 0건은 `검색 결과가 없습니다.`로 보여야 하며, 회의룸 생성 안내를 재사용하면 실패다.
   - `참여한 회의룸` 0건은 `참여한 회의룸이 없습니다.`로 보여야 하며, 내 회의룸 생성 안내를 재사용하면 실패다.
3. 카드 badge와 액션을 확인한다.
   - 내 회의룸: `공유`, `공유 해제`, `삭제`
   - 공유 중인 내 회의룸: 카드 액션 줄 왼쪽에 현재 shareId 기준 집계인 `열람 N명`이 보여야 한다.
   - 참여 active: `참여`, `목록에서 제거`
   - 참여 unavailable: `접근 불가`, `목록에서 제거`
   - 카드 제목 줄에는 제목과 내 소유가 아닌 회의룸의 `참여`/`접근 불가` 배지만 보여야 한다. `기록 있음`/`기록 없음` 같은 기록 상태는 날짜 메타 줄에 표시한다.
   - 참여 카드 액션 줄 왼쪽에는 i-Nova에서 수집한 공유자 표시명만 보여주고, 이메일은 hover tooltip으로만 확인한다.
4. `open-result`와 `open-workspace`가 구분되어 동작하는지 확인한다.
   - 결과가 있는 기록은 결과로 열리고, 작업실 진입은 workspace URL로 열려야 한다.
5. 공유 생성/공유 해제 버튼은 capability와 권한이 있을 때만 보여야 한다.
   - `meeting.share.create-function`
   - `meeting.share.revoke-function`
   - `공유 해제` 클릭 시 시스템 팝업이 아니라 카드 안에서 현재 `열람 N명`과 기존 링크 참여자의 즉시 접근 차단을 설명하는 확인 문구가 먼저 보여야 한다.
6. popup에서 `로컬 호스팅`과 `상용 호스팅`을 전환한다.
   - 선택 상태와 local override가 즉시 반영되어야 한다.
   - 열린 workspace URL이 이전 origin에 묶여 있으면 실패다.

## 공유 참여 Shortcut P1

1. 테스트용 owned 회의룸을 만들고 공유 링크를 생성한다.
2. 다른 사용자로 공유 링크를 최초 정상 접속한다.
   - workspace가 readonly로 열려야 한다.
   - `integration_inova_meeting_participations/{viewerProviderUserKey}__{ownerProviderUserKey}__{meetingId}` 문서가 생성되어야 한다.
   - owner meeting 문서의 현재 `share.participantCount`가 1 증가해야 한다.
   - 실제 생성 또는 hidden 복구가 일어난 경우에만 `회의룸을 내 목록에 추가했어요.` toast가 떠야 한다.
3. 같은 공유 링크를 반복 접속한다.
   - participation write가 없어야 한다.
   - 현재 `share.participantCount`가 다시 증가하면 실패다.
   - `lastRefreshAt`은 24시간 throttle 전에는 갱신되지 않아야 한다.
   - 반복 접속에서는 자동 등록 toast가 없어야 한다.
4. 회의 룸 패널에서 `참여한 회의룸` 탭을 연다.
   - 참여 카드가 보여야 한다.
   - 날짜 줄에는 `최근 업데이트`/`최근 기록` 같은 반복 라벨을 노출하지 않고 날짜만 보여야 한다.
5. 참여 카드에서 다시 작업실을 연다.
   - raw share token 없이 `participationId` 기반으로 재접속해야 한다.
   - 서버는 participation 문서만으로 권한을 확정하지 않고 현재 meeting share 상태까지 함께 검증해야 한다.
6. `목록에서 제거`를 실행한다.
   - UI 목록에서 카드가 사라져야 한다.
   - Firestore participation 문서는 삭제가 아니라 `hidden: true`, `hiddenAt`, `updatedAt`으로 갱신되어야 한다.
7. 제거한 사용자가 같은 공유 링크로 다시 정상 접속하면 hidden 복구 write가 발생하고 카드가 다시 보여야 한다.
8. owner가 자기 공유 링크를 열어도 participation 문서가 생성되면 안 된다.
9. owner가 공유를 해제하면 함수가 현재 `shareId`의 participation shortcut들을 `accessState: revoked`, `hidden: false`로 갱신해야 한다.
   - 참여자 목록에서는 비활성 카드가 남고, 액션은 `목록에서 제거`만 보여야 한다.
   - 참여자가 다시 열면 접근이 거절되어야 한다.
10. owner가 공유 링크를 다시 생성하면 새 `shareId`가 발급되고 `share.participantCount`는 0부터 다시 시작해야 한다.

## Firestore 비용 확인

- 내 회의룸: `integration_inova_meetings` owner query, 기본 limit 24.
- 내 회의룸의 `열람 N명`: owned meeting 문서의 `share.participantCount` snapshot만 사용하고, 목록 렌더링 중 participation 집계를 추가로 읽으면 실패다.
- 참여 회의룸: `integration_inova_meeting_participations` viewer query, `hidden == false`, `lastRefreshAt desc`, limit 24.
- 전체 탭: 추가 query 없이 owned + participation 메모리 병합.
- 사용량 대시보드: 기존 aggregate 2개 문서만 읽기.
- 검색: Firestore query 없음.
- 공유 링크 반복 접속: 기본 write 없음.
- title snapshot refresh: hash 변경 + 마지막 refresh 후 24시간 이상일 때만 write.
- share revoke: owner action 시점에 현재 `shareId`의 participation shortcut만 fan-out update해서 `revoked`로 비활성화한다.
- 새 shareId 생성: 기존 shareId의 열람자 수와 참여 상태를 재사용하지 않는다.

## 회의 작업실 P0

1. 회의 허브에서 작업실을 열거나, 승인된 meeting session URL로 작업실을 연다. 회의 허브는 web-open 우선 경로로 현재 hosting origin의 clean 작업실 URL을 먼저 열고 prepared URL로 보정해야 한다. 열린 실제 Chrome 새 탭을 확인하려면 기존 패널 탭이 아니라 새 탭을 Bridge selector로 다시 선택한다. URL을 알고 있고 내부 shell만 확인하면 Bridge-controlled tab을 같은 URL로 직접 이동해 테스트할 수 있으며, 이 결과는 `URL 기반 직접 이동으로 내부 테스트`로 기록한다.
2. 작업실이 blocked 화면이 아니라 실제 shell로 뜨는지 확인한다.
   - 직접 clean URL만 붙여 넣어 세션이 없으면 blocked 화면이 정상이다. 이 화면은 `inova-status-state` 디자인 시스템 primitive를 써야 하고, icon/eyebrow/title/body/hint가 viewport 정중앙에 있어야 한다.
   - 패널에서 연 owner workspace는 `meetingSessionToken`을 받아 실제 shell로 들어가야 한다.
3. hosted 작업실 URL에 필요하면 `?debug=1`을 붙이고 새 탭 DevTools 콘솔 필터를 `inova:`로 둔다.
4. hosted 콘솔에서 아래 순서를 확인한다.
   - `workspace.bootstrap`
   - `workspace.realtime.connect.success`
   - `workspace.ready`
5. 회의 룸 header, 기록 추가 카드, 기록 선택 목록, 기록 상세 영역이 렌더링되는지 본다.
6. 기록 목록이 먼저 보이고, 선택된 record detail은 뒤늦게 비차단으로 채워지는지 본다.
   - 완료 record에 `artifactId`가 있는데 상세 artifact가 아직 로드되지 않은 순간에는 `회의 정리 없음`/degraded 문구가 먼저 보이면 실패다.
   - 이 구간은 상세 로딩 상태로 보여야 하며, artifact read 이후 실제 notes/segments가 없을 때만 empty/degraded 문구가 보여야 한다.
7. 완료된 기존 record 1건을 선택한다.
8. `상태`, `회의 정리`, `메모`, `원문` 탭 전환이 정상인지 본다.
9. 완료 record에서만 `회의 정리 복사`, `원문 복사`, `용어 치환` action row가 보여야 한다.

## Recording/Import P1

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
   - chunk 정책 변경 PR에서는 hosted 기본값이 OpenRouter-safe 기준인 10분 target, 14MB target, 1.5초 overlap인지 source policy 검증으로 확인한다. 실제 긴 파일을 기다리는 대신 fixture/stub 또는 기존 운영 evidence로 part 수와 part size 상한을 확인한다.
9. 원격 처리 성공 후 completed record 검증은 기존 완료 record를 우선 사용하고, 새 녹음의 전사 완료까지 오래 기다리지 않는다.
   - AI provider 우선순위 변경 PR에서는 `INOVA_EXTENSION_AI_PROVIDER_CONFIG` JSON secret에 `openrouter.apiKey`가 포함되어 Functions에 mount된 상태에서 짧은 샘플 import 또는 기존 완료 record 기반 재처리를 확인한다. 회의 전사와 회의록 생성은 `gemini.apiKey`도 같은 JSON 안에서만 관리한다. 전사는 Gemini Files API, 회의록 생성/섹션 AI 수정은 Gemini OpenAI-compatible chat completion이 먼저 호출되어야 한다. Gemini 빈 전사/truncation/timeout 또는 JSON shape 실패는 성공으로 저장하지 않고 OpenRouter fallback, explicit error, 또는 degraded 상태로 드러나야 한다.
   - 실패 후 재시도 또는 운영 복구로 completed가 된 record는 Firestore job의 `status`와 `notesStatus`가 성공 상태이고, 이전 실패의 `error`와 `retry.lastError`가 completed 화면에 남지 않아야 한다.
10. completed record에서 `원본 다운로드`가 가능해야 한다. Bridge에서 blob anchor 다운로드가 `download` 이벤트로 잡히지 않을 수 있으므로, 이 경우 버튼 click handler, 성공 토스트, 로컬 pending blob 존재를 함께 보고 실패 여부를 판단한다.

## Notes/Edit/Recovery P1

1. 완료 record에서 `회의 정리` 탭을 연다.
2. `회의 정리 복사`와 `원문 복사`가 실제 clipboard 동작까지 되는지 확인한다.
3. `용어 치환`을 연다.
   - 치환 추가, 변경 취소, 전체 비우기, `용어 치환 적용하기` 버튼 상태가 맞아야 한다.
   - 저장 후 같은 회의 룸의 회의 정리에 적용되어야 한다.
4. 회의 정리 섹션에서 `직접 수정`, `AI 수정`, `삭제`가 분리되어 보여야 한다.
5. `AI 수정`은 `AI 미리보기 -> 적용` 순서여야 하고, preview 없는 apply는 막혀야 한다.
   - 회의록 요약/수정 모델 기본값이 바뀐 PR에서는 기존 완료 record에서 AI 미리보기 1회를 실행해 응답 품질, timeout/degraded 표면, preview 적용 흐름을 함께 확인한다.
   - 회의록 생성 모델 또는 요청 파라미터가 바뀐 PR에서는 최신 completed job의 `notesStatus`가 `succeeded`인지 확인하고, `notesDegradedReason`에 모델 파라미터 오류가 남지 않는지 Firestore에서 함께 확인한다.
   - 자동 회의록 prompt 품질 가드가 바뀐 PR에서는 기존 완료 record의 전사 1건으로 재생성 비교를 수행한다. 검토, 재확인, 제안, 테스트 가능성이 `decisions`로 승격되지 않고 `actionItems`, `openQuestions`, `risksOrDependencies` 중 맞는 곳에 남는지 확인한다. 같은 사안이 핵심 요약이나 개요에서 하기로 했다, 추진하기로 했다 같은 확정 표현으로 보이지 않는지도 함께 확인한다. 모델이 약한 결정을 반환해도 Functions normalizer가 `decisions`에서 제거하는지 `verify:meeting-notes-generation`으로 확인한다.
   - Gemini 회의록 튜닝 PR에서는 `npm.cmd run eval:gemini-meeting-notes` 리포트의 평균 점수가 같은 evaluator version의 이전 성공/기준 리포트보다 올라간 경우만 성공으로 본다. 리포트에는 최소 1개 이상의 기존 completed record 재생성 결과와 weak commitment prose, weak consensus prose, awkward softened prose, sourceTrace/follow-up coverage 패널티가 남아 있는지 포함되어야 한다.
   - 튜닝 리포트에서 테스트하기로, 해보기로, 지원하기로 같은 문장이 남아 weak commitment prose 패널티를 만들거나, 테스트를 우선 진행 방안 같은 어색한 완화 문장이 남으면 다음 튜닝은 해당 표현이 자연스러운 논의/검토 문장으로 낮아지는지 확인한다.
   - sourceTrace/follow-up coverage 튜닝에서는 실제 completed record 재생성 리포트에서 full 회의록 sourceTrace 6개가 주요 summary/discussion/action/open/risk 근거를 가리키는지, 권장했다/필수다 같은 평가형 표현이 중립 문장으로 낮아졌는지 함께 본다.
   - actionItems coverage 튜닝에서는 기존 기능 재확인, API 규격 협의, 데이터 조사, 자료 작성 요청, 보고처럼 전사에 나온 실제 후속 행동이 담당자/기한이 비어도 actionItems로 남는지 리포트와 화면에서 확인한다.
   - OpenRouter provider 경로를 바꾼 PR에서는 AI 미리보기 1회가 OpenRouter 모델로 먼저 완료되는지 보고, 실패 시 `degraded` 또는 explicit error가 남는지 확인한다.
6. `직접 수정`은 미리보기 없이 해당 섹션만 저장해야 한다.
   - 긴 업무 회의록 보정 PR에서는 `논의 흐름` 10개, `추가 결정 필요 사항` 7개, `리스크 및 제약` 6개, `후속 실행 항목` 8개 수준의 긴 섹션을 저장해도 화면과 Firestore notes에서 잘리지 않는지 확인한다. 현재 안전 상한은 discussionFlow 12개, keyPoints 6개, decisions 8개, actionItems 12개, openQuestions 12개, risksOrDependencies 10개다.
   - `회의 개요` 직접 수정에서는 `[일시]`, `[참여자]`, `[목적]`, `[개요]`의 대괄호를 지우고 `일시`, `참여자`, `목적`, `개요` 제목 줄만 남겨도 각 필드가 저장되어야 한다. 표식 없이 본문만 입력한 경우에는 입력 전체가 `overview` 본문으로 저장되어야 한다.
7. `메모` 탭에서 기록 메모 저장이 completed record에만 가능해야 한다.
8. read-only 또는 공유 링크 모드라면 저장/삭제/이동/용어 치환 같은 mutation 버튼이 숨겨지거나 비활성화되어야 한다.
9. pending upload queue가 degraded면 warning notice와 hosted console trace가 함께 남아야 한다.

## P2 Destructive/Deep

1. 새 녹음 또는 파일 import 1건을 끝까지 처리한다.
2. 회의 제목/메모/결과 수정 또는 삭제 1회를 확인한다.
3. `기록 이동`은 완료 remote record에서만 실행한다.
   - 이동 성공 후 source 회의 룸에서 사라지고 target 회의 룸에 동일 전사/회의 정리/메모가 남아야 한다.
   - 브라우저 로컬 pending copy도 target 회의 룸으로 함께 이동해야 한다.
4. `기록 삭제`와 `회의 룸 삭제`는 사용자 승인 후에만 실행한다.
   - 삭제 뒤 local pending copy가 다시 살아나지 않아야 한다.
   - cleanup degraded가 있으면 숨기지 않고 warning/trace로 남아야 한다.
5. queue fault 주입은 `debugQueueSandbox=1` 같은 sandbox에서만 한다.
   - `queueFaults.scenarios()`
   - `queueState()`
   - `queueValidation.check(...)`
6. 긴 녹음, 2시간 한계, 대용량 업로드, 장시간 전사 queue 검증은 실제 시간을 채워 실행하지 않는다.
   - 짧은 fixture, metadata stub, sandbox fault로 같은 분기와 문구를 검증할 수 있을 때만 실행한다.
   - 그런 준비가 없으면 P2 항목으로 기록하고 이번 actual Chrome run에서는 skip한다.

## Debug Evidence

hosted workspace 이슈는 top panel 콘솔에서 끝까지 닫지 않는다. panel 콘솔은 launch dispatch까지만 보고, 새 탭 DevTools 콘솔에서 hosted trace를 본다.

필요 시 아래 helper를 순서대로 실행한다.

```js
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleState()
__INOVA_HOSTED_MEETING_DEBUG__.debugConsoleValidation.checkWorkspace()
__INOVA_HOSTED_MEETING_DEBUG__.errors()
__INOVA_HOSTED_MEETING_DEBUG__.printPendingSyncEvidence({ queueLimit: 20, entriesLimit: 40 })
```

최소 증거는 화면 스크린샷, `inova:` trace, `errors()` 출력, pending sync evidence다.

## 주의 리스크

- cached 목록을 fresh로 오판하기 쉽다.
- local/prod target을 바꿨는데 workspace만 이전 origin으로 열릴 수 있다.
- 읽기 전용 상태에서 저장/공유 버튼이 살아 있으면 실패다.
- 일반 이동에서도 `beforeunload`가 뜨면 사용자 흐름을 과하게 막는 오탐다.
- 참여 목록 카드는 snapshot 기반이므로 원본 회의 최신 기록과 실시간 일치를 보장하는 UI처럼 보이면 실패다.
