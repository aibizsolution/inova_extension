function createMeetingNotesDocumentDomain(deps) {
  const {
    buildTranscriptExcerpt,
    crypto,
    limits,
    normalizeText,
    normalizeTextBlock,
    supportedNotesStatuses,
  } = deps;
  const {
    MAX_MEETING_NOTES_ACTION_ITEMS,
    MAX_MEETING_NOTES_DECISIONS,
    MAX_MEETING_NOTES_OPEN_QUESTIONS,
    MAX_MEETING_NOTES_RISKS,
    MAX_MEETING_NOTES_SOURCE_TRACE,
    MAX_MEETING_NOTES_TOPIC_COUNT,
    MAX_MEETING_NOTES_TOPIC_KEY_POINTS,
  } = limits;

  function createEmptyMeetingNotes() {
    return {
      actionItems: [],
      decisions: [],
      discussionFlow: [],
      meetingMeta: {
        datetime: "",
        participants: [],
        purpose: "",
        title: "",
      },
      openQuestions: [],
      summary: "",
      overview: "",
      risksOrDependencies: [],
      sourceTrace: [],
    };
  }

  function normalizeMeetingComparisonText(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|]+/g, " ")
      .trim();
  }

  function dedupeMeetingItems(items, getKey, maxItems) {
    const seen = new Set();
    const deduped = [];
    for (const item of Array.isArray(items) ? items : []) {
      const key = normalizeText(typeof getKey === "function" ? getKey(item) : "") || crypto.randomUUID();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(item);
      if (maxItems > 0 && deduped.length >= maxItems) {
        break;
      }
    }
    return deduped;
  }

  function normalizeNoteTextValue(input) {
    if (Array.isArray(input)) {
      return input.map((item) => normalizeNoteTextValue(item)).filter(Boolean).join(" · ");
    }
    if (input && typeof input === "object") {
      const primary = normalizeText(
        input?.text
        || input?.question
        || input?.summary
        || input?.topic
        || input?.title
        || input?.task
        || input?.decision
        || input?.label
        || input?.name
      );
      const details = [
        normalizeText(input?.owner || input?.assignee) ? `담당: ${normalizeText(input.owner || input.assignee)}` : "",
        normalizeText(input?.dueDate || input?.dueAt) ? `기한: ${normalizeText(input.dueDate || input.dueAt)}` : "",
        normalizeText(input?.status) ? `상태: ${normalizeText(input.status)}` : "",
        normalizeText(input?.severity) ? `심각도: ${normalizeText(input.severity)}` : "",
        normalizeText(input?.reason) ? `사유: ${normalizeText(input.reason)}` : "",
      ].filter(Boolean);
      if (primary || details.length) {
        return [primary, ...details].filter(Boolean).join(" · ");
      }
      return Object.values(input)
        .map((item) => normalizeNoteTextValue(item))
        .filter(Boolean)
        .join(" · ");
    }
    return normalizeText(input);
  }

  function normalizeTextList(input) {
    return (Array.isArray(input) ? input : [])
      .map((item) => normalizeNoteTextValue(item))
      .filter(Boolean);
  }

  function normalizeMeetingMeta(input) {
    const data = input && typeof input === "object" ? input : {};
    return {
      datetime: normalizeText(data?.datetime),
      participants: normalizeTextList(data?.participants),
      purpose: normalizeTextBlock(data?.purpose),
      title: normalizeText(data?.title),
    };
  }

  function normalizeMeetingOverviewText(primary, fallback) {
    const direct = normalizeTextBlock(primary);
    if (direct) {
      return softenWeakDecisionProse(direct);
    }
    const fallbackParagraphs = normalizeTextList(fallback)
      .map((item) => normalizeTextBlock(item))
      .filter(Boolean);
    return softenWeakDecisionProse(fallbackParagraphs.join("\n\n"));
  }

  function normalizeMeetingSummaryText(primary, fallback) {
    const direct = normalizeTextBlock(primary);
    if (direct) {
      return softenWeakDecisionProse(direct);
    }
    return softenWeakDecisionProse(normalizeTextList(fallback)
      .map((item) => normalizeTextBlock(item))
      .filter(Boolean)
      .join(" "));
  }

  function normalizeMeetingOpenQuestions(input, maxItems = MAX_MEETING_NOTES_OPEN_QUESTIONS) {
    const normalized = normalizeTextList(input)
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .filter((item) => !/^(추가\s*)?(논의|검토|확인)\s*필요\s*(사항)?$/i.test(item));
    return dedupeMeetingItems(normalized, (item) => normalizeMeetingComparisonText(item), maxItems);
  }

  function isWeakMeetingActionTask(task) {
    const normalizedTask = normalizeText(task);
    if (!normalizedTask) {
      return true;
    }
    return /(검토가 필요|논의가 필요|추가 확인이 필요|추가 논의가 필요|결정이 필요|추가 검토 필요|추가 논의 필요)$/i.test(normalizedTask);
  }

  function softenWeakDecisionProse(input) {
    const softened = normalizeTextBlock(input)
      .replace(/필수적인/g, "필요한")
      .replace(/필수적/g, "필요")
      .replace(/권장하지\s*않았으며/g, "적합하지 않다는 의견을 냈으며")
      .replace(/권장하지\s*않았다/g, "적합하지 않다는 의견을 냈다")
      .replace(/권장하지\s*않았습니다/g, "적합하지 않다는 의견을 냈습니다")
      .replace(/권장했다/g, "대안으로 제시했다")
      .replace(/권장했습니다/g, "대안으로 제시했습니다")
      .replace(/([^.!?\n。！？…]*?테스트[^.!?\n。！？…]*?)(?:을|를)?\s*진행하기로\s*논의(?:했다|했습니다|하였다|하였습니다|되었다|되었습니다|됐다|됐습니다)/g, "$1 진행 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?테스트[^.!?\n。！？…]*?)(?:을|를)?\s*진행하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 진행 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?테스트[^.!?\n。！？…]*?)(?:을|를)?\s*진행하기로\s*의견이\s*나왔(?:다|습니다)/g, "$1 진행 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)?\s*테스트하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 테스트 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)?\s*테스트하기로\s*(?:했으며|하였으며)/g, "$1 테스트 방안이 논의됐으며")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)?\s*테스트해\s*보기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 테스트 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)?\s*해보기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 시도 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*진행하기로\s*방향이\s*정리(?:되었다|되었습니다|됐다|됐습니다)/g, "$1 진행 방안이 정리됐다")
      .replace(/([^.!?\n。！？…]*?)\s*진행하기로\s*논의(?:했다|했습니다|하였다|하였습니다|되었다|되었습니다|됐다|됐습니다)/g, "$1 진행 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*진행하기로\s*함/g, "$1 진행 방안이 논의됨")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*진행하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 진행 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*진행하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 진행 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*진행하기로\s*의견이\s*나왔(?:다|습니다)/g, "$1 진행 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*추진하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 추진 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*추진하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 추진 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*협력하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 협력 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*지원하기로\s*(?:했으며|하였으며)/g, "$1 지원 방안이 논의됐으며")
      .replace(/([^.!?\n。！？…]*?)\s*지원하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 지원 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*담기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 담는 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*담기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 담는 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*포함하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 포함하는 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*포함하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 포함하는 방안이 논의됐다")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*재검토하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 재검토 필요가 남았다")
      .replace(/([^.!?\n。！？…]*?)\s*재검토하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 재검토 필요가 남았다")
      .replace(/([^.!?\n。！？…]*?)\s*재확인하기로\s*(?:했으며|하였으며|했다|했습니다|하였다|하였습니다)/g, "$1 재확인 필요가 남았으며")
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*확인하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 확인 필요가 논의됐다")
      .replace(/([^.!?\n。！？…]*?)\s*확인하기로\s*(?:했다|했습니다|하였다|하였습니다)/g, "$1 확인 필요가 논의됐다")
      .replace(/방향으로\s*의견이\s*모였(?:다|습니다)/g, "방향이 논의됐다")
      .replace(/는\s*데\s*의견이\s*모였(?:다|습니다)/g, "는 논의가 있었다")
      .replace(/의견이\s*모였(?:으며|고)/g, "의견이 나왔으며")
      .replace(/의견이\s*모였(?:다|습니다)/g, "의견이 나왔다")
      .replace(/의견을\s*모았(?:다|습니다)/g, "의견이 나왔다");
    return polishSoftenedDecisionProse(softened);
  }

  function polishSoftenedDecisionProse(input) {
    return normalizeTextBlock(input)
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*(우선|즉시|내부적으로)?\s*(테스트|진행|시도|지원)\s*방안이/g, (_match, target, modifier, verb) => {
        const modifierText = normalizeText(modifier);
        return `${normalizeText(target)}를 ${modifierText ? `${modifierText} ` : ""}${verb}하는 방안이`;
      })
      .replace(/([^.!?\n。！？…]*?)(이|가)\s*지원\s*방안이/g, (_match, target) => `${normalizeText(target)}의 지원 방안이`)
      .replace(/([^.!?\n。！？…]*?)(?:을|를)\s*(내부적으로)?\s*(재검토|재확인)\s*필요가/g, (_match, target, modifier, verb) => {
        const modifierText = normalizeText(modifier);
        return `${normalizeText(target)}를 ${modifierText ? `${modifierText} ` : ""}${verb}할 필요가`;
      })
      .replace(/(방안이|필요가)(논의|남)/g, "$1 $2")
      .replace(/([가-힣A-Za-z0-9)])(방안이|필요가)(논의|남)/g, "$1$2 $3")
      .replace(/([.?!。！？…])([가-힣A-Za-z0-9])/g, "$1 $2")
      .replace(/([^.!?\n。！？…]*?\S)\s*시도\s*방안이/g, "$1 시도하는 방안이");
  }

  function isWeakMeetingDecisionText(text) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return true;
    }
    if (/(확정|승인|합의|최종\s*결정|결론\s*내)/.test(normalizedText)) {
      return false;
    }
    return /(검토|재확인|확인|테스트|시도|제안|논의|협의|가능|필요|알아보|추진|진행\s*여부)/.test(normalizedText);
  }

  function normalizeMeetingActionItems(input, maxItems = MAX_MEETING_NOTES_ACTION_ITEMS) {
    const normalized = (Array.isArray(input) ? input : [])
      .map((item) => {
        if (typeof item === "string") {
          return {
            assignee: "",
            dueDate: "",
            source: "transcript",
            status: "open",
            task: normalizeText(item),
          };
        }
        return {
          assignee: normalizeText(item?.assignee || item?.owner),
          dueDate: normalizeText(item?.dueDate || item?.dueAt),
          source: normalizeText(item?.source) || "transcript",
          status: normalizeText(item?.status) || "open",
          task: normalizeText(item?.task || item?.text),
        };
      })
      .filter((item) => item.task)
      .filter((item) => !isWeakMeetingActionTask(item.task) || item.assignee || item.dueDate);
    return dedupeMeetingItems(normalized, (item) => normalizeMeetingComparisonText(item.task), maxItems);
  }

  function normalizeMeetingDecisionItems(input, maxItems = MAX_MEETING_NOTES_DECISIONS) {
    const normalized = (Array.isArray(input) ? input : [])
      .map((item) => {
        if (typeof item === "string") {
          return {
            confidence: "medium",
            owner: "",
            text: normalizeText(item),
          };
        }
        return {
          confidence: normalizeText(item?.confidence) || "medium",
          owner: normalizeText(item?.owner),
          text: normalizeText(item?.text || item?.decision),
        };
      })
      .filter((item) => item.text)
      .filter((item) => !isWeakMeetingDecisionText(item.text));
    return dedupeMeetingItems(normalized, (item) => normalizeMeetingComparisonText(item.text), maxItems);
  }

  function normalizeMeetingRisks(input, maxItems = MAX_MEETING_NOTES_RISKS) {
    const normalized = (Array.isArray(input) ? input : [])
      .map((item) => {
        if (typeof item === "string") {
          return {
            severity: "medium",
            text: normalizeText(item),
          };
        }
        return {
          severity: normalizeText(item?.severity) || "medium",
          text: normalizeText(item?.text),
        };
      })
      .filter((item) => item.text);
    return dedupeMeetingItems(normalized, (item) => normalizeMeetingComparisonText(item.text), maxItems);
  }

  function normalizeMeetingSourceTrace(input, maxItems = MAX_MEETING_NOTES_SOURCE_TRACE) {
    const normalized = (Array.isArray(input) ? input : [])
      .map((item) => ({
        evidence: normalizeText(item?.evidence),
        itemRef: normalizeText(item?.itemRef),
        itemType: normalizeText(item?.itemType),
      }))
      .filter((item) => item.itemType || item.itemRef || item.evidence);
    return dedupeMeetingItems(
      normalized,
      (item) => normalizeMeetingComparisonText(`${item.itemType} ${item.itemRef} ${item.evidence}`),
      maxItems
    );
  }

  function normalizeMeetingDiscussionFlow(input, maxItems = MAX_MEETING_NOTES_TOPIC_COUNT, maxKeyPoints = MAX_MEETING_NOTES_TOPIC_KEY_POINTS) {
    const normalized = (Array.isArray(input) ? input : [])
      .map((item) => {
        const heading = normalizeText(item?.heading || item?.title || item?.topic);
        const narrative = softenWeakDecisionProse(item?.narrative || item?.summary || item?.text);
        const keyPoints = dedupeMeetingItems(
          normalizeTextList(item?.keyPoints),
          (value) => normalizeMeetingComparisonText(value),
          maxKeyPoints
        );
        return {
          heading,
          keyPoints,
          narrative,
        };
      })
      .filter((item) => item.heading || item.narrative || item.keyPoints.length);
    return dedupeMeetingItems(
      normalized,
      (item) => normalizeMeetingComparisonText([
        item.heading,
        item.narrative,
        ...item.keyPoints,
      ].filter(Boolean).join(" ")),
      maxItems
    );
  }

  function normalizeDocumentMeetingNotes(notes, settings) {
    const meetingMeta = normalizeMeetingMeta(notes.meetingMeta);
    const discussionFlow = normalizeMeetingDiscussionFlow(
      notes.discussionFlow,
      Math.max(1, Number(settings.maxDiscussionFlow) || MAX_MEETING_NOTES_TOPIC_COUNT),
      Math.max(1, Number(settings.maxKeyPoints) || MAX_MEETING_NOTES_TOPIC_KEY_POINTS)
    );
    return {
      actionItems: normalizeMeetingActionItems(notes.actionItems, Math.max(1, Number(settings.maxActionItems) || MAX_MEETING_NOTES_ACTION_ITEMS)),
      decisions: normalizeMeetingDecisionItems(notes.decisions, Math.max(1, Number(settings.maxDecisions) || MAX_MEETING_NOTES_DECISIONS)),
      discussionFlow,
      meetingMeta,
      openQuestions: normalizeMeetingOpenQuestions(notes.openQuestions, Math.max(1, Number(settings.maxOpenQuestions) || MAX_MEETING_NOTES_OPEN_QUESTIONS)),
      summary: normalizeMeetingSummaryText(notes.summary, [notes.overview]),
      overview: normalizeMeetingOverviewText(notes.overview, []),
      risksOrDependencies: normalizeMeetingRisks(notes.risksOrDependencies, Math.max(1, Number(settings.maxRisks) || MAX_MEETING_NOTES_RISKS)),
      sourceTrace: normalizeMeetingSourceTrace(notes.sourceTrace, Math.max(1, Number(settings.maxSourceTrace) || MAX_MEETING_NOTES_SOURCE_TRACE)),
    };
  }

  function normalizeMeetingNotes(input, options) {
    const settings = options && typeof options === "object" ? options : {};
    const notes = input && typeof input === "object" ? input : {};
    return normalizeDocumentMeetingNotes(notes, settings);
  }

  function hasMeetingNotes(notes) {
    const normalized = normalizeMeetingNotes(notes);
    return Boolean(
      normalized.summary
      || normalized.overview
      || normalized.meetingMeta.purpose
      || normalized.meetingMeta.title
      || normalized.meetingMeta.datetime
      || normalized.meetingMeta.participants.length
      || normalized.discussionFlow.length
      || normalized.decisions.length
      || normalized.actionItems.length
      || normalized.openQuestions.length
      || normalized.risksOrDependencies.length
    );
  }

  function parseMeetingNotesJson(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return createEmptyMeetingNotes();
    }
    const fenced = normalized.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const candidate = fenced ? normalizeText(fenced[1]) : normalized;
    try {
      return JSON.parse(candidate);
    } catch {
      return createEmptyMeetingNotes();
    }
  }

  function normalizeMeetingNotesStatus(value) {
    const normalized = normalizeText(value).toLowerCase();
    return supportedNotesStatuses.has(normalized) ? normalized : "";
  }

  function getMeetingNotesPreviewText(notesInput) {
    const notes = normalizeMeetingNotes(notesInput);
    const candidates = [
      normalizeTextBlock(notes.summary),
      normalizeTextBlock(notes.overview),
      ...notes.discussionFlow.flatMap((item) => [normalizeText(item.heading), normalizeTextBlock(item.narrative)]),
      ...notes.decisions.map((item) => normalizeText(item.text)),
      ...notes.actionItems.map((item) => normalizeText(item.task)),
    ]
      .map((item) => normalizeText(item))
      .filter(Boolean);
    return buildTranscriptExcerpt(candidates.join(" "));
  }

  function applyMeetingTermReplacements(notesInput, replacementsInput) {
    const notes = normalizeMeetingNotes(notesInput);
    const replacements = normalizeMeetingTermReplacementsInput(replacementsInput);
    if (!replacements.length) {
      return notes;
    }
    return normalizeMeetingNotes({
      ...notes,
      actionItems: notes.actionItems.map((item) => ({
        ...item,
        assignee: applyLiteralReplacements(item.assignee, replacements),
        dueDate: applyLiteralReplacements(item.dueDate, replacements),
        source: applyLiteralReplacements(item.source, replacements),
        status: applyLiteralReplacements(item.status, replacements),
        task: applyLiteralReplacements(item.task, replacements),
      })),
      decisions: notes.decisions.map((item) => ({
        ...item,
        confidence: applyLiteralReplacements(item.confidence, replacements),
        owner: applyLiteralReplacements(item.owner, replacements),
        text: applyLiteralReplacements(item.text, replacements),
      })),
      discussionFlow: notes.discussionFlow.map((item) => ({
        ...item,
        heading: applyLiteralReplacements(item.heading, replacements),
        keyPoints: item.keyPoints.map((value) => applyLiteralReplacements(value, replacements)),
        narrative: applyLiteralReplacements(item.narrative, replacements),
      })),
      meetingMeta: {
        ...notes.meetingMeta,
        datetime: applyLiteralReplacements(notes.meetingMeta.datetime, replacements),
        participants: notes.meetingMeta.participants.map((value) => applyLiteralReplacements(value, replacements)),
        purpose: applyLiteralReplacements(notes.meetingMeta.purpose, replacements),
        title: applyLiteralReplacements(notes.meetingMeta.title, replacements),
      },
      openQuestions: notes.openQuestions.map((value) => applyLiteralReplacements(value, replacements)),
      summary: applyLiteralReplacements(notes.summary, replacements),
      overview: applyLiteralReplacements(notes.overview, replacements),
      risksOrDependencies: notes.risksOrDependencies.map((item) => ({
        ...item,
        severity: applyLiteralReplacements(item.severity, replacements),
        text: applyLiteralReplacements(item.text, replacements),
      })),
      sourceTrace: notes.sourceTrace,
    });
  }

  function normalizeMeetingTermReplacementsInput(input) {
    return (Array.isArray(input) ? input : [])
      .map((item) => ({
        from: normalizeText(item?.from),
        to: normalizeText(item?.to),
      }))
      .filter((item) => item.from && item.to);
  }

  function applyLiteralReplacements(value, replacements) {
    let text = String(value || "");
    for (const replacement of replacements) {
      text = text.split(replacement.from).join(replacement.to);
    }
    return typeof value === "string" ? text : normalizeText(text);
  }

  return {
    applyMeetingTermReplacements,
    createEmptyMeetingNotes,
    dedupeMeetingItems,
    getMeetingNotesPreviewText,
    hasMeetingNotes,
    normalizeMeetingComparisonText,
    normalizeMeetingNotes,
    normalizeMeetingNotesStatus,
    parseMeetingNotesJson,
  };
}

module.exports = {
  createMeetingNotesDocumentDomain,
};
