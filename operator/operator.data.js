// /operator/operator.data.js
// Legacy localStorage bridge retained only for manual recovery. Database orders are the source of truth.
(() => {
  const cfg = window.PROOFLINK_CONFIG || {};
  const tenant = cfg.tenant || window.PROOFLINK_TENANT || {};
  const backend = tenant.backend || {};
  const KEY = backend.orderBridgeKey || "cottagelink_operator_order_bridge_v1";
  const TENANT_ID = tenant.id || "default";

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function normalizeOrder(row) {
    if (!row || typeof row !== "object") return null;
    const id = String(row.id || `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const createdAt = row.createdAt || row.created_at || new Date().toISOString();
    const status = String(row.status || "new").toLowerCase();
    const estimatedTotalCents = Number.isFinite(+row.estimatedTotalCents) ? +row.estimatedTotalCents : 0;
    const unpricedCount = Number.isFinite(+row.unpricedCount) ? +row.unpricedCount : 0;
    const itemCount = Number.isFinite(+row.itemCount) ? +row.itemCount : 0;
    const items = Array.isArray(row.items) ? row.items : [];

    return {
      id,
      createdAt,
      status,
      reviewedAt: row.reviewedAt || row.reviewed_at || "",
      tenantId: String(row.tenantId || row.tenant_id || TENANT_ID),
      tenantSlug: String(row.tenantSlug || row.tenant_slug || tenant.slug || "default"),
      tenantBusinessName: String(row.tenantBusinessName || row.tenant_business_name || tenant.businessName || "Tenant"),
      name: String(row.name || ""),
      email: String(row.email || ""),
      phone: String(row.phone || ""),
      preferred: String(row.preferred || "email"),
      notes: String(row.notes || ""),
      occasion: String(row.occasion || ""),
      servings: String(row.servings || ""),
      flavor: String(row.flavor || ""),
      pickupWindow: String(row.pickupWindow || ""),
      preferPickup: Boolean(row.preferPickup),
      preferDelivery: Boolean(row.preferDelivery),
      fulfillment: String(row.fulfillment || ""),
      cartSummary: String(row.cartSummary || ""),
      items,
      estimatedTotalCents,
      unpricedCount,
      itemCount,
    };
  }

  function matchesTenant(row) {
    return String(row?.tenantId || row?.tenant_id || TENANT_ID) === TENANT_ID;
  }

  function readOrders() {
    const parsed = safeParse(localStorage.getItem(KEY));
    const rows = Array.isArray(parsed) ? parsed : [];
    return rows.map(normalizeOrder).filter((row) => row && matchesTenant(row)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function writeOrders(rows) {
    localStorage.setItem(KEY, JSON.stringify((rows || []).map(normalizeOrder).filter((row) => row && matchesTenant(row))));
  }

  function upsertOrder(row) {
    const incoming = normalizeOrder({ ...row, tenantId: row?.tenantId || TENANT_ID });
    if (!incoming) return null;
    const rows = readOrders();
    const idx = rows.findIndex((x) => x.id === incoming.id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...incoming, tenantId: TENANT_ID };
    else rows.unshift({ ...incoming, tenantId: TENANT_ID });
    writeOrders(rows);
    return incoming;
  }

  function updateOrderStatus(id, status) {
    const rows = readOrders();
    const idx = rows.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    rows[idx] = {
      ...rows[idx],
      tenantId: TENANT_ID,
      status: String(status || "new").toLowerCase(),
      reviewedAt: new Date().toISOString(),
    };
    writeOrders(rows);
    return rows[idx];
  }

  function exportOrdersBlob() {
    const rows = readOrders();
    return new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  }

  window.PROOFLINK_OPERATOR_DATA = {
    key: KEY,
    tenantId: TENANT_ID,
    readOrders,
    writeOrders,
    upsertOrder,
    updateOrderStatus,
    exportOrdersBlob,
  };
})();
