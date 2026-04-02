"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeButton() {
  return {
    addEventListener: vi.fn(),
  };
}

function loadSetupWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-setup-workspace.js"),
    "utf8"
  );

  const context = {
    console,
    window: {
      location: { origin: "https://app.prooflink.test" },
      PROOFLINK_OPERATOR_ACCOUNTING: {
        normalizeAccountingSystem: (value) => {
          const raw = String(value || "").trim().toLowerCase();
          return ["quickbooks", "other"].includes(raw) ? raw : "prooflink";
        },
        defaultAccountingReferenceLabel: (system) => String(system || "").trim().toLowerCase() === "quickbooks"
          ? "QuickBooks invoice #"
          : "Accounting invoice #",
      },
    },
    URL,
    document: {
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
    },
    setupPublishMeta: { textContent: "" },
    btnRefreshSetup: makeButton(),
    btnSaveSetup: makeButton(),
    btnSaveSetupTop: makeButton(),
    btnPreviewWebsite: makeButton(),
    btnOpenSetupHomePreview: makeButton(),
    btnOpenSetupProductsPreview: makeButton(),
    btnOpenSetupOrderPreview: makeButton(),
    btnOpenSetupAboutPreview: makeButton(),
    btnOpenSetupContactPreview: makeButton(),
    btnOpenSetupHowPreview: makeButton(),
    btnOpenSetupPublishedSite: makeButton(),
    btnPublishWebsite: makeButton(),
    btnPublishWebsiteTop: makeButton(),
    btnMarkSetupComplete: makeButton(),
    btnUploadSetupLogo: makeButton(),
    btnUploadSetupHero: makeButton(),
    setupPreviewWrap: { innerHTML: "" },
    setupLogoFile: null,
    setupLogoStatus: null,
    setupLogoUrl: null,
    setupHeroFile: null,
    setupHeroStatus: null,
    setupHeroImageUrl: null,
    setupTagline: null,
    setupHeroHeading: null,
    setupHeroSubheading: null,
    setupAbout: null,
    setupPublicContactEmail: null,
    setupPublicBusinessPhone: null,
    setupServiceArea: null,
    setupAccountingSystem: null,
    setupAccountingReferenceLabel: null,
    setupReviewPlatformLabel: null,
    setupReviewLinkUrl: null,
    setupReferralMessage: null,
    setupInstagram: null,
    setupFacebook: null,
    setupHoursNotes: null,
    setupFulfillmentNotes: null,
    setupAccentColor: null,
    setupPrimaryCtaLabel: null,
    setupBookingCtaLabel: null,
    setupShowPrices: null,
    setupAllowCustomRequests: null,
    setupWorkspaceBusinessType: null,
    setupSiteFontPreset: null,
    setupSiteSurfaceStyle: null,
    setupSiteButtonStyle: null,
    setupSiteCardStyle: null,
    setupSiteHeroLayout: null,
    SETUP_STATE: { tenant: { slug: "logan-lawn", custom_domain: "" }, config: {}, locked_record: null },
    OPERATOR_CONFIG: { tenantBusinessName: "ProofLink Demo" },
    cleanUrl: (value) => String(value || "").trim(),
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    formatDateTime: vi.fn(() => "Mar 26, 2026"),
    setSetupMessage: vi.fn(),
    safeFilename: (value) => String(value || ""),
    TENANT_ID: "tenant_123",
    sb: {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
          getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://cdn.example/logo.png" } })),
        })),
      },
    },
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    },
    $: vi.fn(() => null),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator setup workspace", () => {
  test("setupPublishedUrl prefers a custom domain and falls back to the tenant slug", () => {
    const customDomainContext = loadSetupWorkspace({
      SETUP_STATE: {
        tenant: { slug: "logan-lawn", custom_domain: "https://loganlawn.com/" },
        config: { custom_domain: "https://loganlawn.com/" },
        locked_record: null,
      },
    });
    const slugContext = loadSetupWorkspace();

    expect(customDomainContext.window.setupPublishedUrl("site-home.html")).toBe("https://loganlawn.com/");
    expect(slugContext.window.setupPublishedUrl("about.html")).toBe("https://logan-lawn.prooflink.co/about.html");
  });

  test("renderSetupPublishMeta shows the right publish-state copy", () => {
    const context = loadSetupWorkspace();

    context.window.renderSetupPublishMeta({ site_publish_status: "draft" });
    expect(context.setupPublishMeta.textContent).toContain("draft mode");

    context.window.renderSetupPublishMeta({
      site_publish_status: "published",
      site_published_at: "2026-03-26T10:00:00.000Z",
    });
    expect(context.setupPublishMeta.textContent).toContain("Website is published");
    expect(context.setupPublishMeta.textContent).toContain("Mar 26, 2026");
  });

  test("initSetupWorkspaceBindings only wires listeners once", () => {
    const context = loadSetupWorkspace();

    context.window.initSetupWorkspaceBindings();
    context.window.initSetupWorkspaceBindings();

    expect(context.btnPreviewWebsite.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnSaveSetup.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnPublishWebsite.addEventListener).toHaveBeenCalledTimes(1);
  });

  test("collectSetupPayload keeps external accounting preferences in the saved setup", () => {
    const context = loadSetupWorkspace({
      setupAccountingSystem: { value: "quickbooks" },
      setupAccountingReferenceLabel: { value: "" },
      setupTagline: { value: "Clean sites, clear proof." },
    });

    const payload = context.window.collectSetupPayload();

    expect(payload.accounting_system).toBe("quickbooks");
    expect(payload.accounting_reference_label).toBe("QuickBooks invoice #");
    expect(payload.tagline).toBe("Clean sites, clear proof.");
  });
});
