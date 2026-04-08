"use strict";

const fs = require("fs");
const path = require("path");

describe("netlify/functions order schema contract", () => {
  test("order notification and review flows use normalized order columns", () => {
    const sendOrderNotification = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/send-order-notification.js"),
      "utf8"
    );
    const requestReview = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/request-review.js"),
      "utf8"
    );
    const submitReview = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/submit-review.js"),
      "utf8"
    );

    expect(sendOrderNotification).toContain(".select('id, customer_name, email, status, cart_summary, notes')");
    expect(sendOrderNotification).toContain(".select('business_name, name')");
    expect(sendOrderNotification).not.toContain("customer_email, status, title, description");
    expect(requestReview).toContain(".select('id, customer_name, email, status, review_requested_at, tenant_id, operator_id')");
    expect(requestReview).not.toContain(".select('id, customer_name, customer_email, email, status, review_requested_at, tenant_id, operator_id')");
    expect(submitReview).toContain(".select('id, customer_name, email, tenant_id')");
    expect(submitReview).toContain("customer_email: order.email || null");
  });

  test("invoice and recurring-order flows use cart_summary, notes, and items", () => {
    const sendInvoiceEmail = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/send-invoice-email.js"),
      "utf8"
    );
    const generateInvoice = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/generate-invoice.js"),
      "utf8"
    );
    const sendPaymentReminder = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/send-payment-reminder.js"),
      "utf8"
    );
    const createRecurringOrder = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/create-recurring-order.js"),
      "utf8"
    );
    const getCustomerPortal = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/get-customer-portal.js"),
      "utf8"
    );

    expect(sendInvoiceEmail).toContain(".select('id, customer_name, email, cart_summary, notes, total_cents, status, created_at, tenant_id, invoice_number, payment_due_date')");
    expect(sendInvoiceEmail).toContain(".select('business_name, name, slug, logo_url')");
    expect(sendInvoiceEmail).toContain("title         : order.cart_summary || 'Service'");
    expect(generateInvoice).toContain("customer_email: order.customers?.email || order.email || ''");
    expect(generateInvoice).toContain(".select('business_name, name')");
    expect(generateInvoice).toContain("const orderTotalCents = Number(order.total_cents || 0) || 0;");
    expect(generateInvoice).toContain("order_title: order.cart_summary || order.notes || 'Invoice'");
    expect(sendPaymentReminder).toContain(".select('id, customer_name, email, cart_summary, total_cents, status, created_at')");
    expect(sendPaymentReminder).toContain(".select('business_name, name')");
    expect(sendPaymentReminder).toContain("customer_email: order.email");
    expect(createRecurringOrder).toContain(".select('id, cart_summary, notes, customer_id, customer_name, total_cents, items, service_address, schedule_window, operator_id, tenant_id')");
    expect(createRecurringOrder).toContain("const lineItems = Array.isArray(order.items) ? order.items : [];");
    expect(createRecurringOrder).toContain("const summary = String(order.notes || '').trim() || null;");
    expect(getCustomerPortal).toContain(".select('id, business_name, name')");
    expect(getCustomerPortal).toContain("title: order.cart_summary || order.customer_name || 'Order'");
    expect(getCustomerPortal).toContain("total_amount: totalCents / 100");
    expect(getCustomerPortal).not.toContain("title: order.title || order.cart_summary");
  });
});
