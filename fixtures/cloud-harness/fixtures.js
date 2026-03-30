const NOW = "2026-03-30T09:00:00.000Z";
const PROVIDER_IDENTITY = {
  provider: "inova",
  providerUserKey: "fixture-user",
  email: "fixture@example.com",
  displayName: "Harness User",
  numericUserId: 1001,
};

const PROMPT_LIBRARY_ITEMS = [
  {
    id: "prompt-fixture-1",
    title: "Meeting summary",
    content: "Summarize the meeting and list the next actions.",
    createdAt: "2026-03-26T01:00:00.000Z",
    updatedAt: "2026-03-26T01:00:00.000Z",
  },
  {
    id: "prompt-fixture-2",
    title: "Executive rewrite",
    content: "Rewrite the draft for an executive audience.",
    createdAt: "2026-03-25T01:00:00.000Z",
    updatedAt: "2026-03-25T01:00:00.000Z",
  },
];

const STORE_ENTRIES = [
  {
    entryId: "store-entry-1",
    categoryId: "meeting",
    categoryLabel: "Meeting",
    title: "Action tracker",
    summary: "Turn a meeting log into action items.",
    content: "Read the meeting notes and extract owner, due date, and risk.",
    owner: {
      displayName: "AI Biz Team",
      kind: "system",
      maskedEmail: "",
      providerUserKey: "system",
    },
    publishedAt: "2026-03-28T03:00:00.000Z",
    updatedAt: "2026-03-28T03:00:00.000Z",
    metrics: {
      importCount: 18,
      likeCount: 11,
      viewCount: 33,
    },
    viewer: {
      imported: false,
      liked: false,
      viewed: false,
    },
  },
  {
    entryId: "store-entry-2",
    categoryId: "summary",
    categoryLabel: "Summary",
    title: "Short recap",
    summary: "Compress a long discussion into a short recap.",
    content: "Summarize the discussion in five bullets with one recommendation.",
    owner: {
      displayName: "Harness User",
      kind: "user",
      maskedEmail: "fi***@example.com",
      providerUserKey: "fixture-user",
    },
    publishedAt: "2026-03-27T02:00:00.000Z",
    updatedAt: "2026-03-27T02:00:00.000Z",
    metrics: {
      importCount: 7,
      likeCount: 5,
      viewCount: 12,
    },
    viewer: {
      imported: true,
      liked: true,
      viewed: true,
    },
  },
];

const REVIEW_RESULT = {
  verdict: "revise",
  totalScore: 74,
  summary: "Intent is clear, but constraints and output shape can be more explicit.",
  checks: [
    { id: "context", label: "Context", status: "partial", feedback: "Audience and situation need more detail." },
    { id: "goal", label: "Goal", status: "good", feedback: "The desired result is clear." },
    { id: "constraints", label: "Constraints", status: "missing", feedback: "Add length or exclusion rules." },
    { id: "output", label: "Output", status: "partial", feedback: "Ask for a fixed response structure." },
  ],
  quickImprovements: [
    "Add the target audience.",
    "State one or two exclusions.",
    "Request a fixed response structure.",
  ],
  refinedPrompt: "Rewrite the request for an executive audience, keep it under five bullets, and end with one recommended next action.",
};

const RELEASE_LATEST = {
  version: "0.3.8",
  level: "minor",
  headline: "Harness local preview",
  summary: "Local cloud and browser harness checks are available.",
  changes: [
    { type: "added", text: "Added a local browser harness page." },
    { type: "added", text: "Added a local cloud harness server." },
  ],
  publishedAt: NOW,
  fileName: "inova-extension-0.3.8.zip",
  downloadUrl: "https://browser-extension-main.web.app/extension/downloads/latest.zip",
  versionDownloadUrl: "https://browser-extension-main.web.app/extension/downloads/inova-extension-0.3.8.zip",
  notes: "Fixture release",
  sha256: "fixture",
  sizeBytes: 204800,
  minSupportedVersion: "0.3.8",
};

const RELEASE_HISTORY = [
  {
    version: "0.3.7",
    level: "patch",
    headline: "Prompt store polish",
    summary: "Small prompt store and release panel refinements.",
    changes: [{ type: "fixed", text: "Improved store loading feedback." }],
    publishedAt: "2026-03-27T01:00:00.000Z",
    fileName: "inova-extension-0.3.7.zip",
    downloadUrl: "https://browser-extension-main.web.app/extension/downloads/inova-extension-0.3.7.zip",
    versionDownloadUrl: "https://browser-extension-main.web.app/extension/downloads/inova-extension-0.3.7.zip",
    notes: "Fixture release history",
    sha256: "fixture-37",
    sizeBytes: 198000,
    minSupportedVersion: "0.3.7",
  },
];

function createHarnessState() {
  const promptLibrary = {
    found: true,
    libraryId: buildLibraryId(PROVIDER_IDENTITY.providerUserKey),
    owner: cloneValue(PROVIDER_IDENTITY),
    promptLibrary: {
      itemCount: PROMPT_LIBRARY_ITEMS.length,
      items: cloneValue(PROMPT_LIBRARY_ITEMS),
      updatedAt: PROMPT_LIBRARY_ITEMS[0].updatedAt,
      version: 1,
    },
    syncedAt: NOW,
  };

  return {
    providerIdentity: cloneValue(PROVIDER_IDENTITY),
    promptLibrary,
    promptLibraryRemote: {
      checkedAt: NOW,
      found: true,
      itemCount: promptLibrary.promptLibrary.itemCount,
      lastRevision: "fixture-revision-1",
      lastSyncedAt: NOW,
      providerUserKey: PROVIDER_IDENTITY.providerUserKey,
      updatedAt: promptLibrary.promptLibrary.updatedAt,
      version: 1,
    },
    reviewResult: cloneValue(REVIEW_RESULT),
    requests: [],
    storeEntries: cloneValue(STORE_ENTRIES),
    releaseLatest: cloneValue(RELEASE_LATEST),
    releaseHistory: cloneValue(RELEASE_HISTORY),
    syncRevision: "fixture-revision-1",
  };
}

function buildLibraryId(providerUserKey) {
  return `inova__${String(providerUserKey || "").trim()}`;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

module.exports = {
  NOW,
  PROVIDER_IDENTITY,
  RELEASE_HISTORY,
  RELEASE_LATEST,
  REVIEW_RESULT,
  STORE_ENTRIES,
  createHarnessState,
};
