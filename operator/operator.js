// /operator/operator.js
// ProofLink Operator v3 CRM pass

const OPERATOR_CONFIG = window.COTTAGELINK_OPERATOR_CONFIG || {};
const SUPABASE_URL = OPERATOR_CONFIG.supabaseUrl || "https://ygfpawksbqfbgohztisv.supabase.co";
const SUPABASE_ANON_KEY = OPERATOR_CONFIG.supabaseAnonKey || "sb_publishable_bcILNxLX87f-G2zq_SbDGA_Vvs62biB";

window.sb = window.sb || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sb = window.sb;

let TENANT_ID = OPERATOR_CONFIG.tenantId || "default";
const TENANT_SCOPE_ENABLED = OPERATOR_CONFIG.enforceTenantScope === true;
const TENANT_COLUMN = OPERATOR_CONFIG.tenantColumn || "tenant_id";
const OPERATOR_COLUMN = OPERATOR_CONFIG.operatorColumn || "operator_id";

function scopeQuery(query) {
  let next = query.eq(OPERATOR_COLUMN, opId());
  if (TENANT_SCOPE_ENABLED) next = next.eq(TENANT_COLUMN, TENANT_ID);
  return next;
}

function withTenantScope(payload) {
  if (!TENANT_SCOPE_ENABLED) return payload;
  return { ...payload, [TENANT_COLUMN]: TENANT_ID };
}

function getOperatorRedirectUrl() {
  const host = window.location.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  const redirectPath = OPERATOR_CONFIG.redirectPath || "/operator/";
  return new URL(redirectPath, window.location.origin).toString();
}

let PRODUCTS_CACHE = [];
let EXPENSES_CACHE = [];
let CUSTOMERS_CACHE = [];
let CRM_ORDERS_CACHE = [];
let PAYMENTS_CACHE = [];
let PICK_PRODUCT_CATEGORIES = [];
let PICK_EXPENSE_CATEGORIES = [];
let PICK_VENDORS = [];
let AVAILABILITY = null;
let CURRENT_OPERATOR = null;
let BOOTING = false;
window.PROOFLINK_BOOT_READY = false;
// Tracks which password-setup flow is active: "reset" | "first-time" | null
let passwordSetupMode = null;
let ACTIVE_ORDER_ID = null;
let ACTIVE_CUSTOMER_ID = null;
let DASHBOARD_PAYMENT_STATE = null;
let DASHBOARD_LAUNCH_CHECKLIST = null;

function currentMonthRevenueCents() {
  const mk = yyyymm(new Date());
  return PAYMENTS_CACHE.filter((row) => monthKeyFromDate(row.paid_at || row.created_at || row.updated_at || new Date()) === mk)
    .reduce((sum, row) => sum + Number(row.amount_cents || row.net_amount_cents || row.total_cents || 0), 0);
}
function lastMonthRevenueCents() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const mk = yyyymm(d);
  return PAYMENTS_CACHE.filter((row) => monthKeyFromDate(row.paid_at || row.created_at || row.updated_at || new Date()) === mk)
    .reduce((sum, row) => sum + Number(row.amount_cents || row.net_amount_cents || row.total_cents || 0), 0);
}
function currentMonthCustomerCount() {
  const mk = yyyymm(new Date());
  return CUSTOMERS_CACHE.filter((row) => monthKeyFromDate(row.created_at || row.updated_at || new Date()) === mk).length;
}
function currentMonthOrderCount() {
  const mk = yyyymm(new Date());
  return CRM_ORDERS_CACHE.filter((row) => monthKeyFromDate(row.created_at || row.updated_at || new Date()) === mk).length;
}
function averageOrderValueCents() {
  const rows = Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => sum + Number(row.total_cents || row.subtotal_cents || row.estimated_total_cents || 0), 0);
  return Math.round(total / rows.length);
}
async function fetchDashboardPaymentState() {
  try {
    let token = sessionStorage.getItem('pl_op_token') || '';
    if (!token && sb?.auth?.getSession) {
      const { data } = await sb.auth.getSession();
      token = data?.session?.access_token || '';
    }
    const res = await fetch('/.netlify/functions/tenant-payment-status?tenant_id=' + encodeURIComponent(TENANT_ID), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return null;
    DASHBOARD_PAYMENT_STATE = data.paymentState || null;
    return DASHBOARD_PAYMENT_STATE;
  } catch (_) {
    return null;
  }
}
async function fetchDashboardLaunchChecklist() {
  if (!TENANT_ID) return null;
  try {
    const res = await fetch(`/.netlify/functions/get-launch-checklist?tenant_id=${encodeURIComponent(TENANT_ID)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    DASHBOARD_LAUNCH_CHECKLIST = data;
    return data;
  } catch (_) {
    return null;
  }
}

const $ = (id) => document.getElementById(id);

const viewLogin = $("viewLogin");
const viewApp = $("viewApp");
const btnSignOut = $("btnSignOut");
const btnStartTour = $("btnStartTour");
const sessionEmail = $("sessionEmail");

const loginForm = $("loginForm");
const loginEmail = $("loginEmail");
const loginPassword = $("loginPassword");
const btnMagicLink = $("btnMagicLink");
const loginMsg = $("loginMsg");

const brandLogo = $("brandLogo");
const brandTenant = $("brandTenant");
const brandPowered = $("brandPowered");
const brandCompany = $("brandCompany");
const brandProductPill = $("brandProductPill");
const brandProductName = $("brandProductName");
const platformLogo = $("platformLogo");
const startupChecklist = $("startupChecklist");
const operatorFooterText = $("operatorFooterText");

const dashboardWrap = $("dashboardWrap");
const btnRefreshDashboard = $("btnRefreshDashboard");
const ordersList = $("ordersList");
const orderDetailWrap = $("orderDetailWrap");
const btnRefreshOrders = $("btnRefreshOrders");
const btnExportOrders = $("btnExportOrders");
const btnImportBridgeOrders = $("btnImportBridgeOrders");
const guidanceWrap = $("guidanceWrap");
const btnRefreshGuidance = $("btnRefreshGuidance");

const customersList = $("customersList");
const customerDetailWrap = $("customerDetailWrap");
const btnRefreshCustomers = $("btnRefreshCustomers");
const customerSearch = $("customerSearch");

const paymentsList = $("paymentsList");
const btnRefreshPayments = $("btnRefreshPayments");

const setupForm = $("setupForm");
const btnRefreshSetup = $("btnRefreshSetup");
const btnSaveSetup = $("btnSaveSetup");
const btnSaveSetupTop = $("btnSaveSetupTop");
const btnMarkSetupComplete = $("btnMarkSetupComplete");
const setupMsg = $("setupMsg");
const setupPreviewWrap = $("setupPreviewWrap");
const setupLockedRecord = $("setupLockedRecord");
const setupTagline = $("setupTagline");
const setupHeroHeading = $("setupHeroHeading");
const setupHeroSubheading = $("setupHeroSubheading");
const setupAbout = $("setupAbout");
const setupAccentColor = $("setupAccentColor");
const setupLogoUrl = $("setupLogoUrl");
const setupHeroImageUrl = $("setupHeroImageUrl");
const setupPublicContactEmail = $("setupPublicContactEmail");
const setupPublicBusinessPhone = $("setupPublicBusinessPhone");
const setupServiceArea = $("setupServiceArea");
const setupInstagram = $("setupInstagram");
const setupFacebook = $("setupFacebook");
const setupHoursNotes = $("setupHoursNotes");
const setupFulfillmentNotes = $("setupFulfillmentNotes");
const setupShowPrices = $("setupShowPrices");
const setupAllowCustomRequests = $("setupAllowCustomRequests");
const setupLogoFile = $("setupLogoFile");
const setupHeroFile = $("setupHeroFile");
const btnUploadSetupLogo = $("btnUploadSetupLogo");
const btnUploadSetupHero = $("btnUploadSetupHero");
const setupLogoStatus = $("setupLogoStatus");
const setupHeroStatus = $("setupHeroStatus");
let SETUP_STATE = null;

const productsList = $("productsList");
const btnNewProduct = $("btnNewProduct");
const btnRefreshProducts = $("btnRefreshProducts");
const productSearch = $("productSearch");
const productForm = $("productForm");
const productFormTitle = $("productFormTitle");
const productMsg = $("productMsg");
const btnArchiveProduct = $("btnArchiveProduct");
const productId = $("productId");
const productName = $("productName");
const productSlug = $("productSlug");
const productCategory = $("productCategory");
const productDescription = $("productDescription");
const productIngredients = $("productIngredients");
const productImageUrl = $("productImageUrl");
const productImageFile = $("productImageFile");
const btnUploadProductImage = $("btnUploadProductImage");
const productImageStatus = $("productImageStatus");
const productIsActive = $("productIsActive");
const productIsAvailable = $("productIsAvailable");
const productSort = $("productSort");

const pricingList = $("pricingList");
const btnRefreshPricing = $("btnRefreshPricing");

const availabilityWrap = $("availabilityWrap");
const availabilityMsg = $("availabilityMsg");
const btnSaveAvailability = $("btnSaveAvailability");
const btnRefreshAvailability = $("btnRefreshAvailability");

const expensesList = $("expensesList");
const btnNewExpense = $("btnNewExpense");
const btnRefreshExpenses = $("btnRefreshExpenses");
const expenseForm = $("expenseForm");
const expenseFormTitle = $("expenseFormTitle");
const expenseMsg = $("expenseMsg");
const btnDeleteExpense = $("btnDeleteExpense");
const expenseId = $("expenseId");
const expenseDate = $("expenseDate");
const expenseCategory = $("expenseCategory");
const expenseVendor = $("expenseVendor");
const expenseDescription = $("expenseDescription");
const expenseAmount = $("expenseAmount");

const moneyWrap = $("moneyWrap");
const btnRefreshMoney = $("btnRefreshMoney");

const viewPasswordSetup = $("viewPasswordSetup");
const passwordSetupMsg  = $("passwordSetupMsg");
const newPasswordInput  = $("newPasswordInput");
const confirmPasswordInput = $("confirmPasswordInput");
const btnSetPassword    = $("btnSetPassword");

const viewForgotPassword = $("viewForgotPassword");
const forgotEmail        = $("forgotEmail");
const btnSendReset       = $("btnSendReset");
const btnBackToLogin     = $("btnBackToLogin");
const forgotMsg          = $("forgotMsg");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[s]));
}
function escapeAttr(value) { return escapeHtml(String(value ?? "")).replace(/"/g, "&quot;"); }
function normalizePick(str) { return String(str ?? "").trim().replace(/\s+/g, " "); }
function money(cents) { return (Number(cents || 0) / 100).toFixed(2); }
function formatUsd(cents) { return `$${money(cents)}`; }
function toCents(numStr) { return Math.round(Number(numStr || 0) * 100); }
function safeFilename(name) { return String(name || "file").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9._-]/g, ""); }
function yyyymm(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function slugify(str) { return String(str || "").trim().toLowerCase().replace(/["']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function monthKeyFromDate(dateStr) { const d = new Date(dateStr); return Number.isNaN(d.getTime()) ? null : yyyymm(d); }
function opId() { if (!CURRENT_OPERATOR?.operator_id) throw new Error("Operator context not loaded."); return CURRENT_OPERATOR.operator_id; }
function formatDateTime(iso) { const d = new Date(iso || Date.now()); return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function formatDateOnly(iso) { const d = new Date(iso || Date.now()); return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleDateString([], { dateStyle: "medium" }); }
function prettifyDay(day) { const value = String(day || "").trim().toLowerCase(); return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Day"; }
function formatTime12(value) {
  const raw = String(value || "").trim();
  if (!raw.includes(":")) return raw || "—";
  const [hStr, mStr] = raw.split(":");
  const h = Number(hStr);
  if (Number.isNaN(h)) return raw;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(mStr || "00").padStart(2, "0")} ${suffix}`;
}

function isPasswordSetupVisible() {
  return !!viewPasswordSetup && !viewPasswordSetup.classList.contains("hidden");
}

function setDatalistOptions(datalistEl, values) {
  if (!datalistEl) return;
  datalistEl.innerHTML = "";
  const uniq = Array.from(new Set((values || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  uniq.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    datalistEl.appendChild(opt);
  });
}
function preferExisting(inputValue, options) {
  const v = normalizePick(inputValue);
  if (!v) return null;
  const hit = (options || []).find((o) => String(o).toLowerCase() === v.toLowerCase());
  return hit || v;
}
async function fetchDistinct(table, column) {
  const { data, error } = await scopeQuery(sb.from(table).select(column)).limit(1000);
  if (error) throw error;
  return (data || []).map((r) => r[column]).filter(Boolean);
}
async function refreshPicklists() {
  PICK_PRODUCT_CATEGORIES = Array.from(new Set((await fetchDistinct("products", "category")).map(normalizePick).filter(Boolean)));
  setDatalistOptions($("categoryOptions"), PICK_PRODUCT_CATEGORIES);

  PICK_EXPENSE_CATEGORIES = Array.from(new Set((await fetchDistinct("expenses", "category")).map(normalizePick).filter(Boolean)));
  setDatalistOptions($("expenseCategoryOptions"), PICK_EXPENSE_CATEGORIES);

  PICK_VENDORS = Array.from(new Set((await fetchDistinct("expenses", "vendor")).map(normalizePick).filter(Boolean)));
  setDatalistOptions($("vendorOptions"), PICK_VENDORS);
}

function initBranding() {
  const b = window.COTTAGELINK_BRAND || {};
  if (brandTenant) brandTenant.textContent = b.tenantName || "Tenant";
  if (brandPowered) brandPowered.textContent = `Business powered by ${b.productName || "ProofLink"}`;
  if (brandCompany) brandCompany.textContent = b.productName || "ProofLink";
  if (brandProductPill) brandProductPill.textContent = b.productName || "ProofLink";
  if (brandProductName) brandProductName.textContent = b.productName || "ProofLink";

  if (brandLogo) {
    brandLogo.src = b.tenantLogoUrl || "../assets/logo.png";
    brandLogo.style.display = "block";
  }
  if (platformLogo) {
    platformLogo.src = b.platformLogoUrl || "../assets/cottagelink-logo.png";
    platformLogo.style.display = "block";
  }
  if (operatorFooterText) {
    operatorFooterText.textContent = `Operator UI v3 — ${b.tenantName || "Tenant"} • Powered by ${b.productName || "ProofLink"}${TENANT_SCOPE_ENABLED ? ` • ${TENANT_COLUMN} ready (${TENANT_ID})` : ""}`;
  }
}

function renderStartupChecklist() {
  if (!startupChecklist) return;
  const items = [
    { done: PRODUCTS_CACHE.length > 0, label: "Add your first product", tab: "products", action: "Open products" },
    { done: PRODUCTS_CACHE.some((p) => !!p.is_active), label: "Publish at least one product to the storefront", tab: "products", action: "Review products" },
    { done: PRODUCTS_CACHE.some((p) => !!p.image_url), label: "Add at least one product image", tab: "products", action: "Add image" },
    { done: EXPENSES_CACHE.length > 0, label: "Track your first expense", tab: "expenses", action: "Open expenses" },
    { done: CUSTOMERS_CACHE.length > 0, label: "Capture your first customer in CRM", tab: "customers", action: "Open CRM" },
    { done: CRM_ORDERS_CACHE.length > 0, label: "Convert at least one request into a tracked order", tab: "orders", action: "Open orders" },
    { done: !!(SETUP_STATE?.payload?.logo_url || SETUP_STATE?.payload?.hero_image_url || SETUP_STATE?.payload?.tagline), label: "Add branding, media, and public profile details", tab: "setup", action: "Open setup" },
    { done: PAYMENTS_CACHE.length > 0, label: "Review payment setup and payout readiness", tab: "payments", action: "Open payments" },
  ];

  startupChecklist.innerHTML = items.map((item) => `
    <button class="checklist-item ${item.done ? "is-done" : ""}" type="button" data-tour-go="${escapeAttr(item.tab)}" style="width:100%;text-align:left;background:transparent;border:0;padding:0;cursor:pointer;">
      <span class="dot"></span>
      <span style="flex:1;">${escapeHtml(item.label)}</span>
      <span class="pill" style="margin-left:8px;">${escapeHtml(item.action)}</span>
    </button>
  `).join("");
}

function setSetupMessage(message = "", tone = "") {
  if (!setupMsg) return;
  setupMsg.className = `msg${tone ? ` ${tone}` : ""}`;
  setupMsg.textContent = message;
}

function setupPreviewHtml(payload = {}, record = null) {
  const logoUrl = String(payload.logo_url || "").trim();
  const heroUrl = String(payload.hero_image_url || "").trim();
  return `
    <div class="stack" style="display:grid;gap:14px;">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="width:64px;height:64px;border-radius:14px;border:1px solid var(--border);background:rgba(255,255,255,.03);display:grid;place-items:center;overflow:hidden;">
          ${logoUrl ? `<img src="${escapeAttr(logoUrl)}" alt="Logo" style="width:100%;height:100%;object-fit:cover;" />` : `<span class="muted" style="font-size:.8rem;">No logo</span>`}
        </div>
        <div>
          <div style="font-weight:800;font-size:1.05rem;">${escapeHtml(record?.legal_business_name || OPERATOR_CONFIG.tenantBusinessName || "Business")}</div>
          <div class="muted">${escapeHtml(payload.tagline || "No tagline yet.")}</div>
        </div>
      </div>
      <div style="padding:14px;border-radius:14px;border:1px solid var(--border);background:rgba(255,255,255,.02);">
        <div style="font-weight:800;font-size:1rem;margin-bottom:6px;">${escapeHtml(payload.hero_heading || record?.legal_business_name || "Hero heading not set")}</div>
        <div class="muted">${escapeHtml(payload.hero_subheading || "No hero subheading yet.")}</div>
        ${heroUrl ? `<div style="margin-top:12px;border-radius:12px;overflow:hidden;border:1px solid var(--border);"><img src="${escapeAttr(heroUrl)}" alt="Hero" style="display:block;width:100%;height:220px;object-fit:cover;" /></div>` : ``}
      </div>
      <div class="table">
        <div class="tr"><div>Public contact</div><div>${escapeHtml(payload.public_contact_email || payload.contact_email || "—")}</div></div>
        <div class="tr"><div>Public phone</div><div>${escapeHtml(payload.public_business_phone || payload.business_phone || "—")}</div></div>
        <div class="tr"><div>Location</div><div>${escapeHtml(record?.city_state || payload.city_state || "—")}</div></div>
        <div class="tr"><div>Service area</div><div>${escapeHtml(payload.service_area || "—")}</div></div>
      </div>
    </div>
  `;
}

function renderLockedBusinessRecord(record = {}) {
  if (!setupLockedRecord) return;
  const rows = [
    ["Legal business name", record.legal_business_name || "—"],
    ["Owner name", record.owner_name || "—"],
    ["Login email", record.login_email || "—"],
    ["Business type", record.business_type || "—"],
    ["City / State", record.city_state || "—"],
    ["License number", record.license_number || "—"],
    ["Tenant slug", record.slug || "—"],
    ["Tenant status", record.active ? "Active" : "Inactive"],
  ];
  setupLockedRecord.innerHTML = rows.map(([label, value]) => `
    <div class="tr"><div>${escapeHtml(label)}</div><div>${escapeHtml(String(value || "—"))}</div></div>
  `).join("");
}

function fillSetupForm(payload = {}, record = null) {
  if (setupTagline) setupTagline.value = payload.tagline || "";
  if (setupHeroHeading) setupHeroHeading.value = payload.hero_heading || "";
  if (setupHeroSubheading) setupHeroSubheading.value = payload.hero_subheading || "";
  if (setupAbout) setupAbout.value = payload.about || "";
  if (setupAccentColor) setupAccentColor.value = payload.accent_color || window.COTTAGELINK_BRAND?.accent || "#c84b2f";
  if (setupLogoUrl) setupLogoUrl.value = payload.logo_url || "";
  if (setupHeroImageUrl) setupHeroImageUrl.value = payload.hero_image_url || "";
  if (setupPublicContactEmail) setupPublicContactEmail.value = payload.public_contact_email || payload.contact_email || "";
  if (setupPublicBusinessPhone) setupPublicBusinessPhone.value = payload.public_business_phone || payload.business_phone || "";
  if (setupServiceArea) setupServiceArea.value = payload.service_area || "";
  if (setupInstagram) setupInstagram.value = payload.instagram || "";
  if (setupFacebook) setupFacebook.value = payload.facebook || "";
  if (setupHoursNotes) setupHoursNotes.value = payload.hours_notes || "";
  if (setupFulfillmentNotes) setupFulfillmentNotes.value = payload.fulfillment_notes || "";
  if (setupShowPrices) setupShowPrices.checked = payload.show_prices !== false;
  if (setupAllowCustomRequests) setupAllowCustomRequests.checked = payload.allow_custom_requests !== false;
  if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(payload, record || SETUP_STATE?.locked_record || null);
  renderLockedBusinessRecord(record || SETUP_STATE?.locked_record || {});
}

function collectSetupPayload(extra = {}) {
  return {
    tagline: setupTagline?.value?.trim() || "",
    hero_heading: setupHeroHeading?.value?.trim() || "",
    hero_subheading: setupHeroSubheading?.value?.trim() || "",
    about: setupAbout?.value?.trim() || "",
    accent_color: setupAccentColor?.value?.trim() || "",
    logo_url: setupLogoUrl?.value?.trim() || "",
    hero_image_url: setupHeroImageUrl?.value?.trim() || "",
    public_contact_email: setupPublicContactEmail?.value?.trim() || "",
    public_business_phone: setupPublicBusinessPhone?.value?.trim() || "",
    service_area: setupServiceArea?.value?.trim() || "",
    instagram: setupInstagram?.value?.trim().replace(/^@/, "") || "",
    facebook: setupFacebook?.value?.trim() || "",
    hours_notes: setupHoursNotes?.value?.trim() || "",
    fulfillment_notes: setupFulfillmentNotes?.value?.trim() || "",
    show_prices: !!setupShowPrices?.checked,
    allow_custom_requests: !!setupAllowCustomRequests?.checked,
    ...extra,
  };
}

async function fetchOperatorSetup() {
  const token = await window.PROOFLINK_OPERATOR_RUNTIME?.getAccessToken?.();
  const res = await fetch('/.netlify/functions/get-operator-setup', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load setup.');
  SETUP_STATE = data;
  fillSetupForm(data.config || {}, data.locked_record || data.tenant || {});
  return data;
}

async function saveOperatorSetup(extra = {}) {
  const payload = collectSetupPayload(extra);
  setSetupMessage('Saving setup…');
  const token = await window.PROOFLINK_OPERATOR_RUNTIME?.getAccessToken?.();
  const res = await fetch('/.netlify/functions/update-tenant-config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ tenant_id: TENANT_ID, config: payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to save setup.');
  SETUP_STATE = { ...(SETUP_STATE || {}), config: data.config || payload, locked_record: SETUP_STATE?.locked_record || null };
  fillSetupForm(data.config || payload, SETUP_STATE?.locked_record || null);
  initBranding();
  setSetupMessage('Setup saved.', 'good');
  return data;
}

async function uploadSetupAsset(file, slot = 'asset') {
  const key = `branding/${TENANT_ID}/${slot}_${Date.now()}_${safeFilename(file.name)}`;
  const { error: upErr } = await sb.storage.from('product-images').upload(key, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/png',
  });
  if (upErr) throw upErr;
  const { data } = sb.storage.from('product-images').getPublicUrl(key);
  if (!data?.publicUrl) throw new Error('Upload succeeded but no public URL returned.');
  return data.publicUrl;
}

function normalizePanel(panel) {
  const value = String(panel || '').trim().toLowerCase();
  return document.querySelector(`.tab[data-tab="${value}"]`) ? value : 'dashboard';
}
function panelFromLocation() {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  return normalizePanel(hash || document.querySelector(".tab.active")?.dataset.tab || 'dashboard');
}
function syncPanelHash(tab) {
  const target = `#${normalizePanel(tab)}`;
  if (window.location.hash === target) return;
  if (window.history?.replaceState) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${target}`);
  } else {
    window.location.hash = target;
  }
}
function currentPanel() {
  return panelFromLocation();
}
function switchTab(tab, opts = {}) {
  const nextTab = normalizePanel(tab);
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === nextTab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== nextTab));

  if (nextTab === "money") renderMoney().catch(console.error);
  if (nextTab === "dashboard") renderDashboard();
  if (nextTab === "orders") renderOrders();
  if (nextTab === "customers") renderCustomersList(customerSearch?.value || "");
  if (nextTab === "payments") renderPayments();
  if (nextTab === "setup") fetchOperatorSetup().catch((err) => setSetupMessage(err.message || String(err), "bad"));
  if (nextTab === "guidance") renderGuidance();
  if (opts.updateHash !== false) syncPanelHash(nextTab);
}
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
startupChecklist?.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-tour-go]");
  if (!trigger) return;
  const tab = trigger.getAttribute("data-tour-go");
  if (!tab) return;
  switchTab(tab);
});

btnStartTour?.addEventListener("click", () => {
  if (window.PROOFLINK_WALKTHROUGH?.start) window.PROOFLINK_WALKTHROUGH.start({ force: true });
});

window.addEventListener('hashchange', () => {
  const target = panelFromLocation();
  if (target !== document.querySelector('.tab.active')?.dataset.tab) {
    switchTab(target, { updateHash: false });
  }
});

function showLogin(message = "") {
  window.PROOFLINK_BOOT_READY = false;
  viewLogin?.classList.remove("hidden");
  viewApp?.classList.add("hidden");
  viewPasswordSetup?.classList.add("hidden");
  viewForgotPassword?.classList.add("hidden");
  btnSignOut?.classList.add("hidden");
  btnStartTour?.classList.add("hidden");
  if (sessionEmail) sessionEmail.textContent = "";
  if (loginMsg) loginMsg.textContent = message || "";
}
function showApp(user) {
  viewLogin?.classList.add("hidden");
  viewApp?.classList.remove("hidden");
  viewPasswordSetup?.classList.add("hidden");
  viewForgotPassword?.classList.add("hidden");
  btnSignOut?.classList.remove("hidden");
  btnStartTour?.classList.remove("hidden");
  if (sessionEmail) sessionEmail.textContent = user?.email || "";
  if (loginMsg) loginMsg.textContent = "";
}

function getAuthCallbackType() {
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  if (hash.includes("type=magiclink") || search.includes("type=magiclink")) return "magiclink";
  if (hash.includes("type=invite")    || search.includes("type=invite"))    return "invite";
  if (hash.includes("type=recovery")  || search.includes("type=recovery"))  return "recovery";
  if (hash.includes("type=signup")    || search.includes("type=signup"))    return "signup";
  // Bare access_token without explicit type → treat as magic link (first-time setup)
  if (hash.includes("access_token=")) return "magiclink";
  return null;
}

let pendingAuthCallback = getAuthCallbackType();

function clearAuthHash() {
  if (window.history?.replaceState) {
    // Strip auth-related query params (PKCE flow) while preserving any others
    const params = new URLSearchParams(window.location.search);
    ["token_hash", "type", "code"].forEach((k) => params.delete(k));
    const remaining = params.toString();
    const search = remaining ? "?" + remaining : "";
    window.history.replaceState(null, "", window.location.pathname + search);
  }
}

async function showPasswordSetup(mode) {
  window.PROOFLINK_BOOT_READY = false;
  passwordSetupMode = mode === "reset" ? "reset" : "first-time";
  const isReset = passwordSetupMode === "reset";

  viewLogin?.classList.add("hidden");
  viewApp?.classList.add("hidden");
  viewPasswordSetup?.classList.remove("hidden");
  viewForgotPassword?.classList.add("hidden");
  btnSignOut?.classList.remove("hidden");
  btnStartTour?.classList.remove("hidden");
  if (passwordSetupMsg) passwordSetupMsg.textContent = "";
  if (newPasswordInput) newPasswordInput.value = "";
  if (confirmPasswordInput) confirmPasswordInput.value = "";
  if (btnSetPassword) btnSetPassword.disabled = false;

  const heading  = viewPasswordSetup?.querySelector("[data-pw-heading]");
  const desc     = viewPasswordSetup?.querySelector("[data-pw-desc]");
  const emailEl  = viewPasswordSetup?.querySelector("[data-pw-email]");
  if (heading) heading.textContent = isReset ? "Reset your password" : "Set your password";
  if (desc)    desc.textContent    = isReset
    ? "Enter a new password for your account."
    : "Your email is confirmed. Create a password so you can log back in directly next time.";
  if (btnSetPassword) btnSetPassword.textContent = isReset ? "Update password and sign in" : "Set password and open dashboard";

  // Populate email address from the active Supabase session
  if (emailEl) {
    emailEl.textContent = "";
    try {
      const { data } = await sb.auth.getUser();
      const email = data?.user?.email || "";
      emailEl.textContent = email;
      emailEl.style.display = email ? "" : "none";
    } catch {
      emailEl.style.display = "none";
    }
  }
}

function showForgotPassword() {
  window.PROOFLINK_BOOT_READY = false;
  viewLogin?.classList.add("hidden");
  viewApp?.classList.add("hidden");
  viewPasswordSetup?.classList.add("hidden");
  viewForgotPassword?.classList.remove("hidden");
  btnSignOut?.classList.add("hidden");
  btnStartTour?.classList.add("hidden");
  if (forgotMsg) forgotMsg.textContent = "";
  if (forgotEmail) forgotEmail.value = loginEmail?.value || "";
}
async function getUser() {
  const { data, error } = await sb.auth.getUser();
  return error ? null : data?.user || null;
}
async function refreshSession() {
  const user = await getUser();
  if (!user) {
    showLogin("");
    return null;
  }
  return user;
}
async function sendMagicLink(email) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getOperatorRedirectUrl() },
  });
  if (error) throw error;
}

btnSetPassword?.addEventListener("click", async () => {
  const pw  = newPasswordInput?.value || "";
  const pw2 = confirmPasswordInput?.value || "";

  if (pw.length < 8) {
    if (passwordSetupMsg) { passwordSetupMsg.textContent = "Password must be at least 8 characters."; passwordSetupMsg.className = "msg error"; }
    return;
  }
  if (pw !== pw2) {
    if (passwordSetupMsg) { passwordSetupMsg.textContent = "Passwords do not match."; passwordSetupMsg.className = "msg error"; }
    return;
  }

  if (btnSetPassword) btnSetPassword.disabled = true;
  if (passwordSetupMsg) { passwordSetupMsg.textContent = "Setting password…"; passwordSetupMsg.className = "msg"; }

  const { error } = await sb.auth.updateUser({ password: pw });

  if (error) {
    if (passwordSetupMsg) { passwordSetupMsg.textContent = error.message || "Could not set password."; passwordSetupMsg.className = "msg error"; }
    if (btnSetPassword) btnSetPassword.disabled = false;
    return;
  }

  const isReset = passwordSetupMode === "reset";
  passwordSetupMode = null;

  if (passwordSetupMsg) { passwordSetupMsg.textContent = isReset ? "Password updated. Loading your dashboard…" : "Password set. Loading your dashboard…"; passwordSetupMsg.className = "msg ok"; }

  setTimeout(() => {
    window.PROOFLINK_BOOT_READY = false;
    boot().then(() => {
      // Re-trigger the tour auto-show poll now that the dashboard is freshly booted.
      // This is needed because the page-load poll may have already expired by the time
      // the user finishes password setup.
      window.__plTourReady?.();
    }).catch((err) => {
      console.error(err);
      showLogin(err?.message || String(err));
    });
  }, 800);
});

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (loginMsg) loginMsg.textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({
    email: loginEmail.value.trim(),
    password: loginPassword.value,
  });
  if (error) {
    if (loginMsg) loginMsg.textContent = error.message;
    return;
  }
  await boot();
});
btnMagicLink?.addEventListener("click", async () => {
  const email = loginEmail.value.trim();
  if (!email) {
    if (loginMsg) loginMsg.textContent = "Enter your email first.";
    return;
  }
  try {
    if (loginMsg) loginMsg.textContent = "Sending sign-in link…";
    await sendMagicLink(email);
    if (loginMsg) loginMsg.textContent = "Check your inbox for the newest sign-in link.";
  } catch (err) {
    if (loginMsg) loginMsg.textContent = err?.message || String(err);
  }
});

// ── Forgot password flow ──────────────────────────────────────────────────
$("btnForgotPassword")?.addEventListener("click", (e) => {
  e.preventDefault();
  showForgotPassword();
});

btnBackToLogin?.addEventListener("click", () => showLogin(""));

btnSendReset?.addEventListener("click", async () => {
  const email = (forgotEmail?.value || "").trim();
  if (!email) {
    if (forgotMsg) { forgotMsg.textContent = "Enter your email address."; forgotMsg.className = "msg error"; }
    return;
  }
  if (btnSendReset) btnSendReset.disabled = true;
  if (forgotMsg) { forgotMsg.textContent = "Sending reset link…"; forgotMsg.className = "msg"; }

  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: getOperatorRedirectUrl(),
    });
    if (error) throw error;
    if (forgotMsg) {
      forgotMsg.textContent = "Check your inbox for a password reset link.";
      forgotMsg.className = "msg ok";
    }
  } catch (err) {
    if (forgotMsg) { forgotMsg.textContent = err?.message || String(err); forgotMsg.className = "msg error"; }
  } finally {
    if (btnSendReset) btnSendReset.disabled = false;
  }
});
btnSignOut?.addEventListener("click", async () => {
  await sb.auth.signOut();
  CURRENT_OPERATOR = null;
  showLogin("");
});
sb.auth.onAuthStateChange((_event, session) => {
  if (!session?.user) {
    CURRENT_OPERATOR = null;
    pendingAuthCallback = null;
    showLogin("");
    return;
  }

  // Re-check URL for auth callback type in case pendingAuthCallback was cleared
  // by an earlier null-session event during Supabase initialization.
  const callbackType = pendingAuthCallback || getAuthCallbackType();

  // Password recovery flow must stop on the password screen.
  if (_event === "PASSWORD_RECOVERY" || callbackType === "recovery") {
    pendingAuthCallback = null;
    clearAuthHash();
    showPasswordSetup("reset").catch(console.error);
    return;
  }

  // First magic-link / invite / signup flow must stop on the password screen.
  if (
    callbackType === "magiclink" ||
    callbackType === "invite" ||
    callbackType === "signup"
  ) {
    pendingAuthCallback = null;
    clearAuthHash();
    showPasswordSetup("first-time").catch(console.error);
    return;
  }

  // Do not auto-boot away from the password screen if another auth event fires.
  if (isPasswordSetupVisible()) {
    return;
  }

  pendingAuthCallback = null;
  boot().catch((err) => {
    console.error(err);
    showLogin(err?.message || String(err));
  });
});

async function requireOperatorContext() {
  const { data: sess } = await sb.auth.getSession();
  const uid = sess?.session?.user?.id || null;
  const token = sess?.session?.access_token || null;
  if (!uid) throw new Error("Not authenticated.");

  // Try direct user_id lookup
  let { data, error } = await sb
    .from("operator_members")
    .select("role, operators!operator_id(id, name, tenant_id)")
    .eq("user_id", uid)
    .limit(1)
    .maybeSingle();

  // Fallback: call server to link user_id by email, then retry
  let linkStatus = null;
  let linkBody = null;
  if (!data && token) {
    try {
      const res = await fetch("/.netlify/functions/link-operator-user", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      });
      linkStatus = res.status;
      try { linkBody = await res.json(); } catch (_) { linkBody = null; }
      if (res.ok) {
        const retry = await sb
          .from("operator_members")
          .select("role, operators!operator_id(id, name, tenant_id)")
          .eq("user_id", uid)
          .limit(1)
          .maybeSingle();
        data = retry.data;
        error = retry.error;
      } else {
        console.warn("link-operator-user returned", linkStatus, linkBody);
      }
    } catch (linkErr) {
      console.warn("link-operator-user fallback failed:", linkErr.message);
    }
  }

  if (error) throw error;
  if (!data?.operators?.id) {
    const detail = linkBody?.detail || linkBody?.error || "";
    throw new Error("No operator membership found for this user." + (detail ? " Server: " + detail : "") + (linkStatus ? " (HTTP " + linkStatus + ")" : ""));
  }

  const operatorTenantId = String(data.operators.tenant_id || '').trim();
  if (TENANT_SCOPE_ENABLED && operatorTenantId && operatorTenantId !== TENANT_ID) {
    // Tenant in database doesn't match static config — update the module-level
    // TENANT_ID to the real value from the database so all queries use the correct
    // tenant. This allows the operator dashboard to work for any provisioned tenant,
    // not just the demo tenant hardcoded in cottagelink.tenant.js.
    console.log(`[ProofLink] Tenant scope updated: ${TENANT_ID} → ${operatorTenantId}`);
    // eslint-disable-next-line no-global-assign
    TENANT_ID = operatorTenantId;
  }

  CURRENT_OPERATOR = {
    operator_id: data.operators.id,
    operator_name: data.operators.name,
    operator_slug: "",
    operator_tenant_id: operatorTenantId || TENANT_ID,
    role: data.role,
  };
  return CURRENT_OPERATOR;
}

async function fetchProducts() {
  const { data, error } = await scopeQuery(sb
    .from("products")
    .select("*"))
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  PRODUCTS_CACHE = data || [];
  return PRODUCTS_CACHE;
}
function renderProductsList(filter = "") {
  const q = String(filter || "").trim().toLowerCase();
  const rows = PRODUCTS_CACHE.filter((p) =>
    !q ||
    String(p.name || "").toLowerCase().includes(q) ||
    String(p.slug || "").toLowerCase().includes(q) ||
    String(p.category || "").toLowerCase().includes(q)
  );

  if (!productsList) return;
  productsList.innerHTML = rows.length ? "" : `<div class="muted">No products.</div>`;

  rows.forEach((p) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "list-item";
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(p.name)}</div>
        <div class="li-sub muted">${escapeHtml(p.category || "—")} • ${escapeHtml(p.slug)}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${p.is_active ? "pill-on" : ""}">${p.is_active ? "On site" : "Hidden"}</span>
        <span class="pill ${p.is_available ? "pill-on" : ""}">${p.is_available ? "Available" : "Unavailable"}</span>
      </div>
    `;
    el.addEventListener("click", () => loadProductIntoForm(p));
    productsList.appendChild(el);
  });
}
function clearProductForm() {
  productId.value = "";
  productName.value = "";
  productSlug.value = "";
  productCategory.value = "";
  productDescription.value = "";
  productIngredients.value = "";
  productImageUrl.value = "";
  if (productImageFile) productImageFile.value = "";
  if (productImageStatus) productImageStatus.textContent = "";
  if (productIsActive) productIsActive.checked = true;
  if (productIsAvailable) productIsAvailable.checked = true;
  if (productSort) productSort.value = "0";
  if (productMsg) productMsg.textContent = "";
  if (productFormTitle) productFormTitle.textContent = "New product";
}
function loadProductIntoForm(p) {
  productId.value = p.id || "";
  productName.value = p.name || "";
  productSlug.value = p.slug || "";
  productCategory.value = p.category || "";
  productDescription.value = p.description || "";
  productIngredients.value = Array.isArray(p.ingredients) ? p.ingredients.join(", ") : "";
  productImageUrl.value = p.image_url || "";
  if (productImageFile) productImageFile.value = "";
  if (productImageStatus) productImageStatus.textContent = "";
  if (productIsActive) productIsActive.checked = !!p.is_active;
  if (productIsAvailable) productIsAvailable.checked = !!p.is_available;
  if (productSort) productSort.value = String(p.sort_order ?? 0);
  if (productMsg) productMsg.textContent = "";
  if (productFormTitle) productFormTitle.textContent = `Edit: ${p.name}`;
}
async function ensurePricingRow(productRowId) {
  const { data, error } = await sb
    .from("pricing")
    .select("product_id")
    
    .eq("product_id", productRowId)
    .limit(1);

  if (error) throw error;
  if (Array.isArray(data) && data.length) return;

  const { error: insertError } = await sb.from("pricing").insert(withTenantScope({
    operator_id: opId(),
    product_id: productRowId,
    unit_label: "each",
    sell_price_cents: 0,
    cost_ingredients_cents: 0,
    cost_packaging_cents: 0,
    labor_minutes: 0,
    notes: "",
    updated_at: new Date().toISOString(),
  }));
  if (insertError) throw insertError;
}

function normalizePricingForSave(mode, amountCents) {
  const cents = Math.max(0, Number(amountCents || 0));

  if (mode === "fixed") {
    return {
      pricing_mode: "fixed",
      sell_price_cents: cents,
      starting_price_cents: 0,
    };
  }

  if (mode === "starts_at") {
    return {
      pricing_mode: "starts_at",
      sell_price_cents: 0,
      starting_price_cents: cents,
    };
  }

  return {
    pricing_mode: "quote",
    sell_price_cents: 0,
    starting_price_cents: 0,
  };
}

function normalizePricingModeForUi(productRow) {
  const sell = Number(productRow?.sell_price_cents || 0);
  const start = Number(productRow?.starting_price_cents || 0);
  const raw = String(productRow?.pricing_mode || "").trim().toLowerCase();

  if (sell > 0) return "fixed";
  if (start > 0) return "starts_at";
  if (raw === "fixed" || raw === "starts_at" || raw === "quote") return raw;
  return "quote";
}

function pricingAmountForUi(productRow) {
  const mode = normalizePricingModeForUi(productRow);
  if (mode === "fixed") return Number(productRow?.sell_price_cents || 0);
  if (mode === "starts_at") return Number(productRow?.starting_price_cents || 0);
  return 0;
}
productName?.addEventListener("input", () => {
  if (!productId.value) productSlug.value = slugify(productName.value);
});
productSearch?.addEventListener("input", () => renderProductsList(productSearch.value));
btnRefreshProducts?.addEventListener("click", async () => {
  try {
    await fetchProducts();
    renderProductsList(productSearch.value);
    await refreshPicklists();
    renderStartupChecklist();
  } catch (err) {
    alert(err.message || String(err));
  }
});
btnNewProduct?.addEventListener("click", clearProductForm);
productForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (productMsg) productMsg.textContent = "Saving…";

  const id = productId.value || null;
  const payload = withTenantScope({
    operator_id: opId(),
    name: productName.value.trim(),
    slug: productSlug.value.trim(),
    category: preferExisting(productCategory.value, PICK_PRODUCT_CATEGORIES),
    description: productDescription.value.trim(),
    ingredients: String(productIngredients.value || "").split(",").map((s) => normalizePick(s)).filter(Boolean),
    image_url: productImageUrl.value.trim() || null,
    is_active: !!productIsActive.checked,
    is_available: !!productIsAvailable.checked,
    sort_order: Number(productSort.value || 0),
    updated_at: new Date().toISOString(),
  });

  try {
    let savedId = id;
    if (id) {
      const { error } = await sb.from("products").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from("products")
        .insert({
          ...payload,
          pricing_mode: "quote",
          sell_price_cents: 0,
          starting_price_cents: 0,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      savedId = data?.id || null;
      if (savedId) productId.value = savedId;
    }

    if (savedId) await ensurePricingRow(savedId);

    if (productMsg) productMsg.textContent = "Saved.";
    await fetchProducts();
    renderProductsList(productSearch.value);
    await refreshPicklists();
    renderStartupChecklist();
    const current = PRODUCTS_CACHE.find((p) => p.id === savedId);
    if (current) loadProductIntoForm(current);
  } catch (err) {
    if (productMsg) productMsg.textContent = err.message || String(err);
  }
});
btnArchiveProduct?.addEventListener("click", async () => {
  if (!productId.value) return;
  try {
    const { error } = await sb
      .from("products")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", productId.value)
      .eq(OPERATOR_COLUMN, opId());
    if (error) throw error;
    if (productMsg) productMsg.textContent = "Archived.";
    await fetchProducts();
    renderProductsList(productSearch.value);
    renderStartupChecklist();
  } catch (err) {
    if (productMsg) productMsg.textContent = err.message || String(err);
  }
});
async function uploadProductImage(file) {
  const key = `products/${opId()}/${Date.now()}_${safeFilename(file.name)}`;
  const { error: upErr } = await sb.storage.from("product-images").upload(key, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/png",
  });
  if (upErr) throw upErr;
  const { data } = sb.storage.from("product-images").getPublicUrl(key);
  if (!data?.publicUrl) throw new Error("Upload succeeded but no public URL returned.");
  return data.publicUrl;
}
btnUploadProductImage?.addEventListener("click", async () => {
  const file = productImageFile?.files?.[0];
  if (!file) {
    if (productImageStatus) productImageStatus.textContent = "Choose a file first.";
    return;
  }
  try {
    if (productImageStatus) productImageStatus.textContent = "Uploading…";
    productImageUrl.value = await uploadProductImage(file);
    if (productImageStatus) productImageStatus.textContent = "Uploaded. Click Save to store URL.";
  } catch (err) {
    if (productImageStatus) productImageStatus.textContent = err.message || String(err);
  }
});

async function fetchPricing() {
  const [productsRes, pricingRes] = await Promise.all([
    scopeQuery(sb
      .from("products")
      .select("id, name, category, pricing_mode, sell_price_cents, starting_price_cents"))
            .order("name", { ascending: true }),
    scopeQuery(sb
      .from("pricing")
      .select("*"))
            .order("product_id", { ascending: true }),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (pricingRes.error) throw pricingRes.error;

  const pricingByProductId = new Map((pricingRes.data || []).map((r) => [r.product_id, r]));

  return (productsRes.data || []).map((product) => {
    const pricingRow = pricingByProductId.get(product.id) || null;
    return {
      product_id: product.id,
      product_name: product.name || "",
      product_category: product.category || "",
      pricing_mode: normalizePricingModeForUi(product),
      sell_price_cents: Number(product.sell_price_cents || 0),
      starting_price_cents: Number(product.starting_price_cents || 0),
      unit_label: pricingRow?.unit_label || "each",
      cost_ingredients_cents: Number(pricingRow?.cost_ingredients_cents || 0),
      cost_packaging_cents: Number(pricingRow?.cost_packaging_cents || 0),
      labor_minutes: Number(pricingRow?.labor_minutes || 0),
      notes: pricingRow?.notes || "",
      has_cost_row: !!pricingRow,
    };
  });
}
function totalCostCents(row) {
  return Number(row.cost_ingredients_cents || 0) + Number(row.cost_packaging_cents || 0);
}
function renderPricing(rows) {
  if (!pricingList) return;

  pricingList.innerHTML = "";
  if (!rows.length) {
    pricingList.innerHTML = `<div class="muted">No products yet.</div>`;
    return;
  }

  rows.forEach((r) => {
    const mode = normalizePricingModeForUi(r);
    const amountCents = pricingAmountForUi(r);

    const el = document.createElement("div");
    el.className = "list-item";
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(r.product_name || r.product_id)}</div>
        <div class="li-sub muted">${escapeHtml(r.product_category || "")} • ${escapeHtml(r.unit_label || "each")}</div>
      </div>
      <div class="li-meta" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
        <label class="inline">
          <span class="muted">Mode</span>
          <select data-pricing-mode data-product-id="${escapeAttr(r.product_id)}" class="input sm">
            <option value="quote" ${mode === "quote" ? "selected" : ""}>Quote</option>
            <option value="fixed" ${mode === "fixed" ? "selected" : ""}>Fixed price</option>
            <option value="starts_at" ${mode === "starts_at" ? "selected" : ""}>Starts at</option>
          </select>
        </label>

        <label class="inline">
          <span class="muted">Amount</span>
          <input
            data-pricing-amount
            data-product-id="${escapeAttr(r.product_id)}"
            class="input sm"
            type="number"
            step="0.01"
            min="0"
            value="${money(amountCents)}"
            ${mode === "quote" ? "disabled" : ""}
          />
        </label>

        <label class="inline">
          <span class="muted">Cost</span>
          <input
            data-pricing-cost
            data-product-id="${escapeAttr(r.product_id)}"
            class="input sm"
            type="number"
            step="0.01"
            min="0"
            value="${money(totalCostCents(r))}"
          />
        </label>
      </div>
    `;
    pricingList.appendChild(el);
  });

  pricingList.querySelectorAll("select[data-pricing-mode]").forEach((selectEl) => {
    selectEl.addEventListener("change", async () => {
      const productIdValue = selectEl.getAttribute("data-product-id");
      const amountEl = pricingList.querySelector(`input[data-pricing-amount][data-product-id="${CSS.escape(productIdValue)}"]`);
      const mode = selectEl.value;

      if (amountEl) {
        amountEl.disabled = mode === "quote";
        if (mode === "quote") amountEl.value = "0.00";
      }

      const cents = toCents(amountEl?.value || 0);
      const productPatch = {
        ...normalizePricingForSave(mode, cents),
        updated_at: new Date().toISOString(),
      };

      try {
        const { error } = await sb
          .from("products")
          .update(productPatch)
          .eq("id", productIdValue)
          .eq(OPERATOR_COLUMN, opId());
        if (error) throw error;

        await fetchProducts();
        renderPricing(await fetchPricing());
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  });

  pricingList.querySelectorAll("input[data-pricing-amount]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const productIdValue = inp.getAttribute("data-product-id");
      const modeEl = pricingList.querySelector(`select[data-pricing-mode][data-product-id="${CSS.escape(productIdValue)}"]`);
      const mode = modeEl?.value || "quote";
      const cents = toCents(inp.value);

      const productPatch = {
        ...normalizePricingForSave(mode, cents),
        updated_at: new Date().toISOString(),
      };

      try {
        const { error } = await sb
          .from("products")
          .update(productPatch)
          .eq("id", productIdValue)
          .eq(OPERATOR_COLUMN, opId());
        if (error) throw error;

        await fetchProducts();
        renderPricing(await fetchPricing());
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  });

  pricingList.querySelectorAll("input[data-pricing-cost]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const productIdValue = inp.getAttribute("data-product-id");
      const cents = toCents(inp.value);

      try {
        await ensurePricingRow(productIdValue);

        const patch = {
          cost_ingredients_cents: cents,
          cost_packaging_cents: 0,
          updated_at: new Date().toISOString(),
        };

        const { error } = await sb
          .from("pricing")
          .update(patch)
          .eq("product_id", productIdValue)
          .eq(OPERATOR_COLUMN, opId());

        if (error) throw error;

        renderPricing(await fetchPricing());
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  });
}
btnRefreshSetup?.addEventListener("click", async () => {
  try {
    setSetupMessage('Refreshing setup…');
    await fetchOperatorSetup();
    setSetupMessage('Setup reloaded.', 'good');
  } catch (err) {
    setSetupMessage(err.message || String(err), 'bad');
  }
});
btnSaveSetup?.addEventListener("click", async () => {
  try {
    await saveOperatorSetup();
  } catch (err) {
    setSetupMessage(err.message || String(err), 'bad');
  }
});
btnSaveSetupTop?.addEventListener("click", async () => {
  try {
    await saveOperatorSetup();
  } catch (err) {
    setSetupMessage(err.message || String(err), 'bad');
  }
});
btnMarkSetupComplete?.addEventListener("click", async () => {
  try {
    await saveOperatorSetup({ onboarding_complete: true });
    setSetupMessage('Setup marked complete.', 'good');
  } catch (err) {
    setSetupMessage(err.message || String(err), 'bad');
  }
});
btnUploadSetupLogo?.addEventListener('click', async () => {
  const file = setupLogoFile?.files?.[0];
  if (!file) {
    if (setupLogoStatus) setupLogoStatus.textContent = 'Choose a logo file first.';
    return;
  }
  try {
    if (setupLogoStatus) setupLogoStatus.textContent = 'Uploading…';
    if (setupLogoUrl) setupLogoUrl.value = await uploadSetupAsset(file, 'logo');
    if (setupLogoStatus) setupLogoStatus.textContent = 'Uploaded. Save setup to keep it.';
    fillSetupForm(collectSetupPayload(), SETUP_STATE?.locked_record || null);
  } catch (err) {
    if (setupLogoStatus) setupLogoStatus.textContent = err.message || String(err);
  }
});
btnUploadSetupHero?.addEventListener('click', async () => {
  const file = setupHeroFile?.files?.[0];
  if (!file) {
    if (setupHeroStatus) setupHeroStatus.textContent = 'Choose a hero image first.';
    return;
  }
  try {
    if (setupHeroStatus) setupHeroStatus.textContent = 'Uploading…';
    if (setupHeroImageUrl) setupHeroImageUrl.value = await uploadSetupAsset(file, 'hero');
    if (setupHeroStatus) setupHeroStatus.textContent = 'Uploaded. Save setup to keep it.';
    fillSetupForm(collectSetupPayload(), SETUP_STATE?.locked_record || null);
  } catch (err) {
    if (setupHeroStatus) setupHeroStatus.textContent = err.message || String(err);
  }
});
[setupTagline, setupHeroHeading, setupHeroSubheading, setupAbout, setupLogoUrl, setupHeroImageUrl, setupPublicContactEmail, setupPublicBusinessPhone, setupServiceArea, setupInstagram, setupFacebook, setupHoursNotes, setupFulfillmentNotes, setupAccentColor].forEach((el) => {
  el?.addEventListener('input', () => { if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null); });
});
[setupShowPrices, setupAllowCustomRequests].forEach((el) => {
  el?.addEventListener('change', () => { if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null); });
});

btnRefreshPricing?.addEventListener("click", async () => {
  try {
    await fetchProducts();
    renderPricing(await fetchPricing());
  } catch (err) {
    alert(err.message || String(err));
  }
});

async function fetchExpenses() {
  const { data, error } = await scopeQuery(sb
    .from("expenses")
    .select("*"))
    .order("date", { ascending: false })
    .limit(250);
  if (error) throw error;
  EXPENSES_CACHE = data || [];
  return EXPENSES_CACHE;
}
function clearExpenseForm() {
  expenseId.value = "";
  expenseDate.value = "";
  expenseCategory.value = "";
  expenseVendor.value = "";
  expenseDescription.value = "";
  expenseAmount.value = "";
  if (expenseMsg) expenseMsg.textContent = "";
  if (expenseFormTitle) expenseFormTitle.textContent = "New expense";
}
function loadExpenseIntoForm(r) {
  expenseId.value = r.id;
  expenseDate.value = r.date || "";
  expenseCategory.value = r.category || "";
  expenseVendor.value = r.vendor || "";
  expenseDescription.value = r.description || r.notes || "";
  expenseAmount.value = money(r.amount_cents);
  if (expenseMsg) expenseMsg.textContent = "";
  if (expenseFormTitle) expenseFormTitle.textContent = "Edit expense";
}
function renderExpenses(rows) {
  if (!expensesList) return;
  expensesList.innerHTML = "";
  if (!rows.length) {
    expensesList.innerHTML = `<div class="muted">No expenses yet.</div>`;
    return;
  }

  rows.forEach((r) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "list-item";
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(r.category || "Expense")} — $${money(r.amount_cents)}</div>
        <div class="li-sub muted">${escapeHtml(r.date || "")} • ${escapeHtml(r.vendor || "")}</div>
      </div>
      <div class="li-meta">
        <span class="pill">${escapeHtml(r.description || r.notes || "")}</span>
      </div>
    `;
    el.addEventListener("click", () => loadExpenseIntoForm(r));
    expensesList.appendChild(el);
  });
}
btnNewExpense?.addEventListener("click", clearExpenseForm);
btnRefreshExpenses?.addEventListener("click", async () => {
  try {
    renderExpenses(await fetchExpenses());
    await refreshPicklists();
    renderStartupChecklist();
  } catch (err) {
    alert(err.message || String(err));
  }
});
expenseForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (expenseMsg) expenseMsg.textContent = "Saving…";

  const id = expenseId.value || null;
  const payload = withTenantScope({
    operator_id: opId(),
    date: expenseDate.value,
    expense_date: expenseDate.value,
    category: preferExisting(expenseCategory.value, PICK_EXPENSE_CATEGORIES),
    vendor: preferExisting(expenseVendor.value, PICK_VENDORS),
    description: expenseDescription.value.trim(),
    notes: expenseDescription.value.trim(),
    amount_cents: toCents(expenseAmount.value),
    updated_at: new Date().toISOString(),
  });

  try {
    const q = id
      ? sb.from("expenses").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
      : sb.from("expenses").insert({ ...payload, created_at: new Date().toISOString() });

    const { error } = await q;
    if (error) throw error;

    if (expenseMsg) expenseMsg.textContent = "Saved.";
    renderExpenses(await fetchExpenses());
    await refreshPicklists();
    renderStartupChecklist();
  } catch (err) {
    if (expenseMsg) expenseMsg.textContent = err.message || String(err);
  }
});
btnDeleteExpense?.addEventListener("click", async () => {
  if (!expenseId.value) return;
  try {
    const { error } = await sb.from("expenses").delete().eq("id", expenseId.value).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);
    if (error) throw error;
    clearExpenseForm();
    renderExpenses(await fetchExpenses());
    await refreshPicklists();
    renderStartupChecklist();
  } catch (err) {
    if (expenseMsg) expenseMsg.textContent = err.message || String(err);
  }
});

const AVAILABILITY_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
];
const AVAILABILITY_LEAD_TIMES = [
  { value: 0, label: "Same day" },
  { value: 24, label: "1 day notice" },
  { value: 48, label: "2 days notice" },
  { value: 72, label: "3 days notice" },
  { value: 96, label: "4 days notice" },
  { value: 168, label: "1 week notice" },
];

async function fetchAvailability() {
  const { data, error } = await scopeQuery(sb.from("availability").select("*")).limit(1).single();
  if (error && error.code !== "PGRST116") throw error;

  AVAILABILITY = normalizeAvailability(data || {
    operator_id: opId(),
    timezone: "America/New_York",
    rules: [],
    updated_at: new Date().toISOString(),
  });
  return AVAILABILITY;
}
function normalizeAvailability(input) {
  const base = input || {};
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const defaultRules = days.map((day) => ({
    day,
    enabled: !["saturday", "sunday"].includes(day),
    start: "08:00",
    end: "17:00",
  }));
  const existingRules = Array.isArray(base.rules) ? base.rules : [];

  return {
    operator_id: base.operator_id || opId(),
    timezone: base.timezone || "America/New_York",
    lead_time_hours: Number(base.lead_time_hours ?? 24),
    max_orders_per_day: Number(base.max_orders_per_day ?? 0),
    notes: String(base.notes || ""),
    blackout_dates: Array.isArray(base.blackout_dates) ? base.blackout_dates.filter(Boolean) : [],
    rules: days.map((day) => {
      const found = existingRules.find((r) => String(r?.day || "").toLowerCase() === day);
      return found
        ? { day, enabled: typeof found.enabled === "boolean" ? found.enabled : true, start: found.start || "08:00", end: found.end || "17:00" }
        : defaultRules.find((r) => r.day === day);
    }),
    updated_at: base.updated_at || new Date().toISOString(),
  };
}
function getTimezoneLabel(value) {
  return AVAILABILITY_TIMEZONES.find((tz) => tz.value === value)?.label || value || "Eastern Time";
}
function getLeadTimeLabel(hours) {
  return AVAILABILITY_LEAD_TIMES.find((x) => Number(x.value) === Number(hours))?.label || `${hours} hours`;
}
function getAvailabilityRule(av, dayName) {
  return (av.rules || []).find((r) => String(r.day || "").toLowerCase() === String(dayName || "").toLowerCase());
}
function formatEnabledDaySummary(av) {
  const enabled = (av.rules || []).filter((r) => !!r.enabled);
  if (!enabled.length) return "No order days enabled.";

  const groups = [];
  let current = [];

  for (const rule of enabled) {
    if (!current.length) current.push(rule);
    else if (current[current.length - 1].start === rule.start && current[current.length - 1].end === rule.end) current.push(rule);
    else {
      groups.push(current);
      current = [rule];
    }
  }
  if (current.length) groups.push(current);

  return groups.map((group) => {
    const first = prettifyDay(group[0].day);
    const last = prettifyDay(group[group.length - 1].day);
    return `${group.length === 1 ? first : `${first}–${last}`} ${formatTime12(group[0].start)} to ${formatTime12(group[0].end)}`;
  }).join("; ");
}
function availabilitySummaryText(av) {
  return `${formatEnabledDaySummary(av)} Lead time: ${getLeadTimeLabel(av.lead_time_hours)}. Timezone: ${getTimezoneLabel(av.timezone)}. ${Number(av.max_orders_per_day || 0) > 0 ? `Daily order limit: ${av.max_orders_per_day}.` : `No daily order limit set.`}`;
}
function getAvailabilityBlackoutDatesFromUi() {
  try {
    const parsed = JSON.parse($("availabilityBlackoutDatesData")?.value || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}
function renderBlackoutDateItems(dates) {
  return dates.length
    ? dates.map((date) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.03);">
          <span>${escapeHtml(date)}</span>
          <button type="button" class="btn btn-ghost availability-remove-blackout" data-date="${escapeAttr(date)}" style="padding:6px 10px;">Remove</button>
        </div>
      `).join("")
    : `<div class="muted" style="font-size:12px;">No closed dates added.</div>`;
}
function syncBlackoutDateUi(dates) {
  if ($("availabilityBlackoutDatesData")) $("availabilityBlackoutDatesData").value = JSON.stringify(dates);
  if ($("availabilityBlackoutList")) $("availabilityBlackoutList").innerHTML = renderBlackoutDateItems(dates);

  $("availabilityBlackoutList")?.querySelectorAll(".availability-remove-blackout").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncBlackoutDateUi(getAvailabilityBlackoutDatesFromUi().filter((x) => x !== btn.getAttribute("data-date")));
      updateAvailabilitySummaryFromForm();
    });
  });
}
function setAvailabilityDay(day, patch) {
  const enabledEl = availabilityWrap.querySelector(`.availability-day-enabled[data-day="${day}"]`);
  const startEl = availabilityWrap.querySelector(`.availability-day-start[data-day="${day}"]`);
  const endEl = availabilityWrap.querySelector(`.availability-day-end[data-day="${day}"]`);

  if (typeof patch.enabled === "boolean" && enabledEl) enabledEl.checked = patch.enabled;
  if (patch.start && startEl) startEl.value = patch.start;
  if (patch.end && endEl) endEl.value = patch.end;

  const enabled = enabledEl ? enabledEl.checked : false;
  if (startEl) startEl.disabled = !enabled;
  if (endEl) endEl.disabled = !enabled;
}
function copyDaySchedule(sourceDay, targetDays) {
  const enabled = !!availabilityWrap.querySelector(`.availability-day-enabled[data-day="${sourceDay}"]`)?.checked;
  const start = availabilityWrap.querySelector(`.availability-day-start[data-day="${sourceDay}"]`)?.value || "08:00";
  const end = availabilityWrap.querySelector(`.availability-day-end[data-day="${sourceDay}"]`)?.value || "17:00";
  targetDays.forEach((day) => setAvailabilityDay(day, { enabled, start, end }));
  updateAvailabilitySummaryFromForm();
}
function getScheduledDateFromOrder(row) {
  const candidates = [
    row?.scheduled_date,
    row?.requestedDate,
    row?.pickupDate,
    row?.deliveryDate,
    row?.date,
    row?.pickupWindow,
    row?.notes,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const text = String(candidate);
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (us) return `${us[3]}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  }
  return null;
}
function readBridgeOrders() {
  return Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];
}
function getAvailabilityOrderFeed() {
  const rows = readBridgeOrders();
  const scheduled = [];
  const unscheduled = [];
  rows.forEach((row) => {
    const scheduledDate = getScheduledDateFromOrder(row);
    (scheduledDate ? scheduled : unscheduled).push(scheduledDate ? { ...row, scheduledDate } : row);
  });
  scheduled.sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)));
  return { scheduled, unscheduled };
}
function buildAvailabilityCalendarCells(av, daysAhead = 28) {
  const { scheduled } = getAvailabilityOrderFeed();
  const ordersByDate = new Map();
  scheduled.forEach((row) => {
    const key = row.scheduledDate;
    if (!ordersByDate.has(key)) ordersByDate.set(key, []);
    ordersByDate.get(key).push(row);
  });

  const cells = [];
  const now = new Date();

  for (let i = 0; i < daysAhead; i += 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(now.getDate() + i);

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayName = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const rule = getAvailabilityRule(av, dayName);
    const blackout = (av.blackout_dates || []).includes(key);
    const orderRows = ordersByDate.get(key) || [];
    const count = orderRows.length;
    const cap = Number(av.max_orders_per_day || 0);
    const open = !!rule?.enabled && !blackout;
    const full = open && cap > 0 && count >= cap;

    cells.push({
      key,
      weekday: d.toLocaleDateString([], { weekday: "short" }),
      label: d.toLocaleDateString([], { month: "short", day: "numeric" }),
      open,
      full,
      blackout,
      count,
      stateLabel: blackout ? "Closed date" : full ? "Full" : open ? "Open" : "Closed",
      start: rule?.start || "",
      end: rule?.end || "",
      revenueCents: orderRows.reduce((sum, row) => sum + Number(row.estimatedTotalCents || 0), 0),
    });
  }
  return cells;
}
function buildPrepOutlook(daysAhead = 14) {
  const { scheduled, unscheduled } = getAvailabilityOrderFeed();
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() + daysAhead);

  const upcoming = scheduled.filter((row) => {
    const d = new Date(`${row.scheduledDate}T00:00:00`);
    return !Number.isNaN(d.getTime()) && d >= now && d <= end;
  });

  const itemCounts = new Map();
  const ingredientCounts = new Map();
  const productsByKey = new Map();
  PRODUCTS_CACHE.forEach((p) => {
    [String(p.id || "").toLowerCase(), String(p.slug || "").toLowerCase(), String(p.name || "").toLowerCase()]
      .filter(Boolean)
      .forEach((key) => productsByKey.set(key, p));
  });

  upcoming.forEach((row) => {
    (Array.isArray(row.items) ? row.items : []).forEach((item) => {
      const qty = Number(item?.qty || item?.quantity || 1) || 1;
      const name = String(item?.name || item?.title || item?.slug || "Item").trim();

      itemCounts.set(name, (itemCounts.get(name) || 0) + qty);

      const lookup =
        productsByKey.get(String(item?.id || "").toLowerCase()) ||
        productsByKey.get(String(item?.slug || "").toLowerCase()) ||
        productsByKey.get(name.toLowerCase());

      (Array.isArray(lookup?.ingredients) ? lookup.ingredients : []).forEach((ingredient) => {
        const clean = String(ingredient || "").trim();
        if (clean) ingredientCounts.set(clean, (ingredientCounts.get(clean) || 0) + qty);
      });
    });
  });

  return {
    upcoming,
    unscheduled,
    topItems: Array.from(itemCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
    topIngredients: Array.from(ingredientCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}
function updateAvailabilitySummaryFromForm() {
  const summaryEl = $("availabilitySummaryText");
  if (!summaryEl) return;
  try {
    summaryEl.textContent = availabilitySummaryText(collectAvailabilityFromForm());
  } catch {
    summaryEl.textContent = "Finish any invalid schedule fields to see the summary update.";
  }
}
function renderAvailability() {
  if (!availabilityWrap || !AVAILABILITY) return;

  const rules = AVAILABILITY.rules || [];
  const summaryText = availabilitySummaryText(AVAILABILITY);
  const maxOrdersEnabled = Number(AVAILABILITY.max_orders_per_day || 0) > 0;
  const calendarCells = buildAvailabilityCalendarCells(AVAILABILITY, 28);
  const prepOutlook = buildPrepOutlook(14);

  availabilityWrap.innerHTML = `
    <div class="availability-ui form">
      <div class="card" style="margin-bottom:14px;">
        <div class="card-hd">
          <strong>Availability summary</strong>
          <span class="muted">A plain-language view of what customers can request.</span>
        </div>
        <div class="card-bd">
          <div id="availabilitySummaryText" style="line-height:1.65;font-size:15px;color:var(--text);">${escapeHtml(summaryText)}</div>
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <div class="card-hd">
            <strong>Business schedule</strong>
            <span class="muted">Choose when orders are allowed.</span>
          </div>
          <div class="card-bd form">
            <label>Timezone
              <select id="availabilityTimezone">
                ${AVAILABILITY_TIMEZONES.map((tz) => `
                  <option value="${escapeAttr(tz.value)}" ${tz.value === AVAILABILITY.timezone ? "selected" : ""}>${escapeHtml(tz.label)}</option>
                `).join("")}
              </select>
            </label>

            <div class="grid two">
              <label>Lead time required
                <select id="availabilityLeadTime">
                  ${AVAILABILITY_LEAD_TIMES.map((o) => `
                    <option value="${o.value}" ${Number(o.value) === Number(AVAILABILITY.lead_time_hours) ? "selected" : ""}>${escapeHtml(o.label)}</option>
                  `).join("")}
                </select>
              </label>

              <div>
                <label class="inline" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;">
                  <input id="availabilityLimitToggle" type="checkbox" ${maxOrdersEnabled ? "checked" : ""} style="width:18px;height:18px;margin:0;" />
                  <span>Limit orders per day</span>
                </label>
                <input id="availabilityMaxOrders" type="number" min="1" step="1" value="${escapeAttr(maxOrdersEnabled ? AVAILABILITY.max_orders_per_day : 6)}" ${maxOrdersEnabled ? "" : "disabled"} />
              </div>
            </div>

            <label>Schedule notes
              <textarea id="availabilityNotes" rows="4" placeholder="Example: Custom cakes need at least 72 hours notice.">${escapeHtml(AVAILABILITY.notes || "")}</textarea>
            </label>
          </div>
        </div>

        <div class="card">
          <div class="card-hd">
            <strong>Closed or blackout dates</strong>
            <span class="muted">Add specific dates customers cannot book.</span>
          </div>
          <div class="card-bd form">
            <div class="row" style="align-items:end;gap:10px;">
              <label style="flex:1;">Closed date
                <input id="availabilityBlackoutDatePicker" type="date" />
              </label>
              <button id="btnAddAvailabilityBlackout" class="btn btn-ghost" type="button">Add date</button>
            </div>

            <input id="availabilityBlackoutDatesData" type="hidden" value="${escapeAttr(JSON.stringify(AVAILABILITY.blackout_dates || []))}" />
            <div id="availabilityBlackoutList" style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">${renderBlackoutDateItems(AVAILABILITY.blackout_dates || [])}</div>
            <div class="muted" style="font-size:12px;line-height:1.5;margin-top:8px;">Add holidays, vacations, or planned shutdown days.</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px;">
        <div class="card-hd" style="align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div>
            <strong>Order days and hours</strong>
            <div class="muted" style="margin-top:4px;">Turn days on or off, then set the order window.</div>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap;">
            <button id="btnCopyMondayToWeekdays" class="btn btn-ghost" type="button">Copy Monday to weekdays</button>
            <button id="btnSetWeekdaysStandard" class="btn btn-ghost" type="button">Set weekdays 8–5</button>
            <button id="btnCopyWeekdaysToWeekend" class="btn btn-ghost" type="button">Copy Friday to weekend</button>
            <button id="btnClearWeekend" class="btn btn-ghost" type="button">Close weekend</button>
          </div>
        </div>

        <div class="card-bd" style="display:flex;flex-direction:column;gap:12px;">
          ${rules.map((rule) => `
            <div style="display:grid;grid-template-columns:180px 1fr;gap:16px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:16px;background:rgba(0,0,0,.18);">
              <label class="inline" style="font-size:14px;color:var(--text);font-weight:700;">
                <input type="checkbox" class="availability-day-enabled" data-day="${escapeAttr(rule.day)}" ${rule.enabled ? "checked" : ""} style="width:18px;height:18px;margin:0;" />
                <span>${escapeHtml(prettifyDay(rule.day))}</span>
              </label>

              <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 220px));gap:12px;">
                <label>
                  <span class="muted">Start</span>
                  <input type="time" class="availability-day-start" data-day="${escapeAttr(rule.day)}" value="${escapeAttr(rule.start || "08:00")}" ${rule.enabled ? "" : "disabled"} />
                </label>
                <label>
                  <span class="muted">End</span>
                  <input type="time" class="availability-day-end" data-day="${escapeAttr(rule.day)}" value="${escapeAttr(rule.end || "17:00")}" ${rule.enabled ? "" : "disabled"} />
                </label>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="grid two" style="margin-top:14px;">
        <div class="card">
          <div class="card-hd">
            <strong>Next 28 days</strong>
            <span class="muted">Open, closed, full, and booked days at a glance.</span>
          </div>
          <div class="card-bd">
            <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">
              ${calendarCells.map((cell) => `
                <div style="border:1px solid var(--border);border-radius:14px;padding:10px;background:${cell.blackout ? "rgba(160,40,40,.15)" : cell.full ? "rgba(180,120,0,.15)" : cell.open ? "rgba(40,120,60,.12)" : "rgba(255,255,255,.03)"};">
                  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">
                    <strong>${escapeHtml(cell.label)}</strong>
                    <span class="muted">${escapeHtml(cell.weekday)}</span>
                  </div>
                  <div class="muted" style="font-size:12px;">${escapeHtml(cell.stateLabel)}</div>
                  <div style="font-size:12px;margin-top:6px;">${cell.open && cell.start && cell.end ? `${escapeHtml(formatTime12(cell.start))}–${escapeHtml(formatTime12(cell.end))}` : "—"}</div>
                  <div style="font-size:12px;margin-top:6px;">Orders: <strong>${cell.count}</strong></div>
                  <div style="font-size:12px;margin-top:4px;">Value: <strong>${formatUsd(cell.revenueCents || 0)}</strong></div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-hd">
            <strong>Prep outlook</strong>
            <span class="muted">Use upcoming scheduled requests to spot load and ingredient pressure.</span>
          </div>
          <div class="card-bd">
            <div style="margin-bottom:12px;">
              <div class="muted" style="margin-bottom:6px;">Upcoming scheduled orders</div>
              ${prepOutlook.upcoming.length ? `
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${prepOutlook.upcoming.slice(0, 8).map((row) => `
                    <div style="border:1px solid var(--border);border-radius:12px;padding:8px 10px;background:rgba(255,255,255,.03);">
                      <div style="display:flex;justify-content:space-between;gap:8px;">
                        <strong>${escapeHtml(row.scheduledDate)}</strong>
                        <span>${escapeHtml(row.name || "Customer")}</span>
                      </div>
                      <div class="muted" style="font-size:12px;margin-top:4px;">
                        ${escapeHtml(row.pickupWindow || row.occasion || "Scheduled request")} • ${formatUsd(row.estimatedTotalCents || 0)}
                      </div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div class="muted">No upcoming orders with a readable scheduled date yet.</div>`}
            </div>

            <div style="margin-bottom:12px;">
              <div class="muted" style="margin-bottom:6px;">Top upcoming items</div>
              ${prepOutlook.topItems.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${prepOutlook.topItems.map(([name, qty]) => `<span class="pill pill-on">${escapeHtml(name)} × ${escapeHtml(String(qty))}</span>`).join("")}
                </div>
              ` : `<div class="muted">No item-level counts available yet.</div>`}
            </div>

            <div style="margin-bottom:12px;">
              <div class="muted" style="margin-bottom:6px;">Ingredient watchlist</div>
              ${prepOutlook.topIngredients.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${prepOutlook.topIngredients.map(([name, qty]) => `<span class="pill">${escapeHtml(name)} × ${escapeHtml(String(qty))}</span>`).join("")}
                </div>
              ` : `<div class="muted">Ingredient forecasting becomes stronger as product ingredients and dated orders fill in.</div>`}
            </div>

            ${prepOutlook.unscheduled.length ? `
              <div>
                <div class="muted" style="margin-bottom:6px;">Requests missing a usable date</div>
                <div class="muted" style="font-size:12px;line-height:1.55;">${escapeHtml(String(prepOutlook.unscheduled.length))} request(s) do not yet include a readable date in the pickup/delivery window.</div>
              </div>
            ` : ""}
          </div>
        </div>
      </div>
    </div>
  `;

  syncBlackoutDateUi(AVAILABILITY.blackout_dates || []);

  availabilityWrap.querySelectorAll(".availability-day-enabled").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const day = checkbox.getAttribute("data-day");
      const start = availabilityWrap.querySelector(`.availability-day-start[data-day="${day}"]`);
      const end = availabilityWrap.querySelector(`.availability-day-end[data-day="${day}"]`);
      if (start) start.disabled = !checkbox.checked;
      if (end) end.disabled = !checkbox.checked;
      updateAvailabilitySummaryFromForm();
    });
  });

  availabilityWrap.querySelectorAll("#availabilityTimezone,#availabilityLeadTime,#availabilityNotes,.availability-day-start,.availability-day-end").forEach((el) => {
    el.addEventListener("change", updateAvailabilitySummaryFromForm);
    el.addEventListener("input", updateAvailabilitySummaryFromForm);
  });

  $("availabilityLimitToggle")?.addEventListener("change", (e) => {
    const input = $("availabilityMaxOrders");
    if (input) {
      input.disabled = !e.target.checked;
      if (!e.target.checked) input.value = "6";
    }
    updateAvailabilitySummaryFromForm();
  });

  $("availabilityMaxOrders")?.addEventListener("input", updateAvailabilitySummaryFromForm);

  $("btnAddAvailabilityBlackout")?.addEventListener("click", () => {
    const value = $("availabilityBlackoutDatePicker")?.value?.trim();
    if (!value) return;
    syncBlackoutDateUi(Array.from(new Set([...getAvailabilityBlackoutDatesFromUi(), value])).sort());
    if ($("availabilityBlackoutDatePicker")) $("availabilityBlackoutDatePicker").value = "";
    updateAvailabilitySummaryFromForm();
  });

  $("btnCopyMondayToWeekdays")?.addEventListener("click", () => copyDaySchedule("monday", ["tuesday", "wednesday", "thursday", "friday"]));
  $("btnSetWeekdaysStandard")?.addEventListener("click", () => {
    ["monday", "tuesday", "wednesday", "thursday", "friday"].forEach((day) => setAvailabilityDay(day, { enabled: true, start: "08:00", end: "17:00" }));
    updateAvailabilitySummaryFromForm();
  });
  $("btnCopyWeekdaysToWeekend")?.addEventListener("click", () => copyDaySchedule("friday", ["saturday", "sunday"]));
  $("btnClearWeekend")?.addEventListener("click", () => {
    ["saturday", "sunday"].forEach((day) => setAvailabilityDay(day, { enabled: false, start: "08:00", end: "17:00" }));
    updateAvailabilitySummaryFromForm();
  });
}
function collectAvailabilityFromForm() {
  const limitEnabled = !!$("availabilityLimitToggle")?.checked;
  const rules = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({
    day,
    enabled: !!document.querySelector(`.availability-day-enabled[data-day="${day}"]`)?.checked,
    start: document.querySelector(`.availability-day-start[data-day="${day}"]`)?.value || "08:00",
    end: document.querySelector(`.availability-day-end[data-day="${day}"]`)?.value || "17:00",
  }));

  for (const rule of rules) {
    if (rule.enabled && rule.start >= rule.end) {
      throw new Error(`${prettifyDay(rule.day)} has an end time that must be later than the start time.`);
    }
  }

  const maxOrdersPerDay = limitEnabled ? Number($("availabilityMaxOrders")?.value || 0) : 0;
  if (limitEnabled && maxOrdersPerDay < 1) throw new Error("Daily order limit must be at least 1 when enabled.");

  return normalizeAvailability({
    operator_id: opId(),
    timezone: $("availabilityTimezone")?.value || "America/New_York",
    lead_time_hours: Number($("availabilityLeadTime")?.value || 24),
    max_orders_per_day: maxOrdersPerDay,
    notes: $("availabilityNotes")?.value?.trim() || "",
    blackout_dates: getAvailabilityBlackoutDatesFromUi(),
    rules,
    updated_at: new Date().toISOString(),
  });
}
btnRefreshAvailability?.addEventListener("click", async () => {
  try {
    await fetchAvailability();
    renderAvailability();
    if (availabilityMsg) availabilityMsg.textContent = "";
  } catch (err) {
    if (availabilityMsg) availabilityMsg.textContent = err.message || String(err);
  }
});
btnSaveAvailability?.addEventListener("click", async () => {
  try {
    if (availabilityMsg) availabilityMsg.textContent = "Saving…";
    const payload = collectAvailabilityFromForm();
    const { error } = await sb.from("availability").upsert(payload, { onConflict: `${TENANT_COLUMN},${OPERATOR_COLUMN}` });
    if (error) throw error;
    AVAILABILITY = normalizeAvailability(payload);
    renderAvailability();
    if (availabilityMsg) availabilityMsg.textContent = "Availability saved.";
  } catch (err) {
    if (availabilityMsg) availabilityMsg.textContent = err.message || String(err);
  }
});

async function fetchCustomers() {
  const { data, error } = await scopeQuery(sb
    .from("customers")
    .select("*"))
    .order("lifetime_value_cents", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  CUSTOMERS_CACHE = data || [];
  return CUSTOMERS_CACHE;
}
async function fetchCustomerInteractions(customerId) {
  const { data, error } = await scopeQuery(sb
    .from("customer_interactions")
    .select("*"))
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}
async function fetchCrmOrders() {
  let query = scopeQuery(sb
    .from("orders")
    .select("*"))
    .order("created_at", { ascending: false })
    .limit(250);

  const { data, error } = await query;
  if (error) throw error;
  CRM_ORDERS_CACHE = data || [];
  return CRM_ORDERS_CACHE;
}
async function fetchPayments() {
  const { data, error } = await scopeQuery(sb
    .from("payments")
    .select("*"))
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) throw error;
  PAYMENTS_CACHE = data || [];
  return PAYMENTS_CACHE;
}
function findExistingCustomerRecord(row) {
  const email = String(row?.email || "").trim().toLowerCase();
  const phone = String(row?.phone || "").trim();
  return CUSTOMERS_CACHE.find((c) =>
    (email && String(c.email || "").trim().toLowerCase() === email) ||
    (phone && String(c.phone || "").trim() === phone)
  ) || null;
}
async function upsertCrmCustomerFromBridge(row) {
  const existing = findExistingCustomerRecord(row);
  if (existing) return existing;

  const payload = withTenantScope({
    operator_id: opId(),
    name: row.name || "Customer",
    email: row.email || null,
    phone: row.phone || null,
    preferred_contact: row.preferred || row.preferredContact || "email",
    notes: row.notes || "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_contact_at: new Date().toISOString(),
  });

  const { data, error } = await sb.from("customers").insert(payload).select("*").single();
  if (error) throw error;
  CUSTOMERS_CACHE.unshift(data);
  return data;
}
async function orderExistsForBridgeId(bridgeId) {
  const { data, error } = await scopeQuery(sb
    .from("orders")
    .select("id"))
    .eq("source_type", "bridge")
    .eq("source_ref", bridgeId)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}
async function importBridgeOrdersToCrm() {
  const rows = readBridgeOrders();
  if (!rows.length) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    if (await orderExistsForBridgeId(row.id)) {
      skipped += 1;
      continue;
    }

    const customer = await upsertCrmCustomerFromBridge(row);
    const scheduledDate = getScheduledDateFromOrder(row);
    const totalCents = Number(row.estimatedTotalCents || 0);

    const { data: orderData, error: orderError } = await sb.from("orders").insert(withTenantScope({
      operator_id: opId(),
      customer_id: customer.id,
      status: row.status === "reviewed" ? "quoted" : "draft",
      scheduled_date: scheduledDate || null,
      scheduled_time: row.pickupWindow || null,
      items: Array.isArray(row.items) ? row.items : [],
      subtotal_cents: totalCents,
      total_cents: totalCents,
      notes: row.notes || row.cartSummary || "",
      source_type: "bridge",
      source_ref: row.id,
      created_at: row.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).select("*").single();

    if (orderError) throw orderError;
    CRM_ORDERS_CACHE.unshift(orderData);

    await sb.from("customer_interactions").insert(withTenantScope({
      operator_id: opId(),
      customer_id: customer.id,
      type: "order_imported",
      summary: `Imported storefront request for ${formatUsd(totalCents)}`,
      metadata: { bridge_id: row.id, pickup_window: row.pickupWindow || null },
      source_type: "bridge",
      source_ref: row.id,
      created_at: new Date().toISOString(),
    }));

    const existingValue = Number(customer.lifetime_value_cents || 0);
    const existingCount = Number(customer.order_count || 0);

    const { data: updatedCustomer, error: customerError } = await sb.from("customers")
      .update({
        lifetime_value_cents: existingValue + totalCents,
        order_count: existingCount + 1,
        updated_at: new Date().toISOString(),
        last_contact_at: new Date().toISOString(),
      })
      .eq("id", customer.id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();

    if (customerError) throw customerError;
    CUSTOMERS_CACHE = CUSTOMERS_CACHE.map((c) => c.id === customer.id ? updatedCustomer : c);
    imported += 1;
  }

  await Promise.all([fetchCustomers(), fetchCrmOrders(), fetchPayments()]);
  return { imported, skipped };
}
function renderCustomersList(filter = "") {
  if (!customersList) return;
  const q = String(filter || "").trim().toLowerCase();

  const rows = CUSTOMERS_CACHE.filter((c) =>
    !q || [c.name, c.email, c.phone].some((x) => String(x || "").toLowerCase().includes(q))
  );

  customersList.innerHTML = rows.length ? "" : `<div class="muted">No customers yet.</div>`;

  rows.forEach((c) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `list-item ${ACTIVE_CUSTOMER_ID === c.id ? "is-active" : ""}`;
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(c.name || "Unnamed customer")}</div>
        <div class="li-sub muted">${escapeHtml(c.email || "No email")} • ${escapeHtml(c.phone || "No phone")}</div>
      </div>
      <div class="li-meta">
        <span class="pill pill-on">${formatUsd(c.lifetime_value_cents || 0)}</span>
        <span class="pill">${escapeHtml(String(c.order_count || 0))} orders</span>
      </div>
    `;
    el.addEventListener("click", async () => {
      ACTIVE_CUSTOMER_ID = c.id;
      renderCustomersList(customerSearch?.value || "");
      await renderCustomerDetail(c.id);
    });
    customersList.appendChild(el);
  });

  if (!ACTIVE_CUSTOMER_ID && rows[0]) ACTIVE_CUSTOMER_ID = rows[0].id;
  if (ACTIVE_CUSTOMER_ID) renderCustomerDetail(ACTIVE_CUSTOMER_ID).catch(console.error);
}
async function renderCustomerDetail(customerId) {
  if (!customerDetailWrap) return;
  const customer = CUSTOMERS_CACHE.find((c) => c.id === customerId);
  if (!customer) {
    customerDetailWrap.innerHTML = `<div class="muted">Select a customer to inspect the record.</div>`;
    return;
  }

  const customerOrders = CRM_ORDERS_CACHE.filter((o) => o.customer_id === customerId).slice(0, 12);
  const interactions = await fetchCustomerInteractions(customerId);
  const customerPayments = PAYMENTS_CACHE.filter((p) => p.customer_id === customerId).slice(0, 12);

  customerDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Customer profile</div>
      <div><strong>${escapeHtml(customer.name || "Unnamed customer")}</strong></div>
      <div class="detail-copy">${escapeHtml(customer.email || "No email")} • ${escapeHtml(customer.phone || "No phone")}</div>
      <div class="detail-copy">Preferred contact: ${escapeHtml(customer.preferred_contact || "email")}</div>
      <div class="detail-copy">Lifetime value: ${formatUsd(customer.lifetime_value_cents || 0)} • Orders: ${escapeHtml(String(customer.order_count || 0))}</div>
      <div class="detail-copy">Last touch: ${escapeHtml(customer.last_contact_at ? formatDateTime(customer.last_contact_at) : "Not recorded")}</div>
    </div>

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Operator notes</div>
      <textarea id="customerNotesInput" rows="4">${escapeHtml(customer.notes || "")}</textarea>
      <div class="row" style="margin-top:10px;">
        <button id="btnSaveCustomerNotes" class="btn btn-primary" type="button">Save notes</button>
      </div>
    </div>

    <div class="grid two" style="margin-top:14px;">
      <div class="card">
        <div class="card-hd">
          <strong>Recent orders</strong>
          <span class="muted">Most recent first</span>
        </div>
        <div class="card-bd">
          ${customerOrders.length ? `
            <div class="list">
              ${customerOrders.map((o) => `
                <div class="list-item">
                  <div class="li-main">
                    <div class="li-title">${escapeHtml(o.status || "draft")}</div>
                    <div class="li-sub muted">${escapeHtml(o.scheduled_date || "No scheduled date")} • ${escapeHtml(o.scheduled_time || "No time")}</div>
                  </div>
                  <div class="li-meta">
                    <span class="pill pill-on">${formatUsd(o.total_cents || 0)}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No CRM orders for this customer yet.</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-hd">
          <strong>Payments</strong>
          <span class="muted">Stripe will plug in here next.</span>
        </div>
        <div class="card-bd">
          ${customerPayments.length ? `
            <div class="list">
              ${customerPayments.map((p) => `
                <div class="list-item">
                  <div class="li-main">
                    <div class="li-title">${escapeHtml(p.status || "pending")}</div>
                    <div class="li-sub muted">${escapeHtml(formatDateTime(p.created_at))}</div>
                  </div>
                  <div class="li-meta">
                    <span class="pill pill-on">${formatUsd(p.amount_cents || 0)}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No payments recorded yet.</div>`}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px;">
      <div class="card-hd">
        <strong>Interaction timeline</strong>
        <span class="muted">Capture live notes while you are on the phone.</span>
      </div>
      <div class="card-bd">
        <div class="row">
          <select id="customerInteractionType" style="max-width:200px;">
            <option value="note">Note</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="order">Order</option>
            <option value="payment">Payment</option>
          </select>
          <input id="customerInteractionSummary" class="input" style="flex:1;max-width:none;" placeholder="What happened with this customer?" />
          <button id="btnAddCustomerInteraction" class="btn btn-primary" type="button">Add interaction</button>
        </div>

        <div style="margin-top:14px;">
          ${interactions.length ? `
            <div class="list">
              ${interactions.map((i) => `
                <div class="list-item">
                  <div class="li-main">
                    <div class="li-title">${escapeHtml(i.type)}</div>
                    <div class="li-sub muted">${escapeHtml(i.summary || "No summary")}</div>
                  </div>
                  <div class="li-meta">
                    <span class="pill">${escapeHtml(formatDateTime(i.created_at))}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No interactions logged yet.</div>`}
        </div>
      </div>
    </div>
  `;

  $("btnSaveCustomerNotes")?.addEventListener("click", async () => {
    const notes = $("customerNotesInput")?.value?.trim() || "";
    const { data, error } = await sb.from("customers")
      .update({ notes, updated_at: new Date().toISOString() })
      .eq("id", customerId).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();

    if (error) {
      alert(error.message || String(error));
      return;
    }
    CUSTOMERS_CACHE = CUSTOMERS_CACHE.map((c) => c.id === customerId ? data : c);
    renderCustomersList(customerSearch?.value || "");
  });

  $("btnAddCustomerInteraction")?.addEventListener("click", async () => {
    const type = $("customerInteractionType")?.value || "note";
    const summary = $("customerInteractionSummary")?.value?.trim() || "";
    if (!summary) return;

    const { error } = await sb.from("customer_interactions").insert(withTenantScope({
      operator_id: opId(),
      customer_id: customerId,
      type,
      summary,
      metadata: {},
      created_at: new Date().toISOString(),
    }));
    if (error) {
      alert(error.message || String(error));
      return;
    }

    await sb.from("customers")
      .update({ last_contact_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", customerId).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);

    await fetchCustomers();
    await renderCustomerDetail(customerId);
    renderCustomersList(customerSearch?.value || "");
  });
}
customerSearch?.addEventListener("input", () => renderCustomersList(customerSearch.value));
btnRefreshCustomers?.addEventListener("click", async () => {
  try {
    await Promise.all([fetchCustomers(), fetchCrmOrders(), fetchPayments()]);
    renderCustomersList(customerSearch?.value || "");
  } catch (err) {
    alert(err.message || String(err));
  }
});

function renderPayments() {
  if (!paymentsList) return;
  paymentsList.innerHTML = PAYMENTS_CACHE.length ? "" : `<div class="muted">No payments recorded yet.</div>`;

  PAYMENTS_CACHE.forEach((p) => {
    const customer = CUSTOMERS_CACHE.find((c) => c.id === p.customer_id);
    const order = CRM_ORDERS_CACHE.find((o) => o.id === p.order_id);

    const el = document.createElement("div");
    el.className = "list-item";
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(customer?.name || "Customer")}</div>
        <div class="li-sub muted">${escapeHtml(order?.status || "order")} • ${escapeHtml(formatDateTime(p.created_at))}</div>
      </div>
      <div class="li-meta">
        <span class="pill">${escapeHtml(p.status || "pending")}</span>
        <span class="pill pill-on">${formatUsd(p.amount_cents || 0)}</span>
      </div>
    `;
    paymentsList.appendChild(el);
  });
}
btnRefreshPayments?.addEventListener("click", async () => {
  try {
    await fetchPayments();
    renderPayments();
  } catch (err) {
    alert(err.message || String(err));
  }
});

function currentMonthExpenseCents() {
  const mk = yyyymm(new Date());
  return EXPENSES_CACHE.filter((row) => monthKeyFromDate(row.date) === mk)
    .reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
}
function openOrdersCount() {
  return CRM_ORDERS_CACHE.filter((x) => !["fulfilled", "completed", "paid", "cancelled"].includes(String(x.status || "").toLowerCase())).length;
}
function quotedRevenueCents() {
  return CRM_ORDERS_CACHE.reduce((sum, row) => sum + Number(row.total_cents || row.estimated_total_cents || 0), 0);
}
function forecastMonthOrders() {
  const rows = Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];
  if (!rows.length) return 0;
  const now = Date.now();
  const last14 = rows.filter((row) => {
    const d = new Date(row.created_at || row.createdAt || 0).getTime();
    return Number.isFinite(d) && d > 0 && (now - d) <= 14 * 24 * 60 * 60 * 1000;
  }).length;
  return Math.round((last14 / 14) * 30);
}
function renderDashboard() {
  if (!dashboardWrap) return;

  const currentExpenses = currentMonthExpenseCents();
  const quotedRevenue = quotedRevenueCents();
  const publishedProducts = PRODUCTS_CACHE.filter((p) => !!p.is_active).length;
  const alerts = [];

  if (!CUSTOMERS_CACHE.length) alerts.push("No customers are in CRM yet. Once storefront orders hit the database, customer history gets stronger.");
  if (!CRM_ORDERS_CACHE.length) alerts.push("No CRM orders exist yet. That means lifetime value and customer ranking are still shallow.");
  if (!EXPENSES_CACHE.length) alerts.push("No expenses are logged yet, so profit visibility is still weak.");

  const metricsHtml = window.ProofLinkAnalyticsWidgets?.renderCards
    ? window.ProofLinkAnalyticsWidgets.renderCards({
        revenueThisMonth: currentMonthRevenueCents() / 100,
        revenueLastMonth: lastMonthRevenueCents() / 100,
        orderCountThisMonth: currentMonthOrderCount(),
        averageOrderValue: averageOrderValueCents() / 100,
        newCustomersThisMonth: currentMonthCustomerCount(),
        expensesThisMonth: currentExpenses / 100,
        outstandingOrders: openOrdersCount()
      })
    : '';

  const checklistHtml = window.ProofLinkChecklistEngine?.renderServerChecklist
    ? window.ProofLinkChecklistEngine.renderServerChecklist(DASHBOARD_LAUNCH_CHECKLIST || { steps: [], percent: 0, launch_ready: false })
    : '';

  const paymentHtml = window.ProofLinkStripeReadiness?.render && DASHBOARD_PAYMENT_STATE
    ? window.ProofLinkStripeReadiness.render({
        billing_status: DASHBOARD_PAYMENT_STATE.billingStatus,
        connect_status: DASHBOARD_PAYMENT_STATE.connectStatus,
        online_payments_enabled: DASHBOARD_PAYMENT_STATE.onlinePaymentsEligible
      })
    : '';

  dashboardWrap.innerHTML = `
    ${metricsHtml}

    <div class="cards">
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Open work</div>
          <div class="money">${openOrdersCount()}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Customer count</div>
          <div class="money">${CUSTOMERS_CACHE.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Quoted / ordered pipeline</div>
          <div class="money">${formatUsd(quotedRevenue)}</div>
        </div>
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">
        <h3>What needs attention</h3>
        <p>${alerts.length ? alerts.map((x) => escapeHtml(x)).join("<br>") : "Core operator signals look stable right now."}</p>
      </div>
      <div class="insight">
        <h3>CRM value</h3>
        <p>Top customer today: <strong>${escapeHtml(CUSTOMERS_CACHE[0]?.name || "None yet")}</strong>${CUSTOMERS_CACHE[0] ? ` • ${formatUsd(CUSTOMERS_CACHE[0].lifetime_value_cents || 0)}` : ""}</p>
        <p>Published products: <strong>${publishedProducts}</strong></p>
      </div>
      <div class="insight">
        <h3>Cash awareness</h3>
        <p>Tracked expenses this month: <strong>${formatUsd(currentExpenses)}</strong></p>
        <p>Forecasted month orders: <strong>${forecastMonthOrders()}</strong></p>
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">${checklistHtml || '<h3>Launch checklist</h3><p>Checklist unavailable right now.</p>'}</div>
      <div class="insight">${paymentHtml || '<h3>Payment readiness</h3><p>Payment truth will appear here once tenant state loads.</p>'}</div>
      <div class="insight">
        <h3>Tier posture</h3>
        <p>Use the payments page to control tier, connect Stripe, and see when online checkout is truly ready.</p>
        <p><strong>Next move:</strong> finish the highest-priority pending checklist step before adding new complexity.</p>
      </div>
    </div>
  `;
}
function renderOrders() {
  if (!ordersList) return;
  const rows = Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];

  if (!rows.length) {
    ordersList.innerHTML = `<div class="muted">No orders yet.</div>`;
    if (orderDetailWrap) orderDetailWrap.innerHTML = `<div class="muted">Select an order to inspect it.</div>`;
    return;
  }

  if (!ACTIVE_ORDER_ID) ACTIVE_ORDER_ID = rows[0].id;
  const active = rows.find((x) => x.id === ACTIVE_ORDER_ID) || rows[0];
  ACTIVE_ORDER_ID = active.id;

  ordersList.innerHTML = rows.map((row) => {
    const customerName = row.customer_name || row.name || "Unnamed customer";
    const customerEmail = row.email || "No email";
    const submittedAt = row.created_at || row.createdAt || new Date().toISOString();
    const fulfillment = row.fulfillment || "pickup";
    const scheduledDate = row.scheduled_date || getScheduledDateFromOrder(row) || "No scheduled date";
    const scheduledTime = row.scheduled_time || row.pickupWindow || "No time";
    const totalCents = Number(row.total_cents || row.subtotal_cents || row.estimatedTotalCents || 0);

    return `
      <button type="button" class="list-item ${row.id === active.id ? "is-active" : ""}" data-order-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(customerName)}</div>
          <div class="li-sub muted">${escapeHtml(customerEmail)} • ${escapeHtml(formatDateTime(submittedAt))}</div>
          <div class="li-sub muted">${escapeHtml(fulfillment)} • ${escapeHtml(String(scheduledDate))} • ${escapeHtml(String(scheduledTime))}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${["fulfilled", "completed", "paid"].includes(String(row.status || "new").toLowerCase()) ? "pill-on" : ""}">${escapeHtml(String(row.status || "new"))}</span>
          <span class="pill">${formatUsd(totalCents)}</span>
        </div>
      </button>
    `;
  }).join("");

  ordersList.querySelectorAll("[data-order-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_ORDER_ID = btn.getAttribute("data-order-id");
      renderOrders();
    });
  });

  const totalCents = Number(active.total_cents || active.subtotal_cents || active.estimatedTotalCents || 0);
  const scheduledDate = active.scheduled_date || getScheduledDateFromOrder(active) || "Not specified";
  const scheduledTime = active.scheduled_time || active.pickupWindow || "Not specified";
  const itemCount = Array.isArray(active.items) ? active.items.length : Number(active.item_count || active.itemCount || 0);
  const notesText = active.notes || active.cartSummary || "No extra notes provided.";

  orderDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Customer</div>
      <div><strong>${escapeHtml(active.customer_name || active.name || "Unnamed customer")}</strong></div>
      <div class="detail-copy">${escapeHtml(active.email || "No email")} • ${escapeHtml(active.phone || "No phone")}</div>
      <div class="detail-copy">Submitted: ${escapeHtml(formatDateTime(active.created_at || active.createdAt))}</div>
      <div class="detail-copy">Status: ${escapeHtml(String(active.status || "new"))}</div>
    </div>

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Order profile</div>
      <div class="detail-copy">Fulfillment: ${escapeHtml(active.fulfillment || "pickup")}</div>
      <div class="detail-copy">Scheduled date: ${escapeHtml(String(scheduledDate))}</div>
      <div class="detail-copy">Scheduled time: ${escapeHtml(String(scheduledTime))}</div>
      <div class="detail-copy">Items: ${escapeHtml(String(itemCount))}</div>
    </div>

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Commercial read</div>
      <div class="detail-copy">Order value: ${formatUsd(totalCents)}</div>
      <div class="detail-copy">Tenant: ${escapeHtml(active.tenant_id || TENANT_ID)}</div>
      <div class="detail-copy">${escapeHtml(notesText)}</div>
    </div>

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Order status</div>
      <div class="row" style="margin-top:10px; align-items:end;">
        <label class="field" style="flex:1;">
          <span>Status</span>
          <select id="orderStatusSelect">
            ${["new", "confirmed", "fulfilled", "cancelled"].map((status) => `<option value="${status}" ${String(active.status || "new").toLowerCase() === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </label>
        <button id="btnSaveOrderStatus" class="btn btn-primary" type="button">Save status</button>
      </div>
    </div>
  `;

  $("btnSaveOrderStatus")?.addEventListener("click", async () => {
    const nextStatus = $("orderStatusSelect")?.value || "new";
    const { data, error } = await sb.from("orders")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", active.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();

    if (error) {
      alert(error.message || String(error));
      return;
    }

    CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) => row.id === active.id ? data : row);
    renderOrders();
    renderDashboard();
    renderGuidance();
  });
}
function renderGuidance() {
  if (!guidanceWrap) return;
  const notes = [];
  notes.push(["CRM foundation", CUSTOMERS_CACHE.length ? `You now have ${CUSTOMERS_CACHE.length} customer record(s). Start ranking by lifetime value and following up based on order history.` : "No customers are in CRM yet. Database-backed orders are live, so customer history can now grow directly from storefront requests."]);
  notes.push(["Payments", PAYMENTS_CACHE.length ? "Payments are flowing into the operator record. Stripe integration can now plug into an existing customer + order structure." : "Payments table is empty. Next serious upgrade is Stripe checkout + webhook updates."]);
  notes.push(["Orders", CRM_ORDERS_CACHE.length ? `You have ${CRM_ORDERS_CACHE.length} live database order(s). This is the backbone for customer value tracking.` : "No database orders exist yet. Once storefront requests land in Supabase, customer value tracking starts immediately."]);

  guidanceWrap.innerHTML = `
    <div class="guidance-grid">
      ${notes.map(([title, copy]) => `
        <div class="guidance-card">
          <div class="kicker">${escapeHtml(title)}</div>
          <div class="guidance-copy">${escapeHtml(copy)}</div>
        </div>
      `).join("")}
    </div>
  `;
}
btnRefreshDashboard?.addEventListener("click", async () => {
  await Promise.allSettled([fetchDashboardLaunchChecklist(), fetchDashboardPaymentState()]);
  renderDashboard();
  renderGuidance();
});
btnRefreshOrders?.addEventListener("click", async () => {
  try {
    await fetchCrmOrders();
    renderOrders();
    renderDashboard();
    renderGuidance();
  } catch (err) {
    alert(err.message || String(err));
  }
});
btnRefreshGuidance?.addEventListener("click", () => {
  renderGuidance();
  renderDashboard();
});
btnExportOrders?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(CRM_ORDERS_CACHE || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `operator-orders-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
if (btnImportBridgeOrders) {
  btnImportBridgeOrders.hidden = true;
  btnImportBridgeOrders.disabled = true;
}

btnRefreshMoney?.addEventListener("click", () => renderMoney().catch(console.error));
async function renderMoney() {
  if (!moneyWrap) return;

  const pricingRows = await fetchPricing();
  const expByMonth = new Map();
  EXPENSES_CACHE.forEach((e) => {
    const mk = monthKeyFromDate(e.date);
    if (mk) expByMonth.set(mk, (expByMonth.get(mk) || 0) + Number(e.amount_cents || 0));
  });

  const productsMissingPrice = PRODUCTS_CACHE.filter((p) => {
    const mode = String(p.pricing_mode || "").trim().toLowerCase();
    const sell = Number(p.sell_price_cents || 0);
    const start = Number(p.starting_price_cents || 0);

    if (sell > 0) return false;
    if (start > 0) return false;
    if (mode === "quote") return false;

    return true;
  }).length;

  const months = Array.from(expByMonth.keys()).sort().reverse();

  moneyWrap.innerHTML = `
    <div class="cards">
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Customers</div>
          <div class="money">${CUSTOMERS_CACHE.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">CRM orders</div>
          <div class="money">${CRM_ORDERS_CACHE.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Top customer value</div>
          <div class="money">${formatUsd(CUSTOMERS_CACHE[0]?.lifetime_value_cents || 0)}</div>
        </div>
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">
        <h3>Catalog health</h3>
        <p>Missing sell price: <strong>${productsMissingPrice}</strong></p>
        <p>Missing image: <strong>${PRODUCTS_CACHE.filter((p) => !String(p.image_url || "").trim()).length}</strong></p>
      </div>
      <div class="insight">
        <h3>Revenue memory</h3>
        <p>The system can now rank customers by value and tie revenue back to people instead of isolated receipts.</p>
      </div>
    </div>

    ${months.length ? `
      <div class="table" style="margin-top:14px;">
        <div class="tr th">
          <div>Month</div>
          <div class="right">Expenses</div>
        </div>
        ${months.map((m) => `
          <div class="tr">
            <div>${escapeHtml(m)}</div>
            <div class="right">${formatUsd(expByMonth.get(m) || 0)}</div>
          </div>
        `).join("")}
      </div>
    ` : `<div class="muted" style="margin-top:14px;">No expenses logged yet.</div>`}
  `;
}

async function boot() {
  if (BOOTING) return;
  if (pendingAuthCallback) return; // Auth callback will handle this
  BOOTING = true;
  window.PROOFLINK_BOOT_READY = false;

  try {
    const user = await refreshSession();
    if (!user) return;

    await requireOperatorContext();

    await Promise.all([
      fetchProducts(),
      fetchExpenses(),
      fetchCustomers(),
      fetchCrmOrders(),
      fetchPayments(),
      fetchAvailability(),
      fetchOperatorSetup().catch(() => null),
    ]);

    showApp(user);

    renderProductsList("");
    renderAvailability();
    renderPricing(await fetchPricing());
    renderExpenses(EXPENSES_CACHE);
    await refreshPicklists();
    renderStartupChecklist();
    await Promise.allSettled([fetchDashboardLaunchChecklist(), fetchDashboardPaymentState()]);
    renderDashboard();
    renderOrders();
    renderCustomersList("");
    renderPayments();
    renderGuidance();
    await renderMoney();
    switchTab(panelFromLocation(), { updateHash: false });

    window.PROOFLINK_BOOT_READY = true;
  } catch (err) {
    console.error(err);
    CURRENT_OPERATOR = null;
    window.PROOFLINK_BOOT_READY = false;
    showLogin(err?.message || String(err));
  } finally {
    BOOTING = false;
  }
}

window.PROOFLINK_OPERATOR_RUNTIME = {
  getAccessToken: async () => {
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || "";
  },
  getTenantId: () => TENANT_ID,
  getOperatorId: () => CURRENT_OPERATOR?.operator_id || "",
  getActiveOrderId: () => ACTIVE_ORDER_ID || "",
  getActiveOrder: () => CRM_ORDERS_CACHE.find((row) => row.id === ACTIVE_ORDER_ID) || null,
  refreshPayments: async () => { await fetchPayments(); renderPayments(); },
  refreshOrders: async () => { await fetchCrmOrders(); renderOrders(); },
};

initBranding();
boot().catch((err) => {
  console.error(err);
  showLogin(err?.message || String(err));
});
