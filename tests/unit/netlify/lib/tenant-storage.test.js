"use strict";

const path = require("path");

const modulePath = path.resolve(
  process.cwd(),
  "netlify/functions/lib/tenant-storage.js"
);

function loadTenantStorage() {
  delete require.cache[modulePath];
  return require(modulePath);
}

describe("tenant-storage receipt signing", () => {
  const originalSecret = process.env.TENANT_UPLOAD_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.TENANT_UPLOAD_SECRET;
    } else {
      process.env.TENANT_UPLOAD_SECRET = originalSecret;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    delete require.cache[modulePath];
  });

  test("receipt generation uses the deterministic fallback secret in test mode", () => {
    delete process.env.TENANT_UPLOAD_SECRET;
    process.env.NODE_ENV = "test";
    const { makeReceipt } = loadTenantStorage();

    const receipt = makeReceipt({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      objectPath: "tenant-1/uploads/operator-1/file.png",
      expectedBytes: 1024,
      contentType: "image/png",
      slot: "hero",
      folder: "uploads",
    });

    expect(typeof receipt).toBe("string");
    expect(receipt.length).toBeGreaterThan(0);
  });

  test("receipt verification uses the deterministic fallback secret in test mode", () => {
    delete process.env.TENANT_UPLOAD_SECRET;
    process.env.NODE_ENV = "test";
    const { makeReceipt, parseReceipt } = loadTenantStorage();
    const receipt = makeReceipt({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      objectPath: "tenant-1/uploads/operator-1/file.png",
      expectedBytes: 1024,
      contentType: "image/png",
      slot: "hero",
      folder: "uploads",
    });

    const parsed = parseReceipt(receipt);

    expect(parsed.tenantId).toBe("tenant-1");
    expect(parsed.operatorId).toBe("operator-1");
    expect(parsed.expectedBytes).toBe(1024);
  });

  test("receipt generation fails outside test mode when upload secret is missing", () => {
    delete process.env.TENANT_UPLOAD_SECRET;
    process.env.NODE_ENV = "production";
    const { makeReceipt } = loadTenantStorage();

    expect(() =>
      makeReceipt({
        tenantId: "tenant-1",
        operatorId: "operator-1",
        objectPath: "tenant-1/uploads/operator-1/file.png",
        expectedBytes: 1024,
        contentType: "image/png",
        slot: "hero",
        folder: "uploads",
      })
    ).toThrow(/signing secret is not configured/i);
  });

  test("receipt verification fails outside test mode when upload secret is missing", () => {
    process.env.TENANT_UPLOAD_SECRET = "pltest-upload-secret";
    process.env.NODE_ENV = "test";
    const { makeReceipt } = loadTenantStorage();
    const receipt = makeReceipt({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      objectPath: "tenant-1/uploads/operator-1/file.png",
      expectedBytes: 1024,
      contentType: "image/png",
      slot: "hero",
      folder: "uploads",
    });

    delete process.env.TENANT_UPLOAD_SECRET;
    process.env.NODE_ENV = "production";
    const { parseReceipt } = loadTenantStorage();

    expect(() => parseReceipt(receipt)).toThrow(/signing secret is not configured/i);
  });

  test("valid configured secret still signs and verifies receipts", () => {
    process.env.TENANT_UPLOAD_SECRET = "pltest-upload-secret";
    const { makeReceipt, parseReceipt } = loadTenantStorage();

    const receipt = makeReceipt({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      objectPath: "tenant-1/uploads/operator-1/file.png",
      expectedBytes: 1024,
      contentType: "image/png",
      slot: "hero",
      folder: "uploads",
    });

    const parsed = parseReceipt(receipt);

    expect(parsed.tenantId).toBe("tenant-1");
    expect(parsed.operatorId).toBe("operator-1");
    expect(parsed.expectedBytes).toBe(1024);
    expect(parsed.objectPath).toContain("tenant-1/uploads/operator-1");
  });
});
