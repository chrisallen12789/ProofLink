(function () {
  const Tools = window.ProofLinkImportTools || {};
  if (!Tools.parseCsv || !Tools.getValue || typeof sb === "undefined") return;

  const $ = (id) => document.getElementById(id);
  const importFile = $("importFile");
  const importFileLabel = $("importFileLabel");
  const btnAnalyzeImport = $("btnAnalyzeImport");
  const btnRunImport = $("btnRunImport");
  const btnClearImport = $("btnClearImport");
  const btnDownloadImportTemplate = $("btnDownloadImportTemplate");
  const importKindSummary = $("importKindSummary");
  const importSummaryCards = $("importSummaryCards");
  const importPreviewWrap = $("importPreviewWrap");
  const importMsg = $("importMsg");
  const importAiMsg = $("importAiMsg");
  const importAiReviewWrap = $("importAiReviewWrap");
  const importProfileWrap = $("importProfileWrap");
  const importKindButtons = Array.from(document.querySelectorAll("[data-import-kind]"));
  const importTemplateButtons = Array.from(document.querySelectorAll("[data-template-kind]"));
  const btnRunImportAiReview = $("btnRunImportAiReview");
  const btnSaveImportProfile = $("btnSaveImportProfile");

  if (!importFile || !importPreviewWrap) return;

  let IMPORT_STATE = {
    kind: "customers",
    fileName: "",
    headers: [],
    rows: [],
    preview: null,
    importing: false,
    profilesLoaded: false,
    profiles: [],
    profileKey: "",
    aiReview: null,
  };

  function kind() {
    return Tools.normalizeImportKind(IMPORT_STATE.kind);
  }

  function kindMeta(value = kind()) {
    return Tools.IMPORT_KIND_META?.[Tools.normalizeImportKind(value)] || Tools.IMPORT_KIND_META.customers;
  }

  function profileList() {
    return Array.isArray(IMPORT_STATE.profiles) ? IMPORT_STATE.profiles : [];
  }

  function activeImportProfile() {
    const profileKey = compact(IMPORT_STATE.profileKey);
    if (!profileKey) return null;
    return profileList().find((profile) => compact(profile?.key) === profileKey) || null;
  }

  function profilesForKind(importKind = kind()) {
    return profileList().filter((profile) => Tools.normalizeImportKind(profile?.import_kind || profile?.importKind) === Tools.normalizeImportKind(importKind));
  }

  async function ensureImportProfilesLoaded(options = {}) {
    if (IMPORT_STATE.profilesLoaded && !options.force) return profileList();
    if (typeof requestOperatorFunction !== "function") return profileList();
    try {
      const payload = await requestOperatorFunction("manage-import-profiles");
      IMPORT_STATE.profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
      IMPORT_STATE.profilesLoaded = true;
      return IMPORT_STATE.profiles;
    } catch (err) {
      if (!options.silent) setImportAiMessage(err.message || String(err), "error");
      return profileList();
    }
  }

  function setImportMessage(message = "", tone = "") {
    if (typeof setInlineMessage === "function") {
      setInlineMessage(importMsg, message, tone);
      return;
    }
    if (!importMsg) return;
    importMsg.className = `msg${tone ? ` ${tone}` : ""}`;
    importMsg.textContent = message;
  }

  function setImportAiMessage(message = "", tone = "") {
    if (typeof setInlineMessage === "function") {
      setInlineMessage(importAiMsg, message, tone);
      return;
    }
    if (!importAiMsg) return;
    importAiMsg.className = `msg${tone ? ` ${tone}` : ""}`;
    importAiMsg.textContent = message;
  }

  function compact(value) {
    return String(value || "").trim();
  }

  function email(value) {
    return Tools.normalizeEmail(value);
  }

  function phoneDigits(value) {
    return Tools.normalizePhoneDigits(value);
  }

  function normalizePreferredContact(value, fallbackEmail, fallbackPhone) {
    const raw = compact(value).toLowerCase();
    if (["email", "phone", "text"].includes(raw)) return raw;
    if (["sms", "mobile"].includes(raw)) return "text";
    if (fallbackEmail) return "email";
    if (fallbackPhone) return "phone";
    return "email";
  }

  function importField(row, importKind, fieldKey) {
    const aliases = typeof Tools.resolveFieldAliases === "function"
      ? Tools.resolveFieldAliases(importKind, fieldKey, activeImportProfile() ? [activeImportProfile()] : [])
      : (Tools.FIELD_ALIASES?.[Tools.normalizeImportKind(importKind)]?.[fieldKey] || []);
    return Tools.getValue(row, aliases);
  }

  function mergeNotes(existing, incoming, prefix = "") {
    const current = compact(existing);
    const next = compact(incoming);
    if (!next) return current || null;
    if (!current) return next;
    if (current.includes(next)) return current;
    return `${current}\n\n${prefix ? `${prefix}: ` : ""}${next}`;
  }

  function mergeTags(existing, incoming) {
    return Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]));
  }

  function cacheReplaceById(rows, nextRow) {
    const list = Array.isArray(rows) ? [...rows] : [];
    const index = list.findIndex((row) => row?.id === nextRow?.id);
    if (index >= 0) list[index] = { ...list[index], ...nextRow };
    else list.unshift(nextRow);
    return list;
  }

  function updateCustomersCache(nextRow) {
    CUSTOMERS_CACHE = cacheReplaceById(CUSTOMERS_CACHE, nextRow);
  }

  function updateOrdersCache(nextRow) {
    CRM_ORDERS_CACHE = cacheReplaceById(CRM_ORDERS_CACHE, nextRow);
  }

  function updatePaymentsCache(nextRow) {
    PAYMENTS_CACHE = cacheReplaceById(PAYMENTS_CACHE, nextRow);
  }

  function updateLeadsCache(nextRow) {
    LEADS_CACHE = cacheReplaceById(LEADS_CACHE, nextRow);
  }

  function updateJobsCache(nextRow) {
    JOBS_CACHE = cacheReplaceById(JOBS_CACHE, nextRow);
  }

  function customerMatch(row) {
    const targetEmail = email(row?.email);
    const targetPhone = phoneDigits(row?.phone);
    const targetName = compact(row?.name).toLowerCase();
    return CUSTOMERS_CACHE.find((customer) =>
      (targetEmail && email(customer?.email) === targetEmail)
      || (targetPhone && phoneDigits(customer?.phone) === targetPhone)
      || (!targetEmail && !targetPhone && targetName && compact(customer?.name).toLowerCase() === targetName)
    ) || null;
  }

  function importRef(prefix, values) {
    return `${prefix}-${Tools.hashString(values.map((value) => compact(value).toLowerCase()).join("|"))}`;
  }

  function workRef(row) {
    const externalId = compact(row.externalId || row.orderExternalId);
    return externalId
      ? importRef("csv-work", [externalId])
      : importRef("csv-work", [row.customerEmail, row.customerPhone, row.title, row.scheduledDate, row.totalCents, row.stageRaw]);
  }

  function leadRef(row) {
    const externalId = compact(row.externalId);
    return externalId
      ? importRef("csv-lead", [externalId])
      : importRef("csv-lead", [row.customerEmail, row.customerPhone, row.title, row.summary, row.stageRaw]);
  }

  function paymentRef(row) {
    const externalId = compact(row.externalId);
    return externalId
      ? importRef("csv-payment", [externalId])
      : importRef("csv-payment", [row.customerEmail, row.customerPhone, row.orderExternalId, row.amountCents, row.paidAt, row.reference]);
  }

  function existingLeadByRef(ref) {
    return LEADS_CACHE.find((row) => String(row?.source_type || "").toLowerCase() === "csv_import" && String(row?.source_ref || "") === ref) || null;
  }

  function existingOrderByRef(ref) {
    return CRM_ORDERS_CACHE.find((row) => String(row?.source_type || "").toLowerCase() === "csv_import" && String(row?.source_ref || "") === ref) || null;
  }

  function existingPaymentByRef(ref) {
    return PAYMENTS_CACHE.find((row) => String(row?.metadata?.import_ref || "") === ref) || null;
  }

  function importedRollupPaymentsForOrder(orderId) {
    return PAYMENTS_CACHE.filter((row) => row?.order_id === orderId && row?.metadata?.import_rollup === true);
  }

  function inferPaymentState(totalCents, amountPaidCents, dueDate, explicit) {
    const normalized = typeof normalizeWorkflowPaymentState === "function"
      ? normalizeWorkflowPaymentState(explicit)
      : compact(explicit).toLowerCase();
    if (normalized && normalized !== "unpaid") return normalized;
    const paid = Math.max(0, Number(amountPaidCents || 0));
    const due = Math.max(Math.max(0, Number(totalCents || 0)) - paid, 0);
    if (due <= 0 && paid > 0) return "paid";
    if (paid > 0 && due > 0) return "partially_paid";
    const dueTime = dueDate ? new Date(dueDate).getTime() : 0;
    if (due > 0 && dueTime && dueTime < Date.now()) return "overdue";
    return "unpaid";
  }

  function normalizeWorkStage(value, row) {
    const raw = compact(value || row.status).toLowerCase().replace(/[\s-]+/g, "_");
    const totalCents = Number(row.totalCents || 0);
    if (["lead", "new", "contacted", "qualified"].includes(raw)) return { recordType: "lead", leadStatus: raw === "lead" ? "new" : raw };
    if (["quote", "quoted", "proposal", "bid", "ready_to_send", "sent", "approved"].includes(raw)) {
      return { recordType: "bid", leadStatus: "quoted", bidStatus: ["quote", "quoted", "proposal", "bid"].includes(raw) ? "ready_to_send" : raw };
    }
    if (["booked", "scheduled", "confirmed"].includes(raw)) return { recordType: "order", orderStatus: "confirmed", jobStatus: "scheduled", createJob: true };
    if (["dispatched"].includes(raw)) return { recordType: "order", orderStatus: "confirmed", jobStatus: "dispatched", createJob: true };
    if (["in_progress", "active"].includes(raw)) return { recordType: "order", orderStatus: "confirmed", jobStatus: "in_progress", createJob: true };
    if (["fulfilled", "completed"].includes(raw)) return { recordType: "order", orderStatus: "completed", jobStatus: "completed", createJob: true };
    if (["paid"].includes(raw)) return { recordType: "order", orderStatus: "paid", jobStatus: "completed", createJob: true, paymentState: "paid" };
    if (["overdue"].includes(raw)) return { recordType: "order", orderStatus: "completed", jobStatus: "completed", createJob: true, paymentState: "overdue" };
    if (["cancelled", "canceled"].includes(raw)) return totalCents > 0 ? { recordType: "order", orderStatus: "cancelled", jobStatus: "cancelled" } : { recordType: "lead", leadStatus: "lost" };
    return totalCents > 0 ? { recordType: "bid", leadStatus: "quoted", bidStatus: "ready_to_send" } : { recordType: "lead", leadStatus: "new" };
  }

  function normalizePaymentStatus(value) {
    const raw = compact(value).toLowerCase().replace(/[\s-]+/g, "_");
    if (["paid", "succeeded", "complete", "completed"].includes(raw)) return "paid";
    if (["pending", "open", "due"].includes(raw)) return "pending";
    if (["refunded", "refund"].includes(raw)) return "refunded";
    if (["cancelled", "canceled", "void"].includes(raw)) return "cancelled";
    return "paid";
  }

  function normalizePaymentMethod(value) {
    const raw = compact(value).toLowerCase().replace(/[\s-]+/g, "_");
    if (["cash", "check", "ach", "zelle", "venmo", "external_card", "manual_other"].includes(raw)) return raw;
    if (["card", "card_on_site", "onsite_card"].includes(raw)) return "external_card";
    if (["wire", "bank_transfer"].includes(raw)) return "ach";
    return "manual_other";
  }

  function normalizeIsoDate(value) {
    const raw = compact(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  function normalizeIsoDateTime(value) {
    return typeof toIsoDateTime === "function" ? toIsoDateTime(value) : null;
  }

  function baseOrderItems(row) {
    const total = Math.max(0, Number(row.totalCents || 0));
    const description = compact(row.summary || row.note);
    return [{
      name: compact(row.title) || compact(row.requestedServiceType) || "Imported work",
      description,
      quantity: 1,
      unit: "job",
      kind: "base",
      unitPriceCents: total,
      totalCents: total,
    }];
  }

  function baseBidLineItems(row) {
    const total = Math.max(0, Number(row.totalCents || 0));
    return [{
      name: compact(row.title) || compact(row.requestedServiceType) || "Imported quote",
      description: compact(row.summary || row.note),
      quantity: 1,
      unit: "job",
      kind: "base",
      unit_price_cents: total,
      total_cents: total,
      optional: false,
      included: true,
    }];
  }

  function previewCustomers() {
    return IMPORT_STATE.rows.map((raw, index) => {
      const name = compact(importField(raw, "customers", "name"));
      const contactEmail = email(importField(raw, "customers", "email"));
      const contactPhone = compact(importField(raw, "customers", "phone"));
      const existing = customerMatch({ name, email: contactEmail, phone: contactPhone });
      const tags = Tools.parseTagList(importField(raw, "customers", "tags"));
      const mergedTags = mergeTags(existing?.tags, tags);
      const mergedNotes = mergeNotes(existing?.notes, importField(raw, "customers", "notes"), "Imported note");
      const serviceAddress = compact(importField(raw, "customers", "service_address"));
      const billingAddress = compact(importField(raw, "customers", "billing_address"));
      const preferredContact = normalizePreferredContact(importField(raw, "customers", "preferred_contact"), contactEmail, contactPhone);

      if (!name && !contactEmail && !contactPhone) {
        return { rowNumber: index + 2, ready: false, action: "Needs review", tone: "error", primary: `Row ${index + 2}`, secondary: "Missing customer identity", detail: "Add a name, email, or phone so ProofLink has a real customer to create or match." };
      }

      const changed = !existing || !!(
        (name && compact(existing?.name) !== name)
        || (contactEmail && email(existing?.email) !== contactEmail)
        || (contactPhone && compact(existing?.phone) !== contactPhone)
        || (serviceAddress && compact(existing?.service_address) !== serviceAddress)
        || (billingAddress && compact(existing?.billing_address) !== billingAddress)
        || (preferredContact && compact(existing?.preferred_contact) !== preferredContact)
        || JSON.stringify(Array.isArray(existing?.tags) ? existing.tags : []) !== JSON.stringify(mergedTags)
        || compact(existing?.notes) !== compact(mergedNotes)
      );

      return {
        rowNumber: index + 2,
        raw,
        ready: true,
        externalId: compact(importField(raw, "customers", "external_id")),
        name,
        email: contactEmail,
        phone: contactPhone,
        preferredContact,
        serviceAddress,
        billingAddress,
        tags,
        mergedTags,
        mergedNotes,
        existing,
        action: existing ? (changed ? "Update" : "Match") : "Create",
        tone: existing ? (changed ? "warn" : "") : "ok",
        primary: name || existing?.name || "Imported customer",
        secondary: [contactEmail || "No email", contactPhone || "No phone"].join(" | "),
        detail: existing ? (changed ? "ProofLink will enrich the live customer record." : "ProofLink already has this customer and will not duplicate it.") : "ProofLink will create a new customer record.",
      };
    });
  }

  function previewWork() {
    return IMPORT_STATE.rows.map((raw, index) => {
      const customerName = compact(importField(raw, "open_work", "customer_name"));
      const customerEmail = email(importField(raw, "open_work", "customer_email"));
      const customerPhone = compact(importField(raw, "open_work", "customer_phone"));
      const title = compact(importField(raw, "open_work", "title")) || compact(importField(raw, "open_work", "requested_service_type")) || "Imported work";
      const summary = compact(importField(raw, "open_work", "summary"));
      const totalCents = Math.max(0, Tools.toCents(importField(raw, "open_work", "total_amount")));
      const amountPaidCents = Math.max(0, Tools.toCents(importField(raw, "open_work", "amount_paid")));
      const depositRequiredCents = Math.max(0, Tools.toCents(importField(raw, "open_work", "deposit_required")));
      const paymentDueDate = compact(importField(raw, "open_work", "payment_due_date"));
      const stageRaw = compact(importField(raw, "open_work", "stage"));
      const stage = normalizeWorkStage(stageRaw, { totalCents });
      const paymentState = inferPaymentState(totalCents, amountPaidCents, paymentDueDate, stage.paymentState);
      const sourceRef = stage.recordType === "order"
        ? workRef({ externalId: importField(raw, "open_work", "external_id"), customerEmail, customerPhone, title, scheduledDate: importField(raw, "open_work", "scheduled_date"), totalCents, stageRaw })
        : leadRef({ externalId: importField(raw, "open_work", "external_id"), customerEmail, customerPhone, title, summary, stageRaw });
      const existing = stage.recordType === "order" ? existingOrderByRef(sourceRef) : existingLeadByRef(sourceRef);

      if (!customerName && !customerEmail && !customerPhone) {
        return { rowNumber: index + 2, ready: false, action: "Needs review", tone: "error", primary: `Row ${index + 2}`, secondary: "Missing customer identity", detail: "Add customer information so the imported work lands on a real account." };
      }

      return {
        rowNumber: index + 2,
        raw,
        ready: true,
        existing,
        sourceRef,
        externalId: compact(importField(raw, "open_work", "external_id")),
        customerExternalId: compact(importField(raw, "open_work", "customer_external_id")),
        customerName,
        customerEmail,
        customerPhone,
        title,
        summary,
        requestedServiceType: compact(importField(raw, "open_work", "requested_service_type")),
        serviceAddress: compact(importField(raw, "open_work", "service_address")),
        scheduledDate: compact(importField(raw, "open_work", "scheduled_date")),
        scheduleWindow: compact(importField(raw, "open_work", "schedule_window")),
        totalCents,
        amountPaidCents,
        amountDueCents: Math.max(totalCents - amountPaidCents, 0),
        depositRequiredCents,
        paymentDueDate,
        note: compact(importField(raw, "open_work", "note")),
        stageRaw,
        recordType: stage.recordType,
        leadStatus: stage.leadStatus || "new",
        bidStatus: stage.bidStatus || "ready_to_send",
        orderStatus: stage.orderStatus || "confirmed",
        jobStatus: stage.jobStatus || "scheduled",
        createJob: stage.createJob === true,
        paymentState,
        action: existing ? "Skip existing" : (stage.recordType === "lead" ? "Create lead" : (stage.recordType === "bid" ? "Create quote" : (stage.createJob ? "Create job flow" : "Create tracked work"))),
        tone: existing ? "" : "ok",
        primary: title,
        secondary: `${customerName || "Customer"} | ${stage.recordType === "bid" ? "Lead + bid" : stage.recordType === "lead" ? "Lead" : "Tracked work"}`,
        detail: existing ? "ProofLink already has this imported record and will skip it safely." : `${formatUsd(totalCents)} total${depositRequiredCents > 0 ? ` | ${formatUsd(depositRequiredCents)} deposit` : ""}${stage.createJob ? " | job included" : ""}`,
      };
    });
  }

  function previewPayments() {
    return IMPORT_STATE.rows.map((raw, index) => {
      const customerName = compact(importField(raw, "payments", "customer_name"));
      const customerEmail = email(importField(raw, "payments", "customer_email"));
      const customerPhone = compact(importField(raw, "payments", "customer_phone"));
      const amountCents = Math.max(0, Tools.toCents(importField(raw, "payments", "amount")));
      const rowData = {
        externalId: compact(importField(raw, "payments", "external_id")),
        customerExternalId: compact(importField(raw, "payments", "customer_external_id")),
        customerName,
        customerEmail,
        customerPhone,
        orderExternalId: compact(importField(raw, "payments", "order_external_id")),
        amountCents,
        status: normalizePaymentStatus(importField(raw, "payments", "status")),
        method: normalizePaymentMethod(importField(raw, "payments", "method")),
        paidAt: compact(importField(raw, "payments", "paid_at")),
        reference: compact(importField(raw, "payments", "reference")),
        note: compact(importField(raw, "payments", "note")),
      };
      const sourceRef = paymentRef(rowData);
      const existing = existingPaymentByRef(sourceRef);

      if ((!customerName && !customerEmail && !customerPhone) && !rowData.orderExternalId) {
        return { rowNumber: index + 2, ready: false, action: "Needs review", tone: "error", primary: `Row ${index + 2}`, secondary: "Missing customer or work link", detail: "Add customer information or the matching work external id so ProofLink knows where the payment belongs." };
      }
      if (!amountCents) {
        return { rowNumber: index + 2, ready: false, action: "Needs review", tone: "error", primary: `Row ${index + 2}`, secondary: customerName || customerEmail || "Payment row", detail: "Add an amount greater than zero before importing payment history." };
      }

      return {
        ...rowData,
        rowNumber: index + 2,
        raw,
        ready: true,
        existing,
        sourceRef,
        action: existing ? "Skip existing" : "Import payment",
        tone: existing ? "" : "ok",
        primary: customerName || customerEmail || customerPhone || "Imported payment",
        secondary: `${formatUsd(amountCents)} | ${rowData.status} | ${rowData.method}`,
        detail: rowData.orderExternalId ? `Will try to link to imported work id ${rowData.orderExternalId}.` : "Will import as customer-linked payment history.",
      };
    });
  }

  function buildPreview() {
    const rows = kind() === "customers" ? previewCustomers() : (kind() === "open_work" ? previewWork() : previewPayments());
    const readyRows = rows.filter((row) => row.ready && !/^skip/i.test(row.action) && !/^match/i.test(row.action));
    return {
      kind: kind(),
      rows,
      readyRows,
      cards: [
        { label: "Preview rows", value: rows.length },
        { label: "Ready to write", value: readyRows.length },
        { label: "Already handled", value: rows.filter((row) => /^skip|^match/i.test(row.action)).length },
        { label: "Needs review", value: rows.filter((row) => row.ready === false).length },
      ],
    };
  }

  function renderPreview() {
    const preview = IMPORT_STATE.preview;
    if (importSummaryCards) importSummaryCards.innerHTML = "";
    if (!preview) {
      importPreviewWrap.innerHTML = `<div class="import-preview-table__empty">Choose an import type and preview a CSV to see what ProofLink will create, update, or skip before anything writes.</div>`;
      if (btnRunImport) btnRunImport.disabled = true;
      return;
    }
    if (importSummaryCards) {
      importSummaryCards.innerHTML = preview.cards.map((card) => `
        <div class="import-summary-card">
          <div class="kicker">${escapeHtml(card.label)}</div>
          <strong>${escapeHtml(String(card.value))}</strong>
          <span>${escapeHtml(kindMeta(preview.kind).label)}</span>
        </div>
      `).join("");
    }
    importPreviewWrap.innerHTML = preview.rows.length ? `
      <div class="import-preview-table">
        ${preview.rows.slice(0, 18).map((row) => `
          <article class="import-preview-table__row">
            <div>
              <div class="kicker">Row ${escapeHtml(String(row.rowNumber || ""))}</div>
              <strong>${escapeHtml(row.primary || "Import row")}</strong>
              <div class="detail-copy">${escapeHtml(row.secondary || "")}</div>
              <div class="detail-copy">${escapeHtml(row.detail || "")}</div>
            </div>
            <div class="import-preview-table__meta">
              <span class="pill ${row.tone === "ok" ? "pill-on" : (row.tone === "warn" ? "pill-warn" : (row.tone === "error" ? "pill-bad" : ""))}">${escapeHtml(row.action || "Review")}</span>
              ${row.recordType ? `<span class="pill">${escapeHtml(row.recordType)}</span>` : ""}
              ${row.paymentState ? `<span class="pill">${escapeHtml(String(row.paymentState).replace(/_/g, " "))}</span>` : ""}
            </div>
            <div class="detail-copy mono">${escapeHtml(row.sourceRef || row.externalId || "")}</div>
          </article>
        `).join("")}
        ${preview.rows.length > 18 ? `<div class="muted">Showing the first 18 rows. ProofLink will still process all ${preview.rows.length} previewed rows.</div>` : ""}
      </div>
    ` : `<div class="import-preview-table__empty">This file did not produce any usable rows yet.</div>`;
    if (btnRunImport) btnRunImport.disabled = IMPORT_STATE.importing || preview.readyRows.length === 0;
  }

  function renderProfileSummary() {
    if (!importProfileWrap) return;
    const activeProfile = activeImportProfile();
    const availableProfiles = profilesForKind();
    const activeLabel = activeProfile?.label || "";
    const savedCount = availableProfiles.length;

    if (!activeProfile) {
      importProfileWrap.innerHTML = `
        <div class="detail-card">
          <div class="kicker">Import profile</div>
          <div><strong>No saved profile matched this file yet.</strong></div>
          <div class="detail-copy">${escapeHtml(savedCount ? `${savedCount} saved profile${savedCount === 1 ? "" : "s"} exist for this import lane, but this file did not line up strongly with one yet.` : "Run the review and save a learned profile when this export shape looks right." )}</div>
        </div>
      `;
      return;
    }

    const confidence = Number(activeProfile?.confidence_score || activeProfile?.confidenceScore || 0);
    const mappedFields = Object.keys(activeProfile?.field_aliases || activeProfile?.fieldAliases || {});
    importProfileWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">Import profile</div>
        <div><strong>${escapeHtml(activeLabel || "Matched import profile")}</strong></div>
        <div class="detail-copy">${escapeHtml(activeProfile?.source_hint || activeProfile?.sourceHint || "ProofLink matched a saved legacy export profile for this file and is applying it during preview.")}</div>
        <div class="workspace-chip-row u-mt-10">
          <span class="pill pill-on">${escapeHtml(kindMeta(activeProfile?.import_kind || activeProfile?.importKind).label)}</span>
          <span class="pill">${escapeHtml(`${mappedFields.length} mapped field${mappedFields.length === 1 ? "" : "s"}`)}</span>
          <span class="pill">${escapeHtml(`confidence ${Math.round(confidence * 100)}%`)}</span>
        </div>
      </div>
    `;
  }

  function renderAiReview() {
    if (!importAiReviewWrap) return;
    const payload = IMPORT_STATE.aiReview;
    const report = payload?.report || null;
    const contextSummary = payload?.context_summary || {};
    const profileSuggestion = contextSummary?.profile_suggestion || null;
    if (btnSaveImportProfile) btnSaveImportProfile.disabled = !profileSuggestion || IMPORT_STATE.importing;

    if (!report) {
      importAiReviewWrap.innerHTML = `
        <div class="detail-card">
          <div class="kicker">AI migration review</div>
          <div><strong>No structured migration review yet.</strong></div>
          <div class="detail-copy">Preview a CSV first, then run the review to see grounded mapping coverage, row-routing risk, and the reusable profile ProofLink can learn from this export.</div>
        </div>
      `;
      return;
    }

    const routeCounts = contextSummary.route_counts || {};
    const routeChips = [
      contextSummary.recommended_kind ? `${kindMeta(contextSummary.recommended_kind).label} lane` : "",
      Number(contextSummary.ready_row_count || 0) ? `${contextSummary.ready_row_count} ready sample row${Number(contextSummary.ready_row_count || 0) === 1 ? "" : "s"}` : "",
      Number(contextSummary.review_row_count || 0) ? `${contextSummary.review_row_count} review row${Number(contextSummary.review_row_count || 0) === 1 ? "" : "s"}` : "No review rows in sample",
      Number(contextSummary.unknown_headers_count || 0) ? `${contextSummary.unknown_headers_count} unmapped header${Number(contextSummary.unknown_headers_count || 0) === 1 ? "" : "s"}` : "",
      Number(routeCounts.leads || 0) ? `${routeCounts.leads} leads` : "",
      Number(routeCounts.bids || 0) ? `${routeCounts.bids} quotes` : "",
      Number(routeCounts.orders || 0) ? `${routeCounts.orders} tracked work` : "",
      Number(routeCounts.jobs || 0) ? `${routeCounts.jobs} jobs` : "",
      Number(routeCounts.payments || 0) ? `${routeCounts.payments} payments` : "",
      Number(routeCounts.customers || 0) ? `${routeCounts.customers} customers` : "",
    ].filter(Boolean).slice(0, 8);

    importAiReviewWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">AI migration review</div>
        <div><strong>${escapeHtml(report.summary || "Import review ready.")}</strong></div>
        <div class="workspace-chip-row u-mt-10">
          ${routeChips.map((chip) => `<span class="pill">${escapeHtml(chip)}</span>`).join("")}
          <span class="pill ${report.summary_status === "blocked" ? "pill-bad" : (report.summary_status === "review_needed" ? "pill-warn" : "pill-on")}">${escapeHtml(String(report.summary_status || "review_needed").replace(/_/g, " "))}</span>
        </div>
      </div>
      ${profileSuggestion ? `
        <div class="detail-card u-mt-10">
          <div class="kicker">Learned profile</div>
          <div><strong>${escapeHtml(profileSuggestion.label || "Suggested import profile")}</strong></div>
          <div class="detail-copy">${escapeHtml(profileSuggestion.source_hint || "ProofLink can save this mapping so the next file from the same system matches automatically.")}</div>
        </div>
      ` : ""}
      ${Array.isArray(report.findings) && report.findings.length ? `
        <div class="memory-checklist u-mt-10">
          ${report.findings.slice(0, 4).map((finding) => `
            <div class="memory-checklist__item ${finding.severity === "critical" || finding.severity === "warning" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
              <div class="workspace-chip-row">
                <span class="pill ${finding.severity === "critical" ? "pill-bad" : (finding.severity === "warning" ? "pill-warn" : "pill-on")}">${escapeHtml(finding.category || "import")}</span>
              </div>
              <div class="memory-checklist__title u-mt-10">${escapeHtml(finding.title || "Finding")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(finding.detail || "")}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${Array.isArray(report.missing_data) && report.missing_data.length ? `
        <div class="detail-card u-mt-10">
          <div class="kicker">Missing data</div>
          ${report.missing_data.slice(0, 3).map((item) => `<div class="detail-copy"><strong>${escapeHtml(item.label || "Missing")}</strong> ${escapeHtml(item.detail || "")}</div>`).join("")}
        </div>
      ` : ""}
      ${Array.isArray(report.recommended_actions) && report.recommended_actions.length ? `
        <div class="detail-card u-mt-10">
          <div class="kicker">Recommended next moves</div>
          ${report.recommended_actions.slice(0, 3).map((action) => `<div class="detail-copy"><strong>${escapeHtml(action.title || "Next move")}</strong> ${escapeHtml(action.detail || "")}</div>`).join("")}
        </div>
      ` : ""}
    `;
  }

  function renderImportWorkspace() {
    const meta = kindMeta();
    const activeProfile = activeImportProfile();
    importKindButtons.forEach((button) => {
      button.classList.toggle("is-active", Tools.normalizeImportKind(button.getAttribute("data-import-kind")) === kind());
    });
    if (importKindSummary) {
      importKindSummary.innerHTML = `
        <div class="kicker">Current import</div>
        <strong>${escapeHtml(meta.label)}</strong>
        <div class="detail-copy">${escapeHtml(meta.summary)}</div>
        <div class="detail-copy">${escapeHtml(IMPORT_STATE.fileName ? `File loaded: ${IMPORT_STATE.fileName}` : "No file selected yet.")}</div>
        ${activeProfile ? `<div class="detail-copy">${escapeHtml(`Matched profile: ${activeProfile.label || activeProfile.key}`)}</div>` : ""}
      `;
    }
    if (btnDownloadImportTemplate) btnDownloadImportTemplate.textContent = `Download ${meta.label.toLowerCase()} template`;
    if (importFileLabel) importFileLabel.textContent = IMPORT_STATE.fileName || "Drop a CSV here or choose a file";
    if (btnAnalyzeImport) btnAnalyzeImport.disabled = IMPORT_STATE.importing;
    if (btnClearImport) btnClearImport.disabled = IMPORT_STATE.importing;
    if (btnRunImportAiReview) btnRunImportAiReview.disabled = IMPORT_STATE.importing || !IMPORT_STATE.preview?.rows?.length;
    renderPreview();
    renderProfileSummary();
    renderAiReview();
  }

  function resetImportState(options = {}) {
    IMPORT_STATE = {
      kind: options.keepKind ? kind() : "customers",
      fileName: "",
      headers: [],
      rows: [],
      preview: null,
      importing: false,
      profilesLoaded: IMPORT_STATE.profilesLoaded,
      profiles: profileList(),
      profileKey: "",
      aiReview: null,
    };
    if (importFile) importFile.value = "";
    setImportMessage("");
    setImportAiMessage("");
    renderImportWorkspace();
  }

  function setImportKind(kindValue) {
    IMPORT_STATE.kind = Tools.normalizeImportKind(kindValue);
    IMPORT_STATE.fileName = "";
    IMPORT_STATE.headers = [];
    IMPORT_STATE.rows = [];
    IMPORT_STATE.preview = null;
    IMPORT_STATE.profileKey = "";
    IMPORT_STATE.aiReview = null;
    if (importFile) importFile.value = "";
    setImportMessage("");
    setImportAiMessage("");
    renderImportWorkspace();
  }

  function readSelectedImportFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("This file could not be read."));
      reader.readAsText(file);
    });
  }

  async function previewImport(file) {
    if (!file) throw new Error("Choose a CSV file first.");
    await ensureImportProfilesLoaded({ silent: true });
    const text = await readSelectedImportFile(file);
    const parsed = Tools.parseCsv(text);
    if (!parsed.rows.length) throw new Error("That CSV does not contain any import rows yet.");
    const detectedKind = Tools.detectImportKind(parsed.headers, { profiles: profileList() });
    if (detectedKind && detectedKind !== kind()) {
      IMPORT_STATE.kind = detectedKind;
      setImportMessage(`ProofLink recognized this file as ${kindMeta(detectedKind).label.toLowerCase()} and switched the import mode for you.`, "ok");
    } else {
      setImportMessage("");
    }
    IMPORT_STATE.fileName = file.name || "import.csv";
    IMPORT_STATE.headers = parsed.headers;
    IMPORT_STATE.rows = parsed.rows;
    IMPORT_STATE.aiReview = null;
    const matchedProfile = typeof Tools.chooseImportProfile === "function"
      ? Tools.chooseImportProfile(parsed.headers, IMPORT_STATE.kind, profileList())
      : null;
    IMPORT_STATE.profileKey = matchedProfile?.key || "";
    IMPORT_STATE.preview = buildPreview();
    if (matchedProfile) {
      setImportAiMessage(`Matched saved import profile: ${matchedProfile.label || matchedProfile.key}.`, "ok");
    } else {
      setImportAiMessage("");
    }
    renderImportWorkspace();
    return IMPORT_STATE.preview;
  }

  async function upsertImportedCustomer(record) {
    const existing = record.existing || customerMatch(record);
    const nowIso = new Date().toISOString();
    const payload = withTenantScope({
      operator_id: opId(),
      name: record.name || existing?.name || record.email || record.phone || "Customer",
      email: record.email || null,
      phone: record.phone || null,
      preferred_contact: record.preferredContact || existing?.preferred_contact || "email",
      notes: record.mergedNotes || existing?.notes || "",
      service_address: record.serviceAddress || existing?.service_address || null,
      billing_address: record.billingAddress || existing?.billing_address || null,
      tags: record.mergedTags || existing?.tags || [],
      last_contact_at: nowIso,
      updated_at: nowIso,
    });

    const query = existing?.id
      ? sb.from("customers").update(payload).eq("id", existing.id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
      : sb.from("customers").insert({ ...payload, created_at: nowIso });

    const { data, error } = await query.select("*").single();
    if (error) throw error;
    updateCustomersCache(data);
    return { customer: data, action: existing?.id ? (record.action === "Match" ? "matched" : "updated") : "created" };
  }

  async function bumpImportedCustomerMetrics(customer, totalCents) {
    if (!customer?.id || totalCents <= 0) return customer;
    const nowIso = new Date().toISOString();
    const payload = {
      lifetime_value_cents: Math.max(0, Number(customer.lifetime_value_cents || 0)) + Math.max(0, Number(totalCents || 0)),
      order_count: Math.max(0, Number(customer.order_count || 0)) + 1,
      last_contact_at: nowIso,
      updated_at: nowIso,
    };
    const { data, error } = await sb.from("customers")
      .update(payload)
      .eq("id", customer.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();
    if (error) throw error;
    updateCustomersCache(data);
    return data;
  }

  async function ensureDepositImportOverride(order, row) {
    if (!order?.id) return order;
    const depositGap = Math.max(0, Number(order.deposit_required_cents || row.depositRequiredCents || 0) - Math.min(Number(order.deposit_required_cents || row.depositRequiredCents || 0), Number(order.deposit_paid_cents || order.amount_paid_cents || row.amountPaidCents || 0)));
    const nowIso = new Date().toISOString();
    const reason = row.depositRequiredCents > 0
      ? `Imported work carried over with ${formatUsd(depositGap)} deposit still open so scheduling history stayed intact during migration.`
      : "Imported work was allowed through during the ProofLink migration.";
    const { data, error } = await sb.from("orders")
      .update({
        deposit_override_reason: reason,
        deposit_override_at: nowIso,
        deposit_override_by: opId(),
        updated_at: nowIso,
      })
      .eq("id", order.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();
    if (error) {
      if (typeof isMissingDatabaseFeatureError === "function" && isMissingDatabaseFeatureError(error, ["deposit_override_reason"])) return order;
      throw error;
    }
    updateOrdersCache(data);
    return data;
  }

  async function importLeadRow(row, customer) {
    const existing = existingLeadByRef(row.sourceRef);
    if (existing) return { lead: existing, action: "skipped" };
    const nowIso = new Date().toISOString();
    const payload = withTenantScope({
      operator_id: opId(),
      customer_id: customer?.id || null,
      status: row.leadStatus || "new",
      source_type: "csv_import",
      source_ref: row.sourceRef,
      title: row.title || "Imported lead",
      summary: row.summary || row.note || "",
      requested_service_type: row.requestedServiceType || "",
      service_address: row.serviceAddress || customer?.service_address || null,
      contact_name: customer?.name || row.customerName || null,
      contact_email: row.customerEmail || customer?.email || null,
      contact_phone: row.customerPhone || customer?.phone || null,
      preferred_contact: normalizePreferredContact(customer?.preferred_contact || "", row.customerEmail, row.customerPhone),
      notes: row.note || "",
      metadata: {
        imported_via: "csv",
        import_ref: row.sourceRef,
      },
      last_activity_at: nowIso,
      updated_at: nowIso,
    });
    const { data, error } = await sb.from("leads").insert({ ...payload, created_at: nowIso }).select("*").single();
    if (error) throw error;
    updateLeadsCache(data);
    return { lead: data, action: "created" };
  }

  async function importBidRow(row, customer) {
    let lead = existingLeadByRef(row.sourceRef);
    if (!lead) {
      const result = await importLeadRow(row, customer);
      lead = result.lead;
    }
    if (!lead?.id) throw new Error("ProofLink could not create the imported lead record.");
    if (lead.converted_bid_id) {
      const existingBid = BIDS_CACHE.find((draft) => bidRecordId(draft) === lead.converted_bid_id || draft.id === lead.converted_bid_id) || null;
      return { lead, bid: existingBid, action: "skipped" };
    }

    const nowIso = new Date().toISOString();
    const payload = withTenantScope({
      operator_id: opId(),
      lead_id: lead.id,
      customer_id: customer?.id || lead.customer_id || null,
      status: row.bidStatus || "ready_to_send",
      profile: typeof preferredBidProfile === "function" ? preferredBidProfile() : "general_service",
      title: row.title || lead.title || "Imported quote",
      walkthrough_at: nowIso,
      valid_until: normalizeIsoDate(row.paymentDueDate),
      service_address: row.serviceAddress || customer?.service_address || null,
      schedule_window: row.scheduleWindow || null,
      project_summary: row.summary || lead.summary || "",
      scope_of_work: row.summary || "",
      internal_notes: mergeNotes(lead.notes, row.note, "Imported work note"),
      deposit_percent: row.totalCents > 0 && row.depositRequiredCents > 0 ? Number(((row.depositRequiredCents / row.totalCents) * 100).toFixed(2)) : 0,
      deposit_amount_cents: Math.max(0, Number(row.depositRequiredCents || 0)),
      line_items: baseBidLineItems(row),
      photos: [],
      subtotal_cents: Math.max(0, Number(row.totalCents || 0)),
      optional_total_cents: 0,
      total_cents: Math.max(0, Number(row.totalCents || 0)),
      metadata: {
        imported_via: "csv",
        import_ref: row.sourceRef,
        local_draft_id: `imported-${Tools.hashString(row.sourceRef || row.title || nowIso)}`,
      },
      updated_at: nowIso,
    });
    const { data: bidRow, error: bidError } = await sb.from("bids").insert({ ...payload, created_at: nowIso }).select("*").single();
    if (bidError) throw bidError;

    const { data: nextLead, error: leadError } = await sb.from("leads")
      .update({
        converted_bid_id: bidRow.id,
        status: "quoted",
        last_activity_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", lead.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();
    if (leadError) throw leadError;

    updateLeadsCache(nextLead);
    const draft = typeof draftFromBidRow === "function" ? draftFromBidRow(bidRow) : bidRow;
    if (typeof mergeBidDraftCollections === "function") {
      BIDS_CACHE = mergeBidDraftCollections(BIDS_CACHE, [draft]);
    } else {
      BIDS_CACHE = cacheReplaceById(BIDS_CACHE, draft);
    }
    if (typeof persistBidDrafts === "function") persistBidDrafts();
    return { lead: nextLead, bid: bidRow, action: "created" };
  }

  async function removeImportedRollupPayments(orderId) {
    const rows = importedRollupPaymentsForOrder(orderId);
    if (!rows.length) return;
    const ids = rows.map((row) => row.id).filter(Boolean);
    const { error } = await sb.from("payments")
      .delete()
      .in("id", ids)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID);
    if (error) throw error;
    PAYMENTS_CACHE = PAYMENTS_CACHE.filter((row) => !ids.includes(row.id));
  }

  async function createImportedRollupPayment(order, row, customer) {
    const ref = `${row.sourceRef}::rollup`;
    const existing = existingPaymentByRef(ref);
    if (existing) return existing;
    const amountCents = Math.max(0, Number(row.amountPaidCents || 0));
    if (amountCents <= 0) return null;
    const paidAt = normalizeIsoDateTime(row.paymentDueDate) || new Date().toISOString();
    const nowIso = new Date().toISOString();
    const payload = withTenantScope({
      operator_id: opId(),
      customer_id: customer?.id || order.customer_id || null,
      order_id: order.id,
      job_id: order.primary_job_id || null,
      payment_mode: "manual_other",
      status: "paid",
      amount_subtotal: amountCents,
      amount_total: amountCents,
      currency: "usd",
      source: "csv_import_rollup",
      reference_number: null,
      note: "Imported payment rollup from legacy open work.",
      metadata: {
        import_ref: ref,
        import_rollup: true,
        note: "Imported payment rollup from legacy open work.",
        recorded_via: "csv_import",
      },
      paid_at: paidAt,
      received_at: paidAt,
      is_manual: true,
      updated_at: nowIso,
    });
    const { data, error } = await sb.from("payments").insert({ ...payload, created_at: nowIso }).select("*").single();
    if (error) throw error;
    updatePaymentsCache(data);
    return data;
  }

  async function createImportedJob(order, row, customer) {
    const existing = JOBS_CACHE.find((job) => job.order_id === order.id || job.id === order.primary_job_id) || null;
    if (existing) return { job: existing, action: "skipped" };
    const nowIso = new Date().toISOString();
    const payload = withTenantScope({
      operator_id: order.operator_id || opId(),
      order_id: order.id,
      customer_id: order.customer_id || customer?.id || null,
      bid_id: order.bid_id || null,
      status: row.jobStatus || "scheduled",
      title: row.title || order.cart_summary || order.customer_name || "Imported job",
      service_address: row.serviceAddress || order.service_address || customer?.service_address || customer?.billing_address || "",
      scheduled_date: normalizeIsoDate(row.scheduledDate || order.scheduled_date),
      scheduled_time: order.scheduled_time || null,
      schedule_window: row.scheduleWindow || order.schedule_window || null,
      summary: row.summary || order.cart_summary || "Imported service work",
      notes: row.note || order.notes || "",
      payment_state: order.payment_state || row.paymentState || "unpaid",
      amount_paid_cents: Math.max(0, Number(order.amount_paid_cents || row.amountPaidCents || 0)),
      amount_due_cents: Math.max(0, Number(order.amount_due_cents || row.amountDueCents || 0)),
      updated_at: nowIso,
    });

    let jobRow;
    let jobError;
    ({ data: jobRow, error: jobError } = await sb.from("jobs").insert({ ...payload, created_at: nowIso }).select("*").single());
    if (jobError) {
      const text = typeof errorText === "function" ? errorText(jobError) : String(jobError?.message || "").toLowerCase();
      if (text.includes("deposit") || text.includes("booking")) {
        const overrideOrder = await ensureDepositImportOverride(order, row);
        ({ data: jobRow, error: jobError } = await sb.from("jobs").insert({ ...payload, created_at: nowIso }).select("*").single());
        if (jobError) throw jobError;
        order = overrideOrder;
      } else {
        throw jobError;
      }
    }
    updateJobsCache(jobRow);

    const nextStatus = ["new", "quoted"].includes(String(order.status || "").toLowerCase()) ? "confirmed" : order.status;
    const { data: nextOrder, error: orderError } = await sb.from("orders")
      .update({
        primary_job_id: jobRow.id,
        booked_at: order.booked_at || nowIso,
        status: nextStatus,
        updated_at: nowIso,
      })
      .eq("id", order.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();
    if (orderError) throw orderError;
    updateOrdersCache(nextOrder);
    return { job: jobRow, order: nextOrder, action: "created" };
  }

  async function importOrderRow(row, customer) {
    const existing = existingOrderByRef(row.sourceRef);
    if (existing) return { order: existing, action: "skipped" };
    const nowIso = new Date().toISOString();
    const scheduledDate = normalizeIsoDate(row.scheduledDate);
    const totalCents = Math.max(0, Number(row.totalCents || 0));
    const paymentDueDate = normalizeIsoDate(row.paymentDueDate) || scheduledDate || null;
    const payload = withTenantScope({
      operator_id: opId(),
      customer_id: customer?.id || null,
      status: row.orderStatus || "confirmed",
      fulfillment: "service",
      scheduled_date: scheduledDate,
      scheduled_time: null,
      schedule_window: row.scheduleWindow || null,
      service_address: row.serviceAddress || customer?.service_address || customer?.billing_address || null,
      items: baseOrderItems(row),
      subtotal_cents: totalCents,
      delivery_fee_cents: 0,
      total_cents: totalCents,
      estimated_total_cents: totalCents,
      item_count: 1,
      unpriced_count: totalCents > 0 ? 0 : 1,
      cart_summary: row.title || "Imported work",
      notes: mergeNotes("", row.note || row.summary, "Imported work note"),
      customer_name: customer?.name || row.customerName || "Customer",
      email: row.customerEmail || customer?.email || null,
      phone: row.customerPhone || customer?.phone || null,
      preferred_contact: normalizePreferredContact(customer?.preferred_contact || "", row.customerEmail || customer?.email, row.customerPhone || customer?.phone),
      source_type: "csv_import",
      source_ref: row.sourceRef,
      payment_due_date: paymentDueDate,
      payment_state: row.paymentState || "unpaid",
      amount_paid_cents: Math.max(0, Number(row.amountPaidCents || 0)),
      amount_due_cents: Math.max(0, Number(row.amountDueCents || totalCents)),
      deposit_required_cents: Math.max(0, Number(row.depositRequiredCents || 0)),
      created_at: nowIso,
      updated_at: nowIso,
    });

    let orderRow;
    let orderError;
    ({ data: orderRow, error: orderError } = await sb.from("orders").insert(payload).select("*").single());
    if (orderError) {
      if (typeof isMissingDatabaseFeatureError === "function" && isMissingDatabaseFeatureError(orderError, ["schedule_window", "service_address"])) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.schedule_window;
        delete fallbackPayload.service_address;
        ({ data: orderRow, error: orderError } = await sb.from("orders").insert(fallbackPayload).select("*").single());
      }
    }
    if (orderError) throw orderError;

    updateOrdersCache(orderRow);
    let seededOrder = orderRow;
    if (typeof seedOrderDepositDefaults === "function" && row.depositRequiredCents > 0) {
      seededOrder = await seedOrderDepositDefaults(orderRow, {
        depositRequiredCents: row.depositRequiredCents,
        depositPolicy: "required_before_job",
        depositDueDate: paymentDueDate || scheduledDate || null,
      });
      updateOrdersCache(seededOrder);
    }
    if (row.amountPaidCents > 0) {
      await createImportedRollupPayment(seededOrder, row, customer);
    }
    let nextCustomer = customer;
    if (totalCents > 0) {
      nextCustomer = await bumpImportedCustomerMetrics(customer, totalCents);
    }
    let nextJob = null;
    if (row.createJob) {
      const jobResult = await createImportedJob(seededOrder, row, nextCustomer || customer);
      nextJob = jobResult.job;
      if (jobResult.order) seededOrder = jobResult.order;
    }
    return { order: seededOrder, job: nextJob, customer: nextCustomer || customer, action: "created" };
  }

  function resolveOrderForPayment(row) {
    const externalId = compact(row.orderExternalId);
    if (externalId) {
      const sourceRef = workRef({ externalId });
      const order = existingOrderByRef(sourceRef);
      if (order) return order;
    }
    return CRM_ORDERS_CACHE.find((order) => {
      const sameCustomer = row.customerEmail && email(order.email) === row.customerEmail
        || (row.customerPhone && phoneDigits(order.phone) === phoneDigits(row.customerPhone));
      return !!sameCustomer;
    }) || null;
  }

  async function importPaymentRow(row) {
    if (row.existing) return { payment: row.existing, action: "skipped" };
    const existing = existingPaymentByRef(row.sourceRef);
    if (existing) return { payment: existing, action: "skipped" };

    let order = resolveOrderForPayment(row);
    let customer = order?.customer_id ? (CUSTOMERS_CACHE.find((item) => item.id === order.customer_id) || null) : null;
    const matchedCustomer = customerMatch({ name: row.customerName, email: row.customerEmail, phone: row.customerPhone });
    if (!customer && (row.customerName || row.customerEmail || row.customerPhone)) {
      const customerResult = await upsertImportedCustomer({
        name: row.customerName || row.customerEmail || row.customerPhone,
        email: row.customerEmail || "",
        phone: row.customerPhone || "",
        preferredContact: normalizePreferredContact("", row.customerEmail, row.customerPhone),
        serviceAddress: "",
        billingAddress: "",
        tags: [],
        mergedTags: [],
        mergedNotes: row.note || "",
        existing: matchedCustomer,
        action: matchedCustomer ? "Update" : "Create",
      });
      customer = customerResult.customer;
    }
    if (order?.id) {
      await removeImportedRollupPayments(order.id);
    }

    const nowIso = new Date().toISOString();
    const paidAt = normalizeIsoDateTime(row.paidAt) || nowIso;
    const payload = withTenantScope({
      operator_id: opId(),
      customer_id: customer?.id || order?.customer_id || null,
      order_id: order?.id || null,
      job_id: JOBS_CACHE.find((job) => job.order_id === order?.id)?.id || null,
      payment_mode: row.method || "manual_other",
      status: row.status || "paid",
      amount_subtotal: Math.max(0, Number(row.amountCents || 0)),
      amount_total: Math.max(0, Number(row.amountCents || 0)),
      currency: "usd",
      source: "csv_import",
      reference_number: row.reference || null,
      note: row.note || null,
      metadata: {
        import_ref: row.sourceRef,
        imported_via: "csv",
        reference: row.reference || null,
        note: row.note || null,
      },
      paid_at: paidAt,
      received_at: paidAt,
      is_manual: true,
      updated_at: nowIso,
    });
    const { data, error } = await sb.from("payments").insert({ ...payload, created_at: nowIso }).select("*").single();
    if (error) throw error;
    updatePaymentsCache(data);
    return { payment: data, action: "created", customer, order };
  }

  async function runAiMigrationReview() {
    if (!IMPORT_STATE.preview?.rows?.length) throw new Error("Preview a CSV before running the migration review.");
    if (typeof requestOperatorFunction !== "function") throw new Error("Operator function access is not ready yet.");
    await ensureImportProfilesLoaded({ silent: true });
    setImportAiMessage("Reviewing the import mapping, row routing, and profile fit...", "");
    const activeProfile = activeImportProfile();
    const payload = await requestOperatorFunction("ai-agent-report", {
      method: "POST",
      body: {
        agent_key: "import_migration_assistant",
        import_kind: kind(),
        file_name: IMPORT_STATE.fileName || "",
        headers: IMPORT_STATE.headers,
        sample_rows: IMPORT_STATE.rows.slice(0, 18),
        active_profile: activeProfile ? {
          key: activeProfile.key,
          label: activeProfile.label,
          import_kind: activeProfile.import_kind || activeProfile.importKind,
          field_aliases: activeProfile.field_aliases || activeProfile.fieldAliases || {},
          sample_headers: activeProfile.sample_headers || activeProfile.sampleHeaders || [],
          confidence_score: activeProfile.confidence_score || activeProfile.confidenceScore || 0,
          source_hint: activeProfile.source_hint || activeProfile.sourceHint || "",
        } : null,
      },
    });
    IMPORT_STATE.aiReview = payload;
    renderImportWorkspace();
    setImportAiMessage("Migration review ready. Save the learned profile if the mapping looks right.", "ok");
    return payload;
  }

  async function saveSuggestedImportProfile() {
    const suggestion = IMPORT_STATE.aiReview?.context_summary?.profile_suggestion || null;
    if (!suggestion) throw new Error("Run the migration review first so ProofLink has a profile to save.");
    if (typeof requestOperatorFunction !== "function") throw new Error("Operator function access is not ready yet.");
    setImportAiMessage("Saving the learned import profile...", "");
    const payload = await requestOperatorFunction("manage-import-profiles", {
      method: "POST",
      body: {
        action: "upsert",
        profile: suggestion,
      },
    });
    IMPORT_STATE.profiles = Array.isArray(payload?.profiles) ? payload.profiles : profileList();
    IMPORT_STATE.profilesLoaded = true;
    IMPORT_STATE.profileKey = payload?.profile?.key || suggestion.key || "";
    IMPORT_STATE.preview = buildPreview();
    renderImportWorkspace();
    setImportAiMessage(`Saved ${payload?.profile?.label || "the learned profile"}. Future imports from the same export shape will match faster.`, "ok");
    return payload?.profile || null;
  }

  async function runImport() {
    const preview = IMPORT_STATE.preview;
    if (!preview?.rows?.length) throw new Error("Preview a CSV before importing it.");
    IMPORT_STATE.importing = true;
    renderImportWorkspace();
    setImportMessage("Importing into ProofLink...");

    const results = {
      processed: preview.rows.length,
      created: 0,
      updated: 0,
      matched: 0,
      skipped: 0,
      errors: 0,
      leads: 0,
      bids: 0,
      orders: 0,
      jobs: 0,
      payments: 0,
      customers: 0,
    };
    const rowErrors = [];

    for (const row of preview.rows) {
      if (!row.ready) {
        results.errors += 1;
        rowErrors.push(`Row ${row.rowNumber}: ${row.detail || "Needs review before importing."}`);
        continue;
      }
      try {
        if (preview.kind === "customers") {
          const result = await upsertImportedCustomer(row);
          if (result.action === "created") {
            results.created += 1;
            results.customers += 1;
          } else if (result.action === "updated") {
            results.updated += 1;
            results.customers += 1;
          } else {
            results.matched += 1;
          }
          continue;
        }

        if (preview.kind === "open_work") {
          const matchedCustomer = customerMatch({ name: row.customerName, email: row.customerEmail, phone: row.customerPhone });
          const customerResult = await upsertImportedCustomer({
            name: row.customerName || row.customerEmail || row.customerPhone,
            email: row.customerEmail || "",
            phone: row.customerPhone || "",
            preferredContact: normalizePreferredContact("", row.customerEmail, row.customerPhone),
            serviceAddress: row.serviceAddress || "",
            billingAddress: "",
            tags: [],
            mergedTags: [],
            mergedNotes: row.note || "",
            existing: matchedCustomer,
            action: matchedCustomer ? "Update" : "Create",
          });
          const customer = customerResult.customer;
          if (customerResult.action === "created") {
            results.created += 1;
            results.customers += 1;
          } else if (customerResult.action === "updated") {
            results.updated += 1;
            results.customers += 1;
          } else {
            results.matched += 1;
          }

          if (row.existing) {
            results.skipped += 1;
            continue;
          }

          if (row.recordType === "lead") {
            const leadResult = await importLeadRow(row, customer);
            if (leadResult.action === "created") {
              results.created += 1;
              results.leads += 1;
            } else {
              results.skipped += 1;
            }
            continue;
          }

          if (row.recordType === "bid") {
            const bidResult = await importBidRow(row, customer);
            if (bidResult.action === "created") {
              results.created += 2;
              results.leads += 1;
              results.bids += 1;
            } else {
              results.skipped += 1;
            }
            continue;
          }

          const orderResult = await importOrderRow(row, customer);
          if (orderResult.action === "created") {
            results.created += 1;
            results.orders += 1;
            if (orderResult.job) {
              results.created += 1;
              results.jobs += 1;
            }
            if (row.amountPaidCents > 0) {
              results.created += 1;
              results.payments += 1;
            }
          } else {
            results.skipped += 1;
          }
          continue;
        }

        if (preview.kind === "payments") {
          const paymentResult = await importPaymentRow(row);
          if (paymentResult.action === "created") {
            results.created += 1;
            results.payments += 1;
          } else {
            results.skipped += 1;
          }
        }
      } catch (err) {
        results.errors += 1;
        rowErrors.push(`Row ${row.rowNumber}: ${err.message || String(err)}`);
      }
    }

    await Promise.allSettled([
      fetchCustomers(),
      fetchCrmOrders(),
      fetchPayments(),
      fetchLeads(),
      fetchJobs(),
      typeof loadPersistedBids === "function" ? loadPersistedBids() : Promise.resolve([]),
    ]);

    renderCustomersList(customerSearch?.value || "");
    renderOrders();
    renderPayments();
    renderLeads(leadSearch?.value || "");
    renderJobs(jobSearch?.value || "");
    renderDashboard();
    renderGuidance();
    if (typeof renderStartupChecklist === "function") renderStartupChecklist();
    renderMoney().catch(console.error);

    IMPORT_STATE.preview = buildPreview();
    IMPORT_STATE.importing = false;
    renderImportWorkspace();

    const summaryBits = [
      `${results.processed} row${results.processed === 1 ? "" : "s"} reviewed`,
      `${results.created} created`,
      `${results.updated} updated`,
      `${results.matched} matched`,
      `${results.skipped} skipped`,
    ];
    const tone = results.errors ? "warn" : "ok";
    const errorTail = results.errors ? ` ${results.errors} row${results.errors === 1 ? "" : "s"} still need attention.${rowErrors.length ? ` ${rowErrors.slice(0, 2).join(" ")}` : ""}` : "";
    setImportMessage(`Import finished: ${summaryBits.join(" | ")}.${errorTail}`, tone);
  }

  function downloadTemplate(kindValue) {
    const nextKind = Tools.normalizeImportKind(kindValue);
    const csv = Tools.templateCsv(nextKind);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prooflink-${nextKind}-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  importKindButtons.forEach((button) => {
    button.addEventListener("click", () => setImportKind(button.getAttribute("data-import-kind")));
  });

  importTemplateButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextKind = button.getAttribute("data-template-kind");
      setImportKind(nextKind);
      downloadTemplate(nextKind);
      setImportMessage(`Downloaded the ${kindMeta(nextKind).label.toLowerCase()} template. Fill it out, then come right back here to preview it.`, "ok");
    });
  });

  btnDownloadImportTemplate?.addEventListener("click", () => {
    downloadTemplate(kind());
    setImportMessage(`Downloaded the ${kindMeta().label.toLowerCase()} template.`, "ok");
  });

  btnClearImport?.addEventListener("click", () => {
    resetImportState({ keepKind: true });
    setImportMessage("Import list cleared.", "ok");
  });

  importFile?.addEventListener("change", async () => {
    const [file] = Array.from(importFile.files || []);
    if (!file) return;
    try {
      await previewImport(file);
    } catch (err) {
      setImportMessage(err.message || String(err), "error");
    }
  });

  btnAnalyzeImport?.addEventListener("click", async () => {
    const [file] = Array.from(importFile.files || []);
    try {
      await previewImport(file);
      setImportMessage("Preview ready. Review what ProofLink will create, update, or skip before you import.", "ok");
    } catch (err) {
      setImportMessage(err.message || String(err), "error");
    }
  });

  btnRunImportAiReview?.addEventListener("click", async () => {
    try {
      await runAiMigrationReview();
    } catch (err) {
      setImportAiMessage(err.message || String(err), "error");
      renderImportWorkspace();
    }
  });

  btnSaveImportProfile?.addEventListener("click", async () => {
    try {
      await saveSuggestedImportProfile();
    } catch (err) {
      setImportAiMessage(err.message || String(err), "error");
      renderImportWorkspace();
    }
  });

  btnRunImport?.addEventListener("click", async () => {
    try {
      await runImport();
    } catch (err) {
      IMPORT_STATE.importing = false;
      renderImportWorkspace();
      setImportMessage(err.message || String(err), "error");
    }
  });

  window.PROOFLINK_IMPORT_WORKSPACE = {
    render: renderImportWorkspace,
    reset: resetImportState,
    previewImport,
    runAiMigrationReview,
    saveSuggestedImportProfile,
    ensureImportProfilesLoaded,
  };

  renderImportWorkspace();
})();
