(function () {
  function $(id) { return document.getElementById(id); }

  const BILLING_LABELS = {
    active: "Active",
    past_due: "Past Due",
    canceled: "Canceled",
    trialing: "Trial",
    incomplete: "Incomplete",
    onboarding: "Not yet active",
  };
  const CONNECT_LABELS = {
    connect_connected: "Connected",
    connect_not_started: "Not connected",
    connect_pending: "Pending",
    connect_restricted: "Restricted",
  };

  const state = {
    startContext: null,
    paymentState: null,
    websiteState: null,
    tenantSlug: "",
    tenantId: "",
    planKey: "",
    currentStep: 1,
    firstOfferDone: false,
  };

  function billingLabel(status) {
    return BILLING_LABELS[status] || titleCase(status || "Unknown");
  }

  function connectLabel(status) {
    return CONNECT_LABELS[status] || titleCase(status || "Unknown");
  }

  function titleCase(value) {
    const raw = String(value || "").replace(/[_-]+/g, " ").trim();
    return raw ? raw.replace(/\b\w/g, (m) => m.toUpperCase()) : "Unknown";
  }

  function readStartContext() {
    try {
      return JSON.parse(localStorage.getItem("prooflink_start_context") || "null");
    } catch {
      return null;
    }
  }

  function getTenantFromUrl() {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("tenant") || "").trim();
  }

  function getPlanFromUrl() {
    const Public = window.PROOFLINK_PUBLIC;
    if (Public && typeof Public.readQueryPlanIntent === "function") {
      return Public.readQueryPlanIntent(window.location.search || "")?.planKey || "";
    }
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("plan") || "").trim().toLowerCase();
  }

  function isSelfServeStart() {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("selfServe") || "").trim() === "1";
  }

  async function getAccessToken() {
    const runtime = window.PROOFLINK_OPERATOR_RUNTIME || {};
    if (typeof runtime.getAccessToken === "function") {
      return runtime.getAccessToken();
    }
    return "";
  }

  async function apiPost(path, payload) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  function setMsg(step, text, tone) {
    const el = $(`msg-step-${step}`);
    if (!el) return;
    el.textContent = text || "";
    el.className = `msg${tone ? ` ${tone}` : ""}`;
  }

  function getPlanKey() {
    return state.planKey || state.startContext?.planKey || "starter";
  }

  function tenantSlug() {
    return state.tenantSlug || state.startContext?.tenantSlug || "";
  }

  function isPreviewRoutingHost() {
    const host = String(window.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "prooflink.co" || host === "www.prooflink.co";
  }

  function publicUrlFor(page = "site-home.html", published = false) {
    const slug = tenantSlug();
    if (!slug) return "/";
    const normalizedPage = String(page || "site-home.html").trim().replace(/^\//, "");
    if (published && !isPreviewRoutingHost()) {
      return normalizedPage === "site-home.html"
        ? `https://${slug}.prooflink.co/`
        : `https://${slug}.prooflink.co/${normalizedPage}`;
    }
    const url = new URL(`/${normalizedPage}`, window.location.origin);
    url.searchParams.set("tenant", slug);
    return url.toString();
  }

  function getPublishedWebsiteUrl() {
    return publicUrlFor("site-home.html", true);
  }

  function websiteBasicsReady() {
    return !!state.websiteState?.basicsReady;
  }

  function websitePublished() {
    return state.websiteState?.publishStatus === "published";
  }

  function moneyFlowsReady() {
    return state.paymentState?.billingStatus === "active" && state.paymentState?.connectStatus === "connect_connected";
  }

  function renderStaticBusinessContext() {
    const ctx = state.startContext || {};
    const slug = tenantSlug() || "unknown";
    const businessName = ctx.businessName || slug;
    const ownerName = ctx.ownerName || "Unknown";
    const email = ctx.email || "Unknown";
    const planKey = getPlanKey();
    const selfServe = isSelfServeStart();

    $("pageTitle").textContent = `Launch ${businessName}`;
    $("pageSub").textContent = selfServe
      ? `Brand the website, preview the public pages, publish, and turn on money flows for ${businessName}.`
      : `Move ${businessName} from setup into a clean live launch.`;
    const eyebrow = $("onboardingEyebrow");
    if (eyebrow) eyebrow.textContent = selfServe ? "Self-serve launch" : "Workspace launch";

    $("businessKv").innerHTML = `
      <div class="k">Business</div><div>${businessName}</div>
      <div class="k">Owner</div><div>${ownerName}</div>
      <div class="k">Email</div><div>${email}</div>
      <div class="k">Public URL</div><div>${slug}.prooflink.co</div>
      <div class="k">Plan</div><div>${titleCase(planKey)}</div>
    `;

    const websiteUrl = getPublishedWebsiteUrl();
    $("subdomainText").textContent = websiteUrl;
    $("websiteUrlText").textContent = websiteUrl;
    $("openStorefrontBtn").href = websiteUrl;
  }

  function renderPills() {
    const ps = state.paymentState || {};
    const ws = state.websiteState || {};
    const plan = titleCase(ps.prooflinkPlanKey || getPlanKey());
    const billing = billingLabel(ps.billingStatus || "onboarding");
    const connect = connectLabel(ps.connectStatus || "connect_not_started");
    const eligible = ps.onlinePaymentsEligible ? "Eligible" : "Blocked";
    const website = titleCase(ws.publishStatus || "draft");

    $("summaryPills").innerHTML = `
      <div class="pill">Plan: ${plan}</div>
      <div class="pill ${websitePublished() ? "good" : "warn"}">Website: ${website}</div>
      <div class="pill ${ps.billingStatus === "active" ? "good" : "warn"}">Billing: ${billing}</div>
      <div class="pill ${ps.connectStatus === "connect_connected" ? "good" : "warn"}">Payouts: ${connect}</div>
    `;

    $("livePills").innerHTML = `
      <div class="pill ${websiteBasicsReady() ? "good" : "warn"}">${websiteBasicsReady() ? "Website basics set" : "Website still needs shaping"}</div>
      <div class="pill ${websitePublished() ? "good" : "warn"}">${websitePublished() ? "Website published" : "Website still draft"}</div>
      <div class="pill ${moneyFlowsReady() ? "good" : "warn"}">${moneyFlowsReady() ? "Money flows ready" : "Money flows still blocked"}</div>
      <div class="pill ${state.firstOfferDone ? "good" : "warn"}">${state.firstOfferDone ? "First service added" : "First service still needed"}</div>
    `;

    $("websiteStatusText").textContent = websiteBasicsReady() ? "Ready for preview" : "Still needs core website details";
    $("publishStatusText").textContent = website;
    $("billingStatusText").textContent = billing;
    $("connectStatusText").textContent = connect;
    $("eligibilityText").textContent = ps.onlinePaymentsEligible ? "Eligible" : (ps.onlinePaymentsReason || "Blocked");
  }

  function computeStep() {
    if (!websiteBasicsReady()) return 2;
    if (!websitePublished()) return 3;
    if (!moneyFlowsReady()) return 4;
    return 5;
  }

  function renderStepNav() {
    const current = state.currentStep;
    const doneMap = {
      1: true,
      2: websiteBasicsReady(),
      3: websitePublished(),
      4: moneyFlowsReady(),
      5: state.firstOfferDone,
    };

    [1, 2, 3, 4, 5].forEach((n) => {
      const nav = $(`nav-step-${n}`);
      if (!nav) return;
      nav.classList.remove("active", "done");
      if (doneMap[n]) nav.classList.add("done");
      if (n === current) nav.classList.add("active");
    });

    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    $(`step-${current}`)?.classList.add("active");
  }

  async function refreshPaymentState() {
    const payload = { tenantId: tenantSlug() || state.tenantId };
    const data = await apiPost("/.netlify/functions/tenant-payment-status", payload);
    state.paymentState = data.paymentState || null;
    state.tenantSlug = data.tenantSlug || state.tenantSlug;
    state.tenantId = data.tenantId || state.tenantId;
    renderStaticBusinessContext();
  }

  async function refreshWebsiteState() {
    const slug = tenantSlug();
    if (!slug) {
      state.websiteState = {
        publishStatus: "draft",
        basicsReady: false,
      };
      return;
    }
    const res = await fetch(`/.netlify/functions/get-public-tenant-info?tenant=${encodeURIComponent(slug)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.tenant) {
      throw new Error(data.error || "Could not load website state.");
    }

    const storefront = data.tenant.storefront || {};
    const contact = data.tenant.contact || {};
    const website = data.tenant.website || {};
    const basicsReady = Boolean(
      String(storefront.heroHeading || "").trim() &&
      (String(contact.email || "").trim() || String(contact.phone || "").trim()) &&
      String(storefront.primaryCtaLabel || "").trim()
    );

    state.websiteState = {
      publishStatus: String(website.publishStatus || "draft").trim().toLowerCase() || "draft",
      basicsReady,
      homePreviewUrl: publicUrlFor("site-home.html"),
      servicesPreviewUrl: publicUrlFor("products.html"),
      requestPreviewUrl: publicUrlFor("order.html"),
      publishedWebsiteUrl: getPublishedWebsiteUrl(),
    };
  }

  async function refreshState() {
    await Promise.all([
      refreshPaymentState(),
      refreshWebsiteState(),
    ]);
    renderPills();
    state.currentStep = computeStep();
    renderStepNav();
  }

  async function startBilling() {
    if (getPlanKey() === "enterprise") {
      throw new Error("Enterprise billing is finalized through a guided rollout after setup.");
    }

    const params = new URLSearchParams();
    if (tenantSlug()) params.set("tenant", tenantSlug());
    if (getPlanKey()) params.set("plan", getPlanKey());
    const query = params.toString();
    const returnBase = `${window.location.origin}/operator/onboarding.html${query ? `?${query}` : ""}`;
    const joiner = query ? "&" : "?";

    setMsg(4, "Creating Stripe subscription checkout...", "");
    const data = await apiPost("/.netlify/functions/stripe-platform-checkout", {
      tenantId: tenantSlug() || state.tenantId,
      planKey: getPlanKey(),
      successUrl: `${returnBase}${joiner}billing=success#payments`,
      cancelUrl: `${returnBase}${joiner}billing=cancel#payments`,
    });
    setMsg(4, "Redirecting to Stripe...", "");
    if (data.url) window.location.href = data.url;
  }

  async function startConnect() {
    const params = new URLSearchParams();
    if (tenantSlug()) params.set("tenant", tenantSlug());
    if (getPlanKey()) params.set("plan", getPlanKey());
    const query = params.toString();
    const returnBase = `${window.location.origin}/operator/onboarding.html${query ? `?${query}` : ""}`;
    const joiner = query ? "&" : "?";

    setMsg(4, "Creating Stripe Connect onboarding link...", "");
    const data = await apiPost("/.netlify/functions/stripe-connect-link", {
      tenantId: tenantSlug() || state.tenantId,
      refreshUrl: `${returnBase}${joiner}connect=refresh#payments`,
      returnUrl: `${returnBase}${joiner}connect=return#payments`,
    });
    setMsg(4, "Redirecting to Stripe Connect...", "");
    if (data.url) window.location.href = data.url;
  }

  function consumeRedirectFlags() {
    const params = new URLSearchParams(window.location.search || "");
    const billing = String(params.get("billing") || "").toLowerCase();
    const connect = String(params.get("connect") || "").toLowerCase();

    if (billing === "success") {
      setMsg(4, "Billing checkout returned successfully. Refresh once if webhook truth has not landed yet.", "good");
    } else if (billing === "cancel") {
      setMsg(4, "Billing checkout was canceled before completion.", "bad");
    }

    if (connect === "return") {
      setMsg(4, "Stripe Connect returned successfully. Refresh once if account truth has not landed yet.", "good");
    } else if (connect === "refresh") {
      setMsg(4, "Stripe asked for a refreshed onboarding link. Start Connect Stripe again.", "bad");
    }

    params.delete("billing");
    params.delete("connect");
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (window.history?.replaceState) window.history.replaceState(null, "", next);
  }

  function openWebsite(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  function bind() {
    $("startBillingBtn")?.addEventListener("click", () => startBilling().catch((e) => setMsg(4, e.message || String(e), "bad")));
    $("connectStripeBtn")?.addEventListener("click", () => startConnect().catch((e) => setMsg(4, e.message || String(e), "bad")));

    $("refreshStateBtn1")?.addEventListener("click", () => refreshState().catch((e) => setMsg(1, e.message || String(e), "bad")));
    $("refreshStateBtn2")?.addEventListener("click", () => refreshState().catch((e) => setMsg(2, e.message || String(e), "bad")));
    $("refreshStateBtn3")?.addEventListener("click", () => refreshState().catch((e) => setMsg(3, e.message || String(e), "bad")));
    $("refreshStateBtn4")?.addEventListener("click", () => refreshState().catch((e) => setMsg(4, e.message || String(e), "bad")));

    $("openHomePreviewBtn")?.addEventListener("click", () => openWebsite(state.websiteState?.homePreviewUrl));
    $("openServicesPreviewBtn")?.addEventListener("click", () => openWebsite(state.websiteState?.servicesPreviewUrl));
    $("openRequestPreviewBtn")?.addEventListener("click", () => openWebsite(state.websiteState?.requestPreviewUrl));

    $("markProductsDoneBtn")?.addEventListener("click", () => {
      state.firstOfferDone = true;
      localStorage.setItem(`prooflink_first_offer_done:${tenantSlug()}`, "1");
      state.currentStep = computeStep();
      renderPills();
      renderStepNav();
      setMsg(5, "Marked as done. Open the website and run one test request before handing it off.", "good");
    });
  }

  async function boot() {
    state.startContext = readStartContext();
    state.tenantSlug = getTenantFromUrl() || state.startContext?.tenantSlug || "";
    state.tenantId = state.startContext?.tenantId || "";
    state.planKey = getPlanFromUrl() || state.startContext?.planKey || "starter";
    state.firstOfferDone = localStorage.getItem(`prooflink_first_offer_done:${tenantSlug()}`) === "1";

    if (state.startContext) {
      state.startContext.planKey = state.planKey;
      localStorage.setItem("prooflink_start_context", JSON.stringify(state.startContext));
    }

    renderStaticBusinessContext();
    bind();
    consumeRedirectFlags();

    try {
      await refreshState();
    } catch (error) {
      setMsg(1, error.message || String(error), "bad");
      state.currentStep = 1;
      renderStepNav();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch(console.error); }, { once: true });
  } else {
    boot().catch(console.error);
  }
})();
