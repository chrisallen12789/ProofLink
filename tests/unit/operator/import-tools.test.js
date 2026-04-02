"use strict";

const path = require("path");

describe("ProofLink import tools", () => {
  const toolsPath = path.resolve(process.cwd(), "operator/components/import-tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[toolsPath];
  });

  test("resolveFieldAliases merges a saved profile ahead of the built-in aliases", () => {
    const tools = require(toolsPath);

    const aliases = tools.resolveFieldAliases("customers", "name", [
      {
        key: "legacy-crm",
        import_kind: "customers",
        field_aliases: {
          name: ["Account Label"],
        },
      },
    ]);

    expect(aliases[0]).toBe("account_label");
    expect(aliases).toContain("name");
  });

  test("detectImportKind honors saved profile headers when the export is custom", () => {
    const tools = require(toolsPath);
    const profile = {
      key: "legacy-customers",
      import_kind: "customers",
      field_aliases: {
        name: ["Account Label"],
        email: ["Primary Email"],
        phone: ["Main Line"],
      },
      sample_headers: ["Account Label", "Primary Email", "Main Line"],
    };

    const kind = tools.detectImportKind(["Account Label", "Primary Email", "Main Line"], {
      profiles: [profile],
    });

    expect(kind).toBe("customers");
  });

  test("chooseImportProfile picks the strongest saved profile for the current file", () => {
    const tools = require(toolsPath);
    const profiles = [
      {
        key: "legacy-customers",
        label: "Legacy CRM customers",
        import_kind: "customers",
        learned_at: "2026-04-01T10:00:00.000Z",
        field_aliases: {
          name: ["Account Label"],
          email: ["Primary Email"],
          phone: ["Main Line"],
        },
        sample_headers: ["Account Label", "Primary Email", "Main Line"],
      },
      {
        key: "legacy-payments",
        label: "Legacy CRM payments",
        import_kind: "payments",
        learned_at: "2026-04-01T09:00:00.000Z",
        field_aliases: {
          amount: ["Paid Amount"],
          status: ["Payment State"],
        },
        sample_headers: ["Paid Amount", "Payment State"],
      },
    ];

    const matched = tools.chooseImportProfile(
      ["Account Label", "Primary Email", "Main Line", "Notes"],
      "customers",
      profiles
    );

    expect(matched?.key).toBe("legacy-customers");
  });

  test("chooseImportPreset recognizes a QuickBooks payment export", () => {
    const tools = require(toolsPath);

    const matched = tools.chooseImportPreset(
      ["Payment Date", "Customer", "Invoice Number", "Payment Amount", "Payment Method", "Reference"],
      "payments"
    );

    expect(matched?.key).toBe("quickbooks_payments");
    expect(matched?.source_system).toBe("quickbooks");
  });

  test("listImportPresetProfiles exposes source-system presets by lane", () => {
    const tools = require(toolsPath);

    const presets = tools.listImportPresetProfiles("open_work");

    expect(presets.some((preset) => preset.key === "jobber_open_work")).toBe(true);
    expect(presets.some((preset) => preset.key === "housecall_pro_open_work")).toBe(true);
    expect(presets.every((preset) => preset.import_kind === "open_work")).toBe(true);
  });

  test("chooseImportPreset uses the file name as a tie-breaker when source hints are present", () => {
    const tools = require(toolsPath);

    const matched = tools.chooseImportPreset(
      ["Client Name", "Email", "Status", "Job Name", "Service Date", "Total", "Notes"],
      "open_work",
      { fileName: "jobber-open-work.csv" }
    );

    expect(matched?.key).toBe("jobber_open_work");
  });

  test("exposes attachment-aware aliases for migration follow-up", () => {
    const tools = require(toolsPath);

    expect(tools.FIELD_ALIASES.customers.attachment_links).toContain("attachments");
    expect(tools.FIELD_ALIASES.open_work.attachment_links).toContain("photo_links");
    expect(tools.FIELD_ALIASES.payments.attachment_links).toContain("receipt_links");
    expect(tools.templateCsv("customers")).toContain("attachment_links");
  });
});
