#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OpenAI = require("../functions/node_modules/openai");
const { createAiProviderRuntime } = require("../functions/platform/ai-provider-runtime");
const { createMeetingNotesDocumentDomain } = require("../functions/features/meeting/meeting-notes-document-domain");
const { createMeetingNotesGenerationDomain } = require("../functions/features/meeting/meeting-notes-generation-domain");
const { createMeetingNotesRuntimeDomain } = require("../functions/features/meeting/meeting-notes-runtime-domain");
const { createMeetingTranscriptDomain } = require("../functions/features/meeting/meeting-transcript-domain");
const {
  buildTranscriptExcerpt,
  normalizeText,
  normalizeTextBlock,
  normalizeTranscriptSegment,
} = require("../functions/features/meeting/meeting-common-domain");
const { getGcloudAccessToken } = require("./meeting-data-lib");

const PROJECT_ID = "browser-extension-main";
const JOB_COLLECTION = "integration_inova_meeting_jobs";
const DEFAULT_CASE_IDS = [
  "meeting-job-d0a375ddc3f749d402528599294a1f7e",
  "meeting-job-7efc23e3bad3270b28c350f0a7fd7b66",
  "meeting-job-ce4d21cbe882e7b469bdb60fb6372657",
];
const OUTPUT_DIR = path.join(__dirname, "..", ".codex", "gemini-meeting-notes-tuning");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadLocalSecret();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const previousReport = options.previous ? readReport(options.previous) : null;
  const jobs = await Promise.all(options.jobIds.map((jobId) => loadJob(jobId)));
  const generation = createGenerationRuntime();
  const cases = [];

  for (const job of jobs) {
    const caseReport = await evaluateCase(job, generation);
    cases.push(caseReport);
    printCaseSummary(caseReport);
  }

  const report = buildReport({
    cases,
    label: options.label,
    previousReport,
    successNumber: options.successNumber,
  });
  const reportPath = writeReport(report);
  printReportSummary(report, reportPath);
}

function parseArgs(args) {
  const options = {
    jobIds: [...DEFAULT_CASE_IDS],
    label: "baseline",
    previous: "",
    successNumber: 0,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = normalizeText(args[index]);
    if (arg === "--label") {
      options.label = normalizeText(args[index + 1]) || options.label;
      index += 1;
      continue;
    }
    if (arg === "--previous") {
      options.previous = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--success-number") {
      options.successNumber = Math.max(0, Number(args[index + 1]) || 0);
      index += 1;
      continue;
    }
    if (arg === "--job-id") {
      const jobId = normalizeText(args[index + 1]);
      if (jobId) {
        options.jobIds.push(jobId);
      }
      index += 1;
      continue;
    }
    if (arg === "--only-job-id") {
      const jobId = normalizeText(args[index + 1]);
      options.jobIds = jobId ? [jobId] : [];
      index += 1;
    }
  }
  options.jobIds = Array.from(new Set(options.jobIds)).filter(Boolean);
  if (!options.jobIds.length) {
    throw new Error("평가할 job id가 없습니다.");
  }
  return options;
}

function loadLocalSecret() {
  const secretPath = path.join(__dirname, "..", "functions", ".secret.local");
  if (!fs.existsSync(secretPath)) {
    return;
  }
  for (const rawLine of fs.readFileSync(secretPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function loadJob(jobId) {
  const accessToken = getGcloudAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${JOB_COLLECTION}/${encodeURIComponent(jobId)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`${jobId} 조회 실패 (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  return {
    id: jobId,
    data: decodeFirestoreValue({ mapValue: { fields: payload.fields || {} } }) || {},
  };
}

function createGenerationRuntime() {
  const notesDomain = createMeetingNotesDocumentDomain({
    buildTranscriptExcerpt,
    crypto,
    limits: {
      MAX_MEETING_NOTES_ACTION_ITEMS: 5,
      MAX_MEETING_NOTES_DECISIONS: 5,
      MAX_MEETING_NOTES_OPEN_QUESTIONS: 3,
      MAX_MEETING_NOTES_RISKS: 3,
      MAX_MEETING_NOTES_SOURCE_TRACE: 6,
      MAX_MEETING_NOTES_TOPIC_COUNT: 4,
      MAX_MEETING_NOTES_TOPIC_KEY_POINTS: 4,
    },
    normalizeText,
    normalizeTextBlock,
    supportedNotesStatuses: new Set(["pending", "disabled", "skipped", "degraded", "succeeded"]),
  });
  const runtimeDomain = createMeetingNotesRuntimeDomain({
    createEmptyMeetingNotes: notesDomain.createEmptyMeetingNotes,
    hasMeetingNotes: notesDomain.hasMeetingNotes,
    normalizeMeetingNotes: notesDomain.normalizeMeetingNotes,
    normalizeMeetingNotesStatus: notesDomain.normalizeMeetingNotesStatus,
    normalizeText,
    notesSchemaVersion: 3,
  });
  const transcriptDomain = createMeetingTranscriptDomain({
    normalizeText,
    normalizeTextBlock,
    normalizeTranscriptSegment,
    limits: {
      MAX_MEETING_NOTES_SECTION_CHARS: 9000,
      MAX_MEETING_NOTES_SECTION_COUNT: 8,
      MAX_REVIEW_SEGMENT_CHARS: 420,
      MAX_REVIEW_SEGMENT_DURATION_MS: 45 * 1000,
      MAX_SUMMARY_TRANSCRIPT_CHARS: 12000,
      MIN_REVIEW_SEGMENT_CHARS: 90,
      MIN_REVIEW_SEGMENT_DURATION_MS: 12 * 1000,
      TARGET_REVIEW_SEGMENT_CHARS: 320,
      TARGET_REVIEW_SEGMENT_DURATION_MS: 30 * 1000,
    },
  });
  const providerEvents = [];
  const client = createAiProviderRuntime({
    OpenAI,
    createHttpError(status, message) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    logEvent(name, payload) {
      providerEvents.push({ name, payload });
    },
    normalizeText,
  }).createClient();
  const generationDomain = createMeetingNotesGenerationDomain({
    applyMeetingTermReplacements: notesDomain.applyMeetingTermReplacements,
    buildMeetingNotesTranscriptPrompt: transcriptDomain.buildMeetingNotesTranscriptPrompt,
    buildMeetingNotesTranscriptSections: transcriptDomain.buildMeetingNotesTranscriptSections,
    buildTranscriptExcerpt,
    createEmptyMeetingNotesBundle: runtimeDomain.createEmptyMeetingNotesBundle,
    createHttpError(status, message) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    createMeetingNotesBundleFromNotes: runtimeDomain.createMeetingNotesBundleFromNotes,
    getClient: () => client,
    getMeetingClassifierModel: () => process.env.OPENROUTER_MEETING_SUMMARY_MODEL || "openai/gpt-5.5",
    getMeetingSummaryModel: () => process.env.OPENROUTER_MEETING_SUMMARY_MODEL || "openai/gpt-5.5",
    loadMeetingSummaryRecord: async () => ({ meeting: { termReplacements: [] } }),
    normalizeCompletionContent: runtimeDomain.normalizeCompletionContent,
    normalizeMeetingNotes: notesDomain.normalizeMeetingNotes,
    normalizeMeetingTermReplacements: () => [],
    normalizeText,
    normalizeTextBlock,
    parseMeetingNotesJson: notesDomain.parseMeetingNotesJson,
    limits: {
      MAX_COMPACT_MEETING_NOTES_LINE_CHARS: 96,
      MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS: 180,
      MAX_COMPACT_MEETING_NOTES_TITLE_CHARS: 48,
      MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS: 1800,
      MIN_MEETING_NOTES_DIRECT_SEGMENTS: 4,
      MIN_MEETING_NOTES_DIRECT_SENTENCES: 3,
      MIN_MEETING_NOTES_DIRECT_TEXT_CHARS: 180,
    },
  });
  return {
    generationDomain,
    normalizeMeetingNotes: notesDomain.normalizeMeetingNotes,
    providerEvents,
  };
}

async function evaluateCase(job, generation) {
  const data = job.data;
  const transcript = data.transcript || {};
  const beforeEvents = generation.providerEvents.length;
  const startedAt = Date.now();
  const bundle = await generation.generationDomain.maybeGenerateMeetingNotes(
    transcript,
    {
      ...(data.meeting || {}),
      language: data.transcription?.language || data.meeting?.language || "ko",
      meetingId: data.meetingId,
    },
    { summary: true },
    data.context || { sharedMemoSnapshot: data.notesInputSnapshot?.sharedMemo || "" },
    () => {},
    data.owner || {},
    data.jobId || job.id
  );
  const elapsedMs = Date.now() - startedAt;
  const generatedNotes = generation.normalizeMeetingNotes(bundle.notes);
  const storedNotes = generation.normalizeMeetingNotes(data.meetingNotes);
  const generatedScore = scoreNotes(generatedNotes, storedNotes);
  return {
    elapsedMs,
    generated: summarizeNotes(generatedNotes),
    generatedScore,
    jobId: job.id,
    meetingId: data.meetingId || "",
    providerEvents: generation.providerEvents.slice(beforeEvents),
    stored: summarizeNotes(storedNotes),
    title: data.title || data.meeting?.title || "",
    transcript: {
      chars: normalizeText(transcript.text).length,
      segments: Array.isArray(transcript.segments) ? transcript.segments.length : 0,
    },
    updatedAt: data.updatedAt || "",
  };
}

function scoreNotes(notes, storedNotes) {
  const metrics = buildMetrics(notes);
  const storedMetrics = buildMetrics(storedNotes);
  const penalties = [];
  addPenalty(penalties, "weakDecisions", metrics.weakDecisions * 15);
  addPenalty(penalties, "weakCommitmentProse", metrics.weakCommitmentProse * 10);
  addPenalty(penalties, "nonKoreanEnums", metrics.nonKoreanEnums * 6);
  addPenalty(penalties, "overclaimPhrases", metrics.overclaimPhrases * 5);
  addPenalty(penalties, "missingSourceTrace", metrics.sourceTrace ? 0 : 8);
  addPenalty(penalties, "emptySummary", metrics.summaryChars ? 0 : 12);
  addPenalty(penalties, "thinOverview", metrics.overviewChars >= 120 ? 0 : 6);
  addPenalty(penalties, "topicOverrun", Math.max(0, metrics.topics - 4) * 4);
  addPenalty(penalties, "decisionOverrun", Math.max(0, metrics.decisions - Math.max(0, storedMetrics.decisions)) * 4);
  addPenalty(penalties, "followupUnderrun", metrics.followupCount || storedMetrics.followupCount === 0 ? 0 : 8);
  const penaltyTotal = penalties.reduce((sum, item) => sum + item.points, 0);
  return {
    metrics,
    penaltyTotal,
    penalties,
    score: Math.max(0, 100 - penaltyTotal),
    storedMetrics,
  };
}

function addPenalty(penalties, name, points) {
  const rounded = Math.max(0, Number(points) || 0);
  if (rounded > 0) {
    penalties.push({ name, points: rounded });
  }
}

function buildMetrics(notes) {
  const summary = normalizeTextBlock(notes.summary);
  const overview = normalizeTextBlock(notes.overview);
  const prose = [
    summary,
    overview,
    ...(notes.discussionFlow || []).map((item) => normalizeTextBlock(item.narrative)),
  ].join("\n");
  const actionStatuses = (notes.actionItems || []).map((item) => normalizeText(item.status)).filter(Boolean);
  const decisionConfidences = (notes.decisions || []).map((item) => normalizeText(item.confidence)).filter(Boolean);
  const riskSeverities = (notes.risksOrDependencies || []).map((item) => normalizeText(item.severity)).filter(Boolean);
  const nonKoreanEnums = [...actionStatuses, ...decisionConfidences, ...riskSeverities]
    .filter((value) => /^(open|todo|not started|planned|high|medium|low)$/i.test(value))
    .length;
  return {
    actions: (notes.actionItems || []).length,
    decisions: (notes.decisions || []).length,
    followupCount: (notes.actionItems || []).length
      + (notes.openQuestions || []).length
      + (notes.risksOrDependencies || []).length,
    nonKoreanEnums,
    overclaimPhrases: countMatches(prose, /(필수|권장|반드시|확실히|분명히|최종\s*확정)/g),
    overviewChars: overview.length,
    questions: (notes.openQuestions || []).length,
    risks: (notes.risksOrDependencies || []).length,
    sourceTrace: (notes.sourceTrace || []).length,
    summaryChars: summary.length,
    topics: (notes.discussionFlow || []).length,
    weakCommitmentProse: countMatches(prose, /(진행하기로|추진하기로|확인하기로|테스트하기로|해보기로|의견을\s*모았)/g),
    weakDecisions: (notes.decisions || [])
      .filter((item) => /(검토|재확인|확인|테스트|시도|제안|논의|협의|가능|필요|알아보|추진|진행\s*여부)/.test(normalizeText(item.text)))
      .length,
  };
}

function countMatches(text, pattern) {
  return (normalizeTextBlock(text).match(pattern) || []).length;
}

function summarizeNotes(notes) {
  return {
    actionItems: (notes.actionItems || []).map((item) => ({
      assignee: item.assignee || "",
      dueDate: item.dueDate || "",
      status: item.status || "",
      task: item.task || "",
    })),
    decisions: (notes.decisions || []).map((item) => ({
      confidence: item.confidence || "",
      owner: item.owner || "",
      text: item.text || "",
    })),
    discussionFlow: (notes.discussionFlow || []).map((item) => ({
      heading: item.heading || "",
      keyPointCount: (item.keyPoints || []).length,
      narrative: item.narrative || "",
    })),
    overview: notes.overview || "",
    openQuestions: notes.openQuestions || [],
    risksOrDependencies: (notes.risksOrDependencies || []).map((item) => ({
      severity: item.severity || "",
      text: item.text || "",
    })),
    sourceTraceCount: (notes.sourceTrace || []).length,
    summary: notes.summary || "",
    title: notes.meetingMeta?.title || "",
  };
}

function buildReport({ cases, label, previousReport, successNumber }) {
  const aggregate = aggregateScores(cases);
  const previousAggregate = previousReport?.aggregate || null;
  const improvement = previousAggregate
    ? {
        improved: aggregate.score > previousAggregate.score,
        scoreDelta: round2(aggregate.score - previousAggregate.score),
      }
    : {
        improved: false,
        scoreDelta: 0,
      };
  return {
    aggregate,
    cases,
    improvement,
    label,
    previousReport: previousReport?.reportFile || previousReport?.label || "",
    reportFile: "",
    successNumber,
    timestamp: new Date().toISOString(),
  };
}

function aggregateScores(cases) {
  const score = cases.length
    ? round2(cases.reduce((sum, item) => sum + item.generatedScore.score, 0) / cases.length)
    : 0;
  return {
    averageLatencyMs: cases.length
      ? Math.round(cases.reduce((sum, item) => sum + item.elapsedMs, 0) / cases.length)
      : 0,
    caseCount: cases.length,
    score,
    totalPenalty: round2(cases.reduce((sum, item) => sum + item.generatedScore.penaltyTotal, 0)),
  };
}

function writeReport(report) {
  const safeLabel = normalizeText(report.label).replace(/[^a-zA-Z0-9._-]+/g, "-") || "report";
  const prefix = report.successNumber ? `success-${String(report.successNumber).padStart(2, "0")}` : "baseline";
  const fileName = `${prefix}-${safeLabel}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  report.reportFile = outputPath;
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

function readReport(inputPath) {
  const resolved = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function printCaseSummary(caseReport) {
  console.log(`[case] ${caseReport.jobId} score=${caseReport.generatedScore.score} elapsedMs=${caseReport.elapsedMs}`);
}

function printReportSummary(report, reportPath) {
  console.log(`[report] label=${report.label}`);
  console.log(`[report] score=${report.aggregate.score} cases=${report.aggregate.caseCount} avgLatencyMs=${report.aggregate.averageLatencyMs}`);
  if (report.previousReport) {
    console.log(`[report] previous=${report.previousReport}`);
    console.log(`[report] improved=${report.improvement.improved} delta=${report.improvement.scoreDelta}`);
  }
  console.log(`[report] path=${reportPath}`);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (typeof value.stringValue === "string") {
    return value.stringValue;
  }
  if (typeof value.timestampValue === "string") {
    return value.timestampValue;
  }
  if (typeof value.integerValue === "string") {
    return Number(value.integerValue);
  }
  if (typeof value.doubleValue === "number") {
    return value.doubleValue;
  }
  if (typeof value.booleanValue === "boolean") {
    return value.booleanValue;
  }
  if (value.nullValue !== undefined) {
    return null;
  }
  if (value.arrayValue) {
    return (value.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nestedValue]) => [key, decodeFirestoreValue(nestedValue)])
    );
  }
  return undefined;
}

main().catch((error) => {
  console.error(`[gemini-meeting-notes-tuning-eval] ${error.stack || error.message}`);
  process.exit(1);
});
