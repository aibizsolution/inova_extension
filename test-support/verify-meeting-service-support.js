const JOB_COLLECTION = "integration_inova_meeting_jobs";
const ARTIFACT_COLLECTION = "integration_inova_meeting_artifacts";
const COMMAND_COLLECTION = "integration_inova_meeting_commands";
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
              const fileName = String(request?.file?.name || request?.file?.filename || "");
              state.openaiRequests.push({
                chunking_strategy: request.chunking_strategy || "",
                fileName,
                language: request.language || "",
                model: request.model || "",
                response_format: request.response_format || "",
              });
              if (fileName.includes("microphone-test")) {
                return {
                  duration: 22,
                  language: "ko",
                  segments: [
                    {
                      end: 22,
                      start: 0,
                      text: "녹음이 잘 되고 있는지 테스트를 하는 중입니다. 이번 수정이 잘 반영되었기를 바랍니다. 근데 마이크는 어디에 있는 걸까요? 테스트하려면 마이크 위치를 정확히 알아야 되는데 마이크가 어디 있는지 모르겠습니다.",
                    },
                  ],
                  task: "transcribe",
                  text: "녹음이 잘 되고 있는지 테스트를 하는 중입니다. 이번 수정이 잘 반영되었기를 바랍니다. 근데 마이크는 어디에 있는 걸까요? 테스트하려면 마이크 위치를 정확히 알아야 되는데 마이크가 어디 있는지 모르겠습니다.",
                };
              }
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
              if (firstSystemMessage.includes("회의 전사 요약 프로필 분류기")) {
                state.openaiSummaryRequests.push({ kind: "classifier", model: request.model || "", prompt: userPrompt, systemPrompt: firstSystemMessage });
                const profile = /테스트|마이크|장비|점검/.test(userPrompt) ? "compact" : "full";
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          profile,
                          reason: profile === "compact" ? "짧은 테스트성 전사입니다." : "",
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
              const isCompact = firstSystemMessage.includes("짧은 테스트성 또는 저신호 전사");
              const sectionMatch = userPrompt.match(/섹션 키:\s*([a-zA-Z]+)/);
              if (sectionMatch) {
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify(createSectionEditFixture({
                          mode,
                          sectionKey: sectionMatch[1],
                          userPrompt,
                        })),
                      },
                    },
                  ],
                };
              }
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify(isCompact ? createCompactNotesFixture(userPrompt) : createNotesFixture(mode)),
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
      discussionFlow: [{
        heading: "후보자 응답 평가",
        keyPoints: ["문제 구조화가 빠르고 핵심을 먼저 설명했다.", "운영 경험은 후속 질문이 더 필요하다."],
        narrative: "후보자는 핵심 쟁점을 빠르게 구조화해 설명했지만, 대규모 운영 경험은 추가 확인이 필요하다는 의견이 정리되었습니다.",
      }],
      meetingMeta: {
        datetime: "",
        participants: ["채용 리드", "면접관"],
        purpose: "후보자의 답변 내용을 정리하고 다음 인터뷰 라운드 진행 여부와 후속 확인 질문을 정리합니다.",
        title: "후보자 응답 및 후속 인터뷰 정리",
      },
      openQuestions: ["대규모 운영 환경에서의 장애 대응 경험을 어느 수준까지 검증할지 추가 합의가 필요합니다."],
      summary: "후보자 강점은 확인됐고 운영 경험은 추가 검증이 필요합니다.",
      overview: "후보자의 문제 구조화와 커뮤니케이션은 강점으로 확인됐고, 운영 경험은 다음 라운드에서 더 구체적으로 확인하기로 했습니다.",
      risksOrDependencies: [{ severity: "medium", text: "운영 경험 검증이 부족하면 합격 판단 근거가 약해질 수 있습니다." }],
      sourceTrace: [{ evidence: "운영 경험 추가 확인 필요", itemRef: "추가 맥락", itemType: "memo" }],
    };
  }
  if (mode === "general") {
    return {
      actionItems: [{ assignee: "운영 팀", dueDate: "", status: "open", task: "외부 협업 일정 초안을 정리합니다." }],
      decisions: [{ confidence: "medium", owner: "", text: "전체 일정은 운영 준비와 외부 협업 일정에 맞춰 다시 조정하기로 했다." }],
      discussionFlow: [{
        heading: "운영 일정 조정",
        keyPoints: ["외부 협업 일정이 전체 오픈 시점을 좌우한다.", "운영 구조 정리가 선행되어야 한다."],
        narrative: "플랫폼 준비 상황과 외부 협업 일정을 함께 검토하면서, 운영 구조가 정리되어야 전체 일정도 다시 맞출 수 있다는 점이 공감되었습니다.",
      }],
      meetingMeta: {
        datetime: "",
        participants: ["운영 팀"],
        purpose: "플랫폼 준비 상황과 외부 협업 일정을 함께 검토하고 운영 일정을 다시 정리합니다.",
        title: "플랫폼 구축 및 운영 일정 일반 회의 정리",
      },
      openQuestions: [
        { question: "운영 구조와 명분이 아직 정리되지 않았습니다.", status: "open" },
        { text: "외부 협업 일정을 언제까지 확정할지 추가 논의가 필요합니다." },
      ],
      summary: "운영 구조와 외부 협업 일정을 함께 정리해야 전체 일정이 안정됩니다.",
      overview: "운영 구조와 외부 협업 일정이 함께 정리되어야 전체 오픈 일정도 안정적으로 확정할 수 있다는 점이 회의의 핵심 결론이었습니다.",
      risksOrDependencies: [
        { severity: "medium", text: "업체 계약이 늦어지면 전체 오픈 일정이 밀릴 수 있습니다." },
      ],
      sourceTrace: [{ evidence: "외부 협업 일정 검토", itemRef: "전사", itemType: "transcript" }],
    };
  }
  return {
    actionItems: [{ assignee: "마케팅 팀", dueDate: "오늘", status: "open", task: "예산과 랜딩 문구 초안을 정리합니다." }],
    decisions: [{ confidence: "high", owner: "팀 리드", text: "신규 프로모션 일정은 이번 주 안에 확정합니다." }],
    discussionFlow: [{
      heading: "프로모션 일정 확정",
      keyPoints: ["이번 주 안에 일정 확정", "예산과 랜딩 문구 초안은 오늘 정리"],
      narrative: "프로모션 실행 시점을 확정하는 것이 가장 중요한 안건이었고, 이를 위해 예산과 랜딩 문구 초안을 바로 정리하기로 했습니다.",
    }],
    meetingMeta: {
      datetime: "",
      participants: ["팀 리드", "마케팅 팀"],
      purpose: "신규 프로모션 일정과 예산, 랜딩 문구 준비 순서를 정리하고 실행 계획을 확정합니다.",
      title: "프로모션 일정·예산 실행 계획",
    },
    openQuestions: [],
    summary: "프로모션 일정은 이번 주 안에 확정하고 초안은 바로 정리하기로 했습니다.",
    overview: "신규 프로모션 일정 확정이 회의의 중심이었고, 예산과 랜딩 문구 초안은 이번 주 일정 확정에 맞춰 바로 정리하기로 했습니다.",
    risksOrDependencies: [{ severity: "medium", text: "디자인 시안 확정이 늦어질 수 있습니다." }],
    sourceTrace: [{ evidence: "담당자 확정이 우선", itemRef: "추가 맥락", itemType: "memo" }],
  };
}

function createSectionEditFixture({ mode, sectionKey, userPrompt }) {
  const notes = createNotesFixture(mode);
  if (sectionKey === "summary") {
    return {
      summary: /(?:10|20)글자/.test(userPrompt)
        ? "핵심 점검"
        : "일정 확정과 초안 정리가 핵심입니다.",
    };
  }
  if (sectionKey === "overview") {
    const isShortSummaryRequest = /(?:10|20)글자/.test(userPrompt);
    if (isShortSummaryRequest) {
      return {
        meetingMeta: {
          ...notes.meetingMeta,
          purpose: "",
        },
        summary: notes.summary,
        overview: "테스트 점검",
      };
    }
    return {
      meetingMeta: {
        ...notes.meetingMeta,
        purpose: "",
      },
      summary: notes.summary,
      overview: "일정 확정과 초안 정리가 핵심으로 다시 정리됐습니다.",
    };
  }
  return notes;
}

function createCompactNotesFixture(userPrompt) {
  if (/마이크|녹음|테스트/.test(userPrompt)) {
    return {
      actionItems: [],
      decisions: [],
      discussionFlow: [],
      meetingMeta: {
        datetime: "",
        participants: [],
        purpose: "",
        title: "녹음 테스트 및 마이크 위치 확인",
      },
      openQuestions: ["마이크 위치 확인 필요"],
      summary: "녹음 테스트와 마이크 위치 확인이 언급됐다.",
      overview: "녹음 테스트와 수정 반영 여부 확인이 언급됐다. 마이크 위치를 몰라 테스트 진행이 어렵다는 말이 나왔다.",
      risksOrDependencies: [],
      sourceTrace: [{ evidence: "마이크 위치를 모르겠다고 언급함", itemRef: "전사", itemType: "transcript" }],
    };
  }
  return {
    actionItems: [],
    decisions: [],
    discussionFlow: [],
    meetingMeta: {
      datetime: "",
      participants: [],
      purpose: "",
      title: "짧은 상태 확인",
    },
    openQuestions: [],
    summary: "짧은 상태 확인 발화가 기록되었다.",
    overview: "짧은 상태 확인 성격의 발화가 기록되었다.",
    risksOrDependencies: [],
    sourceTrace: [{ evidence: "짧은 상태 확인", itemRef: "전사", itemType: "transcript" }],
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
async function invokeCommandWriteTrigger(handlers, state, commandId, beforeValue) {
  const collection = state.collections.get(COMMAND_COLLECTION) || new Map();
  const afterValue = cloneValue(collection.get(commandId));
  const ref = createStateDocRef(state, COMMAND_COLLECTION, commandId);
  await handlers.processQueuedMeetingCommandWrite({
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

function normalizeText(value) {
  return String(value || "").trim();
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
module.exports = {
  ARTIFACT_COLLECTION,
  COMMAND_COLLECTION,
  DELETION_COLLECTION,
  JOB_COLLECTION,
  JOB_FINALIZER_COLLECTION,
  JOB_PART_COLLECTION,
  MEETING_COLLECTION,
  WORKSPACE_SESSION_COLLECTION,
  createDeps,
  createMemoryState,
  drainChunkedMeetingPipeline,
  invokeCommandWriteTrigger,
  invokeDeletionWriteTrigger,
  invokeHandler,
  invokeJobWriteTrigger,
  invokePartWriteTrigger,
};
