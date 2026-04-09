function createMeetingNotesRuntimeDomain(deps) {
  const {
    createEmptyMeetingNotes,
    hasMeetingNotes,
    normalizeMeetingNotes,
    normalizeMeetingNotesContextItems,
    normalizeMeetingNotesStatus,
    normalizeText,
    notesSchemaVersion,
  } = deps;

  function createEmptyMeetingNotesBundle(statusInput, degradedReasonInput) {
    return {
      notes: createEmptyMeetingNotes(),
      notesDegradedReason: normalizeText(degradedReasonInput),
      notesGeneratedAt: "",
      notesStatus: normalizeMeetingNotesStatus(statusInput) || "skipped",
      notesSchemaVersion,
    };
  }

  function createMeetingNotesBundleFromNotes(notesInput, context) {
    const notes = normalizeMeetingNotes(notesInput);
    if (normalizeMeetingNotesContextItems(context?.notesContextItems).length && !hasMeetingNotes(notes)) {
      throw new Error("추가 맥락은 회의 정리를 비우거나 핵심 내용을 삭제하는 용도로 사용할 수 없어요. 전사와 메모를 보완하는 정보만 남겨 주세요.");
    }
    return {
      notes,
      notesDegradedReason: "",
      notesGeneratedAt: new Date().toISOString(),
      notesStatus: "succeeded",
      notesSchemaVersion,
    };
  }

  function normalizeCompletionContent(content) {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          return normalizeText(item?.text || item?.content);
        })
        .filter(Boolean)
        .join("\n");
    }
    return normalizeText(content?.text || content?.content);
  }

  return {
    createEmptyMeetingNotesBundle,
    createMeetingNotesBundleFromNotes,
    normalizeCompletionContent,
  };
}

module.exports = {
  createMeetingNotesRuntimeDomain,
};
