function createMeetingNotesRuntimeDomain(deps) {
  const {
    createEmptyMeetingNotes,
    hasMeetingNotes,
    normalizeMeetingNotes,
    normalizeMeetingNotesFailure,
    normalizeMeetingNotesStatus,
    normalizeText,
    notesSchemaVersion,
  } = deps;

  function createEmptyMeetingNotesBundle(statusInput, degradedReasonInput, failureInput) {
    return {
      notes: createEmptyMeetingNotes(),
      notesDegradedReason: normalizeText(degradedReasonInput),
      notesFailure: normalizeMeetingNotesFailure(failureInput),
      notesGeneratedAt: "",
      notesStatus: normalizeMeetingNotesStatus(statusInput) || "skipped",
      notesSchemaVersion,
    };
  }

  function createMeetingNotesBundleFromNotes(notesInput) {
    const notes = normalizeMeetingNotes(notesInput);
    if (!hasMeetingNotes(notes)) {
      throw new Error("전사에 근거한 회의 정리를 만들지 못했어요.");
    }
    return {
      notes,
      notesDegradedReason: "",
      notesFailure: {},
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
