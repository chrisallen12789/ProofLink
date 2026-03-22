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
let LEADS_CACHE = [];
let BIDS_CACHE = [];
let JOBS_CACHE = [];
let SERVICE_PLANS_CACHE = [];
let SERVICE_PLANS_FEATURE_READY = true;
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
let ACTIVE_LEAD_ID = null;
let CUSTOMER_CREATING = false;
let ACTIVE_PAYMENT_ID = null;
let ACTIVE_JOB_ID = null;
let ACTIVE_PLAN_ID = null;
let ACTIVE_BID_LINE_ITEM_ID = null;
let BID_QUICK_CUSTOMER_OPEN = false;
let DASHBOARD_PAYMENT_STATE = null;
let DASHBOARD_LAUNCH_CHECKLIST = null;
let WORKSPACE_BLUEPRINT = null;
let BID_SYNC_TIMER = null;
let BID_SYNC_IN_FLIGHT = false;
let BID_SYNC_PROMISE = null;
let CURRENT_FOLLOW_UP_QUEUE = [];
let FOLLOW_UP_QUEUE_MESSAGE = null;

const FOLLOW_UP_SNOOZE_KEY = "prooflink_follow_up_snoozes_v1";
const FOLLOW_UP_KIND_META = {
  lead_nudge: { label: "Missed lead", cooldownHours: 24 },
  quote_follow_up: { label: "Quote follow-up", cooldownHours: 72 },
  deposit_reminder: { label: "Deposit reminder", cooldownHours: 24 },
  payment_reminder: { label: "Payment reminder", cooldownHours: 24 },
  review_request: { label: "Review request", cooldownHours: 168 },
};

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
    applyWorkspaceBlueprint();
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
const sectionNav = document.querySelector('.nav[aria-label="Sections"]');
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
const leadsList = $("leadsList");
const leadDetailWrap = $("leadDetailWrap");
const btnNewLead = $("btnNewLead");
const leadSearch = $("leadSearch");
const leadForm = $("leadForm");
const leadId = $("leadId");
const leadStatus = $("leadStatus");
const leadPriority = $("leadPriority");
const leadCustomerId = $("leadCustomerId");
const leadTitle = $("leadTitle");
const leadRequestedService = $("leadRequestedService");
const leadContactName = $("leadContactName");
const leadContactEmail = $("leadContactEmail");
const leadContactPhone = $("leadContactPhone");
const leadPreferredContact = $("leadPreferredContact");
const leadSourceType = $("leadSourceType");
const leadServiceAddress = $("leadServiceAddress");
const leadSummary = $("leadSummary");
const leadNotes = $("leadNotes");
const leadMsg = $("leadMsg");
const btnLeadCreateBid = $("btnLeadCreateBid");
const btnLeadOpenBid = $("btnLeadOpenBid");
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
const bidPhotoGuide = $("bidPhotoGuide");
const bidPhotoForm = $("bidPhotoForm");
const bidPhotoFile = $("bidPhotoFile");
const bidPhotoName = $("bidPhotoName");
const bidPhotoCategory = $("bidPhotoCategory");
const bidPhotoNote = $("bidPhotoNote");
const bidPhotoMsg = $("bidPhotoMsg");
const bidPhotosList = $("bidPhotosList");
const bidScopeStarters = $("bidScopeStarters");
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
const jobsList = $("jobsList");
const jobDetailWrap = $("jobDetailWrap");
const btnNewJob = $("btnNewJob");
const jobSearch = $("jobSearch");
const jobForm = $("jobForm");
const jobId = $("jobId");
const jobStatus = $("jobStatus");
const jobOrderId = $("jobOrderId");
const jobCustomerId = $("jobCustomerId");
const jobTitle = $("jobTitle");
const jobServiceAddress = $("jobServiceAddress");
const jobScheduledDate = $("jobScheduledDate");
const jobScheduledTime = $("jobScheduledTime");
const jobScheduleWindow = $("jobScheduleWindow");
const jobSummary = $("jobSummary");
const jobNotes = $("jobNotes");
const jobMsg = $("jobMsg");
const btnJobOpenOrder = $("btnJobOpenOrder");
const btnJobRecordPayment = $("btnJobRecordPayment");
const plansList = $("plansList");
const planDetailWrap = $("planDetailWrap");
const btnNewPlan = $("btnNewPlan");
const btnRunDuePlans = $("btnRunDuePlans");
const planSearch = $("planSearch");
const planForm = $("planForm");
const planId = $("planId");
const planStatus = $("planStatus");
const planCustomerId = $("planCustomerId");
const planSourceOrderId = $("planSourceOrderId");
const planTitle = $("planTitle");
const planServiceAddress = $("planServiceAddress");
const planCadence = $("planCadence");
const planIntervalDays = $("planIntervalDays");
const planNextRunOn = $("planNextRunOn");
const planAmount = $("planAmount");
const planDepositAmount = $("planDepositAmount");
const planAutoCreateJob = $("planAutoCreateJob");
const planScheduleWindow = $("planScheduleWindow");
const planSummary = $("planSummary");
const planNotes = $("planNotes");
const planMsg = $("planMsg");
const btnGeneratePlanOrder = $("btnGeneratePlanOrder");
const btnOpenPlanOrder = $("btnOpenPlanOrder");

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
const paymentJobId = $("paymentJobId");
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
const setupWorkspaceBusinessType = $("setupWorkspaceBusinessType");
const setupAccentColor = $("setupAccentColor");
const setupLogoUrl = $("setupLogoUrl");
const setupHeroImageUrl = $("setupHeroImageUrl");
const setupPublicContactEmail = $("setupPublicContactEmail");
const setupPublicBusinessPhone = $("setupPublicBusinessPhone");
const setupServiceArea = $("setupServiceArea");
const setupReviewPlatformLabel = $("setupReviewPlatformLabel");
const setupReviewLinkUrl = $("setupReviewLinkUrl");
const setupReferralMessage = $("setupReferralMessage");
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

// Bookings
let BOOKINGS_CACHE = [];
let BK_VIEW_DATE   = new Date(); // month currently shown in calendar

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
const expenseType = $("expenseType");
const expenseDescription = $("expenseDescription");
const expenseNotes = $("expenseNotes");
const expenseAmount = $("expenseAmount");
const expenseCustomerId = $("expenseCustomerId");
const expenseOrderId = $("expenseOrderId");
const expenseJobId = $("expenseJobId");
const expenseBillable = $("expenseBillable");
const expenseReimbursable = $("expenseReimbursable");
const expenseChangeOrder = $("expenseChangeOrder");
const expenseLaborFields = $("expenseLaborFields");
const expenseLaborRole = $("expenseLaborRole");

const WORKSPACE_DIRTY_TABS = new Set();
const WORKSPACE_SNAPSHOT_BY_TAB = new Map();
const WORKSPACE_SNAPSHOT_TIMERS = new Map();
const WORKSPACE_CONTEXT_GROUPS = {
  dashboard: ["dashboard", "leads", "bids", "orders", "jobs", "payments", "customers", "import"],
  leads: ["leads", "bids", "customers"],
  bids: ["bids", "leads", "orders", "customers"],
  orders: ["orders", "jobs", "payments", "customers"],
  jobs: ["jobs", "orders", "payments", "expenses"],
  plans: ["plans", "jobs", "customers", "payments"],
  customers: ["customers", "leads", "bids", "payments"],
  import: ["import", "customers", "orders", "payments"],
  payments: ["payments", "orders", "jobs", "money"],
  domains: ["domains", "setup"],
  setup: ["setup", "domains", "guidance"],
  products: ["products", "pricing", "availability"],
  pricing: ["pricing", "products", "availability"],
  availability: ["availability", "products", "pricing", "plans"],
  expenses: ["expenses", "jobs", "money"],
  money: ["money", "payments", "expenses", "jobs"],
  guidance: ["guidance", "dashboard", "money"],
};
const expenseLaborHours = $("expenseLaborHours");
const expenseLaborRate = $("expenseLaborRate");
const expenseMaterialFields = $("expenseMaterialFields");
const expenseMaterialName = $("expenseMaterialName");
const expenseMaterialQuantity = $("expenseMaterialQuantity");
const expenseChangeOrderFields = $("expenseChangeOrderFields");
const expenseChangeOrderLabel = $("expenseChangeOrderLabel");
const expenseChangeOrderNote = $("expenseChangeOrderNote");
const expenseMaterialNotesFields = $("expenseMaterialNotesFields");
const expenseLeftoverNote = $("expenseLeftoverNote");
const expenseWasteNote = $("expenseWasteNote");

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
    photoCategories: [
      { value: "overview", label: "Overview", name: "Wide work area", note: "Wide photo showing the full work area and what is included in the visible scope." },
      { value: "concern", label: "Concern", name: "Main issue", note: "Close photo of the issue, buildup, damage, or condition that affects the price or scope." },
      { value: "access", label: "Access", name: "Access point", note: "Show gates, entries, power, water, ladder setup, or anything that changes labor and logistics." },
      { value: "measurement", label: "Measurement", name: "Measurements and counts", note: "Capture measured sections, equipment counts, or boundaries used to build the bid." },
      { value: "materials", label: "Materials", name: "Materials and staging", note: "Document equipment, consumables, or jobsite staging that supports the proposed work." },
      { value: "finish", label: "Finish detail", name: "Finish detail", note: "Show delicate finishes, matching concerns, or details that need protection or special handling." },
    ],
    scopeStarters: [
      { key: "service_visit", name: "Primary service scope", description: "Core labor and materials for the main problem the customer needs solved on this visit.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { key: "site_allowance", name: "Site-specific allowance", description: "Allowance for access issues, unknowns, or field conditions that can only be confirmed once work begins.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { key: "service_upgrade", name: "Optional add-on", description: "Upgrade or adjacent work the customer may approve without rewriting the full proposal.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    proposalPrompts: [
      "Separate the base scope from allowances and optional add-ons so the client can say yes without confusion.",
      "Use photos to explain what you saw on site so the price feels documented instead of guessed.",
      "Call out access, schedule, and protection steps so the proposal reads like a real operating plan.",
    ],
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
    photoCategories: [
      { value: "overview", label: "Front elevation", name: "Front elevation and curb view", note: "Wide shot of the full structure or work zone so the client can see the visible wash scope in one frame." },
      { value: "concern", label: "Stain or buildup", name: "Heavy buildup and staining", note: "Close photo showing algae, rust, oil, oxidation, or deep staining that affects chemistry, labor, or expectations." },
      { value: "access", label: "Water and drainage", name: "Water access and drainage path", note: "Show spigot access, hose path, runoff direction, and any area that needs containment or extra prep." },
      { value: "finish", label: "Delicate surfaces", name: "Windows, fixtures, and landscaping", note: "Show glass, fixtures, paint, plants, or delicate surfaces that need masking, protection, or soft-wash treatment." },
      { value: "measurement", label: "Measured sections", name: "Measured flatwork or work sections", note: "Capture sections, footage, or boundaries used to price driveways, sidewalks, patios, or other flatwork cleanly." },
      { value: "materials", label: "Obstacles and setup", name: "Access obstacles and setup factors", note: "Show gates, steep grade, parked vehicles, furniture, or obstacles that change setup time and wash sequencing." },
    ],
    scopeStarters: [
      { key: "house_soft_wash", name: "House soft wash", description: "Low-pressure wash of siding, soffits, fascia, trim, and entry surfaces based on visible organic buildup and access.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { key: "flatwork_cleaning", name: "Driveway and flatwork cleaning", description: "Surface cleaning for driveway, sidewalk, patio, or other flatwork sections priced from the measured areas captured on site.", quantity: 1, unit: "section", unit_price_cents: 0, kind: "base" },
      { key: "gutter_brightening", name: "Gutter brightening", description: "Optional add-on for tiger-striping, oxidation, or visible gutter staining that needs dedicated treatment.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
      { key: "rust_treatment", name: "Rust or stain treatment", description: "Targeted treatment for rust, oil, red clay, or deep staining that requires extra chemistry and additional passes.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { key: "deck_fence_wash", name: "Deck or fence wash", description: "Cleaning scope for wood, vinyl, or composite deck and fence surfaces when those areas are included beyond the base wash.", quantity: 1, unit: "section", unit_price_cents: 0, kind: "option" },
      { key: "surface_protection", name: "Post-clean protection", description: "Optional sealing or surface protection quoted separately so the customer can approve it without changing the wash scope.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    proposalPrompts: [
      "Break out the wash, stain treatment, and protection work so the client can approve the right level of service quickly.",
      "Use the walkthrough photos to show buildup, oxidation, and access conditions that justify the recommended chemistry and labor.",
      "Call out water access, drainage, and landscape protection so the proposal feels careful and professional before anyone arrives on site.",
    ],
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
function cleanUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const next = new URL(raw);
    if (!["http:", "https:"].includes(next.protocol)) return "";
    return next.toString();
  } catch (_) {
    return "";
  }
}
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
  if (!raw.includes(":")) return raw || "-";
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
function getOperatorAccessToken() {
  return window.PROOFLINK_OPERATOR_RUNTIME?.getAccessToken?.() || Promise.resolve("");
}
async function postOperatorFunction(functionName, payload = {}) {
  const token = await getOperatorAccessToken();
  const res = await fetch(`/.netlify/functions/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function errorText(error) {
  return String(error?.message || error?.details || error?.hint || "").toLowerCase();
}
function isMissingDatabaseFeatureError(error, hints = []) {
  const code = String(error?.code || "").toUpperCase();
  const message = errorText(error);
  const featureHints = Array.isArray(hints) ? hints.map((item) => String(item || "").toLowerCase()).filter(Boolean) : [];
  const mentionsHint = !featureHints.length || featureHints.some((hint) => message.includes(hint));
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(code)) return true;
  if (!mentionsHint) return false;
  return (
    message.includes("does not exist") ||
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    message.includes("relation") ||
    message.includes("function")
  );
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
function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}
function normalizeWorkflowPaymentState(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "partial") return "partially_paid";
  if (["paid", "partially_paid", "overdue", "refunded", "void"].includes(raw)) return raw;
  return "unpaid";
}
function orderTotalCents(row) {
  return Number(row?.total_cents || row?.estimated_total_cents || row?.subtotal_cents || 0);
}
function orderAmountPaidCents(row) {
  const explicit = Number(row?.amount_paid_cents || 0);
  if (explicit > 0) return explicit;
  return PAYMENTS_CACHE
    .filter((payment) => payment.order_id === row?.id)
    .reduce((sum, payment) => sum + Math.max(0, paymentRevenueContributionCents(payment)), 0);
}
function orderAmountDueCents(row) {
  const explicit = Number(row?.amount_due_cents || 0);
  if (explicit > 0 || normalizeWorkflowPaymentState(row?.payment_state) === "paid") return explicit;
  return Math.max(orderTotalCents(row) - orderAmountPaidCents(row), 0);
}
function orderDepositRequiredCents(row) {
  return Math.max(0, Number(row?.deposit_required_cents || 0));
}
function orderDepositPaidCents(row) {
  const explicit = Math.max(0, Number(row?.deposit_paid_cents || 0));
  if (explicit > 0) return explicit;
  return Math.min(orderAmountPaidCents(row), orderDepositRequiredCents(row));
}
function orderDepositGapCents(row) {
  return Math.max(orderDepositRequiredCents(row) - orderDepositPaidCents(row), 0);
}
function normalizeDepositPolicy(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["required_before_booking", "required_before_job", "optional"].includes(raw)) return raw;
  return "optional";
}
function orderDepositPolicy(row) {
  if (Number(row?.deposit_required_cents || 0) <= 0) return "optional";
  return normalizeDepositPolicy(row?.deposit_policy);
}
function orderDepositDueDate(row) {
  return row?.deposit_due_date || row?.scheduled_date || row?.payment_due_date || null;
}
function orderDepositOverrideReason(row) {
  return String(row?.deposit_override_reason || "").trim();
}
function orderDepositStatus(row) {
  const required = orderDepositRequiredCents(row);
  const paid = orderDepositPaidCents(row);
  const gap = orderDepositGapCents(row);
  if (required <= 0) return "not_required";
  if (orderDepositOverrideReason(row)) return "waived";
  if (gap <= 0 && required > 0) return "paid";
  const dueDate = orderDepositDueDate(row) ? new Date(orderDepositDueDate(row)) : null;
  const isPastDue = dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < new Date();
  if (paid > 0 && gap > 0) return isPastDue ? "overdue" : "partially_paid";
  if (orderDepositPolicy(row) === "optional") return "requested";
  return isPastDue ? "overdue" : "due";
}
function formatDepositStatus(value) {
  const labels = {
    not_required: "No deposit",
    requested: "Deposit requested",
    due: "Deposit due",
    partially_paid: "Deposit part paid",
    paid: "Deposit paid",
    overdue: "Deposit overdue",
    waived: "Deposit waived",
  };
  return labels[String(value || "").trim().toLowerCase()] || "Deposit";
}
function depositStatusClass(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "paid") return "pill-on";
  if (status === "overdue") return "pill-bad";
  if (status === "due" || status === "partially_paid") return "pill-warn";
  return "pill-muted";
}
function orderDepositBlocksBooking(row) {
  return orderDepositPolicy(row) === "required_before_booking" && orderDepositGapCents(row) > 0 && !orderDepositOverrideReason(row);
}
function orderDepositBlocksJob(row) {
  return ["required_before_booking", "required_before_job"].includes(orderDepositPolicy(row)) && orderDepositGapCents(row) > 0 && !orderDepositOverrideReason(row);
}
function depositPolicyLabel(value) {
  const labels = {
    optional: "Optional deposit",
    required_before_booking: "Required before booking",
    required_before_job: "Required before job",
  };
  return labels[normalizeDepositPolicy(value)] || "Optional deposit";
}
function orderPaymentState(row) {
  const explicit = normalizeWorkflowPaymentState(row?.payment_state);
  if (explicit !== "unpaid" || Number(row?.amount_paid_cents || 0) > 0 || Number(row?.amount_due_cents || 0) > 0) {
    return explicit;
  }
  const paid = orderAmountPaidCents(row);
  const due = Math.max(orderTotalCents(row) - paid, 0);
  if (due <= 0 && paid > 0) return "paid";
  if (paid > 0 && due > 0) return "partially_paid";
  const dueDate = row?.payment_due_date ? new Date(row.payment_due_date) : null;
  if (due > 0 && dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < new Date()) return "overdue";
  return "unpaid";
}
function formatWorkflowPaymentState(value) {
  const labels = {
    unpaid: "Unpaid",
    partially_paid: "Partially paid",
    paid: "Paid",
    overdue: "Overdue",
    refunded: "Refunded",
    void: "Void",
  };
  return labels[normalizeWorkflowPaymentState(value)] || "Unpaid";
}
function paymentStateClass(value) {
  const state = normalizeWorkflowPaymentState(value);
  if (state === "paid") return "pill-on";
  if (state === "partially_paid") return "pill-warn";
  if (state === "overdue") return "pill-bad";
  if (state === "refunded" || state === "void") return "pill-muted";
  return "";
}
function orderStatusAdvancesBooking(value) {
  return ["confirmed", "fulfilled", "completed", "paid"].includes(String(value || "").trim().toLowerCase());
}
function assertOrderAllowsStatusChange(row, nextStatus) {
  if (orderDepositBlocksBooking(row) && orderStatusAdvancesBooking(nextStatus)) {
    throw new Error("This order requires a deposit before it can be booked. Collect the deposit or add an override reason first.");
  }
}
function assertOrderAllowsJobCreation(row) {
  if (orderDepositBlocksJob(row)) {
    throw new Error("This order requires its deposit before a job can be created. Collect the deposit or record an override reason first.");
  }
}
async function seedOrderDepositDefaults(order, options = {}) {
  if (!order?.id) return order;
  const required = Math.max(0, Number(options.depositRequiredCents ?? order.deposit_required_cents ?? 0));
  if (required <= 0) return order;
  const policy = normalizeDepositPolicy(options.depositPolicy || order.deposit_policy || "required_before_job");
  const dueDate = options.depositDueDate || order.deposit_due_date || order.scheduled_date || order.payment_due_date || new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await sb.from("orders")
      .update({
        deposit_policy: policy,
        deposit_due_date: dueDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();
    if (error) {
      if (isMissingDatabaseFeatureError(error, ["deposit_policy", "deposit_due_date"])) return order;
      throw error;
    }
    CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) => row.id === order.id ? data : row);
    return data;
  } catch (error) {
    if (isMissingDatabaseFeatureError(error, ["deposit_policy", "deposit_due_date"])) return order;
    throw error;
  }
}
function planCadenceLabel(value, intervalDays = 0) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "custom_days") {
    const days = Math.max(1, Number(intervalDays || 0));
    return `${days || 30}-day cycle`;
  }
  const labels = {
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    monthly: "Monthly",
    quarterly: "Quarterly",
  };
  return labels[raw] || titleCaseWords(raw || "monthly");
}
function servicePlanAmountCents(plan) {
  const explicit = Math.max(0, Number(plan?.amount_cents || 0));
  if (explicit > 0) return explicit;
  return (Array.isArray(plan?.line_items) ? plan.line_items : [])
    .reduce((sum, item) => sum + Math.max(0, Number(item?.totalCents || item?.total_cents || 0)), 0);
}
function servicePlanNextRunTime(plan) {
  return new Date(plan?.next_run_on || 0).getTime() || 0;
}
function servicePlanNextRunLabel(plan) {
  return plan?.next_run_on ? formatDateOnly(plan.next_run_on) : "No date";
}
function currentServicePlan() {
  return SERVICE_PLANS_CACHE.find((row) => row.id === ACTIVE_PLAN_ID) || null;
}
function dueServicePlans() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return SERVICE_PLANS_CACHE.filter((plan) => {
    if (String(plan?.status || "").toLowerCase() !== "active") return false;
    const nextRun = new Date(plan?.next_run_on || 0);
    if (Number.isNaN(nextRun.getTime())) return false;
    nextRun.setHours(0, 0, 0, 0);
    return nextRun.getTime() <= today.getTime();
  });
}
function ordersMissingDeposits() {
  return CRM_ORDERS_CACHE.filter((row) => {
    const status = String(row?.status || "").trim().toLowerCase();
    if (["cancelled", "paid"].includes(status)) return false;
    return orderDepositGapCents(row) > 0 && orderDepositPolicy(row) !== "optional" && !orderDepositOverrideReason(row);
  });
}
function linkedOrderForJob(job) {
  return CRM_ORDERS_CACHE.find((row) => row.id === job?.order_id) || null;
}
function currentLead() {
  return LEADS_CACHE.find((row) => row.id === ACTIVE_LEAD_ID) || null;
}
function currentJob() {
  return JOBS_CACHE.find((row) => row.id === ACTIVE_JOB_ID) || null;
}
function normalizeExpenseType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["job_cost", "material", "labor", "vendor_bill", "overhead", "reimbursement", "other"].includes(raw)) return raw;
  return "overhead";
}
function formatExpenseType(value) {
  const labels = {
    job_cost: "Job cost",
    material: "Material",
    labor: "Labor",
    vendor_bill: "Vendor bill",
    overhead: "Overhead",
    reimbursement: "Reimbursement",
    other: "Other",
  };
  return labels[normalizeExpenseType(value)] || "Expense";
}
function normalizeSupplementalCostItems(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item, kind: String(item.kind || "").trim().toLowerCase() }))
    .filter((item) => item.kind);
}
function expenseSupplementalItems(expense) {
  return normalizeSupplementalCostItems(expense?.used_materials);
}
function expenseLaborItem(expense) {
  return expenseSupplementalItems(expense).find((item) => item.kind === "labor") || null;
}
function expenseMaterialItems(expense) {
  return expenseSupplementalItems(expense).filter((item) => item.kind === "material");
}
function expenseChangeOrderItem(expense) {
  return expenseSupplementalItems(expense).find((item) => item.kind === "change_order") || null;
}
function expenseLeftoverNotes(expense) {
  return expenseMaterialItems(expense)
    .map((item) => String(item.leftover_note || "").trim())
    .filter(Boolean);
}
function expenseWasteNotes(expense) {
  return expenseMaterialItems(expense)
    .map((item) => String(item.waste_note || "").trim())
    .filter(Boolean);
}
function expenseLaborHoursValue(expense) {
  return Number(expenseLaborItem(expense)?.hours || 0);
}
function expenseLaborRateCents(expense) {
  return Number(expenseLaborItem(expense)?.rate_cents || 0);
}
function expenseHasLaborDetail(expense) {
  return !!expenseLaborItem(expense);
}
function expenseHasMaterialDetail(expense) {
  return expenseMaterialItems(expense).length > 0;
}
function expenseIsChangeOrder(expense) {
  return !!expense?.billable && !!expenseChangeOrderItem(expense);
}
function costItemSummary(expense) {
  const parts = [formatExpenseType(expense?.expense_type)];
  const labor = expenseLaborItem(expense);
  const material = expenseMaterialItems(expense)[0] || null;
  const changeOrder = expenseChangeOrderItem(expense);
  if (labor?.hours) parts.push(`${Number(labor.hours)}h labor`);
  if (material?.name) parts.push(material.name);
  if (changeOrder?.label) parts.push(`CO: ${changeOrder.label}`);
  return parts.join(" | ");
}
function updateExpenseTypeVisibility() {
  const type = normalizeExpenseType(expenseType?.value || "overhead");
  if (expenseLaborFields) expenseLaborFields.classList.toggle("hidden", type !== "labor");
  const showMaterial = ["material", "job_cost", "vendor_bill"].includes(type);
  if (expenseMaterialFields) expenseMaterialFields.classList.toggle("hidden", !showMaterial);
  if (expenseMaterialNotesFields) expenseMaterialNotesFields.classList.toggle("hidden", !showMaterial);
  const showChangeOrder = !!expenseChangeOrder?.checked;
  if (expenseChangeOrderFields) expenseChangeOrderFields.classList.toggle("hidden", !showChangeOrder);
}
function syncExpenseLaborAmount() {
  if (!expenseAmount || normalizeExpenseType(expenseType?.value || "") !== "labor") return;
  const hours = Number(expenseLaborHours?.value || 0);
  const rate = Number(expenseLaborRate?.value || 0);
  if (hours > 0 && rate > 0) {
    expenseAmount.value = String((hours * rate).toFixed(2));
  }
}
function buildExpenseSupplementalItems() {
  const items = [];
  const type = normalizeExpenseType(expenseType?.value || "overhead");
  const laborHours = Number(expenseLaborHours?.value || 0);
  const laborRateCents = toCents(expenseLaborRate?.value || 0);
  if (type === "labor" && laborHours > 0) {
    items.push({
      kind: "labor",
      role: expenseLaborRole?.value?.trim() || "",
      hours: laborHours,
      rate_cents: laborRateCents,
    });
  }
  const materialName = expenseMaterialName?.value?.trim() || "";
  const materialQuantity = expenseMaterialQuantity?.value?.trim() || "";
  const leftoverNote = expenseLeftoverNote?.value?.trim() || "";
  const wasteNote = expenseWasteNote?.value?.trim() || "";
  if (materialName || materialQuantity || leftoverNote || wasteNote) {
    items.push({
      kind: "material",
      name: materialName,
      quantity: materialQuantity,
      leftover_note: leftoverNote,
      waste_note: wasteNote,
    });
  }
  if (expenseChangeOrder?.checked) {
    items.push({
      kind: "change_order",
      label: expenseChangeOrderLabel?.value?.trim() || "Extra scope",
      note: expenseChangeOrderNote?.value?.trim() || "",
    });
  }
  return items;
}
function costBreakdownForJobs(rows = jobsWithTrackedEconomics()) {
  const breakdown = {
    laborCostCents: 0,
    materialCostCents: 0,
    changeOrderCostCents: 0,
    laborHours: 0,
    leftoverNotes: [],
    wasteNotes: [],
  };
  rows.forEach(({ job, order }) => {
    trackedJobExpenses(job, order).forEach((expense) => {
      const amount = expenseAmountCents(expense);
      const type = normalizeExpenseType(expense.expense_type);
      if (type === "labor" || expenseHasLaborDetail(expense)) {
        breakdown.laborCostCents += amount;
        breakdown.laborHours += expenseLaborHoursValue(expense);
      } else if (type === "material" || expenseHasMaterialDetail(expense)) {
        breakdown.materialCostCents += amount;
      }
      if (expenseIsChangeOrder(expense)) breakdown.changeOrderCostCents += amount;
      breakdown.leftoverNotes.push(...expenseLeftoverNotes(expense));
      breakdown.wasteNotes.push(...expenseWasteNotes(expense));
    });
  });
  breakdown.leftoverNotes = uniqList(breakdown.leftoverNotes).slice(0, 6);
  breakdown.wasteNotes = uniqList(breakdown.wasteNotes).slice(0, 6);
  return breakdown;
}
function expenseCountsTowardJobCost(expense) {
  if (!expense) return false;
  if (normalizeExpenseType(expense.expense_type) === "overhead") return false;
  return Boolean(expense.job_id || expense.order_id);
}
function expensesForOrder(orderIdValue) {
  const orderId = String(orderIdValue || "").trim();
  if (!orderId) return [];
  return EXPENSES_CACHE.filter((expense) => expense.order_id === orderId);
}
function expensesForJob(jobIdValue) {
  const jobId = String(jobIdValue || "").trim();
  if (!jobId) return [];
  return EXPENSES_CACHE.filter((expense) => expense.job_id === jobId);
}
function expenseAmountCents(expense) {
  return Math.max(0, Number(expense?.amount_cents || 0));
}
function expenseLinkedCustomerId(expense) {
  return expense?.customer_id || linkedOrderForJob(JOBS_CACHE.find((row) => row.id === expense?.job_id))?.customer_id || "";
}
function trackedJobExpenses(job, order = linkedOrderForJob(job)) {
  if (!job) return [];
  const jobRows = expensesForJob(job.id);
  const orderRows = order?.id
    ? expensesForOrder(order.id).filter((expense) => !expense.job_id || expense.job_id === job.id)
    : [];
  const seen = new Set();
  return [...jobRows, ...orderRows]
    .filter((expense) => {
      if (!expenseCountsTowardJobCost(expense)) return false;
      if (seen.has(expense.id)) return false;
      seen.add(expense.id);
      return true;
    });
}
function jobRevenueCents(job, order = linkedOrderForJob(job)) {
  return Math.max(0, orderTotalCents(order));
}
function jobTrackedCostCents(job, order = linkedOrderForJob(job)) {
  return trackedJobExpenses(job, order)
    .reduce((sum, expense) => sum + expenseAmountCents(expense), 0);
}
function jobGrossProfitCents(job, order = linkedOrderForJob(job)) {
  return jobRevenueCents(job, order) - jobTrackedCostCents(job, order);
}
function jobMarginRatio(job, order = linkedOrderForJob(job)) {
  const revenue = jobRevenueCents(job, order);
  if (revenue <= 0) return null;
  return jobGrossProfitCents(job, order) / revenue;
}
function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}
function grossProfitToneClass(valueCents = 0) {
  if (valueCents > 0) return "pill-on";
  if (valueCents < 0) return "pill-bad";
  return "pill-muted";
}
function marginToneClass(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "pill-muted";
  if (Number(value) >= 0.45) return "pill-on";
  if (Number(value) >= 0.2) return "pill-warn";
  return "pill-bad";
}
function jobsWithTrackedEconomics() {
  return (JOBS_CACHE || [])
    .map((job) => {
      const order = linkedOrderForJob(job);
      return {
        job,
        order,
        revenueCents: jobRevenueCents(job, order),
        costCents: jobTrackedCostCents(job, order),
        grossProfitCents: jobGrossProfitCents(job, order),
        marginRatio: jobMarginRatio(job, order),
      };
    })
    .filter((row) => row.revenueCents > 0);
}
function weightedAverageJobMarginRatio() {
  const rows = jobsWithTrackedEconomics();
  const totals = rows.reduce((sum, row) => {
    sum.revenue += row.revenueCents;
    sum.profit += row.grossProfitCents;
    return sum;
  }, { revenue: 0, profit: 0 });
  if (totals.revenue <= 0) return null;
  return totals.profit / totals.revenue;
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
  renderExpenseCustomerOptions(expenseCustomerId?.value || "");
  renderExpenseOrderOptions(expenseOrderId?.value || "");
  renderExpenseJobOptions(expenseJobId?.value || "");
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
    operatorFooterText.textContent = `Operator UI v3 - ${b.tenantName || "Tenant"}  |  Powered by ${b.productName || "ProofLink"}${TENANT_SCOPE_ENABLED ? `  |  ${TENANT_COLUMN} ready (${TENANT_ID})` : ""}`;
  }
}

const WORKSPACE_BASE_TAB_ORDER = [
  "dashboard",
  "leads",
  "orders",
  "bids",
  "jobs",
  "plans",
  "customers",
  "import",
  "payments",
  "domains",
  "setup",
  "products",
  "pricing",
  "availability",
  "bookings",
  "expenses",
  "money",
  "guidance",
];
const WORKSPACE_PRIORITY_TAB_MAP = {
  crm: "customers",
  intake: "orders",
  bids: "bids",
  orders_jobs: "orders",
  payments: "payments",
  expenses: "expenses",
  inventory_materials: "products",
  schedule: "availability",
  proof: "bids",
  reporting: "guidance",
};
const WORKSPACE_SERVICE_FAMILIES = new Set([
  "field_service",
  "project_trade",
  "recurring_field_service",
  "mixed_scope_service",
]);
const WORKSPACE_BOOKING_FAMILIES = new Set([
  "appointment_service",
  "creative_service",
]);
const WORKSPACE_EVENT_FAMILIES = new Set(["event_service"]);

function uniqList(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}
function titleCaseWords(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase()) || "Unknown";
}
function workspaceTenantRecord() {
  return {
    ...(SETUP_STATE?.tenant || {}),
    ...(SETUP_STATE?.locked_record || {}),
    prooflink_plan_key:
      SETUP_STATE?.tenant?.prooflink_plan_key ||
      SETUP_STATE?.locked_record?.prooflink_plan_key ||
      DASHBOARD_PAYMENT_STATE?.prooflinkPlanKey ||
      "starter",
  };
}
function workspacePlanKey() {
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  const tenant = workspaceTenantRecord();
  const raw = window.ProofLinkPlan?.getPlanKey
    ? window.ProofLinkPlan.getPlanKey(tenant)
    : tenant.prooflink_plan_key;
  if (Architecture?.sanitizeTier) return Architecture.sanitizeTier(raw);
  return String(raw || "starter").trim().toLowerCase() || "starter";
}
function workspaceBusinessType() {
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  const raw = String(
    SETUP_STATE?.tenant?.business_type ||
    SETUP_STATE?.config?.workspace_business_type ||
    SETUP_STATE?.locked_record?.business_type ||
    SETUP_STATE?.config?.business_type ||
    ""
  ).trim().toLowerCase();
  if (Architecture?.sanitizeBusinessType) return Architecture.sanitizeBusinessType(raw);
  return raw || "other";
}
function workspaceProfileChoices() {
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  const profiles = Architecture?.BUSINESS_PROFILES || {};
  const preferredOrder = [
    "service_business",
    "pressure_washing",
    "property_maintenance",
    "contractor",
    "handyman",
    "hvac",
    "plumbing",
    "cleaning",
    "lawn_care",
    "events",
    "photography",
    "pet_services",
    "bakery",
    "other",
  ];
  return uniqList([...preferredOrder, ...Object.keys(profiles)])
    .filter((key) => profiles[key])
    .map((key) => ({ key, label: profiles[key].label || titleCaseWords(key) }));
}
function hydrateWorkspaceProfileOptions(selectedValue = "") {
  if (!setupWorkspaceBusinessType) return;
  const selected = String(selectedValue || "").trim().toLowerCase();
  const options = workspaceProfileChoices();
  setupWorkspaceBusinessType.innerHTML = [
    `<option value="">Use protected business type if set</option>`,
    ...options.map((option) => `<option value="${escapeAttr(option.key)}">${escapeHtml(option.label)}</option>`),
  ].join("");
  const matches = options.some((option) => option.key === selected);
  setupWorkspaceBusinessType.value = matches ? selected : "";
}
function currentWorkspaceBlueprint() {
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  const planKey = workspacePlanKey();
  const businessType = workspaceBusinessType();
  if (Architecture?.resolveWorkspaceBlueprint) {
    WORKSPACE_BLUEPRINT = Architecture.resolveWorkspaceBlueprint(planKey, businessType);
    return WORKSPACE_BLUEPRINT;
  }
  WORKSPACE_BLUEPRINT = {
    tier: { key: planKey, label: titleCaseWords(planKey), promise: "Keep the business organized as it grows." },
    business: {
      key: businessType,
      label: titleCaseWords(businessType),
      family: "general_business",
      workspaceMode: "guided_generalist",
      bidProfile: "general_service",
      operatorNeeds: [],
    },
    enabledFeatures: [],
    deferredFeatures: [],
    priorityViews: ["crm", "orders_jobs", "payments", "reporting"],
    hiddenByDefault: [],
    recommendedModules: ["crm", "orders_jobs", "payments", "reporting"],
    bidProfile: "general_service",
  };
  return WORKSPACE_BLUEPRINT;
}
function workspaceFamily(blueprint = currentWorkspaceBlueprint()) {
  return blueprint?.business?.family || "general_business";
}
function isServiceWorkspace(blueprint = currentWorkspaceBlueprint()) {
  return WORKSPACE_SERVICE_FAMILIES.has(workspaceFamily(blueprint));
}
function isBookingWorkspace(blueprint = currentWorkspaceBlueprint()) {
  return WORKSPACE_BOOKING_FAMILIES.has(workspaceFamily(blueprint));
}
function isEventWorkspace(blueprint = currentWorkspaceBlueprint()) {
  return WORKSPACE_EVENT_FAMILIES.has(workspaceFamily(blueprint));
}
function workspaceUsesServiceCatalog(blueprint = currentWorkspaceBlueprint()) {
  return isServiceWorkspace(blueprint);
}
function workspaceOrderLabel(blueprint = currentWorkspaceBlueprint()) {
  if (isEventWorkspace(blueprint)) return "Events";
  if (isBookingWorkspace(blueprint)) return "Bookings";
  if (isServiceWorkspace(blueprint)) return "Jobs";
  return "Orders";
}
function workspaceOrderLabelLower(blueprint = currentWorkspaceBlueprint()) {
  return workspaceOrderLabel(blueprint).toLowerCase();
}
function workspaceCatalogLabel(blueprint = currentWorkspaceBlueprint()) {
  if (workspaceUsesServiceCatalog(blueprint)) return "Services";
  if (isBookingWorkspace(blueprint) || isEventWorkspace(blueprint)) return "Packages";
  return "Products";
}
function workspaceCatalogLabelLower(blueprint = currentWorkspaceBlueprint()) {
  return workspaceCatalogLabel(blueprint).toLowerCase();
}
function workspaceCatalogSingular(blueprint = currentWorkspaceBlueprint()) {
  if (workspaceUsesServiceCatalog(blueprint)) return "service template";
  if (isBookingWorkspace(blueprint) || isEventWorkspace(blueprint)) return "package or offering";
  return "product";
}
function workspaceBidLabel(blueprint = currentWorkspaceBlueprint()) {
  if (isServiceWorkspace(blueprint)) return "Walkthrough Bids";
  if (isEventWorkspace(blueprint)) return "Proposals";
  return "Bids";
}
function workspaceAnalyticsMode() {
  const rules = window.ProofLinkPlan?.getPlanRules?.(workspaceTenantRecord()) || {};
  return String(rules.analytics || "basic").trim().toLowerCase();
}
function workspaceFeatureEnabled(featureKey, blueprint = currentWorkspaceBlueprint()) {
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  if (Architecture?.isFeatureEnabled) {
    return Architecture.isFeatureEnabled(workspacePlanKey(), workspaceBusinessType(), featureKey);
  }
  return Array.isArray(blueprint?.enabledFeatures) && blueprint.enabledFeatures.includes(featureKey);
}
function workspaceFeatureLabel(featureKey) {
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  return Architecture?.FEATURE_CATALOG?.[featureKey] || titleCaseWords(featureKey);
}
function workspacePriorityTabs(blueprint = currentWorkspaceBlueprint()) {
  return uniqList((blueprint?.priorityViews || []).map((moduleKey) => WORKSPACE_PRIORITY_TAB_MAP[moduleKey]).filter(Boolean));
}
function workspaceTabLabel(tab, blueprint = currentWorkspaceBlueprint()) {
  switch (tab) {
    case "dashboard":
      return "Today";
    case "leads":
      return "Leads";
    case "orders":
      return workspaceOrderLabel(blueprint);
    case "bids":
      return workspaceBidLabel(blueprint);
    case "jobs":
      return "Jobs";
    case "plans":
      return "Recurring Plans";
    case "import":
      return "Switch & Import";
    case "products":
      return workspaceCatalogLabel(blueprint);
    case "pricing":
      return workspaceUsesServiceCatalog(blueprint)
        ? "Pricing / Rates"
        : (isBookingWorkspace(blueprint) || isEventWorkspace(blueprint) ? "Packages / Pricing" : "Pricing");
    case "availability":
      return (isServiceWorkspace(blueprint) || isBookingWorkspace(blueprint) || isEventWorkspace(blueprint))
        ? "Schedule"
        : "Availability";
    case "money":
      return "Insights";
    default:
      return titleCaseWords(tab);
  }
}
function workspacePanelCopy(tab, blueprint = currentWorkspaceBlueprint()) {
  const businessLabel = blueprint?.business?.label || "Business";
  const orderLower = workspaceOrderLabelLower(blueprint);
  const catalogLower = workspaceCatalogLabelLower(blueprint);
  switch (tab) {
    case "dashboard":
      return {
        title: "Today",
        subtitle: `${businessLabel} at a glance, with the next customer, work, and money actions made obvious.`,
      };
    case "leads":
      return {
        title: "Leads",
        subtitle: "Capture inbound work cleanly and move qualified opportunities into pricing without rebuilding the record.",
      };
    case "orders":
      return {
        title: workspaceOrderLabel(blueprint),
        subtitle: isServiceWorkspace(blueprint)
          ? `Review live ${orderLower}, schedule commitments, and the next action for each customer.`
          : `Review live ${orderLower}, intake details, and what needs to happen next.`,
      };
    case "bids":
      return {
        title: workspaceBidLabel(blueprint),
        subtitle: isServiceWorkspace(blueprint)
          ? "Build on-site scope, photos, pricing, and delivery language in one professional record."
          : "Build clear offers, pricing, and customer-ready delivery language in one place.",
      };
    case "jobs":
      return {
        title: "Jobs",
        subtitle: "Track scheduled work, field progress, proof, and payment state without splitting execution from the customer record.",
      };
    case "plans":
      return {
        title: "Recurring Plans",
        subtitle: "Turn repeat service into scheduled orders and jobs without rebuilding the same work from scratch every month.",
      };
    case "import":
      return {
        title: "Switch & Import",
        subtitle: "Move customers, live work, and payment history into ProofLink without rebuilding the office by hand.",
      };
    case "products":
      return {
        title: workspaceCatalogLabel(blueprint),
        subtitle: workspaceUsesServiceCatalog(blueprint)
          ? `Create reusable ${catalogLower}, scope building blocks, and job starters.`
          : `Create and edit ${catalogLower}. Keep what the customer buys easy to understand.`,
      };
    case "pricing":
      return {
        title: workspaceTabLabel("pricing", blueprint),
        subtitle: workspaceUsesServiceCatalog(blueprint)
          ? "Keep pricing practical today and layer in better rate logic as the business matures."
          : "Control how offers are priced without forcing the team into accounting language.",
      };
    case "availability":
      return {
        title: workspaceTabLabel("availability", blueprint),
        subtitle: (isServiceWorkspace(blueprint) || isBookingWorkspace(blueprint) || isEventWorkspace(blueprint))
          ? "Show when the team can actually take on more work and where the schedule is tight."
          : "Track availability and operating windows in one place.",
      };
    case "expenses":
      return {
        title: "Expenses",
        subtitle: isServiceWorkspace(blueprint)
          ? `Track overhead and job costs so ${orderLower} stay profitable.`
          : "Track expenses for bookkeeping, visibility, and margin awareness.",
      };
    case "money":
      return {
        title: workspaceTabLabel("money", blueprint),
        subtitle: "Business signals, customer value, and margin clues without accounting clutter.",
      };
    case "guidance":
      return {
        title: "Guidance",
        subtitle: `Operator advice shaped around how ${businessLabel} actually sells and delivers work.`,
      };
    case "setup":
      return {
        title: "Business Setup",
        subtitle: "Branding, public business profile, and customer-facing details stay editable here.",
      };
    default:
      return {
        title: workspaceTabLabel(tab, blueprint),
        subtitle: "",
      };
  }
}
function isTabVisibleInWorkspace(tab, blueprint = currentWorkspaceBlueprint()) {
  const hidden = new Set(blueprint?.hiddenByDefault || []);
  if (hidden.has(tab)) return false;
  if (tab === "bids") {
    if (hidden.has("bids")) return false;
    const priorityTabs = workspacePriorityTabs(blueprint);
    if (!priorityTabs.includes("bids") && !blueprint?.business?.bidProfile) return false;
  }
  if (tab === "plans") {
    return isServiceWorkspace(blueprint) || isBookingWorkspace(blueprint);
  }
  return true;
}
function isTabLockedInWorkspace(tab, blueprint = currentWorkspaceBlueprint()) {
  if (!isTabVisibleInWorkspace(tab, blueprint)) return false;
  if (tab === "domains") {
    return !window.ProofLinkPlan?.canUse?.("customDomain", workspaceTenantRecord());
  }
  return false;
}
function tabLockBadge(tab, blueprint = currentWorkspaceBlueprint()) {
  if (!isTabLockedInWorkspace(tab, blueprint)) return "";
  if (tab === "domains") return "Growth+";
  return "Locked";
}
function panelNoticeHtml(tab, blueprint = currentWorkspaceBlueprint()) {
  if (tab === "domains" && isTabLockedInWorkspace(tab, blueprint)) {
    return `
      <div class="workspace-panel-notice is-warn">
        <div class="workspace-panel-notice__title">Custom domains unlock on Growth</div>
        <div class="workspace-panel-notice__copy">Starter keeps the ProofLink subdomain live. Use this page for launch guidance now, then move to a branded domain when the business truly needs it.</div>
      </div>
    `;
  }
  if (tab === "products" && workspaceUsesServiceCatalog(blueprint)) {
    return `
      <div class="workspace-panel-notice is-soft">
        <div class="workspace-panel-notice__title">Use this as your service catalog</div>
        <div class="workspace-panel-notice__copy">For service businesses, this is where reusable offerings, scope starters, and repeatable work templates live.</div>
      </div>
    `;
  }
  if (tab === "pricing" && workspaceUsesServiceCatalog(blueprint) && !workspaceFeatureEnabled("rate_sheets", blueprint)) {
    return `
      <div class="workspace-panel-notice is-soft">
        <div class="workspace-panel-notice__title">Basic pricing is active now</div>
        <div class="workspace-panel-notice__copy">Use simple price anchors today. Advanced rate sheets unlock when the business is ready for more structured service pricing.</div>
      </div>
    `;
  }
  if (tab === "plans") {
    return `
      <div class="workspace-panel-notice is-soft">
        <div class="workspace-panel-notice__title">Repeat work should not depend on memory</div>
        <div class="workspace-panel-notice__copy">Create a recurring plan from a real order when a customer is likely to need the same service again. ProofLink will keep the next run visible and generate the work record when it is due.</div>
      </div>
    `;
  }
  if (tab === "money" && workspaceAnalyticsMode() === "basic") {
    return `
      <div class="workspace-panel-notice is-soft">
        <div class="workspace-panel-notice__title">This view stays intentionally simple</div>
        <div class="workspace-panel-notice__copy">You already have the essentials. Deeper reporting, team accountability, and more advanced visibility can layer in later without making the workspace harder to teach.</div>
      </div>
    `;
  }
  return "";
}
function renderPanelNotice(tab, blueprint = currentWorkspaceBlueprint()) {
  const panel = document.querySelector(`.panel[data-panel="${tab}"]`);
  const head = panel?.querySelector(".panel-head");
  if (!panel || !head) return;
  panel.querySelector(".workspace-panel-notice")?.remove();
  const html = panelNoticeHtml(tab, blueprint);
  if (!html) return;
  const anchor = panel.querySelector(".workspace-context-nav") || head;
  anchor.insertAdjacentHTML("afterend", html);
}
function updateWorkspaceTabPresentation(tab, blueprint = currentWorkspaceBlueprint()) {
  const btn = sectionNav?.querySelector(`.tab[data-tab="${tab}"]`);
  if (!btn) return;
  const visible = isTabVisibleInWorkspace(tab, blueprint);
  const locked = isTabLockedInWorkspace(tab, blueprint);
  const priorityTabs = workspacePriorityTabs(blueprint);
  const isPrimary = tab === "dashboard" || priorityTabs.includes(tab);
  btn.hidden = !visible;
  btn.classList.toggle("is-secondary", visible && !isPrimary);
  btn.classList.toggle("is-locked", locked);
  btn.setAttribute("aria-hidden", visible ? "false" : "true");
  const label = workspaceTabLabel(tab, blueprint);
  const badge = tabLockBadge(tab, blueprint);
  btn.innerHTML = `
    <span class="tab__label">${escapeHtml(label)}</span>
    ${badge ? `<span class="tab-badge">${escapeHtml(badge)}</span>` : ""}
  `;
}
function updateWorkspacePanelPresentation(tab, blueprint = currentWorkspaceBlueprint()) {
  const panel = document.querySelector(`.panel[data-panel="${tab}"]`);
  if (!panel) return;
  const titleEl = panel.querySelector(".panel-head h2");
  const subtitleEl = panel.querySelector(".panel-head .muted");
  const copy = workspacePanelCopy(tab, blueprint);
  if (titleEl) titleEl.textContent = copy.title;
  if (subtitleEl && copy.subtitle) subtitleEl.textContent = copy.subtitle;
  renderPanelNotice(tab, blueprint);
}
function workspaceSummaryData(blueprint = currentWorkspaceBlueprint()) {
  const focusTabs = workspacePriorityTabs(blueprint).map((tab) => workspaceTabLabel(tab, blueprint));
  const deferredLabels = uniqList((blueprint?.deferredFeatures || []).map(workspaceFeatureLabel)).slice(0, 4);
  return {
    businessLabel: blueprint?.business?.label || "Business",
    tierLabel: blueprint?.tier?.label || titleCaseWords(workspacePlanKey()),
    workspaceModeLabel: titleCaseWords(blueprint?.business?.workspaceMode || "guided_generalist"),
    promise: blueprint?.tier?.promise || "Keep the operation clear as it grows.",
    focusTabs,
    deferredLabels,
    operatorNeeds: blueprint?.business?.operatorNeeds || [],
    priorityOutcomes: blueprint?.tier?.priorityOutcomes || [],
  };
}
function hasPricedBidDraft() {
  return (BIDS_CACHE || []).some((row) => calculateBidTotals(row).total > 0);
}
function applyWorkspaceBlueprint() {
  const blueprint = currentWorkspaceBlueprint();
  if (!blueprint) return null;

  WORKSPACE_BASE_TAB_ORDER.forEach((tab) => {
    updateWorkspaceTabPresentation(tab, blueprint);
    updateWorkspacePanelPresentation(tab, blueprint);
  });

  if (sectionNav) {
    const orderedTabs = uniqList([
      "dashboard",
      ...workspacePriorityTabs(blueprint).filter((tab) => isTabVisibleInWorkspace(tab, blueprint)),
      ...WORKSPACE_BASE_TAB_ORDER.filter((tab) => isTabVisibleInWorkspace(tab, blueprint)),
    ]);
    orderedTabs.forEach((tab) => {
      const btn = sectionNav.querySelector(`.tab[data-tab="${tab}"]`);
      if (btn) sectionNav.appendChild(btn);
    });
  }

  const topbarSub = document.querySelector(".topbar .sub");
  if (topbarSub) {
    const focus = workspaceSummaryData(blueprint).focusTabs.slice(0, 3).join(", ");
    topbarSub.textContent = `${workspaceSummaryData(blueprint).businessLabel} workspace on ${workspaceSummaryData(blueprint).tierLabel}. ${focus ? `Priority views: ${focus}.` : blueprint.tier.promise}`;
  }

  const sideCopy = document.querySelector(".side-copy");
  if (sideCopy) {
    sideCopy.textContent = blueprint?.business?.operatorNeeds?.[0]
      ? `${blueprint.business.operatorNeeds[0]}. ${blueprint.tier.promise}`
      : "Track the sale from first contact to payment, keep customer history in one place, and make business decisions with less guesswork.";
  }

  renderWorkspaceHub();
  const activeTab = currentPanel();
  if (!isTabVisibleInWorkspace(activeTab, blueprint)) {
    switchTab("dashboard", { force: true });
  }
  return blueprint;
}

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
    { done: CUSTOMERS_CACHE.length > 0, label: "Capture your first customer in CRM", tab: "customers", action: "Open Customers" },
    { done: CRM_ORDERS_CACHE.length > 0, label: `Convert at least one request into tracked ${orderLabel}`, tab: "orders", action: `Open ${workspaceTabLabel("orders", blueprint)}` },
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
      { done: BIDS_CACHE.length > 0, label: "Create your first professional bid draft", tab: "bids", action: `Open ${workspaceBidLabel(blueprint)}` },
      { done: hasPricedBidDraft(), label: "Price at least one real bid scope", tab: "bids", action: "Finish pricing" }
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
}

function setSetupMessage(message = "", tone = "") {
  if (!setupMsg) return;
  setupMsg.className = `msg${tone ? ` ${tone}` : ""}`;
  setupMsg.textContent = message;
}

function setupPreviewHtml(payload = {}, record = null) {
  const logoUrl = String(payload.logo_url || "").trim();
  const heroUrl = String(payload.hero_image_url || "").trim();
  const reviewUrl = cleanUrl(payload.review_link_url || "");
  const reviewPlatform = String(payload.review_platform_label || "").trim() || (reviewUrl ? "Google" : "-");
  const referralMessage = String(payload.referral_message || "").trim();
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
        <div class="tr"><div>Public contact</div><div>${escapeHtml(payload.public_contact_email || payload.contact_email || "-")}</div></div>
        <div class="tr"><div>Public phone</div><div>${escapeHtml(payload.public_business_phone || payload.business_phone || "-")}</div></div>
        <div class="tr"><div>Location</div><div>${escapeHtml(record?.city_state || payload.city_state || "-")}</div></div>
        <div class="tr"><div>Service area</div><div>${escapeHtml(payload.service_area || "-")}</div></div>
        <div class="tr"><div>Review platform</div><div>${escapeHtml(reviewPlatform)}</div></div>
        <div class="tr"><div>Review link</div><div>${reviewUrl ? `<a href="${escapeAttr(reviewUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reviewUrl)}</a>` : "-"}</div></div>
      </div>
      ${referralMessage ? `<div class="detail-card"><div class="kicker">Referral thank-you note</div><div class="detail-copy">${escapeHtml(referralMessage)}</div></div>` : ``}
    </div>
  `;
}

function fillSetupForm(payload = {}, record = null) {
  hydrateWorkspaceProfileOptions(payload.workspace_business_type || record?.business_type || "");
  if (setupTagline) setupTagline.value = payload.tagline || "";
  if (setupHeroHeading) setupHeroHeading.value = payload.hero_heading || "";
  if (setupHeroSubheading) setupHeroSubheading.value = payload.hero_subheading || "";
  if (setupAbout) setupAbout.value = payload.about || "";
  if (setupWorkspaceBusinessType) setupWorkspaceBusinessType.value = String(payload.workspace_business_type || record?.business_type || "").trim().toLowerCase();
  if (setupAccentColor) setupAccentColor.value = payload.accent_color || window.COTTAGELINK_BRAND?.accent || "#c84b2f";
  if (setupLogoUrl) setupLogoUrl.value = payload.logo_url || "";
  if (setupHeroImageUrl) setupHeroImageUrl.value = payload.hero_image_url || "";
  if (setupPublicContactEmail) setupPublicContactEmail.value = payload.public_contact_email || payload.contact_email || "";
  if (setupPublicBusinessPhone) setupPublicBusinessPhone.value = payload.public_business_phone || payload.business_phone || "";
  if (setupServiceArea) setupServiceArea.value = payload.service_area || "";
  if (setupReviewPlatformLabel) setupReviewPlatformLabel.value = payload.review_platform_label || "";
  if (setupReviewLinkUrl) setupReviewLinkUrl.value = payload.review_link_url || "";
  if (setupReferralMessage) setupReferralMessage.value = payload.referral_message || "";
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
    workspace_business_type: setupWorkspaceBusinessType?.value?.trim() || "",
    accent_color: setupAccentColor?.value?.trim() || "",
    logo_url: setupLogoUrl?.value?.trim() || "",
    hero_image_url: setupHeroImageUrl?.value?.trim() || "",
    public_contact_email: setupPublicContactEmail?.value?.trim() || "",
    public_business_phone: setupPublicBusinessPhone?.value?.trim() || "",
    service_area: setupServiceArea?.value?.trim() || "",
    review_platform_label: setupReviewPlatformLabel?.value?.trim() || "",
    review_link_url: setupReviewLinkUrl?.value?.trim() || "",
    referral_message: setupReferralMessage?.value?.trim() || "",
    instagram: setupInstagram?.value?.trim().replace(/^@/, "") || "",
    facebook: setupFacebook?.value?.trim() || "",
    hours_notes: setupHoursNotes?.value?.trim() || "",
    fulfillment_notes: setupFulfillmentNotes?.value?.trim() || "",
    show_prices: !!setupShowPrices?.checked,
    allow_custom_requests: !!setupAllowCustomRequests?.checked,
    ...extra,
  };
}

function renderLockedBusinessRecord(record = {}) {
  if (!setupLockedRecord) return;
  const blueprint = currentWorkspaceBlueprint();
  const rows = [
    ["Legal business name", record.legal_business_name || "-"],
    ["Owner name", record.owner_name || "-"],
    ["Login email", record.login_email || "-"],
    ["Business type", blueprint?.business?.label || record.business_type || "-"],
    ["ProofLink plan", blueprint?.tier?.label || titleCaseWords(record.prooflink_plan_key || workspacePlanKey())],
    ["City / State", record.city_state || "-"],
    ["License number", record.license_number || "-"],
    ["Tenant slug", record.slug || "-"],
    ["Tenant status", record.active ? "Active" : "Inactive"],
  ];
  setupLockedRecord.innerHTML = rows.map(([label, value]) => `
    <div class="tr"><div>${escapeHtml(label)}</div><div>${escapeHtml(String(value || "-"))}</div></div>
  `).join("");
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
  applyWorkspaceBlueprint();
  scheduleWorkspaceSnapshot("setup", 260);
  return data;
}

async function saveOperatorSetup(extra = {}) {
  const payload = collectSetupPayload(extra);
  setSetupMessage('Saving setup...');
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
  applyWorkspaceBlueprint();
  initBranding();
  markWorkspaceClean("setup");
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

function workspacePanels() {
  return Array.from(viewApp?.querySelectorAll(".panel") || []);
}
function workspacePanel(tab) {
  return viewApp?.querySelector(`.panel[data-panel="${tab}"]`) || null;
}
function serializeWorkspaceField(field) {
  const type = String(field?.type || "").trim().toLowerCase();
  if (type === "checkbox") return field.checked ? "1" : "0";
  if (type === "radio") return field.checked ? String(field.value || "") : "";
  if (type === "file") return Array.from(field.files || []).map((file) => `${file.name}:${file.size}`).join("|");
  if (field?.multiple && "selectedOptions" in field) {
    return Array.from(field.selectedOptions || []).map((option) => option.value).join("|");
  }
  return String(field?.value ?? "");
}
function serializeWorkspaceForm(form) {
  const entries = [];
  Array.from(form?.elements || []).forEach((field) => {
    if (!field || field.disabled) return;
    const key = String(field.name || field.id || "").trim();
    if (!key) return;
    const type = String(field.type || "").trim().toLowerCase();
    if (type === "radio" && !field.checked) return;
    entries.push([key, serializeWorkspaceField(field)]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}
function serializeWorkspacePanel(tab) {
  const panel = workspacePanel(tab);
  if (!panel) return "";
  return Array.from(panel.querySelectorAll("form"))
    .map((form) => `${form.id || "form"}:${serializeWorkspaceForm(form)}`)
    .join("||");
}
function setWorkspaceDirty(tab, dirty) {
  if (!tab) return;
  if (dirty) {
    WORKSPACE_DIRTY_TABS.add(tab);
  } else {
    WORKSPACE_DIRTY_TABS.delete(tab);
  }
  const panel = workspacePanel(tab);
  if (panel) panel.dataset.dirty = dirty ? "true" : "false";
  renderWorkspaceHub();
  updateWorkspaceWindowControls(tab);
}
function markWorkspaceClean(tab) {
  if (!tab) return;
  WORKSPACE_SNAPSHOT_BY_TAB.set(tab, serializeWorkspacePanel(tab));
  setWorkspaceDirty(tab, false);
}
function scheduleWorkspaceSnapshot(tab, delay = 120) {
  if (!tab) return;
  const existing = WORKSPACE_SNAPSHOT_TIMERS.get(tab);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    WORKSPACE_SNAPSHOT_TIMERS.delete(tab);
    markWorkspaceClean(tab);
  }, delay);
  WORKSPACE_SNAPSHOT_TIMERS.set(tab, timer);
}
function updateWorkspaceDirtyState(tab) {
  if (!tab) return;
  const snapshot = WORKSPACE_SNAPSHOT_BY_TAB.get(tab);
  const current = serializeWorkspacePanel(tab);
  if (snapshot == null) {
    WORKSPACE_SNAPSHOT_BY_TAB.set(tab, current);
    setWorkspaceDirty(tab, false);
    return;
  }
  setWorkspaceDirty(tab, current !== snapshot);
}
function workspaceExitMessage(tab) {
  return `You have unsaved changes in ${workspaceTabLabel(tab, currentWorkspaceBlueprint())}. If you leave this window now, those edits will be lost.`;
}
function confirmWorkspaceChange(currentTab, nextTab) {
  if (!currentTab || currentTab === nextTab) return true;
  if (!WORKSPACE_DIRTY_TABS.has(currentTab)) return true;
  return window.confirm(workspaceExitMessage(currentTab));
}
function updateWorkspaceWindowControls(tab) {
  const panel = workspacePanel(tab);
  if (!panel) return;
  const collapseBtn = panel.querySelector('[data-workspace-action="collapse"]');
  const closeBtn = panel.querySelector('[data-workspace-action="close"]');
  if (collapseBtn) {
    collapseBtn.textContent = panel.classList.contains("is-collapsed") ? "Expand" : "Collapse";
  }
  if (closeBtn) {
    closeBtn.hidden = tab === "dashboard";
  }
}
function setWorkspaceCollapsed(tab, collapsed) {
  const panel = workspacePanel(tab);
  if (!panel) return;
  panel.classList.toggle("is-collapsed", !!collapsed);
  updateWorkspaceWindowControls(tab);
  renderWorkspaceHub();
}
function workspaceContextTabsFor(tab, blueprint = currentWorkspaceBlueprint()) {
  const group = WORKSPACE_CONTEXT_GROUPS[tab] || [tab];
  return uniqList(group.filter((candidate) => isTabVisibleInWorkspace(candidate, blueprint)));
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
function bindWorkspaceDirtyTracking() {
  if (!viewApp || viewApp.dataset.workspaceDirtyBound === "1") return;
  viewApp.dataset.workspaceDirtyBound = "1";
  viewApp.querySelectorAll(".panel form").forEach((form) => {
    const tab = form.closest(".panel")?.dataset.panel || "";
    if (!tab) return;
    const handleChange = () => window.requestAnimationFrame(() => updateWorkspaceDirtyState(tab));
    form.addEventListener("input", handleChange);
    form.addEventListener("change", handleChange);
  });
  window.addEventListener("beforeunload", (event) => {
    const active = document.querySelector(".tab.active")?.dataset.tab || panelFromLocation();
    if (!WORKSPACE_DIRTY_TABS.has(active)) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
function renderWorkspaceHub() {
  ensureWorkspaceWindowShell();
  renderWorkspaceContextTabs();
}

function normalizePanel(panel) {
  const value = String(panel || '').trim().toLowerCase();
  return document.querySelector(`.tab[data-tab="${value}"]:not([hidden])`) ? value : 'dashboard';
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
  const activeTab = document.querySelector(".tab.active")?.dataset.tab || "dashboard";
  ensureWorkspaceWindowShell();
  bindWorkspaceDirtyTracking();
  if (!opts.force && !confirmWorkspaceChange(activeTab, nextTab)) {
    if (opts.updateHash !== false) syncPanelHash(activeTab);
    return false;
  }
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === nextTab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== nextTab));
  setWorkspaceCollapsed(nextTab, false);

  if (nextTab === "money") renderMoney().catch(console.error);
  if (nextTab === "dashboard") renderDashboard();
  if (nextTab === "leads") renderLeads(leadSearch?.value || "");
  if (nextTab === "orders") renderOrders();
  if (nextTab === "bids") renderBids(bidSearch?.value || "");
  if (nextTab === "jobs") renderJobs(jobSearch?.value || "");
  if (nextTab === "plans") renderPlans(planSearch?.value || "");
  if (nextTab === "customers") renderCustomersList(customerSearch?.value || "");
  if (nextTab === "import") window.PROOFLINK_IMPORT_WORKSPACE?.render?.();
  if (nextTab === "payments") renderPayments();
  if (nextTab === "domains") window.renderDomains?.();
  if (nextTab === "setup") fetchOperatorSetup().catch((err) => setSetupMessage(err.message || String(err), "bad"));
  if (nextTab === "guidance") renderGuidance();
  if (nextTab === "bookings") renderBookings().catch(console.error);
  if (opts.updateHash !== false) syncPanelHash(nextTab);
  renderWorkspaceHub();
  scheduleWorkspaceSnapshot(nextTab);
  return true;
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
  // Bare access_token without explicit type -> treat as magic link (first-time setup)
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
  if (passwordSetupMsg) { passwordSetupMsg.textContent = "Setting password..."; passwordSetupMsg.className = "msg"; }

  const { error } = await sb.auth.updateUser({ password: pw });

  if (error) {
    if (passwordSetupMsg) { passwordSetupMsg.textContent = error.message || "Could not set password."; passwordSetupMsg.className = "msg error"; }
    if (btnSetPassword) btnSetPassword.disabled = false;
    return;
  }

  const isReset = passwordSetupMode === "reset";
  passwordSetupMode = null;

  if (passwordSetupMsg) { passwordSetupMsg.textContent = isReset ? "Password updated. Loading your dashboard..." : "Password set. Loading your dashboard..."; passwordSetupMsg.className = "msg ok"; }

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
  if (loginMsg) loginMsg.textContent = "Signing in...";
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
    if (loginMsg) loginMsg.textContent = "Sending sign-in link...";
    await sendMagicLink(email);
    if (loginMsg) loginMsg.textContent = "Check your inbox for the newest sign-in link.";
  } catch (err) {
    if (loginMsg) loginMsg.textContent = err?.message || String(err);
  }
});

// -- Forgot password flow --------------------------------------------------
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
  if (forgotMsg) { forgotMsg.textContent = "Sending reset link..."; forgotMsg.className = "msg"; }

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
  stopRealtime();
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
    // Tenant in database doesn't match static config - update the module-level
    // TENANT_ID to the real value from the database so all queries use the correct
    // tenant. This allows the operator dashboard to work for any provisioned tenant,
    // not just the demo tenant hardcoded in cottagelink.tenant.js.
    console.log(`[ProofLink] Tenant scope updated: ${TENANT_ID} -> ${operatorTenantId}`);
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
        <div class="li-sub muted">${escapeHtml(p.category || "-")}  |  ${escapeHtml(p.slug)}</div>
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
  if (productMsg) productMsg.textContent = "Saving...";

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
      markWorkspaceClean("products");
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
    if (productImageStatus) productImageStatus.textContent = "Uploading...";
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
        <div class="li-sub muted">${escapeHtml(r.product_category || "")}  |  ${escapeHtml(r.unit_label || "each")}</div>
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
    setSetupMessage('Refreshing setup...');
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
    if (setupLogoStatus) setupLogoStatus.textContent = 'Uploading...';
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
    if (setupHeroStatus) setupHeroStatus.textContent = 'Uploading...';
    if (setupHeroImageUrl) setupHeroImageUrl.value = await uploadSetupAsset(file, 'hero');
    if (setupHeroStatus) setupHeroStatus.textContent = 'Uploaded. Save setup to keep it.';
    fillSetupForm(collectSetupPayload(), SETUP_STATE?.locked_record || null);
  } catch (err) {
    if (setupHeroStatus) setupHeroStatus.textContent = err.message || String(err);
  }
});
[setupTagline, setupHeroHeading, setupHeroSubheading, setupAbout, setupLogoUrl, setupHeroImageUrl, setupPublicContactEmail, setupPublicBusinessPhone, setupServiceArea, setupReviewPlatformLabel, setupReviewLinkUrl, setupReferralMessage, setupInstagram, setupFacebook, setupHoursNotes, setupFulfillmentNotes, setupAccentColor].forEach((el) => {
  el?.addEventListener('input', () => { if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null); });
});
[setupShowPrices, setupAllowCustomRequests, setupWorkspaceBusinessType].forEach((el) => {
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
function renderExpenseCustomerOptions(selectedCustomerId = "") {
  if (!expenseCustomerId) return;
  const options = [`<option value="">No customer link</option>`];
  sortedCustomers(CUSTOMERS_CACHE).forEach((customer) => {
    options.push(`<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || "Customer")}</option>`);
  });
  expenseCustomerId.innerHTML = options.join("");
  expenseCustomerId.value = selectedCustomerId || "";
}
function renderExpenseOrderOptions(selectedOrderId = "") {
  if (!expenseOrderId) return;
  const options = [`<option value="">No order link</option>`];
  [...CRM_ORDERS_CACHE]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
    .forEach((order) => {
      const label = order.customer_name || order.cart_summary || "Tracked order";
      options.push(`<option value="${escapeAttr(order.id)}">${escapeHtml(label)} - ${escapeHtml(formatUsd(orderTotalCents(order)))}</option>`);
    });
  expenseOrderId.innerHTML = options.join("");
  expenseOrderId.value = selectedOrderId || "";
}
function renderExpenseJobOptions(selectedJobId = "") {
  if (!expenseJobId) return;
  const options = [`<option value="">No job link</option>`];
  [...JOBS_CACHE]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
    .forEach((job) => {
      const customerName = customerById(job.customer_id)?.name || linkedOrderForJob(job)?.customer_name || "Job";
      options.push(`<option value="${escapeAttr(job.id)}">${escapeHtml(job.title || customerName)} - ${escapeHtml(String(job.status || "scheduled").replace(/_/g, " "))}</option>`);
    });
  expenseJobId.innerHTML = options.join("");
  expenseJobId.value = selectedJobId || "";
}
function clearExpenseForm(defaults = {}) {
  expenseId.value = "";
  expenseDate.value = defaults.date || "";
  expenseCategory.value = "";
  expenseVendor.value = "";
  if (expenseType) expenseType.value = normalizeExpenseType(defaults.expense_type || "overhead");
  expenseDescription.value = "";
  if (expenseNotes) expenseNotes.value = "";
  expenseAmount.value = "";
  renderExpenseCustomerOptions(defaults.customer_id || "");
  renderExpenseOrderOptions(defaults.order_id || "");
  renderExpenseJobOptions(defaults.job_id || "");
  if (expenseBillable) expenseBillable.checked = !!defaults.billable;
  if (expenseReimbursable) expenseReimbursable.checked = !!defaults.reimbursable;
  if (expenseChangeOrder) expenseChangeOrder.checked = !!defaults.change_order;
  if (expenseLaborRole) expenseLaborRole.value = "";
  if (expenseLaborHours) expenseLaborHours.value = "";
  if (expenseLaborRate) expenseLaborRate.value = "";
  if (expenseMaterialName) expenseMaterialName.value = "";
  if (expenseMaterialQuantity) expenseMaterialQuantity.value = "";
  if (expenseChangeOrderLabel) expenseChangeOrderLabel.value = "";
  if (expenseChangeOrderNote) expenseChangeOrderNote.value = "";
  if (expenseLeftoverNote) expenseLeftoverNote.value = "";
  if (expenseWasteNote) expenseWasteNote.value = "";
  updateExpenseTypeVisibility();
  if (expenseMsg) expenseMsg.textContent = "";
  if (expenseFormTitle) expenseFormTitle.textContent = defaults.job_id || defaults.order_id ? "Log job cost" : "New expense";
}
function loadExpenseIntoForm(r) {
  const labor = expenseLaborItem(r);
  const material = expenseMaterialItems(r)[0] || null;
  const changeOrder = expenseChangeOrderItem(r);
  expenseId.value = r.id;
  expenseDate.value = r.date || r.expense_date || "";
  expenseCategory.value = r.category || "";
  expenseVendor.value = r.vendor || "";
  if (expenseType) expenseType.value = normalizeExpenseType(r.expense_type || "overhead");
  expenseDescription.value = r.description || r.notes || "";
  if (expenseNotes) expenseNotes.value = r.notes || "";
  expenseAmount.value = money(r.amount_cents);
  renderExpenseCustomerOptions(r.customer_id || "");
  renderExpenseOrderOptions(r.order_id || "");
  renderExpenseJobOptions(r.job_id || "");
  if (expenseBillable) expenseBillable.checked = !!r.billable;
  if (expenseReimbursable) expenseReimbursable.checked = !!r.reimbursable;
  if (expenseChangeOrder) expenseChangeOrder.checked = !!changeOrder;
  if (expenseLaborRole) expenseLaborRole.value = labor?.role || "";
  if (expenseLaborHours) expenseLaborHours.value = labor?.hours || "";
  if (expenseLaborRate) expenseLaborRate.value = labor?.rate_cents ? money(labor.rate_cents) : "";
  if (expenseMaterialName) expenseMaterialName.value = material?.name || "";
  if (expenseMaterialQuantity) expenseMaterialQuantity.value = material?.quantity || "";
  if (expenseChangeOrderLabel) expenseChangeOrderLabel.value = changeOrder?.label || "";
  if (expenseChangeOrderNote) expenseChangeOrderNote.value = changeOrder?.note || "";
  if (expenseLeftoverNote) expenseLeftoverNote.value = material?.leftover_note || "";
  if (expenseWasteNote) expenseWasteNote.value = material?.waste_note || "";
  updateExpenseTypeVisibility();
  if (expenseMsg) expenseMsg.textContent = "";
  if (expenseFormTitle) expenseFormTitle.textContent = "Edit expense";
}
function openExpenseForJob(job) {
  const order = linkedOrderForJob(job);
  const defaults = {
    date: todayDateValue(0),
    expense_type: "job_cost",
    customer_id: job?.customer_id || order?.customer_id || "",
    order_id: order?.id || job?.order_id || "",
    job_id: job?.id || "",
  };
  clearExpenseForm(defaults);
  switchTab("expenses");
}
function renderExpenses(rows) {
  if (!expensesList) return;
  expensesList.innerHTML = "";
  if (!rows.length) {
    expensesList.innerHTML = `<div class="muted">No expenses yet.</div>`;
    return;
  }

  rows.forEach((r) => {
    const linkedJob = JOBS_CACHE.find((job) => job.id === r.job_id) || null;
    const linkedOrder = CRM_ORDERS_CACHE.find((order) => order.id === r.order_id) || null;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "list-item";
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(r.category || "Expense")} - $${money(r.amount_cents)}</div>
        <div class="li-sub muted">${escapeHtml(r.date || r.expense_date || "")}  |  ${escapeHtml(r.vendor || "")}</div>
        <div class="li-sub muted">${escapeHtml(costItemSummary(r))}${linkedJob ? ` | ${escapeHtml(linkedJob.title || "Job cost")}` : (linkedOrder ? ` | ${escapeHtml(linkedOrder.customer_name || linkedOrder.cart_summary || "Order cost")}` : "")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${expenseIsChangeOrder(r) ? "pill-warn" : ""}">${escapeHtml(r.description || r.notes || "")}</span>
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
  if (expenseMsg) expenseMsg.textContent = "Saving...";

  const id = expenseId.value || null;
  const selectedJob = JOBS_CACHE.find((row) => row.id === expenseJobId?.value) || null;
  const selectedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (expenseOrderId?.value || selectedJob?.order_id || "")) || null;
  const selectedCustomerId = expenseCustomerId?.value || selectedJob?.customer_id || selectedOrder?.customer_id || "";
  const payload = withTenantScope({
    operator_id: opId(),
    date: expenseDate.value,
    expense_date: expenseDate.value,
    category: preferExisting(expenseCategory.value, PICK_EXPENSE_CATEGORIES),
    vendor: preferExisting(expenseVendor.value, PICK_VENDORS),
    expense_type: normalizeExpenseType(expenseType?.value || "overhead"),
    customer_id: selectedCustomerId || null,
    order_id: selectedOrder?.id || null,
    job_id: selectedJob?.id || null,
    billable: !!expenseBillable?.checked,
    reimbursable: !!expenseReimbursable?.checked,
    used_materials: buildExpenseSupplementalItems(),
    description: expenseDescription.value.trim(),
    notes: expenseNotes?.value?.trim() || expenseDescription.value.trim(),
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
      markWorkspaceClean("expenses");
      renderExpenses(await fetchExpenses());
    await refreshPicklists();
    renderStartupChecklist();
    renderJobs(jobSearch?.value || "");
    renderMoney().catch(console.error);
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
    renderJobs(jobSearch?.value || "");
    renderMoney().catch(console.error);
  } catch (err) {
    if (expenseMsg) expenseMsg.textContent = err.message || String(err);
  }
});
expenseOrderId?.addEventListener("change", () => {
  const order = CRM_ORDERS_CACHE.find((row) => row.id === expenseOrderId.value) || null;
  if (!order) return;
  renderExpenseCustomerOptions(order.customer_id || "");
});
expenseJobId?.addEventListener("change", () => {
  const job = JOBS_CACHE.find((row) => row.id === expenseJobId.value) || null;
  const order = linkedOrderForJob(job);
  if (!job) return;
  renderExpenseOrderOptions(order?.id || job.order_id || "");
  renderExpenseCustomerOptions(job.customer_id || order?.customer_id || "");
});
expenseType?.addEventListener("change", () => {
  updateExpenseTypeVisibility();
  syncExpenseLaborAmount();
});
expenseChangeOrder?.addEventListener("change", updateExpenseTypeVisibility);
[expenseLaborHours, expenseLaborRate].forEach((el) => {
  el?.addEventListener("input", syncExpenseLaborAmount);
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
    return `${group.length === 1 ? first : `${first}-${last}`} ${formatTime12(group[0].start)} to ${formatTime12(group[0].end)}`;
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
            <button id="btnSetWeekdaysStandard" class="btn btn-ghost" type="button">Set weekdays 8-5</button>
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
                  <div style="font-size:12px;margin-top:6px;">${cell.open && cell.start && cell.end ? `${escapeHtml(formatTime12(cell.start))}-${escapeHtml(formatTime12(cell.end))}` : "-"}</div>
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
                        ${escapeHtml(row.pickupWindow || row.occasion || "Scheduled request")}  |  ${formatUsd(row.estimatedTotalCents || 0)}
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
                  ${prepOutlook.topItems.map(([name, qty]) => `<span class="pill pill-on">${escapeHtml(name)} x ${escapeHtml(String(qty))}</span>`).join("")}
                </div>
              ` : `<div class="muted">No item-level counts available yet.</div>`}
            </div>

            <div style="margin-bottom:12px;">
              <div class="muted" style="margin-bottom:6px;">Ingredient watchlist</div>
              ${prepOutlook.topIngredients.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${prepOutlook.topIngredients.map(([name, qty]) => `<span class="pill">${escapeHtml(name)} x ${escapeHtml(String(qty))}</span>`).join("")}
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
    if (availabilityMsg) availabilityMsg.textContent = "Saving...";
    const payload = collectAvailabilityFromForm();
    const { error } = await sb.from("availability").upsert(payload, { onConflict: `${TENANT_COLUMN},${OPERATOR_COLUMN}` });
      if (error) throw error;
      AVAILABILITY = normalizeAvailability(payload);
      renderAvailability();
      markWorkspaceClean("availability");
      if (availabilityMsg) availabilityMsg.textContent = "Availability saved.";
  } catch (err) {
    if (availabilityMsg) availabilityMsg.textContent = err.message || String(err);
  }
});

// ── Bookings ─────────────────────────────────────────────────────────────────

async function fetchBookings() {
  const tok = await getAccessToken();
  const year  = BK_VIEW_DATE.getFullYear();
  const month = BK_VIEW_DATE.getMonth();
  const start = new Date(year, month, 1).toISOString().slice(0, 10);
  const end   = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  const res = await fetch(`/.netlify/functions/get-bookings?start=${start}&end=${end}`, {
    headers: { "Authorization": `Bearer ${tok}` },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Failed to fetch bookings");
  BOOKINGS_CACHE = d.bookings || [];
  return BOOKINGS_CACHE;
}

function renderBookingsCalendar(bookings) {
  const cal   = $("bookingsCalendar");
  const label = $("bkMonthLabel");
  if (!cal) return;

  const year  = BK_VIEW_DATE.getFullYear();
  const month = BK_VIEW_DATE.getMonth();
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  if (label) label.textContent = `${monthNames[month]} ${year}`;

  const firstDay  = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMo  = new Date(year, month + 1, 0).getDate();
  const today     = new Date().toISOString().slice(0, 10);

  // Group bookings by date
  const byDate = {};
  (bookings || []).forEach((bk) => {
    const d = bk.starts_at ? bk.starts_at.slice(0, 10) : null;
    if (!d) return;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(bk);
  });

  let html = `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:.8rem;">
    <thead><tr>`;
  ["Su","Mo","Tu","We","Th","Fr","Sa"].forEach((d) => {
    html += `<th style="padding:4px 2px;text-align:center;color:rgba(255,255,255,.4);font-weight:500;">${d}</th>`;
  });
  html += `</tr></thead><tbody><tr>`;

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) html += `<td></td>`;

  for (let day = 1; day <= daysInMo; day++) {
    if ((firstDay + day - 1) % 7 === 0 && day > 1) html += `</tr><tr>`;
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = dateStr === today;
    const dayBks  = byDate[dateStr] || [];
    const dotHtml = dayBks.length
      ? `<span style="display:block;width:6px;height:6px;background:#c84b2f;border-radius:50%;margin:1px auto 0;"></span>`
      : '';
    html += `<td style="padding:4px 2px;text-align:center;vertical-align:top;cursor:pointer;" class="bk-cal-day" data-date="${dateStr}">
      <span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;${isToday ? 'background:#c84b2f;color:#fff;font-weight:700;' : ''}">${day}</span>
      ${dotHtml}
    </td>`;
  }

  html += `</tr></tbody></table>`;
  cal.innerHTML = html;

  // Click day → filter list to that day
  cal.querySelectorAll(".bk-cal-day").forEach((cell) => {
    cell.addEventListener("click", () => {
      const date = cell.dataset.date;
      renderBookingsList(bookings.filter((bk) => bk.starts_at?.slice(0,10) === date));
      const lbl = $("bkListLabel");
      if (lbl) lbl.textContent = `Appointments on ${date}`;
    });
  });
}

function renderBookingsList(bookings) {
  const list = $("bookingsList");
  if (!list) return;
  if (!bookings || !bookings.length) {
    list.innerHTML = `<p class="muted" style="padding:12px 0;">No appointments found.</p>`;
    return;
  }
  list.innerHTML = bookings.map((bk) => {
    const start = bk.starts_at ? new Date(bk.starts_at) : null;
    const end   = bk.ends_at   ? new Date(bk.ends_at)   : null;
    const dateStr = start ? start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : "—";
    const timeStr = start
      ? start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
        (end ? ` – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '')
      : "—";
    const statusColor = bk.status === 'cancelled' ? '#f87171' : bk.status === 'completed' ? '#4ade80' : '#93c5fd';
    return `<div class="list-row" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:.9rem;">${bk.title || "Appointment"}</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.5);">${bk.customer_name || "—"} · ${dateStr} · ${timeStr}</div>
      </div>
      <span style="font-size:.75rem;padding:3px 8px;background:rgba(255,255,255,.06);border-radius:12px;color:${statusColor};white-space:nowrap;">${bk.status || "confirmed"}</span>
      <button class="btn btn-ghost btn-sm bk-cancel-btn" data-id="${bk.id}" type="button" ${bk.status === 'cancelled' ? 'disabled' : ''} style="white-space:nowrap;">Cancel</button>
    </div>`;
  }).join('');

  list.querySelectorAll(".bk-cancel-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Cancel this booking?")) return;
      btn.disabled = true;
      try {
        const tok = await getAccessToken();
        const res = await fetch("/.netlify/functions/update-booking", {
          method : "PATCH",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
          body   : JSON.stringify({ id: btn.dataset.id, status: "cancelled" }),
        });
        if (!res.ok) throw new Error("Failed to cancel");
        await fetchBookings();
        renderBookingsCalendar(BOOKINGS_CACHE);
        renderBookingsList(BOOKINGS_CACHE);
        const lbl = $("bkListLabel");
        if (lbl) lbl.textContent = "Upcoming appointments";
      } catch (err) {
        alert(err.message || "Error cancelling booking");
        btn.disabled = false;
      }
    });
  });
}

async function renderBookings() {
  try {
    await fetchBookings();
  } catch (err) {
    console.error("[renderBookings]", err);
  }
  renderBookingsCalendar(BOOKINGS_CACHE);
  // Show upcoming (next 30 days)
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = BOOKINGS_CACHE.filter((bk) =>
    bk.starts_at && bk.starts_at.slice(0,10) >= todayStr && bk.status !== 'cancelled'
  );
  renderBookingsList(upcoming.length ? upcoming : BOOKINGS_CACHE);
  // Booking link
  const linkEl = $("bookingLinkDisplay");
  if (linkEl && TENANT_ID) {
    linkEl.textContent = `${location.origin}/book.html?tenant=${TENANT_ID}`;
  }
}

// Bookings event handlers
$("btnNewBooking")?.addEventListener("click", () => {
  const form = $("newBookingForm");
  if (form) {
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const bkDate = $("bkDate");
      if (bkDate && !bkDate.value) bkDate.value = tomorrow.toISOString().slice(0, 10);
    }
  }
});

$("btnCancelBooking")?.addEventListener("click", () => {
  const form = $("newBookingForm");
  if (form) form.classList.add("hidden");
});

$("btnCopyBookingLink")?.addEventListener("click", () => {
  const link = $("bookingLinkDisplay")?.textContent?.trim();
  if (!link || link === "—") return;
  navigator.clipboard.writeText(link).then(() => {
    const btn = $("btnCopyBookingLink");
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy link"; }, 2000); }
  });
});

$("btnRefreshBookings")?.addEventListener("click", () => renderBookings());

$("btnBkPrev")?.addEventListener("click", async () => {
  BK_VIEW_DATE = new Date(BK_VIEW_DATE.getFullYear(), BK_VIEW_DATE.getMonth() - 1, 1);
  await renderBookings();
});
$("btnBkNext")?.addEventListener("click", async () => {
  BK_VIEW_DATE = new Date(BK_VIEW_DATE.getFullYear(), BK_VIEW_DATE.getMonth() + 1, 1);
  await renderBookings();
});

$("btnSaveBooking")?.addEventListener("click", async () => {
  const btn  = $("btnSaveBooking");
  const msg  = $("newBookingMsg");
  const name  = $("bkCustomerName")?.value.trim();
  const email = $("bkCustomerEmail")?.value.trim();
  const title = $("bkTitle")?.value.trim();
  const date  = $("bkDate")?.value;
  const time  = $("bkStart")?.value;
  const dur   = parseInt($("bkDuration")?.value || "60", 10);
  const notes = $("bkNotes")?.value.trim();

  if (msg) { msg.textContent = ""; msg.className = "msg"; }
  if (!name || !title || !date || !time) {
    if (msg) { msg.textContent = "Please fill in all required fields."; msg.className = "msg error"; }
    return;
  }

  const startsAt = new Date(`${date}T${time}:00`).toISOString();
  const endsAt   = new Date(new Date(startsAt).getTime() + dur * 60000).toISOString();

  btn.disabled = true;
  if (msg) { msg.textContent = "Saving…"; msg.className = "msg"; }
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/create-booking", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body   : JSON.stringify({ customer_name: name, customer_email: email || undefined, title, starts_at: startsAt, ends_at: endsAt, notes: notes || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to save booking");
    if (msg) { msg.textContent = "✓ Booking saved!"; msg.className = "msg success"; }
    // Reset form
    ["bkCustomerName","bkCustomerEmail","bkTitle","bkNotes"].forEach((id) => { const el = $( id); if (el) el.value = ""; });
    btn.disabled = false;
    await renderBookings();
    setTimeout(() => { const form = $("newBookingForm"); if (form) form.classList.add("hidden"); }, 1200);
  } catch (err) {
    if (msg) { msg.textContent = err.message || "Error saving."; msg.className = "msg error"; }
    btn.disabled = false;
  }
});

// ── End Bookings ─────────────────────────────────────────────────────────────

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
async function logCustomerInteraction(customerId, type, summary, metadata = {}) {
  if (!customerId) throw new Error("Customer id is required.");
  const nowIso = new Date().toISOString();
  const { error } = await sb.from("customer_interactions").insert(withTenantScope({
    operator_id: opId(),
    customer_id: customerId,
    type,
    summary,
    metadata,
    created_at: nowIso,
  }));
  if (error) throw error;

  const { error: customerError } = await sb.from("customers")
    .update({ last_contact_at: nowIso, updated_at: nowIso })
    .eq("id", customerId)
    .eq(OPERATOR_COLUMN, opId())
    .eq(TENANT_COLUMN, TENANT_ID);
  if (customerError) throw customerError;
  return nowIso;
}
async function fetchLeads() {
  const { data, error } = await scopeQuery(sb
    .from("leads")
    .select("*"))
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) {
    if (isMissingDatabaseFeatureError(error, ["leads"])) {
      LEADS_CACHE = [];
      return LEADS_CACHE;
    }
    throw error;
  }
  LEADS_CACHE = data || [];
  return LEADS_CACHE;
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
async function fetchPersistedBids() {
  const { data, error } = await scopeQuery(sb
    .from("bids")
    .select("*"))
    .order("updated_at", { ascending: false })
    .limit(250);

  if (error) {
    if (isMissingDatabaseFeatureError(error, ["bids"])) return [];
    throw error;
  }
  return data || [];
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
async function fetchJobs() {
  const { data, error } = await scopeQuery(sb
    .from("jobs")
    .select("*"))
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) {
    if (isMissingDatabaseFeatureError(error, ["jobs"])) {
      JOBS_CACHE = [];
      return JOBS_CACHE;
    }
    throw error;
  }
  JOBS_CACHE = data || [];
  return JOBS_CACHE;
}
async function fetchServicePlans() {
  const { data, error } = await scopeQuery(sb
    .from("service_plans")
    .select("*"))
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) {
    if (isMissingDatabaseFeatureError(error, ["service_plans"])) {
      SERVICE_PLANS_CACHE = [];
      SERVICE_PLANS_FEATURE_READY = false;
      return SERVICE_PLANS_CACHE;
    }
    throw error;
  }
  SERVICE_PLANS_FEATURE_READY = true;
  SERVICE_PLANS_CACHE = data || [];
  return SERVICE_PLANS_CACHE;
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
        <div class="li-sub muted">${escapeHtml(c.email || "No email")}  |  ${escapeHtml(c.phone || "No phone")}</div>
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
      <div class="detail-copy">${escapeHtml(customer.email || "No email")}  |  ${escapeHtml(customer.phone || "No phone")}</div>
      <div class="detail-copy">Preferred contact: ${escapeHtml(customer.preferred_contact || "email")}</div>
      <div class="detail-copy">Lifetime value: ${formatUsd(customer.lifetime_value_cents || 0)}  |  Orders: ${escapeHtml(String(customer.order_count || 0))}</div>
      <div class="detail-copy">Last touch: ${escapeHtml(customer.last_contact_at ? formatDateTime(customer.last_contact_at) : "Not recorded")}</div>
      ${customer.email && TENANT_ID ? `
      <div class="detail-copy" style="margin-top:8px;">
        Customer portal link:
        <button id="btnCopyPortalLink" class="btn btn-ghost btn-sm" type="button" style="margin-left:6px;">Copy link</button>
        <span id="portalLinkCopied" style="display:none;font-size:.75rem;color:#4ade80;margin-left:6px;">Copied!</span>
      </div>` : ''}
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
                    <div class="li-sub muted">${escapeHtml(o.scheduled_date || "No scheduled date")}  |  ${escapeHtml(o.scheduled_time || "No time")}</div>
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

    ${customer.phone ? `
    <div class="card" style="margin-top:14px;">
      <div class="card-hd">
        <strong>SMS</strong>
        <span class="muted">Two-way text with ${escapeHtml(customer.name || "customer")}</span>
      </div>
      <div class="card-bd">
        <div id="smsThread" style="max-height:280px;overflow-y:auto;margin-bottom:12px;"></div>
        <div class="row" style="gap:8px;">
          <input id="smsInput" type="text" style="flex:1;" placeholder="Type a message…" />
          <button id="btnSendSms" class="btn btn-primary" type="button">Send</button>
        </div>
        <div id="smsMsg" class="msg"></div>
      </div>
    </div>` : ''}
  `;

  // Load SMS thread if customer has phone
  if (customer.phone) {
    (async () => {
      try {
        const tok = await getAccessToken();
        const encoded = encodeURIComponent(customer.phone);
        const res = await fetch(`/.netlify/functions/get-sms-thread?phone=${encoded}`, {
          headers: { "Authorization": `Bearer ${tok}` },
        });
        const d = await res.json().catch(() => ({}));
        const thread = $("smsThread");
        if (!thread) return;
        const msgs = d.messages || [];
        if (!msgs.length) {
          thread.innerHTML = `<p class="muted" style="font-size:.8rem;">No messages yet.</p>`;
        } else {
          thread.innerHTML = msgs.map((m) => {
            const isOut = m.direction === 'outbound';
            return `<div style="display:flex;justify-content:${isOut ? 'flex-end' : 'flex-start'};margin-bottom:6px;">
              <div style="max-width:75%;background:${isOut ? '#c84b2f' : 'rgba(255,255,255,.08)'};border-radius:10px;padding:7px 12px;font-size:.83rem;line-height:1.4;">
                ${escapeHtml(m.body || "")}
                <div style="font-size:.7rem;opacity:.5;margin-top:3px;text-align:${isOut ? 'right' : 'left'};">${formatDateTime(m.created_at)}</div>
              </div>
            </div>`;
          }).join('');
          thread.scrollTop = thread.scrollHeight;
        }
      } catch (e) {
        console.error("[SMS thread load]", e);
      }
    })();
  }

  $("btnCopyPortalLink")?.addEventListener("click", () => {
    if (!customer.email || !TENANT_ID) return;
    const link = `${location.origin}/portal.html?tenant=${encodeURIComponent(TENANT_ID)}&email=${encodeURIComponent(customer.email)}`;
    navigator.clipboard.writeText(link).then(() => {
      const copied = $("portalLinkCopied");
      if (copied) { copied.style.display = "inline"; setTimeout(() => { copied.style.display = "none"; }, 2000); }
    });
  });

  $("btnSendSms")?.addEventListener("click", async () => {
    const btn  = $("btnSendSms");
    const msg  = $("smsMsg");
    const text = $("smsInput")?.value?.trim();
    if (!text) return;
    if (!customer.phone) return;
    btn.disabled = true;
    if (msg) { msg.textContent = ""; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-sms", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ to: customer.phone, body: text, customer_id: customerId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      const inp = $("smsInput");
      if (inp) inp.value = "";
      // Append sent message to thread
      const thread = $("smsThread");
      if (thread) {
        thread.innerHTML += `<div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
          <div style="max-width:75%;background:#c84b2f;border-radius:10px;padding:7px 12px;font-size:.83rem;line-height:1.4;">
            ${escapeHtml(text)}
            <div style="font-size:.7rem;opacity:.5;margin-top:3px;text-align:right;">Just now</div>
          </div>
        </div>`;
        thread.scrollTop = thread.scrollHeight;
      }
      if (msg) { msg.textContent = "✓ Message sent"; msg.className = "msg success"; setTimeout(() => { if (msg) { msg.textContent = ""; msg.className = "msg"; } }, 3000); }
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending."; msg.className = "msg error"; }
    }
    btn.disabled = false;
  });

  $("smsInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnSendSms")?.click(); }
  });

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
        <div class="li-sub muted">${escapeHtml(order?.status || "order")}  |  ${escapeHtml(formatDateTime(p.created_at))}</div>
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
  if (paymentFormTitle) paymentFormTitle.textContent = options.title || "Manual payment entry";
  if (paymentId) paymentId.value = "";
  if (paymentJobId) paymentJobId.value = options.jobId || "";
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
  if (paymentJobId) paymentJobId.value = payment.job_id || "";
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
      markWorkspaceClean("customers");
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
    job_id: paymentJobId?.value || null,
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
    await Promise.all([fetchPayments(), fetchCustomers(), fetchCrmOrders(), fetchJobs()]);
    const fresh = PAYMENTS_CACHE.find((row) => row.id === data.id) || data;
    loadPaymentIntoForm(fresh);
    renderPayments();
    renderOrders();
    renderJobs(jobSearch?.value || "");
    renderCustomersList(customerSearch?.value || "");
    renderDashboard();
      renderMoney().catch(console.error);
      renderGuidance();
      if (ACTIVE_CUSTOMER_ID) renderCustomerDetail(ACTIVE_CUSTOMER_ID).catch(console.error);
      markWorkspaceClean("payments");
      setInlineMessage(paymentMsg, "Payment saved.", "ok");
    } catch (err) {
    setInlineMessage(paymentMsg, err.message || String(err), "error");
  }
});
leadSearch?.addEventListener("input", () => renderLeads(leadSearch.value));
btnNewLead?.addEventListener("click", () => {
  ACTIVE_LEAD_ID = null;
  clearLeadForm();
  renderLeadDetail(null).catch(console.error);
});
leadForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setInlineMessage(leadMsg, "Saving...");
  try {
    await saveLeadRecord();
    markWorkspaceClean("leads");
    setInlineMessage(leadMsg, "Lead saved.", "ok");
  } catch (err) {
    setInlineMessage(leadMsg, err.message || String(err), "error");
  }
});
btnLeadCreateBid?.addEventListener("click", async () => {
  try {
    setInlineMessage(leadMsg, "Creating bid...");
    let lead = currentLead();
    if (!lead || !lead.id) {
      lead = await saveLeadRecord();
    }
    const result = await createBidFromLeadRecord(lead, { profile: preferredBidProfile() });
    const target = result?.bid || BIDS_CACHE[0] || null;
    if (target) ACTIVE_BID_ID = target.id;
    renderBids(bidSearch?.value || "");
    renderLeads(leadSearch?.value || "");
    setInlineMessage(leadMsg, result?.existing ? "Linked bid opened." : "Lead converted into a bid.", "ok");
    switchTab("bids");
  } catch (err) {
    setInlineMessage(leadMsg, err.message || String(err), "error");
  }
});
btnLeadOpenBid?.addEventListener("click", async () => {
  const lead = currentLead();
  if (!lead?.converted_bid_id) return;
  await loadPersistedBids();
  const bid = findBidRecordById(lead.converted_bid_id);
  if (bid) ACTIVE_BID_ID = bid.id;
  renderBids(bidSearch?.value || "");
  switchTab("bids");
});
jobSearch?.addEventListener("input", () => renderJobs(jobSearch.value));
btnNewJob?.addEventListener("click", () => {
  ACTIVE_JOB_ID = null;
  clearJobForm();
  renderJobDetail(null).catch(console.error);
});
jobOrderId?.addEventListener("change", () => {
  const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (jobOrderId.value || ""));
  if (!linkedOrder) return;
  renderJobCustomerOptions(linkedOrder.customer_id || "");
  if (jobTitle && !jobTitle.value.trim()) jobTitle.value = linkedOrder.cart_summary || linkedOrder.customer_name || "";
  if (jobServiceAddress && !jobServiceAddress.value.trim()) jobServiceAddress.value = linkedOrder.service_address || "";
  if (jobScheduledDate && !jobScheduledDate.value) jobScheduledDate.value = linkedOrder.scheduled_date || "";
  if (jobScheduledTime && !jobScheduledTime.value.trim()) jobScheduledTime.value = linkedOrder.scheduled_time || "";
});
jobForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setInlineMessage(jobMsg, "Saving...");
  try {
    await saveJobRecord();
    markWorkspaceClean("jobs");
    setInlineMessage(jobMsg, "Job saved.", "ok");
  } catch (err) {
    setInlineMessage(jobMsg, err.message || String(err), "error");
  }
});
btnJobOpenOrder?.addEventListener("click", () => {
  const job = currentJob();
  if (!job?.order_id) return;
  ACTIVE_ORDER_ID = job.order_id;
  renderOrders();
  switchTab("orders");
});
btnJobRecordPayment?.addEventListener("click", () => {
  const job = currentJob();
  if (!job) return;
  const order = linkedOrderForJob(job);
  ACTIVE_ORDER_ID = order?.id || job.order_id || null;
  ACTIVE_JOB_ID = job.id;
  clearPaymentForm({
    customerId: job.customer_id || order?.customer_id || "",
    orderId: order?.id || job.order_id || "",
    jobId: job.id,
  });
  switchTab("payments");
});
planSearch?.addEventListener("input", () => renderPlans(planSearch.value));
btnNewPlan?.addEventListener("click", () => {
  ACTIVE_PLAN_ID = null;
  clearPlanForm();
  renderPlanDetail(null).catch(console.error);
});
planSourceOrderId?.addEventListener("change", () => {
  const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (planSourceOrderId.value || ""));
  const linkedCustomer = CUSTOMERS_CACHE.find((row) => row.id === linkedOrder?.customer_id) || null;
  if (!linkedOrder) return;
  renderPlanCustomerOptions(linkedOrder.customer_id || "");
  if (planTitle && !planTitle.value.trim()) planTitle.value = linkedOrder.cart_summary || linkedOrder.customer_name || "Recurring service";
  if (planServiceAddress && !planServiceAddress.value.trim()) planServiceAddress.value = linkedOrder.service_address || linkedCustomer?.service_address || linkedCustomer?.billing_address || "";
  if (planNextRunOn && !planNextRunOn.value) planNextRunOn.value = linkedOrder.scheduled_date || todayDateValue(30);
  if (planAmount && !planAmount.value.trim()) planAmount.value = money(orderTotalCents(linkedOrder));
  if (planDepositAmount && !planDepositAmount.value.trim()) planDepositAmount.value = money(orderDepositRequiredCents(linkedOrder));
  if (planScheduleWindow && !planScheduleWindow.value.trim()) planScheduleWindow.value = linkedOrder.schedule_window || linkedOrder.scheduled_time || "";
  if (planSummary && !planSummary.value.trim()) planSummary.value = linkedOrder.cart_summary || "";
  if (planNotes && !planNotes.value.trim()) planNotes.value = linkedOrder.notes || "";
});
planForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setInlineMessage(planMsg, "Saving...");
  try {
    await saveServicePlanRecord();
    markWorkspaceClean("plans");
    setInlineMessage(planMsg, "Recurring plan saved.", "ok");
  } catch (err) {
    setInlineMessage(planMsg, err.message || String(err), "error");
  }
});
btnGeneratePlanOrder?.addEventListener("click", async () => {
  const plan = currentServicePlan();
  if (!plan) return;
  setInlineMessage(planMsg, "Generating next order...");
  try {
    const result = await runServicePlanRecord(plan);
    setInlineMessage(planMsg, result?.existing ? "The next order already existed, so it was reopened." : "Recurring work generated.", "ok");
    if (result?.order?.id) {
      ACTIVE_ORDER_ID = result.order.id;
      switchTab("orders");
    }
  } catch (err) {
    setInlineMessage(planMsg, err.message || String(err), "error");
  }
});
btnOpenPlanOrder?.addEventListener("click", () => {
  const plan = currentServicePlan();
  if (!plan?.last_generated_order_id) return;
  ACTIVE_ORDER_ID = plan.last_generated_order_id;
  renderOrders();
  switchTab("orders");
});
btnRunDuePlans?.addEventListener("click", async () => {
  setInlineMessage(planMsg, "Generating due recurring work...");
  try {
    const result = await runDueServicePlans();
    setInlineMessage(planMsg, result.created ? `Generated ${result.created} due recurring order${result.created === 1 ? "" : "s"}.` : "No new due recurring orders were needed.", "ok");
  } catch (err) {
    setInlineMessage(planMsg, err.message || String(err), "error");
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
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  if (Architecture?.resolveBidProfileForBusinessType) {
    return normalizeBidProfile(Architecture.resolveBidProfileForBusinessType(raw));
  }
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
function bidPhotoCategories(profileKey) {
  const profile = bidProfileConfig(profileKey);
  const defaults = BID_PROFILE_LIBRARY.general_service?.photoCategories || [];
  return Array.isArray(profile?.photoCategories) && profile.photoCategories.length
    ? profile.photoCategories
    : defaults;
}
function bidScopeStarterLibrary(profileKey) {
  const profile = bidProfileConfig(profileKey);
  const defaults = BID_PROFILE_LIBRARY.general_service?.scopeStarters || [];
  return Array.isArray(profile?.scopeStarters) && profile.scopeStarters.length
    ? profile.scopeStarters
    : defaults;
}
function bidProposalPrompts(profileKey) {
  const profile = bidProfileConfig(profileKey);
  const defaults = BID_PROFILE_LIBRARY.general_service?.proposalPrompts || [];
  return Array.isArray(profile?.proposalPrompts) && profile.proposalPrompts.length
    ? profile.proposalPrompts
    : defaults;
}
function bidPhotoCategoryByValue(profileKey, categoryValue) {
  const key = String(categoryValue || "").trim().toLowerCase();
  return bidPhotoCategories(profileKey).find((item) => item.value === key) || bidPhotoCategories(profileKey)[0] || null;
}
function hydrateBidPhotoCategoryOptions(profileKey, selectedValue = "") {
  if (!bidPhotoCategory) return;
  const selected = String(selectedValue || "").trim().toLowerCase();
  const options = bidPhotoCategories(profileKey);
  bidPhotoCategory.innerHTML = options.map((item) => `
    <option value="${escapeAttr(item.value)}">${escapeHtml(item.label)}</option>
  `).join("");
  const fallback = options[0]?.value || "overview";
  bidPhotoCategory.value = options.some((item) => item.value === selected) ? selected : fallback;
}
function bidPhotoPresetNeedsName(currentValue = "") {
  const raw = String(currentValue || "").trim().toLowerCase();
  return !raw || ["walkthrough photo", "photo", "image"].includes(raw);
}
function mergeBidLineItem(base = {}, item = {}) {
  return {
    id: item.id || base.id || createLocalId("line"),
    name: item.name || base.name || "",
    description: item.description || base.description || "",
    quantity: Number(item.quantity ?? base.quantity ?? 1),
    unit: item.unit || base.unit || "job",
    unit_price_cents: Number(item.unit_price_cents ?? base.unit_price_cents ?? 0),
    kind: String(item.kind || base.kind || "base"),
    template_key: item.template_key || base.template_key || "",
  };
}
function formatBidStatus(status) {
  const labels = {
    draft: "Draft",
    walkthrough_complete: "Walkthrough complete",
    ready_to_send: "Ready to send",
    sent: "Sent to client",
    approved: "Approved",
    declined: "Declined",
    converted: "Converted",
  };
  return labels[String(status || "").trim().toLowerCase()] || (status ? String(status) : "Draft");
}
function bidRecordId(draft) {
  return draft?.record_id || (isUuidLike(draft?.id) ? draft.id : "");
}
function bidMetadataValue(row) {
  return row && typeof row.metadata === "object" && row.metadata
    ? row.metadata
    : {};
}
function draftFromBidRow(row) {
  const metadata = bidMetadataValue(row);
  const localId = metadata.local_draft_id || row.id;
  return {
    id: localId,
    record_id: row.id,
    title: row.title || "",
    customer_id: row.customer_id || "",
    lead_id: row.lead_id || "",
    profile: normalizeBidProfile(row.profile || preferredBidProfile()),
    status: String(row.status || "draft"),
    walkthrough_at: row.walkthrough_at || null,
    valid_until: row.valid_until || "",
    service_address: row.service_address || "",
    site_contact: row.site_contact || "",
    schedule_window: row.schedule_window || "",
    project_summary: row.project_summary || "",
    scope_of_work: row.scope_of_work || "",
    proposed_solution: row.proposed_solution || "",
    materials_plan: row.materials_plan || "",
    unused_materials_plan: row.unused_materials_plan || "",
    exclusions: row.exclusions || "",
    warranty: row.warranty || "",
    cover_note: row.cover_note || "",
    internal_notes: row.internal_notes || "",
    deposit_percent: Number(row.deposit_percent || 0),
    deposit_amount_cents: Number(row.deposit_amount_cents || 0),
    terms: row.terms || "",
    line_items: cloneJson(row.line_items || [], []),
    photos: cloneJson(row.photos || [], []),
    subtotal_cents: Number(row.subtotal_cents || 0),
    optional_total_cents: Number(row.optional_total_cents || 0),
    total_cents: Number(row.total_cents || 0),
    converted_order_id: row.converted_order_id || "",
    converted_at: row.converted_at || null,
    sent_at: row.sent_at || null,
    approved_at: row.approved_at || null,
    metadata,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}
function bidRowFromDraft(draft) {
  const totals = calculateBidTotals(draft);
  return withTenantScope({
    operator_id: opId(),
    lead_id: draft?.lead_id || null,
    customer_id: draft?.customer_id || null,
    status: String(draft?.status || "draft"),
    profile: normalizeBidProfile(draft?.profile || preferredBidProfile()),
    title: draft?.title || defaultBidTitleFromDraft(draft),
    walkthrough_at: draft?.walkthrough_at || null,
    valid_until: draft?.valid_until || null,
    service_address: draft?.service_address || null,
    site_contact: draft?.site_contact || null,
    schedule_window: draft?.schedule_window || null,
    project_summary: draft?.project_summary || null,
    scope_of_work: draft?.scope_of_work || null,
    proposed_solution: draft?.proposed_solution || null,
    materials_plan: draft?.materials_plan || null,
    unused_materials_plan: draft?.unused_materials_plan || null,
    exclusions: draft?.exclusions || null,
    warranty: draft?.warranty || null,
    cover_note: draft?.cover_note || null,
    internal_notes: draft?.internal_notes || null,
    deposit_percent: Number(draft?.deposit_percent || 0),
    deposit_amount_cents: Number(draft?.deposit_amount_cents || 0),
    terms: draft?.terms || null,
    line_items: cloneJson(draft?.line_items || [], []),
    photos: cloneJson(draft?.photos || [], []),
    subtotal_cents: totals.base + totals.allowances,
    optional_total_cents: totals.options,
    total_cents: totals.total,
    converted_order_id: draft?.converted_order_id || null,
    sent_at: draft?.sent_at || null,
    approved_at: draft?.approved_at || null,
    converted_at: draft?.converted_at || null,
    metadata: {
      ...(draft?.metadata && typeof draft.metadata === "object" ? draft.metadata : {}),
      local_draft_id: draft?.id || null,
      client_version: "phase1",
    },
    updated_at: draft?.updated_at || new Date().toISOString(),
  });
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
  return text ? escapeHtml(text).replace(/\n/g, "<br>") : "-";
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
    record_id: "",
    lead_id: "",
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
function mergeBidDraftCollections(localRows = [], remoteRows = []) {
  const merged = new Map();
  [...localRows, ...remoteRows].forEach((row) => {
    if (!row) return;
    const key = bidRecordId(row) || row.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      return;
    }
    const existingAt = new Date(existing.updated_at || 0).getTime();
    const nextAt = new Date(row.updated_at || 0).getTime();
    merged.set(key, nextAt >= existingAt ? row : existing);
  });
  return [...merged.values()].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
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
async function loadPersistedBids() {
  const remoteRows = await fetchPersistedBids();
  const remoteDrafts = remoteRows.map(draftFromBidRow);
  BIDS_CACHE = mergeBidDraftCollections(BIDS_CACHE, remoteDrafts);
  persistBidDrafts();
  ACTIVE_BID_ID = ACTIVE_BID_ID && BIDS_CACHE.some((row) => row.id === ACTIVE_BID_ID)
    ? ACTIVE_BID_ID
    : (BIDS_CACHE[0]?.id || null);
  return BIDS_CACHE;
}
async function flushBidDraftSync(options = {}) {
  if (BID_SYNC_PROMISE) {
    try {
      await BID_SYNC_PROMISE;
    } catch (err) {
      if (options.throwOnError) throw err;
      return null;
    }
  }

  const runSync = async () => {
    let lastSyncedDraft = null;
    while (true) {
      const active = currentBid();
      if (!active || !CURRENT_OPERATOR?.operator_id) return lastSyncedDraft;

      const activeUpdatedAt = String(active.updated_at || "");
      const rowPayload = bidRowFromDraft(active);
      const recordId = bidRecordId(active);
      const query = recordId
        ? sb.from("bids").update(rowPayload).eq("id", recordId).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
        : sb.from("bids").insert({ ...rowPayload, created_at: active.created_at || new Date().toISOString() });
      const { data, error } = await query.select("*").single();
      if (error) throw error;

      const remoteDraft = draftFromBidRow(data);
      const latestDraft = BIDS_CACHE.find((row) => row.id === active.id) || active;
      const changedWhileSyncing = String(latestDraft.updated_at || "") !== activeUpdatedAt;
      const baseDraft = changedWhileSyncing ? latestDraft : active;
      const nextDraft = changedWhileSyncing
        ? {
            ...baseDraft,
            record_id: data.id,
            metadata: {
              ...(remoteDraft.metadata || {}),
              ...(baseDraft.metadata || {}),
              local_draft_id: baseDraft.id,
            },
          }
        : {
            ...baseDraft,
            ...remoteDraft,
            id: baseDraft.id,
            record_id: data.id,
            metadata: {
              ...(remoteDraft.metadata || {}),
              ...(baseDraft.metadata || {}),
              local_draft_id: baseDraft.id,
            },
          };

      BIDS_CACHE = BIDS_CACHE.map((row) => row.id === baseDraft.id ? nextDraft : row);
      ACTIVE_BID_ID = nextDraft.id;
      persistBidDrafts();
      lastSyncedDraft = nextDraft;

      if (!changedWhileSyncing) return lastSyncedDraft;
    }
  };

  BID_SYNC_IN_FLIGHT = true;
  BID_SYNC_PROMISE = runSync();
  try {
    return await BID_SYNC_PROMISE;
  } catch (err) {
    console.error("[bids] sync failed", err);
    if (options.throwOnError) throw err;
  } finally {
    BID_SYNC_IN_FLIGHT = false;
    BID_SYNC_PROMISE = null;
  }
  return null;
}
function queueBidDraftSync(delayMs = 500) {
  if (BID_SYNC_TIMER) window.clearTimeout(BID_SYNC_TIMER);
  BID_SYNC_TIMER = window.setTimeout(() => {
    flushBidDraftSync().catch(console.error);
  }, delayMs);
}
function replaceBidDraft(nextDraft) {
  BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== nextDraft.id), nextDraft]
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  ACTIVE_BID_ID = nextDraft.id;
  persistBidDrafts();
  queueBidDraftSync();
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
  hydrateBidPhotoCategoryOptions(currentBid()?.profile || bidProfile?.value || preferredBidProfile(), bidPhotoCategory?.value || "");
  if (bidPhotoFile) bidPhotoFile.value = "";
  if (bidPhotoName) bidPhotoName.value = "";
  if (bidPhotoCategory && !bidPhotoCategory.value) bidPhotoCategory.value = "overview";
  if (bidPhotoNote) bidPhotoNote.value = "";
  setInlineMessage(bidPhotoMsg, "");
}
function collectBidFormDraft() {
  const active = currentBid();
  const profileKey = normalizeBidProfile(bidProfile?.value || active?.profile || preferredBidProfile());
  const draft = {
    ...(active || emptyBidDraft(profileKey)),
    id: bidId?.value || active?.id || createLocalId("bid"),
    record_id: active?.record_id || "",
    lead_id: active?.lead_id || "",
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
  hydrateBidPhotoCategoryOptions(draft?.profile, bidPhotoCategory?.value || "");
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
  hydrateBidPhotoCategoryOptions(preferredBidProfile(), bidPhotoCategory?.value || "");
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
              <div class="bid-step__num">${step.done ? "OK" : index + 1}</div>
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
  const proposalTips = bidProposalPrompts(draft.profile);
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
      <div>
        <strong>How to make it feel professional</strong>
        <ul class="bid-guide-list">
          ${proposalTips.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}
function applyBidPhotoPreset(categoryValue) {
  const profileKey = normalizeBidProfile(bidProfile?.value || currentBid()?.profile || preferredBidProfile());
  const category = bidPhotoCategoryByValue(profileKey, categoryValue);
  if (!category) return;
  hydrateBidPhotoCategoryOptions(profileKey, category.value);
  if (bidPhotoName && bidPhotoPresetNeedsName(bidPhotoName.value)) bidPhotoName.value = category.name || category.label || "";
  if (bidPhotoNote && !String(bidPhotoNote.value || "").trim()) bidPhotoNote.value = category.note || "";
  setInlineMessage(bidPhotoMsg, `${category.label} preset loaded. Capture the photo and save it to the bid.`, "");
  if (bidPhotoFile) bidPhotoFile.focus();
}
function renderBidPhotoGuide(draft) {
  if (!bidPhotoGuide) return;
  const profileKey = normalizeBidProfile(draft?.profile || bidProfile?.value || preferredBidProfile());
  const profile = bidProfileConfig(profileKey);
  const categories = bidPhotoCategories(profileKey);
  if (!categories.length) {
    bidPhotoGuide.innerHTML = `<div class="muted">No photo prompts are configured for this service profile yet.</div>`;
    return;
  }
  bidPhotoGuide.innerHTML = `
    <div class="bid-template-panel__top">
      <div>
        <strong>${escapeHtml(profile.label)} shot list</strong>
        <div class="bid-template-panel__copy">Tap a photo prompt to load the category, a suggested name, and the note starter before you capture the image.</div>
      </div>
    </div>
    <div class="bid-chip-row">
      ${categories.map((item) => `
        <button class="btn btn-ghost btn-sm" type="button" data-bid-photo-preset="${escapeAttr(item.value)}">${escapeHtml(item.label)}</button>
      `).join("")}
    </div>
  `;
  bidPhotoGuide.querySelectorAll("[data-bid-photo-preset]").forEach((btn) => {
    btn.addEventListener("click", () => applyBidPhotoPreset(btn.getAttribute("data-bid-photo-preset")));
  });
}
function addBidScopeStarter(starterKey) {
  let active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const starter = bidScopeStarterLibrary(active.profile).find((item) => item.key === starterKey);
  if (!starter) return null;
  const existing = (active.line_items || []).find((item) => item.template_key === starter.key);
  if (existing) {
    populateBidLineItemForm(existing);
    setInlineMessage(bidLineItemMsg, `${starter.name} is already on this bid. Edit pricing or wording below.`, "ok");
    bidLineItemUnitPrice?.focus();
    return existing;
  }
  const nextItem = mergeBidLineItem({}, {
    ...starter,
    template_key: starter.key,
  });
  const nextDraft = {
    ...active,
    line_items: [...(active.line_items || []), nextItem],
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  populateBidLineItemForm(nextItem);
  setInlineMessage(bidLineItemMsg, `${starter.name} added. Price it and tighten the wording below.`, "ok");
  bidLineItemUnitPrice?.focus();
  return nextItem;
}
function renderBidScopeStarters(draft) {
  if (!bidScopeStarters) return;
  const profileKey = normalizeBidProfile(draft?.profile || bidProfile?.value || preferredBidProfile());
  const profile = bidProfileConfig(profileKey);
  const starters = bidScopeStarterLibrary(profileKey);
  if (!starters.length) {
    bidScopeStarters.innerHTML = `<div class="muted">No scope starters are configured for this service profile yet.</div>`;
    return;
  }
  const activeKeys = new Set((draft?.line_items || []).map((item) => item.template_key).filter(Boolean));
  bidScopeStarters.innerHTML = `
    <div class="bid-template-panel__top">
      <div>
        <strong>${escapeHtml(profile.label)} scope starters</strong>
        <div class="bid-template-panel__copy">Tap a starter to drop a professional line item into the bid instead of building every wash scope from scratch.</div>
      </div>
    </div>
    <div class="bid-template-grid">
      ${starters.map((item) => `
        <button class="bid-template-card ${activeKeys.has(item.key) ? "is-added" : ""}" type="button" data-bid-scope-starter="${escapeAttr(item.key)}">
          <div class="bid-template-card__kicker">${escapeHtml(formatBidLineItemKind(item.kind))}</div>
          <div class="bid-template-card__title">${escapeHtml(item.name)}</div>
          <div class="bid-template-card__copy">${escapeHtml(item.description || "")}</div>
          <div class="bid-template-card__meta">
            <span class="pill">${escapeHtml(String(item.quantity || 1))} ${escapeHtml(item.unit || "job")}</span>
            <span class="pill ${activeKeys.has(item.key) ? "pill-on" : ""}">${activeKeys.has(item.key) ? "Added" : "Add starter"}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
  bidScopeStarters.querySelectorAll("[data-bid-scope-starter]").forEach((btn) => {
    btn.addEventListener("click", () => addBidScopeStarter(btn.getAttribute("data-bid-scope-starter")));
  });
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
          <span class="pill">${escapeHtml(bidPhotoCategoryByValue(draft?.profile, photo.category)?.label || photo.category || "overview")}</span>
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
    renderBidPhotoGuide(null);
    renderBidScopeStarters(null);
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
  renderBidPhotoGuide(draft);
  renderBidScopeStarters(draft);
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
                  <div class="proposal-photo__meta"><span class="pill">${escapeHtml(bidPhotoCategoryByValue(draft?.profile, photo.category)?.label || photo.category || "Overview")}</span></div>
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
        .proposal-photo__meta{margin-top:8px;}
        .proposal-photo__copy{color:#555;font-size:12px;line-height:1.5;margin-top:6px;}
        .proposal-section h3{margin:0 0 10px;font-size:14px;}
        .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #ddd;border-radius:999px;font-size:11px;font-weight:700;background:#fff;}
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
    || CRM_ORDERS_CACHE.find((row) => row.bid_id && row.bid_id === bidRecordId(draft))
    || CRM_ORDERS_CACHE.find((row) => ["walkthrough_bid", "service_bid"].includes(String(row.source_type || "").toLowerCase()) && [draft.id, bidRecordId(draft)].includes(String(row.source_ref || "")))
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
  const key = String(bidIdValue || "").trim();
  if (!key) return null;
  if (isUuidLike(key)) {
    const byBid = await scopeQuery(sb
      .from("orders")
      .select("*"))
      .eq("bid_id", key)
      .limit(1);
    if (byBid.error) throw byBid.error;
    if (Array.isArray(byBid.data) && byBid.data.length) return byBid.data[0];
  }
  const { data, error } = await scopeQuery(sb
    .from("orders")
    .select("*"))
    .eq("source_ref", key)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}
async function convertBidToTrackedOrder() {
  let baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!baseDraft) throw new Error("Create a bid first.");
  if (!baseDraft.customer_id) throw new Error("Link the bid to a customer before converting it into tracked work.");
  const customer = findBidCustomer(baseDraft.customer_id);
  if (!customer) throw new Error("The linked customer record could not be found. Refresh customers and try again.");
  await flushBidDraftSync({ throwOnError: true });
  baseDraft = currentBid() || baseDraft;
  const recordId = bidRecordId(baseDraft);

  const existing = currentBidOrder(baseDraft) || await existingOrderForBidId(recordId || baseDraft.id);
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
  if (recordId) {
    const { data, error } = await sb.rpc("create_order_from_bid", { p_bid_id: recordId });
    if (!error) {
      await Promise.all([fetchCrmOrders(), fetchCustomers(), fetchPayments(), fetchLeads(), fetchJobs(), loadPersistedBids()]);
      let order = CRM_ORDERS_CACHE.find((row) => row.id === data?.order_id) || await existingOrderForBidId(recordId);
      if (!order) throw new Error("The bid converted, but the tracked order could not be reloaded.");
      order = await seedOrderDepositDefaults(order, {
        depositRequiredCents: totals.deposit,
        depositPolicy: totals.deposit > 0 ? "required_before_job" : "optional",
        depositDueDate: baseDraft.valid_until || order.payment_due_date || null,
      });
      ACTIVE_ORDER_ID = order.id;
      const refreshedDraft = findBidRecordById(recordId) || currentBid() || baseDraft;
      renderOrders();
      renderCustomersList(customerSearch?.value || "");
      renderDashboard();
      renderGuidance();
      renderMoney().catch(console.error);
      return { order, draft: refreshedDraft, existed: !!data?.existing };
    }
    if (!isMissingDatabaseFeatureError(error, ["create_order_from_bid"])) throw error;
  }
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: customer.id,
    lead_id: baseDraft.lead_id || null,
    bid_id: recordId || null,
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
    payment_due_date: baseDraft.valid_until || null,
    deposit_required_cents: totals.deposit,
    source_type: "walkthrough_bid",
    source_ref: recordId || baseDraft.id,
    created_at: nowIso,
    updated_at: nowIso,
  });
  const { data, error } = await sb.from("orders").insert(payload).select("*").single();
  if (error) throw error;
  const orderWithDepositDefaults = await seedOrderDepositDefaults(data, {
    depositRequiredCents: totals.deposit,
    depositPolicy: totals.deposit > 0 ? "required_before_job" : "optional",
    depositDueDate: baseDraft.valid_until || null,
  });

  await sb.from("customer_interactions").insert(withTenantScope({
    operator_id: opId(),
    customer_id: customer.id,
    type: "bid_converted",
    summary: `Converted walkthrough bid into tracked order for ${formatUsd(totals.total)}`,
    metadata: {
      bid_id: baseDraft.id,
      order_id: orderWithDepositDefaults.id,
      status,
      service_address: baseDraft.service_address || null,
    },
    created_at: nowIso,
  }));

  ACTIVE_ORDER_ID = orderWithDepositDefaults.id;
  if (recordId) {
    await Promise.allSettled([
      sb.from("bids")
        .update({
          converted_order_id: orderWithDepositDefaults.id,
          converted_at: nowIso,
          status: String(baseDraft.status || "").toLowerCase() === "approved" ? "converted" : (baseDraft.status || "draft"),
          updated_at: nowIso,
        })
        .eq("id", recordId)
        .eq(OPERATOR_COLUMN, opId())
        .eq(TENANT_COLUMN, TENANT_ID),
      baseDraft.lead_id
        ? sb.from("leads")
          .update({
            converted_order_id: orderWithDepositDefaults.id,
            status: "converted",
            last_activity_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", baseDraft.lead_id)
          .eq(OPERATOR_COLUMN, opId())
          .eq(TENANT_COLUMN, TENANT_ID)
        : Promise.resolve(),
    ]);
  }
  const nextDraft = {
    ...baseDraft,
    converted_order_id: orderWithDepositDefaults.id,
    converted_at: nowIso,
    updated_at: nowIso,
  };
  replaceBidDraft(nextDraft);
  await Promise.all([fetchCrmOrders(), fetchCustomers(), fetchPayments(), fetchLeads(), fetchJobs(), loadPersistedBids()]);
  renderOrders();
  renderCustomersList(customerSearch?.value || "");
  renderDashboard();
  renderGuidance();
  renderMoney().catch(console.error);
  return { order: orderWithDepositDefaults, draft: nextDraft, existed: false };
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
bidForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nextDraft = updateCurrentBidFromForm({ allowCreate: true }) || startNewBid(preferredBidProfile());
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  if (BID_SYNC_TIMER) {
    window.clearTimeout(BID_SYNC_TIMER);
    BID_SYNC_TIMER = null;
  }
  try {
    const syncedDraft = await flushBidDraftSync({ throwOnError: true });
      if (syncedDraft) {
        await loadPersistedBids();
        const refreshed = currentBid() || syncedDraft;
        renderBidWorkspace(refreshed, { preserveForm: true });
        renderBidList(bidSearch?.value || "");
      }
      markWorkspaceClean("bids");
      setInlineMessage(bidMsg, "Bid saved.", "ok");
    } catch (err) {
    setInlineMessage(bidMsg, err.message || String(err), "error");
  }
});
[bidTitle, bidCustomerId, bidProfile, bidStatus, bidWalkthroughAt, bidValidUntil, bidServiceAddress, bidSiteContact, bidScheduleWindow, bidProjectSummary, bidScopeOfWork, bidProposedSolution, bidMaterialsPlan, bidUnusedMaterialsPlan, bidExclusions, bidWarranty, bidCoverNote, bidInternalNotes, bidDepositPercent, bidDepositAmount, bidTerms].forEach((el) => {
  el?.addEventListener("input", scheduleBidAutosave);
  el?.addEventListener("change", () => {
    scheduleBidAutosave();
    if (el === bidProfile) {
      const draft = collectBidFormDraft();
      hydrateBidPhotoCategoryOptions(draft.profile, bidPhotoCategory?.value || "");
      renderBidProfileGuideCard(draft);
      renderBidPhotoGuide(draft);
      renderBidScopeStarters(draft);
    }
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
  const existingItem = (active.line_items || []).find((row) => row.id === (bidLineItemId?.value || ACTIVE_BID_LINE_ITEM_ID));
  const item = mergeBidLineItem(existingItem, {
    id: bidLineItemId?.value || createLocalId("line"),
    name: itemName,
    description: bidLineItemDescription?.value?.trim() || "",
    quantity: Number(bidLineItemQuantity?.value || 0),
    unit: bidLineItemUnit?.value?.trim() || "job",
    unit_price_cents: toCents(bidLineItemUnitPrice?.value || 0),
    kind: String(bidLineItemKind?.value || "base"),
  });
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
function findBidRecordById(value) {
  const key = String(value || "").trim();
  if (!key) return null;
  return BIDS_CACHE.find((row) => row.id === key || bidRecordId(row) === key) || null;
}
function servicePipelineSnapshot() {
  return {
    leads: LEADS_CACHE.filter((row) => !["converted", "lost", "archived"].includes(String(row.status || "").toLowerCase())).length,
    quoted: BIDS_CACHE.filter((row) => !["converted", "declined", "expired"].includes(String(row.status || "").toLowerCase())).length,
    booked: JOBS_CACHE.filter((row) => ["scheduled", "dispatched"].includes(String(row.status || "").toLowerCase())).length,
    inProgress: JOBS_CACHE.filter((row) => String(row.status || "").toLowerCase() === "in_progress").length,
    completed: JOBS_CACHE.filter((row) => String(row.status || "").toLowerCase() === "completed").length,
    paid: CRM_ORDERS_CACHE.filter((row) => orderPaymentState(row) === "paid").length,
    overdue: CRM_ORDERS_CACHE.filter((row) => orderPaymentState(row) === "overdue").length,
  };
}
function leadLastTouchedAt(row) {
  return new Date(row?.last_activity_at || row?.updated_at || row?.created_at || 0).getTime();
}
function ageLabelFromTime(timeMs) {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return "just now";
  const elapsed = Math.max(0, Date.now() - timeMs);
  const minutes = Math.max(1, Math.floor(elapsed / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
function staleLeads(hours = 24) {
  const thresholdMs = Math.max(1, Number(hours || 24)) * 60 * 60 * 1000;
  return LEADS_CACHE.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    if (["converted", "lost", "archived"].includes(status)) return false;
    const touchedAt = leadLastTouchedAt(row);
    return Number.isFinite(touchedAt) && touchedAt > 0 && (Date.now() - touchedAt) >= thresholdMs;
  });
}
function completedUnpaidOrders() {
  return CRM_ORDERS_CACHE.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return ["fulfilled", "completed"].includes(status) && ["unpaid", "partially_paid", "overdue"].includes(orderPaymentState(row));
  });
}
function outstandingBalanceCents() {
  return CRM_ORDERS_CACHE.reduce((sum, row) => sum + orderAmountDueCents(row), 0);
}
function overdueBalanceCents() {
  return CRM_ORDERS_CACHE
    .filter((row) => orderPaymentState(row) === "overdue")
    .reduce((sum, row) => sum + orderAmountDueCents(row), 0);
}
function readFollowUpSnoozes() {
  try {
    const raw = window.localStorage.getItem(FOLLOW_UP_SNOOZE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}
function writeFollowUpSnoozes(next) {
  try {
    window.localStorage.setItem(FOLLOW_UP_SNOOZE_KEY, JSON.stringify(next || {}));
  } catch (_) {
    // Ignore locked-down browser storage failures.
  }
}
function followUpSnoozeActive(itemId) {
  const value = readFollowUpSnoozes()[itemId];
  const until = new Date(value || 0).getTime();
  return Number.isFinite(until) && until > Date.now();
}
function snoozeFollowUpItem(itemId, hours = 24) {
  const next = readFollowUpSnoozes();
  next[itemId] = new Date(Date.now() + Math.max(1, Number(hours || 24)) * 60 * 60 * 1000).toISOString();
  writeFollowUpSnoozes(next);
}
function setFollowUpQueueMessage(message = "", tone = "") {
  FOLLOW_UP_QUEUE_MESSAGE = message ? { text: message, tone } : null;
}
function customerById(customerIdValue) {
  return CUSTOMERS_CACHE.find((row) => row.id === customerIdValue) || null;
}
function customerTouchedAt(customer) {
  return new Date(customer?.last_contact_at || 0).getTime();
}
function customerTouchedRecently(customer, hours = 24) {
  const touchedAt = customerTouchedAt(customer);
  if (!Number.isFinite(touchedAt) || touchedAt <= 0) return false;
  return (Date.now() - touchedAt) < Math.max(1, Number(hours || 24)) * 60 * 60 * 1000;
}
function newestPaymentForOrder(orderIdValue) {
  return [...PAYMENTS_CACHE]
    .filter((row) => row.order_id === orderIdValue)
    .sort((a, b) => new Date(b.paid_at || b.created_at || b.updated_at || 0).getTime() - new Date(a.paid_at || a.created_at || a.updated_at || 0).getTime())[0] || null;
}
function followUpChannel({ email = "", phone = "", preferred = "" } = {}) {
  const preferredValue = String(preferred || "").trim().toLowerCase();
  if (preferredValue === "phone" && phone) return "phone";
  if (email) return "email";
  if (phone) return "phone";
  return "";
}
function followUpKindLabel(kind) {
  return FOLLOW_UP_KIND_META[kind]?.label || "Follow-up";
}
function followUpCooldownHours(kind) {
  return Number(FOLLOW_UP_KIND_META[kind]?.cooldownHours || 24);
}
function followUpCooldownLabel(kind) {
  return `Max one ${followUpKindLabel(kind).toLowerCase()} every ${followUpCooldownHours(kind)}h.`;
}
function queueBrandLines() {
  const brand = bidBrandContext();
  return [brand.tenantName, brand.contactEmail || null, brand.phone || null].filter(Boolean);
}
function reviewPlatformLabel() {
  const configured = String(SETUP_STATE?.config?.review_platform_label || "").trim();
  if (configured) return configured;
  return reviewLinkUrl() ? "Google" : "Review";
}
function reviewLinkUrl() {
  return cleanUrl(SETUP_STATE?.config?.review_link_url || "");
}
function reviewReferralMessage() {
  const configured = String(SETUP_STATE?.config?.referral_message || "").trim();
  return configured || "If someone else comes to mind who needs this kind of help, we would be grateful if you shared our name.";
}
function queueFollowUpItem(item) {
  const recordId = String(item.recordId || item.targetId || item.customerId || "").trim();
  if (!recordId) return null;
  const queued = {
    ...item,
    id: `${item.kind}:${recordId}`,
    kindLabel: followUpKindLabel(item.kind),
    cooldownHours: followUpCooldownHours(item.kind),
    cooldownLabel: followUpCooldownLabel(item.kind),
  };
  if (!queued.channel) queued.channel = followUpChannel({
    email: queued.contactEmail,
    phone: queued.contactPhone,
    preferred: queued.preferredContact,
  });
  queued.reviewLinkUrl = cleanUrl(queued.reviewLinkUrl || "");
  queued.canSend = Boolean(queued.channel === "email" && queued.contactEmail && queued.customerId);
  return queued;
}
function leadFollowUpQueueItems() {
  const brandLines = queueBrandLines();
  return staleLeads()
    .sort((a, b) => leadLastTouchedAt(a) - leadLastTouchedAt(b))
    .map((lead) => {
      const customer = customerById(lead.customer_id);
      if (customerTouchedRecently(customer, 24)) return null;
      const contactName = lead.contact_name || customer?.name || "there";
      const contactEmail = lead.contact_email || customer?.email || "";
      const contactPhone = lead.contact_phone || customer?.phone || "";
      if (!contactEmail && !contactPhone) return null;
      const requestedService = lead.requested_service_type || "service work";
      const preferredContact = lead.preferred_contact || customer?.preferred_contact || "email";
      const channel = followUpChannel({ email: contactEmail, phone: contactPhone, preferred: preferredContact });
      return queueFollowUpItem({
        kind: "lead_nudge",
        priority: 10,
        tab: "leads",
        targetId: lead.id,
        recordId: lead.id,
        customerId: lead.customer_id || "",
        leadId: lead.id,
        customerName: customer?.name || lead.contact_name || lead.title || "Lead",
        contactName,
        contactEmail,
        contactPhone,
        preferredContact,
        channel,
        title: `Check in on ${contactName}`,
        detail: `${requestedService} | Last touch ${ageLabelFromTime(leadLastTouchedAt(lead))}`,
        reason: `This lead has been quiet for at least 24 hours. ${followUpCooldownLabel("lead_nudge")}`,
        subject: `${bidBrandContext().tenantName}: checking in on your request`,
        message: [
          channel === "phone" ? `Call script for ${contactName}:` : `Hi ${contactName},`,
          channel === "phone" ? "" : ``,
          `Just checking in on your request for ${requestedService}.`,
          lead.service_address ? `We have ${lead.service_address} noted for the project.` : null,
          channel === "phone"
            ? `If they still want help, confirm the next step and update the lead in ProofLink right after the call.`
            : `If you still want help, reply to this email and we can get the next step moving.`,
          channel === "phone" ? "" : ``,
          ...brandLines,
        ].filter(Boolean).join("\n"),
      });
    })
    .filter(Boolean);
}
function quoteFollowUpQueueItems() {
  const brandLines = queueBrandLines();
  return [...BIDS_CACHE]
    .filter((row) => !row.converted_order_id && String(row.status || "").toLowerCase() === "sent")
    .filter((row) => (Date.now() - new Date(row.updated_at || row.created_at || 0).getTime()) >= 72 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime())
    .map((bid) => {
      const customer = findBidCustomer(bid.customer_id);
      if (!customer || customerTouchedRecently(customer, 72)) return null;
      const totals = calculateBidTotals(bid);
      const contactName = customer.name || "there";
      const contactEmail = customer.email || "";
      const contactPhone = customer.phone || "";
      if (!contactEmail && !contactPhone) return null;
      const preferredContact = customer.preferred_contact || "email";
      const channel = followUpChannel({ email: contactEmail, phone: contactPhone, preferred: preferredContact });
      return queueFollowUpItem({
        kind: "quote_follow_up",
        priority: 20,
        tab: "bids",
        targetId: bid.id,
        recordId: bidRecordId(bid) || bid.id,
        customerId: customer.id,
        bidId: bid.id,
        customerName: customer.name || bid.title || "Customer",
        contactName,
        contactEmail,
        contactPhone,
        preferredContact,
        channel,
        title: `Follow up on ${bid.title || "the proposal"}`,
        detail: `${contactName} | Sent ${ageLabelFromTime(new Date(bid.updated_at || bid.created_at || 0).getTime())} | ${formatUsd(totals.total)}`,
        reason: `This proposal is still open and has not converted into booked work. ${followUpCooldownLabel("quote_follow_up")}`,
        subject: `${bidBrandContext().tenantName}: following up on your proposal`,
        message: [
          channel === "phone" ? `Call script for ${contactName}:` : `Hi ${contactName},`,
          channel === "phone" ? "" : ``,
          `Following up on the proposal we sent over for ${bid.service_address || "your project"}.`,
          channel === "phone"
            ? `Ask whether they want to move forward, need revisions, or have questions before booking.`
            : `If you want to move forward, want revisions, or have questions, just reply and we will handle the next step.`,
          `Current base investment: ${formatUsd(totals.total)}.`,
          bid.valid_until ? `The proposal is currently dated through ${formatDateOnly(bid.valid_until)}.` : null,
          channel === "phone" ? "" : ``,
          ...brandLines,
        ].filter(Boolean).join("\n"),
      });
    })
    .filter(Boolean);
}
function paymentReminderQueueItems() {
  const brandLines = queueBrandLines();
  return [...CRM_ORDERS_CACHE]
    .filter((row) => !["new", "quoted", "cancelled"].includes(String(row.status || "").toLowerCase()))
    .filter((row) => !orderDepositBlocksJob(row))
    .filter((row) => ["unpaid", "partially_paid", "overdue"].includes(orderPaymentState(row)) && orderAmountDueCents(row) > 0)
    .sort((a, b) => {
      const stateA = orderPaymentState(a) === "overdue" ? 0 : 1;
      const stateB = orderPaymentState(b) === "overdue" ? 0 : 1;
      if (stateA !== stateB) return stateA - stateB;
      return new Date(a.payment_due_date || a.created_at || 0).getTime() - new Date(b.payment_due_date || b.created_at || 0).getTime();
    })
    .map((order) => {
      const customer = customerById(order.customer_id);
      if (!customer || customerTouchedRecently(customer, 24)) return null;
      const contactEmail = customer.email || order.email || "";
      const contactPhone = customer.phone || order.phone || "";
      if (!contactEmail && !contactPhone) return null;
      const paymentState = orderPaymentState(order);
      const preferredContact = customer.preferred_contact || order.preferred_contact || "email";
      const channel = followUpChannel({ email: contactEmail, phone: contactPhone, preferred: preferredContact });
      return queueFollowUpItem({
        kind: "payment_reminder",
        priority: paymentState === "overdue" ? 0 : 30,
        tab: "orders",
        targetId: order.id,
        recordId: order.id,
        customerId: customer.id,
        orderId: order.id,
        customerName: customer.name || order.customer_name || "Customer",
        contactName: customer.name || order.customer_name || "there",
        contactEmail,
        contactPhone,
        preferredContact,
        channel,
        title: paymentState === "overdue" ? `Collect overdue money from ${customer.name || order.customer_name || "this customer"}` : `Remind ${customer.name || order.customer_name || "this customer"} about payment`,
        detail: `${formatWorkflowPaymentState(paymentState)} | ${formatUsd(orderAmountDueCents(order))} due`,
        reason: `This reminder only appears while the order still carries an open balance. ${followUpCooldownLabel("payment_reminder")}`,
        subject: `${bidBrandContext().tenantName}: payment reminder`,
        message: [
          channel === "phone" ? `Call script for ${customer.name || order.customer_name || "this customer"}:` : `Hi ${customer.name || order.customer_name || "there"},`,
          channel === "phone" ? "" : ``,
          `This is a quick reminder that ${formatUsd(orderAmountDueCents(order))} is still open for ${order.cart_summary || "the completed work"}.`,
          order.payment_due_date ? `The balance was due on ${formatDateOnly(order.payment_due_date)}.` : null,
          channel === "phone"
            ? `Offer to answer questions, take payment, or confirm when the balance will be handled.`
            : `If you need anything clarified before payment, just reply and we will help.`,
          channel === "phone" ? "" : ``,
          ...brandLines,
        ].filter(Boolean).join("\n"),
      });
    })
    .filter(Boolean);
}
function depositReminderQueueItems() {
  const brandLines = queueBrandLines();
  return [...CRM_ORDERS_CACHE]
    .filter((row) => !["new", "quoted", "cancelled", "paid"].includes(String(row.status || "").toLowerCase()))
    .filter((row) => orderDepositBlocksJob(row))
    .sort((a, b) => new Date(orderDepositDueDate(a) || a.created_at || 0).getTime() - new Date(orderDepositDueDate(b) || b.created_at || 0).getTime())
    .map((order) => {
      const customer = customerById(order.customer_id);
      if (!customer || customerTouchedRecently(customer, 24)) return null;
      const contactEmail = customer.email || order.email || "";
      const contactPhone = customer.phone || order.phone || "";
      if (!contactEmail && !contactPhone) return null;
      const preferredContact = customer.preferred_contact || order.preferred_contact || "email";
      const channel = followUpChannel({ email: contactEmail, phone: contactPhone, preferred: preferredContact });
      const depositGap = orderDepositGapCents(order);
      return queueFollowUpItem({
        kind: "deposit_reminder",
        priority: orderDepositStatus(order) === "overdue" ? 5 : 15,
        tab: "orders",
        targetId: order.id,
        recordId: order.id,
        customerId: customer.id,
        orderId: order.id,
        customerName: customer.name || order.customer_name || "Customer",
        contactName: customer.name || order.customer_name || "there",
        contactEmail,
        contactPhone,
        preferredContact,
        channel,
        title: `Collect the deposit from ${customer.name || order.customer_name || "this customer"}`,
        detail: `${formatDepositStatus(orderDepositStatus(order))} | ${formatUsd(depositGap)} still needed`,
        reason: `This reminder only appears while the required deposit is still open. ${followUpCooldownLabel("deposit_reminder")}`,
        subject: `${bidBrandContext().tenantName}: deposit needed before scheduling`,
        message: [
          channel === "phone" ? `Call script for ${customer.name || order.customer_name || "this customer"}:` : `Hi ${customer.name || order.customer_name || "there"},`,
          channel === "phone" ? "" : ``,
          `Before we lock in the work, we still need the deposit of ${formatUsd(depositGap)} for ${order.cart_summary || "your service visit"}.`,
          orderDepositDueDate(order) ? `The deposit is currently due on ${formatDateOnly(orderDepositDueDate(order))}.` : null,
          channel === "phone"
            ? `Confirm when the deposit will be handled, or whether the customer needs anything clarified before paying it.`
            : `If you need anything clarified before handling the deposit, just reply and we will help.`,
          channel === "phone" ? "" : ``,
          ...brandLines,
        ].filter(Boolean).join("\n"),
      });
    })
    .filter(Boolean);
}
function reviewRequestQueueItems() {
  const brandLines = queueBrandLines();
  const reviewUrl = reviewLinkUrl();
  const platformLabel = reviewPlatformLabel();
  const referralMessage = reviewReferralMessage();
  return [...CRM_ORDERS_CACHE]
    .filter((row) => ["fulfilled", "completed", "paid"].includes(String(row.status || "").toLowerCase()))
    .filter((row) => orderPaymentState(row) === "paid")
    .filter((row) => {
      const anchor = newestPaymentForOrder(row.id);
      const sentAt = new Date(anchor?.paid_at || anchor?.created_at || row.updated_at || row.created_at || 0).getTime();
      const elapsed = Date.now() - sentAt;
      return Number.isFinite(sentAt) && elapsed >= 24 * 60 * 60 * 1000 && elapsed <= 7 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
    .map((order) => {
      const customer = customerById(order.customer_id);
      if (!customer || customerTouchedRecently(customer, 72)) return null;
      const contactEmail = customer.email || order.email || "";
      const contactPhone = customer.phone || order.phone || "";
      if (!contactEmail && !contactPhone) return null;
      const preferredContact = customer.preferred_contact || order.preferred_contact || "email";
      const channel = followUpChannel({ email: contactEmail, phone: contactPhone, preferred: preferredContact });
      return queueFollowUpItem({
        kind: "review_request",
        priority: 40,
        tab: "orders",
        targetId: order.id,
        recordId: order.id,
        customerId: customer.id,
        orderId: order.id,
        customerName: customer.name || order.customer_name || "Customer",
        contactName: customer.name || order.customer_name || "there",
        contactEmail,
        contactPhone,
        preferredContact,
        channel,
        title: reviewUrl
          ? `Ask ${customer.name || order.customer_name || "this customer"} for a ${platformLabel} review`
          : `Ask ${customer.name || order.customer_name || "this customer"} for feedback`,
        detail: `${order.cart_summary || "Completed work"} | Paid and closed${reviewUrl ? ` | ${platformLabel} link ready` : ""}`,
        reason: `Only queued after paid work and only once per week. ${followUpCooldownLabel("review_request")}`,
        subject: `${bidBrandContext().tenantName}: thank you for the opportunity`,
        message: [
          channel === "phone" ? `Call script for ${customer.name || order.customer_name || "this customer"}:` : `Hi ${customer.name || order.customer_name || "there"},`,
          channel === "phone" ? "" : ``,
          `Thank you again for trusting ${bidBrandContext().tenantName} with ${order.cart_summary || "your project"}.`,
          reviewUrl
            ? (channel === "phone"
              ? `If everything looks good, ask whether they would be comfortable leaving a quick ${platformLabel} review here: ${reviewUrl}`
              : `If everything looks good, we would really appreciate a quick ${platformLabel} review here: ${reviewUrl}`)
            : (channel === "phone"
              ? `If everything looks good, ask for quick feedback or a review while the work is still fresh.`
              : `If everything looks good, we would really appreciate a quick reply with feedback or a review.`),
          referralMessage,
          channel === "phone" ? "" : ``,
          ...brandLines,
        ].filter(Boolean).join("\n"),
        reviewLinkUrl: reviewUrl,
        reviewLinkLabel: `Leave a ${platformLabel} review`,
        ctaLabel: reviewUrl ? `Leave a ${platformLabel} review` : "",
        ctaUrl: reviewUrl,
      });
    })
    .filter(Boolean);
}
function buildFollowUpQueue() {
  return [
    ...depositReminderQueueItems(),
    ...paymentReminderQueueItems(),
    ...leadFollowUpQueueItems(),
    ...quoteFollowUpQueueItems(),
    ...reviewRequestQueueItems(),
  ]
    .filter((item) => item && !followUpSnoozeActive(item.id))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return String(a.customerName || "").localeCompare(String(b.customerName || ""));
    })
    .slice(0, 8);
}
function todayActionItems() {
  const actions = [];
  if (!CUSTOMERS_CACHE.length && !CRM_ORDERS_CACHE.length && !PAYMENTS_CACHE.length) {
    actions.push({
      tab: "import",
      title: "Bring your old system into ProofLink",
      detail: "Upload customers, open work, and payment history from CSV in one guided switch flow.",
      targetId: "",
    });
  }
  const staleLead = [...staleLeads()].sort((a, b) => leadLastTouchedAt(a) - leadLastTouchedAt(b))[0] || null;
  const duePlan = [...dueServicePlans()].sort((a, b) => servicePlanNextRunTime(a) - servicePlanNextRunTime(b))[0] || null;
  const depositRiskOrder = [...ordersMissingDeposits()].sort((a, b) => orderDepositGapCents(b) - orderDepositGapCents(a))[0] || null;
  const urgentLead = staleLead || [...LEADS_CACHE].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .find((row) => !["converted", "lost", "archived"].includes(String(row.status || "").toLowerCase()));
  if (urgentLead) {
    const stale = staleLead && staleLead.id === urgentLead.id;
    actions.push({
      tab: "leads",
      title: stale ? "Recover a missed lead" : (urgentLead.converted_bid_id ? "Follow up active lead" : "Work the next lead"),
      detail: `${urgentLead.contact_name || urgentLead.title || "Lead"} | ${String(urgentLead.status || "new").replace(/_/g, " ")} | ${ageLabelFromTime(leadLastTouchedAt(urgentLead))}`,
      targetId: urgentLead.id,
    });
  }
  const quoteReady = [...BIDS_CACHE].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .find((row) => !row.converted_order_id && ["ready_to_send", "sent", "approved", "walkthrough_complete"].includes(String(row.status || "").toLowerCase()));
  if (quoteReady) {
    actions.push({
      tab: "bids",
      title: quoteReady.converted_order_id ? "Open converted bid" : "Advance a live bid",
      detail: `${quoteReady.title || "Proposal"} | ${formatBidStatus(quoteReady.status)}`,
      targetId: quoteReady.id,
    });
  }
  if (duePlan) {
    actions.push({
      tab: "plans",
      title: "Generate recurring work",
      detail: `${duePlan.title || "Recurring plan"} | ${planCadenceLabel(duePlan.cadence, duePlan.custom_interval_days)} | Due ${servicePlanNextRunLabel(duePlan)}`,
      targetId: duePlan.id,
    });
  }
  const collectionRiskOrder = [...CRM_ORDERS_CACHE].sort((a, b) => new Date(a.payment_due_date || a.created_at || 0) - new Date(b.payment_due_date || b.created_at || 0))
    .find((row) => ["overdue", "partially_paid", "unpaid"].includes(orderPaymentState(row)));
  if (collectionRiskOrder) {
    const paymentState = orderPaymentState(collectionRiskOrder);
    const orderStatus = String(collectionRiskOrder.status || "").toLowerCase();
    actions.push({
      tab: "orders",
      title: paymentState === "overdue"
        ? "Collect overdue money"
        : (["fulfilled", "completed"].includes(orderStatus) ? "Collect from completed work" : "Collect or confirm payment"),
      detail: `${collectionRiskOrder.customer_name || "Customer"} | ${formatWorkflowPaymentState(paymentState)} | ${formatUsd(orderAmountDueCents(collectionRiskOrder))} due`,
      targetId: collectionRiskOrder.id,
    });
  }
  if (depositRiskOrder) {
    actions.push({
      tab: "orders",
      title: "Collect or confirm the deposit",
      detail: `${depositRiskOrder.customer_name || "Customer"} | ${formatUsd(orderDepositGapCents(depositRiskOrder))} deposit still open`,
      targetId: depositRiskOrder.id,
    });
  }
  const activeJob = [...JOBS_CACHE].sort((a, b) => new Date(a.scheduled_date || a.created_at || 0) - new Date(b.scheduled_date || b.created_at || 0))
    .find((row) => ["scheduled", "dispatched", "in_progress", "blocked"].includes(String(row.status || "").toLowerCase()));
  if (activeJob) {
    actions.push({
      tab: "jobs",
      title: "Move active work forward",
      detail: `${activeJob.title || "Job"} | ${String(activeJob.status || "scheduled").replace(/_/g, " ")}`,
      targetId: activeJob.id,
    });
  }
  return actions.slice(0, 4);
}
function dashboardClientTrackerRows(todayActions = []) {
  const rows = [];
  const activeStatuses = new Set(["new", "quoted", "confirmed", "fulfilled", "completed", "scheduled", "dispatched", "in_progress", "blocked"]);
  sortedCustomers(CUSTOMERS_CACHE).forEach((customer) => {
    const customerOrders = CRM_ORDERS_CACHE
      .filter((row) => row.customer_id === customer.id)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
    const customerJobs = JOBS_CACHE
      .filter((row) => row.customer_id === customer.id)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
    const customerLeads = LEADS_CACHE
      .filter((row) => row.customer_id === customer.id)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());

    const activeJob = customerJobs.find((row) => activeStatuses.has(String(row.status || "").toLowerCase()));
    const activeOrder = customerOrders.find((row) => !["paid", "cancelled"].includes(String(row.status || "").toLowerCase())) || customerOrders[0] || null;
    const activeLead = customerLeads.find((row) => !["converted", "lost", "archived"].includes(String(row.status || "").toLowerCase())) || null;
    const outstanding = customerOrders.reduce((sum, row) => sum + orderAmountDueCents(row), 0);
    const lifetime = customerLifetimeValueCents(customer);
    const focusRecord = activeJob || activeOrder || activeLead;
    if (!focusRecord && !outstanding && lifetime <= 0) return;

    const targetTab = activeJob ? "jobs" : (activeOrder ? "orders" : (activeLead ? "leads" : "customers"));
    const targetId = activeJob?.id || activeOrder?.id || activeLead?.id || customer.id;
    const statusLabel = activeJob
      ? `Job ${titleCaseWords(String(activeJob.status || "scheduled").replace(/_/g, " "))}`
      : (activeOrder
        ? `${titleCaseWords(String(activeOrder.status || "new").replace(/_/g, " "))} ${workspaceOrderLabel(currentWorkspaceBlueprint())}`
        : (activeLead ? `Lead ${titleCaseWords(String(activeLead.status || "new").replace(/_/g, " "))}` : "Customer record"));
    const summary = activeJob?.title
      || activeOrder?.cart_summary
      || activeLead?.title
      || activeLead?.requested_service_type
      || customer.email
      || customer.phone
      || "Customer record";
    const serviceAddress = activeJob?.service_address
      || activeOrder?.service_address
      || customer.service_address
      || customer.billing_address
      || "";
    const monetaryLabel = outstanding > 0
      ? `${formatUsd(outstanding)} open`
      : `${formatUsd(lifetime)} lifetime`;
    const actionHint = activeLead
      ? "Needs response"
      : (activeJob
        ? "Track field work"
        : (activeOrder ? "Track work and payment" : "Open customer"));

    rows.push({
      customerId: customer.id,
      customerName: customer.name || "Unnamed customer",
      targetTab,
      targetId,
      statusLabel,
      summary,
      serviceAddress,
      monetaryLabel,
      actionHint,
      sortValue: outstanding > 0 ? outstanding : lifetime,
    });
  });

  const uniqueRows = uniqList(todayActions.map((item) => item.targetId).filter(Boolean));
  const actionHints = new Map(todayActions.map((item) => [item.targetId, item.title]));
  return rows
    .sort((a, b) => b.sortValue - a.sortValue || a.customerName.localeCompare(b.customerName))
    .map((row) => ({
      ...row,
      actionHint: actionHints.get(row.targetId) || row.actionHint,
      isPriority: uniqueRows.includes(row.targetId),
    }))
    .slice(0, 6);
}
async function sendQueuedFollowUp(item) {
  if (!item?.canSend) throw new Error("This follow-up does not have an email delivery path.");
  const response = await postOperatorFunction("send-follow-up", {
    tenant_id: TENANT_ID,
    customer_id: item.customerId,
    kind: item.kind,
    lead_id: item.leadId || null,
    bid_id: item.bidId || null,
    order_id: item.orderId || null,
    job_id: item.jobId || null,
    subject: item.subject,
    message: item.message,
    contact_email: item.contactEmail,
    contact_name: item.contactName,
    cta_label: item.ctaLabel || null,
    cta_url: item.ctaUrl || null,
  });
  await fetchCustomers();
  setFollowUpQueueMessage(
    response?.skipped
      ? "Follow-up was prepared and logged, but email delivery is not configured in this environment."
      : "Follow-up sent and logged.",
    "ok"
  );
  renderDashboard();
  return response;
}
async function markQueuedFollowUpContacted(item) {
  if (!item?.customerId) throw new Error("This follow-up does not have a linked customer yet.");
  await logCustomerInteraction(
    item.customerId,
    item.channel === "phone" ? "call" : "email",
    `${item.kindLabel} handled from ProofLink queue.`,
    {
      follow_up_kind: item.kind,
      source: "dashboard_queue",
      lead_id: item.leadId || null,
      bid_id: item.bidId || null,
      order_id: item.orderId || null,
      job_id: item.jobId || null,
    }
  );
  await fetchCustomers();
  setFollowUpQueueMessage("Follow-up marked as handled.", "ok");
  renderDashboard();
}
function openQueuedFollowUp(item) {
  if (!item?.tab) return;
  if (item.tab === "leads" && item.targetId) ACTIVE_LEAD_ID = item.targetId;
  if (item.tab === "bids" && item.targetId) ACTIVE_BID_ID = item.targetId;
  if (item.tab === "orders" && item.targetId) ACTIVE_ORDER_ID = item.targetId;
  if (item.tab === "jobs" && item.targetId) ACTIVE_JOB_ID = item.targetId;
  if (item.tab === "customers" && item.customerId) ACTIVE_CUSTOMER_ID = item.customerId;
  switchTab(item.tab);
}
function renderLeadCustomerOptions(selectedCustomerId = "") {
  if (!leadCustomerId) return;
  const options = sortedCustomers(CUSTOMERS_CACHE);
  leadCustomerId.innerHTML = `
    <option value="">Create or link later</option>
    ${options.map((customer) => `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || customer.phone || "Customer")}</option>`).join("")}
  `;
  leadCustomerId.value = options.some((customer) => customer.id === selectedCustomerId) ? selectedCustomerId : "";
}
function clearLeadForm() {
  if (leadId) leadId.value = "";
  if (leadStatus) leadStatus.value = "new";
  if (leadPriority) leadPriority.value = "normal";
  renderLeadCustomerOptions("");
  if (leadTitle) leadTitle.value = "";
  if (leadRequestedService) leadRequestedService.value = "";
  if (leadContactName) leadContactName.value = "";
  if (leadContactEmail) leadContactEmail.value = "";
  if (leadContactPhone) leadContactPhone.value = "";
  if (leadPreferredContact) leadPreferredContact.value = "phone";
  if (leadSourceType) leadSourceType.value = "manual";
  if (leadServiceAddress) leadServiceAddress.value = "";
  if (leadSummary) leadSummary.value = "";
  if (leadNotes) leadNotes.value = "";
  setInlineMessage(leadMsg, "");
}
function populateLeadForm(lead) {
  if (!lead) {
    clearLeadForm();
    return;
  }
  if (leadId) leadId.value = lead.id || "";
  if (leadStatus) leadStatus.value = String(lead.status || "new");
  if (leadPriority) leadPriority.value = String(lead.priority || "normal");
  renderLeadCustomerOptions(lead.customer_id || "");
  if (leadTitle) leadTitle.value = lead.title || "";
  if (leadRequestedService) leadRequestedService.value = lead.requested_service_type || "";
  if (leadContactName) leadContactName.value = lead.contact_name || "";
  if (leadContactEmail) leadContactEmail.value = lead.contact_email || "";
  if (leadContactPhone) leadContactPhone.value = lead.contact_phone || "";
  if (leadPreferredContact) leadPreferredContact.value = lead.preferred_contact || "phone";
  if (leadSourceType) leadSourceType.value = lead.source_type || "manual";
  if (leadServiceAddress) leadServiceAddress.value = lead.service_address || "";
  if (leadSummary) leadSummary.value = lead.summary || "";
  if (leadNotes) leadNotes.value = lead.notes || "";
}
async function renderLeadDetail(leadIdValue) {
  if (!leadDetailWrap) return;
  const lead = LEADS_CACHE.find((row) => row.id === leadIdValue) || null;
  populateLeadForm(lead);
  if (!lead) {
    if (btnLeadOpenBid) btnLeadOpenBid.disabled = true;
    leadDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Lead intake</div><div><strong>Create or select a lead.</strong></div><div class="detail-copy">This record becomes the bridge between the customer conversation and the quote, order, and job that follow.</div></div>`;
    return;
  }
  const linkedCustomer = CUSTOMERS_CACHE.find((row) => row.id === lead.customer_id) || null;
  const linkedBid = findBidRecordById(lead.converted_bid_id);
  const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === lead.converted_order_id) || null;
  leadDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Lead summary</div>
      <div><strong>${escapeHtml(lead.contact_name || lead.title || "Lead")}</strong></div>
      <div class="detail-copy">${escapeHtml(lead.contact_email || "No email")} | ${escapeHtml(lead.contact_phone || "No phone")}</div>
      <div class="detail-copy">Status: ${escapeHtml(String(lead.status || "new").replace(/_/g, " "))} | Priority: ${escapeHtml(String(lead.priority || "normal"))}</div>
      <div class="detail-copy">Requested service: ${escapeHtml(lead.requested_service_type || "Not specified")}</div>
      <div class="detail-copy">Last activity: ${escapeHtml(formatDateTime(lead.last_activity_at || lead.updated_at || lead.created_at))}</div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Workflow links</div>
      <div class="detail-copy">Customer: ${escapeHtml(linkedCustomer?.name || "Not linked yet")}</div>
      <div class="detail-copy">Bid: ${escapeHtml(linkedBid?.title || (lead.converted_bid_id ? "Linked record" : "Not created yet"))}</div>
      <div class="detail-copy">Order: ${escapeHtml(linkedOrder?.customer_name || (lead.converted_order_id ? "Linked order" : "Not created yet"))}</div>
    </div>
  `;
  if (btnLeadOpenBid) {
    btnLeadOpenBid.disabled = !lead.converted_bid_id;
  }
}
function sortedLeads(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(LEADS_CACHE || [])].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  if (!needle) return rows;
  return rows.filter((row) => {
    const haystack = [
      row.title,
      row.contact_name,
      row.contact_email,
      row.contact_phone,
      row.requested_service_type,
      row.summary,
      row.service_address,
      row.status,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
function renderLeads(filter = "") {
  if (!leadsList) return;
  const rows = sortedLeads(filter);
  if (!rows.length) {
    leadsList.innerHTML = `<div class="muted">No leads yet.</div>`;
    ACTIVE_LEAD_ID = null;
    renderLeadDetail(null).catch(console.error);
    return;
  }
  if (!ACTIVE_LEAD_ID || !rows.some((row) => row.id === ACTIVE_LEAD_ID)) ACTIVE_LEAD_ID = rows[0].id;
  const active = rows.find((row) => row.id === ACTIVE_LEAD_ID) || rows[0];
  ACTIVE_LEAD_ID = active.id;
  leadsList.innerHTML = rows.map((row) => `
    <button type="button" class="list-item ${row.id === active.id ? "is-active" : ""}" data-lead-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.contact_name || row.title || "Lead")}</div>
        <div class="li-sub muted">${escapeHtml(row.requested_service_type || "Service request")} | ${escapeHtml(String(row.status || "new").replace(/_/g, " "))}</div>
        <div class="li-sub muted">${escapeHtml(row.service_address || "No service address")}</div>
      </div>
      <div class="li-meta">
        <span class="pill">${escapeHtml(String(row.priority || "normal"))}</span>
      </div>
    </button>
  `).join("");
  leadsList.querySelectorAll("[data-lead-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_LEAD_ID = btn.getAttribute("data-lead-id");
      renderLeads(filter);
    });
  });
  renderLeadDetail(ACTIVE_LEAD_ID).catch(console.error);
}
function renderJobOrderOptions(selectedOrderId = "") {
  if (!jobOrderId) return;
  const rows = [...CRM_ORDERS_CACHE].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  jobOrderId.innerHTML = `
    <option value="">Link order</option>
    ${rows.map((order) => `<option value="${escapeAttr(order.id)}">${escapeHtml(`${order.customer_name || "Customer"} | ${String(order.status || "new")} | ${formatWorkflowPaymentState(orderPaymentState(order))}`)}</option>`).join("")}
  `;
  jobOrderId.value = rows.some((row) => row.id === selectedOrderId) ? selectedOrderId : "";
}
function renderJobCustomerOptions(selectedCustomerId = "") {
  if (!jobCustomerId) return;
  const options = sortedCustomers(CUSTOMERS_CACHE);
  jobCustomerId.innerHTML = `
    <option value="">Link customer</option>
    ${options.map((customer) => `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || customer.phone || "Customer")}</option>`).join("")}
  `;
  jobCustomerId.value = options.some((customer) => customer.id === selectedCustomerId) ? selectedCustomerId : "";
}
function clearJobForm() {
  if (jobId) jobId.value = "";
  if (jobStatus) jobStatus.value = "scheduled";
  renderJobOrderOptions(ACTIVE_ORDER_ID || "");
  renderJobCustomerOptions("");
  if (jobTitle) jobTitle.value = "";
  if (jobServiceAddress) jobServiceAddress.value = "";
  if (jobScheduledDate) jobScheduledDate.value = "";
  if (jobScheduledTime) jobScheduledTime.value = "";
  if (jobScheduleWindow) jobScheduleWindow.value = "";
  if (jobSummary) jobSummary.value = "";
  if (jobNotes) jobNotes.value = "";
  setInlineMessage(jobMsg, "");
}
function populateJobForm(job) {
  if (!job) {
    clearJobForm();
    return;
  }
  if (jobId) jobId.value = job.id || "";
  if (jobStatus) jobStatus.value = String(job.status || "scheduled");
  renderJobOrderOptions(job.order_id || "");
  renderJobCustomerOptions(job.customer_id || "");
  if (jobTitle) jobTitle.value = job.title || "";
  if (jobServiceAddress) jobServiceAddress.value = job.service_address || "";
  if (jobScheduledDate) jobScheduledDate.value = job.scheduled_date || "";
  if (jobScheduledTime) jobScheduledTime.value = job.scheduled_time || "";
  if (jobScheduleWindow) jobScheduleWindow.value = job.schedule_window || "";
  if (jobSummary) jobSummary.value = job.summary || "";
  if (jobNotes) jobNotes.value = job.notes || "";
}
async function renderJobDetail(jobIdValue) {
  if (!jobDetailWrap) return;
  const job = JOBS_CACHE.find((row) => row.id === jobIdValue) || null;
  populateJobForm(job);
  if (!job) {
    if (btnJobOpenOrder) btnJobOpenOrder.disabled = true;
    if (btnJobRecordPayment) btnJobRecordPayment.disabled = true;
    jobDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Job execution</div><div><strong>Create or select a job.</strong></div><div class="detail-copy">This becomes the execution record tied back to the customer, order, and payment state.</div></div>`;
    return;
  }
  const order = linkedOrderForJob(job);
  const depositStatus = orderDepositStatus(order);
  const revenueCents = jobRevenueCents(job, order);
  const costCents = jobTrackedCostCents(job, order);
  const grossProfitCents = jobGrossProfitCents(job, order);
  const marginRatio = jobMarginRatio(job, order);
  const trackedExpenses = trackedJobExpenses(job, order);
  const laborCostCents = trackedExpenses.filter((expense) => normalizeExpenseType(expense.expense_type) === "labor" || expenseHasLaborDetail(expense))
    .reduce((sum, expense) => sum + expenseAmountCents(expense), 0);
  const laborHours = trackedExpenses.reduce((sum, expense) => sum + expenseLaborHoursValue(expense), 0);
  const materialCostCents = trackedExpenses.filter((expense) => normalizeExpenseType(expense.expense_type) === "material" || expenseHasMaterialDetail(expense))
    .reduce((sum, expense) => sum + expenseAmountCents(expense), 0);
  const changeOrderCostCents = trackedExpenses.filter((expense) => expenseIsChangeOrder(expense))
    .reduce((sum, expense) => sum + expenseAmountCents(expense), 0);
  const leftoverNotes = uniqList(trackedExpenses.flatMap((expense) => expenseLeftoverNotes(expense))).slice(0, 3);
  const wasteNotes = uniqList(trackedExpenses.flatMap((expense) => expenseWasteNotes(expense))).slice(0, 3);
  jobDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Execution summary</div>
      <div><strong>${escapeHtml(job.title || "Job")}</strong></div>
      <div class="detail-copy">Status: ${escapeHtml(String(job.status || "scheduled").replace(/_/g, " "))}</div>
      <div class="detail-copy">Scheduled: ${escapeHtml(String(job.scheduled_date || "No date"))} | ${escapeHtml(String(job.scheduled_time || "No time"))}</div>
      <div class="detail-copy">Payment: <span class="pill ${paymentStateClass(job.payment_state || orderPaymentState(order))}">${escapeHtml(formatWorkflowPaymentState(job.payment_state || orderPaymentState(order)))}</span></div>
      ${order ? `<div class="detail-copy">Deposit: <span class="pill ${depositStatusClass(depositStatus)}">${escapeHtml(formatDepositStatus(depositStatus))}</span>${orderDepositGapCents(order) > 0 ? ` | ${formatUsd(orderDepositGapCents(order))} still open` : ""}</div>` : ""}
      <div class="detail-copy">Due: ${formatUsd(Number(job.amount_due_cents || orderAmountDueCents(order) || 0))}</div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Job economics</div>
      <div class="workspace-chip-row">
        <span class="pill">Revenue ${escapeHtml(formatUsd(revenueCents))}</span>
        <span class="pill">Tracked cost ${escapeHtml(formatUsd(costCents))}</span>
        <span class="pill ${grossProfitToneClass(grossProfitCents)}">Gross profit ${escapeHtml(formatUsd(grossProfitCents))}</span>
        <span class="pill ${marginToneClass(marginRatio)}">Margin ${escapeHtml(formatPercent(marginRatio))}</span>
      </div>
      <div class="detail-copy">${trackedExpenses.length ? `${trackedExpenses.length} linked job cost${trackedExpenses.length === 1 ? "" : "s"} are shaping this margin right now.` : "No linked job costs yet. Log labor, materials, or vendor spend against this job to make the margin real."}</div>
      ${trackedExpenses.length ? `
        <div class="workspace-chip-row">
          <span class="pill">Labor ${escapeHtml(formatUsd(laborCostCents))}${laborHours > 0 ? ` • ${escapeHtml(String(Number(laborHours.toFixed(2))))}h` : ""}</span>
          <span class="pill">Materials ${escapeHtml(formatUsd(materialCostCents))}</span>
          ${changeOrderCostCents > 0 ? `<span class="pill pill-warn">Change-order cost ${escapeHtml(formatUsd(changeOrderCostCents))}</span>` : ``}
        </div>
      ` : ``}
      ${leftoverNotes.length ? `<div class="detail-copy">Leftovers: ${escapeHtml(leftoverNotes.join(" | "))}</div>` : ``}
      ${wasteNotes.length ? `<div class="detail-copy">Waste / overage: ${escapeHtml(wasteNotes.join(" | "))}</div>` : ``}
      <div class="row" style="margin-top:12px;">
        <button type="button" class="btn btn-ghost" data-job-cost-action="log" data-job-id="${escapeAttr(job.id)}">Log job cost</button>
      </div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Linked work</div>
      <div class="detail-copy">Order: ${escapeHtml(order?.customer_name || "Not linked")}</div>
      <div class="detail-copy">Customer: ${escapeHtml((CUSTOMERS_CACHE.find((row) => row.id === job.customer_id) || {}).name || "Not linked")}</div>
      <div class="detail-copy">${escapeHtml(job.service_address || "No service address recorded")}</div>
    </div>
  `;
  jobDetailWrap.querySelector('[data-job-cost-action="log"]')?.addEventListener("click", () => openExpenseForJob(job));
  if (btnJobOpenOrder) btnJobOpenOrder.disabled = !job.order_id;
  if (btnJobRecordPayment) btnJobRecordPayment.disabled = !job.order_id;
}
function sortedJobs(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(JOBS_CACHE || [])].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  if (!needle) return rows;
  return rows.filter((row) => {
    const order = linkedOrderForJob(row);
    const haystack = [
      row.title,
      row.service_address,
      row.summary,
      row.notes,
      row.status,
      order?.customer_name,
      order?.email,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
function renderJobs(filter = "") {
  if (!jobsList) return;
  const rows = sortedJobs(filter);
  if (!rows.length) {
    jobsList.innerHTML = `<div class="muted">No jobs yet.</div>`;
    ACTIVE_JOB_ID = null;
    renderJobDetail(null).catch(console.error);
    return;
  }
  if (!ACTIVE_JOB_ID || !rows.some((row) => row.id === ACTIVE_JOB_ID)) ACTIVE_JOB_ID = rows[0].id;
  const active = rows.find((row) => row.id === ACTIVE_JOB_ID) || rows[0];
  ACTIVE_JOB_ID = active.id;
  jobsList.innerHTML = rows.map((row) => {
    const order = linkedOrderForJob(row);
    const customer = CUSTOMERS_CACHE.find((customerRow) => customerRow.id === row.customer_id) || null;
    const customerLabel = customer?.name || order?.customer_name || "Unlinked customer";
    const paymentState = row.payment_state || orderPaymentState(order);
    const marginRatio = jobMarginRatio(row, order);
    return `
      <button type="button" class="list-item ${row.id === active.id ? "is-active" : ""}" data-job-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.title || order?.customer_name || "Job")}</div>
          <div class="li-sub muted">${escapeHtml(customerLabel)}</div>
          <div class="li-sub muted">${escapeHtml(String(row.status || "scheduled").replace(/_/g, " "))} | ${escapeHtml(String(row.scheduled_date || "No date"))}</div>
          <div class="li-sub muted">${escapeHtml(row.service_address || "No service address")}</div>
          <div class="li-sub muted">Revenue ${escapeHtml(formatUsd(jobRevenueCents(row, order)))} | Cost ${escapeHtml(formatUsd(jobTrackedCostCents(row, order)))} | Margin ${escapeHtml(formatPercent(marginRatio))}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${paymentStateClass(paymentState)}">${escapeHtml(formatWorkflowPaymentState(paymentState))}</span>
        </div>
      </button>
    `;
  }).join("");
  jobsList.querySelectorAll("[data-job-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_JOB_ID = btn.getAttribute("data-job-id");
      renderJobs(filter);
    });
  });
  renderJobDetail(ACTIVE_JOB_ID).catch(console.error);
}
function renderPlanCustomerOptions(selectedCustomerId = "") {
  if (!planCustomerId) return;
  const options = [`<option value="">Select customer</option>`];
  sortedCustomers(CUSTOMERS_CACHE).forEach((customer) => {
    options.push(`<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || "Customer")}</option>`);
  });
  planCustomerId.innerHTML = options.join("");
  planCustomerId.value = selectedCustomerId || "";
}
function renderPlanOrderOptions(selectedOrderId = "") {
  if (!planSourceOrderId) return;
  const rows = [...CRM_ORDERS_CACHE].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const options = [`<option value="">Start without a source order</option>`];
  rows.forEach((order) => {
    const label = order.customer_name || order.cart_summary || "Tracked order";
    options.push(`<option value="${escapeAttr(order.id)}">${escapeHtml(label)} - ${escapeHtml(formatUsd(orderTotalCents(order)))}</option>`);
  });
  planSourceOrderId.innerHTML = options.join("");
  planSourceOrderId.value = selectedOrderId || "";
}
function todayDateValue(offsetDays = 0) {
  const next = new Date();
  next.setDate(next.getDate() + Number(offsetDays || 0));
  next.setHours(0, 0, 0, 0);
  return next.toISOString().slice(0, 10);
}
function normalizeServicePlanItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      name: String(item?.name || item?.title || "Recurring service").trim(),
      description: String(item?.description || "").trim(),
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unit: String(item?.unit || "visit").trim() || "visit",
      kind: String(item?.kind || "base").trim() || "base",
      unitPriceCents: Math.max(0, Number(item?.unitPriceCents ?? item?.unit_price_cents ?? 0)),
      totalCents: Math.max(0, Number(item?.totalCents ?? item?.total_cents ?? 0)),
    }))
    .filter((item) => item.name);
}
function buildPlanLineItems(sourceOrder, existingItems, titleValue, amountCents) {
  const sourceItems = normalizeServicePlanItems(sourceOrder?.items || []);
  if (sourceItems.length) return sourceItems;
  const preserved = normalizeServicePlanItems(existingItems || []);
  if (preserved.length) return preserved;
  const price = Math.max(0, Number(amountCents || 0));
  return [{
    name: String(titleValue || sourceOrder?.cart_summary || sourceOrder?.customer_name || "Recurring service").trim() || "Recurring service",
    description: "",
    quantity: 1,
    unit: "visit",
    kind: "base",
    unitPriceCents: price,
    totalCents: price,
  }];
}
function clearPlanForm() {
  ACTIVE_PLAN_ID = null;
  if (planId) planId.value = "";
  if (planStatus) planStatus.value = "draft";
  renderPlanCustomerOptions("");
  renderPlanOrderOptions(ACTIVE_ORDER_ID || "");
  if (planTitle) planTitle.value = "";
  if (planServiceAddress) planServiceAddress.value = "";
  if (planCadence) planCadence.value = "monthly";
  if (planIntervalDays) planIntervalDays.value = "";
  if (planNextRunOn) planNextRunOn.value = todayDateValue(30);
  if (planAmount) planAmount.value = "";
  if (planDepositAmount) planDepositAmount.value = "";
  if (planAutoCreateJob) planAutoCreateJob.checked = true;
  if (planScheduleWindow) planScheduleWindow.value = "";
  if (planSummary) planSummary.value = "";
  if (planNotes) planNotes.value = "";
  if (btnGeneratePlanOrder) btnGeneratePlanOrder.disabled = true;
  if (btnOpenPlanOrder) btnOpenPlanOrder.disabled = true;
  setInlineMessage(planMsg, "");
}
function populatePlanForm(plan) {
  if (!plan) {
    clearPlanForm();
    return;
  }
  if (planId) planId.value = plan.id || "";
  if (planStatus) planStatus.value = String(plan.status || "draft");
  renderPlanCustomerOptions(plan.customer_id || "");
  renderPlanOrderOptions(plan.source_order_id || "");
  if (planTitle) planTitle.value = plan.title || "";
  if (planServiceAddress) planServiceAddress.value = plan.service_address || "";
  if (planCadence) planCadence.value = String(plan.cadence || "monthly");
  if (planIntervalDays) planIntervalDays.value = plan.custom_interval_days || "";
  if (planNextRunOn) planNextRunOn.value = plan.next_run_on || "";
  if (planAmount) planAmount.value = money(servicePlanAmountCents(plan));
  if (planDepositAmount) planDepositAmount.value = money(Number(plan.deposit_required_cents || 0));
  if (planAutoCreateJob) planAutoCreateJob.checked = plan.auto_create_job !== false;
  if (planScheduleWindow) planScheduleWindow.value = plan.schedule_window || "";
  if (planSummary) planSummary.value = plan.summary || "";
  if (planNotes) planNotes.value = plan.notes || "";
  if (btnGeneratePlanOrder) btnGeneratePlanOrder.disabled = String(plan.status || "").toLowerCase() !== "active";
  if (btnOpenPlanOrder) btnOpenPlanOrder.disabled = !plan.last_generated_order_id;
}
async function renderPlanDetail(planIdValue) {
  if (!planDetailWrap) return;
  if (!SERVICE_PLANS_FEATURE_READY) {
    if (btnGeneratePlanOrder) btnGeneratePlanOrder.disabled = true;
    if (btnOpenPlanOrder) btnOpenPlanOrder.disabled = true;
    planDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Recurring plans</div><div><strong>Database upgrade required.</strong></div><div class="detail-copy">Run sql/service_recurring_plans.sql in Supabase before using recurring service plans in this workspace.</div></div>`;
    return;
  }
  const plan = SERVICE_PLANS_CACHE.find((row) => row.id === planIdValue) || null;
  populatePlanForm(plan);
  if (!plan) {
    planDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Recurring rhythm</div><div><strong>Create or select a plan.</strong></div><div class="detail-copy">Recurring plans keep repeat work from turning back into manual follow-up and forgotten next steps.</div></div>`;
    return;
  }
  const customer = CUSTOMERS_CACHE.find((row) => row.id === plan.customer_id) || null;
  const sourceOrder = CRM_ORDERS_CACHE.find((row) => row.id === plan.source_order_id) || null;
  const lastOrder = CRM_ORDERS_CACHE.find((row) => row.id === plan.last_generated_order_id) || null;
  const dueNow = dueServicePlans().some((row) => row.id === plan.id);
  planDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Recurring summary</div>
      <div><strong>${escapeHtml(plan.title || "Recurring plan")}</strong></div>
      <div class="detail-copy">${escapeHtml(customer?.name || "No linked customer")} | ${escapeHtml(planCadenceLabel(plan.cadence, plan.custom_interval_days))}</div>
      <div class="detail-copy">Next run: ${escapeHtml(servicePlanNextRunLabel(plan))}${dueNow ? " | Due now" : ""}</div>
      <div class="detail-copy">Amount: ${formatUsd(servicePlanAmountCents(plan))} | Deposit: ${formatUsd(Number(plan.deposit_required_cents || 0))}</div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Source and automation</div>
      <div class="detail-copy">Source order: ${escapeHtml(sourceOrder?.customer_name || sourceOrder?.cart_summary || "No source order")}</div>
      <div class="detail-copy">Auto-create job: ${plan.auto_create_job !== false ? "On" : "Off"}</div>
      <div class="detail-copy">${escapeHtml(plan.service_address || customer?.service_address || "No service address recorded")}</div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Last generated work</div>
      <div class="detail-copy">Last order: ${escapeHtml(lastOrder?.customer_name || lastOrder?.cart_summary || "None yet")}</div>
      <div class="detail-copy">${lastOrder ? `${escapeHtml(formatWorkflowPaymentState(orderPaymentState(lastOrder)))} | ${formatUsd(orderAmountDueCents(lastOrder))} due` : "Generate the next order when this plan is ready to create work."}</div>
      <div class="detail-copy">${escapeHtml(plan.notes || "Use notes for site access, seasonal adjustments, and handoff reminders.")}</div>
    </div>
  `;
}
function sortedServicePlans(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(SERVICE_PLANS_CACHE || [])].sort((a, b) => {
    const dueDiff = servicePlanNextRunTime(a) - servicePlanNextRunTime(b);
    if (dueDiff) return dueDiff;
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  });
  if (!needle) return rows;
  return rows.filter((plan) => {
    const customer = CUSTOMERS_CACHE.find((row) => row.id === plan.customer_id) || null;
    const haystack = [
      plan.title,
      plan.service_address,
      plan.summary,
      plan.notes,
      plan.status,
      customer?.name,
      customer?.email,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
function renderPlans(filter = "") {
  if (!plansList) return;
  if (!SERVICE_PLANS_FEATURE_READY) {
    plansList.innerHTML = `<div class="muted">Recurring plans are not enabled in this environment yet. Run sql/service_recurring_plans.sql.</div>`;
    ACTIVE_PLAN_ID = null;
    renderPlanDetail(null).catch(console.error);
    return;
  }
  const rows = sortedServicePlans(filter);
  if (!rows.length) {
    plansList.innerHTML = `<div class="muted">No recurring plans yet.</div>`;
    ACTIVE_PLAN_ID = null;
    renderPlanDetail(null).catch(console.error);
    return;
  }
  if (!ACTIVE_PLAN_ID || !rows.some((row) => row.id === ACTIVE_PLAN_ID)) ACTIVE_PLAN_ID = rows[0].id;
  const active = rows.find((row) => row.id === ACTIVE_PLAN_ID) || rows[0];
  ACTIVE_PLAN_ID = active.id;
  plansList.innerHTML = rows.map((plan) => {
    const customer = CUSTOMERS_CACHE.find((row) => row.id === plan.customer_id) || null;
    const dueNow = dueServicePlans().some((row) => row.id === plan.id);
    return `
      <button type="button" class="list-item ${plan.id === active.id ? "is-active" : ""}" data-plan-id="${escapeAttr(plan.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(plan.title || "Recurring plan")}</div>
          <div class="li-sub muted">${escapeHtml(customer?.name || "No linked customer")}</div>
          <div class="li-sub muted">${escapeHtml(planCadenceLabel(plan.cadence, plan.custom_interval_days))} | Next run ${escapeHtml(servicePlanNextRunLabel(plan))}</div>
          <div class="li-sub muted">${escapeHtml(plan.service_address || "No service address")}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${dueNow ? "pill-bad" : (String(plan.status || "").toLowerCase() === "active" ? "pill-on" : "")}">${escapeHtml(dueNow ? "Due now" : titleCaseWords(plan.status || "draft"))}</span>
          <span class="pill">${formatUsd(servicePlanAmountCents(plan))}</span>
        </div>
      </button>
    `;
  }).join("");
  plansList.querySelectorAll("[data-plan-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_PLAN_ID = btn.getAttribute("data-plan-id");
      renderPlans(filter);
    });
  });
  renderPlanDetail(ACTIVE_PLAN_ID).catch(console.error);
}
async function saveServicePlanRecord(fields = {}) {
  const nowIso = new Date().toISOString();
  const existing = currentServicePlan();
  const sourceOrder = CRM_ORDERS_CACHE.find((row) => row.id === (fields.source_order_id || planSourceOrderId?.value || existing?.source_order_id || "")) || null;
  const customerIdValue = fields.customer_id || planCustomerId?.value || sourceOrder?.customer_id || existing?.customer_id || "";
  if (!customerIdValue) throw new Error("Link the recurring plan to a customer before saving it.");
  const cadenceValue = String(fields.cadence || planCadence?.value || existing?.cadence || "monthly").trim().toLowerCase();
  const intervalDays = cadenceValue === "custom_days"
    ? Math.max(1, Number(fields.custom_interval_days || planIntervalDays?.value || existing?.custom_interval_days || 0))
    : null;
  if (cadenceValue === "custom_days" && intervalDays < 7) {
    throw new Error("Custom day cadence must be at least 7 days.");
  }
  const statusValue = String(fields.status || planStatus?.value || existing?.status || "draft").trim().toLowerCase();
  const nextRunValue = String(fields.next_run_on || planNextRunOn?.value || existing?.next_run_on || "").trim();
  if (statusValue === "active" && !nextRunValue) {
    throw new Error("Active recurring plans need a next run date.");
  }
  const titleValue = String(fields.title || planTitle?.value || existing?.title || sourceOrder?.cart_summary || "").trim();
  const amountCents = toCents(fields.amount_dollars ?? planAmount?.value ?? money(servicePlanAmountCents(existing)));
  const depositCents = toCents(fields.deposit_dollars ?? planDepositAmount?.value ?? money(Number(existing?.deposit_required_cents || 0)));
  const lineItems = buildPlanLineItems(
    sourceOrder,
    fields.line_items || existing?.line_items,
    titleValue,
    amountCents
  );
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: customerIdValue,
    source_order_id: sourceOrder?.id || null,
    status: statusValue,
    title: titleValue || "Recurring service",
    cadence: cadenceValue,
    custom_interval_days: intervalDays,
    next_run_on: nextRunValue || null,
    auto_create_job: fields.auto_create_job ?? planAutoCreateJob?.checked ?? (existing?.auto_create_job !== false),
    service_address: String(fields.service_address || planServiceAddress?.value || existing?.service_address || sourceOrder?.service_address || "").trim(),
    schedule_window: String(fields.schedule_window || planScheduleWindow?.value || existing?.schedule_window || sourceOrder?.schedule_window || sourceOrder?.scheduled_time || "").trim(),
    summary: String(fields.summary || planSummary?.value || existing?.summary || sourceOrder?.cart_summary || "").trim(),
    notes: String(fields.notes || planNotes?.value || existing?.notes || sourceOrder?.notes || "").trim(),
    line_items: lineItems,
    amount_cents: amountCents,
    deposit_required_cents: depositCents,
    updated_at: nowIso,
  });
  const idValue = fields.id || planId?.value || existing?.id || "";
  const query = idValue
    ? sb.from("service_plans").update(payload).eq("id", idValue).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("service_plans").insert({ ...payload, created_at: nowIso });
  const { data, error } = await query.select("*").single();
  if (error) {
    if (isMissingDatabaseFeatureError(error, ["service_plans"])) {
      throw new Error("Recurring plans need the service_recurring_plans.sql migration before they can be saved.");
    }
    throw error;
  }
  ACTIVE_PLAN_ID = data.id;
  await fetchServicePlans();
  renderPlans(planSearch?.value || "");
  renderDashboard();
  renderGuidance();
  renderMoney().catch(console.error);
  return SERVICE_PLANS_CACHE.find((row) => row.id === data.id) || data;
}
async function createServicePlanFromOrderRecord(order) {
  if (!order?.id) throw new Error("Select an order before creating a recurring plan.");
  const existing = SERVICE_PLANS_CACHE.find((plan) => plan.source_order_id === order.id && String(plan.status || "").toLowerCase() !== "cancelled") || null;
  if (existing) {
    ACTIVE_PLAN_ID = existing.id;
    renderPlans(planSearch?.value || "");
    return { plan: existing, existing: true };
  }
  const customer = CUSTOMERS_CACHE.find((row) => row.id === order.customer_id) || null;
  const plan = await saveServicePlanRecord({
    status: "active",
    customer_id: order.customer_id || customer?.id || "",
    source_order_id: order.id,
    title: order.cart_summary || `${order.customer_name || "Customer"} recurring service`,
    cadence: "monthly",
    next_run_on: order.scheduled_date || todayDateValue(30),
    amount_dollars: money(orderTotalCents(order)),
    deposit_dollars: money(orderDepositRequiredCents(order)),
    auto_create_job: true,
    service_address: order.service_address || customer?.service_address || customer?.billing_address || "",
    schedule_window: order.schedule_window || order.scheduled_time || "",
    summary: order.cart_summary || "",
    notes: order.notes || "",
    line_items: normalizeServicePlanItems(order.items || []),
  });
  return { plan, existing: false };
}
async function runServicePlanRecord(plan, options = {}) {
  if (!plan?.id) throw new Error("Select a recurring plan before generating work.");
  const { data, error } = await sb.rpc("create_order_from_service_plan", {
    p_plan_id: plan.id,
    p_force: options.force === true,
  });
  if (error) {
    if (isMissingDatabaseFeatureError(error, ["create_order_from_service_plan"])) {
      throw new Error("Recurring plan generation needs the service_recurring_plans.sql migration.");
    }
    throw error;
  }
  await Promise.all([fetchServicePlans(), fetchCrmOrders(), fetchJobs(), fetchPayments()]);
  let order = CRM_ORDERS_CACHE.find((row) => row.id === data?.order_id) || null;
  if (order) {
    order = await seedOrderDepositDefaults(order, {
      depositRequiredCents: Number(order.deposit_required_cents || plan.deposit_required_cents || 0),
      depositPolicy: Number(order.deposit_required_cents || plan.deposit_required_cents || 0) > 0 ? "required_before_job" : "optional",
      depositDueDate: order.scheduled_date || order.payment_due_date || plan.next_run_on || null,
    });
    ACTIVE_ORDER_ID = order.id;
  }
  if (data?.job_id) ACTIVE_JOB_ID = data.job_id;
  ACTIVE_PLAN_ID = plan.id;
  renderPlans(planSearch?.value || "");
  renderOrders();
  renderJobs(jobSearch?.value || "");
  renderDashboard();
  renderGuidance();
  renderMoney().catch(console.error);
  return { order, jobId: data?.job_id || null, existing: !!data?.existing };
}
async function runDueServicePlans() {
  const due = dueServicePlans();
  if (!due.length) return { created: 0, existing: 0 };
  const { data, error } = await sb.rpc("generate_due_service_plans", {
    p_tenant_id: TENANT_ID,
  });
  if (!error) {
    await Promise.all([fetchServicePlans(), fetchCrmOrders(), fetchJobs(), fetchPayments()]);
    const duePlanIds = new Set(due.map((plan) => plan.id));
    await Promise.allSettled(
      SERVICE_PLANS_CACHE
        .filter((plan) => duePlanIds.has(plan.id) && plan.last_generated_order_id)
        .map((plan) => {
          const order = CRM_ORDERS_CACHE.find((row) => row.id === plan.last_generated_order_id) || null;
          if (!order) return null;
          return seedOrderDepositDefaults(order, {
            depositRequiredCents: Number(order.deposit_required_cents || plan.deposit_required_cents || 0),
            depositPolicy: Number(order.deposit_required_cents || plan.deposit_required_cents || 0) > 0 ? "required_before_job" : "optional",
            depositDueDate: order.scheduled_date || order.payment_due_date || plan.next_run_on || null,
          });
        })
        .filter(Boolean)
    );
    renderPlans(planSearch?.value || "");
    renderOrders();
    renderJobs(jobSearch?.value || "");
    renderDashboard();
    renderGuidance();
    renderMoney().catch(console.error);
    return {
      created: Number(data?.created_count || 0),
      existing: Number(data?.existing_count || 0),
    };
  }
  if (!isMissingDatabaseFeatureError(error, ["generate_due_service_plans"])) throw error;
  let created = 0;
  let existing = 0;
  for (const plan of due) {
    const result = await runServicePlanRecord(plan);
    if (result?.existing) existing += 1;
    else created += 1;
  }
  return { created, existing };
}
async function saveLeadRecord(fields = {}) {
  const nowIso = new Date().toISOString();
  const rawCustomerId = fields.customer_id || leadCustomerId?.value || "";
  let resolvedCustomerId = rawCustomerId;
  const contactName = String(fields.contact_name ?? leadContactName?.value ?? "").trim();
  const contactEmail = String(fields.contact_email ?? leadContactEmail?.value ?? "").trim().toLowerCase();
  const contactPhone = String(fields.contact_phone ?? leadContactPhone?.value ?? "").trim();
  if (!resolvedCustomerId && (contactName || contactEmail || contactPhone)) {
    const existing = findExistingCustomerRecord({ name: contactName, email: contactEmail, phone: contactPhone });
    const customer = existing || await saveCustomerRecord({
      name: contactName || fields.title || leadTitle?.value || "Customer",
      email: contactEmail || null,
      phone: contactPhone || null,
      preferred_contact: fields.preferred_contact || leadPreferredContact?.value || "phone",
      notes: fields.notes || leadNotes?.value || "",
    });
    resolvedCustomerId = customer?.id || "";
  }
  if (!resolvedCustomerId && !contactName && !contactEmail && !contactPhone) {
    throw new Error("Link a customer or capture contact details before saving the lead.");
  }
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: resolvedCustomerId || null,
    status: fields.status || leadStatus?.value || "new",
    priority: fields.priority || leadPriority?.value || "normal",
    source_type: fields.source_type || leadSourceType?.value || "manual",
    title: fields.title || leadTitle?.value?.trim() || "",
    requested_service_type: fields.requested_service_type || leadRequestedService?.value?.trim() || "",
    service_address: fields.service_address || leadServiceAddress?.value?.trim() || "",
    contact_name: contactName || null,
    contact_email: contactEmail || null,
    contact_phone: contactPhone || null,
    preferred_contact: fields.preferred_contact || leadPreferredContact?.value || "phone",
    summary: fields.summary || leadSummary?.value?.trim() || "",
    notes: fields.notes || leadNotes?.value?.trim() || "",
    metadata: {
      submitted_via: "operator_console",
      ...(fields.metadata && typeof fields.metadata === "object" ? fields.metadata : {}),
    },
    last_activity_at: nowIso,
    updated_at: nowIso,
  });
  const id = fields.id || leadId?.value || "";
  const query = id
    ? sb.from("leads").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("leads").insert({ ...payload, created_at: nowIso });
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  ACTIVE_LEAD_ID = data.id;
  await fetchLeads();
  renderLeads(leadSearch?.value || "");
  renderDashboard();
  renderGuidance();
  return data;
}
async function createBidFromLeadRecord(lead, options = {}) {
  if (!lead?.id) throw new Error("Save the lead before creating a bid.");
  if (lead.converted_bid_id) {
    await Promise.all([fetchLeads(), loadPersistedBids()]);
    const existingBid = findBidRecordById(lead.converted_bid_id);
    if (existingBid) {
      ACTIVE_BID_ID = existingBid.id;
      return { bid: existingBid, existing: true };
    }
  }

  const profile = normalizeBidProfile(options.profile || preferredBidProfile());
  const { data, error } = await sb.rpc("create_bid_from_lead", {
    p_lead_id: lead.id,
    p_profile: profile,
  });

  if (!error) {
    await Promise.all([fetchLeads(), loadPersistedBids()]);
    const bid = findBidRecordById(data?.bid_id) || BIDS_CACHE[0] || null;
    if (bid) ACTIVE_BID_ID = bid.id;
    return { bid, existing: !!data?.existing };
  }
  if (!isMissingDatabaseFeatureError(error, ["create_bid_from_lead"])) throw error;

  const nowIso = new Date().toISOString();
  const draft = {
    ...emptyBidDraft(),
    title: lead.title || lead.requested_service_type || "Service quote",
    customer_id: lead.customer_id || "",
    lead_id: lead.id,
    profile,
    status: "draft",
    walkthrough_at: nowIso,
    service_address: lead.service_address || "",
    project_summary: lead.summary || "",
    internal_notes: lead.notes || "",
    created_at: nowIso,
    updated_at: nowIso,
  };
  const rowPayload = bidRowFromDraft(draft);
  const { data: bidRow, error: bidError } = await sb.from("bids")
    .insert({ ...rowPayload, created_at: nowIso, updated_at: nowIso })
    .select("*")
    .single();
  if (bidError) throw bidError;

  const { error: leadError } = await sb.from("leads")
    .update({
      converted_bid_id: bidRow.id,
      status: "quoted",
      last_activity_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", lead.id)
    .eq(OPERATOR_COLUMN, opId())
    .eq(TENANT_COLUMN, TENANT_ID);
  if (leadError) throw leadError;

  await Promise.all([fetchLeads(), loadPersistedBids()]);
  const bid = findBidRecordById(bidRow.id) || draftFromBidRow(bidRow);
  if (bid) ACTIVE_BID_ID = bid.id;
  return { bid, existing: false };
}
async function saveJobRecord(fields = {}) {
  const nowIso = new Date().toISOString();
  const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (fields.order_id || jobOrderId?.value || ""));
  if (linkedOrder) assertOrderAllowsJobCreation(linkedOrder);
  const payload = withTenantScope({
    operator_id: opId(),
    order_id: fields.order_id || jobOrderId?.value || null,
    customer_id: fields.customer_id || jobCustomerId?.value || linkedOrder?.customer_id || null,
    status: fields.status || jobStatus?.value || "scheduled",
    title: fields.title || jobTitle?.value?.trim() || linkedOrder?.cart_summary || "",
    service_address: fields.service_address || jobServiceAddress?.value?.trim() || "",
    scheduled_date: fields.scheduled_date || jobScheduledDate?.value || null,
    scheduled_time: fields.scheduled_time || jobScheduledTime?.value?.trim() || null,
    schedule_window: fields.schedule_window || jobScheduleWindow?.value?.trim() || null,
    summary: fields.summary || jobSummary?.value?.trim() || "",
    notes: fields.notes || jobNotes?.value?.trim() || "",
    updated_at: nowIso,
  });
  if (!payload.order_id) throw new Error("Link the job to an order before saving it.");
  const id = fields.id || jobId?.value || "";
  const query = id
    ? sb.from("jobs").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("jobs").insert({ ...payload, created_at: nowIso });
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  ACTIVE_JOB_ID = data.id;
  await Promise.all([fetchJobs(), fetchCrmOrders()]);
  renderJobs(jobSearch?.value || "");
  renderOrders();
  renderDashboard();
  renderGuidance();
  return data;
}
async function createJobFromOrderRecord(order) {
  if (!order?.id) throw new Error("Select an order before creating a job.");
  assertOrderAllowsJobCreation(order);
  const existingJob = JOBS_CACHE.find((row) => row.order_id === order.id || row.id === order.primary_job_id) || null;
  if (existingJob) return { job: existingJob, existing: true };

  const { data, error } = await sb.rpc("create_job_from_order", { p_order_id: order.id });
  if (!error) {
    await Promise.all([fetchJobs(), fetchCrmOrders()]);
    const job = JOBS_CACHE.find((row) => row.id === data?.job_id || row.order_id === order.id) || null;
    if (!job) throw new Error("The job was created, but it could not be reloaded.");
    ACTIVE_JOB_ID = job.id;
    return { job, existing: !!data?.existing };
  }
  if (!isMissingDatabaseFeatureError(error, ["create_job_from_order"])) throw error;

  const customer = CUSTOMERS_CACHE.find((row) => row.id === order.customer_id) || null;
  if (!customer && !order.customer_id) {
    throw new Error("Link the order to a customer before creating a job.");
  }
  const linkedBid = order.bid_id ? findBidRecordById(order.bid_id) : null;
  const nowIso = new Date().toISOString();
  const payload = withTenantScope({
    operator_id: order.operator_id || opId(),
    order_id: order.id,
    customer_id: order.customer_id || customer?.id || null,
    bid_id: order.bid_id || null,
    status: "scheduled",
    title: linkedBid?.title || order.cart_summary || order.customer_name || "Service job",
    service_address: linkedBid?.service_address || customer?.service_address || customer?.billing_address || "",
    scheduled_date: order.scheduled_date || null,
    scheduled_time: order.scheduled_time || null,
    schedule_window: linkedBid?.schedule_window || null,
    summary: order.cart_summary || linkedBid?.project_summary || "Tracked service work",
    notes: order.notes || "",
    payment_state: orderPaymentState(order),
    amount_paid_cents: orderAmountPaidCents(order),
    amount_due_cents: orderAmountDueCents(order),
    updated_at: nowIso,
  });
  const { data: jobRow, error: jobError } = await sb.from("jobs")
    .insert({ ...payload, created_at: nowIso })
    .select("*")
    .single();
  if (jobError) throw jobError;

  const nextStatus = ["new", "quoted"].includes(String(order.status || "").toLowerCase()) ? "confirmed" : order.status;
  await Promise.allSettled([
    sb.from("orders")
      .update({
        primary_job_id: jobRow.id,
        booked_at: order.booked_at || nowIso,
        status: nextStatus,
        updated_at: nowIso,
      })
      .eq("id", order.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID),
    order.lead_id
      ? sb.from("leads")
        .update({
          converted_job_id: jobRow.id,
          last_activity_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", order.lead_id)
        .eq(OPERATOR_COLUMN, opId())
        .eq(TENANT_COLUMN, TENANT_ID)
      : Promise.resolve(),
  ]);

  await Promise.all([fetchJobs(), fetchCrmOrders(), fetchLeads()]);
  const job = JOBS_CACHE.find((row) => row.id === jobRow.id) || jobRow;
  ACTIVE_JOB_ID = job.id;
  return { job, existing: false };
}
function renderDashboard() {
  if (!dashboardWrap) return;

  const blueprint = currentWorkspaceBlueprint();
  const summary = workspaceSummaryData(blueprint);
  const pipeline = servicePipelineSnapshot();
  const todayActions = todayActionItems();
  const trackedClients = dashboardClientTrackerRows(todayActions);
  const followUps = buildFollowUpQueue();
  CURRENT_FOLLOW_UP_QUEUE = followUps;
  const currentExpenses = currentMonthExpenseCents();
  const quotedRevenue = quotedRevenueCents();
  const activeOfferings = PRODUCTS_CACHE.filter((p) => !!p.is_active).length;
  const topCustomer = sortedCustomers(CUSTOMERS_CACHE)[0] || null;
  const staleLeadRows = staleLeads();
  const completedUnpaid = completedUnpaidOrders();
  const duePlans = dueServicePlans();
  const depositRiskOrders = ordersMissingDeposits();
  const completedUnpaidBalance = completedUnpaid.reduce((sum, row) => sum + orderAmountDueCents(row), 0);
  const outstandingBalance = outstandingBalanceCents();
  const overdueBalance = overdueBalanceCents();
  const missingDepositBalance = depositRiskOrders.reduce((sum, row) => sum + orderDepositGapCents(row), 0);
  const orderLabel = workspaceOrderLabelLower(blueprint);
  const catalogLabel = workspaceCatalogLabelLower(blueprint);
  const alerts = [];

  if (!CUSTOMERS_CACHE.length) alerts.push("No customers are in CRM yet. As real work lands here, relationship memory and follow-up get stronger.");
  if (!CRM_ORDERS_CACHE.length) alerts.push(`No tracked ${orderLabel} exist yet. That means customer value and operational visibility are still shallow.`);
  if (!EXPENSES_CACHE.length) alerts.push("No expenses are logged yet, so profit visibility is still weak.");
  if (duePlans.length) alerts.push(`${duePlans.length} recurring plan${duePlans.length === 1 ? "" : "s"} are due right now. Generate the next work record before repeat revenue slips.`);
  if (missingDepositBalance > 0) alerts.push(`${formatUsd(missingDepositBalance)} in deposits is still open on booked work. Make the deposit expectation visible before the schedule gets ahead of the cash.`);

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

    <div class="workflow-strip">
      <div class="workflow-stage">
        <span class="workflow-stage__label">Leads</span>
        <strong>${pipeline.leads}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Quoted</span>
        <strong>${pipeline.quoted}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Booked</span>
        <strong>${pipeline.booked}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">In progress</span>
        <strong>${pipeline.inProgress}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Completed</span>
        <strong>${pipeline.completed}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Paid</span>
        <strong>${pipeline.paid}</strong>
      </div>
    </div>

    <div class="cards">
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Open ${escapeHtml(orderLabel)}</div>
          <div class="money">${openOrdersCount()}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Outstanding money</div>
          <div class="money">${formatUsd(outstandingBalance)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Leads waiting 24h+</div>
          <div class="money">${staleLeadRows.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Completed work unpaid</div>
          <div class="money">${formatUsd(completedUnpaidBalance)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Recurring work due</div>
          <div class="money">${duePlans.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Booked without deposit</div>
          <div class="money">${formatUsd(missingDepositBalance)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Overdue money</div>
          <div class="money">${formatUsd(overdueBalance)}</div>
        </div>
      </div>
    </div>

    <div class="dashboard-tracker">
      <div class="dashboard-tracker__head">
        <div>
          <div class="kicker">Active client tracker</div>
          <h3>See who is active, what stage they are in, and where the money still sits.</h3>
          <p>Open the client, order, job, or lead directly from the tracking row instead of hunting across the system.</p>
        </div>
        <div class="workspace-chip-row">
          <span class="pill">${escapeHtml(String(trackedClients.length))} clients in focus</span>
          <span class="pill">${escapeHtml(String(todayActions.length))} live pressure points</span>
        </div>
      </div>
      <div class="dashboard-tracker__list">
        ${trackedClients.length ? trackedClients.map((item) => `
          <button type="button" class="dashboard-tracker-row${item.isPriority ? " is-priority" : ""}" data-today-tab="${escapeAttr(item.targetTab)}" data-today-id="${escapeAttr(item.targetId || "")}">
            <div class="dashboard-tracker-row__main">
              <div class="dashboard-tracker-row__title">
                <strong>${escapeHtml(item.customerName)}</strong>
                <span class="pill${item.isPriority ? " pill-bad" : ""}">${escapeHtml(item.statusLabel)}</span>
              </div>
              <div class="dashboard-tracker-row__copy">${escapeHtml(item.summary)}${item.serviceAddress ? ` &middot; ${escapeHtml(item.serviceAddress)}` : ""}</div>
            </div>
            <div class="dashboard-tracker-row__meta">
              <span>${escapeHtml(item.monetaryLabel)}</span>
              <span>${escapeHtml(item.actionHint)}</span>
            </div>
          </button>
        `).join("") : `<div class="detail-card"><div class="kicker">Client tracker</div><div><strong>No active clients are being tracked yet.</strong></div><div class="detail-copy">As customers, jobs, and payments land in ProofLink, the dashboard will keep the live records visible here.</div></div>`}
      </div>
    </div>

    <div class="follow-up-queue">
      <div class="follow-up-queue__head">
        <div>
          <div class="kicker">Guarded follow-up queue</div>
          <h3>Helpful follow-up without spam</h3>
          <p>These follow-ups are generated from real workflow events, capped by cooldowns, and stop mattering as soon as the work state changes.</p>
        </div>
        <div class="follow-up-queue__meta">
          <span class="pill">${escapeHtml(String(followUps.length))} queued</span>
          <span class="pill">No bulk blasts</span>
          <span class="pill">Operator visible</span>
        </div>
      </div>
      ${FOLLOW_UP_QUEUE_MESSAGE ? `<div class="msg ${escapeAttr(FOLLOW_UP_QUEUE_MESSAGE.tone || "")}">${escapeHtml(FOLLOW_UP_QUEUE_MESSAGE.text || "")}</div>` : ""}
      <div class="follow-up-grid">
        ${followUps.length ? followUps.map((item, index) => `
          <article class="follow-up-card">
            <div class="follow-up-card__top">
              <div>
                <div class="kicker">${escapeHtml(item.kindLabel)}</div>
                <strong>${escapeHtml(item.title)}</strong>
              </div>
              <span class="pill ${["payment_reminder", "deposit_reminder"].includes(item.kind) ? "pill-bad" : (item.kind === "review_request" ? "pill-on" : "")}">${escapeHtml(item.channel === "email" ? "Email ready" : "Call script ready")}</span>
            </div>
            <div class="detail-copy">${escapeHtml(item.detail)}</div>
            <div class="follow-up-card__reason">${escapeHtml(item.reason)}</div>
            <div class="follow-up-card__contact">${escapeHtml(item.customerName || item.contactName || "Customer")}${item.contactEmail ? ` &middot; ${escapeHtml(item.contactEmail)}` : ""}${item.contactPhone ? ` &middot; ${escapeHtml(item.contactPhone)}` : ""}</div>
            ${item.reviewLinkUrl ? `<div class="workspace-chip-row"><span class="pill pill-on">${escapeHtml(item.reviewLinkLabel || "Review link ready")}</span></div>` : ""}
            <div class="follow-up-card__actions">
              <button type="button" class="btn btn-primary btn-sm" data-follow-up-action="copy" data-follow-up-index="${escapeAttr(index)}">${escapeHtml(item.channel === "email" ? "Copy email" : "Copy call script")}</button>
              ${item.canSend ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="send" data-follow-up-index="${escapeAttr(index)}">Send email</button>` : ""}
              ${item.reviewLinkUrl ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="copy-link" data-follow-up-index="${escapeAttr(index)}">Copy review link</button>` : ""}
              ${item.reviewLinkUrl ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="open-link" data-follow-up-index="${escapeAttr(index)}">Open review link</button>` : ""}
              ${item.customerId ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="handled" data-follow-up-index="${escapeAttr(index)}">Mark contacted</button>` : ""}
              <button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="open" data-follow-up-index="${escapeAttr(index)}">Open record</button>
              <button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="snooze" data-follow-up-index="${escapeAttr(index)}">Snooze 24h</button>
            </div>
          </article>
        `).join("") : `<div class="detail-card"><div class="kicker">Queue</div><div><strong>No safe follow-up is queued right now.</strong></div><div class="detail-copy">That means leads are being worked, money is caught up, or recent contact already happened.</div></div>`}
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">
        <h3>What needs attention</h3>
        <p>${alerts.length ? alerts.map((x) => escapeHtml(x)).join("<br>") : "Core operator signals look stable right now."}</p>
      </div>
      <div class="insight">
        <h3>Owner pressure points</h3>
        <p>Stale leads: <strong>${staleLeadRows.length}</strong> | Completed but unpaid: <strong>${completedUnpaid.length}</strong></p>
        <p>Quoted pipeline waiting on decision: <strong>${pipeline.quoted}</strong> | Due recurring work: <strong>${duePlans.length}</strong> | Missing deposits: <strong>${formatUsd(missingDepositBalance)}</strong></p>
      </div>
      <div class="insight">
        <h3>CRM value</h3>
        <p>Top customer today: <strong>${escapeHtml(topCustomer?.name || "None yet")}</strong>${topCustomer ? ` | ${formatUsd(customerLifetimeValueCents(topCustomer))}` : ""}</p>
        <p>Active ${escapeHtml(catalogLabel)}: <strong>${activeOfferings}</strong></p>
      </div>
      <div class="insight">
        <h3>Cash awareness</h3>
        <p>Tracked expenses this month: <strong>${formatUsd(currentExpenses)}</strong></p>
        <p>Forecasted month ${escapeHtml(orderLabel)}: <strong>${forecastMonthOrders()}</strong></p>
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">${checklistHtml || '<h3>Launch checklist</h3><p>Checklist unavailable right now.</p>'}</div>
      <div class="insight">${paymentHtml || '<h3>Payment readiness</h3><p>Payment truth will appear here once tenant state loads.</p>'}</div>
      <div class="insight">
        <h3>Operating posture</h3>
        <p>${escapeHtml(summary.priorityOutcomes[0] || "Keep the team inside one operating system instead of scattered memory.")}</p>
        <p><strong>Next move:</strong> finish the highest-priority pending checklist step before adding new complexity.</p>
      </div>
    </div>
  `;

  dashboardWrap.querySelectorAll("[data-today-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-today-tab");
      const targetId = btn.getAttribute("data-today-id");
      if (tab === "leads" && targetId) ACTIVE_LEAD_ID = targetId;
      if (tab === "bids" && targetId) ACTIVE_BID_ID = targetId;
      if (tab === "orders" && targetId) ACTIVE_ORDER_ID = targetId;
      if (tab === "jobs" && targetId) ACTIVE_JOB_ID = targetId;
      if (tab === "plans" && targetId) ACTIVE_PLAN_ID = targetId;
      if (tab === "customers" && targetId) ACTIVE_CUSTOMER_ID = targetId;
      switchTab(tab || "dashboard");
    });
  });
  dashboardWrap.querySelectorAll("[data-dashboard-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-dashboard-action");
      if (action === "import") {
        switchTab("import");
        return;
      }
      if (action === "new-lead") {
        ACTIVE_LEAD_ID = null;
        clearLeadForm();
        renderLeadDetail(null).catch(console.error);
        switchTab("leads");
        return;
      }
      if (action === "new-bid") {
        startNewBid(preferredBidProfile());
        switchTab("bids");
        return;
      }
      if (action === "new-customer") {
        startNewCustomer();
        switchTab("customers");
        return;
      }
      if (action === "record-payment") {
        clearPaymentForm({ customerId: ACTIVE_CUSTOMER_ID || "" });
        renderPayments();
        switchTab("payments");
        return;
      }
      if (action === "new-plan") {
        ACTIVE_PLAN_ID = null;
        clearPlanForm();
        renderPlanDetail(null).catch(console.error);
        switchTab("plans");
      }
    });
  });
  dashboardWrap.querySelectorAll("[data-follow-up-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-follow-up-action");
      const index = Number(btn.getAttribute("data-follow-up-index"));
      const item = CURRENT_FOLLOW_UP_QUEUE[index];
      if (!item) return;
      try {
        if (action === "copy") {
          await copyTextValue(item.message || "");
          setFollowUpQueueMessage(item.channel === "email" ? "Follow-up email copied to the clipboard." : "Call script copied to the clipboard.", "ok");
          renderDashboard();
          return;
        }
        if (action === "send") {
          setFollowUpQueueMessage("Sending follow-up...", "");
          renderDashboard();
          await sendQueuedFollowUp(item);
          return;
        }
        if (action === "copy-link") {
          if (!item.reviewLinkUrl) throw new Error("This follow-up does not have a review link yet.");
          await copyTextValue(item.reviewLinkUrl);
          setFollowUpQueueMessage("Review link copied to the clipboard.", "ok");
          renderDashboard();
          return;
        }
        if (action === "open-link") {
          if (!item.reviewLinkUrl) throw new Error("This follow-up does not have a review link yet.");
          window.open(item.reviewLinkUrl, "_blank", "noopener,noreferrer");
          setFollowUpQueueMessage("Review link opened in a new tab.", "ok");
          renderDashboard();
          return;
        }
        if (action === "handled") {
          await markQueuedFollowUpContacted(item);
          return;
        }
        if (action === "open") {
          openQueuedFollowUp(item);
          return;
        }
        if (action === "snooze") {
          snoozeFollowUpItem(item.id, 24);
          setFollowUpQueueMessage("Follow-up snoozed for 24 hours.", "ok");
          renderDashboard();
        }
      } catch (err) {
        setFollowUpQueueMessage(err.message || String(err), "error");
        renderDashboard();
      }
    });
  });
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
    const paymentState = orderPaymentState(row);
    const depositStatus = orderDepositStatus(row);

    return `
      <button type="button" class="list-item ${row.id === active.id ? "is-active" : ""}" data-order-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(customerName)}</div>
          <div class="li-sub muted">${escapeHtml(customerEmail)}  |  ${escapeHtml(formatDateTime(submittedAt))}</div>
          <div class="li-sub muted">${escapeHtml(fulfillment)}  |  ${escapeHtml(String(scheduledDate))}  |  ${escapeHtml(String(scheduledTime))}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${["fulfilled", "completed", "paid"].includes(String(row.status || "new").toLowerCase()) ? "pill-on" : ""}">${escapeHtml(String(row.status || "new"))}</span>
          ${depositStatus !== "not_required" ? `<span class="pill ${depositStatusClass(depositStatus)}">${escapeHtml(formatDepositStatus(depositStatus))}</span>` : ""}
          <span class="pill ${paymentStateClass(paymentState)}">${escapeHtml(formatWorkflowPaymentState(paymentState))}</span>
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
  const linkedJob = JOBS_CACHE.find((row) => row.order_id === active.id || row.id === active.primary_job_id) || null;
  const linkedPlan = SERVICE_PLANS_CACHE.find((row) => row.source_order_id === active.id) || null;
  const paymentState = orderPaymentState(active);
  const amountDue = orderAmountDueCents(active);
  const amountPaid = orderAmountPaidCents(active);
  const depositPolicy = orderDepositPolicy(active);
  const depositStatus = orderDepositStatus(active);
  const depositRequired = orderDepositRequiredCents(active);
  const depositPaid = orderDepositPaidCents(active);
  const depositGap = orderDepositGapCents(active);
  const depositOverrideReason = orderDepositOverrideReason(active);
  const depositDueDate = orderDepositDueDate(active);

  orderDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Customer</div>
      <div><strong>${escapeHtml(active.customer_name || active.name || "Unnamed customer")}</strong></div>
      <div class="detail-copy">${escapeHtml(active.email || "No email")}  |  ${escapeHtml(active.phone || "No phone")}</div>
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
      <div class="detail-copy">Paid: ${formatUsd(amountPaid)} | Due: ${formatUsd(amountDue)}</div>
      <div class="detail-copy">Deposit: ${formatUsd(depositPaid)} paid of ${formatUsd(depositRequired)} required${depositGap > 0 ? ` | ${formatUsd(depositGap)} still open` : ""}</div>
      <div class="detail-copy">Deposit status: <span class="pill ${depositStatusClass(depositStatus)}">${escapeHtml(formatDepositStatus(depositStatus))}</span></div>
      <div class="detail-copy">Payment state: ${escapeHtml(formatWorkflowPaymentState(paymentState))}</div>
      <div class="detail-copy">Tenant: ${escapeHtml(active.tenant_id || TENANT_ID)}</div>
      <div class="detail-copy">${escapeHtml(notesText)}</div>
    </div>

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Workflow next step</div>
      <div class="detail-copy">Tracked job: ${escapeHtml(linkedJob?.title || (linkedJob ? "Linked job" : "No job yet"))}</div>
      <div class="detail-copy">Recurring plan: ${escapeHtml(linkedPlan?.title || "Not set up")}</div>
      <div class="detail-copy">${linkedJob ? `Execution status: ${escapeHtml(String(linkedJob.status || "scheduled").replace(/_/g, " "))}` : "Create a job when this work is ready to be scheduled or performed."}</div>
      <div class="row" style="margin-top:10px;">
        <button id="btnCreateJobFromOrder" class="btn btn-primary" type="button">${linkedJob ? "Open linked job" : "Create job"}</button>
        <button id="btnCreateRecurringPlanFromOrder" class="btn" type="button">${linkedPlan ? "Open recurring plan" : "Make recurring"}</button>
        <button id="btnCollectOrderDeposit" class="btn btn-ghost" type="button">${depositGap > 0 ? "Collect deposit" : "Record payment"}</button>
        <button id="btnRecordOrderPayment" class="btn btn-ghost" type="button">Record payment</button>
        <button id="btnDownloadInvoice" class="btn btn-ghost" type="button">⬇ Invoice PDF</button>
        <button id="btnSetupRecurring" class="btn btn-ghost" type="button">🔁 Make recurring</button>
        ${active.customer_phone ? `<button id="btnOrderSms" class="btn btn-ghost" type="button">💬 Text customer</button>` : ""}
      </div>
      <div id="recurringSetupPanel" style="display:none;margin-top:12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div class="row" style="gap:8px;align-items:end;flex-wrap:wrap;">
          <label style="flex:1;min-width:130px;">Repeat every
            <select id="recurringFrequency">
              <option value="weekly">Week</option>
              <option value="biweekly">2 Weeks</option>
              <option value="monthly">Month</option>
            </select>
          </label>
          <label style="flex:1;min-width:140px;">Next date
            <input type="date" id="recurringNextDate" />
          </label>
          <button id="btnSaveRecurring" class="btn btn-primary" type="button" style="flex:0 0 auto;">Save</button>
        </div>
        <div id="recurringMsg" class="msg" style="margin-top:6px;"></div>
      </div>

      ${active.customer_phone ? `
      <div id="orderSmsPanel" style="display:none;margin-top:12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="font-size:.8rem;color:rgba(255,255,255,.5);margin-bottom:8px;">Texting ${escapeHtml(active.customer_name || "customer")} at ${escapeHtml(active.customer_phone)}</div>
        <div id="orderSmsThread" style="max-height:200px;overflow-y:auto;margin-bottom:8px;"></div>
        <div class="row" style="gap:8px;">
          <input id="orderSmsInput" type="text" style="flex:1;" placeholder="Type a message…" />
          <button id="btnOrderSmsSend" class="btn btn-primary btn-sm" type="button">Send</button>
        </div>
        <div id="orderSmsMsg" class="msg"></div>
      </div>` : ""}
    </div>

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Deposit control</div>
      <div class="detail-copy">${escapeHtml(depositPolicyLabel(depositPolicy))}${depositDueDate ? ` | Due ${escapeHtml(formatDateOnly(depositDueDate))}` : ""}</div>
      <div class="detail-copy">${depositOverrideReason ? `Override reason: ${escapeHtml(depositOverrideReason)}` : "Use this when the business needs a deposit rule that is teachable, enforceable, and still flexible in real life."}</div>
      <div class="grid three form-grid" style="margin-top:10px;">
        <label>Deposit policy
          <select id="orderDepositPolicySelect">
            <option value="optional" ${depositPolicy === "optional" ? "selected" : ""}>Optional</option>
            <option value="required_before_booking" ${depositPolicy === "required_before_booking" ? "selected" : ""}>Required before booking</option>
            <option value="required_before_job" ${depositPolicy === "required_before_job" ? "selected" : ""}>Required before job</option>
          </select>
        </label>
        <label>Required amount (USD)
          <input id="orderDepositRequiredAmount" type="number" min="0" step="0.01" value="${escapeAttr(money(depositRequired))}" />
        </label>
        <label>Deposit due date
          <input id="orderDepositDueDate" type="date" value="${escapeAttr(depositDueDate || "")}" />
        </label>
      </div>
      <label style="margin-top:10px;">Override reason
        <textarea id="orderDepositOverrideReason" rows="3" placeholder="Why this order can move ahead before the deposit is collected.">${escapeHtml(depositOverrideReason)}</textarea>
      </label>
      <div class="row" style="margin-top:10px;">
        <button id="btnSaveOrderDepositSettings" class="btn btn-primary" type="button">Save deposit settings</button>
        <button id="btnClearOrderDepositOverride" class="btn btn-ghost" type="button" ${depositOverrideReason ? "" : "disabled"}>Clear override</button>
      </div>
      <div id="orderDepositMsg" class="msg"></div>
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
      ${["completed","fulfilled"].includes(String(active.status||"").toLowerCase()) && active.customer_email ? `
      <div style="margin-top:.75rem;">
        <button id="btnRequestReview" class="btn btn-ghost btn-sm" type="button">
          ${active.review_requested_at ? "✓ Review requested" : "⭐ Request review"}
        </button>
      </div>` : ""}
    </div>
  `;

  $("btnSaveOrderStatus")?.addEventListener("click", async () => {
    const nextStatus = $("orderStatusSelect")?.value || "new";
    try {
      assertOrderAllowsStatusChange(active, nextStatus);
    } catch (err) {
      alert(err.message || String(err));
      return;
    }
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

    // Auto-send review request when order is marked complete/fulfilled
    if (["completed", "fulfilled"].includes(nextStatus) && data.customer_email && !data.review_requested_at) {
      try {
        const tok = await getAccessToken();
        await fetch("/.netlify/functions/request-review", {
          method : "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
          body   : JSON.stringify({ order_id: data.id }),
        });
      } catch (e) {
        console.warn("[review] auto-request failed:", e.message);
      }
    }
  });
  $("btnDownloadInvoice")?.addEventListener("click", () => {
    generateInvoicePDF(active);
  });

  $("btnRequestReview")?.addEventListener("click", async () => {
    const btn = $("btnRequestReview");
    if (!btn || active.review_requested_at) return;
    btn.disabled = true;
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/request-review", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send review request");
      btn.textContent = "✓ Review requested";
      CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) =>
        row.id === active.id ? { ...row, review_requested_at: new Date().toISOString() } : row
      );
    } catch (err) {
      alert(err.message || String(err));
      btn.disabled = false;
    }
  });

  $("btnSetupRecurring")?.addEventListener("click", () => {
    const panel = $("recurringSetupPanel");
    if (!panel) return;
    const isHidden = panel.style.display === "none";
    panel.style.display = isHidden ? "block" : "none";
    if (isHidden) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateInput = $("recurringNextDate");
      if (dateInput && !dateInput.value) {
        dateInput.value = tomorrow.toISOString().slice(0, 10);
      }
    }
  });

  $("btnSaveRecurring")?.addEventListener("click", async () => {
    const btn  = $("btnSaveRecurring");
    const msg  = $("recurringMsg");
    const freq = $("recurringFrequency")?.value;
    const nd   = $("recurringNextDate")?.value;
    if (!freq || !nd) { if (msg) { msg.textContent = "Select frequency and date."; msg.className = "msg error"; } return; }
    btn.disabled = true;
    if (msg) { msg.textContent = "Saving…"; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/create-recurring-order", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id, frequency: freq, next_date: nd }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to save");
      if (msg) { msg.textContent = "✓ Recurring schedule saved!"; msg.className = "msg success"; }
      $("btnSetupRecurring").textContent = "🔁 Recurring: " + freq;
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error saving."; msg.className = "msg error"; }
      btn.disabled = false;
    }
  });

  // Order-level SMS
  $("btnOrderSms")?.addEventListener("click", async () => {
    const panel = $("orderSmsPanel");
    if (!panel) return;
    const isHidden = panel.style.display === "none";
    panel.style.display = isHidden ? "block" : "none";
    if (isHidden && active.customer_phone) {
      const thread = $("orderSmsThread");
      if (thread && !thread.dataset.loaded) {
        thread.dataset.loaded = "1";
        try {
          const tok = await getAccessToken();
          const res = await fetch(`/.netlify/functions/get-sms-thread?phone=${encodeURIComponent(active.customer_phone)}`, {
            headers: { "Authorization": `Bearer ${tok}` },
          });
          const d = await res.json().catch(() => ({}));
          const msgs = d.messages || [];
          thread.innerHTML = msgs.length ? msgs.map((m) => {
            const isOut = m.direction === 'outbound';
            return `<div style="display:flex;justify-content:${isOut ? 'flex-end' : 'flex-start'};margin-bottom:5px;">
              <div style="max-width:75%;background:${isOut ? '#c84b2f' : 'rgba(255,255,255,.1)'};border-radius:10px;padding:6px 10px;font-size:.82rem;">
                ${escapeHtml(m.body || "")}
              </div>
            </div>`;
          }).join('') : '<p style="font-size:.8rem;color:rgba(255,255,255,.4);">No messages yet.</p>';
          thread.scrollTop = thread.scrollHeight;
        } catch (e) { console.error("[order sms thread]", e); }
      }
    }
  });

  $("btnOrderSmsSend")?.addEventListener("click", async () => {
    const btn  = $("btnOrderSmsSend");
    const inp  = $("orderSmsInput");
    const msg  = $("orderSmsMsg");
    const text = inp?.value?.trim();
    if (!text || !active.customer_phone) return;
    btn.disabled = true;
    if (msg) { msg.textContent = ""; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-sms", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ to: active.customer_phone, body: text, order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (inp) inp.value = "";
      const thread = $("orderSmsThread");
      if (thread) {
        thread.innerHTML += `<div style="display:flex;justify-content:flex-end;margin-bottom:5px;">
          <div style="max-width:75%;background:#c84b2f;border-radius:10px;padding:6px 10px;font-size:.82rem;">${escapeHtml(text)}</div>
        </div>`;
        thread.scrollTop = thread.scrollHeight;
      }
      if (msg) { msg.textContent = "✓ Sent"; msg.className = "msg success"; setTimeout(() => { if (msg) { msg.textContent = ""; msg.className = "msg"; } }, 2000); }
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending."; msg.className = "msg error"; }
    }
    btn.disabled = false;
  });

  $("orderSmsInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnOrderSmsSend")?.click(); }
  });

  $("btnCreateJobFromOrder")?.addEventListener("click", async () => {
    if (linkedJob) {
      ACTIVE_JOB_ID = linkedJob.id;
      switchTab("jobs");
      return;
    }
    try {
      assertOrderAllowsJobCreation(active);
      await createJobFromOrderRecord(active);
      renderJobs(jobSearch?.value || "");
      renderOrders();
      renderDashboard();
      renderGuidance();
      switchTab("jobs");
    } catch (err) {
      const message = err.message || String(err);
      if (message.toLowerCase().includes("deposit")) {
        setInlineMessage($("orderDepositMsg"), "This order still has a required deposit open. Record the deposit or add an override reason below, then create the job.", "error");
        $("orderDepositOverrideReason")?.focus();
        return;
      }
      alert(message);
    }
  });
  $("btnCreateRecurringPlanFromOrder")?.addEventListener("click", async () => {
    if (linkedPlan) {
      ACTIVE_PLAN_ID = linkedPlan.id;
      renderPlans(planSearch?.value || "");
      switchTab("plans");
      return;
    }
    try {
      const result = await createServicePlanFromOrderRecord(active);
      if (result?.plan?.id) ACTIVE_PLAN_ID = result.plan.id;
      renderPlans(planSearch?.value || "");
      renderDashboard();
      renderGuidance();
      switchTab("plans");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  $("btnRecordOrderPayment")?.addEventListener("click", () => {
    ACTIVE_ORDER_ID = active.id;
    clearPaymentForm({
      customerId: active.customer_id || "",
      orderId: active.id,
    });
    switchTab("payments");
  });
  $("btnCollectOrderDeposit")?.addEventListener("click", () => {
    ACTIVE_ORDER_ID = active.id;
    clearPaymentForm({
      customerId: active.customer_id || "",
      orderId: active.id,
      amount: depositGap > 0 ? money(depositGap) : "",
      note: depositGap > 0 ? `Deposit for ${active.cart_summary || active.customer_name || "order"}` : "",
      title: depositGap > 0 ? "Record deposit" : "Manual payment entry",
    });
    switchTab("payments");
  });
  $("btnSaveOrderDepositSettings")?.addEventListener("click", async () => {
    const msgEl = $("orderDepositMsg");
    setInlineMessage(msgEl, "Saving...");
    const nextPolicy = normalizeDepositPolicy($("orderDepositPolicySelect")?.value || "optional");
    const nextRequired = toCents($("orderDepositRequiredAmount")?.value || 0);
    const nextDueDate = $("orderDepositDueDate")?.value || null;
    const nextOverride = $("orderDepositOverrideReason")?.value?.trim() || null;
    if (nextPolicy !== "optional" && nextRequired <= 0) {
      setInlineMessage(msgEl, "A required deposit policy needs an amount greater than zero.", "error");
      return;
    }
    try {
      const payload = {
        deposit_policy: nextRequired > 0 ? nextPolicy : "optional",
        deposit_required_cents: nextRequired,
        deposit_due_date: nextRequired > 0 && nextPolicy !== "optional" ? (nextDueDate || active.scheduled_date || active.payment_due_date || new Date().toISOString().slice(0, 10)) : null,
        deposit_override_reason: nextOverride,
        deposit_override_at: nextOverride ? new Date().toISOString() : null,
        deposit_override_by: nextOverride ? opId() : null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await sb.from("orders")
        .update(payload)
        .eq("id", active.id)
        .eq(OPERATOR_COLUMN, opId())
        .eq(TENANT_COLUMN, TENANT_ID)
        .select("*")
        .single();
      if (error) {
        if (isMissingDatabaseFeatureError(error, ["deposit_policy", "deposit_due_date", "deposit_override_reason"])) {
          throw new Error("Deposit control needs the service_deposit_control.sql migration before these settings can be saved.");
        }
        throw error;
      }
      CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) => row.id === active.id ? data : row);
      if (nextOverride && active.customer_id) {
        await logCustomerInteraction(active.customer_id, "payment", `Deposit override recorded for ${active.cart_summary || "order"}`, {
          order_id: active.id,
          deposit_override_reason: nextOverride,
          deposit_required_cents: nextRequired,
        }).catch(() => null);
      }
      renderOrders();
      renderJobs(jobSearch?.value || "");
      renderDashboard();
      renderGuidance();
      renderMoney().catch(console.error);
      setInlineMessage($("orderDepositMsg"), "Deposit settings saved.", "ok");
    } catch (err) {
      setInlineMessage(msgEl, err.message || String(err), "error");
    }
  });
  $("btnClearOrderDepositOverride")?.addEventListener("click", async () => {
    const msgEl = $("orderDepositMsg");
    setInlineMessage(msgEl, "Clearing override...");
    try {
      const { data, error } = await sb.from("orders")
        .update({
          deposit_override_reason: null,
          deposit_override_at: null,
          deposit_override_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", active.id)
        .eq(OPERATOR_COLUMN, opId())
        .eq(TENANT_COLUMN, TENANT_ID)
        .select("*")
        .single();
      if (error) {
        if (isMissingDatabaseFeatureError(error, ["deposit_override_reason"])) {
          throw new Error("Deposit override clearing needs the service_deposit_control.sql migration.");
        }
        throw error;
      }
      CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) => row.id === active.id ? data : row);
      renderOrders();
      renderJobs(jobSearch?.value || "");
      renderDashboard();
      renderGuidance();
      renderMoney().catch(console.error);
      setInlineMessage($("orderDepositMsg"), "Deposit override cleared.", "ok");
    } catch (err) {
      setInlineMessage(msgEl, err.message || String(err), "error");
    }
  });
}
function renderGuidance() {
  if (!guidanceWrap) return;
  const blueprint = currentWorkspaceBlueprint();
  const summary = workspaceSummaryData(blueprint);
  const notes = [];
  notes.push(["Workspace blueprint", `${summary.businessLabel} is running in ${summary.workspaceModeLabel}. Keep the team living inside ${(summary.focusTabs.length ? summary.focusTabs : ["Customers", workspaceTabLabel("orders", blueprint), "Payments"]).join(", ")}.`]);
  notes.push(["How this should feel", summary.operatorNeeds[0] ? `${summary.operatorNeeds[0]}. ${summary.promise}` : summary.promise]);
  notes.push(["Lead pipeline", LEADS_CACHE.length ? `You have ${LEADS_CACHE.length} lead record(s). Work them forward instead of letting website requests or phone notes die in memory.` : "No leads exist yet. As service intake starts landing here, the pipeline becomes much easier to trust."]);
  notes.push(["CRM foundation", CUSTOMERS_CACHE.length ? `You now have ${CUSTOMERS_CACHE.length} customer record(s). Start ranking by lifetime value and following up based on real history.` : "No customers are in CRM yet. The next win is building customer memory that does not live in texts or somebody's head."]);
  notes.push(["Execution", JOBS_CACHE.length ? `You have ${JOBS_CACHE.length} tracked job record(s). That means work no longer has to live only inside the order list.` : "No jobs are tracked yet. Convert booked work into jobs so schedule, proof, and collection all stay visible."]);
  if (isTabVisibleInWorkspace("plans", blueprint)) {
    notes.push(["Recurring work", SERVICE_PLANS_CACHE.length ? `You have ${SERVICE_PLANS_CACHE.length} recurring plan(s). That keeps repeat revenue from depending on manual memory and calendar juggling.` : "No recurring plans exist yet. Build one from a real order when the same customer is likely to need the work again."]);
  }
  notes.push(["Payments", PAYMENTS_CACHE.length ? "Payments are flowing into the operator record. Online and offline collection can now sit on the same customer and work history." : "Payments table is empty. Start by logging real deposits and collections so the business history becomes trustworthy."]);
  if (isTabVisibleInWorkspace("bids", blueprint)) {
    notes.push(["Bids and sales flow", BIDS_CACHE.length ? `You have ${BIDS_CACHE.length} saved bid draft(s). Keep using the walkthrough record so scope, photos, and pricing stay together.` : "No professional bid drafts exist yet. The fastest upgrade is turning site visits into structured proposals instead of memory-based follow-up."]);
  }
  notes.push([workspaceTabLabel("orders", blueprint), CRM_ORDERS_CACHE.length ? `You have ${CRM_ORDERS_CACHE.length} tracked ${workspaceOrderLabelLower(blueprint)}. This is the operating backbone for accountability and customer value.` : `No tracked ${workspaceOrderLabelLower(blueprint)} exist yet. Once work starts landing here, operator visibility gets much stronger.`]);
  if (summary.deferredLabels.length) {
    notes.push(["Later unlocks", `When the business is ready for more depth, layer in ${summary.deferredLabels.join(", ")} without changing the core operating habits.`]);
  }

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
  await Promise.allSettled([fetchLeads(), fetchCrmOrders(), fetchPayments(), fetchJobs(), fetchServicePlans(), fetchDashboardLaunchChecklist(), fetchDashboardPaymentState(), loadPersistedBids()]);
  renderDashboard();
  renderLeads(leadSearch?.value || "");
  renderPlans(planSearch?.value || "");
  renderGuidance();
});
btnRefreshOrders?.addEventListener("click", async () => {
  try {
    await Promise.all([fetchCrmOrders(), fetchJobs(), fetchServicePlans()]);
    renderOrders();
    renderJobs(jobSearch?.value || "");
    renderPlans(planSearch?.value || "");
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

  const blueprint = currentWorkspaceBlueprint();
  const pricingRows = await fetchPricing();
  const topCustomer = sortedCustomers(CUSTOMERS_CACHE)[0] || null;
  const expByMonth = new Map();
  EXPENSES_CACHE.forEach((e) => {
    const mk = monthKeyFromDate(e.date || e.expense_date);
    if (mk) expByMonth.set(mk, (expByMonth.get(mk) || 0) + Number(e.amount_cents || 0));
  });
  const jobEconomics = jobsWithTrackedEconomics()
    .sort((a, b) => b.grossProfitCents - a.grossProfitCents);
  const weightedMargin = weightedAverageJobMarginRatio();
  const totalTrackedJobCost = jobEconomics.reduce((sum, row) => sum + row.costCents, 0);
  const totalGrossProfit = jobEconomics.reduce((sum, row) => sum + row.grossProfitCents, 0);
  const profitableJobs = jobEconomics.filter((row) => row.grossProfitCents > 0).length;
  const weakestJobs = [...jobEconomics]
    .sort((a, b) => a.grossProfitCents - b.grossProfitCents)
    .slice(0, 5);
  const strongestJobs = jobEconomics.slice(0, 5);
  const costBreakdown = costBreakdownForJobs(jobEconomics);

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
  const duePlans = dueServicePlans();
  const activePlans = SERVICE_PLANS_CACHE.filter((row) => String(row.status || "").toLowerCase() === "active");

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
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Active recurring plans</div>
          <div class="money">${activePlans.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Recurring work due</div>
          <div class="money">${duePlans.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Tracked job cost</div>
          <div class="money">${formatUsd(totalTrackedJobCost)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Gross profit</div>
          <div class="money">${formatUsd(totalGrossProfit)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Average job margin</div>
          <div class="money">${formatPercent(weightedMargin)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Tracked labor</div>
          <div class="money">${costBreakdown.laborHours ? `${Number(costBreakdown.laborHours.toFixed(2))}h` : "-"}</div>
        </div>
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">
        <h3>${escapeHtml(workspaceUsesServiceCatalog(blueprint) ? "Service catalog health" : (isBookingWorkspace(blueprint) || isEventWorkspace(blueprint) ? "Package health" : "Catalog health"))}</h3>
        <p>${escapeHtml(workspaceUsesServiceCatalog(blueprint) ? "Missing price anchor" : "Missing sell price")}: <strong>${productsMissingPrice}</strong></p>
        <p>${escapeHtml(workspaceUsesServiceCatalog(blueprint) ? "Missing image or proof" : "Missing image")}: <strong>${PRODUCTS_CACHE.filter((p) => !String(p.image_url || "").trim()).length}</strong></p>
      </div>
      <div class="insight">
        <h3>Customer value</h3>
        <p>The system now ranks customers by value and ties money back to real people instead of isolated receipts.</p>
      </div>
      <div class="insight">
        <h3>${escapeHtml(titleCaseWords(workspaceOrderLabelLower(blueprint)))} economics</h3>
        <p>${jobEconomics.length ? `ProofLink is now measuring ${jobEconomics.length} tracked job${jobEconomics.length === 1 ? "" : "s"} with real revenue and linked cost.` : "Link expenses to jobs or orders so this page can show real gross profit instead of just expense totals."}</p>
      </div>
      <div class="insight">
        <h3>Profit signal</h3>
        <p>${jobEconomics.length ? `${profitableJobs} of ${jobEconomics.length} tracked jobs are currently above zero gross profit. Weighted average margin is ${formatPercent(weightedMargin)}.` : "Once jobs have linked costs, this screen will show which work is healthy and which work is leaking margin."}</p>
      </div>
      <div class="insight">
        <h3>Cost mix</h3>
        <p>${jobEconomics.length ? `Labor: ${formatUsd(costBreakdown.laborCostCents)}. Materials: ${formatUsd(costBreakdown.materialCostCents)}.${costBreakdown.changeOrderCostCents > 0 ? ` Change-order cost: ${formatUsd(costBreakdown.changeOrderCostCents)}.` : ""}` : "As you log labor and material usage, this view will show what is actually eating margin."}</p>
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

    <div class="grid two" style="margin-top:14px;">
      <div class="card">
        <div class="card-hd">
          <strong>Strongest tracked jobs</strong>
          <span class="muted">Highest gross profit right now</span>
        </div>
        <div class="card-bd">
          ${strongestJobs.length ? `
            <div class="table">
              ${strongestJobs.map((row) => `
                <div class="tr">
                  <div>
                    <div><strong>${escapeHtml(row.job.title || row.order?.customer_name || "Job")}</strong></div>
                    <div class="muted" style="margin-top:4px;">Revenue ${escapeHtml(formatUsd(row.revenueCents))} | Cost ${escapeHtml(formatUsd(row.costCents))}</div>
                  </div>
                  <div class="right"><span class="pill ${grossProfitToneClass(row.grossProfitCents)}">${escapeHtml(formatUsd(row.grossProfitCents))} • ${escapeHtml(formatPercent(row.marginRatio))}</span></div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No tracked job economics yet.</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-hd">
          <strong>Weakest tracked jobs</strong>
          <span class="muted">Where margin needs attention</span>
        </div>
        <div class="card-bd">
          ${weakestJobs.length ? `
            <div class="table">
              ${weakestJobs.map((row) => `
                <div class="tr">
                  <div>
                    <div><strong>${escapeHtml(row.job.title || row.order?.customer_name || "Job")}</strong></div>
                    <div class="muted" style="margin-top:4px;">Revenue ${escapeHtml(formatUsd(row.revenueCents))} | Cost ${escapeHtml(formatUsd(row.costCents))}</div>
                  </div>
                  <div class="right"><span class="pill ${grossProfitToneClass(row.grossProfitCents)}">${escapeHtml(formatUsd(row.grossProfitCents))} • ${escapeHtml(formatPercent(row.marginRatio))}</span></div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No tracked job economics yet.</div>`}
        </div>
      </div>
    </div>

    ${(costBreakdown.leftoverNotes.length || costBreakdown.wasteNotes.length) ? `
      <div class="grid two" style="margin-top:14px;">
        <div class="card">
          <div class="card-hd">
            <strong>Leftover materials</strong>
            <span class="muted">What can be returned to stock or reused</span>
          </div>
          <div class="card-bd">
            ${costBreakdown.leftoverNotes.length ? `<div class="note-list">${costBreakdown.leftoverNotes.map((note) => `<div class="note-item">${escapeHtml(note)}</div>`).join("")}</div>` : `<div class="muted">No leftover notes logged yet.</div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-hd">
            <strong>Waste and overage</strong>
            <span class="muted">What is getting used up or lost</span>
          </div>
          <div class="card-bd">
            ${costBreakdown.wasteNotes.length ? `<div class="note-list">${costBreakdown.wasteNotes.map((note) => `<div class="note-item">${escapeHtml(note)}</div>`).join("")}</div>` : `<div class="muted">No waste or overage notes logged yet.</div>`}
          </div>
        </div>
      </div>
    ` : ``}
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
      fetchLeads(),
      fetchCrmOrders(),
      fetchPayments(),
      fetchJobs(),
      fetchServicePlans(),
      fetchAvailability(),
      fetchOperatorSetup().catch(() => null),
    ]);
    loadBidDrafts();
    await loadPersistedBids();

    showApp(user);
    applyWorkspaceBlueprint();

    renderProductsList("");
    renderAvailability();
    renderBookings();
    renderPricing(await fetchPricing());
    renderExpenses(EXPENSES_CACHE);
    await refreshPicklists();
    renderStartupChecklist();
    await Promise.allSettled([fetchDashboardLaunchChecklist(), fetchDashboardPaymentState()]);
    applyWorkspaceBlueprint();
    renderDashboard();
    renderLeads("");
    renderOrders();
    renderBids("");
    renderJobs("");
    renderPlans("");
    renderCustomersList("");
    renderPayments();
    renderGuidance();
    await renderMoney();
    switchTab(panelFromLocation(), { updateHash: false });

    window.PROOFLINK_BOOT_READY = true;
    startRealtime();
    registerPushNotifications();
  } catch (err) {
    console.error(err);
    CURRENT_OPERATOR = null;
    window.PROOFLINK_BOOT_READY = false;
    showLogin(err?.message || String(err));
  } finally {
    BOOTING = false;
  }
}

// ── Push Notifications ────────────────────────────────────────────────────────

const VAPID_PUBLIC_KEY = "BPB-zAeBzP3xUdVT7F_zML4A3Oq0f_LE24o2oM38has6FhsIRDE6V14vNDkDZr_co2VP0HJVWkYaxr7tdAD5ARA";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registerPushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission === "denied") return;

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub   = await reg.pushManager.getSubscription();

    if (!sub) {
      if (Notification.permission !== "granted") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly     : true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const tok = await getAccessToken();
    await fetch("/.netlify/functions/save-push-subscription", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body   : JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch (e) {
    console.warn("[push] registration failed:", e.message);
  }
}

// ── Invoice PDF ───────────────────────────────────────────────────────────────

function generateInvoicePDF(order) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) { alert("PDF library not loaded. Please refresh and try again."); return; }

  const doc  = new jsPDF({ unit: "pt", format: "letter" });
  const W    = doc.internal.pageSize.getWidth();
  const red  = [200, 75, 47];
  const dark = [26, 26, 26];
  const grey = [100, 100, 100];

  const fmt  = (v) => isNaN(Number(v)) ? "—" : "$" + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const now  = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Header bar
  doc.setFillColor(...red);
  doc.rect(0, 0, W, 48, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("INVOICE", 40, 31);

  // Business name
  const bizName = (CURRENT_OPERATOR?.business_name || CURRENT_OPERATOR?.name || "ProofLink Business").slice(0, 50);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(bizName, W - 40, 28, { align: "right" });

  // Invoice meta
  doc.setTextColor(...dark);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Invoice #", 40, 80);
  doc.text("Date", 40, 96);
  doc.text("Status", 40, 112);

  doc.setFont("helvetica", "normal");
  doc.text(String(order.id || "").slice(0, 8).toUpperCase(), 140, 80);
  doc.text(now, 140, 96);
  doc.text(String(order.status || "new").toUpperCase(), 140, 112);

  // Bill To
  doc.setFont("helvetica", "bold");
  doc.text("Bill To", W - 200, 80);
  doc.setFont("helvetica", "normal");
  doc.text(String(order.customer_name || "—"), W - 200, 96);
  if (order.customer_email) doc.text(order.customer_email, W - 200, 112);

  // Divider
  doc.setDrawColor(220, 220, 210);
  doc.line(40, 130, W - 40, 130);

  // Order title / description
  let y = 152;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...dark);
  doc.text(String(order.title || "Service"), 40, y);
  y += 18;

  if (order.description) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...grey);
    const lines = doc.splitTextToSize(String(order.description), W - 80);
    lines.slice(0, 6).forEach((line) => { doc.text(line, 40, y); y += 13; });
    y += 6;
  }

  // Line items table header
  y += 10;
  doc.setFillColor(244, 241, 236);
  doc.rect(40, y - 13, W - 80, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...dark);
  doc.text("Description", 48, y);
  doc.text("Qty", W - 200, y, { align: "right" });
  doc.text("Unit Price", W - 130, y, { align: "right" });
  doc.text("Amount", W - 40, y, { align: "right" });
  y += 18;

  // Line items
  doc.setFont("helvetica", "normal");
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  if (lineItems.length === 0) {
    doc.text(String(order.title || "Service"), 48, y);
    doc.text("1", W - 200, y, { align: "right" });
    doc.text(fmt(order.total_amount || 0), W - 130, y, { align: "right" });
    doc.text(fmt(order.total_amount || 0), W - 40, y, { align: "right" });
    y += 16;
  } else {
    lineItems.forEach((item) => {
      const qty   = Number(item.quantity || 1);
      const price = Number(item.unit_price || item.price || 0);
      doc.text(String(item.name || item.description || "Item").slice(0, 48), 48, y);
      doc.text(String(qty), W - 200, y, { align: "right" });
      doc.text(fmt(price), W - 130, y, { align: "right" });
      doc.text(fmt(qty * price), W - 40, y, { align: "right" });
      y += 16;
    });
  }

  // Totals
  y += 8;
  doc.setDrawColor(220, 220, 210);
  doc.line(W - 220, y, W - 40, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total Due", W - 220, y);
  doc.setTextColor(...red);
  doc.text(fmt(order.total_amount || 0), W - 40, y, { align: "right" });

  // Footer
  doc.setTextColor(...grey);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Generated by ProofLink · prooflink.co", W / 2, doc.internal.pageSize.getHeight() - 24, { align: "center" });

  const filename = `invoice-${String(order.id || "order").slice(0, 8)}-${now.replace(/\s/g, "-")}.pdf`;
  doc.save(filename);
}

// ── Realtime ──────────────────────────────────────────────────────────────────

let _realtimeChannel = null;

function stopRealtime() {
  if (_realtimeChannel) {
    sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

function startRealtime() {
  stopRealtime();

  if (!TENANT_ID || !CURRENT_OPERATOR?.operator_id) return;

  function realtimeToast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:1.25rem;left:50%;transform:translateX(-50%);background:var(--bg2,#1e1e1e);color:var(--text,#fff);padding:.55rem 1.1rem;border-radius:8px;font-size:.82rem;box-shadow:0 4px 18px rgba(0,0,0,.45);z-index:9999;pointer-events:none;opacity:0;transition:opacity .25s';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  _realtimeChannel = sb.channel('prooflink-operator-realtime')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'orders',
      filter: `tenant_id=eq.${TENANT_ID}`,
    }, async (payload) => {
      await fetchCrmOrders();
      renderOrders();
      renderDashboard();
      if (payload.eventType === 'INSERT') realtimeToast('New order received');
      if (payload.eventType === 'UPDATE') realtimeToast('Order updated');
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'customers',
      filter: `tenant_id=eq.${TENANT_ID}`,
    }, async (payload) => {
      await fetchCustomers();
      renderCustomersList(customerSearch?.value || '');
      if (payload.eventType === 'INSERT') realtimeToast('New customer added');
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'payments',
      filter: `tenant_id=eq.${TENANT_ID}`,
    }, async () => {
      await fetchPayments();
      renderPayments();
      await renderMoney();
      realtimeToast('Payment record updated');
    })
    .subscribe();
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
  refreshLeads: async () => { await fetchLeads(); renderLeads(leadSearch?.value || ""); },
  refreshJobs: async () => { await fetchJobs(); renderJobs(jobSearch?.value || ""); },
  refreshPlans: async () => { await fetchServicePlans(); renderPlans(planSearch?.value || ""); },
};

initBranding();
boot().catch((err) => {
  console.error(err);
  showLogin(err?.message || String(err));
});
