// Workspace guard helpers extracted from operator.js so unsaved-change prompts
// stay reusable while the operator shell is split into domain modules.
function workspaceExitMessage(tab) {
  return `You have unsaved changes in ${workspaceTabLabel(tab, currentWorkspaceBlueprint())}. If you leave this window now, those edits will be lost.`;
}

async function confirmWorkspaceChange(currentTab, nextTab) {
  if (!currentTab || currentTab === nextTab) return true;
  if (!WORKSPACE_DIRTY_TABS.has(currentTab)) return true;
  return showConfirmModal(workspaceExitMessage(currentTab), "Leave without saving", "Stay here");
}

const WORKSPACE_GUARD_HELPERS = {
  workspaceExitMessage,
  confirmWorkspaceChange,
};

window.PROOFLINK_OPERATOR_WORKSPACE_GUARD = {
  ...(window.PROOFLINK_OPERATOR_WORKSPACE_GUARD || {}),
  ...WORKSPACE_GUARD_HELPERS,
};

Object.assign(window, WORKSPACE_GUARD_HELPERS);
