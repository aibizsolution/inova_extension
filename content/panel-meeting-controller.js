(function initPanelMeetingController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const render = typeof deps.render === "function" ? deps.render : () => {};

    async function handleAction(action, detail = {}) {
      if (namespace.session.normalizeText(state.meetingUi.pending.action)) {
        traceMeetingFlow("60.top.meeting.pending.skip", {
          action,
          pending: state.meetingUi.pending,
        });
        return;
      }
      traceMeetingFlow("61.top.meeting.handle.start", {
        action,
        detail,
      });
      const providerIdentity = namespace.providerIdentity.getCurrent();
      await providerIdentitySync.syncToStorage(`meeting-action:${action}`, providerIdentity);
      traceMeetingFlow("62.top.meeting.identity.synced", {
        action,
        providerUserKey: namespace.session.normalizeText(providerIdentity?.providerUserKey),
      });
      const input = {
        jobId: namespace.session.normalizeText(detail.jobId),
        meetingId: namespace.session.normalizeText(detail.meetingId),
        title: namespace.session.normalizeText(detail.title || state.sessionTitle),
      };
      setPending({
        action: resolvePendingAction(action),
        jobId: input.jobId,
        meetingId: input.meetingId,
        startedAt: Date.now(),
        title: input.title,
      });
      logMeetingAction("click", {
        action,
        jobId: input.jobId,
        meetingId: input.meetingId,
        providerUserKey: namespace.session.normalizeText(providerIdentity?.providerUserKey),
        title: input.title,
        });
        try {
        if (action === "open-result" && (input.meetingId || input.jobId)) {
          traceMeetingFlow("63.top.meeting.bridge.open-result.start", input);
          const result = await namespace.meetingBridge.openMeetingResult(input, providerIdentity);
          logMeetingAction("success", {
            action,
            jobId: input.jobId,
            meetingId: input.meetingId,
            opened: Boolean(result?.opened),
            url: namespace.session.normalizeText(result?.url),
          });
          traceMeetingFlow("64.top.meeting.bridge.open-result.success", {
            meetingId: input.meetingId,
            opened: Boolean(result?.opened),
            url: namespace.session.normalizeText(result?.url),
          });
          setFeedback("결과 탭을 열었습니다.", "info", 1800);
          return;
        }
        if (action === "share" && input.meetingId) {
          traceMeetingFlow("63.top.meeting.bridge.share.start", input);
          const result = await namespace.meetingBridge.createMeetingShareLink(input, providerIdentity);
          const shareUrl = namespace.session.normalizeText(result?.shareUrl);
          if (!shareUrl) {
            throw new Error("공유 링크를 만들지 못했어요.");
          }
          patchShareState(input.meetingId, result?.share);
          await global.navigator.clipboard.writeText(shareUrl);
          logMeetingAction("success", {
            action,
            meetingId: input.meetingId,
            shareUrl,
          });
          traceMeetingFlow("64.top.meeting.bridge.share.success", {
            meetingId: input.meetingId,
            shareUrl,
          });
          setFeedback("공유 링크를 복사했습니다.", "info", 2200);
          meetingManager.scheduleSync(0);
          return;
        }
        if (action === "revoke-share" && input.meetingId) {
          traceMeetingFlow("63.top.meeting.bridge.revoke-share.start", input);
          const result = await namespace.meetingBridge.revokeMeetingShareLink(input, providerIdentity);
          patchShareState(input.meetingId, result?.share);
          logMeetingAction("success", {
            action,
            meetingId: input.meetingId,
          });
          traceMeetingFlow("64.top.meeting.bridge.revoke-share.success", {
            meetingId: input.meetingId,
          });
          setFeedback("공유 링크를 해제했습니다.", "info", 2200);
          meetingManager.scheduleSync(0);
          return;
        }
        traceMeetingFlow("63.top.meeting.bridge.open-workspace.start", input);
        const result = await namespace.meetingBridge.openMeetingWorkspace(input, providerIdentity);
        logMeetingAction("success", {
          action: "open-workspace",
          jobId: input.jobId,
          meetingId: input.meetingId,
          opened: Boolean(result?.opened),
          url: namespace.session.normalizeText(result?.url),
        });
        traceMeetingFlow("64.top.meeting.bridge.open-workspace.success", {
          meetingId: input.meetingId,
          opened: Boolean(result?.opened),
          url: namespace.session.normalizeText(result?.url),
        });
        setFeedback("작업실 탭을 열었습니다.", "info", 1800);
      } catch (error) {
        logMeetingAction("error", {
          action,
          error: error instanceof Error ? error.message : String(error || ""),
          jobId: input.jobId,
          meetingId: input.meetingId,
        });
        traceMeetingFlow("65.top.meeting.bridge.error", {
          action,
          error: error instanceof Error ? error.message : String(error || ""),
          jobId: input.jobId,
          meetingId: input.meetingId,
        });
        if (namespace.panelDebug?.isEnabled?.()) {
          console.error("[i-Nova Bookmarks] meeting page open failed", error);
        }
        setFeedback(error instanceof Error ? error.message : "작업실을 열지 못했어요. 다시 시도해 주세요.", "error", 3600);
      } finally {
        clearPending();
      }
    }

    function buildToolState(meetingHub) {
      const normalized = namespace.meetingManager.mergeMeetingHub(meetingHub);
      return {
        ...normalized,
        count: Array.isArray(normalized.items) ? normalized.items.length : 0,
        feedback: state.meetingUi.feedback,
        pending: state.meetingUi.pending,
      };
    }

    function clearPending() {
      state.meetingUi.pending = { action: "", jobId: "", meetingId: "", startedAt: 0, title: "" };
      render();
    }

    function patchShareState(meetingId, share) {
      const normalizedMeetingId = namespace.session.normalizeText(meetingId);
      if (!normalizedMeetingId || !Array.isArray(state.meetingHub?.items) || !state.meetingHub.items.length) {
        return;
      }
      const nextShare = normalizeShare(share);
      let changed = false;
      const nextItems = state.meetingHub.items.map((item) => {
        if (namespace.session.normalizeText(item?.meetingId) !== normalizedMeetingId) {
          return item;
        }
        changed = true;
        return {
          ...(item && typeof item === "object" ? item : {}),
          share: nextShare,
        };
      });
      if (!changed) {
        return;
      }
      state.meetingHub = namespace.meetingManager.mergeMeetingHub({
        ...state.meetingHub,
        items: nextItems,
      });
      render();
    }

    function setFeedback(text, tone = "info", timeoutMs = 2200) {
      global.clearTimeout(state.meetingUi.feedbackTimer);
      const nextText = namespace.session.normalizeText(text);
      state.meetingUi.feedback = nextText
        ? {
            text: nextText,
            tone: namespace.session.normalizeText(tone) || "info",
          }
        : null;
      render();
      if (!nextText || timeoutMs <= 0) {
        state.meetingUi.feedbackTimer = 0;
        return;
      }
      state.meetingUi.feedbackTimer = global.setTimeout(() => {
        state.meetingUi.feedback = null;
        state.meetingUi.feedbackTimer = 0;
        render();
      }, timeoutMs);
    }

    function setPending(pending) {
      state.meetingUi.pending = {
        action: namespace.session.normalizeText(pending?.action),
        jobId: namespace.session.normalizeText(pending?.jobId),
        meetingId: namespace.session.normalizeText(pending?.meetingId),
        startedAt: Math.max(0, Number(pending?.startedAt) || Date.now()),
        title: namespace.session.normalizeText(pending?.title),
      };
      render();
    }

    return {
      buildToolState,
      handleAction,
      patchShareState,
      setFeedback,
      setPending,
    };
  }

  function logMeetingAction(event, payload) {
    namespace.panelDebug?.log?.(`panel.action.${namespace.session.normalizeText(event)}`, payload || {});
  }

  function traceMeetingFlow(step, payload = {}) {
    if (!namespace.panelDebug?.isEnabled?.()) {
      return false;
    }
    const detail = payload && typeof payload === "object" ? payload : {};
    console.info(`[inova:meeting] ${namespace.session.normalizeText(step) || "trace"}`, detail);
    namespace.panelDebug?.log?.(`trace.meeting.${namespace.session.normalizeText(step) || "trace"}`, detail);
    return true;
  }

  function normalizeShare(share) {
    if (share && typeof share === "object") {
      return {
        active: Boolean(share.active),
        createdAt: namespace.session.normalizeText(share.createdAt),
        createdBy: share.createdBy && typeof share.createdBy === "object" ? { ...share.createdBy } : {},
        revokedAt: namespace.session.normalizeText(share.revokedAt),
        shareId: namespace.session.normalizeText(share.shareId),
        status: namespace.session.normalizeText(share.status),
      };
    }
    return {
      active: false,
      createdAt: "",
      createdBy: {},
      revokedAt: "",
      shareId: "",
      status: "",
    };
  }

  function resolvePendingAction(action) {
    if (action === "open-result") return "open-result";
    if (action === "share") return "share";
    if (action === "revoke-share") return "revoke-share";
    return "open-workspace";
  }

  namespace.panelMeetingController = { create };
})(globalThis);
