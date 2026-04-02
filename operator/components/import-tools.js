(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ProofLinkImportTools = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const IMPORT_KIND_META = {
    customers: {
      key: "customers",
      label: "Customers",
      noun: "customer",
      summary: "Bring over CRM contacts, notes, addresses, and tags without rebuilding the customer list by hand.",
    },
    open_work: {
      key: "open_work",
      label: "Open Work",
      noun: "work row",
      summary: "Bring over live leads, quotes, booked jobs, and unpaid work so the operator starts with a real pipeline.",
    },
    payments: {
      key: "payments",
      label: "Payments",
      noun: "payment",
      summary: "Bring over received payments or open payment history so ProofLink starts with money context, not guesswork.",
    },
  };

  const FIELD_ALIASES = {
    customers: {
      external_id: ["external_id", "customer_external_id", "crm_id", "legacy_id", "id"],
      name: ["name", "customer_name", "full_name", "company", "client_name"],
      email: ["email", "customer_email", "email_address"],
      phone: ["phone", "customer_phone", "mobile", "mobile_phone", "cell", "telephone"],
      preferred_contact: ["preferred_contact", "preferred", "contact_preference"],
      service_address: ["service_address", "service_location", "job_address", "address", "property_address"],
      billing_address: ["billing_address", "invoice_address", "mailing_address"],
      tags: ["tags", "labels", "customer_tags"],
      notes: ["notes", "internal_notes", "memo", "customer_notes"],
      attachment_links: ["attachment_links", "attachments", "attachment_urls", "file_links", "document_links", "photo_links", "proof_links"],
    },
    open_work: {
      external_id: ["external_id", "work_external_id", "job_external_id", "quote_external_id", "record_id", "id"],
      customer_external_id: ["customer_external_id", "customer_id", "client_id"],
      customer_name: ["customer_name", "name", "client_name", "company"],
      customer_email: ["customer_email", "email", "email_address"],
      customer_phone: ["customer_phone", "phone", "mobile", "telephone"],
      stage: ["stage", "workflow_stage", "record_stage", "status"],
      title: ["title", "job_name", "quote_name", "subject", "service_name"],
      requested_service_type: ["requested_service_type", "service_type", "service", "category"],
      summary: ["summary", "scope", "description", "details"],
      service_address: ["service_address", "job_address", "address", "property_address"],
      scheduled_date: ["scheduled_date", "job_date", "service_date", "date"],
      schedule_window: ["schedule_window", "time_window", "scheduled_time", "time"],
      total_amount: ["total_amount", "total", "quoted_amount", "job_amount", "invoice_total"],
      amount_paid: ["amount_paid", "paid_amount", "collected_amount"],
      deposit_required: ["deposit_required", "deposit_amount", "required_deposit"],
      payment_due_date: ["payment_due_date", "due_date", "invoice_due_date"],
      note: ["note", "notes", "internal_notes", "status_note"],
      attachment_links: ["attachment_links", "attachments", "attachment_urls", "file_links", "document_links", "photo_links", "proof_links", "media_links"],
    },
    payments: {
      external_id: ["external_id", "payment_external_id", "payment_id", "id"],
      customer_external_id: ["customer_external_id", "customer_id", "client_id"],
      customer_name: ["customer_name", "name", "client_name"],
      customer_email: ["customer_email", "email", "email_address"],
      customer_phone: ["customer_phone", "phone", "mobile"],
      order_external_id: ["order_external_id", "work_external_id", "job_external_id", "quote_external_id", "order_id"],
      amount: ["amount", "amount_paid", "payment_amount", "total"],
      status: ["status", "payment_status"],
      method: ["method", "payment_method", "mode"],
      paid_at: ["paid_at", "received_at", "payment_date", "date"],
      reference: ["reference", "reference_number", "check_number", "confirmation"],
      note: ["note", "notes", "memo"],
      attachment_links: ["attachment_links", "attachments", "attachment_urls", "receipt_links", "document_links", "proof_links", "file_links"],
    },
  };

  const TEMPLATE_ROWS = {
    customers: [
      {
        external_id: "cust-1001",
        name: "Maple Street HOA",
        email: "board@maplestreethoa.com",
        phone: "555-0101",
        preferred_contact: "email",
        service_address: "808 Wash Way, Detroit, MI",
        billing_address: "PO Box 1808, Detroit, MI",
        tags: "hoa,priority",
        notes: "Front entry must stay clear after 3pm.",
        attachment_links: "https://legacy.example.com/customers/maple-street/site-map.pdf",
      },
    ],
    open_work: [
      {
        external_id: "work-2001",
        customer_external_id: "cust-1001",
        customer_name: "Maple Street HOA",
        customer_email: "board@maplestreethoa.com",
        customer_phone: "555-0101",
        stage: "quoted",
        title: "Front walk pressure wash proposal",
        requested_service_type: "Pressure washing",
        summary: "Front walk, entry, and curb approach need stain removal before board inspection.",
        service_address: "808 Wash Way, Detroit, MI",
        scheduled_date: "2026-03-28",
        schedule_window: "Morning",
        total_amount: "1450.00",
        amount_paid: "0.00",
        deposit_required: "300.00",
        payment_due_date: "2026-04-05",
        note: "Imported from prior quoting sheet.",
        attachment_links: "https://legacy.example.com/work/work-2001/entry-photo.jpg; https://legacy.example.com/work/work-2001/scope.pdf",
      },
    ],
    payments: [
      {
        external_id: "pay-3001",
        customer_external_id: "cust-1001",
        customer_name: "Maple Street HOA",
        customer_email: "board@maplestreethoa.com",
        customer_phone: "555-0101",
        order_external_id: "work-2001",
        amount: "300.00",
        status: "paid",
        method: "check",
        paid_at: "2026-03-21 14:30",
        reference: "CHK-1048",
        note: "Deposit received before scheduling.",
        attachment_links: "https://legacy.example.com/payments/pay-3001/check-image.jpg",
      },
    ],
  };

  const IMPORT_SOURCE_PRESETS = [
    {
      key: "quickbooks_customers",
      label: "QuickBooks customers",
      import_kind: "customers",
      source_system: "quickbooks",
      system_label: "QuickBooks",
      description: "Customer and accounting contact exports from QuickBooks.",
      source_hint: "Matched QuickBooks-style customer columns from the legacy export.",
      field_aliases: {
        external_id: ["list_id", "customer_id", "customer_number", "customer_no"],
        name: ["customer", "customer_name", "display_name", "company_name", "company"],
        email: ["email", "email_address", "primary_email"],
        phone: ["phone", "main_phone", "customer_phone", "mobile"],
        service_address: ["ship_address", "service_address", "job_address", "service_location"],
        billing_address: ["billing_address", "bill_to_address", "bill_address", "mailing_address"],
        notes: ["memo", "notes", "customer_notes"],
      },
      sample_headers: ["customer", "email", "phone", "billing_address", "ship_address", "memo"],
    },
    {
      key: "quickbooks_open_work",
      label: "QuickBooks invoice / work",
      import_kind: "open_work",
      source_system: "quickbooks",
      system_label: "QuickBooks",
      description: "Invoice-style open work exports from QuickBooks.",
      source_hint: "Matched QuickBooks invoice columns that can be routed into open work.",
      field_aliases: {
        external_id: ["doc_number", "invoice_number", "invoice_no", "txn_number"],
        customer_name: ["customer", "customer_name", "display_name"],
        customer_email: ["email", "email_address"],
        customer_phone: ["phone", "customer_phone"],
        stage: ["status", "invoice_status", "payment_status"],
        title: ["product_service", "service_item", "memo", "job_name"],
        requested_service_type: ["service_type", "product_service", "item"],
        summary: ["description", "memo", "message_on_invoice", "notes"],
        service_address: ["ship_address", "service_address", "job_address"],
        scheduled_date: ["txn_date", "service_date", "job_date"],
        total_amount: ["invoice_total", "total", "amount", "balance"],
        amount_paid: ["amount_paid", "paid_amount", "amount_received", "payment"],
        payment_due_date: ["due_date"],
        note: ["memo", "notes", "message_on_invoice"],
      },
      sample_headers: ["doc_number", "customer", "txn_date", "due_date", "invoice_total", "memo"],
    },
    {
      key: "quickbooks_payments",
      label: "QuickBooks payments",
      import_kind: "payments",
      source_system: "quickbooks",
      system_label: "QuickBooks",
      description: "Payment or receive-payment exports from QuickBooks.",
      source_hint: "Matched QuickBooks payment columns including invoice references.",
      field_aliases: {
        external_id: ["payment_id", "txn_number", "payment_number"],
        customer_name: ["customer", "customer_name", "display_name"],
        customer_email: ["email", "email_address"],
        customer_phone: ["phone", "customer_phone"],
        order_external_id: ["invoice_number", "doc_number", "invoice_no", "linked_txn", "applied_to"],
        amount: ["payment_amount", "amount_received", "amount"],
        status: ["status", "payment_status"],
        method: ["payment_method", "method", "payment_type"],
        paid_at: ["payment_date", "txn_date", "received_at"],
        reference: ["reference", "reference_number", "check_number", "ref_number"],
        note: ["memo", "notes"],
      },
      sample_headers: ["payment_date", "customer", "invoice_number", "payment_amount", "payment_method", "reference"],
    },
    {
      key: "jobber_customers",
      label: "Jobber customers",
      import_kind: "customers",
      source_system: "jobber",
      system_label: "Jobber",
      description: "Client exports from Jobber.",
      source_hint: "Matched Jobber client export columns.",
      field_aliases: {
        external_id: ["client_id", "customer_id", "id"],
        name: ["client_name", "client", "company_name"],
        email: ["client_email", "email"],
        phone: ["phone", "phone_number", "mobile"],
        preferred_contact: ["preferred_contact", "contact_method"],
        service_address: ["property_address", "service_address", "address"],
        billing_address: ["billing_address", "invoice_address"],
        tags: ["labels", "tags"],
        notes: ["client_notes", "notes"],
      },
      sample_headers: ["client_name", "client_email", "phone", "property_address", "client_notes"],
    },
    {
      key: "jobber_open_work",
      label: "Jobber requests / quotes / jobs",
      import_kind: "open_work",
      source_system: "jobber",
      system_label: "Jobber",
      description: "Pipeline and scheduled work exports from Jobber.",
      source_hint: "Matched Jobber request, quote, or job columns.",
      field_aliases: {
        external_id: ["job_number", "quote_number", "request_number", "work_id", "id"],
        customer_external_id: ["client_id", "customer_id"],
        customer_name: ["client_name", "client", "company_name"],
        customer_email: ["client_email", "email"],
        customer_phone: ["phone", "phone_number"],
        stage: ["status", "request_status", "quote_status", "job_status"],
        title: ["job_title", "quote_title", "request_title", "subject"],
        requested_service_type: ["service_type", "service", "line_of_business"],
        summary: ["description", "request_details", "notes"],
        service_address: ["property_address", "service_address", "address"],
        scheduled_date: ["scheduled_for", "service_date", "quote_date"],
        schedule_window: ["scheduled_window", "visit_time", "time_window"],
        total_amount: ["quote_total", "job_total", "invoice_total", "total"],
        amount_paid: ["amount_paid", "paid"],
        deposit_required: ["deposit", "required_deposit"],
        payment_due_date: ["invoice_due_date", "due_date"],
        note: ["internal_notes", "notes"],
      },
      sample_headers: ["client_name", "status", "job_title", "scheduled_for", "quote_total", "internal_notes"],
    },
    {
      key: "jobber_payments",
      label: "Jobber payments",
      import_kind: "payments",
      source_system: "jobber",
      system_label: "Jobber",
      description: "Payment exports from Jobber.",
      source_hint: "Matched Jobber payment history columns.",
      field_aliases: {
        external_id: ["payment_id", "id"],
        customer_external_id: ["client_id", "customer_id"],
        customer_name: ["client_name", "client"],
        customer_email: ["client_email", "email"],
        customer_phone: ["phone", "phone_number"],
        order_external_id: ["job_number", "quote_number", "invoice_number"],
        amount: ["payment_amount", "amount_received", "amount"],
        status: ["status", "payment_status"],
        method: ["method", "payment_method"],
        paid_at: ["paid_on", "payment_date", "date"],
        reference: ["reference", "reference_number", "check_number"],
        note: ["notes", "memo"],
      },
      sample_headers: ["client_name", "invoice_number", "payment_amount", "method", "paid_on"],
    },
    {
      key: "housecall_pro_customers",
      label: "Housecall Pro customers",
      import_kind: "customers",
      source_system: "housecall_pro",
      system_label: "Housecall Pro",
      description: "Customer exports from Housecall Pro.",
      source_hint: "Matched Housecall Pro customer export columns.",
      field_aliases: {
        external_id: ["customer_id", "client_id", "id"],
        name: ["customer_name", "customer", "client_name"],
        email: ["customer_email", "email"],
        phone: ["phone", "mobile_number", "customer_phone"],
        preferred_contact: ["preferred_contact", "contact_method"],
        service_address: ["service_address", "address", "property_address"],
        billing_address: ["billing_address", "mailing_address"],
        tags: ["tags", "labels"],
        notes: ["notes", "customer_notes"],
      },
      sample_headers: ["customer_name", "customer_email", "phone", "service_address", "customer_notes"],
    },
    {
      key: "housecall_pro_open_work",
      label: "Housecall Pro jobs / estimates",
      import_kind: "open_work",
      source_system: "housecall_pro",
      system_label: "Housecall Pro",
      description: "Work-in-flight exports from Housecall Pro.",
      source_hint: "Matched Housecall Pro job or estimate columns.",
      field_aliases: {
        external_id: ["job_id", "work_order_id", "estimate_id", "invoice_number"],
        customer_external_id: ["customer_id", "client_id"],
        customer_name: ["customer_name", "customer", "client_name"],
        customer_email: ["customer_email", "email"],
        customer_phone: ["phone", "mobile_number"],
        stage: ["status", "job_status", "estimate_status"],
        title: ["job_name", "estimate_name", "work_type"],
        requested_service_type: ["service_type", "job_type", "trade"],
        summary: ["description", "job_notes", "notes"],
        service_address: ["service_address", "address", "property_address"],
        scheduled_date: ["scheduled_start", "scheduled_date", "appointment_date"],
        schedule_window: ["arrival_window", "scheduled_window", "time_window"],
        total_amount: ["total", "invoice_total", "estimate_total"],
        amount_paid: ["paid", "amount_paid"],
        deposit_required: ["deposit", "required_deposit"],
        payment_due_date: ["payment_due_date", "due_date"],
        note: ["job_notes", "notes", "internal_notes"],
      },
      sample_headers: ["customer_name", "status", "job_name", "scheduled_start", "total", "job_notes"],
    },
    {
      key: "housecall_pro_payments",
      label: "Housecall Pro payments",
      import_kind: "payments",
      source_system: "housecall_pro",
      system_label: "Housecall Pro",
      description: "Payment history exports from Housecall Pro.",
      source_hint: "Matched Housecall Pro payment export columns.",
      field_aliases: {
        external_id: ["payment_id", "id"],
        customer_external_id: ["customer_id", "client_id"],
        customer_name: ["customer_name", "customer"],
        customer_email: ["customer_email", "email"],
        customer_phone: ["phone", "mobile_number"],
        order_external_id: ["invoice_number", "job_id", "estimate_id"],
        amount: ["amount", "payment_amount", "amount_received"],
        status: ["status", "payment_status"],
        method: ["method", "payment_method"],
        paid_at: ["payment_date", "received_at", "date"],
        reference: ["reference", "transaction_id", "confirmation_number"],
        note: ["notes", "memo"],
      },
      sample_headers: ["customer_name", "invoice_number", "payment_amount", "payment_method", "payment_date"],
    },
    {
      key: "servicetitan_open_work",
      label: "ServiceTitan jobs / invoices",
      import_kind: "open_work",
      source_system: "servicetitan",
      system_label: "ServiceTitan",
      description: "Scheduled work or invoice exports from ServiceTitan.",
      source_hint: "Matched ServiceTitan job or invoice columns.",
      field_aliases: {
        external_id: ["job_number", "invoice_number", "work_order_number"],
        customer_external_id: ["customer_id"],
        customer_name: ["customer_name", "customer"],
        customer_email: ["email", "customer_email"],
        customer_phone: ["phone", "customer_phone"],
        stage: ["status", "job_status", "invoice_status"],
        title: ["job_type", "service_type", "summary"],
        requested_service_type: ["job_type", "service_type"],
        summary: ["summary", "description", "notes"],
        service_address: ["service_address", "job_address", "address"],
        scheduled_date: ["scheduled_date", "appointment_date", "job_date"],
        schedule_window: ["arrival_window", "time_window"],
        total_amount: ["invoice_total", "total", "job_total"],
        amount_paid: ["amount_paid", "paid"],
        payment_due_date: ["due_date"],
        note: ["notes", "internal_notes"],
      },
      sample_headers: ["customer_name", "status", "job_type", "scheduled_date", "invoice_total", "notes"],
    },
    {
      key: "servicetitan_payments",
      label: "ServiceTitan payments",
      import_kind: "payments",
      source_system: "servicetitan",
      system_label: "ServiceTitan",
      description: "Payment history exports from ServiceTitan.",
      source_hint: "Matched ServiceTitan payment export columns.",
      field_aliases: {
        external_id: ["payment_id", "transaction_id"],
        customer_external_id: ["customer_id"],
        customer_name: ["customer_name", "customer"],
        customer_email: ["email", "customer_email"],
        customer_phone: ["phone", "customer_phone"],
        order_external_id: ["invoice_number", "job_number", "work_order_number"],
        amount: ["amount", "payment_amount", "amount_received"],
        status: ["status", "payment_status"],
        method: ["payment_method", "method"],
        paid_at: ["payment_date", "received_at"],
        reference: ["reference_number", "transaction_id", "check_number"],
        note: ["notes", "memo"],
      },
      sample_headers: ["customer_name", "invoice_number", "payment_amount", "payment_method", "payment_date"],
    },
  ];

  function normalizeImportKind(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["customers", "customer", "crm", "contacts"].includes(raw)) return "customers";
    if (["open_work", "work", "jobs", "orders", "pipeline", "quotes"].includes(raw)) return "open_work";
    if (["payments", "payment", "money"].includes(raw)) return "payments";
    return "customers";
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizePhoneDigits(value) {
    const digits = String(value || "").replace(/\D+/g, "");
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    return digits;
  }

  function parseTagList(value) {
    return Array.from(new Set(
      String(value || "")
        .split(/[,;\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    ));
  }

  function uniqueNormalizedHeaders(values, maxItems = 40) {
    const list = Array.isArray(values) ? values : [values];
    return Array.from(new Set(
      list
        .map((value) => normalizeHeader(value))
        .filter(Boolean)
    )).slice(0, maxItems);
  }

  function toCents(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const cleaned = raw.replace(/[$,\s]/g, "");
    const negative = cleaned.startsWith("(") && cleaned.endsWith(")");
    const numeric = negative ? cleaned.slice(1, -1) : cleaned;
    const amount = Number(numeric);
    if (!Number.isFinite(amount)) return 0;
    return Math.round((negative ? -amount : amount) * 100);
  }

  function hashString(value) {
    const input = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function parseCsv(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (inQuotes) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (char === "\r") {
        if (next === "\n") continue;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }

    const nonEmpty = rows.filter((entries) => entries.some((entry) => String(entry || "").trim() !== ""));
    if (!nonEmpty.length) return { headers: [], rows: [] };

    const rawHeaders = nonEmpty[0];
    const seen = new Map();
    const headers = rawHeaders.map((header, index) => {
      const normalized = normalizeHeader(header) || `column_${index + 1}`;
      const count = seen.get(normalized) || 0;
      seen.set(normalized, count + 1);
      return count ? `${normalized}_${count + 1}` : normalized;
    });

    const dataRows = nonEmpty.slice(1).map((entries) => {
      const rowObject = {};
      headers.forEach((header, index) => {
        rowObject[header] = String(entries[index] ?? "").trim();
      });
      return rowObject;
    });

    return { headers, rows: dataRows };
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function templateCsv(kind) {
    const normalizedKind = normalizeImportKind(kind);
    const rows = TEMPLATE_ROWS[normalizedKind] || [];
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(",")),
    ].join("\n");
  }

  function getValue(row, aliases) {
    if (!row || !aliases) return "";
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const alias of list) {
      const key = normalizeHeader(alias);
      if (Object.prototype.hasOwnProperty.call(row, key)) return String(row[key] || "").trim();
    }
    return "";
  }

  function mergeFieldAliases(kind, profiles = []) {
    const normalizedKind = normalizeImportKind(kind);
    const baseFieldMap = FIELD_ALIASES[normalizedKind] || {};
    const profileList = Array.isArray(profiles) ? profiles : [profiles];
    const merged = {};

    Object.keys(baseFieldMap).forEach((fieldKey) => {
      const profileAliases = [];
      profileList.forEach((profile) => {
        const profileKind = normalizeImportKind(profile?.import_kind || profile?.importKind || normalizedKind);
        if (profileKind !== normalizedKind) return;
        const fieldAliases = profile?.field_aliases?.[fieldKey] || profile?.fieldAliases?.[fieldKey] || [];
        uniqueNormalizedHeaders(fieldAliases, 20).forEach((alias) => profileAliases.push(alias));
      });
      merged[fieldKey] = Array.from(new Set([
        ...profileAliases,
        ...baseFieldMap[fieldKey].map((alias) => normalizeHeader(alias)).filter(Boolean),
      ]));
    });

    return merged;
  }

  function resolveFieldAliases(kind, fieldKey, profiles = []) {
    const merged = mergeFieldAliases(kind, profiles);
    return merged[fieldKey] || [];
  }

  function scoreImportProfile(headers, profile) {
    if (!profile) {
      return {
        score: 0,
        matched_fields: 0,
        total_fields: 0,
        alias_hits: 0,
        sample_hits: 0,
        sample_total: 0,
      };
    }

    const normalizedHeaders = uniqueNormalizedHeaders(headers, 80);
    const headerSet = new Set(normalizedHeaders);
    const fieldAliases = profile?.field_aliases || profile?.fieldAliases || {};
    const sampleHeaders = uniqueNormalizedHeaders(profile?.sample_headers || profile?.sampleHeaders || [], 80);

    let matchedFields = 0;
    let totalFields = 0;
    let aliasHits = 0;

    Object.values(fieldAliases).forEach((aliases) => {
      const normalizedAliases = uniqueNormalizedHeaders(aliases, 20);
      if (!normalizedAliases.length) return;
      totalFields += 1;
      const hits = normalizedAliases.filter((alias) => headerSet.has(alias));
      if (hits.length) {
        matchedFields += 1;
        aliasHits += hits.length;
      }
    });

    const sampleHits = sampleHeaders.filter((header) => headerSet.has(header)).length;
    const aliasScore = totalFields ? matchedFields / totalFields : 0;
    const sampleScore = sampleHeaders.length ? sampleHits / sampleHeaders.length : 0;

    return {
      score: Number(Math.min(1, (aliasScore * 0.8) + (sampleScore * 0.2)).toFixed(2)),
      matched_fields: matchedFields,
      total_fields: totalFields,
      alias_hits: aliasHits,
      sample_hits: sampleHits,
      sample_total: sampleHeaders.length,
    };
  }

  function chooseImportProfile(headers, importKind, profiles = []) {
    const normalizedKind = normalizeImportKind(importKind);
    const profileList = Array.isArray(profiles) ? profiles : [profiles];

    const ranked = profileList
      .filter((profile) => normalizeImportKind(profile?.import_kind || profile?.importKind || normalizedKind) === normalizedKind)
      .map((profile) => ({
        profile,
        score: scoreImportProfile(headers, profile),
      }))
      .filter((item) =>
        item.score.score >= 0.35
        && (item.score.matched_fields >= 2 || item.score.sample_hits >= 3)
      )
      .sort((a, b) => {
        if (b.score.score !== a.score.score) return b.score.score - a.score.score;
        if (b.score.matched_fields !== a.score.matched_fields) return b.score.matched_fields - a.score.matched_fields;
        return String(b.profile?.learned_at || "").localeCompare(String(a.profile?.learned_at || ""));
      });

    return ranked[0]?.profile || null;
  }

  function listImportPresetProfiles(importKind = "") {
    const normalizedKind = importKind ? normalizeImportKind(importKind) : "";
    return IMPORT_SOURCE_PRESETS
      .filter((preset) => !normalizedKind || normalizeImportKind(preset.import_kind) === normalizedKind)
      .map((preset) => ({
        key: preset.key,
        label: preset.label,
        import_kind: normalizeImportKind(preset.import_kind),
        field_aliases: preset.field_aliases,
        sample_headers: preset.sample_headers,
        source_hint: preset.source_hint,
        confidence_score: Number(preset.confidence_score || 0.82),
        source_system: preset.source_system,
        source_preset: preset.key,
        system_label: preset.system_label,
        description: preset.description,
        is_preset: true,
      }));
  }

  function getImportPresetProfile(key) {
    const presetKey = normalizeHeader(key);
    return listImportPresetProfiles().find((preset) => normalizeHeader(preset.key) === presetKey) || null;
  }

  function presetSourceHintScore(profile, options = {}) {
    const sourceHint = normalizeHeader(options.file_name || options.fileName || options.source_hint || options.sourceHint || "");
    if (!sourceHint || !profile) return 0;
    const candidates = [
      profile.source_system,
      profile.system_label,
      profile.key,
      profile.label,
    ]
      .map((value) => normalizeHeader(value))
      .filter(Boolean);
    return candidates.some((value) => sourceHint.includes(value)) ? 1 : 0;
  }

  function chooseImportPreset(headers, importKind, options = {}) {
    const presets = listImportPresetProfiles(importKind);
    const ranked = presets
      .map((profile) => ({
        profile,
        score: scoreImportProfile(headers, profile),
        sourceHintScore: presetSourceHintScore(profile, options),
      }))
      .filter((item) =>
        item.score.score >= 0.35
        && (item.score.matched_fields >= 2 || item.score.sample_hits >= 3)
      )
      .sort((a, b) => {
        if (b.sourceHintScore !== a.sourceHintScore) return b.sourceHintScore - a.sourceHintScore;
        if (b.score.score !== a.score.score) return b.score.score - a.score.score;
        if (b.score.matched_fields !== a.score.matched_fields) return b.score.matched_fields - a.score.matched_fields;
        return String(a.profile?.label || "").localeCompare(String(b.profile?.label || ""));
      });

    return ranked[0]?.profile || null;
  }

  function detectImportKind(headers, options = {}) {
    const profiles = Array.isArray(options?.profiles) ? options.profiles : [];
    const normalizedHeaders = uniqueNormalizedHeaders(headers, 80);
    let bestKind = null;
    let bestScore = 0;

    Object.entries(FIELD_ALIASES).forEach(([kind, fieldMap]) => {
      const mergedFieldMap = mergeFieldAliases(kind, profiles);
      let score = 0;
      Object.keys(fieldMap).forEach((fieldKey) => {
        const aliases = mergedFieldMap[fieldKey] || [];
        if (aliases.some((alias) => normalizedHeaders.includes(normalizeHeader(alias)))) score += 1;
      });
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
      }
    });

    return bestScore >= 2 ? bestKind : null;
  }

  return {
    IMPORT_KIND_META,
    FIELD_ALIASES,
    TEMPLATE_ROWS,
    IMPORT_SOURCE_PRESETS,
    normalizeImportKind,
    normalizeHeader,
    normalizeEmail,
    normalizePhoneDigits,
    parseTagList,
    toCents,
    hashString,
    parseCsv,
    templateCsv,
    getValue,
    detectImportKind,
    mergeFieldAliases,
    resolveFieldAliases,
    scoreImportProfile,
    chooseImportProfile,
    listImportPresetProfiles,
    getImportPresetProfile,
    chooseImportPreset,
  };
});
