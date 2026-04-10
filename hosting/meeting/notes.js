(function initHostedMeetingNotes(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const {
    normalizeText,
    normalizeTextBlock,
  } = ns.shared;

  const MAX_DISCUSSION_FLOW_COUNT = 4;
  const MAX_DISCUSSION_KEY_POINTS = 4;
  const MAX_DECISION_COUNT = 5;
  const MAX_ACTION_COUNT = 5;
  const MAX_OPEN_QUESTION_COUNT = 3;
  const MAX_RISK_COUNT = 3;
  const MAX_SOURCE_TRACE_COUNT = 6;

  function normalizeNoteTextValue(value) {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeNoteTextValue(item)).filter(Boolean).join(" · ");
    }
    if (value && typeof value === "object") {
      const primary = normalizeText(
        value?.text
        || value?.question
        || value?.summary
        || value?.topic
        || value?.title
        || value?.task
        || value?.decision
        || value?.label
        || value?.name
      );
      const details = [
        normalizeText(value?.owner || value?.assignee) ? `담당: ${normalizeText(value.owner || value.assignee)}` : "",
        normalizeText(value?.dueDate || value?.dueAt) ? `기한: ${normalizeText(value.dueDate || value.dueAt)}` : "",
        normalizeText(value?.status) ? `상태: ${normalizeText(value.status)}` : "",
        normalizeText(value?.severity) ? `심각도: ${normalizeText(value.severity)}` : "",
        normalizeText(value?.reason) ? `사유: ${normalizeText(value.reason)}` : "",
      ].filter(Boolean);
      if (primary || details.length) {
        return [primary, ...details].filter(Boolean).join(" · ");
      }
      return Object.values(value)
        .map((item) => normalizeNoteTextValue(item))
        .filter(Boolean)
        .join(" · ");
    }
    return normalizeText(value);
  }

  function normalizeTextArray(values) {
    return (Array.isArray(values) ? values : [])
      .map((value) => normalizeNoteTextValue(value))
      .filter(Boolean);
  }

  function normalizeComparisonText(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|]+/g, " ")
      .trim();
  }

  function dedupeItems(items, getKey, maxItems) {
    const seen = new Set();
    const deduped = [];
    for (const item of Array.isArray(items) ? items : []) {
      const key = normalizeText(typeof getKey === "function" ? getKey(item) : item);
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

  function normalizeMeetingMeta(input) {
    const data = input && typeof input === "object" ? input : {};
    return {
      datetime: normalizeText(data?.datetime),
      participants: normalizeTextArray(data?.participants),
      purpose: normalizeTextBlock(data?.purpose),
      title: normalizeText(data?.title),
    };
  }

  function normalizeOverviewText(primary, fallback) {
    const direct = typeof primary === "string" ? normalizeTextBlock(primary) : "";
    if (direct) {
      return direct;
    }
    return normalizeTextArray(fallback)
      .map((item) => normalizeTextBlock(item))
      .filter(Boolean)
      .join("\n\n");
  }

  function normalizeSummaryText(primary, fallback) {
    const direct = typeof primary === "string" ? normalizeTextBlock(primary) : "";
    if (direct) {
      return direct;
    }
    return normalizeTextArray(fallback)
      .map((item) => normalizeTextBlock(item))
      .filter(Boolean)
      .join(" ");
  }

  function normalizeMeetingActionItems(items, maxItems = MAX_ACTION_COUNT) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => {
        if (typeof item === "string") {
          return { assignee: "", dueDate: "", source: "transcript", status: "open", task: normalizeText(item) };
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
      .filter((item) => {
        if (item.assignee || item.dueDate) return true;
        return !/(검토가 필요|논의가 필요|추가 확인이 필요|추가 논의가 필요|결정이 필요|추가 검토 필요|추가 논의 필요)$/i.test(item.task);
      });
    return dedupeItems(normalized, (item) => normalizeComparisonText(item.task), maxItems);
  }

  function normalizeMeetingDecisionItems(items, maxItems = MAX_DECISION_COUNT) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => {
        if (typeof item === "string") {
          return { confidence: "medium", owner: "", text: normalizeText(item) };
        }
        return {
          confidence: normalizeText(item?.confidence) || "medium",
          owner: normalizeText(item?.owner),
          text: normalizeText(item?.text || item?.decision),
        };
      })
      .filter((item) => item.text);
    return dedupeItems(normalized, (item) => normalizeComparisonText(item.text), maxItems);
  }

  function normalizeMeetingOpenQuestions(items, maxItems = MAX_OPEN_QUESTION_COUNT) {
    const normalized = normalizeTextArray(items)
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .filter((item) => !/^(추가\s*)?(논의|검토|확인)\s*필요\s*(사항)?$/i.test(item));
    return dedupeItems(normalized, (item) => normalizeComparisonText(item), maxItems);
  }

  function normalizeMeetingRiskItems(items, maxItems = MAX_RISK_COUNT) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => typeof item === "string"
        ? { severity: "medium", text: normalizeText(item) }
        : { severity: normalizeText(item?.severity) || "medium", text: normalizeText(item?.text) })
      .filter((item) => item.text);
    return dedupeItems(normalized, (item) => normalizeComparisonText(item.text), maxItems);
  }

  function normalizeMeetingSourceTrace(items, maxItems = MAX_SOURCE_TRACE_COUNT) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => ({
        evidence: normalizeText(item?.evidence),
        itemRef: normalizeText(item?.itemRef),
        itemType: normalizeText(item?.itemType),
      }))
      .filter((item) => item.itemType || item.itemRef || item.evidence);
    return dedupeItems(
      normalized,
      (item) => normalizeComparisonText(`${item.itemType} ${item.itemRef} ${item.evidence}`),
      maxItems
    );
  }

  function buildLegacyDiscussionNarrative(item) {
    const summary = normalizeTextBlock(item?.summary);
    const decisions = normalizeTextArray(item?.decisions).slice(0, 2);
    const openQuestions = normalizeMeetingOpenQuestions(item?.openQuestions, 2);
    return [
      summary,
      decisions.length ? `정리된 내용: ${decisions.join(" / ")}` : "",
      openQuestions.length ? `남은 쟁점: ${openQuestions.join(" / ")}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function normalizeDiscussionFlow(items, maxItems = MAX_DISCUSSION_FLOW_COUNT, maxKeyPoints = MAX_DISCUSSION_KEY_POINTS) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => ({
        heading: normalizeText(item?.heading || item?.title || item?.topic),
        keyPoints: dedupeItems(
          normalizeTextArray(item?.keyPoints),
          (value) => normalizeComparisonText(value),
          maxKeyPoints
        ),
        narrative: normalizeTextBlock(item?.narrative || item?.summary || item?.text),
      }))
      .filter((item) => item.heading || item.narrative || item.keyPoints.length);
    return dedupeItems(
      normalized,
      (item) => normalizeComparisonText(item.heading || item.narrative || item.keyPoints[0]),
      maxItems
    );
  }

  function convertLegacyTopicsToDiscussionFlow(items, maxItems = MAX_DISCUSSION_FLOW_COUNT, maxKeyPoints = MAX_DISCUSSION_KEY_POINTS) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => ({
        heading: normalizeText(item?.topic),
        keyPoints: dedupeItems(
          normalizeTextArray(item?.keyPoints),
          (value) => normalizeComparisonText(value),
          maxKeyPoints
        ),
        narrative: buildLegacyDiscussionNarrative(item),
      }))
      .filter((item) => item.heading || item.narrative || item.keyPoints.length);
    return dedupeItems(
      normalized,
      (item) => normalizeComparisonText(item.heading || item.narrative || item.keyPoints[0]),
      maxItems
    );
  }

  function convertLegacyDiscussionListToDiscussionFlow(items, maxItems = MAX_DISCUSSION_FLOW_COUNT) {
    const keyPoints = dedupeItems(
      normalizeTextArray(items),
      (value) => normalizeComparisonText(value),
      MAX_DISCUSSION_KEY_POINTS
    );
    if (!keyPoints.length) {
      return [];
    }
    return [{
      heading: "주요 논의 흐름",
      keyPoints,
      narrative: "",
    }].slice(0, maxItems);
  }

  function normalizeDocumentMeetingNotes(notes, settings) {
    return {
      actionItems: normalizeMeetingActionItems(notes.actionItems, Math.max(1, Number(settings.maxActionItems) || MAX_ACTION_COUNT)),
      decisions: normalizeMeetingDecisionItems(notes.decisions, Math.max(1, Number(settings.maxDecisions) || MAX_DECISION_COUNT)),
      discussionFlow: normalizeDiscussionFlow(
        notes.discussionFlow,
        Math.max(1, Number(settings.maxDiscussionFlow) || MAX_DISCUSSION_FLOW_COUNT),
        Math.max(1, Number(settings.maxKeyPoints) || MAX_DISCUSSION_KEY_POINTS)
      ),
      meetingMeta: normalizeMeetingMeta(notes.meetingMeta),
      openQuestions: normalizeMeetingOpenQuestions(notes.openQuestions, Math.max(1, Number(settings.maxOpenQuestions) || MAX_OPEN_QUESTION_COUNT)),
      summary: normalizeSummaryText(notes.summary, [notes.overview]),
      overview: normalizeOverviewText(notes.overview, []),
      risksOrDependencies: normalizeMeetingRiskItems(notes.risksOrDependencies, Math.max(1, Number(settings.maxRisks) || MAX_RISK_COUNT)),
      sourceTrace: normalizeMeetingSourceTrace(notes.sourceTrace, Math.max(1, Number(settings.maxSourceTrace) || MAX_SOURCE_TRACE_COUNT)),
    };
  }

  function normalizeLegacyMeetingNotes(notes, settings) {
    const legacyActionItems = normalizeMeetingActionItems(notes.actionItems, Math.max(1, Number(settings.maxActionItems) || MAX_ACTION_COUNT));
    const legacyNextSteps = normalizeTextArray(notes.nextSteps).map((task) => ({
      assignee: "",
      dueDate: "",
      source: "transcript",
      status: "open",
      task,
    }));
    return {
      actionItems: dedupeItems(
        [...legacyActionItems, ...legacyNextSteps],
        (item) => normalizeComparisonText(item.task),
        Math.max(1, Number(settings.maxActionItems) || MAX_ACTION_COUNT)
      ),
      decisions: normalizeMeetingDecisionItems(notes.decisions, Math.max(1, Number(settings.maxDecisions) || MAX_DECISION_COUNT)),
      discussionFlow: Array.isArray(notes.topics) && notes.topics.length
        ? convertLegacyTopicsToDiscussionFlow(
            notes.topics,
            Math.max(1, Number(settings.maxDiscussionFlow) || MAX_DISCUSSION_FLOW_COUNT),
            Math.max(1, Number(settings.maxKeyPoints) || MAX_DISCUSSION_KEY_POINTS)
          )
        : convertLegacyDiscussionListToDiscussionFlow(
            notes.discussion,
            Math.max(1, Number(settings.maxDiscussionFlow) || MAX_DISCUSSION_FLOW_COUNT)
          ),
      meetingMeta: normalizeMeetingMeta(notes.meetingMeta),
      openQuestions: normalizeMeetingOpenQuestions(notes.openQuestions, Math.max(1, Number(settings.maxOpenQuestions) || MAX_OPEN_QUESTION_COUNT)),
      summary: normalizeSummaryText(notes.summary, notes.executiveSummary || notes.overview || []),
      overview: normalizeOverviewText(notes.overview, notes.executiveSummary),
      risksOrDependencies: normalizeMeetingRiskItems(notes.risksOrDependencies, Math.max(1, Number(settings.maxRisks) || MAX_RISK_COUNT)),
      sourceTrace: normalizeMeetingSourceTrace(notes.sourceTrace, Math.max(1, Number(settings.maxSourceTrace) || MAX_SOURCE_TRACE_COUNT)),
    };
  }

  function normalizeMeetingNotes(notes, options) {
    const settings = options && typeof options === "object" ? options : {};
    const nextNotes = notes && typeof notes === "object" ? notes : {};
    if (
      typeof nextNotes.summary !== "undefined"
      || typeof nextNotes.overview !== "undefined"
      || Array.isArray(nextNotes.discussionFlow)
      || (nextNotes.meetingMeta && typeof nextNotes.meetingMeta === "object" && (
        normalizeText(nextNotes.meetingMeta?.purpose)
        || normalizeText(nextNotes.meetingMeta?.datetime)
        || normalizeText(nextNotes.meetingMeta?.title)
        || normalizeTextArray(nextNotes.meetingMeta?.participants).length
      ))
    ) {
      return normalizeDocumentMeetingNotes(nextNotes, settings);
    }
    return normalizeLegacyMeetingNotes(nextNotes, settings);
  }

  function hasMeetingNotes(notes) {
    const normalized = normalizeMeetingNotes(notes);
    return Boolean(
      normalized.summary
      || normalized.overview
      || normalized.meetingMeta?.purpose
      || normalized.meetingMeta?.title
      || normalized.meetingMeta?.datetime
      || normalizeTextArray(normalized.meetingMeta?.participants).length
      || normalized.discussionFlow?.length
      || normalized.decisions?.length
      || normalized.actionItems?.length
      || normalized.openQuestions?.length
      || normalized.risksOrDependencies?.length
    );
  }

  ns.notes = {
    hasMeetingNotes,
    normalizeMeetingNotes,
    normalizeTextArray,
    normalizeTextBlock,
  };
})(globalThis);
