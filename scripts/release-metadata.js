const fs = require("fs");
const path = require("path");

const RELEASE_NOTES_RELATIVE_PATH = path.join("releases", "release-notes.json");
const RELEASE_CHANGE_TYPES = ["added", "changed", "fixed", "removed", "ops"];
const RELEASE_LEVELS = ["patch", "minor", "major"];

function getReleaseNotesPath(root) {
  return path.join(root, RELEASE_NOTES_RELATIVE_PATH);
}

function readReleaseCatalog(root) {
  const targetPath = getReleaseNotesPath(root);
  if (!fs.existsSync(targetPath)) {
    return {
      schemaVersion: 1,
      versions: [],
    };
  }

  const payload = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  return {
    schemaVersion: 1,
    ...payload,
    versions: Array.isArray(payload?.versions) ? payload.versions.slice() : [],
  };
}

function writeReleaseCatalog(root, catalog) {
  const targetPath = getReleaseNotesPath(root);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify({
    schemaVersion: 1,
    versions: sortReleaseEntries(Array.isArray(catalog?.versions) ? catalog.versions : []),
  }, null, 2)}\n`);
}

function sortReleaseEntries(entries) {
  return entries.slice().sort((left, right) => compareVersions(right?.version, left?.version));
}

function findReleaseEntry(catalog, version) {
  return (Array.isArray(catalog?.versions) ? catalog.versions : []).find((entry) => String(entry?.version || "") === String(version || "")) || null;
}

function upsertReleaseEntry(catalog, entry) {
  const entries = Array.isArray(catalog?.versions) ? catalog.versions.slice() : [];
  const index = entries.findIndex((item) => String(item?.version || "") === String(entry?.version || ""));
  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      ...entry,
    };
  } else {
    entries.push(entry);
  }
  return {
    schemaVersion: 1,
    ...catalog,
    versions: sortReleaseEntries(entries),
  };
}

function compareVersions(left, right) {
  const leftParts = String(left || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function inferReleaseLevel(currentVersion, nextVersion) {
  const current = normalizeVersionParts(currentVersion);
  const next = normalizeVersionParts(nextVersion);
  if (next[0] !== current[0]) return "major";
  if (next[1] !== current[1]) return "minor";
  return "patch";
}

function buildDraftReleaseEntry(version, level) {
  return {
    version: String(version || "").trim(),
    level: normalizeReleaseLevel(level),
    public: {
      headline: `TODO: ${version} 릴리스 제목`,
      summary: "TODO: 사용자 관점 변경 요약",
      changes: [
        {
          type: "changed",
          text: "TODO: 이번 버전의 핵심 변경을 적어 주세요.",
        },
      ],
    },
  };
}

function validateReleaseEntry(entry, version) {
  const errors = [];
  if (!entry || typeof entry !== "object") {
    return [`릴리스 메타가 없습니다: ${version}`];
  }

  const releaseVersion = String(entry.version || "").trim();
  if (releaseVersion !== String(version || "").trim()) {
    errors.push(`릴리스 메타의 version이 현재 버전과 다릅니다: ${releaseVersion || "(비어 있음)"}`);
  }

  const entryLevel = String(entry.level || "").trim().toLowerCase();
  if (!RELEASE_LEVELS.includes(entryLevel)) {
    errors.push(`level은 ${RELEASE_LEVELS.join(", ")} 중 하나여야 합니다.`);
  }

  const publicEntry = getPublicReleaseSection(entry);
  if (isDraftText(publicEntry.headline)) {
    errors.push("headline이 비었거나 TODO 상태입니다.");
  }

  if (isDraftText(publicEntry.summary)) {
    errors.push("summary가 비었거나 TODO 상태입니다.");
  }

  const changes = Array.isArray(publicEntry.changes) ? publicEntry.changes : [];
  if (!changes.length) {
    errors.push("changes 항목이 1개 이상 필요합니다.");
  }

  changes.forEach((item, index) => {
    const type = String(item?.type || "").trim();
    const text = String(item?.text || "").trim();
    if (!RELEASE_CHANGE_TYPES.includes(type)) {
      errors.push(`changes[${index}].type 은 ${RELEASE_CHANGE_TYPES.join(", ")} 중 하나여야 합니다.`);
    }
    if (isDraftText(text)) {
      errors.push(`changes[${index}].text 가 비었거나 TODO 상태입니다.`);
    }
  });

  const internalChanges = Array.isArray(entry?.internal?.changes) ? entry.internal.changes : [];
  internalChanges.forEach((item, index) => {
    const type = String(item?.type || "").trim();
    const text = String(item?.text || "").trim();
    if (!RELEASE_CHANGE_TYPES.includes(type)) {
      errors.push(`internal.changes[${index}].type 은 ${RELEASE_CHANGE_TYPES.join(", ")} 중 하나여야 합니다.`);
    }
    if (isDraftText(text)) {
      errors.push(`internal.changes[${index}].text 가 비었거나 TODO 상태입니다.`);
    }
  });

  return errors;
}

function getPublicReleaseSection(entry) {
  const source = entry?.public && typeof entry.public === "object" ? entry.public : entry;
  return {
    headline: String(source?.headline || "").trim(),
    summary: String(source?.summary || "").trim(),
    changes: Array.isArray(source?.changes) ? source.changes.slice() : [],
  };
}

function normalizeReleaseLevel(level) {
  const normalized = String(level || "").trim().toLowerCase();
  return RELEASE_LEVELS.includes(normalized) ? normalized : "patch";
}

function normalizeVersionParts(version) {
  const parts = String(version || "").split(".").map((value) => Number.parseInt(value, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function isDraftText(value) {
  const text = String(value || "").trim();
  return !text || /todo/i.test(text);
}

module.exports = {
  RELEASE_CHANGE_TYPES,
  RELEASE_LEVELS,
  RELEASE_NOTES_RELATIVE_PATH,
  buildDraftReleaseEntry,
  compareVersions,
  findReleaseEntry,
  getPublicReleaseSection,
  getReleaseNotesPath,
  inferReleaseLevel,
  readReleaseCatalog,
  upsertReleaseEntry,
  validateReleaseEntry,
  writeReleaseCatalog,
};
