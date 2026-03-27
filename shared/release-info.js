(function initReleaseInfo(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function mergeReleaseInfo(...states) {
    return states.reduce(
      (merged, next) => ({
        ...merged,
        ...(next || {}),
        checkedAt: normalizeText(next?.checkedAt) || merged.checkedAt,
        checkedForVersion: normalizeText(next?.checkedForVersion) || merged.checkedForVersion,
        error: normalizeText(next?.error),
        history: Array.isArray(next?.history) ? next.history.map(normalizeRelease).filter(Boolean) : merged.history,
        historyCheckedAt: normalizeText(next?.historyCheckedAt) || merged.historyCheckedAt,
        historyCheckedForVersion: normalizeText(next?.historyCheckedForVersion) || merged.historyCheckedForVersion,
        latest: next?.latest === null ? null : next?.latest ? normalizeRelease(next.latest) : merged.latest,
        version: Math.max(1, Number(next?.version) || merged.version),
      }),
      {
        ...namespace.constants.defaults.releaseInfo,
        history: [],
        latest: null,
      }
    );
  }

  function normalizeRelease(release) {
    const version = normalizeText(release?.version);
    if (!version) return null;
    return {
      version,
      level: normalizeText(release?.level || "patch"),
      headline: normalizeText(release?.headline),
      summary: normalizeText(release?.summary),
      changes: Array.isArray(release?.changes) ? release.changes.map(normalizeChange).filter(Boolean) : [],
      publishedAt: normalizeText(release?.publishedAt),
      fileName: normalizeText(release?.fileName),
      downloadUrl: normalizeText(release?.downloadUrl),
      versionDownloadUrl: normalizeText(release?.versionDownloadUrl),
      notes: normalizeText(release?.notes),
      sha256: normalizeText(release?.sha256),
      sizeBytes: Math.max(0, Number(release?.sizeBytes) || 0),
      minSupportedVersion: normalizeText(release?.minSupportedVersion),
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

  function isUpdateAvailable(currentVersion, latestVersion) {
    return compareVersions(latestVersion, currentVersion) > 0;
  }

  function isFresh(releaseInfo, maxAgeMs) {
    const checkedAt = Date.parse(releaseInfo?.checkedAt || "");
    return Boolean(checkedAt && Date.now() - checkedAt < maxAgeMs);
  }

  function isHistoryFresh(releaseInfo, maxAgeMs) {
    const checkedAt = Date.parse(releaseInfo?.historyCheckedAt || "");
    return Boolean(checkedAt && Date.now() - checkedAt < maxAgeMs);
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeChange(change) {
    const type = normalizeText(change?.type);
    const text = normalizeText(change?.text);
    if (!type || !text) return null;
    return { type, text };
  }

  namespace.releaseInfo = {
    compareVersions,
    isFresh,
    isHistoryFresh,
    isUpdateAvailable,
    mergeReleaseInfo,
    normalizeRelease,
  };
})(globalThis);
