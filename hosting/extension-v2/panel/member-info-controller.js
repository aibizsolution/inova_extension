(function initMemberInfoController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { normalizeText, readErrorMessage, resolveBrowserCapabilities } = namespace.panelUtils;
  const MEMBER_INFO_CAPABILITY_ID = "member.info.show";
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "runtime.invoke.v1",
  ]);

  function create(options = {}) {
    const browserCapabilities = resolveBrowserCapabilities(options);
    const invokeCapability = typeof browserCapabilities.invokeCapability === "function"
      ? browserCapabilities.invokeCapability
      : async () => ({});
    const scheduleRender = typeof options.scheduleRender === "function"
      ? options.scheduleRender
      : () => {};
    const traceMember = typeof options.traceMember === "function"
      ? options.traceMember
      : () => {};

    const state = {
      capabilities: [],
      checkedAt: "",
      data: null,
      degraded: false,
      degradedReason: "",
      error: "",
      initialized: false,
      loading: false,
      source: "none",
    };

    return {
      buildViewState,
      getMemberInfoCount,
      handleMemberAction,
      hasRequiredCapabilities,
      syncPanelState,
    };

    function syncPanelState(panelState, extensionCapabilities = []) {
      void panelState;
      state.capabilities = Array.isArray(extensionCapabilities)
        ? extensionCapabilities.map((value) => normalizeText(value)).filter(Boolean)
        : [];
    }

    function hasRequiredCapabilities() {
      return REQUIRED_EXTENSION_CAPABILITIES.every((capability) => state.capabilities.includes(capability));
    }

    function getMemberInfoCount() {
      return buildViewState().member?.providerIdentity?.available ? 1 : 0;
    }

    function buildViewState(fallbackMemberTool = {}) {
      const canUseRuntime = hasRequiredCapabilities();
      const canRunWorkflow = hasCapability(MEMBER_INFO_CAPABILITY_ID);
      return {
        ...fallbackMemberTool,
        canRefresh: canUseRuntime && canRunWorkflow && !state.loading,
        capabilityError: canUseRuntime
          ? canRunWorkflow
            ? ""
            : "회원 정보 기능이 현재 capability catalog에 없거나 비활성화되어 있어요."
          : "확장 런타임 연결이 필요해요.",
        checkedAt: normalizeText(state.checkedAt),
        degraded: Boolean(state.degraded),
        degradedReason: normalizeText(state.degradedReason),
        error: normalizeText(state.error),
        initialized: Boolean(state.initialized),
        loading: Boolean(state.loading),
        member: normalizeMemberInfo(state.data),
        source: normalizeText(state.source) || "none",
      };
    }

    async function handleMemberAction(action) {
      const normalizedAction = normalizeText(action);
      if (normalizedAction !== "refresh" && normalizedAction !== "show") {
        return false;
      }
      await loadMemberInfo();
      return true;
    }

    async function loadMemberInfo() {
      if (state.loading) {
        return state.data;
      }
      if (!hasRequiredCapabilities()) {
        state.error = "확장 런타임 연결이 필요해요.";
        state.degraded = true;
        state.degradedReason = "runtime-capability-missing";
        scheduleRender();
        return state.data;
      }
      if (!hasCapability(MEMBER_INFO_CAPABILITY_ID)) {
        state.error = "회원 정보 기능이 현재 capability catalog에 없거나 비활성화되어 있어요.";
        state.degraded = true;
        state.degradedReason = "capability-disabled";
        scheduleRender();
        return state.data;
      }

      state.loading = true;
      state.error = "";
      scheduleRender();
      try {
        traceMember("34.hosted.member.workflow.request", {
          capabilityId: MEMBER_INFO_CAPABILITY_ID,
        });
        const result = await invokeCapability(
          MEMBER_INFO_CAPABILITY_ID,
          { requestedAt: new Date().toISOString() },
          { pilotEnabled: true }
        );
        const memberInfo = normalizeWorkflowResult(result);
        state.data = memberInfo;
        state.checkedAt = new Date().toISOString();
        state.initialized = true;
        state.source = "workflow";
        state.degraded = !memberInfo.providerIdentity.available;
        state.degradedReason = memberInfo.providerIdentity.available ? "" : "provider-identity-missing";
        state.error = memberInfo.providerIdentity.available ? "" : "회원 정보를 아직 확인하지 못했어요. i-Nova 로그인을 확인해 주세요.";
        traceMember("35.hosted.member.workflow.success", {
          available: memberInfo.providerIdentity.available,
          provider: memberInfo.providerIdentity.provider,
          workflowId: memberInfo.workflowId,
        });
      } catch (error) {
        state.degraded = true;
        state.degradedReason = "member-info-workflow-failed";
        state.error = readErrorMessage(error, "회원 정보를 불러오지 못했어요.");
        state.source = "none";
        traceMember("35.hosted.member.workflow.error", {
          error: state.error,
        });
      } finally {
        state.loading = false;
        scheduleRender();
      }
      return state.data;
    }

    function normalizeWorkflowResult(result) {
      const payload = result?.output && typeof result.output === "object" ? result.output : {};
      return {
        providerIdentity: normalizeProviderIdentity(payload.providerIdentity),
        settings: {
          meetingWorkspaceTarget: normalizeText(payload.settings?.meetingWorkspaceTarget),
        },
        stepCount: Number(result?.stepCount) || 0,
        uiPreferences: {
          activePromptTab: normalizeText(payload.uiPreferences?.activePromptTab),
          activeTool: normalizeText(payload.uiPreferences?.activeTool),
          panelOpen: payload.uiPreferences?.panelOpen === true,
        },
        workflowId: normalizeText(result?.workflowId),
      };
    }

    function normalizeMemberInfo(memberInfo) {
      const normalized = memberInfo && typeof memberInfo === "object" ? memberInfo : {};
      return {
        providerIdentity: normalizeProviderIdentity(normalized.providerIdentity),
        settings: {
          meetingWorkspaceTarget: normalizeText(normalized.settings?.meetingWorkspaceTarget),
        },
        stepCount: Number(normalized.stepCount) || 0,
        uiPreferences: {
          activePromptTab: normalizeText(normalized.uiPreferences?.activePromptTab),
          activeTool: normalizeText(normalized.uiPreferences?.activeTool),
          panelOpen: normalized.uiPreferences?.panelOpen === true,
        },
        workflowId: normalizeText(normalized.workflowId),
      };
    }

    function normalizeProviderIdentity(providerIdentity) {
      const providerUserKey = normalizeText(providerIdentity?.providerUserKey);
      const email = normalizeText(providerIdentity?.email).toLowerCase();
      return {
        available: Boolean(providerIdentity?.available || providerUserKey || email),
        displayName: normalizeText(providerIdentity?.displayName),
        email,
        numericUserId: Number.isFinite(Number(providerIdentity?.numericUserId))
          ? Number(providerIdentity.numericUserId)
          : null,
        provider: normalizeText(providerIdentity?.provider || "inova") || "inova",
        providerUserKey,
      };
    }

    function hasCapability(capabilityId) {
      return state.capabilities.includes(capabilityId);
    }
  }

  namespace.memberInfoController = { create };
})(globalThis);
