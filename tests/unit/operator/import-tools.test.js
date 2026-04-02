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
});
