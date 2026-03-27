// Startup checklist helpers extracted from operator.js
// so first-win guidance stays separate from the main shell orchestration.
function renderStartupChecklist() {
  if (!startupChecklist) return;
  const blueprint = currentWorkspaceBlueprint();
  const catalogSingular = workspaceCatalogSingular(blueprint);
  const catalogTabLabel = workspaceTabLabel("products", blueprint);
  const orderLabel = workspaceOrderLabelLower(blueprint);
  const pricingReady = PRODUCTS_CACHE.some((row) => {
    const mode = String(row.pricing_mode || "").trim().toLowerCase();
    return Number(row.sell_price_cents || row.starting_price_cents || 0) > 0 || ["fixed", "starts_at", "quote"].includes(mode);
  });
  const brandingReady = !!(
    SETUP_STATE?.config?.logo_url ||
    SETUP_STATE?.config?.hero_image_url ||
    SETUP_STATE?.config?.tagline
  );
  const items = [
    { done: PRODUCTS_CACHE.length > 0, label: `Add your first ${catalogSingular}`, tab: "products", action: `Open ${catalogTabLabel}` },
    { done: PRODUCTS_CACHE.some((row) => !!row.is_active), label: `Make at least one ${catalogSingular} live for intake`, tab: "products", action: `Review ${catalogTabLabel}` },
    { done: pricingReady, label: workspaceUsesServiceCatalog(blueprint) ? "Give at least one service a usable price anchor" : `Price at least one ${catalogSingular}`, tab: workspaceUsesServiceCatalog(blueprint) ? "pricing" : "products", action: `Open ${workspaceTabLabel(workspaceUsesServiceCatalog(blueprint) ? "pricing" : "products", blueprint)}` },
    { done: CUSTOMERS_CACHE.length > 0, label: "Add your first customer", tab: "customers", action: "Open Customers" },
    { done: CRM_ORDERS_CACHE.length > 0, label: `Turn your first request into tracked ${orderLabel}`, tab: "orders", action: `Open ${workspaceTabLabel("orders", blueprint)}` },
    { done: EXPENSES_CACHE.length > 0, label: isServiceWorkspace(blueprint) ? `Track your first expense against real ${orderLabel}` : "Track your first expense", tab: "expenses", action: "Open Expenses" },
    { done: brandingReady, label: "Add branding, media, and public profile details", tab: "setup", action: "Open Setup" },
    { done: PAYMENTS_CACHE.length > 0, label: "Log your first payment, deposit, or offline collection", tab: "payments", action: "Open Payments" },
  ];

  items.splice(4, 0, {
    done: CUSTOMERS_CACHE.length > 0 || CRM_ORDERS_CACHE.length > 0 || PAYMENTS_CACHE.length > 0,
    label: "Bring over customers, open work, or payment history from your old spreadsheet or app",
    tab: "import",
    action: "Open Switch & Import",
  });

  if (isTabVisibleInWorkspace("bids", blueprint)) {
    items.splice(4, 0,
      { done: BIDS_CACHE.length > 0, label: "Create your first quote draft", tab: "bids", action: `Open ${workspaceBidLabel(blueprint)}` },
      { done: hasPricedBidDraft(), label: "Price out one real quote", tab: "bids", action: "Finish pricing" }
    );
  }
  if (isTabVisibleInWorkspace("plans", blueprint)) {
    items.splice(Math.min(items.length, 7), 0,
      { done: SERVICE_PLANS_CACHE.length > 0, label: "Turn one repeat customer into a recurring plan", tab: "plans", action: "Open Recurring Plans" }
    );
  }

  startupChecklist.innerHTML = items.map((item) => `
    <button class="checklist-item ${item.done ? "is-done" : ""}" type="button" data-tour-go="${escapeAttr(item.tab)}" style="width:100%;text-align:left;background:transparent;border:0;padding:0;cursor:pointer;">
      <span class="dot"></span>
      <span style="flex:1;">${escapeHtml(item.label)}</span>
      <span class="pill" style="margin-left:8px;">${escapeHtml(item.action)}</span>
    </button>
  `).join("");

  // Auto-hide the checklist card once every item is completed
  const doc = typeof document !== "undefined" ? document : null;
  const card = doc?.getElementById?.("sideChecklistCard");
  if (card) {
    const allDone = items.every((item) => item.done);
    card.style.display = allDone ? "none" : "";
  }
}

let STARTUP_CHECKLIST_BINDINGS_BOUND = false;
function initStartupChecklistBindings() {
  if (STARTUP_CHECKLIST_BINDINGS_BOUND) return;
  STARTUP_CHECKLIST_BINDINGS_BOUND = true;

  startupChecklist?.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-tour-go]");
    if (!trigger) return;
    const tab = trigger.getAttribute("data-tour-go");
    if (!tab) return;
    switchTab(tab);
  });
}

window.PROOFLINK_OPERATOR_STARTUP_CHECKLIST = {
  ...(window.PROOFLINK_OPERATOR_STARTUP_CHECKLIST || {}),
  renderStartupChecklist,
  initStartupChecklistBindings,
};

Object.assign(window, window.PROOFLINK_OPERATOR_STARTUP_CHECKLIST);
