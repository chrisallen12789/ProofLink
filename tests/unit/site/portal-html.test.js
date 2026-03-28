"use strict";

const fs = require("fs");
const path = require("path");

describe("customer portal html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "portal.html"),
    "utf8"
  );

  test("uses clearer customer-account guidance", () => {
    expect(source).toContain("<title>Customer account</title>");
    expect(source).toContain("Use the email you book with");
    expect(source).toContain("See my account");
    expect(source).toContain("Message us");
    expect(source).toContain("Schedule another appointment");
    expect(source).toContain("Use another email");
  });

  test("only shows a review link when the portal receives a real estimate review URL", () => {
    expect(source).toContain("var reviewUrl = q.review_url || '';");
    expect(source).toContain("Review estimate");
    expect(source).not.toContain('href="/quote.html?token=');
  });

  test("uses delegated payment buttons and checkout return guidance", () => {
    expect(source).toContain('data-action="pay-now"');
    expect(source).not.toContain('onclick="handlePayNow(');
    expect(source).toContain("portalPaymentGuidance(order, dueCents, paidCents)");
    expect(source).toContain("Paid in full. You are all set on this order.");
    expect(source).toContain("A balance is still open.");
    expect(source).toContain("checkoutState === 'success'");
    expect(source).toContain("checkoutState === 'cancel'");
    expect(source).toContain("Your payment for ");
    expect(source).toContain("No payment was made for ");
    expect(source).toContain('data-order-id="');
    expect(source).toContain("order-row--highlight");
    expect(source).toContain("focusPortalOrder(checkoutOrderId)");
    expect(source).toContain("if (tenantId && prefill && checkoutState)");
  });

  test("uses shared portal classes instead of inline return layouts", () => {
    expect(source).toContain('class="btn btn-ghost portal-back-btn"');
    expect(source).toContain('class="package-balance-panel"');
    expect(source).toContain('class="order-row order-row--top"');
    expect(source).toContain('class="order-row stacked-row stacked-row--tight"');
    expect(source).toContain('class="review-estimate-link"');
    expect(source).not.toContain('style="margin-top:12px;"');
    expect(source).not.toContain('style="flex-wrap:wrap;align-items:flex-start;"');
    expect(source).not.toContain('style="gap:6px;"');
    expect(source).not.toContain('style="font-size:.82rem;color:#c84b2f;text-decoration:none;font-weight:600;"');
  });

  test("does not carry mojibake into the customer portal", () => {
    expect(source).not.toContain("Ã¢");
    expect(source).not.toContain("Ãƒ");
    expect(source).not.toContain("LoadingÃƒ");
  });
});
