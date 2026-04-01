"use strict";

function loadFreshEnvModule() {
  const modulePath = require.resolve("../../setup/env.test.js");
  delete require.cache[modulePath];
  return require("../../setup/env.test.js");
}

const REQUIRED_TEST_KEYS = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_SERVICE_ROLE_KEY",
  "TEST_SUPABASE_ANON_KEY",
  "TEST_SITE_URL",
  "TEST_PLATFORM_ADMIN_EMAIL",
  "TEST_PLATFORM_ADMIN_PASSWORD",
  "TEST_TENANT_A_ADMIN_EMAIL",
  "TEST_TENANT_A_ADMIN_PASSWORD",
  "TEST_TENANT_B_ADMIN_EMAIL",
  "TEST_TENANT_B_ADMIN_PASSWORD",
];

const VALID_TEST_ENV = {
  TEST_SUPABASE_URL: "https://pl-test-project.supabase.co",
  TEST_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  TEST_SUPABASE_ANON_KEY: "anon-secret",
  TEST_SITE_URL: "http://127.0.0.1:8888",
  TEST_PLATFORM_ADMIN_EMAIL: "platform-admin@prooflink.test",
  TEST_PLATFORM_ADMIN_PASSWORD: "platform-secret",
  TEST_TENANT_A_ADMIN_EMAIL: "tenant-a-admin@prooflink.test",
  TEST_TENANT_A_ADMIN_PASSWORD: "tenant-a-secret",
  TEST_TENANT_B_ADMIN_EMAIL: "tenant-b-admin@prooflink.test",
  TEST_TENANT_B_ADMIN_PASSWORD: "tenant-b-secret",
};

describe("tests/setup/env.test.js", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of REQUIRED_TEST_KEYS) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws when required TEST_* keys are missing", () => {
    const envModule = loadFreshEnvModule();
    expect(() => envModule.assertRequiredEnv()).toThrow(/Missing required test environment variables/);
  });

  it("throws when placeholder values are present", () => {
    Object.assign(process.env, VALID_TEST_ENV, {
      TEST_SUPABASE_URL: "https://your-project.supabase.co",
      TEST_PLATFORM_ADMIN_PASSWORD: "change-me",
    });
    const envModule = loadFreshEnvModule();
    expect(() => envModule.assertRequiredEnv()).toThrow(/Placeholder test environment values detected/);
  });

  it("passes when TEST_* keys are set to non-placeholder values", () => {
    Object.assign(process.env, VALID_TEST_ENV);
    const envModule = loadFreshEnvModule();
    expect(() => envModule.assertRequiredEnv()).not.toThrow();
  });

  it("allows non-template example.com test identities", () => {
    Object.assign(process.env, VALID_TEST_ENV, {
      TEST_PLATFORM_ADMIN_EMAIL: "platform-admin+ci@example.com",
      TEST_TENANT_A_ADMIN_EMAIL: "tenant-a-admin+ci@example.com",
      TEST_TENANT_B_ADMIN_EMAIL: "tenant-b-admin+ci@example.com",
    });
    const envModule = loadFreshEnvModule();
    expect(() => envModule.assertRequiredEnv()).not.toThrow();
  });
});
