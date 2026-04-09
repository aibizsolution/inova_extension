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
      return direct;
    }
    const fallbackParagraphs = normalizeTextList(fallback)
      .map((item) => normalizeTextBlock(item))
      .filter(Boolean);
    return fallbackParagraphs.join("\n\n");
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
      .filter((item) => item.text);
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
        const narrative = normalizeTextBlock(item?.narrative || item?.summary || item?.text);
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
      (item) => normalizeMeetingComparisonText(item.heading || item.narrative || item.keyPoints[0]),
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
      normalized.overview
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
