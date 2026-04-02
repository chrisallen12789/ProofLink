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

  test("lists the available agents on GET for admins", async () => {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        requireAdminContext: vi.fn(async () => ({ role: "platform_admin" })),
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

  test("returns a structured report for a valid tenant-scoped POST request", async () => {
    const requireOperatorContext = vi.fn(async () => ({
      supabase: {},
      tenantId: "tenant_1",
      operatorId: "operator_1",
      role: "owner",
    }));
    const runAgentReport = vi.fn(async () => ({
      trace_id: "trace_1",
      agent: { key: "job_record_auditor", label: "Job Record Auditor" },
      report: {
        agent_key: "job_record_auditor",
        agent_label: "Job Record Auditor",
        summary: "Blocked by missing proof.",
      },
    }));

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        getAdminClient: vi.fn(() => ({})),
        requireAdminContext: vi.fn(),
        requireOperatorContext,
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
      exports: { runAgentReport },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ agent_key: "job_record_auditor", job_id: "job_1" }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(requireOperatorContext).toHaveBeenCalledWith(expect.any(Object), "");
    expect(runAgentReport).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_1",
      operatorId: "operator_1",
      agentKey: "job_record_auditor",
      input: { job_id: "job_1" },
    }));
    expect(body.ok).toBe(true);
    expect(body.report.summary).toContain("missing proof");
  });

  test("blocks workforce review for non-admin operators", async () => {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        getAdminClient: vi.fn(() => ({})),
        requireAdminContext: vi.fn(),
        requireOperatorContext: vi.fn(async () => ({
          supabase: {},
          tenantId: "tenant_1",
          operatorId: "operator_2",
          role: "owner",
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
      exports: { runAgentReport: vi.fn() },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ agent_key: "agent_workforce_architect" }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(403);
    expect(body.error).toContain("admin role required");
  });

  test("lets a platform admin target a tenant on POST", async () => {
    const requireOperatorContext = vi.fn(async () => ({
      supabase: {},
      tenantId: "tenant_admin_home",
      operatorId: "admin_1",
      role: "platform_admin",
    }));
    const runAgentReport = vi.fn(async () => ({
      trace_id: "trace_admin",
      agent: { key: "agent_workforce_architect", label: "AI Workforce Architect" },
      report: {
        agent_key: "agent_workforce_architect",
        agent_label: "AI Workforce Architect",
        summary: "ProofLink should add 1 specialist agent.",
      },
      context_summary: { new_agent_candidates: 1 },
    }));

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        getAdminClient: vi.fn(() => ({})),
        requireAdminContext: vi.fn(),
        requireOperatorContext,
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
      exports: { runAgentReport },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        agent_key: "agent_workforce_architect",
        tenant_id: "tenant_focus",
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(requireOperatorContext).toHaveBeenCalledWith(expect.any(Object), "tenant_focus");
    expect(runAgentReport).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_focus",
      agentKey: "agent_workforce_architect",
    }));
  });
});
