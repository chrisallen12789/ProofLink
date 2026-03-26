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

const FETCH_OFFSETS = { orders: 0, customers: 0, jobs: 0, payments: 0, bids: 0 };
const PAGE_SIZE = 50;
let ORDERS_TOTAL_COUNT = 0;
let CUSTOMERS_TOTAL_COUNT = 0;
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
let PRICING_CACHE = [];
let PICK_PRODUCT_CATEGORIES = [];
let PICK_EXPENSE_CATEGORIES = [];
let PICK_VENDORS = [];
let AVAILABILITY = null;
let CURRENT_OPERATOR = null;
let BOOTING = false;
const TABS_LOADED = new Set();
const FETCHING = new Set();
let _tabAbortController = null;
let BOOKING_PAGE_ENABLED = true;
window.PROOFLINK_BOOT_READY = false;
// Tracks which password-setup flow is active: "reset" | "first-time" | null
let passwordSetupMode = null;
let ACTIVE_ORDER_ID = null;
let ACTIVE_BID_ID = null;
let ACTIVE_CUSTOMER_ID = null;
let ACTIVE_LEAD_ID = null;
let CUSTOMER_CREATING = false;
let CUSTOMER_SAVE_ADD_ANOTHER = false;
let ACTIVE_PAYMENT_ID = null;
let ACTIVE_JOB_ID = null;
let ACTIVE_PLAN_ID = null;
let ACTIVE_FACILITY_ID = null;
let FACILITY_SAVE_ADD_ANOTHER = false;
let ACTIVE_MANIFEST_ID = null;
let ACTIVE_LOCATE_ID = null;
let ACTIVE_DRIVER_QUAL_MEMBER_ID = null;
let ACTIVE_DISPATCH_JOB_ID = null;
let ACTIVE_PERMIT_ID = null;
let ACTIVE_ASSET_ID = null;
let ACTIVE_BID_LINE_ITEM_ID = null;
let ACTIVE_PRICING_PRODUCT_ID = null;
let PREVIOUS_PANEL_TAB = "dashboard";
let BID_QUICK_CUSTOMER_OPEN = false;
let DASHBOARD_PAYMENT_STATE = null;
let DASHBOARD_LAUNCH_CHECKLIST = null;
let WORKSPACE_BLUEPRINT = null;
let BID_SYNC_TIMER = null;
let BID_SYNC_IN_FLIGHT = false;
let BID_SYNC_PROMISE = null;
let BID_WORKSPACE_BOOTSTRAPPING = false;
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
    const tok = await getOperatorAccessToken();
    const res = await fetch(`/.netlify/functions/get-launch-checklist?tenant_id=${encodeURIComponent(TENANT_ID)}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
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
const sidebarPrimary = $("sidebarPrimary");
sectionNav?.querySelector('.tab[data-tab="ai"]')?.setAttribute("hidden", "hidden");
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
startupChecklist?.closest(".side-card")?.setAttribute("hidden", "hidden");
document.querySelector(".side-copy")?.closest(".side-card")?.setAttribute("hidden", "hidden");

const dashboardWrap = $("dashboardWrap");
const btnRefreshDashboard = $("btnRefreshDashboard");
const leadsList = $("leadsList");
const leadDetailWrap = $("leadDetailWrap");
const requestStageStrip = $("requestStageStrip");
const requestActionBar = $("requestActionBar");
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
const pipelineStageStrip = $("pipelineStageStrip");
const pipelineActionBar = $("pipelineActionBar");
const workCommandWrap = $("workCommandWrap");
const btnRefreshOrders = $("btnRefreshOrders");
const btnExportOrders = $("btnExportOrders");
const btnImportBridgeOrders = $("btnImportBridgeOrders");
const bidSearch = $("bidSearch");
const btnNewBid = $("btnNewBid");
const btnConvertBidToOrder = $("btnConvertBidToOrder");
const btnPrintBidProposal = $("btnPrintBidProposal");
const bidGuideFlow = $("bidGuideFlow");
const proposalStageStrip = $("proposalStageStrip");
const proposalActionBar = $("proposalActionBar");
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
const bidCatalogStarters = $("bidCatalogStarters");
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
const jobStageStrip = $("jobStageStrip");
const jobActionBar = $("jobActionBar");
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
const jobAssignedTo = $("jobAssignedTo");
const jobMainServiceType       = $("jobMainServiceType");
const jobServiceType           = $("jobServiceType");
const jobEquipmentId           = $("jobEquipmentId");
const jobBillableHours         = $("jobBillableHours");
const jobMinimumHours          = $("jobMinimumHours");
const jobTravelHours           = $("jobTravelHours");
const jobTruckRate             = $("jobTruckRate");
const jobOperatorRate          = $("jobOperatorRate");
const jobAfterHoursMultiplier  = $("jobAfterHoursMultiplier");
const jobMobilizationFee       = $("jobMobilizationFee");
const jobDisposalVolume        = $("jobDisposalVolume");
const jobDisposalCost          = $("jobDisposalCost");
const jobDisposalSite          = $("jobDisposalSite");
const jobDisposalManifest      = $("jobDisposalManifest");
const btnJobOpenOrder = $("btnJobOpenOrder");
const btnJobRecordPayment = $("btnJobRecordPayment");
const facilityStageStrip = $("facilityStageStrip");
const facilityActionBar = $("facilityActionBar");
const hydrovacFacilitiesList = $("hydrovacFacilitiesList");
const hydrovacFacilityForm = $("hydrovacFacilityForm");
const hydrovacFacilityId = $("hydrovacFacilityId");
const hydrovacFacilityName = $("hydrovacFacilityName");
const hydrovacFacilityStatus = $("hydrovacFacilityStatus");
const hydrovacFacilityType = $("hydrovacFacilityType");
const hydrovacFacilityPermitExpiry = $("hydrovacFacilityPermitExpiry");
const hydrovacFacilityAddress = $("hydrovacFacilityAddress");
const hydrovacFacilityCityState = $("hydrovacFacilityCityState");
const hydrovacFacilityRateGallon = $("hydrovacFacilityRateGallon");
const hydrovacFacilityRateYard = $("hydrovacFacilityRateYard");
const hydrovacFacilityMinimumCharge = $("hydrovacFacilityMinimumCharge");
const hydrovacFacilityContact = $("hydrovacFacilityContact");
const hydrovacFacilityDispatchPhone = $("hydrovacFacilityDispatchPhone");
const hydrovacFacilityWasteTypes = $("hydrovacFacilityWasteTypes");
const hydrovacFacilityNotes = $("hydrovacFacilityNotes");
const hydrovacFacilityMsg = $("hydrovacFacilityMsg");
const hydrovacFacilityFormTitle = $("hydrovacFacilityFormTitle");
const btnRefreshFacilities = $("btnRefreshFacilities");
const btnNewFacility = $("btnNewFacility");
const btnSaveAndAddFacility = $("btnSaveAndAddFacility");
const btnClearFacility = $("btnClearFacility");
const manifestStageStrip = $("manifestStageStrip");
const manifestActionBar = $("manifestActionBar");
const hydrovacManifestsList = $("hydrovacManifestsList");
const hydrovacManifestDetailWrap = $("hydrovacManifestDetailWrap");
const btnRefreshManifests = $("btnRefreshManifests");
const locateStageStrip = $("locateStageStrip");
const locateActionBar = $("locateActionBar");
const hydrovacLocateList = $("hydrovacLocateList");
const hydrovacLocateForm = $("hydrovacLocateForm");
const hydrovacLocateId = $("hydrovacLocateId");
const hydrovacLocateJobId = $("hydrovacLocateJobId");
const hydrovacLocateType = $("hydrovacLocateType");
const hydrovacLocateNumber = $("hydrovacLocateNumber");
const hydrovacLocateStatus = $("hydrovacLocateStatus");
const hydrovacLocateCenter = $("hydrovacLocateCenter");
const hydrovacLocateState = $("hydrovacLocateState");
const hydrovacLocateAddress = $("hydrovacLocateAddress");
const hydrovacLocateValidFrom = $("hydrovacLocateValidFrom");
const hydrovacLocateValidUntil = $("hydrovacLocateValidUntil");
const hydrovacLocateNotes = $("hydrovacLocateNotes");
const hydrovacLocateMsg = $("hydrovacLocateMsg");
const btnRefreshLocates = $("btnRefreshLocates");
const btnNewLocate = $("btnNewLocate");
const btnVerifyLocate = $("btnVerifyLocate");
const btnClearLocate = $("btnClearLocate");
const complianceStageStrip = $("complianceStageStrip");
const complianceActionBar = $("complianceActionBar");
const hydrovacComplianceSummary = $("hydrovacComplianceSummary");
const hydrovacComplianceUrgent = $("hydrovacComplianceUrgent");
const hydrovacComplianceCoverage = $("hydrovacComplianceCoverage");
const btnRefreshCompliance = $("btnRefreshCompliance");
const driverStageStrip = $("driverStageStrip");
const driverActionBar = $("driverActionBar");
const driverQualificationsList = $("driverQualificationsList");
const driverQualificationDetail = $("driverQualificationDetail");
const dispatchStageStrip = $("dispatchStageStrip");
const dispatchActionBar = $("dispatchActionBar");
const dispatchDate = $("dispatchDate");
const dispatchBoard = $("dispatchBoard");
const dispatchDetail = $("dispatchDetail");
const btnRefreshDispatchBoard = $("btnRefreshDispatchBoard");
const hydrovacInvoiceStageStrip = $("hydrovacInvoiceStageStrip");
const hydrovacInvoiceActionBar = $("hydrovacInvoiceActionBar");
const hydrovacInvoiceJobSelect = $("hydrovacInvoiceJobSelect");
const btnPreviewHydrovacInvoice = $("btnPreviewHydrovacInvoice");
const hydrovacInvoiceMsg = $("hydrovacInvoiceMsg");
const hydrovacInvoicePreview = $("hydrovacInvoicePreview");
const permitStageStrip = $("permitStageStrip");
const permitActionBar = $("permitActionBar");
const hydrovacPermitList = $("hydrovacPermitList");
const hydrovacPermitDetail = $("hydrovacPermitDetail");
const assetStageStrip = $("assetStageStrip");
const assetActionBar = $("assetActionBar");
const hydrovacAssetList = $("hydrovacAssetList");
const hydrovacAssetDetail = $("hydrovacAssetDetail");
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
const btnSaveAndAddCustomer = $("btnSaveAndAddCustomer");
const btnClearCustomerForm = $("btnClearCustomerForm");
const customerId = $("customerId");
const customerName = $("customerName");
const customerEmail = $("customerEmail");
const customerPhone = $("customerPhone");
const customerPreferredContact = $("customerPreferredContact");
const customerNotes = $("customerNotes");
const customerAddress1 = $("customerAddress1");
const customerCity = $("customerCity");
const customerState = $("customerState");
const customerZip = $("customerZip");

const paymentsList = $("paymentsList");
const moneyStageStrip = $("moneyStageStrip");
const moneyActionBar = $("moneyActionBar");
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
const setupPrimaryCtaLabel = $("setupPrimaryCtaLabel");
const setupBookingCtaLabel = $("setupBookingCtaLabel");
const setupSiteFontPreset = $("setupSiteFontPreset");
const setupSiteSurfaceStyle = $("setupSiteSurfaceStyle");
const setupSiteButtonStyle = $("setupSiteButtonStyle");
const setupSiteCardStyle = $("setupSiteCardStyle");
const setupSiteHeroLayout = $("setupSiteHeroLayout");
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
const btnPreviewWebsite = $("btnPreviewWebsite");
const btnOpenSetupHomePreview = $("btnOpenSetupHomePreview");
const btnPublishWebsite = $("btnPublishWebsite");
const btnPublishWebsiteTop = $("btnPublishWebsiteTop");
const btnOpenSetupProductsPreview = $("btnOpenSetupProductsPreview");
const btnOpenSetupOrderPreview = $("btnOpenSetupOrderPreview");
const btnOpenSetupAboutPreview = $("btnOpenSetupAboutPreview");
const btnOpenSetupContactPreview = $("btnOpenSetupContactPreview");
const btnOpenSetupHowPreview = $("btnOpenSetupHowPreview");
const btnOpenSetupPublishedSite = $("btnOpenSetupPublishedSite");
const setupLogoStatus = $("setupLogoStatus");
const setupHeroStatus = $("setupHeroStatus");
const setupPublishMeta = $("setupPublishMeta");
let SETUP_STATE = null;

const productsList = $("productsList");
const productPresetNotice = $("productPresetNotice");
const btnNewProduct = $("btnNewProduct");
const btnLoadRecommendedServices = $("btnLoadRecommendedServices");
const btnRefreshProducts = $("btnRefreshProducts");
const productSearch = $("productSearch");
const servicePresetPack = $("servicePresetPack");
const productForm = $("productForm");
const productFormTitle = $("productFormTitle");
const productMsg = $("productMsg");
const btnArchiveProduct = $("btnArchiveProduct");
const productId = $("productId");
const productName = $("productName");
const productSlug = $("productSlug");
const productCategory = $("productCategory");
const productDescription = $("productDescription");
const productTags = $("productTags");
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
let OPERATOR_MEMBERS_CACHE = [];
let TEAM_MEMBERS_CACHE = [];
let TIME_ENTRIES_CACHE = [];
let VENDORS_CACHE = [];
let EQUIPMENT_CACHE = [];
let EQUIPMENT_PANEL_LOADED = false;
let HYDROVAC_FACILITIES_CACHE = [];
let HYDROVAC_MANIFESTS_CACHE = [];
let HYDROVAC_LOCATE_TICKETS_CACHE = [];
let HYDROVAC_DRIVER_COMPLIANCE_CACHE = [];
let HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE = [];
let HYDROVAC_ANALYTICS_CACHE = null;
let HYDROVAC_PERMITS_CACHE = [];
let HYDROVAC_ASSETS_CACHE = [];
let INVENTORY_CACHE = [];
let INVENTORY_PANEL_LOADED = false;

// Reviews
let REVIEWS_CACHE = [];
let QUOTES_CACHE  = [];
const JOB_HYDROVAC_DETAIL_CACHE = new Map();

// Bulk order selection
let BULK_SELECTED_ORDER_IDS = new Set();

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
  leads: ["leads", "bids", "orders", "customers"],
  bids: ["bids", "leads", "orders", "jobs", "customers"],
  orders: ["orders", "leads", "bids", "jobs", "payments", "customers"],
  jobs: ["jobs", "orders", "bids", "payments", "expenses", "customers", "manifests", "locates", "compliance"],
  plans: ["plans", "bookings", "jobs", "customers", "payments"],
  customers: ["customers", "leads", "bids", "orders", "jobs", "payments"],
  import: ["import", "customers", "orders", "payments"],
  payments: ["payments", "orders", "jobs", "money", "customers"],
  equipment: ["equipment", "facilities", "compliance", "jobs"],
  facilities: ["facilities", "manifests", "compliance", "equipment", "jobs"],
  manifests: ["manifests", "jobs", "money", "facilities", "compliance"],
  locates: ["locates", "jobs", "compliance", "orders"],
  compliance: ["compliance", "locates", "manifests", "facilities", "equipment", "jobs"],
  domains: ["domains", "setup"],
  setup: ["setup", "domains", "guidance"],
  products: ["products", "pricing", "availability"],
  pricing: ["pricing", "products", "availability"],
  availability: ["availability", "bookings", "products", "pricing", "plans"],
  bookings: ["bookings", "availability", "plans", "jobs"],
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
  landscaping_maintenance: {
    label: "Landscaping",
    intro: "Built for recurring maintenance, seasonal cleanups, and property-specific notes where the operator needs to keep the visit easy to sell and easy to repeat.",
    scopePrompt: "Document yard size, access, gates, pet notes, recurring cadence, bed count, debris level, and any property-specific instructions that need to carry forward.",
    solutionPrompt: "Break the work into the recurring visit, the seasonal reset, and any upgrade or enhancement work the customer may approve separately.",
    photoPrompts: [
      "Wide shot of the front yard and street view",
      "Backyard, fence gates, and access constraints",
      "Beds, shrubs, leaves, or overgrowth that change labor",
      "Property notes like steep grade, toys, pet waste, or obstacles",
    ],
    pricingPrompts: [
      "Recurring visit cadence",
      "Seasonal cleanup or reset",
      "Optional mulch, trimming, or enhancement work",
    ],
    lineItems: [
      { name: "Recurring property visit", description: "Core mow, trim, blow, or recurring maintenance scope tied to the property notes captured during the visit.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "base" },
      { name: "Seasonal cleanup allowance", description: "Allowance for leaf volume, debris haul-off, or extra cleanup labor that depends on what is actually onsite.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional enhancement", description: "Mulch, shrub trimming, bed refresh, or another property upgrade the customer can approve without changing the base visit.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Seasonal consumables, debris bags, mulch, and truck tools are planned from the property notes so repeat visits stay consistent.",
    unused: "Unused material stays tied to the property record so the next visit starts from the real on-site condition instead of memory.",
    exclusions: "Tree removal, hardscape work, irrigation repairs, and heavy debris hauling are excluded unless specifically listed.",
    warranty: "Recurring quality is reviewed against the agreed visit scope and the documented property notes for that customer.",
    terms: "Pricing assumes normal property access and the visible growth conditions documented during the walkthrough. Heavy overgrowth or added tasks require approval.",
    deliveryNote: "Here is the landscaping proposal from the site visit, including the recurring work, seasonal reset items, and any optional upgrades we recommend.",
    proposalPrompts: [
      "Separate the repeatable visit from the one-time cleanup so the customer understands what happens every time versus right now.",
      "Use property-specific notes so future visits feel repeatable instead of dependent on memory.",
      "Keep upgrades optional and clearly labeled so the base maintenance price stays easy to say yes to.",
    ],
    scopeStarters: [
      { key: "recurring_property_visit", name: "Recurring property visit", description: "Routine mow, trim, blow, or recurring maintenance tied to the property notes captured on site.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "base" },
      { key: "seasonal_cleanup", name: "Seasonal cleanup", description: "Leaf pickup, debris reset, bed cleanup, or seasonal catch-up work that should be priced separately from the repeat visit.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "allowance" },
      { key: "property_enhancement", name: "Enhancement add-on", description: "Mulch, shrub trimming, edging, or another optional upgrade the customer can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
  },
  cleaning_services: {
    label: "Cleaning",
    intro: "Built for recurring cleanings, deep cleans, turnovers, and scope-sensitive visit pricing where trust comes from spelling out exactly what is included.",
    scopePrompt: "Capture home size, bathrooms, pet hair, clutter level, first-visit condition, parking/access notes, and anything that changes labor time or visit cadence.",
    solutionPrompt: "Separate the recurring clean, the deep-clean catch-up, and optional add-ons so the customer knows what happens every visit versus only once.",
    photoPrompts: [
      "Wide shot of main living spaces",
      "Kitchen and bathroom condition",
      "Heavy buildup, pet hair, or first-visit catch-up areas",
      "Access, parking, stairs, or entry instructions",
    ],
    pricingPrompts: [
      "Recurring visit price",
      "First-visit or deep-clean catch-up",
      "Optional inside appliances, windows, or add-ons",
    ],
    lineItems: [
      { name: "Recurring cleaning visit", description: "Core cleaning scope for the agreed rooms, surfaces, and recurring cadence.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "base" },
      { name: "First-visit catch-up allowance", description: "Allowance for extra labor, buildup, or reset work needed before the home settles into the recurring standard.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional add-on clean", description: "Inside appliances, interior windows, or another optional extra that the customer can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Consumables, vacuums, and specialty cleaners are staged from the documented home condition and the recurring scope agreed with the customer.",
    unused: "Unused consumables stay in standard stock while the visit notes carry forward the real home condition for the next clean.",
    exclusions: "Biohazard cleanup, excessive clutter organizing, mold remediation, and restoration work are excluded unless listed.",
    warranty: "Service quality is reviewed against the agreed room list and the notes documented during the intake or walkthrough.",
    terms: "Pricing assumes normal home access and the visible condition documented during the walkthrough. Heavy buildup or added rooms require approval.",
    deliveryNote: "Attached is the cleaning proposal from the walkthrough, including the recurring scope, the first-visit reset work, and any optional add-ons.",
    proposalPrompts: [
      "Keep recurring work separate from first-visit catch-up so the ongoing price stays believable and easy to understand.",
      "Spell out any condition factors like pet hair, buildup, or extra bathrooms before they turn into surprises.",
      "Use optional add-ons instead of burying them in the base visit so the customer can choose the right level cleanly.",
    ],
    scopeStarters: [
      { key: "recurring_cleaning_visit", name: "Recurring cleaning visit", description: "Routine cleaning for the agreed rooms and cadence once the home is at maintenance level.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "base" },
      { key: "deep_clean_catchup", name: "Deep-clean catch-up", description: "One-time reset labor for first-visit buildup, neglected areas, or a turnover-level clean.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "allowance" },
      { key: "cleaning_add_on", name: "Cleaning add-on", description: "Inside oven, fridge, interior windows, or another optional extra the customer can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
  },
  photography_sessions: {
    label: "Photography",
    intro: "Built for portrait, family, and brand sessions where the deliverables, timeline, and client expectations matter as much as the shoot itself.",
    scopePrompt: "Capture session type, location, people count, wardrobe notes, deliverables, turnaround expectations, and any permits or travel factors.",
    solutionPrompt: "Define the session coverage, editing deliverables, delivery timing, and any optional upgrades like prints, rush edits, or extra locations.",
    photoPrompts: [
      "Location overview or mood board reference",
      "Lighting conditions and time-of-day note",
      "Key backdrop, setup, or access constraint",
      "Inspiration reference or must-have shot note",
    ],
    pricingPrompts: [
      "Session coverage",
      "Editing and delivery scope",
      "Optional prints, rush turnaround, or extra coverage",
    ],
    lineItems: [
      { name: "Session coverage", description: "Photography session time, planning, and on-site coverage for the agreed shoot.", quantity: 1, unit: "session", unit_price_cents: 0, kind: "base" },
      { name: "Editing and delivery allowance", description: "Allowance for edit volume, retouch depth, travel, or file-delivery complexity beyond the base session.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional upgrade", description: "Optional print package, rush delivery, extra location, or extended coverage the client can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Session prep, gear, and delivery planning are staged from the location and deliverable notes captured before the shoot.",
    unused: "Unused prep time or reserved deliverable capacity stays documented in the client record so the next session starts with the right context.",
    exclusions: "Permit fees, studio rentals, specialty retouching, and extra travel outside the written scope are excluded unless listed.",
    warranty: "Deliverables are reviewed against the agreed session scope, image count, and turnaround timeline documented in the proposal.",
    terms: "Pricing assumes the planned location, people count, and session timeline match the intake notes. Added coverage or rush work requires approval.",
    deliveryNote: "Attached is the session proposal, including the coverage plan, deliverables, and any optional upgrades we discussed.",
    proposalPrompts: [
      "Make the deliverables and turnaround timing as clear as the shoot itself.",
      "Separate the session coverage from editing and extras so the package feels intentional instead of vague.",
      "Use the proposal to reduce anxiety by confirming location, people count, and what the client gets at the end.",
    ],
    scopeStarters: [
      { key: "session_coverage", name: "Session coverage", description: "Base portrait, family, or brand session coverage for the agreed time window and location.", quantity: 1, unit: "session", unit_price_cents: 0, kind: "base" },
      { key: "editing_delivery", name: "Editing and delivery", description: "Editing time, gallery delivery, or travel complexity that needs to be visible in the package.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { key: "session_upgrade", name: "Session upgrade", description: "Extra location, rush turnaround, album, or print add-on the client can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
  },
  pet_care_services: {
    label: "Pet services",
    intro: "Built for grooming, walking, and pet-care visits where the pet profile, behavior notes, and repeat-client trust all need to stay attached to the work.",
    scopePrompt: "Capture pet name, breed, size, temperament, service history, home access notes, and any care instructions that need to follow every visit.",
    solutionPrompt: "Spell out the core visit, pet-specific handling notes, and any optional upgrades like add-on grooming, extra walk time, or medication support.",
    photoPrompts: [
      "Pet profile reference photo",
      "Coat condition, matting, or handling concerns",
      "Home access, leash, crate, or entry instructions",
      "Care setup like feeding station, yard, or medication notes",
    ],
    pricingPrompts: [
      "Core visit or service",
      "Behavior, coat, or time allowance",
      "Optional add-on grooming or extra care",
    ],
    lineItems: [
      { name: "Core pet-care visit", description: "Base grooming, walking, or in-home care visit tied to the pet profile and agreed service length.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "base" },
      { name: "Pet-specific allowance", description: "Allowance for coat condition, handling complexity, extra walk time, or care instructions beyond the base visit.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional care add-on", description: "Optional add-on for nails, medication, extra play time, or another approved care upgrade.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Visit supplies and handling prep are planned from the pet profile and service notes so repeat visits stay consistent and safe.",
    unused: "Unused supplies return to stock while the pet-specific notes stay tied to the customer record for future visits.",
    exclusions: "Aggression handling beyond the agreed scope, emergency vet care, and unscheduled additional pets are excluded unless listed.",
    warranty: "Service quality is reviewed against the documented pet profile, agreed visit length, and care notes for that client.",
    terms: "Pricing assumes the pet condition and handling needs match the documented notes. Additional behavior, coat, or care complexity requires approval.",
    deliveryNote: "Attached is the pet-service proposal, including the visit plan, pet notes we are carrying forward, and any optional care add-ons.",
    proposalPrompts: [
      "Keep the pet profile visible in the proposal so the client feels understood, not processed.",
      "Separate the standard visit from pet-specific complexity instead of hiding it in the base number.",
      "Use repeat-visit language that makes future scheduling feel easy and trustworthy.",
    ],
    scopeStarters: [
      { key: "core_pet_visit", name: "Core pet-care visit", description: "Base grooming, walking, or drop-in care visit tied to the pet's normal routine.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "base" },
      { key: "pet_complexity_allowance", name: "Pet-specific allowance", description: "Allowance for matting, behavior, extra handling time, or home-access complexity beyond the base visit.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { key: "pet_add_on", name: "Optional care add-on", description: "Nail trim, extra walk time, medication support, or another add-on the client can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
  },
  event_planning: {
    label: "Events",
    intro: "Built for event proposals where the client needs to see the production plan, inclusions, timeline, and optional upgrades without getting lost.",
    scopePrompt: "Capture event type, guest count, venue, timeline, included services, vendor dependencies, and any decisions still pending.",
    solutionPrompt: "Break the event into the base package, coordination or rental allowances, and optional upgrades the client can approve separately.",
    photoPrompts: [
      "Venue overview and layout notes",
      "Key setup zones or decor inspiration",
      "Access, loading, or timing constraints",
      "Must-have elements, rentals, or staging references",
    ],
    pricingPrompts: [
      "Base event package",
      "Coordination or rental allowance",
      "Optional upgrades or add-ons",
    ],
    lineItems: [
      { name: "Base event package", description: "Core coordination, planning, or production scope tied to the event timeline and guest count.", quantity: 1, unit: "event", unit_price_cents: 0, kind: "base" },
      { name: "Coordination / rental allowance", description: "Allowance for staffing, rentals, florals, or vendor-managed items that depend on final event details.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional event upgrade", description: "Optional decor, entertainment, extra coverage, or premium add-on the client can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Timeline planning, rental assumptions, and vendor support are staged from the event brief so execution feels organized before the date arrives.",
    unused: "Unused rental or coordination capacity stays documented in the event record so changes can be handled without losing clarity.",
    exclusions: "Venue fees, permits, taxes, third-party vendor contracts, and client-requested additions outside the written scope are excluded unless listed.",
    warranty: "Execution is reviewed against the documented timeline, inclusions, and approvals tied to the booked event.",
    terms: "Pricing assumes the guest count, venue, and event scope match the current brief. Added services or timeline changes require approval.",
    deliveryNote: "Attached is the event proposal, including the package scope, timeline assumptions, and optional upgrades we discussed.",
    proposalPrompts: [
      "Make the timeline and inclusions as clear as the price so the client sees a plan, not just a number.",
      "Separate base coordination from vendor or rental allowances so open items stay visible.",
      "Use optional upgrades to protect the core package from getting muddy while still making upsells easy.",
    ],
    scopeStarters: [
      { key: "base_event_package", name: "Base event package", description: "Core planning, coordination, or execution package for the event as currently scoped.", quantity: 1, unit: "event", unit_price_cents: 0, kind: "base" },
      { key: "event_allowance", name: "Coordination or rental allowance", description: "Allowance for staffing, rentals, florals, or another event component not fully finalized yet.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { key: "event_upgrade", name: "Optional event upgrade", description: "Premium decor, entertainment, extra coverage, or another add-on the client can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
  },
  handyman_punchlist: {
    label: "Handyman",
    intro: "Built for punch lists, mixed repairs, and small project visits where the customer needs to see what is included now, what may vary, and what can be added later.",
    scopePrompt: "Document the punch-list items, access notes, existing-condition risks, materials likely needed, and any tasks that should be broken out as optional.",
    solutionPrompt: "Group the work into the core visit, a material or hidden-condition allowance, and optional add-ons so the customer can approve it quickly.",
    photoPrompts: [
      "Wide shot of each repair zone",
      "Close-up of damage, wear, or failure point",
      "Access, ladder, parking, or furniture-move constraints",
      "Materials, finishes, or match detail that affect the repair",
    ],
    pricingPrompts: [
      "Core punch-list labor",
      "Material or hidden-condition allowance",
      "Optional extra tasks",
    ],
    lineItems: [
      { name: "Core punch-list visit", description: "Base labor for the agreed repair or installation list captured during the walkthrough.", quantity: 1, unit: "visit", unit_price_cents: 0, kind: "base" },
      { name: "Material / hidden-condition allowance", description: "Allowance for small materials, patching, or conditions that cannot be fully confirmed until the work starts.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional extra task", description: "Optional adjacent repair or upgrade the customer can approve without rebuilding the whole estimate.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Truck stock, small hardware, and purchased materials are planned from the punch list and the site conditions documented during the walkthrough.",
    unused: "Unused materials are returned to stock or tagged to the job record so follow-up work starts from the real condition instead of guesswork.",
    exclusions: "Permit work, hidden structural issues, specialty trade repairs, and finish restoration outside the written scope are excluded unless listed.",
    warranty: "Completed handyman work is reviewed against the documented punch list and the materials installed during the visit.",
    terms: "Pricing assumes the visible conditions match the walkthrough. Hidden damage or added tasks require approval before extra charges are added.",
    deliveryNote: "Attached is the handyman proposal from the walkthrough, including the core punch-list work, any allowances, and the optional extras we discussed.",
  },
  bakery_custom_orders: {
    label: "Bakery / custom orders",
    intro: "Built for custom cakes, dessert tables, and event baking where the proposal needs to make quantities, design assumptions, and delivery details feel easy to trust.",
    scopePrompt: "Capture servings, flavors, design direction, pickup or delivery timing, allergy notes, and any event-specific setup details.",
    solutionPrompt: "Separate the base order, design or setup allowances, and optional add-ons like cupcakes, toppers, or delivery support.",
    photoPrompts: [
      "Design inspiration or sample reference",
      "Color palette or theme notes",
      "Delivery, setup, or venue timing detail",
      "Sizing, tier, or dessert-table quantity note",
    ],
    pricingPrompts: [
      "Base baked order",
      "Design or specialty allowance",
      "Optional add-ons or delivery support",
    ],
    lineItems: [
      { name: "Base custom order", description: "Core cake, dessert, or baked-good scope tied to the agreed servings and flavor direction.", quantity: 1, unit: "order", unit_price_cents: 0, kind: "base" },
      { name: "Design or specialty allowance", description: "Allowance for specialty decoration, premium ingredients, or setup details that depend on final design.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional add-on", description: "Cupcakes, cookies, topper work, delivery, or another add-on the client can approve separately.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Ingredient planning, production timing, and packaging are staged from the order brief so pickup or delivery stays predictable.",
    unused: "Unused prep capacity and design notes stay tied to the order record for future repeats or event follow-up.",
    exclusions: "Rush orders, major design changes, venue setup beyond the written scope, and allergy assurances outside the documented notes are excluded unless listed.",
    warranty: "Order quality is reviewed against the confirmed flavor, design direction, and pickup or delivery details captured in the proposal.",
    terms: "Pricing assumes the serving count, design complexity, and timing match the current order brief. Large design changes or rush timing require approval.",
    deliveryNote: "Attached is the custom order proposal, including the servings, design assumptions, and any optional add-ons or delivery support.",
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
  hydrovac_vactor: {
    label: "Hydrovac / Vactor",
    intro: "Built for Vactor and hydrovac work where truck time, crew mix, disposal, and site access are the main pricing drivers.",
    scopePrompt: "Capture the site conditions, structure count, spoil and liquid assumptions, access constraints, and whether the truck is supporting cleanout, excavation, flood response, or line work.",
    solutionPrompt: "Spell out the truck and crew minimum, disposal assumptions, work sequence on site, and any allowance for extra gallons, tonnage, or specialty support.",
    photoPrompts: [
      "Wide shot of the site, basin area, or excavation zone",
      "Close-up of solids, sludge, debris, or flooding conditions",
      "Truck access, hose route, traffic, or safety constraints",
      "Structure IDs, basin lids, line entry points, or measured work zones",
    ],
    pricingPrompts: [
      "Minimum truck and crew block",
      "Liquid disposal or spoil treatment beyond the included allowance",
      "Optional extra support like plumber, washout, or emergency response",
    ],
    lineItems: [
      { name: "Truck and crew minimum", description: "Base hydrovac / Vactor block for the truck, operator, helper or plumber, and the included disposal allowance tied to the visit.", quantity: 1, unit: "job", unit_price_cents: 0, kind: "base" },
      { name: "Disposal or spoil overage", description: "Allowance for extra liquid gallons, solids tonnage, or treatment charges beyond the included minimum block.", quantity: 1, unit: "allowance", unit_price_cents: 0, kind: "allowance" },
      { name: "Optional support or extended time", description: "Optional add-on for extra truck time, plumber support, washout, or emergency conditions beyond the base visit.", quantity: 1, unit: "option", unit_price_cents: 0, kind: "option" },
    ],
    materials: "Truck time, helper or plumber support, disposal allowances, and site handling assumptions are staged from the walkthrough and the company-standard Vactor pricing.",
    unused: "Unused disposal allowance and reserved support stay documented in the quote record, while leftover materials or site notes carry forward to the active job.",
    exclusions: "Traffic control, permit costs, hidden obstructions, extra disposal beyond the included allowance, and emergency conditions outside the written scope are excluded unless listed.",
    warranty: "Proposal scope is reviewed at completion based on the documented site conditions and the truck support provided during the work window.",
    terms: "Pricing reflects the visible site conditions, the included minimum block, and the listed disposal assumptions. Extra gallons, tonnage, hidden obstructions, or expanded scope require approval.",
    deliveryNote: "Attached is the hydrovac / Vactor proposal from the walkthrough, including the site conditions, the crew and truck block we recommend, and the disposal assumptions built into the price.",
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

function opId() { if (!CURRENT_OPERATOR?.operator_id) throw new Error("Operator context not loaded."); return CURRENT_OPERATOR.operator_id; }
function getOperatorAccessToken() {
  return window.PROOFLINK_OPERATOR_RUNTIME?.getAccessToken?.() || Promise.resolve("");
}
// Alias used throughout the file
const getAccessToken = getOperatorAccessToken;
async function requestOperatorFunction(functionName, options = {}) {
  const method = String(options.method || "GET").trim().toUpperCase() || "GET";
  const query = String(options.query || "").trim();
  const token = await getOperatorAccessToken();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/.netlify/functions/${functionName}${query ? `?${query}` : ""}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}
async function postOperatorFunction(functionName, payload = {}) {
  return requestOperatorFunction(functionName, { method: "POST", body: payload });
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
function currentPayment() {
  return PAYMENTS_CACHE.find((row) => row.id === ACTIVE_PAYMENT_ID) || null;
}
function currentJob() {
  return JOBS_CACHE.find((row) => row.id === ACTIVE_JOB_ID) || null;
}
function hydrovacJobDetailState(jobId) {
  return JOB_HYDROVAC_DETAIL_CACHE.get(jobId) || {
    tickets: [],
    manifests: [],
    loading: false,
    error: "",
    loadedAt: 0,
  };
}
function setHydrovacJobDetailState(jobId, nextState = {}) {
  const current = hydrovacJobDetailState(jobId);
  const merged = { ...current, ...nextState };
  JOB_HYDROVAC_DETAIL_CACHE.set(jobId, merged);
  return merged;
}
async function fetchJobHydrovacDetails(jobId, options = {}) {
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) return hydrovacJobDetailState("");
  const existing = hydrovacJobDetailState(cleanJobId);
  const freshEnough = existing.loadedAt && (Date.now() - existing.loadedAt) < 20000;
  if (!options.force && (existing.loading || freshEnough)) return existing;
  setHydrovacJobDetailState(cleanJobId, { loading: true, error: "" });
  try {
    const [ticketData, manifestData] = await Promise.all([
      requestOperatorFunction("manage-locate-tickets", {
        query: `job_id=${encodeURIComponent(cleanJobId)}`,
      }),
      requestOperatorFunction("manage-waste-manifests", {
        query: `job_id=${encodeURIComponent(cleanJobId)}`,
      }),
    ]);
    return setHydrovacJobDetailState(cleanJobId, {
      tickets: Array.isArray(ticketData?.tickets) ? ticketData.tickets : [],
      manifests: Array.isArray(manifestData?.manifests) ? manifestData.manifests : [],
      loading: false,
      error: "",
      loadedAt: Date.now(),
    });
  } catch (error) {
    return setHydrovacJobDetailState(cleanJobId, {
      loading: false,
      error: error?.message || "Failed to load hydrovac details.",
      loadedAt: Date.now(),
    });
  }
}
function localDateToIso(value, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const time = endOfDay ? "T23:59:59" : "T00:00:00";
  const date = new Date(`${raw}${time}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function hydrovacLocateToneClass(ticket) {
  const status = normalizeWorkflowStatusValue(ticket?.status || "requested");
  const validUntil = Date.parse(ticket?.extended_until || ticket?.valid_until || "");
  if (status === "cancelled") return "pill-muted";
  if (Number.isFinite(validUntil) && validUntil < Date.now()) return "pill-bad";
  if (ticket?.verified_on_site && status === "active") return "pill-good";
  if (status === "active") return "pill-warn";
  return "pill-muted";
}
function hydrovacManifestToneClass(manifest) {
  const status = normalizeWorkflowStatusValue(manifest?.status || "in_transit");
  if (status === "confirmed" || status === "invoiced") return "pill-good";
  if (status === "void") return "pill-muted";
  return "pill-warn";
}
function hydrovacManifestQuantityLabel(manifest) {
  const quantity = manifest?.quantity_actual ?? manifest?.quantity_estimated;
  if (quantity == null || quantity === "") return "Qty pending";
  const unit = String(manifest?.quantity_unit || "gallons").replace(/_/g, " ");
  return `${Number(quantity)} ${unit}`;
}
function hydrovacManifestQuantityGallons(manifest) {
  const quantity = Number(manifest?.quantity_actual ?? manifest?.quantity_estimated ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const unit = normalizeWorkflowStatusValue(manifest?.quantity_unit || "gallons");
  if (unit === "gallons") return quantity;
  if (unit === "cubic_yards") return quantity * 201.974;
  return 0;
}
function hydrovacJobManifestSnapshot(jobId) {
  const manifests = (HYDROVAC_MANIFESTS_CACHE || []).filter((row) => row.job_id === jobId);
  const openLoads = manifests.filter((row) => ["in_transit", "delivered"].includes(normalizeWorkflowStatusValue(row.status))).length;
  const confirmedUnbilled = manifests.filter((row) => normalizeWorkflowStatusValue(row.status) === "confirmed" && row.invoiced !== true).length;
  const totalChargeCents = manifests.reduce((sum, row) => sum + Number(row.disposal_charge_cents || 0), 0);
  const totalCostCents = manifests.reduce((sum, row) => sum + Number(row.disposal_cost_cents || 0), 0);
  const unbilledChargeCents = manifests
    .filter((row) => normalizeWorkflowStatusValue(row.status) === "confirmed" && row.invoiced !== true)
    .reduce((sum, row) => sum + Number(row.disposal_charge_cents || 0), 0);
  const openGallons = manifests
    .filter((row) => ["in_transit", "delivered"].includes(normalizeWorkflowStatusValue(row.status)))
    .reduce((sum, row) => sum + hydrovacManifestQuantityGallons(row), 0);
  return {
    manifests,
    openLoads,
    confirmedUnbilled,
    totalChargeCents,
    totalCostCents,
    unbilledChargeCents,
    openGallons,
  };
}
function hydrovacJobNeedsLocate(job) {
  const type = normalizeWorkflowStatusValue(job?.job_type || "");
  return ["hydrovac_excavation", "potholing", "daylighting"].includes(type);
}
function hydrovacJobNeedsPermit(job) {
  if (job?.requires_confined_space_permit === true) return true;
  const haystack = `${job?.job_type || ""} ${job?.title || ""} ${job?.summary || ""} ${job?.scope_of_work || ""} ${job?.service_address || ""}`;
  return /manhole|wet well|lift station|vault|tank/i.test(haystack);
}
function hydrovacDashboardSnapshot() {
  const hydrovacJobs = (JOBS_CACHE || []).filter((job) => isHydrovacJob(job));
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayJobs = hydrovacJobs.filter((job) => hydrovacJobSortDate(job) === todayKey);
  const expiringTickets = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((ticket) => {
    const days = daysUntil(ticket.extended_until || ticket.valid_until);
    return days != null && days >= 0 && days <= 3;
  });
  const expiredTickets = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((ticket) => {
    const days = daysUntil(ticket.extended_until || ticket.valid_until);
    return days != null && days < 0;
  });
  const openPermits = (HYDROVAC_PERMITS_CACHE || []).filter((permit) => normalizeWorkflowStatusValue(permit.status) === "open");
  const expiredPermits = openPermits.filter((permit) => {
    const days = daysUntil(permit.permit_valid_until);
    return days != null && days < 0;
  });
  const uninvoicedManifests = (HYDROVAC_MANIFESTS_CACHE || []).filter((manifest) => normalizeWorkflowStatusValue(manifest.status) === "confirmed" && manifest.invoiced !== true);
  const openLoads = (HYDROVAC_MANIFESTS_CACHE || []).filter((manifest) => ["in_transit", "delivered"].includes(normalizeWorkflowStatusValue(manifest.status)));
  const dispatchBlockedJobs = todayJobs.filter((job) => {
    const tickets = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((ticket) => ticket.job_id === job.id);
    const hasValidLocate = tickets.some((ticket) => {
      const status = normalizeWorkflowStatusValue(ticket.status);
      const until = Date.parse(ticket.extended_until || ticket.valid_until || "");
      return ["active", "extended"].includes(status) && (!Number.isFinite(until) || until > Date.now());
    });
    const permits = (HYDROVAC_PERMITS_CACHE || []).filter((permit) => permit.job_id === job.id && normalizeWorkflowStatusValue(permit.status) === "open");
    const hasPermit = permits.some((permit) => {
      const until = Date.parse(permit.permit_valid_until || "");
      return !Number.isFinite(until) || until > Date.now();
    });
    return !job.assigned_truck_id
      || !job.assigned_member_id
      || (hydrovacJobNeedsLocate(job) && !hasValidLocate)
      || (hydrovacJobNeedsPermit(job) && !hasPermit);
  });
  return {
    todayJobs,
    expiringTickets,
    expiredTickets,
    openPermits,
    expiredPermits,
    uninvoicedManifests,
    openLoads,
    dispatchBlockedJobs,
    uninvoicedChargeCents: uninvoicedManifests.reduce((sum, row) => sum + Number(row.disposal_charge_cents || 0), 0),
  };
}
function hydrovacInvoicePreviewHtml(jobId, result = null) {
  const job = (JOBS_CACHE || []).find((row) => row.id === jobId) || null;
  if (!job) return `<div class="muted">Pick a hydrovac job to build or refresh the invoice draft on the linked order.</div>`;
  const order = linkedOrderForJob(job);
  const customer = (CUSTOMERS_CACHE || []).find((row) => row.id === (order?.customer_id || job.customer_id)) || null;
  const manifestSnapshot = hydrovacJobManifestSnapshot(job.id);
  const lineItems = Array.isArray(result?.line_items) ? result.line_items : [];
  const totalCents = Number(result?.total_cents || order?.total_cents || 0);
  const dueCents = order ? orderAmountDueCents(order) : 0;
  const marginCents = manifestSnapshot.totalChargeCents - manifestSnapshot.totalCostCents;
  return `
    <div class="invoice-workbench">
      <div class="invoice-workbench__summary">
        <div class="invoice-workbench__stat">
          <span class="muted">Customer</span>
          <strong>${escapeHtml(customer?.name || order?.customer_name || job.customer_name || "Customer not linked")}</strong>
        </div>
        <div class="invoice-workbench__stat">
          <span class="muted">Confirmed manifests</span>
          <strong>${escapeHtml(String(manifestSnapshot.confirmedUnbilled))}</strong>
        </div>
        <div class="invoice-workbench__stat">
          <span class="muted">Disposal to bill</span>
          <strong>${formatUsd(manifestSnapshot.unbilledChargeCents)}</strong>
        </div>
        <div class="invoice-workbench__stat">
          <span class="muted">Disposal margin</span>
          <strong>${formatUsd(marginCents)}</strong>
        </div>
        <div class="invoice-workbench__stat">
          <span class="muted">Draft total</span>
          <strong>${formatUsd(totalCents)}</strong>
        </div>
        <div class="invoice-workbench__stat">
          <span class="muted">Open balance</span>
          <strong>${formatUsd(dueCents)}</strong>
        </div>
      </div>
      <div class="workspace-chip-row" style="margin-top:10px;">
        <span class="pill">${escapeHtml(job.title || "Hydrovac job")}</span>
        <span class="pill">${escapeHtml(titleCaseWords(String(job.status || "scheduled").replace(/_/g, " ")))}</span>
        <span class="pill">${escapeHtml(order?.status ? titleCaseWords(String(order.status).replace(/_/g, " ")) : "No linked order")}</span>
      </div>
      ${lineItems.length ? `
        <div class="table" style="margin-top:12px;">
          <div class="tr th">
            <div>Description</div>
            <div class="right">Amount</div>
          </div>
          ${lineItems.map((item) => `
            <div class="tr">
              <div>
                <div><strong>${escapeHtml(item.name || "Line item")}</strong></div>
                <div class="muted" style="margin-top:4px;">${escapeHtml(item.description || item.kind || "Hydrovac draft line")}</div>
              </div>
              <div class="right">${formatUsd(Number(item.total_cents || 0))}</div>
            </div>
          `).join("")}
          <div class="tr">
            <div><strong>Draft total</strong></div>
            <div class="right"><strong>${formatUsd(totalCents)}</strong></div>
          </div>
        </div>
      ` : `
        <div class="detail-card" style="margin-top:12px;">
          <div class="kicker">Draft snapshot</div>
          <div><strong>${escapeHtml(job.title || "Hydrovac job")}</strong></div>
          <div class="detail-copy">Refresh the draft to pull the latest manifests, job totals, and linked order line items into the invoice preview.</div>
        </div>
      `}
    </div>
  `;
}
function formatCountNumber(value) {
  return Number(value || 0).toLocaleString();
}
function hydrovacLocateExpiryLabel(ticket) {
  const raw = ticket?.extended_until || ticket?.valid_until || "";
  if (!raw) return "No expiry recorded";
  return `Expires ${formatDateTime(raw)}`;
}
function hydrovacMaterialLabel(value) {
  return titleCaseWords(String(value || "mixed").replace(/_/g, " "));
}
function hydrovacOpsSummary(job, tickets = [], manifests = []) {
  const activeTickets = tickets.filter((ticket) => {
    const status = normalizeWorkflowStatusValue(ticket?.status || "requested");
    const validUntil = Date.parse(ticket?.extended_until || ticket?.valid_until || "");
    return status === "active" && (!Number.isFinite(validUntil) || validUntil > Date.now());
  });
  const confirmedLoads = manifests.filter((manifest) => ["confirmed", "invoiced"].includes(normalizeWorkflowStatusValue(manifest?.status || "")));
  return {
    activeTickets: activeTickets.length,
    verifiedTickets: tickets.filter((ticket) => ticket?.verified_on_site).length,
    loadsLogged: manifests.length,
    confirmedLoads: confirmedLoads.length,
    gallonsHauled: Number(job?.total_gallons_hauled || 0),
    yardsHauled: Number(job?.total_yards_hauled || 0),
  };
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
// â”€â”€ Hydrovac revenue calculation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcHydrovacRevenueCents(job) {
  const bh       = Math.max(parseFloat(job.billable_hours) || 0, parseFloat(job.minimum_hours) || 2);
  const mult     = parseFloat(job.after_hours_multiplier) || 1.0;
  const truckR   = parseInt(job.hourly_truck_rate_cents)    || 0;
  const opR      = parseInt(job.hourly_operator_rate_cents) || 0;
  const mobFee   = parseInt(job.mobilization_fee_cents)     || 0;
  const disposal = parseInt(job.disposal_cost_cents)        || 0;
  if (!truckR && !opR) return null; // rates not set â€” not a hydrovac job
  return Math.round(bh * mult * (truckR + opR)) + mobFee + disposal;
}

function hydrovacRevenueBreakdownHtml(job) {
  const bh     = Math.max(parseFloat(job.billable_hours) || 0, parseFloat(job.minimum_hours) || 2);
  const mult   = parseFloat(job.after_hours_multiplier) || 1.0;
  const truckR = parseInt(job.hourly_truck_rate_cents)    || 0;
  const opR    = parseInt(job.hourly_operator_rate_cents) || 0;
  const mob    = parseInt(job.mobilization_fee_cents)     || 0;
  const disp   = parseInt(job.disposal_cost_cents)        || 0;
  const rate   = truckR + opR;
  const laborRev = Math.round(bh * mult * rate);
  const total  = laborRev + mob + disp;
  const multLabel = mult !== 1.0 ? ` Ã— ${mult}Ã— after-hours` : '';
  return {
    html: `
      <div>${bh.toFixed(2)} hrs Ã— $${(rate/100).toFixed(2)}/hr${multLabel} = <strong>$${(laborRev/100).toFixed(2)}</strong></div>
      ${mob  ? `<div>Mobilization: <strong>$${(mob/100).toFixed(2)}</strong></div>` : ''}
      ${disp ? `<div>Disposal: <strong>$${(disp/100).toFixed(2)}</strong></div>` : ''}
    `,
    total,
  };
}

function toggleHydrovacFields(value) {
  const el = document.getElementById('hydrovacFields');
  if (!el) return;
  const isHydrovac = value === 'hydrovac';
  el.style.display = isHydrovac ? 'block' : 'none';
  if (isHydrovac) {
    renderEquipmentOptions();
    if (jobServiceType && !String(jobServiceType.value || "").trim()) {
      applyHydrovacJobTemplate("hydrovac_4hr_laborer_minimum", {
        preserveExisting: true,
      });
    }
  }
}

function renderEquipmentOptions(selectedId = '') {
  if (!jobEquipmentId) return;
  jobEquipmentId.innerHTML = '<option value="">â€” Unassigned â€”</option>'
    + (EQUIPMENT_CACHE || [])
      .filter(e => e.is_active)
      .map(e => `<option value="${escapeAttr(e.id)}"${e.id === selectedId ? ' selected' : ''}>
        ${escapeHtml(e.unit_number ? `${e.unit_number} â€” ${e.name}` : e.name)}
        ${e.hourly_rate_cents ? ` ($${(e.hourly_rate_cents/100).toFixed(0)}/hr)` : ''}
      </option>`)
      .join('');
}

function updateHydrovacPreview() {
  const preview = document.getElementById('hydrovacRevenuePreview');
  const breakdown = document.getElementById('hydrovacRevenueBreakdown');
  const totalEl   = document.getElementById('hydrovacRevenueTotal');
  if (!preview) return;
  const job = {
    billable_hours              : jobBillableHours?.value,
    minimum_hours               : jobMinimumHours?.value || '2',
    after_hours_multiplier      : jobAfterHoursMultiplier?.value || '1',
    hourly_truck_rate_cents     : Math.round((parseFloat(jobTruckRate?.value) || 0) * 100),
    hourly_operator_rate_cents  : Math.round((parseFloat(jobOperatorRate?.value) || 0) * 100),
    mobilization_fee_cents      : Math.round((parseFloat(jobMobilizationFee?.value) || 0) * 100),
    disposal_cost_cents         : Math.round((parseFloat(jobDisposalCost?.value) || 0) * 100),
  };
  const rev = calcHydrovacRevenueCents(job);
  if (rev === null || rev === 0) { preview.style.display = 'none'; return; }
  const { html, total } = hydrovacRevenueBreakdownHtml(job);
  breakdown.innerHTML = html;
  totalEl.textContent = `Total: $${(total / 100).toFixed(2)}`;
  preview.style.display = 'block';
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
  "orders",
  "customers",
  "bookings",
  "payments",
  "leads",
  "bids",
  "jobs",
  "facilities",
  "manifests",
  "locates",
  "compliance",
  "plans",
  "expenses",
  "money",
  "products",
  "pricing",
  "availability",
  "import",
  "setup",
  "domains",
  "guidance",
  "quotes",
  "reviews",
  "messages",
  "ai",
];
const PRIMARY_TABS = new Set(["dashboard", "orders", "customers", "bookings", "payments", "setup", "guidance"]);
const SECONDARY_TABS = new Set([
  "leads",
  "bids",
  "jobs",
  "quotes",
  "plans",
  "expenses",
  "money",
  "reviews",
  "products",
  "pricing",
  "availability",
  "domains",
  "import",
  "vendors",
  "equipment",
  "team",
  "inventory",
  "contracts",
  "facilities",
  "manifests",
  "locates",
  "compliance",
]);
const SIDEBAR_GROUPS = {
  workflow: ["leads", "bids", "jobs", "quotes", "plans"],
  money: ["expenses", "money", "reviews"],
  website: ["products", "pricing", "availability", "domains", "import"],
  operations: ["vendors", "equipment", "team", "inventory", "contracts"],
  hydrovac: ["facilities", "manifests", "locates", "compliance"],
};
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
    "landscaping",
    "property_maintenance",
    "contractor",
    "handyman",
    "hvac",
    "plumbing",
    "cleaning",
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
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;
  const rawSelected = String(selectedValue || "").trim().toLowerCase();
  const selected = Architecture?.sanitizeBusinessType ? Architecture.sanitizeBusinessType(rawSelected) : rawSelected;
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
function isHydrovacWorkspace(blueprint = currentWorkspaceBlueprint()) {
  return String(blueprint?.business?.key || workspaceBusinessType() || "").trim().toLowerCase() === "hydrovac";
}
function isHydrovacJob(job, blueprint = currentWorkspaceBlueprint()) {
  if (!job) return false;
  if (isHydrovacWorkspace(blueprint)) return true;
  const type = String(job.service_type || job.job_type || "").trim().toLowerCase();
  return [
    "hydrovac",
    "vactor",
    "daylighting",
    "potholing",
    "catch_basin",
    "lift_station",
    "storm_drain",
    "industrial_vacuum",
    "tank_cleaning",
    "line_jetting",
  ].some((needle) => type.includes(needle));
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
function workspaceQuotedBookedLabel(blueprint = currentWorkspaceBlueprint()) {
  if (isServiceWorkspace(blueprint)) return "Quoted / booked";
  return workspaceOrderLabel(blueprint);
}
function workspaceJobsNavLabel(blueprint = currentWorkspaceBlueprint()) {
  if (isServiceWorkspace(blueprint)) return "Active jobs";
  return "Jobs";
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
function workspaceQuotesArchiveLabel(blueprint = currentWorkspaceBlueprint()) {
  if (isServiceWorkspace(blueprint)) return "Quote pages";
  return "Quotes";
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
  if (isHydrovacWorkspace(blueprint)) {
    return ["orders", "jobs", "customers", "payments"];
  }
  if (isServiceWorkspace(blueprint)) {
    return ["orders", "customers", "bookings", "payments"];
  }
  if (isBookingWorkspace(blueprint) || isEventWorkspace(blueprint)) {
    return ["bookings", "customers", "payments", "orders"];
  }
  return uniqList((blueprint?.priorityViews || []).map((moduleKey) => WORKSPACE_PRIORITY_TAB_MAP[moduleKey]).filter(Boolean));
}
function workspaceTabLabel(tab, blueprint = currentWorkspaceBlueprint()) {
  switch (tab) {
    case "dashboard":
      return "Today";
    case "leads":
      return "Requests";
    case "orders":
      return isServiceWorkspace(blueprint) ? "Work" : workspaceQuotedBookedLabel(blueprint);
    case "bids":
      return workspaceBidLabel(blueprint);
    case "jobs":
      return workspaceJobsNavLabel(blueprint);
    case "plans":
      return "Recurring Plans";
    case "bookings":
      return (isServiceWorkspace(blueprint) || isBookingWorkspace(blueprint) || isEventWorkspace(blueprint))
        ? "Calendar"
        : "Bookings";
    case "payments":
      return isServiceWorkspace(blueprint) ? "Money" : "Payments";
    case "import":
      return "Switch & Import";
    case "quotes":
      return workspaceQuotesArchiveLabel(blueprint);
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
    case "setup":
      return "Website";
    case "guidance":
      return "Operations";
    case "facilities":
      return "Facilities";
    case "manifests":
      return "Loads & Manifests";
    case "locates":
      return "Locate Tickets";
    case "compliance":
      return "Compliance";
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
        title: "Requests",
        subtitle: "Capture inbound work cleanly, link it to the customer automatically, and move it into quoting without rebuilding the record.",
      };
    case "orders":
      return {
        title: isServiceWorkspace(blueprint) ? "Work" : workspaceOrderLabel(blueprint),
        subtitle: isServiceWorkspace(blueprint)
          ? "Run the request, proposal, approved, and active-job stages from one workspace so the next step is always close by."
          : `Review live ${orderLower}, intake details, and what needs to happen next.`,
      };
    case "bids":
      return {
        title: workspaceBidLabel(blueprint),
        subtitle: isServiceWorkspace(blueprint)
          ? "Build the quote here with scope, photos, pricing, and customer-ready delivery language, then send it for approval."
          : "Build clear offers, pricing, and customer-ready delivery language in one place.",
      };
    case "jobs":
      return {
        title: "Jobs",
        subtitle: isServiceWorkspace(blueprint)
          ? "Track approved and scheduled field work here. If the customer is still deciding, keep it in Walkthrough Bids or Quoted / booked work."
          : "Track scheduled work, field progress, proof, and payment state without splitting execution from the customer record.",
      };
    case "plans":
      return {
        title: "Recurring Plans",
        subtitle: "Turn repeat service into scheduled orders and jobs without rebuilding the same work from scratch every month.",
      };
    case "bookings":
      return {
        title: workspaceTabLabel("bookings", blueprint),
        subtitle: (isServiceWorkspace(blueprint) || isBookingWorkspace(blueprint) || isEventWorkspace(blueprint))
          ? "See the calendar, upcoming commitments, booking flow, and route pressure in one place."
          : "Manage appointments and scheduled commitments in one place.",
      };
    case "payments":
      return {
        title: workspaceTabLabel("payments", blueprint),
        subtitle: isServiceWorkspace(blueprint)
          ? "Track deposits, collections, overdue balances, and payment follow-up without leaving the work behind."
          : "Track payments, collection status, and money movement in one place.",
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
      case "facilities":
        return {
          title: "Disposal Facilities",
          subtitle: "Keep approved dump sites, pricing, and permit coverage visible without digging through old notes.",
        };
      case "manifests":
        return {
          title: "Loads & Manifests",
          subtitle: "Track every hauled load, what got dumped, and which disposal charges are still waiting to be billed.",
        };
      case "locates":
        return {
          title: "Locate Tickets",
          subtitle: "Keep one-call coverage active, verified, and visible before field work turns risky.",
        };
      case "compliance":
        return {
          title: "Compliance",
          subtitle: "Surface document risk, expiring tickets, and uninvoiced disposal before they become expensive problems.",
        };
      case "guidance":
        return {
          title: "Operations",
          subtitle: `Reach the specialized tools for ${businessLabel} without crowding the daily navigation.`,
        };
    case "setup":
      return {
        title: "Website",
        subtitle: "Shape the customer-facing website, preview the pages, and publish when it feels right.",
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
    if (["facilities", "manifests", "locates", "compliance"].includes(tab)) {
      return isHydrovacWorkspace(blueprint);
    }
    if (isServiceWorkspace(blueprint) && (tab === "messages" || tab === "ai")) {
      return false;
    }
  if (tab === "bids") {
    if (hidden.has("bids")) return false;
    const priorityTabs = workspacePriorityTabs(blueprint);
    if (!priorityTabs.includes("bids") && !blueprint?.business?.bidProfile) return false;
  }
  if (tab === "plans") {
    return isServiceWorkspace(blueprint) || isBookingWorkspace(blueprint);
  }
  if (tab === "quotes" && isServiceWorkspace(blueprint)) {
    return false;
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
  if (tab === "bids" && isServiceWorkspace(blueprint)) {
    return `
      <div class="workspace-panel-notice is-soft">
        <div class="workspace-panel-notice__title">Build and send the quote here</div>
        <div class="workspace-panel-notice__copy">Start from a lead or click New quote. Use <strong>Quoted / awaiting approval</strong> after it has been sent and you are waiting on the customer to approve it.</div>
      </div>
    `;
  }
  if (tab === "orders" && isServiceWorkspace(blueprint)) {
    return `
      <div class="workspace-panel-notice is-soft">
        <div class="workspace-panel-notice__title">This is the quote and booking stage</div>
        <div class="workspace-panel-notice__copy">Use <strong>Quoted / awaiting approval</strong> while the customer is deciding. Once they approve, move it to confirmed or create the active field job.</div>
      </div>
    `;
  }
  if (tab === "jobs" && isServiceWorkspace(blueprint)) {
    return `
      <div class="workspace-panel-notice is-soft">
        <div class="workspace-panel-notice__title">Jobs are for approved work</div>
        <div class="workspace-panel-notice__copy">If you still need to work up or send the quote, open <strong>Walkthrough Bids</strong>. If the quote is out and waiting on approval, keep it in <strong>Quoted / booked work</strong>.</div>
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
  const isPrimary = PRIMARY_TABS.has(tab);
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
function syncSidebarGroupVisibility(blueprint = currentWorkspaceBlueprint()) {
  const more = $("sidebarMore");
  const moreButton = $("btnSidebarMore");
  if (!more) return;
  let visibleGroupCount = 0;
  Object.entries(SIDEBAR_GROUPS).forEach(([groupKey, tabs]) => {
    const group = more.querySelector(`[data-nav-group="${groupKey}"]`);
    if (!group) return;
    const hasVisibleTab = tabs.some((tab) => {
      const button = group.querySelector(`.tab[data-tab="${tab}"]`);
      return button && !button.hidden && isTabVisibleInWorkspace(tab, blueprint);
    });
    group.hidden = !hasVisibleTab;
    if (hasVisibleTab) visibleGroupCount += 1;
  });
  if (moreButton) moreButton.hidden = visibleGroupCount === 0;
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
function ensureWebsiteQuickLinks() {
  const setupPanel = document.querySelector('.panel[data-panel="setup"]');
  const panelHead = setupPanel?.querySelector(".panel-head");
  if (!setupPanel || !panelHead) return;
  let links = setupPanel.querySelector(".setup-quick-links");
  if (!links) {
    links = document.createElement("div");
    links.className = "setup-quick-links";
    links.setAttribute("aria-label", "Website shortcuts");
    links.innerHTML = `
      <button class="btn btn-ghost btn-sm" type="button" data-setup-shortcut="products">Open services</button>
      <button class="btn btn-ghost btn-sm" type="button" data-setup-shortcut="pricing">Open pricing</button>
      <button class="btn btn-ghost btn-sm" type="button" data-setup-shortcut="domains">Open domains</button>
      <button class="btn btn-ghost btn-sm" type="button" data-setup-shortcut="import">Open import</button>
    `;
    panelHead.insertAdjacentElement("afterend", links);
    links.querySelectorAll("[data-setup-shortcut]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.getAttribute("data-setup-shortcut") || "setup";
        switchTab(tab);
      });
    });
  }
}
function syncOperatorShellLayout(blueprint = currentWorkspaceBlueprint()) {
  startupChecklist?.closest(".side-card")?.setAttribute("hidden", "hidden");
  document.querySelector(".side-copy")?.closest(".side-card")?.setAttribute("hidden", "hidden");
  sectionNav?.querySelector('.tab[data-tab="ai"]')?.setAttribute("hidden", "hidden");
  const more = $("sidebarMore");
  const moreButton = $("btnSidebarMore");
  syncSidebarGroupVisibility(blueprint);
  if (moreButton) moreButton.textContent = more && more.style.display !== "none" ? "Hide tools" : "Tools";
  const mobileWorkLabel = document.querySelector('.mbn-item[data-mbn-tab="orders"] span');
  if (mobileWorkLabel) mobileWorkLabel.textContent = workspaceTabLabel("orders", blueprint);
  const mobileMenuLabel = document.querySelector('#mbnMenuBtn span');
  if (mobileMenuLabel) mobileMenuLabel.textContent = "Tools";
  ensureWebsiteQuickLinks();
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
    const orderedPrimaryTabs = uniqList([
      "dashboard",
      ...workspacePriorityTabs(blueprint).filter((tab) => PRIMARY_TABS.has(tab) && isTabVisibleInWorkspace(tab, blueprint)),
      ...Array.from(PRIMARY_TABS).filter((tab) => tab !== "dashboard" && isTabVisibleInWorkspace(tab, blueprint)),
    ]);
    orderedPrimaryTabs.forEach((tab) => {
      const btn = sidebarPrimary?.querySelector(`.tab[data-tab="${tab}"]`) || sectionNav.querySelector(`.tab[data-tab="${tab}"]`);
      if (btn && sidebarPrimary) sidebarPrimary.appendChild(btn);
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

  renderServicePresetPicker();
  syncOperatorShellLayout(blueprint);
  renderPanelBackButtons();
  renderWorkspaceHub();
  const activeTab = currentPanel();
  if (!isTabVisibleInWorkspace(activeTab, blueprint)) {
    switchTab("dashboard", { force: true });
  }
  return blueprint;
}

const BENKARI_HYDROVAC_RATE_SHEET = {
  truckAndOperatorHourly: 215,
  plumberHourly: 103,
  laborerHourly: 63,
  liquidDisposalPerGallon: 0.61,
  catchBasinWastePerTon: 146.28,
  minimumHours4: 4,
  minimumHours8: 8,
  includedLiquidGallons4: 1500,
  includedLiquidGallons8: 3000,
  includedSolidsYards4: 2,
  includedSolidsYards8: 4,
  tankWashoutBase: 250,
  tankWashoutExtended: 450,
  solidificationWashoutFee: 100,
};

function roundDollars(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

function benkariHydrovacMinimumDollars(hours, helperHourly, includedGallons) {
  return roundDollars(
    (BENKARI_HYDROVAC_RATE_SHEET.truckAndOperatorHourly + helperHourly) * Number(hours || 0)
    + (BENKARI_HYDROVAC_RATE_SHEET.liquidDisposalPerGallon * Number(includedGallons || 0))
  );
}

function benkariHydrovacDisposalDollars(gallons) {
  return roundDollars(Number(gallons || 0) * BENKARI_HYDROVAC_RATE_SHEET.liquidDisposalPerGallon);
}

const HYDROVAC_JOB_TEMPLATE_LIBRARY = {
  hydrovac_4hr_laborer_minimum: {
    key: "hydrovac_4hr_laborer_minimum",
    label: "4-hour minimum (truck + laborer)",
    summary: "4-hour hydrovac minimum with truck, operator, laborer, 2 yards solids, and 1,500 gallons liquid disposal included.",
    serviceTypeValue: "hydrovac_4hr_laborer_minimum",
    minimumHours: BENKARI_HYDROVAC_RATE_SHEET.minimumHours4,
    truckRate: BENKARI_HYDROVAC_RATE_SHEET.truckAndOperatorHourly,
    helperRate: BENKARI_HYDROVAC_RATE_SHEET.laborerHourly,
    disposalGallons: BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4,
    disposalCost: benkariHydrovacDisposalDollars(BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4),
    note: `Company-standard 4-hour minimum. Includes ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards4} yards of solids and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4} gallons of liquid disposal.`,
  },
  hydrovac_8hr_laborer_minimum: {
    key: "hydrovac_8hr_laborer_minimum",
    label: "8-hour minimum (truck + laborer)",
    summary: "8-hour hydrovac minimum with truck, operator, laborer, 4 yards solids, and 3,000 gallons liquid disposal included.",
    serviceTypeValue: "hydrovac_8hr_laborer_minimum",
    minimumHours: BENKARI_HYDROVAC_RATE_SHEET.minimumHours8,
    truckRate: BENKARI_HYDROVAC_RATE_SHEET.truckAndOperatorHourly,
    helperRate: BENKARI_HYDROVAC_RATE_SHEET.laborerHourly,
    disposalGallons: BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8,
    disposalCost: benkariHydrovacDisposalDollars(BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8),
    note: `Built as the doubled Benkari minimum for all-day hydrovac work. Includes ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards8} yards of solids and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8} gallons of liquid disposal.`,
  },
  hydrovac_4hr_plumber_minimum: {
    key: "hydrovac_4hr_plumber_minimum",
    label: "4-hour minimum (truck + plumber)",
    summary: "4-hour hydrovac minimum with truck, operator, plumber, 2 yards solids, and 1,500 gallons liquid disposal included.",
    serviceTypeValue: "hydrovac_4hr_plumber_minimum",
    minimumHours: BENKARI_HYDROVAC_RATE_SHEET.minimumHours4,
    truckRate: BENKARI_HYDROVAC_RATE_SHEET.truckAndOperatorHourly,
    helperRate: BENKARI_HYDROVAC_RATE_SHEET.plumberHourly,
    disposalGallons: BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4,
    disposalCost: benkariHydrovacDisposalDollars(BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4),
    note: `Use this standard when the hydrovac truck is paired with a plumber instead of a laborer. Includes ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards4} yards solids and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4} gallons liquid disposal.`,
  },
  hydrovac_8hr_plumber_minimum: {
    key: "hydrovac_8hr_plumber_minimum",
    label: "8-hour minimum (truck + plumber)",
    summary: "8-hour hydrovac minimum with truck, operator, plumber, 4 yards solids, and 3,000 gallons liquid disposal included.",
    serviceTypeValue: "hydrovac_8hr_plumber_minimum",
    minimumHours: BENKARI_HYDROVAC_RATE_SHEET.minimumHours8,
    truckRate: BENKARI_HYDROVAC_RATE_SHEET.truckAndOperatorHourly,
    helperRate: BENKARI_HYDROVAC_RATE_SHEET.plumberHourly,
    disposalGallons: BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8,
    disposalCost: benkariHydrovacDisposalDollars(BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8),
    note: `Use this standard when the hydrovac truck is paired with a plumber for the full day. Includes ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards8} yards solids and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8} gallons liquid disposal.`,
  },
  hydrovac_additional_truck_hour: {
    key: "hydrovac_additional_truck_hour",
    label: "Additional truck hour",
    summary: "Additional truck and operator hour once the minimum block is already covered.",
    serviceTypeValue: "hydrovac_additional_truck_hour",
    minimumHours: 1,
    truckRate: BENKARI_HYDROVAC_RATE_SHEET.truckAndOperatorHourly,
    helperRate: 0,
    disposalGallons: 0,
    disposalCost: 0,
    note: "Use this to extend the base hydrovac minimum once the included minimum block has already been sold.",
  },
  hydrovac_additional_laborer_hour: {
    key: "hydrovac_additional_laborer_hour",
    label: "Additional laborer hour",
    summary: "Additional JVT laborer hour layered onto the hydrovac truck after the minimum.",
    serviceTypeValue: "hydrovac_additional_laborer_hour",
    minimumHours: 1,
    truckRate: 0,
    helperRate: BENKARI_HYDROVAC_RATE_SHEET.laborerHourly,
    disposalGallons: 0,
    disposalCost: 0,
    note: "Standard hourly add-on for the extra laborer once the minimum job is already covered.",
  },
  hydrovac_additional_plumber_hour: {
    key: "hydrovac_additional_plumber_hour",
    label: "Additional plumber hour",
    summary: "Additional plumber hour layered onto hydrovac work once the minimum is covered.",
    serviceTypeValue: "hydrovac_additional_plumber_hour",
    minimumHours: 1,
    truckRate: 0,
    helperRate: BENKARI_HYDROVAC_RATE_SHEET.plumberHourly,
    disposalGallons: 0,
    disposalCost: 0,
    note: "Use this when the field scope needs a plumber on top of the base hydrovac block.",
  },
  hydrovac_liquid_disposal: {
    key: "hydrovac_liquid_disposal",
    label: "Liquid waste disposal",
    summary: "Company-standard liquid waste disposal charged per gallon.",
    serviceTypeValue: "hydrovac_liquid_disposal",
    minimumHours: 0,
    truckRate: 0,
    helperRate: 0,
    disposalGallons: 0,
    disposalCost: 0,
    note: `Company-standard disposal charge is $${BENKARI_HYDROVAC_RATE_SHEET.liquidDisposalPerGallon.toFixed(2)} per gallon.`,
  },
  catch_basin_waste_disposal: {
    key: "catch_basin_waste_disposal",
    label: "Catch basin waste disposal",
    summary: "Catch basin waste treatment charged per ton.",
    serviceTypeValue: "catch_basin_waste_disposal",
    minimumHours: 0,
    truckRate: 0,
    helperRate: 0,
    disposalGallons: 0,
    disposalCost: 0,
    note: `Current treatment anchor is $${BENKARI_HYDROVAC_RATE_SHEET.catchBasinWastePerTon.toFixed(2)} per ton. Use on top of crew time and haul scope.`,
  },
  tank_washout_base: {
    key: "tank_washout_base",
    label: "Tank washout",
    summary: "Tank washout charge for up to 15 minutes.",
    serviceTypeValue: "tank_washout_base",
    minimumHours: 0,
    truckRate: 0,
    helperRate: 0,
    disposalGallons: 0,
    disposalCost: 0,
    note: "Standard tank washout up to 15 minutes. Use the extended washout line if the yard charges the higher bracket.",
  },
};

const BENKARI_PRODUCT_JOB_TEMPLATE_MAP = {
  "hydrovac-4-hour-minimum-truck-laborer": "hydrovac_4hr_laborer_minimum",
  "hydrovac-8-hour-minimum-truck-laborer": "hydrovac_8hr_laborer_minimum",
  "hydrovac-4-hour-minimum-truck-plumber": "hydrovac_4hr_plumber_minimum",
  "hydrovac-8-hour-minimum-truck-plumber": "hydrovac_8hr_plumber_minimum",
  "additional-hydrovac-truck-operator-hour": "hydrovac_additional_truck_hour",
  "additional-jvt-laborer-hour": "hydrovac_additional_laborer_hour",
  "additional-plumber-hour": "hydrovac_additional_plumber_hour",
  "liquid-waste-disposal": "hydrovac_liquid_disposal",
  "catch-basin-waste-treatment": "catch_basin_waste_disposal",
  "tank-washout-up-to-15-minutes": "tank_washout_base",
};

const SERVICE_PRESET_LIBRARY = {
  hydrovac_southeast_michigan: {
    label: "Benkari hydrovac rate sheet",
    summary: "Current Benkari company-standard hydrovac pricing with 4-hour and 8-hour minimums, helper/plumber variants, and disposal anchors built from your working rate sheet.",
    businessKeys: ["hydrovac"],
    items: [
      {
        name: "Hydrovac 4-hour minimum (truck + laborer)",
        slug: "hydrovac-4-hour-minimum-truck-laborer",
        category: "Minimums",
        pricing_mode: "fixed",
        sell_price_dollars: benkariHydrovacMinimumDollars(BENKARI_HYDROVAC_RATE_SHEET.minimumHours4, BENKARI_HYDROVAC_RATE_SHEET.laborerHourly, BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4),
        unit_label: "minimum",
        description: `Operator with truck, JVT laborer, ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards4} yards of solids, and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4} gallons of liquid waste disposal included.`,
        notes: "Primary Benkari minimum for hydrovac work when the helper is a laborer. Good standard-price line item for normal dispatches.",
      },
      {
        name: "Hydrovac 8-hour minimum (truck + laborer)",
        slug: "hydrovac-8-hour-minimum-truck-laborer",
        category: "Minimums",
        pricing_mode: "fixed",
        sell_price_dollars: benkariHydrovacMinimumDollars(BENKARI_HYDROVAC_RATE_SHEET.minimumHours8, BENKARI_HYDROVAC_RATE_SHEET.laborerHourly, BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8),
        unit_label: "minimum",
        description: `Full-day hydrovac minimum with operator, truck, JVT laborer, ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards8} yards of solids, and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8} gallons of liquid waste disposal included.`,
        notes: "Built as the full-day Benkari standard. Adjust the included waste allowance if the field conditions call for something different.",
      },
      {
        name: "Hydrovac 4-hour minimum (truck + plumber)",
        slug: "hydrovac-4-hour-minimum-truck-plumber",
        category: "Minimums",
        pricing_mode: "fixed",
        sell_price_dollars: benkariHydrovacMinimumDollars(BENKARI_HYDROVAC_RATE_SHEET.minimumHours4, BENKARI_HYDROVAC_RATE_SHEET.plumberHourly, BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4),
        unit_label: "minimum",
        description: `Operator with truck, plumber, ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards4} yards of solids, and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons4} gallons of liquid waste disposal included.`,
        notes: "Use when the job needs a plumber on the crew inside the base 4-hour block.",
      },
      {
        name: "Hydrovac 8-hour minimum (truck + plumber)",
        slug: "hydrovac-8-hour-minimum-truck-plumber",
        category: "Minimums",
        pricing_mode: "fixed",
        sell_price_dollars: benkariHydrovacMinimumDollars(BENKARI_HYDROVAC_RATE_SHEET.minimumHours8, BENKARI_HYDROVAC_RATE_SHEET.plumberHourly, BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8),
        unit_label: "minimum",
        description: `Full-day hydrovac minimum with operator, truck, plumber, ${BENKARI_HYDROVAC_RATE_SHEET.includedSolidsYards8} yards of solids, and ${BENKARI_HYDROVAC_RATE_SHEET.includedLiquidGallons8} gallons of liquid waste disposal included.`,
        notes: "Use when the field work needs a plumber for the full-day minimum block.",
      },
      {
        name: "Additional hydrovac truck/operator hour",
        slug: "additional-hydrovac-truck-operator-hour",
        category: "Hourly add-ons",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.truckAndOperatorHourly,
        unit_label: "hour",
        description: "Additional truck and operator hour once the sold minimum block is already covered.",
        notes: "Layer this on top of the 4-hour or 8-hour minimum when the truck stays onsite longer.",
      },
      {
        name: "Additional JVT laborer hour",
        slug: "additional-jvt-laborer-hour",
        category: "Hourly add-ons",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.laborerHourly,
        unit_label: "hour",
        description: "Additional laborer hour once the sold minimum block is already covered.",
        notes: "Use when the helper time extends beyond the minimum crew block.",
      },
      {
        name: "Additional plumber hour",
        slug: "additional-plumber-hour",
        category: "Hourly add-ons",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.plumberHourly,
        unit_label: "hour",
        description: "Additional plumber hour layered onto the hydrovac scope once the minimum block is covered.",
        notes: "Use this when the plumber stays longer than the included minimum or is added after the base block.",
      },
      {
        name: "Liquid waste disposal",
        slug: "liquid-waste-disposal",
        category: "Disposal",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.liquidDisposalPerGallon,
        unit_label: "gallon",
        description: "Company-standard liquid waste disposal charged by the gallon.",
        notes: `Current Benkari disposal charge is $${BENKARI_HYDROVAC_RATE_SHEET.liquidDisposalPerGallon.toFixed(2)} per gallon. The minimum blocks already include disposal allowances.`,
      },
      {
        name: "Catch basin waste treatment",
        slug: "catch-basin-waste-treatment",
        category: "Disposal",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.catchBasinWastePerTon,
        unit_label: "ton",
        description: "Catch basin waste treatment charged by the ton for Dearborn-yard style disposal.",
        notes: "Use on top of crew time when catch basin solids are being hauled and treated separately.",
      },
      {
        name: "Tank washout (up to 15 minutes)",
        slug: "tank-washout-up-to-15-minutes",
        category: "Yard charges",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.tankWashoutBase,
        unit_label: "washout",
        description: "Tank washout for up to 15 minutes.",
        notes: "Add the extended washout or solidification fee if the yard charge escalates beyond the base washout.",
      },
      {
        name: "Tank washout (extended)",
        slug: "tank-washout-extended",
        category: "Yard charges",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.tankWashoutExtended,
        unit_label: "washout",
        description: "Extended tank washout when the yard charges the higher bracket.",
        notes: "Use when the base tank washout is not enough and the yard moves to the extended rate.",
      },
      {
        name: "Mandatory solidification washout fee",
        slug: "mandatory-solidification-washout-fee",
        category: "Yard charges",
        pricing_mode: "fixed",
        sell_price_dollars: BENKARI_HYDROVAC_RATE_SHEET.solidificationWashoutFee,
        unit_label: "fee",
        description: "Mandatory washout fee for solidification loads.",
        notes: "Use when the load type triggers the extra washout fee at the disposal yard.",
      },
    ],
  },
  contractor_southeast_michigan: {
    label: "Contractor / Field Crew - Southeast Michigan",
    summary: "Common service anchors for punch-list work, small projects, emergency response, and cleanup-oriented field jobs.",
    businessKeys: ["contractor"],
    items: [
      { name: "Service call minimum", category: "Field service", pricing_mode: "fixed", sell_price_dollars: 145, unit_label: "visit", description: "Minimum dispatch covering travel, setup, assessment, and the first block of light field work.", notes: "Useful base anchor for fast jobs where the real value is getting a capable crew on site." },
      { name: "Two-hour field block", category: "Field service", pricing_mode: "fixed", sell_price_dollars: 245, unit_label: "block", description: "Standard two-hour work block for repairs, punch lists, and small completion items.", notes: "Good standard-price line item when the crew can handle a defined scope without a full-day rate." },
      { name: "Half-day field crew", category: "Crew rate", pricing_mode: "fixed", sell_price_dollars: 495, unit_label: "half day", description: "Half-day crew rate for mixed-scope site work with tools, travel, and basic materials handling.", notes: "Strong anchor for small remodel support, maintenance punch lists, or cleanup-heavy service calls." },
      { name: "Full-day field crew", category: "Crew rate", pricing_mode: "fixed", sell_price_dollars: 895, unit_label: "day", description: "Full-day crew rate for scope that benefits from a clean single-day commitment.", notes: "Use when the job is best sold as one committed day instead of piecemeal hourly pricing." },
      { name: "Emergency board-up / site secure", category: "Emergency", pricing_mode: "starts_at", starting_price_dollars: 375, unit_label: "job", description: "Secure openings, protect the property, and stabilize the site after damage, break-ins, or urgent field failures.", notes: "Starting anchor before premium materials, after-hours labor, or multi-opening scope is added." },
      { name: "Debris removal and haul-away", category: "Cleanup", pricing_mode: "starts_at", starting_price_dollars: 225, unit_label: "load", description: "Remove job debris, bag waste, and leave the work area clean enough for the next trade or owner walk-through.", notes: "Good standard line item for cleanup, disposal, and closeout labor." },
    ],
  },
  landscaping_southeast_michigan: {
    label: "Landscaping - Southeast Michigan",
    summary: "Simple starter pricing for mowing, cleanup, mulch, trimming, and small property visits that keep a young operator focused on selling and following through.",
    businessKeys: ["landscaping"],
    items: [
      { name: "Weekly lawn cut", category: "Recurring", pricing_mode: "starts_at", starting_price_dollars: 45, unit_label: "visit", description: "Routine mow, trim, and blow visit for a standard residential yard.", notes: "Good first recurring anchor that keeps pricing simple and easy to explain." },
      { name: "Biweekly lawn cut", category: "Recurring", pricing_mode: "starts_at", starting_price_dollars: 55, unit_label: "visit", description: "Biweekly mow, trim, and blow visit when the property is not maintained every week.", notes: "Useful second anchor when growth and cleanup take a little longer." },
      { name: "Front-bed cleanup", category: "Cleanup", pricing_mode: "starts_at", starting_price_dollars: 95, unit_label: "job", description: "Light bed cleanup, weed pull, debris bagging, and simple reset around the front of the property.", notes: "Keeps small one-off landscape jobs easy to quote." },
      { name: "Spring or fall cleanup", category: "Seasonal", pricing_mode: "starts_at", starting_price_dollars: 175, unit_label: "job", description: "Leaf pickup, bed cleanup, light trimming, and curbside bag staging for a seasonal reset.", notes: "Strong seasonal anchor that can scale up by yard size." },
      { name: "Mulch refresh", category: "Enhancement", pricing_mode: "starts_at", starting_price_dollars: 225, unit_label: "job", description: "Bed preparation and mulch install priced from bed count, material depth, and access.", notes: "Use this as the starting point before material quantity is finalized." },
      { name: "Shrub trimming visit", category: "Enhancement", pricing_mode: "starts_at", starting_price_dollars: 125, unit_label: "visit", description: "Trim and shape shrubs or hedges with cleanup and haul-away priced from quantity and access.", notes: "Good add-on or standalone service that teaches simple upselling." },
    ],
  },
  pressure_washing_southeast_michigan: {
    label: "Pressure washing - Southeast Michigan",
    summary: "Exterior-cleaning anchors for house washes, flatwork, stain treatment, and upgrade-friendly proposals.",
    businessKeys: ["pressure_washing"],
    items: [
      { name: "House wash", category: "Residential", pricing_mode: "starts_at", starting_price_dollars: 195, unit_label: "job", description: "Soft-wash style exterior house cleaning priced from siding size, condition, and access.", notes: "Strong first anchor for residential wash work that still leaves room for square-foot and oxidation adjustments." },
      { name: "Driveway and flatwork cleaning", category: "Flatwork", pricing_mode: "starts_at", starting_price_dollars: 145, unit_label: "section", description: "Pressure-clean driveway, sidewalk, or patio sections with pricing tied to measured surface area.", notes: "Clean anchor for concrete work without forcing full custom math every time." },
      { name: "Deck or fence wash", category: "Add-on", pricing_mode: "starts_at", starting_price_dollars: 115, unit_label: "section", description: "Wash and brighten deck or fence surfaces when they are priced separately from the main house wash.", notes: "Easy add-on that helps the operator upsell visible adjacent work." },
      { name: "Rust or stain treatment", category: "Special treatment", pricing_mode: "starts_at", starting_price_dollars: 95, unit_label: "area", description: "Targeted treatment for rust, oil, or deep staining that needs dedicated chemistry and extra passes.", notes: "Use when the wash price alone would understate the labor and chemistry involved." },
      { name: "Commercial building wash", category: "Commercial", pricing_mode: "quote", unit_label: "job", description: "Quoted facade wash for larger buildings, commercial sites, or multi-unit work with more coordination.", notes: "Good quote-only line when access, water, and runoff controls need a more disciplined scope." },
    ],
  },
  cleaning_southeast_michigan: {
    label: "Cleaning - Southeast Michigan",
    summary: "Starter pricing for recurring residential cleans, deep-clean resets, turnovers, and high-trust add-ons.",
    businessKeys: ["cleaning"],
    items: [
      { name: "Recurring clean - small home", category: "Recurring", pricing_mode: "fixed", sell_price_dollars: 115, unit_label: "visit", description: "Routine cleaning visit for a smaller home or apartment on a recurring cadence.", notes: "Keeps the repeat visit simple enough for a customer to understand and a young operator to quote confidently." },
      { name: "Recurring clean - standard home", category: "Recurring", pricing_mode: "fixed", sell_price_dollars: 155, unit_label: "visit", description: "Standard recurring clean for a typical multi-room home with bathrooms, kitchen, and common areas.", notes: "Good middle anchor before deep-clean or size complexity gets involved." },
      { name: "First-visit deep clean", category: "Reset work", pricing_mode: "starts_at", starting_price_dollars: 245, unit_label: "job", description: "One-time deep clean or first-visit reset before the home settles into a recurring standard.", notes: "Helps separate ongoing pricing from catch-up labor and heavy buildup." },
      { name: "Move-in / move-out clean", category: "Turnovers", pricing_mode: "starts_at", starting_price_dollars: 295, unit_label: "job", description: "Vacant-home turnover clean priced from size, condition, and appliance scope.", notes: "Useful anchor for empty-unit work where condition and timing are variable." },
      { name: "Inside appliance add-on", category: "Add-on", pricing_mode: "fixed", sell_price_dollars: 45, unit_label: "appliance", description: "Inside oven or refrigerator add-on that can be approved separately from the base visit.", notes: "Simple optional extra that keeps the core visit price clean." },
    ],
  },
  hvac_southeast_michigan: {
    label: "HVAC - Southeast Michigan",
    summary: "Service-call anchors for diagnostics, tune-ups, common repairs, and replacement-led proposals.",
    businessKeys: ["hvac"],
    items: [
      { name: "Diagnostic service call", category: "Service", pricing_mode: "fixed", sell_price_dollars: 95, unit_label: "visit", description: "Dispatch and diagnostic visit for HVAC issues, credited toward same-visit repair when approved.", notes: "Foundational anchor for trust and cleaner repair conversations." },
      { name: "Seasonal tune-up", category: "Maintenance", pricing_mode: "fixed", sell_price_dollars: 129, unit_label: "system", description: "Preventative maintenance visit for an AC or furnace system with standard inspection and test steps.", notes: "Good standard-price offer that supports repeat business and easier upsells." },
      { name: "Common repair scope", category: "Repair", pricing_mode: "starts_at", starting_price_dollars: 165, unit_label: "repair", description: "Starting point for capacitor, contactor, thermostat, or similarly scoped repair work.", notes: "Keeps small repairs from turning into fully custom bids every time." },
      { name: "Equipment replacement consult", category: "Replacement", pricing_mode: "quote", unit_label: "system", description: "Quoted equipment replacement scope for larger repairs or full-system swaps after diagnosis.", notes: "Use when the proposal needs more structure, equipment options, and code-sensitive language." },
      { name: "Indoor air quality upgrade", category: "Add-on", pricing_mode: "starts_at", starting_price_dollars: 195, unit_label: "upgrade", description: "Optional IAQ upgrade like filtration, UV, or accessory work layered onto the main service proposal.", notes: "Helpful add-on line when the technician sees a real comfort or air-quality opportunity." },
    ],
  },
  plumbing_southeast_michigan: {
    label: "Plumbing - Southeast Michigan",
    summary: "Service anchors for diagnostics, drain work, fixture replacements, and repair-plus-restoration proposals.",
    businessKeys: ["plumbing"],
    items: [
      { name: "Service call / diagnostic", category: "Service", pricing_mode: "fixed", sell_price_dollars: 95, unit_label: "visit", description: "Dispatch and first-hour diagnostic for visible plumbing issues or troubleshooting.", notes: "Core trust-building anchor before the repair scope is finalized." },
      { name: "Fixture repair or replace", category: "Repair", pricing_mode: "starts_at", starting_price_dollars: 145, unit_label: "fixture", description: "Starting point for faucet, toilet, disposal, or similar fixture repair and replacement work.", notes: "Useful middle anchor that covers a lot of common residential plumbing jobs." },
      { name: "Drain cleaning", category: "Drain work", pricing_mode: "starts_at", starting_price_dollars: 165, unit_label: "line", description: "Starting point for sink, tub, or branch-line drain clearing before main-line complexity is involved.", notes: "Easy anchor that keeps drain work from feeling vague or improvised." },
      { name: "Main-line or specialty repair", category: "Specialty", pricing_mode: "quote", unit_label: "job", description: "Quoted scope for larger line work, leak investigation, hidden damage, or more complex plumbing repairs.", notes: "Use when access, restoration, or code questions make a custom proposal the safer move." },
      { name: "Finish restoration allowance", category: "Add-on", pricing_mode: "starts_at", starting_price_dollars: 125, unit_label: "allowance", description: "Allowance for patching, trim, or basic finish restoration that can be approved on top of the plumbing repair.", notes: "Keeps the repair scope separate from optional finish work." },
    ],
  },
  photography_southeast_michigan: {
    label: "Photography - Southeast Michigan",
    summary: "Session anchors for portraits, families, branding, and add-on-heavy creative work.",
    businessKeys: ["photography"],
    items: [
      { name: "Mini session", category: "Portrait", pricing_mode: "fixed", sell_price_dollars: 225, unit_label: "session", description: "Short portrait or seasonal mini session with a simple delivery package.", notes: "Great low-friction starter package that is easy to book and easy to explain." },
      { name: "Standard portrait session", category: "Portrait", pricing_mode: "fixed", sell_price_dollars: 395, unit_label: "session", description: "Standard portrait or family session with a fuller gallery and more flexible timing.", notes: "Good core package for portrait work that balances price and substance." },
      { name: "Brand or content session", category: "Branding", pricing_mode: "starts_at", starting_price_dollars: 495, unit_label: "session", description: "Business or content session priced from deliverables, locations, and coverage needs.", notes: "Useful when the operator needs room for scope and editing variation." },
      { name: "Event coverage", category: "Events", pricing_mode: "quote", unit_label: "event", description: "Quoted event or milestone coverage where timeline, guest count, and deliverables vary more widely.", notes: "Keeps larger creative commitments disciplined instead of guessed." },
      { name: "Album or rush-delivery add-on", category: "Add-on", pricing_mode: "starts_at", starting_price_dollars: 125, unit_label: "upgrade", description: "Optional print, album, or rush-edit upgrade the client can approve separately.", notes: "Simple extra that keeps the main package clean while opening a path to upsell." },
    ],
  },
  events_southeast_michigan: {
    label: "Events - Southeast Michigan",
    summary: "Proposal anchors for coordination, rentals, decor, and event-day support with upgrade-friendly structure.",
    businessKeys: ["events"],
    items: [
      { name: "Base event coordination", category: "Coordination", pricing_mode: "starts_at", starting_price_dollars: 795, unit_label: "event", description: "Coordination package priced from guest count, event length, and venue complexity.", notes: "Strong first anchor for event planning without pretending every event is identical." },
      { name: "Day-of coordination", category: "Coordination", pricing_mode: "fixed", sell_price_dollars: 1195, unit_label: "event", description: "Event-day execution package focused on timeline control, vendor coordination, and guest-flow management.", notes: "Useful standard package when the main value is confidence on the day itself." },
      { name: "Decor or rental allowance", category: "Allowances", pricing_mode: "starts_at", starting_price_dollars: 350, unit_label: "allowance", description: "Allowance for rentals, floral, tablescape, or setup details that depend on final selections.", notes: "Helps keep open vendor or rental decisions visible instead of buried." },
      { name: "Entertainment or premium add-on", category: "Add-on", pricing_mode: "starts_at", starting_price_dollars: 425, unit_label: "upgrade", description: "Optional enhancement like photo booth, DJ support, upgraded decor, or another premium event layer.", notes: "Creates an easy way to upsell without muddying the base package." },
      { name: "Full event production", category: "Full service", pricing_mode: "quote", unit_label: "event", description: "Quoted full-service production for higher-complexity events, multiple vendors, or larger execution needs.", notes: "Best fit when the event deserves a more detailed commercial structure." },
    ],
  },
  general_service_southeast_michigan: {
    label: "General service - Southeast Michigan",
    summary: "Broad service anchors for dispatch work, small jobs, half-day visits, emergency response, and materials handling.",
    businessKeys: ["service_business", "other"],
    items: [
      { name: "Standard service call", category: "Dispatch", pricing_mode: "fixed", sell_price_dollars: 125, unit_label: "visit", description: "Dispatch, diagnosis, and first-pass field work for small service needs that can be resolved quickly.", notes: "Baseline service-call pricing anchor for owner-operators and small crews." },
      { name: "Two-hour service block", category: "Field work", pricing_mode: "fixed", sell_price_dollars: 225, unit_label: "block", description: "Two-hour service block for jobs that need more than a quick dispatch but not a half-day crew.", notes: "Use as the standard-price option when the scope is straightforward and time-boxed." },
      { name: "Half-day site visit", category: "Field work", pricing_mode: "fixed", sell_price_dollars: 425, unit_label: "half day", description: "Half-day crew visit for mixed-scope service, troubleshooting, repairs, and documented closeout.", notes: "Good fit for owner-operators who need a clean anchor between hourly and quote-only pricing." },
      { name: "Full-day field service", category: "Field work", pricing_mode: "fixed", sell_price_dollars: 795, unit_label: "day", description: "Full-day commitment for larger site work, project punch lists, or scope that is easiest to sell as one complete visit.", notes: "Works well when the customer wants one quoted day instead of stacked small charges." },
      { name: "Emergency response dispatch", category: "Emergency", pricing_mode: "starts_at", starting_price_dollars: 295, unit_label: "dispatch", description: "Urgent or same-day response where schedule disruption, weather, or site risk increases the cost of showing up fast.", notes: "Starting anchor for short-notice response before job-specific labor or materials are layered in." },
      { name: "Materials pickup / disposal", category: "Support", pricing_mode: "fixed", sell_price_dollars: 95, unit_label: "trip", description: "Dedicated pickup, dump, or materials-run line item when the job needs travel and handling outside the base service visit.", notes: "Useful company-standard add-on that operators can pull into bids without rewriting it." },
    ],
  },
};

function servicePresetKeyForWorkspace() {
  const businessKey = String(currentWorkspaceBlueprint()?.business?.key || "").trim().toLowerCase();
  if (businessKey === "pressure_washing") return "pressure_washing_southeast_michigan";
  if (businessKey === "cleaning") return "cleaning_southeast_michigan";
  if (businessKey === "hvac") return "hvac_southeast_michigan";
  if (businessKey === "plumbing") return "plumbing_southeast_michigan";
  if (businessKey === "photography") return "photography_southeast_michigan";
  if (businessKey === "events") return "events_southeast_michigan";
  if (businessKey === "hydrovac") return "hydrovac_southeast_michigan";
  if (businessKey === "contractor") return "contractor_southeast_michigan";
  if (businessKey === "landscaping") return "landscaping_southeast_michigan";
  return "general_service_southeast_michigan";
}

function servicePresetChoicesForWorkspace() {
  const primaryKey = servicePresetKeyForWorkspace();
  const ordered = [
    primaryKey,
    "hydrovac_southeast_michigan",
    "pressure_washing_southeast_michigan",
    "contractor_southeast_michigan",
    "landscaping_southeast_michigan",
    "cleaning_southeast_michigan",
    "hvac_southeast_michigan",
    "plumbing_southeast_michigan",
    "photography_southeast_michigan",
    "events_southeast_michigan",
    "general_service_southeast_michigan",
  ];
  return uniqList(ordered).map((key) => SERVICE_PRESET_LIBRARY[key]).filter(Boolean);
}

function currentServicePreset() {
  const selectedKey = servicePresetPack?.value || servicePresetKeyForWorkspace();
  return SERVICE_PRESET_LIBRARY[selectedKey] || SERVICE_PRESET_LIBRARY[servicePresetKeyForWorkspace()];
}

function presetAmountCents(item) {
  if (item.pricing_mode === "fixed") return Math.round(Number(item.sell_price_dollars || 0) * 100);
  if (item.pricing_mode === "starts_at") return Math.round(Number(item.starting_price_dollars || 0) * 100);
  return 0;
}

function renderServicePresetPicker() {
  const choices = servicePresetChoicesForWorkspace();
  const activeKey = currentServicePreset()?.label ? (servicePresetPack?.value || servicePresetKeyForWorkspace()) : servicePresetKeyForWorkspace();

  if (servicePresetPack) {
    servicePresetPack.innerHTML = choices.map((preset) => `
      <option value="${escapeAttr(Object.keys(SERVICE_PRESET_LIBRARY).find((key) => SERVICE_PRESET_LIBRARY[key] === preset) || "")}">
        ${escapeHtml(preset.label)}
      </option>
    `).join("");
    servicePresetPack.value = activeKey;
  }

  const preset = currentServicePreset();
  if (btnLoadRecommendedServices) {
    btnLoadRecommendedServices.textContent = PRODUCTS_CACHE.length ? "Add missing starters" : "Load starters";
  }
  if (productPresetNotice) {
    productPresetNotice.innerHTML = preset ? `
      <div class="workspace-panel-notice__title">${escapeHtml(preset.label)}</div>
      <div class="workspace-panel-notice__copy">${escapeHtml(preset.summary)} Choose a service below, then jump straight into pricing and reuse those company-standard numbers inside bids.</div>
    ` : `<div class="workspace-panel-notice__copy">Choose a recommended service pack, then load it into the catalog so operators can price from real anchors instead of memory.</div>`;
  }
}

function currentPricingRow(productId) {
  return PRICING_CACHE.find((row) => row.product_id === productId) || null;
}

function hydrovacTemplateForProduct(product) {
  const slug = String(product?.slug || "").trim().toLowerCase();
  const templateKey = BENKARI_PRODUCT_JOB_TEMPLATE_MAP[slug] || "";
  return HYDROVAC_JOB_TEMPLATE_LIBRARY[templateKey] || null;
}

function applyHydrovacJobTemplate(templateKey, options = {}) {
  const template = HYDROVAC_JOB_TEMPLATE_LIBRARY[String(templateKey || "").trim()];
  if (!template) return null;
  const preserveExisting = options.preserveExisting !== false;
  const shouldWrite = (el) => !preserveExisting || !String(el?.value || "").trim();

  if (jobMainServiceType) jobMainServiceType.value = "hydrovac";
  if (jobServiceType) jobServiceType.value = template.serviceTypeValue || template.key;
  toggleHydrovacFields("hydrovac");
  if (jobSummary && shouldWrite(jobSummary)) jobSummary.value = template.summary || "";
  if (jobMinimumHours && (shouldWrite(jobMinimumHours) || Number(jobMinimumHours.value || 0) <= 0)) jobMinimumHours.value = String(template.minimumHours ?? 0);
  if (jobTruckRate && (shouldWrite(jobTruckRate) || Number(jobTruckRate.value || 0) <= 0)) jobTruckRate.value = template.truckRate ? String(template.truckRate) : "0";
  if (jobOperatorRate && (shouldWrite(jobOperatorRate) || Number(jobOperatorRate.value || 0) <= 0)) jobOperatorRate.value = template.helperRate ? String(template.helperRate) : "0";
  if (jobDisposalVolume && (shouldWrite(jobDisposalVolume) || Number(jobDisposalVolume.value || 0) <= 0)) jobDisposalVolume.value = template.disposalGallons ? String(template.disposalGallons) : "";
  if (jobDisposalCost && (shouldWrite(jobDisposalCost) || Number(jobDisposalCost.value || 0) <= 0)) jobDisposalCost.value = template.disposalCost ? template.disposalCost.toFixed(2) : "0.00";
  if (jobAfterHoursMultiplier && (shouldWrite(jobAfterHoursMultiplier) || Number(jobAfterHoursMultiplier.value || 0) <= 0)) jobAfterHoursMultiplier.value = "1.0";
  if (jobNotes) {
    const currentNotes = String(jobNotes.value || "").trim();
    if (!currentNotes || !preserveExisting) {
      jobNotes.value = template.note || "";
    } else if (!currentNotes.includes(template.note || "")) {
      jobNotes.value = [currentNotes, template.note || ""].filter(Boolean).join("\n\n");
    }
  }
  updateHydrovacPreview();
  if (options.announce !== false) {
    setInlineMessage(jobMsg, `${template.label} loaded from company-standard pricing. Adjust the job-specific numbers if this site needs something different.`, "ok");
  }
  return template;
}

function pricingSummaryForRow(row) {
  if (!row) return "Quoted after scope review";
  const amountCents = pricingAmountForUi(row);
  const unit = row.unit_label || "job";
  const mode = normalizePricingModeForUi(row);
  if (mode === "fixed") return `${formatUsd(amountCents)} / ${unit}`;
  if (mode === "starts_at") return `Starts at ${formatUsd(amountCents)} / ${unit}`;
  return "Quoted after scope review";
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
}

function setSetupMessage(message = "", tone = "") {
  if (!setupMsg) return;
  setupMsg.className = `msg${tone ? ` ${tone}` : ""}`;
  setupMsg.textContent = message;
}

function siteFontLabel(value) {
  const labels = {
    modern_sans: "Modern sans",
    editorial: "Editorial",
    trust_serif: "Trust serif",
    compact_ui: "Compact UI",
  };
  return labels[String(value || "").trim().toLowerCase()] || "Modern sans";
}

function siteStyleLabel(value, kind) {
  const maps = {
    surface: {
      clean: "Clean and bright",
      warm: "Warm and approachable",
      bold: "Bold and high contrast",
    },
    button: {
      rounded: "Rounded buttons",
      solid: "Solid buttons",
      outline: "Outline buttons",
    },
    card: {
      soft: "Soft panels",
      lined: "Lined panels",
      elevated: "Elevated panels",
    },
    hero: {
      split: "Split hero",
      stacked: "Stacked hero",
      statement: "Statement hero",
    },
  };
  return maps[kind]?.[String(value || "").trim().toLowerCase()] || "-";
}

function setupPublishStatus(payload = {}) {
  return String(payload.site_publish_status || "").trim().toLowerCase() || "draft";
}

function renderSetupPublishMeta(payload = {}) {
  if (!setupPublishMeta) return;
  const status = setupPublishStatus(payload);
  const publishedAt = payload.site_published_at ? formatDateTime(payload.site_published_at) : "";
  const message = status === "published"
    ? `Website is published${publishedAt ? ` since ${publishedAt}` : ""}.`
    : status === "ready"
      ? "Website is saved and marked ready, but not published yet."
      : "Website is still in draft mode. Save your changes, then publish when it looks right.";
  setupPublishMeta.textContent = message;
}

function setupTenantSlug() {
  return String(
    SETUP_STATE?.tenant?.slug ||
    SETUP_STATE?.locked_record?.tenant_slug ||
    SETUP_STATE?.locked_record?.slug ||
    ""
  ).trim();
}

function setupPreviewUrl(page = "products.html") {
  const slug = setupTenantSlug();
  const url = new URL(`/${String(page || "products.html").replace(/^\/+/, "")}`, window.location.origin);
  if (slug) url.searchParams.set("tenant", slug);
  return url.toString();
}

function setupPublishedUrl(page = "site-home.html") {
  const normalizedPage = String(page || "site-home.html").replace(/^\/+/, "");
  const path = normalizedPage === "site-home.html" ? "/" : `/${normalizedPage}`;
  const customDomain = String(SETUP_STATE?.config?.custom_domain || SETUP_STATE?.tenant?.custom_domain || "").trim();
  if (customDomain) {
    return `https://${customDomain.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}${path}`;
  }
  const slug = setupTenantSlug();
  if (slug) return `https://${slug}.prooflink.co${path}`;
  return setupPreviewUrl(normalizedPage);
}

function renderSetupPreviewActions() {
  const slug = setupTenantSlug();
  const previewAvailable = !!slug;
  [
    btnOpenSetupHomePreview,
    btnOpenSetupProductsPreview,
    btnOpenSetupOrderPreview,
    btnOpenSetupAboutPreview,
    btnOpenSetupContactPreview,
    btnOpenSetupHowPreview,
    btnOpenSetupPublishedSite,
  ].forEach((button) => {
    if (!button) return;
    button.disabled = !previewAvailable;
    button.title = previewAvailable ? "" : "Save or reload setup once the tenant record is available.";
  });
}

function initSetupBuilderNav() {
  document.querySelectorAll("[data-setup-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = String(button.getAttribute("data-setup-target") || "").trim();
      if (!targetId) return;
      document.querySelectorAll("[data-setup-target]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.classList.add("setup-focus-flash");
      window.setTimeout(() => target?.classList.remove("setup-focus-flash"), 900);
    });
  });
}

function setupPreviewHtml(payload = {}, record = null) {
  const logoUrl = String(payload.logo_url || "").trim();
  const heroUrl = String(payload.hero_image_url || "").trim();
  const reviewUrl = cleanUrl(payload.review_link_url || "");
  const reviewPlatform = String(payload.review_platform_label || "").trim() || (reviewUrl ? "Google" : "-");
  const referralMessage = String(payload.referral_message || "").trim();
  const accent = String(payload.accent_color || "#c84b2f").trim() || "#c84b2f";
  const surface = String(payload.site_surface_style || "clean").trim().toLowerCase();
  const fontPreset = String(payload.site_font_preset || "modern_sans").trim().toLowerCase();
  const cardStyle = String(payload.site_card_style || "soft").trim().toLowerCase();
  const buttonStyle = String(payload.site_button_style || "rounded").trim().toLowerCase();
  const surfaceBg = surface === "warm" ? "rgba(200, 160, 120, .08)" : surface === "bold" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.03)";
  const heroBg = surface === "warm" ? "linear-gradient(180deg, rgba(200,160,120,.13), rgba(255,255,255,.03))" : surface === "bold" ? "linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.03))" : "linear-gradient(180deg, rgba(22,79,99,.10), rgba(255,255,255,.03))";
  const fontFamily = fontPreset === "trust_serif" ? "Georgia, 'Times New Roman', serif" : fontPreset === "editorial" ? "'Palatino Linotype', 'Book Antiqua', Palatino, serif" : "var(--font-display)";
  const cardBorderRadius = cardStyle === "lined" ? "12px" : cardStyle === "elevated" ? "20px" : "16px";
  const cardShadow = cardStyle === "elevated" ? "0 18px 36px rgba(0,0,0,.22)" : "none";
  const buttonRadius = buttonStyle === "solid" ? "10px" : buttonStyle === "outline" ? "999px" : "16px";
  const buttonBackground = buttonStyle === "outline" ? "transparent" : accent;
  const buttonBorder = buttonStyle === "outline" ? `1px solid ${accent}` : "1px solid transparent";
  const buttonColor = buttonStyle === "outline" ? accent : "#ffffff";
  const publishStatus = setupPublishStatus(payload);
  const bookingCta = String(payload.site_booking_cta_label || "Book now").trim();
  const primaryCta = String(payload.site_primary_cta_label || "Request service").trim();

  return `
    <div class="setup-site-preview" style="display:grid;gap:14px;">
      <div class="setup-site-preview__top" style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:64px;height:64px;border-radius:14px;border:1px solid var(--border);background:${surfaceBg};display:grid;place-items:center;overflow:hidden;">
            ${logoUrl ? `<img src="${escapeAttr(logoUrl)}" alt="Logo" style="width:100%;height:100%;object-fit:cover;" />` : `<span class="muted" style="font-size:.8rem;">No logo</span>`}
          </div>
          <div>
            <div style="font-weight:800;font-size:1.05rem;">${escapeHtml(record?.legal_business_name || OPERATOR_CONFIG.tenantBusinessName || "Business")}</div>
            <div class="muted">${escapeHtml(payload.tagline || "No tagline yet.")}</div>
          </div>
        </div>
        <span class="pill" style="border-color:${publishStatus === "published" ? "rgba(67,160,71,.3)" : "var(--border)"};color:${publishStatus === "published" ? "var(--good)" : "var(--muted)"};">${escapeHtml(publishStatus)}</span>
      </div>
      <div class="setup-site-preview__hero" style="padding:18px;border-radius:${cardBorderRadius};border:1px solid var(--border);background:${heroBg};box-shadow:${cardShadow};">
        <div style="font-family:${fontFamily};font-weight:800;font-size:1.4rem;line-height:1.05;margin-bottom:8px;">${escapeHtml(payload.hero_heading || record?.legal_business_name || "Hero heading not set")}</div>
        <div class="muted" style="line-height:1.65;">${escapeHtml(payload.hero_subheading || "No hero subheading yet.")}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
          <span style="display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:${buttonRadius};border:${buttonBorder};background:${buttonBackground};color:${buttonColor};font-weight:700;">${escapeHtml(primaryCta)}</span>
          <span style="display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:${buttonRadius};border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text);font-weight:700;">${escapeHtml(bookingCta)}</span>
        </div>
        ${heroUrl ? `<div style="margin-top:14px;border-radius:${cardBorderRadius};overflow:hidden;border:1px solid var(--border);"><img src="${escapeAttr(heroUrl)}" alt="Hero" style="display:block;width:100%;height:220px;object-fit:cover;" /></div>` : ``}
      </div>
      <div class="table">
        <div class="tr"><div>Public contact</div><div>${escapeHtml(payload.public_contact_email || payload.contact_email || "-")}</div></div>
        <div class="tr"><div>Public phone</div><div>${escapeHtml(payload.public_business_phone || payload.business_phone || "-")}</div></div>
        <div class="tr"><div>Location</div><div>${escapeHtml(record?.city_state || payload.city_state || "-")}</div></div>
        <div class="tr"><div>Service area</div><div>${escapeHtml(payload.service_area || "-")}</div></div>
        <div class="tr"><div>Review platform</div><div>${escapeHtml(reviewPlatform)}</div></div>
        <div class="tr"><div>Review link</div><div>${reviewUrl ? `<a href="${escapeAttr(reviewUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reviewUrl)}</a>` : "-"}</div></div>
      </div>
      <div class="grid two" style="gap:12px;">
        <div class="detail-card">
          <div class="kicker">Style choices</div>
          <div class="detail-copy">Font: ${escapeHtml(siteFontLabel(fontPreset))}<br />Surface: ${escapeHtml(siteStyleLabel(payload.site_surface_style, "surface"))}<br />Buttons: ${escapeHtml(siteStyleLabel(payload.site_button_style, "button"))}</div>
        </div>
        <div class="detail-card">
          <div class="kicker">Website structure</div>
          <div class="detail-copy">Hero: ${escapeHtml(siteStyleLabel(payload.site_hero_layout, "hero"))}<br />Cards: ${escapeHtml(siteStyleLabel(payload.site_card_style, "card"))}<br />Prices visible: ${payload.show_prices !== false ? "Yes" : "No"}</div>
        </div>
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
  if (setupPrimaryCtaLabel) setupPrimaryCtaLabel.value = payload.site_primary_cta_label || "Request service";
  if (setupBookingCtaLabel) setupBookingCtaLabel.value = payload.site_booking_cta_label || "Book now";
  if (setupSiteFontPreset) setupSiteFontPreset.value = payload.site_font_preset || "modern_sans";
  if (setupSiteSurfaceStyle) setupSiteSurfaceStyle.value = payload.site_surface_style || "clean";
  if (setupSiteButtonStyle) setupSiteButtonStyle.value = payload.site_button_style || "rounded";
  if (setupSiteCardStyle) setupSiteCardStyle.value = payload.site_card_style || "soft";
  if (setupSiteHeroLayout) setupSiteHeroLayout.value = payload.site_hero_layout || "split";
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
  const bookingEnabled = payload.booking_page_enabled !== false;
  const setupBookingPageEl = document.getElementById('setupBookingPageEnabled');
  if (setupBookingPageEl) setupBookingPageEl.checked = bookingEnabled;
  applyWebsiteMode(bookingEnabled);
  renderSetupPublishMeta(payload);
  if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(payload, record || SETUP_STATE?.locked_record || null);
  renderSetupPreviewActions();
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
    site_primary_cta_label: setupPrimaryCtaLabel?.value?.trim() || "Request service",
    site_booking_cta_label: setupBookingCtaLabel?.value?.trim() || "Book now",
    site_font_preset: setupSiteFontPreset?.value?.trim() || "modern_sans",
    site_surface_style: setupSiteSurfaceStyle?.value?.trim() || "clean",
    site_button_style: setupSiteButtonStyle?.value?.trim() || "rounded",
    site_card_style: setupSiteCardStyle?.value?.trim() || "soft",
    site_hero_layout: setupSiteHeroLayout?.value?.trim() || "split",
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
    booking_page_enabled: document.getElementById('setupBookingPageEnabled')?.checked !== false,
    site_publish_status: setupPublishStatus(SETUP_STATE?.config || extra) || "draft",
    site_published_at: String(SETUP_STATE?.config?.site_published_at || "").trim(),
    ...extra,
  };
}

function applyWebsiteMode(enabled) {
  BOOKING_PAGE_ENABLED = enabled;
  document.querySelectorAll('[data-website-feature]').forEach((el) => {
    el.style.display = enabled ? '' : 'none';
  });
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

async function publishWebsite() {
  const nextStatus = 'published';
  return saveOperatorSetup({
    site_publish_status: nextStatus,
    site_published_at: new Date().toISOString(),
    onboarding_complete: true,
  });
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
      button.title = "Go back to the previous workspace";
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
    button.textContent = `â† ${workspaceTabLabel(previousTab, blueprint)}`;
    button.textContent = `Back to ${workspaceTabLabel(previousTab, blueprint)}`;
    button.onclick = () => switchTab(previousTab);
  });
}
async function switchTab(tab, opts = {}) {
  if (_tabAbortController) { _tabAbortController.abort(); }
  _tabAbortController = new AbortController();
  let nextTab = normalizePanel(tab);
  if (nextTab === "quotes" && isServiceWorkspace(currentWorkspaceBlueprint())) {
    nextTab = "bids";
  }
  ensureSecondaryTabVisible?.(nextTab);
  const activeTab = document.querySelector(".tab.active")?.dataset.tab || "dashboard";
  ensureWorkspaceWindowShell();
  bindWorkspaceDirtyTracking();
  if (!opts.force && !(await confirmWorkspaceChange(activeTab, nextTab))) {
    if (opts.updateHash !== false) syncPanelHash(activeTab);
    return false;
  }
  if (nextTab !== activeTab) PREVIOUS_PANEL_TAB = activeTab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === nextTab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== nextTab));
  setWorkspaceCollapsed(nextTab, false);

  if (nextTab === "money") renderMoney().catch(console.error);
  if (nextTab === "dashboard") renderDashboard();
  if (nextTab === "leads") renderLeads(leadSearch?.value || "");
  if (nextTab === "orders" && !TABS_LOADED.has("orders")) {
    TABS_LOADED.add("orders");
    renderOrders(); renderPackagesSummary();
  }
  if (nextTab === "bids") renderBids(bidSearch?.value || "");
  if (nextTab === "jobs" && !TABS_LOADED.has("jobs")) {
    TABS_LOADED.add("jobs");
    renderJobs(jobSearch?.value || "");
  }
  if (nextTab === "plans") renderPlans(planSearch?.value || "");
  if (nextTab === "customers" && !TABS_LOADED.has("customers")) {
    TABS_LOADED.add("customers");
    renderCustomersList(customerSearch?.value || "");
  }
  if (nextTab === "import") window.PROOFLINK_IMPORT_WORKSPACE?.render?.();
  if (nextTab === "payments") renderPayments();
  if (nextTab === "domains") window.renderDomains?.();
  if (nextTab === "setup") fetchOperatorSetup().catch((err) => setSetupMessage(err.message || String(err), "bad"));
  if (nextTab === "guidance") renderGuidance();
  if (nextTab === "bookings") {
    renderBookings().catch(console.error);
    if (isHydrovacWorkspace()) {
      fetchEquipment().catch(console.warn);
      fetchHydrovacLocateTickets().catch(console.warn);
      fetchHydrovacComplianceData().catch(console.warn);
    }
  }
    if (nextTab === "quotes" && !TABS_LOADED.has("quotes")) {
      TABS_LOADED.add("quotes");
      fetchAndRenderQuotes().catch(console.error);
    }
    if (nextTab === "facilities") fetchHydrovacFacilities().catch(console.error);
    if (nextTab === "manifests") fetchHydrovacManifests().catch(console.error);
    if (nextTab === "locates") fetchHydrovacLocateTickets().catch(console.error);
    if (nextTab === "compliance") fetchHydrovacComplianceData().catch(console.error);
    if (nextTab === "reviews")  fetchAndRenderReviews().catch(console.error);
  if (nextTab === "messages") fetchAndRenderMessages().catch(console.error);
  if (nextTab === "ai")       initAIPanel();
  if (nextTab === "vendors" && !VENDORS_PANEL_LOADED) {
    VENDORS_PANEL_LOADED = true;
    fetchVendors().then(renderVendors);
  }
  if (nextTab === 'inventory' && !INVENTORY_PANEL_LOADED) {
    INVENTORY_PANEL_LOADED = true;
    fetchInventory().then(() => renderInventory());
    $('inventorySearch')?.addEventListener('input', (e) => renderInventory(e.target.value));
    $('btnAddInventoryItem')?.addEventListener('click', openAddInventoryModal);
    $('btnRefreshInventory')?.addEventListener('click', async () => { await fetchInventory(); renderInventory($('inventorySearch')?.value || ''); });
  }
  if (nextTab === 'contracts' && !CONTRACTS_PANEL_LOADED) {
    CONTRACTS_PANEL_LOADED = true;
    fetchContracts().then(contracts => { CONTRACTS_CACHE = contracts; renderContracts(); });
    $('btnAddContract')?.addEventListener('click', () => openAddContractModal());
    $('btnRefreshContracts')?.addEventListener('click', async () => { CONTRACTS_CACHE = await fetchContracts(); renderContracts(); });
  }
  if (nextTab === 'availability') {
    loadAvailabilityBlocks();
  }
  if (nextTab === 'team' && !TEAM_PANEL_LOADED) {
    TEAM_PANEL_LOADED = true;
    fetchTeamMembers().catch(console.warn);
    fetchHydrovacDriverQualifications().catch(console.warn);
    $('btnInviteTeamMember')?.addEventListener('click', () => openInviteTeamMemberModal());
    $('btnRefreshTeam')?.addEventListener('click', async () => {
      await fetchTeamMembers().catch(console.warn);
      await fetchHydrovacDriverQualifications().catch(console.warn);
    });
    $('btnLoadHours')?.addEventListener('click', loadHoursReport);
    $('btnExportHoursCsv')?.addEventListener('click', exportHoursCsv);
    // Set default date range to current month
    const hoursStart = $('hoursStart');
    const hoursEnd = $('hoursEnd');
    if (hoursStart && !hoursStart.value) {
      const now = new Date();
      hoursStart.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      hoursEnd.value = now.toISOString().split('T')[0];
    }
  } else if (nextTab === 'team') {
    fetchHydrovacDriverQualifications().catch(console.warn);
  }
  if (nextTab === 'equipment' && !EQUIPMENT_PANEL_LOADED) {
    EQUIPMENT_PANEL_LOADED = true;
    fetchEquipment().catch(console.warn);
    $('btnAddEquipment')?.addEventListener('click', () => openAddEquipmentModal());
    $('btnRefreshEquipment')?.addEventListener('click', () => fetchEquipment().catch(console.warn));
  }
  if (opts.updateHash !== false) syncPanelHash(nextTab);
  renderPanelBackButtons();
  renderWorkspaceHub();
  scheduleWorkspaceSnapshot(nextTab);
  return true;
}
document.querySelectorAll(".tab[data-tab]").forEach((btn) => {
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
    .select("role, tenant_id, operators!operator_id(id, name, tenant_id)")
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
          .select("role, tenant_id, operators!operator_id(id, name, tenant_id)")
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

  // Use tenant_id from operator_members first (handles platform_admin whose operators row has null tenant_id)
  const operatorTenantId = String(data.tenant_id || data.operators.tenant_id || '').trim();
  if (TENANT_SCOPE_ENABLED && operatorTenantId && operatorTenantId !== TENANT_ID) {
    // Tenant in database doesn't match static config - update the module-level
    // TENANT_ID to the real value from the database so all queries use the correct
    // tenant. This allows the operator dashboard to work for any provisioned tenant,
    // not just the demo tenant hardcoded in cottagelink.tenant.js.
    console.log(`[ProofLink] Tenant scope updated: ${TENANT_ID} -> ${operatorTenantId}`);
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
  if (FETCHING.has('products')) return;
  FETCHING.add('products');
  try {
    const { data, error } = await scopeQuery(sb
      .from("products")
      .select("*"))
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;
    PRODUCTS_CACHE = data || [];
    return PRODUCTS_CACHE;
  } finally {
    FETCHING.delete('products');
  }
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
    const pricingRow = currentPricingRow(p.id) || {
      product_id: p.id,
      product_name: p.name || "",
      unit_label: "job",
      pricing_mode: normalizePricingModeForUi(p),
      sell_price_cents: Number(p.sell_price_cents || 0),
      starting_price_cents: Number(p.starting_price_cents || 0),
    };
    const el = document.createElement("div");
    el.className = "list-item";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(p.name)}</div>
        <div class="li-sub muted">${escapeHtml(p.category || "-")}  |  ${escapeHtml(p.slug)}  |  ${escapeHtml(pricingSummaryForRow(pricingRow))}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${p.is_active ? "pill-on" : ""}">${p.is_active ? "On site" : "Hidden"}</span>
        <span class="pill ${p.is_available ? "pill-on" : ""}">${p.is_available ? "Available" : "Unavailable"}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-edit-product-id="${escapeAttr(p.id)}">Edit</button>
        <button class="btn btn-primary btn-sm" type="button" data-price-product-id="${escapeAttr(p.id)}">Price</button>
      </div>
    `;
    el.addEventListener("click", () => openPricingForProduct(p.id));
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPricingForProduct(p.id);
      }
    });
    productsList.appendChild(el);
  });

  productsList.querySelectorAll("[data-edit-product-id]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const row = PRODUCTS_CACHE.find((product) => product.id === btn.getAttribute("data-edit-product-id"));
      if (row) loadProductIntoForm(row);
    });
  });

  productsList.querySelectorAll("[data-price-product-id]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await openPricingForProduct(btn.getAttribute("data-price-product-id"));
    });
  });
}
function clearProductForm() {
  productId.value = "";
  productName.value = "";
  productSlug.value = "";
  productCategory.value = "";
  productDescription.value = "";
  productTags.value = "";
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
  productTags.value = Array.isArray(p.ingredients) ? p.ingredients.join(", ") : "";
  productImageUrl.value = p.image_url || "";
  if (productImageFile) productImageFile.value = "";
  if (productImageStatus) productImageStatus.textContent = "";
  if (productIsActive) productIsActive.checked = !!p.is_active;
  if (productIsAvailable) productIsAvailable.checked = !!p.is_available;
  if (productSort) productSort.value = String(p.sort_order ?? 0);
  if (productMsg) productMsg.textContent = "";
  if (productFormTitle) productFormTitle.textContent = `Edit: ${p.name}`;
}
async function openPricingForProduct(productId) {
  if (!productId) return;
  const product = PRODUCTS_CACHE.find((row) => row.id === productId) || null;
  const hydrovacTemplate = hydrovacTemplateForProduct(product);
  ACTIVE_PRICING_PRODUCT_ID = productId;
  renderPricing(await fetchPricing());
  switchTab("pricing");
  if (hydrovacTemplate && !ACTIVE_JOB_ID) {
    applyHydrovacJobTemplate(hydrovacTemplate.key, {
      preserveExisting: true,
      announce: false,
    });
    showToast(`${hydrovacTemplate.label} is ready in Jobs too.`);
  }
}

function presetProductPayload(item, sortOrder) {
  const pricingMode = String(item.pricing_mode || "quote");
  return withTenantScope({
    operator_id: opId(),
    name: item.name,
    slug: item.slug || slugify(item.name),
    category: item.category || "Services",
    description: item.description || "",
    ingredients: [],
    image_url: null,
    is_active: true,
    is_available: true,
    sort_order: sortOrder,
    pricing_mode: pricingMode,
    sell_price_cents: pricingMode === "fixed" ? presetAmountCents(item) : 0,
    starting_price_cents: pricingMode === "starts_at" ? presetAmountCents(item) : 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function loadRecommendedServicePack() {
  const preset = currentServicePreset();
  if (!preset?.items?.length) {
    notifyOperator("No recommended services are configured for this business yet.");
    return;
  }

  if (productMsg) productMsg.textContent = "Loading recommended services...";

  const existingBySlug = new Map((PRODUCTS_CACHE || []).map((row) => [String(row.slug || "").trim().toLowerCase(), row]));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, item] of preset.items.entries()) {
    const slug = slugify(item.name);
    const existing = existingBySlug.get(slug);
    let productIdValue = existing?.id || "";

    if (!existing) {
      const { data, error } = await sb.from("products")
        .insert(presetProductPayload(item, index))
        .select("id")
        .single();
      if (error) throw error;
      productIdValue = data?.id || "";
      inserted += 1;
    } else {
      const shouldHydrateExisting = Number(existing.sell_price_cents || existing.starting_price_cents || 0) <= 0;
      if (shouldHydrateExisting || !String(existing.description || "").trim()) {
        const patch = {
          category: existing.category || item.category || "Services",
          description: String(existing.description || "").trim() || item.description || "",
          pricing_mode: shouldHydrateExisting ? item.pricing_mode : existing.pricing_mode,
          sell_price_cents: shouldHydrateExisting && item.pricing_mode === "fixed" ? presetAmountCents(item) : Number(existing.sell_price_cents || 0),
          starting_price_cents: shouldHydrateExisting && item.pricing_mode === "starts_at" ? presetAmountCents(item) : Number(existing.starting_price_cents || 0),
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from("products")
          .update(patch)
          .eq("id", existing.id)
          .eq(OPERATOR_COLUMN, opId())
          .eq(TENANT_COLUMN, TENANT_ID);
        if (error) throw error;
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    if (!productIdValue) continue;
    await ensurePricingRow(productIdValue);

    const pricingPatch = {
      unit_label: item.unit_label || "job",
      notes: item.notes || "",
      updated_at: new Date().toISOString(),
    };
    const { error: pricingError } = await sb.from("pricing")
      .update(pricingPatch)
      .eq("product_id", productIdValue)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID);
    if (pricingError) throw pricingError;
  }

  await fetchProducts();
  renderProductsList(productSearch?.value || "");
  renderPricing(await fetchPricing());
  renderServicePresetPicker();
  renderBidCatalogStarters(currentBid());
  renderStartupChecklist();

  const summary = `${inserted} added, ${updated} filled in, ${skipped} left alone.`;
  if (productMsg) productMsg.textContent = `Recommended services loaded. ${summary}`;
  if (productPresetNotice) {
    productPresetNotice.innerHTML += `<div class="workspace-panel-notice__copy" style="margin-top:8px;">Latest load: ${escapeHtml(summary)}</div>`;
  }
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
productSearch?.addEventListener("input", debounce(() => renderProductsList(productSearch.value)));
servicePresetPack?.addEventListener("change", renderServicePresetPicker);
btnLoadRecommendedServices?.addEventListener("click", async () => {
  try {
    await loadRecommendedServicePack();
  } catch (err) {
    if (productMsg) productMsg.textContent = err.message || String(err);
    else notifyOperator(err.message || String(err));
  }
});
btnRefreshProducts?.addEventListener("click", async () => {
  try {
    await fetchProducts();
    await fetchPricing();
    renderProductsList(productSearch.value);
    renderServicePresetPicker();
    renderBidCatalogStarters(currentBid());
    await refreshPicklists();
    renderStartupChecklist();
  } catch (err) {
    notifyOperator(err.message || String(err));
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
    ingredients: String(productTags.value || "").split(",").map((s) => normalizePick(s)).filter(Boolean),
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
      await fetchPricing();
    renderProductsList(productSearch.value);
    renderServicePresetPicker();
    renderBidCatalogStarters(currentBid());
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
    await fetchPricing();
    renderProductsList(productSearch.value);
    renderServicePresetPicker();
    renderBidCatalogStarters(currentBid());
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

  PRICING_CACHE = (productsRes.data || []).map((product) => {
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
  return PRICING_CACHE;
}
function totalCostCents(row) {
  return Number(row.cost_ingredients_cents || 0) + Number(row.cost_packaging_cents || 0);
}
function renderPricing(rows) {
  if (!pricingList) return;

  PRICING_CACHE = Array.isArray(rows) ? rows : [];
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
    if (r.product_id === ACTIVE_PRICING_PRODUCT_ID) el.classList.add("is-active");
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

  if (ACTIVE_PRICING_PRODUCT_ID) {
    const activeRow = pricingList.querySelector(`.list-item.is-active`);
    activeRow?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

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
        notifyOperator(err.message || String(err));
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
        notifyOperator(err.message || String(err));
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
        notifyOperator(err.message || String(err));
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

// Normalize the operator theme after the rest of the UI boots.
// This keeps the console readable even when tenant branding is dramatic.
(function initializeReadableOperatorTheme() {
  const root = document.documentElement;
  window.__prooflinkThemeManaged = true;
  const savedTheme = localStorage.getItem("pl_theme");
  if (!savedTheme) {
    root.setAttribute("data-theme", "light");
  }

  const originalButton = $("btnDarkMode");
  if (!originalButton) return;

  const replacementButton = originalButton.cloneNode(true);
  originalButton.replaceWith(replacementButton);

  function syncThemeButton() {
    const activeTheme = root.getAttribute("data-theme") || "light";
    replacementButton.textContent = activeTheme === "light" ? "â—" : "â˜€";
    replacementButton.title = activeTheme === "light" ? "Switch to dark mode" : "Switch to light mode";
  }

  syncThemeButton();

  replacementButton.addEventListener("click", () => {
    const currentTheme = root.getAttribute("data-theme") || "light";
    const nextTheme = currentTheme === "light" ? "dark" : "light";
    root.setAttribute("data-theme", nextTheme);
    localStorage.setItem("pl_theme", nextTheme);
    syncThemeButton();
  });
})();
btnPreviewWebsite?.addEventListener("click", () => {
  if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null);
  renderSetupPublishMeta(collectSetupPayload());
  renderSetupPreviewActions();
  setSetupMessage('Preview refreshed with the current draft.', 'good');
});
btnOpenSetupHomePreview?.addEventListener("click", () => {
  window.open(setupPreviewUrl("site-home.html"), "_blank", "noopener");
});
btnOpenSetupProductsPreview?.addEventListener("click", () => {
  window.open(setupPreviewUrl("products.html"), "_blank", "noopener");
});
btnOpenSetupOrderPreview?.addEventListener("click", () => {
  window.open(setupPreviewUrl("order.html"), "_blank", "noopener");
});
btnOpenSetupAboutPreview?.addEventListener("click", () => {
  window.open(setupPreviewUrl("about.html"), "_blank", "noopener");
});
btnOpenSetupContactPreview?.addEventListener("click", () => {
  window.open(setupPreviewUrl("contact.html"), "_blank", "noopener");
});
btnOpenSetupHowPreview?.addEventListener("click", () => {
  window.open(setupPreviewUrl("how-it-works.html"), "_blank", "noopener");
});
btnOpenSetupPublishedSite?.addEventListener("click", () => {
  window.open(setupPublishedUrl("site-home.html"), "_blank", "noopener");
});
btnPublishWebsite?.addEventListener("click", async () => {
  try {
    await publishWebsite();
    setSetupMessage('Website published. Customers should now see the live version of this draft.', 'good');
  } catch (err) {
    setSetupMessage(err.message || String(err), 'bad');
  }
});
btnPublishWebsiteTop?.addEventListener("click", async () => {
  try {
    await publishWebsite();
    setSetupMessage('Website published. Customers should now see the live version of this draft.', 'good');
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
[setupTagline, setupHeroHeading, setupHeroSubheading, setupAbout, setupLogoUrl, setupHeroImageUrl, setupPublicContactEmail, setupPublicBusinessPhone, setupServiceArea, setupReviewPlatformLabel, setupReviewLinkUrl, setupReferralMessage, setupInstagram, setupFacebook, setupHoursNotes, setupFulfillmentNotes, setupAccentColor, setupPrimaryCtaLabel, setupBookingCtaLabel].forEach((el) => {
  el?.addEventListener('input', () => {
    if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null);
    renderSetupPublishMeta(collectSetupPayload());
    renderSetupPreviewActions();
  });
});
[setupShowPrices, setupAllowCustomRequests, setupWorkspaceBusinessType, setupSiteFontPreset, setupSiteSurfaceStyle, setupSiteButtonStyle, setupSiteCardStyle, setupSiteHeroLayout].forEach((el) => {
  el?.addEventListener('change', () => {
    if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null);
    renderSetupPublishMeta(collectSetupPayload());
    renderSetupPreviewActions();
  });
});
initSetupBuilderNav();
renderSetupPreviewActions();

btnRefreshPricing?.addEventListener("click", async () => {
  try {
    await fetchProducts();
    renderPricing(await fetchPricing());
    renderBidCatalogStarters(currentBid());
  } catch (err) {
    notifyOperator(err.message || String(err));
  }
});

async function fetchExpenses() {
  if (FETCHING.has('expenses')) return;
  FETCHING.add('expenses');
  try {
    const { data, error } = await scopeQuery(sb
      .from("expenses")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .order("date", { ascending: false })
      .limit(250);
    if (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) return;
      console.error('[fetchExpenses]', error);
      return;
    }
    EXPENSES_CACHE = data || [];
    return EXPENSES_CACHE;
  } finally {
    FETCHING.delete('expenses');
  }
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
    notifyOperator(err.message || String(err));
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

// â”€â”€ Bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchBookings() {
  if (FETCHING.has('bookings')) return;
  FETCHING.add('bookings');
  try {
    const tok = await getAccessToken();
    const year  = BK_VIEW_DATE.getFullYear();
    const month = BK_VIEW_DATE.getMonth();
    const start = new Date(year, month, 1).toISOString().slice(0, 10);
    const end   = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    const res = await fetch(`/.netlify/functions/get-bookings?start=${start}&end=${end}`, {
      headers: { "Authorization": `Bearer ${tok}` },
      signal: _tabAbortController?.signal,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to fetch bookings");
    BOOKINGS_CACHE = (d.bookings || []).filter((b) => !b.is_deleted);
    return BOOKINGS_CACHE;
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) return;
    throw err;
  } finally {
    FETCHING.delete('bookings');
  }
}

async function fetchOperatorMembers() {
  if (OPERATOR_MEMBERS_CACHE.length) return OPERATOR_MEMBERS_CACHE;
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/get-operator-members", {
      headers: { "Authorization": `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(d.members)) {
      OPERATOR_MEMBERS_CACHE = d.members;
    }
  } catch (_) {}
  return OPERATOR_MEMBERS_CACHE;
}

let CONTRACTS_CACHE = [];
let CONTRACTS_PANEL_LOADED = false;

async function fetchContracts(customerId) {
  try {
    const tok = await getAccessToken();
    const url = customerId
      ? `/.netlify/functions/manage-service-contracts?customer_id=${encodeURIComponent(customerId)}`
      : '/.netlify/functions/manage-service-contracts';
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tok}` } });
    const d = await res.json().catch(() => ({}));
    if (d.contracts && !customerId) CONTRACTS_CACHE = d.contracts;
    return d.contracts || [];
  } catch { return []; }
}

function renderContracts() {
  const listEl = $('contractsList');
  const expiringEl = $('contractsExpiringSoon');
  if (!listEl) return;

  const now = new Date();
  const soon = new Date(now); soon.setDate(soon.getDate() + 60);
  const expiring = CONTRACTS_CACHE.filter(c => c.expires_at && new Date(c.expires_at) <= soon && new Date(c.expires_at) >= now);

  if (expiringEl) {
    expiringEl.innerHTML = expiring.length
      ? expiring.map(c => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);">
          <div><div style="font-weight:500;color:#e8e9eb;">${escapeHtml(c.title)}</div>
          <div style="font-size:.78rem;color:rgba(255,255,255,.4);">${escapeHtml(c.contract_type || 'warranty')} Â· expires ${new Date(c.expires_at).toLocaleDateString()}</div></div>
          <span style="color:#fbbf24;font-size:.78rem;font-weight:600;">${Math.ceil((new Date(c.expires_at)-now)/86400000)} days</span>
        </div>`).join('')
      : '<div class="muted" style="font-size:.82rem;">No contracts expiring in next 60 days.</div>';
  }

  if (!CONTRACTS_CACHE.length) {
    listEl.innerHTML = '<div class="muted" style="font-size:.85rem;">No service contracts yet.</div><div style="margin-top:10px;"><button class="btn btn-primary btn-sm" onclick="openAddContractModal()">+ Add first contract</button></div>';
    return;
  }
  listEl.innerHTML = CONTRACTS_CACHE.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div>
        <div style="font-weight:500;color:#e8e9eb;">${escapeHtml(c.title)}</div>
        <div style="font-size:.78rem;color:rgba(255,255,255,.4);">${escapeHtml(c.contract_type || 'warranty')}${c.starts_at ? ' Â· starts ' + new Date(c.starts_at).toLocaleDateString() : ''}${c.expires_at ? ' Â· expires ' + new Date(c.expires_at).toLocaleDateString() : ''}</div>
        ${c.terms ? `<div style="font-size:.75rem;color:rgba(255,255,255,.3);margin-top:2px;">${escapeHtml(c.terms.slice(0,80))}${c.terms.length>80?'â€¦':''}</div>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" style="font-size:.72rem;" onclick="openEditContractModal(CONTRACTS_CACHE.find(x=>x.id==='${escapeAttr(c.id)}'))">Edit</button>
      <button class="btn btn-ghost" style="font-size:.72rem;" onclick="deleteContract('${escapeAttr(c.id)}')">Remove</button>
    </div>`).join('');
}

async function deleteContract(id) {
  if (!(await showConfirmModal('Remove this contract?', 'Remove', 'Cancel'))) return;
  const tok = await getAccessToken();
  await fetch(`/.netlify/functions/manage-service-contracts?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'Authorization': `Bearer ${tok}` },
  });
  await fetchContracts();
  renderContracts();
}

function openEditContractModal(contract) {
  if (!contract) return;
  const existing = document.getElementById('editContractModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'editContractModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const custOptions = (CUSTOMERS_CACHE || []).map(c => `<option value="${escapeAttr(c.id)}" ${c.id === contract.customer_id ? 'selected' : ''}>${escapeHtml(c.name || c.email || c.id)}</option>`).join('');
  const startsVal = contract.starts_at ? contract.starts_at.slice(0, 10) : '';
  const expiresVal = contract.expires_at ? contract.expires_at.slice(0, 10) : '';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:460px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Edit service contract</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="ecTitle" class="input" placeholder="Contract title *" style="width:100%;" value="${escapeAttr(contract.title || '')}" />
        <div style="display:flex;gap:8px;">
          <select id="ecType" class="input" style="flex:1;">
            <option value="warranty" ${contract.contract_type === 'warranty' ? 'selected' : ''}>Warranty</option>
            <option value="maintenance" ${contract.contract_type === 'maintenance' ? 'selected' : ''}>Maintenance plan</option>
            <option value="service_plan" ${contract.contract_type === 'service_plan' ? 'selected' : ''}>Service plan</option>
          </select>
          <select id="ecCustomer" class="input" style="flex:1;">
            <option value="">No customer</option>${custOptions}
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Starts</label>
            <input id="ecStarts" type="date" class="input" style="width:100%;" value="${escapeAttr(startsVal)}" /></div>
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Expires</label>
            <input id="ecExpires" type="date" class="input" style="width:100%;" value="${escapeAttr(expiresVal)}" /></div>
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Remind (days before)</label>
            <input id="ecRemind" type="number" class="input" value="${escapeAttr(String(contract.reminder_days ?? 30))}" min="0" style="width:100%;" /></div>
        </div>
        <textarea id="ecTerms" class="input" rows="2" placeholder="Terms / notes" style="width:100%;resize:vertical;">${escapeHtml(contract.terms || '')}</textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('editContractModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="ecSave" class="btn btn-primary">Save changes</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('ecSave').onclick = async () => {
    const title = (document.getElementById('ecTitle')?.value || '').trim();
    if (!title) { notifyOperator("Add a title first."); return; }
    const btn = document.getElementById('ecSave'); btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-service-contracts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          id: contract.id,
          title,
          contract_type: document.getElementById('ecType')?.value,
          customer_id: document.getElementById('ecCustomer')?.value || undefined,
          starts_at: document.getElementById('ecStarts')?.value || undefined,
          expires_at: document.getElementById('ecExpires')?.value || undefined,
          reminder_days: parseInt(document.getElementById('ecRemind')?.value || 30),
          terms: (document.getElementById('ecTerms')?.value || '').trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Contract updated.');
      modal.remove();
      CONTRACTS_CACHE = await fetchContracts();
      renderContracts();
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Save changes';
    }
  };
}

function openAddContractModal(customerId, orderId) {
  const existing = document.getElementById('addContractModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'addContractModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const custOptions = (CUSTOMERS_CACHE||[]).map(c => `<option value="${escapeAttr(c.id)}" ${c.id===customerId?'selected':''}>${escapeHtml(c.name||c.email||c.id)}</option>`).join('');
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:460px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Add service contract</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="ctTitle" class="input" placeholder="Contract title *" style="width:100%;" />
        <div style="display:flex;gap:8px;">
          <select id="ctType" class="input" style="flex:1;">
            <option value="warranty">Warranty</option>
            <option value="maintenance">Maintenance plan</option>
            <option value="service_plan">Service plan</option>
          </select>
          <select id="ctCustomer" class="input" style="flex:1;">
            <option value="">No customer</option>${custOptions}
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Starts</label>
            <input id="ctStarts" type="date" class="input" style="width:100%;" /></div>
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Expires</label>
            <input id="ctExpires" type="date" class="input" style="width:100%;" /></div>
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Remind (days before)</label>
            <input id="ctRemind" type="number" class="input" value="30" min="0" style="width:100%;" /></div>
        </div>
        <textarea id="ctTerms" class="input" rows="2" placeholder="Terms / notes" style="width:100%;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('addContractModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="ctSave" class="btn btn-primary">Save contract</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('ctSave').onclick = async () => {
    const title = ($('ctTitle')?.value || '').trim();
    if (!title) { notifyOperator("Add a title first."); return; }
    const btn = $('ctSave'); btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-service-contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          title,
          contract_type: $('ctType')?.value,
          customer_id  : $('ctCustomer')?.value || undefined,
          order_id     : orderId || undefined,
          starts_at    : $('ctStarts')?.value || undefined,
          expires_at   : $('ctExpires')?.value || undefined,
          reminder_days: parseInt($('ctRemind')?.value || 30),
          terms        : ($('ctTerms')?.value || '').trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Contract saved.');
      modal.remove();
      CONTRACTS_CACHE = await fetchContracts();
      renderContracts();
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Save contract';
    }
  };
}

async function fetchInventory() {
  try {
    const tok = await getAccessToken();
    const res = await fetch('/.netlify/functions/manage-inventory', {
      headers: { 'Authorization': `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (d.items) INVENTORY_CACHE = d.items;
  } catch (e) { /* silent */ }
  return INVENTORY_CACHE;
}

function renderInventory(filter = '') {
  const listEl = $('inventoryList');
  if (!listEl) return;

  // Update summary stats
  const totalItems = INVENTORY_CACHE.length;
  const lowStock = INVENTORY_CACHE.filter(i => i.reorder_point > 0 && Number(i.quantity_on_hand) <= Number(i.reorder_point)).length;
  const totalValue = INVENTORY_CACHE.reduce((s, i) => s + (Number(i.quantity_on_hand) * Number(i.cost_cents || 0)), 0);
  const totalItemsEl = $('inventoryTotalItems');
  const lowStockEl = $('inventoryLowStock');
  const totalValueEl = $('inventoryTotalValue');
  if (totalItemsEl) totalItemsEl.textContent = totalItems;
  if (lowStockEl) lowStockEl.textContent = lowStock || 'â€”';
  if (totalValueEl) totalValueEl.textContent = formatUsd(totalValue);

  const items = filter
    ? INVENTORY_CACHE.filter(i => (i.name || '').toLowerCase().includes(filter.toLowerCase()) || (i.category || '').toLowerCase().includes(filter.toLowerCase()))
    : INVENTORY_CACHE;

  if (!items.length) {
    listEl.innerHTML = `<div class="muted" style="font-size:.85rem;">${filter ? 'No items match your search.' : 'No inventory items yet. Add parts, materials, or supplies.'}</div>${filter ? '' : '<div style="margin-top:10px;"><button class="btn btn-primary btn-sm" onclick="openAddInventoryModal()">+ Add first item</button></div>'}`;
    return;
  }

  listEl.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
    <thead><tr style="color:rgba(255,255,255,.35);border-bottom:1px solid rgba(255,255,255,.08);">
      <th style="text-align:left;padding:6px 8px;">Item</th>
      <th style="text-align:left;padding:6px 8px;">Category</th>
      <th style="text-align:right;padding:6px 8px;">On hand</th>
      <th style="text-align:right;padding:6px 8px;">Cost</th>
      <th style="text-align:right;padding:6px 8px;">Price</th>
      <th style="padding:6px 8px;"></th>
    </tr></thead>
    <tbody>${items.map(i => {
      const isLow = i.reorder_point > 0 && Number(i.quantity_on_hand) <= Number(i.reorder_point);
      return `<tr style="border-bottom:1px solid rgba(255,255,255,.05);">
        <td style="padding:7px 8px;font-weight:500;color:#e8e9eb;">${escapeHtml(i.name)}${isLow ? ' <span style="color:#fbbf24;font-size:.72rem;">âš  Low</span>' : ''}</td>
        <td style="padding:7px 8px;color:rgba(255,255,255,.45);">${escapeHtml(i.category || 'â€”')}</td>
        <td style="text-align:right;padding:7px 8px;">${Number(i.quantity_on_hand)} ${escapeHtml(i.unit || '')}</td>
        <td style="text-align:right;padding:7px 8px;color:rgba(255,255,255,.45);">${formatUsd(i.cost_cents)}</td>
        <td style="text-align:right;padding:7px 8px;">${formatUsd(i.price_cents)}</td>
        <td style="padding:7px 8px;text-align:right;white-space:nowrap;">
          <button class="btn btn-ghost" style="font-size:.72rem;padding:3px 8px;margin-right:4px;" onclick="openLogUsageModal('${escapeAttr(i.id)}','${escapeAttr(i.name)}')">Log use</button>
          <button class="btn btn-ghost" style="font-size:.72rem;padding:3px 8px;" onclick="openEditInventoryModal('${escapeAttr(i.id)}')">Edit</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

function openAddInventoryModal() {
  const existing = document.getElementById('addInventoryModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'addInventoryModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:480px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Add inventory item</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="invName" class="input" placeholder="Item name *" style="width:100%;" />
        <div style="display:flex;gap:8px;">
          <input id="invSku" class="input" placeholder="SKU / part #" style="flex:1;" />
          <input id="invCategory" class="input" placeholder="Category" style="flex:1;" />
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Unit</label>
            <select id="invUnit" class="input" style="width:100%;">
              <option value="each">Each</option>
              <option value="lb">lb</option>
              <option value="ft">ft</option>
              <option value="sq ft">sq ft</option>
              <option value="gal">gallon</option>
              <option value="box">box</option>
              <option value="hr">hr</option>
            </select>
          </div>
          <div style="flex:1;">
            <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Qty on hand</label>
            <input id="invQty" type="number" min="0" step="0.01" class="input" value="0" style="width:100%;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Reorder at</label>
            <input id="invReorder" type="number" min="0" step="0.01" class="input" value="0" style="width:100%;" />
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Your cost ($)</label>
            <input id="invCost" type="number" min="0" step="0.01" class="input" placeholder="0.00" style="width:100%;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Charge price ($)</label>
            <input id="invPrice" type="number" min="0" step="0.01" class="input" placeholder="0.00" style="width:100%;" />
          </div>
        </div>
        <textarea id="invDesc" class="input" rows="2" placeholder="Description (optional)" style="width:100%;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('addInventoryModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="invSaveBtn" class="btn btn-primary">Save item</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('invSaveBtn').onclick = async () => {
    const name = ($('invName')?.value || '').trim();
    if (!name) { notifyOperator("Add an item name first."); return; }
    const btn = $('invSaveBtn');
    btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          name,
          sku             : ($('invSku')?.value || '').trim() || undefined,
          category        : ($('invCategory')?.value || '').trim() || undefined,
          unit            : $('invUnit')?.value || 'each',
          quantity_on_hand: parseFloat($('invQty')?.value || 0),
          reorder_point   : parseFloat($('invReorder')?.value || 0),
          cost_cents      : Math.round(parseFloat($('invCost')?.value || 0) * 100),
          price_cents     : Math.round(parseFloat($('invPrice')?.value || 0) * 100),
          description     : ($('invDesc')?.value || '').trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Item saved.');
      modal.remove();
      await fetchInventory();
      renderInventory($('inventorySearch')?.value || '');
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Save item';
    }
  };
}

function openLogUsageModal(itemId, itemName) {
  const existing = document.getElementById('logUsageModal');
  if (existing) existing.remove();
  const orderOptions = (CRM_ORDERS_CACHE || []).filter(o => !['paid','cancelled'].includes(String(o.status||'').toLowerCase()))
    .slice(0, 30)
    .map(o => `<option value="${escapeAttr(o.id)}">${escapeHtml(o.customer_name || o.title || o.id)}</option>`).join('');
  const modal = document.createElement('div');
  modal.id = 'logUsageModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px 28px;max-width:400px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 16px;font-size:1rem;color:#e8e9eb;">Log usage â€” ${escapeHtml(itemName)}</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Qty used</label>
            <input id="usageQty" type="number" min="0.01" step="0.01" value="1" class="input" style="width:100%;" />
          </div>
        </div>
        <div>
          <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Link to order (optional)</label>
          <select id="usageOrder" class="input" style="width:100%;">
            <option value="">No order</option>
            ${orderOptions}
          </select>
        </div>
        <input id="usageNotes" class="input" placeholder="Notes (optional)" style="width:100%;" />
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('logUsageModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="logUsageSave" class="btn btn-primary">Log usage</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('logUsageSave').onclick = async () => {
    const qty = parseFloat($('usageQty')?.value || 1);
    const btn = $('logUsageSave');
    btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          action           : 'log_usage',
          inventory_item_id: itemId,
          quantity_used    : qty,
          order_id         : $('usageOrder')?.value || undefined,
          notes            : ($('usageNotes')?.value || '').trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast(`Usage logged: ${qty} ${itemName}`);
      modal.remove();
      await fetchInventory();
      renderInventory($('inventorySearch')?.value || '');
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Log usage';
    }
  };
}

function openEditInventoryModal(itemId) {
  const item = INVENTORY_CACHE.find(i => i.id === itemId);
  if (!item) return;
  const existing = document.getElementById('editInventoryModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'editInventoryModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px 28px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 16px;font-size:1rem;color:#e8e9eb;">Edit â€” ${escapeHtml(item.name)}</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Qty on hand</label>
            <input id="eiQty" type="number" step="0.01" class="input" value="${Number(item.quantity_on_hand)}" style="width:100%;" /></div>
          <div style="flex:1;"><label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Cost ($)</label>
            <input id="eiCost" type="number" step="0.01" class="input" value="${(item.cost_cents/100).toFixed(2)}" style="width:100%;" /></div>
          <div style="flex:1;"><label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Price ($)</label>
            <input id="eiPrice" type="number" step="0.01" class="input" value="${(item.price_cents/100).toFixed(2)}" style="width:100%;" /></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('editInventoryModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="eiSave" class="btn btn-primary">Save changes</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('eiSave').onclick = async () => {
    const btn = $('eiSave');
    btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          id              : itemId,
          quantity_on_hand: parseFloat($('eiQty')?.value || 0),
          cost_cents      : Math.round(parseFloat($('eiCost')?.value || 0) * 100),
          price_cents     : Math.round(parseFloat($('eiPrice')?.value || 0) * 100),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Item updated.');
      modal.remove();
      await fetchInventory();
      renderInventory($('inventorySearch')?.value || '');
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Save changes';
    }
  };
}

async function fetchVendors() {
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/manage-vendors", {
      headers: { "Authorization": `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (d.vendors) VENDORS_CACHE = d.vendors;
  } catch (e) { /* silent */ }
  return VENDORS_CACHE;
}

function renderVendors() {
  const el = $("vendorsList");
  if (!el) return;
  if (!VENDORS_CACHE.length) {
    el.innerHTML = `<div class="muted" style="font-size:.85rem;">No vendors yet. Add your first subcontractor or supplier.</div><div style="margin-top:10px;"><button class="btn btn-primary btn-sm" onclick="openAddVendorModal()">+ Add your first vendor</button></div>`;
    return;
  }
  el.innerHTML = VENDORS_CACHE.map((v) => `
    <div class="li" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div style="flex:1;">
        <div style="font-weight:600;color:#e8e9eb;">${escapeHtml(v.name)}</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.4);">${escapeHtml(v.company || "")}${v.company && v.trade ? " Â· " : ""}${escapeHtml(v.trade || "")}</div>
        <div style="font-size:.78rem;color:rgba(255,255,255,.35);">${escapeHtml(v.email || "")}${v.email && v.phone ? " Â· " : ""}${escapeHtml(v.phone || "")}</div>
      </div>
      <button class="btn btn-ghost btn-sm" style="font-size:.75rem;" onclick="openEditVendorModal(VENDORS_CACHE.find(x=>x.id==='${escapeAttr(v.id)}'))">Edit</button>
      <button class="btn btn-ghost" style="font-size:.75rem;" onclick="deleteVendor('${escapeAttr(v.id)}')">Remove</button>
    </div>`).join("");
}

async function deleteVendor(id) {
  if (!(await showConfirmModal("Remove this vendor?", "Remove", "Cancel"))) return;
  const tok = await getAccessToken();
  await fetch(`/.netlify/functions/manage-vendors?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${tok}` },
  });
  await fetchVendors();
  renderVendors();
}

function openEditVendorModal(vendor) {
  if (!vendor) return;
  const existing = document.getElementById('editVendorModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'editVendorModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:460px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Edit vendor</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="evName" class="input" placeholder="Name *" style="width:100%;" value="${escapeAttr(vendor.name || '')}" />
        <input id="evCompany" class="input" placeholder="Company" style="width:100%;" value="${escapeAttr(vendor.company || '')}" />
        <input id="evEmail" class="input" placeholder="Email" style="width:100%;" value="${escapeAttr(vendor.email || '')}" />
        <input id="evPhone" class="input" placeholder="Phone" style="width:100%;" value="${escapeAttr(vendor.phone || '')}" />
        <input id="evTrade" class="input" placeholder="Trade / specialty" style="width:100%;" value="${escapeAttr(vendor.trade || '')}" />
        <textarea id="evNotes" class="input" rows="2" placeholder="Notes" style="width:100%;resize:vertical;">${escapeHtml(vendor.notes || '')}</textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('editVendorModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="evSave" class="btn btn-primary">Save changes</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('evSave').onclick = async () => {
    const name = (document.getElementById('evName')?.value || '').trim();
    if (!name) { notifyOperator("Add a name first."); return; }
    const btn = document.getElementById('evSave'); btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-vendors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          id: vendor.id,
          name,
          company: document.getElementById('evCompany')?.value || undefined,
          email: document.getElementById('evEmail')?.value || undefined,
          phone: document.getElementById('evPhone')?.value || undefined,
          trade: document.getElementById('evTrade')?.value || undefined,
          notes: document.getElementById('evNotes')?.value || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Vendor updated.');
      modal.remove();
      await fetchVendors();
      renderVendors();
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Save changes';
    }
  };
}

// â”€â”€ Equipment management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchEquipment() {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const res = await fetch('/.netlify/functions/manage-equipment', { headers: { Authorization: 'Bearer ' + token } });
  const d = await res.json();
  EQUIPMENT_CACHE = d.equipment || [];
  renderEquipment();
}

function renderEquipment() {
  const el = document.getElementById('equipmentList');
  if (!el) return;
  if (!EQUIPMENT_CACHE.length) {
    el.innerHTML = '<div class="muted" style="font-size:.85rem;padding:16px 0;">No equipment yet. <button class="btn btn-ghost btn-sm" onclick="openAddEquipmentModal()">+ Add first truck</button></div>';
    return;
  }
  const statusColor = { active: '#4caf82', maintenance: '#e5a027', retired: 'rgba(255,255,255,.3)' };
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.85rem;">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Unit</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Type</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Rate</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Status</th>
      <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);"></th>
    </tr></thead>
    <tbody>
      ${EQUIPMENT_CACHE.map(e => `<tr>
        <td style="padding:8px;color:#e8e9eb;">${escapeHtml(e.unit_number ? `${e.unit_number} â€” ${e.name}` : e.name)}<br><span style="font-size:.75rem;color:rgba(255,255,255,.35);">${escapeHtml([e.year, e.make, e.model].filter(Boolean).join(' '))}</span></td>
        <td style="padding:8px;color:rgba(255,255,255,.55);">${escapeHtml(e.equipment_type || 'â€”')}</td>
        <td style="padding:8px;color:rgba(255,255,255,.55);">${e.hourly_rate_cents ? '$' + (e.hourly_rate_cents/100).toFixed(0) + '/hr' : 'â€”'}</td>
        <td style="padding:8px;"><span style="font-size:.75rem;font-weight:600;color:${statusColor[e.status] || '#fff'};">${e.status || 'active'}</span></td>
        <td style="padding:8px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">
          <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openEditEquipmentModal('${escapeAttr(e.id)}')">Edit</button>
          <button class="btn btn-ghost" style="font-size:.72rem;" onclick="deleteEquipment('${escapeAttr(e.id)}')">Remove</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function openAddEquipmentModal() {
  const existing = document.getElementById('addEquipmentModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'addEquipmentModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:400px;">
    <h3 style="margin:0 0 16px;font-size:1rem;">Add equipment</h3>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Name *</label>
    <input id="eqName" class="input" style="margin-bottom:10px;width:100%;" placeholder="Truck 1 / Vactor 2112">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Unit #</label>
        <input id="eqUnit" class="input" style="width:100%;" placeholder="T-01"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Type</label>
        <select id="eqType" class="input" style="width:100%;">
          <option value="hydrovac">Hydrovac</option>
          <option value="vactor">Vactor</option>
          <option value="jetter">Jetter</option>
          <option value="combo">Combo</option>
          <option value="vacuum_truck">Vacuum truck</option>
          <option value="other">Other</option>
        </select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Year</label>
        <input id="eqYear" class="input" style="width:100%;" type="number" placeholder="2024"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Make</label>
        <input id="eqMake" class="input" style="width:100%;" placeholder="Vactor"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Model</label>
        <input id="eqModel" class="input" style="width:100%;" placeholder="2112"></div>
    </div>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Hourly rate ($/hr)</label>
    <input id="eqRate" class="input" style="margin-bottom:10px;width:100%;" type="number" min="0" placeholder="0">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Notes</label>
    <textarea id="eqNotes" class="input" style="margin-bottom:16px;width:100%;height:60px;"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost" onclick="document.getElementById('addEquipmentModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" id="eqSaveBtn">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#eqSaveBtn').onclick = async () => {
    const name = document.getElementById('eqName')?.value?.trim();
    if (!name) { showToast('Name is required'); return; }
    const token = (await sb.auth.getSession()).data.session?.access_token;
    try {
      const res = await fetch('/.netlify/functions/manage-equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          name,
          unit_number: document.getElementById('eqUnit')?.value || null,
          equipment_type: document.getElementById('eqType')?.value || 'hydrovac',
          year: parseInt(document.getElementById('eqYear')?.value) || null,
          make: document.getElementById('eqMake')?.value || null,
          model: document.getElementById('eqModel')?.value || null,
          hourly_rate_cents: Math.round((parseFloat(document.getElementById('eqRate')?.value) || 0) * 100),
          notes: document.getElementById('eqNotes')?.value || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      modal.remove();
      await fetchEquipment();
      showToast('Equipment added.');
    } catch (err) { showToast('Error: ' + err.message); }
  };
}

function openEditEquipmentModal(id) {
  const eq = EQUIPMENT_CACHE.find(e => e.id === id);
  if (!eq) return;
  const existing = document.getElementById('editEquipmentModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'editEquipmentModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:400px;">
    <h3 style="margin:0 0 16px;font-size:1rem;">Edit equipment</h3>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Name</label>
    <input id="eqEditName" class="input" style="margin-bottom:10px;width:100%;" value="${escapeAttr(eq.name)}">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Unit #</label>
        <input id="eqEditUnit" class="input" style="width:100%;" value="${escapeAttr(eq.unit_number||'')}"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Status</label>
        <select id="eqEditStatus" class="input" style="width:100%;">
          ${['active','maintenance','retired'].map(s => `<option value="${s}"${s===eq.status?' selected':''}>${s}</option>`).join('')}
        </select></div>
    </div>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Hourly rate ($/hr)</label>
    <input id="eqEditRate" class="input" style="margin-bottom:10px;width:100%;" type="number" min="0" value="${eq.hourly_rate_cents ? (eq.hourly_rate_cents/100).toFixed(0) : ''}">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Notes</label>
    <textarea id="eqEditNotes" class="input" style="margin-bottom:16px;width:100%;height:60px;">${escapeHtml(eq.notes||'')}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost" onclick="document.getElementById('editEquipmentModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" id="eqEditSaveBtn">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#eqEditSaveBtn').onclick = async () => {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    try {
      const res = await fetch('/.netlify/functions/manage-equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          id,
          name: document.getElementById('eqEditName')?.value?.trim(),
          unit_number: document.getElementById('eqEditUnit')?.value || null,
          status: document.getElementById('eqEditStatus')?.value || 'active',
          hourly_rate_cents: Math.round((parseFloat(document.getElementById('eqEditRate')?.value) || 0) * 100),
          notes: document.getElementById('eqEditNotes')?.value || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      modal.remove();
      await fetchEquipment();
      showToast('Equipment updated.');
    } catch (err) { showToast('Error: ' + err.message); }
  };
}

async function deleteEquipment(id) {
  if (!(await showConfirmModal('Remove this equipment?', 'Remove', 'Cancel'))) return;
  const token = (await sb.auth.getSession()).data.session?.access_token;
  try {
    const res = await fetch(`/.netlify/functions/manage-equipment?id=${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    EQUIPMENT_CACHE = EQUIPMENT_CACHE.filter(e => e.id !== id);
    renderEquipment();
    showToast('Equipment removed.');
  } catch (err) { showToast('Error: ' + err.message); }
}

function parseHydrovacCityState(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { city: null, state_province: null };
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], state_province: parts[1] };
  return { city: raw, state_province: null };
}
function hydrovacCityStateLabel(row) {
  return [row?.city, row?.state_province].filter(Boolean).join(", ");
}
function hydrovacDateTimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function hydrovacWarningTone(severity = "") {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "expired") return "pill-bad";
  if (normalized === "critical") return "pill-warn";
  if (normalized === "warning") return "pill";
  return "pill";
}
function currentHydrovacFacility() {
  return HYDROVAC_FACILITIES_CACHE.find((row) => row.id === ACTIVE_FACILITY_ID) || null;
}
function currentHydrovacManifest() {
  return HYDROVAC_MANIFESTS_CACHE.find((row) => row.id === ACTIVE_MANIFEST_ID) || null;
}
function currentHydrovacLocate() {
  return HYDROVAC_LOCATE_TICKETS_CACHE.find((row) => row.id === ACTIVE_LOCATE_ID) || null;
}
function currentDriverQualification() {
  return HYDROVAC_DRIVER_COMPLIANCE_CACHE.find((row) => row.member_id === ACTIVE_DRIVER_QUAL_MEMBER_ID) || null;
}
function currentHydrovacPermit() {
  return HYDROVAC_PERMITS_CACHE.find((row) => row.id === ACTIVE_PERMIT_ID) || null;
}
function currentHydrovacAsset() {
  return HYDROVAC_ASSETS_CACHE.find((row) => row.id === ACTIVE_ASSET_ID) || null;
}
function hydrovacSeverityRank(severity = "") {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "expired") return 3;
  if (normalized === "critical") return 2;
  if (normalized === "warning") return 1;
  return 0;
}
function teamMemberLabel(member) {
  return member?.display_name || member?.name || member?.email || member?.id || "Crew member";
}
function driverStatusTone(warnings = []) {
  const highest = (warnings || []).reduce((max, warning) => Math.max(max, hydrovacSeverityRank(warning?.severity)), 0);
  if (highest >= 3) return "pill-bad";
  if (highest >= 2) return "pill-warn";
  if (highest >= 1) return "pill";
  return "pill-on";
}
function hydrovacJobSortDate(job) {
  return String(job?.scheduled_date || job?.created_at || "").trim();
}
function clearHydrovacFacilityForm() {
  ACTIVE_FACILITY_ID = null;
  if (hydrovacFacilityFormTitle) hydrovacFacilityFormTitle.textContent = "New facility";
  if (hydrovacFacilityId) hydrovacFacilityId.value = "";
  if (hydrovacFacilityName) hydrovacFacilityName.value = "";
  if (hydrovacFacilityStatus) hydrovacFacilityStatus.value = "active";
  if (hydrovacFacilityType) hydrovacFacilityType.value = "transfer_station";
  if (hydrovacFacilityPermitExpiry) hydrovacFacilityPermitExpiry.value = "";
  if (hydrovacFacilityAddress) hydrovacFacilityAddress.value = "";
  if (hydrovacFacilityCityState) hydrovacFacilityCityState.value = "";
  if (hydrovacFacilityRateGallon) hydrovacFacilityRateGallon.value = "";
  if (hydrovacFacilityRateYard) hydrovacFacilityRateYard.value = "";
  if (hydrovacFacilityMinimumCharge) hydrovacFacilityMinimumCharge.value = "";
  if (hydrovacFacilityContact) hydrovacFacilityContact.value = "";
  if (hydrovacFacilityDispatchPhone) hydrovacFacilityDispatchPhone.value = "";
  if (hydrovacFacilityWasteTypes) hydrovacFacilityWasteTypes.value = "";
  if (hydrovacFacilityNotes) hydrovacFacilityNotes.value = "";
  if (btnClearFacility) btnClearFacility.textContent = "Clear form";
  setInlineMessage(hydrovacFacilityMsg, "");
}
function populateHydrovacFacilityForm(row) {
  if (!row) return clearHydrovacFacilityForm();
  ACTIVE_FACILITY_ID = row.id || null;
  if (hydrovacFacilityFormTitle) hydrovacFacilityFormTitle.textContent = "Edit facility";
  if (hydrovacFacilityId) hydrovacFacilityId.value = row.id || "";
  if (hydrovacFacilityName) hydrovacFacilityName.value = row.name || "";
  if (hydrovacFacilityStatus) hydrovacFacilityStatus.value = row.status || "active";
  if (hydrovacFacilityType) hydrovacFacilityType.value = row.facility_type || "transfer_station";
  if (hydrovacFacilityPermitExpiry) hydrovacFacilityPermitExpiry.value = row.permit_expiry_date || "";
  if (hydrovacFacilityAddress) hydrovacFacilityAddress.value = row.address || "";
  if (hydrovacFacilityCityState) hydrovacFacilityCityState.value = hydrovacCityStateLabel(row);
  if (hydrovacFacilityRateGallon) hydrovacFacilityRateGallon.value = row.price_per_gallon_cents ? (Number(row.price_per_gallon_cents) / 100).toFixed(2) : "";
  if (hydrovacFacilityRateYard) hydrovacFacilityRateYard.value = row.price_per_cubic_yard_cents ? (Number(row.price_per_cubic_yard_cents) / 100).toFixed(2) : "";
  if (hydrovacFacilityMinimumCharge) hydrovacFacilityMinimumCharge.value = row.minimum_charge_cents ? (Number(row.minimum_charge_cents) / 100).toFixed(2) : "";
  if (hydrovacFacilityContact) hydrovacFacilityContact.value = [row.primary_contact_name, row.primary_contact_phone || row.primary_contact_email].filter(Boolean).join(" | ");
  if (hydrovacFacilityDispatchPhone) hydrovacFacilityDispatchPhone.value = row.dispatch_phone || "";
  if (hydrovacFacilityWasteTypes) hydrovacFacilityWasteTypes.value = Array.isArray(row.accepted_waste_types) ? row.accepted_waste_types.join(", ") : "";
  if (hydrovacFacilityNotes) hydrovacFacilityNotes.value = row.notes || "";
  if (btnClearFacility) btnClearFacility.textContent = "New facility";
  setInlineMessage(hydrovacFacilityMsg, "");
}
function renderHydrovacLocateJobOptions(selectedId = "") {
  if (!hydrovacLocateJobId) return;
  hydrovacLocateJobId.innerHTML = `<option value="">Optional</option>${(JOBS_CACHE || []).map((job) => `
    <option value="${escapeAttr(job.id)}"${job.id === selectedId ? " selected" : ""}>${escapeHtml(job.title || job.service_address || "Untitled job")}</option>
  `).join("")}`;
}
function clearHydrovacLocateForm() {
  ACTIVE_LOCATE_ID = null;
  if (hydrovacLocateId) hydrovacLocateId.value = "";
  renderHydrovacLocateJobOptions("");
  if (hydrovacLocateType) hydrovacLocateType.value = "standard";
  if (hydrovacLocateNumber) hydrovacLocateNumber.value = "";
  if (hydrovacLocateStatus) hydrovacLocateStatus.value = "requested";
  if (hydrovacLocateCenter) hydrovacLocateCenter.value = "";
  if (hydrovacLocateState) hydrovacLocateState.value = "";
  if (hydrovacLocateAddress) hydrovacLocateAddress.value = "";
  if (hydrovacLocateValidFrom) hydrovacLocateValidFrom.value = "";
  if (hydrovacLocateValidUntil) hydrovacLocateValidUntil.value = "";
  if (hydrovacLocateNotes) hydrovacLocateNotes.value = "";
  setInlineMessage(hydrovacLocateMsg, "");
}
function populateHydrovacLocateForm(row) {
  if (!row) return clearHydrovacLocateForm();
  ACTIVE_LOCATE_ID = row.id || null;
  if (hydrovacLocateId) hydrovacLocateId.value = row.id || "";
  renderHydrovacLocateJobOptions(row.job_id || "");
  if (hydrovacLocateType) hydrovacLocateType.value = row.ticket_type || "standard";
  if (hydrovacLocateNumber) hydrovacLocateNumber.value = row.ticket_number || "";
  if (hydrovacLocateStatus) hydrovacLocateStatus.value = row.status || "requested";
  if (hydrovacLocateCenter) hydrovacLocateCenter.value = row.one_call_center || "";
  if (hydrovacLocateState) hydrovacLocateState.value = row.state_province || "";
  if (hydrovacLocateAddress) hydrovacLocateAddress.value = row.work_site_address || "";
  if (hydrovacLocateValidFrom) hydrovacLocateValidFrom.value = hydrovacDateTimeInputValue(row.valid_from);
  if (hydrovacLocateValidUntil) hydrovacLocateValidUntil.value = hydrovacDateTimeInputValue(row.valid_until);
  if (hydrovacLocateNotes) hydrovacLocateNotes.value = row.locate_notes || "";
  setInlineMessage(hydrovacLocateMsg, "");
}
async function fetchHydrovacFacilities() {
  const data = await requestOperatorFunction("manage-disposal-facilities");
  HYDROVAC_FACILITIES_CACHE = Array.isArray(data?.facilities) ? data.facilities : [];
  if (!ACTIVE_FACILITY_ID && HYDROVAC_FACILITIES_CACHE[0]) ACTIVE_FACILITY_ID = HYDROVAC_FACILITIES_CACHE[0].id;
  renderHydrovacFacilities();
  return HYDROVAC_FACILITIES_CACHE;
}
async function fetchHydrovacManifests() {
  const data = await requestOperatorFunction("manage-waste-manifests", { query: "action=all&limit=100" });
  HYDROVAC_MANIFESTS_CACHE = Array.isArray(data?.manifests) ? data.manifests : [];
  if (!ACTIVE_MANIFEST_ID && HYDROVAC_MANIFESTS_CACHE[0]) ACTIVE_MANIFEST_ID = HYDROVAC_MANIFESTS_CACHE[0].id;
  renderHydrovacManifests();
  return HYDROVAC_MANIFESTS_CACHE;
}
async function fetchHydrovacLocateTickets() {
  const data = await requestOperatorFunction("manage-locate-tickets", { query: "limit=100" });
  HYDROVAC_LOCATE_TICKETS_CACHE = Array.isArray(data?.tickets) ? data.tickets : [];
  if (!ACTIVE_LOCATE_ID && HYDROVAC_LOCATE_TICKETS_CACHE[0]) ACTIVE_LOCATE_ID = HYDROVAC_LOCATE_TICKETS_CACHE[0].id;
  renderHydrovacLocateWorkspace();
  return HYDROVAC_LOCATE_TICKETS_CACHE;
}
async function fetchHydrovacComplianceData() {
  const [equipmentData, driverData, locateData, manifestData, analyticsData, facilitiesData, locateBoardData, permitData, assetData] = await Promise.all([
    requestOperatorFunction("manage-equipment", { query: "action=compliance_summary" }),
    requestOperatorFunction("manage-driver-qualifications", { query: "action=compliance_summary" }),
    requestOperatorFunction("manage-locate-tickets", { query: "status=active&days_until_expiry=30&limit=100" }),
    requestOperatorFunction("manage-waste-manifests", { query: "action=unbilled&days=90" }),
    requestOperatorFunction("get-hydrovac-analytics", { query: "days=90" }),
    requestOperatorFunction("manage-disposal-facilities"),
    requestOperatorFunction("manage-locate-tickets", { query: "limit=100" }),
    requestOperatorFunction("manage-confined-space-permits", { query: "limit=100" }),
    requestOperatorFunction("manage-infrastructure-assets"),
  ]);
  HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE = Array.isArray(equipmentData?.equipment) ? equipmentData.equipment : [];
  HYDROVAC_DRIVER_COMPLIANCE_CACHE = Array.isArray(driverData?.drivers) ? driverData.drivers : [];
  HYDROVAC_ANALYTICS_CACHE = analyticsData?.analytics || null;
  HYDROVAC_FACILITIES_CACHE = Array.isArray(facilitiesData?.facilities) ? facilitiesData.facilities : HYDROVAC_FACILITIES_CACHE;
  HYDROVAC_LOCATE_TICKETS_CACHE = Array.isArray(locateBoardData?.tickets) ? locateBoardData.tickets : HYDROVAC_LOCATE_TICKETS_CACHE;
  HYDROVAC_PERMITS_CACHE = Array.isArray(permitData?.permits) ? permitData.permits : HYDROVAC_PERMITS_CACHE;
  HYDROVAC_ASSETS_CACHE = Array.isArray(assetData?.assets) ? assetData.assets : HYDROVAC_ASSETS_CACHE;
  renderHydrovacCompliance(
    Array.isArray(locateData?.tickets) ? locateData.tickets : [],
    Array.isArray(manifestData?.manifests) ? manifestData.manifests : [],
  );
}
async function fetchHydrovacDriverQualifications() {
  const driverData = await requestOperatorFunction("manage-driver-qualifications", { query: "action=compliance_summary" });
  HYDROVAC_DRIVER_COMPLIANCE_CACHE = Array.isArray(driverData?.drivers) ? driverData.drivers : [];
  renderHydrovacDriverWorkspace();
  return HYDROVAC_DRIVER_COMPLIANCE_CACHE;
}
async function fetchHydrovacPermits() {
  const permitData = await requestOperatorFunction("manage-confined-space-permits", { query: "limit=100" });
  HYDROVAC_PERMITS_CACHE = Array.isArray(permitData?.permits) ? permitData.permits : [];
  if (!ACTIVE_PERMIT_ID && HYDROVAC_PERMITS_CACHE[0]) ACTIVE_PERMIT_ID = HYDROVAC_PERMITS_CACHE[0].id;
  renderHydrovacPermitsWorkspace();
  return HYDROVAC_PERMITS_CACHE;
}
async function fetchHydrovacAssets() {
  const assetData = await requestOperatorFunction("manage-infrastructure-assets");
  HYDROVAC_ASSETS_CACHE = Array.isArray(assetData?.assets) ? assetData.assets : [];
  if (!ACTIVE_ASSET_ID && HYDROVAC_ASSETS_CACHE[0]) ACTIVE_ASSET_ID = HYDROVAC_ASSETS_CACHE[0].id;
  renderHydrovacAssetsWorkspace();
  return HYDROVAC_ASSETS_CACHE;
}
function renderHydrovacDriverWorkspace() {
  if (!driverQualificationsList || !driverQualificationDetail) return;
  const members = Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [];
  const driverRows = members.map((member) => {
    const qualification = HYDROVAC_DRIVER_COMPLIANCE_CACHE.find((row) => row.member_id === member.id) || null;
    return { member, qualification, warnings: qualification?.warnings || [] };
  });
  const critical = driverRows.filter((row) => row.warnings.some((warning) => ["critical", "expired"].includes(String(warning.severity || "").toLowerCase()))).length;
  const missing = driverRows.filter((row) => !row.qualification).length;
  const ready = driverRows.filter((row) => row.qualification && !(row.warnings || []).length).length;
  if (driverStageStrip) {
    driverStageStrip.innerHTML = [
      { eyebrow: "Roster", value: driverRows.length, title: "Crew records", copy: "Team members the office can dispatch or track against work." },
      { eyebrow: "Ready", value: ready, title: "Driver-ready", copy: "People with qualification records and no current expiry pressure." },
      { eyebrow: "Watch", value: critical, title: "Compliance pressure", copy: "Drivers with expiring or expired documents." },
      { eyebrow: "Missing", value: missing, title: "Needs setup", copy: "Crew records still missing a qualification profile." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (driverActionBar) {
    driverActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-driver-action="invite">Invite member</button>
      <button type="button" class="pipeline-action-chip" data-driver-action="calendar">Open calendar</button>
      <button type="button" class="pipeline-action-chip" data-driver-action="compliance">Open compliance</button>
      <button type="button" class="pipeline-action-chip" data-driver-action="jobs">Open jobs</button>
    `;
    driverActionBar.querySelectorAll("[data-driver-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-driver-action");
        if (action === "invite") return openInviteTeamMemberModal();
        if (action === "calendar") return switchTab("bookings");
        if (action === "compliance") return switchTab("compliance");
        if (action === "jobs") return switchTab("jobs");
      });
    });
  }
  if (!driverRows.length) {
    driverQualificationsList.innerHTML = `<div class="muted">No team members yet. Invite the first crew member so you can track driver docs and dispatch readiness.</div>`;
    driverQualificationDetail.innerHTML = `<div class="muted">The driver qualification form will appear once at least one team member exists.</div>`;
    return;
  }
  if (!ACTIVE_DRIVER_QUAL_MEMBER_ID || !driverRows.some((row) => row.member.id === ACTIVE_DRIVER_QUAL_MEMBER_ID)) ACTIVE_DRIVER_QUAL_MEMBER_ID = driverRows[0].member.id;
  driverQualificationsList.innerHTML = driverRows.map((row) => `
    <button type="button" class="list-item ${row.member.id === ACTIVE_DRIVER_QUAL_MEMBER_ID ? "is-active" : ""}" data-driver-member-id="${escapeAttr(row.member.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(teamMemberLabel(row.member))}</div>
        <div class="li-sub muted">${escapeHtml(row.member.role || row.member.role_title || "Crew member")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${driverStatusTone(row.warnings)}">${row.qualification ? escapeHtml(row.warnings.length ? `${row.warnings.length} warning${row.warnings.length === 1 ? "" : "s"}` : "Ready") : "Needs setup"}</span>
      </div>
    </button>
  `).join("");
  driverQualificationsList.querySelectorAll("[data-driver-member-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_DRIVER_QUAL_MEMBER_ID = button.getAttribute("data-driver-member-id") || null;
      renderHydrovacDriverWorkspace();
    });
  });
  const activeRow = driverRows.find((row) => row.member.id === ACTIVE_DRIVER_QUAL_MEMBER_ID) || driverRows[0];
  const qualification = activeRow?.qualification || null;
  const warnings = qualification?.warnings || [];
  driverQualificationDetail.innerHTML = `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(teamMemberLabel(activeRow.member))}</strong>
        <span class="pill ${driverStatusTone(warnings)}">${qualification ? escapeHtml(warnings.length ? "Needs attention" : "Dispatch-ready") : "New record"}</span>
      </div>
      <div class="detail-grid">
        <label>CDL number
          <input id="driverCdlNumber" value="${escapeAttr(qualification?.cdl_number || "")}" placeholder="License number" />
        </label>
        <label>CDL class
          <select id="driverCdlClass">
            <option value="">Select</option>
            <option value="A"${qualification?.cdl_class === "A" ? " selected" : ""}>Class A</option>
            <option value="B"${qualification?.cdl_class === "B" ? " selected" : ""}>Class B</option>
            <option value="C"${qualification?.cdl_class === "C" ? " selected" : ""}>Class C</option>
          </select>
        </label>
        <label>CDL expiry
          <input id="driverCdlExpiry" type="date" value="${escapeAttr(qualification?.cdl_expiry_date || "")}" />
        </label>
        <label>Medical card expiry
          <input id="driverMedicalExpiry" type="date" value="${escapeAttr(qualification?.medical_certificate_expiry || "")}" />
        </label>
        <label>HOS available (minutes)
          <input id="driverHosMinutes" type="number" min="0" step="1" value="${escapeAttr(qualification?.hos_available_driving_minutes ?? "")}" />
        </label>
        <label>MVR status
          <select id="driverMvrStatus">
            <option value="">Not set</option>
            <option value="clear"${qualification?.mvr_status === "clear" ? " selected" : ""}>Clear</option>
            <option value="violations"${qualification?.mvr_status === "violations" ? " selected" : ""}>Violations</option>
            <option value="disqualified"${qualification?.mvr_status === "disqualified" ? " selected" : ""}>Disqualified</option>
          </select>
        </label>
        <label><input id="driverHazmatCertified" type="checkbox"${qualification?.hazmat_certified ? " checked" : ""} /> Hazmat certified</label>
        <label>Hazmat expiry
          <input id="driverHazmatExpiry" type="date" value="${escapeAttr(qualification?.hazmat_cert_expiry_date || "")}" />
        </label>
        <label><input id="driverConfinedCertified" type="checkbox"${qualification?.confined_space_certified ? " checked" : ""} /> Confined-space certified</label>
        <label>Confined-space expiry
          <input id="driverConfinedExpiry" type="date" value="${escapeAttr(qualification?.confined_space_cert_expiry_date || "")}" />
        </label>
        <label><input id="driverH2sCertified" type="checkbox"${qualification?.h2s_alive_certified ? " checked" : ""} /> H2S certified</label>
        <label>H2S expiry
          <input id="driverH2sExpiry" type="date" value="${escapeAttr(qualification?.h2s_cert_expiry_date || "")}" />
        </label>
      </div>
      ${warnings.length ? `<div class="detail-copy" style="margin-top:12px;">${warnings.map((warning) => `${titleCaseWords(String(warning.field || "").replace(/_/g, " "))}: ${warning.expiry_date || "No date"}`).join(" | ")}</div>` : `<div class="detail-copy" style="margin-top:12px;">No compliance warnings are showing for this driver record right now.</div>`}
      <label style="margin-top:12px;">Notes
        <textarea id="driverQualificationNotes" rows="3" placeholder="CDL notes, med card follow-up, consortium details, or dispatch notes.">${escapeHtml(qualification?.notes || "")}</textarea>
      </label>
      <div class="row" style="margin-top:12px;">
        <button id="btnSaveDriverQualification" class="btn btn-primary" type="button">${qualification ? "Save driver record" : "Create driver record"}</button>
        <button id="btnOpenDriverCalendar" class="btn btn-ghost" type="button">Open calendar</button>
        <button id="btnOpenDriverCompliance" class="btn btn-ghost" type="button">Open compliance</button>
      </div>
      <div id="driverQualificationMsg" class="msg"></div>
    </div>
  `;
  $("btnOpenDriverCalendar")?.addEventListener("click", () => switchTab("bookings"));
  $("btnOpenDriverCompliance")?.addEventListener("click", () => switchTab("compliance"));
  $("btnSaveDriverQualification")?.addEventListener("click", async () => {
    const payload = {
      member_id: activeRow.member.id,
      cdl_number: $("driverCdlNumber")?.value || null,
      cdl_class: $("driverCdlClass")?.value || null,
      cdl_expiry_date: $("driverCdlExpiry")?.value || null,
      medical_certificate_expiry: $("driverMedicalExpiry")?.value || null,
      hos_available_driving_minutes: $("driverHosMinutes")?.value || null,
      mvr_status: $("driverMvrStatus")?.value || null,
      hazmat_certified: $("driverHazmatCertified")?.checked || false,
      hazmat_cert_expiry_date: $("driverHazmatExpiry")?.value || null,
      confined_space_certified: $("driverConfinedCertified")?.checked || false,
      confined_space_cert_expiry_date: $("driverConfinedExpiry")?.value || null,
      h2s_alive_certified: $("driverH2sCertified")?.checked || false,
      h2s_cert_expiry_date: $("driverH2sExpiry")?.value || null,
      notes: $("driverQualificationNotes")?.value || null,
    };
    if (qualification?.id) payload.id = qualification.id;
    setInlineMessage($("driverQualificationMsg"), "Saving...");
    try {
      await requestOperatorFunction("manage-driver-qualifications", {
        method: qualification?.id ? "PATCH" : "POST",
        body: payload,
      });
      await fetchHydrovacDriverQualifications();
      if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
      setInlineMessage($("driverQualificationMsg"), "Driver record saved.", "ok");
    } catch (error) {
      setInlineMessage($("driverQualificationMsg"), error.message || String(error), "error");
    }
  });
}
function renderHydrovacFacilities() {
  if (!hydrovacFacilitiesList) return;
  const rows = Array.isArray(HYDROVAC_FACILITIES_CACHE) ? HYDROVAC_FACILITIES_CACHE : [];
  const expiring = rows.filter((row) => (row.warnings || []).some((warning) => ["warning", "critical", "expired"].includes(String(warning.severity || "").toLowerCase()))).length;
  const preferred = rows.filter((row) => String(row.status || "").toLowerCase() === "preferred").length;
  const missingRates = rows.filter((row) => (row.warnings || []).some((warning) => warning.field === "pricing")).length;
  if (facilityStageStrip) {
    facilityStageStrip.innerHTML = [
      { eyebrow: "Live", value: rows.filter((row) => String(row.status || "").toLowerCase() !== "inactive").length, title: "Active facilities", copy: "Dump sites the office can route work to right now." },
      { eyebrow: "Preferred", value: preferred, title: "Preferred", copy: "Sites the team should default to first." },
      { eyebrow: "Watch", value: expiring, title: "Permit pressure", copy: "Facilities with permit dates or other warnings needing attention." },
      { eyebrow: "Rates", value: missingRates, title: "Pricing missing", copy: "Facilities still missing contracted disposal pricing." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (facilityActionBar) {
    facilityActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-facility-action="new">New facility</button>
      <button type="button" class="pipeline-action-chip" data-facility-action="manifests">Open loads</button>
      <button type="button" class="pipeline-action-chip" data-facility-action="compliance">Open compliance</button>
      <button type="button" class="pipeline-action-chip" data-facility-action="equipment">Open equipment</button>
    `;
    facilityActionBar.querySelectorAll("[data-facility-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-facility-action");
        if (action === "new") return clearHydrovacFacilityForm();
        if (action === "manifests") return switchTab("manifests");
        if (action === "compliance") return switchTab("compliance");
        if (action === "equipment") return switchTab("equipment");
      });
    });
  }
  if (!rows.length) {
    hydrovacFacilitiesList.innerHTML = `<div class="muted">No disposal facilities saved yet. Add the dump sites and contracted rates the office uses most.</div>`;
    clearHydrovacFacilityForm();
    return;
  }
  if (!ACTIVE_FACILITY_ID || !rows.some((row) => row.id === ACTIVE_FACILITY_ID)) ACTIVE_FACILITY_ID = rows[0].id;
  hydrovacFacilitiesList.innerHTML = rows.map((row) => {
    const warning = Array.isArray(row.warnings) ? row.warnings[0] : null;
    return `
      <button type="button" class="list-item ${row.id === ACTIVE_FACILITY_ID ? "is-active" : ""}" data-facility-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.name || "Unnamed facility")}</div>
          <div class="li-sub muted">${escapeHtml(hydrovacCityStateLabel(row) || row.address || "Location not set")}</div>
          <div class="li-sub muted">${escapeHtml(titleCaseWords(String(row.facility_type || "transfer_station").replace(/_/g, " ")))}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${String(row.status || "").toLowerCase() === "preferred" ? "pill-on" : ""}">${escapeHtml(titleCaseWords(String(row.status || "active")))}</span>
          ${warning ? `<span class="pill ${hydrovacWarningTone(warning.severity)}">${escapeHtml(warning.field === "pricing" ? "Needs rates" : "Permit watch")}</span>` : ""}
          <span class="pill">${row.price_per_gallon_cents ? `$${(Number(row.price_per_gallon_cents) / 100).toFixed(2)}/gal` : "No gal rate"}</span>
        </div>
      </button>
    `;
  }).join("");
  hydrovacFacilitiesList.querySelectorAll("[data-facility-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_FACILITY_ID = button.getAttribute("data-facility-id") || null;
      renderHydrovacFacilities();
    });
  });
  populateHydrovacFacilityForm(currentHydrovacFacility());
}
function renderHydrovacManifests() {
  if (!hydrovacManifestsList || !hydrovacManifestDetailWrap) return;
  const rows = Array.isArray(HYDROVAC_MANIFESTS_CACHE) ? HYDROVAC_MANIFESTS_CACHE : [];
  const openLoads = rows.filter((row) => ["in_transit", "delivered"].includes(String(row.status || "").toLowerCase())).length;
  const confirmedUnbilled = rows.filter((row) => String(row.status || "").toLowerCase() === "confirmed" && row.invoiced !== true).length;
  const totalCharge = rows.filter((row) => row.invoiced !== true).reduce((sum, row) => sum + Number(row.disposal_charge_cents || 0), 0);
  const totalCost = rows.reduce((sum, row) => sum + Number(row.disposal_cost_cents || 0), 0);
  if (manifestStageStrip) {
    manifestStageStrip.innerHTML = [
      { eyebrow: "Rolling", value: openLoads, title: "Open loads", copy: "Loads still in transit or waiting to be fully confirmed." },
      { eyebrow: "Billing", value: confirmedUnbilled, title: "Confirmed / uninvoiced", copy: "Disposal charges that still need to make it onto the invoice." },
      { eyebrow: "Charge", value: formatUsd(totalCharge), title: "Unbilled charge", copy: "Customer-facing disposal still waiting to be billed." },
      { eyebrow: "Cost", value: formatUsd(totalCost), title: "Tracked disposal cost", copy: "What the dumps have cost the business so far." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (manifestActionBar) {
    manifestActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-manifest-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-manifest-action="money">Open money</button>
      <button type="button" class="pipeline-action-chip" data-manifest-action="facilities">Open facilities</button>
      <button type="button" class="pipeline-action-chip" data-manifest-action="compliance">Open compliance</button>
    `;
    manifestActionBar.querySelectorAll("[data-manifest-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-manifest-action");
        if (action === "jobs") return switchTab("jobs");
        if (action === "money") return switchTab("payments");
        if (action === "facilities") return switchTab("facilities");
        if (action === "compliance") return switchTab("compliance");
      });
    });
  }
  if (!rows.length) {
    hydrovacManifestsList.innerHTML = `<div class="muted">No loads logged yet. Once the truck starts hauling, manifests will show up here for office review.</div>`;
    hydrovacManifestDetailWrap.innerHTML = `<div class="muted">Select a load to inspect it.</div>`;
    return;
  }
  if (!ACTIVE_MANIFEST_ID || !rows.some((row) => row.id === ACTIVE_MANIFEST_ID)) ACTIVE_MANIFEST_ID = rows[0].id;
  hydrovacManifestsList.innerHTML = rows.map((row) => {
    const job = (JOBS_CACHE || []).find((candidate) => candidate.id === row.job_id) || null;
    const customer = (CUSTOMERS_CACHE || []).find((candidate) => candidate.id === row.customer_id) || null;
    return `
      <button type="button" class="list-item ${row.id === ACTIVE_MANIFEST_ID ? "is-active" : ""}" data-manifest-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.manifest_number || "Draft load")}</div>
          <div class="li-sub muted">${escapeHtml(customer?.name || job?.customer_name || "Unknown customer")}</div>
          <div class="li-sub muted">${escapeHtml(job?.title || row.pickup_address || "Job not linked")}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${hydrovacManifestToneClass(row.status)}">${escapeHtml(titleCaseWords(String(row.status || "in_transit").replace(/_/g, " ")))}</span>
          <span class="pill">${escapeHtml(hydrovacManifestQuantityLabel(row) || "Qty pending")}</span>
        </div>
      </button>
    `;
  }).join("");
  hydrovacManifestsList.querySelectorAll("[data-manifest-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_MANIFEST_ID = button.getAttribute("data-manifest-id") || null;
      renderHydrovacManifests();
    });
  });
  const active = currentHydrovacManifest();
  const linkedJob = active?.job_id ? (JOBS_CACHE || []).find((row) => row.id === active.job_id) || null : null;
  const linkedOrder = active?.order_id ? (CRM_ORDERS_CACHE || []).find((row) => row.id === active.order_id) || null : linkedOrderForJob(linkedJob);
  const linkedCustomer = active?.customer_id
    ? (CUSTOMERS_CACHE || []).find((row) => row.id === active.customer_id) || null
    : (linkedOrder?.customer_id ? (CUSTOMERS_CACHE || []).find((row) => row.id === linkedOrder.customer_id) || null : null);
  const marginCents = Number(active?.disposal_charge_cents || 0) - Number(active?.disposal_cost_cents || 0);
  hydrovacManifestDetailWrap.innerHTML = active ? `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active.manifest_number || "Draft load")}</strong>
        <span class="pill ${hydrovacManifestToneClass(active.status)}">${escapeHtml(titleCaseWords(String(active.status || "in_transit").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-grid">
        <div><span class="muted">Customer</span><div>${escapeHtml(linkedCustomer?.name || linkedOrder?.customer_name || linkedJob?.customer_name || "Not linked")}</div></div>
        <div><span class="muted">Job</span><div>${escapeHtml(linkedJob?.title || "Not linked")}</div></div>
        <div><span class="muted">Material</span><div>${escapeHtml(hydrovacMaterialLabel(active.material_type))}</div></div>
        <div><span class="muted">Quantity</span><div>${escapeHtml(hydrovacManifestQuantityLabel(active) || "Pending")}</div></div>
        <div><span class="muted">Facility</span><div>${escapeHtml(active.disposal_facility_name || "Not set")}</div></div>
        <div><span class="muted">Ticket</span><div>${escapeHtml(active.disposal_ticket_number || "Pending")}</div></div>
        <div><span class="muted">Charge</span><div>${formatUsd(Number(active.disposal_charge_cents || 0))}</div></div>
        <div><span class="muted">Cost</span><div>${formatUsd(Number(active.disposal_cost_cents || 0))}</div></div>
        <div><span class="muted">Margin</span><div>${formatUsd(marginCents)}</div></div>
        <div><span class="muted">Invoice state</span><div>${escapeHtml(active.invoiced === true ? "Already on invoice" : "Waiting for invoice")}</div></div>
        <div><span class="muted">Order balance</span><div>${formatUsd(linkedOrder ? orderAmountDueCents(linkedOrder) : 0)}</div></div>
      </div>
      <div class="detail-copy" style="margin-top:12px;">${escapeHtml(active.notes || active.pickup_address || "No additional manifest notes.")}</div>
      <div class="pipeline-action-bar" style="padding:14px 0 0;">
        ${linkedCustomer ? `<button type="button" class="pipeline-action-chip" data-manifest-open-customer="${escapeAttr(linkedCustomer.id)}">Open customer</button>` : ""}
        ${linkedJob ? `<button type="button" class="pipeline-action-chip" data-manifest-open-job="${escapeAttr(linkedJob.id)}">Open job</button>` : ""}
        ${linkedOrder ? `<button type="button" class="pipeline-action-chip" data-manifest-open-order="${escapeAttr(linkedOrder.id)}">Open pipeline record</button>` : ""}
        ${linkedJob ? `<button type="button" class="pipeline-action-chip" data-manifest-open-invoice="${escapeAttr(linkedJob.id)}">Open invoice draft</button>` : ""}
        ${["in_transit", "delivered"].includes(String(active.status || "").toLowerCase()) ? `<button type="button" class="pipeline-action-chip" data-manifest-confirm="${escapeAttr(active.id)}">Confirm load</button>` : ""}
        ${active.invoiced !== true ? `<button type="button" class="pipeline-action-chip" data-manifest-open-money="1">Open money</button>` : ""}
      </div>
    </div>
  ` : `<div class="muted">Select a load to inspect it.</div>`;
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-customer]")?.addEventListener("click", (event) => {
    ACTIVE_CUSTOMER_ID = event.currentTarget.getAttribute("data-manifest-open-customer") || null;
    switchTab("customers");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-job]")?.addEventListener("click", (event) => {
    ACTIVE_JOB_ID = event.currentTarget.getAttribute("data-manifest-open-job") || null;
    switchTab("jobs");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-order]")?.addEventListener("click", (event) => {
    ACTIVE_ORDER_ID = event.currentTarget.getAttribute("data-manifest-open-order") || null;
    switchTab("orders");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-invoice]")?.addEventListener("click", (event) => {
    ACTIVE_JOB_ID = event.currentTarget.getAttribute("data-manifest-open-invoice") || null;
    switchTab("payments");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-money]")?.addEventListener("click", () => switchTab("payments"));
  hydrovacManifestDetailWrap.querySelector("[data-manifest-confirm]")?.addEventListener("click", async (event) => {
    const id = event.currentTarget.getAttribute("data-manifest-confirm");
    if (!id) return;
    await requestOperatorFunction("manage-waste-manifests", {
      method: "PATCH",
      body: { id, status: "confirmed", disposal_confirmed_at: new Date().toISOString() },
    });
    await fetchHydrovacManifests();
    if (TABS_LOADED.has("jobs")) await fetchJobs();
  });
}
function renderHydrovacLocateWorkspace() {
  if (!hydrovacLocateList) return;
  const rows = Array.isArray(HYDROVAC_LOCATE_TICKETS_CACHE) ? HYDROVAC_LOCATE_TICKETS_CACHE : [];
  const expiringSoon = rows.filter((row) => {
    const days = daysUntil(row.valid_until);
    return days != null && days >= 0 && days <= 3;
  }).length;
  const expired = rows.filter((row) => {
    const days = daysUntil(row.valid_until);
    return days != null && days < 0;
  }).length;
  const verified = rows.filter((row) => row.verified_on_site === true).length;
  if (locateStageStrip) {
    locateStageStrip.innerHTML = [
      { eyebrow: "Live", value: rows.filter((row) => ["active", "extended"].includes(String(row.status || "").toLowerCase())).length, title: "Active coverage", copy: "Tickets currently covering excavation or potholing work." },
      { eyebrow: "Watch", value: expiringSoon, title: "Expiring soon", copy: "Coverage the office should extend before the crew gets jammed up." },
      { eyebrow: "Risk", value: expired, title: "Expired", copy: "Tickets already out of date and worth immediate attention." },
      { eyebrow: "Field", value: verified, title: "Verified on site", copy: "Tickets the crew has already confirmed in the field." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (locateActionBar) {
    locateActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-locate-action="new">New ticket</button>
      <button type="button" class="pipeline-action-chip" data-locate-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-locate-action="compliance">Open compliance</button>
      <button type="button" class="pipeline-action-chip" data-locate-action="pipeline">Open pipeline</button>
    `;
    locateActionBar.querySelectorAll("[data-locate-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-locate-action");
        if (action === "new") return clearHydrovacLocateForm();
        if (action === "jobs") return switchTab("jobs");
        if (action === "compliance") return switchTab("compliance");
        if (action === "pipeline") return switchTab("orders");
      });
    });
  }
  renderHydrovacLocateJobOptions(currentHydrovacLocate()?.job_id || "");
  if (!rows.length) {
    hydrovacLocateList.innerHTML = `<div class="muted">No locate tickets logged yet. Add 811 coverage here or from the linked job.</div>`;
    clearHydrovacLocateForm();
    return;
  }
  if (!ACTIVE_LOCATE_ID || !rows.some((row) => row.id === ACTIVE_LOCATE_ID)) ACTIVE_LOCATE_ID = rows[0].id;
  hydrovacLocateList.innerHTML = rows.map((row) => {
    const job = (JOBS_CACHE || []).find((candidate) => candidate.id === row.job_id) || null;
    return `
      <button type="button" class="list-item ${row.id === ACTIVE_LOCATE_ID ? "is-active" : ""}" data-locate-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.ticket_number || "Ticket pending")}</div>
          <div class="li-sub muted">${escapeHtml(job?.title || row.work_site_address || "Job not linked")}</div>
          <div class="li-sub muted">${escapeHtml(row.one_call_center || "One-call center not set")}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${hydrovacLocateToneClass(row)}">${escapeHtml(titleCaseWords(String(row.status || "requested").replace(/_/g, " ")))}</span>
          <span class="pill">${escapeHtml(hydrovacLocateExpiryLabel(row) || "No expiry")}</span>
        </div>
      </button>
    `;
  }).join("");
  hydrovacLocateList.querySelectorAll("[data-locate-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_LOCATE_ID = button.getAttribute("data-locate-id") || null;
      renderHydrovacLocateWorkspace();
    });
  });
  populateHydrovacLocateForm(currentHydrovacLocate());
}
function renderHydrovacCompliance(expiringTickets = [], unbilledManifests = []) {
  if (!hydrovacComplianceSummary || !hydrovacComplianceUrgent || !hydrovacComplianceCoverage) return;
  const equipmentWarnings = HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE.flatMap((row) => (row.warnings || []).map((warning) => ({ ...warning, type: "equipment", row })));
  const driverWarnings = HYDROVAC_DRIVER_COMPLIANCE_CACHE.flatMap((row) => (row.warnings || []).map((warning) => ({ ...warning, type: "driver", row })));
  const criticalCount = equipmentWarnings.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length
    + driverWarnings.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length
    + expiringTickets.filter((row) => {
      const days = daysUntil(row.valid_until);
      return days != null && days <= 3;
    }).length;
  const warningCount = equipmentWarnings.filter((row) => String(row.severity || "").toLowerCase() === "warning").length
    + driverWarnings.filter((row) => String(row.severity || "").toLowerCase() === "warning").length;
  const avgMargin = HYDROVAC_ANALYTICS_CACHE?.avg_job_margin != null
    ? `${Math.round(Number(HYDROVAC_ANALYTICS_CACHE.avg_job_margin || 0) * 100)}%`
    : "N/A";
  if (complianceStageStrip) {
    complianceStageStrip.innerHTML = [
      { eyebrow: "Critical", value: criticalCount, title: "Act now", copy: "Items that can stop dispatch, compliance, or billing if ignored." },
      { eyebrow: "Watch", value: warningCount, title: "Expiring soon", copy: "Documents and permits the office should get in front of this month." },
      { eyebrow: "Billing", value: unbilledManifests.length, title: "Uninvoiced disposal", copy: "Confirmed manifests still waiting to make it onto an invoice." },
      { eyebrow: "Margin", value: avgMargin, title: "Average job margin", copy: "Recent hydrovac margin based on tracked costs already in the system." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (complianceActionBar) {
    complianceActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-compliance-action="locates">Open locate tickets</button>
      <button type="button" class="pipeline-action-chip" data-compliance-action="manifests">Open manifests</button>
      <button type="button" class="pipeline-action-chip" data-compliance-action="equipment">Open equipment</button>
      <button type="button" class="pipeline-action-chip" data-compliance-action="jobs">Open jobs</button>
    `;
    complianceActionBar.querySelectorAll("[data-compliance-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-compliance-action");
        if (action === "locates") return switchTab("locates");
        if (action === "manifests") return switchTab("manifests");
        if (action === "equipment") return switchTab("equipment");
        if (action === "jobs") return switchTab("jobs");
      });
    });
  }
  hydrovacComplianceSummary.innerHTML = `
    <div class="card stat-card"><div class="card-hd"><strong>Critical items</strong><span class="muted">Today</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(criticalCount))}</div></div></div>
    <div class="card stat-card"><div class="card-hd"><strong>Driver warnings</strong><span class="muted">CDL / med / certs</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(driverWarnings.length))}</div></div></div>
    <div class="card stat-card"><div class="card-hd"><strong>Equipment warnings</strong><span class="muted">Inspections / docs</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(equipmentWarnings.length))}</div></div></div>
    <div class="card stat-card"><div class="card-hd"><strong>Uninvoiced disposal</strong><span class="muted">Confirmed manifests</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(unbilledManifests.length))}</div></div></div>
  `;
  const urgentItems = [];
  expiringTickets.forEach((ticket) => {
    const days = daysUntil(ticket.valid_until);
    urgentItems.push({
      label: `Locate ${ticket.ticket_number || "ticket"}${days != null ? ` (${days < 0 ? "expired" : `${days}d left`})` : ""}`,
      sub: ticket.work_site_address || "Ticket coverage",
      tone: days != null && days < 0 ? "pill-bad" : "pill-warn",
      actionTab: "locates",
    });
  });
  equipmentWarnings.forEach((warning) => {
    urgentItems.push({
      label: `${warning.row?.unit_number || warning.row?.name || "Truck"}: ${titleCaseWords(String(warning.field || "").replace(/_/g, " "))}`,
      sub: warning.row?.name || "Equipment compliance",
      tone: hydrovacWarningTone(warning.severity),
      actionTab: "equipment",
    });
  });
  driverWarnings.forEach((warning) => {
    urgentItems.push({
      label: `${warning.row?.operator_members?.display_name || "Driver"}: ${titleCaseWords(String(warning.field || "").replace(/_/g, " "))}`,
      sub: "Driver compliance",
      tone: hydrovacWarningTone(warning.severity),
      actionTab: "compliance",
    });
  });
  unbilledManifests.forEach((manifest) => {
    urgentItems.push({
      label: `Uninvoiced ${manifest.manifest_number || "manifest"} (${formatUsd(Number(manifest.disposal_charge_cents || 0))})`,
      sub: manifest.disposal_facility_name || manifest.material_type || "Disposal charge waiting for billing",
      tone: "pill-warn",
      actionTab: "manifests",
    });
  });
  hydrovacComplianceUrgent.innerHTML = urgentItems.length ? urgentItems.slice(0, 20).map((item) => `
    <button type="button" class="list-item" data-compliance-tab="${escapeAttr(item.actionTab)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(item.label)}</div>
        <div class="li-sub muted">${escapeHtml(item.sub)}</div>
      </div>
      <div class="li-meta"><span class="pill ${item.tone}">Review</span></div>
    </button>
  `).join("") : `<div class="muted">No urgent compliance issues are showing right now.</div>`;
  hydrovacComplianceUrgent.querySelectorAll("[data-compliance-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.getAttribute("data-compliance-tab") || "compliance"));
  });
  hydrovacComplianceCoverage.innerHTML = `
    <div class="list-item">
      <div class="li-main"><div class="li-title">Hydrovac jobs tracked</div><div class="li-sub muted">Recent completed jobs in analytics</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String(HYDROVAC_ANALYTICS_CACHE?.total_jobs || 0))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Tracked disposal cost</div><div class="li-sub muted">Recent period</div></div>
      <div class="li-meta"><span class="pill">${formatUsd(Number(HYDROVAC_ANALYTICS_CACHE?.total_disposal_cost_cents || 0))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Preferred facilities</div><div class="li-sub muted">Ready for dispatch</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String((HYDROVAC_FACILITIES_CACHE || []).filter((row) => String(row.status || "").toLowerCase() === "preferred").length))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Active tickets in cache</div><div class="li-sub muted">Recent office view</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String((HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => ["active", "extended"].includes(String(row.status || "").toLowerCase())).length))}</span></div>
    </div>
  `;
  renderHydrovacPermitsWorkspace();
  renderHydrovacAssetsWorkspace();
}

function renderHydrovacPermitsWorkspace() {
  if (!hydrovacPermitList || !hydrovacPermitDetail) return;
  const rows = Array.isArray(HYDROVAC_PERMITS_CACHE) ? HYDROVAC_PERMITS_CACHE : [];
  if (!ACTIVE_PERMIT_ID && rows[0]) ACTIVE_PERMIT_ID = rows[0].id;
  if (ACTIVE_PERMIT_ID && rows.length && !rows.some((row) => row.id === ACTIVE_PERMIT_ID)) ACTIVE_PERMIT_ID = rows[0].id;
  const openCount = rows.filter((row) => String(row.status || "").toLowerCase() === "open").length;
  const expiredCount = rows.filter((row) => {
    const days = daysUntil(row.permit_valid_until);
    return days != null && days < 0 && String(row.status || "").toLowerCase() === "open";
  }).length;
  const needsReading = rows.filter((row) => !Array.isArray(row.atmospheric_readings) || !row.atmospheric_readings.length).length;
  if (permitStageStrip) {
    permitStageStrip.innerHTML = [
      { eyebrow: "Open", value: openCount, title: "Active permits", copy: "Permit-required entries still open in the field." },
      { eyebrow: "Risk", value: expiredCount, title: "Expired", copy: "Open permits past their valid-until window." },
      { eyebrow: "Readings", value: needsReading, title: "Atmosphere missing", copy: "Permits that still need a full atmosphere reading logged." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (permitActionBar) {
    permitActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-permit-action="new">New permit</button>
      <button type="button" class="pipeline-action-chip" data-permit-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-permit-action="refresh">Refresh</button>
    `;
    permitActionBar.querySelectorAll("[data-permit-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-permit-action");
        if (action === "new") {
          ACTIVE_PERMIT_ID = null;
          renderHydrovacPermitsWorkspace();
          return;
        }
        if (action === "jobs") return switchTab("jobs");
        if (action === "refresh") return fetchHydrovacPermits().catch(console.error);
      });
    });
  }
  hydrovacPermitList.innerHTML = rows.length ? rows.map((row) => `
    <button type="button" class="list-item ${row.id === ACTIVE_PERMIT_ID ? "is-active" : ""}" data-permit-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.permit_number || row.space_description || "Permit")}</div>
        <div class="li-sub muted">${escapeHtml(row.space_description || "Space description missing")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${String(row.status || "").toLowerCase() === "open" ? "pill-warn" : "pill-on"}">${escapeHtml(titleCaseWords(String(row.status || "open").replace(/_/g, " ")))}</span>
      </div>
    </button>
  `).join("") : `<div class="muted">No confined-space permits logged yet.</div>`;
  hydrovacPermitList.querySelectorAll("[data-permit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_PERMIT_ID = button.getAttribute("data-permit-id") || null;
      renderHydrovacPermitsWorkspace();
    });
  });
  const active = currentHydrovacPermit();
  const reading = Array.isArray(active?.atmospheric_readings) && active.atmospheric_readings.length ? active.atmospheric_readings[active.atmospheric_readings.length - 1] : {};
  hydrovacPermitDetail.innerHTML = `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active?.permit_number || "New permit")}</strong>
        <span class="pill ${active ? hydrovacManifestToneClass(active.status) : "pill"}">${escapeHtml(titleCaseWords(String(active?.status || "draft").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-grid">
        <label>Job
          <select id="permitJobId">
            <option value="">Select job</option>
            ${(JOBS_CACHE || []).filter((job) => isHydrovacJob(job)).map((job) => `<option value="${escapeAttr(job.id)}"${job.id === active?.job_id ? " selected" : ""}>${escapeHtml(job.title || "Untitled job")}</option>`).join("")}
          </select>
        </label>
        <label>Space description
          <input id="permitSpaceDescription" value="${escapeAttr(active?.space_description || "")}" placeholder="Wet well, manhole, tank, or vault" />
        </label>
        <label>Supervisor
          <input id="permitSupervisor" value="${escapeAttr(active?.entry_supervisor_name || "")}" placeholder="Entry supervisor" />
        </label>
        <label>Attendant
          <input id="permitAttendant" value="${escapeAttr(active?.attendant_name || "")}" placeholder="Attendant" />
        </label>
        <label>Valid until
          <input id="permitValidUntil" type="datetime-local" value="${escapeAttr(hydrovacDateTimeInputValue(active?.permit_valid_until))}" />
        </label>
        <label>Status
          <select id="permitStatusSelect">
            <option value="open"${String(active?.status || "").toLowerCase() === "open" ? " selected" : ""}>Open</option>
            <option value="closed"${String(active?.status || "").toLowerCase() === "closed" ? " selected" : ""}>Closed</option>
            <option value="cancelled"${String(active?.status || "").toLowerCase() === "cancelled" ? " selected" : ""}>Cancelled</option>
          </select>
        </label>
        <label>O2 %
          <input id="permitOxygen" type="number" step="0.1" value="${escapeAttr(reading?.oxygen_pct ?? "")}" />
        </label>
        <label>LEL %
          <input id="permitLel" type="number" step="0.1" value="${escapeAttr(reading?.lel_pct ?? "")}" />
        </label>
        <label>H2S ppm
          <input id="permitH2s" type="number" step="0.1" value="${escapeAttr(reading?.h2s_ppm ?? "")}" />
        </label>
        <label>CO ppm
          <input id="permitCo" type="number" step="0.1" value="${escapeAttr(reading?.co_ppm ?? "")}" />
        </label>
      </div>
      <label style="margin-top:12px;">Known hazards
        <input id="permitHazards" value="${escapeAttr(Array.isArray(active?.known_hazards) ? active.known_hazards.join(", ") : "")}" placeholder="h2s, engulfment, electrical" />
      </label>
      <label style="margin-top:12px;">Rescue procedure
        <textarea id="permitRescueProcedure" rows="2" placeholder="How rescue is staged for this entry.">${escapeHtml(active?.rescue_procedure || "")}</textarea>
      </label>
      <div class="row" style="margin-top:12px;">
        <button id="btnSavePermit" class="btn btn-primary" type="button">${active ? "Save permit" : "Create permit"}</button>
        ${active?.job_id ? `<button id="btnOpenPermitJob" class="btn btn-ghost" type="button">Open job</button>` : ""}
      </div>
      <div id="permitMsg" class="msg"></div>
    </div>
  `;
  $("btnOpenPermitJob")?.addEventListener("click", () => {
    if (!active?.job_id) return;
    ACTIVE_JOB_ID = active.job_id;
    switchTab("jobs");
  });
  $("btnSavePermit")?.addEventListener("click", async () => {
    const oxygen = Number($("permitOxygen")?.value || "");
    const lel = Number($("permitLel")?.value || "");
    const h2s = Number($("permitH2s")?.value || "");
    const co = Number($("permitCo")?.value || "");
    const readingPayload = [oxygen, lel, h2s, co].some((value) => Number.isFinite(value)) ? [{
      tested_at: new Date().toISOString(),
      oxygen_pct: Number.isFinite(oxygen) ? oxygen : null,
      lel_pct: Number.isFinite(lel) ? lel : null,
      h2s_ppm: Number.isFinite(h2s) ? h2s : null,
      co_ppm: Number.isFinite(co) ? co : null,
      tester_name: CURRENT_OPERATOR?.name || "",
      monitor_serial: null,
    }] : (Array.isArray(active?.atmospheric_readings) ? active.atmospheric_readings : []);
    const oxygenOk = readingPayload.length ? (Number.isFinite(oxygen) ? (oxygen >= 19.5 && oxygen <= 23.5) : active?.oxygen_acceptable !== false) : true;
    const lelOk = readingPayload.length ? (Number.isFinite(lel) ? lel < 10 : active?.lel_acceptable !== false) : true;
    const h2sOk = readingPayload.length ? (Number.isFinite(h2s) ? h2s < 10 : active?.h2s_acceptable !== false) : true;
    const coOk = readingPayload.length ? (Number.isFinite(co) ? co < 35 : active?.co_acceptable !== false) : true;
    const payload = {
      job_id: $("permitJobId")?.value || null,
      space_description: $("permitSpaceDescription")?.value || "",
      entry_supervisor_name: $("permitSupervisor")?.value || null,
      attendant_name: $("permitAttendant")?.value || null,
      permit_valid_until: $("permitValidUntil")?.value ? new Date($("permitValidUntil").value).toISOString() : null,
      known_hazards: String($("permitHazards")?.value || "").split(",").map((part) => part.trim()).filter(Boolean),
      rescue_procedure: $("permitRescueProcedure")?.value || null,
      atmospheric_readings: readingPayload,
      oxygen_acceptable: oxygenOk,
      lel_acceptable: lelOk,
      h2s_acceptable: h2sOk,
      co_acceptable: coOk,
      status: $("permitStatusSelect")?.value || "open",
    };
    if (active?.id) payload.id = active.id;
    setInlineMessage($("permitMsg"), "Saving...");
    try {
      await requestOperatorFunction("manage-confined-space-permits", {
        method: active?.id ? "PATCH" : "POST",
        body: payload,
      });
      await fetchHydrovacPermits();
      if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
      setInlineMessage($("permitMsg"), "Permit saved.", "ok");
    } catch (error) {
      setInlineMessage($("permitMsg"), error.message || String(error), "error");
    }
  });
}

function renderHydrovacAssetsWorkspace() {
  if (!hydrovacAssetList || !hydrovacAssetDetail) return;
  const rows = Array.isArray(HYDROVAC_ASSETS_CACHE) ? HYDROVAC_ASSETS_CACHE : [];
  if (!ACTIVE_ASSET_ID && rows[0]) ACTIVE_ASSET_ID = rows[0].id;
  if (ACTIVE_ASSET_ID && rows.length && !rows.some((row) => row.id === ACTIVE_ASSET_ID)) ACTIVE_ASSET_ID = rows[0].id;
  const dueSoon = rows.filter((row) => {
    const days = daysUntil(row.next_service_due_date);
    return days != null && days >= 0 && days <= 14 && String(row.status || "").toLowerCase() !== "decommissioned";
  }).length;
  const withDefects = rows.filter((row) => row.has_defects === true).length;
  const activeRows = rows.filter((row) => String(row.status || "").toLowerCase() === "active").length;
  if (assetStageStrip) {
    assetStageStrip.innerHTML = [
      { eyebrow: "Live", value: activeRows, title: "Active assets", copy: "Catch basins, manholes, tanks, and structures still in service." },
      { eyebrow: "Due", value: dueSoon, title: "Needs service soon", copy: "Assets with maintenance due in the next two weeks." },
      { eyebrow: "Watch", value: withDefects, title: "Defects flagged", copy: "Assets carrying condition or defect notes." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (assetActionBar) {
    assetActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-asset-action="new">New asset</button>
      <button type="button" class="pipeline-action-chip" data-asset-action="customers">Open customers</button>
      <button type="button" class="pipeline-action-chip" data-asset-action="calendar">Open calendar</button>
    `;
    assetActionBar.querySelectorAll("[data-asset-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-asset-action");
        if (action === "new") {
          ACTIVE_ASSET_ID = null;
          renderHydrovacAssetsWorkspace();
          return;
        }
        if (action === "customers") return switchTab("customers");
        if (action === "calendar") return switchTab("bookings");
      });
    });
  }
  hydrovacAssetList.innerHTML = rows.length ? rows.map((row) => `
    <button type="button" class="list-item ${row.id === ACTIVE_ASSET_ID ? "is-active" : ""}" data-asset-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.asset_name || row.external_asset_id || titleCaseWords(String(row.asset_type || "asset").replace(/_/g, " ")))}</div>
        <div class="li-sub muted">${escapeHtml(row.address || row.location_description || "Address not set")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${row.has_defects ? "pill-warn" : "pill-on"}">${row.has_defects ? "Defects" : escapeHtml(titleCaseWords(String(row.status || "active")))}</span>
      </div>
    </button>
  `).join("") : `<div class="muted">No infrastructure assets saved yet.</div>`;
  hydrovacAssetList.querySelectorAll("[data-asset-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_ASSET_ID = button.getAttribute("data-asset-id") || null;
      renderHydrovacAssetsWorkspace();
    });
  });
  const active = currentHydrovacAsset();
  hydrovacAssetDetail.innerHTML = `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active?.asset_name || "New asset")}</strong>
        <span class="pill ${active?.has_defects ? "pill-warn" : "pill-on"}">${escapeHtml(titleCaseWords(String(active?.status || "active").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-grid">
        <label>Customer
          <select id="assetCustomerId">
            <option value="">Optional</option>
            ${(CUSTOMERS_CACHE || []).map((customer) => `<option value="${escapeAttr(customer.id)}"${customer.id === active?.customer_id ? " selected" : ""}>${escapeHtml(customer.name || customer.email || "Customer")}</option>`).join("")}
          </select>
        </label>
        <label>Asset type
          <select id="assetType">
            ${["catch_basin","manhole","lift_station","wet_well","storm_drain","grease_trap","industrial_tank","vault","sump","pipe_segment","other"].map((type) => `<option value="${type}"${type === (active?.asset_type || "catch_basin") ? " selected" : ""}>${escapeHtml(titleCaseWords(type.replace(/_/g, " ")))}</option>`).join("")}
          </select>
        </label>
        <label>Asset name
          <input id="assetName" value="${escapeAttr(active?.asset_name || "")}" placeholder="CB-047 / Main & Oak NW" />
        </label>
        <label>External asset ID
          <input id="assetExternalId" value="${escapeAttr(active?.external_asset_id || "")}" placeholder="Customer or GIS asset ID" />
        </label>
        <label>Address
          <input id="assetAddress" value="${escapeAttr(active?.address || "")}" placeholder="Asset location" />
        </label>
        <label>Service frequency (days)
          <input id="assetServiceFrequency" type="number" min="0" step="1" value="${escapeAttr(active?.service_frequency_days ?? "")}" />
        </label>
        <label>Next due date
          <input id="assetNextDueDate" type="date" value="${escapeAttr(active?.next_service_due_date || "")}" />
        </label>
        <label>Condition
          <select id="assetConditionRating">
            <option value="">Not set</option>
            <option value="good"${active?.last_condition_rating === "good" ? " selected" : ""}>Good</option>
            <option value="fair"${active?.last_condition_rating === "fair" ? " selected" : ""}>Fair</option>
            <option value="poor"${active?.last_condition_rating === "poor" ? " selected" : ""}>Poor</option>
            <option value="critical"${active?.last_condition_rating === "critical" ? " selected" : ""}>Critical</option>
          </select>
        </label>
      </div>
      <label style="margin-top:12px;"><input id="assetHasDefects" type="checkbox"${active?.has_defects ? " checked" : ""} /> Defects present</label>
      <label style="margin-top:12px;">Defect codes
        <input id="assetDefectCodes" value="${escapeAttr(Array.isArray(active?.defect_codes) ? active.defect_codes.join(", ") : "")}" placeholder="Broken frame, collapsed wall, heavy sediment" />
      </label>
      <label style="margin-top:12px;">Notes
        <textarea id="assetNotes" rows="3" placeholder="Condition notes, site access, or municipal context.">${escapeHtml(active?.notes || "")}</textarea>
      </label>
      <div class="detail-copy" style="margin-top:12px;">Service count: ${escapeHtml(String(active?.service_count_total || 0))} total â€¢ Last serviced ${escapeHtml(active?.last_service_date || "Not yet recorded")}</div>
      <div class="row" style="margin-top:12px;">
        <button id="btnSaveAsset" class="btn btn-primary" type="button">${active ? "Save asset" : "Create asset"}</button>
        ${active?.customer_id ? `<button id="btnOpenAssetCustomer" class="btn btn-ghost" type="button">Open customer</button>` : ""}
      </div>
      <div id="assetMsg" class="msg"></div>
    </div>
  `;
  $("btnOpenAssetCustomer")?.addEventListener("click", () => {
    if (!active?.customer_id) return;
    ACTIVE_CUSTOMER_ID = active.customer_id;
    CUSTOMER_CREATING = false;
    switchTab("customers");
  });
  $("btnSaveAsset")?.addEventListener("click", async () => {
    const payload = {
      customer_id: $("assetCustomerId")?.value || null,
      asset_type: $("assetType")?.value || "catch_basin",
      asset_name: $("assetName")?.value || null,
      external_asset_id: $("assetExternalId")?.value || null,
      address: $("assetAddress")?.value || null,
      service_frequency_days: $("assetServiceFrequency")?.value || null,
      next_service_due_date: $("assetNextDueDate")?.value || null,
      last_condition_rating: $("assetConditionRating")?.value || null,
      has_defects: $("assetHasDefects")?.checked || false,
      defect_codes: String($("assetDefectCodes")?.value || "").split(",").map((part) => part.trim()).filter(Boolean),
      notes: $("assetNotes")?.value || null,
      status: active?.status || "active",
    };
    if (active?.id) payload.id = active.id;
    setInlineMessage($("assetMsg"), "Saving...");
    try {
      await requestOperatorFunction("manage-infrastructure-assets", {
        method: active?.id ? "PATCH" : "POST",
        body: payload,
      });
      await fetchHydrovacAssets();
      if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
      setInlineMessage($("assetMsg"), "Asset saved.", "ok");
    } catch (error) {
      setInlineMessage($("assetMsg"), error.message || String(error), "error");
    }
  });
}

btnRefreshFacilities?.addEventListener("click", () => fetchHydrovacFacilities().catch(console.error));
btnNewFacility?.addEventListener("click", () => clearHydrovacFacilityForm());
btnSaveAndAddFacility?.addEventListener("click", () => {
  FACILITY_SAVE_ADD_ANOTHER = true;
  hydrovacFacilityForm?.requestSubmit?.();
});
btnClearFacility?.addEventListener("click", () => clearHydrovacFacilityForm());
hydrovacFacilityForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setInlineMessage(hydrovacFacilityMsg, "Saving...");
  const shouldAddAnother = FACILITY_SAVE_ADD_ANOTHER;
  FACILITY_SAVE_ADD_ANOTHER = false;
  try {
    const cityState = parseHydrovacCityState(hydrovacFacilityCityState?.value || "");
    const payload = {
      id: hydrovacFacilityId?.value || undefined,
      name: hydrovacFacilityName?.value || "",
      status: hydrovacFacilityStatus?.value || "active",
      facility_type: hydrovacFacilityType?.value || "transfer_station",
      permit_expiry_date: hydrovacFacilityPermitExpiry?.value || null,
      address: hydrovacFacilityAddress?.value || null,
      city: cityState.city,
      state_province: cityState.state_province,
      price_per_gallon_cents: Math.round((parseFloat(hydrovacFacilityRateGallon?.value || "0") || 0) * 100),
      price_per_cubic_yard_cents: Math.round((parseFloat(hydrovacFacilityRateYard?.value || "0") || 0) * 100),
      minimum_charge_cents: Math.round((parseFloat(hydrovacFacilityMinimumCharge?.value || "0") || 0) * 100),
      primary_contact_name: hydrovacFacilityContact?.value || null,
      dispatch_phone: hydrovacFacilityDispatchPhone?.value || null,
      accepted_waste_types: String(hydrovacFacilityWasteTypes?.value || "").split(",").map((part) => part.trim()).filter(Boolean),
      notes: hydrovacFacilityNotes?.value || null,
    };
    const response = await requestOperatorFunction("manage-disposal-facilities", {
      method: hydrovacFacilityId?.value ? "PATCH" : "POST",
      body: payload,
    });
    if (response?.facility?.id) ACTIVE_FACILITY_ID = response.facility.id;
    await fetchHydrovacFacilities();
    if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
    if (shouldAddAnother) {
      clearHydrovacFacilityForm();
      setInlineMessage(hydrovacFacilityMsg, "Facility saved. Ready for the next one.", "ok");
      hydrovacFacilityName?.focus?.();
    } else {
      setInlineMessage(hydrovacFacilityMsg, "Facility saved.", "ok");
    }
  } catch (error) {
    setInlineMessage(hydrovacFacilityMsg, error.message || String(error), "error");
  }
});
btnRefreshManifests?.addEventListener("click", () => fetchHydrovacManifests().catch(console.error));
btnRefreshLocates?.addEventListener("click", () => fetchHydrovacLocateTickets().catch(console.error));
btnNewLocate?.addEventListener("click", () => clearHydrovacLocateForm());
btnClearLocate?.addEventListener("click", () => clearHydrovacLocateForm());
btnVerifyLocate?.addEventListener("click", async () => {
  const id = hydrovacLocateId?.value || "";
  if (!id) return;
  setInlineMessage(hydrovacLocateMsg, "Marking verified...");
  try {
    await requestOperatorFunction("manage-locate-tickets", {
      method: "PATCH",
      body: { id, verified_on_site: true },
    });
    await fetchHydrovacLocateTickets();
    if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
    setInlineMessage(hydrovacLocateMsg, "Ticket marked verified.", "ok");
  } catch (error) {
    setInlineMessage(hydrovacLocateMsg, error.message || String(error), "error");
  }
});
hydrovacLocateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setInlineMessage(hydrovacLocateMsg, "Saving...");
  try {
    const payload = {
      id: hydrovacLocateId?.value || undefined,
      job_id: hydrovacLocateJobId?.value || null,
      ticket_number: hydrovacLocateNumber?.value || "",
      ticket_type: hydrovacLocateType?.value || "standard",
      status: hydrovacLocateStatus?.value || "requested",
      one_call_center: hydrovacLocateCenter?.value || null,
      state_province: hydrovacLocateState?.value || null,
      work_site_address: hydrovacLocateAddress?.value || "",
      valid_from: hydrovacLocateValidFrom?.value ? new Date(hydrovacLocateValidFrom.value).toISOString() : null,
      valid_until: hydrovacLocateValidUntil?.value ? new Date(hydrovacLocateValidUntil.value).toISOString() : null,
      locate_notes: hydrovacLocateNotes?.value || null,
    };
    await requestOperatorFunction("manage-locate-tickets", {
      method: hydrovacLocateId?.value ? "PATCH" : "POST",
      body: payload,
    });
    await fetchHydrovacLocateTickets();
    if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
    if (TABS_LOADED.has("jobs")) await fetchJobs();
    setInlineMessage(hydrovacLocateMsg, "Ticket saved.", "ok");
  } catch (error) {
    setInlineMessage(hydrovacLocateMsg, error.message || String(error), "error");
  }
});
btnRefreshCompliance?.addEventListener("click", () => fetchHydrovacComplianceData().catch(console.error));
btnRefreshDispatchBoard?.addEventListener("click", async () => {
  await Promise.all([fetchJobs(), fetchEquipment(), fetchHydrovacLocateTickets()]);
  renderDispatchWorkspace();
});
dispatchDate?.addEventListener("change", () => renderDispatchWorkspace());
hydrovacInvoiceJobSelect?.addEventListener("change", () => {
  ACTIVE_JOB_ID = hydrovacInvoiceJobSelect.value || null;
  renderHydrovacInvoiceWorkbench();
});
btnPreviewHydrovacInvoice?.addEventListener("click", async () => {
  const jobId = hydrovacInvoiceJobSelect?.value || "";
  if (!jobId) {
    setInlineMessage(hydrovacInvoiceMsg, "Choose a hydrovac job first.", "error");
    return;
  }
  ACTIVE_JOB_ID = jobId;
  setInlineMessage(hydrovacInvoiceMsg, "Refreshing draft...");
  try {
    const result = await postOperatorFunction("generate-hydrovac-invoice", { job_id: jobId });
    hydrovacInvoicePreview.innerHTML = hydrovacInvoicePreviewHtml(jobId, result);
    setInlineMessage(hydrovacInvoiceMsg, "Draft refreshed on the linked order.", "ok");
  } catch (error) {
    setInlineMessage(hydrovacInvoiceMsg, error.message || String(error), "error");
  }
});

let VENDORS_PANEL_LOADED = false;
let TEAM_PANEL_LOADED = false;

async function fetchTeamMembers() {
  const r = await fetch('/.netlify/functions/manage-operator-members', { headers: authHeaders() });
  const d = await r.json().catch(() => ({}));
  TEAM_MEMBERS_CACHE = d.members || [];
  renderTeamPanel();
}

function renderTeamPanel() {
  const el = $('teamMembersList');
  if (!el) return;
  if (!TEAM_MEMBERS_CACHE.length) {
    el.innerHTML = '<div class="muted" style="font-size:.85rem;">No team members yet. Invite your first crew member.</div><div style="margin-top:10px;"><button class="btn btn-primary btn-sm" onclick="openInviteTeamMemberModal()">+ Invite first member</button></div>';
    renderHydrovacDriverWorkspace();
    return;
  }
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.85rem;">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Name</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Role</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Hourly Rate</th>
      <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);"></th>
    </tr></thead>
    <tbody>
      ${TEAM_MEMBERS_CACHE.map(m => `
        <tr>
          <td style="padding:8px;color:#e8e9eb;">${escapeHtml(m.display_name || m.name || m.email || m.id)}</td>
          <td style="padding:8px;color:rgba(255,255,255,.55);">${escapeHtml(m.role || 'â€”')}</td>
          <td style="padding:8px;color:rgba(255,255,255,.55);">${m.hourly_rate_cents ? formatUsd(m.hourly_rate_cents) + '/hr' : 'â€”'}</td>
          <td style="padding:8px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openEditTeamMemberModal('${escapeAttr(m.id)}','${escapeAttr(m.role||'')}','${m.hourly_rate_cents||0}')">Edit</button>
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="removeTeamMember('${escapeAttr(m.id)}')">Remove</button>
          </td>
        </tr>`).join('')}
    </tbody>
  </table>
  <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07);">
    <a href="/crew/" target="_blank" rel="noopener" style="font-size:.8rem;color:rgba(255,255,255,.45);text-decoration:none;display:inline-flex;align-items:center;gap:5px;transition:color .15s;" onmouseover="this.style.color='rgba(255,255,255,.75)'" onmouseout="this.style.color='rgba(255,255,255,.45)'">Open crew app &#8599;</a>
  </div>`;
  renderHydrovacDriverWorkspace();
}

function openInviteTeamMemberModal() {
  const existing = document.getElementById('inviteTeamModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'inviteTeamModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Invite team member</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="tmEmail" class="input" placeholder="Email *" type="email" style="width:100%;" />
        <input id="tmName" class="input" placeholder="Display name" style="width:100%;" />
        <select id="tmRole" class="input" style="width:100%;">
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member" selected>Member</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('inviteTeamModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="tmSave" class="btn btn-primary">Send invite</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('tmSave').onclick = async () => {
    const email = (document.getElementById('tmEmail')?.value || '').trim();
    if (!email) { notifyOperator("Add an email address first."); return; }
    const btn = document.getElementById('tmSave'); btn.disabled = true; btn.textContent = 'Sendingâ€¦';
    try {
      const res = await fetch('/.netlify/functions/manage-operator-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          email,
          name: document.getElementById('tmName')?.value || undefined,
          role: document.getElementById('tmRole')?.value || 'member',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Invite sent.');
      modal.remove();
      await fetchTeamMembers();
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Send invite';
    }
  };
}

function openEditTeamMemberModal(id, currentRole, currentRateCents) {
  const existing = document.getElementById('editTeamModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'editTeamModal';
  modal.className = 'modal-overlay';
  const roles = ['owner','admin','member','viewer'];
  modal.innerHTML = `<div class="modal-box" style="max-width:340px;">
    <h3 style="margin:0 0 16px;font-size:1rem;">Edit Team Member</h3>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Role</label>
    <select id="tmEditRole" class="input" style="margin-bottom:12px;width:100%;">
      ${roles.map(r => `<option value="${r}"${r===currentRole?' selected':''}>${r}</option>`).join('')}
    </select>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Hourly Rate ($/hr)</label>
    <input id="tmEditRate" class="input" type="number" min="0" step="0.01" style="margin-bottom:16px;width:100%;" value="${currentRateCents ? (currentRateCents/100).toFixed(2) : ''}">
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost" onclick="document.getElementById('editTeamModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" id="tmEditSave">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#tmEditSave').onclick = async () => {
    const role = document.getElementById('tmEditRole')?.value;
    const rate = parseFloat(document.getElementById('tmEditRate')?.value || '0');
    try {
      const res = await fetch('/.netlify/functions/manage-operator-members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id, role, hourly_rate_cents: Math.round(rate * 100) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      modal.remove();
      await fetchTeamMembers();
      showToast('Member updated.');
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  };
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function removeTeamMember(id) {
  if (!(await showConfirmModal('Remove this team member?', 'Remove', 'Cancel'))) return;
  try {
    const res = await fetch(`/.netlify/functions/manage-operator-members?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    TEAM_MEMBERS_CACHE = TEAM_MEMBERS_CACHE.filter(m => m.id !== id);
    renderTeamPanel();
    showToast('Team member removed.');
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

async function loadHoursReport() {
  const startEl = $('hoursStart');
  const endEl = $('hoursEnd');
  const reportEl = $('hoursReport');
  if (!reportEl) return;

  const start = startEl?.value;
  const end = endEl?.value;
  if (!start || !end) { reportEl.innerHTML = '<div class="muted">Set start and end dates.</div>'; return; }

  reportEl.innerHTML = '<div class="muted">Loading\u2026</div>';

  try {
    const tok = await getOperatorAccessToken();
    const res = await fetch(`/.netlify/functions/get-team-hours?start=${start}&end=${end}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Failed to load hours');
    renderHoursReport(d);
  } catch (err) {
    reportEl.innerHTML = `<div class="msg error">${escapeHtml(err.message)}</div>`;
  }
}

function renderHoursReport(data) {
  const reportEl = $('hoursReport');
  if (!reportEl) return;

  const { members = [], totals = {} } = data;

  if (!members.length) {
    reportEl.innerHTML = '<div class="muted">No hours logged in this period.</div>';
    return;
  }

  const toHrs = (mins) => (mins / 60).toFixed(1);

  const memberHtml = members.map((m) => {
    const hasActivity = m.total_minutes > 0 || m.job_count > 0;
    const jobRows = (m.jobs || []).map((j) => {
      const dur = j.actual_end_at && j.actual_start_at
        ? Math.round((new Date(j.actual_end_at) - new Date(j.actual_start_at)) / 60000)
        : null;
      return `<div class="list-item" style="padding:6px 0;">
        <div class="li-main">
          <div class="li-title" style="font-size:.85rem;">${escapeHtml(j.title || 'Untitled job')} &middot; ${escapeHtml(j.customer_name || '')}</div>
          <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(j.actual_start_at ? new Date(j.actual_start_at).toLocaleDateString() : '\u2014')}${dur != null ? ` &middot; ${toHrs(dur)}h` : ''}</div>
        </div>
        <div class="li-meta"><span class="pill ${j.status === 'completed' ? 'pill-on' : ''}">${escapeHtml(j.status || '')}</span></div>
      </div>`;
    }).join('');

    const entryRows = (m.entries || []).map((e) => `
      <div class="list-item" style="padding:6px 0;">
        <div class="li-main">
          <div class="li-title" style="font-size:.85rem;">${escapeHtml(e.description || 'Time entry')}</div>
          <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(e.started_at ? new Date(e.started_at).toLocaleDateString() : '\u2014')} &middot; ${escapeHtml(e.billable ? 'Billable' : 'Non-billable')}</div>
        </div>
        <div class="li-meta"><span class="pill">${toHrs(e.duration_minutes || 0)}h</span></div>
      </div>`).join('');

    return `
      <div class="card" style="margin-bottom:12px;${!hasActivity ? 'opacity:.55;' : ''}">
        <div class="card-hd" style="cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
          <div>
            <strong>${escapeHtml(m.name || 'Unknown')}</strong>
            <span class="pill" style="margin-left:8px;">${escapeHtml(m.role || '')}</span>
          </div>
          <div class="row" style="gap:16px;font-size:.85rem;">
            <span><strong>${toHrs(m.total_minutes)}</strong> hrs total</span>
            <span class="muted">${toHrs(m.billable_minutes)} billable</span>
            <span class="muted">${m.job_count} jobs</span>
            ${m.estimated_pay_cents > 0 ? `<span class="pill pill-on">${formatUsd(m.estimated_pay_cents)}</span>` : ''}
          </div>
        </div>
        <div class="card-bd" style="display:none;">
          ${jobRows ? `<div style="margin-bottom:10px;"><div class="kicker">Jobs</div><div class="list">${jobRows}</div></div>` : ''}
          ${entryRows ? `<div><div class="kicker">Time entries</div><div class="list">${entryRows}</div></div>` : ''}
          ${!jobRows && !entryRows ? '<div class="muted">No detail records in this period.</div>' : ''}
        </div>
      </div>`;
  }).join('');

  const totalHtml = `
    <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:14px;margin-top:4px;display:flex;gap:24px;font-size:.9rem;">
      <span><strong>${toHrs(totals.total_minutes || 0)}</strong> total hours</span>
      <span class="muted">${toHrs(totals.billable_minutes || 0)} billable</span>
      <span class="muted">${totals.member_count || 0} team members</span>
      ${totals.estimated_pay_cents > 0 ? `<span class="pill pill-on">Est. payroll: ${formatUsd(totals.estimated_pay_cents)}</span>` : ''}
    </div>`;

  reportEl.innerHTML = memberHtml + totalHtml;

  // Store for CSV export
  reportEl._data = data;
}

function exportHoursCsv() {
  const reportEl = $('hoursReport');
  const data = reportEl?._data;
  if (!data) { showToast('Load a report first.'); return; }

  const startEl = $('hoursStart');
  const endEl = $('hoursEnd');

  const rows = [['Member', 'Role', 'Date', 'Description', 'Type', 'Billable', 'Duration (hrs)', 'Hourly Rate', 'Est. Pay']];

  for (const m of data.members || []) {
    // Time entries
    for (const e of m.entries || []) {
      const hrs = ((e.duration_minutes || 0) / 60).toFixed(2);
      const rate = ((e.hourly_rate_cents || m.hourly_rate_cents || 0) / 100).toFixed(2);
      const pay = ((e.duration_minutes || 0) / 60 * (e.hourly_rate_cents || m.hourly_rate_cents || 0) / 100).toFixed(2);
      rows.push([
        m.name || '',
        m.role || '',
        e.started_at ? new Date(e.started_at).toLocaleDateString() : '',
        e.description || 'Time entry',
        'Time Entry',
        e.billable ? 'Yes' : 'No',
        hrs,
        `$${rate}`,
        `$${pay}`,
      ]);
    }
    // Jobs
    for (const j of m.jobs || []) {
      if (!j.actual_start_at || !j.actual_end_at) continue;
      const mins = Math.round((new Date(j.actual_end_at) - new Date(j.actual_start_at)) / 60000);
      const hrs = (mins / 60).toFixed(2);
      const rate = (m.hourly_rate_cents / 100).toFixed(2);
      const pay = (mins / 60 * m.hourly_rate_cents / 100).toFixed(2);
      rows.push([
        m.name || '',
        m.role || '',
        new Date(j.actual_start_at).toLocaleDateString(),
        j.title || 'Job',
        'Job',
        'Yes',
        hrs,
        `$${rate}`,
        `$${pay}`,
      ]);
    }
  }

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hours-${startEl?.value || 'report'}-to-${endEl?.value || 'report'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchTimeEntries(orderId) {
  try {
    const tok = await getAccessToken();
    const res = await fetch(`/.netlify/functions/get-time-entries?order_id=${encodeURIComponent(orderId)}`, {
      headers: { "Authorization": `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(d.entries)) {
      TIME_ENTRIES_CACHE = d.entries;
      return d.entries;
    }
  } catch (_) {}
  return [];
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

  // Click day â†’ filter list to that day
  cal.querySelectorAll(".bk-cal-day").forEach((cell) => {
    cell.addEventListener("click", () => {
      const date = cell.dataset.date;
      renderBookingsList(bookings.filter((bk) => bk.starts_at?.slice(0,10) === date));
      const lbl = $("bkListLabel");
      if (lbl) lbl.textContent = `Appointments on ${date}`;
    });
  });
}

function showBookingDetail(bk) {
  const existing = document.getElementById("bkDetailModal");
  if (existing) existing.remove();

  const start    = bk.starts_at ? new Date(bk.starts_at) : null;
  const end      = bk.ends_at   ? new Date(bk.ends_at)   : null;
  const localDate = start ? start.toISOString().slice(0, 10) : "";
  const localStart = start ? start.toTimeString().slice(0, 5) : "09:00";
  const localEnd   = end   ? end.toTimeString().slice(0, 5)   : "";

  const overlay = document.createElement("div");
  overlay.id = "bkDetailModal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";
  overlay.innerHTML = `
    <div style="background:#1a1d27;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:28px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <strong style="font-size:1rem;">${escapeHtml(bk.title || "Appointment")}</strong>
        <button id="bkDetailClose" type="button" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:1.2rem;cursor:pointer;padding:0 4px;">âœ•</button>
      </div>
      <table style="width:100%;font-size:.85rem;margin-bottom:16px;">
        <tr><td style="color:rgba(255,255,255,.5);padding:5px 0;width:110px;">Customer</td><td>${escapeHtml(bk.customer_name || "â€”")}</td></tr>
        <tr><td style="color:rgba(255,255,255,.5);padding:5px 0;">Email</td><td>${escapeHtml(bk.customer_email || "â€”")}</td></tr>
        <tr><td style="color:rgba(255,255,255,.5);padding:5px 0;">Status</td><td>${escapeHtml(bk.status || "confirmed")}</td></tr>
      </table>
      ${bk.notes ? `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:10px 12px;font-size:.82rem;color:rgba(255,255,255,.6);margin-bottom:16px;white-space:pre-wrap;">${escapeHtml(bk.notes)}</div>` : ""}
      <div style="margin-top:10px;margin-bottom:10px;">
        <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:4px;">Assigned to</label>
        <select id="bkAssignedOperator" class="input" style="width:100%;">
          <option value="">Unassigned</option>
        </select>
      </div>
      <div style="margin-top:10px;margin-bottom:16px;">
        <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:4px;">Vehicle / equipment (optional)</label>
        <input id="bkVehicleNotes" class="input" value="${escapeAttr(bk.notes_vehicle || '')}" placeholder="e.g. 2019 Honda Civic â€” silver, plate ABC123" style="width:100%;" />
      </div>
      <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:16px;margin-bottom:4px;">
        <div style="font-size:.82rem;font-weight:600;color:rgba(255,255,255,.5);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em;">Reschedule</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <label style="flex:1;min-width:130px;font-size:.8rem;color:rgba(255,255,255,.6);">Date<br/>
            <input id="bkDetailDate" type="date" value="${escapeAttr(localDate)}" style="width:100%;margin-top:4px;background:#0f1117;border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e8e9eb;padding:8px 10px;font-size:.85rem;outline:none;" />
          </label>
          <label style="flex:1;min-width:100px;font-size:.8rem;color:rgba(255,255,255,.6);">Start time<br/>
            <input id="bkDetailStart" type="time" value="${escapeAttr(localStart)}" style="width:100%;margin-top:4px;background:#0f1117;border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e8e9eb;padding:8px 10px;font-size:.85rem;outline:none;" />
          </label>
          <label style="flex:1;min-width:100px;font-size:.8rem;color:rgba(255,255,255,.6);">End time<br/>
            <input id="bkDetailEnd" type="time" value="${escapeAttr(localEnd)}" style="width:100%;margin-top:4px;background:#0f1117;border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e8e9eb;padding:8px 10px;font-size:.85rem;outline:none;" />
          </label>
        </div>
        <button id="bkDetailSave" class="btn btn-primary btn-sm" type="button">Save reschedule</button>
        <span id="bkDetailMsg" style="font-size:.8rem;margin-left:10px;"></span>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("bkDetailClose").addEventListener("click", () => overlay.remove());

  // Populate assigned operator dropdown
  fetchOperatorMembers().then((members) => {
    const sel = document.getElementById("bkAssignedOperator");
    if (!sel) return;
    members.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id || m.operator_id || "";
      opt.textContent = m.name || m.email || m.operator_id || "Member";
      if ((m.id || m.operator_id) === (bk.assigned_operator_id || "")) opt.selected = true;
      sel.appendChild(opt);
    });
    if (bk.assigned_operator_id) sel.value = bk.assigned_operator_id;
  });

  document.getElementById("bkDetailSave").addEventListener("click", async () => {
    const saveBtn = document.getElementById("bkDetailSave");
    const msgEl   = document.getElementById("bkDetailMsg");
    const date    = document.getElementById("bkDetailDate").value;
    const startT  = document.getElementById("bkDetailStart").value;
    const endT    = document.getElementById("bkDetailEnd").value;
    const assignedOpId = (document.getElementById("bkAssignedOperator")?.value || "").trim();
    if (!date || !startT) { msgEl.textContent = "Date and start time are required."; msgEl.style.color = "#f87171"; return; }
    saveBtn.disabled = true;
    saveBtn.textContent = "Savingâ€¦";
    try {
      const startsAt     = new Date(`${date}T${startT}:00`).toISOString();
      const endsAt       = endT ? new Date(`${date}T${endT}:00`).toISOString() : null;
      const vehicleNotes = (document.getElementById("bkVehicleNotes")?.value || "").trim();
      const patch        = { id: bk.id, starts_at: startsAt, ...(endsAt ? { ends_at: endsAt } : {}), ...(vehicleNotes !== (bk.notes_vehicle || "") ? { notes_vehicle: vehicleNotes } : {}), ...(assignedOpId ? { assigned_operator_id: assignedOpId } : { assigned_operator_id: null }) };
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/update-booking", {
        method : "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to update");
      msgEl.textContent = "Saved âœ“";
      msgEl.style.color = "#4ade80";
      BOOKINGS_CACHE = BOOKINGS_CACHE.map((b) => b.id === bk.id ? { ...b, starts_at: startsAt, ends_at: endsAt || b.ends_at, assigned_operator_id: assignedOpId || null } : b);
      renderBookingsCalendar(BOOKINGS_CACHE);
      renderBookingsList(BOOKINGS_CACHE);
      setTimeout(() => overlay.remove(), 1500);
    } catch (err) {
      msgEl.textContent = err.message || "Error";
      msgEl.style.color = "#f87171";
      saveBtn.disabled = false;
      saveBtn.textContent = "Save reschedule";
    }
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
    const dateStr = start ? start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : "â€”";
    const timeStr = start
      ? start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
        (end ? ` â€“ ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '')
      : "â€”";
    const statusColor = bk.status === 'cancelled' ? '#f87171' : bk.status === 'completed' ? '#4ade80' : '#93c5fd';
    return `<div class="list-row" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:.9rem;">${bk.title || "Appointment"}</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.5);">${bk.customer_name || "â€”"} Â· ${dateStr} Â· ${timeStr}</div>
        ${bk.notes ? `<div style="font-size:.78rem;color:rgba(255,255,255,.35);margin-top:2px;white-space:pre-wrap;">${escapeHtml(bk.notes.slice(0, 120))}${bk.notes.length > 120 ? 'â€¦' : ''}</div>` : ''}
      </div>
      <span style="font-size:.75rem;padding:3px 8px;background:rgba(255,255,255,.06);border-radius:12px;color:${statusColor};white-space:nowrap;">${bk.status || "confirmed"}</span>
      ${bk.customer_email && !['cancelled','completed','no_show'].includes(bk.status) && bk.starts_at && new Date(bk.starts_at) > new Date() ? `<button class="btn btn-ghost btn-sm bk-remind-btn" data-action="remind" data-booking-id="${bk.id}" type="button" title="Send reminder email" style="white-space:nowrap;">Remind</button>` : ''}
      <button class="btn btn-ghost btn-sm bk-cancel-btn" data-action="cancel" data-booking-id="${bk.id}" type="button" ${bk.status === 'cancelled' ? 'disabled' : ''} style="white-space:nowrap;">Cancel</button>
      <button class="btn btn-ghost btn-sm bk-detail-btn" data-action="detail" data-booking-id="${bk.id}" type="button" style="white-space:nowrap;">Details</button>
    </div>`;
  }).join('');

  if (!list._delegated) {
    list._delegated = true;
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const bookingId = btn.dataset.bookingId;
      const action = btn.dataset.action;
      if (action === 'cancel') {
        const approved = await showConfirmModal("Cancel this appointment?", "Cancel appointment", "Keep appointment");
        if (!approved) return;
        btn.disabled = true;
        try {
          const tok = await getAccessToken();
          const res = await fetch("/.netlify/functions/update-booking", {
            method : "PATCH",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
            body   : JSON.stringify({ id: bookingId, status: "cancelled" }),
          });
          if (!res.ok) throw new Error("Failed to cancel");
          await fetchBookings();
          renderBookingsCalendar(BOOKINGS_CACHE);
          renderBookingsList(BOOKINGS_CACHE);
          const lbl = $("bkListLabel");
          if (lbl) lbl.textContent = "Upcoming appointments";
        } catch (err) {
          notifyOperator(err.message || "Error cancelling booking");
          btn.disabled = false;
        }
      }
      if (action === 'detail') {
        const bk = BOOKINGS_CACHE.find((b) => b.id === bookingId);
        if (bk) showBookingDetail(bk);
      }
      if (action === 'remind') {
        btn.disabled = true;
        btn.textContent = "Sendingâ€¦";
        try {
          const tok = await getAccessToken();
          const res = await fetch("/.netlify/functions/send-booking-reminder", {
            method : "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
            body   : JSON.stringify({ booking_id: bookingId }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || "Failed to send reminder");
          btn.textContent = "Sent âœ“";
          setTimeout(() => { btn.textContent = "Remind"; btn.disabled = false; }, 3000);
        } catch (err) {
          notifyOperator(err.message || "Error sending reminder");
          btn.textContent = "Remind";
          btn.disabled = false;
        }
      }
    });
  }
}

async function renderBookings() {
  try {
    await fetchBookings();
  } catch (err) {
    console.error("[renderBookings]", err);
  }
  renderBookingsCalendar(BOOKINGS_CACHE);
  // Apply "My bookings" filter if active
  const myBookingsActive = localStorage.getItem("pl_my_bookings_filter") === "true";
  const btnMy = $("btnMyBookings");
  if (btnMy) {
    btnMy.style.background = myBookingsActive ? "rgba(200,75,47,.2)" : "";
    btnMy.style.color = myBookingsActive ? "var(--accent)" : "";
  }
  let filteredBookings = BOOKINGS_CACHE;
  if (myBookingsActive) {
    let myOpId = "";
    try { myOpId = opId(); } catch (_) {}
    if (myOpId) filteredBookings = BOOKINGS_CACHE.filter((bk) => bk.assigned_operator_id === myOpId);
  }
  // Show upcoming (next 30 days)
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = filteredBookings.filter((bk) =>
    bk.starts_at && bk.starts_at.slice(0,10) >= todayStr && bk.status !== 'cancelled'
  );
  renderBookingsList(upcoming.length ? upcoming : filteredBookings);
  // No-show rate stat
  const noShowEl = $("bookingsNoShowStat");
  if (noShowEl) {
    const concluded = BOOKINGS_CACHE.filter((b) => ['no_show', 'completed'].includes(b.status));
    const noShows = BOOKINGS_CACHE.filter((b) => b.status === 'no_show');
    const noShowRate = concluded.length ? Math.round(noShows.length / concluded.length * 100) : 0;
    noShowEl.textContent = `No-show rate: ${noShowRate}% (${noShows.length} no-show${noShows.length === 1 ? '' : 's'} out of ${concluded.length} completed+no-show)`;
  }
  // Booking link
  const linkEl = $("bookingLinkDisplay");
  if (linkEl && TENANT_ID) {
    linkEl.textContent = `${location.origin}/book.html?tenant=${TENANT_ID}`;
  }
  renderDispatchWorkspace();
}

function renderDispatchWorkspace() {
  if (!dispatchBoard || !dispatchDetail) return;
  const targetDate = dispatchDate?.value || new Date().toISOString().slice(0, 10);
  if (dispatchDate && !dispatchDate.value) dispatchDate.value = targetDate;
  const hydrovacJobs = (JOBS_CACHE || [])
    .filter((job) => isHydrovacJob(job) && hydrovacJobSortDate(job) === targetDate)
    .sort((a, b) => String(a.scheduled_time || "").localeCompare(String(b.scheduled_time || "")));
  const trucks = (EQUIPMENT_CACHE || []).filter((unit) => unit.is_active !== false);
  const scheduled = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "scheduled").length;
  const dispatched = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "dispatched").length;
  const inProgress = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "in_progress").length;
  const unassigned = hydrovacJobs.filter((job) => !job.assigned_truck_id).length;
  if (dispatchStageStrip) {
    dispatchStageStrip.innerHTML = [
      { eyebrow: "Today", value: hydrovacJobs.length, title: "Hydrovac work", copy: "Scheduled hydrovac jobs on the selected day." },
      { eyebrow: "Queued", value: scheduled, title: "Still waiting", copy: "Scheduled jobs that still need truck or driver confirmation." },
      { eyebrow: "Rolling", value: dispatched + inProgress, title: "In motion", copy: "Jobs already dispatched or currently in progress." },
      { eyebrow: "Open", value: unassigned, title: "Truck not assigned", copy: "Work that still needs a truck before it can roll." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (dispatchActionBar) {
    dispatchActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-dispatch-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-dispatch-action="locates">Open locate tickets</button>
      <button type="button" class="pipeline-action-chip" data-dispatch-action="team">Open team</button>
      <button type="button" class="pipeline-action-chip" data-dispatch-action="equipment">Open equipment</button>
    `;
    dispatchActionBar.querySelectorAll("[data-dispatch-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-dispatch-action");
        if (action === "jobs") return switchTab("jobs");
        if (action === "locates") return switchTab("locates");
        if (action === "team") return switchTab("team");
        if (action === "equipment") return switchTab("equipment");
      });
    });
  }
  const columns = [{ id: "", label: "Unassigned", unit: null }, ...trucks.map((truck) => ({ id: truck.id, label: truck.unit_number || truck.name || "Truck", unit: truck }))];
  dispatchBoard.innerHTML = columns.map((column) => {
    const columnJobs = hydrovacJobs.filter((job) => String(job.assigned_truck_id || "") === column.id);
    const warningCount = column.unit ? ((HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE.find((row) => row.id === column.unit.id)?.warnings || []).length) : 0;
    return `
      <div class="dispatch-column">
        <div class="dispatch-column__header">
          <div>
            <strong>${escapeHtml(column.label)}</strong>
            <div class="muted">${column.unit ? escapeHtml(column.unit.name || "Equipment record") : "Jobs still waiting on a truck"}</div>
          </div>
          <span class="pill ${warningCount ? "pill-warn" : "pill-on"}">${warningCount ? `${warningCount} watch` : `${columnJobs.length} job${columnJobs.length === 1 ? "" : "s"}`}</span>
        </div>
        <div class="dispatch-column__body">
          ${columnJobs.length ? columnJobs.map((job) => {
            const member = (TEAM_MEMBERS_CACHE || []).find((row) => row.id === job.assigned_member_id) || null;
            const locateCount = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => row.job_id === job.id && ["active", "extended"].includes(String(row.status || "").toLowerCase())).length;
            return `
              <button type="button" class="dispatch-job-card ${job.id === ACTIVE_DISPATCH_JOB_ID ? "is-active" : ""}" data-dispatch-job-id="${escapeAttr(job.id)}">
                <div class="dispatch-job-card__title">${escapeHtml(job.title || "Untitled job")}</div>
                <div class="dispatch-job-card__meta">${escapeHtml(job.customer_name || job.service_address || "Customer not linked")}</div>
                <div class="dispatch-job-card__meta">${escapeHtml(job.scheduled_time || "Time not set")} â€¢ ${escapeHtml(titleCaseWords(String(job.status || "scheduled").replace(/_/g, " ")))}</div>
                <div class="dispatch-job-card__chips">
                  <span class="pill ${locateCount ? "pill-on" : "pill-warn"}">${locateCount ? `${locateCount} ticket` : "No locate"}</span>
                  <span class="pill">${escapeHtml(member ? teamMemberLabel(member) : "Driver open")}</span>
                </div>
              </button>
            `;
          }).join("") : `<div class="muted">No jobs in this column for ${escapeHtml(targetDate)}.</div>`}
        </div>
      </div>
    `;
  }).join("");
  Array.from(dispatchBoard.children).forEach((columnEl, index) => {
    const column = columns[index];
    if (!column?.unit) return;
    const columnJobs = hydrovacJobs.filter((job) => String(job.assigned_truck_id || "") === column.id);
    const openLoadGallons = columnJobs.reduce((sum, job) => sum + hydrovacJobManifestSnapshot(job.id).openGallons, 0);
    const openLoadCount = columnJobs.reduce((sum, job) => sum + hydrovacJobManifestSnapshot(job.id).openLoads, 0);
    const capacityGallons = Number(column.unit?.debris_tank_capacity_gallons || 0);
    const fillPercent = capacityGallons > 0 ? Math.max(0, Math.min(100, Math.round((openLoadGallons / capacityGallons) * 100))) : 0;
    const headerMain = columnEl.querySelector(".dispatch-column__header > div");
    if (headerMain) {
      const stats = document.createElement("div");
      stats.className = "dispatch-column__stats";
      stats.innerHTML = `
        <span>${escapeHtml(String(columnJobs.length))} job${columnJobs.length === 1 ? "" : "s"}</span>
        <span>${escapeHtml(String(openLoadCount))} open load${openLoadCount === 1 ? "" : "s"}</span>
        <span>${escapeHtml(capacityGallons ? `${Math.round(openLoadGallons)} / ${capacityGallons} gal` : "Tank capacity not set")}</span>
      `;
      headerMain.appendChild(stats);
      const fill = document.createElement("div");
      fill.className = "dispatch-fill";
      fill.innerHTML = `
        <div class="dispatch-fill__bar"><span style="width:${fillPercent}%;"></span></div>
        <div class="dispatch-fill__label">${escapeHtml(capacityGallons ? `${fillPercent}% tank pressure from open manifests` : "Set truck tank capacity to see load pressure")}</div>
      `;
      headerMain.appendChild(fill);
    }
    columnJobs.forEach((job) => {
      const card = columnEl.querySelector(`[data-dispatch-job-id="${job.id}"] .dispatch-job-card__chips`);
      if (!card) return;
      const manifestSnapshot = hydrovacJobManifestSnapshot(job.id);
      const chip = document.createElement("span");
      chip.className = `pill${manifestSnapshot.openLoads ? " pill-warn" : ""}`;
      chip.textContent = manifestSnapshot.openLoads ? `${manifestSnapshot.openLoads} open load${manifestSnapshot.openLoads === 1 ? "" : "s"}` : "No open loads";
      card.appendChild(chip);
    });
  });
  dispatchBoard.querySelectorAll("[data-dispatch-job-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_DISPATCH_JOB_ID = button.getAttribute("data-dispatch-job-id") || null;
      renderDispatchWorkspace();
    });
  });
  if (!ACTIVE_DISPATCH_JOB_ID || !hydrovacJobs.some((job) => job.id === ACTIVE_DISPATCH_JOB_ID)) ACTIVE_DISPATCH_JOB_ID = hydrovacJobs[0]?.id || null;
  const activeJob = hydrovacJobs.find((job) => job.id === ACTIVE_DISPATCH_JOB_ID) || null;
  if (!activeJob) {
    dispatchDetail.innerHTML = `<div class="muted">No hydrovac jobs are scheduled on ${escapeHtml(targetDate)} yet.</div>`;
    return;
  }
  const assignedTruck = (EQUIPMENT_CACHE || []).find((unit) => unit.id === activeJob.assigned_truck_id) || null;
  const assignedDriver = (TEAM_MEMBERS_CACHE || []).find((row) => row.id === activeJob.assigned_member_id) || null;
  const activeLocates = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => row.job_id === activeJob.id && ["active", "extended"].includes(String(row.status || "").toLowerCase()));
  const currentTruckId = assignedTruck?.id || activeJob.assigned_truck_id || "";
  const currentDriverId = assignedDriver?.id || activeJob.assigned_member_id || "";
  const activePermits = (HYDROVAC_PERMITS_CACHE || []).filter((row) => row.job_id === activeJob.id && normalizeWorkflowStatusValue(row.status) === "open");
  const manifestSnapshot = hydrovacJobManifestSnapshot(activeJob.id);
  const driverCompliance = currentDriverId
    ? (HYDROVAC_DRIVER_COMPLIANCE_CACHE || []).find((row) => row.member_id === currentDriverId || row.operator_members?.id === currentDriverId) || null
    : null;
  const truckCompliance = currentTruckId
    ? (HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE || []).find((row) => row.id === currentTruckId) || null
    : null;
  dispatchDetail.innerHTML = `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(activeJob.title || "Untitled hydrovac job")}</strong>
        <span class="pill ${hydrovacManifestToneClass(activeJob.status)}">${escapeHtml(titleCaseWords(String(activeJob.status || "scheduled").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-copy">${escapeHtml(activeJob.customer_name || activeJob.service_address || "Customer not linked")}</div>
      <div class="detail-grid" style="margin-top:12px;">
        <div><span class="muted">Scheduled</span><div>${escapeHtml(activeJob.scheduled_date || targetDate)} ${escapeHtml(activeJob.scheduled_time || "")}</div></div>
        <div><span class="muted">Locate tickets</span><div>${escapeHtml(String(activeLocates.length))}</div></div>
        <div><span class="muted">Open loads</span><div>${escapeHtml(String(manifestSnapshot.openLoads))}</div></div>
        <div><span class="muted">Unbilled disposal</span><div>${formatUsd(manifestSnapshot.unbilledChargeCents)}</div></div>
      </div>
      <div class="detail-grid" style="margin-top:12px;">
        <label>Truck
          <select id="dispatchTruckSelect">
            <option value="">Select truck</option>
            ${(EQUIPMENT_CACHE || []).filter((unit) => unit.is_active !== false).map((unit) => `<option value="${escapeAttr(unit.id)}"${unit.id === currentTruckId ? " selected" : ""}>${escapeHtml(unit.unit_number || unit.name || "Truck")}</option>`).join("")}
          </select>
        </label>
        <label>Driver
          <select id="dispatchDriverSelect">
            <option value="">Select driver</option>
            ${(TEAM_MEMBERS_CACHE || []).map((member) => `<option value="${escapeAttr(member.id)}"${member.id === currentDriverId ? " selected" : ""}>${escapeHtml(teamMemberLabel(member))}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="btnDispatchJobNow" class="btn btn-primary" type="button">${String(activeJob.status || "").toLowerCase() === "dispatched" ? "Refresh dispatch" : "Dispatch job"}</button>
        <button id="btnDispatchOpenJob" class="btn btn-ghost" type="button">Open job</button>
        <button id="btnDispatchOpenLocates" class="btn btn-ghost" type="button">Open locate tickets</button>
        <button id="btnDispatchOpenCompliance" class="btn btn-ghost" type="button">Open compliance</button>
      </div>
      <div id="dispatchMsg" class="msg"></div>
    </div>
  `;
  const dispatchCard = dispatchDetail.querySelector(".detail-card");
  if (dispatchCard) {
    const readiness = [
      { label: "Truck assigned", ok: !!currentTruckId },
      { label: "Driver assigned", ok: !!currentDriverId },
      { label: "Locate coverage", ok: !hydrovacJobNeedsLocate(activeJob) || activeLocates.length > 0 },
      { label: "Permit coverage", ok: !hydrovacJobNeedsPermit(activeJob) || activePermits.length > 0 },
      { label: "Driver docs", ok: !driverCompliance || !(driverCompliance.warnings || []).some((warning) => ["critical", "expired"].includes(String(warning.severity || "").toLowerCase())) },
      { label: "Truck docs", ok: !truckCompliance || !(truckCompliance.warnings || []).some((warning) => ["critical", "expired"].includes(String(warning.severity || "").toLowerCase())) },
    ];
    const readinessEl = document.createElement("div");
    readinessEl.className = "dispatch-readiness";
    readinessEl.innerHTML = readiness.map((item) => `
      <div class="dispatch-readiness__item${item.ok ? "" : " is-blocked"}">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="pill ${item.ok ? "pill-on" : "pill-bad"}">${item.ok ? "Ready" : "Needs work"}</span>
      </div>
    `).join("");
    const secondGrid = dispatchCard.querySelectorAll(".detail-grid")[1];
    if (secondGrid) dispatchCard.insertBefore(readinessEl, secondGrid);
  }
  $("btnDispatchOpenJob")?.addEventListener("click", () => {
    ACTIVE_JOB_ID = activeJob.id;
    switchTab("jobs");
  });
  $("btnDispatchOpenLocates")?.addEventListener("click", () => switchTab("locates"));
  $("btnDispatchOpenCompliance")?.addEventListener("click", () => switchTab("compliance"));
  $("btnDispatchJobNow")?.addEventListener("click", async () => {
    const truckId = $("dispatchTruckSelect")?.value || "";
    const driverId = $("dispatchDriverSelect")?.value || "";
    setInlineMessage($("dispatchMsg"), "Dispatching...");
    try {
      await requestOperatorFunction("dispatch-job", {
        method: "POST",
        body: {
          job_id: activeJob.id,
          assigned_truck_id: truckId,
          driver_member_id: driverId,
          scheduled_date: targetDate,
          scheduled_time: activeJob.scheduled_time || null,
        },
      });
      await Promise.all([fetchJobs(), fetchEquipment(), fetchHydrovacComplianceData()]);
      renderDispatchWorkspace();
      setInlineMessage($("dispatchMsg"), "Job dispatched.", "ok");
    } catch (error) {
      setInlineMessage($("dispatchMsg"), error.message || String(error), "error");
    }
  });
}

// Bookings event handlers
$("btnMyBookings")?.addEventListener("click", () => {
  const current = localStorage.getItem("pl_my_bookings_filter") === "true";
  localStorage.setItem("pl_my_bookings_filter", current ? "false" : "true");
  renderBookings();
});

// â”€â”€ Walk-in booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
$("btnWalkIn")?.addEventListener("click", () => {
  const existing = document.getElementById("walkInModal");
  if (existing) { existing.remove(); return; }
  const modal = document.createElement("div");
  modal.id = "walkInModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  const customerOptions = CUSTOMERS_CACHE.map((c) =>
    `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name || c.email || "Unknown")}</option>`
  ).join("");
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">âš¡ Walk-in booking</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Customer</label>
          <select id="wiCustomer" class="input" style="width:100%;">
            <option value="">-- Select or type name --</option>
            ${customerOptions}
          </select>
        </div>
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Service</label>
          <input id="wiService" class="input" placeholder="e.g. Haircut, Oil change, Dog grooming" style="width:100%;" />
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Price ($)</label>
            <input id="wiPrice" type="number" min="0" step="0.01" class="input" placeholder="0.00" style="width:100%;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Assigned to</label>
            <select id="wiOperator" class="input" style="width:100%;">
              <option value="">Unassigned</option>
              ${(OPERATOR_MEMBERS_CACHE || []).map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.display_name || m.email || m.id)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Notes</label>
          <input id="wiNotes" class="input" placeholder="Optional" style="width:100%;" />
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="wiCancel" class="btn btn-ghost">Cancel</button>
        <button id="wiSave" class="btn btn-primary">Create walk-in</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("wiCancel").onclick = () => modal.remove();
  document.getElementById("wiSave").onclick = async () => {
    const customerId = document.getElementById("wiCustomer").value;
    const service = (document.getElementById("wiService").value || "").trim();
    const price = parseFloat(document.getElementById("wiPrice").value || 0);
    const operatorId = document.getElementById("wiOperator").value;
    const notes = (document.getElementById("wiNotes").value || "").trim();
    if (!service) { notifyOperator("Add a service name first."); return; }
    const btn = document.getElementById("wiSave");
    btn.disabled = true; btn.textContent = "Creatingâ€¦";
    try {
      const tok = await getAccessToken();
      const now = new Date().toISOString();
      const res = await fetch("/.netlify/functions/create-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body: JSON.stringify({
          customer_id         : customerId || undefined,
          title               : service,
          starts_at           : now,
          is_walk_in          : true,
          assigned_operator_id: operatorId || undefined,
          notes,
          skip_confirmation_email: true,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      showToast("Walk-in created.");
      modal.remove();
      await fetchBookings();
      renderBookings();
    } catch (err) {
      showToast("Error: " + err.message);
      btn.disabled = false; btn.textContent = "Create walk-in";
    }
  };
});

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

$("btnLogTime")?.addEventListener("click", () => {
  const existing = document.getElementById("timeLogModal");
  if (existing) { existing.remove(); return; }
  const modal = document.createElement("div");
  modal.id = "timeLogModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";

  // Build open-orders list for the dropdown
  const openOrders = CRM_ORDERS_CACHE.filter((o) => !["paid","cancelled"].includes(String(o.status || "").toLowerCase()));
  const orderOptions = openOrders.map((o) => `<option value="${escapeAttr(o.id)}">${escapeHtml(o.customer_name || o.name || "Order")} â€” ${escapeHtml(o.title || o.id)}</option>`).join("");

  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:440px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 20px;font-size:1rem;color:#e8e9eb;">Log time</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="tlCustomer" class="input" placeholder="Customer name" />
        <input id="tlDescription" class="input" placeholder="Work description" />
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="tlHours" class="input" type="number" min="0" step="0.25" placeholder="Hours" style="width:90px;" />
          <input id="tlRate" class="input" type="number" min="0" step="1" placeholder="Rate ($/hr)" style="flex:1;" />
          <label style="display:flex;align-items:center;gap:5px;font-size:.8rem;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" id="tlBillable" checked /> Billable
          </label>
        </div>
        <input id="tlDate" class="input" type="date" />
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:4px;">Link to order (optional)</label>
          <select id="tlOrderLink" class="input" style="width:100%;">
            <option value="">No order linked</option>
            ${orderOptions}
          </select>
        </div>
      </div>
      <div id="tlMsg" style="font-size:.8rem;margin-bottom:10px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="tlCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
        <button id="tlSave" class="btn btn-primary btn-sm" type="button">Save time entry</button>
      </div>
    </div>`;
  modal.querySelector("#tlDate").value = new Date().toISOString().slice(0, 10);
  modal.querySelector("#tlCancel").onclick = () => modal.remove();
  modal.querySelector("#tlSave").onclick = async () => {
    const customer  = modal.querySelector("#tlCustomer").value.trim();
    const desc      = modal.querySelector("#tlDescription").value.trim();
    const hours     = parseFloat(modal.querySelector("#tlHours").value) || 0;
    const rate      = parseFloat(modal.querySelector("#tlRate").value) || 0;
    const date      = modal.querySelector("#tlDate").value;
    const billable  = modal.querySelector("#tlBillable").checked;
    const orderId   = modal.querySelector("#tlOrderLink").value;
    const msgEl     = modal.querySelector("#tlMsg");
    if (!hours || !desc) { msgEl.textContent = "Enter hours and description."; msgEl.style.color = "#f87171"; return; }
    const amountCents = billable ? Math.round(hours * rate * 100) : 0;
    const payload = {
      tenant_id   : TENANT_ID,
      operator_id : opId(),
      customer    : customer || "Time entry",
      description : desc,
      hours,
      rate_per_hour: rate,
      billable,
      amount_cents : amountCents,
      date,
      order_id    : orderId || undefined,
    };
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/log-time-entry", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to save time entry");
      if (d.entry) TIME_ENTRIES_CACHE = [...TIME_ENTRIES_CACHE, d.entry];
      msgEl.textContent = `âœ“ Logged ${hours}h${billable && rate ? ` = $${(amountCents / 100).toFixed(2)} billable` : ''}`;
      msgEl.style.color = "#4ade80";
      setTimeout(() => modal.remove(), 1500);
    } catch (err) {
      msgEl.textContent = err.message || "Failed to save.";
      msgEl.style.color = "#f87171";
    }
  };
  document.body.appendChild(modal);
});

$("btnCopyBookingLink")?.addEventListener("click", () => {
  const link = $("bookingLinkDisplay")?.textContent?.trim();
  if (!link || link === "â€”") return;
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

// Recurrence UI: show/hide options and compute count
(function initRecurrenceUI() {
  const ruleEl = $("bkRecurrenceRule");
  const optEl  = $("bkRecurrenceOptions");
  const endEl  = $("bkRecurrenceEnd");
  const cntEl  = $("bkRecurrenceCount");
  if (!ruleEl) return;

  function computeRecurrenceCount() {
    const rule = ruleEl.value;
    const endDate = endEl?.value;
    if (!rule || !endDate) { if (cntEl) cntEl.textContent = "â€”"; return; }
    const baseDate = $("bkDate")?.value;
    if (!baseDate) { if (cntEl) cntEl.textContent = "â€”"; return; }
    const start = new Date(baseDate + "T00:00:00");
    const end   = new Date(endDate + "T00:00:00");
    if (end <= start) { if (cntEl) cntEl.textContent = "End date must be after start date."; return; }
    const intervalDays = rule === "DAILY" ? 1 : rule === "WEEKLY" ? 7 : rule === "BIWEEKLY" ? 14 : 30;
    let count = 0;
    let cur = new Date(start.getTime() + intervalDays * 86400000);
    while (cur <= end) { count++; cur = new Date(cur.getTime() + intervalDays * 86400000); }
    if (cntEl) cntEl.textContent = `${count} recurring instance${count === 1 ? "" : "s"} will be created`;
  }

  ruleEl.addEventListener("change", () => {
    if (optEl) optEl.style.display = ruleEl.value ? "block" : "none";
    computeRecurrenceCount();
  });
  endEl?.addEventListener("change", computeRecurrenceCount);
  $("bkDate")?.addEventListener("change", computeRecurrenceCount);
})();

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
  const recurrenceRule = $("bkRecurrenceRule")?.value || "";
  const recurrenceEnd  = $("bkRecurrenceEnd")?.value  || "";

  if (msg) { msg.textContent = ""; msg.className = "msg"; }
  if (!name || !title || !date || !time) {
    if (msg) { msg.textContent = "Please fill in all required fields."; msg.className = "msg error"; }
    return;
  }

  const startsAt = new Date(`${date}T${time}:00`).toISOString();
  const endsAt   = new Date(new Date(startsAt).getTime() + dur * 60000).toISOString();

  btn.disabled = true;
  if (msg) { msg.textContent = "Savingâ€¦"; msg.className = "msg"; }
  try {
    const tok = await getAccessToken();
    const payload = { customer_name: name, customer_email: email || undefined, title, starts_at: startsAt, ends_at: endsAt, notes: notes || undefined };
    if (recurrenceRule) { payload.recurrence_rule = recurrenceRule; if (recurrenceEnd) payload.recurrence_end_date = recurrenceEnd; }
    const res = await fetch("/.netlify/functions/create-booking", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body   : JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to save booking");

    // Handle recurrence
    if (recurrenceRule && recurrenceEnd && d.booking?.id) {
      try {
        const rRes = await fetch("/.netlify/functions/create-recurring-bookings", {
          method : "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
          body   : JSON.stringify({ booking_id: d.booking.id, recurrence_rule: recurrenceRule, recurrence_end_date: recurrenceEnd }),
        });
        const rData = await rRes.json().catch(() => ({}));
        const n = rData.count || 0;
        if (msg) { msg.textContent = `âœ“ Booked + ${n} recurring instance${n === 1 ? "" : "s"} created.`; msg.className = "msg success"; }
        showToast(`Booked + ${n} recurring instance${n === 1 ? "" : "s"} created.`);
      } catch (_) {
        if (msg) { msg.textContent = "âœ“ Booking saved! (Recurring instances may have failed.)"; msg.className = "msg success"; }
      }
    } else {
      if (msg) { msg.textContent = "âœ“ Booking saved!"; msg.className = "msg success"; }
    }

    // Reset form
    ["bkCustomerName","bkCustomerEmail","bkTitle","bkNotes"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    const ruleEl = $("bkRecurrenceRule"); if (ruleEl) ruleEl.value = "";
    const optEl  = $("bkRecurrenceOptions"); if (optEl) optEl.style.display = "none";
    const endEl  = $("bkRecurrenceEnd"); if (endEl) endEl.value = "";
    btn.disabled = false;
    await renderBookings();
    setTimeout(() => { const form = $("newBookingForm"); if (form) form.classList.add("hidden"); }, 1200);
  } catch (err) {
    if (msg) { msg.textContent = err.message || "Error saving."; msg.className = "msg error"; }
    btn.disabled = false;
  }
});

// â”€â”€ End Bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchCustomers() {
  if (FETCHING.has('customers')) return;
  FETCHING.add('customers');
  try {
    const { count, error: countError } = await scopeQuery(sb
      .from("customers")
      .select('*', { count: 'exact', head: true }))
      .eq('is_deleted', false);
    if (countError) {
      if (countError.name === 'AbortError' || countError.message?.includes('abort')) return;
      console.error('[fetchCustomers count]', countError);
    } else {
      CUSTOMERS_TOTAL_COUNT = count || 0;
    }

    const { data, error } = await scopeQuery(sb
      .from("customers")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .eq('is_deleted', false)
      .order("lifetime_value_cents", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(FETCH_OFFSETS.customers, FETCH_OFFSETS.customers + PAGE_SIZE - 1);

    if (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) return;
      console.error('[fetchCustomers]', error);
      return;
    }
    if (FETCH_OFFSETS.customers === 0) {
      CUSTOMERS_CACHE = data || [];
    } else {
      CUSTOMERS_CACHE = [...CUSTOMERS_CACHE, ...(data || [])];
    }
    TABS_LOADED.delete('customers');
    return CUSTOMERS_CACHE;
  } finally {
    FETCHING.delete('customers');
  }
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

const CUSTOMER_INTERACTION_OPTIONS = [
  { value: "note", label: "General note", placeholder: "What happened with this customer?" },
  { value: "call", label: "Phone call", placeholder: "What was discussed on the call?" },
  { value: "text", label: "Text message", placeholder: "What did you text or learn by text?" },
  { value: "email", label: "Email", placeholder: "What was sent or answered by email?" },
  { value: "voicemail", label: "Voicemail", placeholder: "What message was left or received?" },
  { value: "onsite", label: "On-site visit", placeholder: "What happened at the property or visit?" },
  { value: "quote", label: "Quote or bid", placeholder: "What changed with the quote or bid?" },
  { value: "follow_up", label: "Follow-up", placeholder: "What follow-up happened or is needed next?" },
  { value: "issue", label: "Issue or complaint", placeholder: "What problem or concern came up?" },
  { value: "payment", label: "Payment", placeholder: "What happened with payment or collection?" },
  { value: "order", label: "Order or job", placeholder: "What changed on the order or job?" },
  { value: "internal", label: "Internal note", placeholder: "What should the team remember internally?" },
];

function customerInteractionLabel(type) {
  const match = CUSTOMER_INTERACTION_OPTIONS.find((option) => option.value === String(type || "").trim());
  if (match) return match.label;
  return String(type || "note")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function customerInteractionPlaceholder(type) {
  return CUSTOMER_INTERACTION_OPTIONS.find((option) => option.value === String(type || "").trim())?.placeholder
    || "What happened with this customer?";
}

function customerInteractionOptionsMarkup(selected = "note") {
  return CUSTOMER_INTERACTION_OPTIONS.map((option) => (
    `<option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
}

async function fetchLeads() {
  if (FETCHING.has('leads')) return;
  FETCHING.add('leads');
  try {
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
  } finally {
    FETCHING.delete('leads');
  }
}
async function fetchCrmOrders() {
  if (FETCHING.has('orders')) return;
  FETCHING.add('orders');
  try {
    const { count, error: countError } = await scopeQuery(sb
      .from("orders")
      .select('*', { count: 'exact', head: true }))
      .eq('is_deleted', false);
    if (countError) {
      if (countError.name === 'AbortError' || countError.message?.includes('abort')) return;
      console.error('[fetchCrmOrders count]', countError);
    } else {
      ORDERS_TOTAL_COUNT = count || 0;
    }

    const { data, error } = await scopeQuery(sb
      .from("orders")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .eq('is_deleted', false)
      .order("created_at", { ascending: false })
      .range(FETCH_OFFSETS.orders, FETCH_OFFSETS.orders + PAGE_SIZE - 1);

    if (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) return;
      console.error('[fetchCrmOrders]', error);
      return;
    }
    if (FETCH_OFFSETS.orders === 0) {
      CRM_ORDERS_CACHE = data || [];
    } else {
      CRM_ORDERS_CACHE = [...CRM_ORDERS_CACHE, ...(data || [])];
    }
    TABS_LOADED.delete('orders');
    return CRM_ORDERS_CACHE;
  } finally {
    FETCHING.delete('orders');
  }
}
async function fetchPersistedBids() {
  if (FETCHING.has('bids')) return;
  FETCHING.add('bids');
  try {
    const { data, error } = await scopeQuery(sb
      .from("bids")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .order("updated_at", { ascending: false })
      .limit(250);

    if (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) return;
      if (isMissingDatabaseFeatureError(error, ["bids"])) return [];
      console.error('[fetchPersistedBids]', error);
      return;
    }
    return data || [];
  } finally {
    FETCHING.delete('bids');
  }
}
async function fetchPayments() {
  if (FETCHING.has('payments')) return;
  FETCHING.add('payments');
  try {
    const { data, error } = await scopeQuery(sb
      .from("payments")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) return;
      console.error('[fetchPayments]', error);
      return;
    }
    PAYMENTS_CACHE = data || [];
    return PAYMENTS_CACHE;
  } finally {
    FETCHING.delete('payments');
  }
}
async function fetchJobs() {
  if (FETCHING.has('jobs')) return;
  FETCHING.add('jobs');
  try {
    const { data, error } = await scopeQuery(sb
      .from("jobs")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) return;
      if (isMissingDatabaseFeatureError(error, ["jobs"])) {
        JOBS_CACHE = [];
        return JOBS_CACHE;
      }
      console.error('[fetchJobs]', error);
      return;
    }
    JOBS_CACHE = data || [];
    TABS_LOADED.delete('jobs');
    return JOBS_CACHE;
  } finally {
    FETCHING.delete('jobs');
  }
}
async function fetchServicePlans() {
  if (FETCHING.has('service_plans')) return;
  FETCHING.add('service_plans');
  try {
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
  } finally {
    FETCHING.delete('service_plans');
  }
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
customerSearch?.addEventListener("input", debounce(() => renderCustomersList(customerSearch.value)));
btnRefreshCustomers?.addEventListener("click", async () => {
  try {
    await Promise.all([fetchCustomers(), fetchCrmOrders(), fetchPayments()]);
    renderCustomersList(customerSearch?.value || "");
  } catch (err) {
    notifyOperator(err.message || String(err));
  }
});

btnRefreshPayments?.addEventListener("click", async () => {
  try {
    await fetchPayments();
    renderPayments();
  } catch (err) {
    notifyOperator(err.message || String(err));
  }
});

function populateCustomerForm(customer = null) {
  if (customerFormTitle) customerFormTitle.textContent = customer?.id ? "Edit customer" : "New customer";
  if (customerId) customerId.value = customer?.id || "";
  if (customerName) customerName.value = customer?.name || "";
  if (customerEmail) customerEmail.value = customer?.email || "";
  if (customerPhone) customerPhone.value = customer?.phone || "";
  if (customerPreferredContact) customerPreferredContact.value = customer?.preferred_contact || "email";
  if (customerNotes) customerNotes.value = customer?.notes || "";
  if (customerAddress1) customerAddress1.value = customer?.address_line1 || "";
  if (customerCity) customerCity.value = customer?.city || "";
  if (customerState) customerState.value = customer?.state || "";
  if (customerZip) customerZip.value = customer?.zip || "";
  if (btnClearCustomerForm) btnClearCustomerForm.textContent = customer?.id ? "New customer" : "Clear form";
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

  if (CUSTOMERS_CACHE.length < CUSTOMERS_TOTAL_COUNT) {
    const remaining = CUSTOMERS_TOTAL_COUNT - CUSTOMERS_CACHE.length;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'width:100%;margin-top:12px;';
    btn.textContent = `Load ${Math.min(PAGE_SIZE, remaining)} more (${CUSTOMERS_CACHE.length} of ${CUSTOMERS_TOTAL_COUNT} shown)`;
    btn.addEventListener('click', async () => {
      FETCH_OFFSETS.customers += PAGE_SIZE;
      btn.disabled = true;
      btn.textContent = 'Loadingâ€¦';
      await fetchCustomers();
      renderCustomersList(customerSearch?.value || "");
    });
    customersList.appendChild(btn);
  }

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
  return renderCustomerDetailWorkspace(customerIdValue, customer);
}
function customerInputPayload(fields = {}) {
  const name = String(fields.name || "").trim();
  const email = String(fields.email || "").trim();
  const phone = String(fields.phone || "").trim();
  const addressLine1 = String(fields.address_line1 || "").trim();
  const city = String(fields.city || "").trim();
  const state = String(fields.state || "").trim().toUpperCase();
  const zip = String(fields.zip || "").trim();
  return {
    id: fields.id || null,
    name: name || email || phone || "Customer",
    email: email || null,
    phone: phone || null,
    preferred_contact: fields.preferred_contact || "email",
    notes: String(fields.notes || "").trim(),
    address_line1: addressLine1 || null,
    city: city || null,
    state: state || null,
    zip: zip || null,
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
    address_line1: input.address_line1,
    city: input.city,
    state: input.state,
    zip: input.zip,
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
  const shouldAddAnother = CUSTOMER_SAVE_ADD_ANOTHER;
  CUSTOMER_SAVE_ADD_ANOTHER = false;

  const emailVal = (customerEmail?.value || '').trim().toLowerCase();
  const custId   = customerId?.value || null;
  if (emailVal) {
    const dup = CUSTOMERS_CACHE.find((c) => c.email?.toLowerCase() === emailVal && c.id !== custId);
    if (dup) {
      setInlineMessage(customerMsg, `A customer with email ${emailVal} already exists: ${dup.name || 'unnamed'}. Open their record instead.`, 'error');
      return;
    }
  }

  try {
      await saveCustomerRecord({
        id: customerId?.value || null,
        name: customerName?.value,
        email: customerEmail?.value,
        phone: customerPhone?.value,
        preferred_contact: customerPreferredContact?.value,
        notes: customerNotes?.value,
        address_line1: customerAddress1?.value || undefined,
        city: customerCity?.value || undefined,
        state: customerState?.value || undefined,
        zip: customerZip?.value || undefined,
      });
      markWorkspaceClean("customers");
      if (shouldAddAnother) {
        startNewCustomer();
        setInlineMessage(customerMsg, "Customer saved. Ready for the next one.", "ok");
        customerName?.focus?.();
      } else {
        setInlineMessage(customerMsg, "Customer saved.", "ok");
      }
    } catch (err) {
    setInlineMessage(customerMsg, err.message || String(err), "error");
  }
});
btnNewCustomer?.addEventListener("click", startNewCustomer);
btnSaveAndAddCustomer?.addEventListener("click", () => {
  CUSTOMER_SAVE_ADD_ANOTHER = true;
  customerForm?.requestSubmit?.();
});
btnClearCustomerForm?.addEventListener("click", startNewCustomer);

leadSearch?.addEventListener("input", debounce(() => renderLeads(leadSearch.value)));
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
    setBidWorkspaceBootstrapping(true, "Opening proposal workspace...");
    let localDraft = null;
    if (!lead.converted_bid_id) {
      localDraft = bidDraftFromLeadRecord(lead, preferredBidProfile());
      BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== localDraft.id), localDraft]
        .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
      persistBidDrafts();
      ACTIVE_BID_ID = localDraft.id;
      renderBids(bidSearch?.value || "");
    }
    switchTab("bids", { force: true });
    setInlineMessage(bidMsg, "Opening proposal workspace...");
    const result = await createBidFromLeadRecord(lead, {
      profile: preferredBidProfile(),
      localDraftId: localDraft?.id || "",
    });
    const target = result?.bid || BIDS_CACHE[0] || null;
    if (target) ACTIVE_BID_ID = target.id;
    setBidWorkspaceBootstrapping(false);
    renderBids(bidSearch?.value || "", localDraft ? { preserveForm: true } : {});
    renderLeads(leadSearch?.value || "");
    markWorkspaceClean("leads");
    setInlineMessage(leadMsg, result?.existing ? "Linked bid opened." : "Lead converted into a bid.", "ok");
    const currentBidMessage = String(bidMsg?.textContent || "").trim().toLowerCase();
    if (!currentBidMessage || currentBidMessage.includes("opening proposal workspace")) {
      setInlineMessage(bidMsg, result?.existing ? "Linked proposal opened." : "Proposal draft ready.", "ok");
    }
  } catch (err) {
    setBidWorkspaceBootstrapping(false);
    setInlineMessage(leadMsg, err.message || String(err), "error");
    setInlineMessage(bidMsg, err.message || String(err), "error");
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
jobSearch?.addEventListener("input", debounce(() => renderJobs(jobSearch.value)));
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
// Hydrovac live preview
['jobBillableHours','jobMinimumHours','jobTruckRate','jobOperatorRate',
 'jobAfterHoursMultiplier','jobMobilizationFee','jobDisposalCost'].forEach(id => {
  $(id)?.addEventListener('input', updateHydrovacPreview);
});
jobMainServiceType?.addEventListener('change', () => {
  const value = String(jobMainServiceType.value || '').trim();
  toggleHydrovacFields(value);
  if (value === 'hydrovac' && jobServiceType && !String(jobServiceType.value || '').trim()) {
    applyHydrovacJobTemplate('hydrovac_4hr_laborer_minimum', {
      preserveExisting: true,
    });
  }
});
jobServiceType?.addEventListener('change', () => {
  const templateKey = String(jobServiceType.value || '').trim();
  if (HYDROVAC_JOB_TEMPLATE_LIBRARY[templateKey]) {
    applyHydrovacJobTemplate(templateKey, {
      preserveExisting: false,
    });
  } else {
    updateHydrovacPreview();
  }
});
// Auto-fill truck rate when equipment is selected
jobEquipmentId?.addEventListener('change', () => {
  const eq = EQUIPMENT_CACHE.find(e => e.id === jobEquipmentId.value);
  if (eq?.hourly_rate_cents && jobTruckRate && !jobTruckRate.value) {
    jobTruckRate.value = (eq.hourly_rate_cents / 100).toFixed(0);
    updateHydrovacPreview();
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
planSearch?.addEventListener("input", debounce(() => renderPlans(planSearch.value)));
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
    bakery: "bakery_custom_orders",
    contractor: "contractor_remodeling",
    contractor_remodeling: "contractor_remodeling",
    cleaning: "cleaning_services",
    events: "event_planning",
    handyman: "handyman_punchlist",
    pressure_washing: "pressure_washing",
    hvac: "hvac",
    landscaping: "landscaping_maintenance",
    lawn_care: "landscaping_maintenance",
    pet_services: "pet_care_services",
    photography: "photography_sessions",
    plumbing: "plumbing",
    property_maintenance: "property_maintenance",
    hydrovac: "hydrovac_vactor",
    vactor: "hydrovac_vactor",
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
    product_id: item.product_id || base.product_id || "",
    pricing_source: item.pricing_source || base.pricing_source || "job_specific",
  };
}
function formatBidStatus(status) {
  const labels = {
    draft: "Draft",
    walkthrough_complete: "Walkthrough complete",
    ready_to_send: "Ready to send",
    sent: "Quoted / awaiting approval",
    approved: "Approved",
    declined: "Declined",
    converted: "Converted",
  };
  return labels[String(status || "").trim().toLowerCase()] || (status ? String(status) : "Draft");
}
function formatOrderWorkflowStatus(status) {
  const labels = {
    new: "New request",
    quoted: "Quoted / awaiting approval",
    confirmed: "Approved / booked",
    fulfilled: "Work finished",
    completed: "Completed",
    paid: "Paid",
    cancelled: "Cancelled",
  };
  return labels[String(status || "").trim().toLowerCase()] || titleCaseWords(String(status || "new"));
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
function bidDraftFromLeadRecord(lead, profileKey = preferredBidProfile(), seedDraft = null) {
  const profile = normalizeBidProfile(profileKey);
  const baseDraft = seedDraft
    ? cloneJson(seedDraft, {})
    : emptyBidDraft(profile);
  const nowIso = new Date().toISOString();
  return {
    ...baseDraft,
    title: String(lead?.title || lead?.requested_service_type || baseDraft.title || "Service proposal").trim(),
    customer_id: lead?.customer_id || baseDraft.customer_id || "",
    lead_id: lead?.id || baseDraft.lead_id || "",
    profile,
    status: String(baseDraft.status || "draft"),
    walkthrough_at: baseDraft.walkthrough_at || nowIso,
    service_address: lead?.service_address || baseDraft.service_address || "",
    site_contact: lead?.contact_name || baseDraft.site_contact || "",
    project_summary: lead?.summary || baseDraft.project_summary || "",
    internal_notes: lead?.notes || baseDraft.internal_notes || "",
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
function setBidWorkspaceBootstrapping(pending, message = "") {
  BID_WORKSPACE_BOOTSTRAPPING = !!pending;
  if (bidForm) {
    bidForm.hidden = !!pending;
    bidForm.setAttribute("aria-busy", pending ? "true" : "false");
  }
  const host = bidForm?.parentElement;
  if (!host) return;
  let state = host.querySelector("#bidWorkspaceBootstrappingState");
  if (!state) {
    state = document.createElement("div");
    state.id = "bidWorkspaceBootstrappingState";
    state.className = "detail-copy";
    state.style.marginBottom = "14px";
    host.insertBefore(state, bidForm || null);
  }
  state.hidden = !pending;
  state.textContent = pending ? (message || "Opening proposal workspace...") : "";
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
async function applyBidProfileStructure(force = false) {
  const active = currentBid();
  if (!active) return null;
  const profile = bidProfileConfig(bidProfile?.value || active.profile);
  const hasCustomLineItems = Array.isArray(active.line_items) && active.line_items.length > 0;
  if (force && hasCustomLineItems && !(await showConfirmModal("Replace the current line items with the starter service structure?", "Replace items", "Keep current items"))) {
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
      copy: isServiceWorkspace(currentWorkspaceBlueprint())
        ? "Once the proposal is real, move it into quoted / booked work so the rest of the business can manage it without relying on memory."
        : "Once the proposal is real, convert it into a tracked order so the rest of the business can manage it without relying on memory.",
      done: !!draft?.converted_order_id,
      actionLabel: draft?.converted_order_id
        ? (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Open quoted / booked" : "Open order")
        : (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Move to quoted / booked" : "Create tracked order"),
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
function addBidCatalogStarter(productId) {
  let active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const product = PRODUCTS_CACHE.find((row) => row.id === productId);
  const pricingRow = currentPricingRow(productId);
  if (!product) return null;

  const existing = (active.line_items || []).find((item) => item.product_id === productId);
  if (existing) {
    populateBidLineItemForm(existing);
    setInlineMessage(bidLineItemMsg, `${product.name} is already on this bid. Adjust the company-standard price if this job needs a custom number.`, "ok");
    bidLineItemUnitPrice?.focus();
    return existing;
  }

  const mode = normalizePricingModeForUi(pricingRow || product);
  const nextItem = mergeBidLineItem({}, {
    name: product.name || "Service line item",
    description: product.description || "",
    quantity: 1,
    unit: pricingRow?.unit_label || "job",
    unit_price_cents: mode === "quote" ? 0 : pricingAmountForUi(pricingRow || product),
    kind: "base",
    template_key: `catalog:${productId}`,
    product_id: productId,
    pricing_source: "company_standard",
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
  setInlineMessage(bidLineItemMsg, `${product.name} loaded from company-standard pricing. Adjust the number if this specific job needs a custom price.`, "ok");
  bidLineItemUnitPrice?.focus();
  return nextItem;
}
function renderBidCatalogStarters(draft) {
  if (!bidCatalogStarters) return;
  const activeServices = PRODUCTS_CACHE
    .filter((row) => !!row.is_active && !!row.is_available)
    .map((row) => ({
      product: row,
      pricing: currentPricingRow(row.id),
    }))
    .filter(({ product, pricing }) => !!product && (!!pricing || ["fixed", "starts_at", "quote"].includes(String(product.pricing_mode || "").toLowerCase())))
    .slice(0, 16);

  if (!activeServices.length) {
    bidCatalogStarters.innerHTML = `<div class="muted">Company-standard services will appear here once the service catalog has live offerings.</div>`;
    return;
  }

  const activeProductIds = new Set((draft?.line_items || []).map((item) => item.product_id).filter(Boolean));
  bidCatalogStarters.innerHTML = `
    <div class="bid-template-panel__top">
      <div>
        <strong>Company-standard pricing</strong>
        <div class="bid-template-panel__copy">Tap a live service to drop your standard pricing into this bid, then tighten it for the specific job without rebuilding the line item from scratch.</div>
      </div>
    </div>
    <div class="bid-template-grid">
      ${activeServices.map(({ product, pricing }) => `
        <button class="bid-template-card ${activeProductIds.has(product.id) ? "is-added" : ""}" type="button" data-bid-catalog-starter="${escapeAttr(product.id)}">
          <div class="bid-template-card__kicker">${escapeHtml(product.category || "Service")}</div>
          <div class="bid-template-card__title">${escapeHtml(product.name || "Service")}</div>
          <div class="bid-template-card__copy">${escapeHtml(pricingSummaryForRow(pricing || product))}</div>
          <div class="bid-template-card__meta">
            <span class="pill">${escapeHtml((pricing?.unit_label || "job").toString())}</span>
            <span class="pill ${activeProductIds.has(product.id) ? "pill-on" : ""}">${activeProductIds.has(product.id) ? "Added" : "Use standard"}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
  bidCatalogStarters.querySelectorAll("[data-bid-catalog-starter]").forEach((btn) => {
    btn.addEventListener("click", () => addBidCatalogStarter(btn.getAttribute("data-bid-catalog-starter")));
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
        <div class="bid-stat__label">${escapeHtml(isServiceWorkspace(currentWorkspaceBlueprint()) ? "Quoted / booked work" : "Tracked order")}</div>
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
  bidsList.innerHTML = `<div class="muted">${BIDS_CACHE.length ? "No walkthrough bids match this search." : "No walkthrough bids yet. Click New quote to start the first one."}</div>`;
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
          ${row.converted_order_id ? `<span class="pill pill-on">${escapeHtml(isServiceWorkspace(currentWorkspaceBlueprint()) ? "Quoted / booked" : "Tracked order")}</span>` : ""}
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
        <div class="inline">
          <span class="pill pill-on">${escapeHtml(formatBidLineItemKind(item.kind))}</span>
          <span class="pill ${item.pricing_source === "company_standard" ? "pill-on" : "pill-muted"}">${item.pricing_source === "company_standard" ? "Company standard" : "Job specific"}</span>
        </div>
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
  renderProposalWorkspace();
  if (!BID_WORKSPACE_BOOTSTRAPPING) setBidWorkspaceBootstrapping(false);
  if (!draft) {
    clearBidForm();
    if (btnConvertBidToOrder) {
      btnConvertBidToOrder.textContent = isServiceWorkspace(currentWorkspaceBlueprint()) ? "Move to quoted / booked work" : "Create tracked order";
      btnConvertBidToOrder.disabled = true;
    }
    renderBidQuickCustomerCard(null);
    renderBidGuideFlow(null);
    renderBidProfileGuideCard(null);
    renderBidPhotoGuide(null);
    renderBidScopeStarters(null);
    renderBidCatalogStarters(null);
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
    btnConvertBidToOrder.textContent = linkedOrder
      ? (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Open quoted / booked work" : "Open tracked order")
      : (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Move to quoted / booked work" : "Create tracked order");
  }
  renderBidQuickCustomerCard(draft);
  renderBidGuideFlow(draft);
  renderBidProfileGuideCard(draft);
  renderBidPhotoGuide(draft);
  renderBidScopeStarters(draft);
  renderBidCatalogStarters(draft);
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
bidSearch?.addEventListener("input", debounce(() => renderBids(bidSearch.value, { preserveForm: true })));
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
  setInlineMessage(bidMsg, isServiceWorkspace(currentWorkspaceBlueprint()) ? "Moving quote into quoted / booked work..." : "Creating tracked order...");
  try {
    const result = await convertBidToTrackedOrder();
    renderBids(bidSearch?.value || "", { preserveForm: true });
    setInlineMessage(
      bidMsg,
      result.existed
        ? (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Quoted / booked work already existed. Opening it next." : "Tracked order already existed. Opening Orders next.")
        : (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Quote moved into quoted / booked work. Opening it next." : "Tracked order created. Opening Orders next."),
      "ok",
    );
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
  setInlineMessage(bidMsg, "Bid saved locally. Syncing...", "ok");
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
$("btnEmailBidToCustomer")?.addEventListener("click", async () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first.", "error");
    return;
  }
  const customer = findBidCustomer(active.customer_id);
  if (!customer?.email) {
    setInlineMessage(bidMsg, "Add a customer with an email address before sending.", "error");
    return;
  }
  const btn = $("btnEmailBidToCustomer");
  if (btn) btn.disabled = true;
  setInlineMessage(bidMsg, "Sendingâ€¦", "ok");
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/send-bid-email", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body   : JSON.stringify({ bid_id: active.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to send");
    setInlineMessage(bidMsg, `âœ“ Proposal emailed to ${customer.email}`, "ok");
    // Update local cache status
    const idx = BIDS_CACHE.findIndex((r) => r.id === active.id);
    if (idx >= 0) BIDS_CACHE[idx] = { ...BIDS_CACHE[idx], status: "sent" };
    renderBids(bidSearch?.value || "");
  } catch (err) {
    setInlineMessage(bidMsg, err.message || "Error sending.", "error");
  }
  if (btn) btn.disabled = false;
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
      title: stale ? "Recover a missed request" : (urgentLead.converted_bid_id ? "Follow up active request" : "Work the next request"),
      detail: `${urgentLead.contact_name || urgentLead.title || "Request"} | ${String(urgentLead.status || "new").replace(/_/g, " ")} | ${ageLabelFromTime(leadLastTouchedAt(urgentLead))}`,
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
function orderHasLinkedJob(order) {
  if (!order?.id) return false;
  return JOBS_CACHE.some((job) => job.order_id === order.id || job.id === order.primary_job_id);
}
function workCommandItems() {
  const staleLead = [...staleLeads()].sort((a, b) => leadLastTouchedAt(a) - leadLastTouchedAt(b))[0] || null;
  const liveBid = [...BIDS_CACHE]
    .filter((row) => !row.converted_order_id && !["declined", "expired", "converted"].includes(String(row.status || "").toLowerCase()))
    .sort((a, b) => new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime())[0] || null;
  const bookedWithoutJob = [...CRM_ORDERS_CACHE]
    .filter((row) => ["confirmed", "fulfilled"].includes(String(row.status || "").toLowerCase()))
    .filter((row) => !orderHasLinkedJob(row))
    .sort((a, b) => new Date(a.scheduled_date || a.created_at || 0).getTime() - new Date(b.scheduled_date || b.created_at || 0).getTime())[0] || null;
  const activeJob = [...JOBS_CACHE]
    .filter((row) => ["blocked", "scheduled", "dispatched", "in_progress"].includes(String(row.status || "").toLowerCase()))
    .sort((a, b) => new Date(a.scheduled_date || a.created_at || 0).getTime() - new Date(b.scheduled_date || b.created_at || 0).getTime())[0] || null;
  const collectionRisk = [...CRM_ORDERS_CACHE]
    .filter((row) => orderAmountDueCents(row) > 0 && ["unpaid", "partially_paid", "overdue"].includes(orderPaymentState(row)))
    .sort((a, b) => {
      const stateA = orderPaymentState(a) === "overdue" ? 0 : 1;
      const stateB = orderPaymentState(b) === "overdue" ? 0 : 1;
      if (stateA !== stateB) return stateA - stateB;
      return new Date(a.payment_due_date || a.created_at || 0).getTime() - new Date(b.payment_due_date || b.created_at || 0).getTime();
    })[0] || null;

  return [
    staleLead ? {
      title: "Requests waiting on you",
      count: staleLeads().length,
      detail: `${staleLead.contact_name || staleLead.title || "Request"} | ${ageLabelFromTime(leadLastTouchedAt(staleLead))}`,
      action: "Open request",
      tab: "leads",
      targetId: staleLead.id,
      tone: staleLeads().length ? "pill-bad" : "",
    } : null,
    liveBid ? {
      title: "Quotes waiting to move",
      count: BIDS_CACHE.filter((row) => !row.converted_order_id && !["declined", "expired", "converted"].includes(String(row.status || "").toLowerCase())).length,
      detail: `${liveBid.title || "Proposal"} | ${formatBidStatus(liveBid.status)}`,
      action: "Open quote",
      tab: "bids",
      targetId: liveBid.id,
      tone: "",
    } : null,
    bookedWithoutJob ? {
      title: "Booked work not yet in the field",
      count: CRM_ORDERS_CACHE.filter((row) => ["confirmed", "fulfilled"].includes(String(row.status || "").toLowerCase()) && !orderHasLinkedJob(row)).length,
      detail: `${bookedWithoutJob.customer_name || "Customer"} | ${formatUsd(Number(bookedWithoutJob.total_cents || 0))} booked`,
      action: "Open work",
      tab: "orders",
      targetId: bookedWithoutJob.id,
      tone: "",
    } : null,
    activeJob ? {
      title: "Field work still moving",
      count: JOBS_CACHE.filter((row) => ["blocked", "scheduled", "dispatched", "in_progress"].includes(String(row.status || "").toLowerCase())).length,
      detail: `${activeJob.title || "Job"} | ${String(activeJob.status || "scheduled").replace(/_/g, " ")}`,
      action: "Open job",
      tab: "jobs",
      targetId: activeJob.id,
      tone: String(activeJob.status || "").toLowerCase() === "blocked" ? "pill-bad" : "",
    } : null,
    collectionRisk ? {
      title: "Money still tied to live work",
      count: CRM_ORDERS_CACHE.filter((row) => orderAmountDueCents(row) > 0 && ["unpaid", "partially_paid", "overdue"].includes(orderPaymentState(row))).length,
      detail: `${collectionRisk.customer_name || "Customer"} | ${formatUsd(orderAmountDueCents(collectionRisk))} due`,
      action: "Open money item",
      tab: "orders",
      targetId: collectionRisk.id,
      tone: orderPaymentState(collectionRisk) === "overdue" ? "pill-bad" : "",
    } : null,
  ].filter(Boolean).slice(0, 4);
}
function renderTodayFocusSection({ todayActions = [], followUps = [], staleLeadRows = [], duePlans = [], depositRiskOrders = [], completedUnpaid = [], blueprint }) {
  const fallbackActions = [
    { label: "Add a customer", action: "new-customer" },
    { label: "Create a request", action: "new-lead" },
    { label: `Draft ${workspaceBidLabel(blueprint)}`, action: "new-bid" },
    { label: "Record payment", action: "record-payment" },
  ];
  const primary = todayActions[0] || null;
  const secondary = todayActions.slice(1, 3);
  const cleanup = [
    staleLeadRows.length ? `${staleLeadRows.length} request${staleLeadRows.length === 1 ? "" : "s"} waiting 24h+` : null,
    depositRiskOrders.length ? `${depositRiskOrders.length} booked job${depositRiskOrders.length === 1 ? "" : "s"} still missing deposit coverage` : null,
    completedUnpaid.length ? `${completedUnpaid.length} completed item${completedUnpaid.length === 1 ? "" : "s"} still unpaid` : null,
    duePlans.length ? `${duePlans.length} recurring plan${duePlans.length === 1 ? "" : "s"} due now` : null,
    followUps.length ? `${followUps.length} safe follow-up${followUps.length === 1 ? "" : "s"} queued` : null,
  ].filter(Boolean).slice(0, 4);

  return `
    <div class="workflow-focus">
      <div class="workflow-focus__head">
        <div>
          <div class="kicker">Operating rhythm</div>
          <h3>Start with the next move that actually changes the business.</h3>
          <p>Use Today to see what needs action now, what should move next, and what needs cleanup before it turns into friction later.</p>
        </div>
        <div class="workspace-chip-row">
          ${fallbackActions.map((item) => `<button type="button" class="pipeline-action-chip" data-dashboard-action="${escapeAttr(item.action)}">${escapeHtml(item.label)}</button>`).join("")}
        </div>
      </div>
      <div class="workflow-focus__grid">
        <div class="workflow-focus__primary">
          <div class="kicker">Start now</div>
          ${primary ? `
            <button type="button" class="today-action-card workflow-focus__card" data-today-tab="${escapeAttr(primary.tab)}" data-today-id="${escapeAttr(primary.targetId || "")}">
              <strong>${escapeHtml(primary.title)}</strong>
              <div class="muted">${escapeHtml(primary.detail)}</div>
              <div class="workspace-chip-row">
                <span class="pill pill-bad">Highest leverage</span>
                <span class="pill">Open record</span>
              </div>
            </button>
          ` : `
            <div class="detail-card workflow-focus__empty">
              <div class="kicker">Start now</div>
              <div><strong>No urgent record is pulling focus right now.</strong></div>
              <div class="detail-copy">That usually means the work is caught up enough to create the next customer, request, or quote on purpose.</div>
            </div>
          `}
        </div>
        <div class="workflow-focus__stack">
          <div class="kicker">Keep moving</div>
          ${secondary.length ? secondary.map((item) => `
            <button type="button" class="today-action-card" data-today-tab="${escapeAttr(item.tab)}" data-today-id="${escapeAttr(item.targetId || "")}">
              <strong>${escapeHtml(item.title)}</strong>
              <div class="muted">${escapeHtml(item.detail)}</div>
            </button>
          `).join("") : `
            <div class="detail-card workflow-focus__empty">
              <div><strong>No secondary action is competing for attention yet.</strong></div>
              <div class="detail-copy">As requests, work, and payments stack up, Today will keep the next moves visible here.</div>
            </div>
          `}
        </div>
        <div class="workflow-focus__summary">
          <div class="kicker">Keep clean</div>
          <div class="workflow-focus__summary-list">
            ${cleanup.length ? cleanup.map((item) => `<div class="workflow-focus__summary-item">${escapeHtml(item)}</div>`).join("") : `<div class="workflow-focus__summary-item">No cleanup pressure is standing out right now.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}
function activateWorkspaceTarget(tab, targetId = "") {
  const id = String(targetId || "").trim();
  if (tab === "leads" && id) ACTIVE_LEAD_ID = id;
  if (tab === "bids" && id) ACTIVE_BID_ID = id;
  if (tab === "orders" && id) ACTIVE_ORDER_ID = id;
  if (tab === "jobs" && id) ACTIVE_JOB_ID = id;
  if (tab === "plans" && id) ACTIVE_PLAN_ID = id;
  if (tab === "customers" && id) ACTIVE_CUSTOMER_ID = id;
  if (tab === "dispatch" && id) ACTIVE_DISPATCH_JOB_ID = id;
  if (tab === "locates" && id) ACTIVE_LOCATE_ID = id;
  if (tab === "manifests" && id) ACTIVE_MANIFEST_ID = id;
  if (tab === "permits" && id) ACTIVE_PERMIT_ID = id;
  switchTab(tab || "dashboard");
}
function renderWorkCommandCenter() {
  if (!workCommandWrap) return;
  const items = workCommandItems();
  const requestPressure = staleLeads().length;
  const queuedQuotes = BIDS_CACHE.filter((row) => !row.converted_order_id && !["declined", "expired", "converted"].includes(String(row.status || "").toLowerCase())).length;
  const bookedWithoutJobs = CRM_ORDERS_CACHE.filter((row) => ["confirmed", "fulfilled"].includes(String(row.status || "").toLowerCase()) && !orderHasLinkedJob(row)).length;
  const liveJobs = JOBS_CACHE.filter((row) => ["blocked", "scheduled", "dispatched", "in_progress"].includes(String(row.status || "").toLowerCase())).length;

  workCommandWrap.innerHTML = `
    <div class="work-command__head">
      <div>
        <div class="kicker">Command center</div>
        <h3>Move work from request to field without losing the thread.</h3>
        <p>Use this space to see where the workflow is backing up before you drop into the detailed record lists below.</p>
      </div>
      <div class="workspace-chip-row">
        <button type="button" class="pipeline-action-chip" data-pipeline-action="new-request">New request</button>
        <button type="button" class="pipeline-action-chip" data-pipeline-action="draft-proposal">Draft proposal</button>
        <button type="button" class="pipeline-action-chip" data-pipeline-action="open-jobs">Open active jobs</button>
        <button type="button" class="pipeline-action-chip" data-pipeline-action="record-payment">Record payment</button>
      </div>
    </div>
    <div class="work-command__stats">
      <div class="work-command__stat">
        <span class="muted">Requests waiting</span>
        <strong>${escapeHtml(String(requestPressure))}</strong>
      </div>
      <div class="work-command__stat">
        <span class="muted">Live quotes</span>
        <strong>${escapeHtml(String(queuedQuotes))}</strong>
      </div>
      <div class="work-command__stat">
        <span class="muted">Booked without job</span>
        <strong>${escapeHtml(String(bookedWithoutJobs))}</strong>
      </div>
      <div class="work-command__stat">
        <span class="muted">Active field work</span>
        <strong>${escapeHtml(String(liveJobs))}</strong>
      </div>
    </div>
    <div class="work-command__grid">
      ${items.length ? items.map((item) => `
        <button type="button" class="today-action-card work-command__card" data-work-command-tab="${escapeAttr(item.tab)}" data-work-command-id="${escapeAttr(item.targetId || "")}">
          <div class="dashboard-tracker-row__title">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="pill ${escapeAttr(item.tone || "")}">${escapeHtml(String(item.count))}</span>
          </div>
          <div class="dashboard-tracker-row__copy">${escapeHtml(item.detail)}</div>
          <div class="workspace-chip-row">
            <span class="pill">Open record</span>
            <span class="pill">${escapeHtml(item.action)}</span>
          </div>
        </button>
      `).join("") : `
        <div class="detail-card work-command__empty">
          <div class="kicker">Command center</div>
          <div><strong>No workflow pressure is showing right now.</strong></div>
          <div class="detail-copy">Requests, quotes, booked work, and jobs are either caught up or not yet in the system.</div>
        </div>
      `}
    </div>
  `;

  workCommandWrap.querySelectorAll("[data-work-command-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activateWorkspaceTarget(
        button.getAttribute("data-work-command-tab") || "orders",
        button.getAttribute("data-work-command-id") || ""
      );
    });
  });
  workCommandWrap.querySelectorAll("[data-pipeline-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-pipeline-action");
      if (action === "new-request") {
        ACTIVE_LEAD_ID = null;
        clearLeadForm();
        renderLeadDetail(null).catch(console.error);
        switchTab("leads");
        return;
      }
      if (action === "draft-proposal") {
        startNewBid(preferredBidProfile());
        switchTab("bids");
        return;
      }
      if (action === "open-jobs") {
        switchTab("jobs");
        return;
      }
      if (action === "record-payment") {
        clearPaymentForm({ customerId: ACTIVE_CUSTOMER_ID || "" });
        renderPayments();
        switchTab("payments");
      }
    });
  });
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
        : (activeLead ? `Request ${titleCaseWords(String(activeLead.status || "new").replace(/_/g, " "))}` : "Customer record"));
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
    leadDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Request intake</div><div><strong>Create or select a request.</strong></div><div class="detail-copy">This record becomes the bridge between the customer conversation and the quote, quoted work, and job that follow.</div></div>`;
    return;
  }
  const linkedCustomer = CUSTOMERS_CACHE.find((row) => row.id === lead.customer_id) || null;
  const linkedBid = findBidRecordById(lead.converted_bid_id);
  const linkedOrder = linkedOrderForLead(lead);
  const linkedJob = linkedOrder ? (JOBS_CACHE.find((row) => row.order_id === linkedOrder.id || row.id === linkedOrder.primary_job_id) || null) : null;
  leadDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Request summary</div>
      <div><strong>${escapeHtml(lead.contact_name || lead.title || "Request")}</strong></div>
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
      <div class="detail-copy">Job: ${escapeHtml(linkedJob?.title || "Not created yet")}</div>
      <div class="pipeline-next-steps">
        <button id="btnLeadOpenCustomer" class="btn btn-ghost" type="button">${linkedCustomer ? "Open customer" : "Create customer"}</button>
        <button id="btnLeadDraftProposal" class="btn" type="button">${linkedBid ? "Open proposal" : "Draft proposal"}</button>
        <button id="btnLeadOpenPipeline" class="btn btn-ghost" type="button">${linkedOrder ? "Open quoted / booked" : "Open pipeline"}</button>
        <button id="btnLeadOpenJob" class="btn btn-ghost" type="button">${linkedJob ? "Open active job" : "Open jobs"}</button>
      </div>
    </div>
  `;
  if (btnLeadOpenBid) {
    btnLeadOpenBid.disabled = !lead.converted_bid_id;
  }
  $("btnLeadOpenCustomer")?.addEventListener("click", () => {
    if (linkedCustomer?.id) {
      ACTIVE_CUSTOMER_ID = linkedCustomer.id;
      CUSTOMER_CREATING = false;
      switchTab("customers");
      return;
    }
    startNewCustomer();
    if (customerName) customerName.value = lead.contact_name || "";
    if (customerEmail) customerEmail.value = lead.contact_email || "";
    if (customerPhone) customerPhone.value = lead.contact_phone || "";
    if (customerAddress) customerAddress.value = lead.service_address || "";
    switchTab("customers");
  });
  $("btnLeadDraftProposal")?.addEventListener("click", () => btnLeadCreateBid?.click());
  $("btnLeadOpenPipeline")?.addEventListener("click", () => {
    if (linkedOrder?.id) ACTIVE_ORDER_ID = linkedOrder.id;
    switchTab("orders");
  });
  $("btnLeadOpenJob")?.addEventListener("click", () => {
    if (linkedJob?.id) ACTIVE_JOB_ID = linkedJob.id;
    switchTab("jobs");
  });
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
  renderRequestWorkspace();
  const rows = sortedLeads(filter);
  if (!rows.length) {
    leadsList.innerHTML = `<div class="muted">No requests yet.</div>`;
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
        <div class="li-title">${escapeHtml(row.contact_name || row.title || "Request")}</div>
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
    ${rows.map((order) => `<option value="${escapeAttr(order.id)}">${escapeHtml(`${order.customer_name || "Customer"} | ${formatOrderWorkflowStatus(order.status || "new")} | ${formatWorkflowPaymentState(orderPaymentState(order))}`)}</option>`).join("")}
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
function renderJobAssignedToOptions(selectedId = "") {
  if (!jobAssignedTo) return;
  const members = OPERATOR_MEMBERS_CACHE || [];
  jobAssignedTo.innerHTML = `
    <option value="">Unassigned</option>
    ${members.map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.name || m.email)}</option>`).join("")}
  `;
  jobAssignedTo.value = members.some((m) => m.id === selectedId) ? selectedId : "";
}
function clearJobForm() {
  if (jobId) jobId.value = "";
  if (jobStatus) jobStatus.value = "scheduled";
  renderJobOrderOptions(ACTIVE_ORDER_ID || "");
  renderJobCustomerOptions("");
  renderJobAssignedToOptions("");
  if (jobTitle) jobTitle.value = "";
  if (jobServiceAddress) jobServiceAddress.value = "";
  if (jobScheduledDate) jobScheduledDate.value = "";
  if (jobScheduledTime) jobScheduledTime.value = "";
  if (jobScheduleWindow) jobScheduleWindow.value = "";
  if (jobSummary) jobSummary.value = "";
  if (jobNotes) jobNotes.value = "";
  setInlineMessage(jobMsg, "");
  if (jobMainServiceType) { jobMainServiceType.value = ''; toggleHydrovacFields(''); }
  if (jobServiceType)     jobServiceType.value = '';
  if (jobEquipmentId)     jobEquipmentId.value = '';
  if (jobBillableHours)   jobBillableHours.value = '';
  if (jobMinimumHours)    jobMinimumHours.value = '2';
  if (jobTravelHours)     jobTravelHours.value = '';
  if (jobTruckRate)       jobTruckRate.value = '';
  if (jobOperatorRate)    jobOperatorRate.value = '';
  if (jobAfterHoursMultiplier) jobAfterHoursMultiplier.value = '1.0';
  if (jobMobilizationFee) jobMobilizationFee.value = '';
  if (jobDisposalVolume)  jobDisposalVolume.value = '';
  if (jobDisposalCost)    jobDisposalCost.value = '';
  if (jobDisposalSite)    jobDisposalSite.value = '';
  if (jobDisposalManifest) jobDisposalManifest.value = '';
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
  renderJobAssignedToOptions(job.assigned_operator_id || "");
  if (jobTitle) jobTitle.value = job.title || "";
  if (jobServiceAddress) jobServiceAddress.value = job.service_address || "";
  if (jobScheduledDate) jobScheduledDate.value = job.scheduled_date || "";
  if (jobScheduledTime) jobScheduledTime.value = job.scheduled_time || "";
  if (jobScheduleWindow) jobScheduleWindow.value = job.schedule_window || "";
  if (jobSummary) jobSummary.value = job.summary || "";
  if (jobNotes) jobNotes.value = job.notes || "";
  // Hydrovac fields
  const svcType = job.service_type || '';
  if (jobMainServiceType) { jobMainServiceType.value = svcType ? 'hydrovac' : ''; }
  toggleHydrovacFields(svcType ? 'hydrovac' : '');
  if (jobServiceType)          jobServiceType.value          = svcType;
  if (jobEquipmentId)          renderEquipmentOptions(job.equipment_id || '');
  if (jobBillableHours)        jobBillableHours.value        = job.billable_hours ?? '';
  if (jobMinimumHours)         jobMinimumHours.value         = job.minimum_hours ?? '2';
  if (jobTravelHours)          jobTravelHours.value          = job.travel_hours ?? '';
  if (jobTruckRate)            jobTruckRate.value            = job.hourly_truck_rate_cents ? (job.hourly_truck_rate_cents / 100).toFixed(0) : '';
  if (jobOperatorRate)         jobOperatorRate.value         = job.hourly_operator_rate_cents ? (job.hourly_operator_rate_cents / 100).toFixed(0) : '';
  if (jobAfterHoursMultiplier) jobAfterHoursMultiplier.value = job.after_hours_multiplier ?? '1.0';
  if (jobMobilizationFee)      jobMobilizationFee.value      = job.mobilization_fee_cents ? (job.mobilization_fee_cents / 100).toFixed(0) : '';
  if (jobDisposalVolume)       jobDisposalVolume.value       = job.disposal_volume_m3 ?? '';
  if (jobDisposalCost)         jobDisposalCost.value         = job.disposal_cost_cents ? (job.disposal_cost_cents / 100).toFixed(0) : '';
  if (jobDisposalSite)         jobDisposalSite.value         = job.disposal_site ?? '';
  if (jobDisposalManifest)     jobDisposalManifest.value     = job.disposal_manifest_number ?? '';
}
function renderHydrovacJobOperations(job, order, detailState) {
  const tickets = Array.isArray(detailState?.tickets) ? detailState.tickets : [];
  const manifests = Array.isArray(detailState?.manifests) ? detailState.manifests : [];
  const summary = hydrovacOpsSummary(job, tickets, manifests);
  return `
    <div class="detail-card job-hydrovac-card" style="margin-top:14px;">
      <div class="kicker">Hydrovac ops</div>
      <div class="detail-copy">Keep utility locate compliance, load logging, and disposal proof on the job instead of in a glove box or another tab.</div>
      <div class="workspace-chip-row">
        <span class="pill ${summary.activeTickets ? "pill-good" : "pill-bad"}">${escapeHtml(String(summary.activeTickets))} active locate ticket${summary.activeTickets === 1 ? "" : "s"}</span>
        <span class="pill ${summary.verifiedTickets ? "pill-good" : "pill-warn"}">${escapeHtml(String(summary.verifiedTickets))} verified on site</span>
        <span class="pill">${escapeHtml(String(summary.loadsLogged))} load${summary.loadsLogged === 1 ? "" : "s"} logged</span>
        <span class="pill">${escapeHtml(formatCountNumber(summary.gallonsHauled))} gal hauled</span>
        <span class="pill">${escapeHtml(formatCountNumber(summary.yardsHauled))} yd hauled</span>
      </div>
      ${detailState?.error ? `<div class="msg error" style="margin-top:12px;">${escapeHtml(detailState.error)}</div>` : ``}
      ${detailState?.loading ? `<div class="detail-copy" style="margin-top:12px;">Loading hydrovac compliance and load records...</div>` : ``}
      <div class="job-hydrovac-grid">
        <div class="job-hydrovac-panel">
          <div class="job-hydrovac-panel__head">
            <strong>Utility locate tickets</strong>
            <span class="muted">811 / one-call proof for excavation work</span>
          </div>
          <div class="job-hydrovac-list">
            ${tickets.length ? tickets.map((ticket) => `
              <div class="job-hydrovac-row">
                <div class="job-hydrovac-row__top">
                  <div>
                    <div class="job-hydrovac-row__title">${escapeHtml(ticket.ticket_number || "Locate ticket")}</div>
                    <div class="job-hydrovac-row__meta">${escapeHtml(ticket.one_call_center || "One-call center pending")} | ${escapeHtml(ticket.work_site_address || job.service_address || "No work site address")}</div>
                  </div>
                  <span class="pill ${hydrovacLocateToneClass(ticket)}">${escapeHtml(titleCaseWords(String(ticket.status || "requested").replace(/_/g, " ")))}</span>
                </div>
                <div class="job-hydrovac-row__meta">${escapeHtml(hydrovacLocateExpiryLabel(ticket))}</div>
                ${ticket.locate_notes ? `<div class="job-hydrovac-row__meta">${escapeHtml(ticket.locate_notes)}</div>` : ``}
                <div class="job-hydrovac-mini-actions">
                  ${ticket.verified_on_site ? `<span class="pill pill-good">Verified on site</span>` : `<button type="button" class="btn btn-ghost btn-sm" data-hv-verify-ticket="${escapeAttr(ticket.id)}">Mark verified</button>`}
                </div>
              </div>
            `).join("") : `<div class="job-hydrovac-empty">No utility locate tickets logged yet.</div>`}
          </div>
          <form id="jobHydrovacTicketForm" class="job-hydrovac-form">
            <div class="grid three form-grid">
              <label>Ticket number
                <input id="jobHydrovacTicketNumber" placeholder="2026-1234567" />
              </label>
              <label>One-call center
                <input id="jobHydrovacTicketCenter" placeholder="Miss Dig 811" value="Miss Dig 811" />
              </label>
              <label>Valid until
                <input id="jobHydrovacTicketValidUntil" type="date" value="${escapeAttr(todayDateValue(10))}" />
              </label>
            </div>
            <div class="row">
              <button type="submit" class="btn btn-ghost">Save locate ticket</button>
            </div>
          </form>
        </div>
        <div class="job-hydrovac-panel">
          <div class="job-hydrovac-panel__head">
            <strong>Loads & disposal</strong>
            <span class="muted">Manifest every haul-off from this job</span>
          </div>
          <div class="job-hydrovac-list">
            ${manifests.length ? manifests.map((manifest) => `
              <div class="job-hydrovac-row">
                <div class="job-hydrovac-row__top">
                  <div>
                    <div class="job-hydrovac-row__title">${escapeHtml(manifest.manifest_number || "Manifest pending")} - ${escapeHtml(hydrovacMaterialLabel(manifest.material_type))}</div>
                    <div class="job-hydrovac-row__meta">${escapeHtml(hydrovacManifestQuantityLabel(manifest))} | Charge ${escapeHtml(formatUsd(Number(manifest.disposal_charge_cents || 0)))} | Cost ${escapeHtml(formatUsd(Number(manifest.disposal_cost_cents || 0)))}</div>
                  </div>
                  <span class="pill ${hydrovacManifestToneClass(manifest)}">${escapeHtml(titleCaseWords(String(manifest.status || "in_transit").replace(/_/g, " ")))}</span>
                </div>
                <div class="job-hydrovac-row__meta">${escapeHtml(manifest.disposal_ticket_number ? `Facility ticket ${manifest.disposal_ticket_number}` : "Facility ticket pending")}</div>
                ${manifest.notes ? `<div class="job-hydrovac-row__meta">${escapeHtml(manifest.notes)}</div>` : ``}
                <div class="job-hydrovac-mini-actions">
                  ${normalizeWorkflowStatusValue(manifest.status) === "in_transit" ? `<button type="button" class="btn btn-ghost btn-sm" data-hv-confirm-manifest="${escapeAttr(manifest.id)}">Confirm load</button><button type="button" class="btn btn-ghost btn-sm" data-hv-delete-manifest="${escapeAttr(manifest.id)}">Delete draft load</button>` : `<span class="pill pill-good">Load saved</span>`}
                </div>
              </div>
            `).join("") : `<div class="job-hydrovac-empty">No loads logged yet. Start with the first haul-off from this site.</div>`}
          </div>
          <form id="jobHydrovacManifestForm" class="job-hydrovac-form">
            <div class="grid two form-grid">
              <label>Material type
                <select id="jobHydrovacManifestMaterial">
                  <option value="soil">Soil</option>
                  <option value="sewage">Sewage</option>
                  <option value="grease">Grease</option>
                  <option value="concrete_slurry">Concrete slurry</option>
                  <option value="industrial_waste">Industrial waste</option>
                  <option value="mixed">Mixed waste</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>Estimated quantity
                <input id="jobHydrovacManifestQuantity" type="number" min="0" step="1" placeholder="1500" />
              </label>
            </div>
            <div class="grid three form-grid">
              <label>Unit
                <select id="jobHydrovacManifestUnit">
                  <option value="gallons">Gallons</option>
                  <option value="cubic_yards">Cubic yards</option>
                  <option value="tons">Tons</option>
                </select>
              </label>
              <label>Disposal charge ($)
                <input id="jobHydrovacManifestCharge" type="number" min="0" step="1" placeholder="0" />
              </label>
              <label>Disposal cost ($)
                <input id="jobHydrovacManifestCost" type="number" min="0" step="1" placeholder="0" />
              </label>
            </div>
            <label>Load note
              <input id="jobHydrovacManifestNote" placeholder="Catch basin debris, rear lot" />
            </label>
            <div class="job-hydrovac-mini-actions">
              <button type="submit" class="btn btn-ghost">Log load</button>
              <button type="button" class="btn btn-ghost btn-sm" data-hv-action="invoice">Draft hydrovac invoice</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
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
  const localDraftId = String(options.localDraftId || "").trim();
  const baseLocalDraft = localDraftId
    ? ((BIDS_CACHE || []).find((row) => row.id === localDraftId) || null)
    : null;
  const latestLocalDraftForMerge = () => {
    if (!localDraftId) return null;
    if (currentBid()?.id === localDraftId) {
      try {
        return collectBidFormDraft();
      } catch (_) {
        // Ignore form collection failures and fall back to cached draft.
      }
    }
    return (BIDS_CACHE || []).find((row) => row.id === localDraftId) || baseLocalDraft;
  };
  const { data, error } = await sb.rpc("create_bid_from_lead", {
    p_lead_id: lead.id,
    p_profile: profile,
  });

  if (!error) {
    await Promise.all([fetchLeads(), loadPersistedBids()]);
    let bid = findBidRecordById(data?.bid_id) || BIDS_CACHE[0] || null;
    const localDraft = latestLocalDraftForMerge();
    if (bid && localDraft) {
      const mergedBid = {
        ...cloneJson(bid, {}),
        ...cloneJson(localDraft, {}),
        id: localDraft.id,
        record_id: bid.record_id || data?.bid_id || localDraft.record_id || "",
        metadata: {
          ...(bid.metadata || {}),
          ...(localDraft.metadata || {}),
          local_draft_id: localDraft.id,
        },
        updated_at: localDraft.updated_at || bid.updated_at || new Date().toISOString(),
      };
      BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== mergedBid.id), mergedBid]
        .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
      persistBidDrafts();
      bid = mergedBid;
    }
    if (bid) ACTIVE_BID_ID = bid.id;
    return { bid, existing: !!data?.existing };
  }
  if (!isMissingDatabaseFeatureError(error, ["create_bid_from_lead"])) throw error;

  const nowIso = new Date().toISOString();
  const draft = bidDraftFromLeadRecord(lead, profile, latestLocalDraftForMerge());
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
  let bid = findBidRecordById(bidRow.id) || draftFromBidRow(bidRow);
  const localDraft = latestLocalDraftForMerge();
  if (bid && localDraft) {
    const mergedBid = {
      ...cloneJson(bid, {}),
      ...cloneJson(localDraft, {}),
      id: localDraft.id,
      record_id: bid.record_id || bidRow.id,
      metadata: {
        ...(bid.metadata || {}),
        ...(localDraft.metadata || {}),
        local_draft_id: localDraft.id,
      },
      updated_at: localDraft.updated_at || bid.updated_at || nowIso,
    };
    BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== mergedBid.id), mergedBid]
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    persistBidDrafts();
    bid = mergedBid;
  }
  if (bid) ACTIVE_BID_ID = bid.id;
  return { bid, existing: false };
}
function maybeLogJobHours(job) {
  if (!job?.assigned_operator_id) return;
  const member = (TEAM_MEMBERS_CACHE || []).find(
    (m) => m.id === job.assigned_operator_id || m.user_id === job.assigned_operator_id
  );
  const memberName = member?.name || member?.email || 'crew member';
  const autoMins = job.actual_start_at && job.actual_end_at
    ? Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000)
    : null;
  const defaultHrs = autoMins != null
    ? (autoMins / 60).toFixed(2)
    : (job.billable_hours || '');
  const hint = autoMins != null
    ? `${(autoMins / 60).toFixed(1)}h from crew check-in/out`
    : (job.billable_hours ? `${job.billable_hours}h estimated` : '');

  const existing = document.getElementById('jobHoursLogModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'jobHoursLogModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-hd"><strong>Log hours for ${escapeHtml(memberName)}</strong></div>
      <div class="modal-bd">
        <div class="detail-copy" style="margin-bottom:14px;">${escapeHtml(job.title || 'Job')}</div>
        <label class="form-label">Hours worked</label>
        <input type="number" id="jobHoursInput" class="input" value="${escapeAttr(String(defaultHrs))}" min="0" max="24" step="0.25" placeholder="e.g. 2.5" style="margin-top:4px;" />
        ${hint ? `<div class="muted" style="font-size:.78rem;margin-top:4px;">${escapeHtml(hint)}</div>` : ''}
        <label class="check" style="margin-top:14px;">
          <input type="checkbox" id="jobHoursBillable" checked /> Billable â€” include in payroll
        </label>
        <div id="jobHoursLogMsg" class="msg" style="margin-top:10px;"></div>
      </div>
      <div class="modal-ft">
        <button id="btnJobHoursSkip" class="btn btn-ghost" type="button">Skip</button>
        <button id="btnJobHoursSave" class="btn btn-primary" type="button">Log Hours</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('btnJobHoursSkip')?.addEventListener('click', () => modal.remove());

  document.getElementById('btnJobHoursSave')?.addEventListener('click', async () => {
    const hoursVal = parseFloat(document.getElementById('jobHoursInput')?.value || '0');
    const billable = document.getElementById('jobHoursBillable')?.checked !== false;
    const msgEl   = document.getElementById('jobHoursLogMsg');
    const saveBtn = document.getElementById('btnJobHoursSave');

    if (!hoursVal || hoursVal <= 0) {
      if (msgEl) { msgEl.textContent = 'Enter hours greater than 0.'; msgEl.className = 'msg error'; }
      return;
    }
    if (saveBtn) saveBtn.disabled = true;

    try {
      const tok = await window.PROOFLINK_OPERATOR_RUNTIME?.getAccessToken?.();
      const durationMinutes = Math.round(hoursVal * 60);
      const startedAt = job.actual_start_at
        || (job.scheduled_date
          ? new Date(`${job.scheduled_date}T${job.scheduled_time || '08:00'}:00`).toISOString()
          : new Date(Date.now() - durationMinutes * 60000).toISOString());

      const res = await fetch('/.netlify/functions/log-time-entry', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body   : JSON.stringify({
          operator_id      : member?.user_id || job.assigned_operator_id,
          job_id           : job.id,
          customer_id      : job.customer_id || null,
          order_id         : job.order_id   || null,
          description      : `${job.title || 'Job'} â€” ${memberName}`,
          started_at       : startedAt,
          duration_minutes : durationMinutes,
          billable,
          hourly_rate_cents: member?.hourly_rate_cents || 0,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed to log hours');
      modal.remove();
      showToast(`${hoursVal}h logged for ${memberName}`);
    } catch (err) {
      if (msgEl) { msgEl.textContent = err.message; msgEl.className = 'msg error'; }
      if (saveBtn) saveBtn.disabled = false;
    }
  });
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
    assigned_operator_id: fields.assigned_operator_id || jobAssignedTo?.value || null,
    service_type                : jobMainServiceType?.value === 'hydrovac' ? (jobServiceType?.value || 'hydrovac') : (jobMainServiceType?.value || null),
    equipment_id                : jobEquipmentId?.value || null,
    billable_hours              : jobBillableHours?.value ? parseFloat(jobBillableHours.value) : null,
    minimum_hours               : jobMinimumHours?.value ? parseFloat(jobMinimumHours.value) : 2,
    travel_hours                : jobTravelHours?.value ? parseFloat(jobTravelHours.value) : 0,
    hourly_truck_rate_cents     : jobTruckRate?.value ? Math.round(parseFloat(jobTruckRate.value) * 100) : 0,
    hourly_operator_rate_cents  : jobOperatorRate?.value ? Math.round(parseFloat(jobOperatorRate.value) * 100) : 0,
    after_hours_multiplier      : jobAfterHoursMultiplier?.value ? parseFloat(jobAfterHoursMultiplier.value) : 1.0,
    mobilization_fee_cents      : jobMobilizationFee?.value ? Math.round(parseFloat(jobMobilizationFee.value) * 100) : 0,
    disposal_volume_m3          : jobDisposalVolume?.value ? parseFloat(jobDisposalVolume.value) : null,
    disposal_cost_cents         : jobDisposalCost?.value ? Math.round(parseFloat(jobDisposalCost.value) * 100) : 0,
    disposal_site               : jobDisposalSite?.value || null,
    disposal_manifest_number    : jobDisposalManifest?.value || null,
    updated_at: nowIso,
  });
  if (Object.prototype.hasOwnProperty.call(fields, "actual_start_at")) payload.actual_start_at = fields.actual_start_at;
  if (Object.prototype.hasOwnProperty.call(fields, "actual_end_at")) payload.actual_end_at = fields.actual_end_at;
  if (Object.prototype.hasOwnProperty.call(fields, "check_in_lat")) payload.check_in_lat = fields.check_in_lat;
  if (Object.prototype.hasOwnProperty.call(fields, "check_in_lng")) payload.check_in_lng = fields.check_in_lng;
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
  // Notify the operator when a job has just been dispatched to a crew member
  if (String(data.status || "").toLowerCase() === "dispatched" && data.assigned_operator_id) {
    showToast("Job dispatched â€” crew member will be notified");
  }
  // Prompt to log hours when a job is marked complete and has an assigned crew member
  if (String(data.status || "").toLowerCase() === "completed" && data.assigned_operator_id) {
    maybeLogJobHours(data);
  }
  return data;
}
async function createJobFromOrderRecord(order) {
  if (!order?.id) throw new Error("Select an order before creating a job.");
  assertOrderAllowsJobCreation(order);
  const existingJob = JOBS_CACHE.find((row) => row.order_id === order.id || row.id === order.primary_job_id) || null;
  if (existingJob) return { job: existingJob, existing: true };

  async function reloadJobForOrder() {
    await Promise.all([fetchJobs(), fetchCrmOrders()]);
    let job = JOBS_CACHE.find((row) => row.id === order.primary_job_id || row.order_id === order.id) || null;
    if (job) return job;
    const { data: freshJob, error: freshJobError } = await scopeQuery(
      sb.from("jobs").select("*")
    )
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (freshJobError) throw freshJobError;
    if (freshJob) {
      JOBS_CACHE = [freshJob, ...JOBS_CACHE.filter((row) => row.id !== freshJob.id)];
      job = freshJob;
    }
    return job;
  }

  const { data, error } = await sb.rpc("create_job_from_order", { p_order_id: order.id });
  if (!error) {
    const job = await reloadJobForOrder();
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
  const job = JOBS_CACHE.find((row) => row.id === jobRow.id || row.order_id === order.id) || jobRow;
  ACTIVE_JOB_ID = job.id;
  return { job, existing: false };
}
function normalizeWorkflowStatusValue(value) {
  return String(value || "").trim().toLowerCase();
}
function linkedLeadForOrder(order) {
  if (!order) return null;
  const directLeadId = String(order.lead_id || order.source_lead_id || "").trim();
  if (directLeadId) {
    const direct = LEADS_CACHE.find((row) => row.id === directLeadId);
    if (direct) return direct;
  }
  const sourceRef = String(order.source_ref || "").trim();
  if (sourceRef) {
    const bySource = LEADS_CACHE.find((row) => row.id === sourceRef);
    if (bySource) return bySource;
  }
  const bid = linkedBidForOrder(order);
  if (bid?.lead_id) {
    return LEADS_CACHE.find((row) => row.id === bid.lead_id) || null;
  }
  return null;
}
function linkedBidForOrder(order) {
  if (!order) return null;
  const bidId = String(order.bid_id || "").trim();
  if (bidId) {
    const direct = findBidRecordById(bidId);
    if (direct) return direct;
  }
  const sourceRef = String(order.source_ref || "").trim();
  if (sourceRef) {
    const bySource = findBidRecordById(sourceRef);
    if (bySource) return bySource;
  }
  const leadId = String(order.lead_id || order.source_lead_id || "").trim();
  if (leadId) {
    return BIDS_CACHE.find((row) => String(row.lead_id || "") === leadId) || null;
  }
  return null;
}
function linkedOrderForLead(lead) {
  if (!lead) return null;
  const directOrderId = String(lead.converted_order_id || "").trim();
  if (directOrderId) {
    return CRM_ORDERS_CACHE.find((row) => row.id === directOrderId) || null;
  }
  const bid = lead.converted_bid_id ? findBidRecordById(lead.converted_bid_id) : null;
  if (bid) return currentBidOrder(bid);
  return null;
}
function pipelineStageStats() {
  const requestCount = (LEADS_CACHE || []).filter((lead) => {
    const status = normalizeWorkflowStatusValue(lead.status);
    return !["converted", "cancelled", "closed", "won", "lost"].includes(status);
  }).length;
  const proposalCount = (BIDS_CACHE || []).filter((bid) => {
    const status = normalizeWorkflowStatusValue(bid.status);
    return !bid.converted_order_id && !["converted", "declined", "cancelled", "archived"].includes(status);
  }).length;
  const quotedBookedCount = (CRM_ORDERS_CACHE || []).filter((order) => {
    const status = normalizeWorkflowStatusValue(order.status || "new");
    return !["completed", "paid", "cancelled"].includes(status);
  }).length;
  const activeJobCount = (JOBS_CACHE || []).filter((job) => {
    const status = normalizeWorkflowStatusValue(job.status || "scheduled");
    return !["completed", "cancelled"].includes(status);
  }).length;
  return [
    {
      tab: "leads",
      value: requestCount,
      eyebrow: "Stage 1",
      title: "Requests",
      copy: "Inbound work that still needs qualification and scope.",
    },
    {
      tab: "bids",
      value: proposalCount,
      eyebrow: "Stage 2",
      title: "Proposals",
      copy: "Quotes being worked up, reviewed, or waiting to be sent.",
    },
    {
      tab: "orders",
      value: quotedBookedCount,
      eyebrow: "Stage 3",
      title: "Quoted / booked",
      copy: "Priced work that is approved, waiting on approval, or being scheduled.",
    },
    {
      tab: "jobs",
      value: activeJobCount,
      eyebrow: "Stage 4",
      title: "Active jobs",
      copy: "Approved work that is moving through dispatch and field execution.",
    },
  ];
}
function renderRequestWorkspace() {
  const activeLead = currentLead();
  const linkedCustomer = activeLead?.customer_id ? (CUSTOMERS_CACHE.find((row) => row.id === activeLead.customer_id) || null) : null;
  const linkedBid = activeLead?.converted_bid_id ? findBidRecordById(activeLead.converted_bid_id) : null;
  const linkedOrder = linkedOrderForLead(activeLead);
  const requestCount = (LEADS_CACHE || []).filter((lead) => !["converted", "lost", "archived"].includes(normalizeWorkflowStatusValue(lead.status))).length;
  const readyToQuote = (LEADS_CACHE || []).filter((lead) => ["qualified", "contacted"].includes(normalizeWorkflowStatusValue(lead.status)) && !lead.converted_bid_id).length;
  const movedToProposal = (LEADS_CACHE || []).filter((lead) => !!lead.converted_bid_id).length;
  if (requestStageStrip) {
    const cards = [
      { tab: "leads", eyebrow: "Requests", value: requestCount, title: "Open intake", copy: "New inbound work that still needs qualification or customer context." },
      { tab: "leads", eyebrow: "Ready next", value: readyToQuote, title: "Ready to quote", copy: "Qualified requests that should move into a proposal next." },
      { tab: "bids", eyebrow: "Moved forward", value: movedToProposal, title: "In proposals", copy: "Requests already linked to a draft or active proposal." },
    ];
    requestStageStrip.innerHTML = cards.map((stage) => `
      <button type="button" class="pipeline-stage-card ${stage.tab === "leads" ? "is-active" : ""}" data-request-stage-tab="${escapeAttr(stage.tab)}">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </button>
    `).join("");
    requestStageStrip.querySelectorAll("[data-request-stage-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.getAttribute("data-request-stage-tab") || "leads"));
    });
  }
  if (requestActionBar) {
    requestActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-request-action="new-request">New request</button>
      <button type="button" class="pipeline-action-chip" data-request-action="draft-proposal">${linkedBid ? "Open proposal" : "Draft proposal"}</button>
      <button type="button" class="pipeline-action-chip" data-request-action="open-customer">${linkedCustomer ? "Open customer" : "Create customer"}</button>
      <button type="button" class="pipeline-action-chip" data-request-action="open-pipeline">${linkedOrder ? "Open quoted / booked" : "Open pipeline"}</button>
    `;
    requestActionBar.querySelectorAll("[data-request-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.getAttribute("data-request-action");
        if (action === "new-request") {
          ACTIVE_LEAD_ID = null;
          clearLeadForm();
          renderLeadDetail(null).catch(console.error);
          return;
        }
        if (action === "open-customer") {
          if (linkedCustomer?.id) {
            ACTIVE_CUSTOMER_ID = linkedCustomer.id;
            CUSTOMER_CREATING = false;
            switchTab("customers");
            return;
          }
          startNewCustomer();
          if (customerName) customerName.value = activeLead?.contact_name || "";
          if (customerEmail) customerEmail.value = activeLead?.contact_email || "";
          if (customerPhone) customerPhone.value = activeLead?.contact_phone || "";
          if (customerAddress) customerAddress.value = activeLead?.service_address || "";
          switchTab("customers");
          return;
        }
        if (action === "draft-proposal") {
          if (linkedBid?.id) {
            ACTIVE_BID_ID = linkedBid.id;
            renderBids(bidSearch?.value || "");
            switchTab("bids");
            return;
          }
          btnLeadCreateBid?.click();
          return;
        }
        if (action === "open-pipeline") {
          if (linkedOrder?.id) ACTIVE_ORDER_ID = linkedOrder.id;
          switchTab("orders");
        }
      });
    });
  }
}
function renderProposalWorkspace() {
  const draft = currentBid();
  const customer = draft?.customer_id ? findBidCustomer(draft.customer_id) : null;
  const linkedLead = draft?.lead_id ? (LEADS_CACHE.find((row) => row.id === draft.lead_id) || null) : null;
  const linkedOrder = draft ? currentBidOrder(draft) : null;
  const draftCount = (BIDS_CACHE || []).filter((row) => !row.converted_order_id && ["draft", "review", ""].includes(normalizeWorkflowStatusValue(row.status || "draft"))).length;
  const readyCount = (BIDS_CACHE || []).filter((row) => !row.converted_order_id && calculateBidTotals(row).total > 0).length;
  const movedCount = (BIDS_CACHE || []).filter((row) => !!row.converted_order_id).length;
  if (proposalStageStrip) {
    const cards = [
      { tab: "bids", eyebrow: "Proposals", value: draftCount, title: "Drafting", copy: "Quotes being scoped, priced, or cleaned up before delivery." },
      { tab: "bids", eyebrow: "Ready next", value: readyCount, title: "Priced and usable", copy: "Drafts with enough pricing in them to finish and send." },
      { tab: "orders", eyebrow: "Moved forward", value: movedCount, title: "In pipeline", copy: "Proposals already turned into quoted or booked work." },
    ];
    proposalStageStrip.innerHTML = cards.map((stage) => `
      <button type="button" class="pipeline-stage-card ${stage.tab === "bids" ? "is-active" : ""}" data-proposal-stage-tab="${escapeAttr(stage.tab)}">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </button>
    `).join("");
    proposalStageStrip.querySelectorAll("[data-proposal-stage-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.getAttribute("data-proposal-stage-tab") || "bids"));
    });
  }
  if (proposalActionBar) {
    proposalActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-proposal-action="new-proposal">New quote</button>
      <button type="button" class="pipeline-action-chip" data-proposal-action="open-request">${linkedLead ? "Open request" : "Create request"}</button>
      <button type="button" class="pipeline-action-chip" data-proposal-action="open-customer">${customer ? "Open customer" : "Create customer"}</button>
      <button type="button" class="pipeline-action-chip" data-proposal-action="open-pipeline">${linkedOrder ? "Open quoted / booked" : "Move into pipeline"}</button>
    `;
    proposalActionBar.querySelectorAll("[data-proposal-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-proposal-action");
        if (action === "new-proposal") {
          startNewBid(preferredBidProfile());
          return;
        }
        if (action === "open-request") {
          if (linkedLead?.id) {
            ACTIVE_LEAD_ID = linkedLead.id;
            switchTab("leads");
            return;
          }
          clearLeadForm();
          renderLeadCustomerOptions(customer?.id || "");
          if (leadCustomerId) leadCustomerId.value = customer?.id || "";
          if (leadContactName) leadContactName.value = customer?.name || "";
          if (leadContactEmail) leadContactEmail.value = customer?.email || "";
          if (leadContactPhone) leadContactPhone.value = customer?.phone || "";
          if (leadServiceAddress) leadServiceAddress.value = draft?.service_address || "";
          if (leadTitle) leadTitle.value = draft?.title ? `${draft.title} request` : "";
          if (leadSummary) leadSummary.value = draft?.project_summary || "";
          ACTIVE_LEAD_ID = null;
          renderLeadDetail(null).catch(console.error);
          switchTab("leads");
          return;
        }
        if (action === "open-customer") {
          if (customer?.id) {
            ACTIVE_CUSTOMER_ID = customer.id;
            CUSTOMER_CREATING = false;
            switchTab("customers");
            return;
          }
          startNewCustomer();
          if (customerName) customerName.value = draft?.site_contact || "";
          if (customerEmail) customerEmail.value = "";
          if (customerPhone) customerPhone.value = "";
          if (customerAddress) customerAddress.value = draft?.service_address || "";
          switchTab("customers");
          return;
        }
        if (action === "open-pipeline") {
          if (linkedOrder?.id) {
            ACTIVE_ORDER_ID = linkedOrder.id;
            renderOrders();
            switchTab("orders");
            return;
          }
          btnConvertBidToOrder?.click();
        }
      });
    });
  }
}
function renderJobWorkspace() {
  const activeJob = currentJob();
  const activeOrder = linkedOrderForJob(activeJob);
  const activeCustomer = activeJob?.customer_id ? (CUSTOMERS_CACHE.find((row) => row.id === activeJob.customer_id) || null) : null;
  const scheduledCount = (JOBS_CACHE || []).filter((job) => ["scheduled", "dispatched"].includes(normalizeWorkflowStatusValue(job.status || "scheduled"))).length;
  const activeCount = (JOBS_CACHE || []).filter((job) => normalizeWorkflowStatusValue(job.status) === "in_progress").length;
  const blockedCount = (JOBS_CACHE || []).filter((job) => normalizeWorkflowStatusValue(job.status) === "blocked").length;
  const unpaidCount = (JOBS_CACHE || []).filter((job) => {
    const order = linkedOrderForJob(job);
    const paymentState = job.payment_state || orderPaymentState(order);
    return !["paid"].includes(normalizeWorkflowStatusValue(paymentState)) && !["cancelled"].includes(normalizeWorkflowStatusValue(job.status));
  }).length;
  if (jobStageStrip) {
    const cards = [
      { tab: "jobs", eyebrow: "Ready", value: scheduledCount, title: "Scheduled / dispatched", copy: "Approved work waiting to roll or already assigned to the field." },
      { tab: "jobs", eyebrow: "Live", value: activeCount, title: "In progress", copy: "Jobs crews are actively working right now." },
      { tab: "jobs", eyebrow: "Watch", value: blockedCount, title: "Blocked", copy: "Execution records that need an operator decision or missing info." },
      { tab: "payments", eyebrow: "Money", value: unpaidCount, title: "Still unpaid", copy: "Jobs that are done or active but still need collection." },
    ];
    jobStageStrip.innerHTML = cards.map((stage) => `
      <button type="button" class="pipeline-stage-card ${stage.tab === "jobs" ? "is-active" : ""}" data-job-stage-tab="${escapeAttr(stage.tab)}">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </button>
    `).join("");
    jobStageStrip.querySelectorAll("[data-job-stage-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.getAttribute("data-job-stage-tab") || "jobs"));
    });
  }
  if (jobActionBar) {
    const linkedLead = linkedLeadForOrder(activeOrder);
    const linkedBid = linkedBidForOrder(activeOrder);
    const hydrovacActions = isHydrovacWorkspace() ? `
        <button type="button" class="pipeline-action-chip" data-job-action="open-manifests">Open loads</button>
        <button type="button" class="pipeline-action-chip" data-job-action="open-locates">Open locate tickets</button>
        <button type="button" class="pipeline-action-chip" data-job-action="open-compliance">Open compliance</button>
    ` : "";
    jobActionBar.innerHTML = `
        <button type="button" class="pipeline-action-chip" data-job-action="new-job">New job</button>
        <button type="button" class="pipeline-action-chip" data-job-action="open-pipeline">${activeOrder ? "Open quoted / booked" : "Open pipeline"}</button>
        <button type="button" class="pipeline-action-chip" data-job-action="open-proposal">${linkedBid ? "Open proposal" : "Open proposals"}</button>
        <button type="button" class="pipeline-action-chip" data-job-action="open-request">${linkedLead ? "Open request" : "Open requests"}</button>
        <button type="button" class="pipeline-action-chip" data-job-action="open-customer">${activeCustomer ? "Open customer" : "Open customers"}</button>
        <button type="button" class="pipeline-action-chip" data-job-action="record-payment">Record payment</button>
        ${hydrovacActions}
      `;
    jobActionBar.querySelectorAll("[data-job-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-job-action");
        if (action === "new-job") {
          ACTIVE_JOB_ID = null;
          clearJobForm();
          renderJobDetail(null).catch(console.error);
          return;
        }
        if (action === "open-pipeline") {
          if (activeOrder?.id) ACTIVE_ORDER_ID = activeOrder.id;
          switchTab("orders");
          return;
        }
        if (action === "open-proposal") {
          const linkedBid = linkedBidForOrder(activeOrder);
          if (linkedBid?.id) ACTIVE_BID_ID = linkedBid.id;
          switchTab("bids");
          return;
        }
        if (action === "open-request") {
          const linkedLead = linkedLeadForOrder(activeOrder);
          if (linkedLead?.id) ACTIVE_LEAD_ID = linkedLead.id;
          switchTab("leads");
          return;
        }
        if (action === "open-customer") {
          if (activeCustomer?.id) {
            ACTIVE_CUSTOMER_ID = activeCustomer.id;
            CUSTOMER_CREATING = false;
          }
          switchTab("customers");
          return;
        }
          if (action === "record-payment") {
            const order = linkedOrderForJob(activeJob);
            clearPaymentForm({
              customerId: activeJob?.customer_id || order?.customer_id || "",
              orderId: order?.id || activeJob?.order_id || "",
              jobId: activeJob?.id || "",
            });
            switchTab("payments");
            return;
          }
          if (action === "open-manifests") return switchTab("manifests");
          if (action === "open-locates") return switchTab("locates");
          if (action === "open-compliance") return switchTab("compliance");
        });
      });
    }
  }
btnRefreshDashboard?.addEventListener("click", async () => {
  await Promise.allSettled([fetchLeads(), fetchCrmOrders(), fetchPayments(), fetchJobs(), fetchServicePlans(), fetchDashboardLaunchChecklist(), fetchDashboardPaymentState(), loadPersistedBids()]);
  renderDashboard();
  renderLeads(leadSearch?.value || "");
  renderPlans(planSearch?.value || "");
  renderGuidance();
});
btnRefreshMoney?.addEventListener("click", () => renderMoney().catch(console.error));
$('btnExportPaymentsCsv')?.addEventListener('click', () => {
  const rows = [['Order ID','Customer','Date Paid','Amount','Method','Status']];
  (ORDERS_CACHE || []).forEach(o => {
    if (o.amount_paid_cents > 0 || o.payment_state === 'paid') {
      rows.push([
        o.id || '',
        o.customer_name || '',
        (o.paid_at || o.updated_at || '').slice(0, 10),
        o.amount_paid_cents ? (o.amount_paid_cents / 100).toFixed(2) : (o.total_amount || ''),
        o.payment_method || '',
        o.payment_state || o.status || '',
      ]);
    }
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'payments.csv';
  a.click();
});
function renderHydrovacInvoiceWorkbench() {
  if (!hydrovacInvoicePreview || !hydrovacInvoiceJobSelect) return;
  const hydrovacJobs = (JOBS_CACHE || []).filter((job) => isHydrovacJob(job));
  const completed = hydrovacJobs.filter((job) => ["completed", "fulfilled"].includes(String(job.status || "").toLowerCase())).length;
  const withDisposal = hydrovacJobs.filter((job) => Number(job.total_loads_hauled || 0) > 0).length;
  const openAmounts = (CRM_ORDERS_CACHE || []).filter((order) => Number(order.amount_due_cents || 0) > 0).length;
  if (hydrovacInvoiceStageStrip) {
    hydrovacInvoiceStageStrip.innerHTML = [
      { eyebrow: "Ready", value: completed, title: "Completed jobs", copy: "Hydrovac work likely ready for invoice drafting." },
      { eyebrow: "Loads", value: withDisposal, title: "Jobs with disposal", copy: "Jobs that should pull confirmed manifests into the draft." },
      { eyebrow: "AR", value: openAmounts, title: "Open balances", copy: "Quoted or completed work still carrying money due." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (hydrovacInvoiceActionBar) {
    hydrovacInvoiceActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-hydrovac-invoice-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-hydrovac-invoice-action="manifests">Open manifests</button>
      <button type="button" class="pipeline-action-chip" data-hydrovac-invoice-action="payments">Open payments</button>
    `;
    hydrovacInvoiceActionBar.querySelectorAll("[data-hydrovac-invoice-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-hydrovac-invoice-action");
        if (action === "jobs") return switchTab("jobs");
        if (action === "manifests") return switchTab("manifests");
        if (action === "payments") return switchTab("payments");
      });
    });
  }
  hydrovacInvoiceJobSelect.innerHTML = `<option value="">Select a hydrovac job</option>${hydrovacJobs.map((job) => `<option value="${escapeAttr(job.id)}"${job.id === ACTIVE_JOB_ID ? " selected" : ""}>${escapeHtml(job.title || job.customer_name || "Untitled job")} â€” ${escapeHtml(job.scheduled_date || "No date")}</option>`).join("")}`;
  hydrovacInvoicePreview.innerHTML = hydrovacInvoicePreviewHtml(hydrovacInvoiceJobSelect?.value || ACTIVE_JOB_ID || "");
}
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
                  <div class="right"><span class="pill ${grossProfitToneClass(row.grossProfitCents)}">${escapeHtml(formatUsd(row.grossProfitCents))} â€¢ ${escapeHtml(formatPercent(row.marginRatio))}</span></div>
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
                  <div class="right"><span class="pill ${grossProfitToneClass(row.grossProfitCents)}">${escapeHtml(formatUsd(row.grossProfitCents))} â€¢ ${escapeHtml(formatPercent(row.marginRatio))}</span></div>
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

  // AR aging
  const arEl = $("arAgingContent");
  if (arEl) {
    const now = Date.now();
    const buckets = { current: {count:0,cents:0}, d30: {count:0,cents:0}, d60: {count:0,cents:0}, d90: {count:0,cents:0} };
    CRM_ORDERS_CACHE
      .filter(o => !o.is_deleted && orderPaymentState(o) !== 'paid' && orderPaymentState(o) !== 'void')
      .forEach(o => {
        const due = o.payment_due_date ? new Date(o.payment_due_date).getTime() : null;
        const days = due ? Math.floor((now - due) / 86400000) : 0;
        const amt  = Number(o.total_cents || 0) - Number(o.amount_paid_cents || 0);
        const key  = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : 'd90';
        buckets[key].count++;
        buckets[key].cents += amt;
      });
    const rows = [
      ['Current', buckets.current],
      ['1â€“30 days overdue', buckets.d30],
      ['31â€“60 days overdue', buckets.d60],
      ['61+ days overdue', buckets.d90],
    ];
    const total = Object.values(buckets).reduce((s, b) => s + b.cents, 0);
    if (total > 0) {
      arEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
          ${rows.map(([label, b]) => b.count ? `<tr>
            <td style="padding:7px 0;color:rgba(255,255,255,.6);">${label}</td>
            <td style="padding:7px 0;text-align:right;color:${label.includes('61') ? '#f87171' : label.includes('31') ? '#fb923c' : '#e8e9eb'};font-weight:600;">${money(b.cents/100)}</td>
            <td style="padding:7px 0;text-align:right;color:rgba(255,255,255,.35);padding-left:12px;">${b.count} order${b.count>1?'s':''}</td>
          </tr>` : '').join('')}
          <tr style="border-top:1px solid rgba(255,255,255,.08);">
            <td style="padding:7px 0;font-weight:700;color:#e8e9eb;">Total AR</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;color:#e8e9eb;">${money(total/100)}</td>
            <td></td>
          </tr>
        </table>`;
    } else {
      arEl.innerHTML = '<div class="muted" style="font-size:.85rem;">No outstanding receivables.</div>';
    }
  }
  renderHydrovacInvoiceWorkbench();
}

// â”€â”€ Setup Wizard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function maybeShowSetupWizard() {
  if (localStorage.getItem('pl_wizard_dismissed')) return;
  const cfg = SETUP_STATE?.config || {};
  // First time if: no logo, no business hours configured, no customers yet
  const isFirstTime = !cfg.logo_url && (!CUSTOMERS_CACHE || CUSTOMERS_CACHE.length === 0);
  if (!isFirstTime) return;
  showSetupWizard();
}

function showSetupWizard() {
  const existing = document.getElementById('setupWizardModal');
  if (existing) return;
  const modal = document.createElement('div');
  modal.id = 'setupWizardModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:480px;">
    <h2 style="margin:0 0 8px;font-size:1.2rem;">Welcome to ProofLink! ðŸ‘‹</h2>
    <p style="color:rgba(255,255,255,.65);margin:0 0 20px;font-size:.9rem;">Let's get your business set up in 3 quick steps so you can start taking bookings.</p>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;">
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('setup');" style="text-align:left;padding:14px 16px;">
        <div style="font-weight:600;">1. Set up your business profile</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.55);font-weight:400;">Name, logo, timezone, contact info</div>
      </button>
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('availability');" style="text-align:left;padding:14px 16px;">
        <div style="font-weight:600;">2. Set your availability</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.55);font-weight:400;">Business hours and lead time</div>
      </button>
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('bookings');" style="text-align:left;padding:14px 16px;">
        <div style="font-weight:600;">3. Share your booking link</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.55);font-weight:400;">Get your first customer booked</div>
      </button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <button class="btn btn-ghost" style="font-size:.8rem;" onclick="localStorage.setItem('pl_wizard_dismissed','1');document.getElementById('setupWizardModal')?.remove();">Skip setup</button>
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('setup');">Get started â†’</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
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
      fetchCustomers(),
      fetchLeads(),
      fetchCrmOrders(),
      fetchPayments(),
      fetchJobs(),
    ]);
    loadBidDrafts();
    await loadPersistedBids();

    showApp(user);
    applyWorkspaceBlueprint();

    renderProductsList("");
    renderAvailability();
    renderBookings();
    renderExpenses(EXPENSES_CACHE);
    renderPricing([]);
    renderStartupChecklist();
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
    switchTab(panelFromLocation(), { updateHash: false });

    window.PROOFLINK_BOOT_READY = true;
    maybeShowSetupWizard().catch(console.warn);
    startRealtime();
    registerPushNotifications();

    Promise.allSettled([
      fetchExpenses(),
      fetchServicePlans(),
      fetchAvailability(),
      fetchPricing(),
      refreshPicklists(),
      fetchDashboardLaunchChecklist(),
      fetchDashboardPaymentState(),
      fetchOperatorSetup(),
      fetchReviews(),
    ]).then(async (results) => {
      const pricingData = results[3];
      if (pricingData?.status === "fulfilled") {
        renderPricing(pricingData.value || []);
      }
      renderAvailability();
      renderBookings();
      renderExpenses(EXPENSES_CACHE);
      renderStartupChecklist();
      applyWorkspaceBlueprint();
      renderDashboard();
      renderPlans(planSearch?.value || "");
      renderGuidance();
      renderReviews();
      await renderMoney();
      const activeTab = panelFromLocation();
      if (activeTab === "setup") {
        renderSetupPreviewActions?.();
      }
    }).catch(console.warn);
  } catch (err) {
    console.error(err);
    CURRENT_OPERATOR = null;
    window.PROOFLINK_BOOT_READY = false;
    showLogin(err?.message || String(err));
  } finally {
    BOOTING = false;
  }
}

// â”€â”€ Push Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Invoice PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function generateInvoicePDF(order) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) { notifyOperator("The PDF tool is not loaded yet. Refresh and try again."); return; }

  const doc  = new jsPDF({ unit: "pt", format: "letter" });
  const W    = doc.internal.pageSize.getWidth();
  const red  = [200, 75, 47];
  const dark = [26, 26, 26];
  const grey = [100, 100, 100];

  const fmt  = (v) => isNaN(Number(v)) ? "â€”" : "$" + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
  doc.text(String(order.customer_name || "â€”"), W - 200, 96);
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
  doc.text("Generated by ProofLink Â· prooflink.co", W / 2, doc.internal.pageSize.getHeight() - 24, { align: "center" });

  const filename = `invoice-${String(order.id || "order").slice(0, 8)}-${now.replace(/\s/g, "-")}.pdf`;
  doc.save(filename);
}

// â”€â”€ Reviews â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchReviews() {
  if (FETCHING.has('reviews')) return;
  FETCHING.add('reviews');
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/get-reviews", {
      headers: { "Authorization": `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    REVIEWS_CACHE = d.reviews || [];
    return REVIEWS_CACHE;
  } catch (e) {
    console.warn("[reviews] fetch failed:", e.message);
    return [];
  } finally {
    FETCHING.delete('reviews');
  }
}

function renderReviews(reviews) {
  const el = $("reviewsList");
  if (!el) return;
  const rows = reviews || REVIEWS_CACHE;
  if (!rows.length) {
    el.innerHTML = `<div class="muted">No reviews yet. Reviews are collected when customers click the review link in their completion email.</div>`;
    return;
  }
  const avgRating = rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length;
  const stars = (n) => "â˜…".repeat(Math.round(n)) + "â˜†".repeat(5 - Math.round(n));
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);">
      <div style="font-size:2rem;color:#fbbf24;">${stars(avgRating)}</div>
      <div>
        <div style="font-size:1.1rem;font-weight:700;">${avgRating.toFixed(1)} average</div>
        <div class="muted" style="font-size:.82rem;">${rows.length} review${rows.length === 1 ? "" : "s"}</div>
      </div>
    </div>
    <div class="list">
      ${rows.map((r) => `
        <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:4px;">
          <div style="display:flex;align-items:center;gap:10px;width:100%;">
            <span style="color:#fbbf24;font-size:1rem;">${stars(Number(r.rating || 0))}</span>
            <strong style="flex:1;">${escapeHtml(r.customer_name || "Anonymous")}</strong>
            <span class="muted" style="font-size:.75rem;">${formatDateOnly(r.created_at)}</span>
          </div>
          ${(r.review_text || r.comment) ? `<div style="font-size:.85rem;color:var(--muted);padding-left:2px;">${escapeHtml(r.review_text || r.comment)}</div>` : ""}
          ${r.order_id ? `<div style="font-size:.75rem;color:var(--muted);">Order: ${escapeHtml(String(r.order_id).slice(0, 8))}</div>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

async function fetchAndRenderReviews() {
  await fetchReviews();
  renderReviews();
}

$("btnRefreshReviews")?.addEventListener("click", () => fetchAndRenderReviews().catch(console.error));

$("btnExportReviewsCsv")?.addEventListener("click", () => {
  const rows = REVIEWS_CACHE;
  if (!rows.length) { notifyOperator("There are no reviews to export yet."); return; }
  const headers = ["id", "customer_name", "customer_email", "rating", "comment", "order_id", "created_at"];
  downloadCsv("reviews", headers, rows.map((r) => headers.map((h) => r[h] ?? "")));
});

// â”€â”€ Quotes Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchQuotes(status) {
  if (FETCHING.has('quotes')) return;
  FETCHING.add('quotes');
  try {
    const tok = await getAccessToken();
    const url = status
      ? `/.netlify/functions/get-quotes?status=${encodeURIComponent(status)}`
      : "/.netlify/functions/get-quotes";
    const res = await fetch(url, { headers: { "Authorization": `Bearer ${tok}` }, signal: _tabAbortController?.signal });
    const d   = await res.json().catch(() => ({}));
    QUOTES_CACHE = d.quotes || [];
    TABS_LOADED.delete('quotes');
    return QUOTES_CACHE;
  } catch (e) {
    if (e.name === 'AbortError' || e.message?.includes('abort')) return;
    console.warn("[quotes] fetch failed:", e.message);
    return [];
  } finally {
    FETCHING.delete('quotes');
  }
}

function renderQuotesList() {
  const el = $("quotesList");
  if (!el) return;
  const statusFilter = $("quotesStatusFilter")?.value || "";
  const rows = statusFilter ? QUOTES_CACHE.filter((q) => q.status === statusFilter) : QUOTES_CACHE;

  if (!rows.length) {
    el.innerHTML = `<div class="muted">No quote pages found yet. In service workspaces, build and send quotes from Walkthrough Bids.</div>`;
    return;
  }

  const statusColor = { pending: "#93c5fd", accepted: "#4ade80", declined: "#f87171", expired: "rgba(255,255,255,.35)" };
  const fmtMoney = (cents) => cents != null ? "$" + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "â€”";

  el.innerHTML = `
    <div class="list">
      ${rows.map((q) => {
        const color = statusColor[q.status] || "rgba(255,255,255,.5)";
        const quoteUrl = `${location.origin}/quote.html?id=${encodeURIComponent(q.id)}`;
        const isPending = q.status === "pending";
        return `
        <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:6px;">
          <div style="display:flex;align-items:center;gap:10px;width:100%;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:.9rem;">${escapeHtml(q.title || "Quote")}</div>
              <div class="muted" style="font-size:.78rem;">${escapeHtml(q.customer_name || "")}${q.customer_email ? ` Â· ${escapeHtml(q.customer_email)}` : ""} Â· ${formatDateOnly(q.created_at)}</div>
            </div>
            <span style="font-size:.75rem;padding:3px 9px;background:rgba(255,255,255,.06);border-radius:12px;color:${color};white-space:nowrap;">${escapeHtml(q.status || "pending")}</span>
            <span style="font-size:.85rem;font-weight:700;color:var(--text);white-space:nowrap;">${fmtMoney(q.amount_cents)}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a href="${escapeHtml(quoteUrl)}" target="_blank" style="font-size:.78rem;color:var(--accent);text-decoration:none;">View quote page â†’</a>
            ${isPending ? `<button class="btn btn-ghost btn-sm qt-resend-btn" data-email="${escapeHtml(q.customer_email || "")}" data-url="${escapeHtml(quoteUrl)}" data-name="${escapeHtml(q.customer_name || "")}" type="button" style="font-size:.75rem;padding:2px 8px;">Copy link</button>` : ""}
            ${q.accepted_at ? `<span class="muted" style="font-size:.75rem;">Accepted ${formatDateOnly(q.accepted_at)}</span>` : ""}
            ${q.declined_at ? `<span class="muted" style="font-size:.75rem;">Declined ${formatDateOnly(q.declined_at)}</span>` : ""}
            ${q.valid_until ? `<span class="muted" style="font-size:.75rem;">Valid until ${formatDateOnly(q.valid_until)}</span>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>
  `;

  // Resend link: copy to clipboard
  el.querySelectorAll(".qt-resend-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url  = btn.dataset.url;
      const name = btn.dataset.name;
      const email = btn.dataset.email;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
        });
      } else {
        showCopyModal(`Copy this link and send it to ${name || "the customer"}.`, url).catch(() => {});
      }
    });
  });
}

async function fetchAndRenderQuotes() {
  const statusFilter = $("quotesStatusFilter")?.value || "";
  await fetchQuotes();
  renderQuotesList();
}

$("btnRefreshQuotes")?.addEventListener("click", () => fetchAndRenderQuotes().catch(console.error));

$("quotesStatusFilter")?.addEventListener("change", () => renderQuotesList());

$("btnExportQuotesCsv")?.addEventListener("click", () => {
  if (!QUOTES_CACHE.length) { notifyOperator("There are no quotes to export yet."); return; }
  const headers = ["id", "title", "customer_name", "customer_email", "amount_cents", "status", "valid_until", "created_at", "accepted_at", "declined_at"];
  downloadCsv("quotes", headers, QUOTES_CACHE.map((q) => headers.map((h) => q[h] ?? "")));
});

// â”€â”€ Global Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const globalSearch = $("globalSearch");
const globalSearchOverlay = $("globalSearchOverlay");
const globalSearchResults = $("globalSearchResults");

function runGlobalSearch(q) {
  if (!CRM_ORDERS_CACHE?.length && !CUSTOMERS_CACHE?.length && !BOOKINGS_CACHE?.length) {
    const overlay = $("globalSearchOverlay");
    if (overlay) overlay.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.4);font-size:.85rem;">Loading dataâ€¦ try again in a moment.</div>';
    return;
  }
  if (!q || q.length < 2) { if (globalSearchOverlay) globalSearchOverlay.style.display = "none"; return; }
  const lq = q.toLowerCase();

  const matchedOrders = (CRM_ORDERS_CACHE || []).filter((o) =>
    [o.customer_name, o.email, o.title, o.status, o.id].some((v) => String(v || "").toLowerCase().includes(lq))
  ).slice(0, 5);

  const matchedCustomers = (CUSTOMERS_CACHE || []).filter((c) =>
    [c.name, c.email, c.phone].some((v) => String(v || "").toLowerCase().includes(lq))
  ).slice(0, 5);

  const matchedBookings = (BOOKINGS_CACHE || []).filter((b) =>
    [b.customer_name, b.customer_email, b.title].some((v) => String(v || "").toLowerCase().includes(lq))
  ).slice(0, 4);

  const total = matchedOrders.length + matchedCustomers.length + matchedBookings.length;
  if (!total) {
    if (globalSearchResults) globalSearchResults.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:.85rem;">No results for "${escapeHtml(q)}"</div>`;
    if (globalSearchOverlay) globalSearchOverlay.style.display = "block";
    return;
  }

  let html = "";
  const sectionStyle = "padding:6px 16px 4px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);";
  const itemStyle = "display:flex;gap:10px;align-items:center;padding:9px 16px;cursor:pointer;border-radius:6px;";
  const itemHover = "onmouseover=\"this.style.background='rgba(255,255,255,.04)'\" onmouseout=\"this.style.background=''\"";

  if (matchedOrders.length) {
    html += `<div style="${sectionStyle}">Orders</div>`;
    html += matchedOrders.map((o) => `
      <div style="${itemStyle}" ${itemHover} data-search-tab="orders" data-search-id="${escapeAttr(o.id)}">
        <span style="font-size:.9rem;">${escapeHtml(o.customer_name || "Unnamed")}</span>
        <span class="pill" style="font-size:.72rem;">${escapeHtml(o.status || "new")}</span>
        <span class="muted" style="font-size:.78rem;margin-left:auto;">${escapeHtml(o.email || "")}</span>
      </div>
    `).join("");
  }
  if (matchedCustomers.length) {
    html += `<div style="${sectionStyle}">Customers</div>`;
    html += matchedCustomers.map((c) => `
      <div style="${itemStyle}" ${itemHover} data-search-tab="customers" data-search-id="${escapeAttr(c.id)}">
        <span style="font-size:.9rem;">${escapeHtml(c.name || "Unnamed")}</span>
        <span class="muted" style="font-size:.78rem;margin-left:auto;">${escapeHtml(c.email || "")}</span>
      </div>
    `).join("");
  }
  if (matchedBookings.length) {
    html += `<div style="${sectionStyle}">Bookings</div>`;
    html += matchedBookings.map((b) => `
      <div style="${itemStyle}" ${itemHover} data-search-tab="bookings" data-search-id="${escapeAttr(b.id)}">
        <span style="font-size:.9rem;">${escapeHtml(b.title || "Booking")}</span>
        <span class="muted" style="font-size:.78rem;margin-left:auto;">${escapeHtml(b.customer_name || "")}</span>
      </div>
    `).join("");
  }

  if (globalSearchResults) globalSearchResults.innerHTML = html;
  if (globalSearchOverlay) globalSearchOverlay.style.display = "block";

  globalSearchOverlay?.querySelectorAll("[data-search-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      const tab = el.dataset.searchTab;
      const id = el.dataset.searchId;
      if (tab === "orders") { ACTIVE_ORDER_ID = id; switchTab("orders"); }
      else if (tab === "customers") { ACTIVE_CUSTOMER_ID = id; CUSTOMER_CREATING = false; switchTab("customers"); }
      else if (tab === "bookings") switchTab("bookings");
      if (globalSearch) globalSearch.value = "";
      if (globalSearchOverlay) globalSearchOverlay.style.display = "none";
    });
  });
}

globalSearch?.addEventListener("input", debounce(() => runGlobalSearch(globalSearch.value.trim())));
globalSearch?.addEventListener("keydown", (e) => { if (e.key === "Escape") { globalSearchOverlay.style.display = "none"; globalSearch.value = ""; } });
document.addEventListener("click", (e) => {
  if (globalSearchOverlay && !globalSearch?.contains(e.target) && !globalSearchOverlay.contains(e.target)) {
    globalSearchOverlay.style.display = "none";
  }
});

// â”€â”€ Dark / Light mode toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

(function () {
  const saved = localStorage.getItem("pl_theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

$("btnDarkMode")?.addEventListener("click", () => {
  if (window.__prooflinkThemeManaged) return;
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("pl_theme", next);
  const btn = $("btnDarkMode");
  if (btn) btn.textContent = next === "light" ? "â˜¾" : "â˜€";
});

// â”€â”€ CSV Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

$("btnExportCustomersCsv")?.addEventListener("click", () => {
  const rows = [['Name','Email','Phone','City','State','Created']];
  (CUSTOMERS_CACHE || []).forEach(c => {
    rows.push([c.name||'', c.email||'', c.phone||'', c.city||'', c.state||'', (c.created_at||'').slice(0,10)]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'customers.csv'; a.click();
});

// â”€â”€ Bulk Customer Import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
$("btnImportCustomers")?.addEventListener("click", () => {
  const existing = document.getElementById("importCustomersModal");
  if (existing) { existing.remove(); return; }
  const modal = document.createElement("div");
  modal.id = "importCustomersModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;";
  modal.innerHTML = `
    <div style="background:#1a1d27;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:28px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <strong style="font-size:1rem;">Import customers from CSV</strong>
        <button id="importCustClose" type="button" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:1.2rem;cursor:pointer;">âœ•</button>
      </div>
      <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:10px;">Expected format (one per line):<br /><code style="font-size:.75rem;">Name, Email, Phone, Address, City, State, Zip</code></div>
      <textarea id="importCsvData" class="input" rows="8" style="width:100%;font-family:monospace;font-size:.8rem;resize:vertical;" placeholder="Jane Smith, jane@example.com, 555-1234, 123 Main St, Springfield, IL, 62701&#10;John Doe, john@example.com, 555-9999"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button id="btnImportCsvPreview" class="btn btn-ghost btn-sm" type="button">Preview</button>
        <button id="btnImportCsvSubmit" class="btn btn-primary btn-sm" type="button" disabled>Import 0 customers</button>
        <button id="importCustCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
      </div>
      <div id="importCsvPreviewWrap" style="margin-top:12px;"></div>
      <div id="importCsvMsg" style="font-size:.8rem;margin-top:8px;"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#importCustClose").onclick = () => modal.remove();
  modal.querySelector("#importCustCancel").onclick = () => modal.remove();
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  let parsedRows = [];

  function parseCsv(raw) {
    return raw.split("\n")
      .map((line) => line.split(",").map((c) => c.trim()))
      .filter((cols) => cols.length >= 1 && cols[0]);
  }

  modal.querySelector("#btnImportCsvPreview").onclick = () => {
    const raw = modal.querySelector("#importCsvData").value.trim();
    if (!raw) { modal.querySelector("#importCsvMsg").textContent = "Paste CSV data first."; return; }
    parsedRows = parseCsv(raw);
    const preview = parsedRows.slice(0, 5);
    const previewWrap = modal.querySelector("#importCsvPreviewWrap");
    previewWrap.innerHTML = `
      <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:6px;">Preview (first ${preview.length} of ${parsedRows.length} rows):</div>
      <table style="width:100%;font-size:.78rem;border-collapse:collapse;">
        <thead><tr style="color:rgba(255,255,255,.35);">${["Name","Email","Phone","Address","City","State","Zip"].map((h) => `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">${h}</th>`).join("")}</tr></thead>
        <tbody>${preview.map((r) => `<tr>${r.slice(0,7).map((c) => `<td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
    const submitBtn = modal.querySelector("#btnImportCsvSubmit");
    submitBtn.textContent = `Import ${parsedRows.length} customer${parsedRows.length === 1 ? "" : "s"}`;
    submitBtn.disabled = false;
    modal.querySelector("#importCsvMsg").textContent = "";
  };

  modal.querySelector("#btnImportCsvSubmit").onclick = async () => {
    const submitBtn = modal.querySelector("#btnImportCsvSubmit");
    const msgEl     = modal.querySelector("#importCsvMsg");
    if (!parsedRows.length) { msgEl.textContent = "No rows to import."; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Importingâ€¦";
    try {
      const tok = await getAccessToken();
      const customers = parsedRows.map(([name, email, phone, address, city, state, zip]) => ({
        name: name || "", email: email || undefined, phone: phone || undefined,
        address: address || undefined, city: city || undefined, state: state || undefined, zip: zip || undefined,
      }));
      const res = await fetch("/.netlify/functions/bulk-import-customers", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ customers }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Import failed");
      const imported = d.imported || 0;
      const skipped  = d.skipped  || 0;
      msgEl.textContent = `Imported ${imported}, Skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}`;
      msgEl.style.color = "#4ade80";
      await fetchCustomers();
      renderCustomersList(customerSearch?.value || "");
      submitBtn.textContent = "Done";
      setTimeout(() => modal.remove(), 2500);
    } catch (err) {
      msgEl.textContent = err.message || "Import failed.";
      msgEl.style.color = "#f87171";
      submitBtn.disabled = false;
      submitBtn.textContent = `Import ${parsedRows.length} customers`;
    }
  };
});

// â”€â”€ Customer Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchAndRenderMessages() {
  const list = $("messagesList");
  if (!list) return;
  list.innerHTML = `<p class="muted" style="padding:12px 0;">Loadingâ€¦</p>`;
  try {
    const { data, error } = await sb
      .from("customer_messages")
      .select("id, customer_name, customer_email, message, reply_text, replied_at, created_at, status")
      .eq(TENANT_COLUMN, TENANT_ID)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    if (!data || !data.length) {
      list.innerHTML = `<p class="muted" style="padding:12px 0;">No messages yet.</p>`;
      return;
    }

    list.innerHTML = data.map((msg) => {
      const date = msg.created_at ? new Date(msg.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "â€”";
      return `<div style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,.06);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="font-weight:600;font-size:.88rem;">${escapeHtml(msg.customer_name || "Customer")}</div>
          <div style="font-size:.78rem;color:rgba(255,255,255,.4);">${escapeHtml(msg.customer_email || "")}</div>
          <div style="font-size:.75rem;color:rgba(255,255,255,.3);margin-left:auto;">${date}</div>
        </div>
        <div style="font-size:.85rem;color:rgba(255,255,255,.7);margin-bottom:${msg.reply_text ? '8px' : '10px'};">${escapeHtml(msg.message || "")}</div>
        ${msg.reply_text ? `<div style="background:rgba(200,75,47,.08);border-left:3px solid #c84b2f;padding:8px 12px;font-size:.82rem;color:rgba(255,255,255,.6);margin-bottom:8px;"><span style="font-size:.75rem;color:#c84b2f;font-weight:600;display:block;margin-bottom:4px;">Your reply</span>${escapeHtml(msg.reply_text)}</div>` : ""}
        ${!msg.reply_text ? `<div style="margin-top:6px;">
          <div class="msg-reply-form" data-id="${escapeAttr(msg.id)}" data-name="${escapeAttr(msg.customer_name || "")}" style="display:none;">
            <textarea class="msg-reply-input" rows="3" placeholder="Type your replyâ€¦" style="width:100%;background:#0f1117;border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e8e9eb;padding:8px 10px;font-size:.85rem;resize:vertical;margin-bottom:6px;font-family:inherit;outline:none;"></textarea>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary btn-sm msg-send-reply" type="button">Send reply</button>
              <button class="btn btn-ghost btn-sm msg-cancel-reply" type="button">Cancel</button>
            </div>
            <div class="msg-reply-result" style="font-size:.8rem;margin-top:6px;"></div>
          </div>
          <button class="btn btn-ghost btn-sm msg-show-reply" data-id="${escapeAttr(msg.id)}" type="button">Reply</button>
        </div>` : ""}
      </div>`;
    }).join("");

    // Wire up reply buttons
    list.querySelectorAll(".msg-show-reply").forEach((btn) => {
      btn.addEventListener("click", () => {
        const form = list.querySelector(`.msg-reply-form[data-id="${btn.dataset.id}"]`);
        if (form) { form.style.display = "block"; btn.style.display = "none"; }
      });
    });
    list.querySelectorAll(".msg-cancel-reply").forEach((btn) => {
      btn.addEventListener("click", () => {
        const form = btn.closest(".msg-reply-form");
        const showBtn = list.querySelector(`.msg-show-reply[data-id="${form.dataset.id}"]`);
        if (form) form.style.display = "none";
        if (showBtn) showBtn.style.display = "";
      });
    });
    list.querySelectorAll(".msg-send-reply").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const form      = btn.closest(".msg-reply-form");
        const textarea  = form.querySelector(".msg-reply-input");
        const resultEl  = form.querySelector(".msg-reply-result");
        const reply     = textarea.value.trim();
        if (!reply) { resultEl.textContent = "Please enter a reply."; resultEl.style.color = "#f87171"; return; }
        btn.disabled = true; btn.textContent = "Sendingâ€¦";
        try {
          const tok = await getAccessToken();
          const res = await fetch("/.netlify/functions/reply-customer-message", {
            method : "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
            body   : JSON.stringify({ message_id: form.dataset.id, reply_text: reply }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || "Failed to send reply");
          resultEl.textContent = "Reply sent âœ“";
          resultEl.style.color = "#4ade80";
          setTimeout(() => fetchAndRenderMessages().catch(console.error), 1500);
        } catch (err) {
          resultEl.textContent = err.message || "Error";
          resultEl.style.color = "#f87171";
          btn.disabled = false;
          btn.textContent = "Send reply";
        }
      });
    });
  } catch (err) {
    console.error("[fetchAndRenderMessages]", err);
    list.innerHTML = `<p class="muted" style="padding:12px 0;">Failed to load messages.</p>`;
  }
}

$("btnRefreshMessages")?.addEventListener("click", () => fetchAndRenderMessages().catch(console.error));

$("btnCopyBookingLink")?.addEventListener("click", async () => {
  const siteUrl = window.location.origin;
  const link = `${siteUrl}/book.html?tenant=${encodeURIComponent(TENANT_ID)}`;
  try {
    await navigator.clipboard.writeText(link);
    const btn = $("btnCopyBookingLink");
    if (btn) { const t = btn.textContent; btn.textContent = "âœ“ Copied!"; setTimeout(() => { btn.textContent = t; }, 2000); }
  } catch {
    showCopyModal("Copy this booking link.", link).catch(() => {});
  }
});

// â”€â”€ Sidebar More toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
$("btnSidebarMore")?.addEventListener("click", () => {
  const more = $("sidebarMore");
  if (!more) return;
  const isOpen = more.style.display !== 'none';
  more.style.display = isOpen ? 'none' : 'block';
  const btn = $("btnSidebarMore");
  if (btn) btn.textContent = isOpen ? 'Tools' : 'Hide tools';
  try { localStorage.setItem('pl_sidebar_simple', isOpen ? '1' : '0'); } catch {}
});

// Auto-expand More panel when a secondary tab is navigated to directly (hash, back button, etc.)
function ensureSecondaryTabVisible(tab) {
  if (!SECONDARY_TABS.has(tab)) return;
  const more = $("sidebarMore");
  const btn  = $("btnSidebarMore");
  if (more && more.style.display === 'none') {
    more.style.display = 'block';
    if (btn) btn.textContent = 'Hide tools';
  }
}

// â”€â”€ AI Copilot Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let AI_PANEL_LOADED = false;

async function initAIPanel() {
  if (AI_PANEL_LOADED) return;
  AI_PANEL_LOADED = true;
  await loadAIBriefing();
}

async function loadAIBriefing() {
  const briefEl   = $("aiBriefContent");
  const statusEl  = $("aiBriefStatus");
  const chipsEl   = $("aiContextChips");
  if (!briefEl) return;
  if (statusEl) { statusEl.textContent = "Loadingâ€¦"; statusEl.style.display = "block"; }
  briefEl.style.display = "none";
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/ai-brief", {
      method : "GET",
      headers: { "Authorization": `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to load briefing");
    if (statusEl) statusEl.style.display = "none";
    briefEl.style.display = "block";
    // Render briefing text (preserve newlines)
    briefEl.innerHTML = d.briefing
      ? d.briefing.split("\n").map((line) => `<p style="margin:0 0 6px;">${escapeHtml(line) || "&nbsp;"}</p>`).join("")
      : "<p class='muted'>No briefing available.</p>";
    // Render context chips
    if (chipsEl && d.context_summary) {
      const cs = d.context_summary;
      const chips = [
        cs.today_appointments > 0 && `${cs.today_appointments} appt${cs.today_appointments > 1 ? "s" : ""} today`,
        cs.unpaid_orders > 0 && `${cs.unpaid_orders} unpaid`,
        cs.pending_quotes > 0 && `${cs.pending_quotes} pending quote${cs.pending_quotes > 1 ? "s" : ""}`,
        cs.unread_messages > 0 && `${cs.unread_messages} message${cs.unread_messages > 1 ? "s" : ""}`,
        cs.overdue_orders > 0 && `${cs.overdue_orders} overdue`,
      ].filter(Boolean);
      chipsEl.innerHTML = chips.map((c) => `<span style="display:inline-block;background:rgba(200,75,47,.15);border:1px solid rgba(200,75,47,.3);border-radius:12px;padding:2px 10px;font-size:.75rem;color:rgba(255,255,255,.7);">${escapeHtml(c)}</span>`).join(" ");
    }
  } catch (err) {
    console.error("[loadAIBriefing]", err);
    if (statusEl) { statusEl.textContent = err.message || "Failed to load."; }
    briefEl.style.display = "none";
  }
}

$("btnRefreshBrief")?.addEventListener("click", async () => {
  AI_PANEL_LOADED = false;
  await loadAIBriefing();
  AI_PANEL_LOADED = true;
});

async function aiAskQuestion(question) {
  const answerEl = $("aiAnswer");
  const errorEl  = $("aiError");
  const btn      = $("btnAskAI");
  if (!answerEl) return;
  if (btn) btn.disabled = true;
  if (errorEl) errorEl.style.display = "none";
  answerEl.style.display = "block";
  answerEl.textContent = "Thinkingâ€¦";
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/ai-copilot", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body   : JSON.stringify({ question, mode: "copilot" }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to get answer");
    answerEl.textContent = d.answer || "(no response)";
  } catch (err) {
    answerEl.style.display = "none";
    if (errorEl) { errorEl.textContent = err.message || "Error"; errorEl.style.display = "block"; }
  }
  if (btn) btn.disabled = false;
}

$("btnAskAI")?.addEventListener("click", () => {
  const q = $("aiQuestion")?.value.trim();
  if (q) aiAskQuestion(q);
});

$("aiQuestion")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnAskAI")?.click(); }
});

// Quick-action buttons
document.querySelectorAll(".ai-quick[data-q]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $("aiQuestion");
    if (input) input.value = btn.getAttribute("data-q");
    aiAskQuestion(btn.getAttribute("data-q"));
  });
});

function buildDraftExtras(draft_type) {
  const extras = {};
  if (ACTIVE_ORDER_ID) {
    const order = CRM_ORDERS_CACHE?.find((o) => o.id === ACTIVE_ORDER_ID);
    if (order) {
      extras.customer_name = order.customer_name || order.email || '';
      extras.order_title   = order.title || order.cart_summary || '';
      extras.amount        = order.total_cents ? `$${(order.total_cents / 100).toFixed(2)}` : (order.total_amount || '');
      extras.status        = order.status || '';
      extras.days_overdue  = order.payment_due_date
        ? Math.max(0, Math.floor((Date.now() - new Date(order.payment_due_date).getTime()) / 86400000))
        : null;
    }
  }
  if (ACTIVE_BID_ID) {
    const bid = BIDS_CACHE?.find((b) => b.id === ACTIVE_BID_ID);
    if (bid && !extras.customer_name) {
      extras.bid_title = bid.title || '';
    }
  }
  return extras;
}
async function requestAIDraft(draft_type) {
  const areaEl   = $("aiDraftArea");
  const outputEl = $("aiDraftText");
  const copyBtn  = $("btnCopyDraft");
  if (!outputEl) return;
  if (areaEl) areaEl.style.display = "block";
  if (copyBtn) copyBtn.style.display = "none";
  outputEl.textContent = "Draftingâ€¦";
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/ai-copilot", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body   : JSON.stringify({ question: draft_type, mode: "draft", draft_type, draft_extras: buildDraftExtras(draft_type) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to generate draft");
    outputEl.textContent = d.answer || "(no draft generated)";
    if (copyBtn) copyBtn.style.display = "inline-flex";
  } catch (err) {
    outputEl.textContent = `Error: ${err.message || "Unknown error"}`;
  }
}

// Draft assistant buttons
document.querySelectorAll(".ai-draft[data-type]").forEach((btn) => {
  btn.addEventListener("click", () => requestAIDraft(btn.getAttribute("data-type")));
});

$("btnCopyDraft")?.addEventListener("click", () => {
  const text = $("aiDraftText")?.textContent || "";
  if (text) navigator.clipboard.writeText(text).catch(() => {});
});

$("btnCloseDraft")?.addEventListener("click", () => {
  const area = $("aiDraftArea");
  if (area) area.style.display = "none";
});

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

// Restore sidebar preference
try {
  if (localStorage.getItem('pl_sidebar_simple') === '1') {
    const more = $("sidebarMore");
    if (more) more.style.display = 'none';
  }
  const btn = $("btnSidebarMore");
  const more = $("sidebarMore");
  if (btn) btn.textContent = more && more.style.display !== 'none' ? 'Hide tools' : 'Tools';
} catch {}

boot().catch((err) => {
  console.error(err);
  showLogin(err?.message || String(err));
});

// â”€â”€ Availability blocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let AVAILABILITY_BLOCKS_CACHE = [];

async function loadAvailabilityBlocks() {
  try {
    const tok = await getAccessToken();
    const res = await fetch('/.netlify/functions/manage-availability-blocks', {
      headers: { 'Authorization': `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    AVAILABILITY_BLOCKS_CACHE = d.blocks || [];
  } catch { AVAILABILITY_BLOCKS_CACHE = []; }
  renderAvailabilityBlocks();
}

function renderAvailabilityBlocks() {
  const el = $('availabilityBlocksList');
  if (!el) return;
  if (!AVAILABILITY_BLOCKS_CACHE.length) {
    el.innerHTML = '<div class="muted" style="font-size:.82rem;">No date blocks. Add one to pause bookings during vacations or off-season.</div>';
    return;
  }
  el.innerHTML = AVAILABILITY_BLOCKS_CACHE.map(b => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div>
        <div style="font-weight:500;color:#e8e9eb;">${escapeHtml(b.title || 'Unavailable')}</div>
        <div style="font-size:.78rem;color:rgba(255,255,255,.4);">
          ${new Date(b.starts_at).toLocaleDateString()} â€“ ${new Date(b.ends_at).toLocaleDateString()}
          ${b.block_bookings ? ' Â· <span style="color:#fbbf24;">Blocks new bookings</span>' : ''}
        </div>
      </div>
      <button class="btn btn-ghost" style="font-size:.72rem;" onclick="deleteAvailBlock('${escapeAttr(b.id)}')">Delete</button>
    </div>`).join('');
}

async function deleteAvailBlock(id) {
  if (!(await showConfirmModal('Delete this date block?', 'Delete', 'Cancel'))) return;
  const tok = await getAccessToken();
  await fetch(`/.netlify/functions/manage-availability-blocks?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'Authorization': `Bearer ${tok}` },
  });
  await loadAvailabilityBlocks();
}

$('btnAddAvailBlock')?.addEventListener('click', () => {
  const existing = document.getElementById('addAvailBlockModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'addAvailBlockModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px 28px;max-width:400px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 16px;font-size:1rem;color:#e8e9eb;">Block dates</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
        <input id="abTitle" class="input" placeholder="Label (e.g. Winter break, Vacation)" style="width:100%;" />
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">From</label>
            <input id="abStart" type="date" class="input" style="width:100%;" /></div>
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">To</label>
            <input id="abEnd" type="date" class="input" style="width:100%;" /></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer;">
          <input id="abBlockBookings" type="checkbox" checked /> Block new customer bookings during this period
        </label>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('addAvailBlockModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="abSave" class="btn btn-primary">Save block</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('abSave').onclick = async () => {
    const starts = $('abStart')?.value;
    const ends = $('abEnd')?.value;
    if (!starts || !ends) { notifyOperator("Add both a start and end date."); return; }
    if (starts > ends) { notifyOperator("The start date needs to come before the end date."); return; }
    const btn = $('abSave'); btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-availability-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          title         : ($('abTitle')?.value || '').trim() || 'Unavailable',
          starts_at     : starts,
          ends_at       : ends,
          block_bookings: $('abBlockBookings')?.checked !== false,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Date block saved.');
      modal.remove();
      await loadAvailabilityBlocks();
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Save block';
    }
  };
});

// â”€â”€ Package sessions summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderPackagesSummary() {
  const card = $('packagesSummaryCard');
  const list = $('packagesSummaryList');
  if (!card || !list) return;
  const packages = (CRM_ORDERS_CACHE || []).filter(o => o.order_type === 'package' && !o.is_deleted);
  if (!packages.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  list.innerHTML = packages.map(p => {
    const used = Number(p.package_sessions_used || 0);
    const total = Number(p.package_sessions_total || 0);
    const remaining = Math.max(0, total - used);
    const pct = total > 0 ? Math.round(remaining / total * 100) : 0;
    const expiry = p.package_valid_until ? ` Â· expires ${new Date(p.package_valid_until).toLocaleDateString()}` : '';
    const custName = p.customer_name || p.email || 'Unknown';
    return `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div><span style="font-weight:500;color:#e8e9eb;">${escapeHtml(custName)}</span> <span style="color:rgba(255,255,255,.4);font-size:.8rem;">${escapeHtml(p.title || '')}</span></div>
        <span style="font-size:.8rem;font-weight:600;color:${remaining===0?'#ef4444':remaining<=2?'#fbbf24':'#34d399'};">${remaining} / ${total} remaining</span>
      </div>
      <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;">
        <div style="height:100%;width:${pct}%;background:${remaining===0?'#ef4444':remaining<=2?'#fbbf24':'#34d399'};border-radius:2px;transition:width .3s;"></div>
      </div>
      <div style="font-size:.72rem;color:rgba(255,255,255,.3);margin-top:3px;">${expiry}</div>
    </div>`;
  }).join('');
}

// â”€â”€ Project phases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadPhasesIntoEl(orderId, bodyEl) {
  try {
    const tok = await getAccessToken();
    const res = await fetch(`/.netlify/functions/manage-project-phases?order_id=${encodeURIComponent(orderId)}`, {
      headers: { 'Authorization': `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    const phases = d.phases || [];
    if (!phases.length) {
      bodyEl.innerHTML = '<div class="muted" style="font-size:.82rem;">No phases yet. Click "+ Phase" to add milestones.</div>';
      return;
    }
    const totalPhased = phases.reduce((s, p) => s + Number(p.amount_cents || 0), 0);
    bodyEl.innerHTML = `
      <div style="margin-bottom:8px;font-size:.78rem;color:rgba(255,255,255,.4);">Total phased: ${formatUsd(totalPhased)}</div>
      ${phases.sort((a,b) => a.phase_number - b.phase_number).map(p => {
        const statusColor = p.status === 'completed' ? '#34d399' : p.status === 'invoiced' ? '#60a5fa' : p.status === 'in_progress' ? '#fbbf24' : 'rgba(255,255,255,.3)';
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);">
          <div style="background:${statusColor};color:#12141c;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;flex-shrink:0;">${p.phase_number}</div>
          <div style="flex:1;">
            <div style="font-weight:500;color:#e8e9eb;">${escapeHtml(p.title)}</div>
            ${p.description ? `<div style="font-size:.75rem;color:rgba(255,255,255,.4);">${escapeHtml(p.description)}</div>` : ''}
            <div style="font-size:.75rem;color:rgba(255,255,255,.35);">${formatUsd(p.amount_cents)}${p.due_date ? ' Â· due ' + new Date(p.due_date).toLocaleDateString() : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
            <span style="font-size:.7rem;font-weight:600;color:${statusColor};text-transform:uppercase;">${p.status}</span>
            ${p.status !== 'completed' && p.status !== 'invoiced' ? `<button class="btn btn-ghost" style="font-size:.7rem;padding:2px 6px;" onclick="markPhaseComplete('${escapeAttr(p.id)}','${escapeAttr(orderId)}')">Mark done</button>` : ''}
          </div>
        </div>`;
      }).join('')}`;
  } catch (err) {
    bodyEl.innerHTML = `<div class="muted" style="font-size:.82rem;">Error loading phases: ${escapeHtml(err.message)}</div>`;
  }
}

async function markPhaseComplete(phaseId, orderId) {
  const tok = await getAccessToken();
  await fetch('/.netlify/functions/manage-project-phases', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
    body: JSON.stringify({ id: phaseId, status: 'completed', completed_at: new Date().toISOString() }),
  });
  showToast('Phase marked complete.');
  const body = document.getElementById('phasesBody');
  if (body && body.style.display !== 'none') await loadPhasesIntoEl(orderId, body);
}

function openAddPhaseModal(orderId) {
  const existing = document.getElementById('addPhaseModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'addPhaseModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px 28px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 16px;font-size:1rem;color:#e8e9eb;">Add project phase</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
        <input id="phTitle" class="input" placeholder="Phase name *" style="width:100%;" />
        <textarea id="phDesc" class="input" rows="2" placeholder="Description (optional)" style="width:100%;resize:vertical;"></textarea>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Phase #</label>
            <input id="phNum" type="number" min="1" value="1" class="input" style="width:100%;" /></div>
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Billing amount ($)</label>
            <input id="phAmount" type="number" min="0" step="0.01" placeholder="0.00" class="input" style="width:100%;" /></div>
          <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Due date</label>
            <input id="phDue" type="date" class="input" style="width:100%;" /></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('addPhaseModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="phSave" class="btn btn-primary">Add phase</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('phSave').onclick = async () => {
    const title = ($('phTitle')?.value || '').trim();
    if (!title) { notifyOperator("Add a phase name first."); return; }
    const btn = $('phSave'); btn.disabled = true; btn.textContent = 'Savingâ€¦';
    try {
      const tok = await getAccessToken();
      const res = await fetch('/.netlify/functions/manage-project-phases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({
          order_id    : orderId,
          title,
          description : ($('phDesc')?.value || '').trim() || undefined,
          phase_number: parseInt($('phNum')?.value || 1),
          amount_cents: Math.round(parseFloat($('phAmount')?.value || 0) * 100),
          due_date    : $('phDue')?.value || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('Phase added.');
      modal.remove();
      const body = document.getElementById('phasesBody');
      if (body) await loadPhasesIntoEl(orderId, body);
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.disabled = false; btn.textContent = 'Add phase';
    }
  };
}

// â”€â”€ Time entry logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function renderTimeEntries(orderId) {
  const body = document.getElementById("timeLoggedBody");
  if (!body || body.style.display === "none") return;
  body.innerHTML = `<div class="muted" style="font-size:.82rem;">Loadingâ€¦</div>`;
  const entries = await fetchTimeEntries(orderId);
  if (!entries.length) {
    body.innerHTML = `<div class="muted" style="font-size:.82rem;">No time entries for this order.</div>`;
    return;
  }
  const totalMins     = entries.reduce((s, e) => s + Number(e.duration_minutes || 0), 0);
  const totalBillable = entries.reduce((s, e) => s + Number(e.amount_cents || 0), 0);
  body.innerHTML = `
    <table style="width:100%;font-size:.8rem;border-collapse:collapse;">
      <thead><tr style="color:rgba(255,255,255,.35);">
        <th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Date</th>
        <th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Description</th>
        <th style="text-align:right;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Duration</th>
        <th style="text-align:right;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Billable?</th>
        <th style="text-align:right;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Cost</th>
      </tr></thead>
      <tbody>${entries.map((e) => {
        const mins = Number(e.duration_minutes || 0);
        const hrs  = Math.floor(mins / 60);
        const rem  = mins % 60;
        const dur  = hrs ? `${hrs}h ${rem}m` : `${rem}m`;
        const date = e.started_at ? new Date(e.started_at).toLocaleDateString() : (e.date || "");
        return `<tr>
          <td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${escapeHtml(date)}</td>
          <td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${escapeHtml(e.description || "")}</td>
          <td style="text-align:right;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${dur}</td>
          <td style="text-align:right;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${e.billable ? "Yes" : "No"}</td>
          <td style="text-align:right;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${e.billable && e.amount_cents ? formatUsd(e.amount_cents) : "â€”"}</td>
        </tr>`;
      }).join("")}
      </tbody>
      <tfoot><tr style="font-weight:600;">
        <td colspan="2" style="padding:6px 6px 2px;">Total</td>
        <td style="text-align:right;padding:6px 6px 2px;">${(totalMins / 60).toFixed(2)} hrs</td>
        <td></td>
        <td style="text-align:right;padding:6px 6px 2px;">${totalBillable ? formatUsd(totalBillable) : "â€”"}</td>
      </tr></tfoot>
    </table>
    <button id="btnTimeToInvoice" class="btn btn-ghost" style="margin-top:8px;font-size:.78rem;">âš¡ Add uninvoiced hours to invoice</button>`;
}

function openLogTimeModal(orderId) {
  const existing = document.getElementById("logTimeModal");
  if (existing) { existing.remove(); return; }

  // Default started_at to current local time in datetime-local format
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const defaultStarted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const modal = document.createElement("div");
  modal.id = "logTimeModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:480px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Log time entry</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="ltDesc" class="input" placeholder="Description *" style="width:100%;" />
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Started at</label>
            <input id="ltStartedAt" type="datetime-local" class="input" value="${defaultStarted}" style="width:100%;" />
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Duration (minutes)</label>
            <input id="ltDurationMins" type="number" min="1" step="1" placeholder="e.g. 60" class="input" style="width:100%;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">â€” or â€” Ended at</label>
            <input id="ltEndedAt" type="datetime-local" class="input" style="width:100%;" />
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Hourly rate ($)</label>
            <input id="ltHourlyRate" type="number" min="0" step="0.01" placeholder="75.00" class="input" style="width:100%;" />
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding-top:18px;">
            <input id="ltBillable" type="checkbox" checked style="width:16px;height:16px;cursor:pointer;" />
            <label for="ltBillable" style="font-size:.85rem;color:#e8e9eb;cursor:pointer;">Billable</label>
          </div>
        </div>
      </div>
      <div id="ltMsg" style="font-size:.8rem;color:#f87171;min-height:18px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('logTimeModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="ltSave" class="btn btn-primary">Save entry</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("ltSave").onclick = async () => {
    const desc        = (document.getElementById("ltDesc")?.value || "").trim();
    const startedAt   = document.getElementById("ltStartedAt")?.value || "";
    const durationRaw = document.getElementById("ltDurationMins")?.value;
    const endedAt     = document.getElementById("ltEndedAt")?.value || "";
    const billable    = document.getElementById("ltBillable")?.checked ?? true;
    const rateRaw     = document.getElementById("ltHourlyRate")?.value;
    const msgEl       = document.getElementById("ltMsg");

    if (!desc)       { msgEl.textContent = "Description is required."; return; }
    if (!startedAt)  { msgEl.textContent = "Started at is required."; return; }
    if (!durationRaw && !endedAt) { msgEl.textContent = "Provide duration or ended at."; return; }

    const btn = document.getElementById("ltSave");
    btn.disabled = true;
    btn.textContent = "Savingâ€¦";

    try {
      const tok = await getAccessToken();
      const payload = {
        order_id   : orderId,
        description: desc,
        started_at : new Date(startedAt).toISOString(),
        billable,
      };
      if (durationRaw) {
        payload.duration_minutes = parseInt(durationRaw, 10);
      } else {
        payload.ended_at = new Date(endedAt).toISOString();
      }
      if (rateRaw) {
        payload.hourly_rate_cents = Math.round(parseFloat(rateRaw) * 100);
      }

      const res = await fetch("/.netlify/functions/log-time-entry", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save entry");
      }
      showToast("Time entry logged.");
      modal.remove();

      // Expand the time log section if it isn't already, then refresh
      const body = document.getElementById("timeLoggedBody");
      const span = document.getElementById("timeLoggedToggle")?.querySelector("span");
      if (body) {
        body.style.display = "block";
        if (span) span.textContent = "Time logged â–¾";
        await renderTimeEntries(orderId);
      }
    } catch (err) {
      if (msgEl) msgEl.textContent = "Error: " + err.message;
      btn.disabled = false;
      btn.textContent = "Save entry";
    }
  };
}

// â”€â”€ Session idle timeout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(function initIdleTimer() {
  const WARN_MS   = 25 * 60 * 1000; // warn after 25 min idle
  const LOGOUT_MS = 30 * 60 * 1000; // logout after 30 min idle
  let warnTimer, logoutTimer, banner;

  function showIdleBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.id = 'idleBanner';
    banner.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e2029;border:1px solid rgba(200,75,47,.5);border-radius:8px;padding:14px 20px;color:#e8e9eb;font-size:.85rem;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 24px rgba(0,0,0,.4);';
    banner.innerHTML = '<span>You\'ll be signed out in 5 minutes due to inactivity.</span><button onclick="document.getElementById(\'idleBanner\').remove();window._idleReset&&window._idleReset();" style="background:#c84b2f;color:#fff;border:none;border-radius:4px;padding:6px 14px;font-size:.8rem;cursor:pointer;font-weight:600;">Stay signed in</button>';
    document.body.appendChild(banner);
  }

  function reset() {
    clearTimeout(warnTimer);
    clearTimeout(logoutTimer);
    if (banner) { banner.remove(); banner = null; }
    warnTimer   = setTimeout(showIdleBanner, WARN_MS);
    logoutTimer = setTimeout(async () => {
      const { error } = await sb.auth.signOut();
      if (!error) window.location.reload();
    }, LOGOUT_MS);
  }

  window._idleReset = reset;
  ['mousemove','keydown','click','touchstart'].forEach((ev) =>
    document.addEventListener(ev, reset, { passive: true })
  );
  reset();
})();

// â”€â”€ Vendor handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
$("btnRefreshVendors")?.addEventListener("click", async () => {
  await fetchVendors();
  renderVendors();
});

$("btnAddVendor")?.addEventListener("click", () => {
  const existing = document.getElementById("addVendorModal");
  if (existing) { existing.remove(); return; }
  const modal = document.createElement("div");
  modal.id = "addVendorModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:440px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Add vendor / subcontractor</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="vName"    class="input" placeholder="Name *" style="width:100%;" />
        <input id="vCompany" class="input" placeholder="Company" style="width:100%;" />
        <div style="display:flex;gap:8px;">
          <input id="vEmail" class="input" placeholder="Email" style="flex:1;" />
          <input id="vPhone" class="input" placeholder="Phone" style="flex:1;" />
        </div>
        <input id="vTrade" class="input" placeholder="Trade / specialty (e.g. Electrical, Plumbing)" style="width:100%;" />
        <textarea id="vNotes" class="input" rows="2" placeholder="Notes" style="width:100%;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="avCancel" class="btn btn-ghost">Cancel</button>
        <button id="avSave" class="btn btn-primary">Save vendor</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("avCancel").onclick = () => modal.remove();
  document.getElementById("avSave").onclick = async () => {
    const name = (document.getElementById("vName").value || "").trim();
    if (!name) { notifyOperator("Add a name first."); return; }
    const btn = document.getElementById("avSave");
    btn.disabled = true; btn.textContent = "Savingâ€¦";
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/manage-vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body: JSON.stringify({
          name,
          company: document.getElementById("vCompany").value.trim() || undefined,
          email  : document.getElementById("vEmail").value.trim() || undefined,
          phone  : document.getElementById("vPhone").value.trim() || undefined,
          trade  : document.getElementById("vTrade").value.trim() || undefined,
          notes  : document.getElementById("vNotes").value.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      showToast("Vendor saved.");
      modal.remove();
      await fetchVendors();
      renderVendors();
    } catch (err) {
      showToast("Error: " + err.message);
      btn.disabled = false; btn.textContent = "Save vendor";
    }
  };
});


