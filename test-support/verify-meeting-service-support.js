const JOB_COLLECTION = "integration_inova_meeting_jobs";
const DELETION_COLLECTION = "integration_inova_meeting_deletions";
const JOB_FINALIZER_COLLECTION = "integration_inova_meeting_job_finalizers";
const JOB_PART_COLLECTION = "integration_inova_meeting_job_parts";
const MEETING_COLLECTION = "integration_inova_meetings";
const WORKSPACE_SESSION_COLLECTION = "integration_inova_meeting_workspace_sessions";
function createDeps(state, overrides = {}) {
  return {
    CORS_ORIGINS: ["https://inova.incross.com"],
    REGION: "asia-northeast3",
    bucket: Object.prototype.hasOwnProperty.call(overrides, "bucket") ? overrides.bucket : createBucket(state),
    async createFirebaseCustomToken(uid, claims) {
      state.customTokens.push({
        claims: cloneValue(claims),
        uid: String(uid || ""),
      });
      return `custom-token:${String(uid || "")}`;
    },
    createHttpError(status, message) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    db: createDb(state),
    hostedMeetingPageUrl: "https://browser-extension-main.web.app/meeting/index.html",
    logEvent(name, payload) {
      state.events.push({ name, payload: cloneValue(payload) });
    },
    normalizeIdentity(input) {
      return {
        displayName: String(input?.displayName || "").trim(),
        email: String(input?.email || "").trim(),
        numericUserId: Number(input?.numericUserId) || 0,
        provider: String(input?.provider || "").trim(),
        providerUserKey: String(input?.providerUserKey || "").trim(),
      };
    },
    normalizeText(value) {
      return String(value || "").trim();
    },
    onRequest(_options, handler) {
      return handler;
    },
    openaiFactory() {
      return {
        audio: {
          transcriptions: {
            async create(request) {
              state.openaiRequests.push({
                chunking_strategy: request.chunking_strategy || "",
                language: request.language || "",
                model: request.model || "",
                response_format: request.response_format || "",
              });
              return {
                duration: 10.4,
                language: "ko",
                segments: [
                  {
                    end: 5.3,
                    start: 0,
                    text: "신규 프로모션 일정을 이번 주 안에 확정합시다.",
                  },
                  {
                    end: 10.4,
                    start: 5.4,
                    text: "예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
                  },
                ],
                task: "transcribe",
                text: "신규 프로모션 일정을 이번 주 안에 확정합시다. 예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
              };
            },
          },
        },
        chat: {
          completions: {
            async create(request) {
              const firstSystemMessage = Array.isArray(request.messages) ? String(request.messages[0]?.content || "") : "";
              const userPrompt = Array.isArray(request.messages) ? String(request.messages[1]?.content || "") : "";
              if (firstSystemMessage.includes("회의 전사 분류기")) {
                state.openaiSummaryRequests.push({ kind: "classifier", model: request.model || "", prompt: userPrompt, systemPrompt: firstSystemMessage });
                const mode = userPrompt.includes("인터뷰") ? "interview" : "planning";
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          confidence: mode === "interview" ? 0.74 : 0.88,
                          mode,
                        }),
                      },
                    },
                  ],
                };
              }
              state.openaiSummaryRequests.push({ kind: "notes", model: request.model || "", prompt: userPrompt, systemPrompt: firstSystemMessage });
              const mode = userPrompt.includes("정리 형식(내부 판단): interview")
                ? "interview"
                : userPrompt.includes("정리 형식(내부 판단): review")
                  ? "review"
                  : userPrompt.includes("정리 형식(내부 판단): planning")
                    ? "planning"
                    : "general";
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify(createNotesFixture(mode)),
                    },
                  },
                ],
              };
            },
          },
        },
      };
    },
    sendError(response, error) {
      response.status(Number(error?.status) || 500).json({
        error: String(error?.message || "Unexpected error"),
        ok: false,
      });
    },
    async verifyInovaIdentity(providerIdentity) {
      return providerIdentity;
    },
  };
}
function createNotesFixture(mode) {
  if (mode === "interview") {
    return {
      actionItems: [{ assignee: "채용 리드", dueDate: "다음 주", status: "open", task: "후속 인터뷰 질문을 정리합니다." }],
      decisions: [{ confidence: "medium", owner: "채용 리드", text: "다음 라운드 인터뷰를 진행합니다." }],
      executiveSummary: ["후보자의 문제 구조화와 커뮤니케이션이 핵심 인사이트였고, 운영 경험은 후속 질문으로 남겼습니다."],
      meetingMeta: {
        title: "후보자 응답 및 후속 인터뷰 정리",
      },
      memoHighlights: [{ linkedTopic: "후속 질문", mergeStatus: "merged", text: "서비스 운영 경험을 더 확인합니다." }],
      mode: "interview",
      modeSpecific: {
        concerns: ["대규모 운영 경험은 추가 확인이 필요합니다."],
        followUpQuestions: ["장애 대응 경험을 구체적으로 질문합니다."],
        strengths: ["문제 구조화가 빠릅니다."],
      },
      openQuestions: [],
      risksOrDependencies: [],
      topics: [{ decisions: [], keyPoints: ["후보자는 데이터 기반 의사결정을 강조했습니다."], openQuestions: [], source: { memo: true, transcript: true }, summary: "응답 정리입니다.", topic: "응답 요약" }],
    };
  }
  if (mode === "general") {
    return {
      actionItems: [{ assignee: "운영 팀", dueDate: "", status: "open", task: "외부 협업 일정 초안을 정리합니다." }],
      decisions: [{ confidence: "medium", owner: "", text: "전체 일정은 운영 준비와 외부 협업 일정에 맞춰 다시 조정하기로 했다." }],
      executiveSummary: ["플랫폼 준비와 운영 구조를 함께 검토한 결과, 외부 협업 일정이 확정돼야 전체 일정도 다시 맞출 수 있다는 점이 정리되었습니다."],
      meetingMeta: {
        title: "플랫폼 구축 및 운영 일정 일반 회의 정리",
      },
      memoHighlights: [],
      mode: "general",
      modeSpecific: {},
      openQuestions: [
        { question: "운영 구조와 명분이 아직 정리되지 않았습니다.", status: "open" },
        { text: "외부 협업 일정을 언제까지 확정할지 추가 논의가 필요합니다." },
      ],
      risksOrDependencies: [
        { severity: "medium", text: "업체 계약이 늦어지면 전체 오픈 일정이 밀릴 수 있습니다." },
      ],
      topics: [
        {
          decisions: [],
          keyPoints: ["운영 구조와 외부 협업 일정 검토"],
          openQuestions: [{ question: "오픈 시점을 어떻게 잡을지 추가 검토 필요" }],
          source: { memo: true, transcript: true },
          summary: "일정과 운영 구조를 함께 검토했다.",
          topic: "운영 일정",
        },
      ],
    };
  }
  return {
    actionItems: [{ assignee: "마케팅 팀", dueDate: "오늘", status: "open", task: "예산과 랜딩 문구 초안을 정리합니다." }],
    decisions: [{ confidence: "high", owner: "팀 리드", text: "신규 프로모션 일정은 이번 주 안에 확정합니다." }],
    executiveSummary: ["신규 프로모션 일정 확정이 회의의 중심이었고, 예산과 랜딩 문구 초안은 이번 주 일정 확정에 맞춰 바로 정리하기로 했습니다."],
    meetingMeta: {
      title: "프로모션 일정·예산 실행 계획",
    },
    memoHighlights: [{ linkedTopic: "일정 계획", mergeStatus: "merged", text: "담당자 확정이 우선입니다." }],
    mode: "planning",
    modeSpecific: {
      dependencies: ["디자인 시안 최종본"],
      milestones: ["오늘 초안 정리", "이번 주 일정 확정"],
      scopeItems: ["프로모션 일정", "예산", "랜딩 문구"],
    },
    openQuestions: [],
    risksOrDependencies: [{ severity: "medium", text: "디자인 시안 확정이 늦어질 수 있습니다." }],
    topics: [{ decisions: ["이번 주 일정 확정"], keyPoints: ["예산과 랜딩 문구 초안 정리"], openQuestions: [], source: { memo: true, transcript: true }, summary: "실행 순서를 정리했습니다.", topic: "일정 계획" }],
  };
}
function createDb(state) {
  function ensureCollection(name) {
    const resolvedName = String(name || "").trim();
    if (!state.collections.has(resolvedName)) {
      state.collections.set(resolvedName, new Map());
    }
    return state.collections.get(resolvedName);
  }
  function getFieldValue(source, path) {
    return String(path || "")
      .split(".")
      .filter(Boolean)
      .reduce((current, key) => (current == null ? undefined : current[key]), source);
  }
  function buildDocSnapshot(collectionName, docId, value) {
    return {
      data() {
        return cloneValue(value);
      },
      exists: value !== undefined,
      id: docId,
      ref: createDocRef(collectionName, docId),
    };
  }
  function createDocRef(collectionName, id) {
    const resolvedCollectionName = String(collectionName || "").trim();
    const collectionState = ensureCollection(resolvedCollectionName);
    const resolvedId = String(id || `doc-${state.nextId++}`);
    return {
      id: resolvedId,
      async get() {
        return buildDocSnapshot(resolvedCollectionName, resolvedId, collectionState.get(resolvedId));
      },
      async delete() {
        collectionState.delete(resolvedId);
      },
      async set(value, options = {}) {
        const nextValue = cloneValue(value);
        if (options.merge && collectionState.has(resolvedId)) {
          collectionState.set(resolvedId, deepMerge(collectionState.get(resolvedId), nextValue));
          return;
        }
        collectionState.set(resolvedId, nextValue);
      },
    };
  }
  function createQuery(collectionName, statePatch = {}) {
    const queryState = {
      filters: Array.isArray(statePatch.filters) ? statePatch.filters : [],
      limitCount: Number.isFinite(statePatch.limitCount) ? statePatch.limitCount : null,
      orderBy: statePatch.orderBy || null,
      startAfterId: statePatch.startAfterId || "",
    };
    return {
      where(field, operator, value) {
        return createQuery(collectionName, {
          ...queryState,
          filters: [...queryState.filters, { field, operator, value }],
        });
      },
      orderBy(field, direction = "asc") {
        return createQuery(collectionName, {
          ...queryState,
          orderBy: {
            direction: normalizeText(direction).toLowerCase() === "desc" ? "desc" : "asc",
            field,
          },
        });
      },
      limit(limitCount) {
        return createQuery(collectionName, {
          ...queryState,
          limitCount: Math.max(0, Number(limitCount) || 0),
        });
      },
      startAfter(snapshot) {
        return createQuery(collectionName, {
          ...queryState,
          startAfterId: normalizeText(snapshot?.id || snapshot?.ref?.id),
        });
      },
      async get() {
        const collectionState = ensureCollection(collectionName);
        let entries = Array.from(collectionState.entries());
        for (const filter of queryState.filters) {
          entries = entries.filter(([, value]) => {
            if (filter.operator !== "==") {
              throw new Error(`Unsupported query operator: ${filter.operator}`);
            }
            return getFieldValue(value, filter.field) === filter.value;
          });
        }
        if (queryState.orderBy?.field) {
          const direction = queryState.orderBy.direction === "desc" ? -1 : 1;
          entries.sort((left, right) => {
            const leftValue = getFieldValue(left[1], queryState.orderBy.field);
            const rightValue = getFieldValue(right[1], queryState.orderBy.field);
            if (leftValue === rightValue) {
              return left[0].localeCompare(right[0]) * direction;
            }
            return (leftValue < rightValue ? -1 : 1) * direction;
          });
        }
        if (queryState.startAfterId) {
          const startIndex = entries.findIndex(([docId]) => docId === queryState.startAfterId);
          if (startIndex >= 0) {
            entries = entries.slice(startIndex + 1);
          }
        }
        if (queryState.limitCount != null) {
          entries = entries.slice(0, queryState.limitCount);
        }
        return {
          docs: entries.map(([docId, value]) => buildDocSnapshot(collectionName, docId, value)),
        };
      },
    };
  }
  function resolveDoc(ref) {
    return ref && typeof ref.get === "function" ? ref : null;
  }
  return {
    batch() {
      const operations = [];
      return {
        delete(ref) {
          operations.push(() => ref.delete());
        },
        set(ref, value, options) {
          operations.push(() => ref.set(value, options));
        },
        update(ref, value) {
          operations.push(() => ref.set(value, { merge: true }));
        },
        async commit() {
          for (const operation of operations) {
            await operation();
          }
        },
      };
    },
    collection(name) {
      const resolvedCollectionName = String(name || "").trim();
      ensureCollection(resolvedCollectionName);
      return {
        doc(id) {
          return createDocRef(resolvedCollectionName, id);
        },
        get() {
          return createQuery(resolvedCollectionName).get();
        },
        limit(limitCount) {
          return createQuery(resolvedCollectionName).limit(limitCount);
        },
        orderBy(field, direction) {
          return createQuery(resolvedCollectionName).orderBy(field, direction);
        },
        startAfter(snapshot) {
          return createQuery(resolvedCollectionName).startAfter(snapshot);
        },
        where(field, operator, value) {
          return createQuery(resolvedCollectionName).where(field, operator, value);
        },
      };
    },
    async runTransaction(work) {
      const transaction = {
        async get(ref) {
          const doc = resolveDoc(ref);
          if (!doc) {
            throw new Error("Unsupported transaction ref");
          }
          return doc.get();
        },
        set(ref, value, options) {
          const doc = resolveDoc(ref);
          if (!doc) {
            throw new Error("Unsupported transaction ref");
          }
          return doc.set(value, options);
        },
        update(ref, value) {
          const doc = resolveDoc(ref);
          if (!doc) {
            throw new Error("Unsupported transaction ref");
          }
          return doc.set(value, { merge: true });
        },
        delete(ref) {
          const doc = resolveDoc(ref);
          if (!doc) {
            throw new Error("Unsupported transaction ref");
          }
          return doc.delete();
        },
      };
      return work(transaction);
    },
  };
}
function createBucket(state) {
  return {
    file(path) {
      const normalizedPath = String(path || "").trim();
      return {
        async delete() {
          const current = state.uploads.get(normalizedPath) || {};
          state.uploads.set(normalizedPath, { ...current, deleted: true });
        },
        async download() {
          const current = state.uploads.get(normalizedPath);
          return [Buffer.from(current?.buffer || Buffer.alloc(0))];
        },
        async save(buffer, options = {}) {
          state.uploads.set(normalizedPath, {
            buffer: Buffer.from(buffer),
            contentType: options.contentType || "",
            deleted: false,
            metadata: cloneValue(options.metadata || {}),
          });
        },
      };
    },
  };
}
function createMemoryState() {
  return {
    collections: new Map(),
    customTokens: [],
    events: [],
    nextId: 1,
    openaiRequests: [],
    openaiSummaryRequests: [],
    uploads: new Map(),
  };
}
async function invokeHandler(handler, request) {
  const response = createResponse();
  await handler(request, response);
  return response;
}
async function invokeJobWriteTrigger(handlers, state, jobId, beforeValue) {
  const collection = state.collections.get(JOB_COLLECTION) || new Map();
  const afterValue = cloneValue(collection.get(jobId));
  await handlers.processQueuedMeetingJobWrite({
    data: {
      after: {
        data() {
          return cloneValue(afterValue);
        },
        exists: Boolean(afterValue),
      },
      before: {
        data() {
          return cloneValue(beforeValue);
        },
        exists: Boolean(beforeValue),
      },
    },
  });
}
function createStateDocRef(state, collectionName, docId) {
  const resolvedCollection = String(collectionName || "").trim();
  const resolvedDocId = String(docId || "").trim();
  if (!state.collections.has(resolvedCollection)) {
    state.collections.set(resolvedCollection, new Map());
  }
  const collection = state.collections.get(resolvedCollection);
  return {
    id: resolvedDocId,
    async get() {
      return {
        data() {
          return cloneValue(collection.get(resolvedDocId));
        },
        exists: collection.has(resolvedDocId),
        id: resolvedDocId,
        ref: createStateDocRef(state, resolvedCollection, resolvedDocId),
      };
    },
    async delete() {
      collection.delete(resolvedDocId);
    },
    async set(value, options = {}) {
      const nextValue = cloneValue(value);
      if (options.merge && collection.has(resolvedDocId)) {
        collection.set(resolvedDocId, deepMerge(collection.get(resolvedDocId), nextValue));
        return;
      }
      collection.set(resolvedDocId, nextValue);
    },
  };
}
async function invokeDeletionWriteTrigger(handlers, state, taskId, beforeValue) {
  const collection = state.collections.get(DELETION_COLLECTION) || new Map();
  const afterValue = cloneValue(collection.get(taskId));
  const ref = createStateDocRef(state, DELETION_COLLECTION, taskId);
  await handlers.processMeetingDeletionWrite({
    data: {
      after: {
        data() {
          return cloneValue(afterValue);
        },
        exists: Boolean(afterValue),
        ref,
      },
      before: {
        data() {
          return cloneValue(beforeValue);
        },
        exists: Boolean(beforeValue),
        ref,
      },
    },
  });
}
async function invokePartWriteTrigger(handlers, state, docId, beforeValue) {
  const collection = state.collections.get(JOB_PART_COLLECTION) || new Map();
  const afterValue = cloneValue(collection.get(docId));
  const ref = createStateDocRef(state, JOB_PART_COLLECTION, docId);
  await handlers.processQueuedMeetingJobPartWrite({
    data: {
      after: {
        data() {
          return cloneValue(afterValue);
        },
        exists: Boolean(afterValue),
        id: docId,
        ref,
      },
      before: {
        data() {
          return cloneValue(beforeValue);
        },
        exists: Boolean(beforeValue),
        id: docId,
        ref,
      },
    },
  });
}
async function invokeFinalizerWriteTrigger(handlers, state, docId, beforeValue) {
  const collection = state.collections.get(JOB_FINALIZER_COLLECTION) || new Map();
  const afterValue = cloneValue(collection.get(docId));
  const ref = createStateDocRef(state, JOB_FINALIZER_COLLECTION, docId);
  await handlers.finalizeChunkedMeetingJobWrite({
    data: {
      after: {
        data() {
          return cloneValue(afterValue);
        },
        exists: Boolean(afterValue),
        id: docId,
        ref,
      },
      before: {
        data() {
          return cloneValue(beforeValue);
        },
        exists: Boolean(beforeValue),
        id: docId,
        ref,
      },
    },
  });
}
async function drainChunkedMeetingPipeline(handlers, state, jobId) {
  const normalizedJobId = String(jobId || "").trim();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let progressed = false;
    const queuedParts = Array.from((state.collections.get(JOB_PART_COLLECTION) || new Map()).entries())
      .filter(([, value]) => String(value?.jobId || "").trim() === normalizedJobId)
      .filter(([, value]) => String(value?.status || "").trim() === "queued")
      .map(([docId]) => docId);
    for (const docId of queuedParts) {
      await invokePartWriteTrigger(handlers, state, docId);
      progressed = true;
    }
    const queuedFinalizers = Array.from((state.collections.get(JOB_FINALIZER_COLLECTION) || new Map()).entries())
      .filter(([docId, value]) => docId === normalizedJobId || String(value?.jobId || "").trim() === normalizedJobId)
      .filter(([, value]) => String(value?.status || "").trim() === "queued")
      .map(([docId]) => docId);
    for (const docId of queuedFinalizers) {
      await invokeFinalizerWriteTrigger(handlers, state, docId);
      progressed = true;
    }
    const currentJob = cloneValue((state.collections.get(JOB_COLLECTION) || new Map()).get(normalizedJobId));
    const currentStatus = String(currentJob?.status || "").trim();
    if (currentStatus === "succeeded" || currentStatus === "failed") {
      return;
    }
    if (!progressed) {
      return;
    }
  }
}
function createResponse() {
  return {
    jsonBody: null,
    statusCode: 200,
    json(payload) {
      this.jsonBody = cloneValue(payload);
      return this;
    },
    status(code) {
      this.statusCode = Number(code) || 500;
      return this;
    },
  };
}
function deepMerge(base, patch) {
  const nextBase = base && typeof base === "object" ? base : {};
  const nextPatch = patch && typeof patch === "object" ? patch : {};
  const result = Array.isArray(nextPatch) ? [] : { ...cloneValue(nextBase) };
  for (const [key, value] of Object.entries(nextPatch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(nextBase[key], value);
      continue;
    }
    result[key] = cloneValue(value);
  }
  return result;
}
function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
module.exports = {
  DELETION_COLLECTION,
  JOB_COLLECTION,
  JOB_FINALIZER_COLLECTION,
  JOB_PART_COLLECTION,
  MEETING_COLLECTION,
  WORKSPACE_SESSION_COLLECTION,
  createDeps,
  createMemoryState,
  drainChunkedMeetingPipeline,
  invokeDeletionWriteTrigger,
  invokeHandler,
  invokeJobWriteTrigger,
  invokePartWriteTrigger,
};
