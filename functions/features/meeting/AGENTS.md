# functions meeting feature

## 기능 목적
- 회의 launch/session auth, 회의 job 생성, chunk worker, finalizer, 결과 수정/삭제, 회의록 섹션 수정 preview/apply를 다룬다.

## 먼저 볼 파일
- `functions/features/meeting/meeting-launch-service.js`
- `functions/features/meeting/meeting-common-domain.js`
- `functions/features/meeting/meeting-creation-domain.js`
- `functions/features/meeting/meeting-deletion-domain.js`
- `functions/features/meeting/meeting-notes-context-domain.js`
- `functions/features/meeting/meeting-notes-edit-domain.js`
- `functions/features/meeting/meeting-notes-document-domain.js`
- `functions/features/meeting/meeting-notes-generation-domain.js`
- `functions/features/meeting/meeting-notes-runtime-domain.js`
- `functions/features/meeting/meeting-notes-source-domain.js`
- `functions/features/meeting/meeting-mutation-domain.js`
- `functions/features/meeting/meeting-owned-query-domain.js`
- `functions/features/meeting/meeting-processing-domain.js`
- `functions/features/meeting/meeting-processing-runtime-domain.js`
- `functions/features/meeting/meeting-runtime-artifact-domain.js`
- `functions/features/meeting/meeting-result-domain.js`
- `functions/features/meeting/meeting-record-domain.js`
- `functions/features/meeting/meeting-source-domain.js`
- `functions/features/meeting/meeting-summary-sync-domain.js`
- `functions/features/meeting/meeting-state-domain.js`
- `functions/features/meeting/meeting-service.js`
- `functions/features/meeting/meeting-transcript-domain.js`
- `functions/features/meeting/meeting-usage-accounting-domain.js`

## 관련 프론트 경로
- `content/meeting-manager.js`
- `hosting/meeting/index.js`
- `background/service-worker.js`
- `shared/meeting-bridge.js` - inactive legacy reference

## 관련 functions 경로
- `functions/index.js`
- `functions/platform/*`
- `docs/release-workflow.md`는 version gate와 release decision 기준을 맡고, `docs/runtime-architecture.md`는 meeting runtime/compat boundary 기준을 맡는다.
- `docs/functions-runtime-guide.md`는 runtime sizing과 운영 튜닝 기준을 맡는다.

## meeting 리팩토링 경계 규칙
- `meeting-service.js` 분리는 line count 자체가 아니라 `workflow`, `persisted data contract`, `queue lifecycle`, `notes/source/record/state` 같은 도메인 경계를 기준으로 판단한다.
- `meeting-service.js`의 목표 end-state는 `legacy handler/export surface + cross-domain orchestration`이다. 여러 domain 결과를 묶어 auth, Firestore, Storage, OpenAI 흐름을 끝내는 helper는 service 안에 남길 수 있다.
- `common`, `guard`처럼 얇은 helper-only 파일은 새로 늘리기 전에 재사용, 독립 테스트 가치, 분리된 변경 이유가 충분한지 먼저 확인한다.
- `meeting-common-domain.js`는 `meeting-service.js`, `meeting-launch-service.js`, `meeting-workspace-auth-service.js`가 함께 쓰는 shared normalization boundary다.
- ownership assert와 제목 동기화 helper는 service-local workflow에 가까우므로 `meeting-service.js` 안에 남긴다.
- `meeting-creation-domain.js`, `meeting-processing-domain.js`, `meeting-summary-sync-domain.js`, `meeting-deletion-domain.js`, `meeting-notes-source-domain.js`처럼 설명 가능한 workflow/data boundary만 독립 모듈로 유지한다.
- `meeting-processing-runtime-domain.js`는 AI provider 전사 호출(Gemini Files API 우선, OpenRouter/OpenAI fallback), retry/error 분류, chunk 병렬 처리, transcript merge/dedupe를 묶는 runtime boundary다. `meeting-processing-domain.js`는 queue/finalizer workflow를 유지하고 runtime 세부 정책은 이 모듈에 위임한다.
- `meeting-runtime-artifact-domain.js`는 temp source 업로드/정리, chunk transcript 저장/로드, runtime artifact cleanup을 묶는 storage lifecycle boundary다. `meeting-creation-domain.js`, `meeting-processing-domain.js`, `meeting-deletion-domain.js`가 같은 runtime artifact 규칙을 공유할 때 이 모듈을 우선 본다.
- `meeting-owned-query-domain.js`는 owner-scoped meeting/job 조회를 묶는 Firestore query boundary다. `meeting-notes-edit-domain.js`, meeting hub list, delete request handler가 같은 owner filter와 emulator fallback 규칙을 공유할 때 이 모듈을 우선 본다.
- `meeting-deletion-domain.js`는 queue/sweep뿐 아니라 soft delete 시작 단계도 포함한 deletion workflow boundary다. 회의 결과/회의 삭제 handler는 tombstone patch를 직접 만들기보다 이 모듈에 위임한다.
- `meeting-notes-edit-domain.js`는 `termReplacements` 저장 이후 결과 notes 재적용과 section preview/apply, notes 기반 제목 sync를 묶는 workflow boundary다.
- `meeting-notes-generation-domain.js`는 signal gate, full/compact notes 생성, section/reducer prompt builder, compact notes 후처리를 묶는 workflow boundary다.
- `meeting-result-domain.js`는 결과 title/sharedMemo 수정과 record move transaction, recentJobs sync를 묶는 workflow boundary다.
- `meeting-usage-accounting-domain.js`는 성공 처리된 회의 녹음 사용량 원장과 aggregate 갱신을 묶는 accounting boundary다. quota 차단은 이 모듈의 현재 책임이 아니며, job/artifact/summary 저장 성공 후 best-effort로 호출되어 실패해도 회의 결과 생성을 실패시키지 않는다.
- `updateInovaMeeting`는 mutation accepted만이 아니라 수정된 `meeting` payload도 계속 돌려준다. hosted-only service harness와 response envelope 회귀 점검에서 이 계약을 유지한다.
- 회의록 보정은 `termReplacements` 저장과 `preview/apply section edit` 두 경로로만 확장한다. 추가 맥락 기반 전체 재생성 경로는 다시 도입하지 않는다.
- 회의록 자동 생성은 `skip`만이 아니라 `full`과 `compact` 두 출력 프로필을 가질 수 있다. 짧은 테스트성/저신호 전사는 `compact`로 정리하되, 정식 회의처럼 서사를 부풀리지 않는다.
- 회의록 자동 생성은 항목 수를 채우기 위해 결정/리스크/미결정 사항을 만들지 않는다. 각 배열은 근거가 없으면 0개가 정상이며, 근거가 많을 때만 상한까지 분리한다.
- 회의록 자동 생성의 `decisions`는 전사에 확정, 합의, 승인, 하기로 했다 같은 명시적 결정 근거가 있을 때만 채운다. 검토, 재확인, 제안, 테스트 가능성은 decision으로 승격하지 않고 actionItems/openQuestions/risksOrDependencies에 둔다.
- 기존 기능 재확인, API 규격 협의, 데이터 조사, 자료 작성 요청, 보고처럼 실제 후속 행동이 전사에 나오면 담당자/기한이 비어도 `actionItems`에 남긴다. 단순한 추가 검토 필요 같은 일반론은 action item으로 만들지 않는다.
- decision 근거가 약한 사안은 `summary`, `overview`, `discussionFlow`에서도 하기로 했다, 추진하기로 했다 같은 확정 표현으로 쓰지 않는다. 논의했다, 검토했다, 확인 필요로 남았다처럼 근거 수준에 맞춰 쓴다.
- 권장했다, 필수다, 반드시 해야 한다처럼 회의록 작성자가 평가·자문하는 듯한 표현은 피하고, 전사 근거 수준에 맞춰 대안으로 제시했다, 필요성이 언급됐다, 검토 대상으로 남았다처럼 중립화한다.
- notes normalizer는 모델이 약한 결정을 반환해도 테스트, 검토, 재확인, 제안, 협의, 가능성 같은 항목을 `decisions`에서 제거한다. 확정, 승인, 합의, 최종 결정처럼 강한 근거가 있는 결정만 보존한다.
- Gemini 회의록 튜닝은 `run-gemini-meeting-notes-tuning-eval.js` 리포트로 같은 evaluator version의 이전 평균 점수보다 개선된 경우만 성공으로 센다. v2 평가는 weak decision/prose뿐 아니라 weak consensus 표현, 어색한 deterministic 완화 문장, sourceTrace/follow-up coverage 부족도 함께 본다.
- full 회의록에서 서로 다른 근거가 충분하면 `sourceTrace`는 summary, 주요 discussionFlow, actionItems/openQuestions/risksOrDependencies 근거를 합쳐 6개를 채운다. 근거 부족 때만 6개보다 적게 둔다.
- 하기로/진행하기로/담기로/포함하기로 같은 약한 확정형 prose는 normalizer에서 논의/방안 표현으로 낮추되, 결과 문장이 `테스트를 우선 진행 방안`처럼 어색하면 다음 튜닝 대상으로 본다.
- 테스트하기로, 해보기로, 지원하기로처럼 실행 확정과 검토/지원 논의가 섞일 수 있는 표현도 normalizer에서 테스트/시도/지원 방안이 논의된 것으로 낮춘다.
- `discussionFlow`는 단순 주제 목록이 아니라 회의 진행 흐름을 보존한다. 같은 안건이 뒤에서 다시 등장해 새 결정, 조건, 반론, 리스크를 만들면 같은 heading이어도 별도 항목으로 남긴다.
- full 회의록과 직접 수정 저장은 긴 업무 회의록을 보존할 수 있어야 한다. 현재 상한은 discussionFlow 12개, keyPoints 6개, decisions 8개, actionItems 12개, openQuestions 12개, risksOrDependencies 10개이며, 이 값은 목표 개수가 아니라 truncation 방지용 안전 상한이다.
- Functions 전사 source part 검증 상한은 OpenAI 25MB 업로드 제한보다 낮은 24MB를 기준으로 유지한다. `gpt-4o-transcribe` 단일 오디오 제한 1400초보다 낮은 23분 안전선을 넘으면 파일이 작아도 chunked로 전환한다.
- hosted chunked source는 OpenRouter 전사 502를 줄이되 전사 품질을 과하게 해치지 않기 위해 12kHz mono WAV, 10분 chunk, 1.5초 overlap으로 올라온다는 전제를 둔다. Functions는 각 part가 24MB 검증 상한 아래인지 확인하고, part 자체를 다시 재분할하지 않는다.
- Gemini 전사 primary는 Gemini 전용 STT endpoint가 아니라 Files API 업로드 후 `generateContent` 오디오 입력으로 처리한다. `gemini-3.5-flash`는 전사에서 `thinkingLevel: "minimal"`과 `maxOutputTokens: 16384`를 기본으로 써야 긴 회의 chunk에서 빈 응답/지연/truncation을 줄일 수 있으며, 빈 전사는 성공으로 저장하지 않는다. 업로드한 Gemini file은 성공/실패와 관계없이 best-effort 삭제한다.
- 회의록 생성과 섹션 AI 수정은 품질 우선 경로라 `gemini-3.1-pro-preview`를 Gemini OpenAI-compatible chat completion으로 먼저 쓰고, 실패 시 OpenRouter/OpenAI fallback을 탄다. JSON 회의록 shape가 깨지면 성공처럼 저장하지 않고 기존 notes degraded/error 경계로 드러낸다.
- 전사 결과가 같은 문장을 비정상적으로 반복하면 성공 저장하지 않는다. `meeting-processing-runtime-domain.js`는 반복 전사를 한 번 재시도하고, 재시도 후에도 반복이면 명시적 실패로 드러낸다.

## 관련 데이터 경계
- `integration_inova_meetings`
- `integration_inova_meeting_jobs`
- `integration_inova_meeting_job_parts`
- `integration_inova_meeting_job_finalizers`
- `integration_inova_meeting_artifacts`
- `integration_inova_meeting_usage_events` - 처리 성공 job별 idempotency 원장, 클라이언트 읽기 금지
- `integration_inova_meeting_usage_user_months` - 사용자별 월 집계, 패널은 본인 현재 월 doc `get`만 허용
- `integration_inova_meeting_usage_user_totals` - 사용자별 전체 집계, 패널은 본인 doc `get`만 허용
- `integration_inova_meeting_usage_admin_months`
- `integration_inova_meeting_usage_admin_days`
- launch/session 컬렉션

## 보통 건드리지 말아야 할 범위
- prompt-library
- prompt-store
- prompt-review
- release

## 최소 검증 방법
- meeting 관련 export 이름, Firestore trigger 문서 경로, hosted meeting auth 흐름이 그대로 유지되는지 확인한다.
- 사용량 accounting을 바꾸면 `verify-meeting-service`에서 single job, chunked finalizer, duplicate commit, 삭제 후 aggregate 유지가 모두 통과해야 한다. 과거 데이터 backfill과 삭제 차감은 기본 동작이 아니다.
- chunk worker 기본값은 per-job staged queue가 아니라 full fan-out이다. `OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY`를 넣었을 때만 waiting/queued 제한이 다시 걸리는지 확인한다.
- runtime sizing, `check:function-runtime`, chunk/finalize 운영 기준은 `docs/functions-runtime-guide.md`를 기준으로 확인한다.
- version gate는 `docs/release-workflow.md`, meeting runtime/compat 판단은 `docs/runtime-architecture.md`를 기준으로 확인한다.
- `termReplacements`는 회의 단위 순서 보존 배열이며, `from` 중복/빈 값이 거부되고 기존 notes와 이후 notes 결과에 모두 deterministic pass가 적용되는지 확인한다.
- `previewInovaMeetingResultSectionEdit`와 `applyInovaMeetingResultSectionEdit`의 AI 수정 경로는 editable section key, `baseRevisionToken`, stale preview 거절 계약을 유지해야 한다. 사용자가 직접 고치는 `editMode: "manual"` 경로만 preview/baseRevisionToken 없이 같은 editable section key에 저장하거나 삭제할 수 있다.
- persisted meeting notes는 `summary`와 `overview`를 독립 필드로 유지한다. `summary`는 핵심 요약 카드용 짧은 요약이고, `summary`/`overview` 모두 섹션 preview/apply 대상이지만 서로를 덮어쓰지 않아야 한다.
- 전사 source mode, chunk 크기, 품질 가드를 바꾸면 `npm.cmd run verify:meeting-audio-source-policy`와 `npm.cmd run verify:meeting-transcription-quality`를 함께 돌려 OpenAI-safe part 크기, 23분 초과 chunk 전환, 반복 전사 재시도와 명시적 실패 경계를 확인한다.
- 섹션 preview는 사용자 요청 우선 rewrite prompt로 한 번 생성하고, 전사/현재 섹션은 참고로만 사용한다. 형식이 맞지 않으면 같은 요청으로 한 번 더 재시도하고, `warning` 필드는 호환용으로 유지한다.
- compact 회의록은 `overview` 중심의 짧은 기록 메모를 기본으로 하고, `decisions/actionItems/risks`는 전사에 직접 근거가 없으면 비워 둔다.
- 상용 회의 데이터 잔존 여부를 편하게 볼 때는 `npm run check:meeting-data`를 사용한다.
- 회의 데이터를 전체 또는 특정 `meetingId` 기준으로 수동 정리할 때는 기본 dry-run인 `npm run delete:meeting-data -- --all` 또는 `npm run delete:meeting-data -- --meeting-id <id>`를 먼저 보고, 실제 삭제는 같은 명령에 `--execute`를 붙인다.
- 회의 삭제 task와 1시간 sweep은 job/artifact/part/finalizer뿐 아니라 관련 `integration_inova_meeting_commands`와 회의 단위 `launch/workspace session`까지 함께 정리해야 한다.

## 언제 사용자에게 다시 물을지
- 패널 회의 허브 문제인지 hosted 작업실 문제인지, auth 문제인지 전사 worker 문제인지 모호할 때만 확인한다.

## 언제 범위를 확장할지
- 공통 helper, admin bootstrap, export wiring이 필요할 때만 `functions/platform/*`과 `functions/index.js`를 읽는다.
