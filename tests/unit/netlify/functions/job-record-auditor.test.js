"use strict";

const { analyzeJobRecordAudit } = require("../../../../netlify/functions/agent/agents/job-record-auditor");

describe("job record auditor", () => {
  test("flags missing proof and billing blockers on a completed job", () => {
    const report = analyzeJobRecordAudit({
      tenant_id: "tenant_1",
      job: {
        id: "job_1",
        title: "Main Street Wash",
        status: "completed",
        order_id: "order_1",
        customer_id: "customer_1",
        completion_photo_required: true,
        signature_data_url: "",
      },
      order: {
        id: "order_1",
        total_cents: 18500,
        amount_due_cents: 18500,
        amount_paid_cents: 0,
        payment_state: "unpaid",
      },
      customer: { id: "customer_1", name: "Main Street HOA" },
      customer_location: null,
      photos: [],
      payments: [],
      expenses: [],
      time_segments: [],
      invoices: [],
      waste_manifests: [],
      compliance_alerts: [],
      assumptions: [],
      tables: { invoices_available: true },
      data_used: [],
    });

    expect(report.summary_status).toBe("blocked");
    expect(report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "job_missing_closeout_note",
      "job_missing_after_photo",
      "job_missing_signature",
      "invoice_missing_for_completed_job",
    ]));
    expect(report.recommended_actions.map((item) => item.id)).toEqual(expect.arrayContaining([
      "capture_closeout_proof",
      "create_invoice_draft",
    ]));
  });

  test("detects contradictory timing and payment-state conflicts", () => {
    const report = analyzeJobRecordAudit({
      tenant_id: "tenant_1",
      job: {
        id: "job_2",
        title: "Downtown Maintenance",
        status: "completed",
        order_id: "order_2",
        customer_id: "customer_2",
        completion_note: "Wrapped up",
        actual_start_at: "2026-04-02T14:00:00.000Z",
        actual_end_at: "2026-04-02T12:00:00.000Z",
        signature_data_url: "data:image/png;base64,abc",
        completion_photo_required: false,
      },
      order: {
        id: "order_2",
        total_cents: 22000,
        amount_due_cents: 2200,
        amount_paid_cents: 19800,
        payment_state: "paid",
      },
      customer: { id: "customer_2", name: "Downtown Towers" },
      photos: [{ id: "photo_1", photo_type: "after" }],
      payments: [{ id: "payment_1", amount_total: 19800, status: "succeeded" }],
      expenses: [],
      time_segments: [],
      invoices: [{ id: "invoice_1", status: "draft", total_cents: 22000 }],
      waste_manifests: [],
      compliance_alerts: [],
      assumptions: [],
      tables: { invoices_available: true },
      data_used: [],
    });

    expect(report.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "job_contradictory_timing",
      "order_payment_state_conflict",
    ]));
    expect(report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "job_contradictory_timing",
      "order_payment_state_conflict",
    ]));
  });
});
