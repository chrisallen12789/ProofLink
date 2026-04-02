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
  const importWalkthroughWrap = $("importWalkthroughWrap");
  const importProfileWrap = $("importProfileWrap");
  const importPresetWrap = $("importPresetWrap");
  const importReviewQueueWrap = $("importReviewQueueWrap");
  const importCleanupInboxWrap = $("importCleanupInboxWrap");
  const importKindButtons = Array.from(document.querySelectorAll("[data-import-kind]"));
  const importTemplateButtons = Array.from(document.querySelectorAll("[data-template-kind]"));
  const btnRunImportAiReview = $("btnRunImportAiReview");
  const btnSaveImportProfile = $("btnSaveImportProfile");
  const MATCH_SELECTION_NEW = "__create_new__";
  const MATCH_SELECTION_CUSTOMER_ONLY = "__customer_only__";

  const REVIEW_FIELD_CONFIG = {
    customers: [
      { key: "name", label: "Customer name" },
      { key: "email", label: "Email", input: "email" },
      { key: "phone", label: "Phone", input: "tel" },
      { key: "preferred_contact", label: "Preferred contact", input: "select", options: ["email", "phone", "text"] },
      { key: "service_address", label: "Service address" },
      { key: "billing_address", label: "Billing address" },
      { key: "tags", label: "Tags", help: "Comma-separated tags" },
      { key: "notes", label: "Notes", input: "textarea" },
      { key: "attachment_links", label: "Attachment links", input: "textarea", help: "URLs or file references separated by commas, semicolons, or new lines" },
    ],
    open_work: [
      { key: "customer_name", label: "Customer name" },
      { key: "customer_email", label: "Customer email", input: "email" },
      { key: "customer_phone", label: "Customer phone", input: "tel" },
      { key: "stage", label: "Workflow stage", input: "select", options: ["new", "quoted", "booked", "scheduled", "completed", "paid", "overdue", "cancelled"] },
      { key: "title", label: "Work title" },
      { key: "requested_service_type", label: "Service type" },
      { key: "summary", label: "Summary", input: "textarea" },
      { key: "service_address", label: "Service address" },
      { key: "scheduled_date", label: "Scheduled date", input: "date" },
      { key: "schedule_window", label: "Schedule window" },
      { key: "total_amount", label: "Total amount" },
      { key: "amount_paid", label: "Amount paid" },
      { key: "deposit_required", label: "Deposit required" },
      { key: "payment_due_date", label: "Payment due date", input: "date" },
      { key: "note", label: "Notes", input: "textarea" },
      { key: "attachment_links", label: "Attachment links", input: "textarea", help: "URLs or file references separated by commas, semicolons, or new lines" },
    ],
    payments: [
      { key: "customer_name", label: "Customer name" },
      { key: "customer_email", label: "Customer email", input: "email" },
      { key: "customer_phone", label: "Customer phone", input: "tel" },
      { key: "order_external_id", label: "Linked work / invoice id" },
      { key: "amount", label: "Amount" },
      { key: "status", label: "Payment status", input: "select", options: ["paid", "pending", "refunded", "cancelled"] },
      { key: "method", label: "Payment method", input: "select", options: ["cash", "check", "ach", "external_card", "manual_other"] },
      { key: "paid_at", label: "Paid at" },
      { key: "reference", label: "Reference" },
      { key: "note", label: "Notes", input: "textarea" },
      { key: "attachment_links", label: "Attachment links", input: "textarea", help: "Receipt URLs, document links, or file references" },
    ],
  };

  const LANE_WALKTHROUGH_GUIDANCE = {
    customers: {
      title: "Customer foundation",
      tips: [
        "Start with customers so later work and payment imports have stable people and account matches.",
        "Names, emails, phones, and addresses matter more than internal notes on the first pass.",
      ],
    },
    open_work: {
      title: "Pipeline continuity",
      tips: [
        "Import open work after customers so leads, quotes, jobs, and invoice-ready work land on real accounts.",
        "Service address, scheduled date, and the workflow stage are the first fields to verify for dispatch accuracy.",
      ],
    },
    payments: {
      title: "Money continuity",
      tips: [
        "Import payments after customers and open work so deposits and historical payments can link cleanly.",
        "Payment amount, date, method, and the linked invoice or work reference are the fields that keep collections accurate.",
      ],
    },
  };

  const SOURCE_WALKTHROUGH_GUIDANCE = {
    quickbooks: {
      title: "QuickBooks continuity",
      tips: [
        "If QuickBooks stays the accounting source of truth, keep the QuickBooks invoice or doc number mapped into the linked work or payment reference fields.",
        "That reference should show up in the service report or job notes so ProofLink and QuickBooks stay traceable without duplicate bookkeeping.",
      ],
    },
    jobber: {
      title: "Jobber exports",
      tips: [
        "Jobber exports work best in order: customers first, then open work, then payments.",
        "Property address, job title, and scheduled date are the first fields to verify before importing jobs or quotes.",
      ],
    },
    housecall_pro: {
      title: "Housecall Pro exports",
      tips: [
        "Check property address and arrival window fields carefully so crew scheduling stays grounded after migration.",
        "Use the review queue to clean up any customer rows that only have a property name without a strong contact match.",
      ],
    },
    servicetitan: {
      title: "ServiceTitan exports",
      tips: [
        "Verify job type, appointment date, and invoice number before importing open work from ServiceTitan.",
        "If a payment file is separate, bring it in last so invoice references can attach to migrated work cleanly.",
      ],
    },
    generic: {
      title: "Legacy spreadsheet guidance",
      tips: [
        "Preview first, then fix only the rows that block routing or billing history. You do not need a perfect sheet before starting.",
        "Save the learned profile after review so the next export from the same system takes far less cleanup.",
      ],
    },
  };

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
    presetKey: "",
    presetPinned: false,
    rowDecisions: {},
    rowOverrides: {},
    rowSelections: {},
    expandedReviewRow: 0,
    lastSavedProfileKey: "",
    aiReview: null,
    cleanupInbox: [],
    lastImportResults: null,
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

  function presetProfilesForKind(importKind = kind()) {
    return typeof Tools.listImportPresetProfiles === "function"
      ? Tools.listImportPresetProfiles(importKind)
      : [];
  }

  function activeImportPreset() {
    const presetKey = compact(IMPORT_STATE.presetKey);
    if (!presetKey) return null;
    return presetProfilesForKind().find((preset) => compact(preset?.key) === presetKey)
      || (typeof Tools.getImportPresetProfile === "function" ? Tools.getImportPresetProfile(presetKey) : null)
      || null;
  }

  function activeImportProfiles() {
    const profiles = [activeImportProfile(), activeImportPreset()].filter(Boolean);
    return profiles.filter((profile, index) => profiles.findIndex((candidate) => compact(candidate?.key) === compact(profile?.key)) === index);
  }

  function reviewFieldConfig(importKind = kind()) {
    return REVIEW_FIELD_CONFIG[Tools.normalizeImportKind(importKind)] || [];
  }

  function laneWalkthroughGuidance(importKind = kind()) {
    return LANE_WALKTHROUGH_GUIDANCE[Tools.normalizeImportKind(importKind)] || LANE_WALKTHROUGH_GUIDANCE.customers;
  }

  function allImportDetectionProfiles() {
    return [
      ...profileList(),
      ...(typeof Tools.listImportPresetProfiles === "function" ? Tools.listImportPresetProfiles() : []),
    ];
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

  function uniqueList(values, maxItems = 6) {
    return Array.from(new Set((Array.isArray(values) ? values : [values]).map((value) => compact(value)).filter(Boolean))).slice(0, maxItems);
  }

  function rowNumberToIndex(rowNumber) {
    const number = Number(rowNumber || 0);
    return number >= 2 ? number - 2 : -1;
  }

  function rawImportRow(rowNumber) {
    const index = rowNumberToIndex(rowNumber);
    return index >= 0 ? (IMPORT_STATE.rows[index] || null) : null;
  }

  function rowOverrideMap(rowOrNumber) {
    const rowNumber = Number(typeof rowOrNumber === "object" ? rowOrNumber?.rowNumber : rowOrNumber);
    if (!rowNumber) return {};
    return IMPORT_STATE.rowOverrides?.[rowNumber] || {};
  }

  function rowOverrideValue(rowOrNumber, fieldKey) {
    const overrides = rowOverrideMap(rowOrNumber);
    return Object.prototype.hasOwnProperty.call(overrides, fieldKey) ? String(overrides[fieldKey] ?? "") : null;
  }

  function hasRowOverrides(rowOrNumber) {
    return Object.keys(rowOverrideMap(rowOrNumber)).length > 0;
  }

  function rowSelectionMap(rowOrNumber) {
    const rowNumber = Number(typeof rowOrNumber === "object" ? rowOrNumber?.rowNumber : rowOrNumber);
    if (!rowNumber) return {};
    return IMPORT_STATE.rowSelections?.[rowNumber] || {};
  }

  function rowSelectionValue(rowOrNumber, fieldKey) {
    const selections = rowSelectionMap(rowOrNumber);
    return Object.prototype.hasOwnProperty.call(selections, fieldKey) ? String(selections[fieldKey] ?? "") : "";
  }

  function hasRowSelections(rowOrNumber) {
    return Object.keys(rowSelectionMap(rowOrNumber)).length > 0;
  }

  function setRowSelection(rowNumber, fieldKey, value = "") {
    const key = Number(rowNumber || 0);
    if (!key || !fieldKey) return;
    const nextValue = String(value ?? "").trim();
    const nextSelections = {
      ...(IMPORT_STATE.rowSelections?.[key] || {}),
    };
    if (nextValue) nextSelections[fieldKey] = nextValue;
    else delete nextSelections[fieldKey];
    IMPORT_STATE.rowSelections = {
      ...(IMPORT_STATE.rowSelections || {}),
      [key]: nextSelections,
    };
    if (!Object.keys(nextSelections).length) delete IMPORT_STATE.rowSelections[key];
    IMPORT_STATE.aiReview = null;
    IMPORT_STATE.preview = buildPreview();
    renderImportWorkspace();
  }

  function currentSourcePresetSummary() {
    return IMPORT_STATE.aiReview?.context_summary?.source_preset || null;
  }

  function currentSourceSystem() {
    return compact(
      activeImportPreset()?.source_system
      || activeImportProfile()?.source_system
      || currentSourcePresetSummary()?.source_system
    ).toLowerCase();
  }

  function sourceWalkthroughGuidance(sourceSystem = currentSourceSystem()) {
    return SOURCE_WALKTHROUGH_GUIDANCE[sourceSystem] || SOURCE_WALKTHROUGH_GUIDANCE.generic;
  }

  function activeLearningNotes() {
    return uniqueList(activeImportProfile()?.learning_notes || []);
  }

  function activeWalkthroughSummary() {
    return compact(activeImportProfile()?.walkthrough_summary);
  }

  function baseImportField(row, importKind, fieldKey) {
    const aliases = typeof Tools.resolveFieldAliases === "function"
      ? Tools.resolveFieldAliases(importKind, fieldKey, activeImportProfiles())
      : (Tools.FIELD_ALIASES?.[Tools.normalizeImportKind(importKind)]?.[fieldKey] || []);
    return Tools.getValue(row, aliases);
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

  function importField(row, importKind, fieldKey, options = {}) {
    const rowNumber = Number(options.rowNumber || row?.rowNumber || 0);
    const overrideValue = rowOverrideValue(rowNumber, fieldKey);
    if (overrideValue !== null) return overrideValue;
    return baseImportField(row, importKind, fieldKey);
  }

  function rowDecision(rowOrNumber) {
    const rowNumber = Number(typeof rowOrNumber === "object" ? rowOrNumber?.rowNumber : rowOrNumber);
    if (!rowNumber) return "";
    return compact(IMPORT_STATE.rowDecisions?.[rowNumber]).toLowerCase();
  }

  function isRowSkipped(rowOrNumber) {
    return rowDecision(rowOrNumber) === "skip";
  }

  function setExpandedReviewRow(rowNumber = 0) {
    IMPORT_STATE.expandedReviewRow = Number(rowNumber || 0);
    renderImportWorkspace();
  }

  function setRowOverrides(rowNumber, values = {}) {
    const key = Number(rowNumber || 0);
    if (!key) return;
    const raw = rawImportRow(key);
    if (!raw) return;
    const nextOverrides = {};
    Object.entries(values || {}).forEach(([fieldKey, value]) => {
      const normalizedValue = String(value ?? "").trim();
      const baseValue = baseImportField(raw, kind(), fieldKey);
      if (normalizedValue !== compact(baseValue)) nextOverrides[fieldKey] = normalizedValue;
    });
    IMPORT_STATE.rowOverrides = {
      ...(IMPORT_STATE.rowOverrides || {}),
      [key]: nextOverrides,
    };
    if (!Object.keys(nextOverrides).length) delete IMPORT_STATE.rowOverrides[key];
    IMPORT_STATE.aiReview = null;
    IMPORT_STATE.preview = buildPreview();
    renderImportWorkspace();
  }

  function clearRowOverrides(rowNumber) {
    const key = Number(rowNumber || 0);
    if (!key || !IMPORT_STATE.rowOverrides?.[key]) return;
    IMPORT_STATE.rowOverrides = {
      ...(IMPORT_STATE.rowOverrides || {}),
    };
    delete IMPORT_STATE.rowOverrides[key];
    IMPORT_STATE.aiReview = null;
    IMPORT_STATE.preview = buildPreview();
    renderImportWorkspace();
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

  function parseImportAttachmentRefs(value) {
    const rawValue = String(value || "").replace(/\r/g, "\n");
    if (!rawValue.trim()) return [];
    const baseParts = rawValue
      .split(/[\n;|]+/)
      .flatMap((part) => part.split(/,(?=\s*(?:https?:\/\/|www\.|\/|[A-Za-z]:\\))/))
      .map((part) => compact(part))
      .filter(Boolean);
    const parts = baseParts.length > 1
      ? baseParts
      : rawValue.split(/[\n;,|]+/).map((part) => compact(part)).filter(Boolean);
    return parts
      .map((entry) => {
        const normalized = compact(entry).replace(/^www\./i, "https://www.");
        const cleanValue = normalized.replace(/\s+/g, " ").trim();
        if (!cleanValue) return null;
        const lowerValue = cleanValue.toLowerCase();
        const pathValue = lowerValue.split("?")[0].split("#")[0];
        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif|svg)$/.test(pathValue);
        const isDocument = /\.(pdf|doc|docx|xls|xlsx|csv|txt|rtf)$/.test(pathValue);
        const label = cleanValue.split("/").pop() || cleanValue;
        return {
          id: `attachment-${Tools.hashString(lowerValue)}`,
          label,
          raw: cleanValue,
          url: /^https?:\/\//.test(cleanValue) ? cleanValue : "",
          kind: isImage ? "image" : (isDocument ? "document" : "reference"),
        };
      })
      .filter(Boolean)
      .filter((attachment, index, list) => list.findIndex((candidate) => candidate.raw.toLowerCase() === attachment.raw.toLowerCase()) === index)
      .slice(0, 10);
  }

  function importAttachmentRefs(row, importKind, rowNumber) {
    return parseImportAttachmentRefs(importField(row, importKind, "attachment_links", { rowNumber }));
  }

  function attachmentSummary(attachments) {
    if (!attachments.length) return "";
    const imageCount = attachments.filter((item) => item.kind === "image").length;
    const documentCount = attachments.filter((item) => item.kind === "document").length;
    const referenceCount = Math.max(attachments.length - imageCount - documentCount, 0);
    return [
      `${attachments.length} attachment ref${attachments.length === 1 ? "" : "s"}`,
      imageCount ? `${imageCount} image${imageCount === 1 ? "" : "s"}` : "",
      documentCount ? `${documentCount} document${documentCount === 1 ? "" : "s"}` : "",
      referenceCount ? `${referenceCount} link${referenceCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" | ");
  }

  function attachmentNoteBlock(attachments, label = "Imported attachment references") {
    if (!attachments.length) return "";
    return `${label}:\n${attachments.map((attachment) => `- ${attachment.label}${attachment.url ? ` | ${attachment.url}` : ` | ${attachment.raw}`}`).join("\n")}`;
  }

  function attachmentMetadata(attachments) {
    return attachments.map((attachment) => ({
      label: attachment.label,
      url: attachment.url || null,
      raw: attachment.raw,
      kind: attachment.kind,
    }));
  }

  function importedBidPhotos(attachments) {
    return attachments
      .filter((attachment) => attachment.kind === "image" && attachment.url)
      .slice(0, 8)
      .map((attachment) => ({
        id: attachment.id,
        name: attachment.label || "Imported walkthrough photo",
        category: "overview",
        note: "Imported from legacy attachment references during CSV migration.",
        url: attachment.url,
        storage_mode: "external_url",
        captured_at: new Date().toISOString(),
      }));
  }

  function matchReasonsLabel(reasons) {
    return uniqueList(reasons, 3).join(", ");
  }

  function customerMatches(row) {
    const targetEmail = email(row?.email || row?.customerEmail);
    const targetPhone = phoneDigits(row?.phone || row?.customerPhone);
    const targetName = compact(row?.name || row?.customerName).toLowerCase();
    const targetAddress = compact(row?.serviceAddress || row?.service_address || row?.billingAddress || "").toLowerCase();
    return (Array.isArray(CUSTOMERS_CACHE) ? CUSTOMERS_CACHE : [])
      .map((customer) => {
        let score = 0;
        const reasons = [];
        if (targetEmail && email(customer?.email) === targetEmail) {
          score += 5;
          reasons.push("email");
        }
        if (targetPhone && phoneDigits(customer?.phone) === targetPhone) {
          score += 4;
          reasons.push("phone");
        }
        if (targetName && compact(customer?.name).toLowerCase() === targetName) {
          score += 3;
          reasons.push("name");
        }
        const customerServiceAddress = compact(customer?.service_address).toLowerCase();
        const customerBillingAddress = compact(customer?.billing_address).toLowerCase();
        if (targetAddress && (customerServiceAddress === targetAddress || customerBillingAddress === targetAddress)) {
          score += 2;
          reasons.push("address");
        }
        return score > 0 ? { ...customer, _matchScore: score, _matchReasons: reasons } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b._matchScore - a._matchScore || compact(a.name).localeCompare(compact(b.name)));
  }

  function resolvedCustomerMatch(rowNumber, row, matches = customerMatches(row)) {
    const selectedId = rowSelectionValue(rowNumber, "match_customer_id");
    if (selectedId === MATCH_SELECTION_NEW) return { customer: null, mode: "create_new", needsDecision: false };
    if (selectedId) {
      const selected = matches.find((customer) => customer.id === selectedId)
        || CUSTOMERS_CACHE.find((customer) => customer?.id === selectedId)
        || null;
      return { customer: selected, mode: selected ? "selected" : "", needsDecision: !selected };
    }
    if (matches.length === 1) return { customer: matches[0], mode: "auto", needsDecision: false };
    return { customer: null, mode: "", needsDecision: matches.length > 1 };
  }

  function customerMatch(row, options = {}) {
    const matches = options.matches || customerMatches(row);
    const resolved = resolvedCustomerMatch(options.rowNumber || row?.rowNumber, row, matches);
    return resolved.customer || null;
  }

  function orderMatchCandidates(row, customer) {
    const externalId = compact(row?.orderExternalId);
    const exactSourceRef = externalId ? workRef({ externalId }) : "";
    const customerId = customer?.id || "";
    return (Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [])
      .map((order) => {
        let score = 0;
        const reasons = [];
        if (exactSourceRef && String(order?.source_ref || "") === exactSourceRef) {
          score += 7;
          reasons.push("import ref");
        }
        if (customerId && order?.customer_id === customerId) {
          score += 4;
          reasons.push("customer");
        }
        if (row?.customerEmail && email(order?.email) === email(row.customerEmail)) {
          score += 3;
          reasons.push("customer email");
        }
        if (row?.customerPhone && phoneDigits(order?.phone) === phoneDigits(row.customerPhone)) {
          score += 3;
          reasons.push("customer phone");
        }
        if (row?.serviceAddress && compact(order?.service_address).toLowerCase() === compact(row.serviceAddress).toLowerCase()) {
          score += 2;
          reasons.push("service address");
        }
        return score > 0 ? { ...order, _matchScore: score, _matchReasons: reasons } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b._matchScore - a._matchScore || new Date(b.scheduled_date || 0).getTime() - new Date(a.scheduled_date || 0).getTime());
  }

  function resolvedOrderMatch(rowNumber, row, candidates = []) {
    const selectedId = rowSelectionValue(rowNumber, "match_order_id");
    if (selectedId === MATCH_SELECTION_CUSTOMER_ONLY) return { order: null, mode: "customer_only", needsDecision: false };
    if (selectedId) {
      const selected = candidates.find((order) => order.id === selectedId)
        || CRM_ORDERS_CACHE.find((order) => order?.id === selectedId)
        || null;
      return { order: selected, mode: selected ? "selected" : "", needsDecision: !selected };
    }
    if (candidates.length === 1) {
      const only = candidates[0];
      const exactExternalMatch = compact(row?.orderExternalId) && compact(only?.source_ref) === workRef({ externalId: row.orderExternalId });
      if (compact(row?.orderExternalId) && !exactExternalMatch) {
        return { order: null, mode: "", needsDecision: true };
      }
      return { order: only, mode: exactExternalMatch ? "exact" : "auto", needsDecision: false };
    }
    if (compact(row?.orderExternalId)) return { order: null, mode: "", needsDecision: true };
    return { order: null, mode: "", needsDecision: candidates.length > 1 };
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
      const rowNumber = index + 2;
      const name = compact(importField(raw, "customers", "name", { rowNumber }));
      const contactEmail = email(importField(raw, "customers", "email", { rowNumber }));
      const contactPhone = compact(importField(raw, "customers", "phone", { rowNumber }));
      const serviceAddress = compact(importField(raw, "customers", "service_address", { rowNumber }));
      const billingAddress = compact(importField(raw, "customers", "billing_address", { rowNumber }));
      const customerMatchesList = customerMatches({ name, email: contactEmail, phone: contactPhone, serviceAddress, billingAddress });
      const customerResolution = resolvedCustomerMatch(rowNumber, { name, email: contactEmail, phone: contactPhone, serviceAddress, billingAddress }, customerMatchesList);
      const existing = customerResolution.customer;
      const tags = Tools.parseTagList(importField(raw, "customers", "tags", { rowNumber }));
      const mergedTags = mergeTags(existing?.tags, tags);
      const mergedNotes = mergeNotes(existing?.notes, importField(raw, "customers", "notes", { rowNumber }), "Imported note");
      const attachments = importAttachmentRefs(raw, "customers", rowNumber);
      const attachmentSummaryText = attachmentSummary(attachments);
      const preferredContact = normalizePreferredContact(importField(raw, "customers", "preferred_contact", { rowNumber }), contactEmail, contactPhone);

      if (!name && !contactEmail && !contactPhone) {
        return {
          rowNumber,
          ready: false,
          action: "Needs review",
          tone: "error",
          primary: `Row ${rowNumber}`,
          secondary: "Missing customer identity",
          detail: "Add a name, email, or phone so ProofLink has a real customer to create or match.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: existing,
          customerDecisionRequired: false,
        };
      }

      if (customerResolution.needsDecision) {
        return {
          rowNumber,
          raw,
          ready: false,
          action: "Needs review",
          tone: "error",
          primary: name || contactEmail || contactPhone || `Row ${rowNumber}`,
          secondary: `${customerMatchesList.length} possible customer matches`,
          detail: "Choose the exact customer to merge into, or pick create new, so ProofLink does not attach this row to the wrong account.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: null,
          customerDecisionRequired: true,
        };
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
        rowNumber,
        raw,
        ready: true,
        externalId: compact(importField(raw, "customers", "external_id", { rowNumber })),
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
        detail: [
          existing
            ? (changed ? "ProofLink will enrich the live customer record." : "ProofLink already has this customer and will not duplicate it.")
            : "ProofLink will create a new customer record.",
          attachmentSummaryText ? `Attachment carry-forward: ${attachmentSummaryText}.` : "",
        ].filter(Boolean).join(" "),
        attachments,
        attachmentSummary: attachmentSummaryText,
        customerMatches: customerMatchesList,
        selectedCustomer: existing,
        customerDecisionRequired: false,
        attachmentFollowUp: attachments.length > 0,
      };
    });
  }

  function previewWork() {
    return IMPORT_STATE.rows.map((raw, index) => {
      const rowNumber = index + 2;
      const customerName = compact(importField(raw, "open_work", "customer_name", { rowNumber }));
      const customerEmail = email(importField(raw, "open_work", "customer_email", { rowNumber }));
      const customerPhone = compact(importField(raw, "open_work", "customer_phone", { rowNumber }));
      const title = compact(importField(raw, "open_work", "title", { rowNumber })) || compact(importField(raw, "open_work", "requested_service_type", { rowNumber })) || "Imported work";
      const summary = compact(importField(raw, "open_work", "summary", { rowNumber }));
      const totalCents = Math.max(0, Tools.toCents(importField(raw, "open_work", "total_amount", { rowNumber })));
      const amountPaidCents = Math.max(0, Tools.toCents(importField(raw, "open_work", "amount_paid", { rowNumber })));
      const depositRequiredCents = Math.max(0, Tools.toCents(importField(raw, "open_work", "deposit_required", { rowNumber })));
      const paymentDueDate = compact(importField(raw, "open_work", "payment_due_date", { rowNumber }));
      const stageRaw = compact(importField(raw, "open_work", "stage", { rowNumber }));
      const stage = normalizeWorkStage(stageRaw, { totalCents });
      const paymentState = inferPaymentState(totalCents, amountPaidCents, paymentDueDate, stage.paymentState);
      const attachments = importAttachmentRefs(raw, "open_work", rowNumber);
      const attachmentSummaryText = attachmentSummary(attachments);
      const customerMatchesList = customerMatches({ name: customerName, email: customerEmail, phone: customerPhone, serviceAddress: compact(importField(raw, "open_work", "service_address", { rowNumber })) });
      const customerResolution = resolvedCustomerMatch(rowNumber, { name: customerName, email: customerEmail, phone: customerPhone, serviceAddress: compact(importField(raw, "open_work", "service_address", { rowNumber })) }, customerMatchesList);
      const sourceRef = stage.recordType === "order"
        ? workRef({ externalId: importField(raw, "open_work", "external_id", { rowNumber }), customerEmail, customerPhone, title, scheduledDate: importField(raw, "open_work", "scheduled_date", { rowNumber }), totalCents, stageRaw })
        : leadRef({ externalId: importField(raw, "open_work", "external_id", { rowNumber }), customerEmail, customerPhone, title, summary, stageRaw });
      const existing = stage.recordType === "order" ? existingOrderByRef(sourceRef) : existingLeadByRef(sourceRef);

      if (!customerName && !customerEmail && !customerPhone) {
        return {
          rowNumber,
          ready: false,
          action: "Needs review",
          tone: "error",
          primary: `Row ${rowNumber}`,
          secondary: "Missing customer identity",
          detail: "Add customer information so the imported work lands on a real account.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: customerResolution.customer,
          customerDecisionRequired: false,
        };
      }

      if (customerResolution.needsDecision) {
        return {
          rowNumber,
          raw,
          ready: false,
          action: "Needs review",
          tone: "error",
          primary: title,
          secondary: `${customerMatchesList.length} possible customer matches`,
          detail: "Choose the correct customer account or create a new customer before this work is routed into the pipeline.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: null,
          customerDecisionRequired: true,
          sourceRef,
          recordType: stage.recordType,
          paymentState,
        };
      }

      return {
        rowNumber,
        raw,
        ready: true,
        existing,
        sourceRef,
        externalId: compact(importField(raw, "open_work", "external_id", { rowNumber })),
        customerExternalId: compact(importField(raw, "open_work", "customer_external_id", { rowNumber })),
        customerName,
        customerEmail,
        customerPhone,
        title,
        summary,
        requestedServiceType: compact(importField(raw, "open_work", "requested_service_type", { rowNumber })),
        serviceAddress: compact(importField(raw, "open_work", "service_address", { rowNumber })),
        scheduledDate: compact(importField(raw, "open_work", "scheduled_date", { rowNumber })),
        scheduleWindow: compact(importField(raw, "open_work", "schedule_window", { rowNumber })),
        totalCents,
        amountPaidCents,
        amountDueCents: Math.max(totalCents - amountPaidCents, 0),
        depositRequiredCents,
        paymentDueDate,
        note: compact(importField(raw, "open_work", "note", { rowNumber })),
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
        detail: [
          existing ? "ProofLink already has this imported record and will skip it safely." : `${formatUsd(totalCents)} total${depositRequiredCents > 0 ? ` | ${formatUsd(depositRequiredCents)} deposit` : ""}${stage.createJob ? " | job included" : ""}`,
          attachmentSummaryText ? `Attachment carry-forward: ${attachmentSummaryText}.` : "",
        ].filter(Boolean).join(" "),
        attachments,
        attachmentSummary: attachmentSummaryText,
        customerMatches: customerMatchesList,
        selectedCustomer: customerResolution.customer,
        customerDecisionRequired: false,
        attachmentFollowUp: attachments.length > 0 && !(stage.recordType === "bid" && attachments.every((attachment) => attachment.kind === "image")),
      };
    });
  }

  function previewPayments() {
    return IMPORT_STATE.rows.map((raw, index) => {
      const rowNumber = index + 2;
      const customerName = compact(importField(raw, "payments", "customer_name", { rowNumber }));
      const customerEmail = email(importField(raw, "payments", "customer_email", { rowNumber }));
      const customerPhone = compact(importField(raw, "payments", "customer_phone", { rowNumber }));
      const amountCents = Math.max(0, Tools.toCents(importField(raw, "payments", "amount", { rowNumber })));
      const rowData = {
        externalId: compact(importField(raw, "payments", "external_id", { rowNumber })),
        customerExternalId: compact(importField(raw, "payments", "customer_external_id", { rowNumber })),
        customerName,
        customerEmail,
        customerPhone,
        orderExternalId: compact(importField(raw, "payments", "order_external_id", { rowNumber })),
        amountCents,
        status: normalizePaymentStatus(importField(raw, "payments", "status", { rowNumber })),
        method: normalizePaymentMethod(importField(raw, "payments", "method", { rowNumber })),
        paidAt: compact(importField(raw, "payments", "paid_at", { rowNumber })),
        reference: compact(importField(raw, "payments", "reference", { rowNumber })),
        note: compact(importField(raw, "payments", "note", { rowNumber })),
      };
      const attachments = importAttachmentRefs(raw, "payments", rowNumber);
      const attachmentSummaryText = attachmentSummary(attachments);
      const customerMatchesList = customerMatches({ name: customerName, email: customerEmail, phone: customerPhone });
      const customerResolution = resolvedCustomerMatch(rowNumber, { name: customerName, email: customerEmail, phone: customerPhone }, customerMatchesList);
      const orderMatches = orderMatchCandidates(rowData, customerResolution.customer);
      const orderResolution = resolvedOrderMatch(rowNumber, rowData, orderMatches, customerResolution.customer);
      const sourceRef = paymentRef(rowData);
      const existing = existingPaymentByRef(sourceRef);

      if ((!customerName && !customerEmail && !customerPhone) && !rowData.orderExternalId) {
        return {
          rowNumber,
          ready: false,
          action: "Needs review",
          tone: "error",
          primary: `Row ${rowNumber}`,
          secondary: "Missing customer or work link",
          detail: "Add customer information or the matching work external id so ProofLink knows where the payment belongs.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: customerResolution.customer,
          customerDecisionRequired: false,
          orderMatches,
          selectedOrder: orderResolution.order,
          orderDecisionRequired: false,
        };
      }
      if (!amountCents) {
        return {
          rowNumber,
          ready: false,
          action: "Needs review",
          tone: "error",
          primary: `Row ${rowNumber}`,
          secondary: customerName || customerEmail || "Payment row",
          detail: "Add an amount greater than zero before importing payment history.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: customerResolution.customer,
          customerDecisionRequired: false,
          orderMatches,
          selectedOrder: orderResolution.order,
          orderDecisionRequired: false,
        };
      }
      if (!orderResolution.order && orderResolution.needsDecision) {
        return {
          ...rowData,
          rowNumber,
          raw,
          ready: false,
          existing,
          sourceRef,
          action: "Needs review",
          tone: "error",
          primary: customerName || customerEmail || customerPhone || "Imported payment",
          secondary: orderMatches.length ? `${orderMatches.length} possible work matches` : "Work link needs a decision",
          detail: compact(rowData.orderExternalId)
            ? "Choose the exact ProofLink work record for this payment, or mark it as customer-only if the legacy payment should stay unlinked."
            : "Choose the exact work record for this payment, or mark it as customer-only if it should remain account-level history.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: customerResolution.customer,
          customerDecisionRequired: false,
          orderMatches,
          selectedOrder: null,
          orderDecisionRequired: true,
        };
      }
      if (!orderResolution.order && customerResolution.needsDecision) {
        return {
          ...rowData,
          rowNumber,
          raw,
          ready: false,
          existing,
          sourceRef,
          action: "Needs review",
          tone: "error",
          primary: customerName || customerEmail || customerPhone || "Imported payment",
          secondary: `${customerMatchesList.length} possible customer matches`,
          detail: "Choose the correct customer account before this payment history is imported.",
          attachments,
          attachmentSummary: attachmentSummaryText,
          customerMatches: customerMatchesList,
          selectedCustomer: null,
          customerDecisionRequired: true,
          orderMatches,
          selectedOrder: orderResolution.order,
          orderDecisionRequired: false,
        };
      }

      return {
        ...rowData,
        rowNumber,
        raw,
        ready: true,
        existing,
        sourceRef,
        action: existing ? "Skip existing" : "Import payment",
        tone: existing ? "" : "ok",
        primary: customerName || customerEmail || customerPhone || "Imported payment",
        secondary: `${formatUsd(amountCents)} | ${rowData.status} | ${rowData.method}`,
        detail: [
          orderResolution.order
            ? `Linked to ${orderResolution.order.cart_summary || orderResolution.order.customer_name || "existing work"}.`
            : (rowData.orderExternalId ? `Will stay customer-linked unless you choose a work record for ${rowData.orderExternalId}.` : "Will import as customer-linked payment history."),
          attachmentSummaryText ? `Attachment carry-forward: ${attachmentSummaryText}.` : "",
        ].filter(Boolean).join(" "),
        attachments,
        attachmentSummary: attachmentSummaryText,
        customerMatches: customerMatchesList,
        selectedCustomer: customerResolution.customer,
        customerDecisionRequired: false,
        orderMatches,
        selectedOrder: orderResolution.order,
        orderDecisionRequired: false,
        attachmentFollowUp: attachments.length > 0,
      };
    });
  }

  function buildPreview() {
    const baseRows = kind() === "customers" ? previewCustomers() : (kind() === "open_work" ? previewWork() : previewPayments());
    const rows = baseRows.map((row) => ({
      ...row,
      operatorDecision: rowDecision(row),
      skipped: isRowSkipped(row),
      hasOverrides: hasRowOverrides(row),
      hasSelections: hasRowSelections(row),
    }));
    const readyRows = rows.filter((row) => row.ready && !row.skipped && !/^skip/i.test(row.action) && !/^match/i.test(row.action));
    return {
      kind: kind(),
      rows,
      readyRows,
      cards: [
        { label: "Preview rows", value: rows.length },
        { label: "Ready to write", value: readyRows.length },
        { label: "Already handled", value: rows.filter((row) => /^skip|^match/i.test(row.action)).length },
        { label: "Operator skipped", value: rows.filter((row) => row.skipped).length },
        { label: "Edited rows", value: rows.filter((row) => row.hasOverrides).length },
        { label: "Merge choices", value: rows.filter((row) => row.hasSelections).length },
        { label: "Attachment refs", value: rows.filter((row) => (row.attachments || []).length > 0).length },
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
              ${row.skipped ? `<span class="pill pill-warn">operator skip</span>` : ""}
              ${row.hasOverrides ? `<span class="pill pill-on">edited</span>` : ""}
              ${row.hasSelections ? `<span class="pill pill-on">merge choice</span>` : ""}
              ${row.recordType ? `<span class="pill">${escapeHtml(row.recordType)}</span>` : ""}
              ${row.paymentState ? `<span class="pill">${escapeHtml(String(row.paymentState).replace(/_/g, " "))}</span>` : ""}
              ${row.attachmentSummary ? `<span class="pill">${escapeHtml(row.attachmentSummary)}</span>` : ""}
            </div>
            <div>
              ${row.selectedCustomer?.id ? `<div class="detail-copy">Customer match: ${escapeHtml(row.selectedCustomer.name || row.selectedCustomer.email || row.selectedCustomer.phone || "Existing customer")}${row.selectedCustomer._matchReasons?.length ? ` (${escapeHtml(matchReasonsLabel(row.selectedCustomer._matchReasons))})` : ""}</div>` : ``}
              ${row.selectedOrder?.id ? `<div class="detail-copy">Work match: ${escapeHtml(row.selectedOrder.cart_summary || row.selectedOrder.customer_name || row.selectedOrder.id)}${row.selectedOrder._matchReasons?.length ? ` (${escapeHtml(matchReasonsLabel(row.selectedOrder._matchReasons))})` : ""}</div>` : ``}
              <div class="detail-copy mono">${escapeHtml(row.sourceRef || row.externalId || "")}</div>
            </div>
          </article>
        `).join("")}
        ${preview.rows.length > 18 ? `<div class="muted">Showing the first 18 rows. ProofLink will still process all ${preview.rows.length} previewed rows.</div>` : ""}
      </div>
    ` : `<div class="import-preview-table__empty">This file did not produce any usable rows yet.</div>`;
    if (btnRunImport) btnRunImport.disabled = IMPORT_STATE.importing || preview.readyRows.length === 0;
  }

  function renderPresetSummary() {
    if (!importPresetWrap) return;
    const presets = presetProfilesForKind();
    const activePreset = activeImportPreset();
    const pinned = IMPORT_STATE.presetPinned === true && !!activePreset;
    const title = activePreset ? activePreset.label : "Auto detection is active.";
    const body = activePreset
      ? (activePreset.description || activePreset.source_hint || "ProofLink is applying a known source-system preset to this file.")
      : "ProofLink will try to recognize the source system automatically. Choose a preset when you know the export came from a specific platform.";

    importPresetWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">Source system preset</div>
        <div><strong>${escapeHtml(title)}</strong></div>
        <div class="detail-copy">${escapeHtml(body)}</div>
        <div class="workspace-chip-row u-mt-10">
          ${activePreset?.system_label ? `<span class="pill pill-on">${escapeHtml(activePreset.system_label)}</span>` : `<span class="pill">Auto match</span>`}
          ${pinned ? `<span class="pill">Pinned for this file</span>` : ""}
        </div>
        <div class="import-preset-row u-mt-10">
          <button class="btn btn-ghost btn-sm import-preset-button" type="button" data-import-preset-key="" aria-pressed="${activePreset ? "false" : "true"}">Auto detect</button>
          ${presets.map((preset) => `
            <button class="btn btn-ghost btn-sm import-preset-button" type="button" data-import-preset-key="${escapeAttr(preset.key)}" aria-pressed="${activePreset?.key === preset.key ? "true" : "false"}">${escapeHtml(preset.system_label || preset.label)}</button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderWalkthrough() {
    if (!importWalkthroughWrap) return;
    const model = buildWalkthroughModel();
    const statusClass = {
      done: "memory-checklist__item--ready",
      warn: "memory-checklist__item--warn",
      current: "memory-checklist__item--ready",
      pending: "",
    };
    importWalkthroughWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">Guided walkthrough</div>
        <div><strong>${escapeHtml(model.title || "Guided walkthrough")}</strong></div>
        <div class="detail-copy">${escapeHtml(model.subtitle || "")}</div>
        <div class="import-walkthrough__next u-mt-10">
          <div class="kicker">Best next move</div>
          <strong>${escapeHtml(model.nextAction.title || "Keep going")}</strong>
          <div class="detail-copy">${escapeHtml(model.nextAction.detail || "")}</div>
        </div>
        ${model.learningSummary ? `<div class="detail-copy u-mt-10"><strong>Learned guidance:</strong> ${escapeHtml(model.learningSummary)}</div>` : ""}
      </div>
      <div class="memory-checklist u-mt-10">
        ${model.steps.map((step) => `
          <div class="memory-checklist__item ${statusClass[step.status] || ""}">
            <div class="workspace-chip-row">
              <span class="pill ${step.status === "done" ? "pill-on" : (step.status === "warn" ? "pill-warn" : "")}">${escapeHtml(step.status === "done" ? "done" : (step.status === "warn" ? "needs attention" : (step.status === "current" ? "next" : "pending")))}</span>
            </div>
            <div class="memory-checklist__title u-mt-10">${escapeHtml(step.label)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(step.detail || "")}</div>
          </div>
        `).join("")}
      </div>
      ${model.guidanceNotes.length ? `
        <div class="detail-card u-mt-10">
          <div class="kicker">Operator coaching</div>
          ${model.guidanceNotes.map((note) => `<div class="detail-copy">${escapeHtml(note)}</div>`).join("")}
        </div>
      ` : ""}
    `;
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
    const learningNotes = uniqueList(activeProfile?.learning_notes || []);
    importProfileWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">Import profile</div>
        <div><strong>${escapeHtml(activeLabel || "Matched import profile")}</strong></div>
        <div class="detail-copy">${escapeHtml(activeProfile?.source_hint || activeProfile?.sourceHint || "ProofLink matched a saved legacy export profile for this file and is applying it during preview.")}</div>
        <div class="workspace-chip-row u-mt-10">
          <span class="pill pill-on">${escapeHtml(kindMeta(activeProfile?.import_kind || activeProfile?.importKind).label)}</span>
          <span class="pill">${escapeHtml(`${mappedFields.length} mapped field${mappedFields.length === 1 ? "" : "s"}`)}</span>
          <span class="pill">${escapeHtml(`confidence ${Math.round(confidence * 100)}%`)}</span>
          ${learningNotes.length ? `<span class="pill">${escapeHtml(`${learningNotes.length} learned note${learningNotes.length === 1 ? "" : "s"}`)}</span>` : ""}
        </div>
        ${activeProfile?.walkthrough_summary ? `<div class="detail-copy u-mt-10">${escapeHtml(activeProfile.walkthrough_summary)}</div>` : ""}
      </div>
    `;
  }

  function reviewRows() {
    const preview = IMPORT_STATE.preview;
    if (!preview?.rows?.length) return [];
    return preview.rows.filter((row) => row.skipped || row.hasOverrides || row.hasSelections || !row.ready || row.tone === "warn" || /^update/i.test(row.action || ""));
  }

  function reviewFieldValue(row, field) {
    return importField(row.raw || rawImportRow(row.rowNumber) || {}, kind(), field.key, { rowNumber: row.rowNumber });
  }

  function renderReviewField(row, field) {
    const rawValue = reviewFieldValue(row, field);
    const value = field.input === "date" ? (normalizeIsoDate(rawValue) || "") : rawValue;
    const help = compact(field.help);
    if (field.input === "textarea") {
      return `
        <label class="import-review-field import-review-field--full">
          <span>${escapeHtml(field.label)}</span>
          <textarea data-import-review-field="${escapeAttr(field.key)}" rows="3">${escapeHtml(value)}</textarea>
          ${help ? `<small>${escapeHtml(help)}</small>` : ""}
        </label>
      `;
    }
    if (field.input === "select") {
      const options = Array.isArray(field.options) ? field.options : [];
      return `
        <label class="import-review-field">
          <span>${escapeHtml(field.label)}</span>
          <select data-import-review-field="${escapeAttr(field.key)}">
            <option value=""></option>
            ${options.map((option) => `<option value="${escapeAttr(option)}"${compact(value).toLowerCase() === compact(option).toLowerCase() ? " selected" : ""}>${escapeHtml(String(option).replace(/_/g, " "))}</option>`).join("")}
          </select>
          ${help ? `<small>${escapeHtml(help)}</small>` : ""}
        </label>
      `;
    }
    return `
      <label class="import-review-field${field.input === "date" ? " import-review-field--compact" : ""}">
        <span>${escapeHtml(field.label)}</span>
        <input type="${escapeAttr(field.input || "text")}" data-import-review-field="${escapeAttr(field.key)}" value="${escapeAttr(value)}" />
        ${help ? `<small>${escapeHtml(help)}</small>` : ""}
      </label>
    `;
  }

  function collectReviewFormValues(form, rowNumber) {
    if (!rawImportRow(rowNumber)) return {};
    const values = {};
    reviewFieldConfig().forEach((field) => {
      const input = form.querySelector(`[data-import-review-field="${field.key}"]`);
      if (!input) return;
      values[field.key] = String(input.value ?? "");
    });
    return values;
  }

  function collectReviewSelections(form) {
    const selections = {};
    form.querySelectorAll("[data-import-selection-field]").forEach((input) => {
      const fieldKey = input.getAttribute("data-import-selection-field");
      if (!fieldKey) return;
      selections[fieldKey] = String(input.value ?? "");
    });
    return selections;
  }

  function renderSelectionField({ label, fieldKey, options = [], currentValue = "", help = "", placeholder = "Choose one", full = true }) {
    return `
      <label class="import-review-field${full ? " import-review-field--full" : ""}">
        <span>${escapeHtml(label)}</span>
        <select data-import-selection-field="${escapeAttr(fieldKey)}">
          <option value="">${escapeHtml(placeholder)}</option>
          ${options.map((option) => `<option value="${escapeAttr(option.value)}"${currentValue === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
        ${help ? `<small>${escapeHtml(help)}</small>` : ""}
      </label>
    `;
  }

  function renderCustomerMatchSelection(row) {
    const selectionValue = rowSelectionValue(row, "match_customer_id");
    const matches = Array.isArray(row.customerMatches) ? row.customerMatches : [];
    if (!(row.customerDecisionRequired || matches.length > 1 || selectionValue === MATCH_SELECTION_NEW)) {
      return row.selectedCustomer?.id
        ? `<div class="import-review-match import-review-field--full"><strong>Matched customer:</strong> ${escapeHtml(row.selectedCustomer.name || row.selectedCustomer.email || row.selectedCustomer.phone || "Existing customer")}${row.selectedCustomer._matchReasons?.length ? ` <span class="muted">(${escapeHtml(matchReasonsLabel(row.selectedCustomer._matchReasons))})</span>` : ""}</div>`
        : "";
    }
    const options = [
      { value: MATCH_SELECTION_NEW, label: "Create new customer" },
      ...matches.map((customer) => ({
        value: customer.id,
        label: `${customer.name || customer.email || customer.phone || "Existing customer"}${customer._matchReasons?.length ? ` (${matchReasonsLabel(customer._matchReasons)})` : ""}`,
      })),
    ];
    return renderSelectionField({
      label: "Customer merge target",
      fieldKey: "match_customer_id",
      options,
      currentValue: selectionValue,
      placeholder: "Choose customer or create new",
      help: "ProofLink found more than one plausible customer account for this row.",
    });
  }

  function renderOrderMatchSelection(row) {
    const selectionValue = rowSelectionValue(row, "match_order_id");
    const matches = Array.isArray(row.orderMatches) ? row.orderMatches : [];
    if (!(row.orderDecisionRequired || matches.length > 1 || selectionValue === MATCH_SELECTION_CUSTOMER_ONLY)) {
      return row.selectedOrder?.id
        ? `<div class="import-review-match import-review-field--full"><strong>Matched work:</strong> ${escapeHtml(row.selectedOrder.cart_summary || row.selectedOrder.customer_name || row.selectedOrder.id)}${row.selectedOrder._matchReasons?.length ? ` <span class="muted">(${escapeHtml(matchReasonsLabel(row.selectedOrder._matchReasons))})</span>` : ""}</div>`
        : "";
    }
    const options = [
      { value: MATCH_SELECTION_CUSTOMER_ONLY, label: "Keep as customer-only payment history" },
      ...matches.map((order) => ({
        value: order.id,
        label: `${order.cart_summary || order.customer_name || order.id}${order.scheduled_date ? ` | ${order.scheduled_date}` : ""}${order._matchReasons?.length ? ` (${matchReasonsLabel(order._matchReasons)})` : ""}`,
      })),
    ];
    return renderSelectionField({
      label: "Linked work target",
      fieldKey: "match_order_id",
      options,
      currentValue: selectionValue,
      placeholder: "Choose work or keep customer-only",
      help: "Use this when a payment could belong to more than one job, order, or invoice record.",
    });
  }

  function renderAttachmentReview(row) {
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    if (!attachments.length) return "";
    return `
      <div class="import-review-attachments import-review-field--full">
        <div class="kicker">Attachment carry-forward</div>
        <div class="detail-copy">${escapeHtml(row.attachmentSummary || `${attachments.length} attachment reference(s)`)}${row.attachmentFollowUp ? " These will land in notes or cleanup follow-up unless ProofLink can place them directly." : " ProofLink can carry these forward directly."}</div>
        <div class="workspace-chip-row u-mt-10">
          ${attachments.slice(0, 6).map((attachment) => `<span class="pill">${escapeHtml(`${attachment.kind}: ${attachment.label}`)}</span>`).join("")}
        </div>
      </div>
    `;
  }

  function buildImportReviewSampleRows(limit = 18) {
    const normalizedKind = kind();
    const fieldKeys = reviewFieldConfig(normalizedKind).map((field) => field.key);
    return IMPORT_STATE.rows
      .map((raw, index) => ({ raw, rowNumber: index + 2 }))
      .filter((entry) => !isRowSkipped(entry.rowNumber))
      .slice(0, limit)
      .map(({ raw, rowNumber }) => {
      const serialized = { row_number: rowNumber };
      fieldKeys.forEach((fieldKey) => {
        const value = importField(raw, normalizedKind, fieldKey, { rowNumber });
        if (compact(value)) serialized[fieldKey] = value;
      });
      return serialized;
      });
  }

  function editedRowCount() {
    return IMPORT_STATE.preview?.rows?.filter((row) => row.hasOverrides).length || 0;
  }

  function selectedMergeRowCount() {
    return IMPORT_STATE.preview?.rows?.filter((row) => row.hasSelections).length || 0;
  }

  function skippedRowCount() {
    return IMPORT_STATE.preview?.rows?.filter((row) => row.skipped).length || 0;
  }

  function unresolvedRowCount() {
    return IMPORT_STATE.preview?.rows?.filter((row) => !row.skipped && row.ready === false).length || 0;
  }

  function attachmentRowCount() {
    return IMPORT_STATE.preview?.rows?.filter((row) => (row.attachments || []).length > 0).length || 0;
  }

  function cleanupInboxCount() {
    return (IMPORT_STATE.cleanupInbox || []).length;
  }

  function correctionFieldKeys(limit = 5) {
    const counts = {};
    Object.values(IMPORT_STATE.rowOverrides || {}).forEach((override) => {
      Object.keys(override || {}).forEach((fieldKey) => {
        counts[fieldKey] = (counts[fieldKey] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([fieldKey]) => fieldKey);
  }

  function correctionFieldLabels(limit = 3) {
    const labels = correctionFieldKeys(limit).map((fieldKey) =>
      reviewFieldConfig().find((field) => field.key === fieldKey)?.label || fieldKey.replace(/_/g, " ")
    );
    return uniqueList(labels, limit);
  }

  function activeWalkthroughHints() {
    const laneGuidance = laneWalkthroughGuidance();
    const sourceGuidance = sourceWalkthroughGuidance();
    return uniqueList([
      ...(laneGuidance?.tips || []),
      ...(sourceGuidance?.tips || []),
      ...activeLearningNotes(),
    ], 6);
  }

  function buildWalkthroughLearningData() {
    const sourceSystem = currentSourceSystem();
    const sourceGuidance = sourceWalkthroughGuidance(sourceSystem);
    const editedRows = editedRowCount();
    const skippedRows = skippedRowCount();
    const unresolvedRows = unresolvedRowCount();
    const selectedMerges = selectedMergeRowCount();
    const attachmentRows = attachmentRowCount();
    const cleanupItems = cleanupInboxCount();
    const correctedLabels = correctionFieldLabels(3);
    const activeProfile = activeImportProfile();
    const mergedNotes = uniqueList([
      ...(activeProfile?.learning_notes || []),
      `Bring ${kindMeta().label.toLowerCase()} through this walkthrough before importing so ProofLink can explain and verify the mapping safely.`,
      ...(sourceGuidance?.tips || []).slice(0, 2),
      editedRows ? `${editedRows} row(s) needed operator edits in the last walkthrough${correctedLabels.length ? `, mainly around ${correctedLabels.join(", ")}` : ""}.` : "",
      selectedMerges ? `${selectedMerges} row(s) needed explicit merge choices so ProofLink would not attach data to the wrong customer or work record.` : "",
      attachmentRows ? `${attachmentRows} row(s) carried attachment references that should stay visible in follow-up cleanup after import.` : "",
      skippedRows ? `${skippedRows} row(s) were skipped during the last walkthrough because they still needed manual cleanup.` : "",
      cleanupItems ? `${cleanupItems} cleanup inbox item(s) were left after import so the operator could finish unresolved links or attachment follow-up.` : "",
    ], 6);
    const correctionFields = uniqueList([
      ...(activeProfile?.correction_fields || []),
      ...correctionFieldKeys(6),
    ], 6);
    const walkthroughSummary = [
      currentSourceSystem() ? `Source system: ${currentSourceSystem().replace(/_/g, " ")}` : "",
      IMPORT_STATE.preview?.rows?.length ? `${IMPORT_STATE.preview.rows.length} preview row(s)` : "",
      editedRows ? `${editedRows} edited` : "0 edited",
      selectedMerges ? `${selectedMerges} merge choice${selectedMerges === 1 ? "" : "s"}` : "0 merge choices",
      attachmentRows ? `${attachmentRows} attachment row${attachmentRows === 1 ? "" : "s"}` : "0 attachment rows",
      skippedRows ? `${skippedRows} skipped` : "0 skipped",
      unresolvedRows ? `${unresolvedRows} still flagged` : "0 still flagged",
      cleanupItems ? `${cleanupItems} cleanup item${cleanupItems === 1 ? "" : "s"}` : "0 cleanup items",
    ].filter(Boolean).join(" | ");

    return {
      learning_notes: mergedNotes,
      correction_fields: correctionFields,
      walkthrough_summary: walkthroughSummary,
    };
  }

  function buildWalkthroughModel() {
    const preview = IMPORT_STATE.preview;
    const fileLoaded = !!compact(IMPORT_STATE.fileName);
    const hasAiReview = !!IMPORT_STATE.aiReview?.report;
    const hasProfile = !!activeImportProfile() || !!compact(IMPORT_STATE.lastSavedProfileKey);
    const editedRows = editedRowCount();
    const skippedRows = skippedRowCount();
    const unresolvedRows = unresolvedRowCount();
    const attachmentRows = attachmentRowCount();
    const cleanupItems = cleanupInboxCount();
    const sourcePreset = activeImportPreset() || currentSourcePresetSummary();
    const sourceGuidance = sourceWalkthroughGuidance();
    const laneGuidance = laneWalkthroughGuidance();
    const guidanceNotes = activeWalkthroughHints();

    const steps = [
      {
        label: "Confirm the lane and source",
        status: fileLoaded ? "done" : "current",
        detail: fileLoaded
          ? `${kindMeta().label} is active${sourcePreset?.label ? ` and ProofLink is guiding from ${sourcePreset.label}.` : "."}`
          : `Choose the best lane first. ${laneGuidance.title} keeps this migration grounded.`,
      },
      {
        label: "Preview the file",
        status: preview ? "done" : (fileLoaded ? "current" : "pending"),
        detail: preview
          ? `ProofLink mapped ${preview.rows.length} preview row(s) and will not write anything until you confirm.`
          : "Load a CSV and preview it so ProofLink can detect the likely source system and route.",
      },
      {
        label: "Reconcile risky rows",
        status: !preview ? "pending" : (unresolvedRows ? "warn" : "done"),
        detail: !preview
          ? "The review queue appears after preview."
          : unresolvedRows
            ? `${unresolvedRows} row(s) still need identity, amount, merge-target, or linked-record cleanup. Use edit fields, merge choices, or skip row to keep moving.`
            : `${editedRows ? `${editedRows} row(s) were corrected. ` : ""}${skippedRows ? `${skippedRows} row(s) were intentionally skipped. ` : ""}${attachmentRows ? `${attachmentRows} row(s) are also carrying attachment references. ` : ""}The current preview no longer has unresolved blockers.`,
      },
      {
        label: "Run the AI migration review",
        status: !preview ? "pending" : (hasAiReview ? "done" : "current"),
        detail: hasAiReview
          ? "The migration assistant reviewed the corrected sample and explained what can be routed safely."
          : "Run the AI review after the preview looks right so ProofLink can explain mapping coverage and routing risk.",
      },
      {
        label: "Teach ProofLink this export",
        status: hasProfile ? "done" : (hasAiReview ? "current" : "pending"),
        detail: hasProfile
          ? "A tenant-scoped learned profile is active for this export shape, so future files from the same system should need less cleanup."
          : "Save the learned profile after review so the migration assistant remembers this export shape next time.",
      },
    ];

    let nextAction = {
      title: "Upload and preview a CSV",
      detail: "ProofLink will detect the likely source system and show the safest import path.",
    };
    if (fileLoaded && !preview) {
      nextAction = {
        title: "Preview the file",
        detail: "This is the safest way to see what will create, update, link, or skip before anything writes.",
      };
    } else if (preview && unresolvedRows) {
      nextAction = {
        title: "Fix or skip the flagged rows",
        detail: "Use the review queue to edit identity, schedule, invoice, or payment fields until only safe rows remain.",
      };
    } else if (preview && !hasAiReview) {
      nextAction = {
        title: "Run AI migration review",
        detail: "The agent will explain mapping coverage, likely source system, and any remaining risk before import.",
      };
    } else if (cleanupItems) {
      nextAction = {
        title: "Work the cleanup inbox",
        detail: "Use the cleanup queue to finish attachment follow-up, skipped rows, and any payment or merge leftovers after the import run.",
      };
    } else if (preview && hasAiReview && !hasProfile) {
      nextAction = {
        title: "Save the learned profile",
        detail: "This is how ProofLink improves the migration assistant for the next export from the same system.",
      };
    } else if (preview?.readyRows?.length) {
      nextAction = {
        title: "Import into ProofLink",
        detail: "The current preview has write-ready rows and the walkthrough is satisfied with the visible blockers.",
      };
    }

    return {
      title: sourceGuidance?.title || "Guided walkthrough",
      subtitle: `ProofLink is guiding this ${kindMeta().label.toLowerCase()} import in the safest order it can detect.`,
      steps,
      nextAction,
      guidanceNotes,
      learningSummary: activeWalkthroughSummary(),
    };
  }

  function renderAiReview() {
    if (!importAiReviewWrap) return;
    const payload = IMPORT_STATE.aiReview;
    const report = payload?.report || null;
    const contextSummary = payload?.context_summary || {};
    const profileSuggestion = contextSummary?.profile_suggestion || null;
    const sourcePreset = contextSummary?.source_preset || null;
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
      Number(contextSummary.attachment_row_count || 0) ? `${contextSummary.attachment_row_count} attachment-heavy row${Number(contextSummary.attachment_row_count || 0) === 1 ? "" : "s"}` : "",
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
          ${sourcePreset?.system_label ? `<div class="workspace-chip-row u-mt-10"><span class="pill pill-on">${escapeHtml(sourcePreset.system_label)}</span></div>` : ""}
        </div>
      ` : ""}
      ${sourcePreset ? `
        <div class="detail-card u-mt-10">
          <div class="kicker">Likely source system</div>
          <div><strong>${escapeHtml(sourcePreset.system_label || sourcePreset.label || "Legacy export")}</strong></div>
          <div class="detail-copy">${escapeHtml(sourcePreset.description || "The reviewed file lines up with a known export shape.")}</div>
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

  function renderReviewQueue() {
    if (!importReviewQueueWrap) return;
    const preview = IMPORT_STATE.preview;
    if (!preview) {
      importReviewQueueWrap.innerHTML = `
        <div class="detail-card">
          <div class="kicker">Review queue</div>
          <div><strong>No import review queue yet.</strong></div>
          <div class="detail-copy">Preview a file first and ProofLink will surface the rows that need operator attention before anything writes.</div>
        </div>
      `;
      return;
    }

    const rows = reviewRows();
    if (!rows.length) {
      importReviewQueueWrap.innerHTML = `
        <div class="detail-card">
          <div class="kicker">Review queue</div>
          <div><strong>No rows need operator intervention right now.</strong></div>
          <div class="detail-copy">The current preview is ready to run without any row-level skips or corrections.</div>
        </div>
      `;
      return;
    }

    importReviewQueueWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">Review queue</div>
        <div><strong>${escapeHtml(`${rows.length} row${rows.length === 1 ? "" : "s"} need a decision before or during import.`)}</strong></div>
        <div class="detail-copy">Fix identity, address, schedule, invoice, or payment fields here before the import runs. Skip the truly risky rows and keep the rest moving.</div>
      </div>
      <div class="memory-checklist u-mt-10">
        ${rows.slice(0, 24).map((row) => `
          <div class="memory-checklist__item ${row.skipped ? "memory-checklist__item--warn" : (row.ready ? "memory-checklist__item--ready" : "memory-checklist__item--warn")}">
            <div class="detail-card__header">
              <div>
                <div class="kicker">Row ${escapeHtml(String(row.rowNumber || ""))}</div>
                <div class="memory-checklist__title">${escapeHtml(row.primary || "Import row")}</div>
              </div>
              <div class="workspace-chip-row">
                <span class="pill ${row.skipped ? "pill-warn" : (row.ready ? "pill-on" : "pill-bad")}">${escapeHtml(row.skipped ? "Skipped" : (row.ready ? "Ready" : "Needs review"))}</span>
                ${row.hasOverrides ? `<span class="pill pill-on">Edited</span>` : ""}
                ${row.hasSelections ? `<span class="pill pill-on">Merge choice</span>` : ""}
                ${row.recordType ? `<span class="pill">${escapeHtml(row.recordType)}</span>` : ""}
                ${row.attachmentSummary ? `<span class="pill">${escapeHtml(row.attachmentSummary)}</span>` : ""}
              </div>
            </div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(row.secondary || "")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(row.detail || "")}</div>
            ${row.selectedCustomer?.id ? `<div class="detail-copy memory-checklist__note"><strong>Customer:</strong> ${escapeHtml(row.selectedCustomer.name || row.selectedCustomer.email || row.selectedCustomer.phone || "Existing customer")}</div>` : ""}
            ${row.selectedOrder?.id ? `<div class="detail-copy memory-checklist__note"><strong>Work:</strong> ${escapeHtml(row.selectedOrder.cart_summary || row.selectedOrder.customer_name || row.selectedOrder.id)}</div>` : ""}
            <div class="import-review-row__actions u-mt-10">
              <button class="btn btn-ghost btn-sm" type="button" data-import-row-action="${IMPORT_STATE.expandedReviewRow === row.rowNumber ? "close-editor" : "open-editor"}" data-import-row-number="${escapeAttr(String(row.rowNumber || ""))}">${IMPORT_STATE.expandedReviewRow === row.rowNumber ? "Hide edits" : "Edit fields"}</button>
              <button class="btn btn-ghost btn-sm" type="button" data-import-row-action="${row.skipped ? "restore" : "skip"}" data-import-row-number="${escapeAttr(String(row.rowNumber || ""))}">${row.skipped ? "Restore row" : "Skip row"}</button>
              ${row.hasOverrides ? `<button class="btn btn-ghost btn-sm" type="button" data-import-row-action="reset-edits" data-import-row-number="${escapeAttr(String(row.rowNumber || ""))}">Reset edits</button>` : ""}
            </div>
            ${IMPORT_STATE.expandedReviewRow === row.rowNumber ? `
              <form class="import-review-form u-mt-10" data-import-review-form="${escapeAttr(String(row.rowNumber || ""))}">
                ${reviewFieldConfig().map((field) => renderReviewField(row, field)).join("")}
                ${renderCustomerMatchSelection(row)}
                ${renderOrderMatchSelection(row)}
                ${renderAttachmentReview(row)}
                <div class="import-review-row__actions">
                  <button class="btn btn-primary btn-sm" type="button" data-import-row-action="save-edits" data-import-row-number="${escapeAttr(String(row.rowNumber || ""))}">Apply edits</button>
                  <button class="btn btn-ghost btn-sm" type="button" data-import-row-action="close-editor" data-import-row-number="${escapeAttr(String(row.rowNumber || ""))}">Close</button>
                </div>
              </form>
            ` : ""}
          </div>
        `).join("")}
        ${rows.length > 24 ? `<div class="detail-copy">Showing the first 24 review rows for this preview.</div>` : ""}
      </div>
    `;
  }

  function removeCleanupItem(itemId) {
    IMPORT_STATE.cleanupInbox = (IMPORT_STATE.cleanupInbox || []).filter((item) => item.id !== itemId);
    renderImportWorkspace();
  }

  function openCleanupTarget(item) {
    if (!item) return;
    const targetTab = compact(item.targetTab);
    const targetId = compact(item.targetId);
    if (item.rowNumber) setExpandedReviewRow(item.rowNumber);
    if (!targetTab || !targetId || typeof switchTab !== "function") return;
    if (targetTab === "customers") {
      ACTIVE_CUSTOMER_ID = targetId;
      CUSTOMER_CREATING = false;
      switchTab("customers");
      if (typeof renderCustomerDetail === "function") renderCustomerDetail(targetId).catch?.(console.error);
      return;
    }
    if (targetTab === "orders") {
      ACTIVE_ORDER_ID = targetId;
      if (typeof renderOrders === "function") renderOrders();
      switchTab("orders");
      return;
    }
    if (targetTab === "jobs") {
      ACTIVE_JOB_ID = targetId;
      if (typeof renderJobs === "function") renderJobs(jobSearch?.value || "");
      switchTab("jobs");
      return;
    }
    if (targetTab === "payments") {
      ACTIVE_PAYMENT_ID = targetId;
      if (typeof renderPayments === "function") renderPayments();
      switchTab("payments");
      return;
    }
    if (targetTab === "bids") {
      ACTIVE_BID_ID = targetId;
      if (typeof renderBids === "function") renderBids(bidSearch?.value || "");
      switchTab("bids");
      return;
    }
    if (targetTab === "leads") {
      ACTIVE_LEAD_ID = targetId;
      if (typeof renderLeads === "function") renderLeads(leadSearch?.value || "");
      switchTab("leads");
    }
  }

  function renderCleanupInbox() {
    if (!importCleanupInboxWrap) return;
    const items = Array.isArray(IMPORT_STATE.cleanupInbox) ? IMPORT_STATE.cleanupInbox : [];
    const lastImport = IMPORT_STATE.lastImportResults || null;
    if (!lastImport && !items.length) {
      importCleanupInboxWrap.innerHTML = `
        <div class="detail-card">
          <div class="kicker">Cleanup inbox</div>
          <div><strong>No post-import cleanup is waiting yet.</strong></div>
          <div class="detail-copy">After an import run, ProofLink will keep unresolved rows, attachment follow-up, and unlinked payment history visible here until the operator clears them.</div>
        </div>
      `;
      return;
    }
    if (!items.length) {
      importCleanupInboxWrap.innerHTML = `
        <div class="detail-card">
          <div class="kicker">Cleanup inbox</div>
          <div><strong>The latest import run does not have any remaining cleanup work.</strong></div>
          <div class="detail-copy">ProofLink finished the last import without leaving unresolved rows, attachment follow-up, or linking leftovers behind.</div>
        </div>
      `;
      return;
    }
    importCleanupInboxWrap.innerHTML = `
      <div class="detail-card">
        <div class="kicker">Cleanup inbox</div>
        <div><strong>${escapeHtml(`${items.length} item${items.length === 1 ? "" : "s"} still need follow-up after the latest import.`)}</strong></div>
        <div class="detail-copy">Use this queue to reopen skipped rows, finish attachment carry-forward, and correct payment or merge leftovers without losing your place.</div>
      </div>
      <div class="memory-checklist u-mt-10">
        ${items.slice(0, 24).map((item) => `
          <div class="memory-checklist__item ${item.tone === "warn" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
            <div class="detail-card__header">
              <div>
                <div class="kicker">${escapeHtml(item.category || "cleanup")}</div>
                <div class="memory-checklist__title">${escapeHtml(item.title || "Cleanup item")}</div>
              </div>
              <div class="workspace-chip-row">
                ${item.rowNumber ? `<span class="pill">Row ${escapeHtml(String(item.rowNumber))}</span>` : ""}
                ${item.targetTab ? `<span class="pill">${escapeHtml(item.targetTab)}</span>` : ""}
              </div>
            </div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
            ${item.meta ? `<div class="detail-copy memory-checklist__note">${escapeHtml(item.meta)}</div>` : ""}
            <div class="import-review-row__actions u-mt-10">
              ${item.rowNumber ? `<button class="btn btn-ghost btn-sm" type="button" data-import-cleanup-action="open-row" data-import-cleanup-id="${escapeAttr(item.id)}">Open row</button>` : ""}
              ${item.targetTab && item.targetId ? `<button class="btn btn-primary btn-sm" type="button" data-import-cleanup-action="open-target" data-import-cleanup-id="${escapeAttr(item.id)}">${escapeHtml(item.actionLabel || "Open record")}</button>` : ""}
              <button class="btn btn-ghost btn-sm" type="button" data-import-cleanup-action="dismiss" data-import-cleanup-id="${escapeAttr(item.id)}">Dismiss</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderImportWorkspace() {
    const meta = kindMeta();
    const activeProfile = activeImportProfile();
    const activePreset = activeImportPreset();
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
        ${activePreset ? `<div class="detail-copy">${escapeHtml(`Preset: ${activePreset.label}`)}</div>` : ""}
      `;
    }
    if (btnDownloadImportTemplate) btnDownloadImportTemplate.textContent = `Download ${meta.label.toLowerCase()} template`;
    if (importFileLabel) importFileLabel.textContent = IMPORT_STATE.fileName || "Drop a CSV here or choose a file";
    if (btnAnalyzeImport) btnAnalyzeImport.disabled = IMPORT_STATE.importing;
    if (btnClearImport) btnClearImport.disabled = IMPORT_STATE.importing;
    if (btnRunImportAiReview) btnRunImportAiReview.disabled = IMPORT_STATE.importing || !IMPORT_STATE.preview?.rows?.length;
    renderPreview();
    renderWalkthrough();
    renderPresetSummary();
    renderProfileSummary();
    renderAiReview();
    renderReviewQueue();
    renderCleanupInbox();
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
      presetKey: "",
      presetPinned: false,
      rowDecisions: {},
      rowOverrides: {},
      rowSelections: {},
      expandedReviewRow: 0,
      lastSavedProfileKey: "",
      aiReview: null,
      cleanupInbox: [],
      lastImportResults: null,
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
    IMPORT_STATE.presetKey = "";
    IMPORT_STATE.presetPinned = false;
    IMPORT_STATE.rowDecisions = {};
    IMPORT_STATE.rowOverrides = {};
    IMPORT_STATE.rowSelections = {};
    IMPORT_STATE.expandedReviewRow = 0;
    IMPORT_STATE.lastSavedProfileKey = "";
    IMPORT_STATE.aiReview = null;
    IMPORT_STATE.cleanupInbox = [];
    IMPORT_STATE.lastImportResults = null;
    if (importFile) importFile.value = "";
    setImportMessage("");
    setImportAiMessage("");
    renderImportWorkspace();
  }

  function setImportPreset(presetKey = "", options = {}) {
    const nextPreset = compact(presetKey)
      ? (typeof Tools.getImportPresetProfile === "function" ? Tools.getImportPresetProfile(presetKey) : null)
      : null;
    IMPORT_STATE.presetKey = nextPreset?.key || "";
    IMPORT_STATE.presetPinned = !!nextPreset;
    IMPORT_STATE.rowDecisions = {};
    IMPORT_STATE.rowOverrides = {};
    IMPORT_STATE.rowSelections = {};
    IMPORT_STATE.expandedReviewRow = 0;
    IMPORT_STATE.lastSavedProfileKey = "";
    if (IMPORT_STATE.rows.length) {
      IMPORT_STATE.preview = buildPreview();
      IMPORT_STATE.aiReview = null;
      if (!options.silent) {
        setImportAiMessage(
          nextPreset
            ? `Using the ${nextPreset.label} preset for this file.`
            : "Source-system preset cleared. ProofLink is back on auto detection for this file.",
          nextPreset ? "ok" : ""
        );
      }
    }
    renderImportWorkspace();
  }

  function setRowDecision(rowNumber, decision = "") {
    const key = Number(rowNumber || 0);
    if (!key) return;
    const nextDecision = compact(decision).toLowerCase();
    IMPORT_STATE.rowDecisions = {
      ...(IMPORT_STATE.rowDecisions || {}),
      [key]: nextDecision,
    };
    if (!nextDecision) delete IMPORT_STATE.rowDecisions[key];
    IMPORT_STATE.aiReview = null;
    IMPORT_STATE.preview = buildPreview();
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
    const detectedKind = Tools.detectImportKind(parsed.headers, { profiles: allImportDetectionProfiles() });
    if (detectedKind && detectedKind !== kind()) {
      IMPORT_STATE.kind = detectedKind;
      setImportMessage(`ProofLink recognized this file as ${kindMeta(detectedKind).label.toLowerCase()} and switched the import mode for you.`, "ok");
    } else {
      setImportMessage("");
    }
    IMPORT_STATE.fileName = file.name || "import.csv";
    IMPORT_STATE.headers = parsed.headers;
    IMPORT_STATE.rows = parsed.rows;
    IMPORT_STATE.rowDecisions = {};
    IMPORT_STATE.rowOverrides = {};
    IMPORT_STATE.rowSelections = {};
    IMPORT_STATE.expandedReviewRow = 0;
    IMPORT_STATE.lastSavedProfileKey = "";
    IMPORT_STATE.aiReview = null;
    IMPORT_STATE.cleanupInbox = [];
    IMPORT_STATE.lastImportResults = null;
    const pinnedPreset = IMPORT_STATE.presetPinned ? activeImportPreset() : null;
    const matchedProfile = typeof Tools.chooseImportProfile === "function"
      ? Tools.chooseImportProfile(parsed.headers, IMPORT_STATE.kind, profileList())
      : null;
    const matchedPreset = pinnedPreset?.import_kind === IMPORT_STATE.kind
      ? pinnedPreset
      : (typeof Tools.chooseImportPreset === "function"
        ? Tools.chooseImportPreset(parsed.headers, IMPORT_STATE.kind, { fileName: IMPORT_STATE.fileName })
        : null);
    IMPORT_STATE.profileKey = matchedProfile?.key || "";
    IMPORT_STATE.presetKey = matchedPreset?.key || "";
    IMPORT_STATE.presetPinned = !!(pinnedPreset && matchedPreset?.key === pinnedPreset.key);
    IMPORT_STATE.preview = buildPreview();
    const matchMessages = [
      matchedProfile ? `Matched saved import profile: ${matchedProfile.label || matchedProfile.key}.` : "",
      matchedPreset ? `Matched source preset: ${matchedPreset.label || matchedPreset.key}.` : "",
    ].filter(Boolean);
    if (matchMessages.length) {
      setImportAiMessage(matchMessages.join(" "), "ok");
    } else {
      setImportAiMessage("");
    }
    renderImportWorkspace();
    return IMPORT_STATE.preview;
  }

  async function upsertImportedCustomer(record) {
    const explicitCreate = rowSelectionValue(record.rowNumber, "match_customer_id") === MATCH_SELECTION_NEW;
    const existing = explicitCreate
      ? null
      : (record.selectedCustomer || record.existing || customerMatch(record, { rowNumber: record.rowNumber, matches: record.customerMatches }));
    const nowIso = new Date().toISOString();
    const attachmentNotes = attachmentNoteBlock(Array.isArray(record.attachments) ? record.attachments : []);
    const payload = withTenantScope({
      operator_id: opId(),
      name: record.name || existing?.name || record.email || record.phone || "Customer",
      email: record.email || null,
      phone: record.phone || null,
      preferred_contact: record.preferredContact || existing?.preferred_contact || "email",
      notes: mergeNotes(record.mergedNotes || existing?.notes || "", attachmentNotes) || "",
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
    const attachmentNotes = attachmentNoteBlock(row.attachments || []);
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
      notes: mergeNotes(row.note || "", attachmentNotes) || "",
      metadata: {
        imported_via: "csv",
        import_ref: row.sourceRef,
        attachments: attachmentMetadata(row.attachments || []),
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
    const bidPhotos = importedBidPhotos(row.attachments || []);
    const nonPhotoAttachments = (row.attachments || []).filter((attachment) => attachment.kind !== "image");
    const attachmentNotes = attachmentNoteBlock(nonPhotoAttachments);
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
      internal_notes: mergeNotes(mergeNotes(lead.notes, row.note, "Imported work note"), attachmentNotes) || "",
      deposit_percent: row.totalCents > 0 && row.depositRequiredCents > 0 ? Number(((row.depositRequiredCents / row.totalCents) * 100).toFixed(2)) : 0,
      deposit_amount_cents: Math.max(0, Number(row.depositRequiredCents || 0)),
      line_items: baseBidLineItems(row),
      photos: bidPhotos,
      subtotal_cents: Math.max(0, Number(row.totalCents || 0)),
      optional_total_cents: 0,
      total_cents: Math.max(0, Number(row.totalCents || 0)),
      metadata: {
        imported_via: "csv",
        import_ref: row.sourceRef,
        local_draft_id: `imported-${Tools.hashString(row.sourceRef || row.title || nowIso)}`,
        attachments: attachmentMetadata(row.attachments || []),
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
    const attachmentNotes = attachmentNoteBlock(row.attachments || []);
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
      notes: mergeNotes(row.note || order.notes || "", attachmentNotes) || "",
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
    const attachmentNotes = attachmentNoteBlock(row.attachments || []);
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
      notes: mergeNotes(mergeNotes("", row.note || row.summary, "Imported work note"), attachmentNotes) || "",
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
    if (row.selectedOrder?.id) return row.selectedOrder;
    if (rowSelectionValue(row.rowNumber, "match_order_id") === MATCH_SELECTION_CUSTOMER_ONLY) return null;
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
    const matchedCustomer = row.selectedCustomer || customerMatch({ name: row.customerName, email: row.customerEmail, phone: row.customerPhone }, { rowNumber: row.rowNumber, matches: row.customerMatches });
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
    const attachmentNotes = attachmentNoteBlock(row.attachments || []);
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
      note: mergeNotes(row.note || "", attachmentNotes) || null,
      metadata: {
        import_ref: row.sourceRef,
        imported_via: "csv",
        reference: row.reference || null,
        note: row.note || null,
        attachments: attachmentMetadata(row.attachments || []),
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
    const activePreset = activeImportPreset();
    const payload = await requestOperatorFunction("ai-agent-report", {
      method: "POST",
      body: {
        agent_key: "import_migration_assistant",
        import_kind: kind(),
        file_name: IMPORT_STATE.fileName || "",
        headers: IMPORT_STATE.headers,
        sample_rows: buildImportReviewSampleRows(18),
        active_profile: activeProfile ? {
          key: activeProfile.key,
          label: activeProfile.label,
          import_kind: activeProfile.import_kind || activeProfile.importKind,
          field_aliases: activeProfile.field_aliases || activeProfile.fieldAliases || {},
          sample_headers: activeProfile.sample_headers || activeProfile.sampleHeaders || [],
          confidence_score: activeProfile.confidence_score || activeProfile.confidenceScore || 0,
          source_hint: activeProfile.source_hint || activeProfile.sourceHint || "",
          source_system: activeProfile.source_system || activeProfile.sourceSystem || "",
          source_preset: activeProfile.source_preset || activeProfile.sourcePreset || "",
          learning_notes: activeProfile.learning_notes || activeProfile.learningNotes || [],
          correction_fields: activeProfile.correction_fields || activeProfile.correctionFields || [],
          walkthrough_summary: activeProfile.walkthrough_summary || activeProfile.walkthroughSummary || "",
        } : null,
        active_preset: activePreset ? {
          key: activePreset.key,
          label: activePreset.label,
          import_kind: activePreset.import_kind || activePreset.importKind,
          field_aliases: activePreset.field_aliases || activePreset.fieldAliases || {},
          sample_headers: activePreset.sample_headers || activePreset.sampleHeaders || [],
          confidence_score: activePreset.confidence_score || activePreset.confidenceScore || 0,
          source_hint: activePreset.source_hint || activePreset.sourceHint || "",
          source_system: activePreset.source_system || "",
          source_preset: activePreset.source_preset || activePreset.key,
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
    const learningData = buildWalkthroughLearningData();
    const payload = await requestOperatorFunction("manage-import-profiles", {
      method: "POST",
      body: {
        action: "upsert",
        profile: {
          ...suggestion,
          ...learningData,
        },
      },
    });
    IMPORT_STATE.profiles = Array.isArray(payload?.profiles) ? payload.profiles : profileList();
    IMPORT_STATE.profilesLoaded = true;
    IMPORT_STATE.profileKey = payload?.profile?.key || suggestion.key || "";
    IMPORT_STATE.lastSavedProfileKey = IMPORT_STATE.profileKey;
    IMPORT_STATE.preview = buildPreview();
    renderImportWorkspace();
    setImportAiMessage(`Saved ${payload?.profile?.label || "the learned profile"}. Future imports from the same export shape will match faster.`, "ok");
    return payload?.profile || null;
  }

  function pushCleanupItem(collection, item) {
    if (!item?.id) return;
    const list = Array.isArray(collection) ? collection : [];
    const index = list.findIndex((entry) => entry.id === item.id);
    if (index >= 0) list[index] = { ...list[index], ...item };
    else list.push(item);
  }

  function importOutcomeTarget(outcome = {}) {
    if (outcome.payment?.id) return { targetTab: "payments", targetId: outcome.payment.id, actionLabel: "Open payment" };
    if (outcome.job?.id) return { targetTab: "jobs", targetId: outcome.job.id, actionLabel: "Open job" };
    if (outcome.order?.id) return { targetTab: "orders", targetId: outcome.order.id, actionLabel: "Open work" };
    if (outcome.bid?.id) return { targetTab: "bids", targetId: outcome.bid.id, actionLabel: "Open quote" };
    if (outcome.lead?.id) return { targetTab: "leads", targetId: outcome.lead.id, actionLabel: "Open lead" };
    if (outcome.customer?.id) return { targetTab: "customers", targetId: outcome.customer.id, actionLabel: "Open customer" };
    return null;
  }

  function buildAttachmentCleanupItem(row, outcome = {}) {
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    if (!row.attachmentFollowUp || !attachments.length) return null;
    const target = importOutcomeTarget(outcome) || null;
    const imageCount = attachments.filter((attachment) => attachment.kind === "image").length;
    const recordLabel = kind() === "customers"
      ? "customer record"
      : (row.recordType === "bid" ? "quote record" : (row.recordType === "lead" ? "lead record" : (kind() === "payments" ? "payment history" : "work record")));
    return {
      id: `cleanup-attachments-${kind()}-${row.rowNumber}`,
      category: "attachments",
      tone: "warn",
      rowNumber: row.rowNumber,
      title: `Finish attachment carry-forward for row ${row.rowNumber}`,
      detail: imageCount && row.recordType === "bid"
        ? `${imageCount} image attachment(s) were carried into the quote photo record. Review the remaining references so the ${recordLabel} keeps the right proof visible.`
        : `ProofLink preserved ${attachments.length} attachment reference(s) for this ${recordLabel}. Review them and move anything important into the place your team expects.`,
      meta: row.attachmentSummary || "",
      ...(target || {}),
    };
  }

  function buildSkippedRowCleanupItem(row, detail) {
    return {
      id: `cleanup-row-${row.rowNumber}`,
      category: "skipped row",
      tone: "warn",
      rowNumber: row.rowNumber,
      title: `Row ${row.rowNumber} still needs a decision`,
      detail: detail || row.detail || "This row stayed out of the import and can be revisited from the review queue.",
      actionLabel: "Open row",
    };
  }

  function buildPaymentLinkCleanupItem(row, outcome = {}) {
    if (kind() !== "payments" || !outcome.payment?.id || outcome.order?.id) return null;
    return {
      id: `cleanup-payment-link-${row.rowNumber}`,
      category: "payment link",
      tone: "warn",
      rowNumber: row.rowNumber,
      title: `Payment row ${row.rowNumber} is still customer-level`,
      detail: compact(row.orderExternalId)
        ? `ProofLink imported this payment without finding the linked work reference ${row.orderExternalId}. Review the payment and attach it to the right job, order, or invoice when that record is ready.`
        : "ProofLink imported this payment at the customer level. Review it if it should be attached to a specific job, order, or invoice.",
      targetTab: "payments",
      targetId: outcome.payment.id,
      actionLabel: "Open payment",
    };
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
    const cleanupItems = [];

    for (const row of preview.rows) {
      if (row.skipped) {
        results.skipped += 1;
        pushCleanupItem(cleanupItems, buildSkippedRowCleanupItem(row, "The operator skipped this row during import. Reopen it if you want to merge it later."));
        continue;
      }
      if (!row.ready) {
        results.errors += 1;
        rowErrors.push(`Row ${row.rowNumber}: ${row.detail || "Needs review before importing."}`);
        pushCleanupItem(cleanupItems, buildSkippedRowCleanupItem(row, row.detail || "This row still needs review before it can be imported safely."));
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
          pushCleanupItem(cleanupItems, buildAttachmentCleanupItem(row, result));
          continue;
        }

        if (preview.kind === "open_work") {
          const matchedCustomer = row.selectedCustomer || customerMatch({ name: row.customerName, email: row.customerEmail, phone: row.customerPhone }, { rowNumber: row.rowNumber, matches: row.customerMatches });
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
            pushCleanupItem(cleanupItems, buildAttachmentCleanupItem(row, { ...leadResult, customer }));
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
            pushCleanupItem(cleanupItems, buildAttachmentCleanupItem(row, { ...bidResult, customer }));
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
          pushCleanupItem(cleanupItems, buildAttachmentCleanupItem(row, orderResult));
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
          pushCleanupItem(cleanupItems, buildAttachmentCleanupItem(row, paymentResult));
          pushCleanupItem(cleanupItems, buildPaymentLinkCleanupItem(row, paymentResult));
        }
      } catch (err) {
        results.errors += 1;
        rowErrors.push(`Row ${row.rowNumber}: ${err.message || String(err)}`);
        pushCleanupItem(cleanupItems, buildSkippedRowCleanupItem(row, err.message || String(err)));
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
    IMPORT_STATE.cleanupInbox = cleanupItems;
    IMPORT_STATE.lastImportResults = results;
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

  importPresetWrap?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-preset-key]");
    if (!button) return;
    setImportPreset(button.getAttribute("data-import-preset-key") || "");
  });

  importReviewQueueWrap?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-row-action]");
    if (!button) return;
    const rowNumber = Number(button.getAttribute("data-import-row-number") || 0);
    if (!rowNumber) return;
    const action = compact(button.getAttribute("data-import-row-action")).toLowerCase();
    if (action === "skip") {
      setRowDecision(rowNumber, "skip");
      return;
    }
    if (action === "restore") {
      setRowDecision(rowNumber, "");
      return;
    }
    if (action === "open-editor") {
      setExpandedReviewRow(rowNumber);
      return;
    }
    if (action === "close-editor") {
      setExpandedReviewRow(IMPORT_STATE.expandedReviewRow === rowNumber ? 0 : rowNumber);
      return;
    }
    if (action === "reset-edits") {
      clearRowOverrides(rowNumber);
      return;
    }
    if (action === "save-edits") {
      const form = button.closest("[data-import-review-form]");
      if (!form) return;
      setRowOverrides(rowNumber, collectReviewFormValues(form, rowNumber));
      Object.entries(collectReviewSelections(form)).forEach(([fieldKey, value]) => {
        setRowSelection(rowNumber, fieldKey, value);
      });
      setExpandedReviewRow(rowNumber);
    }
  });

  importCleanupInboxWrap?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-cleanup-action]");
    if (!button) return;
    const itemId = button.getAttribute("data-import-cleanup-id") || "";
    const item = (IMPORT_STATE.cleanupInbox || []).find((entry) => entry.id === itemId) || null;
    if (!item) return;
    const action = compact(button.getAttribute("data-import-cleanup-action")).toLowerCase();
    if (action === "dismiss") {
      removeCleanupItem(itemId);
      return;
    }
    if (action === "open-row") {
      setExpandedReviewRow(item.rowNumber || 0);
      return;
    }
    if (action === "open-target") {
      openCleanupTarget(item);
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
    setImportPreset,
    runAiMigrationReview,
    saveSuggestedImportProfile,
    ensureImportProfilesLoaded,
  };

  renderImportWorkspace();
})();
