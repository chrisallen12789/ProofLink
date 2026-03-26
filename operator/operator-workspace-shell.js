// Shared workspace shell behavior extracted from operator.js so panel chrome,
// related-view navigation, and panel back behavior live in one place.
(function attachOperatorWorkspaceShell(global) {
  function workspaceContextTabsFor(tab, blueprint = currentWorkspaceBlueprint()) {
    const group = WORKSPACE_CONTEXT_GROUPS[tab] || [tab];
    const seenLabels = new Set();
    return uniqList(group.filter((candidate) => {
      if (!isTabVisibleInWorkspace(candidate, blueprint)) return false;
      const labelKey = String(workspaceTabLabel(candidate, blueprint) || "").trim().toLowerCase();
      if (!labelKey) return false;
      if (seenLabels.has(labelKey)) return false;
      seenLabels.add(labelKey);
      return true;
    }));
  }

  function renderWorkspaceContextTabs() {
    const blueprint = currentWorkspaceBlueprint();
    const activeTab = document.querySelector(".tab.active")?.dataset.tab || "dashboard";
    workspacePanels().forEach((panel) => {
      const tab = panel.dataset.panel || "";
      if (!tab) return;
      const head = panel.querySelector(".panel-head");
      if (!head) return;
      let nav = panel.querySelector(".workspace-context-nav");
      if (!nav) {
        nav = document.createElement("div");
        nav.className = "workspace-context-nav";
        head.insertAdjacentElement("afterend", nav);
      }
      const tabs = tab === "dashboard" ? [tab] : workspaceContextTabsFor(tab, blueprint);
      if (tabs.length <= 1) {
        nav.innerHTML = "";
        nav.classList.add("hidden");
        return;
      }
      nav.classList.remove("hidden");
      nav.innerHTML = `
        <div class="workspace-context-nav__label">Related views</div>
        <div class="workspace-context-nav__tabs">
          ${tabs.map((relatedTab) => `
            <button
              class="workspace-context-tab ${relatedTab === activeTab ? "is-active" : ""}"
              type="button"
              data-context-tab="${escapeAttr(relatedTab)}"
            >
              ${escapeHtml(workspaceTabLabel(relatedTab, blueprint))}
            </button>
          `).join("")}
        </div>
      `;
      nav.querySelectorAll("[data-context-tab]").forEach((button) => {
        button.addEventListener("click", () => switchTab(button.getAttribute("data-context-tab") || "dashboard"));
      });
    });
  }

  function ensureWorkspaceWindowShell() {
    workspacePanels().forEach((panel) => {
      panel.classList.add("workspace-window");
      const head = panel.querySelector(".panel-head");
      if (!head) return;
      if (!panel.querySelector(".workspace-window-body")) {
        const body = document.createElement("div");
        body.className = "workspace-window-body";
        Array.from(panel.children)
          .filter((child) => child !== head)
          .forEach((child) => body.appendChild(child));
        panel.appendChild(body);
      }
      let actions = head.querySelector(".panel-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "panel-actions";
        head.appendChild(actions);
      }
      if (!actions.querySelector(".workspace-window-controls")) {
        const controls = document.createElement("div");
        controls.className = "workspace-window-controls";
        controls.innerHTML = `
          <button class="workspace-window-btn" type="button" data-workspace-action="collapse">Collapse</button>
          <button class="workspace-window-btn is-close" type="button" data-workspace-action="close">Close</button>
        `;
        actions.appendChild(controls);
        controls.querySelector('[data-workspace-action="collapse"]')?.addEventListener("click", () => {
          setWorkspaceCollapsed(panel.dataset.panel, !panel.classList.contains("is-collapsed"));
        });
        controls.querySelector('[data-workspace-action="close"]')?.addEventListener("click", () => {
          switchTab("dashboard");
        });
      }
      updateWorkspaceWindowControls(panel.dataset.panel);
    });
  }

  function renderWorkspaceHub() {
    ensureWorkspaceWindowShell();
    renderWorkspaceContextTabs();
  }

  function renderPanelBackButtons() {
    const blueprint = currentWorkspaceBlueprint();
    document.querySelectorAll(".panel").forEach((panel) => {
      const panelTab = panel.dataset.panel;
      const actions = panel.querySelector(".panel-actions");
      if (!actions) return;

      let button = actions.querySelector("[data-panel-back]");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-ghost hidden";
        button.setAttribute("data-panel-back", panelTab);
        button.title = "Go back to the previous view";
        actions.prepend(button);
      }

      const previousTab = PREVIOUS_PANEL_TAB && PREVIOUS_PANEL_TAB !== panelTab && panelTab !== "dashboard"
        ? PREVIOUS_PANEL_TAB
        : "";

      if (!previousTab) {
        button.classList.add("hidden");
        button.textContent = "";
        return;
      }

      button.classList.remove("hidden");
      button.textContent = `Back to ${workspaceTabLabel(previousTab, blueprint)}`;
      button.onclick = () => switchTab(previousTab);
    });
  }

  const helpers = {
    ensureWorkspaceWindowShell,
    renderPanelBackButtons,
    renderWorkspaceContextTabs,
    renderWorkspaceHub,
    workspaceContextTabsFor,
  };

  global.PROOFLINK_OPERATOR_WORKSPACE_SHELL = {
    ...(global.PROOFLINK_OPERATOR_WORKSPACE_SHELL || {}),
    ...helpers,
  };

  Object.assign(global, helpers);
})(window);
