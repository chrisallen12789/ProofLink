// Setup workspace extracted from operator.js so website preview, branding,
// publish state, and onboarding controls stay together in one domain module.
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
  if (setupAccentColor) setupAccentColor.value = payload.accent_color || window.PROOFLINK_BRAND?.accent || "#c84b2f";
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

let SETUP_WORKSPACE_BOUND = false;

function initSetupWorkspaceBindings() {
  if (SETUP_WORKSPACE_BOUND) return;
  SETUP_WORKSPACE_BOUND = true;

  btnRefreshSetup?.addEventListener("click", async () => {
    try {
      setSetupMessage("Refreshing setup...");
      await fetchOperatorSetup();
      setSetupMessage("Setup reloaded.", "good");
    } catch (err) {
      setSetupMessage(err.message || String(err), "bad");
    }
  });

  btnSaveSetup?.addEventListener("click", async () => {
    try {
      await saveOperatorSetup();
    } catch (err) {
      setSetupMessage(err.message || String(err), "bad");
    }
  });

  btnSaveSetupTop?.addEventListener("click", async () => {
    try {
      await saveOperatorSetup();
    } catch (err) {
      setSetupMessage(err.message || String(err), "bad");
    }
  });

  btnPreviewWebsite?.addEventListener("click", () => {
    if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null);
    renderSetupPublishMeta(collectSetupPayload());
    renderSetupPreviewActions();
    setSetupMessage("Preview refreshed with the current draft.", "good");
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
      setSetupMessage("Website published. Customers should now see the live version of this draft.", "good");
    } catch (err) {
      setSetupMessage(err.message || String(err), "bad");
    }
  });

  btnPublishWebsiteTop?.addEventListener("click", async () => {
    try {
      await publishWebsite();
      setSetupMessage("Website published. Customers should now see the live version of this draft.", "good");
    } catch (err) {
      setSetupMessage(err.message || String(err), "bad");
    }
  });

  btnMarkSetupComplete?.addEventListener("click", async () => {
    try {
      await saveOperatorSetup({ onboarding_complete: true });
      setSetupMessage("Setup marked complete.", "good");
    } catch (err) {
      setSetupMessage(err.message || String(err), "bad");
    }
  });

  btnUploadSetupLogo?.addEventListener("click", async () => {
    const file = setupLogoFile?.files?.[0];
    if (!file) {
      if (setupLogoStatus) setupLogoStatus.textContent = "Choose a logo file first.";
      return;
    }
    try {
      if (setupLogoStatus) setupLogoStatus.textContent = "Uploading...";
      if (setupLogoUrl) setupLogoUrl.value = await uploadSetupAsset(file, "logo");
      if (setupLogoStatus) setupLogoStatus.textContent = "Uploaded. Save setup to keep it.";
      fillSetupForm(collectSetupPayload(), SETUP_STATE?.locked_record || null);
    } catch (err) {
      if (setupLogoStatus) setupLogoStatus.textContent = err.message || String(err);
    }
  });

  btnUploadSetupHero?.addEventListener("click", async () => {
    const file = setupHeroFile?.files?.[0];
    if (!file) {
      if (setupHeroStatus) setupHeroStatus.textContent = "Choose a hero image first.";
      return;
    }
    try {
      if (setupHeroStatus) setupHeroStatus.textContent = "Uploading...";
      if (setupHeroImageUrl) setupHeroImageUrl.value = await uploadSetupAsset(file, "hero");
      if (setupHeroStatus) setupHeroStatus.textContent = "Uploaded. Save setup to keep it.";
      fillSetupForm(collectSetupPayload(), SETUP_STATE?.locked_record || null);
    } catch (err) {
      if (setupHeroStatus) setupHeroStatus.textContent = err.message || String(err);
    }
  });

  [
    setupTagline,
    setupHeroHeading,
    setupHeroSubheading,
    setupAbout,
    setupLogoUrl,
    setupHeroImageUrl,
    setupPublicContactEmail,
    setupPublicBusinessPhone,
    setupServiceArea,
    setupReviewPlatformLabel,
    setupReviewLinkUrl,
    setupReferralMessage,
    setupInstagram,
    setupFacebook,
    setupHoursNotes,
    setupFulfillmentNotes,
    setupAccentColor,
    setupPrimaryCtaLabel,
    setupBookingCtaLabel,
  ].forEach((el) => {
    el?.addEventListener("input", () => {
      if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null);
      renderSetupPublishMeta(collectSetupPayload());
      renderSetupPreviewActions();
    });
  });

  [
    setupShowPrices,
    setupAllowCustomRequests,
    setupWorkspaceBusinessType,
    setupSiteFontPreset,
    setupSiteSurfaceStyle,
    setupSiteButtonStyle,
    setupSiteCardStyle,
    setupSiteHeroLayout,
  ].forEach((el) => {
    el?.addEventListener("change", () => {
      if (setupPreviewWrap) setupPreviewWrap.innerHTML = setupPreviewHtml(collectSetupPayload(), SETUP_STATE?.locked_record || null);
      renderSetupPublishMeta(collectSetupPayload());
      renderSetupPreviewActions();
    });
  });

  initSetupBuilderNav();
  renderSetupPreviewActions();
}

const SETUP_WORKSPACE_HELPERS = {
  setupPublishStatus,
  renderSetupPublishMeta,
  setupTenantSlug,
  setupPreviewUrl,
  setupPublishedUrl,
  initSetupBuilderNav,
  setupPreviewHtml,
  fillSetupForm,
  collectSetupPayload,
  applyWebsiteMode,
  renderLockedBusinessRecord,
  fetchOperatorSetup,
  saveOperatorSetup,
  publishWebsite,
  uploadSetupAsset,
  initSetupWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_SETUP_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_SETUP_WORKSPACE || {}),
  ...SETUP_WORKSPACE_HELPERS,
};

Object.assign(window, SETUP_WORKSPACE_HELPERS);
