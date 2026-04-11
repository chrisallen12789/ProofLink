"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPaymentStateHelpers() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator.js"),
    "utf8"
  );
  const start = source.indexOf("function normalizeWorkflowPaymentState");
  const end = source.indexOf("function orderStatusAdvancesBooking");
  const snippet = source.slice(start, end);
  const context = {
    PAYMENTS_CACHE: [],
    paymentRevenueContributionCents: () => 0,
    Date,
    Math,
  };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context;
}

describe("operator payment state helpers", () => {
  test("treats explicit paid and due amounts as partially paid even if the stored state still says unpaid", () => {
    const api = loadPaymentStateHelpers();

    expect(
      api.orderPaymentState({
        payment_state: "unpaid",
        amount_paid_cents: 15000,
        amount_due_cents: 20000,
        total_cents: 35000,
      })
    ).toBe("partially_paid");
  });

  test("treats explicit paid amount with no remaining due as paid even if the stored state still says unpaid", () => {
    const api = loadPaymentStateHelpers();

    expect(
      api.orderPaymentState({
        payment_state: "unpaid",
        amount_paid_cents: 35000,
        amount_due_cents: 0,
        total_cents: 35000,
      })
    ).toBe("paid");
  });
});
