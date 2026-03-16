"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-approve-onboarding.js");
const authUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const emailUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");
const slugifyPath = path.resolve(process.cwd(), "netlify/functions/utils/slugify.js");
const seedTemplatesPath = path.resolve(process.cwd(), "netlify/functions/lib/seed-templates.js");

function loadHandlerWithMocks({ authExports, emailExports, slugifyExports, seedTemplateExports }) {
  const originals = new Map([
    [authUtilsPath, require.cache[authUtilsPath]],
    [emailUtilsPath, require.cache[emailUtilsPath]],
    [slugifyPath, require.cache[slugifyPath]],
    [seedTemplatesPath, require.cache[seedTemplatesPath]],
    [handlerPath, require.cache[handlerPath]],
  ]);

  require.cache[authUtilsPath] = {
    id: authUtilsPath,
    filename: authUtilsPath,
    loaded: true,
    exports: authExports,
  };
  require.cache[emailUtilsPath] = {
    id: emailUtilsPath,
    filename: emailUtilsPath,
    loaded: true,
    exports: emailExports,
  };
  require.cache[slugifyPath] = {
    id: slugifyPath,
    filename: slugifyPath,
    loaded: true,
    exports: slugifyExports,
  };
  require.cache[seedTemplatesPath] = {
    id: seedTemplatesPath,
    filename: seedTemplatesPath,
    loaded: true,
    exports: seedTemplateExports,
  };
  delete require.cache[handlerPath];

  return {
    handler: require(handlerPath).handler,
    restore() {
      delete require.cache[handlerPath];
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
    },
  };
}

describe("netlify/functions/admin-approve-onboarding", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
  });

  test("fails closed when site URL configuration is missing", async () => {
    const supabase = { from: vi.fn(), auth: { admin: {} } };
    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(), templates: { provisioned: vi.fn() } },
      slugifyExports: { uniqueTenantSlug: vi.fn() },
      seedTemplateExports: { seedTemplateForTenant: vi.fn() },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest_missing_url" }),
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toBe("configuration_error");
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
