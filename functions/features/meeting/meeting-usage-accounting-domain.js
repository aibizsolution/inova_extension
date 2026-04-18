function createMeetingUsageAccountingDomain(deps) {
  const {
    db,
    logEvent,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeText,
    usageCollections,
  } = deps;

  const collections = {
    adminDays: normalizeText(usageCollections?.adminDays) || "integration_inova_meeting_usage_admin_days",
    adminMonths: normalizeText(usageCollections?.adminMonths) || "integration_inova_meeting_usage_admin_months",
    events: normalizeText(usageCollections?.events) || "integration_inova_meeting_usage_events",
    userMonths: normalizeText(usageCollections?.userMonths) || "integration_inova_meeting_usage_user_months",
    userTotals: normalizeText(usageCollections?.userTotals) || "integration_inova_meeting_usage_user_totals",
  };

  async function commitProcessedMeetingUsage(input = {}) {
    const job = normalizeMeetingJob(input.job);
    const artifact = normalizeMeetingArtifact(input.artifact);
    const providerUserKey = normalizeText(job.owner?.providerUserKey || input.owner?.providerUserKey);
    const jobId = normalizeText(job.jobId || input.jobId);
    if (!providerUserKey || !jobId) {
      return { committed: false, reason: "missing-identity" };
    }

    const durationMs = resolveUsageDurationMs(job, artifact);
    if (!(durationMs > 0)) {
      logEvent?.("meeting.usage.commit.skipped", {
        jobId,
        meetingId: normalizeText(job.meetingId || job.meeting?.meetingId),
        providerUserKey,
        reason: "duration-unavailable",
      });
      return { committed: false, reason: "duration-unavailable" };
    }

    const processedAt = normalizeTimestamp(
      input.processedAt
      || artifact.createdAt
      || job.updatedAt
      || job.createdAt
      || new Date().toISOString()
    );
    const monthKey = formatMonthKey(processedAt);
    const dayKey = formatDayKey(processedAt);
    const eventId = buildProcessedUsageEventId(jobId);
    const eventRef = db.collection(collections.events).doc(eventId);
    const userMonthRef = db.collection(collections.userMonths).doc(buildUserMonthDocId(providerUserKey, monthKey));
    const userTotalRef = db.collection(collections.userTotals).doc(providerUserKey);
    const adminMonthRef = db.collection(collections.adminMonths).doc(monthKey);
    const adminDayRef = db.collection(collections.adminDays).doc(dayKey);

    return db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      const userMonthSnapshot = await transaction.get(userMonthRef);
      const userTotalSnapshot = await transaction.get(userTotalRef);
      const adminMonthSnapshot = await transaction.get(adminMonthRef);
      const adminDaySnapshot = await transaction.get(adminDayRef);
      if (eventSnapshot.exists) {
        logEvent?.("meeting.usage.commit.duplicate", {
          eventId,
          jobId,
          providerUserKey,
        });
        return { committed: false, eventId, reason: "duplicate" };
      }

      const event = buildProcessedUsageEvent({
        artifact,
        dayKey,
        durationMs,
        eventId,
        job,
        monthKey,
        processedAt,
        providerUserKey,
      });

      transaction.set(eventRef, event);
      transaction.set(
        userMonthRef,
        buildUsageAggregate(
          readSnapshotData(userMonthSnapshot),
          {
            aggregateScope: "user-month",
            docId: userMonthRef.id,
            monthKey,
            owner: { providerUserKey },
            providerUserKey,
          },
          event
        )
      );
      transaction.set(
        userTotalRef,
        buildUsageAggregate(
          readSnapshotData(userTotalSnapshot),
          {
            aggregateScope: "user-total",
            docId: userTotalRef.id,
            owner: { providerUserKey },
            providerUserKey,
          },
          event
        )
      );
      transaction.set(
        adminMonthRef,
        buildUsageAggregate(
          readSnapshotData(adminMonthSnapshot),
          {
            aggregateScope: "admin-month",
            docId: adminMonthRef.id,
            monthKey,
          },
          event
        )
      );
      transaction.set(
        adminDayRef,
        buildUsageAggregate(
          readSnapshotData(adminDaySnapshot),
          {
            aggregateScope: "admin-day",
            dayKey,
            docId: adminDayRef.id,
            monthKey,
          },
          event
        )
      );

      logEvent?.("meeting.usage.commit.success", {
        dayKey,
        durationMs,
        eventId,
        jobId,
        monthKey,
        providerUserKey,
      });
      return { committed: true, durationMs, eventId };
    });
  }

  function resolveUsageDurationMs(job, artifact) {
    return Math.max(
      readNonNegativeNumber(job?.source?.durationMs),
      readNonNegativeNumber(artifact?.durationMs),
      deriveSegmentsDurationMs(artifact?.segments),
      deriveSegmentsDurationMs(job?.transcript?.segments)
    );
  }

  function deriveSegmentsDurationMs(segments) {
    return (Array.isArray(segments) ? segments : []).reduce((maxEndMs, segment) => {
      const endMs = readNonNegativeNumber(segment?.endMs);
      const endSecondsMs = readNonNegativeNumber(segment?.end) * 1000;
      return Math.max(maxEndMs, endMs, endSecondsMs);
    }, 0);
  }

  function buildProcessedUsageEvent({ artifact, dayKey, durationMs, eventId, job, monthKey, processedAt, providerUserKey }) {
    return {
      captureMode: normalizeText(job?.source?.captureMode),
      createdAt: processedAt,
      dayKey,
      durationMs,
      eventId,
      eventType: "processed",
      jobId: normalizeText(job?.jobId),
      meetingId: normalizeText(job?.meetingId || job?.meeting?.meetingId || artifact?.meetingId),
      monthKey,
      providerUserKey,
      requestId: normalizeText(job?.source?.requestId),
      sourceMode: normalizeText(job?.source?.mode),
      status: "committed",
      updatedAt: processedAt,
    };
  }

  function buildUsageAggregate(current, base, event) {
    const currentData = current && typeof current === "object" ? current : {};
    const processedAt = normalizeTimestamp(event.createdAt);
    const processedMs = readNonNegativeNumber(currentData.processedMs) + event.durationMs;
    const processedCount = readNonNegativeNumber(currentData.processedCount) + 1;
    return {
      ...currentData,
      ...base,
      firstProcessedAt: pickEarlierTimestamp(currentData.firstProcessedAt, processedAt),
      lastProcessedAt: pickLaterTimestamp(currentData.lastProcessedAt, processedAt),
      processedCount,
      processedMs,
      updatedAt: processedAt,
    };
  }

  function readSnapshotData(snapshot) {
    return snapshot?.exists && typeof snapshot.data === "function" ? snapshot.data() : {};
  }

  function buildProcessedUsageEventId(jobId) {
    return `processed__${normalizeText(jobId)}`;
  }

  function buildUserMonthDocId(providerUserKey, monthKey) {
    return `${normalizeText(providerUserKey)}__${normalizeText(monthKey)}`;
  }

  function normalizeTimestamp(value) {
    const normalized = normalizeText(value);
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
  }

  function formatMonthKey(timestamp) {
    return normalizeTimestamp(timestamp).slice(0, 7);
  }

  function formatDayKey(timestamp) {
    return normalizeTimestamp(timestamp).slice(0, 10);
  }

  function pickEarlierTimestamp(left, right) {
    const leftTime = Date.parse(normalizeText(left));
    const rightTime = Date.parse(normalizeText(right));
    if (!Number.isFinite(leftTime)) {
      return normalizeTimestamp(right);
    }
    if (!Number.isFinite(rightTime)) {
      return normalizeTimestamp(left);
    }
    return new Date(Math.min(leftTime, rightTime)).toISOString();
  }

  function pickLaterTimestamp(left, right) {
    const leftTime = Date.parse(normalizeText(left));
    const rightTime = Date.parse(normalizeText(right));
    if (!Number.isFinite(leftTime)) {
      return normalizeTimestamp(right);
    }
    if (!Number.isFinite(rightTime)) {
      return normalizeTimestamp(left);
    }
    return new Date(Math.max(leftTime, rightTime)).toISOString();
  }

  function readNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  }

  return {
    buildProcessedUsageEventId,
    buildUserMonthDocId,
    commitProcessedMeetingUsage,
    formatDayKey,
    formatMonthKey,
    resolveUsageDurationMs,
  };
}

module.exports = {
  createMeetingUsageAccountingDomain,
};
