"use strict";

const path = require("path");

describe("ai-agent-report", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/ai-agent-report.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const registryPath = path.resolve(process.cwd(), "netlify/functions/agent/registry.js");
  const runtimePath = path.resolve(process.cwd(), "netlify/functions/agent/runtime.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[registryPath];
    delete require.cache[runtimePath];
  });

  test("lists the available agents on GET", async () => {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        requireOperatorContext: vi.fn(),
        getAdminClient: vi.fn(),
      },
    };
    require.cache[registryPath] = {
      id: registryPath,
      filename: registryPath,
      loaded: true,
      exports: {
        listAgentDefinitions: () => [{ key: "job_record_auditor", label: "Job Record Auditor" }],
        publicAgentDefinition: (agent) => agent,
      },
    };
    require.cache[runtimePath] = {
      id: runtimePath,
      filename: runtimePath,
      loaded: true,
      exports: { runAgentReport: vi.fn() },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({ httpMethod: "GET" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.agents[0].key).toBe("job_record_auditor");
  });

  test("returns a structured report for a valid POST request", async () => {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        getAdminClient: vi.fn(() => ({})),
        requireOperatorContext: vi.fn(async () => ({
          supabase: {},
          tenantId: "tenant_1",
          operatorId: "operator_1",
        })),
      },
    };
    require.cache[registryPath] = {
      id: registryPath,
      filename: registryPath,
      loaded: true,
      exports: {
        listAgentDefinitions: () => [],
        publicAgentDefinition: (agent) => agent,
      },
    };
    require.cache[runtimePath] = {
      id: runtimePath,
      filename: runtimePath,
      loaded: true,
      exports: {
        runAgentReport: vi.fn(async () => ({
          trace_id: "trace_1",
          agent: { key: "job_record_auditor", label: "Job Record Auditor" },
          report: {
            agent_key: "job_record_auditor",
            agent_label: "Job Record Auditor",
            summary: "Blocked by missing proof.",
          },
        })),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ agent_key: "job_record_auditor", job_id: "job_1" }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.agent.key).toBe("job_record_auditor");
    expect(body.report.summary).toContain("missing proof");
  });
});
