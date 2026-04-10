(function initHostedMeetingRender(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const { escapeHtml, formatBytes, formatDateTime, formatDuration, formatSegmentRange, formatStatusLabel, normalizeStatus, normalizeText, normalizeTextBlock } = ns.shared;
  const { hasMeetingNotes, normalizeMeetingNotes, normalizeTextArray } = ns.notes;
  const {
    TERMINAL_REMOTE_STATUSES,
    buildChunkProgressModel,
    buildHistoryEntries,
    buildLocalPendingJob,
    buildPendingNotice,
    buildPendingSummary,
    buildProcessingNotice,
    buildRecorderView,
    buildWorkspaceView,
    chooseSelectedRecordId,
    comparePendingUploads,
    findHistoryEntry,
    findRemoteForPending,
    getPendingDisplayStatus,
    getProcessingHealth,
    normalizeArtifact,
    normalizeJob,
    normalizeRecord,
    normalizeWorkspaceMutation,
    shouldPrioritizePendingUpload,
  } = ns.renderState;
  const DISPLAY_REVIEW_SEGMENT_TARGET_CHARS = 220;
  const DISPLAY_REVIEW_SEGMENT_MAX_CHARS = 320;
  const DISPLAY_REVIEW_SEGMENT_MIN_CHARS = 80;
  const DISPLAY_REVIEW_SEGMENT_TARGET_DURATION_MS = 90 * 1000;
  const DISPLAY_REVIEW_SEGMENT_MAX_DURATION_MS = 150 * 1000;
  const DISPLAY_REVIEW_SEGMENT_MIN_DURATION_MS = 25 * 1000;

  function renderChunkProgress(model) {
    if (!model) return "";
    const totalCount = Math.max(0, Number(model.totalCount) || 0);
    const doneCount = Math.max(0, Math.min(totalCount, Number(model.doneCount) || 0));
    const activeIndex = Math.max(-1, Math.min(totalCount - 1, Number(model.activeIndex)));
    const activeCount = Math.max(
      0,
      Math.min(totalCount - Math.max(0, activeIndex), Number(model.activeCount) || (activeIndex >= 0 ? 1 : 0))
    );
    const percent = Math.max(0, Math.min(100, Number(model.percent) || 0));
    const segments = Array.from({ length: totalCount }, (_, index) => {
      const tone = index < doneCount
        ? "done"
        : activeIndex >= 0 && index >= activeIndex && index < activeIndex + activeCount
          ? "current"
          : "pending";
      return `<span class="chunk-progress__segment" data-tone="${tone}" title="청크 ${index + 1}/${totalCount}"></span>`;
    }).join("");
    const stages = Array.isArray(model.stages)
      ? model.stages.map((stage) => `
          <span class="chunk-progress__stage" data-tone="${escapeHtml(normalizeText(stage.tone) || "pending")}">
            ${escapeHtml(normalizeText(stage.label) || "")}
          </span>
        `).join("")
      : "";
    return `
      <div class="chunk-progress">
        <div class="chunk-progress__head">
          <strong class="chunk-progress__title">${escapeHtml(normalizeText(model.title) || "청크 진행")}</strong>
          ${normalizeText(model.summary) ? `<span class="chunk-progress__meta">${escapeHtml(model.summary)}</span>` : ""}
        </div>
        ${stages ? `<div class="chunk-progress__stages">${stages}</div>` : ""}
        ${totalCount > 1 ? `<div class="chunk-progress__bar" aria-hidden="true"><span style="width:${percent}%"></span></div>` : ""}
        ${totalCount > 1 ? `<div class="chunk-progress__segments" aria-hidden="true">${segments}</div>` : ""}
      </div>
    `;
  }

  function buildSummaryActionCardHtml(detailView, summaryActionMessage) {
    const chunkProgressHtml = renderChunkProgress(detailView?.chunkProgress);
    const showMessage = !chunkProgressHtml && normalizeText(summaryActionMessage);
    if (!showMessage && !chunkProgressHtml) return "";
    return [
      showMessage
        ? `<div class="summary-action-card__message">${escapeHtml(summaryActionMessage)}</div>`
        : "",
      chunkProgressHtml,
    ].filter(Boolean).join("");
  }

  function buildCompletedRecordSummary(notes) {
    const summary = normalizeTextBlock(notes?.summary);
    if (summary) return summary;
    const overview = normalizeTextBlock(notes?.overview);
    if (overview) return overview;
    const purpose = normalizeTextBlock(notes?.meetingMeta?.purpose);
    if (purpose) return purpose;
    const firstFlow = (Array.isArray(notes?.discussionFlow) ? notes.discussionFlow : []).find((item) => {
      const headline = normalizeText(item?.narrative || item?.heading);
      return Boolean(headline || normalizeTextArray(item?.keyPoints).length);
    });
    if (firstFlow) {
      const narrative = normalizeText(firstFlow?.narrative || firstFlow?.heading);
      if (narrative) return narrative;
      const firstKeyPoint = normalizeTextArray(firstFlow?.keyPoints)[0];
      if (firstKeyPoint) return firstKeyPoint;
    }
    const firstDecision = normalizeText(Array.isArray(notes?.decisions) ? notes.decisions[0]?.text : "");
    if (firstDecision) return `주요 결정: ${firstDecision}`;
    const firstAction = normalizeText(Array.isArray(notes?.actionItems) ? notes.actionItems[0]?.task : "");
    if (firstAction) return `후속 실행: ${firstAction}`;
    return "";
  }

  function splitSegmentTextIntoDisplaySentences(text) {
    const normalized = normalizeTextBlock(text).replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }
    const sentences = normalized.match(/[^.!?。！？…]+(?:[.!?。！？…]+|$)/g) || [normalized];
    const normalizedSentences = sentences.map((sentence) => normalizeText(sentence)).filter(Boolean);
    if (normalizedSentences.length > 1) {
      return normalizedSentences;
    }
    const clauses = normalized
      .split(/(?<=[,，;])\s+|(?=\b(?:그리고|하지만|다만|또|또는|그래서)\b)/)
      .map((clause) => normalizeText(clause))
      .filter(Boolean);
    if (clauses.length > 1) {
      return clauses;
    }
    const words = normalized.split(/\s+/).map((word) => normalizeText(word)).filter(Boolean);
    if (words.length <= 1) {
      return [normalized];
    }
    const chunks = [];
    let current = [];
    let currentLength = 0;
    for (const word of words) {
      const nextLength = currentLength + word.length + (current.length ? 1 : 0);
      if (current.length && nextLength > DISPLAY_REVIEW_SEGMENT_TARGET_CHARS) {
        chunks.push(current.join(" "));
        current = [word];
        currentLength = word.length;
        continue;
      }
      current.push(word);
      currentLength = nextLength;
    }
    if (current.length) {
      chunks.push(current.join(" "));
    }
    return chunks.length ? chunks : [normalized];
  }

  function buildDisplaySegmentChunk(sourceSegment, sentences, totalChars, consumedChars, chunkChars) {
    const text = normalizeTextBlock((Array.isArray(sentences) ? sentences : []).join(" "));
    if (!text) {
      return null;
    }
    const startMs = Math.max(0, Number(sourceSegment?.startMs) || 0);
    const endMs = Math.max(startMs, Number(sourceSegment?.endMs) || 0);
    const durationMs = Math.max(0, endMs - startMs);
    if (!durationMs || totalChars <= 0) {
      return {
        endMs,
        startMs,
        text,
      };
    }
    const chunkStartRatio = Math.max(0, Math.min(1, consumedChars / totalChars));
    const chunkEndRatio = Math.max(chunkStartRatio, Math.min(1, (consumedChars + chunkChars) / totalChars));
    const chunkStartMs = Math.round(startMs + (durationMs * chunkStartRatio));
    const chunkEndMs = Math.max(chunkStartMs + 1, Math.round(startMs + (durationMs * chunkEndRatio)));
    return {
      endMs: Math.min(endMs, chunkEndMs),
      startMs: Math.min(endMs, chunkStartMs),
      text,
    };
  }

  function mergeDisplaySegmentChunks(left, right) {
    const leftText = normalizeTextBlock(left?.text);
    const rightText = normalizeTextBlock(right?.text);
    if (!leftText) return right || null;
    if (!rightText) return left || null;
    return {
      endMs: Math.max(Number(left?.endMs) || 0, Number(right?.endMs) || 0),
      startMs: Math.min(Number(left?.startMs) || 0, Number(right?.startMs) || 0),
      text: `${leftText} ${rightText}`.replace(/\s+/g, " ").trim(),
    };
  }

  function resegmentSingleSegmentForDisplay(segment) {
    const normalizedText = normalizeTextBlock(segment?.text);
    if (!normalizedText) {
      return [];
    }
    const startMs = Math.max(0, Number(segment?.startMs) || 0);
    const endMs = Math.max(startMs, Number(segment?.endMs) || 0);
    const durationMs = Math.max(0, endMs - startMs);
    if (
      normalizedText.length <= DISPLAY_REVIEW_SEGMENT_MAX_CHARS
      && (!durationMs || durationMs <= DISPLAY_REVIEW_SEGMENT_MAX_DURATION_MS)
    ) {
      return [{ endMs, startMs, text: normalizedText }];
    }
    const sentences = splitSegmentTextIntoDisplaySentences(normalizedText);
    if (!sentences.length) {
      return [{ endMs, startMs, text: normalizedText }];
    }
    const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
    const chunks = [];
    let currentSentences = [];
    let currentChars = 0;
    let consumedChars = 0;
    const pushChunk = () => {
      const chunk = buildDisplaySegmentChunk(segment, currentSentences, totalChars, consumedChars, currentChars);
      if (chunk) {
        chunks.push(chunk);
        consumedChars += currentChars;
      }
      currentSentences = [];
      currentChars = 0;
    };
    for (const sentence of sentences) {
      const nextChars = currentChars + sentence.length + (currentSentences.length ? 1 : 0);
      const nextDurationEstimate = totalChars > 0 && durationMs > 0
        ? Math.round((nextChars / totalChars) * durationMs)
        : 0;
      const shouldSplitBeforeAdding = currentSentences.length
        && currentChars >= DISPLAY_REVIEW_SEGMENT_MIN_CHARS
        && (
          nextChars > DISPLAY_REVIEW_SEGMENT_TARGET_CHARS
          || nextDurationEstimate > DISPLAY_REVIEW_SEGMENT_TARGET_DURATION_MS
        );
      const mustSplitBeforeAdding = currentSentences.length
        && (
          nextChars > DISPLAY_REVIEW_SEGMENT_MAX_CHARS
          || nextDurationEstimate > DISPLAY_REVIEW_SEGMENT_MAX_DURATION_MS
        );
      if (shouldSplitBeforeAdding || mustSplitBeforeAdding) {
        pushChunk();
      }
      currentSentences.push(sentence);
      currentChars += sentence.length + (currentSentences.length > 1 ? 1 : 0);
    }
    if (currentSentences.length) {
      pushChunk();
    }
    if (chunks.length >= 2) {
      const last = chunks[chunks.length - 1];
      const lastDurationMs = Math.max(0, (Number(last?.endMs) || 0) - (Number(last?.startMs) || 0));
      if (
        normalizeTextBlock(last?.text).length < DISPLAY_REVIEW_SEGMENT_MIN_CHARS
        || (lastDurationMs > 0 && lastDurationMs < DISPLAY_REVIEW_SEGMENT_MIN_DURATION_MS)
      ) {
        const merged = mergeDisplaySegmentChunks(chunks[chunks.length - 2], last);
        if (merged) {
          chunks.splice(chunks.length - 2, 2, merged);
        }
      }
    }
    return chunks.filter((chunk) => normalizeTextBlock(chunk?.text));
  }

  function resegmentSegmentsForDisplay(segments) {
    return (Array.isArray(segments) ? segments : [])
      .flatMap((segment) => resegmentSingleSegmentForDisplay(segment))
      .filter((segment) => normalizeTextBlock(segment?.text));
  }

  function buildTranscriptTextForDisplay(segments, fallbackText) {
    const lines = (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const text = normalizeText(segment?.text);
        if (!text) return "";
        const range = normalizeText(formatSegmentRange(segment?.startMs, segment?.endMs));
        return range ? `[${range}] ${text}` : text;
      })
      .filter(Boolean);
    return normalizeTextBlock(lines.join("\n") || fallbackText);
  }

  function buildSegmentCopyText(segments, fallbackText) {
    const lines = (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const text = normalizeText(segment?.text);
        if (!text) return "";
        const range = normalizeText(formatSegmentRange(segment?.startMs, segment?.endMs));
        return `${range ? `[${range}] ` : ""}${text}`;
      })
      .filter(Boolean);
    return normalizeTextBlock(lines.join("\n") || fallbackText);
  }

  function formatCaptureTimer(durationMs) {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getMeetingNotesSectionLabel(sectionKey) {
    const normalized = normalizeText(sectionKey);
    if (normalized === "overview") return "회의 개요";
    if (normalized === "discussionFlow") return "논의 흐름";
    if (normalized === "decisions") return "주요 결정 사항";
    if (normalized === "openQuestions") return "추가 결정 필요 사항";
    if (normalized === "risksOrDependencies") return "리스크 및 제약";
    if (normalized === "actionItems") return "후속 실행 항목";
    return "회의 정리";
  }

  function buildMeetingNotesSectionByKey(sectionKey, notes) {
    const normalized = normalizeText(sectionKey);
    if (normalized === "overview") return buildMeetingOverviewSection(notes);
    if (normalized === "discussionFlow") return buildDiscussionFlowSection(notes?.discussionFlow);
    if (normalized === "decisions") return buildSimpleListSection("주요 결정 사항", normalizeDecisionItemsForDisplay(notes?.decisions));
    if (normalized === "openQuestions") return buildSimpleListSection("추가 결정 필요 사항", normalizeTextArray(notes?.openQuestions));
    if (normalized === "risksOrDependencies") return buildSimpleListSection("리스크 및 제약", normalizeRiskItemsForDisplay(notes?.risksOrDependencies));
    if (normalized === "actionItems") return buildSimpleListSection("후속 실행 항목", normalizeActionItemsForDisplay(notes?.actionItems));
    return null;
  }

  function buildMeetingNotesSections(notes) {
    return [
      "overview",
      "discussionFlow",
      "decisions",
      "openQuestions",
      "risksOrDependencies",
      "actionItems",
    ].map((sectionKey) => {
      const section = buildMeetingNotesSectionByKey(sectionKey, notes);
      return section ? { ...section, key: sectionKey } : null;
    }).filter(Boolean);
  }

  function normalizeNotesInputSnapshot(input, fallbackInput) {
    const snapshot = input && typeof input === "object" ? input : {};
    const fallback = fallbackInput && typeof fallbackInput === "object" ? fallbackInput : {};
    const sharedMemo = normalizeTextBlock(
      Object.prototype.hasOwnProperty.call(snapshot, "sharedMemo")
        ? snapshot.sharedMemo
        : fallback.sharedMemo
    );
    const updatedAt = normalizeText(snapshot.updatedAt || fallback.updatedAt);
    return {
      sharedMemo,
      updatedAt,
    };
  }

  function buildMeetingOverviewSection(notes) {
    const purpose = normalizeTextBlock(notes?.meetingMeta?.purpose);
    const overview = normalizeTextBlock(notes?.overview);
    const participants = normalizeTextArray(notes?.meetingMeta?.participants);
    const datetime = normalizeText(notes?.meetingMeta?.datetime);
    const paragraphs = [purpose, overview].filter(Boolean);
    if (!paragraphs.length && !participants.length && !datetime) {
      return null;
    }
    return {
      metaItems: [
        datetime ? `일시 ${datetime}` : "",
        participants.length ? `참여자 ${participants.join(", ")}` : "",
      ].filter(Boolean),
      paragraphs,
      title: "회의 개요",
      type: "prose",
    };
  }

  function normalizeDecisionItemsForDisplay(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const text = normalizeText(item?.text);
        if (!text) {
          return null;
        }
        const meta = normalizeText(item?.owner) ? `담당: ${normalizeText(item.owner)}` : "";
        return { body: "", headline: text, meta };
      })
      .filter(Boolean);
  }

  function normalizeActionItemsForDisplay(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const task = normalizeText(item?.task);
        if (!task) {
          return null;
        }
        const metaParts = [
          normalizeText(item?.assignee) ? `담당: ${normalizeText(item.assignee)}` : "",
          normalizeText(item?.dueDate) ? `기한: ${normalizeText(item.dueDate)}` : "",
          normalizeText(item?.status) ? `상태: ${normalizeText(item.status)}` : "",
        ].filter(Boolean);
        return { body: "", headline: task, meta: metaParts.join(" · ") };
      })
      .filter(Boolean);
  }

  function normalizeRiskItemsForDisplay(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const text = normalizeText(item?.text);
        if (!text) {
          return null;
        }
        const meta = normalizeText(item?.severity) ? `심각도: ${normalizeText(item.severity)}` : "";
        return { body: "", headline: text, meta };
      })
      .filter(Boolean);
  }

  function buildDiscussionFlowSection(items) {
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((item) => ({
        heading: normalizeText(item?.heading),
        keyPoints: normalizeTextArray(item?.keyPoints),
        narrative: normalizeTextBlock(item?.narrative),
      }))
      .filter((item) => item.heading || item.narrative || item.keyPoints.length);
    if (!normalizedItems.length) {
      return null;
    }
    return {
      items: normalizedItems,
      title: "논의 흐름",
      type: "flow",
    };
  }

  function buildSimpleListSection(title, items) {
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((item) => {
        if (typeof item === "string") {
          const text = normalizeTextBlock(item);
          return text ? { body: "", headline: text, meta: "" } : null;
        }
        const headline = normalizeTextBlock(item?.headline);
        const body = normalizeTextBlock(item?.body);
        const meta = normalizeText(item?.meta);
        if (!headline && !body) {
          return null;
        }
        return {
          body,
          headline: headline || body,
          meta,
        };
      })
      .filter(Boolean);
    if (!normalizedItems.length) {
      return null;
    }
    return {
      items: normalizedItems,
      title,
      type: "list",
    };
  }

  function buildMeetingNotesSectionPreview(sectionKey, sectionData) {
    const normalizedKey = normalizeText(sectionKey);
    if (normalizedKey === "overview") {
      const payload = sectionData && typeof sectionData === "object" ? sectionData : {};
      return buildMeetingOverviewSection({
        meetingMeta: payload.meetingMeta,
        overview: payload.overview,
      });
    }
    if (normalizedKey === "discussionFlow") {
      return buildDiscussionFlowSection(sectionData);
    }
    if (normalizedKey === "decisions") {
      return buildSimpleListSection("주요 결정 사항", normalizeDecisionItemsForDisplay(sectionData));
    }
    if (normalizedKey === "openQuestions") {
      return buildSimpleListSection("추가 결정 필요 사항", normalizeTextArray(sectionData));
    }
    if (normalizedKey === "risksOrDependencies") {
      return buildSimpleListSection("리스크 및 제약", normalizeRiskItemsForDisplay(sectionData));
    }
    if (normalizedKey === "actionItems") {
      return buildSimpleListSection("후속 실행 항목", normalizeActionItemsForDisplay(sectionData));
    }
    return null;
  }

  function splitNotesParagraphs(text) {
    return normalizeTextBlock(text)
      .split("\n")
      .map((paragraph) => normalizeTextBlock(paragraph))
      .filter(Boolean);
  }

  function renderNotesProse(paragraphs) {
    const normalized = (Array.isArray(paragraphs) ? paragraphs : [])
      .flatMap((paragraph) => splitNotesParagraphs(paragraph))
      .filter(Boolean);
    if (!normalized.length) {
      return "";
    }
    return `<div class="notes-prose">${normalized.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>`;
  }

  function renderNotesMetaRow(items) {
    const normalized = (Array.isArray(items) ? items : []).map((item) => normalizeText(item)).filter(Boolean);
    if (!normalized.length) {
      return "";
    }
    return `<div class="notes-meta-row">${normalized.map((item) => `<span class="notes-meta-chip">${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function renderNotesListItem(item) {
    const headline = normalizeTextBlock(item?.headline);
    const body = normalizeTextBlock(item?.body);
    const meta = normalizeText(item?.meta);
    if (!headline && !body) {
      return "";
    }
    return `<li class="notes-list__item"><div class="notes-list__headline">${escapeHtml(headline || body)}</div>${meta ? `<div class="notes-list__meta">${escapeHtml(meta)}</div>` : ""}${body && body !== headline ? `<div class="notes-list__body">${renderNotesProse([body])}</div>` : ""}</li>`;
  }

  function renderNotesSectionHeader(section, options = {}) {
    const actionKey = normalizeText(section?.key);
    const actionButton = options.allowSectionEdit && actionKey
      ? `<button type="button" class="notes-section__action" data-notes-section-action="edit" data-section-key="${escapeHtml(actionKey)}" aria-label="${escapeHtml(section.title)} 섹션 수정">
          <svg class="notes-section__action-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M11.667 2.667a1.414 1.414 0 0 1 2 2L6 12.333l-2.667.667L4 10.333l7.667-7.666Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2"/>
          </svg>
        </button>`
      : "";
    return `<div class="notes-section__head"><h3 class="notes-section__title">${escapeHtml(section.title)}</h3>${actionButton}</div>`;
  }

  function renderNotesSection(section, options = {}) {
    if (!section) {
      return "";
    }
    const header = renderNotesSectionHeader(section, options);
    if (section.type === "prose") {
      return `<section class="notes-section">${header}${renderNotesMetaRow(section.metaItems)}${renderNotesProse(section.paragraphs)}</section>`;
    }
    if (section.type === "flow") {
      return `<section class="notes-section">${header}<div class="notes-flow">${section.items.map((item) => `<article class="notes-flow__item"><h4 class="notes-flow__heading">${escapeHtml(item.heading || "주요 논의")}</h4>${renderNotesProse([item.narrative])}${item.keyPoints.length ? `<ul class="notes-flow__points">${item.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div></section>`;
    }
    return `<section class="notes-section">${header}<ul class="notes-list">${section.items.map((item) => renderNotesListItem(item)).join("")}</ul></section>`;
  }

  function renderNotesOverview(notes) {
    const summary = buildCompletedRecordSummary(notes);
    if (!summary) {
      return "";
    }
    return `<section class="notes-section"><h3 class="notes-section__title">핵심 요약</h3>${renderNotesProse([summary])}</section>`;
  }

  function buildMeetingNotesCopyText(notes) {
    const normalized = normalizeMeetingNotes(notes);
    if (!hasMeetingNotes(normalized)) {
      return "";
    }
    const blocks = [];
    const summary = buildCompletedRecordSummary(normalized);
    if (summary) {
      blocks.push(["핵심 요약", ...splitNotesParagraphs(summary)].filter(Boolean).join("\n"));
    }
    for (const section of buildMeetingNotesSections(normalized)) {
      const sectionText = buildMeetingNotesCopySectionText(section);
      if (sectionText) {
        blocks.push(sectionText);
      }
    }
    return blocks.join("\n\n").trim();
  }

  function buildMeetingNotesCopySectionText(section) {
    if (!section) {
      return "";
    }
    if (section.type === "prose") {
      return [
        normalizeText(section.title),
        ...normalizeTextArray(section.metaItems),
        ...(Array.isArray(section.paragraphs) ? section.paragraphs.flatMap((paragraph) => splitNotesParagraphs(paragraph)) : []),
      ].filter(Boolean).join("\n");
    }
    if (section.type === "flow") {
      const items = (Array.isArray(section.items) ? section.items : [])
        .map((item, index) => buildMeetingNotesCopyFlowItemText(item, index))
        .filter(Boolean);
      return [normalizeText(section.title), ...items].filter(Boolean).join("\n");
    }
    const items = (Array.isArray(section.items) ? section.items : [])
      .map((item) => buildMeetingNotesCopyListItemText(item))
      .filter(Boolean);
    return [normalizeText(section.title), ...items].filter(Boolean).join("\n");
  }

  function buildMeetingNotesCopyFlowItemText(item, index) {
    const heading = normalizeText(item?.heading) || `주요 논의 ${index + 1}`;
    const narrative = splitNotesParagraphs(item?.narrative);
    const keyPoints = normalizeTextArray(item?.keyPoints);
    return [
      `${index + 1}. ${heading}`,
      ...narrative,
      ...keyPoints.map((point) => `- ${point}`),
    ].filter(Boolean).join("\n");
  }

  function buildMeetingNotesCopyListItemText(item) {
    const headline = normalizeTextBlock(item?.headline || item?.body);
    const meta = normalizeText(item?.meta);
    const bodyLines = splitNotesParagraphs(item?.body).filter((line) => line !== headline);
    if (!headline && !bodyLines.length) {
      return "";
    }
    return [
      headline ? `- ${headline}` : "",
      meta ? `  ${meta}` : "",
      ...bodyLines.map((line) => `  ${line}`),
    ].filter(Boolean).join("\n");
  }

  function buildStatusFlow(detailView, options = {}) {
    const normalizedStatus = normalizeText(detailView.badgeStatus);
    const recordSelected = normalizedStatus !== "idle";
    const isHydratingDetail = Boolean(options.isHydratingDetail);
    const isFailed = normalizedStatus === "failed";
    const isBusy = ["queued", "processing", "uploading", "uploading_chunks", "preparing_chunks", "remote_queued", "remote_processing"].includes(normalizedStatus);
    const segmentCount = Math.max(0, Number(options.segmentCount) || 0);
    const steps = [];
    const facts = [];
    const pushStep = (title, state, detail, stateLabelOverride = "") => {
      steps.push({
        detail: normalizeText(detail),
        state,
        stateLabel: normalizeText(stateLabelOverride) || (state === "done" ? "" : state === "current" ? "진행" : state === "warning" ? "확인" : state === "failed" ? "오류" : "대기"),
        title,
      });
    };
    const pushFact = (label, value) => {
      const normalizedValue = normalizeText(value);
      if (!normalizedValue) return;
      facts.push({ label, value: normalizedValue });
    };

    pushStep("기록 선택", recordSelected ? "done" : "current", recordSelected ? "기록 선택됨" : "검토할 기록을 고릅니다.", recordSelected ? "" : "선택");

    if (isFailed) {
      pushStep("원문", "failed", "오류로 중단되었습니다.");
    } else if (options.hasSegmentContent) {
      pushStep("원문", "done", segmentCount > 0 ? `구간 ${segmentCount}개 확인 가능` : "전사 텍스트 준비 완료");
    } else if (isHydratingDetail) {
      pushStep("원문", "current", "상세 기록을 불러오는 중입니다.");
    } else if (isBusy) {
      pushStep("원문", "current", "전사 결과를 준비하는 중입니다.");
    } else if (recordSelected) {
      pushStep("원문", "warning", "인식된 발화가 아직 충분하지 않습니다.");
    } else {
      pushStep("원문", "pending", "기록 선택 후 전사를 확인합니다.");
    }

    if (isFailed) {
      pushStep("회의 정리", "failed", "오류 해결 후 다시 생성합니다.");
    } else if (options.hasNotesValue) {
      pushStep("회의 정리", "done", options.generatedAt ? `마지막 정리 ${options.generatedAt}` : "회의 정리가 준비됐습니다.");
    } else if (isHydratingDetail) {
      pushStep("회의 정리", "pending", "상세 기록이 준비되면 이어서 확인합니다.");
    } else if (options.hasSegmentContent) {
      pushStep("회의 정리", isBusy ? "current" : "warning", isBusy ? "전사를 바탕으로 회의 정리를 만드는 중입니다." : normalizeText(options.degradedReason) || "전사 결과를 바탕으로 회의 정리를 확인할 수 있습니다.", isBusy ? "진행" : "보완");
    } else {
      pushStep("회의 정리", isBusy ? "current" : "pending", "전사 확보 후 생성됩니다.");
    }

    if (isFailed) {
      pushStep("검토 마무리", "failed", "오류를 정리한 뒤 다시 확인합니다.");
    } else if (options.hasNotesValue && options.hasSegmentContent) {
      pushStep("검토 마무리", "done", "복사 · 다운로드 · 제목 수정");
    } else if (isHydratingDetail) {
      pushStep("검토 마무리", "pending", "상세 기록을 불러온 뒤 검토합니다.");
    } else if (options.hasSegmentContent) {
      pushStep("검토 마무리", "current", "원문부터 확인할 수 있습니다.", "검토");
    } else {
      pushStep("검토 마무리", "pending", "결과가 준비되면 검토합니다.");
    }

    if (recordSelected && !["idle", "succeeded"].includes(normalizedStatus)) pushFact("현재 상태", detailView.badgeLabel);
    if (segmentCount > 0) pushFact("원문", `${segmentCount}개`);
    pushFact("품질 주의", options.degradedReason);
    pushFact("마지막 정리", options.generatedAt);

    const focusIndex = steps.findIndex((step) => step.state !== "done");
    return {
      facts,
      steps: steps.map((step, index) => ({ ...step, isFocus: focusIndex >= 0 ? index === focusIndex : index === steps.length - 1 })),
    };
  }

  function renderStatusFlow(model) {
    if (!model || !Array.isArray(model.steps) || !model.steps.length) return "";
    return `
      <div class="summary-flow-board">
        <div class="summary-journey" role="list">
          ${model.steps.map((step, index) => `
            <article class="summary-journey-step" data-tone="${escapeHtml(step.state)}" data-focus="${step.isFocus ? "true" : "false"}" role="listitem">
              <div class="summary-journey-step__rail">
                <span class="summary-journey-step__index">${index + 1}</span>
                ${index < model.steps.length - 1 ? '<span class="summary-journey-step__line" aria-hidden="true"></span>' : ""}
              </div>
              ${step.stateLabel ? `<span class="summary-journey-step__state">${escapeHtml(step.stateLabel)}</span>` : ""}
              <strong class="summary-journey-step__title">${escapeHtml(step.title)}</strong>
              <span class="summary-journey-step__detail">${escapeHtml(step.detail)}</span>
            </article>
          `).join("")}
        </div>
        ${model.facts.length
          ? `<div class="summary-flow-facts">${model.facts.map((fact) => `<span class="summary-flow-fact"><span class="summary-flow-fact__label">${escapeHtml(fact.label)}</span><strong class="summary-flow-fact__value">${escapeHtml(fact.value)}</strong></span>`).join("")}</div>`
          : ""}
      </div>
    `;
  }

  function buildStatusActionMessage(detailView, options = {}) {
    const normalizedStatus = normalizeText(detailView.badgeStatus);
    if (!normalizeText(detailView.recordTitle) && detailView.badgeStatus === "idle") {
      return "";
    }
    if (options.isHydratingDetail) {
      return normalizeText(detailView.notice) || "상세 기록을 불러오는 중입니다.";
    }
    if (["queued", "processing"].includes(normalizedStatus)) {
      return "";
    }
    if (normalizedStatus === "failed") {
      return "오류가 있어 다시 시도하거나 삭제 후 새로 만들 수 있습니다.";
    }
    if (!options.hasSegmentContent) {
      return detailView.notice;
    }
    if (!options.hasNotesValue) {
      return normalizeText(detailView.notesMeta?.degradedReason) || "전사를 기준으로 회의 정리를 다시 만들 수 있습니다.";
    }
    return "";
  }

  function renderLocalActionButton(action, requestId, label, tone) {
    const toneClass = tone === "danger" ? " mini-button--danger" : tone === "accent" ? " mini-button--accent" : "";
    return `<button type="button" class="mini-button${toneClass}" data-local-action="${escapeHtml(action)}" data-request-id="${escapeHtml(requestId)}">${escapeHtml(label)}</button>`;
  }

  function buildPendingActions(pending, remote, options = {}) {
    if (!pending) return "";
    if (options.readOnly) return "";
    const buttons = [];
    const processingHealth = getProcessingHealth(remote, pending);
    if (pending.status === "remote_processing" && processingHealth.isStalled) {
      buttons.push(renderLocalActionButton("restart", pending.requestId, "다시 처리", "accent"));
    } else if (pending.status === "on_hold") {
      buttons.push(renderLocalActionButton("resume", pending.requestId, "업로드 재개", "accent"));
    } else if (["local_saved", "upload_queued", "failed"].includes(pending.status)) {
      const retryLabel = pending.status === "failed" ? "다시 처리" : "지금 업로드";
      buttons.push(renderLocalActionButton("retry", pending.requestId, retryLabel, "accent"), renderLocalActionButton("hold", pending.requestId, "보류", ""));
    }
    return buttons.length ? `<div class="record-item__actions">${buttons.join("")}</div>` : "";
  }

  function buildDetailView(state, activeEntry) {
    if (!activeEntry) {
      return { badgeLabel: "대기", badgeStatus: "idle", chunkProgress: null, isHydratingDetail: false, meta: [], meetingNotes: null, notesInputSnapshot: normalizeNotesInputSnapshot(null), notesMeta: null, notice: "왼쪽에서 기록을 선택해 주세요.", noticeTone: "", recordMemo: "", recordTitle: "", segments: [], showRecordActions: false, summary: "", title: "기록을 선택해 주세요", transcriptText: "" };
    }
    const pending = activeEntry.pending;
    const remote = activeEntry.remote;
    const pendingDisplayStatus = getPendingDisplayStatus(pending);
    const shouldUsePendingDetail = Boolean(pending) && (!remote?.jobId || shouldPrioritizePendingUpload(pending));
    const detailTitle = normalizeText(state.currentJob?.title || remote?.title || pending?.meetingTitleSnapshot || state.meeting.title || "새 기록");
    const detailMeta = [];
    const remoteStatus = normalizeText(state.currentJob?.status || remote?.status);
    const processingHealth = getProcessingHealth(state.currentJob || remote, pending);
    const canManageRemoteRecord = Boolean(remote?.jobId) && !["queued", "processing"].includes(remoteStatus);
    const showRecordActions = Boolean((pending?.requestId && !remote?.jobId) || canManageRemoteRecord);
    const detailMemo = normalizeTextBlock(state.currentJob?.sharedMemoSnapshot || pending?.sharedMemoSnapshot);
    const remoteNotesInputSnapshot = normalizeNotesInputSnapshot(remote?.notesInputSnapshot, {
      sharedMemo: normalizeTextBlock(remote?.sharedMemoSnapshot),
      updatedAt: normalizeText(remote?.notesGeneratedAt || remote?.updatedAt),
    });
    const pendingChunkProgress = buildChunkProgressModel(null, pending);

    if (shouldUsePendingDetail) {
      return { badgeLabel: formatStatusLabel(pendingDisplayStatus), badgeStatus: normalizeStatus(pendingDisplayStatus), chunkProgress: pendingChunkProgress, isHydratingDetail: false, meta: detailMeta, meetingNotes: null, notesInputSnapshot: remoteNotesInputSnapshot, notesMeta: null, notice: buildPendingNotice(pending), noticeTone: pendingDisplayStatus === "failed" ? "error" : "highlight", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions, summary: "", title: detailTitle, transcriptText: "" };
    }

    const normalizedJob = state.currentJob || normalizeJob(remote, detailTitle);
    const normalizedArtifact = state.currentArtifact;
    const isHydratingDetail = Boolean(
      state.selectedDetailHydrating
      && normalizeText(state.currentDetailSelectionId) === normalizeText(activeEntry.id)
      && !normalizedArtifact
      && TERMINAL_REMOTE_STATUSES.has(normalizeText(normalizedJob?.status || remote?.status))
    );
    const workspaceMutation = normalizedJob?.workspaceMutation || remote?.workspaceMutation;
    const meetingNotes = normalizeMeetingNotes(normalizedArtifact?.notes || normalizedJob?.meetingNotes);
    const rawSegments = Array.isArray(normalizedArtifact?.segments) ? normalizedArtifact.segments : [];
    const segments = resegmentSegmentsForDisplay(rawSegments);
    const transcriptText = buildTranscriptTextForDisplay(segments, normalizedArtifact?.text);
    const hasNotesValue = hasMeetingNotes(meetingNotes);
    const hasTranscriptValue = Boolean(transcriptText);
    const hasSegmentsValue = segments.length > 0;
    const notesMeta = {
      degradedReason: normalizeText(normalizedArtifact?.notesDegradedReason || normalizedJob?.notesDegradedReason),
      generatedAt: normalizeText(normalizedArtifact?.notesGeneratedAt || normalizedJob?.notesGeneratedAt),
      status: normalizeText(normalizedArtifact?.notesStatus || normalizedJob?.notesStatus),
    };
    const notesInputSnapshot = normalizeNotesInputSnapshot(
      normalizedArtifact?.notesInputSnapshot?.updatedAt
        ? normalizedArtifact.notesInputSnapshot
        : normalizedJob?.notesInputSnapshot,
      {
        sharedMemo: detailMemo,
        updatedAt: normalizeText(normalizedArtifact?.notesGeneratedAt || normalizedJob?.notesGeneratedAt || normalizedJob?.updatedAt),
      }
    );
    const remoteChunkProgress = buildChunkProgressModel(normalizedJob, pending);

    if (isHydratingDetail) {
      return {
        badgeLabel: "불러오는 중",
        badgeStatus: "processing",
        chunkProgress: null,
        isHydratingDetail: true,
        meta: detailMeta,
        meetingNotes: null,
        notesInputSnapshot,
        notesMeta,
        notice: "상세 기록을 불러오는 중입니다.",
        noticeTone: "highlight",
        recordMemo: detailMemo,
        recordTitle: detailTitle,
        segments: [],
        showRecordActions: false,
        summary: "",
        title: detailTitle,
        transcriptText: "",
      };
    }

    if (normalizeText(normalizedJob?.status) === "failed") {
      return { badgeLabel: "오류", badgeStatus: "failed", chunkProgress: remoteChunkProgress, isHydratingDetail: false, meta: detailMeta, meetingNotes: null, notesInputSnapshot, notesMeta, notice: normalizeText(normalizedJob?.error || pending?.lastError) || "회의 처리 중 오류가 발생했습니다.", noticeTone: "error", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions, summary: "", title: detailTitle, transcriptText: "" };
    }
    if (["queued", "processing"].includes(normalizeText(normalizedJob?.status))) {
      return { badgeLabel: processingHealth.isStalled ? "정체 의심" : formatStatusLabel(normalizedJob.status), badgeStatus: normalizeStatus(normalizedJob.status), chunkProgress: remoteChunkProgress, isHydratingDetail: false, meta: detailMeta, meetingNotes: null, notesInputSnapshot, notesMeta, notice: buildProcessingNotice(normalizedJob, pending), noticeTone: processingHealth.isStalled ? "warning" : "highlight", recordMemo: detailMemo, recordTitle: detailTitle, segments: [], showRecordActions: false, summary: "", title: detailTitle, transcriptText: "" };
    }
    let completionNotice = state.notice.text || "회의 정리가 준비됐습니다.";
    let completionTone = state.notice.tone || "highlight";
    if (workspaceMutation?.type === "applySectionEdit" && ["queued", "processing"].includes(workspaceMutation.status)) {
      completionNotice = "선택한 섹션을 적용하는 중입니다. 완료 여부는 실시간 상태로 반영됩니다.";
      completionTone = "highlight";
    } else if (workspaceMutation?.type === "applySectionEdit" && workspaceMutation.status === "failed") {
      completionNotice = workspaceMutation.error || "섹션 수정을 완료하지 못했어요.";
      completionTone = "error";
    } else if (!hasNotesValue && !hasTranscriptValue && !hasSegmentsValue) {
      completionNotice = notesMeta.degradedReason || "녹음이 너무 짧거나 인식된 발화가 부족해 표시할 내용이 없습니다.";
      completionTone = "warning";
    } else if (!hasNotesValue && (hasTranscriptValue || hasSegmentsValue) && !state.notice.text) {
      completionNotice = notesMeta.degradedReason || "전사는 준비됐지만 회의 정리로 묶을 내용은 충분하지 않았습니다.";
      completionTone = "warning";
    }
    return {
      badgeLabel: "완료",
      badgeStatus: "succeeded",
      chunkProgress: null,
      isHydratingDetail: false,
      meta: detailMeta,
      meetingNotes,
      notesInputSnapshot,
      notesMeta,
      notice: completionNotice,
      noticeTone: completionTone,
      recordMemo: detailMemo,
      recordTitle: detailTitle,
      segments,
      showRecordActions,
      summary: "",
      title: detailTitle,
      transcriptText,
    };
  }

  function splitSegmentParagraphs(text) {
    const normalized = ns.shared.normalizeTextBlock(text).replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }
    const sentences = normalized.match(/[^.!?。！？…]+(?:[.!?。！？…]+|$)/g) || [normalized];
    const paragraphs = [];
    let current = [];
    let currentLength = 0;
    for (const sentence of sentences) {
      const normalizedSentence = normalizeText(sentence);
      if (!normalizedSentence) {
        continue;
      }
      const nextLength = current.length ? currentLength + normalizedSentence.length + 1 : normalizedSentence.length;
      if (current.length && nextLength > 180) {
        paragraphs.push(current.join(" "));
        current = [normalizedSentence];
        currentLength = normalizedSentence.length;
        continue;
      }
      current.push(normalizedSentence);
      currentLength = nextLength;
    }
    if (current.length) {
      paragraphs.push(current.join(" "));
    }
    return paragraphs.length ? paragraphs : [normalized];
  }

  function renderSegment(segment, index) {
    const paragraphs = splitSegmentParagraphs(segment.text);
    const label = Number.isFinite(index) ? `원문 ${index + 1}` : "";
    return `<article class="segment-item"><div class="segment-item__head"><span>${escapeHtml(formatSegmentRange(segment.startMs, segment.endMs))}</span>${label ? `<span class="segment-item__index">${escapeHtml(label)}</span>` : ""}</div><div class="segment-item__body">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div></article>`;
  }

  function renderTranscriptFallback(transcriptText) {
    return `<div class="transcript-box">${escapeHtml(transcriptText)}</div>`;
  }

  function renderHistoryEntry(entry, selectedRecordId, options = {}) {
    const title = normalizeText(entry.remote?.title || entry.pending?.meetingTitleSnapshot || "새 기록");
    const pendingSummary = entry.pending?.status === "succeeded" ? "" : buildPendingSummary(entry.pending);
    const pendingNotice = entry.pending?.status === "succeeded" ? "" : buildPendingNotice(entry.pending);
    const meta = [formatDateTime(entry.updatedAt || entry.createdAt, ""), entry.durationMs > 0 ? formatDuration(entry.durationMs) : "", entry.pending?.sizeBytes > 0 ? formatBytes(entry.pending.sizeBytes) : ""].filter(Boolean).join(" · ");
    const chips = [];
    if (pendingSummary) chips.push({ label: pendingSummary, tone: "muted" });
    return `
      <button type="button" class="record-item${entry.id === selectedRecordId ? " is-active" : ""}" data-record-id="${escapeHtml(entry.id)}">
        <div class="record-item__top">
          <div>
            <strong class="record-item__title">${escapeHtml(title)}</strong>
            ${meta ? `<div class="record-item__meta">${escapeHtml(meta)}</div>` : ""}
          </div>
          <span class="status-pill status-pill--soft" data-status="${escapeHtml(normalizeStatus(entry.status))}">${escapeHtml(formatStatusLabel(entry.status))}</span>
        </div>
        ${chips.length ? `<div class="record-item__chips">${chips.map((chip) => `<span class="chip${chip.tone === "accent" ? " chip--accent" : ""}">${escapeHtml(chip.label)}</span>`).join("")}</div>` : ""}
        ${pendingNotice ? `<div class="record-item__local">${escapeHtml(pendingNotice)}</div>` : ""}
      </button>
      ${buildPendingActions(entry.pending, entry.remote, options)}
    `;
  }

  function renderMeetingNotes(refs, detailView, state) {
    const normalized = normalizeMeetingNotes(detailView.meetingNotes);
    const hasNotesValue = hasMeetingNotes(normalized);
    if (!hasNotesValue) {
      refs.meetingNotesOverview.hidden = true;
      refs.meetingNotesOverview.innerHTML = "";
      refs.meetingNotesSections.innerHTML = `<div class="notice-box" data-tone="warning">${escapeHtml(normalizeText(detailView.notesMeta?.degradedReason) || "전사는 준비됐지만 회의 정리로 묶을 내용이 충분하지 않았습니다.")}</div>`;
      return false;
    }
    const overviewMarkup = renderNotesOverview(normalized);
    const allowSectionEdit = Boolean(
      !state.auth?.readOnly
      && normalizeText(detailView.badgeStatus) === "succeeded"
    );
    refs.meetingNotesOverview.hidden = !overviewMarkup;
    refs.meetingNotesOverview.innerHTML = overviewMarkup;
    refs.meetingNotesSections.innerHTML = buildMeetingNotesSections(normalized)
      .map((section) => renderNotesSection(section, { allowSectionEdit }))
      .join("");
    return true;
  }

  function resolveReviewTab(state, detailView, hasNotesValue, options = {}) {
    const isCompleted = normalizeText(detailView.badgeStatus) === "succeeded";
    const hasMemoValue = Boolean(normalizeText(detailView.recordMemo));
    const hasTranscriptValue = Boolean(normalizeText(detailView.transcriptText));
    const hasSegmentsValue = Array.isArray(detailView.segments) && detailView.segments.length > 0;
    const hasSegmentContent = hasSegmentsValue || hasTranscriptValue;
    const showSummaryTab = options.showSummaryTab !== false && !isCompleted;
    const showMemoTab = isCompleted || hasMemoValue;
    const showNotesTab = isCompleted || hasNotesValue;
    const fallbackTab = () => {
      if (showNotesTab) return "notes";
      if (showMemoTab) return "memo";
      if (hasSegmentContent) return "segments";
      return showSummaryTab ? "summary" : "notes";
    };
    let nextTab = normalizeText(state.reviewTab) || "notes";
    if (nextTab === "transcript") {
      nextTab = "segments";
    }
    if (!["summary", "memo", "notes", "segments"].includes(nextTab)) {
      nextTab = "notes";
    }
    if (!showSummaryTab && nextTab === "summary") {
      nextTab = fallbackTab();
    }
    if (!detailView.showRecordActions && !showMemoTab && !hasSegmentContent && !showNotesTab) {
      return showSummaryTab ? "summary" : "notes";
    }
    if (nextTab === "memo" && !showMemoTab) {
      return fallbackTab();
    }
    if (nextTab === "notes" && !showNotesTab) {
      return showMemoTab ? "memo" : hasSegmentContent ? "segments" : showSummaryTab ? "summary" : "notes";
    }
    if (nextTab === "segments" && !hasSegmentContent) {
      return showNotesTab ? "notes" : showMemoTab ? "memo" : showSummaryTab ? "summary" : "notes";
    }
    return nextTab;
  }

  function applyReviewTabState(refs, activeTab) {
    const tabMap = {
      memo: refs.reviewTabMemo,
      notes: refs.reviewTabNotes,
      segments: refs.reviewTabSegments,
      summary: refs.reviewTabSummary,
    };
    for (const [tabName, element] of Object.entries(tabMap)) {
      if (!element) continue;
      const selected = tabName === activeTab;
      element.classList.toggle("is-active", selected);
      element.setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function renderWorkspace(state, refs) {
    const historyEntries = buildHistoryEntries(state);
    const workspaceView = buildWorkspaceView(state, historyEntries);
    const recorderView = buildRecorderView(state);
    const activeEntry = findHistoryEntry(state, state.selectedRecordId);
    const detailView = buildDetailView(state, activeEntry);
    const meetingBusy = state.busy.saveMeetingTitle || state.busy.saveMeetingMemo || state.busy.deleteMeeting;
    const savedMeetingTitle = normalizeText(state.meeting.title || state.session.title);
    const draftMeetingTitle = normalizeText(global.document.activeElement === refs.meetingTitleInput ? refs.meetingTitleInput.value : state.meetingTitleDraft || refs.meetingTitleInput?.value);
    const meetingTitleDirty = Boolean(draftMeetingTitle && draftMeetingTitle !== savedMeetingTitle);
    const savedRecordMemo = ns.shared.normalizeTextBlock(state.recordMemoSaved);
    const draftRecordMemo = ns.shared.normalizeTextBlock(global.document.activeElement === refs.sharedMemoInput ? refs.sharedMemoInput.value : state.recordMemoDraft);
    const recordMemoDirty = draftRecordMemo !== savedRecordMemo;
    const remoteRecordLocked = Boolean(activeEntry?.remote?.jobId) && ["queued", "processing"].includes(normalizeText(activeEntry?.remote?.status));
    const canRenameSelectedRecord = activeEntry?.remote?.jobId ? !remoteRecordLocked : Boolean(activeEntry?.pending?.requestId);
    const canDownloadSelectedRecord = Boolean(activeEntry?.pending?.requestId && Number(activeEntry?.pending?.blob?.size || activeEntry?.pending?.sizeBytes) > 0);
    const canDeleteSelectedRecord = activeEntry?.remote?.jobId ? !remoteRecordLocked : Boolean(activeEntry?.pending?.requestId);
    const savedRecordTitle = normalizeText(detailView.recordTitle);
    const draftRecordTitle = normalizeText(global.document.activeElement === refs.recordTitleInput ? refs.recordTitleInput.value : savedRecordTitle || refs.recordTitleInput?.value);
    const recordTitleDirty = Boolean(draftRecordTitle && draftRecordTitle !== savedRecordTitle);
    const selectedRecordMutationBusy = state.busy.deleteRecord
      || state.busy.applySectionEdit
      || state.busy.previewSectionEdit
      || state.busy.saveRecordMemo
      || state.busy.saveRecordTitle;
    const readOnly = Boolean(state.auth?.readOnly);
    const currentTimerText = formatCaptureTimer(state.capture.durationMs);
    const savedSelectedRecordMemo = ns.shared.normalizeTextBlock(state.selectedRecordMemo?.saved || detailView.recordMemo);
    const draftSelectedRecordMemo = ns.shared.normalizeTextBlock(
      global.document.activeElement === refs.detailMemoInput
        ? refs.detailMemoInput.value
        : state.selectedRecordMemo?.draft ?? detailView.recordMemo
    );
    const selectedRecordMemoDirty = draftSelectedRecordMemo !== savedSelectedRecordMemo;
    refs.pageTitle.hidden = true;
    refs.pageTitle.textContent = savedMeetingTitle || "새 회의 룸";
    refs.pageSummary.hidden = !normalizeText(workspaceView.pageSummary);
    refs.pageSummary.textContent = workspaceView.pageSummary;
    refs.workspaceBadge.textContent = workspaceView.badgeLabel;
    refs.workspaceBadge.dataset.status = workspaceView.badgeStatus;
    refs.offlineQueueBadge.textContent = `로컬 보관 ${state.pendingUploads.length}건`;
    refs.meetingStatusChip.textContent = workspaceView.meetingStatus;
    if (refs.refreshButton) {
      refs.refreshButton.disabled = state.loading;
      refs.refreshButton.textContent = state.loadingReason === "manual" ? "동기화 중" : "새로고침";
    }
    if (global.document.activeElement !== refs.meetingTitleInput) refs.meetingTitleInput.value = normalizeText(state.meetingTitleDraft || savedMeetingTitle);
    refs.meetingTitleInput.disabled = readOnly || meetingBusy;
    refs.saveMeetingTitleButton.disabled = readOnly || meetingBusy || !draftMeetingTitle || !meetingTitleDirty;
    refs.saveMeetingTitleButton.hidden = readOnly;
    refs.saveMeetingTitleButton.textContent = state.busy.saveMeetingTitle ? "저장 중" : meetingTitleDirty ? "이름 저장" : "저장됨";
    refs.deleteMeetingButton.disabled = readOnly || meetingBusy || ["recording", "paused", "stopping"].includes(state.capture.status);
    refs.deleteMeetingButton.hidden = readOnly;

    refs.currentBadge.textContent = recorderView.badgeLabel;
    refs.currentBadge.dataset.status = recorderView.badgeStatus;
    refs.currentSummary.hidden = !normalizeText(recorderView.summary);
    refs.currentSummary.textContent = recorderView.summary;
    refs.currentHint.hidden = !normalizeText(recorderView.hint);
    refs.currentHint.textContent = recorderView.hint;
    refs.currentTimer.textContent = currentTimerText;
    refs.currentNotice.hidden = !state.notice.text;
    refs.currentNotice.textContent = state.notice.text;
    refs.currentNotice.dataset.tone = state.notice.tone || "";
    refs.startButton.hidden = !recorderView.showStart;
    refs.importAudioButton.hidden = !recorderView.showStart;
    refs.pauseButton.hidden = !recorderView.showPause;
    refs.resumeButton.hidden = !recorderView.showResume;
    refs.stopButton.hidden = !recorderView.showStop;
    refs.discardButton.hidden = !recorderView.showDiscard;
    refs.startButton.disabled = !recorderView.canStart;
    refs.importAudioButton.disabled = !recorderView.canStart;
    refs.pauseButton.disabled = !recorderView.canPause;
    refs.resumeButton.disabled = !recorderView.canResume;
    refs.stopButton.disabled = !recorderView.canStop;
    refs.discardButton.disabled = !recorderView.canDiscard;

    if (global.document.activeElement !== refs.sharedMemoInput) refs.sharedMemoInput.value = draftRecordMemo;
    refs.sharedMemoInput.disabled = readOnly;
    refs.saveSharedMemoButton.disabled = true;
    refs.saveSharedMemoButton.hidden = readOnly;
    refs.saveSharedMemoButton.textContent = draftRecordMemo ? "자동 보관됨" : "자동 보관";
    refs.clearSharedMemoButton.disabled = readOnly || state.busy.saveMeetingMemo || !draftRecordMemo;
    refs.clearSharedMemoButton.hidden = readOnly;
    refs.sharedMemoNotice.hidden = true;
    refs.recordCountBadge.textContent = `${historyEntries.length}건`;
    refs.recordList.innerHTML = historyEntries.length ? historyEntries.map((entry) => renderHistoryEntry(entry, state.selectedRecordId, { readOnly })).join("") : `<div class="notice-box">아직 기록이 없습니다.</div>`;

    refs.detailTitle.hidden = detailView.showRecordActions;
    refs.detailTitle.textContent = detailView.title;
    const showDetailBadge = Boolean(detailView.badgeLabel) && ["failed"].includes(normalizeText(detailView.badgeStatus));
    refs.detailBadge.hidden = !showDetailBadge;
    if (showDetailBadge) {
      refs.detailBadge.textContent = detailView.badgeLabel;
      refs.detailBadge.dataset.status = detailView.badgeStatus;
    }
    refs.detailSummary.hidden = !normalizeText(detailView.summary);
    refs.detailSummary.textContent = detailView.summary;
    refs.recordTitleGroup.hidden = !detailView.showRecordActions;
    if (global.document.activeElement !== refs.recordTitleInput) refs.recordTitleInput.value = detailView.recordTitle;
    refs.recordTitleInput.disabled = readOnly || !canRenameSelectedRecord || selectedRecordMutationBusy;
    refs.saveRecordTitleButton.disabled = readOnly || !canRenameSelectedRecord || selectedRecordMutationBusy || !draftRecordTitle || !recordTitleDirty;
    refs.saveRecordTitleButton.hidden = readOnly;
    refs.saveRecordTitleButton.textContent = state.busy.saveRecordTitle ? "저장 중" : recordTitleDirty ? "이름 저장" : "저장됨";
    refs.downloadRecordButton.hidden = readOnly || !canDownloadSelectedRecord;
    refs.downloadRecordButton.disabled = readOnly || !canDownloadSelectedRecord;
    refs.deleteRecordButton.disabled = readOnly || !canDeleteSelectedRecord || selectedRecordMutationBusy;
    refs.deleteRecordButton.hidden = readOnly;
    refs.detailMeta.hidden = !detailView.meta.length;
    refs.detailMeta.innerHTML = detailView.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("");

    const hasNotesValue = renderMeetingNotes(refs, detailView, state);
    const isCompletedRecord = normalizeText(detailView.badgeStatus) === "succeeded";
    const hasMemoValue = Boolean(normalizeText(detailView.recordMemo));
    const hasTranscriptValue = Boolean(normalizeText(detailView.transcriptText));
    const hasSegmentsValue = Array.isArray(detailView.segments) && detailView.segments.length > 0;
    const hasSegmentContent = hasSegmentsValue || hasTranscriptValue;
    const showSummaryReviewTab = !isCompletedRecord;
    const showMemoReviewTab = isCompletedRecord || hasMemoValue;
    const showNotesReviewTab = isCompletedRecord || hasNotesValue;
    const activeReviewTab = resolveReviewTab(state, detailView, hasNotesValue, { showSummaryTab: showSummaryReviewTab });
    state.reviewTab = activeReviewTab;
    refs.reviewTabSummary.hidden = !showSummaryReviewTab;
    refs.reviewTabMemo.hidden = !showMemoReviewTab;
    refs.reviewTabNotes.hidden = !showNotesReviewTab;
    refs.reviewTabSegments.hidden = !hasSegmentContent;
    refs.reviewTabSegmentsCount.hidden = !hasSegmentsValue;
    refs.reviewTabSegmentsCount.textContent = hasSegmentsValue ? `${detailView.segments.length}` : "";
    applyReviewTabState(refs, activeReviewTab);
    refs.reviewSectionHeader.hidden = activeReviewTab !== "summary" || !showSummaryReviewTab;
    refs.reviewTabActions.hidden = !isCompletedRecord;
    refs.copyMeetingNotesButton.hidden = !isCompletedRecord || activeReviewTab !== "notes";
    refs.copyMeetingNotesButton.disabled = !hasNotesValue;
    const summaryFlow = buildStatusFlow(detailView, {
      generatedAt: detailView.notesMeta?.generatedAt ? formatDateTime(detailView.notesMeta.generatedAt, "") : "",
      isHydratingDetail: Boolean(detailView.isHydratingDetail),
      hasNotesValue,
      hasSegmentContent,
      segmentCount: hasSegmentsValue ? detailView.segments.length : 0,
      degradedReason: normalizeText(detailView.notesMeta?.degradedReason),
    });
    const showSummaryStatusPill = activeReviewTab === "summary"
      && Boolean(detailView.badgeLabel)
      && !["idle", "succeeded"].includes(normalizeText(detailView.badgeStatus));
    refs.summaryStatusPill.hidden = !showSummaryStatusPill;
    if (showSummaryStatusPill) {
      refs.summaryStatusPill.textContent = detailView.badgeLabel;
      refs.summaryStatusPill.dataset.status = detailView.badgeStatus;
    }
    refs.reviewSegmentsToolbar.hidden = activeReviewTab !== "segments" || !hasSegmentContent;
    refs.copySegmentsButton.hidden = activeReviewTab !== "segments" || !hasSegmentContent;
    refs.copySegmentsButton.disabled = activeReviewTab !== "segments" || !hasSegmentContent;
    refs.summaryStatusGrid.hidden = !summaryFlow.steps.length;
    refs.summaryStatusGrid.innerHTML = renderStatusFlow(summaryFlow);
    const summaryActionMessage = buildStatusActionMessage(detailView, {
      hasNotesValue,
      hasSegmentContent,
      isHydratingDetail: Boolean(detailView.isHydratingDetail),
      updatedAt: formatDateTime(
        normalizeText(state.currentJob?.updatedAt || activeEntry?.remote?.updatedAt || activeEntry?.pending?.updatedAt),
        ""
      ),
    });
    const summaryActionHtml = buildSummaryActionCardHtml(detailView, summaryActionMessage);
    refs.summaryActionCard.hidden = !summaryActionHtml;
    refs.summaryActionCard.innerHTML = summaryActionHtml;
    const suppressProgressNotice = Boolean(detailView.chunkProgress)
      && !detailView.chunkProgress?.isStalled
      && ["queued", "processing", "uploading", "uploading_chunks", "preparing_chunks", "remote_queued", "remote_processing"].includes(normalizeText(detailView.badgeStatus));
    const showSummaryNotice = !suppressProgressNotice
      && Boolean(detailView.notice)
      && (detailView.badgeStatus !== "succeeded" || ["error", "warning"].includes(detailView.noticeTone));
    refs.detailNotice.hidden = !showSummaryNotice;
    refs.detailNotice.textContent = detailView.notice;
    refs.detailNotice.dataset.tone = showSummaryNotice ? detailView.noticeTone : "";
    refs.reviewPanelSummary.hidden = activeReviewTab !== "summary" || !showSummaryReviewTab;
    refs.reviewPanelMemo.hidden = activeReviewTab !== "memo" || !showMemoReviewTab;
    refs.meetingNotesCard.hidden = activeReviewTab !== "notes" || !showNotesReviewTab;
    refs.reviewPanelSegments.hidden = activeReviewTab !== "segments" || !hasSegmentContent;
    if (refs.detailMemoInput && global.document.activeElement !== refs.detailMemoInput) {
      refs.detailMemoInput.value = draftSelectedRecordMemo;
    }
    if (refs.detailMemoInput) {
      refs.detailMemoInput.disabled = readOnly || !isCompletedRecord || selectedRecordMutationBusy;
    }
    refs.saveRecordMemoButton.disabled = readOnly || !isCompletedRecord
      || !selectedRecordMemoDirty
      || selectedRecordMutationBusy;
    refs.saveRecordMemoButton.hidden = readOnly;
    refs.saveRecordMemoButton.textContent = state.busy.saveRecordMemo
      ? "저장 중"
      : selectedRecordMemoDirty
        ? "저장"
        : "저장됨";
    refs.segmentList.hidden = !hasSegmentContent;
    refs.segmentList.innerHTML = !hasSegmentContent
      ? ""
      : hasSegmentsValue
        ? detailView.segments.map((segment, index) => renderSegment(segment, index)).join("")
        : renderTranscriptFallback(detailView.transcriptText);
    return { activeEntry, historyEntries };
  }

  ns.render = {
    buildDetailView,
    buildMeetingNotesCopyText,
    buildSegmentCopyText,
    TERMINAL_REMOTE_STATUSES,
    buildRecorderView,
    buildHistoryEntries,
    buildWorkspaceView,
    buildLocalPendingJob,
    buildMeetingNotesSectionPreview,
    buildMeetingNotesSections,
    buildPendingActions,
    buildPendingNotice,
    buildPendingSummary,
    buildProcessingNotice,
    chooseSelectedRecordId,
    comparePendingUploads,
    findHistoryEntry,
    findRemoteForPending,
    getMeetingNotesSectionLabel,
    normalizeArtifact,
    normalizeJob,
    normalizeRecord,
    normalizeWorkspaceMutation,
    renderWorkspace,
    renderNotesSection,
  };
})(globalThis);
