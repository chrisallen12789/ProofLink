(function () {
  const Public = window.PROOFLINK_PUBLIC;
  const Architecture = window.PROOFLINK_WORKSPACE_ARCHITECTURE;

  if (!Public) {
    console.error("ProofLink public plan config is missing.");
    return;
  }

  const VALID_COUPON = "BUILDWITHME";

  const state = {
    step: 1,
    planIntent: Public.resolvePlanIntent({ defaultPlan: "growth" }),
    businessType: "",
    businessName: "",
    cityState: "",
    requestedSubdomain: "",
    ownerName: "",
    ownerEmail: "",
    phone: "",
    couponCode: "",
    setupMode: "self_serve",
  };

  const fallbackTypeLabels = {
    bakery: "Bakery / Food",
    cleaning: "Cleaning",
    contractor: "Contractor / Remodeling",
    events: "Events",
    handyman: "Handyman",
    hvac: "HVAC",
    landscaping: "Landscaping",
    other: "Other",
    pet_services: "Pet Services",
    photography: "Photography",
    plumbing: "Plumbing",
    pressure_washing: "Pressure Washing",
    property_maintenance: "Property Maintenance",
    service_business: "Service Business",
  };
  const typeLabels = { ...fallbackTypeLabels };

  if (Architecture?.getBusinessProfile) {
    Object.keys(typeLabels).forEach((key) => {
      const profile = Architecture.getBusinessProfile(key);
      if (profile?.label) typeLabels[key] = profile.label;
    });
  }

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeBusinessType(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    const normalized = Architecture?.sanitizeBusinessType ? Architecture.sanitizeBusinessType(raw) : raw;
    return normalized === "lawn_care" ? "landscaping" : normalized;
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function showNotify(text, tone) {
    const el = $("notify");
    if (!el) return;
    el.textContent = text || "";
    el.className = `notify ${tone || "info"} visible`;
  }

  function hideNotify() {
    const el = $("notify");
    if (!el) return;
    el.className = "notify";
    el.textContent = "";
  }

  function showError(id, message) {
    const el = $(id);
    if (!el) return;
    if (message) el.textContent = message;
    el.classList.add("visible");
  }

  function hideError(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("visible");
  }

  function setFieldError(fieldId, errId, isVisible, message) {
    const field = $(fieldId);
    if (field) field.classList.toggle("error", Boolean(isVisible));
    if (isVisible) showError(errId, message);
    else hideError(errId);
  }

  function selectedPlan() {
    return Public.getPlan(state.planIntent.planKey);
  }

  function isSelfServePlan(planKey) {
    return String(planKey || state.planIntent.planKey).trim().toLowerCase() !== "enterprise";
  }

  function resolvedSetupMode() {
    return isSelfServePlan() && state.setupMode === "guided" ? "guided" : isSelfServePlan() ? "self_serve" : "guided";
  }

  function setupModeLabel() {
    return resolvedSetupMode() === "guided" ? "Guided setup with help" : "Start it myself now";
  }

  function planSubmissionNote(plan) {
    if (plan.key === "enterprise") {
      return "Enterprise starts with a guided rollout. We help shape the account, controls, and website before it goes live.";
    }
    if (resolvedSetupMode() === "guided") {
      return `${plan.name} can start instantly, but you asked for help. We will hold the setup in guided mode so the account and website can be shaped with you first.`;
    }
    return `${plan.name} can create your account now. You will go straight into setup, branding, and website configuration so you can launch without waiting on a manual review step.`;
  }

  function syncQueryString() {
    const params = new URLSearchParams(window.location.search || "");
    params.set("plan", state.planIntent.planKey);
    params.set("intent", state.planIntent.intent);
    params.set("source", state.planIntent.source || "join");
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
  }

  function renderPlanChoices() {
    const container = $("planChoiceGrid");
    if (!container) return;

    container.innerHTML = Public.PLAN_ORDER.map((planKey) => {
      const plan = Public.getPlan(planKey);
      const classes = ["plan-choice"];
      if (plan.recommended) classes.push("recommended");
      if (plan.key === state.planIntent.planKey) classes.push("selected");
      return `
        <button
          class="${classes.join(" ")}"
          type="button"
          data-plan-choice="${plan.key}"
          role="radio"
          aria-checked="${plan.key === state.planIntent.planKey ? "true" : "false"}"
        >
          ${plan.recommended ? '<span class="plan-choice-badge">Recommended</span>' : ""}
          <h3>${plan.name}</h3>
          <div class="plan-price">
            <strong>${plan.priceDisplay}</strong>
            <span>${plan.priceSuffix || "&nbsp;"}</span>
          </div>
          <p>${plan.bestFor}</p>
          <ul>
            ${plan.highlights.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </button>
      `;
    }).join("");

    container.querySelectorAll("[data-plan-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const planKey = button.getAttribute("data-plan-choice");
        state.planIntent = Public.persistPlanIntent(planKey, {
          intent: Public.getPlan(planKey).intent,
          source: "join-plan-picker",
        });
        if (!isSelfServePlan(planKey)) state.setupMode = "guided";
        renderPlanChoices();
        renderPlanContext();
        renderSetupModeCards();
        syncQueryString();
      });
    });
  }

  function renderSetupModeCards() {
    const note = $("setupModeNote");
    const cards = Array.from(document.querySelectorAll(".setup-mode-card[data-setup-mode]"));
    const forcedGuided = !isSelfServePlan();

    cards.forEach((card) => {
      const mode = card.getAttribute("data-setup-mode");
      const selected = resolvedSetupMode() === mode;
      const disabled = forcedGuided && mode === "self_serve";
      card.classList.toggle("selected", selected);
      card.classList.toggle("disabled", disabled);
      card.setAttribute("aria-pressed", selected ? "true" : "false");
      card.setAttribute("aria-disabled", disabled ? "true" : "false");
      card.tabIndex = disabled ? -1 : 0;
    });

    if (note) {
      if (forcedGuided) {
        note.textContent = "Enterprise always moves through guided setup so the account, controls, and website can be finalized with you before launch.";
      } else if (resolvedSetupMode() === "guided") {
        note.textContent = "Guided setup keeps the request in a human-assisted path. Use this if you want help shaping the account or website before it goes live.";
      } else {
        note.textContent = "Self-serve creates the account now and takes you straight into branding, website setup, and publish controls.";
      }
    }
  }

  function renderPlanContext() {
    const plan = selectedPlan();
    const setupMode = resolvedSetupMode();
    const title = plan.priceSuffix ? `${plan.name} ${plan.priceDisplay}${plan.priceSuffix}` : `${plan.name} ${plan.priceDisplay}`;
    const submitBtn = $("submit-btn");

    $("selectedPlanTitle").textContent = title;
    $("selectedPlanSummary").textContent = plan.bestFor;
    $("planIntentNote").textContent = planSubmissionNote(plan);
    $("reviewPlanNote").textContent = planSubmissionNote(plan);

    if (submitBtn) {
      submitBtn.textContent = plan.key === "enterprise"
        ? "Request guided rollout"
        : setupMode === "guided"
          ? `Request guided ${plan.name} setup`
          : `Start ${plan.name} account`;
    }
  }

  function updateProgress(step) {
    for (let i = 1; i <= 4; i += 1) {
      const el = $(`step-ind-${i}`);
      if (!el) continue;
      el.className = "progress-step";
      if (i < step) el.classList.add("complete");
      if (i === step) el.classList.add("active");
    }
  }

  function showSection(step) {
    document.querySelectorAll(".form-section").forEach((section) => {
      section.classList.remove("visible");
    });
    $(`section-${step}`)?.classList.add("visible");
    state.step = step;
    updateProgress(step);
    const formCard = document.querySelector(".form-card");
    if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function validateStep1() {
    state.businessType = normalizeBusinessType(state.businessType || $("business_type")?.value || "");
    if ($("business_type")) $("business_type").value = state.businessType;
    if (!state.businessType) {
      showError("err-type");
      return false;
    }
    hideError("err-type");
    return true;
  }

  function validateStep2() {
    const name = $("business_name")?.value.trim() || "";
    if (!name) {
      setFieldError("business_name", "err-business_name", true);
      return false;
    }

    setFieldError("business_name", "err-business_name", false);
    state.businessName = name;
    state.cityState = $("city_state")?.value.trim() || "";
    state.requestedSubdomain = $("requested_subdomain")?.value.trim() || "";
    return true;
  }

  function validateStep3() {
    const ownerName = $("owner_name")?.value.trim() || "";
    const ownerEmail = ($("owner_email")?.value || "").trim().toLowerCase();
    const phone = $("phone")?.value.trim() || "";
    let valid = true;

    if (!ownerName) {
      setFieldError("owner_name", "err-owner_name", true);
      valid = false;
    } else {
      setFieldError("owner_name", "err-owner_name", false);
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!ownerEmail || !emailRe.test(ownerEmail)) {
      setFieldError("owner_email", "err-owner_email", true);
      valid = false;
    } else {
      setFieldError("owner_email", "err-owner_email", false);
    }

    if (resolvedSetupMode() === "self_serve" && !phone) {
      setFieldError("phone", "err-phone", true, "A phone number is required so we can unblock setup if needed.");
      valid = false;
    } else {
      setFieldError("phone", "err-phone", false);
    }

    if (!valid) return false;

    state.ownerName = ownerName;
    state.ownerEmail = ownerEmail;
    state.phone = phone;
    state.couponCode = ($("coupon_code")?.value || "").trim().toUpperCase() === VALID_COUPON
      && state.planIntent.planKey === "growth"
      ? VALID_COUPON
      : "";

    return true;
  }

  function populateReview() {
    state.businessType = normalizeBusinessType(state.businessType || $("business_type")?.value || "");
    const plan = selectedPlan();
    const title = plan.priceSuffix ? `${plan.name} ${plan.priceDisplay}${plan.priceSuffix}` : `${plan.name} ${plan.priceDisplay}`;
    $("rev-plan").textContent = title;
    $("rev-setup_mode").textContent = setupModeLabel();
    $("rev-business_type").textContent = typeLabels[state.businessType] || "-";
    $("rev-business_name").textContent = state.businessName || "-";
    $("rev-city_state").textContent = state.cityState || "-";
    $("rev-subdomain").textContent = state.requestedSubdomain || "(auto-generated)";
    $("rev-owner_name").textContent = state.ownerName || "-";
    $("rev-owner_email").textContent = state.ownerEmail || "-";
    $("rev-phone").textContent = state.phone || "-";

    const couponRow = $("rev-coupon-row");
    if (state.couponCode) {
      $("rev-coupon").textContent = "1 year free applied";
      if (couponRow) couponRow.style.display = "";
    } else if (couponRow) {
      couponRow.style.display = "none";
    }
  }

  function buildPayload() {
    state.businessType = normalizeBusinessType(state.businessType || $("business_type")?.value || "");
    return {
      business_name: state.businessName,
      owner_name: state.ownerName,
      owner_email: state.ownerEmail,
      phone: state.phone || undefined,
      business_type: state.businessType || undefined,
      city_state: state.cityState || undefined,
      requested_subdomain: state.requestedSubdomain || undefined,
      seed_template_key: state.businessType || "default",
      selected_plan: state.planIntent.planKey,
      coupon_code: state.couponCode || undefined,
      requested_help: resolvedSetupMode() === "guided",
      intake_mode: resolvedSetupMode(),
    };
  }

  function persistStartContext(data) {
    const context = {
      tenantId: data.tenant_id || data.tenantId || "",
      tenantSlug: data.tenant_slug || data.tenantSlug || state.requestedSubdomain || slugify(state.businessName),
      operatorId: data.operator_id || data.operatorId || "",
      businessName: state.businessName,
      ownerName: state.ownerName,
      email: state.ownerEmail,
      phone: state.phone,
      planKey: state.planIntent.planKey,
      businessCategory: state.businessType,
      setupMode: resolvedSetupMode(),
    };
    try {
      localStorage.setItem("prooflink_start_context", JSON.stringify(context));
    } catch (error) {
      console.warn("Unable to persist ProofLink start context:", error);
    }
  }

  async function submitForm() {
    hideNotify();
    const submitBtn = $("submit-btn");
    if (submitBtn) submitBtn.disabled = true;

    const payload = buildPayload();
    const selfServe = resolvedSetupMode() === "self_serve" && isSelfServePlan();
    const endpoint = selfServe
      ? "/.netlify/functions/start-self-serve-workspace"
      : "/.netlify/functions/submit-onboarding-request";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      Public.persistPlanIntent(state.planIntent.planKey, {
        intent: state.planIntent.intent,
        source: selfServe ? "join-self-serve" : "join-guided",
      });

      if (selfServe) {
        persistStartContext(data);
        showNotify("Account ready. Opening your setup page...", "success");
        window.location.href = data.login_url || data.onboarding_url || "/operator/onboarding.html";
        return;
      }

      $("progressBar").style.display = "none";
      document.querySelectorAll(".form-section").forEach((section) => {
        section.classList.remove("visible");
      });

      const plan = selectedPlan();
      $("success-screen").style.display = "block";
      $("successTitle").textContent = plan.key === "enterprise"
        ? "Guided rollout requested"
        : "Guided setup requested";
      $("successLead").textContent = plan.key === "enterprise"
        ? "We saved your business details and started your Enterprise rollout."
        : "We saved your business details and started your guided setup path.";
      $("success-email").textContent = state.ownerEmail;
      $("successPlanText").textContent = plan.key === "enterprise"
        ? "Your Enterprise request is in motion for a guided rollout before the account goes live."
        : "We will follow up with the next step and help shape the account, workflow, and website with you.";
      if (data.request_id) $("success-ref").textContent = `Reference ID: ${data.request_id}`;
    } catch (error) {
      showNotify(`Something went wrong: ${error.message}`, "error");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    if (submitBtn) submitBtn.disabled = false;
  }

  function bindSlugChecker() {
    const input = $("requested_subdomain");
    const status = $("slug-status");
    const preview = $("slug-preview-text");
    if (!input || !status || !preview) return;

    let timer = null;
    let lastChecked = "";
    let controller = null;

    async function checkSlug(slug) {
      if (controller) controller.abort();
      controller = new AbortController();

      try {
        const res = await fetch(`/.netlify/functions/check-slug?slug=${encodeURIComponent(slug)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        lastChecked = slug;

        if (data.available) {
          status.innerHTML = '<span style="color:var(--success);font-weight:700;">Available</span>';
        } else {
          const reason = data.reason === "reserved"
            ? "This name is reserved."
            : data.reason === "taken"
              ? "Already taken. Try another."
              : data.reason === "pending"
                ? "Already requested by another business."
                : "Not available.";
          status.innerHTML = `<span style="color:var(--danger);font-weight:700;">${reason}</span>`;
        }
      } catch (error) {
        if (error.name !== "AbortError") status.innerHTML = "";
      }
    }

    input.addEventListener("input", () => {
      const slug = slugify(input.value);
      preview.textContent = slug ? `prooflink.co/${slug}` : "prooflink.co/your-handle";

      if (!slug) {
        status.innerHTML = "";
        return;
      }
      if (slug === lastChecked) return;

      clearTimeout(timer);
      status.innerHTML = '<span style="color:var(--muted);">Checking availability...</span>';
      timer = window.setTimeout(() => checkSlug(slug), 450);
    });

    $("business_name")?.addEventListener("input", () => {
      if ((input.value || "").trim()) return;
      const generated = slugify($("business_name")?.value || "");
      preview.textContent = generated ? `prooflink.co/${generated}` : "prooflink.co/your-handle";
    });
  }

  function bindBusinessTypes() {
    document.querySelectorAll(".type-chip[data-value]").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".type-chip[data-value]").forEach((item) => item.classList.remove("selected"));
        chip.classList.add("selected");
        state.businessType = normalizeBusinessType(chip.getAttribute("data-value") || "");
        $("business_type").value = state.businessType;
        hideError("err-type");
      });
    });
  }

  function bindSetupModes() {
    document.querySelectorAll(".setup-mode-card[data-setup-mode]").forEach((card) => {
      card.addEventListener("click", () => {
        const mode = card.getAttribute("data-setup-mode") || "self_serve";
        if (!isSelfServePlan() && mode === "self_serve") return;
        state.setupMode = mode;
        renderSetupModeCards();
        renderPlanContext();
      });
    });
  }

  function bindNavigation() {
    $("nextFromStep1")?.addEventListener("click", () => {
      if (validateStep1()) showSection(2);
    });

    $("backFromStep2")?.addEventListener("click", () => showSection(1));
    $("nextFromStep2")?.addEventListener("click", () => {
      if (validateStep2()) showSection(3);
    });

    $("backFromStep3")?.addEventListener("click", () => showSection(2));
    $("nextFromStep3")?.addEventListener("click", () => {
      if (validateStep3()) {
        populateReview();
        showSection(4);
      }
    });

    $("backFromStep4")?.addEventListener("click", () => showSection(3));
    $("submit-btn")?.addEventListener("click", submitForm);
  }

  function bindCouponField() {
    const input = $("coupon_code");
    const hint = $("coupon-hint");
    if (!input || !hint) return;

    input.addEventListener("input", () => {
      const val = input.value.trim().toUpperCase();
      const plan = state.planIntent.planKey;
      if (!val) {
        hint.textContent = "";
        hint.style.color = "";
      } else if (val === VALID_COUPON && plan === "growth") {
        hint.textContent = "Promo code applied. Your first year is free.";
        hint.style.color = "var(--success, #22c55e)";
      } else if (val === VALID_COUPON && plan !== "growth") {
        hint.textContent = "This promo applies to the Growth plan only.";
        hint.style.color = "var(--danger, #ef4444)";
      } else {
        hint.textContent = "Invalid promo code.";
        hint.style.color = "var(--danger, #ef4444)";
      }
    });
  }

  function boot() {
    renderPlanChoices();
    renderSetupModeCards();
    renderPlanContext();
    syncQueryString();
    bindBusinessTypes();
    bindSetupModes();
    bindSlugChecker();
    bindNavigation();
    bindCouponField();
    updateProgress(1);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
