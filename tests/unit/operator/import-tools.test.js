const ImportTools = require("../../../operator/components/import-tools.js");

describe("ProofLink import tools", () => {
  test("parseCsv handles quoted commas and duplicate headers", () => {
    const parsed = ImportTools.parseCsv([
      'Name,Email,Email,Notes',
      '"Maple HOA","board@maple.com","alt@maple.com","Needs gate code, key in lockbox"',
    ].join("\n"));

    expect(parsed.headers).toEqual(["name", "email", "email_2", "notes"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Maple HOA");
    expect(parsed.rows[0].notes).toBe("Needs gate code, key in lockbox");
  });

  test("detectImportKind recognizes work and payment templates", () => {
    expect(ImportTools.detectImportKind(["customer_name", "stage", "total_amount", "scheduled_date"])).toBe("open_work");
    expect(ImportTools.detectImportKind(["customer_email", "order_external_id", "amount", "paid_at"])).toBe("payments");
  });

  test("templateCsv returns a usable starter file", () => {
    const csv = ImportTools.templateCsv("customers");
    expect(csv).toContain("external_id,name,email,phone");
    expect(csv).toContain("Maple Street HOA");
  });

  test("money and identity helpers normalize messy values", () => {
    expect(ImportTools.toCents("$1,450.25")).toBe(145025);
    expect(ImportTools.normalizeEmail("  HELLO@EXAMPLE.COM ")).toBe("hello@example.com");
    expect(ImportTools.normalizePhoneDigits("+1 (555) 010-1010")).toBe("5550101010");
    expect(ImportTools.parseTagList("hoa, priority; repeat")).toEqual(["hoa", "priority", "repeat"]);
  });
});
