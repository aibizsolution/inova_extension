function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeTextBlock(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function normalizeTranscriptSegment(input) {
  const segment = input && typeof input === "object" ? input : {};
  const startMs = Math.max(0, Number(segment.startMs) || 0);
  const endMs = Math.max(startMs + 1, Number(segment.endMs) || startMs + 1);
  return {
    endMs,
    startMs,
    text: normalizeText(segment.text),
  };
}

function buildTranscriptExcerpt(text) {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function buildDefaultFileName(mimeType) {
  return `meeting-source.${resolveAudioExtension(mimeType)}`;
}

function resolveAudioExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  return "bin";
}

function hasOwn(input, key) {
  return Boolean(input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, key));
}

function safeParseJson(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

module.exports = {
  buildDefaultFileName,
  buildTranscriptExcerpt,
  hasOwn,
  normalizeText,
  normalizeTextBlock,
  normalizeTranscriptSegment,
  safeParseJson,
};
