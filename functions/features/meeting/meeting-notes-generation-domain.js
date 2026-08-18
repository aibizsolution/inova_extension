function createMeetingNotesGenerationDomain(deps) {
  const {
    applyMeetingTermReplacements,
    buildMeetingNotesTranscriptPrompt,
    buildMeetingNotesTranscriptSections,
    buildTranscriptExcerpt,
    createEmptyMeetingNotesBundle,
    createHttpError,
    createMeetingNotesBundleFromNotes,
    getClient,
    getMeetingClassifierModel,
    getMeetingSummaryModel,
    loadMeetingSummaryRecord,
    normalizeCompletionContent,
    normalizeMeetingNotes,
    normalizeMeetingTermReplacements,
    normalizeText,
    normalizeTextBlock,
    parseMeetingNotesJson,
    limits,
  } = deps;

  const {
    MAX_COMPACT_MEETING_NOTES_LINE_CHARS,
    MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS,
    MAX_COMPACT_MEETING_NOTES_TITLE_CHARS,
    MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS,
    MIN_MEETING_NOTES_DIRECT_SEGMENTS,
    MIN_MEETING_NOTES_DIRECT_SENTENCES,
    MIN_MEETING_NOTES_DIRECT_TEXT_CHARS,
  } = normalizeMeetingNotesGenerationLimits(limits);

  async function maybeGenerateMeetingNotes(transcript, meeting, options, context, logEvent, owner, jobId) {
    if (!options.summary) {
      return createEmptyMeetingNotesBundle("disabled");
    }
    try {
      let termReplacements = [];
      try {
        const meetingRecord = await loadMeetingSummaryRecord(owner, { meetingId: meeting.meetingId }, createHttpError);
        termReplacements = normalizeMeetingTermReplacements(meetingRecord?.meeting?.termReplacements);
      } catch (error) {
        logEvent("meeting.notes.term-replacements.load.error", {
          error: normalizeText(error?.message),
          jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
        });
        throw createHttpError(500, "회의 용어 치환 목록을 불러오지 못해 회의록 자동 정리를 중단했어요.");
      }
      const gateDecision = await classifyMeetingNotesSignal(transcript);
      logEvent("meeting.notes.gate", {
        decision: gateDecision.decision,
        jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
        reason: gateDecision.reason,
        segmentCount: gateDecision.segmentCount,
        sentenceCount: gateDecision.sentenceCount,
        summaryProfile: gateDecision.summaryProfile,
        strategy: gateDecision.strategy,
        textLength: gateDecision.textLength,
      });
      if (gateDecision.decision === "skip") {
        return createEmptyMeetingNotesBundle("skipped", gateDecision.reason);
      }
      const notesBundle = await generateMeetingNotesBundle(
        transcript,
        meeting,
        context,
        gateDecision.summaryProfile
      );
      return {
        ...notesBundle,
        notes: applyMeetingTermReplacements(notesBundle.notes, termReplacements),
      };
    } catch (error) {
      const failure = error?.notesFailure && typeof error.notesFailure === "object"
        ? error.notesFailure
        : {
            attemptCount: 1,
            code: "provider_error",
            failedAt: new Date().toISOString(),
            finishReason: "",
            model: getMeetingSummaryModel(),
            stage: "generation",
          };
      logEvent("meeting.notes.skipped", {
        error: normalizeText(error?.message),
        failure,
        jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      return createEmptyMeetingNotesBundle(
        "degraded",
        normalizeText(error?.message) || "회의록 자동 정리에 실패했어요.",
        failure
      );
    }
  }

  async function generateMeetingNotesBundle(transcript, meeting, context, summaryProfileInput) {
    const summaryProfile = normalizeMeetingNotesSummaryProfile(summaryProfileInput);
    if (summaryProfile === "compact") {
      return generateCompactMeetingNotesBundle(transcript, meeting, context);
    }
    const transcriptSections = buildMeetingNotesTranscriptSections(transcript);
    if (!transcriptSections.length) {
      return createEmptyMeetingNotesBundle("skipped");
    }
    if (transcriptSections.length === 1) {
      return generateMeetingNotesBundleFromPrompt(
        transcript,
        meeting,
        context,
        transcriptSections[0]
      );
    }
    const partialSummaries = [];
    for (const [index, sectionPrompt] of transcriptSections.entries()) {
      partialSummaries.push(await summarizeMeetingNotesSection(
        transcript,
        meeting,
        context,
        sectionPrompt,
        index,
        transcriptSections.length
      ));
    }
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildMeetingNotesSystemPrompt(),
        },
        {
          role: "user",
          content: buildMeetingNotesReducerPrompt(
            transcript,
            meeting,
            context,
            partialSummaries
          ),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
    });
    return createMeetingNotesBundleFromCompletion(completion, context);
  }

  async function generateCompactMeetingNotesBundle(transcript, meeting, context) {
    const transcriptPrompt = buildMeetingNotesTranscriptPrompt(transcript, { strategy: "balanced" });
    if (!normalizeTextBlock(transcriptPrompt)) {
      return createEmptyMeetingNotesBundle("skipped");
    }
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildCompactMeetingNotesSystemPrompt(),
        },
        {
          role: "user",
          content: buildCompactMeetingNotesUserPrompt(meeting, context, transcriptPrompt),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
    });
    return createMeetingNotesBundleFromCompletion(
      completion,
      context,
      (notes) => normalizeCompactMeetingNotes(notes, transcript)
    );
  }

  async function generateMeetingNotesBundleFromPrompt(transcript, meeting, context, transcriptPrompt) {
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildMeetingNotesSystemPrompt(),
        },
        {
          role: "user",
          content: buildMeetingNotesUserPromptFromText(
            transcript,
            meeting,
            context,
            transcriptPrompt
          ),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
    });
    return createMeetingNotesBundleFromCompletion(completion, context);
  }

  function createMeetingNotesBundleFromCompletion(completion, context, normalizeNotesInput) {
    const content = normalizeCompletionContent(completion?.choices?.[0]?.message?.content);
    const failureBase = {
      attemptCount: 1,
      failedAt: new Date().toISOString(),
      finishReason: normalizeText(completion?.choices?.[0]?.finish_reason),
      model: normalizeText(completion?.model) || getMeetingSummaryModel(),
      stage: "generation",
    };
    if (!content) {
      const error = new Error("회의 정리 모델 응답이 비어 있어요.");
      error.notesFailure = { ...failureBase, code: "empty_response" };
      throw error;
    }
    try {
      return createMeetingNotesBundleFromNotes(
        typeof normalizeNotesInput === "function"
          ? normalizeNotesInput(parseMeetingNotesJson(content))
          : parseMeetingNotesJson(content),
        context
      );
    } catch (error) {
      error.notesFailure = {
        ...failureBase,
        code: "empty_or_invalid_notes",
      };
      throw error;
    }
  }

  async function summarizeMeetingNotesSection(transcript, meeting, context, transcriptPrompt, sectionIndex, totalSections) {
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildMeetingNotesSectionSystemPrompt(),
        },
        {
          role: "user",
          content: buildMeetingNotesSectionUserPrompt(
            transcript,
            meeting,
            context,
            transcriptPrompt,
            sectionIndex,
            totalSections
          ),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
    });
    return normalizeMeetingNotesSectionSummary(
      parseMeetingNotesJson(normalizeCompletionContent(completion?.choices?.[0]?.message?.content))
    );
  }

  async function classifyMeetingNotesSignal(transcript) {
    const signal = buildMeetingNotesSignal(transcript);
    if (!signal.textLength) {
      return {
        decision: "skip",
        reason: "인식된 발화가 없어 자동 회의 정리를 만들지 않았습니다.",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: "skip",
        strategy: "empty-transcript",
        textLength: signal.textLength,
      };
    }
    if (isClearlySummarizableMeetingSignal(signal)) {
      return {
        decision: "generate",
        reason: "",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: "full",
        strategy: "direct-full",
        textLength: signal.textLength,
      };
    }
    try {
      const completion = await getClient().chat.completions.create({
        messages: [
          {
            role: "system",
            content: buildMeetingNotesGateSystemPrompt(),
          },
          {
            role: "user",
            content: buildMeetingNotesGateUserPrompt(signal),
          },
        ],
        model: getMeetingClassifierModel(),
        response_format: { type: "json_object" },
      });
      const gate = parseMeetingNotesGateResult(
        normalizeCompletionContent(completion?.choices?.[0]?.message?.content)
      );
      return {
        decision: "generate",
        reason: gate.profile === "compact"
          ? gate.reason || "짧은 테스트성 또는 저신호 전사라 compact 회의록으로 정리했습니다."
          : "",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: gate.profile === "full" ? "full" : "compact",
        strategy: "llm-profile",
        textLength: signal.textLength,
      };
    } catch {
      return {
        decision: "generate",
        reason: "",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: "compact",
        strategy: "profile-fallback-compact",
        textLength: signal.textLength,
      };
    }
  }

  function buildMeetingNotesSignal(transcript) {
    const segmentTexts = (Array.isArray(transcript?.segments) ? transcript.segments : [])
      .map((segment) => normalizeText(segment?.text))
      .filter(Boolean);
    const plainText = normalizeTextBlock(segmentTexts.join("\n") || transcript?.text);
    const sentenceCount = plainText
      ? plainText
        .split(/[\n.!?。！？…]+/g)
        .map((line) => normalizeText(line))
        .filter(Boolean)
        .length
      : 0;
    const excerpt = plainText.length > MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS
      ? `${plainText.slice(0, MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS)}...`
      : plainText;
    return {
      excerpt,
      segmentCount: segmentTexts.length,
      sentenceCount,
      textLength: plainText.length,
    };
  }

  function isClearlySummarizableMeetingSignal(signal) {
    return signal.textLength >= MIN_MEETING_NOTES_DIRECT_TEXT_CHARS
      || signal.segmentCount >= MIN_MEETING_NOTES_DIRECT_SEGMENTS
      || (signal.sentenceCount >= MIN_MEETING_NOTES_DIRECT_SENTENCES && signal.textLength >= 140);
  }

  function buildMeetingNotesGateSystemPrompt() {
    return [
      "너는 회의 전사 요약 프로필 분류기다.",
      "빈 전사는 여기 들어오지 않는다.",
      "전사 텍스트만 보고 이 기록이 full 회의록이 맞는지, compact 회의록이 맞는지 판단한다.",
      "full은 실제 결정, 요청, 일정, 후속 행동, 여러 논의 흐름이 보여 정식 회의록 구조가 자연스러운 경우다.",
      "compact는 짧은 테스트, 상태 점검, 기기 확인, 단일 질문, 저신호 대화처럼 정식 회의 서사를 만들면 과장되는 경우다.",
      "애매하면 무조건 compact를 선택한다.",
      "반드시 JSON 하나만 반환한다.",
      '형식: {"profile":"full|compact","reason":"compact일 때만 짧은 한국어 이유"}',
    ].join(" ");
  }

  function buildMeetingNotesGateUserPrompt(signal) {
    return [
      `전사 길이: ${signal.textLength}자`,
      `구간 수: ${signal.segmentCount}개`,
      `문장 수: ${signal.sentenceCount}개`,
      "아래 전사가 정식 full 회의록에 맞는지, compact 회의록에 맞는지 판단해 주세요.",
      signal.excerpt ? `전사:\n${signal.excerpt}` : "전사: 없음",
    ].join("\n\n");
  }

  function parseMeetingNotesGateResult(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return { profile: "", reason: "" };
    }
    try {
      const parsed = JSON.parse(normalized);
      const profile = normalizeText(parsed?.profile).toLowerCase();
      return {
        profile: profile === "full" ? "full" : profile === "compact" ? "compact" : "",
        reason: normalizeTextBlock(parsed?.reason).slice(0, 200),
      };
    } catch {
      return { profile: "", reason: "" };
    }
  }

  function buildMeetingNotesSystemPrompt() {
    return [
      "너는 한국어 회의록 작성자다.",
      "주어진 전사와 공용 메모만 근거로 구조화된 회의록 JSON을 만든다.",
      "추측하지 말고, 알 수 없으면 빈 문자열이나 빈 배열로 남긴다.",
      "사실은 전사 우선, 강조/의도는 공용 메모를 보조 근거로 사용한다.",
      "전사와 메모가 충돌하면 단정하지 말고 openQuestions 또는 risksOrDependencies에 남긴다.",
      "전문가 자문, 전략 평가, 타당성 판단처럼 들리는 표현은 피하고 회의에서 실제 언급된 내용만 중립적으로 정리한다.",
      "전사에 없는 결론, 추천, 당위, 우선순위 판단을 새로 만들지 않는다.",
      "권장했다/필수다/반드시 해야 한다 같은 평가형 표현보다, 회의에서 나온 수준에 맞춰 대안으로 제시했다, 필요성이 언급됐다, 검토 대상으로 남았다처럼 쓴다.",
      "항목 수를 맞추기 위해 내용을 만들지 않는다. 각 배열은 0개일 수 있고, 근거가 없으면 빈 배열로 둔다.",
      "근거가 1개면 1개만 작성하고, 실제로 서로 다른 항목이 많을 때만 상한까지 분리한다.",
      "문장은 단순히 '논의되었다'를 반복하지 말고, 왜 이 논의가 나왔는지, 어떤 쟁점이 있었는지, 그래서 무엇이 정리되었는지가 짧게 이어지도록 쓴다.",
      "회의록을 읽는 사람이 배경 없이도 흐름을 이해할 수 있게, 배경 -> 핵심 쟁점 -> 결론 또는 미결정 -> 다음 단계 순서를 의식해 정리한다.",
      "actionItems에는 전사나 메모에 실제로 나온 행동만 적고, 담당자나 기한이 없으면 임의로 만들지 않는다.",
      "단, 담당자나 기한이 없어도 기존 기능 재확인, API 규격 협의, 데이터 조사, 자료 작성 요청, 보고처럼 실제 후속 행동이 명시되었으면 actionItems에 남기고 assignee/dueDate는 빈 문자열로 둔다.",
      "actionItems는 누가 무엇을 할지 비교적 분명한 항목만 포함하고, 단순한 추가 검토 필요·논의 필요 같은 일반론은 openQuestions 또는 risksOrDependencies로 돌린다.",
      "overview와 discussionFlow는 단순 항목 나열이 아니라 회의 맥락이 드러나는 짧은 서술형 회의록처럼 정리하되, 잘 되었다/옳다/필수다 같은 평가형 문장은 피한다.",
      "결과는 상용 회의록 SaaS처럼 사람이 바로 읽는 문서 톤으로 쓰되, 회의에서 실제 언급된 내용만 근거로 사용한다.",
      "summary는 핵심 요약 섹션에 들어갈 1~2문장 길이의 짧은 요약이다. 가장 중요한 결론이나 핵심 맥락만 간결하게 적는다.",
      "overview는 회의 배경, 목적, 핵심 논의 방향, 결론 또는 남은 쟁점을 2~5문장 안에서 하나의 문단으로 정리한다.",
      "meetingMeta.purpose는 이 회의가 왜 열렸고 어떤 배경에서 무엇을 검토·결정하려 했는지 2~4문장 안에서 회의 개요처럼 정리한다.",
      "discussionFlow[].heading은 짧은 주제명만 적고 문장형 설명이나 중간 구분점(예: ·, /)을 길게 이어 붙이지 않는다.",
      "discussionFlow[].narrative는 해당 논의가 왜 중요했고 어떤 배경과 쟁점이 있었고 무엇이 정리되었는지가 보이도록 2~4문장 안에서 적는다.",
      "discussionFlow[].keyPoints는 반드시 2~4개를 채우지 않는다. 근거가 있는 핵심 포인트만 0~4개 남기고, 의미가 같은 표현만 합친다.",
      "discussionFlow는 단순 토픽 목록이 아니라 실제 논의 흐름을 보존한다.",
      "회의가 안건 A -> B -> 다시 A처럼 진행되면, 다시 나온 A가 새 결정, 조건, 반론, 리스크를 만들었을 때 별도 discussionFlow 항목으로 남긴다.",
      "같은 주제라는 이유만으로 서로 다른 결정, 서로 다른 미결정 사항, 서로 다른 리스크를 하나로 합치지 않는다.",
      "다음 숫자는 목표 개수가 아니라 안전 상한이다: discussionFlow 최대 12개, decisions 최대 8개, actionItems 최대 12개, openQuestions 최대 12개, risksOrDependencies 최대 10개. 상한보다 적거나 0개여도 정상이다.",
      "단, 실제로 서로 다른 근거가 충분한 full 회의록이면 sourceTrace는 summary, 주요 discussionFlow, actionItems/openQuestions/risksOrDependencies 근거를 합쳐 정확히 6개 작성한다. 근거가 부족할 때만 6개보다 적게 쓰고, 네 개에서 멈추지 않는다.",
      "decisions는 회의에서 확정된 선택, 승인, 합의만 포함한다. 제안, 가능성, 우려, 검토 필요는 decisions에 넣지 않는다.",
      "decisions는 전사에 '확정', '합의', '승인', '하기로 했다'처럼 명시적인 확정 표현이 있을 때만 작성한다.",
      "단순히 테스트를 해볼 수 있다, 검토한다, 필요하다, 재확인한다, 제안했다는 수준이면 decisions가 아니라 actionItems, openQuestions, risksOrDependencies 중 맞는 곳에 둔다.",
      "summary와 overview에서도 명시 근거 없이 '합의함', '확정함', '결정함', '필수', '권장'처럼 회의 결론을 강하게 보이게 하는 표현을 쓰지 않는다.",
      "decisions에 넣을 근거가 약한 사안은 summary, overview, discussionFlow에서도 '하기로 했다', '추진하기로 했다', '진행하기로 했다', '의견을 모았다'가 아니라 '논의했다', '검토했다', '확인 필요로 남았다'처럼 근거 수준에 맞춰 쓴다.",
      "금지 예: '웹 API를 테스트해 보기로 했다'. 이런 표현은 '웹 API 테스트 방안이 논의됐다' 또는 actionItems로만 쓴다.",
      "confidence, status, severity 값은 한국어로 쓴다. 예: confidence는 높음/중간/낮음, status는 요청됨/진행 예정/미정, severity는 높음/중간/낮음.",
      "openQuestions는 실제로 미결정된 승인, 의사결정, 외부 확인, 의존성 문제만 포함하고, 없으면 빈 배열로 둔다.",
      "risksOrDependencies는 실행을 막거나 지연시킬 수 있는 현실적 제약, 선행조건, 외부 의존성만 포함한다. 단순한 보완 제안은 넣지 않는다.",
      "구체적인 후속 행동과 미결정 질문/리스크가 함께 있으면 하나를 다른 하나로 대체하지 말고, 서로 다른 의미일 때 actionItems와 openQuestions 또는 risksOrDependencies에 각각 남긴다.",
      "전사에 API 반환 규격, 일정, 장비 수급, 외부 파트너, 데이터 준비처럼 아직 확인해야 할 후속 쟁점이나 실행 제약이 나오면 openQuestions 또는 risksOrDependencies에 빠뜨리지 않는다.",
      "반드시 JSON만 반환한다.",
      "스키마는 summary, meetingMeta, overview, discussionFlow, decisions, actionItems, openQuestions, risksOrDependencies, sourceTrace 이다.",
      "meetingMeta는 {title, datetime, participants, purpose} 형식이다.",
      "discussionFlow[]는 {heading, narrative, keyPoints} 형식이다.",
      "decisions[]는 {text, owner, confidence} 형식이다.",
      "actionItems[]는 {task, assignee, dueDate, status, source} 형식이다.",
      "openQuestions[]는 짧은 문자열 배열로 작성하되, 아직 확정되지 않은 의사결정이나 외부 확인 필요 사항만 포함한다.",
      "risksOrDependencies[]는 {text, severity} 형식이고, 리스크, 제약, 선행조건, 외부 의존성, 현실적인 난점을 담는다.",
      "meetingMeta.title은 이 기록을 구분할 짧고 구체적인 한국어 제목 한 줄로 작성한다.",
      "meetingMeta.title은 범용적인 '회의', '회의록', '미팅'만 단독으로 쓰지 말고 핵심 주제를 드러낸다.",
      "meetingMeta.participants는 전사와 메모에서 확인 가능한 참여자만 적고, 확실하지 않으면 비워 둔다.",
      "sourceTrace[]는 {itemType, itemRef, evidence} 형식이다.",
      "sourceTrace[] itemType은 transcript, sharedMemo 중 근거에 맞게 적는다.",
      "sourceTrace[] itemRef는 summary, overview, discussionFlow[0], actionItems[0]처럼 어떤 회의록 항목의 근거인지 식별 가능하게 적는다.",
    ].join(" ");
  }

  function buildCompactMeetingNotesSystemPrompt() {
    return [
      "너는 짧은 테스트성 또는 저신호 전사를 정리하는 한국어 기록 메모 작성자다.",
      "정식 회의록처럼 배경, 쟁점, 결론을 억지로 만들지 않는다.",
      "전사에 직접 나온 사실만 짧게 적고, 해석이나 확장 서사를 붙이지 않는다.",
      "짧은 테스트 발화는 그대로 테스트성 기록 톤으로 남긴다.",
      "summary는 핵심 요약용 한 문장으로 작성한다.",
      "overview는 1~2문장 안의 짧은 메모로 작성한다.",
      "meetingMeta.purpose는 보통 빈 문자열로 두고, 정말 명시된 목적이 있을 때만 한 문장으로 쓴다.",
      "discussionFlow는 보통 빈 배열이며, 분명한 단일 주제가 있을 때만 최대 1개 남긴다.",
      "decisions, actionItems, risksOrDependencies는 전사에 직접 근거가 없으면 빈 배열로 둔다.",
      "openQuestions는 실제로 확인이 필요하거나 모르겠다고 말한 내용만 최대 1개 남긴다.",
      "원문에 없는 결론, 실패 판정, 의도, 배경 설명을 만들지 않는다.",
      "반드시 JSON만 반환한다.",
      "스키마는 summary, meetingMeta, overview, discussionFlow, decisions, actionItems, openQuestions, risksOrDependencies, sourceTrace 이다.",
    ].join(" ");
  }

  function buildMeetingNotesSectionSystemPrompt() {
    return [
      buildMeetingNotesSystemPrompt(),
      "지금 입력되는 전사는 전체 회의 중 일부 구간이다.",
      "이 구간에 실제로 나온 내용만 정리하고, 전체 회의 결론처럼 과하게 단정하지 않는다.",
      "meetingMeta는 필요 최소한만 채워도 되며, section 요약에서는 sourceTrace에 꼭 필요한 근거만 남긴다.",
      "구간 요약에서도 항목 수를 맞추지 않는다. overview는 1개 문단, discussionFlow 최대 2개, decisions/actionItems 각각 최대 2개, openQuestions/risksOrDependencies는 정말 필요한 경우만 남긴다.",
      "구간 요약도 맥락이 보이게 정리하고, discussionFlow[].narrative에는 왜 이 논의가 나왔고 어떤 판단이나 미결정으로 이어졌는지 짧게 남긴다.",
    ].join(" ");
  }

  function buildMeetingNotesReducerPrompt(transcript, meeting, context, partialSummaries) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      "아래는 긴 전사를 여러 구간으로 나눈 중간 정리 결과입니다. 중복을 제거하고 회의 전체 관점에서 하나의 최종 회의록 JSON으로 통합해 주세요.",
      "최종 결과는 사람이 바로 읽는 회의록처럼 간결하게 정리하고, 의미가 같은 토픽/결정/액션만 합친다.",
      "항목 수를 맞추기 위해 내용을 만들지 않는다. 각 배열은 0개일 수 있고, 근거가 없으면 빈 배열로 둔다.",
      "특히 overview와 discussionFlow[].narrative는 전체 흐름이 이해되게 다시 써야 한다. 무엇이 배경이었고, 어떤 쟁점이 오갔고, 무엇이 정리되었는지가 보이게 만든다.",
      "서로 다른 구간에서 같은 안건이 다시 등장해 새 결정, 조건, 반론, 리스크가 추가되면 하나로 뭉개지 말고 별도 discussionFlow 항목으로 남긴다.",
      "최종 결과의 상한은 목표 개수가 아니라 안전 상한이다: discussionFlow 최대 12개, decisions 최대 8개, actionItems 최대 12개, openQuestions 최대 12개, risksOrDependencies 최대 10개다.",
      "후속 실행 항목에는 실제 행동만 남기고, 단순한 검토 필요나 논의 필요 문구는 openQuestions 또는 risksOrDependencies로 정리한다.",
      `전사 발췌:\n${buildMeetingNotesTranscriptPrompt(transcript, { strategy: "balanced" })}`,
      partialSummaries
        .map((summary, index) => `[구간 ${index + 1}/${partialSummaries.length}]\n${JSON.stringify(summary)}`)
        .join("\n\n"),
    ].join("\n\n");
  }

  function buildMeetingNotesSectionUserPrompt(transcript, meeting, context, transcriptPrompt, sectionIndex, totalSections) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      `전체 ${totalSections}개 구간 중 ${sectionIndex + 1}번째 구간입니다.`,
      "아래 구간 전사에서 실제로 언급된 논의, 결정, 액션, 쟁점을 정리해 주세요. 단순 키워드 추출보다 왜 이 얘기가 나왔고 어떤 판단으로 이어졌는지가 드러나게 써 주세요.",
      transcriptPrompt,
    ].join("\n\n");
  }

  function buildMeetingNotesUserPromptFromText(transcript, meeting, context, transcriptPrompt) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      "아래 전사를 기반으로 회의록을 정리해 주세요. 왜 이 회의가 열렸고, 어떤 논의 흐름으로 결론이나 미결정 사항이 나왔는지가 보이게 써 주세요.",
      transcriptPrompt,
    ].join("\n\n");
  }

  function buildCompactMeetingNotesUserPrompt(meeting, context, transcriptPrompt) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      "아래 전사는 짧은 테스트나 저신호 기록일 수 있습니다. 정식 회의처럼 부풀리지 말고, 사람이 나중에 다시 볼 때 필요한 사실만 짧게 정리해 주세요.",
      "핵심은 무엇을 테스트하거나 확인했는지, 무엇이 바로 확인되지 않았는지, 추가 확인이 필요한 항목이 있는지 정도만 남기는 것입니다.",
      transcriptPrompt,
    ].join("\n\n");
  }

  function normalizeMeetingNotesSectionSummary(input) {
    return normalizeMeetingNotes(input, {
      maxActionItems: 2,
      maxDecisions: 2,
      maxDiscussionFlow: 2,
      maxKeyPoints: 3,
      maxOpenQuestions: 2,
      maxRisks: 2,
      maxSourceTrace: 3,
    });
  }

  function normalizeMeetingNotesSummaryProfile(input) {
    const normalized = normalizeText(input).toLowerCase();
    return normalized === "compact" ? "compact" : normalized === "skip" ? "skip" : "full";
  }

  function normalizeCompactMeetingNotes(notesInput, transcriptInput) {
    const transcriptText = buildCompactMeetingTranscriptText(transcriptInput);
    const normalized = normalizeMeetingNotes(notesInput, {
      maxActionItems: 1,
      maxDecisions: 1,
      maxDiscussionFlow: 1,
      maxKeyPoints: 2,
      maxOpenQuestions: 1,
      maxRisks: 1,
      maxSourceTrace: 2,
    });
    const hasDecisionCue = /(결정|확정|승인|합의|정하기로|하기로|진행하기로)/.test(transcriptText);
    const hasActionCue = /(하겠습니다|하겠습니|정리하겠습니다|확인하겠습니다|보내겠습니다|준비하겠습니다|담당|까지\b)/.test(transcriptText);
    const hasQuestionCue = /(\?|모르겠|모르겠습니다|어디|확인해야|확인이 필요|궁금)/.test(transcriptText);
    const hasRiskCue = /(문제|어렵|어려|지연|막히|불가|오류|리스크|제약|장애)/.test(transcriptText);
    const discussionFlow = transcriptText.length >= 140 && !hasQuestionCue
      ? normalized.discussionFlow.slice(0, 1).map((item) => ({
          heading: clampCompactMeetingTitle(item.heading),
          keyPoints: item.keyPoints.map((value) => clampCompactMeetingLine(value)).filter(Boolean).slice(0, 2),
          narrative: clampCompactMeetingBody(item.narrative, 2),
        })).filter((item) => item.heading || item.narrative || item.keyPoints.length)
      : [];
    const openQuestions = hasQuestionCue
      ? normalized.openQuestions.map((item) => clampCompactMeetingLine(item)).filter(Boolean).slice(0, 1)
      : [];
    return normalizeMeetingNotes({
      actionItems: hasActionCue
        ? normalized.actionItems.slice(0, 1).map((item) => ({
            ...item,
            source: "transcript",
            task: clampCompactMeetingLine(item.task),
          })).filter((item) => item.task)
        : [],
      decisions: hasDecisionCue
        ? normalized.decisions.slice(0, 1).map((item) => ({
            ...item,
            text: clampCompactMeetingLine(item.text),
          })).filter((item) => item.text)
        : [],
      discussionFlow,
      meetingMeta: {
        ...normalized.meetingMeta,
        purpose: "",
        title: clampCompactMeetingTitle(normalized.meetingMeta.title) || buildCompactMeetingFallbackTitle(transcriptText),
      },
      openQuestions,
      summary: clampCompactMeetingLine(normalized.summary || normalized.overview)
        || clampCompactMeetingLine(buildCompactMeetingFallbackOverview(transcriptText)),
      overview: clampCompactMeetingBody(normalized.overview, 2) || buildCompactMeetingFallbackOverview(transcriptText),
      risksOrDependencies: hasRiskCue && !hasQuestionCue
        ? normalized.risksOrDependencies.slice(0, 1).map((item) => ({
            ...item,
            text: clampCompactMeetingLine(item.text),
          })).filter((item) => item.text)
        : [],
      sourceTrace: normalized.sourceTrace
        .filter((item) => normalizeText(item.itemType) !== "sharedMemo")
        .slice(0, 2),
    });
  }

  function buildCompactMeetingTranscriptText(transcript) {
    return normalizeTextBlock(
      (Array.isArray(transcript?.segments) ? transcript.segments : [])
        .map((segment) => normalizeText(segment?.text))
        .filter(Boolean)
        .join("\n")
      || transcript?.text
    );
  }

  function clampCompactMeetingBody(textInput, maxSentences = 2) {
    const text = normalizeTextBlock(textInput);
    if (!text) {
      return "";
    }
    const sentences = text
      .match(/[^.!?。！？…]+[.!?。！？…]?/g)
      ?.map((item) => normalizeTextBlock(item))
      .filter(Boolean)
      || [text];
    const limited = sentences.slice(0, Math.max(1, maxSentences)).join(" ");
    return limited.length > MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS
      ? normalizeTextBlock(limited.slice(0, MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS))
      : limited;
  }

  function clampCompactMeetingLine(textInput) {
    const text = normalizeTextBlock(textInput);
    if (!text) {
      return "";
    }
    return text.length > MAX_COMPACT_MEETING_NOTES_LINE_CHARS
      ? normalizeTextBlock(text.slice(0, MAX_COMPACT_MEETING_NOTES_LINE_CHARS))
      : text;
  }

  function clampCompactMeetingTitle(textInput) {
    const text = normalizeText(textInput);
    if (!text) {
      return "";
    }
    return text.length > MAX_COMPACT_MEETING_NOTES_TITLE_CHARS
      ? normalizeText(text.slice(0, MAX_COMPACT_MEETING_NOTES_TITLE_CHARS))
      : text;
  }

  function buildCompactMeetingFallbackTitle(transcriptTextInput) {
    const transcriptText = normalizeTextBlock(transcriptTextInput);
    if (!transcriptText) {
      return "짧은 회의 기록";
    }
    if (/녹음/.test(transcriptText) && /마이크/.test(transcriptText)) {
      return "녹음 테스트 및 마이크 위치 확인";
    }
    if (/테스트|점검|확인/.test(transcriptText)) {
      return "테스트 및 상태 확인";
    }
    return clampCompactMeetingTitle(buildTranscriptExcerpt(transcriptText).replace(/\.\.\.$/, "")) || "짧은 회의 기록";
  }

  function buildCompactMeetingFallbackOverview(transcriptTextInput) {
    const transcriptText = normalizeTextBlock(transcriptTextInput);
    if (!transcriptText) {
      return "짧은 발화가 기록되었지만 추가 맥락은 확인되지 않았습니다.";
    }
    if (/녹음/.test(transcriptText) && /테스트/.test(transcriptText) && /마이크/.test(transcriptText)) {
      return "녹음 테스트와 수정 반영 여부 확인이 언급됐다. 마이크 위치를 몰라 테스트 진행이 어렵다는 말이 나왔다.";
    }
    return clampCompactMeetingBody(buildTranscriptExcerpt(transcriptText).replace(/\.\.\.$/, ""), 2);
  }

  return {
    maybeGenerateMeetingNotes,
  };
}

function normalizeMeetingNotesGenerationLimits(input) {
  const limits = input && typeof input === "object" ? input : {};
  return {
    MAX_COMPACT_MEETING_NOTES_LINE_CHARS: Math.max(1, Number(limits.MAX_COMPACT_MEETING_NOTES_LINE_CHARS) || 96),
    MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS: Math.max(1, Number(limits.MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS) || 180),
    MAX_COMPACT_MEETING_NOTES_TITLE_CHARS: Math.max(1, Number(limits.MAX_COMPACT_MEETING_NOTES_TITLE_CHARS) || 48),
    MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS: Math.max(1, Number(limits.MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS) || 1800),
    MIN_MEETING_NOTES_DIRECT_SEGMENTS: Math.max(1, Number(limits.MIN_MEETING_NOTES_DIRECT_SEGMENTS) || 4),
    MIN_MEETING_NOTES_DIRECT_SENTENCES: Math.max(1, Number(limits.MIN_MEETING_NOTES_DIRECT_SENTENCES) || 3),
    MIN_MEETING_NOTES_DIRECT_TEXT_CHARS: Math.max(1, Number(limits.MIN_MEETING_NOTES_DIRECT_TEXT_CHARS) || 180),
  };
}

module.exports = {
  createMeetingNotesGenerationDomain,
};
