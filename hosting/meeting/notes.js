(function initHostedMeetingNotes(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const {
    DEFAULT_NOTES_MODE,
    normalizeMeetingNotesMode,
    normalizeText,
    normalizeTextBlock,
  } = ns.shared;
  const MAX_NOTES_SUMMARY_ITEMS = 3;
  const MAX_NOTES_TOPIC_COUNT = 4;
  const MAX_NOTES_TOPIC_KEY_POINTS = 4;
  const MAX_NOTES_DECISION_COUNT = 5;
  const MAX_NOTES_ACTION_COUNT = 5;
  const MAX_NOTES_OPEN_QUESTION_COUNT = 3;
  const MAX_NOTES_RISK_COUNT = 3;

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

  function normalizeMeetingActionItems(items) {
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
      .filter((item) => item.task);
    return dedupeItems(normalized, (item) => normalizeComparisonText(item.task), MAX_NOTES_ACTION_COUNT);
  }

  function normalizeMeetingDecisionItems(items) {
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
    return dedupeItems(normalized, (item) => normalizeComparisonText(item.text), MAX_NOTES_DECISION_COUNT);
  }

  function normalizeMeetingTopics(items) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => ({
        decisions: dedupeItems(normalizeTextArray(item?.decisions), (value) => normalizeComparisonText(value), 3),
        keyPoints: dedupeItems(normalizeTextArray(item?.keyPoints), (value) => normalizeComparisonText(value), MAX_NOTES_TOPIC_KEY_POINTS),
        openQuestions: dedupeItems(normalizeTextArray(item?.openQuestions), (value) => normalizeComparisonText(value), 2),
        source: { memo: Boolean(item?.source?.memo), transcript: item?.source?.transcript !== false },
        summary: normalizeText(item?.summary),
        topic: normalizeText(item?.topic),
      }))
      .filter((item) => item.topic || item.summary || item.keyPoints.length || item.decisions.length || item.openQuestions.length);
    return dedupeItems(
      normalized,
      (item) => normalizeComparisonText(item.topic || item.summary || item.keyPoints[0]),
      MAX_NOTES_TOPIC_COUNT
    );
  }

  function normalizeMeetingRiskItems(items) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => typeof item === "string"
        ? { severity: "medium", text: normalizeText(item) }
        : { severity: normalizeText(item?.severity) || "medium", text: normalizeText(item?.text) })
      .filter((item) => item.text);
    return dedupeItems(normalized, (item) => normalizeComparisonText(item.text), MAX_NOTES_RISK_COUNT);
  }

  function normalizeMeetingMemoHighlights(items) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => typeof item === "string"
        ? { linkedTopic: "", mergeStatus: "merged", text: normalizeText(item) }
        : { linkedTopic: normalizeText(item?.linkedTopic), mergeStatus: normalizeText(item?.mergeStatus) || "merged", text: normalizeText(item?.text) })
      .filter((item) => item.text);
    return dedupeItems(normalized, (item) => normalizeComparisonText(item.text), 4);
  }

  function normalizeMeetingModeSpecific(input, mode) {
    const data = input && typeof input === "object" ? input : {};
    if (mode === "interview") {
      return {
        concerns: dedupeItems(normalizeTextArray(data.concerns), (item) => normalizeComparisonText(item), 3),
        followUpQuestions: dedupeItems(normalizeTextArray(data.followUpQuestions), (item) => normalizeComparisonText(item), 3),
        strengths: dedupeItems(normalizeTextArray(data.strengths), (item) => normalizeComparisonText(item), 3),
      };
    }
    if (mode === "review") {
      return {
        improvements: dedupeItems(normalizeTextArray(data.improvements), (item) => normalizeComparisonText(item), 4),
        problems: dedupeItems(normalizeTextArray(data.problems), (item) => normalizeComparisonText(item), 4),
        rootCauses: dedupeItems(normalizeTextArray(data.rootCauses), (item) => normalizeComparisonText(item), 3),
        wins: dedupeItems(normalizeTextArray(data.wins), (item) => normalizeComparisonText(item), 3),
      };
    }
    if (mode === "planning") {
      return {
        dependencies: dedupeItems(normalizeTextArray(data.dependencies), (item) => normalizeComparisonText(item), 4),
        milestones: dedupeItems(normalizeTextArray(data.milestones), (item) => normalizeComparisonText(item), 4),
        scopeItems: dedupeItems(normalizeTextArray(data.scopeItems), (item) => normalizeComparisonText(item), 4),
      };
    }
    return {};
  }

  function normalizeMeetingMeta(input) {
    const data = input && typeof input === "object" ? input : {};
    return {
      datetime: normalizeText(data?.datetime),
      participants: normalizeTextArray(data?.participants),
      purpose: normalizeTextBlock(data?.purpose),
      title: normalizeText(data?.title),
      version: normalizeText(data?.version),
    };
  }

  function normalizeMeetingNotes(notes, preferredMode) {
    const nextNotes = notes && typeof notes === "object" ? notes : {};
    const mode = normalizeMeetingNotesMode(preferredMode || nextNotes.mode) || DEFAULT_NOTES_MODE;
    if (
      Array.isArray(nextNotes.executiveSummary)
      || Array.isArray(nextNotes.topics)
      || Array.isArray(nextNotes.openQuestions)
      || Array.isArray(nextNotes.risksOrDependencies)
      || Array.isArray(nextNotes.memoHighlights)
    ) {
      return {
        actionItems: normalizeMeetingActionItems(nextNotes.actionItems),
        decisions: normalizeMeetingDecisionItems(nextNotes.decisions),
        executiveSummary: dedupeItems(normalizeTextArray(nextNotes.executiveSummary), (item) => normalizeComparisonText(item), MAX_NOTES_SUMMARY_ITEMS),
        meetingMeta: normalizeMeetingMeta(nextNotes.meetingMeta),
        memoHighlights: normalizeMeetingMemoHighlights(nextNotes.memoHighlights),
        mode,
        modeSpecific: normalizeMeetingModeSpecific(nextNotes.modeSpecific, mode),
        openQuestions: dedupeItems(normalizeTextArray(nextNotes.openQuestions), (item) => normalizeComparisonText(item), MAX_NOTES_OPEN_QUESTION_COUNT),
        risksOrDependencies: normalizeMeetingRiskItems(nextNotes.risksOrDependencies),
        topics: normalizeMeetingTopics(nextNotes.topics),
      };
    }
    return {
      actionItems: [
        ...normalizeMeetingActionItems(nextNotes.actionItems),
        ...normalizeTextArray(nextNotes.nextSteps).map((task) => ({ assignee: "", dueDate: "", source: "transcript", status: "open", task })),
      ],
      decisions: normalizeMeetingDecisionItems(nextNotes.decisions),
      executiveSummary: dedupeItems(normalizeTextArray([nextNotes.overview]), (item) => normalizeComparisonText(item), MAX_NOTES_SUMMARY_ITEMS),
      meetingMeta: normalizeMeetingMeta(nextNotes.meetingMeta),
      memoHighlights: [],
      mode,
      modeSpecific: normalizeMeetingModeSpecific({}, mode),
      openQuestions: [],
      risksOrDependencies: [],
      topics: normalizeTextArray(nextNotes.discussion).length
        ? [{ decisions: [], keyPoints: normalizeTextArray(nextNotes.discussion), openQuestions: [], source: { memo: false, transcript: true }, summary: "", topic: "핵심 논의" }]
        : [],
    };
  }

  function hasMeetingNotes(notes) {
    return Boolean(
      notes?.executiveSummary?.length
      || normalizeTextBlock(notes?.meetingMeta?.purpose)
      || normalizeTextArray(notes?.meetingMeta?.participants).length
      || notes?.topics?.length
      || notes?.decisions?.length
      || notes?.actionItems?.length
      || notes?.openQuestions?.length
      || notes?.risksOrDependencies?.length
      || notes?.memoHighlights?.length
      || normalizeTextArray(notes?.modeSpecific?.strengths).length
      || normalizeTextArray(notes?.modeSpecific?.concerns).length
      || normalizeTextArray(notes?.modeSpecific?.wins).length
      || normalizeTextArray(notes?.modeSpecific?.milestones).length
    );
  }

  function joinNoteLines(lines) {
    return (Array.isArray(lines) ? lines : []).map((item) => normalizeText(item)).filter(Boolean).join("\n");
  }

  function splitCompactListText(items) {
    return normalizeTextArray(items).flatMap((item) => {
      if (!item.includes(" / ")) {
        return [item];
      }
      const parts = item.split(" / ").map((part) => normalizeText(part)).filter(Boolean);
      return parts.length >= 2 ? parts : [item];
    });
  }

  function splitTopicHeadline(topic, fallbackSummary) {
    const normalizedTopic = normalizeText(topic);
    const normalizedSummary = normalizeText(fallbackSummary);
    if (normalizedSummary) {
      return { headline: normalizedTopic, summary: normalizedSummary };
    }
    for (const marker of [" · ", " - ", " — ", " – "]) {
      const index = normalizedTopic.indexOf(marker);
      if (index > 1 && index < 40) {
        return {
          headline: normalizeText(normalizedTopic.slice(0, index)),
          summary: normalizeText(normalizedTopic.slice(index + marker.length)),
        };
      }
    }
    return { headline: normalizedTopic, summary: normalizedSummary };
  }

  function formatActionStatusLabel(status) {
    const normalizedStatus = normalizeText(status).toLowerCase();
    if (!normalizedStatus) return "";
    if (["open", "planned", "todo"].includes(normalizedStatus)) return "계획";
    if (["in_progress", "doing", "active"].includes(normalizedStatus)) return "진행 중";
    if (["done", "completed", "closed"].includes(normalizedStatus)) return "완료";
    if (["blocked", "hold", "on_hold"].includes(normalizedStatus)) return "보류";
    return normalizeText(status);
  }

  function formatTopicItem(item) {
    const { headline, summary } = splitTopicHeadline(item?.topic, item?.summary);
    const keyPoints = splitCompactListText(item?.keyPoints)
      .slice(0, MAX_NOTES_TOPIC_KEY_POINTS)
      .map((point) => `- ${point}`);
    const decisions = dedupeItems(normalizeTextArray(item?.decisions), (value) => normalizeComparisonText(value), 2)
      .map((decision) => `- 정리된 내용: ${decision}`);
    const openQuestions = dedupeItems(normalizeTextArray(item?.openQuestions), (value) => normalizeComparisonText(value), 2)
      .map((question) => `- 남은 쟁점: ${question}`);
    return joinNoteLines([
      headline,
      summary,
      ...keyPoints,
      ...decisions,
      ...openQuestions,
    ]);
  }

  function formatDecisionItem(item) {
    return joinNoteLines([
      normalizeText(item?.text),
      normalizeText(item?.owner) ? `담당: ${normalizeText(item.owner)}` : "",
    ]);
  }

  function formatActionItem(item) {
    return joinNoteLines([
      normalizeText(item?.task),
      normalizeText(item?.assignee) ? `담당: ${normalizeText(item.assignee)}` : "",
      normalizeText(item?.dueDate) ? `기한: ${normalizeText(item.dueDate)}` : "",
      formatActionStatusLabel(item?.status) ? `상태: ${formatActionStatusLabel(item.status)}` : "",
    ]);
  }

  function formatRiskItem(item) {
    return joinNoteLines([
      normalizeText(item?.text),
      normalizeText(item?.severity) ? `심각도: ${normalizeText(item.severity)}` : "",
    ]);
  }

  function formatMemoItem(item) {
    return joinNoteLines([
      normalizeText(item?.text),
      normalizeText(item?.linkedTopic) ? `연결 토픽: ${normalizeText(item.linkedTopic)}` : "",
      normalizeText(item?.mergeStatus) ? `반영 상태: ${normalizeText(item.mergeStatus)}` : "",
    ]);
  }

  ns.notes = {
    formatActionItem,
    formatDecisionItem,
    formatMemoItem,
    formatRiskItem,
    formatTopicItem,
    hasMeetingNotes,
    normalizeMeetingNotes,
    normalizeTextArray,
    normalizeTextBlock,
  };
})(globalThis);
