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
      accounting_invoice_number: ["accounting_invoice_number", "invoice_number", "invoice_no", "invoice_num", "doc_number", "quickbooks_invoice_number", "qb_invoice_number", "quickbooks_doc_number"],
      amount_paid: ["amount_paid", "paid_amount", "collected_amount"],
      deposit_required: ["deposit_required", "deposit_amount", "required_deposit"],
      payment_due_date: ["payment_due_date", "due_date", "invoice_due_date"],
      note: ["note", "notes", "internal_notes", "status_note"],
    },
    payments: {
      external_id: ["external_id", "payment_external_id", "payment_id", "id"],
      customer_external_id: ["customer_external_id", "customer_id", "client_id"],
      customer_name: ["customer_name", "name", "client_name"],
      customer_email: ["customer_email", "email", "email_address"],
      customer_phone: ["customer_phone", "phone", "mobile"],
      order_external_id: ["order_external_id", "work_external_id", "job_external_id", "quote_external_id", "order_id"],
      accounting_invoice_number: ["accounting_invoice_number", "invoice_number", "invoice_no", "invoice_num", "doc_number", "quickbooks_invoice_number", "qb_invoice_number", "quickbooks_doc_number"],
      amount: ["amount", "amount_paid", "payment_amount", "total"],
      status: ["status", "payment_status"],
      method: ["method", "payment_method", "mode"],
      paid_at: ["paid_at", "received_at", "payment_date", "date"],
      reference: ["reference", "reference_number", "check_number", "confirmation"],
      note: ["note", "notes", "memo"],
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
        accounting_invoice_number: "QB-1450",
        amount_paid: "0.00",
        deposit_required: "300.00",
        payment_due_date: "2026-04-05",
        note: "Imported from prior quoting sheet.",
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
        accounting_invoice_number: "QB-1450",
        amount: "300.00",
        status: "paid",
        method: "check",
        paid_at: "2026-03-21 14:30",
        reference: "CHK-1048",
        note: "Deposit received before scheduling.",
      },
    ],
  };

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
  };
});
