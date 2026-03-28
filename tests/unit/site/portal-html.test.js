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
    expect(source).toContain("Sign out and use another email");
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
    expect(source).toContain("portalAfterPaymentGuidance(o, dueCents, paidCents)");
    expect(source).toContain("portalPaymentStateLabel(order, dueCents, paidCents)");
    expect(source).toContain("summarizePortalPayments(orders)");
    expect(source).toContain("comparePortalOrders(a, b)");
    expect(source).toContain("renderOrdersSummary(orders)");
    expect(source).toContain('id="ordersSummary"');
    expect(source).toContain("renderBookingsSummary(bookings)");
    expect(source).toContain('id="bookingsSummary"');
    expect(source).toContain("Payment summary");
    expect(source).toContain("Appointment summary");
    expect(source).toContain("You are paid up right now.");
    expect(source).toContain("Next best step: Review ");
    expect(source).toContain("Paid in full. You are all set on this order.");
    expect(source).toContain("The business can now keep your next visit, closeout, or follow-up moving from here.");
    expect(source).toContain("Once the remaining balance is paid, this order will show as fully closed here automatically.");
    expect(source).toContain("A balance is still open.");
    expect(source).toContain("Payment status: ");
    expect(source).toContain("Partially paid");
    expect(source).toContain("checkoutState === 'success'");
    expect(source).toContain("checkoutState === 'cancel'");
    expect(source).toContain("hasTrustedCheckoutReturn(checkoutOrderId)");
    expect(source).toContain("prooflink_portal_checkout");
    expect(source).toContain("activatePortalTab('orders', true)");
    expect(source).toContain("Your payment for ");
    expect(source).toContain("No payment was made for ");
    expect(source).toContain('data-order-id="');
    expect(source).toContain("order-row--highlight");
    expect(source).toContain("focusPortalOrder(checkoutOrderId)");
    expect(source).toContain("if (tenantId && prefill && checkoutState)");
  });

  test("uses shared portal classes instead of inline return layouts", () => {
    expect(source).toContain('class="btn btn-ghost portal-back-btn"');
    expect(source).toContain('class="orders-summary hidden"');
    expect(source).toContain("order-row--focus");
    expect(source).toContain('class="package-balance-panel"');
    expect(source).toContain('class="order-row order-row--top"');
    expect(source).toContain('class="order-row stacked-row stacked-row--tight"');
    expect(source).toContain('class="payment-next-step-note"');
    expect(source).toContain('class="review-estimate-link"');
    expect(source).not.toContain('style="margin-top:12px;"');
    expect(source).not.toContain('style="flex-wrap:wrap;align-items:flex-start;"');
    expect(source).not.toContain('style="gap:6px;"');
    expect(source).not.toContain('style="font-size:.82rem;color:#c84b2f;text-decoration:none;font-weight:600;"');
  });

  test("keeps booking reassurance tied to the appointment lifecycle", () => {
    expect(source).toContain("summarizePortalBookings(bookings)");
    expect(source).toContain("function portalBookingGuidance(booking)");
    expect(source).toContain("Your next appointment is on the calendar");
    expect(source).toContain("A visit is still open");
    expect(source).toContain("Your recent appointments are wrapped up");
    expect(source).toContain("This appointment was cancelled. When you are ready, you can book another visit from this page.");
    expect(source).toContain("This visit is complete. The business will keep any follow-up, payment, or next-service step attached from here.");
    expect(source).toContain("This visit was marked as missed. Contact the business if you want help getting it back on the schedule.");
    expect(source).toContain("You are booked. If anything changes, you can cancel here or message the business from this account.");
    expect(source).toContain("window.confirm('Cancel this appointment? The business will see the update right away.')");
    expect(source).toContain("activatePortalTab(location.hash.replace(/^#/, ''), false)");
  });

  test("does not carry mojibake into the customer portal", () => {
    expect(source).not.toContain("Ã¢");
    expect(source).not.toContain("Ãƒ");
    expect(source).not.toContain("LoadingÃƒ");
  });
});
