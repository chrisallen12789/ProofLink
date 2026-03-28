"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadCoreUtils(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-core-utils.js"),
    "utf8"
  );

  const context = {
    console,
    window: {},
    document: {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => ({
        style: {},
        textContent: "",
        remove: vi.fn(),
        click: vi.fn(),
      })),
    },
    navigator: {},
    Blob: function Blob(parts, options) {
      this.parts = parts;
      this.options = options;
    },
    URL: {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    },
    setTimeout,
    clearTimeout,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator core utils", () => {
  test("requestOrderReview sends the shared review request and updates cache state", async () => {
    const button = { textContent: "Request review", disabled: false };
    const setStatus = vi.fn();
    const onSuccess = vi.fn();
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, review_requested_at: "2026-03-28T14:15:00.000Z" }),
    }));
    const context = loadCoreUtils({
      window: {
        fetch,
        getAccessToken: vi.fn(async () => "token_123"),
        CRM_ORDERS_CACHE: [
          { id: "order_1", review_requested_at: null },
          { id: "order_2", review_requested_at: null },
        ],
      },
    });

    const result = await context.window.PROOFLINK_OPERATOR_UTILS.requestOrderReview("order_1", {
      button,
      setStatus,
      onSuccess,
    });

    expect(fetch).toHaveBeenCalledWith("/.netlify/functions/request-review", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ order_id: "order_1" }),
    }));
    expect(button.textContent).toBe("Review requested");
    expect(button.disabled).toBe(true);
    expect(setStatus).toHaveBeenNthCalledWith(1, "Requesting review...");
    expect(setStatus).toHaveBeenNthCalledWith(2, "Review request sent.", "ok");
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, review_requested_at: "2026-03-28T14:15:00.000Z" }),
      "2026-03-28T14:15:00.000Z"
    );
    expect(result.review_requested_at).toBe("2026-03-28T14:15:00.000Z");
    expect(context.window.CRM_ORDERS_CACHE.find((row) => row.id === "order_1").review_requested_at).toBe("2026-03-28T14:15:00.000Z");
  });
});
