"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeButton() {
  return {
    addEventListener: vi.fn(),
  };
}

function loadMoneyWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-money-workspace.js"),
    "utf8"
  );

  const elementMap = {
    btnRefreshReviews: makeButton(),
    reviewsList: { innerHTML: "" },
  };

  const context = {
    console,
    window: {},
    Set,
    CUSTOMERS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    JOBS_CACHE: [],
    PAYMENTS_CACHE: [],
    REVIEWS_CACHE: [],
    CURRENT_FOLLOW_UP_QUEUE: [],
    expenseCustomerId: { innerHTML: "", value: "", addEventListener: vi.fn() },
    expenseOrderId: { innerHTML: "", value: "", addEventListener: vi.fn() },
    expenseJobId: { innerHTML: "", value: "", addEventListener: vi.fn() },
    btnNewExpense: makeButton(),
    btnRefreshExpenses: makeButton(),
    expenseForm: { addEventListener: vi.fn() },
    btnDeleteExpense: makeButton(),
    expenseType: { addEventListener: vi.fn(), value: "overhead" },
    expenseChangeOrder: { addEventListener: vi.fn() },
    expenseLaborHours: { addEventListener: vi.fn() },
    expenseLaborRate: { addEventListener: vi.fn() },
    btnRefreshMoney: makeButton(),
    $: (id) => elementMap[id] || null,
    sortedCustomers: (rows) => rows,
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    formatUsd: (value) => `$${value}`,
    orderTotalCents: vi.fn(() => 0),
    customerById: vi.fn(() => null),
    linkedOrderForJob: vi.fn(() => null),
    normalizeExpenseType: vi.fn((value) => value),
    expenseLaborItem: vi.fn(() => null),
    expenseMaterialItems: vi.fn(() => []),
    expenseChangeOrderItem: vi.fn(() => null),
    costItemSummary: vi.fn(() => "Expense summary"),
    money: (value) => String(value),
    updateExpenseTypeVisibility: vi.fn(),
    syncExpenseLaborAmount: vi.fn(),
    refreshPicklists: vi.fn(async () => {}),
    renderStartupChecklist: vi.fn(),
    notifyOperator: vi.fn(),
    renderJobs: vi.fn(),
    renderMoney: null,
    fetchExpenses: vi.fn(async () => []),
    fetchReviews: vi.fn(async () => []),
    stars: vi.fn((rating) => `${rating} stars`),
    formatDateOnly: vi.fn(() => "Mar 26"),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator money workspace", () => {
  const paymentsSource = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-payments-workspace.js"),
    "utf8"
  );

  test("buildMoneyCollectionGuidance keeps deposits ahead of non-urgent balances", () => {
    const context = loadMoneyWorkspace({
      formatUsd: (value) => `$${value}`,
    });

    const guidance = context.buildMoneyCollectionGuidance({
      outstandingBalance: 12000,
      overdueBalance: 0,
      duePlansCount: 2,
      openDepositCount: 1,
      unpaidCompletedCount: 0,
    });

    expect(guidance.title).toBe("Collect the open deposits next");
    expect(guidance.chips).toContain("1 deposit open");
  });

  test("renderExpenseCustomerOptions builds customer choices", () => {
    const context = loadMoneyWorkspace({
      CUSTOMERS_CACHE: [
        { id: "customer_1", name: "Logan's Lawn Care" },
        { id: "customer_2", email: "owner@example.com" },
      ],
    });

    context.window.renderExpenseCustomerOptions("customer_2");

    expect(context.expenseCustomerId.innerHTML).toContain("Logan's Lawn Care");
    expect(context.expenseCustomerId.innerHTML).toContain("owner@example.com");
    expect(context.expenseCustomerId.value).toBe("customer_2");
  });

  test("renderReviews shows the empty state when there are no reviews", () => {
    const context = loadMoneyWorkspace();

    context.window.renderReviews([]);

    expect(context.$("reviewsList").innerHTML).toContain("No reviews yet");
  });

  test("initMoneyWorkspaceBindings wires the shared money handlers", () => {
    const context = loadMoneyWorkspace();

    context.window.initMoneyWorkspaceBindings();

    expect(context.btnRefreshExpenses.addEventListener).toHaveBeenCalled();
    expect(context.btnRefreshMoney.addEventListener).toHaveBeenCalled();
    expect(context.expenseForm.addEventListener).toHaveBeenCalled();
    expect(context.expenseType.addEventListener).toHaveBeenCalled();
  });

  test("payments workspace keeps manual collection language calm and plain", () => {
    expect(paymentsSource).toContain('paymentFormTitle.textContent = options.title || "Record payment"');
    expect(paymentsSource).toContain("No payments recorded yet. Record a deposit, final payment, or manual collection to see it here.");
    expect(paymentsSource).toContain("Online payments stay read-only here. Use this form for cash, check, or other manual collections.");
    expect(paymentsSource).not.toContain("Manual payment entry");
    expect(paymentsSource).not.toContain("Stripe-created payment records are read-only here.");
  });
});
