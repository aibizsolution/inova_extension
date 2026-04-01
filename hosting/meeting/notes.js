(function initHostedMeetingNotes(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const {
    DEFAULT_NOTES_MODE,
    normalizeMeetingNotesMode,
    normalizeText,
    normalizeTextBlock,
  } = ns.shared;

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

  function normalizeMeetingActionItems(items) {
    return (Array.isArray(items) ? items : [])
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
  }

  function normalizeMeetingDecisionItems(items) {
    return (Array.isArray(items) ? items : [])
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
  }

  function normalizeMeetingTopics(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        decisions: normalizeTextArray(item?.decisions),
        keyPoints: normalizeTextArray(item?.keyPoints),
        openQuestions: normalizeTextArray(item?.openQuestions),
        source: { memo: Boolean(item?.source?.memo), transcript: item?.source?.transcript !== false },
        summary: normalizeText(item?.summary),
        topic: normalizeText(item?.topic),
      }))
      .filter((item) => item.topic || item.summary || item.keyPoints.length || item.decisions.length || item.openQuestions.length);
  }

  function normalizeMeetingRiskItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => typeof item === "string"
        ? { severity: "medium", text: normalizeText(item) }
        : { severity: normalizeText(item?.severity) || "medium", text: normalizeText(item?.text) })
      .filter((item) => item.text);
  }

  function normalizeMeetingMemoHighlights(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => typeof item === "string"
        ? { linkedTopic: "", mergeStatus: "merged", text: normalizeText(item) }
        : { linkedTopic: normalizeText(item?.linkedTopic), mergeStatus: normalizeText(item?.mergeStatus) || "merged", text: normalizeText(item?.text) })
      .filter((item) => item.text);
  }

  function normalizeMeetingSpeakerSummaries(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        keyPoints: normalizeTextArray(item?.keyPoints),
        speakerLabel: normalizeText(item?.speakerLabel),
        summary: normalizeText(item?.summary),
      }))
      .filter((item) => item.speakerLabel && (item.summary || item.keyPoints.length));
  }

  function normalizeMeetingModeSpecific(input, mode) {
    const data = input && typeof input === "object" ? input : {};
    if (mode === "interview") {
      return {
        concerns: normalizeTextArray(data.concerns),
        followUpQuestions: normalizeTextArray(data.followUpQuestions),
        strengths: normalizeTextArray(data.strengths),
      };
    }
    if (mode === "review") {
      return {
        improvements: normalizeTextArray(data.improvements),
        problems: normalizeTextArray(data.problems),
        rootCauses: normalizeTextArray(data.rootCauses),
        wins: normalizeTextArray(data.wins),
      };
    }
    if (mode === "planning") {
      return {
        dependencies: normalizeTextArray(data.dependencies),
        milestones: normalizeTextArray(data.milestones),
        scopeItems: normalizeTextArray(data.scopeItems),
      };
    }
    return {};
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
      || Array.isArray(nextNotes.speakerSummaries)
    ) {
      return {
        actionItems: normalizeMeetingActionItems(nextNotes.actionItems),
        decisions: normalizeMeetingDecisionItems(nextNotes.decisions),
        executiveSummary: normalizeTextArray(nextNotes.executiveSummary),
        memoHighlights: normalizeMeetingMemoHighlights(nextNotes.memoHighlights),
        mode,
        modeSpecific: normalizeMeetingModeSpecific(nextNotes.modeSpecific, mode),
        openQuestions: normalizeTextArray(nextNotes.openQuestions),
        risksOrDependencies: normalizeMeetingRiskItems(nextNotes.risksOrDependencies),
        speakerSummaries: normalizeMeetingSpeakerSummaries(nextNotes.speakerSummaries),
        topics: normalizeMeetingTopics(nextNotes.topics),
      };
    }
    return {
      actionItems: [
        ...normalizeMeetingActionItems(nextNotes.actionItems),
        ...normalizeTextArray(nextNotes.nextSteps).map((task) => ({ assignee: "", dueDate: "", source: "transcript", status: "open", task })),
      ],
      decisions: normalizeMeetingDecisionItems(nextNotes.decisions),
      executiveSummary: normalizeTextArray([nextNotes.overview]),
      memoHighlights: [],
      mode,
      modeSpecific: normalizeMeetingModeSpecific({}, mode),
      openQuestions: [],
      risksOrDependencies: [],
      speakerSummaries: [],
      topics: normalizeTextArray(nextNotes.discussion).length
        ? [{ decisions: [], keyPoints: normalizeTextArray(nextNotes.discussion), openQuestions: [], source: { memo: false, transcript: true }, summary: "", topic: "핵심 논의" }]
        : [],
    };
  }

  function hasMeetingNotes(notes) {
    return Boolean(
      notes?.executiveSummary?.length
      || notes?.topics?.length
      || notes?.decisions?.length
      || notes?.actionItems?.length
      || notes?.openQuestions?.length
      || notes?.risksOrDependencies?.length
      || notes?.speakerSummaries?.length
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
    const keyPoints = splitCompactListText(item?.keyPoints).map((point) => `- ${point}`);
    return joinNoteLines([
      headline,
      summary,
      ...keyPoints,
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
