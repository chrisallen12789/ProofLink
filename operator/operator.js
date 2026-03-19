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
let BIDS_CACHE = [];
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
let ACTIVE_BID_ID = null;
let ACTIVE_CUSTOMER_ID = null;
let CUSTOMER_CREATING = false;
let ACTIVE_PAYMENT_ID = null;
let ACTIVE_BID_LINE_ITEM_ID = null;
let BID_QUICK_CUSTOMER_OPEN = false;
let DASHBOARD_PAYMENT_STATE = null;
let DASHBOARD_LAUNCH_CHECKLIST = null;

function currentMonthRevenueCents() {
  const mk = yyyymm(new Date());
  return PAYMENTS_CACHE.filter((row) => monthKeyFromDate(row.paid_at || row.created_at || row.updated_at || new Date()) === mk)
    .reduce((sum, row) => sum + paymentRevenueContributionCents(row), 0);
}
function lastMonthRevenueCents() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const mk = yyyymm(d);
  return PAYMENTS_CACHE.filter((row) => monthKeyFromDate(row.paid_at || row.created_at || row.updated_at || new Date()) === mk)
    .reduce((sum, row) => sum + paymentRevenueContributionCents(row), 0);
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
const bidSearch = $("bidSearch");
const btnNewBid = $("btnNewBid");
const btnConvertBidToOrder = $("btnConvertBidToOrder");
const btnPrintBidProposal = $("btnPrintBidProposal");
const bidGuideFlow = $("bidGuideFlow");
const bidsList = $("bidsList");
const bidProfileGuide = $("bidProfileGuide");
const bidStatsWrap = $("bidStatsWrap");
const bidDeliveryWrap = $("bidDeliveryWrap");
const bidForm = $("bidForm");
const bidFormTitle = $("bidFormTitle");
const bidMsg = $("bidMsg");
const bidId = $("bidId");
const bidTitle = $("bidTitle");
const bidCustomerId = $("bidCustomerId");
const bidQuickCustomerCard = $("bidQuickCustomerCard");
const bidQuickCustomerHeading = $("bidQuickCustomerHeading");
const bidQuickCustomerSummary = $("bidQuickCustomerSummary");
const btnToggleBidQuickCustomer = $("btnToggleBidQuickCustomer");
const bidQuickCustomerForm = $("bidQuickCustomerForm");
const bidQuickCustomerName = $("bidQuickCustomerName");
const bidQuickCustomerEmail = $("bidQuickCustomerEmail");
const bidQuickCustomerPhone = $("bidQuickCustomerPhone");
const bidQuickCustomerPreferredContact = $("bidQuickCustomerPreferredContact");
const bidQuickCustomerNote = $("bidQuickCustomerNote");
const btnSaveBidQuickCustomer = $("btnSaveBidQuickCustomer");
const btnCancelBidQuickCustomer = $("btnCancelBidQuickCustomer");
const bidQuickCustomerMsg = $("bidQuickCustomerMsg");
const bidProfile = $("bidProfile");
const bidStatus = $("bidStatus");
const bidWalkthroughAt = $("bidWalkthroughAt");
const bidValidUntil = $("bidValidUntil");
const bidServiceAddress = $("bidServiceAddress");
const bidSiteContact = $("bidSiteContact");
const bidScheduleWindow = $("bidScheduleWindow");
const bidProjectSummary = $("bidProjectSummary");
const bidScopeOfWork = $("bidScopeOfWork");
const bidProposedSolution = $("bidProposedSolution");
const bidMaterialsPlan = $("bidMaterialsPlan");
const bidUnusedMaterialsPlan = $("bidUnusedMaterialsPlan");
const bidExclusions = $("bidExclusions");
const bidWarranty = $("bidWarranty");
const bidCoverNote = $("bidCoverNote");
const bidInternalNotes = $("bidInternalNotes");
const bidDepositPercent = $("bidDepositPercent");
const bidDepositAmount = $("bidDepositAmount");
const bidTerms = $("bidTerms");
const btnDuplicateBid = $("btnDuplicateBid");
const btnApplyBidProfile = $("btnApplyBidProfile");
const bidPhotoForm = $("bidPhotoForm");
const bidPhotoFile = $("bidPhotoFile");
const bidPhotoName = $("bidPhotoName");
const bidPhotoCategory = $("bidPhotoCategory");
const bidPhotoNote = $("bidPhotoNote");
const bidPhotoMsg = $("bidPhotoMsg");
const bidPhotosList = $("bidPhotosList");
const bidLineItemForm = $("bidLineItemForm");
const bidLineItemId = $("bidLineItemId");
const bidLineItemName = $("bidLineItemName");
const bidLineItemKind = $("bidLineItemKind");
const bidLineItemDescription = $("bidLineItemDescription");
const bidLineItemQuantity = $("bidLineItemQuantity");
const bidLineItemUnit = $("bidLineItemUnit");
const bidLineItemUnitPrice = $("bidLineItemUnitPrice");
const btnClearBidLineItem = $("btnClearBidLineItem");
const bidLineItemMsg = $("bidLineItemMsg");
const bidLineItemsList = $("bidLineItemsList");
const btnCopyBidEmail = $("btnCopyBidEmail");
const btnExportBidJson = $("btnExportBidJson");
const bidProposalPreview = $("bidProposalPreview");
const guidanceWrap = $("guidanceWrap");
const btnRefreshGuidance = $("btnRefreshGuidance");

const customersList = $("customersList");
const customerDetailWrap = $("customerDetailWrap");
const btnNewCustomer = $("btnNewCustomer");
const btnRefreshCustomers = $("btnRefreshCustomers");
const customerSearch = $("customerSearch");
const customerForm = $("customerForm");
const customerFormTitle = $("customerFormTitle");
const customerMsg = $("customerMsg");
const btnClearCustomerForm = $("btnClearCustomerForm");
const customerId = $("customerId");
const customerName = $("customerName");
const customerEmail = $("customerEmail");
const customerPhone = $("customerPhone");
const customerPreferredContact = $("customerPreferredContact");
const customerNotes = $("customerNotes");

const paymentsList = $("paymentsList");
const btnRefreshPayments = $("btnRefreshPayments");
const paymentForm = $("paymentForm");
const paymentFormTitle = $("paymentFormTitle");
const paymentMsg = $("paymentMsg");
const btnNewPayment = $("btnNewPayment");
const paymentId = $("paymentId");
const paymentCustomerId = $("paymentCustomerId");
const paymentOrderId = $("paymentOrderId");
const paymentMode = $("paymentMode");
const paymentStatus = $("paymentStatus");
const paymentAmount = $("paymentAmount");
const paymentPaidAt = $("paymentPaidAt");
const paymentReference = $("paymentReference");
const paymentNote = $("paymentNote");

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

const BID_PROFILE_LIBRARY = {
  general_service: {
    label: "General service",
    intro: "For field-service businesses that need a clean walkthrough, clear scope, and a professional proposal without retail-style inventory clutter.",
    scopePrompt: "Document the visible problem, the service area, access notes, and the exact result the customer expects when the work is complete.",
    solutionPrompt: "Spell out the service approach, the crew plan, and anything that protects quality, safety, or scheduling on site.",
    photoPrompts: [
      "Wide shot of the overall work area",
      "Close-up of the main issue or concern",
      "Access points, gate codes, hose or power access",
      "Measurements, counts, or labeled equipment",
    ],
    pricingPrompts: [
      "Base service scope",
      "Allowance for unknowns or site-specific extras",
      "Optional add-on work the customer may approve",
    ],
    lineItems: [
      { name: "On-site walkthrough and planning", description: "Measurements, site review, and production planning built from the visit.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "allowance" },
      { name: "Primary service scope", description: "Core labor and materials for the agreed work listed in this proposal.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
    ],
    materials: "Materials and equipment are allocated from truck stock, shop inventory, or ordered supply based on the walkthrough record.",
    unused: "Unused serviceable material is returned to storage, while waste and overage are tracked in job closeout notes.",
    exclusions: "Hidden conditions, customer-requested additions, permit costs, and work outside the stated scope are excluded unless listed.",
    warranty: "Workmanship is reviewed at completion and backed according to the service performed and the materials used.",
    terms: "Pricing is based on the site conditions visible during the walkthrough. Extra work or hidden conditions require approval before additional charges are added.",
    deliveryNote: "Here is the proposal built from our walkthrough. It shows the problem we saw, the scope we recommend, and how the work is priced.",
  },
  pressure_washing: {
    label: "Pressure washing",
    intro: "Built for exterior cleaning, stain treatment, soft-wash recommendations, and upsells that depend on what the operator sees on site.",
    scopePrompt: "Document surfaces, approximate square footage, water access, stain severity, oxidation, and any delicate areas that require soft washing.",
    solutionPrompt: "Specify detergents, surface prep, rinse method, protection steps, and whether nearby items need to be moved or masked.",
    photoPrompts: [
      "Front elevation and curb view",
      "Heavy buildup, algae, rust, or oil staining",
      "Water access and drainage path",
      "Delicate surfaces, windows, fixtures, or landscaping",
    ],
    pricingPrompts: [
      "House or building wash",
      "Flatwork cleaning by section",
      "Optional gutter brightening, rust removal, or sealing",
    ],
    lineItems: [
      { name: "Exterior wash", description: "Primary wash scope priced from the visible surfaces and access conditions captured on site.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { name: "Spot treatment / stain removal", description: "Allowance for targeted treatment where buildup or staining requires additional chemistry or passes.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional surface protection", description: "Optional add-on for sealing or post-cleaning protection if approved by the client.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Chemistry, hoses, reels, and protection materials are staged based on the site conditions documented in the walkthrough.",
    unused: "Unused chemical and serviceable materials are returned to truck or shop stock; unusable waste is documented during closeout.",
    exclusions: "Deep restoration, paint correction, or repairs outside the cleaning scope are excluded unless listed as an option.",
    warranty: "Cleaning results are reviewed with the customer at completion. Permanent staining or substrate damage outside the cleaning scope is not covered.",
    terms: "Pricing assumes standard access, available water, and no hidden substrate failure. Additional treatment outside the listed scope requires approval.",
    deliveryNote: "Attached is the wash proposal from the site visit, including the visible buildup we saw, the recommended cleaning approach, and the investment.",
  },
  hvac: {
    label: "HVAC",
    intro: "Designed for diagnostics, equipment replacements, maintenance agreements, and code-sensitive service bids where the proposal must inspire trust.",
    scopePrompt: "Capture equipment type, model details, visible condition, performance symptoms, access constraints, and any urgent comfort or safety issues.",
    solutionPrompt: "Explain the diagnostic finding, the recommended repair or replacement path, and what labor, parts, startup, or testing are included.",
    photoPrompts: [
      "Equipment overview with labels or model tags",
      "Area of failure, wear, or restricted access",
      "Duct, drain, line set, or thermostat conditions",
      "Electrical disconnect, pad, or mounting details",
    ],
    pricingPrompts: [
      "Diagnostic and repair labor",
      "Parts or equipment allowance",
      "Optional maintenance plan or IAQ upgrade",
    ],
    lineItems: [
      { name: "Diagnostic and service labor", description: "Labor to diagnose, perform the listed repair, verify operation, and document results.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { name: "Parts / equipment allowance", description: "Allowance for confirmed materials, specialty parts, or code-required accessories.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Maintenance or IAQ upgrade", description: "Optional add-on that improves equipment life or indoor air quality if the client wants to proceed.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Parts, pads, fittings, and standard install materials are allocated from stocked inventory or ordered once scope is approved.",
    unused: "Unused serviceable parts remain tagged to the job record before being returned to stock for future service work.",
    exclusions: "Permit fees, structural modifications, hidden code issues, and additional duct or electrical work are excluded unless listed.",
    warranty: "Workmanship follows the installed scope, and manufacturer warranties apply to covered parts or equipment where available.",
    terms: "Proposal pricing is based on the visible equipment and accessible conditions during the walkthrough. Hidden failures or code issues require change approval.",
    deliveryNote: "This proposal lays out the HVAC findings from the walkthrough, the recommended solution, and the investment needed to complete the work properly.",
  },
  plumbing: {
    label: "Plumbing",
    intro: "Built for leak repair, fixture replacement, drain work, and service proposals where visible conditions and access drive the price.",
    scopePrompt: "Document fixture type, leak location, shutoff access, visible damage, material type, and whether finish repair or restoration is needed.",
    solutionPrompt: "Describe the repair or replacement path, what is included in the service visit, and what conditions could trigger a change order.",
    photoPrompts: [
      "Fixture or affected plumbing area",
      "Visible leak, corrosion, or water damage",
      "Access panel, shutoff, or crawlspace conditions",
      "Finish surfaces that may need protection or follow-up",
    ],
    pricingPrompts: [
      "Repair or replacement labor",
      "Material and fixture allowance",
      "Optional restoration or upgrade work",
    ],
    lineItems: [
      { name: "Plumbing repair scope", description: "Labor and standard tools needed to complete the listed repair or replacement scope.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { name: "Material / fixture allowance", description: "Allowance for valves, fittings, trim, or owner-selected fixtures tied to this repair.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional finish restoration", description: "Optional add-on for patching, trim, or secondary restoration that may be approved separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Repair materials are staged from truck stock or purchased supply based on the service conditions observed during the visit.",
    unused: "Unused fittings, trim kits, or stocked materials are returned to inventory and noted against the job if they were reserved for this work.",
    exclusions: "Hidden damage, restoration outside the listed scope, permit costs, and code upgrades not visible during the walkthrough are excluded.",
    warranty: "Completed plumbing work is reviewed with the client, and workmanship is backed according to the repair or installation completed.",
    terms: "Pricing assumes shutoff access and visible service conditions match the walkthrough. Hidden failures or added restoration require approval.",
    deliveryNote: "Attached is the plumbing proposal from our visit, including the visible conditions we documented and the scope we recommend to fix the issue cleanly.",
  },
  property_maintenance: {
    label: "Property maintenance",
    intro: "For recurring grounds work, turnovers, repair punch lists, and mixed-scope site visits where the operator needs flexible documentation.",
    scopePrompt: "Capture the full punch list, access notes, property manager expectations, recurring needs, and any task that should be priced separately.",
    solutionPrompt: "Break the site into work zones or task groups so the client can see what is included now, later, or as an optional add-on.",
    photoPrompts: [
      "Wide shots of each work zone",
      "Deferred maintenance concerns",
      "Access points, locks, or tenant constraints",
      "Debris, storage, or leftover materials on site",
    ],
    pricingPrompts: [
      "Core maintenance scope",
      "Debris haul-off or consumables allowance",
      "Optional recurring visits or add-on repairs",
    ],
    lineItems: [
      { name: "Core maintenance scope", description: "Labor and routine materials for the listed maintenance tasks or turnover work.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { name: "Consumables / haul-off allowance", description: "Allowance for dump fees, consumables, or site-specific extras that depend on final quantities.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional recurring service", description: "Optional ongoing visit schedule or extra punch-list work if the client wants a larger maintenance plan.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Consumables, truck stock, and site-specific materials are planned from the walkthrough record and assigned to this property scope.",
    unused: "Unused materials are returned to shop or truck stock, while leftover site material stays documented so it can be reused or billed correctly later.",
    exclusions: "Structural repairs, permit work, hidden code issues, and trade-specific specialty work are excluded unless listed.",
    warranty: "Workmanship is reviewed by task type. Recurring maintenance outcomes depend on the ongoing service cadence approved by the client.",
    terms: "Pricing reflects the visible site conditions at the walkthrough. New tenant requests, hidden issues, or scope expansion require approval.",
    deliveryNote: "Here is the property maintenance proposal from the walkthrough, including the active punch list, recommended sequencing, and the investment.",
  },
  contractor_remodeling: {
    label: "Contractor / remodeling",
    intro: "For renovation, carpentry, finish work, and mixed-scope projects where the bid must balance professionalism, allowances, and change-order discipline.",
    scopePrompt: "Capture the rooms or zones involved, measurements, finish selections, demolition constraints, and any owner decisions still pending.",
    solutionPrompt: "Explain the construction sequence, who handles what, and where allowances or change-order controls protect both sides.",
    photoPrompts: [
      "Overall room or project zone",
      "Existing conditions that affect prep or demo",
      "Measurements, fixture locations, and utilities",
      "Finish details the client wants matched or replaced",
    ],
    pricingPrompts: [
      "Base labor and installation scope",
      "Allowance for owner-selected materials or hidden conditions",
      "Optional upgrades or alternates",
    ],
    lineItems: [
      { name: "Base construction scope", description: "Labor, setup, and standard install work tied to the listed remodeling scope.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { name: "Material / hidden-condition allowance", description: "Allowance for owner selections, concealed conditions, or site-specific materials not finalized yet.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional upgrade or alternate", description: "Optional scope the client can approve separately without rewriting the whole bid.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Primary materials are staged from approved selections and tracked against the job so usage and overage stay visible.",
    unused: "Unused materials that remain in good condition are inventoried back into storage or tagged to the client for future approved work.",
    exclusions: "Permit fees, structural engineering, unforeseen concealed conditions, and client-requested scope additions are excluded unless listed.",
    warranty: "Workmanship is backed according to the trade scope completed, with manufacturer warranties applying where materials provide them.",
    terms: "Pricing is based on visible site conditions, current selections, and the listed scope. Any added work or concealed issues move through a change-order approval step.",
    deliveryNote: "Attached is the remodeling proposal built from our walkthrough, with the visible conditions, recommended scope, and commercial structure laid out clearly.",
  },
};

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

function setInlineMessage(el, message = "", tone = "") {
  if (!el) return;
  el.textContent = message || "";
  el.className = tone ? `msg ${tone}` : "msg";
}
function paymentAmountCents(row) {
  return Number(row?.amount_total ?? row?.amount_subtotal ?? row?.amount_cents ?? row?.net_amount_cents ?? row?.total_cents ?? 0);
}
function paymentRevenueContributionCents(row) {
  const amount = paymentAmountCents(row);
  const status = String(row?.status || "").trim().toLowerCase();
  if (!amount) return 0;
  if (["pending", "failed", "cancelled", "voided", "checkout_created"].includes(status)) return 0;
  if (status.includes("refund")) return -amount;
  return amount;
}
function customerLifetimeValueCents(customer) {
  const stored = Number(customer?.lifetime_value_cents || 0);
  const paid = PAYMENTS_CACHE
    .filter((row) => row.customer_id === customer?.id)
    .reduce((sum, row) => sum + Math.max(0, paymentRevenueContributionCents(row)), 0);
  return Math.max(stored, paid);
}
function paymentSortTimestamp(row) {
  return new Date(row?.paid_at || row?.created_at || row?.updated_at || 0).getTime() || 0;
}
function formatPaymentMode(mode) {
  const labels = {
    ach: "ACH",
    cash: "Cash",
    check: "Check",
    external_card: "Card on site",
    manual_other: "Other",
    pay_online: "Online checkout",
    venmo: "Venmo",
    zelle: "Zelle",
  };
  return labels[String(mode || "").trim().toLowerCase()] || (mode ? String(mode) : "Manual");
}
function toDateTimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - (d.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}
function toIsoDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function isManualPaymentRecord(row) {
  return String(row?.source || "").trim().toLowerCase() === "manual";
}
function sortedCustomers(rows = CUSTOMERS_CACHE) {
  return [...(rows || [])].sort((a, b) => {
    const valueDiff = customerLifetimeValueCents(b) - customerLifetimeValueCents(a);
    if (valueDiff) return valueDiff;
    return new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime();
  });
}
function sortedPayments(rows = PAYMENTS_CACHE) {
  return [...(rows || [])].sort((a, b) => paymentSortTimestamp(b) - paymentSortTimestamp(a));
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
  if (nextTab === "bids") renderBids(bidSearch?.value || "");
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

function populateCustomerForm(customer = null) {
  if (customerFormTitle) customerFormTitle.textContent = customer?.id ? "Customer workspace" : "New customer";
  if (customerId) customerId.value = customer?.id || "";
  if (customerName) customerName.value = customer?.name || "";
  if (customerEmail) customerEmail.value = customer?.email || "";
  if (customerPhone) customerPhone.value = customer?.phone || "";
  if (customerPreferredContact) customerPreferredContact.value = customer?.preferred_contact || "email";
  if (customerNotes) customerNotes.value = customer?.notes || "";
}
function startNewCustomer() {
  CUSTOMER_CREATING = true;
  ACTIVE_CUSTOMER_ID = null;
  populateCustomerForm(null);
  setInlineMessage(customerMsg, "");
  renderCustomersList(customerSearch?.value || "");
}
function renderCustomersList(filter = "") {
  if (!customersList) return;
  const q = String(filter || "").trim().toLowerCase();
  const ranked = sortedCustomers(CUSTOMERS_CACHE);
  const rows = ranked.filter((c) =>
    !q || [c.name, c.email, c.phone].some((x) => String(x || "").toLowerCase().includes(q))
  );

  const emptyMessage = CUSTOMERS_CACHE.length
    ? `No customers match this search.`
    : `No customers yet. Create one to start linking work and payments.`;
  customersList.innerHTML = rows.length ? "" : `<div class="muted">${emptyMessage}</div>`;

  rows.forEach((c) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `list-item ${ACTIVE_CUSTOMER_ID === c.id && !CUSTOMER_CREATING ? "is-active" : ""}`;
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(c.name || "Unnamed customer")}</div>
        <div class="li-sub muted">${escapeHtml(c.email || "No email")} &middot; ${escapeHtml(c.phone || "No phone")}</div>
      </div>
      <div class="li-meta">
        <span class="pill pill-on">${formatUsd(customerLifetimeValueCents(c))}</span>
        <span class="pill">${escapeHtml(String(c.order_count || 0))} orders</span>
      </div>
    `;
    el.addEventListener("click", () => {
      CUSTOMER_CREATING = false;
      ACTIVE_CUSTOMER_ID = c.id;
      setInlineMessage(customerMsg, "");
      renderCustomersList(customerSearch?.value || "");
    });
    customersList.appendChild(el);
  });

  if (!rows.length) {
    if (!CUSTOMERS_CACHE.length) {
      CUSTOMER_CREATING = true;
      ACTIVE_CUSTOMER_ID = null;
      renderCustomerDetail(null).catch(console.error);
      return;
    }
    renderCustomerDetail(CUSTOMER_CREATING ? null : ACTIVE_CUSTOMER_ID).catch(console.error);
    return;
  }

  if (!ACTIVE_CUSTOMER_ID && !CUSTOMER_CREATING && rows[0]) ACTIVE_CUSTOMER_ID = rows[0].id;
  if (ACTIVE_CUSTOMER_ID) CUSTOMER_CREATING = false;
  renderCustomerDetail(CUSTOMER_CREATING ? null : ACTIVE_CUSTOMER_ID).catch(console.error);
}
async function renderCustomerDetail(customerIdValue) {
  if (!customerDetailWrap) return;
  const customer = CUSTOMERS_CACHE.find((c) => c.id === customerIdValue) || null;
  populateCustomerForm(customer);

  if (!customer) {
    customerDetailWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">Customer intake</div>
        <div><strong>Create the account before the work gets messy.</strong></div>
        <div class="detail-copy">This record becomes the place to attach bids, jobs, payment history, follow-up, and anything the operator learns over time.</div>
      </div>
    `;
    return;
  }

  const customerOrders = CRM_ORDERS_CACHE
    .filter((o) => o.customer_id === customerIdValue)
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 12);
  const interactions = await fetchCustomerInteractions(customerIdValue);
  const customerPayments = sortedPayments(PAYMENTS_CACHE.filter((p) => p.customer_id === customerIdValue)).slice(0, 12);

  customerDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Customer profile</div>
      <div><strong>${escapeHtml(customer.name || "Unnamed customer")}</strong></div>
      <div class="detail-copy">${escapeHtml(customer.email || "No email")} &middot; ${escapeHtml(customer.phone || "No phone")}</div>
      <div class="detail-copy">Preferred contact: ${escapeHtml(customer.preferred_contact || "email")}</div>
      <div class="detail-copy">Lifetime value: ${formatUsd(customerLifetimeValueCents(customer))} &middot; Orders: ${escapeHtml(String(customer.order_count || 0))}</div>
      <div class="detail-copy">Last touch: ${escapeHtml(customer.last_contact_at ? formatDateTime(customer.last_contact_at) : "Not recorded")}</div>
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
                    <div class="li-title">${escapeHtml(String(o.status || "new"))}</div>
                    <div class="li-sub muted">${escapeHtml(String(o.scheduled_date || "No scheduled date"))} &middot; ${escapeHtml(String(o.scheduled_time || "No time"))}</div>
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
          <span class="muted">Manual and online collections in one place.</span>
        </div>
        <div class="card-bd">
          ${customerPayments.length ? `
            <div class="list">
              ${customerPayments.map((p) => `
                <div class="list-item">
                  <div class="li-main">
                    <div class="li-title">${escapeHtml(formatPaymentMode(p.payment_mode))} &middot; ${escapeHtml(String(p.status || "pending"))}</div>
                    <div class="li-sub muted">${escapeHtml(formatDateTime(p.paid_at || p.created_at || p.updated_at))}${p.metadata?.reference ? ` &middot; Ref ${escapeHtml(String(p.metadata.reference))}` : ""}</div>
                  </div>
                  <div class="li-meta">
                    <span class="pill pill-on">${formatUsd(paymentAmountCents(p))}</span>
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

  $("btnAddCustomerInteraction")?.addEventListener("click", async () => {
    const type = $("customerInteractionType")?.value || "note";
    const summary = $("customerInteractionSummary")?.value?.trim() || "";
    if (!summary) return;

    const nowIso = new Date().toISOString();
    const { error } = await sb.from("customer_interactions").insert(withTenantScope({
      operator_id: opId(),
      customer_id: customerIdValue,
      type,
      summary,
      metadata: {},
      created_at: nowIso,
    }));
    if (error) {
      alert(error.message || String(error));
      return;
    }

    await sb.from("customers")
      .update({ last_contact_at: nowIso, updated_at: nowIso })
      .eq("id", customerIdValue).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);

    CUSTOMER_CREATING = false;
    ACTIVE_CUSTOMER_ID = customerIdValue;
    await fetchCustomers();
    renderCustomersList(customerSearch?.value || "");
    renderDashboard();
    renderMoney().catch(console.error);
  });
}
function renderPaymentCustomerOptions(selectedCustomerId = "") {
  if (!paymentCustomerId) return;
  const options = sortedCustomers(CUSTOMERS_CACHE);
  paymentCustomerId.innerHTML = `
    <option value="">No linked customer yet</option>
    ${options.map((customer) => `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || customer.phone || "Customer")}</option>`).join("")}
  `;
  paymentCustomerId.value = options.some((customer) => customer.id === selectedCustomerId) ? selectedCustomerId : "";
}
function renderPaymentOrderOptions(selectedCustomerId = "", selectedOrderId = "") {
  if (!paymentOrderId) return;
  const rows = [...CRM_ORDERS_CACHE]
    .filter((order) => !selectedCustomerId || order.customer_id === selectedCustomerId)
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  paymentOrderId.innerHTML = `
    <option value="">No linked order</option>
    ${rows.map((order) => {
      const customer = CUSTOMERS_CACHE.find((row) => row.id === order.customer_id);
      const scheduled = order.scheduled_date || getScheduledDateFromOrder(order) || "No date";
      const label = `${customer?.name || order.customer_name || "Customer"} | ${String(order.status || "new")} | ${String(scheduled)}`;
      return `<option value="${escapeAttr(order.id)}">${escapeHtml(label)}</option>`;
    }).join("")}
  `;
  paymentOrderId.value = rows.some((order) => order.id === selectedOrderId) ? selectedOrderId : "";
}
function clearPaymentForm(options = {}) {
  const preferredOrder = CRM_ORDERS_CACHE.find((row) => row.id === (options.orderId || ACTIVE_ORDER_ID)) || null;
  const defaultCustomerId = options.customerId ?? ACTIVE_CUSTOMER_ID ?? preferredOrder?.customer_id ?? "";
  const defaultOrderId = options.orderId ?? (preferredOrder?.customer_id === defaultCustomerId ? preferredOrder?.id || "" : "");

  ACTIVE_PAYMENT_ID = null;
  if (paymentFormTitle) paymentFormTitle.textContent = "Manual payment entry";
  if (paymentId) paymentId.value = "";
  renderPaymentCustomerOptions(defaultCustomerId);
  renderPaymentOrderOptions(defaultCustomerId, defaultOrderId);
  if (paymentMode) paymentMode.value = options.mode || "cash";
  if (paymentStatus) paymentStatus.value = options.status || "paid";
  if (paymentAmount) paymentAmount.value = options.amount || "";
  if (paymentPaidAt) paymentPaidAt.value = options.paidAt || toDateTimeLocalValue(new Date().toISOString());
  if (paymentReference) paymentReference.value = options.reference || "";
  if (paymentNote) paymentNote.value = options.note || "";
  setInlineMessage(paymentMsg, "");
}
function loadPaymentIntoForm(payment) {
  if (!payment || !isManualPaymentRecord(payment)) return;
  ACTIVE_PAYMENT_ID = payment.id;
  if (paymentFormTitle) paymentFormTitle.textContent = "Edit manual payment";
  if (paymentId) paymentId.value = payment.id || "";
  renderPaymentCustomerOptions(payment.customer_id || "");
  renderPaymentOrderOptions(payment.customer_id || "", payment.order_id || "");
  if (paymentMode) paymentMode.value = payment.payment_mode || "cash";
  if (paymentStatus) paymentStatus.value = payment.status || "paid";
  if (paymentAmount) paymentAmount.value = money(paymentAmountCents(payment));
  if (paymentPaidAt) paymentPaidAt.value = toDateTimeLocalValue(payment.paid_at || payment.created_at || payment.updated_at);
  if (paymentReference) paymentReference.value = payment.metadata?.reference || "";
  if (paymentNote) paymentNote.value = payment.metadata?.note || "";
  setInlineMessage(paymentMsg, "Editing a manual payment record.");
}
function customerInputPayload(fields = {}) {
  const name = String(fields.name || "").trim();
  const email = String(fields.email || "").trim();
  const phone = String(fields.phone || "").trim();
  return {
    id: fields.id || null,
    name: name || email || phone || "Customer",
    email: email || null,
    phone: phone || null,
    preferred_contact: fields.preferred_contact || "email",
    notes: String(fields.notes || "").trim(),
  };
}
async function saveCustomerRecord(fields = {}) {
  const input = customerInputPayload(fields);
  const nowIso = new Date().toISOString();
  const payload = withTenantScope({
    operator_id: opId(),
    name: input.name,
    email: input.email,
    phone: input.phone,
    preferred_contact: input.preferred_contact,
    notes: input.notes,
    updated_at: nowIso,
  });

  const query = input.id
    ? sb.from("customers").update(payload).eq("id", input.id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("customers").insert({ ...payload, created_at: nowIso });

  const { data, error } = await query.select("*").single();
  if (error) throw error;

  CUSTOMER_CREATING = false;
  ACTIVE_CUSTOMER_ID = data.id;
  await fetchCustomers();
  renderCustomersList(customerSearch?.value || "");
  renderPayments();
  renderDashboard();
  renderMoney().catch(console.error);
  return data;
}
customerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setInlineMessage(customerMsg, "Saving...");

  try {
    await saveCustomerRecord({
      id: customerId?.value || null,
      name: customerName?.value,
      email: customerEmail?.value,
      phone: customerPhone?.value,
      preferred_contact: customerPreferredContact?.value,
      notes: customerNotes?.value,
    });
    setInlineMessage(customerMsg, "Customer saved.", "ok");
  } catch (err) {
    setInlineMessage(customerMsg, err.message || String(err), "error");
  }
});
btnNewCustomer?.addEventListener("click", startNewCustomer);
btnClearCustomerForm?.addEventListener("click", startNewCustomer);

function renderPayments() {
  if (!paymentsList) return;
  if (paymentId?.value) {
    renderPaymentCustomerOptions(paymentCustomerId?.value || "");
    renderPaymentOrderOptions(paymentCustomerId?.value || "", paymentOrderId?.value || "");
  } else {
    clearPaymentForm({ customerId: paymentCustomerId?.value || ACTIVE_CUSTOMER_ID || "" });
  }

  const rows = sortedPayments(PAYMENTS_CACHE);
  paymentsList.innerHTML = rows.length ? "" : `<div class="muted">No payments recorded yet.</div>`;

  rows.forEach((p) => {
    const customer = CUSTOMERS_CACHE.find((c) => c.id === p.customer_id);
    const order = CRM_ORDERS_CACHE.find((o) => o.id === p.order_id);
    const ref = p.metadata?.reference ? ` | Ref ${String(p.metadata.reference)}` : "";

    const el = document.createElement("button");
    el.type = "button";
    el.className = `list-item ${ACTIVE_PAYMENT_ID === p.id ? "is-active" : ""}`;
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(customer?.name || "Unlinked payment")}</div>
        <div class="li-sub muted">${escapeHtml(formatPaymentMode(p.payment_mode))} &middot; ${escapeHtml(formatDateTime(p.paid_at || p.created_at || p.updated_at))}${escapeHtml(ref)}</div>
        <div class="li-sub muted">${escapeHtml(order ? `Order ${String(order.status || "new")}` : "No linked order")} &middot; ${escapeHtml(String(p.source || "manual"))}</div>
      </div>
      <div class="li-meta">
        <span class="pill">${escapeHtml(String(p.status || "pending"))}</span>
        <span class="pill pill-on">${formatUsd(paymentAmountCents(p))}</span>
      </div>
    `;
    el.addEventListener("click", () => {
      if (!isManualPaymentRecord(p)) {
        ACTIVE_PAYMENT_ID = null;
        renderPayments();
        setInlineMessage(paymentMsg, "Stripe-created payment records are read-only here. Use this form for manual collections.", "error");
        return;
      }

      loadPaymentIntoForm(p);
      renderPayments();
    });
    paymentsList.appendChild(el);
  });
}
paymentCustomerId?.addEventListener("change", () => {
  renderPaymentOrderOptions(paymentCustomerId.value || "", paymentOrderId?.value || "");
});
paymentOrderId?.addEventListener("change", () => {
  const order = CRM_ORDERS_CACHE.find((row) => row.id === paymentOrderId.value);
  if (order?.customer_id) {
    renderPaymentCustomerOptions(order.customer_id);
    if (paymentCustomerId) paymentCustomerId.value = order.customer_id;
    renderPaymentOrderOptions(order.customer_id, order.id);
  }
});
btnNewPayment?.addEventListener("click", () => {
  clearPaymentForm();
  renderPayments();
});
paymentForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setInlineMessage(paymentMsg, "Saving...");

  const id = paymentId?.value || null;
  const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (paymentOrderId?.value || ""));
  const resolvedCustomerId = paymentCustomerId?.value || linkedOrder?.customer_id || null;
  const amountCents = toCents(paymentAmount?.value || 0);
  if (!amountCents) {
    setInlineMessage(paymentMsg, "Enter a payment amount greater than zero.", "error");
    return;
  }

  const nowIso = new Date().toISOString();
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: resolvedCustomerId,
    order_id: paymentOrderId?.value || null,
    payment_mode: paymentMode?.value || "manual_other",
    status: paymentStatus?.value || "paid",
    amount_subtotal: amountCents,
    amount_total: amountCents,
    currency: "usd",
    source: "manual",
    metadata: {
      reference: paymentReference?.value?.trim() || null,
      note: paymentNote?.value?.trim() || null,
      recorded_via: "operator_console",
    },
    paid_at: toIsoDateTime(paymentPaidAt?.value) || null,
    updated_at: nowIso,
  });

  try {
    if (id) {
      const existing = PAYMENTS_CACHE.find((row) => row.id === id);
      if (!isManualPaymentRecord(existing)) throw new Error("Only manual payment records can be edited here.");
    }

    const query = id
      ? sb.from("payments").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
      : sb.from("payments").insert({ ...payload, created_at: nowIso });

    const { data, error } = await query.select("*").single();
    if (error) throw error;

    ACTIVE_PAYMENT_ID = data.id;
    await Promise.all([fetchPayments(), fetchCustomers()]);
    const fresh = PAYMENTS_CACHE.find((row) => row.id === data.id) || data;
    loadPaymentIntoForm(fresh);
    renderPayments();
    renderCustomersList(customerSearch?.value || "");
    renderDashboard();
    renderMoney().catch(console.error);
    renderGuidance();
    if (ACTIVE_CUSTOMER_ID) renderCustomerDetail(ACTIVE_CUSTOMER_ID).catch(console.error);
    setInlineMessage(paymentMsg, "Payment saved.", "ok");
  } catch (err) {
    setInlineMessage(paymentMsg, err.message || String(err), "error");
  }
});

function normalizeBidProfile(value) {
  const key = String(value || "").trim().toLowerCase();
  return BID_PROFILE_LIBRARY[key] ? key : "general_service";
}
function preferredBidProfile() {
  const raw = String(
    SETUP_STATE?.locked_record?.business_type ||
    SETUP_STATE?.tenant?.business_type ||
    SETUP_STATE?.config?.business_type ||
    ""
  ).trim().toLowerCase();
  const map = {
    contractor: "contractor_remodeling",
    contractor_remodeling: "contractor_remodeling",
    pressure_washing: "pressure_washing",
    hvac: "hvac",
    plumbing: "plumbing",
    property_maintenance: "property_maintenance",
  };
  return map[raw] || "general_service";
}
function bidStorageKey() {
  return `prooflink.walkthrough-bids.v1:${TENANT_ID}:${CURRENT_OPERATOR?.operator_id || "anon"}`;
}
function createLocalId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}
function bidProfileConfig(profileKey) {
  return BID_PROFILE_LIBRARY[normalizeBidProfile(profileKey)];
}
function formatBidStatus(status) {
  const labels = {
    draft: "Draft",
    walkthrough_complete: "Walkthrough complete",
    ready_to_send: "Ready to send",
    sent: "Sent to client",
    approved: "Approved",
    declined: "Declined",
  };
  return labels[String(status || "").trim().toLowerCase()] || (status ? String(status) : "Draft");
}
function formatBidLineItemKind(kind) {
  const labels = {
    base: "Base scope",
    option: "Client option",
    allowance: "Allowance",
  };
  return labels[String(kind || "").trim().toLowerCase()] || "Line item";
}
function bidLineItemTotalCents(item) {
  return Math.round(Number(item?.quantity || 0) * Number(item?.unit_price_cents || 0));
}
function calculateBidTotals(bid) {
  const rows = Array.isArray(bid?.line_items) ? bid.line_items : [];
  const base = rows
    .filter((item) => String(item.kind || "base").toLowerCase() === "base")
    .reduce((sum, item) => sum + bidLineItemTotalCents(item), 0);
  const allowances = rows
    .filter((item) => String(item.kind || "").toLowerCase() === "allowance")
    .reduce((sum, item) => sum + bidLineItemTotalCents(item), 0);
  const options = rows
    .filter((item) => String(item.kind || "").toLowerCase() === "option")
    .reduce((sum, item) => sum + bidLineItemTotalCents(item), 0);
  const total = base + allowances;
  const explicitDeposit = Number(bid?.deposit_amount_cents || 0);
  const percentDeposit = Math.round(total * (Number(bid?.deposit_percent || 0) / 100));
  const deposit = explicitDeposit > 0 ? explicitDeposit : percentDeposit;
  return { base, allowances, options, total, deposit };
}
function bidIncludedLineItemsForOrder(bid) {
  return (bid?.line_items || []).filter((item) => String(item.kind || "base").toLowerCase() !== "option");
}
function bidOptionalLineItems(bid) {
  return (bid?.line_items || []).filter((item) => String(item.kind || "").toLowerCase() === "option");
}
function escapeParagraphs(value) {
  const text = String(value || "").trim();
  return text ? escapeHtml(text).replace(/\n/g, "<br>") : "—";
}
function findBidCustomer(customerIdValue) {
  return CUSTOMERS_CACHE.find((row) => row.id === customerIdValue) || null;
}
function currentBid() {
  if (!BIDS_CACHE.length) return null;
  const active = BIDS_CACHE.find((row) => row.id === ACTIVE_BID_ID) || null;
  if (active) return active;
  ACTIVE_BID_ID = BIDS_CACHE[0].id;
  return BIDS_CACHE[0];
}
function defaultBidTitleFromDraft(draft) {
  const customer = findBidCustomer(draft?.customer_id);
  const label = customer?.name || bidProfileConfig(draft?.profile).label;
  const date = draft?.walkthrough_at ? formatDateOnly(draft.walkthrough_at) : formatDateOnly(new Date().toISOString());
  return `${label} proposal - ${date}`;
}
function emptyBidDraft(profileKey = preferredBidProfile()) {
  const profile = bidProfileConfig(profileKey);
  const nowIso = new Date().toISOString();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 14);
  return {
    id: createLocalId("bid"),
    title: "",
    customer_id: "",
    profile: normalizeBidProfile(profileKey),
    status: "draft",
    walkthrough_at: nowIso,
    valid_until: validUntil.toISOString().slice(0, 10),
    service_address: "",
    site_contact: "",
    schedule_window: "",
    project_summary: "",
    scope_of_work: profile.scopePrompt || "",
    proposed_solution: profile.solutionPrompt || "",
    materials_plan: profile.materials || "",
    unused_materials_plan: profile.unused || "",
    exclusions: profile.exclusions || "",
    warranty: profile.warranty || "",
    cover_note: profile.deliveryNote || "",
    internal_notes: "",
    deposit_percent: 0,
    deposit_amount_cents: 0,
    terms: profile.terms || "",
    line_items: (profile.lineItems || []).map((item) => ({
      id: createLocalId("line"),
      name: item.name || "",
      description: item.description || "",
      quantity: Number(item.quantity || 1),
      unit: item.unit || "job",
      unit_price_cents: Number(item.unit_price_cents || 0),
      kind: String(item.kind || "base"),
    })),
    photos: [],
    created_at: nowIso,
    updated_at: nowIso,
  };
}
function persistBidDrafts() {
  try {
    window.localStorage.setItem(bidStorageKey(), JSON.stringify(BIDS_CACHE || []));
    return true;
  } catch (err) {
    setInlineMessage(bidMsg, err.message || "Bid drafts could not be saved in this browser.", "error");
    return false;
  }
}
function loadBidDrafts() {
  try {
    const raw = window.localStorage.getItem(bidStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    BIDS_CACHE = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    BIDS_CACHE = [];
  }
  ACTIVE_BID_ID = BIDS_CACHE[0]?.id || null;
}
function replaceBidDraft(nextDraft) {
  BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== nextDraft.id), nextDraft]
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  ACTIVE_BID_ID = nextDraft.id;
  persistBidDrafts();
  return nextDraft;
}
function sortedBids(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(BIDS_CACHE || [])].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  if (!needle) return rows;
  return rows.filter((row) => {
    const customer = findBidCustomer(row.customer_id);
    const haystack = [
      row.title,
      customer?.name,
      row.service_address,
      row.status,
      bidProfileConfig(row.profile).label,
      row.project_summary,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
function renderBidCustomerOptions(selected = "") {
  if (!bidCustomerId) return;
  const options = sortedCustomers(CUSTOMERS_CACHE);
  bidCustomerId.innerHTML = [
    `<option value="">Link customer later</option>`,
    ...options.map((customer) => `<option value="${escapeAttr(customer.id)}" ${customer.id === selected ? "selected" : ""}>${escapeHtml(customer.name || "Unnamed customer")}</option>`),
  ].join("");
}
function clearBidQuickCustomerForm() {
  if (bidQuickCustomerName) bidQuickCustomerName.value = "";
  if (bidQuickCustomerEmail) bidQuickCustomerEmail.value = "";
  if (bidQuickCustomerPhone) bidQuickCustomerPhone.value = "";
  if (bidQuickCustomerPreferredContact) bidQuickCustomerPreferredContact.value = "email";
  if (bidQuickCustomerNote) bidQuickCustomerNote.value = "";
  setInlineMessage(bidQuickCustomerMsg, "");
}
function setBidQuickCustomerOpen(nextOpen, opts = {}) {
  BID_QUICK_CUSTOMER_OPEN = !!nextOpen;
  if (bidQuickCustomerCard) bidQuickCustomerCard.classList.toggle("is-open", BID_QUICK_CUSTOMER_OPEN);
  if (bidQuickCustomerForm) bidQuickCustomerForm.classList.toggle("hidden", !BID_QUICK_CUSTOMER_OPEN);
  if (!BID_QUICK_CUSTOMER_OPEN && opts.keepValues !== true) clearBidQuickCustomerForm();
}
function renderBidQuickCustomerCard(draft) {
  if (!bidQuickCustomerCard) return;
  const linkedCustomer = findBidCustomer(draft?.customer_id || "");
  const hasCustomers = CUSTOMERS_CACHE.length > 0;
  const forceOpen = !linkedCustomer && !hasCustomers;
  const nextOpen = forceOpen || BID_QUICK_CUSTOMER_OPEN;

  if (bidQuickCustomerHeading) {
    bidQuickCustomerHeading.textContent = linkedCustomer
      ? "Customer record linked"
      : (!hasCustomers ? "No customers in CRM yet" : "Need a new customer?");
  }
  if (bidQuickCustomerSummary) {
    bidQuickCustomerSummary.textContent = linkedCustomer
      ? `${linkedCustomer.name || "This customer"} is attached to the bid. Create another customer here only if this walkthrough belongs to someone else.`
      : (!hasCustomers
          ? "Capture the first customer here without leaving the walkthrough. A name plus email or phone is enough to keep moving."
          : "Link an existing customer above, or capture a brand-new one here without leaving the walkthrough.");
  }
  if (btnToggleBidQuickCustomer) {
    btnToggleBidQuickCustomer.textContent = forceOpen
      ? "Customer details below"
      : (nextOpen ? "Hide quick customer" : "Create customer here");
    btnToggleBidQuickCustomer.disabled = forceOpen;
  }
  setBidQuickCustomerOpen(nextOpen, { keepValues: true });
}
function attachCustomerToCurrentBid(customer) {
  if (!customer?.id) return null;
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) return null;
  const currentTitle = String(active.title || "").trim();
  const previousDefaultTitle = defaultBidTitleFromDraft(active);
  const nextDraft = {
    ...active,
    customer_id: customer.id,
    updated_at: new Date().toISOString(),
  };
  if (!currentTitle || currentTitle === previousDefaultTitle) {
    nextDraft.title = defaultBidTitleFromDraft(nextDraft);
  }
  replaceBidDraft(nextDraft);
  return nextDraft;
}
function clearBidLineItemForm() {
  ACTIVE_BID_LINE_ITEM_ID = null;
  if (bidLineItemId) bidLineItemId.value = "";
  if (bidLineItemName) bidLineItemName.value = "";
  if (bidLineItemKind) bidLineItemKind.value = "base";
  if (bidLineItemDescription) bidLineItemDescription.value = "";
  if (bidLineItemQuantity) bidLineItemQuantity.value = "1";
  if (bidLineItemUnit) bidLineItemUnit.value = "job";
  if (bidLineItemUnitPrice) bidLineItemUnitPrice.value = "0.00";
  setInlineMessage(bidLineItemMsg, "");
}
function populateBidLineItemForm(item) {
  ACTIVE_BID_LINE_ITEM_ID = item?.id || null;
  if (bidLineItemId) bidLineItemId.value = item?.id || "";
  if (bidLineItemName) bidLineItemName.value = item?.name || "";
  if (bidLineItemKind) bidLineItemKind.value = String(item?.kind || "base");
  if (bidLineItemDescription) bidLineItemDescription.value = item?.description || "";
  if (bidLineItemQuantity) bidLineItemQuantity.value = String(item?.quantity ?? 1);
  if (bidLineItemUnit) bidLineItemUnit.value = item?.unit || "job";
  if (bidLineItemUnitPrice) bidLineItemUnitPrice.value = money(item?.unit_price_cents || 0);
}
function clearBidPhotoForm() {
  if (bidPhotoFile) bidPhotoFile.value = "";
  if (bidPhotoName) bidPhotoName.value = "";
  if (bidPhotoCategory) bidPhotoCategory.value = "overview";
  if (bidPhotoNote) bidPhotoNote.value = "";
  setInlineMessage(bidPhotoMsg, "");
}
function collectBidFormDraft() {
  const active = currentBid();
  const profileKey = normalizeBidProfile(bidProfile?.value || active?.profile || preferredBidProfile());
  const draft = {
    ...(active || emptyBidDraft(profileKey)),
    id: bidId?.value || active?.id || createLocalId("bid"),
    title: bidTitle?.value?.trim() || "",
    customer_id: bidCustomerId?.value || "",
    profile: profileKey,
    status: String(bidStatus?.value || "draft"),
    walkthrough_at: toIsoDateTime(bidWalkthroughAt?.value) || active?.walkthrough_at || null,
    valid_until: bidValidUntil?.value || "",
    service_address: bidServiceAddress?.value?.trim() || "",
    site_contact: bidSiteContact?.value?.trim() || "",
    schedule_window: bidScheduleWindow?.value?.trim() || "",
    project_summary: bidProjectSummary?.value?.trim() || "",
    scope_of_work: bidScopeOfWork?.value?.trim() || "",
    proposed_solution: bidProposedSolution?.value?.trim() || "",
    materials_plan: bidMaterialsPlan?.value?.trim() || "",
    unused_materials_plan: bidUnusedMaterialsPlan?.value?.trim() || "",
    exclusions: bidExclusions?.value?.trim() || "",
    warranty: bidWarranty?.value?.trim() || "",
    cover_note: bidCoverNote?.value?.trim() || "",
    internal_notes: bidInternalNotes?.value?.trim() || "",
    deposit_percent: Number(bidDepositPercent?.value || 0),
    deposit_amount_cents: toCents(bidDepositAmount?.value || 0),
    terms: bidTerms?.value?.trim() || "",
    line_items: cloneJson(active?.line_items || [], []),
    photos: cloneJson(active?.photos || [], []),
    updated_at: new Date().toISOString(),
  };
  if (!draft.title) draft.title = defaultBidTitleFromDraft(draft);
  return draft;
}
function updateCurrentBidFromForm(opts = {}) {
  const active = currentBid();
  if (!active && opts.allowCreate !== true) return null;
  const nextDraft = collectBidFormDraft();
  replaceBidDraft(nextDraft);
  if (opts.showMessage) setInlineMessage(bidMsg, "Bid saved.", "ok");
  return nextDraft;
}
let bidAutosaveTimer = null;
function scheduleBidAutosave() {
  if (!currentBid()) return;
  clearTimeout(bidAutosaveTimer);
  bidAutosaveTimer = setTimeout(() => {
    const nextDraft = updateCurrentBidFromForm();
    if (nextDraft) renderBidWorkspace(nextDraft, { preserveForm: true });
    renderBidList(bidSearch?.value || "");
  }, 250);
}
function applyBidProfileStructure(force = false) {
  const active = currentBid();
  if (!active) return null;
  const profile = bidProfileConfig(bidProfile?.value || active.profile);
  const hasCustomLineItems = Array.isArray(active.line_items) && active.line_items.length > 0;
  if (force && hasCustomLineItems && !window.confirm("Replace existing line items with the service-profile starter structure?")) {
    return active;
  }
  const nextDraft = {
    ...collectBidFormDraft(),
    profile: normalizeBidProfile(bidProfile?.value || active.profile),
    scope_of_work: force || !String(active.scope_of_work || "").trim() ? (profile.scopePrompt || "") : active.scope_of_work,
    proposed_solution: force || !String(active.proposed_solution || "").trim() ? (profile.solutionPrompt || "") : active.proposed_solution,
    materials_plan: force || !String(active.materials_plan || "").trim() ? (profile.materials || "") : active.materials_plan,
    unused_materials_plan: force || !String(active.unused_materials_plan || "").trim() ? (profile.unused || "") : active.unused_materials_plan,
    exclusions: force || !String(active.exclusions || "").trim() ? (profile.exclusions || "") : active.exclusions,
    warranty: force || !String(active.warranty || "").trim() ? (profile.warranty || "") : active.warranty,
    cover_note: force || !String(active.cover_note || "").trim() ? (profile.deliveryNote || "") : active.cover_note,
    terms: force || !String(active.terms || "").trim() ? (profile.terms || "") : active.terms,
    line_items: (force || !hasCustomLineItems)
      ? (profile.lineItems || []).map((item) => ({
          id: createLocalId("line"),
          name: item.name || "",
          description: item.description || "",
          quantity: Number(item.quantity || 1),
          unit: item.unit || "job",
          unit_price_cents: Number(item.unit_price_cents || 0),
          kind: String(item.kind || "base"),
        }))
      : cloneJson(active.line_items || [], []),
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  renderBids(bidSearch?.value || "");
  setInlineMessage(bidMsg, "Service profile guidance applied.", "ok");
  return nextDraft;
}
function populateBidForm(draft) {
  renderBidCustomerOptions(draft?.customer_id || "");
  if (bidId) bidId.value = draft?.id || "";
  if (bidTitle) bidTitle.value = draft?.title || "";
  if (bidProfile) bidProfile.value = normalizeBidProfile(draft?.profile);
  if (bidStatus) bidStatus.value = String(draft?.status || "draft");
  if (bidWalkthroughAt) bidWalkthroughAt.value = toDateTimeLocalValue(draft?.walkthrough_at);
  if (bidValidUntil) bidValidUntil.value = draft?.valid_until || "";
  if (bidServiceAddress) bidServiceAddress.value = draft?.service_address || "";
  if (bidSiteContact) bidSiteContact.value = draft?.site_contact || "";
  if (bidScheduleWindow) bidScheduleWindow.value = draft?.schedule_window || "";
  if (bidProjectSummary) bidProjectSummary.value = draft?.project_summary || "";
  if (bidScopeOfWork) bidScopeOfWork.value = draft?.scope_of_work || "";
  if (bidProposedSolution) bidProposedSolution.value = draft?.proposed_solution || "";
  if (bidMaterialsPlan) bidMaterialsPlan.value = draft?.materials_plan || "";
  if (bidUnusedMaterialsPlan) bidUnusedMaterialsPlan.value = draft?.unused_materials_plan || "";
  if (bidExclusions) bidExclusions.value = draft?.exclusions || "";
  if (bidWarranty) bidWarranty.value = draft?.warranty || "";
  if (bidCoverNote) bidCoverNote.value = draft?.cover_note || "";
  if (bidInternalNotes) bidInternalNotes.value = draft?.internal_notes || "";
  if (bidDepositPercent) bidDepositPercent.value = String(draft?.deposit_percent ?? 0);
  if (bidDepositAmount) bidDepositAmount.value = money(draft?.deposit_amount_cents || 0);
  if (bidTerms) bidTerms.value = draft?.terms || "";
  if (bidFormTitle) bidFormTitle.textContent = draft?.title || "Walkthrough workspace";
}
function clearBidForm() {
  renderBidCustomerOptions("");
  if (bidId) bidId.value = "";
  if (bidTitle) bidTitle.value = "";
  if (bidProfile) bidProfile.value = preferredBidProfile();
  if (bidStatus) bidStatus.value = "draft";
  if (bidWalkthroughAt) bidWalkthroughAt.value = "";
  if (bidValidUntil) bidValidUntil.value = "";
  if (bidServiceAddress) bidServiceAddress.value = "";
  if (bidSiteContact) bidSiteContact.value = "";
  if (bidScheduleWindow) bidScheduleWindow.value = "";
  if (bidProjectSummary) bidProjectSummary.value = "";
  if (bidScopeOfWork) bidScopeOfWork.value = "";
  if (bidProposedSolution) bidProposedSolution.value = "";
  if (bidMaterialsPlan) bidMaterialsPlan.value = "";
  if (bidUnusedMaterialsPlan) bidUnusedMaterialsPlan.value = "";
  if (bidExclusions) bidExclusions.value = "";
  if (bidWarranty) bidWarranty.value = "";
  if (bidCoverNote) bidCoverNote.value = "";
  if (bidInternalNotes) bidInternalNotes.value = "";
  if (bidDepositPercent) bidDepositPercent.value = "0";
  if (bidDepositAmount) bidDepositAmount.value = "0.00";
  if (bidTerms) bidTerms.value = "";
  if (bidFormTitle) bidFormTitle.textContent = "Walkthrough workspace";
  clearBidLineItemForm();
  clearBidPhotoForm();
}
function bidGuidedSteps(draft) {
  const totals = calculateBidTotals(draft || {});
  const hasPricedBaseScope = bidIncludedLineItemsForOrder(draft).some((item) => bidLineItemTotalCents(item) > 0);
  const readyStatuses = ["ready_to_send", "sent", "approved"];
  const hasCustomers = CUSTOMERS_CACHE.length > 0;
  return [
    {
      id: "client_site",
      title: "Anchor the bid to a real client and place",
      copy: "Link the customer record and add the service address so this proposal belongs to a real job, not just a note.",
      done: !!draft?.customer_id && !!String(draft?.service_address || "").trim(),
      actionLabel: !draft?.customer_id ? (hasCustomers ? "Link customer" : "Create customer") : "Add address",
      targetId: !draft?.customer_id ? (hasCustomers ? "bidCustomerId" : "btnToggleBidQuickCustomer") : "bidServiceAddress",
    },
    {
      id: "problem",
      title: "Describe the problem in plain English",
      copy: "Write what the customer needs solved, then make sure the base scope explains what is actually included.",
      done: !!String(draft?.project_summary || "").trim() && !!String(draft?.scope_of_work || "").trim(),
      actionLabel: !String(draft?.project_summary || "").trim() ? "Write summary" : "Review scope",
      targetId: !String(draft?.project_summary || "").trim() ? "bidProjectSummary" : "bidScopeOfWork",
    },
    {
      id: "pricing",
      title: "Put real money on the scope",
      copy: "A bid becomes usable when the line items carry actual pricing, not placeholders. Price the base work before polishing the proposal.",
      done: hasPricedBaseScope && totals.total > 0,
      actionLabel: "Price scope",
      targetId: "bidLineItemUnitPrice",
    },
    {
      id: "proof",
      title: "Capture field proof",
      copy: "Photos reduce memory errors, justify pricing, and give the client visible confidence in what you saw during the walkthrough.",
      done: Array.isArray(draft?.photos) && draft.photos.length > 0,
      actionLabel: "Add photo",
      targetId: "bidPhotoFile",
    },
    {
      id: "delivery",
      title: "Package it so it is ready to send",
      copy: "Finish the client note, confirm the validity window, and mark the bid ready so anyone on the team knows it can go out professionally.",
      done: !!String(draft?.cover_note || "").trim() && !!String(draft?.valid_until || "").trim() && readyStatuses.includes(String(draft?.status || "").toLowerCase()),
      actionLabel: !String(draft?.cover_note || "").trim() ? "Write delivery note" : (!String(draft?.valid_until || "").trim() ? "Set validity" : "Set ready status"),
      targetId: !String(draft?.cover_note || "").trim() ? "bidCoverNote" : (!String(draft?.valid_until || "").trim() ? "bidValidUntil" : "bidStatus"),
    },
    {
      id: "operations",
      title: "Push the bid into live work",
      copy: "Once the proposal is real, convert it into a tracked order so the rest of the business can manage it without relying on memory.",
      done: !!draft?.converted_order_id,
      actionLabel: draft?.converted_order_id ? "Open order" : "Create tracked order",
      targetId: "btnConvertBidToOrder",
    },
  ];
}
function focusBidFieldForStep(step) {
  const targetId = step?.targetId;
  if (!targetId) return;
  const target = $(targetId);
  if (!target) return;
  if (targetId === "btnToggleBidQuickCustomer") {
    if (!BID_QUICK_CUSTOMER_OPEN) setBidQuickCustomerOpen(true, { keepValues: true });
    renderBidQuickCustomerCard(currentBid());
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    if (typeof target.click === "function") target.click();
    window.setTimeout(() => bidQuickCustomerName?.focus({ preventScroll: true }), 80);
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  if (targetId === "bidPhotoFile") {
    try {
      target.click();
      return;
    } catch (_) {
      // Fall through to focus.
    }
  }
  if (typeof target.focus === "function") target.focus({ preventScroll: true });
}
function renderBidGuideFlow(draft) {
  if (!bidGuideFlow) return;
  if (!draft) {
    bidGuideFlow.innerHTML = `<div class="muted">Start a bid to see the next-best action and guided workflow.</div>`;
    return;
  }

  const steps = bidGuidedSteps(draft);
  const completed = steps.filter((step) => step.done).length;
  const percent = Math.round((completed / steps.length) * 100);
  const nextStep = steps.find((step) => !step.done) || null;

  bidGuideFlow.innerHTML = `
    <div class="bid-guide-flow">
      <div class="bid-guide-flow__top">
        <div class="bid-guide-flow__progress">
          <strong>${completed}/${steps.length}</strong>
          <span>guided steps complete</span>
          <div class="bid-progress-bar"><span style="width:${percent}%;"></span></div>
        </div>
        <div class="bid-guide-flow__copy">
          This bid follows a teach-through flow so an operator does not need to be naturally organized to build a strong proposal.
          ${nextStep ? `<br><br><strong>Next best action:</strong> ${escapeHtml(nextStep.title)}.` : `<br><br><strong>Ready:</strong> this proposal has the core pieces in place and can move into delivery.`}
        </div>
        ${nextStep ? `<button class="btn btn-primary" type="button" data-bid-guide-next="${escapeAttr(nextStep.id)}">${escapeHtml(nextStep.actionLabel)}</button>` : `<span class="pill pill-on">Client-ready structure</span>`}
      </div>
      <div class="bid-step-list">
        ${steps.map((step, index) => `
          <div class="bid-step ${step.done ? "is-done" : ""}">
            <div class="bid-step__left">
              <div class="bid-step__num">${step.done ? "✓" : index + 1}</div>
              <div>
                <div class="bid-step__title">${escapeHtml(step.title)}</div>
                <div class="bid-step__copy">${escapeHtml(step.copy)}</div>
              </div>
            </div>
            <div class="bid-step__meta">
              <span class="pill ${step.done ? "pill-on" : ""}">${step.done ? "Done" : "Pending"}</span>
              <button class="btn btn-ghost btn-sm" type="button" data-bid-guide-step="${escapeAttr(step.id)}">${escapeHtml(step.done ? "Review" : step.actionLabel)}</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  bidGuideFlow.querySelectorAll("[data-bid-guide-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = steps.find((entry) => entry.id === btn.getAttribute("data-bid-guide-step"));
      if (step) focusBidFieldForStep(step);
    });
  });
  bidGuideFlow.querySelectorAll("[data-bid-guide-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = steps.find((entry) => entry.id === btn.getAttribute("data-bid-guide-next"));
      if (step) focusBidFieldForStep(step);
    });
  });
}
function renderBidProfileGuideCard(draft) {
  if (!bidProfileGuide) return;
  if (!draft) {
    bidProfileGuide.innerHTML = `<div class="muted">Choose a service profile to load walkthrough prompts.</div>`;
    return;
  }
  const profile = bidProfileConfig(draft.profile);
  bidProfileGuide.innerHTML = `
    <div class="bid-stack">
      <div>
        <div class="kicker">${escapeHtml(profile.label)}</div>
        <div class="detail-copy">${escapeHtml(profile.intro)}</div>
      </div>
      <div>
        <strong>What to capture</strong>
        <ul class="bid-guide-list">
          ${profile.photoPrompts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
      <div>
        <strong>How to price it</strong>
        <ul class="bid-guide-list">
          ${profile.pricingPrompts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}
function renderBidStatsCard(draft) {
  if (!bidStatsWrap) return;
  if (!draft) {
    bidStatsWrap.innerHTML = `<div class="muted">No walkthrough bid selected yet.</div>`;
    return;
  }
  const totals = calculateBidTotals(draft);
  bidStatsWrap.innerHTML = `
    <div class="bid-status-grid">
      <div class="bid-stat">
        <div class="bid-stat__label">Base investment</div>
        <div class="bid-stat__value">${formatUsd(totals.total)}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">Optional upsells</div>
        <div class="bid-stat__value">${formatUsd(totals.options)}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">Walkthrough photos</div>
        <div class="bid-stat__value">${String(draft.photos?.length || 0)}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">Last saved</div>
        <div class="bid-stat__value" style="font-size:14px;">${escapeHtml(formatDateTime(draft.updated_at || draft.created_at))}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">Tracked order</div>
        <div class="bid-stat__value" style="font-size:14px;">${escapeHtml(draft.converted_order_id ? "Created" : "Not yet")}</div>
      </div>
    </div>
  `;
}
function renderBidDeliveryCard(draft) {
  if (!bidDeliveryWrap) return;
  if (!draft) {
    bidDeliveryWrap.innerHTML = `<div class="muted">The proposal checklist will appear here once a draft is active.</div>`;
    return;
  }
  const items = [];
  if (!draft.customer_id) items.push(CUSTOMERS_CACHE.length ? "Link the bid to a customer record." : "Create the first customer record and link this bid to it.");
  if (!String(draft.service_address || "").trim()) items.push("Add the service address.");
  if (!String(draft.project_summary || "").trim()) items.push("Write the problem summary in plain English.");
  if (!bidIncludedLineItemsForOrder(draft).some((item) => bidLineItemTotalCents(item) > 0)) items.push("Add at least one priced base-scope line item.");
  if (!Array.isArray(draft.photos) || !draft.photos.length) items.push("Capture walkthrough photos from the site.");
  if (!String(draft.cover_note || "").trim()) items.push("Write the client delivery note.");
  if (!String(draft.valid_until || "").trim()) items.push("Set the proposal validity window.");
  if (!draft.converted_order_id) items.push("Convert the bid into tracked work when it is ready to move into operations.");
  bidDeliveryWrap.innerHTML = items.length
    ? `<ul class="bid-readiness-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="note-item"><strong>Ready to deliver</strong><div class="muted">This draft has the essentials for a professional client proposal.</div></div>`;
}
function renderBidList(filter = "") {
  if (!bidsList) return;
  const rows = sortedBids(filter);
  if (!rows.length) {
    bidsList.innerHTML = `<div class="muted">${BIDS_CACHE.length ? "No walkthrough bids match this search." : "No walkthrough bids yet. Click New bid to start the first one."}</div>`;
    if (!BIDS_CACHE.length) ACTIVE_BID_ID = null;
    return;
  }
  if (!rows.find((row) => row.id === ACTIVE_BID_ID)) ACTIVE_BID_ID = rows[0].id;
  bidsList.innerHTML = rows.map((row) => {
    const customer = findBidCustomer(row.customer_id);
    const totals = calculateBidTotals(row);
    return `
      <button type="button" class="list-item ${row.id === ACTIVE_BID_ID ? "is-active" : ""}" data-bid-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.title || defaultBidTitleFromDraft(row))}</div>
          <div class="li-sub muted">${escapeHtml(customer?.name || "Unlinked customer")} &middot; ${escapeHtml(bidProfileConfig(row.profile).label)}</div>
          <div class="li-sub muted">${escapeHtml(row.service_address || "No service address")} &middot; ${escapeHtml(formatDateTime(row.updated_at || row.created_at))}</div>
        </div>
        <div class="li-meta">
          <span class="pill">${escapeHtml(formatBidStatus(row.status))}</span>
          ${row.converted_order_id ? `<span class="pill pill-on">Tracked order</span>` : ""}
          <span class="pill">${formatUsd(totals.total)}</span>
        </div>
      </button>
    `;
  }).join("");
  bidsList.querySelectorAll("[data-bid-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_BID_ID = btn.getAttribute("data-bid-id");
      renderBids(bidSearch?.value || "");
    });
  });
}
function renderBidPhotos(draft) {
  if (!bidPhotosList) return;
  const photos = Array.isArray(draft?.photos) ? draft.photos : [];
  if (!photos.length) {
    bidPhotosList.innerHTML = `<div class="muted">No walkthrough photos saved yet.</div>`;
    return;
  }
  bidPhotosList.innerHTML = photos.map((photo) => `
    <div class="photo-card">
      <img src="${escapeAttr(photo.url || "")}" alt="${escapeAttr(photo.name || "Walkthrough photo")}" />
      <div class="photo-card__body">
        <div class="row" style="justify-content:space-between;">
          <div class="photo-card__title">${escapeHtml(photo.name || "Walkthrough photo")}</div>
          <span class="pill">${escapeHtml(photo.category || "overview")}</span>
        </div>
        <div class="photo-card__copy">${escapeParagraphs(photo.note || "")}</div>
        <div class="photo-card__copy">Saved ${escapeHtml(formatDateTime(photo.captured_at || draft.updated_at || draft.created_at))}</div>
        <div class="photo-card__actions">
          <button class="btn btn-ghost btn-sm" type="button" data-remove-photo-id="${escapeAttr(photo.id)}">Remove</button>
        </div>
      </div>
    </div>
  `).join("");
  bidPhotosList.querySelectorAll("[data-remove-photo-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      if (!active) return;
      const photoId = btn.getAttribute("data-remove-photo-id");
      const nextDraft = {
        ...active,
        photos: (active.photos || []).filter((photo) => photo.id !== photoId),
        updated_at: new Date().toISOString(),
      };
      replaceBidDraft(nextDraft);
      renderBidWorkspace(nextDraft, { preserveForm: true });
      renderBidList(bidSearch?.value || "");
      setInlineMessage(bidPhotoMsg, "Photo removed from the bid.", "ok");
    });
  });
}
function renderBidLineItems(draft) {
  if (!bidLineItemsList) return;
  const rows = Array.isArray(draft?.line_items) ? draft.line_items : [];
  if (!rows.length) {
    bidLineItemsList.innerHTML = `<div class="muted">No line items added yet.</div>`;
    return;
  }
  bidLineItemsList.innerHTML = rows.map((item) => `
    <div class="line-item-card">
      <div class="line-item-card__top">
        <div>
          <div class="line-item-card__title">${escapeHtml(item.name || "Line item")}</div>
          <div class="line-item-card__copy">${escapeParagraphs(item.description || "")}</div>
        </div>
        <span class="pill pill-on">${escapeHtml(formatBidLineItemKind(item.kind))}</span>
      </div>
      <div class="line-item-card__meta">
        <span class="pill">${escapeHtml(String(item.quantity || 0))} ${escapeHtml(item.unit || "unit")}</span>
        <span class="pill">${formatUsd(Number(item.unit_price_cents || 0))} each</span>
        <span class="pill pill-on">${formatUsd(bidLineItemTotalCents(item))}</span>
      </div>
      <div class="line-item-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-edit-line-id="${escapeAttr(item.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-remove-line-id="${escapeAttr(item.id)}">Remove</button>
      </div>
    </div>
  `).join("");
  bidLineItemsList.querySelectorAll("[data-edit-line-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      const item = active?.line_items?.find((row) => row.id === btn.getAttribute("data-edit-line-id"));
      if (item) populateBidLineItemForm(item);
    });
  });
  bidLineItemsList.querySelectorAll("[data-remove-line-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      if (!active) return;
      const lineId = btn.getAttribute("data-remove-line-id");
      const nextDraft = {
        ...active,
        line_items: (active.line_items || []).filter((item) => item.id !== lineId),
        updated_at: new Date().toISOString(),
      };
      replaceBidDraft(nextDraft);
      clearBidLineItemForm();
      renderBidWorkspace(nextDraft, { preserveForm: true });
      renderBidList(bidSearch?.value || "");
      setInlineMessage(bidLineItemMsg, "Line item removed.", "ok");
    });
  });
}
function renderBidWorkspace(draft, opts = {}) {
  if (!draft) {
    clearBidForm();
    if (btnConvertBidToOrder) {
      btnConvertBidToOrder.textContent = "Create tracked order";
      btnConvertBidToOrder.disabled = true;
    }
    renderBidQuickCustomerCard(null);
    renderBidGuideFlow(null);
    renderBidProfileGuideCard(null);
    renderBidStatsCard(null);
    renderBidDeliveryCard(null);
    if (bidPhotosList) bidPhotosList.innerHTML = `<div class="muted">No walkthrough photos saved yet.</div>`;
    if (bidLineItemsList) bidLineItemsList.innerHTML = `<div class="muted">No line items added yet.</div>`;
    renderBidProposalPreview(null);
    return;
  }
  if (!opts.preserveForm) populateBidForm(draft);
  if (btnConvertBidToOrder) {
    const linkedOrder = currentBidOrder(draft);
    btnConvertBidToOrder.disabled = false;
    btnConvertBidToOrder.textContent = linkedOrder ? "Open tracked order" : "Create tracked order";
  }
  renderBidQuickCustomerCard(draft);
  renderBidGuideFlow(draft);
  renderBidProfileGuideCard(draft);
  renderBidStatsCard(draft);
  renderBidDeliveryCard(draft);
  renderBidPhotos(draft);
  renderBidLineItems(draft);
  renderBidProposalPreview(draft);
}
function renderBids(filter = "", opts = {}) {
  const active = currentBid();
  renderBidList(filter);
  renderBidWorkspace(active, opts);
}
function startNewBid(profileKey = preferredBidProfile()) {
  const draft = emptyBidDraft(profileKey);
  BIDS_CACHE = [draft, ...(BIDS_CACHE || [])];
  ACTIVE_BID_ID = draft.id;
  persistBidDrafts();
  clearBidLineItemForm();
  clearBidPhotoForm();
  renderBids(bidSearch?.value || "");
  setInlineMessage(bidMsg, "New walkthrough bid ready.", "ok");
  return draft;
}
function duplicateCurrentBid() {
  const active = currentBid();
  if (!active) return startNewBid(preferredBidProfile());
  const copy = {
    ...cloneJson(active, {}),
    id: createLocalId("bid"),
    title: `${active.title || defaultBidTitleFromDraft(active)} copy`,
    status: "draft",
    line_items: (active.line_items || []).map((item) => ({ ...item, id: createLocalId("line") })),
    photos: (active.photos || []).map((photo) => ({ ...photo, id: createLocalId("photo") })),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(copy);
  clearBidLineItemForm();
  clearBidPhotoForm();
  renderBids(bidSearch?.value || "");
  setInlineMessage(bidMsg, "Bid duplicated into a fresh draft.", "ok");
  return copy;
}
function bidBrandContext() {
  return {
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c84b2f",
    tenantName: brandTenant?.textContent?.trim() || "ProofLink",
    logoUrl: brandLogo?.getAttribute("src") || "",
    tagline: SETUP_STATE?.config?.tagline || "Professional service proposal",
    contactEmail: SETUP_STATE?.config?.public_contact_email || "",
    phone: SETUP_STATE?.config?.public_business_phone || "",
  };
}
function renderProposalLineItemRows(items) {
  if (!items.length) return `<div class="muted">No items yet.</div>`;
  return items.map((item) => `
    <div class="proposal-line-item">
      <div>
        <div class="proposal-line-item__title">${escapeHtml(item.name || "Line item")}</div>
        <div class="proposal-line-item__copy">${escapeParagraphs(item.description || "")}</div>
      </div>
      <div class="proposal-line-item__right">
        <div>${escapeHtml(String(item.quantity || 0))} ${escapeHtml(item.unit || "unit")}</div>
        <div class="proposal-line-item__copy">${escapeHtml(formatBidLineItemKind(item.kind))}</div>
      </div>
      <div class="proposal-line-item__right">
        <div>${formatUsd(Number(item.unit_price_cents || 0))}</div>
        <div class="proposal-line-item__copy">${formatUsd(bidLineItemTotalCents(item))}</div>
      </div>
    </div>
  `).join("");
}
function buildBidProposalMarkup(draft) {
  if (!draft) return `<div class="muted">Create a walkthrough bid or select one from the list to preview the proposal.</div>`;
  const brand = bidBrandContext();
  const customer = findBidCustomer(draft.customer_id);
  const profile = bidProfileConfig(draft.profile);
  const totals = calculateBidTotals(draft);
  const depositNote = totals.deposit > 0 ? `${formatUsd(totals.deposit)} deposit requested to schedule.` : "No deposit requested on this proposal.";
  const baseItems = (draft.line_items || []).filter((item) => String(item.kind || "base").toLowerCase() !== "option");
  const optionItems = (draft.line_items || []).filter((item) => String(item.kind || "").toLowerCase() === "option");

  return `
    <div class="proposal-shell">
      <div class="proposal-hero">
        <div>
          <div class="proposal-brand">
            <div class="proposal-brand__logo">${brand.logoUrl ? `<img src="${escapeAttr(brand.logoUrl)}" alt="${escapeAttr(brand.tenantName)} logo" />` : ""}</div>
            <div>
              <div class="proposal-kicker">${escapeHtml(profile.label)} proposal</div>
              <div class="proposal-title">${escapeHtml(draft.title || defaultBidTitleFromDraft(draft))}</div>
              <div class="proposal-copy">${escapeHtml(brand.tagline)}</div>
            </div>
          </div>
          <div class="proposal-copy">${escapeParagraphs(draft.cover_note || profile.deliveryNote || "")}</div>
        </div>
        <div class="bid-stack">
          <div class="proposal-box">
            <div class="proposal-box__label">Prepared for</div>
            <div class="proposal-box__value">${escapeHtml(customer?.name || draft.site_contact || "Client to be confirmed")}</div>
            <div class="proposal-copy">${escapeHtml(customer?.email || "")}${customer?.email && customer?.phone ? "<br>" : ""}${escapeHtml(customer?.phone || "")}</div>
          </div>
          <div class="proposal-box">
            <div class="proposal-box__label">Service address</div>
            <div class="proposal-box__value">${escapeHtml(draft.service_address || "To be confirmed")}</div>
          </div>
          <div class="proposal-box">
            <div class="proposal-box__label">Investment</div>
            <div class="proposal-box__value"><strong>${formatUsd(totals.total)}</strong></div>
            <div class="proposal-copy">${escapeHtml(depositNote)}${draft.valid_until ? `<br>Valid through ${escapeHtml(formatDateOnly(draft.valid_until))}.` : ""}</div>
          </div>
        </div>
      </div>

      <div class="proposal-grid three">
        <div class="proposal-box">
          <div class="proposal-box__label">Problem to solve</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.project_summary || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Walkthrough date</div>
          <div class="proposal-box__value">${escapeHtml(draft.walkthrough_at ? formatDateTime(draft.walkthrough_at) : "Not recorded")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Schedule window</div>
          <div class="proposal-box__value">${escapeHtml(draft.schedule_window || "To be scheduled with client")}</div>
        </div>
      </div>

      <div class="proposal-grid">
        <div class="proposal-section proposal-box">
          <div class="proposal-box__label">Scope of work</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.scope_of_work || "")}</div>
        </div>
        <div class="proposal-section proposal-box">
          <div class="proposal-box__label">Recommended solution</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.proposed_solution || "")}</div>
        </div>
      </div>

      <div class="proposal-section proposal-box">
        <div class="proposal-box__label">Base scope and investment</div>
        ${renderProposalLineItemRows(baseItems)}
        <div class="proposal-total-row">
          <span>Total base investment</span>
          <strong>${formatUsd(totals.total)}</strong>
        </div>
      </div>

      ${optionItems.length ? `
        <div class="proposal-section proposal-box">
          <div class="proposal-box__label">Optional add-ons</div>
          ${renderProposalLineItemRows(optionItems)}
          <div class="proposal-total-row">
            <span>Optional work if approved</span>
            <strong>${formatUsd(totals.options)}</strong>
          </div>
        </div>
      ` : ""}

      ${(draft.photos || []).length ? `
        <div class="proposal-section">
          <h3>Walkthrough photo record</h3>
          <div class="proposal-photo-grid">
            ${(draft.photos || []).map((photo) => `
              <div class="proposal-photo">
                <img src="${escapeAttr(photo.url || "")}" alt="${escapeAttr(photo.name || "Walkthrough photo")}" />
                <div class="proposal-photo__body">
                  <div class="proposal-photo__title">${escapeHtml(photo.name || "Walkthrough photo")}</div>
                  <div class="proposal-photo__copy">${escapeParagraphs(photo.note || "")}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <div class="proposal-grid">
        <div class="proposal-box">
          <div class="proposal-box__label">Materials plan</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.materials_plan || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Unused / overage handling</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.unused_materials_plan || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Exclusions / assumptions</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.exclusions || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Warranty</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.warranty || "")}</div>
        </div>
      </div>

      <div class="proposal-grid">
        <div class="proposal-box">
          <div class="proposal-box__label">Commercial terms</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.terms || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Next step</div>
          <div class="proposal-box__value">${escapeHtml(depositNote)}</div>
          <div class="proposal-copy">Reply with approval, or send back revisions before ${escapeHtml(draft.valid_until ? formatDateOnly(draft.valid_until) : "the stated validity date")}.</div>
          ${brand.contactEmail || brand.phone ? `<div class="proposal-copy">${escapeHtml(brand.contactEmail || "")}${brand.contactEmail && brand.phone ? "<br>" : ""}${escapeHtml(brand.phone || "")}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}
function renderBidProposalPreview(draft) {
  if (!bidProposalPreview) return;
  bidProposalPreview.innerHTML = buildBidProposalMarkup(draft);
}
function bidDocumentHtml(draft) {
  const accent = bidBrandContext().accent;
  const body = buildBidProposalMarkup(draft);
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(draft?.title || "ProofLink proposal")}</title>
      <style>
        body{margin:0;padding:32px;font-family:Arial,sans-serif;background:#faf8f5;color:#151515;}
        .proposal-shell{display:flex;flex-direction:column;gap:18px;}
        .proposal-hero{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;padding-bottom:18px;border-bottom:1px solid #ddd;}
        .proposal-brand{display:flex;align-items:flex-start;gap:14px;}
        .proposal-brand__logo{width:56px;height:56px;border-radius:18px;overflow:hidden;border:1px solid #ddd;background:#fff;}
        .proposal-brand__logo img{width:100%;height:100%;object-fit:cover;}
        .proposal-kicker{color:${accent};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;}
        .proposal-title{font-size:30px;line-height:1.05;font-weight:800;margin-top:6px;}
        .proposal-copy{color:#555;line-height:1.65;margin-top:8px;}
        .proposal-box{border:1px solid #ddd;border-radius:18px;padding:14px;background:#fff;}
        .proposal-box__label{color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}
        .proposal-box__value{font-size:15px;line-height:1.55;}
        .proposal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
        .proposal-grid.three{grid-template-columns:repeat(3,minmax(0,1fr));}
        .proposal-line-item{display:grid;grid-template-columns:1.5fr .7fr .7fr;gap:12px;align-items:start;padding:12px 0;border-top:1px solid #ddd;}
        .proposal-line-item:first-child{border-top:none;padding-top:0;}
        .proposal-line-item__title{font-weight:700;}
        .proposal-line-item__copy{color:#555;font-size:12px;line-height:1.5;margin-top:6px;}
        .proposal-line-item__right{text-align:right;}
        .proposal-total-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;margin-top:12px;border-top:1px solid #ddd;}
        .proposal-total-row strong{font-size:18px;}
        .proposal-photo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;}
        .proposal-photo{border:1px solid #ddd;border-radius:18px;overflow:hidden;background:#fff;}
        .proposal-photo img{width:100%;height:160px;object-fit:cover;display:block;}
        .proposal-photo__body{padding:12px;}
        .proposal-photo__title{font-weight:700;}
        .proposal-photo__copy{color:#555;font-size:12px;line-height:1.5;margin-top:6px;}
        .proposal-section h3{margin:0 0 10px;font-size:14px;}
        @media print{body{padding:18px;}}
      </style>
    </head>
    <body>${body}</body>
  </html>`;
}
async function copyTextValue(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return true;
  }
}
function buildBidClientEmail(draft) {
  const customer = findBidCustomer(draft?.customer_id);
  const profile = bidProfileConfig(draft?.profile);
  const totals = calculateBidTotals(draft);
  const baseItems = (draft?.line_items || []).filter((item) => String(item.kind || "base").toLowerCase() !== "option");
  const bulletLines = baseItems.slice(0, 4).map((item) => `- ${item.name}: ${item.description || `${item.quantity} ${item.unit}`}`.trim());
  return [
    `Hi ${customer?.name || "there"},`,
    ``,
    `Thanks again for walking the project with us at ${draft?.service_address || "the site"}.`,
    ``,
    `${draft?.cover_note || profile.deliveryNote || "Attached is the proposal we prepared from the walkthrough."}`,
    ``,
    `Included in this proposal:`,
    ...(bulletLines.length ? bulletLines : ["- Scope and pricing are attached in the proposal document."]),
    ``,
    `Base investment: ${formatUsd(totals.total)}`,
    totals.options > 0 ? `Optional add-ons available: ${formatUsd(totals.options)}` : null,
    totals.deposit > 0 ? `Requested deposit: ${formatUsd(totals.deposit)}` : null,
    draft?.valid_until ? `Proposal valid through: ${formatDateOnly(draft.valid_until)}` : null,
    ``,
    `Reply with approval, questions, or requested revisions and we will get the next step moving.`,
    ``,
    `${bidBrandContext().tenantName}`,
    bidBrandContext().contactEmail || null,
    bidBrandContext().phone || null,
  ].filter(Boolean).join("\n");
}
function currentBidOrder(draft) {
  if (!draft) return null;
  return CRM_ORDERS_CACHE.find((row) => row.id === draft.converted_order_id)
    || CRM_ORDERS_CACHE.find((row) => row.source_type === "walkthrough_bid" && row.source_ref === draft.id)
    || null;
}
function buildOrderNotesFromBid(draft) {
  const sections = [
    draft.project_summary ? `Problem summary:\n${draft.project_summary}` : "",
    draft.scope_of_work ? `Scope of work:\n${draft.scope_of_work}` : "",
    draft.proposed_solution ? `Recommended solution:\n${draft.proposed_solution}` : "",
    draft.materials_plan ? `Materials plan:\n${draft.materials_plan}` : "",
    draft.unused_materials_plan ? `Unused / overage handling:\n${draft.unused_materials_plan}` : "",
    draft.exclusions ? `Exclusions / assumptions:\n${draft.exclusions}` : "",
    draft.terms ? `Commercial terms:\n${draft.terms}` : "",
  ].filter(Boolean);
  const optionalItems = bidOptionalLineItems(draft);
  if (optionalItems.length) {
    sections.push(`Optional add-ons:\n${optionalItems.map((item) => `- ${item.name}: ${formatUsd(bidLineItemTotalCents(item))}`).join("\n")}`);
  }
  if (draft.photos?.length) {
    sections.push(`Walkthrough photo count: ${draft.photos.length}`);
  }
  return sections.join("\n\n");
}
async function existingOrderForBidId(bidIdValue) {
  const { data, error } = await scopeQuery(sb
    .from("orders")
    .select("*"))
    .eq("source_type", "walkthrough_bid")
    .eq("source_ref", bidIdValue)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}
async function convertBidToTrackedOrder() {
  const baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!baseDraft) throw new Error("Create a bid first.");
  if (!baseDraft.customer_id) throw new Error("Link the bid to a customer before converting it into tracked work.");
  const customer = findBidCustomer(baseDraft.customer_id);
  if (!customer) throw new Error("The linked customer record could not be found. Refresh customers and try again.");

  const existing = currentBidOrder(baseDraft) || await existingOrderForBidId(baseDraft.id);
  if (existing) {
    ACTIVE_ORDER_ID = existing.id;
    const nextDraft = {
      ...baseDraft,
      converted_order_id: existing.id,
      converted_at: baseDraft.converted_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    replaceBidDraft(nextDraft);
    await fetchCrmOrders();
    renderOrders();
    renderDashboard();
    renderGuidance();
    renderMoney().catch(console.error);
    return { order: existing, draft: nextDraft, existed: true };
  }

  const items = bidIncludedLineItemsForOrder(baseDraft).map((item) => ({
    name: item.name,
    description: item.description || "",
    quantity: Number(item.quantity || 0),
    unit: item.unit || "job",
    kind: item.kind || "base",
    unitPriceCents: Number(item.unit_price_cents || 0),
    totalCents: bidLineItemTotalCents(item),
  }));
  if (!items.length) throw new Error("Add at least one non-optional line item before converting the bid.");

  const totals = calculateBidTotals(baseDraft);
  const status = String(baseDraft.status || "").toLowerCase() === "approved" ? "confirmed" : "quoted";
  const nowIso = new Date().toISOString();
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: customer.id,
    status,
    fulfillment: "service",
    scheduled_date: null,
    scheduled_time: baseDraft.schedule_window || null,
    items,
    subtotal_cents: totals.total,
    total_cents: totals.total,
    estimated_total_cents: totals.total + totals.options,
    item_count: items.length,
    unpriced_count: items.filter((item) => !Number(item.unitPriceCents || 0)).length,
    cart_summary: baseDraft.project_summary || baseDraft.title || "",
    notes: buildOrderNotesFromBid(baseDraft),
    customer_name: customer.name || "",
    email: customer.email || null,
    phone: customer.phone || null,
    preferred_contact: customer.preferred_contact || "email",
    source_type: "walkthrough_bid",
    source_ref: baseDraft.id,
    created_at: nowIso,
    updated_at: nowIso,
  });
  const { data, error } = await sb.from("orders").insert(payload).select("*").single();
  if (error) throw error;

  await sb.from("customer_interactions").insert(withTenantScope({
    operator_id: opId(),
    customer_id: customer.id,
    type: "bid_converted",
    summary: `Converted walkthrough bid into tracked order for ${formatUsd(totals.total)}`,
    metadata: {
      bid_id: baseDraft.id,
      order_id: data.id,
      status,
      service_address: baseDraft.service_address || null,
    },
    created_at: nowIso,
  }));

  ACTIVE_ORDER_ID = data.id;
  const nextDraft = {
    ...baseDraft,
    converted_order_id: data.id,
    converted_at: nowIso,
    updated_at: nowIso,
  };
  replaceBidDraft(nextDraft);
  await Promise.all([fetchCrmOrders(), fetchCustomers(), fetchPayments()]);
  renderOrders();
  renderCustomersList(customerSearch?.value || "");
  renderDashboard();
  renderGuidance();
  renderMoney().catch(console.error);
  return { order: data, draft: nextDraft, existed: false };
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}
async function uploadBidPhotoAsset(file, bidDraft) {
  const key = `walkthrough-bids/${TENANT_ID}/${opId()}/${bidDraft.id}/${Date.now()}_${safeFilename(file.name || "photo.jpg")}`;
  try {
    const { error } = await sb.storage.from("product-images").upload(key, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (error) throw error;
    const { data } = sb.storage.from("product-images").getPublicUrl(key);
    if (!data?.publicUrl) throw new Error("Photo uploaded but no public URL returned.");
    return { url: data.publicUrl, storage_mode: "cloud" };
  } catch (err) {
    return {
      url: await fileToDataUrl(file),
      storage_mode: "local",
      warning: err.message || String(err),
    };
  }
}
bidSearch?.addEventListener("input", () => renderBids(bidSearch.value, { preserveForm: true }));
btnNewBid?.addEventListener("click", () => startNewBid(preferredBidProfile()));
btnDuplicateBid?.addEventListener("click", () => duplicateCurrentBid());
btnApplyBidProfile?.addEventListener("click", () => applyBidProfileStructure(false));
btnToggleBidQuickCustomer?.addEventListener("click", () => {
  setBidQuickCustomerOpen(!BID_QUICK_CUSTOMER_OPEN, { keepValues: BID_QUICK_CUSTOMER_OPEN });
  renderBidQuickCustomerCard(currentBid());
  if (BID_QUICK_CUSTOMER_OPEN) bidQuickCustomerName?.focus();
});
btnCancelBidQuickCustomer?.addEventListener("click", () => {
  setBidQuickCustomerOpen(false);
  renderBidQuickCustomerCard(currentBid());
});
btnSaveBidQuickCustomer?.addEventListener("click", async () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidQuickCustomerMsg, "Create a bid first so there is something to link.", "error");
    return;
  }
  const hasIdentity = [bidQuickCustomerName?.value, bidQuickCustomerEmail?.value, bidQuickCustomerPhone?.value]
    .some((value) => String(value || "").trim());
  if (!hasIdentity) {
    setInlineMessage(bidQuickCustomerMsg, "Add at least a name, email, or phone so the customer record is usable.", "error");
    bidQuickCustomerName?.focus();
    return;
  }

  setInlineMessage(bidQuickCustomerMsg, "Saving and linking customer...");
  try {
    const customer = await saveCustomerRecord({
      name: bidQuickCustomerName?.value,
      email: bidQuickCustomerEmail?.value,
      phone: bidQuickCustomerPhone?.value,
      preferred_contact: bidQuickCustomerPreferredContact?.value,
      notes: bidQuickCustomerNote?.value,
    });
    const nextDraft = attachCustomerToCurrentBid(customer) || currentBid();
    setBidQuickCustomerOpen(false);
    renderBids(bidSearch?.value || "");
    setInlineMessage(bidMsg, `${customer.name || "Customer"} saved and linked to this bid.`, "ok");
    if (nextDraft?.service_address) return;
    bidServiceAddress?.focus();
  } catch (err) {
    setInlineMessage(bidQuickCustomerMsg, err.message || String(err), "error");
  }
});
btnConvertBidToOrder?.addEventListener("click", async () => {
  const draft = currentBid();
  if (!draft) {
    setInlineMessage(bidMsg, "Create a bid first so there is something to convert.", "error");
    return;
  }
  const existing = currentBidOrder(draft);
  if (existing) {
    ACTIVE_ORDER_ID = existing.id;
    switchTab("orders");
    renderOrders();
    return;
  }
  setInlineMessage(bidMsg, "Creating tracked order...");
  try {
    const result = await convertBidToTrackedOrder();
    renderBids(bidSearch?.value || "", { preserveForm: true });
    setInlineMessage(bidMsg, result.existed ? "Tracked order already existed. Opening Orders next." : "Tracked order created. Opening Orders next.", "ok");
    switchTab("orders");
    renderOrders();
  } catch (err) {
    setInlineMessage(bidMsg, err.message || String(err), "error");
  }
});
bidForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const nextDraft = updateCurrentBidFromForm({ showMessage: true, allowCreate: true }) || startNewBid(preferredBidProfile());
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
});
[bidTitle, bidCustomerId, bidProfile, bidStatus, bidWalkthroughAt, bidValidUntil, bidServiceAddress, bidSiteContact, bidScheduleWindow, bidProjectSummary, bidScopeOfWork, bidProposedSolution, bidMaterialsPlan, bidUnusedMaterialsPlan, bidExclusions, bidWarranty, bidCoverNote, bidInternalNotes, bidDepositPercent, bidDepositAmount, bidTerms].forEach((el) => {
  el?.addEventListener("input", scheduleBidAutosave);
  el?.addEventListener("change", () => {
    scheduleBidAutosave();
    if (el === bidProfile) renderBidProfileGuideCard(collectBidFormDraft());
    if (el === bidCustomerId) {
      if (bidCustomerId?.value) setBidQuickCustomerOpen(false);
      renderBidQuickCustomerCard(collectBidFormDraft());
    }
  });
});
bidPhotoForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  let active = currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const file = bidPhotoFile?.files?.[0];
  if (!file) {
    setInlineMessage(bidPhotoMsg, "Choose or capture a photo first.", "error");
    return;
  }
  const photoName = bidPhotoName?.value?.trim() || file.name || "Walkthrough photo";
  setInlineMessage(bidPhotoMsg, "Saving photo...", "");
  try {
    const upload = await uploadBidPhotoAsset(file, active);
    const baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || active;
    const nextDraft = {
      ...baseDraft,
      photos: [
        {
          id: createLocalId("photo"),
          name: photoName,
          category: bidPhotoCategory?.value || "overview",
          note: bidPhotoNote?.value?.trim() || "",
          url: upload.url,
          storage_mode: upload.storage_mode,
          captured_at: new Date().toISOString(),
        },
        ...(baseDraft.photos || []),
      ],
      updated_at: new Date().toISOString(),
    };
    replaceBidDraft(nextDraft);
    clearBidPhotoForm();
    renderBidWorkspace(nextDraft, { preserveForm: true });
    renderBidList(bidSearch?.value || "");
    setInlineMessage(bidPhotoMsg, upload.warning ? `Photo saved locally in this browser. ${upload.warning}` : "Photo saved to the bid.", "ok");
  } catch (err) {
    setInlineMessage(bidPhotoMsg, err.message || String(err), "error");
  }
});
btnClearBidLineItem?.addEventListener("click", clearBidLineItemForm);
bidLineItemForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  let active = currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const itemName = bidLineItemName?.value?.trim() || "";
  if (!itemName) {
    setInlineMessage(bidLineItemMsg, "Line item name is required.", "error");
    return;
  }
  const item = {
    id: bidLineItemId?.value || createLocalId("line"),
    name: itemName,
    description: bidLineItemDescription?.value?.trim() || "",
    quantity: Number(bidLineItemQuantity?.value || 0),
    unit: bidLineItemUnit?.value?.trim() || "job",
    unit_price_cents: toCents(bidLineItemUnitPrice?.value || 0),
    kind: String(bidLineItemKind?.value || "base"),
  };
  const baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || active;
  const nextDraft = {
    ...baseDraft,
    line_items: [
      ...(baseDraft.line_items || []).filter((row) => row.id !== item.id),
      item,
    ].sort((a, b) => a.name.localeCompare(b.name)),
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  clearBidLineItemForm();
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  setInlineMessage(bidLineItemMsg, "Line item saved.", "ok");
});
btnPrintBidProposal?.addEventListener("click", () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first so there is something to print.", "error");
    return;
  }
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    setInlineMessage(bidMsg, "Allow popups to print the proposal.", "error");
    return;
  }
  win.document.open();
  win.document.write(bidDocumentHtml(active));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
});
btnCopyBidEmail?.addEventListener("click", async () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first so there is a message to copy.", "error");
    return;
  }
  await copyTextValue(buildBidClientEmail(active));
  setInlineMessage(bidMsg, "Client email copy is on the clipboard.", "ok");
});
btnExportBidJson?.addEventListener("click", () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first so there is something to export.", "error");
    return;
  }
  const blob = new Blob([JSON.stringify(active, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(active.title || "walkthrough-bid") || "walkthrough-bid"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const topCustomer = sortedCustomers(CUSTOMERS_CACHE)[0] || null;
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
        <p>Top customer today: <strong>${escapeHtml(topCustomer?.name || "None yet")}</strong>${topCustomer ? ` | ${formatUsd(customerLifetimeValueCents(topCustomer))}` : ""}</p>
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
  const statusOptions = ["new", "quoted", "confirmed", "fulfilled", "completed", "paid", "cancelled"];

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
  const sourceLabel = String(active.source_type || "storefront").replace(/_/g, " ");

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
      <div class="detail-copy">Source: ${escapeHtml(sourceLabel)}</div>
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
            ${statusOptions.map((status) => `<option value="${status}" ${String(active.status || "new").toLowerCase() === status ? "selected" : ""}>${status}</option>`).join("")}
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
  const topCustomer = sortedCustomers(CUSTOMERS_CACHE)[0] || null;
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
          <div class="money">${formatUsd(topCustomer ? customerLifetimeValueCents(topCustomer) : 0)}</div>
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
    loadBidDrafts();

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
    renderBids("");
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
