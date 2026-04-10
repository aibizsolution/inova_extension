function createMeetingTranscriptDomain(deps) {
  const {
    limits,
    normalizeText,
    normalizeTextBlock,
    normalizeTranscriptSegment,
  } = deps;
  const {
    MAX_MEETING_NOTES_SECTION_CHARS,
    MAX_MEETING_NOTES_SECTION_COUNT,
    MAX_REVIEW_SEGMENT_CHARS,
    MAX_REVIEW_SEGMENT_DURATION_MS,
    MAX_SUMMARY_TRANSCRIPT_CHARS,
    MIN_REVIEW_SEGMENT_CHARS,
    MIN_REVIEW_SEGMENT_DURATION_MS,
    TARGET_REVIEW_SEGMENT_CHARS,
    TARGET_REVIEW_SEGMENT_DURATION_MS,
  } = limits;

  function buildTranscriptText(segments) {
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => normalizeText(segment.text))
      .filter(Boolean)
      .join(" ");
  }

  function splitTranscriptTextIntoReviewPieces(text) {
    const normalized = normalizeTextBlock(text).replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }
    const paragraphs = normalized
      .split("\n")
      .map((part) => normalizeText(part))
      .filter(Boolean);
    const pieces = [];
    for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
      const sentenceMatches = paragraph.match(/[^.!?。！？…]+(?:[.!?。！？…]+|$)/g) || [paragraph];
      for (const sentence of sentenceMatches) {
        const normalizedSentence = normalizeText(sentence);
        if (!normalizedSentence) {
          continue;
        }
        if (normalizedSentence.length <= MAX_REVIEW_SEGMENT_CHARS) {
          pieces.push(normalizedSentence);
          continue;
        }
        const words = normalizedSentence.split(/\s+/).filter(Boolean);
        if (words.length <= 1) {
          for (let index = 0; index < normalizedSentence.length; index += TARGET_REVIEW_SEGMENT_CHARS) {
            pieces.push(normalizeText(normalizedSentence.slice(index, index + TARGET_REVIEW_SEGMENT_CHARS)));
          }
          continue;
        }
        let currentWords = [];
        let currentLength = 0;
        for (const word of words) {
          const nextLength = currentWords.length ? currentLength + word.length + 1 : word.length;
          if (currentWords.length && nextLength > TARGET_REVIEW_SEGMENT_CHARS) {
            pieces.push(currentWords.join(" "));
            currentWords = [word];
            currentLength = word.length;
            continue;
          }
          currentWords.push(word);
          currentLength = nextLength;
        }
        if (currentWords.length) {
          pieces.push(currentWords.join(" "));
        }
      }
    }
    return pieces.filter(Boolean);
  }

  function buildTimedTranscriptReviewUnits(segments) {
    const units = [];
    for (const segment of Array.isArray(segments) ? segments : []) {
      const normalizedSegment = normalizeTranscriptSegment(segment);
      const text = normalizeText(normalizedSegment.text);
      if (!text) {
        continue;
      }
      const durationMs = Math.max(1, normalizedSegment.endMs - normalizedSegment.startMs);
      const pieces = splitTranscriptTextIntoReviewPieces(text);
      if (pieces.length <= 1) {
        units.push(normalizedSegment);
        continue;
      }
      const totalChars = Math.max(1, pieces.reduce((sum, piece) => sum + piece.length, 0));
      let cursorMs = normalizedSegment.startMs;
      pieces.forEach((piece, index) => {
        const remainingDurationMs = Math.max(1, normalizedSegment.endMs - cursorMs);
        const pieceDurationMs = index === pieces.length - 1
          ? remainingDurationMs
          : Math.max(1, Math.round(durationMs * (piece.length / totalChars)));
        const nextEndMs = index === pieces.length - 1
          ? normalizedSegment.endMs
          : Math.min(normalizedSegment.endMs, Math.max(cursorMs + 1, cursorMs + pieceDurationMs));
        units.push({
          endMs: nextEndMs,
          startMs: cursorMs,
          text: piece,
        });
        cursorMs = nextEndMs;
      });
    }
    return units;
  }

  function shouldMergeReviewSegments(current, next) {
    if (!current || !next) {
      return false;
    }
    const gapMs = Math.max(0, Number(next.startMs) - Number(current.endMs));
    if (gapMs > 2500) {
      return false;
    }
    const currentDurationMs = Math.max(1, Number(current.endMs) - Number(current.startMs));
    const nextDurationMs = Math.max(1, Number(next.endMs) - Number(next.startMs));
    const mergedDurationMs = Math.max(1, Number(next.endMs) - Number(current.startMs));
    const mergedTextLength = normalizeText(current.text).length + 1 + normalizeText(next.text).length;
    if (mergedTextLength > MAX_REVIEW_SEGMENT_CHARS || mergedDurationMs > MAX_REVIEW_SEGMENT_DURATION_MS) {
      return false;
    }
    return (
      currentDurationMs < TARGET_REVIEW_SEGMENT_DURATION_MS
      || normalizeText(current.text).length < TARGET_REVIEW_SEGMENT_CHARS
      || nextDurationMs < MIN_REVIEW_SEGMENT_DURATION_MS
      || normalizeText(next.text).length < MIN_REVIEW_SEGMENT_CHARS
    );
  }

  function mergeReviewSegments(current, next) {
    return {
      endMs: Math.max(Number(current?.endMs) || 0, Number(next?.endMs) || 0),
      startMs: Math.max(0, Number(current?.startMs) || 0),
      text: [normalizeText(current?.text), normalizeText(next?.text)].filter(Boolean).join(" "),
    };
  }

  function resegmentTranscriptForReview(segments) {
    const reviewUnits = buildTimedTranscriptReviewUnits(segments);
    if (!reviewUnits.length) {
      return [];
    }
    const merged = [];
    let current = null;
    for (const unit of reviewUnits) {
      const normalizedUnit = normalizeTranscriptSegment(unit);
      if (!normalizeText(normalizedUnit.text)) {
        continue;
      }
      if (!current) {
        current = normalizedUnit;
        continue;
      }
      if (shouldMergeReviewSegments(current, normalizedUnit)) {
        current = mergeReviewSegments(current, normalizedUnit);
        continue;
      }
      merged.push(current);
      current = normalizedUnit;
    }
    if (current) {
      merged.push(current);
    }
    const finalized = [];
    for (const segment of merged) {
      const previous = finalized[finalized.length - 1];
      const durationMs = Math.max(1, Number(segment.endMs) - Number(segment.startMs));
      if (
        previous
        && durationMs < MIN_REVIEW_SEGMENT_DURATION_MS
        && normalizeText(segment.text).length < MIN_REVIEW_SEGMENT_CHARS
        && shouldMergeReviewSegments(previous, segment)
      ) {
        finalized[finalized.length - 1] = mergeReviewSegments(previous, segment);
        continue;
      }
      finalized.push(segment);
    }
    return finalized.map(normalizeTranscriptSegment).filter((segment) => normalizeText(segment.text));
  }

  function buildMeetingNotesTranscriptPrompt(transcript, options) {
    const settings = options && typeof options === "object" ? options : {};
    const maxChars = Math.max(1, Number(settings.maxChars) || MAX_SUMMARY_TRANSCRIPT_CHARS);
    const strategy = normalizeText(settings.strategy).toLowerCase() || "start";
    const rawText = normalizeText(buildMeetingNotesTranscriptLines(transcript).join("\n") || transcript?.text);
    if (!rawText) {
      return "";
    }
    if (rawText.length <= maxChars) {
      return rawText;
    }
    if (strategy === "balanced") {
      const headChars = Math.max(1, Math.floor(maxChars * 0.55));
      const tailChars = Math.max(1, maxChars - headChars - 5);
      return `${rawText.slice(0, headChars)}\n...\n${rawText.slice(-tailChars)}`;
    }
    return rawText.length > maxChars
      ? `${rawText.slice(0, maxChars)}...`
      : rawText;
  }

  function buildMeetingNotesTranscriptSections(transcript) {
    const lines = buildMeetingNotesTranscriptLines(transcript);
    if (!lines.length) {
      const fallbackText = normalizeText(transcript?.text);
      return fallbackText ? limitMeetingNotesSections([fallbackText]) : [];
    }
    const sections = [];
    let currentLines = [];
    let currentChars = 0;
    for (const line of lines) {
      const normalizedLine = normalizeText(line);
      if (!normalizedLine) {
        continue;
      }
      const nextChars = currentLines.length ? currentChars + normalizedLine.length + 1 : normalizedLine.length;
      if (currentLines.length && nextChars > MAX_MEETING_NOTES_SECTION_CHARS) {
        sections.push(currentLines.join("\n"));
        currentLines = [normalizedLine];
        currentChars = normalizedLine.length;
        continue;
      }
      currentLines.push(normalizedLine);
      currentChars = nextChars;
    }
    if (currentLines.length) {
      sections.push(currentLines.join("\n"));
    }
    return limitMeetingNotesSections(sections);
  }

  function limitMeetingNotesSections(sections) {
    const sourceSections = (Array.isArray(sections) ? sections : []).map((section) => normalizeText(section)).filter(Boolean);
    if (sourceSections.length <= MAX_MEETING_NOTES_SECTION_COUNT) {
      return sourceSections;
    }
    const groupedSections = [];
    const bucketSize = Math.ceil(sourceSections.length / MAX_MEETING_NOTES_SECTION_COUNT);
    for (let index = 0; index < sourceSections.length; index += bucketSize) {
      groupedSections.push(sourceSections.slice(index, index + bucketSize).join("\n"));
    }
    return groupedSections.filter(Boolean);
  }

  function buildMeetingNotesTranscriptLines(transcript) {
    const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
    const lines = segments
      .map((segment) => {
        const text = normalizeText(segment?.text);
        const range = buildMeetingNotesSegmentRange(segment?.startMs, segment?.endMs);
        if (!text) {
          return "";
        }
        return range ? `[${range}] ${text}` : text;
      })
      .filter(Boolean);
    if (lines.length) {
      return lines;
    }
    return normalizeTextBlock(transcript?.text)
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);
  }

  function buildMeetingNotesSegmentRange(startMs, endMs) {
    const startSeconds = Math.max(0, Math.floor(Number(startMs) / 1000));
    const endSeconds = Math.max(startSeconds, Math.floor(Number(endMs) / 1000));
    const formatPart = (value) => {
      const hours = Math.floor(value / 3600);
      const minutes = Math.floor((value % 3600) / 60);
      const seconds = value % 60;
      if (hours) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    };
    if (endSeconds <= startSeconds) {
      return formatPart(startSeconds);
    }
    return `${formatPart(startSeconds)}-${formatPart(endSeconds)}`;
  }

  return {
    buildMeetingNotesTranscriptPrompt,
    buildMeetingNotesTranscriptSections,
    buildTranscriptText,
    resegmentTranscriptForReview,
  };
}

module.exports = {
  createMeetingTranscriptDomain,
};
