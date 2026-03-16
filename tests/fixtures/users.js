"use strict";

const USERS = {
  platformAdmin: {
    key: "platformAdmin",
    emailEnv: "TEST_PLATFORM_ADMIN_EMAIL",
    passwordEnv: "TEST_PLATFORM_ADMIN_PASSWORD",
    operatorRole: "platform_admin",
    profileRole: "platform_admin",
    tenantKey: null,
    name: "PL Test Platform Admin",
  },
  tenantAAdmin: {
    key: "tenantAAdmin",
    emailEnv: "TEST_TENANT_A_ADMIN_EMAIL",
    passwordEnv: "TEST_TENANT_A_ADMIN_PASSWORD",
    operatorRole: "admin",
    profileRole: "operator",
    tenantKey: "tenantA",
    name: "PL Test Tenant A Admin",
  },
  tenantAStaff: {
    key: "tenantAStaff",
    email: "pltest.tenant.a.staff@example.com",
    password: "ChangeMe123!",
    operatorRole: "staff",
    profileRole: "operator",
    tenantKey: "tenantA",
    name: "PL Test Tenant A Staff",
  },
  tenantBAdmin: {
    key: "tenantBAdmin",
    emailEnv: "TEST_TENANT_B_ADMIN_EMAIL",
    passwordEnv: "TEST_TENANT_B_ADMIN_PASSWORD",
    operatorRole: "admin",
    profileRole: "operator",
    tenantKey: "tenantB",
    name: "PL Test Tenant B Admin",
  },
};

function resolveUserConfig(user) {
  return {
    ...user,
    email: user.email || process.env[user.emailEnv],
    password: user.password || process.env[user.passwordEnv],
  };
}

module.exports = {
  USERS,
  resolveUserConfig,
};
