"use strict";

const { validateAgentReport } = require("../../../../netlify/functions/agent/schemas");

describe("agent schemas", () => {
  test("validates a grounded report and preserves linked evidence", () => {
    const report = validateAgentReport({
      agent_key: "job_record_auditor",
      agent_label: "Job Record Auditor",
      summary: "Job is blocked by missing proof.",
      summary_status: "blocked",
      findings: [
        {
          id: "finding_1",
          severity: "warning",
          category: "proof",
          title: "After photo is missing",
          detail: "No after photo was found on the completed job.",
          evidence_ids: ["proof_package"],
        },
      ],
      blockers: [
        {
          id: "blocker_1",
          title: "Upload the after photo",
          detail: "Completion proof is still missing.",
          evidence_ids: ["proof_package"],
        },
      ],
      evidence: [
        {
          id: "proof_package",
          label: "Proof package",
          record_type: "job",
          record_id: "job_1",
          field: "proof",
          value_excerpt: "0 after photos | signature missing",
        },
      ],
      assumptions: [],
      missing_data: [{ label: "After photo is missing", detail: "No after photo was found." }],
      confidence: { score: 0.66, rationale: "Proof and order data were available." },
      recommended_actions: [
        {
          id: "action_1",
          title: "Capture the missing proof",
          detail: "Upload the after photo before invoicing.",
          priority: "high",
          evidence_ids: ["proof_package"],
        },
      ],
    });

    expect(report.schema_version).toBe("prooflink.agent.report.v1");
    expect(report.findings[0].evidence_ids).toEqual(["proof_package"]);
    expect(report.recommended_actions[0].priority).toBe("high");
  });

  test("throws when a linked evidence id is missing from the report", () => {
    expect(() => validateAgentReport({
      agent_key: "job_record_auditor",
      agent_label: "Job Record Auditor",
      summary: "Broken report",
      findings: [
        {
          title: "Missing evidence",
          evidence_ids: ["missing_evidence"],
        },
      ],
      evidence: [],
      blockers: [],
      recommended_actions: [],
    })).toThrow('Unknown evidence reference "missing_evidence"');
  });
});
